"""Admin API (user details and roles), used by the admin website served at /admin.

Every route requires the Supabase access token of an admin: a user in
public.admins (managed through public.admin_allowlist in Supabase), or an
email in the optional ADMIN_EMAILS override. Users without that role get 403.
The service-role client bypasses RLS, so these routes read across all
accounts; they never write.
"""
import os
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

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


def build_admin_router(supabase, verify_token):
    router = APIRouter(prefix="/admin/api", tags=["admin"])

    def admin_user_ids():
        """User ids in public.admins. Empty if the table is missing."""
        try:
            return {r["user_id"] for r in _rows(supabase.table("admins").select("user_id").execute())}
        except Exception:
            return set()

    def is_admin(user, db_admins=None):
        email = (getattr(user, "email", None) or "").lower()
        ids = admin_user_ids() if db_admins is None else db_admins
        return user.id in ids or (bool(email) and email in admin_emails())

    def require_admin(user=Depends(verify_token)):
        if not is_admin(user):
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

    def account_rows():
        auth_users = list_auth_users()
        db_admins = admin_user_ids()
        profiles = {
            p["id"]: p
            for p in _rows(supabase.table("profiles").select("id, full_name, hospital").limit(MAX_ROWS).execute())
        }
        out = []
        for u in auth_users:
            p = profiles.get(u.id, {})
            meta = getattr(u, "user_metadata", None) or {}
            out.append({
                "id": u.id,
                "email": u.email,
                "full_name": p.get("full_name") or meta.get("full_name"),
                "organisation": p.get("hospital") or meta.get("hospital"),
                "role": "admin" if is_admin(u, db_admins) else "user",
                "created_at": _iso(getattr(u, "created_at", None)),
            })
        out.sort(key=lambda r: r["created_at"] or "", reverse=True)
        return out

    @router.get("/me")
    def me(user=Depends(require_admin)):
        return {"email": user.email, "role": "admin"}

    @router.get("/users")
    def users(_=Depends(require_admin)):
        return {"users": account_rows()}

    return router


def mount_admin_site(app, site_dir):
    """Serves the built admin website at /admin. Call after include_router so
    /admin/api routes match before the static files."""

    @app.get("/admin", include_in_schema=False)
    def admin_root():
        return RedirectResponse("/admin/")

    if os.path.isdir(site_dir):
        app.mount("/admin", StaticFiles(directory=site_dir, html=True), name="admin-site")
