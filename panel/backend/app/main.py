from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.auth.middleware import AuthContextMiddleware

from app.api.routes.health import router as health_router
from app.api.routes.pages import router as pages_router
from app.api.routes.sso_whmcs import router as whmcs_sso_router
from app.api.routes.webhooks.whmcs import router as whmcs_webhooks_router
from app.api.routes.dns import router as dns_router
from app.api.routes.mail import router as mail_router
from app.api.routes.migrations import router as migrations_router


def create_app() -> FastAPI:
    app = FastAPI(title="Lean Panel API", version="0.1.0")

    app.add_middleware(AuthContextMiddleware)

    static_dir = Path(__file__).resolve().parents[2] / "frontend" / "static"
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    app.include_router(health_router)
    app.include_router(pages_router)
    app.include_router(whmcs_sso_router)
    app.include_router(whmcs_webhooks_router)
    app.include_router(dns_router)
    app.include_router(mail_router)
    app.include_router(migrations_router)

    return app


app = create_app()
