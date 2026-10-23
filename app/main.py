"""PediaFracture API - authentication and role-based access.

Users sign in to the mobile app with Supabase; admins sign in to the admin
website served at /admin. This API verifies Supabase access tokens and gives
admins read access to the user list. (The AI analysis endpoints live on the
backup/full-app branch.)
"""
import os

from fastapi import FastAPI, Header, HTTPException, Depends
from supabase import create_client

from app.supabase_check import SupabaseProbe, is_api_key_error

app = FastAPI(title="PediaFracture API")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

supabase_probe = SupabaseProbe(supabase)


def verify_token(authorization: str = Header(...)):
    """Returns the Supabase user for a valid `Authorization: Bearer <token>`."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Invalid auth header")
    try:
        res = supabase.auth.get_user(authorization.split(" ", 1)[1])
    except Exception as e:
        if is_api_key_error(e):
            # The server's own key is broken; the user's token is not the problem.
            supabase_probe.mark_key_error()
            raise HTTPException(503, "Server cannot verify sign-ins: Supabase service key rejected")
        raise HTTPException(401, "Invalid or expired token")
    if not res or not res.user:
        raise HTTPException(401, "Invalid or expired token")
    return res.user


@app.get("/health")
def health():
    supabase_error = supabase_probe.status()
    return {
        "status": "ready" if supabase_error is None else "degraded",
        "supabase": "ok" if supabase_error is None else "error",
        "supabase_error": supabase_error,
    }


@app.get("/me")
def me(user=Depends(verify_token)):
    """Who the token belongs to; used by the mobile app to confirm its session."""
    return {"id": user.id, "email": user.email}


# ---------------------------------------------------------------------------
# Admin: JSON API under /admin/api, website under /admin.
# ---------------------------------------------------------------------------
from app.admin import build_admin_router, mount_admin_site

app.include_router(build_admin_router(supabase, verify_token))
mount_admin_site(app, os.environ.get("ADMIN_SITE_DIR", "/srv/admin_site"))
