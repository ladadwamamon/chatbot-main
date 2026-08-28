"""Platform-owner auth for /manager — separate from restaurant /admin."""
from __future__ import annotations

import hashlib
import os
import secrets

from fastapi import HTTPException, Request, Response, status
from itsdangerous import BadSignature, URLSafeSerializer

COOKIE_NAME = "bbq_manager"
COOKIE_MAX_AGE = 60 * 60 * 12  # 12 hours


def _secret() -> str:
    return os.getenv("MANAGER_SECRET") or hashlib.sha256(
        (os.getenv("ADMIN_SECRET", "") + "manager-fallback").encode()
    ).hexdigest()


_serializer = URLSafeSerializer(_secret(), salt="manager-session")


def _env(name: str) -> str | None:
    v = os.getenv(name)
    if v is None:
        return None
    v = v.strip()
    return v or None


def manager_enabled() -> bool:
    """Login page is always available. Auth uses MANAGER_PASSWORD or ADMIN_PASSWORD."""
    return True


def get_manager_password() -> str:
    return _env("MANAGER_PASSWORD") or _env("ADMIN_PASSWORD") or "manager123"


def sign_session() -> str:
    return _serializer.dumps({"sub": "manager", "nonce": secrets.token_hex(8)})


def verify_session(token: str) -> bool:
    try:
        data = _serializer.loads(token)
        return data.get("sub") == "manager"
    except BadSignature:
        return False


def set_manager_cookie(response: Response) -> None:
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


def clear_manager_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


def is_manager(request: Request) -> bool:
    token = request.cookies.get(COOKIE_NAME)
    return bool(token and verify_session(token))


def require_manager(request: Request) -> None:
    if not manager_enabled():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="غير متاح")
    if not is_manager(request):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="غير مصرح")


def get_agent_token() -> str | None:
    """Token this instance accepts from a remote control plane."""
    return os.getenv("MANAGER_TOKEN") or None


def require_agent(request: Request) -> None:
    expected = get_agent_token()
    if not expected:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="agent disabled")
    got = request.headers.get("x-manager-token") or ""
    if not secrets.compare_digest(got, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid agent token")
