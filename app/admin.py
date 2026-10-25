"""Admin API, used by the admin website served at /admin.

Every route requires the Supabase access token of an account whose
public.profiles.role is 'admin'. The role is read and checked here, in code;
users get 403. The service-role client bypasses RLS, so these routes read
across all accounts; they never write.
"""
import os

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

MAX_ROWS = 5000
SCAN_STATUSES = ("uploaded", "analyzing", "completed", "failed")
SIGNED_URL_SECONDS = 600


def _rows(res):
    return list(getattr(res, "data", None) or [])


def _iso(value):
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def build_admin_router(supabase, verify_token, get_role):
    router = APIRouter(prefix="/admin/api", tags=["admin"])

    def require_admin(user=Depends(verify_token)):
        if get_role(user.id) != "admin":
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

    def profiles_by_id():
        rows = _rows(supabase.table("profiles").select("id, full_name, hospital, role").limit(MAX_ROWS).execute())
        return {p["id"]: p for p in rows}

    def emails_by_id():
        return {u.id: u.email for u in list_auth_users()}

    def patients_for(ids):
        ids = [i for i in set(ids) if i]
        if not ids:
            return {}
        rows = _rows(supabase.table("patients").select("id, patient_code, age_months, sex").in_("id", ids).execute())
        return {r["id"]: r for r in rows}

    def results_for(scan_ids):
        if not scan_ids:
            return {}
        rows = _rows(
            supabase.table("analysis_results")
            .select("scan_id, fracture_detected, confidence, bone_age_months")
            .in_("scan_id", scan_ids).execute()
        )
        return {r["scan_id"]: r for r in rows}

    @router.get("/me")
    def me(user=Depends(require_admin)):
        return {"email": user.email, "role": "admin"}

    @router.get("/users")
    def users(_=Depends(require_admin)):
        profiles = profiles_by_id()
        out = []
        for u in list_auth_users():
            p = profiles.get(u.id, {})
            meta = getattr(u, "user_metadata", None) or {}
            out.append({
                "id": u.id,
                "email": u.email,
                "full_name": p.get("full_name") or meta.get("full_name"),
                "organisation": p.get("hospital") or meta.get("hospital"),
                "role": p.get("role") or "user",
                "created_at": _iso(getattr(u, "created_at", None)),
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
        q = supabase.table("scans").select("id, user_id, patient_id, status, analysis_mode, created_at", count="exact")
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
            res_row = results.get(r["id"]) or {}
            items.append({
                **r,
                # A saved result means the analysis finished, whatever the status says.
                "status": "completed" if res_row else r["status"],
                "user_email": emails.get(r["user_id"]),
                "patient_code": p.get("patient_code"),
                "patient_age_months": p.get("age_months"),
                "patient_sex": p.get("sex"),
                "fracture_detected": res_row.get("fracture_detected"),
                "confidence": res_row.get("confidence"),
                "bone_age_months": res_row.get("bone_age_months"),
            })
        return {"scans": items, "total": getattr(res, "count", None) or len(items)}

    @router.get("/scans/{scan_id}")
    def scan_detail(scan_id: str, _=Depends(require_admin)):
        rows = _rows(supabase.table("scans").select("*").eq("id", scan_id).limit(1).execute())
        if not rows:
            raise HTTPException(404, "Scan not found")
        scan = rows[0]
        result = _rows(supabase.table("analysis_results").select("*").eq("scan_id", scan_id).limit(1).execute())
        if result:
            scan["status"] = "completed"
        image_url = None
        if scan.get("image_path"):
            try:
                signed = supabase.storage.from_("wrist-xrays").create_signed_url(scan["image_path"], SIGNED_URL_SECONDS)
                image_url = signed.get("signedURL") or signed.get("signedUrl")
            except Exception:
                image_url = None  # image missing (e.g. upload failed); show the rest
        return {
            "scan": scan,
            "patient": patients_for([scan.get("patient_id")]).get(scan.get("patient_id")),
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
