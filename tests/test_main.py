"""Smoke test of the real app module with Supabase calls replaced (no network)."""
import importlib
from types import SimpleNamespace

from fastapi.testclient import TestClient


def load_app(monkeypatch, get_user):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_test")
    monkeypatch.setenv("ADMIN_SITE_DIR", "/nonexistent")
    import supabase as sb_mod
    fake = SimpleNamespace(auth=SimpleNamespace(
        get_user=get_user,
        admin=SimpleNamespace(list_users=lambda **_: []),
    ), table=lambda _n: None)
    monkeypatch.setattr(sb_mod, "create_client", lambda *_a, **_k: fake)
    import app.main as main
    return importlib.reload(main)


def test_health_and_me(monkeypatch):
    who = SimpleNamespace(id="u1", email="one@x.org")
    main = load_app(monkeypatch, lambda tok: SimpleNamespace(user=who) if tok == "good" else None)
    c = TestClient(main.app)
    assert c.get("/health").json() == {"status": "ready", "supabase": "ok", "supabase_error": None}
    assert c.get("/me", headers={"Authorization": "Bearer good"}).json() == {"id": "u1", "email": "one@x.org"}
    assert c.get("/me", headers={"Authorization": "Bearer bad"}).status_code == 401
    assert c.get("/analyze").status_code == 404  # AI endpoints are not part of this build


def test_rejected_server_key_is_503_not_401(monkeypatch):
    def boom(_tok):
        raise Exception("Unregistered API key")
    main = load_app(monkeypatch, boom)
    c = TestClient(main.app)
    assert c.get("/me", headers={"Authorization": "Bearer any"}).status_code == 503
    assert c.get("/health").json()["status"] == "degraded"
