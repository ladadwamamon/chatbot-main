"""Main FastAPI application — public site, admin panel, chat, orders."""
from __future__ import annotations

import json
import os
import shutil
import time
import traceback
import uuid
from collections import defaultdict, deque
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import FileResponse, JSONResponse, Response as FastResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.auth import (
    clear_admin_cookie,
    get_admin_password,
    is_authenticated,
    require_admin,
    set_admin_cookie,
)
from app.db import (
    all_settings,
    ensure_default_settings,
    get_conn,
    init_db,
    log_error,
    row_to_dict,
    set_setting,
)
from app.gemini_client import ask_gemini
from app.imgproxy import DEFAULT_WIDTH, get_or_create_variant
from app.menu import format_menu_for_prompt, get_full_menu
from app.tables import (
    build_scan_url,
    create_table,
    delete_table,
    get_table,
    get_table_by_token,
    list_tables,
    make_qr_png,
    regenerate_token,
    update_table,
)

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"
IMAGES_DIR = STATIC_DIR / "images" / "food"
IMAGES_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Barbeque Pizza")


# ---------- Simple in-memory rate limiter ----------
_rate_hits: dict[str, deque[float]] = defaultdict(deque)


def rate_limit(key: str, *, max_hits: int, window_sec: int) -> bool:
    """Return True if allowed, False if rate-limited."""
    now = time.time()
    q = _rate_hits[key]
    while q and now - q[0] > window_sec:
        q.popleft()
    if len(q) >= max_hits:
        return False
    q.append(now)
    return True


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "-"


@app.on_event("startup")
async def _startup() -> None:
    init_db()
    ensure_default_settings()
    # Auto-seed if DB has no items (first-run in a fresh volume)
    try:
        conn = get_conn()
        n = conn.execute("SELECT COUNT(*) c FROM items").fetchone()["c"]
        if n == 0:
            from app.seed import seed_all
            seed_all(force=False)
    except Exception:
        pass


@app.get("/health")
async def health():
    return {"status": "ok", "time": time.time()}


# ---------- Image proxy (resize + WebP cache) ----------
@app.get("/img/{name}")
async def image_proxy(name: str, w: int = DEFAULT_WIDTH):
    result = get_or_create_variant(name, w)
    if result is None:
        raise HTTPException(status_code=404, detail="image not found")
    path, media = result
    return FileResponse(
        path,
        media_type=media,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


# ---------- Error middleware ----------
@app.middleware("http")
async def error_logging(request: Request, call_next):
    started = time.perf_counter()
    try:
        response = await call_next(request)
        return response
    except Exception as e:  # pragma: no cover
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        try:
            log_error(
                source="server",
                message=f"{type(e).__name__}: {e}"[:300],
                details=traceback.format_exc()[:4000],
                path=str(request.url.path),
                user_agent=request.headers.get("user-agent"),
                ip=request.client.host if request.client else None,
            )
        except Exception:
            pass
        return JSONResponse(
            status_code=500,
            content={"detail": "خطأ داخلي في الخادم", "elapsed_ms": elapsed_ms},
        )


# ---------- Schemas ----------
class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=1000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=12)
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    reply: str
    session_id: str


class OrderItem(BaseModel):
    item_id: int
    name: str
    size: Optional[str] = None
    quantity: int = Field(..., ge=1, le=50)
    unit_price: float
    line_total: float
    note: Optional[str] = Field(None, max_length=200)


class OrderRequest(BaseModel):
    customer_name: str = Field(..., min_length=1, max_length=100)
    table_token: Optional[str] = Field(None, max_length=64)
    notes: Optional[str] = Field(None, max_length=500)
    items: list[OrderItem] = Field(..., min_length=1)
    payment_method: str = "نقدي عند الاستلام"


class TableCreatePayload(BaseModel):
    number: str = Field(..., min_length=1, max_length=20)
    label: Optional[str] = Field(None, max_length=50)


class TableUpdatePayload(BaseModel):
    label: Optional[str] = Field(None, max_length=50)
    active: Optional[bool] = None


class LoginRequest(BaseModel):
    password: str


class ItemPayload(BaseModel):
    category_id: int
    name: str
    name_en: Optional[str] = None
    description: Optional[str] = None
    image: Optional[str] = None
    sizes: Optional[list[dict]] = None
    price: Optional[float] = None
    vegetarian: bool = False
    spicy: bool = False
    available: bool = True
    sort_order: int = 0


class CategoryPayload(BaseModel):
    name: str
    name_en: Optional[str] = None
    icon: Optional[str] = None
    sort_order: int = 0


# ---------- Public pages ----------
@app.get("/")
async def public_home():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/t/{token}")
async def public_home_with_table(token: str):
    """QR-scan entry point. Frontend reads the token from the URL."""
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/admin")
@app.get("/admin/")
async def admin_page():
    return FileResponse(STATIC_DIR / "admin" / "index.html")


# ---------- Public API ----------
@app.get("/api/menu")
async def api_menu():
    return get_full_menu()


@app.get("/api/restaurant")
async def api_restaurant():
    s = all_settings()
    return {
        "name": s.get("restaurant_name"),
        "name_en": s.get("restaurant_name_en"),
        "tagline": s.get("restaurant_tagline"),
        "phone": s.get("restaurant_phone"),
        "address": s.get("restaurant_address"),
        "hours": s.get("restaurant_hours"),
        "currency": s.get("currency"),
        "delivery": {
            "available": s.get("delivery_available") == "true",
            "fee": _to_float(s.get("delivery_fee")),
            "min_order": _to_float(s.get("min_order")),
            "estimated_time": s.get("estimated_time"),
        },
        "chatbot": {
            "enabled": s.get("chatbot_enabled") == "true",
            "welcome": s.get("chatbot_welcome"),
        },
        "orders": {
            "require_table": s.get("orders_require_table", "true") == "true",
        },
        "theme": {
            "primary": s.get("primary_color"),
            "primary_dark": s.get("primary_color_dark"),
        },
    }


def _to_float(v):
    try:
        return float(v) if v not in (None, "") else None
    except (ValueError, TypeError):
        return None


@app.post("/api/chat", response_model=ChatResponse)
async def api_chat(request: ChatRequest, http_req: Request):
    if all_settings().get("chatbot_enabled", "true") != "true":
        raise HTTPException(status_code=503, detail="الشات بوت معطل حالياً")

    # Rate-limit per session first (isolates each customer on shared WiFi);
    # fall back to IP only when the client has no session yet.
    rl_key = request.session_id or client_ip(http_req)
    if not rate_limit(f"chat:{rl_key}", max_hits=20, window_sec=60):
        raise HTTPException(status_code=429, detail="طلبات كثيرة، انتظر قليلاً")

    session_id = request.session_id or str(uuid.uuid4())
    try:
        history = [{"role": m.role, "content": m.content} for m in request.history]
        menu_text = format_menu_for_prompt()
        reply = await ask_gemini(request.message, menu_text, history, session_id=session_id)
        return ChatResponse(reply=reply, session_id=session_id)
    except ValueError as e:
        log_error(
            source="chat",
            message=str(e),
            path="/api/chat",
            user_agent=http_req.headers.get("user-agent"),
        )
        raise HTTPException(status_code=500, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@app.get("/api/table/{token}")
async def api_get_table(token: str):
    """Public: resolve a QR token to a table number (used by frontend)."""
    t = get_table_by_token(token)
    if not t or not t["active"]:
        raise HTTPException(status_code=404, detail="طاولة غير معروفة أو غير مفعّلة")
    return {"number": t["number"], "label": t["label"], "token": t["token"]}


@app.post("/api/orders")
async def api_create_order(order: OrderRequest, http_req: Request):
    settings = all_settings()
    require_table = settings.get("orders_require_table", "true") == "true"

    table = None
    if order.table_token:
        candidate = get_table_by_token(order.table_token)
        if candidate and candidate["active"]:
            table = candidate

    if require_table and table is None:
        raise HTTPException(
            status_code=400,
            detail="رقم الطاولة غير صحيح، الرجاء مسح رمز QR الموجود على طاولتك",
        )

    # Rate-limit per identity so one customer on shared WiFi can't block others.
    # In public mode without a table, we fall back to IP (best available).
    identity = (
        (table and f"table:{table['id']}")
        or f"ip:{client_ip(http_req)}"
    )
    if not rate_limit(f"order:{identity}", max_hits=6, window_sec=120):
        raise HTTPException(status_code=429, detail="طلبات كثيرة، انتظر قليلاً")

    try:
        subtotal = sum(i.line_total for i in order.items)
        total = subtotal
        items_data = [i.model_dump() for i in order.items]

        conn = get_conn()
        cur = conn.execute(
            "INSERT INTO orders(customer_name,phone,address,notes,items_json,"
            "subtotal,delivery_fee,total,status,payment_method,table_id,table_number) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                order.customer_name,
                None,
                None,
                order.notes,
                json.dumps(items_data, ensure_ascii=False),
                subtotal,
                0,
                total,
                "جديد",
                order.payment_method,
                table["id"] if table else None,
                table["number"] if table else None,
            ),
        )
        conn.commit()
        return {
            "id": cur.lastrowid,
            "total": total,
            "subtotal": subtotal,
            "table_number": table["number"] if table else None,
            "mode": "table" if require_table else "public",
        }
    except Exception as e:
        log_error(
            source="order",
            message=str(e)[:300],
            details=traceback.format_exc()[:2000],
            path="/api/orders",
            user_agent=http_req.headers.get("user-agent"),
        )
        raise HTTPException(status_code=500, detail="تعذر إتمام الطلب") from e


# ---------- Admin auth ----------
@app.post("/admin/api/login")
async def admin_login(req: LoginRequest, http_req: Request, response: Response):
    ip = client_ip(http_req)
    if not rate_limit(f"login:{ip}", max_hits=8, window_sec=300):
        raise HTTPException(status_code=429, detail="محاولات كثيرة، حاول بعد قليل")
    if req.password != get_admin_password():
        log_error(
            source="auth",
            message="Failed admin login attempt",
            ip=ip,
            user_agent=http_req.headers.get("user-agent"),
        )
        raise HTTPException(status_code=401, detail="كلمة المرور غير صحيحة")
    set_admin_cookie(response)
    return {"ok": True}


@app.post("/admin/api/logout")
async def admin_logout(response: Response):
    clear_admin_cookie(response)
    return {"ok": True}


@app.get("/admin/api/me")
async def admin_me(request: Request):
    return {"authenticated": is_authenticated(request)}


# ---------- Admin: summary ----------
@app.get("/admin/api/summary", dependencies=[Depends(require_admin)])
async def admin_summary():
    conn = get_conn()
    q = lambda sql, *a: conn.execute(sql, a).fetchone()  # noqa: E731
    total_items = q("SELECT COUNT(*) c FROM items")["c"]
    available_items = q("SELECT COUNT(*) c FROM items WHERE available=1")["c"]
    total_orders = q("SELECT COUNT(*) c FROM orders")["c"]
    orders_today = q(
        "SELECT COUNT(*) c FROM orders WHERE date(created_at)=date('now')"
    )["c"]
    revenue_today = q(
        "SELECT COALESCE(SUM(total),0) s FROM orders WHERE date(created_at)=date('now')"
    )["s"]
    total_chats = q("SELECT COUNT(*) c FROM chats")["c"]
    chats_today = q("SELECT COUNT(*) c FROM chats WHERE date(created_at)=date('now')")["c"]
    open_errors = q("SELECT COUNT(*) c FROM errors WHERE resolved=0")["c"]
    tokens_today = q(
        "SELECT COALESCE(SUM(tokens_in),0) i, COALESCE(SUM(tokens_out),0) o "
        "FROM chats WHERE date(created_at)=date('now')"
    )
    recent_orders = conn.execute(
        "SELECT id,customer_name,total,status,created_at FROM orders "
        "ORDER BY created_at DESC LIMIT 5"
    ).fetchall()
    recent_errors = conn.execute(
        "SELECT id,message,source,created_at FROM errors WHERE resolved=0 "
        "ORDER BY created_at DESC LIMIT 5"
    ).fetchall()
    return {
        "items": {"total": total_items, "available": available_items},
        "orders": {"total": total_orders, "today": orders_today, "revenue_today": revenue_today},
        "chats": {"total": total_chats, "today": chats_today,
                   "tokens_in_today": tokens_today["i"], "tokens_out_today": tokens_today["o"]},
        "errors": {"open": open_errors},
        "recent_orders": [dict(r) for r in recent_orders],
        "recent_errors": [dict(r) for r in recent_errors],
    }


# ---------- Admin: items ----------
@app.get("/admin/api/items", dependencies=[Depends(require_admin)])
async def admin_list_items():
    conn = get_conn()
    rows = conn.execute(
        "SELECT id,category_id,name,name_en,description,image,sizes_json,price,"
        "vegetarian,spicy,available,sort_order FROM items ORDER BY category_id,sort_order,id"
    ).fetchall()
    return [row_to_dict(r) for r in rows]


@app.post("/admin/api/items", dependencies=[Depends(require_admin)])
async def admin_create_item(payload: ItemPayload):
    conn = get_conn()
    sizes_json = json.dumps(payload.sizes, ensure_ascii=False) if payload.sizes else None
    cur = conn.execute(
        "INSERT INTO items(category_id,name,name_en,description,image,sizes_json,price,"
        "vegetarian,spicy,available,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (
            payload.category_id, payload.name, payload.name_en, payload.description,
            payload.image, sizes_json, payload.price,
            1 if payload.vegetarian else 0,
            1 if payload.spicy else 0,
            1 if payload.available else 0,
            payload.sort_order,
        ),
    )
    conn.commit()
    return {"id": cur.lastrowid}


@app.patch("/admin/api/items/{item_id}", dependencies=[Depends(require_admin)])
async def admin_update_item(item_id: int, payload: ItemPayload):
    conn = get_conn()
    sizes_json = json.dumps(payload.sizes, ensure_ascii=False) if payload.sizes else None
    conn.execute(
        "UPDATE items SET category_id=?,name=?,name_en=?,description=?,image=?,"
        "sizes_json=?,price=?,vegetarian=?,spicy=?,available=?,sort_order=?,"
        "updated_at=datetime('now') WHERE id=?",
        (
            payload.category_id, payload.name, payload.name_en, payload.description,
            payload.image, sizes_json, payload.price,
            1 if payload.vegetarian else 0,
            1 if payload.spicy else 0,
            1 if payload.available else 0,
            payload.sort_order,
            item_id,
        ),
    )
    conn.commit()
    return {"ok": True}


@app.delete("/admin/api/items/{item_id}", dependencies=[Depends(require_admin)])
async def admin_delete_item(item_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM items WHERE id=?", (item_id,))
    conn.commit()
    return {"ok": True}


@app.post("/admin/api/items/{item_id}/toggle", dependencies=[Depends(require_admin)])
async def admin_toggle_item(item_id: int):
    conn = get_conn()
    conn.execute(
        "UPDATE items SET available=1-available, updated_at=datetime('now') WHERE id=?",
        (item_id,),
    )
    conn.commit()
    return {"ok": True}


# ---------- Admin: categories ----------
@app.get("/admin/api/categories", dependencies=[Depends(require_admin)])
async def admin_list_categories():
    conn = get_conn()
    rows = conn.execute(
        "SELECT id,name,name_en,icon,sort_order FROM categories ORDER BY sort_order,id"
    ).fetchall()
    return [dict(r) for r in rows]


@app.post("/admin/api/categories", dependencies=[Depends(require_admin)])
async def admin_create_category(payload: CategoryPayload):
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO categories(name,name_en,icon,sort_order) VALUES(?,?,?,?)",
        (payload.name, payload.name_en, payload.icon, payload.sort_order),
    )
    conn.commit()
    return {"id": cur.lastrowid}


@app.patch("/admin/api/categories/{cid}", dependencies=[Depends(require_admin)])
async def admin_update_category(cid: int, payload: CategoryPayload):
    conn = get_conn()
    conn.execute(
        "UPDATE categories SET name=?,name_en=?,icon=?,sort_order=? WHERE id=?",
        (payload.name, payload.name_en, payload.icon, payload.sort_order, cid),
    )
    conn.commit()
    return {"ok": True}


@app.delete("/admin/api/categories/{cid}", dependencies=[Depends(require_admin)])
async def admin_delete_category(cid: int):
    conn = get_conn()
    conn.execute("DELETE FROM categories WHERE id=?", (cid,))
    conn.commit()
    return {"ok": True}


# ---------- Admin: image upload ----------
@app.post("/admin/api/upload", dependencies=[Depends(require_admin)])
async def admin_upload_image(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="ملف بدون اسم")
    ext = Path(file.filename).suffix.lower()
    if ext not in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
        raise HTTPException(status_code=400, detail="نوع الملف غير مدعوم")
    safe_name = f"upload-{uuid.uuid4().hex[:10]}{ext}"
    target = IMAGES_DIR / safe_name
    with target.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"image": safe_name}


@app.get("/admin/api/images", dependencies=[Depends(require_admin)])
async def admin_list_images():
    return sorted([p.name for p in IMAGES_DIR.iterdir() if p.is_file()])


# ---------- Admin: errors, chats, orders ----------
@app.get("/admin/api/errors", dependencies=[Depends(require_admin)])
async def admin_list_errors(limit: int = 100, only_open: bool = False):
    conn = get_conn()
    sql = "SELECT * FROM errors "
    params: list = []
    if only_open:
        sql += "WHERE resolved=0 "
    sql += "ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


@app.post("/admin/api/errors/{eid}/resolve", dependencies=[Depends(require_admin)])
async def admin_resolve_error(eid: int):
    conn = get_conn()
    conn.execute("UPDATE errors SET resolved=1 WHERE id=?", (eid,))
    conn.commit()
    return {"ok": True}


@app.delete("/admin/api/errors", dependencies=[Depends(require_admin)])
async def admin_clear_errors():
    conn = get_conn()
    conn.execute("DELETE FROM errors WHERE resolved=1")
    conn.commit()
    return {"ok": True}


@app.get("/admin/api/chats", dependencies=[Depends(require_admin)])
async def admin_list_chats(limit: int = 100):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM chats ORDER BY created_at DESC LIMIT ?", (limit,)
    ).fetchall()
    return [dict(r) for r in rows]


@app.get("/admin/api/orders", dependencies=[Depends(require_admin)])
async def admin_list_orders(limit: int = 100, status_filter: Optional[str] = None):
    conn = get_conn()
    if status_filter:
        rows = conn.execute(
            "SELECT * FROM orders WHERE status=? ORDER BY created_at DESC LIMIT ?",
            (status_filter, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM orders ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["items"] = json.loads(d.pop("items_json") or "[]")
        result.append(d)
    return result


@app.patch("/admin/api/orders/{oid}", dependencies=[Depends(require_admin)])
async def admin_update_order(oid: int, payload: dict):
    conn = get_conn()
    if "status" in payload:
        conn.execute("UPDATE orders SET status=? WHERE id=?", (payload["status"], oid))
        conn.commit()
    return {"ok": True}


# ---------- Admin: tables ----------
def _public_base_url(request: Request) -> str:
    """Best-effort public base URL respecting reverse-proxy headers."""
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}"


@app.get("/admin/api/tables", dependencies=[Depends(require_admin)])
async def admin_list_tables(request: Request):
    base = _public_base_url(request)
    tables = list_tables()
    for t in tables:
        t["scan_url"] = build_scan_url(base, t["token"])
    return tables


@app.post("/admin/api/tables", dependencies=[Depends(require_admin)])
async def admin_create_table(payload: TableCreatePayload):
    try:
        t = create_table(payload.number, payload.label)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return t


@app.patch("/admin/api/tables/{tid}", dependencies=[Depends(require_admin)])
async def admin_update_table(tid: int, payload: TableUpdatePayload):
    if not get_table(tid):
        raise HTTPException(status_code=404, detail="غير موجود")
    update_table(tid, label=payload.label, active=payload.active)
    return {"ok": True, "table": get_table(tid)}


@app.post("/admin/api/tables/{tid}/regenerate", dependencies=[Depends(require_admin)])
async def admin_regenerate_table(tid: int):
    if not get_table(tid):
        raise HTTPException(status_code=404, detail="غير موجود")
    token = regenerate_token(tid)
    return {"ok": True, "token": token}


@app.delete("/admin/api/tables/{tid}", dependencies=[Depends(require_admin)])
async def admin_delete_table(tid: int):
    delete_table(tid)
    return {"ok": True}


@app.get("/admin/api/tables/{tid}/qr.png", dependencies=[Depends(require_admin)])
async def admin_table_qr(tid: int, request: Request, size: int = 12):
    t = get_table(tid)
    if not t:
        raise HTTPException(status_code=404, detail="غير موجود")
    size = max(4, min(20, size))
    url = build_scan_url(_public_base_url(request), t["token"])
    png = make_qr_png(url, box_size=size)
    return FastResponse(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )


# ---------- Admin: settings ----------
@app.get("/admin/api/settings", dependencies=[Depends(require_admin)])
async def admin_get_settings():
    return all_settings()


@app.patch("/admin/api/settings", dependencies=[Depends(require_admin)])
async def admin_update_settings(payload: dict):
    for k, v in payload.items():
        set_setting(k, str(v))
    return {"ok": True, "settings": all_settings()}


# ---------- Static ----------
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
