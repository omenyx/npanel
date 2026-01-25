from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import and_, select

from app.audit.events import audit_event
from app.db.models import DNSZone
from app.db.session import db_session
from app.dns.powerdns import create_zone as pdns_create_zone
from app.dns.powerdns import list_zones as pdns_list_zones
from app.dns.powerdns import patch_rrsets as pdns_patch_rrsets
from app.dns.validation import validate_rrset

router = APIRouter(prefix="/api/dns", tags=["dns"])


class CreateZoneRequest(BaseModel):
    name: str
    nameservers: list[str] = ["ns1.example.com", "ns2.example.com"]


class PatchRRSet(BaseModel):
    name: str
    type: str
    ttl: int = Field(ge=60, le=86400)
    records: list[str]


class PatchRecordsRequest(BaseModel):
    rrsets: list[PatchRRSet]


def _require_dns_enabled(request: Request) -> tuple[str, str]:
    service_id = getattr(request.state, "service_id", None)
    if not service_id:
        raise HTTPException(status_code=401, detail="authentication required")

    state = getattr(request.state, "service_state", None)
    if not state or not getattr(state, "dns_enabled", False):
        raise HTTPException(status_code=403, detail="dns not enabled for service")

    status = (getattr(request.state, "service_status", "") or "").lower()
    return service_id, status


@router.get("/zones")
async def list_zones(request: Request) -> dict:
    service_id, _ = _require_dns_enabled(request)

    async with db_session() as session:
        rows = await session.execute(select(DNSZone).where(DNSZone.service_id == service_id).order_by(DNSZone.zone_name.asc()))
        zones = rows.scalars().all()

    return {
        "zones": [
            {"zone_name": z.zone_name, "created_at": z.created_at, "pdns_zone_id": z.pdns_zone_id}
            for z in zones
        ]
    }


@router.post("/zones")
async def create_zone(request: Request, body: CreateZoneRequest) -> dict:
    service_id, _ = _require_dns_enabled(request)

    zone_name = body.name.strip().lower()
    if not zone_name:
        raise HTTPException(status_code=400, detail="missing zone name")

    # Create zone in PowerDNS first (external side effect), then persist ownership mapping.
    try:
        created = await pdns_create_zone(name=zone_name, nameservers=body.nameservers)
    except Exception as exc:
        await audit_event(action="dns_create_zone", actor_sub=request.state.actor_sub, actor_role=request.state.actor_role, service_id=service_id, result="error", details={"zone": zone_name, "error": str(exc)})
        raise HTTPException(status_code=502, detail="powerdns error") from exc

    async with db_session() as session:
        existing = await session.execute(select(DNSZone).where(DNSZone.zone_name == created.name))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="zone already exists")

        session.add(DNSZone(service_id=service_id, zone_name=created.name, pdns_zone_id=created.id))
        await session.commit()

    await audit_event(action="dns_create_zone", actor_sub=request.state.actor_sub, actor_role=request.state.actor_role, service_id=service_id, result="ok", details={"zone": created.name})
    return {"ok": True, "zone": {"name": created.name, "id": created.id}}


@router.get("/powerdns/zones")
async def debug_list_powerdns_zones(request: Request) -> dict:
    # Intentionally behind auth+feature gate; helps validate PowerDNS connectivity.
    _require_dns_enabled(request)

    zones = await pdns_list_zones()
    return {"zones": [{"id": z.id, "name": z.name, "kind": z.kind} for z in zones]}


@router.patch("/zones/{zone}/records")
async def patch_records(request: Request, zone: str, body: PatchRecordsRequest) -> dict:
    service_id, _ = _require_dns_enabled(request)

    zone_name = zone.strip().lower()
    if not zone_name:
        raise HTTPException(status_code=400, detail="missing zone")

    # Enforce per-service zone ownership.
    async with db_session() as session:
        row = await session.execute(
            select(DNSZone).where(and_(DNSZone.service_id == service_id, DNSZone.zone_name == (zone_name if zone_name.endswith(".") else f"{zone_name}.")))
        )
        owned = row.scalar_one_or_none()
        if not owned:
            raise HTTPException(status_code=404, detail="zone not found")

    rrsets_payload: list[dict] = []
    try:
        for rr in body.rrsets:
            validated = validate_rrset(zone_name=owned.zone_name, name=rr.name, rtype=rr.type, ttl=rr.ttl, records=rr.records)
            rrsets_payload.append(
                {
                    "name": validated.name,
                    "type": validated.rtype,
                    "ttl": validated.ttl,
                    "changetype": "REPLACE",
                    "records": [{"content": c, "disabled": False} for c in validated.records],
                }
            )
    except ValueError as exc:
        await audit_event(
            action="dns_patch_records",
            actor_sub=request.state.actor_sub,
            actor_role=request.state.actor_role,
            service_id=service_id,
            result="denied",
            details={"zone": owned.zone_name, "reason": str(exc)},
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        await pdns_patch_rrsets(zone_id=owned.pdns_zone_id or owned.zone_name, rrsets=rrsets_payload)
    except Exception as exc:
        await audit_event(
            action="dns_patch_records",
            actor_sub=request.state.actor_sub,
            actor_role=request.state.actor_role,
            service_id=service_id,
            result="error",
            details={"zone": owned.zone_name, "error": str(exc)},
        )
        raise HTTPException(status_code=502, detail="powerdns error") from exc

    await audit_event(
        action="dns_patch_records",
        actor_sub=request.state.actor_sub,
        actor_role=request.state.actor_role,
        service_id=service_id,
        result="ok",
        details={"zone": owned.zone_name, "rrsets": [{"name": r["name"], "type": r["type"], "ttl": r["ttl"]} for r in rrsets_payload]},
    )

    return {"ok": True}
