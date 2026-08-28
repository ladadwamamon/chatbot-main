"""SQLite database access layer for the restaurant chatbot & menu system."""
from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any, Iterable

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "chatbot.db"

_local = threading.local()


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def get_conn() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = _connect()
        _local.conn = conn
    return conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_en TEXT,
  icon TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_en TEXT,
  description TEXT,
  image TEXT,
  sizes_json TEXT,
  price REAL,
  vegetarian INTEGER DEFAULT 0,
  spicy INTEGER DEFAULT 0,
  available INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  level TEXT DEFAULT 'error',
  source TEXT,
  message TEXT,
  details TEXT,
  path TEXT,
  user_agent TEXT,
  ip TEXT,
  resolved INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_errors_created ON errors(created_at DESC);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  session_id TEXT,
  user_message TEXT,
  bot_reply TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  latency_ms INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_chats_created ON chats(created_at DESC);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  customer_name TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT,
  items_json TEXT,
  subtotal REAL,
  delivery_fee REAL DEFAULT 0,
  total REAL,
  status TEXT DEFAULT 'جديد',
  payment_method TEXT DEFAULT 'نقدي عند الاستلام',
  table_id INTEGER,
  table_number TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

CREATE TABLE IF NOT EXISTS tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  label TEXT,
  token TEXT NOT NULL UNIQUE,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tables_token ON tables(token);

CREATE TABLE IF NOT EXISTS venues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  name TEXT NOT NULL,
  name_en TEXT,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT DEFAULT 'restaurant',
  status TEXT DEFAULT 'setup',
  plan TEXT DEFAULT 'starter',
  is_local INTEGER DEFAULT 0,
  public_url TEXT,
  contact_name TEXT,
  contact_phone TEXT,
  notes TEXT,
  server_host TEXT,
  suggested_port INTEGER,
  manager_token TEXT,
  admin_password TEXT,
  admin_secret TEXT,
  last_seen_at TEXT,
  last_latency_ms INTEGER,
  last_health TEXT,
  meta_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_venues_status ON venues(status);
"""


def _migrate() -> None:
    """Add columns that older DBs may miss (idempotent), then create indices."""
    conn = get_conn()
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(orders)")}
    if "table_id" not in cols:
        conn.execute("ALTER TABLE orders ADD COLUMN table_id INTEGER")
    if "table_number" not in cols:
        conn.execute("ALTER TABLE orders ADD COLUMN table_number TEXT")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(table_id)")
    conn.commit()


def init_db() -> None:
    conn = get_conn()
    conn.executescript(SCHEMA)
    conn.commit()
    _migrate()


# ---------- Settings helpers ----------
DEFAULT_SETTINGS = {
    "restaurant_name": "بيتزا باربيكيو",
    "restaurant_name_en": "Barbeque Pizza",
    "restaurant_tagline": "ألذ بيتزا في المدينة",
    "restaurant_phone": "",
    "restaurant_address": "",
    "restaurant_hours": "",
    "currency": "شيكل",
    "delivery_available": "true",
    "delivery_fee": "10",
    "min_order": "50",
    "estimated_time": "30-45 دقيقة",
    "orders_require_table": "true",
    "chatbot_enabled": "true",
    "chatbot_model": "gemini-3.5-flash-lite",
    "chatbot_temperature": "0.35",
    "chatbot_thinking_budget": "minimal",
    "chatbot_max_tokens": "800",
    "chatbot_welcome": "أهلاً! أنا مساعد بيتزا باربيكيو. اسألني عن أي صنف، السعر، أو المكونات.",
    "chatbot_system_prompt": (
        "أنت مساعد ذكي لمطعم بيتزا. رد بالعربية فقط، بشكل واضح ومختصر."
        "\nاعتمد فقط على المنيو أدناه — لا تخترع أصناف أو أسعار."
        "\nممنوع Markdown نهائياً: لا * ولا ** ولا #."
        "\nلعرض الأصناف استخدم هذا الشكل بالضبط:"
        "\n• اسم الصنف"
        "\n  المكونات: ..."
        "\n  الأسعار: صغير S .. | وسط M .. | كبير L .. | عائلي XL .. شيكل"
        "\nللصنف بسعر واحد استخدم:"
        "\n• اسم الصنف"
        "\n  التفاصيل: ..."
        "\n  السعر: .. شيكل"
    ),
    "primary_color": "#e63946",
    "primary_color_dark": "#c1121f",
}


def get_setting(key: str, default: str | None = None) -> str | None:
    row = get_conn().execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    if row is None:
        return default
    return row["value"]


def set_setting(key: str, value: str) -> None:
    conn = get_conn()
    conn.execute(
        "INSERT INTO settings(key,value) VALUES(?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )
    conn.commit()


def all_settings() -> dict[str, str]:
    rows = get_conn().execute("SELECT key,value FROM settings").fetchall()
    result = {k: v for k, v in ((r["key"], r["value"]) for r in rows)}
    # Fill missing defaults
    for k, v in DEFAULT_SETTINGS.items():
        result.setdefault(k, v)
    return result


def ensure_default_settings() -> None:
    for k, v in DEFAULT_SETTINGS.items():
        if get_setting(k) is None:
            set_setting(k, v)


# ---------- Row helpers ----------
def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    d = dict(row)
    if "sizes_json" in d:
        sizes = d.pop("sizes_json")
        d["sizes"] = json.loads(sizes) if sizes else None
    if "items_json" in d:
        items = d.pop("items_json")
        d["items"] = json.loads(items) if items else []
    return d


def rows_to_list(rows: Iterable[sqlite3.Row]) -> list[dict[str, Any]]:
    return [row_to_dict(r) for r in rows]  # type: ignore[return-value]


# ---------- Error logging ----------
def log_error(
    *,
    source: str,
    message: str,
    details: str | None = None,
    path: str | None = None,
    user_agent: str | None = None,
    ip: str | None = None,
    level: str = "error",
) -> int:
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO errors(level,source,message,details,path,user_agent,ip) "
        "VALUES(?,?,?,?,?,?,?)",
        (level, source, message, details, path, user_agent, ip),
    )
    conn.commit()
    return cur.lastrowid or 0


def log_chat(
    *,
    session_id: str | None,
    user_message: str,
    bot_reply: str | None,
    tokens_in: int | None = None,
    tokens_out: int | None = None,
    latency_ms: int | None = None,
    error: str | None = None,
) -> int:
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO chats(session_id,user_message,bot_reply,tokens_in,tokens_out,latency_ms,error) "
        "VALUES(?,?,?,?,?,?,?)",
        (session_id, user_message, bot_reply, tokens_in, tokens_out, latency_ms, error),
    )
    conn.commit()
    return cur.lastrowid or 0
