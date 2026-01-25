"""Mail tables (domains + mailboxes)

Revision ID: 0003_mail_tables
Revises: 0002_dns_zones
Create Date: 2026-01-25

"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0003_mail_tables"
down_revision = "0002_dns_zones"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mail_domains",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("service_id", sa.String(length=64), nullable=False),
        sa.Column("domain", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.Integer(), nullable=False),
    )
    op.create_index("ix_mail_domains_service_id", "mail_domains", ["service_id"], unique=False)
    op.create_index("ix_mail_domains_domain", "mail_domains", ["domain"], unique=True)
    op.create_index("ix_mail_domains_created_at", "mail_domains", ["created_at"], unique=False)

    op.create_table(
        "mailboxes",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("domain", sa.String(length=255), nullable=False),
        sa.Column("localpart", sa.String(length=64), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("quota_mb", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.Integer(), nullable=False),
    )
    op.create_index("ix_mailboxes_domain", "mailboxes", ["domain"], unique=False)
    op.create_index("ix_mailboxes_localpart", "mailboxes", ["localpart"], unique=False)
    op.create_index("ix_mailboxes_created_at", "mailboxes", ["created_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_mailboxes_created_at", table_name="mailboxes")
    op.drop_index("ix_mailboxes_localpart", table_name="mailboxes")
    op.drop_index("ix_mailboxes_domain", table_name="mailboxes")
    op.drop_table("mailboxes")

    op.drop_index("ix_mail_domains_created_at", table_name="mail_domains")
    op.drop_index("ix_mail_domains_domain", table_name="mail_domains")
    op.drop_index("ix_mail_domains_service_id", table_name="mail_domains")
    op.drop_table("mail_domains")
