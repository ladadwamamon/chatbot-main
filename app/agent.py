"""Live snapshot of this restaurant instance (used locally and via agent API)."""
from __future__ import annotations

import os
import time

from app.db import all_settings, get_conn

APP_VERSION = "1.1.0"


def local_snapshot() -> dict:
    conn = get_conn()
    q = lambda sql: conn.execute(sql).fetchone()  # noqa: E731
    tokens = q(
        "SELECT COALESCE(SUM(tokens_in),0) i, COALESCE(SUM(tokens_out),0) o "
        "FROM chats WHERE date(created_at)=date('now')"
    )
    s = all_settings()
    return {
        "ok": True,
        "unreachable": False,
        "version": APP_VERSION,
        "role": "venue",
        "is_local": True,
        "restaurant_name": s.get("restaurant_name"),
        "items": {
            "total": q("SELECT COUNT(*) c FROM items")["c"],
            "available": q("SELECT COUNT(*) c FROM items WHERE available=1")["c"],
        },
        "orders": {
            "total": q("SELECT COUNT(*) c FROM orders")["c"],
            "today": q("SELECT COUNT(*) c FROM orders WHERE date(created_at)=date('now')")["c"],
            "revenue_today": q(
                "SELECT COALESCE(SUM(total),0) s FROM orders WHERE date(created_at)=date('now')"
            )["s"],
        },
        "chats": {
            "total": q("SELECT COUNT(*) c FROM chats")["c"],
            "today": q("SELECT COUNT(*) c FROM chats WHERE date(created_at)=date('now')")["c"],
            "tokens_in_today": tokens["i"],
            "tokens_out_today": tokens["o"],
        },
        "errors": {
            "open": q("SELECT COUNT(*) c FROM errors WHERE resolved=0")["c"],
        },
        "chatbot": {
            "enabled": s.get("chatbot_enabled") == "true",
            "model": s.get("chatbot_model"),
            "thinking": s.get("chatbot_thinking_budget"),
            "max_tokens": s.get("chatbot_max_tokens"),
            "temperature": s.get("chatbot_temperature"),
            "welcome": s.get("chatbot_welcome"),
            "system_prompt": s.get("chatbot_system_prompt"),
        },
        "theme": {
            "primary": s.get("primary_color"),
            "primary_dark": s.get("primary_color_dark"),
        },
        "uptime_hint": time.time(),
        "env": os.getenv("APP_ENV", "development"),
        "gemini_configured": bool(os.getenv("GEMINI_API_KEY")),
    }


AGENT_SETTING_KEYS = {
    "chatbot_enabled",
    "chatbot_model",
    "chatbot_temperature",
    "chatbot_thinking_budget",
    "chatbot_max_tokens",
    "chatbot_welcome",
    "chatbot_system_prompt",
    "restaurant_name",
    "restaurant_name_en",
    "restaurant_tagline",
    "primary_color",
    "primary_color_dark",
}
