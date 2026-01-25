import time

from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError

from app.db.models import UsedSSOJTI
from app.db.session import db_session


class ReplayStore:
    async def consume_once(self, jti: str, exp: int, *, grace_seconds: int = 0) -> None:
        now = int(time.time())
        expires_at = int(exp) + int(grace_seconds)

        async with db_session() as session:
            # Best-effort cleanup
            await session.execute(delete(UsedSSOJTI).where(UsedSSOJTI.expires_at <= now))

            session.add(UsedSSOJTI(jti=jti, expires_at=expires_at, created_at=now))
            try:
                await session.commit()
            except IntegrityError as exc:
                await session.rollback()
                raise ValueError("replay detected") from exc
