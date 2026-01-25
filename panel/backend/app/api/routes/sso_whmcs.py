from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import RedirectResponse

from app.whmcs.sso import validate_and_consume_sso_token
from app.auth.sessions import session_store
from app.audit.events import audit_event
from app.whmcs.service_state import upsert_service_state

router = APIRouter(prefix="/sso", tags=["sso"])


@router.get("/whmcs")
async def whmcs_sso(request: Request, token: str = Query(...), format: str | None = Query(default=None)):
    try:
        claims = await validate_and_consume_sso_token(token)
    except ValueError as exc:
        await audit_event(action="whmcs_sso", actor_sub=None, actor_role=None, service_id=None, result="denied", details={"reason": str(exc)})
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    # Service status is driven by WHMCS events (webhooks). If we haven't seen the service
    # yet, seed it as active and rely on webhook/reconciliation to correct.
    await upsert_service_state(service_id=str(claims["service_id"]), status="active")

    session = await session_store.create(
        whmcs_user_id=str(claims["sub"]),
        service_id=str(claims["service_id"]),
        ttl_seconds=3600,
    )

    await audit_event(
        action="whmcs_sso",
        actor_sub=session.whmcs_user_id,
        actor_role="customer",
        service_id=session.service_id,
        result="ok",
        details={"return_to": claims.get("return_to")},
    )

    wants_json = (format == "json") or ("application/json" in (request.headers.get("accept") or ""))
    if wants_json:
        return {"ok": True, "session_id": session.session_id, "claims": claims}

    resp = RedirectResponse(url=str(claims.get("return_to", "/")), status_code=302)
    resp.set_cookie(
        "panel_session",
        session.session_id,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=3600,
        path="/",
    )
    return resp
