"""DNS zones ownership mapping

Revision ID: 0002_dns_zones
Revises: 0001_initial
Create Date: 2026-01-25

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0002_dns_zones"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dns_zones",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("service_id", sa.String(length=64), nullable=False),
        sa.Column("zone_name", sa.String(length=255), nullable=False),
        sa.Column("pdns_zone_id", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.Integer(), nullable=False),
    )
    op.create_index("ix_dns_zones_service_id", "dns_zones", ["service_id"], unique=False)
    op.create_index("ix_dns_zones_zone_name", "dns_zones", ["zone_name"], unique=True)
    op.create_index("ix_dns_zones_created_at", "dns_zones", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_dns_zones_created_at", table_name="dns_zones")
    op.drop_index("ix_dns_zones_zone_name", table_name="dns_zones")
    op.drop_index("ix_dns_zones_service_id", table_name="dns_zones")
    op.drop_table("dns_zones")
