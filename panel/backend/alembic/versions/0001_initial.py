"""Initial schema

Revision ID: 0001_initial
Revises: 
Create Date: 2026-01-25

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "used_sso_jti",
        sa.Column("jti", sa.String(length=128), primary_key=True),
        sa.Column("expires_at", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
    )
    op.create_index("ix_used_sso_jti_expires_at", "used_sso_jti", ["expires_at"], unique=False)
    op.create_index("ix_used_sso_jti_created_at", "used_sso_jti", ["created_at"], unique=False)

    op.create_table(
        "panel_sessions",
        sa.Column("session_id", sa.String(length=128), primary_key=True),
        sa.Column("whmcs_user_id", sa.String(length=64), nullable=False),
        sa.Column("service_id", sa.String(length=64), nullable=False),
        sa.Column("auth_strength", sa.String(length=32), nullable=False, server_default="passkey"),
        sa.Column("created_at", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=False),
    )
    op.create_index("ix_panel_sessions_whmcs_user_id", "panel_sessions", ["whmcs_user_id"], unique=False)
    op.create_index("ix_panel_sessions_service_id", "panel_sessions", ["service_id"], unique=False)
    op.create_index("ix_panel_sessions_created_at", "panel_sessions", ["created_at"], unique=False)
    op.create_index("ix_panel_sessions_expires_at", "panel_sessions", ["expires_at"], unique=False)

    op.create_table(
        "whmcs_services",
        sa.Column("service_id", sa.String(length=64), primary_key=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("plan", sa.String(length=64), nullable=True),
        sa.Column("features", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("mail_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("dns_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("migration_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("quotas", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("updated_at", sa.Integer(), nullable=False),
    )
    op.create_index("ix_whmcs_services_status", "whmcs_services", ["status"], unique=False)
    op.create_index("ix_whmcs_services_updated_at", "whmcs_services", ["updated_at"], unique=False)

    op.create_table(
        "audit_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("ts", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(length=128), nullable=False),
        sa.Column("actor_sub", sa.String(length=128), nullable=True),
        sa.Column("actor_role", sa.String(length=64), nullable=True),
        sa.Column("service_id", sa.String(length=64), nullable=True),
        sa.Column("result", sa.String(length=32), nullable=False),
        sa.Column("request_id", sa.String(length=128), nullable=True),
        sa.Column("actor_ip", sa.String(length=64), nullable=True),
        sa.Column("details_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("prev_hash", sa.String(length=128), nullable=True),
        sa.Column("event_hash", sa.String(length=128), nullable=True),
    )
    op.create_index("ix_audit_events_ts", "audit_events", ["ts"], unique=False)
    op.create_index("ix_audit_events_action", "audit_events", ["action"], unique=False)
    op.create_index("ix_audit_events_actor_sub", "audit_events", ["actor_sub"], unique=False)
    op.create_index("ix_audit_events_actor_role", "audit_events", ["actor_role"], unique=False)
    op.create_index("ix_audit_events_service_id", "audit_events", ["service_id"], unique=False)
    op.create_index("ix_audit_events_result", "audit_events", ["result"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_audit_events_result", table_name="audit_events")
    op.drop_index("ix_audit_events_service_id", table_name="audit_events")
    op.drop_index("ix_audit_events_actor_role", table_name="audit_events")
    op.drop_index("ix_audit_events_actor_sub", table_name="audit_events")
    op.drop_index("ix_audit_events_action", table_name="audit_events")
    op.drop_index("ix_audit_events_ts", table_name="audit_events")
    op.drop_table("audit_events")

    op.drop_index("ix_whmcs_services_updated_at", table_name="whmcs_services")
    op.drop_index("ix_whmcs_services_status", table_name="whmcs_services")
    op.drop_table("whmcs_services")

    op.drop_index("ix_panel_sessions_expires_at", table_name="panel_sessions")
    op.drop_index("ix_panel_sessions_created_at", table_name="panel_sessions")
    op.drop_index("ix_panel_sessions_service_id", table_name="panel_sessions")
    op.drop_index("ix_panel_sessions_whmcs_user_id", table_name="panel_sessions")
    op.drop_table("panel_sessions")

    op.drop_index("ix_used_sso_jti_created_at", table_name="used_sso_jti")
    op.drop_index("ix_used_sso_jti_expires_at", table_name="used_sso_jti")
    op.drop_table("used_sso_jti")
