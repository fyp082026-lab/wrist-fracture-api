"""Admin API tests with an in-memory fake of the Supabase client (no network, no models)."""
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient

from app.admin import build_admin_router

U1, U2, ADMIN = "u1", "u2", "admin"
TABLES = {
    "profiles": [
        {"id": U1, "full_name": "Dr One", "hospital": "City"},
        {"id": ADMIN, "full_name": "Admin", "hospital": None},
    ],
    "patients": [{"id": "p1", "user_id": U1, "patient_code": "P-1", "age_months": 96, "sex": "M"}],
    "scans": [
        {"id": "s1", "user_id": U1, "patient_id": "p1", "status": "completed", "image_path": "u1/s1.jpg", "created_at": "2026-10-17T10:00:00+00:00"},
        {"id": "s2", "user_id": U1, "patient_id": "p1", "status": "failed", "image_path": "u1/s2.jpg", "created_at": "2026-10-16T10:00:00+00:00"},
        {"id": "s3", "user_id": U2, "patient_id": None, "status": "uploaded", "image_path": "u2/s3.jpg", "created_at": "2026-10-15T10:00:00+00:00"},
    ],
    "analysis_results": [
        {"scan_id": "s1", "fracture_detected": True, "confidence": 0.9, "bone_age_months": 100.0,
         "detections": [{"label": "Fracture", "confidence": 0.9, "box_normalized": [0.1, 0.1, 0.2, 0.2]}],
         "clinical_disclaimer": "AI-assisted finding.", "created_at": "2026-10-17T10:01:00+00:00"},
    ],
}


class Query:
    def __init__(self, rows):
        self.rows, self.count = list(rows), None

    def select(self, *_a, count=None):
        self.want_count = count
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


def user(uid, email, confirmed=True):
    return SimpleNamespace(id=uid, email=email, created_at="2026-10-01T00:00:00Z",
                           last_sign_in_at="2026-10-17T09:00:00Z" if confirmed else None,
                           email_confirmed_at="2026-10-01T00:00:00Z" if confirmed else None)


class FakeSupabase:
    def __init__(self):
        self.auth = SimpleNamespace(admin=SimpleNamespace(list_users=lambda page=1, per_page=50: [
            user(U1, "one@x.org"), user(U2, "two@x.org", confirmed=False), user(ADMIN, "boss@x.org")
        ] if page == 1 else []))
        self.storage = SimpleNamespace(from_=lambda _b: SimpleNamespace(
            create_signed_url=lambda path, _s: {"signedURL": f"https://signed/{path}"}))

    def table(self, name):
        return Query(TABLES[name])


TOKENS = {"admin-token": user(ADMIN, "Boss@x.org"), "user-token": user(U1, "one@x.org")}


def verify_token(authorization: str = Header(...)):
    u = TOKENS.get(authorization.removeprefix("Bearer "))
    if not u:
        raise HTTPException(401, "Invalid or expired token")
    return u


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "boss@x.org, other@x.org")
    app = FastAPI()
    app.include_router(build_admin_router(FakeSupabase(), verify_token))
    return TestClient(app)


ADMIN_H = {"Authorization": "Bearer admin-token"}


def test_rejects_missing_bad_and_non_admin_tokens(client):
    assert client.get("/admin/api/me").status_code == 422
    assert client.get("/admin/api/me", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.get("/admin/api/overview", headers={"Authorization": "Bearer user-token"}).status_code == 403


def test_me_is_case_insensitive(client):
    r = client.get("/admin/api/me", headers=ADMIN_H)
    assert r.status_code == 200 and r.json()["is_admin"] is True


def test_overview_counts(client):
    d = client.get("/admin/api/overview", headers=ADMIN_H).json()
    assert d["users_total"] == 3
    assert d["scans_total"] == 3
    assert d["scans_by_status"] == {"uploaded": 1, "analyzing": 0, "completed": 1, "failed": 1}
    assert d["fractures_detected"] == 1
    assert len(d["scans_per_day"]) == 14


def test_users_join_profiles_and_scan_counts(client):
    users = {u["id"]: u for u in client.get("/admin/api/users", headers=ADMIN_H).json()["users"]}
    assert users[U1]["scan_count"] == 2 and users[U1]["hospital"] == "City"
    assert users[U2]["email_confirmed"] is False
    assert users[ADMIN]["is_admin"] is True


def test_scans_filter_and_join(client):
    d = client.get("/admin/api/scans?status=completed", headers=ADMIN_H).json()
    assert d["total"] == 1
    s = d["scans"][0]
    assert s["user_email"] == "one@x.org" and s["patient_code"] == "P-1" and s["fracture_detected"] is True
    assert client.get("/admin/api/scans?status=bogus", headers=ADMIN_H).status_code == 400
    assert client.get(f"/admin/api/scans?user_id={U2}", headers=ADMIN_H).json()["total"] == 1


def test_scan_detail_has_signed_image_and_404(client):
    d = client.get("/admin/api/scans/s1", headers=ADMIN_H).json()
    assert d["image_url"] == "https://signed/u1/s1.jpg"
    assert d["result"]["detections"][0]["label"] == "Fracture"
    assert client.get("/admin/api/scans/missing", headers=ADMIN_H).status_code == 404


def test_site_is_served_and_api_still_wins(tmp_path, monkeypatch):
    from app.admin import mount_admin_site

    monkeypatch.setenv("ADMIN_EMAILS", "boss@x.org")
    (tmp_path / "index.html").write_text("<h1>admin</h1>")
    app = FastAPI()
    app.include_router(build_admin_router(FakeSupabase(), verify_token))
    mount_admin_site(app, str(tmp_path))
    c = TestClient(app)
    r = c.get("/admin", follow_redirects=False)
    assert r.status_code in (301, 302, 307) and r.headers["location"] == "/admin/"
    assert "admin" in c.get("/admin/").text
    assert c.get("/admin/api/me", headers=ADMIN_H).json()["is_admin"] is True
    assert c.get("/admin/api/me").status_code == 422


def test_admin_from_database_table_is_allowed(monkeypatch):
    monkeypatch.setenv("ADMIN_EMAILS", "")
    TABLES["admins"] = [{"user_id": ADMIN}]
    try:
        app = FastAPI()
        app.include_router(build_admin_router(FakeSupabase(), verify_token))
        c = TestClient(app)
        assert c.get("/admin/api/me", headers=ADMIN_H).status_code == 200
        assert c.get("/admin/api/me", headers={"Authorization": "Bearer user-token"}).status_code == 403
        users = {u["id"]: u for u in c.get("/admin/api/users", headers=ADMIN_H).json()["users"]}
        assert users[ADMIN]["is_admin"] is True and users[U1]["is_admin"] is False
    finally:
        del TABLES["admins"]
