from __future__ import annotations

from fastapi import Request


SAFE_PATH_PREFIXES = (
    "/health",
    "/ready",
    "/sso/",
    "/webhooks/",
    "/static/",
)


def enforce_service_state(request: Request) -> None:
    path = request.url.path
    if path.startswith(SAFE_PATH_PREFIXES):
        return

    status = getattr(request.state, "service_status", None)
    if not status:
        # No session yet: allow only public pages/endpoints.
        # In production, you would redirect to login/SSO initiation.
        if path == "/":
            return
        raise PermissionError("authentication required")

    normalized = status.strip().lower()

    if normalized == "terminated":
        raise PermissionError("service terminated")

    if normalized != "active":
        # Suspended services are read-only.
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            raise PermissionError("service suspended")
