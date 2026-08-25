"""Gemini client — reads model settings from DB, logs chat + tokens."""
from __future__ import annotations

import os
import re
import time

import httpx
from dotenv import load_dotenv

from app.db import all_settings, log_chat, log_error

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

MAX_HISTORY_MESSAGES = 6


def clean_reply(text: str) -> str:
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"(?m)^\s*\*\s+", "• ", text)
    text = text.replace("*", "")
    text = re.sub(r"(?m)^\s*[-–—]\s+", "• ", text)
    return text.strip()


def _trim_history(history: list[dict] | None) -> list[dict]:
    if not history:
        return []
    return history[-MAX_HISTORY_MESSAGES:]


def build_system_prompt(menu_text: str) -> str:
    settings = all_settings()
    base = settings.get("chatbot_system_prompt", "")
    return f"{base}\n\n=== المنيو ===\n{menu_text}\n=== نهاية المنيو ==="


async def ask_gemini(
    user_message: str,
    menu_text: str,
    history: list[dict] | None = None,
    *,
    session_id: str | None = None,
) -> str:
    settings = all_settings()

    if settings.get("chatbot_enabled", "true") != "true":
        raise RuntimeError("الشات بوت معطل حالياً من لوحة الإدارة")

    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY غير موجود. أضفه في ملف .env")

    model = settings.get("chatbot_model", "gemini-3.6-flash")
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent"
    )

    system_text = build_system_prompt(menu_text)

    contents = [
        {"role": "user", "parts": [{"text": system_text}]},
        {
            "role": "model",
            "parts": [{"text": "تمام، جاهز أجاوب من منيو المطعم بشكل مرتب وواضح."}],
        },
    ]

    for msg in _trim_history(history):
        role = "user" if msg["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": msg["content"]}]})

    contents.append({"role": "user", "parts": [{"text": user_message}]})

    try:
        temperature = float(settings.get("chatbot_temperature", "0.35"))
    except ValueError:
        temperature = 0.35
    try:
        thinking_budget = int(settings.get("chatbot_thinking_budget", "128"))
    except ValueError:
        thinking_budget = 128
    try:
        max_tokens = int(settings.get("chatbot_max_tokens", "2048"))
    except ValueError:
        max_tokens = 2048

    payload = {
        "contents": contents,
        "generationConfig": {
            "temperature": temperature,
            "topP": 0.9,
            "maxOutputTokens": max_tokens,
            "thinkingConfig": {"thinkingBudget": thinking_budget},
        },
    }

    started = time.perf_counter()
    response = None
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            for _attempt in range(3):
                response = await client.post(
                    url,
                    headers={
                        "Content-Type": "application/json",
                        "X-goog-api-key": GEMINI_API_KEY,
                    },
                    json=payload,
                )
                if response.status_code == 200:
                    break
                if response.status_code not in (429, 503):
                    break

        if response is None or response.status_code != 200:
            error_detail = response.text if response else "لا يوجد رد"
            status_code = response.status_code if response else "N/A"
            raise RuntimeError(f"خطأ من Gemini API ({status_code}): {error_detail[:200]}")

        data = response.json()
        raw = data["candidates"][0]["content"]["parts"][0]["text"]
        reply = clean_reply(raw)

        usage = data.get("usageMetadata", {})
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        log_chat(
            session_id=session_id,
            user_message=user_message,
            bot_reply=reply,
            tokens_in=usage.get("promptTokenCount"),
            tokens_out=usage.get("candidatesTokenCount"),
            latency_ms=elapsed_ms,
        )
        return reply
    except Exception as e:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        log_chat(
            session_id=session_id,
            user_message=user_message,
            bot_reply=None,
            latency_ms=elapsed_ms,
            error=str(e)[:500],
        )
        log_error(
            source="chat",
            message=str(e)[:300],
            details=str(e)[:2000],
        )
        raise
