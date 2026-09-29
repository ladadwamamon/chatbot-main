"""Outbound fleet agent: phone the central hub and pull queued commands."""
from __future__ import annotations

import asyncio
import os
from typing import Any

import httpx

from app.agent import AGENT_SETTING_KEYS, local_snapshot
from app.db import set_setting, wipe_menu

HEARTBEAT_INTERVAL_SEC = 30


def _env(name: str) -> str:
    return (os.getenv(name) or "").strip().rstrip("/")


def hub_enabled() -> bool:
    return bool(_env("HUB_URL") and (os.getenv("MANAGER_TOKEN") or "").strip())


def hub_url() -> str:
    return _env("HUB_URL")


def _headers() -> dict[str, str]:
    return {"X-Manager-Token": (os.getenv("MANAGER_TOKEN") or "").strip()}


def apply_command(cmd: dict[str, Any]) -> dict[str, Any]:
    kind = cmd.get("kind") or ""
    payload = cmd.get("payload") or {}
    if kind == "apply_settings":
        settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else payload
        applied = {}
        for k, v in (settings or {}).items():
            if k in AGENT_SETTING_KEYS:
                set_setting(k, str(v))
                applied[k] = str(v)
        return {"ok": True, "settings": applied}
    if kind == "reset_catalog":
        deleted = wipe_menu()
        return {"ok": True, **deleted}
    return {"ok": False, "error": f"unknown command {kind}"}


async def beat_once() -> dict[str, Any] | None:
    if not hub_enabled():
        return None
    snap = local_snapshot()
    snap["is_local"] = False
    snap["via"] = "heartbeat"
    body = {
        "snapshot": snap,
        "public_url": _env("PUBLIC_URL") or None,
    }
    async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
        r = await client.post(
            f"{hub_url()}/api/hub/heartbeat",
            headers=_headers(),
            json=body,
        )
        r.raise_for_status()
        data = r.json()
        for cmd in data.get("commands") or []:
            try:
                result = apply_command(cmd)
                ok = bool(result.get("ok"))
                err = result.get("error")
            except Exception as e:
                ok = False
                err = str(e)[:180]
            try:
                await client.post(
                    f"{hub_url()}/api/hub/commands/{cmd['id']}/ack",
                    headers=_headers(),
                    json={"ok": ok, "error": err},
                )
            except Exception:
                pass
        return data


async def _loop() -> None:
    await asyncio.sleep(4)
    while True:
        try:
            await beat_once()
        except Exception:
            pass
        await asyncio.sleep(HEARTBEAT_INTERVAL_SEC)


def start_hub_client() -> None:
    if not hub_enabled():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(_loop())
