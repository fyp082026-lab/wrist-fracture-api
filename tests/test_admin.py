"""Admin API tests with an in-memory fake of the Supabase client (no network)."""
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient

from app.admin import build_admin_router, mount_admin_site

U1, U2, ADMIN = "u1", "u2", "admin"
TABLES = {
    "profiles": [
        {"id": U1, "full_name": "User One", "hospital": "City Clinic"},
    ],
    "admins": [{"user_id": ADMIN}],
}


class Query:
    def __init__(self, rows):
        self.rows = list(rows)

    def select(self, *_a, **_k):
        return self

    def limit(self, n):
        self.rows = self.rows[:n]
        return self

    def execute(self):
        return SimpleNamespace(data=self.rows)


def user(uid, email, confirmed=True, signed_in=True, meta=None):
    return SimpleNamespace(
        id=uid, email=email, user_metadata=meta or {},
        created_at="2026-10-01T00:00:00Z",
        last_sign_in_at="2099-01-01T00:00:00Z" if signed_in else None,
        email_confirmed_at="2026-10-01T00:00:00Z" if confirmed else None,
    )


class FakeSupabase:
    def __init__(self):
        self.auth = SimpleNamespace(admin=SimpleNamespace(list_users=lambda page=1, per_page=50: [
            user(U1, "one@x.org"),
            user(U2, "two@x.org", confirmed=False, signed_in=False, meta={"full_name": "Two From Metadata"}),
            user(ADMIN, "boss@x.org"),
        ] if page == 1 else []))

    def table(self, name):
        if name not in TABLES:
            raise RuntimeError(f"relation {name} does not exist")
        return Query(TABLES[name])


TOKENS = {"admin-token": user(ADMIN, "Boss@x.org"), "user-token": user(U1, "one@x.org")}


def verify_token(authorization: str = Header(...)):
    u = TOKENS.get(authorization.removeprefix("Bearer "))
    if not u:
        raise HTTPException(401, "Invalid or expired token")
    return u


def make_client():
    app = FastAPI()
    app.include_router(build_admin_router(FakeSupabase(), verify_token))
    return TestClient(app)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "")
    return make_client()


ADMIN_H = {"Authorization": "Bearer admin-token"}
USER_H = {"Authorization": "Bearer user-token"}


def test_missing_and_bad_tokens_are_rejected(client):
    assert client.get("/admin/api/me").status_code == 422
    assert client.get("/admin/api/me", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_role_based_access(client):
    # A normal user is authenticated but not allowed into any admin route.
    for path in ("/admin/api/me", "/admin/api/overview", "/admin/api/users"):
        assert client.get(path, headers=USER_H).status_code == 403
    r = client.get("/admin/api/me", headers=ADMIN_H)
    assert r.status_code == 200 and r.json()["role"] == "admin"


def test_env_override_grants_admin(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "one@x.org")
    assert make_client().get("/admin/api/me", headers=USER_H).status_code == 200


def test_overview_counts_users_and_admins_separately(client):
    d = client.get("/admin/api/overview", headers=ADMIN_H).json()
    assert d["users_total"] == 2
    assert d["users_verified"] == 1 and d["users_unverified"] == 1
    assert d["users_active_7d"] == 1
    assert d["admins_total"] == 1
    assert len(d["signups_per_day"]) == 14


def test_users_have_roles_and_profile_details(client):
    rows = {u["id"]: u for u in client.get("/admin/api/users", headers=ADMIN_H).json()["users"]}
    assert rows[ADMIN]["role"] == "admin"
    assert rows[U1]["role"] == "user" and rows[U1]["organisation"] == "City Clinic"
    assert rows[U2]["full_name"] == "Two From Metadata"  # falls back to sign-up metadata
    assert rows[U2]["email_confirmed"] is False


def test_missing_admins_table_means_no_db_admins(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "")
    saved = TABLES.pop("admins")
    try:
        assert make_client().get("/admin/api/me", headers=ADMIN_H).status_code == 403
    finally:
        TABLES["admins"] = saved


def test_site_is_served_and_api_still_wins(tmp_path, monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "")
    (tmp_path / "index.html").write_text("<h1>admin</h1>")
    app = FastAPI()
    app.include_router(build_admin_router(FakeSupabase(), verify_token))
    mount_admin_site(app, str(tmp_path))
    c = TestClient(app)
    r = c.get("/admin", follow_redirects=False)
    assert r.status_code in (301, 302, 307) and r.headers["location"] == "/admin/"
    assert "admin" in c.get("/admin/").text
    assert c.get("/admin/api/me", headers=ADMIN_H).json()["role"] == "admin"
