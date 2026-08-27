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

# Gemini 3.x uses thinkingLevel; numeric budget is rejected on Lite (esp. 0/1).
_THINKING_LEVELS = {"minimal", "low", "medium", "high"}


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


def _resolve_thinking_level(raw: str | None) -> str:
    """Map admin setting to a Gemini 3 thinkingLevel."""
    v = (raw or "minimal").strip().lower()
    if v in _THINKING_LEVELS:
        return v
    # Back-compat for old numeric "thinking budget" values
    try:
        n = int(v)
    except ValueError:
        return "minimal"
    if n <= 0:
        return "minimal"
    if n <= 64:
        return "low"
    if n <= 256:
        return "medium"
    return "high"


def _build_thinking_config(model: str, raw_setting: str | None) -> dict:
    level = _resolve_thinking_level(raw_setting)
    m = model.lower()
    # Gemini 3.x (incl. Lite): thinkingBudget:0/1 → 400 INVALID_ARGUMENT
    if m.startswith("gemini-3") or "-3." in m:
        # 3.7 Flash: LOW/MEDIUM/HIGH only (no MINIMAL)
        if "3.7" in m and level == "minimal":
            level = "low"
        return {"thinkingLevel": level.upper()}
    # Gemini 2.5 family still accepts numeric budget
    budget_map = {"minimal": 0, "low": 32, "medium": 128, "high": 512}
    return {"thinkingBudget": budget_map.get(level, 0)}


def _extract_reply_text(data: dict) -> str:
    """Pull visible text; skip thought-only parts that have no user-facing text."""
    try:
        parts = data["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError, TypeError) as e:
        raise RuntimeError(f"رد Gemini بدون محتوى نصي: {data}") from e

    texts: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        # Skip internal thinking blobs when marked as thought
        if part.get("thought") is True:
            continue
        text = part.get("text")
        if text:
            texts.append(text)

    if texts:
        return "".join(texts)

    # Fallback: any text field
    for part in parts:
        if isinstance(part, dict) and part.get("text"):
            return part["text"]

    raise RuntimeError(f"رد Gemini بدون نص: {str(data)[:400]}")


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
        max_tokens = int(settings.get("chatbot_max_tokens", "2048"))
    except ValueError:
        max_tokens = 2048

    thinking = _build_thinking_config(
        model, settings.get("chatbot_thinking_budget", "minimal")
    )

    payload = {
        "contents": contents,
        "generationConfig": {
            "temperature": temperature,
            "topP": 0.9,
            "maxOutputTokens": max_tokens,
            "thinkingConfig": thinking,
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
        reply = clean_reply(_extract_reply_text(data))

        usage = data.get("usageMetadata", {})
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        # Output shown in admin = reply tokens; thoughts may exist separately
        tokens_out = usage.get("candidatesTokenCount")
        thoughts = usage.get("thoughtsTokenCount") or 0
        if thoughts and tokens_out is not None:
            # Store reply+thoughts so dashboard reflects real spend
            tokens_out = int(tokens_out) + int(thoughts)

        log_chat(
            session_id=session_id,
            user_message=user_message,
            bot_reply=reply,
            tokens_in=usage.get("promptTokenCount"),
            tokens_out=tokens_out,
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
