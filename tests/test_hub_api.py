"""Hub heartbeat and command-queue HTTP API."""
from __future__ import annotations

from pathlib import Path

import pytest


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


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("MANAGER_PASSWORD", "test-mgr")
    monkeypatch.setenv("ADMIN_PASSWORD", "test-admin")
    monkeypatch.setenv("HUB_PUBLIC_URL", "https://manager.example.com")
    monkeypatch.setenv("SKIP_SEED", "1")
    monkeypatch.delenv("HUB_URL", raising=False)
    monkeypatch.delenv("MANAGER_TOKEN", raising=False)
    _reset_db(tmp_path / "hub.db")

    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as c:
        yield c


def _login(client) -> None:
    r = client.post("/manager/api/login", json={"password": "test-mgr"})
    assert r.status_code == 200, r.text


def test_heartbeat_marks_connected(client):
    _login(client)
    created = client.post("/manager/api/venues", json={
        "name": "مطعم أحمد",
        "name_en": "Ahmad",
        "public_url": "ahmadrestaurant.com",
        "meta": {"tagline": "أهلاً", "primary_color": "#1e3a5f"},
    })
    assert created.status_code == 200, created.text
    body = created.json()
    venue = body["venue"]
    token = venue["manager_token"]
    assert venue["public_url"] == "https://ahmadrestaurant.com"
    assert venue["connection"]["state"] == "never"
    assert "HUB_URL=https://manager.example.com" in venue["kit"]["env"]
    assert "cat > .env" in venue["kit"]["one_shot"]

    beat = client.post(
        "/api/hub/heartbeat",
        headers={"X-Manager-Token": token},
        json={
            "snapshot": {
                "version": "1.3.0",
                "orders": {"today": 4},
                "chats": {"today": 2},
                "errors": {"open": 0},
            },
            "public_url": "https://ahmadrestaurant.com",
        },
    )
    assert beat.status_code == 200, beat.text
    assert beat.json()["ok"] is True
    assert beat.json()["commands"] == []

    snap = client.get(f"/manager/api/venues/{venue['id']}/snapshot")
    assert snap.status_code == 200
    packed = snap.json()
    assert packed["venue"]["connection"]["state"] == "connected"
    assert packed["snapshot"]["via"] == "heartbeat"
    assert packed["snapshot"]["orders"]["today"] == 4
    assert packed["venue"]["status"] == "live"


def test_queue_when_unreachable_then_ack(client):
    _login(client)
    created = client.post("/manager/api/venues", json={
        "name": "مقهى ليلى",
        "public_url": "http://invalid.invalid",
        "suggested_port": 8099,
    })
    venue = created.json()["venue"]
    token = venue["manager_token"]
    vid = venue["id"]

    pushed = client.post(
        f"/manager/api/venues/{vid}/apply-identity",
    )
    assert pushed.status_code == 200, pushed.text
    data = pushed.json()
    assert data["ok"] is True
    assert data.get("queued") is True

    pending = client.get(
        "/api/hub/commands",
        headers={"X-Manager-Token": token},
    )
    assert pending.status_code == 200
    commands = pending.json()["commands"]
    assert commands
    cid = commands[0]["id"]
    assert commands[0]["kind"] == "apply_settings"

    ack = client.post(
        f"/api/hub/commands/{cid}/ack",
        headers={"X-Manager-Token": token},
        json={"ok": True},
    )
    assert ack.status_code == 200
    leftover = client.get(
        "/api/hub/commands",
        headers={"X-Manager-Token": token},
    )
    assert leftover.json()["commands"] == []


def test_heartbeat_rejects_bad_token(client):
    r = client.post(
        "/api/hub/heartbeat",
        headers={"X-Manager-Token": "nope"},
        json={"snapshot": {}},
    )
    assert r.status_code == 401
