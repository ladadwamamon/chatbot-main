"""Table management: CRUD + QR generation.

Each dine-in table has a unique random URL-safe `token`. The public site is
opened via `https://<host>/t/<token>` — the frontend reads the token from the
URL, validates it against `/api/table/<token>` and remembers it for the
session. Orders must include a valid table token, so people cannot place
orders from outside the restaurant.
"""
from __future__ import annotations

import secrets
from io import BytesIO
from typing import Any

import qrcode
from qrcode.constants import ERROR_CORRECT_M

from app.db import get_conn


def _new_token() -> str:
    # 11 URL-safe chars — 66 bits of entropy, unguessable
    return secrets.token_urlsafe(8)


def _row_to_dict(row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "number": row["number"],
        "label": row["label"],
        "token": row["token"],
        "active": bool(row["active"]),
        "created_at": row["created_at"],
    }


def list_tables() -> list[dict[str, Any]]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT id,number,label,token,active,created_at FROM tables "
        "ORDER BY CAST(number AS INTEGER), number"
    ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_table(table_id: int) -> dict[str, Any] | None:
    row = get_conn().execute(
        "SELECT id,number,label,token,active,created_at FROM tables WHERE id=?",
        (table_id,),
    ).fetchone()
    return _row_to_dict(row) if row else None


def get_table_by_token(token: str) -> dict[str, Any] | None:
    row = get_conn().execute(
        "SELECT id,number,label,token,active,created_at FROM tables WHERE token=?",
        (token,),
    ).fetchone()
    return _row_to_dict(row) if row else None


def create_table(number: str, label: str | None = None) -> dict[str, Any]:
    number = (number or "").strip()
    if not number:
        raise ValueError("رقم الطاولة مطلوب")
    conn = get_conn()
    exists = conn.execute("SELECT 1 FROM tables WHERE number=?", (number,)).fetchone()
    if exists:
        raise ValueError("رقم الطاولة موجود مسبقاً")
    token = _new_token()
    for _ in range(5):
        if not conn.execute("SELECT 1 FROM tables WHERE token=?", (token,)).fetchone():
            break
        token = _new_token()
    cur = conn.execute(
        "INSERT INTO tables(number,label,token,active) VALUES(?,?,?,1)",
        (number, (label or "").strip() or None, token),
    )
    conn.commit()
    return get_table(cur.lastrowid or 0)  # type: ignore[return-value]


def update_table(table_id: int, *, label: str | None = None, active: bool | None = None) -> None:
    conn = get_conn()
    sets: list[str] = []
    args: list[Any] = []
    if label is not None:
        sets.append("label=?")
        args.append(label.strip() or None)
    if active is not None:
        sets.append("active=?")
        args.append(1 if active else 0)
    if not sets:
        return
    args.append(table_id)
    conn.execute(f"UPDATE tables SET {', '.join(sets)} WHERE id=?", args)
    conn.commit()


def regenerate_token(table_id: int) -> str:
    conn = get_conn()
    token = _new_token()
    for _ in range(5):
        if not conn.execute("SELECT 1 FROM tables WHERE token=?", (token,)).fetchone():
            break
        token = _new_token()
    conn.execute("UPDATE tables SET token=? WHERE id=?", (token, table_id))
    conn.commit()
    return token


def delete_table(table_id: int) -> None:
    conn = get_conn()
    conn.execute("DELETE FROM tables WHERE id=?", (table_id,))
    conn.commit()


def build_scan_url(base_url: str, token: str) -> str:
    return f"{base_url.rstrip('/')}/t/{token}"


def make_qr_png(url: str, *, box_size: int = 12, border: int = 2) -> bytes:
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_M,
        box_size=box_size,
        border=border,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
