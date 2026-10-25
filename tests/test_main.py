"""Smoke tests of the real app module with Supabase replaced (no network, no models)."""
import importlib
from types import SimpleNamespace

from fastapi.testclient import TestClient

PROFILES = {"u1": "user", "boss": "admin"}


class Q:
    def __init__(self, rows):
        self.rows = rows

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.rows = [r for r in self.rows if r.get(col) == val]
        return self

    def limit(self, _n):
        return self

    def execute(self):
        return SimpleNamespace(data=self.rows)


def load_app(monkeypatch, get_user):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_test")
    monkeypatch.setenv("ADMIN_SITE_DIR", "/nonexistent")
    import supabase as sb_mod
    fake = SimpleNamespace(
        auth=SimpleNamespace(get_user=get_user, admin=SimpleNamespace(list_users=lambda **_: [])),
        table=lambda name: Q([{"id": k, "role": v} for k, v in PROFILES.items()] if name == "profiles" else []),
    )
    monkeypatch.setattr(sb_mod, "create_client", lambda *_a, **_k: fake)
    import app.main as main
    return importlib.reload(main)


def tokens(tok):
    users = {"user-token": SimpleNamespace(id="u1", email="one@x.org"),
             "admin-token": SimpleNamespace(id="boss", email="boss@x.org"),
             "new-token": SimpleNamespace(id="new", email="new@x.org")}
    return SimpleNamespace(user=users[tok]) if tok in users else None


def test_health_reports_supabase_and_models(monkeypatch):
    c = TestClient(load_app(monkeypatch, tokens).app)
    h = c.get("/health").json()
    assert h["supabase"] == "ok"
    assert h["models"] == "error" and h["status"] == "degraded"  # torch is not installed in tests


def test_me_returns_role_from_profiles(monkeypatch):
    c = TestClient(load_app(monkeypatch, tokens).app)
    assert c.get("/me", headers={"Authorization": "Bearer user-token"}).json()["role"] == "user"
    assert c.get("/me", headers={"Authorization": "Bearer admin-token"}).json()["role"] == "admin"
    assert c.get("/me", headers={"Authorization": "Bearer new-token"}).json()["role"] == "user"  # no row yet
    assert c.get("/me", headers={"Authorization": "Bearer bad"}).status_code == 401


def test_analyze_is_for_users_only(monkeypatch):
    c = TestClient(load_app(monkeypatch, tokens).app)
    body = {"scan_id": "s1", "image_path": "u1/s1.jpg", "patient_age_months": 96, "patient_sex": "M"}
    assert c.post("/analyze", json=body, headers={"Authorization": "Bearer admin-token"}).status_code == 403
    # A user passes the role check; without the models the server answers 503, not a crash.
    assert c.post("/analyze", json=body, headers={"Authorization": "Bearer user-token"}).status_code == 503
    assert c.post("/analyze", json=body).status_code == 422


def test_rejected_server_key_is_503_not_401(monkeypatch):
    def boom(_tok):
        raise Exception("Unregistered API key")
    c = TestClient(load_app(monkeypatch, boom).app)
    assert c.get("/me", headers={"Authorization": "Bearer any"}).status_code == 503
    assert c.get("/health").json()["status"] == "degraded"


class Table(Q):
    """Q plus the writes /analyze makes; a status update can be made to fail."""

    def __init__(self, name, db):
        super().__init__(list(db.get(name, [])))
        self.name, self.db = name, db

    def update(self, values):
        if self.name == "scans" and values.get("status") in self.db["reject_status"]:
            raise Exception('new row violates check constraint "scans_status_check"')
        self.db["writes"].append((self.name, values))
        return self

    def upsert(self, row, **_k):
        self.db["writes"].append((self.name, row))
        return self


def fake_analysis_app(monkeypatch, reject_status=()):
    """App with a fake database, storage and models; returns (client, db, calls)."""
    import io
    from PIL import Image
    main = load_app(monkeypatch, tokens)
    db = {"profiles": [{"id": k, "role": v} for k, v in PROFILES.items()],
          "scans": [{"id": "s1", "user_id": "u1"}], "writes": [], "reject_status": set(reject_status)}
    calls = []
    png = io.BytesIO()
    Image.new("RGB", (100, 80)).save(png, "PNG")
    monkeypatch.setattr(main, "supabase", SimpleNamespace(
        auth=main.supabase.auth,
        table=lambda name: Table(name, db),
        storage=SimpleNamespace(from_=lambda _b: SimpleNamespace(download=lambda _p: png.getvalue())),
    ))
    monkeypatch.setattr(main, "inference", SimpleNamespace(
        detect_fractures=lambda _img: calls.append("yolo") or [(0.9, 10, 10, 50, 40)],
        predict_bone_age=lambda _img, _sex: calls.append("bone") or 97.4,
        bone_model=object()))
    return TestClient(main.app), db, calls


def analyze(c, mode=None):
    body = {"scan_id": "s1", "image_path": "u1/s1.jpg", "patient_age_months": 96, "patient_sex": "M"}
    if mode:
        body["analysis_mode"] = mode
    return c.post("/analyze", json=body, headers={"Authorization": "Bearer user-token"})


def test_each_mode_runs_only_its_models(monkeypatch):
    for mode, expected in [("fracture", ["yolo"]), ("bone_age", ["bone"]), ("both", ["yolo", "bone"]), (None, ["yolo", "bone"])]:
        c, db, calls = fake_analysis_app(monkeypatch)
        r = analyze(c, mode)
        assert r.status_code == 200, (mode, r.text)
        assert calls == expected, mode
        body = r.json()
        assert body["analysis_mode"] == (mode or "both")
        assert (body["fracture_detected"] is None) == (mode == "bone_age")
        assert (body["bone_age_months"] is None) == (mode == "fracture")
        assert ("scans", {"status": "analyzing", "analysis_mode": mode or "both"}) in db["writes"]


def test_unknown_mode_is_rejected(monkeypatch):
    c, _, calls = fake_analysis_app(monkeypatch)
    assert analyze(c, "fusion").status_code == 422 and calls == []


def test_saved_result_is_returned_even_if_status_update_fails(monkeypatch):
    """The original bug: the result was stored, then marking the scan completed
    was rejected by the database, and the user was told the analysis failed."""
    c, db, _ = fake_analysis_app(monkeypatch, reject_status={"completed"})
    r = analyze(c)
    assert r.status_code == 200 and r.json()["fracture_detected"] is True
    assert any(t == "analysis_results" for t, _ in db["writes"])
    assert ("scans", {"status": "failed"}) not in db["writes"]
