from app.whmcs.jwt_verify import verify_whmcs_sso_jwt
from app.whmcs.replay_store import ReplayStore

from app.config.settings import settings


_replay_store = ReplayStore()


async def validate_and_consume_sso_token(token: str) -> dict:
    verified = verify_whmcs_sso_jwt(token)
    await _replay_store.consume_once(
        verified.jti,
        verified.exp,
        grace_seconds=settings.sso_replay_grace_seconds,
    )
    return dict(verified.__dict__)
