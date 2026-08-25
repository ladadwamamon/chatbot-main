"""Simple admin auth: password from env, signed cookie session."""
from __future__ import annotations

import hashlib
import os
import secrets
from typing import Optional

from fastapi import HTTPException, Request, Response, status
from itsdangerous import BadSignature, URLSafeSerializer

COOKIE_NAME = "bbq_admin"
COOKIE_MAX_AGE = 60 * 60 * 8  # 8 hours

_secret = os.getenv("ADMIN_SECRET") or hashlib.sha256(
    (os.getenv("GEMINI_API_KEY", "") + "admin-fallback-secret").encode()
).hexdigest()
_serializer = URLSafeSerializer(_secret, salt="admin-session")


def get_admin_password() -> str:
    return os.getenv("ADMIN_PASSWORD", "admin123")


def sign_session() -> str:
    return _serializer.dumps({"sub": "admin", "nonce": secrets.token_hex(8)})


def verify_session(token: str) -> bool:
    try:
        data = _serializer.loads(token)
        return data.get("sub") == "admin"
    except BadSignature:
        return False


def set_admin_cookie(response: Response) -> None:
    secure = os.getenv("APP_ENV", "development").lower() == "production"
    response.set_cookie(
        COOKIE_NAME,
        sign_session(),
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )


def clear_admin_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


def is_authenticated(request: Request) -> bool:
    token = request.cookies.get(COOKIE_NAME)
    return bool(token and verify_session(token))


def require_admin(request: Request) -> None:
    if not is_authenticated(request):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="غير مصرح")
