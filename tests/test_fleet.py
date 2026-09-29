"""Fleet connection state, deploy kit, and command queue."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.venues import compose_kit, connection_state


def test_local_is_connected():
    st = connection_state({"is_local": True})
    assert st["state"] == "local"
    assert st["ok"] is True


def test_never_seen():
    st = connection_state({"is_local": False, "last_seen_at": None})
    assert st["state"] == "never"
    assert st["ok"] is False
    assert st["label"] == "بانتظار النبضة"


def test_fresh_heartbeat():
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    st = connection_state({"is_local": False, "last_seen_at": now})
    assert st["state"] == "connected"
    assert st["ok"] is True


def test_stale_heartbeat():
    past = datetime.now(timezone.utc) - timedelta(seconds=180)
    ts = past.strftime("%Y-%m-%d %H:%M:%S")
    st = connection_state({"is_local": False, "last_seen_at": ts})
    assert st["state"] == "stale"
    assert st["ok"] is False


def test_offline_heartbeat():
    past = datetime.now(timezone.utc) - timedelta(seconds=700)
    ts = past.strftime("%Y-%m-%d %H:%M:%S")
    st = connection_state({"is_local": False, "last_seen_at": ts})
    assert st["state"] == "offline"
    assert st["ok"] is False


def test_compose_kit_phones_home(monkeypatch):
    monkeypatch.setenv("HUB_PUBLIC_URL", "https://manager.ourcompany.com")
    kit = compose_kit({
        "slug": "ahmad",
        "name": "مطعم أحمد",
        "name_en": "Ahmad",
        "suggested_port": 8080,
        "manager_token": "tok",
        "admin_password": "pw",
        "admin_secret": "sec",
        "public_url": "https://ahmadrestaurant.com",
        "meta": {"tagline": "أهلاً", "primary_color": "#1e3a5f"},
    })
    assert "HUB_URL=https://manager.ourcompany.com" in kit["env"]
    assert "SKIP_SEED=1" in kit["env"]
    assert "PUBLIC_URL=https://ahmadrestaurant.com" in kit["env"]
    assert "HUB_URL=${HUB_URL}" in kit["compose"]
    assert "docker compose up -d" in kit["bootstrap"]
    assert "ahmad_brand" in kit["compose"]
    assert "cat > .env" in kit["one_shot"]
    assert "bootstrap.sh" in kit["one_shot"]
    assert kit["hub_url"] == "https://manager.ourcompany.com"


def _reset_db(path: Path) -> None:
    from app import db as dbmod

    dbmod.DB_PATH = path
    conn = getattr(dbmod._local, "conn", None)
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass
        dbmod._local.conn = None
    dbmod.init_db()


def test_command_queue_roundtrip(tmp_path):
    _reset_db(tmp_path / "queue.db")
    from app.venues import ack_command, create_venue, enqueue_command, list_pending_commands

    venue = create_venue({"name": "مطعم أحمد", "name_en": "Ahmad"})
    cmd = enqueue_command(
        venue["id"],
        "apply_settings",
        {"settings": {"restaurant_name": "أحمد"}},
    )
    pending = list_pending_commands(venue["id"])
    assert len(pending) == 1
    assert pending[0]["kind"] == "apply_settings"
    assert pending[0]["id"] == cmd["id"]
    assert ack_command(cmd["id"], venue["id"], ok=True) is True
    assert list_pending_commands(venue["id"]) == []


def test_apply_command_settings(tmp_path):
    _reset_db(tmp_path / "apply.db")
    from app.db import get_setting, set_setting
    from app.hub_client import apply_command, hub_enabled

    assert hub_enabled() is False
    set_setting("restaurant_name", "old")
    result = apply_command({
        "kind": "apply_settings",
        "payload": {"settings": {"restaurant_name": "new-name"}},
    })
    assert result["ok"] is True
    assert get_setting("restaurant_name") == "new-name"
    unknown = apply_command({"kind": "explode", "payload": {}})
    assert unknown["ok"] is False
