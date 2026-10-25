"""PediaFracture API: authentication, roles and AI analysis of wrist X-rays.

- Users sign in to the mobile app and send X-rays to POST /analyze.
- Admins sign in to the admin website (/admin) and read users and scans.
Roles live in public.profiles.role and are checked here, in code.
"""
import io
import os
import time

from fastapi import FastAPI, Header, HTTPException, Depends
from typing import Literal

from pydantic import BaseModel
from supabase import create_client

from app.supabase_check import SupabaseProbe, is_api_key_error
from app.results import MODES, build_result

app = FastAPI(title="PediaFracture API")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

supabase_probe = SupabaseProbe(supabase)

# The models need torch/ultralytics (installed in the Docker image only).
try:
    from app import inference
    inference_error = None
except Exception as e:  # tests and machines without the ML packages
    inference = None
    inference_error = f"{type(e).__name__}: {e}"
    print("AI models not loaded:", inference_error, flush=True)


# Smaller images (thumbnails, screenshots) lack the bone detail the models need.
MIN_SHORT_EDGE_PX = 512


class ImageTooSmall(Exception):
    def __init__(self, width, height):
        super().__init__(
            f"This image is only {width} x {height} px, too small for an accurate analysis "
            f"(at least {MIN_SHORT_EDGE_PX} px on the short side is needed). Use the original X-ray."
        )


class AnalyzeRequest(BaseModel):
    scan_id: str
    image_path: str
    patient_age_months: int = 84
    patient_sex: str = "M"
    # fracture = YOLOv8 only, bone_age = EfficientNet only, both = both models.
    # Older app versions do not send it and get both.
    analysis_mode: Literal["fracture", "bone_age", "both"] = "both"


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


def get_role(user_id):
    """The account's role from public.profiles ('user' when there is no row)."""
    rows = supabase.table("profiles").select("role").eq("id", user_id).limit(1).execute().data or []
    if not rows:
        return "user"
    return rows[0].get("role") or "user"


@app.get("/health")
def health():
    supabase_error = supabase_probe.status()
    models = inference.status() if inference else {"device": None, "bone_age_model": False, "bone_age_error": inference_error}
    ready = supabase_error is None and inference is not None
    return {
        "status": "ready" if ready else "degraded",
        "supabase": "ok" if supabase_error is None else "error",
        "supabase_error": supabase_error,
        "models": "ok" if inference is not None else "error",
        **models,
    }


@app.get("/me")
def me(user=Depends(verify_token)):
    """Who the token belongs to, and their role."""
    return {"id": user.id, "email": user.email, "role": get_role(user.id)}


@app.post("/analyze")
def analyze(req: AnalyzeRequest, user=Depends(verify_token)):
    # Role check in code: only users analyse X-rays; admins use the website.
    if get_role(user.id) != "user":
        raise HTTPException(403, "Only user accounts can analyse X-rays")
    if inference is None:
        raise HTTPException(503, "AI models are not available on this server")
    run = MODES[req.analysis_mode]
    if req.analysis_mode == "bone_age" and inference.bone_model is None:
        raise HTTPException(503, "The bone age model is not available on this server")
    # Ownership checks (the service role key bypasses RLS, so we must check ourselves)
    if not req.image_path.startswith(f"{user.id}/"):
        raise HTTPException(403, "Not your image")
    scan = (
        supabase.table("scans").select("id")
        .eq("id", req.scan_id).eq("user_id", user.id).execute()
    )
    if not scan.data:
        raise HTTPException(403, "Scan not found")

    started = time.monotonic()
    try:
        supabase.table("scans").update(
            {"status": "analyzing", "analysis_mode": req.analysis_mode}
        ).eq("id", req.scan_id).execute()

        from PIL import Image
        data = supabase.storage.from_("wrist-xrays").download(req.image_path)
        image = Image.open(io.BytesIO(data)).convert("RGB")
        w, h = image.size
        if min(w, h) < MIN_SHORT_EDGE_PX:
            raise ImageTooSmall(w, h)

        # Only the models the user chose are run.
        raw_boxes = inference.detect_fractures(image) if run["fracture"] else None
        bone_age = (
            inference.predict_bone_age(image, req.patient_sex)
            if run["bone_age"] and inference.bone_model is not None else None
        )

        payload, response = build_result(
            req.scan_id, raw_boxes, w, h, bone_age, req.patient_age_months, req.analysis_mode
        )
        # Also fill the table's original columns (user_id, fracture_confidence).
        row = {**payload, "user_id": user.id, "fracture_confidence": payload["confidence"]}
        supabase.table("analysis_results").upsert(row, on_conflict="scan_id").execute()
    except ImageTooSmall as e:
        # Same rule as the app (older app versions do not check): a clear 422, not a crash.
        supabase.table("scans").update({"status": "failed"}).eq("id", req.scan_id).execute()
        raise HTTPException(422, str(e))
    except Exception as e:
        print(f"/analyze failed for scan {req.scan_id} after {time.monotonic() - started:.1f}s: "
              f"{type(e).__name__}: {e}", flush=True)
        supabase.table("scans").update({"status": "failed"}).eq("id", req.scan_id).execute()
        raise HTTPException(500, str(e))

    # The result is saved: the analysis succeeded even if the status update fails
    # (the apps treat a scan with a saved result as completed).
    try:
        supabase.table("scans").update({"status": "completed"}).eq("id", req.scan_id).execute()
    except Exception as e:
        print(f"/analyze: result saved but status update failed for scan {req.scan_id}: "
              f"{type(e).__name__}: {e}", flush=True)
    print(f"/analyze ({req.analysis_mode}) ok for scan {req.scan_id} in {time.monotonic() - started:.1f}s", flush=True)
    return response


# ---------------------------------------------------------------------------
# Admin: JSON API under /admin/api, website under /admin.
# ---------------------------------------------------------------------------
from app.admin import build_admin_router, mount_admin_site

app.include_router(build_admin_router(supabase, verify_token, get_role))
mount_admin_site(app, os.environ.get("ADMIN_SITE_DIR", "/srv/admin_site"))
