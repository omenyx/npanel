from __future__ import annotations

import time
from typing import Any

from sqlalchemy import BigInteger, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class UsedSSOJTI(Base):
    __tablename__ = "used_sso_jti"

    jti: Mapped[str] = mapped_column(String(128), primary_key=True)
    expires_at: Mapped[int] = mapped_column(Integer, index=True)
    created_at: Mapped[int] = mapped_column(Integer, default=lambda: int(time.time()), index=True)


class PanelSession(Base):
    __tablename__ = "panel_sessions"

    session_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    whmcs_user_id: Mapped[str] = mapped_column(String(64), index=True)
    service_id: Mapped[str] = mapped_column(String(64), index=True)
    auth_strength: Mapped[str] = mapped_column(String(32), default="passkey")

    created_at: Mapped[int] = mapped_column(Integer, default=lambda: int(time.time()), index=True)
    expires_at: Mapped[int] = mapped_column(Integer, index=True)


class WHMCSServiceState(Base):
    __tablename__ = "whmcs_services"

    service_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    plan: Mapped[str | None] = mapped_column(String(64), nullable=True)
    features: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Fast-path flags derived from WHMCS/webhook mapping (kept redundant with `features` for easy enforcement).
    mail_enabled: Mapped[bool] = mapped_column(default=False)
    dns_enabled: Mapped[bool] = mapped_column(default=False)
    migration_enabled: Mapped[bool] = mapped_column(default=False)
    quotas: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    updated_at: Mapped[int] = mapped_column(Integer, default=lambda: int(time.time()), onupdate=lambda: int(time.time()), index=True)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    ts: Mapped[int] = mapped_column(Integer, index=True)

    action: Mapped[str] = mapped_column(String(128), index=True)
    actor_sub: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    actor_role: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    service_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    result: Mapped[str] = mapped_column(String(32), index=True)

    request_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    actor_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)

    details_json: Mapped[str] = mapped_column(Text, default="{}")
    prev_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    event_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)


class DNSZone(Base):
    __tablename__ = "dns_zones"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    service_id: Mapped[str] = mapped_column(String(64), index=True)
    zone_name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    pdns_zone_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_at: Mapped[int] = mapped_column(Integer, default=lambda: int(time.time()), index=True)


class MailDomain(Base):
    __tablename__ = "mail_domains"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    service_id: Mapped[str] = mapped_column(String(64), index=True)
    domain: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    created_at: Mapped[int] = mapped_column(Integer, default=lambda: int(time.time()), index=True)


class Mailbox(Base):
    __tablename__ = "mailboxes"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    domain: Mapped[str] = mapped_column(String(255), index=True)
    localpart: Mapped[str] = mapped_column(String(64), index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    quota_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[int] = mapped_column(Integer, default=lambda: int(time.time()), index=True)


class MigrationJob(Base):
    __tablename__ = "migration_jobs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    service_id: Mapped[str] = mapped_column(String(64), index=True)

    status: Mapped[str] = mapped_column(String(32), index=True)
    dry_run: Mapped[bool] = mapped_column(default=True)

    source_host: Mapped[str] = mapped_column(String(255))
    source_path: Mapped[str] = mapped_column(String(1024))
    dest_path: Mapped[str] = mapped_column(String(1024))

    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[int] = mapped_column(Integer, default=lambda: int(time.time()), index=True)
    updated_at: Mapped[int] = mapped_column(Integer, default=lambda: int(time.time()), index=True)
