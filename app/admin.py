"""Admin monitoring API, used by the admin website served at /admin.

Every route requires a Supabase access token whose email is listed in the
ADMIN_EMAILS environment variable (comma separated). The service-role client
bypasses RLS, so these routes read across all users; they never write.
"""
import os
from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

SCAN_STATUSES = ("uploaded", "analyzing", "completed", "failed")
SIGNED_URL_SECONDS = 600
MAX_ROWS = 5000


def admin_emails():
    raw = os.environ.get("ADMIN_EMAILS", "")
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def _rows(res):
    return list(getattr(res, "data", None) or [])


def _iso(value):
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def _parse(value):
    """Timezone-aware datetime from a datetime or ISO string, or None."""
    if value is None:
        return None
    try:
        dt = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def build_admin_router(supabase, verify_token):
    router = APIRouter(prefix="/admin/api", tags=["admin"])

    def require_admin(user=Depends(verify_token)):
        email = (getattr(user, "email", None) or "").lower()
        if not email or email not in admin_emails():
            raise HTTPException(403, "This account is not an administrator")
        return user

    def list_auth_users():
        users, page = [], 1
        while True:
            batch = supabase.auth.admin.list_users(page=page, per_page=1000)
            batch = list(getattr(batch, "users", batch) or [])
            users.extend(batch)
            if len(batch) < 1000:
                return users
            page += 1

    def emails_by_id():
        return {u.id: u.email for u in list_auth_users()}

    def results_for(scan_ids):
        if not scan_ids:
            return {}
        res = (
            supabase.table("analysis_results")
            .select("scan_id, fracture_detected, confidence, bone_age_months, created_at")
            .in_("scan_id", scan_ids)
            .execute()
        )
        return {r["scan_id"]: r for r in _rows(res)}

    def patients_for(patient_ids):
        ids = [p for p in set(patient_ids) if p]
        if not ids:
            return {}
        res = (
            supabase.table("patients")
            .select("id, patient_code, age_months, sex")
            .in_("id", ids)
            .execute()
        )
        return {r["id"]: r for r in _rows(res)}

    @router.get("/me")
    def me(user=Depends(require_admin)):
        return {"email": user.email, "is_admin": True}

    @router.get("/overview")
    def overview(_=Depends(require_admin)):
        users = list_auth_users()
        scans = _rows(
            supabase.table("scans")
            .select("id, status, created_at")
            .order("created_at", desc=True)
            .limit(MAX_ROWS)
            .execute()
        )
        results = _rows(
            supabase.table("analysis_results").select("fracture_detected").limit(MAX_ROWS).execute()
        )
        patients = _rows(supabase.table("patients").select("id").limit(MAX_ROWS).execute())

        by_status = Counter(s.get("status") for s in scans)
        today = datetime.now(timezone.utc).date()
        days = [today - timedelta(days=i) for i in range(13, -1, -1)]
        per_day = Counter((s.get("created_at") or "")[:10] for s in scans)
        week_ago = datetime.now(timezone.utc) - timedelta(days=7)
        active = sum(1 for u in users if (_parse(getattr(u, "last_sign_in_at", None)) or week_ago) > week_ago)

        return {
            "users_total": len(users),
            "users_active_7d": active,
            "patients_total": len(patients),
            "scans_total": len(scans),
            "scans_by_status": {k: by_status.get(k, 0) for k in SCAN_STATUSES},
            "fractures_detected": sum(1 for r in results if r.get("fracture_detected")),
            "results_total": len(results),
            "scans_per_day": [{"date": d.isoformat(), "count": per_day.get(d.isoformat(), 0)} for d in days],
        }

    @router.get("/users")
    def users(_=Depends(require_admin)):
        auth_users = list_auth_users()
        profiles = {
            p["id"]: p
            for p in _rows(supabase.table("profiles").select("id, full_name, hospital").limit(MAX_ROWS).execute())
        }
        scans = _rows(supabase.table("scans").select("user_id, created_at").limit(MAX_ROWS).execute())
        count = Counter(s["user_id"] for s in scans)
        last_scan = {}
        for s in scans:
            uid, ts = s["user_id"], s.get("created_at") or ""
            if ts > last_scan.get(uid, ""):
                last_scan[uid] = ts

        out = []
        for u in auth_users:
            p = profiles.get(u.id, {})
            out.append({
                "id": u.id,
                "email": u.email,
                "full_name": p.get("full_name"),
                "hospital": p.get("hospital"),
                "created_at": _iso(getattr(u, "created_at", None)),
                "last_sign_in_at": _iso(getattr(u, "last_sign_in_at", None)),
                "email_confirmed": bool(getattr(u, "email_confirmed_at", None)),
                "is_admin": (u.email or "").lower() in admin_emails(),
                "scan_count": count.get(u.id, 0),
                "last_scan_at": last_scan.get(u.id),
            })
        out.sort(key=lambda r: r["created_at"] or "", reverse=True)
        return {"users": out}

    @router.get("/scans")
    def scans(
        _=Depends(require_admin),
        status: str | None = Query(None),
        user_id: str | None = Query(None),
        limit: int = Query(50, ge=1, le=200),
        offset: int = Query(0, ge=0),
    ):
        q = supabase.table("scans").select("id, user_id, patient_id, status, created_at", count="exact")
        if status:
            if status not in SCAN_STATUSES:
                raise HTTPException(400, "Unknown status")
            q = q.eq("status", status)
        if user_id:
            q = q.eq("user_id", user_id)
        res = q.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
        rows = _rows(res)

        emails = emails_by_id()
        patients = patients_for([r.get("patient_id") for r in rows])
        results = results_for([r["id"] for r in rows])
        items = []
        for r in rows:
            p = patients.get(r.get("patient_id"), {})
            res_row = results.get(r["id"])
            items.append({
                **r,
                "user_email": emails.get(r["user_id"]),
                "patient_code": p.get("patient_code"),
                "patient_age_months": p.get("age_months"),
                "patient_sex": p.get("sex"),
                "fracture_detected": res_row.get("fracture_detected") if res_row else None,
                "confidence": res_row.get("confidence") if res_row else None,
                "bone_age_months": res_row.get("bone_age_months") if res_row else None,
            })
        return {"scans": items, "total": getattr(res, "count", None) or len(items)}

    @router.get("/scans/{scan_id}")
    def scan_detail(scan_id: str, _=Depends(require_admin)):
        rows = _rows(supabase.table("scans").select("*").eq("id", scan_id).limit(1).execute())
        if not rows:
            raise HTTPException(404, "Scan not found")
        scan = rows[0]
        result = _rows(
            supabase.table("analysis_results").select("*").eq("scan_id", scan_id).limit(1).execute()
        )
        patient = patients_for([scan.get("patient_id")]).get(scan.get("patient_id"))
        image_url = None
        if scan.get("image_path"):
            try:
                signed = supabase.storage.from_("wrist-xrays").create_signed_url(
                    scan["image_path"], SIGNED_URL_SECONDS
                )
                image_url = signed.get("signedURL") or signed.get("signedUrl")
            except Exception:
                image_url = None  # image missing (e.g. upload failed); show the rest
        return {
            "scan": scan,
            "patient": patient,
            "result": result[0] if result else None,
            "user_email": emails_by_id().get(scan["user_id"]),
            "image_url": image_url,
        }

    return router


def mount_admin_site(app, site_dir):
    """Serves the built admin website at /admin. Call after include_router so
    /admin/api routes match before the static files."""

    @app.get("/admin", include_in_schema=False)
    def admin_root():
        return RedirectResponse("/admin/")

    if os.path.isdir(site_dir):
        app.mount("/admin", StaticFiles(directory=site_dir, html=True), name="admin-site")
