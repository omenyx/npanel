from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.audit.events import audit_event
from app.db.models import MigrationJob
from app.db.session import db_session

router = APIRouter(prefix="/api/migrations", tags=["migrations"])


class CreateMigrationJobRequest(BaseModel):
    source_host: str = Field(min_length=1, max_length=255)
    source_path: str = Field(min_length=1, max_length=1024)
    dest_path: str = Field(min_length=1, max_length=1024)
    dry_run: bool = True


def _require_migration_enabled(request: Request) -> str:
    service_id = getattr(request.state, "service_id", None)
    if not service_id:
        raise HTTPException(status_code=401, detail="authentication required")

    state = getattr(request.state, "service_state", None)
    if not state or not getattr(state, "migration_enabled", False):
        raise HTTPException(status_code=403, detail="migration not enabled for service")

    return service_id


@router.get("/jobs")
async def list_jobs(request: Request) -> dict:
    service_id = _require_migration_enabled(request)

    async with db_session() as session:
        rows = await session.execute(select(MigrationJob).where(MigrationJob.service_id == service_id).order_by(MigrationJob.id.desc()))
        jobs = rows.scalars().all()

    return {
        "jobs": [
            {
                "id": j.id,
                "status": j.status,
                "source_host": j.source_host,
                "source_path": j.source_path,
                "dest_path": j.dest_path,
                "dry_run": j.dry_run,
                "created_at": j.created_at,
                "updated_at": j.updated_at,
                "last_error": j.last_error,
            }
            for j in jobs
        ]
    }


@router.post("/jobs")
async def create_job(request: Request, body: CreateMigrationJobRequest) -> dict:
    service_id = _require_migration_enabled(request)

    async with db_session() as session:
        job = MigrationJob(
            service_id=service_id,
            status="pending",
            source_host=body.source_host,
            source_path=body.source_path,
            dest_path=body.dest_path,
            dry_run=bool(body.dry_run),
        )
        session.add(job)
        await session.commit()
        await session.refresh(job)

    await audit_event(
        action="migration_create_job",
        actor_sub=request.state.actor_sub,
        actor_role=request.state.actor_role,
        service_id=service_id,
        result="ok",
        details={"job_id": job.id, "dry_run": job.dry_run},
    )

    return {"ok": True, "job_id": job.id}
