from pathlib import Path

from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select

from app.audit.events import audit_event
from app.db.models import DNSZone
from app.db.session import db_session
from app.dns.powerdns import create_zone as pdns_create_zone

router = APIRouter(tags=["pages"])

_templates_dir = Path(__file__).resolve().parents[4] / "frontend" / "templates"
templates = Jinja2Templates(directory=str(_templates_dir))


@router.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    return templates.TemplateResponse(
        "dashboard.html",
        {
            "request": request,
            "service_id": getattr(request.state, "service_id", None),
            "service_status": getattr(request.state, "service_status", None),
        },
    )


@router.get("/dns", response_class=HTMLResponse)
async def dns_page(request: Request):
    service_id = getattr(request.state, "service_id", None)
    service_state = getattr(request.state, "service_state", None)
    dns_enabled = bool(getattr(service_state, "dns_enabled", False)) if service_state else False

    zones = []
    if service_id and dns_enabled:
        async with db_session() as session:
            rows = await session.execute(select(DNSZone).where(DNSZone.service_id == service_id).order_by(DNSZone.zone_name.asc()))
            zones = list(rows.scalars().all())

    return templates.TemplateResponse(
        "dns.html",
        {
            "request": request,
            "service_id": service_id,
            "dns_enabled": dns_enabled,
            "zones": zones,
        },
    )


@router.post("/dns/zones")
async def dns_create_zone(request: Request, name: str = Form(...)):
    service_id = getattr(request.state, "service_id", None)
    service_state = getattr(request.state, "service_state", None)
    if not service_id:
        return RedirectResponse(url="/", status_code=303)
    if not service_state or not getattr(service_state, "dns_enabled", False):
        await audit_event(action="dns_create_zone", actor_sub=request.state.actor_sub, actor_role=request.state.actor_role, service_id=service_id, result="denied", details={"reason": "dns not enabled"})
        return RedirectResponse(url="/dns", status_code=303)

    zone_name = name.strip().lower()
    try:
        created = await pdns_create_zone(name=zone_name, nameservers=["ns1.example.com", "ns2.example.com"])
    except Exception as exc:
        await audit_event(action="dns_create_zone", actor_sub=request.state.actor_sub, actor_role=request.state.actor_role, service_id=service_id, result="error", details={"zone": zone_name, "error": str(exc)})
        return RedirectResponse(url="/dns", status_code=303)

    async with db_session() as session:
        existing = await session.execute(select(DNSZone).where(DNSZone.zone_name == created.name))
        if existing.scalar_one_or_none():
            return RedirectResponse(url="/dns", status_code=303)
        session.add(DNSZone(service_id=service_id, zone_name=created.name, pdns_zone_id=created.id))
        await session.commit()

    await audit_event(action="dns_create_zone", actor_sub=request.state.actor_sub, actor_role=request.state.actor_role, service_id=service_id, result="ok", details={"zone": created.name})
    return RedirectResponse(url="/dns", status_code=303)
