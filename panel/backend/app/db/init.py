from __future__ import annotations

from app.db.models import Base
from app.db.session import engine


async def init_db_schema() -> None:
    # Scaffold behavior: ensure tables exist.
    # Production: replace with Alembic migrations.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
