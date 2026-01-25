from __future__ import annotations

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.auth.sessions import session_store
from app.featureflags.enforcement import enforce_service_state
from app.whmcs.service_state import get_service_state


class AuthContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request.state.session = None
        request.state.service_id = None
        request.state.service_status = None
        request.state.service_state = None
        request.state.actor_sub = None
        request.state.actor_role = None

        session_id = request.cookies.get("panel_session")
        if not session_id:
            auth = request.headers.get("Authorization", "")
            if auth.startswith("Bearer "):
                session_id = auth.split(" ", 1)[1].strip() or None

        if session_id:
            session = await session_store.get(session_id)
            if session:
                request.state.session = session
                request.state.service_id = session.service_id
                request.state.actor_sub = session.whmcs_user_id
                request.state.actor_role = "customer"

                # Always use latest WHMCS-driven service state from DB.
                latest_state = await get_service_state(session.service_id)
                request.state.service_state = latest_state
                request.state.service_status = (latest_state.status if latest_state else None) or "active"

        # Enforce WHMCS service state (suspension) globally.
        try:
            enforce_service_state(request)
        except PermissionError as exc:
            return JSONResponse({"error": str(exc)}, status_code=403)

        return await call_next(request)
