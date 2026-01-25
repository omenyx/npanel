from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app.config.settings import settings
from app.audit.events import audit_event
from app.whmcs.service_state import upsert_service_state
from app.whmcs.webhook_mapping import parse_whmcs_webhook

router = APIRouter(prefix="/webhooks/whmcs", tags=["webhooks", "whmcs"])


def _verify_signature(raw_body: bytes, signature: str) -> bool:
    secret = settings.whmcs_webhook_secret
    if not secret:
        return False
    mac = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, signature.strip())


@router.post("")
async def whmcs_webhook(request: Request) -> dict:
    raw = await request.body()
    signature = request.headers.get("X-WHMCS-Signature") or request.headers.get("X-Whmcs-Signature")
    if not signature or not _verify_signature(raw, signature):
        await audit_event(action="whmcs_webhook", actor_sub=None, actor_role=None, service_id=None, result="denied", details={"reason": "bad signature"})
        raise HTTPException(status_code=401, detail="invalid signature")

    try:
        payload: dict[str, Any] = json.loads(raw.decode("utf-8"))
    except Exception as exc:
        await audit_event(action="whmcs_webhook", actor_sub=None, actor_role=None, service_id=None, result="denied", details={"reason": "bad json"})
        raise HTTPException(status_code=400, detail="invalid json") from exc

    update = parse_whmcs_webhook(payload)
    if not update.service_id or not update.status:
        await audit_event(action="whmcs_webhook", actor_sub=None, actor_role=None, service_id=None, result="denied", details={"reason": "missing service_id/status"})
        raise HTTPException(status_code=400, detail="missing service_id/status")

    await upsert_service_state(
        service_id=update.service_id,
        status=update.status,
        plan=update.plan,
        features=update.features,
        mail_enabled=update.mail_enabled,
        dns_enabled=update.dns_enabled,
        migration_enabled=update.migration_enabled,
        quotas=update.quotas,
    )

    await audit_event(action="whmcs_webhook", actor_sub=None, actor_role=None, service_id=update.service_id, result="ok", details={"status": update.status})
    return {"ok": True}
