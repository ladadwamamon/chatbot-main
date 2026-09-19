"""Restaurant / cafe registry for the platform control plane."""
from __future__ import annotations

import json
import os
import re
import secrets
import sqlite3
from typing import Any, Optional

from app.db import get_conn


KINDS = ("restaurant", "cafe", "cloud_kitchen", "other")
STATUSES = ("setup", "live", "paused", "archived")
PLANS = ("starter", "pro", "custom")


def _slugify(name: str) -> str:
    s = (name or "").strip().lower()
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"[^a-z0-9\-]", "", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s or f"venue-{secrets.token_hex(3)}"


def unique_slug(base: str, *, exclude_id: Optional[int] = None) -> str:
    slug = _slugify(base)[:40]
    conn = get_conn()
    n = 0
    candidate = slug
    while True:
        q = "SELECT id FROM venues WHERE slug=?"
        args: list[Any] = [candidate]
        if exclude_id is not None:
            q += " AND id<>?"
            args.append(exclude_id)
        if conn.execute(q, args).fetchone() is None:
            return candidate
        n += 1
        candidate = f"{slug}-{n}"


def generate_credentials() -> dict[str, str]:
    return {
        "admin_password": secrets.token_urlsafe(14),
        "admin_secret": secrets.token_hex(32),
        "manager_token": secrets.token_urlsafe(32),
    }


def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    d = dict(row)
    raw = d.pop("meta_json", None)
    try:
        d["meta"] = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        d["meta"] = {}
    d["is_local"] = bool(d.get("is_local"))
    return d


def list_venues() -> list[dict[str, Any]]:
    rows = get_conn().execute(
        "SELECT * FROM venues ORDER BY is_local DESC, created_at DESC"
    ).fetchall()
    return [_row(r) for r in rows]  # type: ignore[misc]


def get_venue(vid: int) -> dict[str, Any] | None:
    return _row(get_conn().execute("SELECT * FROM venues WHERE id=?", (vid,)).fetchone())


def get_local_venue() -> dict[str, Any] | None:
    return _row(get_conn().execute("SELECT * FROM venues WHERE is_local=1").fetchone())


def create_venue(data: dict[str, Any]) -> dict[str, Any]:
    creds = generate_credentials()
    slug = unique_slug(data.get("slug") or data.get("name_en") or data.get("name") or "venue")
    meta = data.get("meta") or {}
    conn = get_conn()
    cur = conn.execute(
        """INSERT INTO venues(
            name,name_en,slug,kind,status,plan,is_local,public_url,
            contact_name,contact_phone,notes,server_host,suggested_port,
            manager_token,admin_password,admin_secret,meta_json
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            data["name"].strip(),
            (data.get("name_en") or "").strip() or None,
            slug,
            data.get("kind") if data.get("kind") in KINDS else "restaurant",
            data.get("status") if data.get("status") in STATUSES else "setup",
            data.get("plan") if data.get("plan") in PLANS else "starter",
            1 if data.get("is_local") else 0,
            (data.get("public_url") or "").rstrip("/") or None,
            data.get("contact_name") or None,
            data.get("contact_phone") or None,
            data.get("notes") or None,
            data.get("server_host") or None,
            data.get("suggested_port"),
            data.get("manager_token") or creds["manager_token"],
            data.get("admin_password") or creds["admin_password"],
            data.get("admin_secret") or creds["admin_secret"],
            json.dumps(meta, ensure_ascii=False),
        ),
    )
    conn.commit()
    venue = get_venue(cur.lastrowid)  # type: ignore[arg-type]
    assert venue
    return venue


def update_venue(vid: int, data: dict[str, Any]) -> dict[str, Any] | None:
    current = get_venue(vid)
    if not current:
        return None
    allowed = {
        "name", "name_en", "kind", "status", "plan", "public_url",
        "contact_name", "contact_phone", "notes", "server_host",
        "suggested_port", "slug",
    }
    fields = []
    args: list[Any] = []
    for k, v in data.items():
        if k not in allowed:
            continue
        if k == "slug" and v:
            v = unique_slug(str(v), exclude_id=vid)
        if k == "kind" and v not in KINDS:
            continue
        if k == "status" and v not in STATUSES:
            continue
        if k == "plan" and v not in PLANS:
            continue
        if k == "public_url" and v:
            v = str(v).rstrip("/")
        fields.append(f"{k}=?")
        args.append(v)
    if "meta" in data and isinstance(data["meta"], dict):
        merged = {**(current.get("meta") or {}), **data["meta"]}
        fields.append("meta_json=?")
        args.append(json.dumps(merged, ensure_ascii=False))
    if not fields:
        return current
    fields.append("updated_at=datetime('now')")
    args.append(vid)
    conn = get_conn()
    conn.execute(f"UPDATE venues SET {', '.join(fields)} WHERE id=?", args)
    conn.commit()
    return get_venue(vid)


def record_probe(vid: int, *, ok: bool, latency_ms: int | None, snapshot: dict | None) -> None:
    conn = get_conn()
    health = json.dumps(snapshot or {"ok": ok}, ensure_ascii=False)
    conn.execute(
        """UPDATE venues SET last_seen_at=CASE WHEN ? THEN datetime('now') ELSE last_seen_at END,
           last_latency_ms=?, last_health=?, updated_at=datetime('now') WHERE id=?""",
        (1 if ok else 0, latency_ms, health, vid),
    )
    conn.commit()


def regenerate_manager_token(vid: int) -> str | None:
    token = secrets.token_urlsafe(32)
    conn = get_conn()
    cur = conn.execute(
        "UPDATE venues SET manager_token=?, updated_at=datetime('now') WHERE id=?",
        (token, vid),
    )
    conn.commit()
    if cur.rowcount == 0:
        return None
    return token


def delete_venue(vid: int) -> bool:
    conn = get_conn()
    row = conn.execute("SELECT is_local FROM venues WHERE id=?", (vid,)).fetchone()
    if not row:
        return False
    if row["is_local"]:
        raise ValueError("لا يمكن حذف المطعم المحلي لهذه النسخة")
    conn.execute("DELETE FROM venues WHERE id=?", (vid,))
    conn.commit()
    return True


def ensure_local_venue(name: str, name_en: str | None = None) -> dict[str, Any]:
    existing = get_local_venue()
    if existing:
        return existing
    return create_venue({
        "name": name,
        "name_en": name_en,
        "slug": name_en or name,
        "kind": "restaurant",
        "status": "live",
        "is_local": True,
        "plan": "pro",
        "notes": "النسخة المحلية المرفوعة على هذا السيرفر",
        "admin_password": os.getenv("ADMIN_PASSWORD") or None,
        "admin_secret": os.getenv("ADMIN_SECRET") or None,
        "manager_token": os.getenv("MANAGER_TOKEN") or None,
    })


def _env_line(key: str, value: Any) -> str:
    raw = str(value or "").replace("\r", " ").replace("\n", " ").strip()
    return f"{key}={raw}"


def compose_kit(venue: dict[str, Any]) -> dict[str, str]:
    """Deploy kit: shared product template, per-tenant branding, empty menu."""
    port = venue.get("suggested_port") or 8182
    slug = venue["slug"]
    meta = venue.get("meta") or {}
    name = venue.get("name") or ""
    name_en = venue.get("name_en") or ""
    tagline = meta.get("tagline") or venue.get("restaurant_tagline") or ""
    primary = meta.get("primary_color") or "#1e3a5f"
    primary_dark = meta.get("primary_color_dark") or "#0f2744"
    welcome = meta.get("welcome") or (f"أهلاً! أنا مساعد {name}. اسألني عن الأصناف أو الأسعار." if name else "")
    currency = meta.get("currency") or "₪"
    public_url = venue.get("public_url") or ""

    env = "\n".join([
        _env_line("HOST_PORT", port),
        _env_line("APP_ENV", "production"),
        _env_line("GEMINI_API_KEY", ""),
        _env_line("GEMINI_MODEL", meta.get("model") or "gemini-3.6-flash"),
        _env_line("ADMIN_PASSWORD", venue.get("admin_password") or ""),
        _env_line("ADMIN_SECRET", venue.get("admin_secret") or ""),
        _env_line("MANAGER_TOKEN", venue.get("manager_token") or ""),
        _env_line("PUBLIC_URL", public_url),
        _env_line("SKIP_SEED", "1"),
        _env_line("RESTAURANT_NAME", name),
        _env_line("RESTAURANT_NAME_EN", name_en),
        _env_line("RESTAURANT_TAGLINE", tagline),
        _env_line("PRIMARY_COLOR", primary),
        _env_line("PRIMARY_COLOR_DARK", primary_dark),
        _env_line("CHATBOT_WELCOME", welcome),
        _env_line("CURRENCY", currency),
    ])
    compose = f"""# Product template (QR, chat, cart, admin). Menu/logo/colors come from env + empty brand volume.
version: "3.9"

services:
  app:
    image: bbq-pizza:latest
    container_name: {slug}
    restart: unless-stopped
    ports:
      - "${{HOST_PORT:-{port}}}:8000"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      - APP_ENV=production
      - GEMINI_API_KEY=${{GEMINI_API_KEY}}
      - GEMINI_MODEL=${{GEMINI_MODEL:-gemini-3.6-flash}}
      - ADMIN_PASSWORD=${{ADMIN_PASSWORD}}
      - ADMIN_SECRET=${{ADMIN_SECRET}}
      - MANAGER_TOKEN=${{MANAGER_TOKEN}}
      - PUBLIC_URL=${{PUBLIC_URL}}
      - SKIP_SEED=${{SKIP_SEED:-1}}
      - RESTAURANT_NAME=${{RESTAURANT_NAME}}
      - RESTAURANT_NAME_EN=${{RESTAURANT_NAME_EN}}
      - RESTAURANT_TAGLINE=${{RESTAURANT_TAGLINE}}
      - PRIMARY_COLOR=${{PRIMARY_COLOR}}
      - PRIMARY_COLOR_DARK=${{PRIMARY_COLOR_DARK}}
      - CHATBOT_WELCOME=${{CHATBOT_WELCOME}}
      - CURRENCY=${{CURRENCY}}
    volumes:
      - {slug}_data:/app/data
      - {slug}_images:/app/static/images/food
      - {slug}_brand:/app/static/images/brand
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:8000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s

volumes:
  {slug}_data:
  {slug}_images:
  {slug}_brand:
"""
    return {"env": env, "compose": compose, "container": slug, "port": str(port)}
