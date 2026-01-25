import secrets
import time
from dataclasses import dataclass

from sqlalchemy import delete, select

from app.db.models import PanelSession
from app.db.session import db_session


@dataclass(frozen=True)
class Session:
    session_id: str
    whmcs_user_id: str
    service_id: str
    created_at: int
    expires_at: int
    auth_strength: str  # password_only | passkey


class SessionStore:
    async def create(self, *, whmcs_user_id: str, service_id: str, ttl_seconds: int) -> Session:
        now = int(time.time())
        session_id = secrets.token_urlsafe(32)
        expires_at = now + int(ttl_seconds)

        async with db_session() as session:
            session.add(
                PanelSession(
                    session_id=session_id,
                    whmcs_user_id=whmcs_user_id,
                    service_id=service_id,
                    auth_strength="passkey",
                    created_at=now,
                    expires_at=expires_at,
                )
            )
            await session.commit()

        return Session(
            session_id=session_id,
            whmcs_user_id=whmcs_user_id,
            service_id=service_id,
            created_at=now,
            expires_at=expires_at,
            auth_strength="passkey",
        )

    async def get(self, session_id: str) -> Session | None:
        now = int(time.time())
        async with db_session() as session:
            row = await session.execute(select(PanelSession).where(PanelSession.session_id == session_id))
            ps = row.scalar_one_or_none()
            if not ps:
                return None
            if ps.expires_at <= now:
                await session.execute(delete(PanelSession).where(PanelSession.session_id == session_id))
                await session.commit()
                return None
            return Session(
                session_id=ps.session_id,
                whmcs_user_id=ps.whmcs_user_id,
                service_id=ps.service_id,
                created_at=ps.created_at,
                expires_at=ps.expires_at,
                auth_strength=ps.auth_strength,
            )


session_store = SessionStore()
