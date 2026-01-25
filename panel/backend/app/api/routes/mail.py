from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import and_, select

from app.audit.events import audit_event
from app.db.models import MailDomain, Mailbox
from app.db.session import db_session
from app.mail.passwords import hash_password

router = APIRouter(prefix="/api/mail", tags=["mail"])


class CreateDomainRequest(BaseModel):
    domain: str


class CreateMailboxRequest(BaseModel):
    localpart: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=10, max_length=256)
    quota_mb: int | None = Field(default=None, ge=1, le=102400)


def _require_mail_enabled(request: Request) -> str:
    service_id = getattr(request.state, "service_id", None)
    if not service_id:
        raise HTTPException(status_code=401, detail="authentication required")

    state = getattr(request.state, "service_state", None)
    if not state or not getattr(state, "mail_enabled", False):
        raise HTTPException(status_code=403, detail="mail not enabled for service")

    return service_id


@router.get("/domains")
async def list_domains(request: Request) -> dict:
    service_id = _require_mail_enabled(request)

    async with db_session() as session:
        rows = await session.execute(select(MailDomain).where(MailDomain.service_id == service_id).order_by(MailDomain.domain.asc()))
        domains = rows.scalars().all()

    return {"domains": [{"domain": d.domain, "created_at": d.created_at} for d in domains]}


@router.post("/domains")
async def create_domain(request: Request, body: CreateDomainRequest) -> dict:
    service_id = _require_mail_enabled(request)

    domain = body.domain.strip().lower()
    if not domain:
        raise HTTPException(status_code=400, detail="missing domain")

    async with db_session() as session:
        existing = await session.execute(select(MailDomain).where(MailDomain.domain == domain))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="domain already exists")

        session.add(MailDomain(service_id=service_id, domain=domain))
        await session.commit()

    await audit_event(action="mail_create_domain", actor_sub=request.state.actor_sub, actor_role=request.state.actor_role, service_id=service_id, result="ok", details={"domain": domain})
    return {"ok": True}


@router.get("/domains/{domain}/mailboxes")
async def list_mailboxes(request: Request, domain: str) -> dict:
    service_id = _require_mail_enabled(request)
    domain = domain.strip().lower()

    async with db_session() as session:
        drow = await session.execute(select(MailDomain).where(and_(MailDomain.service_id == service_id, MailDomain.domain == domain)))
        if not drow.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="domain not found")

        rows = await session.execute(select(Mailbox).where(Mailbox.domain == domain).order_by(Mailbox.localpart.asc()))
        boxes = rows.scalars().all()

    return {"mailboxes": [{"email": f"{m.localpart}@{m.domain}", "quota_mb": m.quota_mb, "created_at": m.created_at} for m in boxes]}


@router.post("/domains/{domain}/mailboxes")
async def create_mailbox(request: Request, domain: str, body: CreateMailboxRequest) -> dict:
    service_id = _require_mail_enabled(request)
    domain = domain.strip().lower()
    localpart = body.localpart.strip().lower()

    async with db_session() as session:
        drow = await session.execute(select(MailDomain).where(and_(MailDomain.service_id == service_id, MailDomain.domain == domain)))
        if not drow.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="domain not found")

        existing = await session.execute(select(Mailbox).where(and_(Mailbox.domain == domain, Mailbox.localpart == localpart)))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="mailbox already exists")

        session.add(
            Mailbox(
                domain=domain,
                localpart=localpart,
                password_hash=hash_password(body.password),
                quota_mb=body.quota_mb,
            )
        )
        await session.commit()

    await audit_event(action="mail_create_mailbox", actor_sub=request.state.actor_sub, actor_role=request.state.actor_role, service_id=service_id, result="ok", details={"email": f"{localpart}@{domain}"})
    return {"ok": True}
