from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class WHMCSServiceUpdate:
    service_id: str
    status: str
    plan: str | None
    features: dict[str, Any] | None
    mail_enabled: bool
    dns_enabled: bool
    migration_enabled: bool
    quotas: dict[str, Any] | None


def normalize_service_status(raw: str) -> str:
    v = (raw or "").strip().lower()

    # Common WHMCS statuses (and typical variants).
    if v in {"active", "active service", "ok"}:
        return "active"
    if v in {"suspended", "suspend", "on hold", "overdue"}:
        return "suspended"
    if v in {"terminated", "terminate", "cancelled", "canceled", "fraud", "closed"}:
        return "terminated"

    # Default: treat unknown as suspended (safe-by-default).
    return "suspended"


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on", "enabled"}
    return False


def parse_whmcs_webhook(payload: dict[str, Any]) -> WHMCSServiceUpdate:
    # Minimal, stable extraction; exact schema depends on WHMCS webhook config/plugin.
    service_id = str(
        payload.get("service_id")
        or payload.get("serviceid")
        or (payload.get("service") or {}).get("id")
        or ""
    ).strip()

    raw_status = str(
        payload.get("status")
        or payload.get("service_status")
        or (payload.get("service") or {}).get("status")
        or ""
    )

    plan = payload.get("plan") or payload.get("product") or payload.get("product_name")

    features = payload.get("features")
    if features is not None and not isinstance(features, dict):
        # Ignore unexpected shapes rather than crashing.
        features = None

    quotas = payload.get("quotas")
    if quotas is not None and not isinstance(quotas, dict):
        quotas = None

    # Allow either top-level booleans or nested under `features`.
    mail_enabled = _truthy(payload.get("mail_enabled")) or _truthy((features or {}).get("mail_enabled"))
    dns_enabled = _truthy(payload.get("dns_enabled")) or _truthy((features or {}).get("dns_enabled"))
    migration_enabled = _truthy(payload.get("migration_enabled")) or _truthy((features or {}).get("migration_enabled"))

    return WHMCSServiceUpdate(
        service_id=service_id,
        status=normalize_service_status(raw_status),
        plan=str(plan) if plan else None,
        features=features,
        mail_enabled=mail_enabled,
        dns_enabled=dns_enabled,
        migration_enabled=migration_enabled,
        quotas=quotas,
    )
