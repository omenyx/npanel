from __future__ import annotations

import time

from sqlalchemy import select

from app.db.models import WHMCSServiceState
from app.db.session import db_session


async def get_service_state(service_id: str) -> WHMCSServiceState | None:
    async with db_session() as session:
        return await session.get(WHMCSServiceState, service_id)


async def get_service_status(service_id: str) -> str | None:
    async with db_session() as session:
        row = await session.execute(select(WHMCSServiceState).where(WHMCSServiceState.service_id == service_id))
        state = row.scalar_one_or_none()
        return state.status if state else None


async def upsert_service_state(
    *,
    service_id: str,
    status: str,
    plan: str | None = None,
    features: dict | None = None,
    mail_enabled: bool = False,
    dns_enabled: bool = False,
    migration_enabled: bool = False,
    quotas: dict | None = None,
) -> None:
    now = int(time.time())
    async with db_session() as session:
        existing = await session.get(WHMCSServiceState, service_id)
        if existing:
            existing.status = status
            existing.plan = plan
            existing.features = features
            existing.mail_enabled = bool(mail_enabled)
            existing.dns_enabled = bool(dns_enabled)
            existing.migration_enabled = bool(migration_enabled)
            existing.quotas = quotas
            existing.updated_at = now
        else:
            session.add(
                WHMCSServiceState(
                    service_id=service_id,
                    status=status,
                    plan=plan,
                    features=features,
                    mail_enabled=bool(mail_enabled),
                    dns_enabled=bool(dns_enabled),
                    migration_enabled=bool(migration_enabled),
                    quotas=quotas,
                    updated_at=now,
                )
            )
        await session.commit()
