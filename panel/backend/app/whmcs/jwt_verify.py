from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse

import jwt

from app.config.settings import settings


@dataclass(frozen=True)
class VerifiedSSO:
    iss: str
    sub: str
    service_id: str
    jti: str
    iat: int
    exp: int
    return_to: str


def verify_whmcs_sso_jwt(token: str) -> VerifiedSSO:
    if settings.whmcs_public_key_pem:
        key = settings.whmcs_public_key_pem
        algorithms = ["EdDSA", "RS256"]
    elif settings.whmcs_hmac_secret:
        key = settings.whmcs_hmac_secret
        algorithms = ["HS256"]
    else:
        raise ValueError("SSO verification not configured")

    decode_kwargs: dict = {
        "key": key,
        "algorithms": algorithms,
        "issuer": settings.sso_token_issuer,
        "options": {"require": ["exp", "iat", "iss", "sub", "jti"]},
        "leeway": settings.sso_clock_skew_seconds,
    }
    if settings.sso_token_audience:
        decode_kwargs["audience"] = settings.sso_token_audience

    payload = jwt.decode(
        token,
        **decode_kwargs,
    )

    for required in ("service_id", "return_to"):
        if required not in payload:
            raise ValueError("invalid token")

    verified = VerifiedSSO(
        iss=str(payload["iss"]),
        sub=str(payload["sub"]),
        service_id=str(payload["service_id"]),
        jti=str(payload["jti"]),
        iat=int(payload["iat"]),
        exp=int(payload["exp"]),
        return_to=str(payload["return_to"]),
    )

    # Extra hardening beyond PyJWT checks
    if verified.exp - verified.iat > settings.sso_max_age_seconds:
        raise ValueError("token max-age exceeded")

    # Only allow relative return_to paths (no scheme/host)
    parsed = urlparse(verified.return_to)
    if parsed.scheme or parsed.netloc:
        raise ValueError("invalid return_to")
    if not verified.return_to.startswith("/"):
        raise ValueError("invalid return_to")

    return verified
