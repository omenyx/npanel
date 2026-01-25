"""Run a queued rsync migration job.

This is intentionally a *server-side* helper and is not invoked by the API.
A production deployment should run this under a dedicated agent with strict
allowlists and secret handling.

Usage:
  python panel/scripts/run_migration_job.py --job-id 123 --db-dsn "postgresql+asyncpg://..."
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import shlex
import subprocess
import time
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-id", type=int, required=True)
    parser.add_argument("--db-dsn", type=str, default=os.environ.get("PANEL_POSTGRES_DSN", ""))
    args = parser.parse_args()

    if not args.db_dsn:
        raise SystemExit("Missing --db-dsn (or PANEL_POSTGRES_DSN)")

    # Make backend `app` importable when invoked from repo root.
    backend_root = Path(__file__).resolve().parents[1] / "backend"
    if str(backend_root) not in sys.path:
        sys.path.insert(0, str(backend_root))

    from app.db.models import MigrationJob  # type: ignore

    engine = create_async_engine(args.db_dsn, pool_pre_ping=True)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as session:
        row = await session.execute(select(MigrationJob).where(MigrationJob.id == args.job_id))
        job = row.scalar_one_or_none()
        if not job:
            raise SystemExit(f"Job {args.job_id} not found")

        job.status = "running"
        job.updated_at = int(time.time())
        await session.commit()

    # NOTE: This uses ssh+rsync; credentials/keys are out of scope here.
    # Destination is local dest_path; source is user@host:path style.
    source = f"{job.source_host}:{job.source_path.rstrip('/')}/"
    dest = job.dest_path.rstrip("/") + "/"

    cmd = [
        "rsync",
        "-aHAX",
        "--numeric-ids",
        "--info=progress2",
        "--delete",
    ]
    if job.dry_run:
        cmd.append("--dry-run")
    cmd.extend([source, dest])

    try:
        subprocess.run(cmd, check=True)
        status = "succeeded"
        last_error = None
    except subprocess.CalledProcessError as exc:
        status = "failed"
        last_error = f"rsync exit {exc.returncode}"

    async with Session() as session:
        row = await session.execute(select(MigrationJob).where(MigrationJob.id == args.job_id))
        job2 = row.scalar_one_or_none()
        if not job2:
            raise SystemExit("Job disappeared")
        job2.status = status
        job2.last_error = last_error
        job2.updated_at = int(time.time())
        await session.commit()

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
