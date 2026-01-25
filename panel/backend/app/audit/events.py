import json
import logging
import time
from typing import Any

from sqlalchemy import select

from app.db.models import AuditEvent
from app.db.session import db_session

logger = logging.getLogger("panel.audit")


async def audit_event(
    *,
    action: str,
    actor_sub: str | None,
    actor_role: str | None,
    service_id: str | None,
    result: str,
    details: dict[str, Any] | None = None,
    request_id: str | None = None,
    actor_ip: str | None = None,
) -> None:
    ts = int(time.time())
    details_str = json.dumps(details or {}, sort_keys=True)

    # Scaffold: persist event row. Hash-chaining to be added once a stable key strategy is chosen.
    async with db_session() as session:
        prev = await session.execute(select(AuditEvent).order_by(AuditEvent.id.desc()).limit(1))
        prev_event = prev.scalar_one_or_none()

        evt = AuditEvent(
            ts=ts,
            action=action,
            actor_sub=actor_sub,
            actor_role=actor_role,
            service_id=service_id,
            result=result,
            request_id=request_id,
            actor_ip=actor_ip,
            details_json=details_str,
            prev_hash=getattr(prev_event, "event_hash", None) if prev_event else None,
            event_hash=None,
        )
        session.add(evt)
        await session.commit()

    logger.info("audit action=%s result=%s service_id=%s", action, result, service_id)
