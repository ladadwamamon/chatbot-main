"""Menu helpers — pulls data from SQLite and formats for the AI prompt."""
from __future__ import annotations

from app.db import all_settings, get_conn


def get_full_menu() -> dict:
    conn = get_conn()
    settings = all_settings()

    cats = conn.execute(
        "SELECT id,name,name_en,icon,sort_order FROM categories ORDER BY sort_order, id"
    ).fetchall()
    items = conn.execute(
        "SELECT id,category_id,name,name_en,description,image,sizes_json,price,"
        "vegetarian,spicy,available,sort_order FROM items ORDER BY category_id, sort_order, id"
    ).fetchall()

    import json as _json
    by_cat: dict[int, list[dict]] = {}
    for it in items:
        d = dict(it)
        sizes = d.pop("sizes_json")
        d["sizes"] = _json.loads(sizes) if sizes else None
        d["vegetarian"] = bool(d["vegetarian"])
        d["spicy"] = bool(d["spicy"])
        d["available"] = bool(d["available"])
        by_cat.setdefault(d["category_id"], []).append(d)

    categories = []
    for c in cats:
        cd = dict(c)
        cd["items"] = by_cat.get(cd["id"], [])
        categories.append(cd)

    return {
        "restaurant": {
            "name": settings.get("restaurant_name"),
            "name_en": settings.get("restaurant_name_en"),
            "tagline": settings.get("restaurant_tagline"),
            "phone": settings.get("restaurant_phone"),
            "address": settings.get("restaurant_address"),
            "hours": settings.get("restaurant_hours"),
            "primary_color": settings.get("primary_color"),
            "primary_color_dark": settings.get("primary_color_dark"),
            "delivery": {
                "available": settings.get("delivery_available") == "true",
                "fee": _num(settings.get("delivery_fee")),
                "min_order": _num(settings.get("min_order")),
                "estimated_time": settings.get("estimated_time"),
                "currency": settings.get("currency", "شيكل"),
            },
        },
        "categories": categories,
    }


def _num(v: str | None) -> float | None:
    if v in (None, ""):
        return None
    try:
        return float(v)
    except ValueError:
        return None


def format_menu_for_prompt() -> str:
    """Compact Arabic menu text — for AI prompt (fewer tokens)."""
    menu = get_full_menu()
    r = menu["restaurant"]
    d = r["delivery"]
    currency = d.get("currency") or "شيكل"

    lines = [f"مطعم: {r['name']} / {r.get('name_en') or ''}"]
    if r.get("phone"):
        lines.append(f"هاتف: {r['phone']}")
    if r.get("address"):
        lines.append(f"عنوان: {r['address']}")
    if r.get("hours"):
        lines.append(f"ساعات: {r['hours']}")

    if d.get("available"):
        parts = ["توصيل: نعم"]
        if d.get("fee") is not None:
            parts.append(f"رسوم {d['fee']} {currency}")
        if d.get("min_order") is not None:
            parts.append(f"حد أدنى {d['min_order']}")
        if d.get("estimated_time"):
            parts.append(f"وقت {d['estimated_time']}")
        lines.append(" | ".join(parts))
    else:
        lines.append("توصيل: غير متوفر حالياً")

    lines.append("أحجام: S صغير | M وسط | L كبير | XL عائلي")
    lines.append(f"العملة: {currency}")
    lines.append("")

    for cat in menu["categories"]:
        available_items = [it for it in cat["items"] if it["available"]]
        if not available_items:
            continue
        lines.append(f"[{cat['name']}]")
        for item in available_items:
            name = item["name"]
            desc = (item.get("description") or "").strip()
            tags = []
            if item.get("vegetarian"):
                tags.append("نباتي")
            if item.get("spicy"):
                tags.append("حار")
            tag_txt = f" | {'، '.join(tags)}" if tags else ""

            if item.get("sizes"):
                prices = " ".join(f"{s['name']}{s['price']}" for s in item["sizes"])
                parts = [name]
                if desc:
                    parts.append(desc)
                parts.append(prices)
                lines.append(" | ".join(parts) + tag_txt)
            else:
                price = item.get("price")
                parts = [name]
                if desc:
                    parts.append(desc)
                if price is not None:
                    parts.append(str(price))
                lines.append(" | ".join(parts) + tag_txt)
        lines.append("")

    return "\n".join(lines).strip()
