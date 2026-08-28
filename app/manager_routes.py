"""Platform control plane (/manager) and satellite agent API."""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.agent import AGENT_SETTING_KEYS, APP_VERSION, local_snapshot
from app.db import get_conn, log_error, set_setting
from app.manager_auth import (
    clear_manager_cookie,
    get_manager_password,
    is_manager,
    manager_enabled,
    require_agent,
    require_manager,
    set_manager_cookie,
)
from app.venues import (
    compose_kit,
    create_venue,
    delete_venue,
    ensure_local_venue,
    get_venue,
    list_venues,
    record_probe,
    regenerate_manager_token,
    update_venue,
)

ROOT = Path(__file__).resolve().parent.parent
MANAGER_DIR = ROOT / "static" / "manager"

router = APIRouter()


class LoginBody(BaseModel):
    password: str


class VenueCreateBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    name_en: Optional[str] = Field(None, max_length=80)
    slug: Optional[str] = Field(None, max_length=40)
    kind: str = "restaurant"
    plan: str = "starter"
    public_url: Optional[str] = Field(None, max_length=300)
    contact_name: Optional[str] = Field(None, max_length=80)
    contact_phone: Optional[str] = Field(None, max_length=40)
    notes: Optional[str] = Field(None, max_length=1000)
    server_host: Optional[str] = Field(None, max_length=200)
    suggested_port: Optional[int] = Field(None, ge=1024, le=65535)
    manager_token: Optional[str] = Field(None, max_length=120)
    connect_existing: bool = False
    meta: Optional[dict[str, Any]] = None


class VenuePatchBody(BaseModel):
    name: Optional[str] = Field(None, max_length=80)
    name_en: Optional[str] = Field(None, max_length=80)
    slug: Optional[str] = Field(None, max_length=40)
    kind: Optional[str] = None
    status: Optional[str] = None
    plan: Optional[str] = None
    public_url: Optional[str] = Field(None, max_length=300)
    contact_name: Optional[str] = Field(None, max_length=80)
    contact_phone: Optional[str] = Field(None, max_length=40)
    notes: Optional[str] = Field(None, max_length=1000)
    server_host: Optional[str] = Field(None, max_length=200)
    suggested_port: Optional[int] = Field(None, ge=1024, le=65535)
    meta: Optional[dict[str, Any]] = None


class SettingsPatchBody(BaseModel):
    settings: dict[str, Any]


def _public_venue(v: dict[str, Any], *, secrets: bool = False) -> dict[str, Any]:
    out = {k: v.get(k) for k in (
        "id", "created_at", "updated_at", "name", "name_en", "slug", "kind",
        "status", "plan", "is_local", "public_url", "contact_name", "contact_phone",
        "notes", "server_host", "suggested_port", "last_seen_at", "last_latency_ms",
        "last_health", "meta",
    )}
    token = v.get("manager_token") or ""
    out["has_token"] = bool(token)
    out["token_tail"] = token[-4:] if token else ""
    health = out.get("last_health")
    if isinstance(health, str):
        try:
            out["last_health"] = json.loads(health)
        except json.JSONDecodeError:
            out["last_health"] = {}
    if secrets:
        out["manager_token"] = v.get("manager_token")
        out["admin_password"] = v.get("admin_password")
        out["admin_secret"] = v.get("admin_secret")
        out["kit"] = compose_kit(v)
    return out


async def _probe_remote(venue: dict[str, Any]) -> dict[str, Any]:
    base = (venue.get("public_url") or "").rstrip("/")
    token = venue.get("manager_token") or ""
    if not base:
        return {"ok": False, "unreachable": True, "error": "لا يوجد رابط للسيرفر"}
    started = time.perf_counter()
    headers = {"X-Manager-Token": token} if token else {}
    try:
        async with httpx.AsyncClient(timeout=6.0, follow_redirects=True) as client:
            r = await client.get(f"{base}/api/agent/snapshot", headers=headers)
            latency = int((time.perf_counter() - started) * 1000)
            if r.status_code == 404:
                # Older instance without agent — fall back to /health
                h = await client.get(f"{base}/health")
                latency = int((time.perf_counter() - started) * 1000)
                if h.status_code == 200:
                    snap = {"ok": True, "unreachable": False, "version": "legacy", "partial": True}
                    snap["latency_ms"] = latency
                    return snap
            if r.status_code == 401:
                return {"ok": False, "unreachable": False, "error": "توكن الوكيل غير صحيح", "latency_ms": latency}
            r.raise_for_status()
            snap = r.json()
            snap["ok"] = True
            snap["unreachable"] = False
            snap["latency_ms"] = latency
            return snap
    except Exception as e:
        latency = int((time.perf_counter() - started) * 1000)
        return {"ok": False, "unreachable": True, "error": str(e)[:180], "latency_ms": latency}


async def probe_venue(venue: dict[str, Any]) -> dict[str, Any]:
    if venue.get("is_local"):
        snap = local_snapshot()
        snap["latency_ms"] = 0
        record_probe(venue["id"], ok=True, latency_ms=0, snapshot=snap)
        return snap
    snap = await _probe_remote(venue)
    record_probe(
        venue["id"],
        ok=bool(snap.get("ok")),
        latency_ms=snap.get("latency_ms"),
        snapshot=snap,
    )
    return snap


# ---------- Pages ----------
@router.get("/manager")
@router.get("/manager/")
async def manager_page():
    if not manager_enabled():
        raise HTTPException(status_code=404, detail="غير متاح")
    return FileResponse(MANAGER_DIR / "index.html")


# ---------- Auth ----------
@router.post("/manager/api/login")
async def manager_login(body: LoginBody, request: Request, response: Response):
    if not manager_enabled():
        raise HTTPException(status_code=404, detail="غير متاح")
    if body.password != get_manager_password():
        log_error(
            source="manager-auth",
            message="Failed manager login",
            ip=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        raise HTTPException(status_code=401, detail="كلمة المرور غير صحيحة")
    set_manager_cookie(response)
    return {"ok": True}


@router.post("/manager/api/logout")
async def manager_logout(response: Response):
    clear_manager_cookie(response)
    return {"ok": True}


@router.get("/manager/api/me")
async def manager_me(request: Request):
    return {"authenticated": is_manager(request), "enabled": manager_enabled()}


# ---------- Dashboard ----------
@router.get("/manager/api/overview", dependencies=[Depends(require_manager)])
async def manager_overview():
    venues = list_venues()
    live = sum(1 for v in venues if v["status"] == "live")
    setup = sum(1 for v in venues if v["status"] == "setup")
    paused = sum(1 for v in venues if v["status"] == "paused")
    local = local_snapshot()
    return {
        "version": APP_VERSION,
        "venues": {
            "total": len(venues),
            "live": live,
            "setup": setup,
            "paused": paused,
        },
        "local": {
            "name": local.get("restaurant_name"),
            "orders_today": local["orders"]["today"],
            "chats_today": local["chats"]["today"],
            "errors_open": local["errors"]["open"],
            "tokens_today": (local["chats"]["tokens_in_today"] or 0) + (local["chats"]["tokens_out_today"] or 0),
            "gemini_configured": local["gemini_configured"],
        },
        "list": [_public_venue(v) for v in venues],
    }


@router.post("/manager/api/ping-all", dependencies=[Depends(require_manager)])
async def manager_ping_all():
    results = []
    for v in list_venues():
        snap = await probe_venue(v)
        results.append({
            "id": v["id"],
            "ok": bool(snap.get("ok")),
            "unreachable": bool(snap.get("unreachable")),
            "latency_ms": snap.get("latency_ms"),
            "error": snap.get("error"),
            "errors_open": (snap.get("errors") or {}).get("open"),
            "orders_today": (snap.get("orders") or {}).get("today"),
        })
    return {"results": results}


# ---------- Venues ----------
@router.get("/manager/api/venues", dependencies=[Depends(require_manager)])
async def manager_list_venues():
    return [_public_venue(v) for v in list_venues()]


@router.post("/manager/api/venues", dependencies=[Depends(require_manager)])
async def manager_create_venue(body: VenueCreateBody):
    data = body.model_dump()
    connect = data.pop("connect_existing", False)
    if connect and not data.get("public_url"):
        raise HTTPException(status_code=400, detail="رابط السيرفر مطلوب للربط")
    if connect:
        data["status"] = "live"
    else:
        data["status"] = "setup"
        # Suggest a free-ish port based on existing venues
        used = {v.get("suggested_port") for v in list_venues() if v.get("suggested_port")}
        port = data.get("suggested_port") or 8183
        while port in used:
            port += 1
        data["suggested_port"] = port
    venue = create_venue(data)
    snap = None
    if connect:
        snap = await probe_venue(venue)
        if not snap.get("ok"):
            update_venue(venue["id"], {"status": "setup"})
            venue = get_venue(venue["id"])
    return {"venue": _public_venue(venue, secrets=True), "snapshot": snap}


@router.get("/manager/api/venues/{vid}", dependencies=[Depends(require_manager)])
async def manager_get_venue(vid: int, secrets: bool = False):
    v = get_venue(vid)
    if not v:
        raise HTTPException(status_code=404, detail="غير موجود")
    return _public_venue(v, secrets=secrets)


@router.patch("/manager/api/venues/{vid}", dependencies=[Depends(require_manager)])
async def manager_patch_venue(vid: int, body: VenuePatchBody):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    v = update_venue(vid, data)
    if not v:
        raise HTTPException(status_code=404, detail="غير موجود")
    return _public_venue(v)


@router.delete("/manager/api/venues/{vid}", dependencies=[Depends(require_manager)])
async def manager_delete_venue(vid: int):
    try:
        if not delete_venue(vid):
            raise HTTPException(status_code=404, detail="غير موجود")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True}


@router.post("/manager/api/venues/{vid}/probe", dependencies=[Depends(require_manager)])
async def manager_probe(vid: int):
    v = get_venue(vid)
    if not v:
        raise HTTPException(status_code=404, detail="غير موجود")
    snap = await probe_venue(v)
    return {"snapshot": snap, "venue": _public_venue(get_venue(vid))}


@router.post("/manager/api/venues/{vid}/regenerate-token", dependencies=[Depends(require_manager)])
async def manager_regen_token(vid: int):
    v = get_venue(vid)
    if not v:
        raise HTTPException(status_code=404, detail="غير موجود")
    if v.get("is_local"):
        raise HTTPException(status_code=400, detail="التوكن المحلي يُضبط من متغير MANAGER_TOKEN في السيرفر")
    token = regenerate_manager_token(vid)
    v = get_venue(vid)
    return {"ok": True, "manager_token": token, "venue": _public_venue(v, secrets=True)}


@router.get("/manager/api/venues/{vid}/kit", dependencies=[Depends(require_manager)])
async def manager_kit(vid: int):
    v = get_venue(vid)
    if not v:
        raise HTTPException(status_code=404, detail="غير موجود")
    return {"venue": _public_venue(v, secrets=True)}


@router.get("/manager/api/venues/{vid}/errors", dependencies=[Depends(require_manager)])
async def manager_venue_errors(vid: int, limit: int = 80, only_open: bool = True):
    v = get_venue(vid)
    if not v:
        raise HTTPException(status_code=404, detail="غير موجود")
    if v.get("is_local"):
        conn = get_conn()
        sql = "SELECT * FROM errors "
        params: list = []
        if only_open:
            sql += "WHERE resolved=0 "
        sql += "ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    base = (v.get("public_url") or "").rstrip("/")
    token = v.get("manager_token") or ""
    if not base or not token:
        raise HTTPException(status_code=400, detail="السيرفر غير مربوط")
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(
                f"{base}/api/agent/errors",
                headers={"X-Manager-Token": token},
                params={"limit": limit, "only_open": str(only_open).lower()},
            )
            r.raise_for_status()
            return r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"تعذر جلب الأخطاء: {e}") from e


@router.post("/manager/api/venues/{vid}/errors/{eid}/resolve", dependencies=[Depends(require_manager)])
async def manager_resolve_error(vid: int, eid: int):
    v = get_venue(vid)
    if not v:
        raise HTTPException(status_code=404, detail="غير موجود")
    if v.get("is_local"):
        conn = get_conn()
        conn.execute("UPDATE errors SET resolved=1 WHERE id=?", (eid,))
        conn.commit()
        return {"ok": True}
    base = (v.get("public_url") or "").rstrip("/")
    token = v.get("manager_token") or ""
    if not base or not token:
        raise HTTPException(status_code=400, detail="السيرفر غير مربوط")
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.post(
                f"{base}/api/agent/errors/{eid}/resolve",
                headers={"X-Manager-Token": token},
            )
            r.raise_for_status()
            return r.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)[:180]) from e


@router.patch("/manager/api/venues/{vid}/settings", dependencies=[Depends(require_manager)])
async def manager_venue_settings(vid: int, body: SettingsPatchBody):
    v = get_venue(vid)
    if not v:
        raise HTTPException(status_code=404, detail="غير موجود")
    payload = {k: str(val) for k, val in body.settings.items() if k in AGENT_SETTING_KEYS}
    if not payload:
        raise HTTPException(status_code=400, detail="لا توجد إعدادات صالحة")
    if v.get("is_local"):
        for k, val in payload.items():
            set_setting(k, val)
        return {"ok": True, "settings": payload}
    base = (v.get("public_url") or "").rstrip("/")
    token = v.get("manager_token") or ""
    if not base or not token:
        raise HTTPException(status_code=400, detail="السيرفر غير مربوط")
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.patch(
                f"{base}/api/agent/settings",
                headers={"X-Manager-Token": token},
                json={"settings": payload},
            )
            r.raise_for_status()
            return r.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)[:180]) from e


@router.get("/manager/api/errors", dependencies=[Depends(require_manager)])
async def manager_local_errors(limit: int = 150, only_open: bool = False):
    """Errors on the hub instance itself."""
    conn = get_conn()
    sql = "SELECT * FROM errors "
    params: list = []
    if only_open:
        sql += "WHERE resolved=0 "
    sql += "ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


# ---------- Satellite agent (called by a remote control plane) ----------
@router.get("/api/agent/snapshot", dependencies=[Depends(require_agent)])
async def agent_snapshot():
    return local_snapshot()


@router.get("/api/agent/errors", dependencies=[Depends(require_agent)])
async def agent_errors(limit: int = 80, only_open: bool = True):
    conn = get_conn()
    sql = "SELECT * FROM errors "
    params: list = []
    if only_open:
        sql += "WHERE resolved=0 "
    sql += "ORDER BY created_at DESC LIMIT ?"
    params.append(min(limit, 300))
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


@router.post("/api/agent/errors/{eid}/resolve", dependencies=[Depends(require_agent)])
async def agent_resolve(eid: int):
    conn = get_conn()
    conn.execute("UPDATE errors SET resolved=1 WHERE id=?", (eid,))
    conn.commit()
    return {"ok": True}


@router.patch("/api/agent/settings", dependencies=[Depends(require_agent)])
async def agent_settings(body: SettingsPatchBody):
    payload = {k: str(v) for k, v in body.settings.items() if k in AGENT_SETTING_KEYS}
    for k, v in payload.items():
        set_setting(k, v)
    return {"ok": True, "settings": payload}


def bootstrap_local_venue() -> None:
    from app.db import all_settings
    s = all_settings()
    ensure_local_venue(
        name=s.get("restaurant_name") or "المطعم المحلي",
        name_en=s.get("restaurant_name_en"),
    )
