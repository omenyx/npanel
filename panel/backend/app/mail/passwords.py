from __future__ import annotations

from passlib.context import CryptContext

# Dovecot/Postfix compatibility: SHA512-CRYPT is widely supported across distros.
# (Argon2 support varies by Dovecot build/version.)
_pwd = CryptContext(schemes=["sha512_crypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return _pwd.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _pwd.verify(password, password_hash)
