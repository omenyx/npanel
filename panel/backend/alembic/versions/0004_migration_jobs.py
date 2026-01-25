"""Migration jobs table

Revision ID: 0004_migration_jobs
Revises: 0003_mail_tables
Create Date: 2026-01-25

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0004_migration_jobs"
down_revision = "0003_mail_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "migration_jobs",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("service_id", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("dry_run", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("source_host", sa.String(length=255), nullable=False),
        sa.Column("source_path", sa.String(length=1024), nullable=False),
        sa.Column("dest_path", sa.String(length=1024), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.Integer(), nullable=False),
    )
    op.create_index("ix_migration_jobs_service_id", "migration_jobs", ["service_id"], unique=False)
    op.create_index("ix_migration_jobs_status", "migration_jobs", ["status"], unique=False)
    op.create_index("ix_migration_jobs_created_at", "migration_jobs", ["created_at"], unique=False)
    op.create_index("ix_migration_jobs_updated_at", "migration_jobs", ["updated_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_migration_jobs_updated_at", table_name="migration_jobs")
    op.drop_index("ix_migration_jobs_created_at", table_name="migration_jobs")
    op.drop_index("ix_migration_jobs_status", table_name="migration_jobs")
    op.drop_index("ix_migration_jobs_service_id", table_name="migration_jobs")
    op.drop_table("migration_jobs")
