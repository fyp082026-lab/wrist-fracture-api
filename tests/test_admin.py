"""Admin API tests with an in-memory fake of the Supabase client (no network)."""
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient

from app.admin import build_admin_router, mount_admin_site

U1, U2, ADMIN = "u1", "u2", "admin"
TABLES = {
    "profiles": [
        {"id": U1, "full_name": "User One", "hospital": "City Clinic", "role": "user"},
        {"id": ADMIN, "full_name": "Boss", "hospital": None, "role": "admin"},
    ],
    "patients": [{"id": "p1", "patient_code": "P-1", "age_months": 96, "sex": "M"}],
    "scans": [
        {"id": "s1", "user_id": U1, "patient_id": "p1", "status": "completed", "image_path": "u1/s1.jpg", "created_at": "2026-10-25T10:00:00+00:00"},
        {"id": "s2", "user_id": U1, "patient_id": "p1", "status": "failed", "image_path": "u1/s2.jpg", "created_at": "2026-10-24T10:00:00+00:00"},
    ],
    "analysis_results": [
        {"scan_id": "s1", "fracture_detected": True, "confidence": 0.9, "bone_age_months": 100.0,
         "detections": [{"label": "Fracture", "confidence": 0.9, "box_normalized": [0.1, 0.1, 0.2, 0.2]}]},
    ],
}


class Query:
    def __init__(self, rows):
        self.rows, self.count = list(rows), None

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.rows = [r for r in self.rows if r.get(col) == val]
        return self

    def in_(self, col, vals):
        self.rows = [r for r in self.rows if r.get(col) in vals]
        return self

    def order(self, col, desc=False):
        self.rows.sort(key=lambda r: r.get(col) or "", reverse=desc)
        return self

    def limit(self, n):
        self.rows = self.rows[:n]
        return self

    def range(self, a, b):
        self.count = len(self.rows)
        self.rows = self.rows[a:b + 1]
        return self

    def execute(self):
        return SimpleNamespace(data=self.rows, count=self.count)


def user(uid, email, meta=None):
    return SimpleNamespace(id=uid, email=email, user_metadata=meta or {}, created_at="2026-10-01T00:00:00Z")


class FakeSupabase:
    def __init__(self):
        self.auth = SimpleNamespace(admin=SimpleNamespace(list_users=lambda page=1, per_page=50: [
            user(U1, "one@x.org"), user(U2, "two@x.org", meta={"full_name": "Two From Metadata"}), user(ADMIN, "boss@x.org"),
        ] if page == 1 else []))
        self.storage = SimpleNamespace(from_=lambda _b: SimpleNamespace(
            create_signed_url=lambda path, _s: {"signedURL": f"https://signed/{path}"}))

    def table(self, name):
        return Query(TABLES[name])


TOKENS = {"admin-token": user(ADMIN, "boss@x.org"), "user-token": user(U1, "one@x.org")}


def verify_token(authorization: str = Header(...)):
    u = TOKENS.get(authorization.removeprefix("Bearer "))
    if not u:
        raise HTTPException(401, "Invalid or expired token")
    return u


def get_role(user_id):
    """Same rule as app.main.get_role: the profiles.role column, default 'user'."""
    rows = [p for p in TABLES["profiles"] if p["id"] == user_id]
    return (rows[0].get("role") or "user") if rows else "user"


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(build_admin_router(FakeSupabase(), verify_token, get_role))
    return TestClient(app)


ADMIN_H = {"Authorization": "Bearer admin-token"}
USER_H = {"Authorization": "Bearer user-token"}


def test_missing_and_bad_tokens_are_rejected(client):
    assert client.get("/admin/api/me").status_code == 422
    assert client.get("/admin/api/me", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_role_decides_access(client):
    for path in ("/admin/api/me", "/admin/api/users", "/admin/api/scans", "/admin/api/scans/s1"):
        assert client.get(path, headers=USER_H).status_code == 403
    r = client.get("/admin/api/me", headers=ADMIN_H)
    assert r.status_code == 200 and r.json()["role"] == "admin"


def test_role_change_takes_effect_immediately(client):
    TABLES["profiles"][0]["role"] = "admin"
    try:
        assert client.get("/admin/api/me", headers=USER_H).status_code == 200
    finally:
        TABLES["profiles"][0]["role"] = "user"
    assert client.get("/admin/api/me", headers=USER_H).status_code == 403


def test_users_come_from_one_table_with_roles(client):
    rows = {u["id"]: u for u in client.get("/admin/api/users", headers=ADMIN_H).json()["users"]}
    assert rows[ADMIN]["role"] == "admin"
    assert rows[U1]["role"] == "user" and rows[U1]["organisation"] == "City Clinic"
    assert rows[U2]["role"] == "user"  # no profile row yet: default user
    assert rows[U2]["full_name"] == "Two From Metadata"
    assert set(rows[U1]) == {"id", "email", "full_name", "organisation", "role", "created_at"}


def test_scans_list_filters_and_joins(client):
    d = client.get("/admin/api/scans?status=completed", headers=ADMIN_H).json()
    assert d["total"] == 1
    s = d["scans"][0]
    assert s["user_email"] == "one@x.org" and s["patient_code"] == "P-1" and s["fracture_detected"] is True
    assert client.get("/admin/api/scans?status=bogus", headers=ADMIN_H).status_code == 400


def test_scan_detail_has_signed_image_and_404(client):
    d = client.get("/admin/api/scans/s1", headers=ADMIN_H).json()
    assert d["image_url"] == "https://signed/u1/s1.jpg"
    assert d["result"]["detections"][0]["label"] == "Fracture"
    assert client.get("/admin/api/scans/missing", headers=ADMIN_H).status_code == 404


def test_site_is_served_and_api_still_wins(tmp_path):
    (tmp_path / "index.html").write_text("<h1>admin</h1>")
    app = FastAPI()
    app.include_router(build_admin_router(FakeSupabase(), verify_token, get_role))
    mount_admin_site(app, str(tmp_path))
    c = TestClient(app)
    r = c.get("/admin", follow_redirects=False)
    assert r.status_code in (301, 302, 307) and r.headers["location"] == "/admin/"
    assert "admin" in c.get("/admin/").text
    assert c.get("/admin/api/me", headers=ADMIN_H).json()["role"] == "admin"
