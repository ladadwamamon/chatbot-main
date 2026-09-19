"""Per-instance tenant branding — env overrides without touching Barbeque defaults on the hub."""
from __future__ import annotations

import os

from app.db import get_setting, set_setting

ENV_TO_SETTING = {
    "RESTAURANT_NAME": "restaurant_name",
    "RESTAURANT_NAME_EN": "restaurant_name_en",
    "RESTAURANT_TAGLINE": "restaurant_tagline",
    "PRIMARY_COLOR": "primary_color",
    "PRIMARY_COLOR_DARK": "primary_color_dark",
    "CHATBOT_WELCOME": "chatbot_welcome",
    "CHATBOT_MODEL": "chatbot_model",
    "CURRENCY": "currency",
}

GENERIC_PROMPT = (
    "أنت مساعد ذكي لمطعم. رد بالعربية فقط، بشكل واضح ومختصر."
    "\nاعتمد فقط على المنيو أدناه — لا تخترع أصناف أو أسعار."
    "\nممنوع Markdown نهائياً: لا * ولا ** ولا #."
    "\nلعرض الأصناف استخدم هذا الشكل بالضبط:"
    "\n• اسم الصنف"
    "\n  المكونات: ..."
    "\n  الأسعار: صغير S .. | وسط M .. | كبير L .. | عائلي XL .."
    "\nللصنف بسعر واحد استخدم:"
    "\n• اسم الصنف"
    "\n  التفاصيل: ..."
    "\n  السعر: .."
)

BBQ_NAME = "بيتزا باربيكيو"
BBQ_COLOR = "#4b1a0c"


def skip_seed() -> bool:
    v = (os.getenv("SKIP_SEED") or "").strip().lower()
    if v:
        return v in {"1", "true", "yes", "on"}
    seed = (os.getenv("SEED_MENU") or "").strip().lower()
    return seed in {"0", "false", "no", "off"}


def _env(name: str) -> str | None:
    raw = os.getenv(name)
    if raw is None:
        return None
    raw = raw.strip().strip('"').strip("'")
    return raw or None


def apply_tenant_env() -> None:
    """Apply RESTAURANT_* env vars. For SKIP_SEED instances, strip leftover Barbeque defaults."""
    for env_key, setting_key in ENV_TO_SETTING.items():
        val = _env(env_key)
        if val:
            set_setting(setting_key, val)

    if not skip_seed():
        return

    if get_setting("restaurant_name") == BBQ_NAME and not _env("RESTAURANT_NAME"):
        set_setting("restaurant_name", "مطعم جديد")
    if get_setting("restaurant_name_en") == "Barbeque Pizza" and not _env("RESTAURANT_NAME_EN"):
        set_setting("restaurant_name_en", "New Restaurant")
    if (get_setting("restaurant_tagline") or "").startswith("ألذ بيتزا") and not _env("RESTAURANT_TAGLINE"):
        set_setting("restaurant_tagline", "أهلاً بكم")
    if (get_setting("primary_color") or "").lower() == BBQ_COLOR and not _env("PRIMARY_COLOR"):
        set_setting("primary_color", "#1e3a5f")
        set_setting("primary_color_dark", "#0f2744")
    welcome = get_setting("chatbot_welcome") or ""
    if "باربيكيو" in welcome and not _env("CHATBOT_WELCOME"):
        name = get_setting("restaurant_name") or "المطعم"
        set_setting("chatbot_welcome", f"أهلاً! أنا مساعد {name}. اسألني عن الأصناف، الأسعار، أو المكونات.")
    prompt = get_setting("chatbot_system_prompt") or ""
    if "مطعم بيتزا" in prompt:
        set_setting("chatbot_system_prompt", GENERIC_PROMPT)
