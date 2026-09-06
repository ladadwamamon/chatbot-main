"""Sanitize bot replies and infer menu cards from mentioned items."""
from __future__ import annotations

import re
from typing import Any

MAX_ITEMS = 4
MAX_CATEGORIES = 2

FALLBACK_REPLY = "ما قدرت أرتب الرد هالمرة. اسألني مرة ثانية عن الصنف أو القسم اللي بدك ياه."

# Keep the model focused on food. Never ask it to emit JSON — lite models leak it.
ACTIONS_INSTRUCTIONS = """

=== عرض الأصناف ===
اكتب أسماء الأصناف كاملة كما هي بالمنيو، سطر لكل صنف.
الواجهة تعرض البطاقات تلقائياً تحت ردك.
ممنوع منعاً باتاً: JSON، أرقام id، [[CARDS]]، Markdown، أو أي كلام إنجليزي أو ملاحظات داخلية.
ردك للزبون عربي فقط عن الأكل والأسعار.
"""

CART_ASK_RE = re.compile(
    r"السلة|سلتك|سلتي|شو\s*في\s*السلة|شو\s*عندي|طلب(?:ي|ك)\s*الحالي|ملخص(?:\s+ال)?طلب",
    re.I,
)

_QUERY_STOP = {
    "بيتزا", "عندنا", "اقترح", "اقترحي", "وجبة", "أنواع", "الموجودة",
    "شو", "فيها", "في", "بدي", "أريد", "عايز", "من", "على", "هذا",
    "هذي", "هذه", "اللي", "موجود", "موجودة", "قائمة", "المنيو", "كمان",
}

_LEAK_LINE = re.compile(
    r"(?i)("
    r"\[\[\s*/?\s*cards\s*\]\]"
    r"|cards?\s+generation"
    r"|ids?\s+mentioned"
    r"|check\s+constraints?"
    r"|no\s+markdown"
    r"|show_cart"
    r"|max\s+(items|categories|4)"
    r"|function\s+call"
    r"|tool\s+call"
    r"|hidden\s+(block|json)"
    r")"
)

_CUT_FROM = re.compile(
    r"(?is)("
    r"\[\[\s*cards"
    r"|```(?:json)?"
    r"|\{[^{}]{0,40}\"items\""
    r"|cards?\s+generation"
    r"|check\s+constraints?"
    r")"
)


def format_cart_for_prompt(cart: list[dict] | None, currency: str = "شيكل") -> str:
    if not cart:
        return "السلة فارغة."
    lines = []
    total = 0.0
    for row in cart:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        size = row.get("size")
        qty = int(row.get("quantity") or 1)
        line_total = float(row.get("line_total") or 0)
        total += line_total
        size_bit = f" ({size})" if size else ""
        lines.append(f"- {name}{size_bit} × {qty} = {line_total:g} {currency}")
    if not lines:
        return "السلة فارغة."
    lines.append(f"المجموع: {total:g} {currency}")
    return "\n".join(lines)


def sanitize_reply(reply: str) -> str:
    """Remove leaked instructions, unfinished JSON, and English meta text."""
    text = reply or ""
    cut = _CUT_FROM.search(text)
    if cut:
        text = text[: cut.start()]

    cleaned: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            if cleaned and cleaned[-1] != "":
                cleaned.append("")
            continue
        if _LEAK_LINE.search(line):
            continue
        if re.match(r"^[\s\{\}\[\]\",:0-9items categories show_cart true false]+$", line, re.I):
            continue
        if re.match(r"^#\d+\b", line) and len(line) < 8:
            continue
        # Drop English-only meta lines
        letters = re.findall(r"[A-Za-z\u0600-\u06FF]", line)
        if letters:
            latin = sum(1 for ch in letters if ch.isascii() and ch.isalpha())
            if latin / len(letters) > 0.7 and len(line) > 12:
                continue
        cleaned.append(line)

    text = "\n".join(cleaned)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def extract_actions(
    reply: str,
    menu: dict,
    *,
    user_message: str = "",
) -> tuple[str, dict[str, Any]]:
    """Return (visible_reply, actions) after stripping leaks and inferring cards."""
    visible = sanitize_reply(reply)
    if _is_junk(visible):
        visible = FALLBACK_REPLY

    item_ids = _infer_ids(visible, _item_names(menu))
    if not item_ids:
        item_ids = _infer_from_query(user_message, menu)

    cat_ids = _infer_ids(f"{visible}\n{user_message}", _category_names(menu))
    if not cat_ids:
        cat_ids = _infer_categories_from_query(user_message, menu)

    if not item_ids and cat_ids:
        item_ids = _items_in_categories(menu, cat_ids)

    item_ids = item_ids[:MAX_ITEMS]
    cat_ids = cat_ids[:MAX_CATEGORIES]

    show_cart = bool(
        CART_ASK_RE.search(user_message or "")
        or (visible != FALLBACK_REPLY and CART_ASK_RE.search(visible))
    )

    return visible, {
        "items": item_ids,
        "categories": cat_ids,
        "show_cart": show_cart,
    }


def _is_junk(text: str) -> bool:
    if not text or len(text.strip()) < 10:
        return True
    arabic = len(re.findall(r"[\u0600-\u06FF]", text))
    if arabic < 8:
        return True
    if _LEAK_LINE.search(text) and arabic < 24:
        return True
    return False


def _item_names(menu: dict) -> list[tuple[str, int]]:
    pairs: list[tuple[str, int]] = []
    for cat in menu.get("categories") or []:
        for it in cat.get("items") or []:
            if it.get("available") is False:
                continue
            try:
                iid = int(it["id"])
            except (KeyError, TypeError, ValueError):
                continue
            for key in ("name", "name_en"):
                name = (it.get(key) or "").strip()
                if name:
                    pairs.append((name, iid))
    return pairs


def _category_names(menu: dict) -> list[tuple[str, int]]:
    pairs: list[tuple[str, int]] = []
    for cat in menu.get("categories") or []:
        try:
            cid = int(cat["id"])
        except (KeyError, TypeError, ValueError):
            continue
        for key in ("name", "name_en"):
            name = (cat.get(key) or "").strip()
            if name:
                pairs.append((name, cid))
    return pairs


def _infer_ids(text: str, names: list[tuple[str, int]]) -> list[int]:
    if not text or not names:
        return []
    hits: list[tuple[int, int, int]] = []
    for name, id_ in names:
        if len(name) < 4:
            continue
        start = 0
        while True:
            i = text.find(name, start)
            if i < 0:
                break
            hits.append((i, i + len(name), id_))
            start = i + len(name)
    if not hits:
        return []
    hits.sort(key=lambda h: (h[0], -(h[1] - h[0])))
    occupied: list[tuple[int, int]] = []
    found: list[int] = []
    seen: set[int] = set()
    for start, end, id_ in hits:
        if id_ in seen:
            continue
        if any(start < oe and end > os for os, oe in occupied):
            continue
        seen.add(id_)
        occupied.append((start, end))
        found.append(id_)
    return found


def _tokens(text: str) -> list[str]:
    return [
        t for t in re.findall(r"[A-Za-z\u0600-\u06FF]{3,}", text or "")
        if t.lower() not in _QUERY_STOP and t not in _QUERY_STOP
    ]


def _infer_from_query(query: str, menu: dict) -> list[int]:
    exact = _infer_ids(query or "", _item_names(menu))
    if exact:
        return exact
    tokens = _tokens(query)
    if not tokens:
        return []
    scored: list[tuple[int, int]] = []
    for cat in menu.get("categories") or []:
        for it in cat.get("items") or []:
            if it.get("available") is False:
                continue
            try:
                iid = int(it["id"])
            except (KeyError, TypeError, ValueError):
                continue
            hay = f"{it.get('name') or ''} {it.get('name_en') or ''} {it.get('description') or ''}"
            hits = sum(1 for t in tokens if t.lower() in hay.lower() or t in hay)
            if hits:
                scored.append((hits, iid))
    scored.sort(key=lambda x: -x[0])
    out: list[int] = []
    for _, iid in scored:
        if iid not in out:
            out.append(iid)
    return out


def _infer_categories_from_query(query: str, menu: dict) -> list[int]:
    q = (query or "").strip()
    if len(q) < 3:
        return []
    found: list[int] = []
    for cat in menu.get("categories") or []:
        try:
            cid = int(cat["id"])
        except (KeyError, TypeError, ValueError):
            continue
        names = [cat.get("name") or "", cat.get("name_en") or ""]
        blob = " ".join(names)
        if any(n and (n in q or q in n) for n in names if len(n) >= 4):
            found.append(cid)
            continue
        for tok in _tokens(q):
            if len(tok) >= 4 and tok in blob:
                found.append(cid)
                break
    return found


def _items_in_categories(menu: dict, cat_ids: list[int]) -> list[int]:
    wanted = {int(c) for c in cat_ids}
    out: list[int] = []
    for cat in menu.get("categories") or []:
        try:
            cid = int(cat["id"])
        except (KeyError, TypeError, ValueError):
            continue
        if cid not in wanted:
            continue
        for it in cat.get("items") or []:
            if it.get("available") is False:
                continue
            try:
                iid = int(it["id"])
            except (KeyError, TypeError, ValueError):
                continue
            if iid not in out:
                out.append(iid)
            if len(out) >= MAX_ITEMS:
                return out
    return out
