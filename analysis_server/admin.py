"""Admin API, used by the admin website served at /admin.

Every route requires the Supabase access token of an account whose
public.profiles.role is 'admin'. The role is read and checked here, in code;
users get 403. The service-role client bypasses RLS, so these routes read
across all accounts; they never write.

FLOW: admin website (admin_website/src/api.ts) -> GET /admin/api/... ->
  require_admin() -> read Supabase tables -> JSON back to the website's pages
  (Users, Scans, AI model pages and the scan detail drawer).
main.py builds this router and passes in its supabase client, verify_token and get_role.
"""
import os

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

MAX_ROWS = 5000
SCAN_STATUSES = ("uploaded", "analyzing", "completed", "failed")
SIGNED_URL_SECONDS = 600
# Which analysis modes run each model (a "both" scan counts for both models).
MODEL_MODES = {"fracture": ["fracture", "both"], "bone_age": ["bone_age", "both"]}
# Fracture findings below this are labelled "lower confidence" (same as the apps).
LOW_CONFIDENCE_THRESHOLD = 0.65


def _rows(res):
    """The rows of a Supabase answer as a plain list (empty when there are none).
    Used by every query in this file."""
    return list(getattr(res, "data", None) or [])


def _iso(value):
    """A date as ISO text so it can be sent as JSON. Used by the /users route."""
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def build_admin_router(supabase, verify_token, get_role):
    """Creates all /admin/api routes. Called once by main.py, which adds the
    returned router to the server with app.include_router()."""
    router = APIRouter(prefix="/admin/api", tags=["admin"])

    def require_admin(user=Depends(verify_token)):
        # Gate used by every route below: lets admins through (returns the user to
        # the route), answers 403 to everyone else.
        if get_role(user.id) != "admin":
            raise HTTPException(403, "This account is not an administrator")
        return user

    def list_auth_users():
        # Every sign-in account from Supabase Auth, read page by page.
        # Result goes to: emails_by_id() and the /users route.
        users, page = [], 1
        while True:
            batch = supabase.auth.admin.list_users(page=page, per_page=1000)
            batch = list(getattr(batch, "users", batch) or [])
            users.extend(batch)
            if len(batch) < 1000:
                return users
            page += 1

    def profiles_by_id():
        # Profile rows (name, organisation, role) keyed by user id. Result goes to: /users.
        rows = _rows(supabase.table("profiles").select("id, full_name, hospital, role").limit(MAX_ROWS).execute())
        return {p["id"]: p for p in rows}

    def emails_by_id():
        # user id -> email for every account. Result goes to: /scans (shows who made each scan).
        return {u.id: u.email for u in list_auth_users()}

    def email_of(user_id):
        # Email of ONE account, without reading the whole account list.
        # Result goes to: /scans/{id} (shows who made the scan).
        try:
            found = supabase.auth.admin.get_user_by_id(user_id)
            return getattr(getattr(found, "user", found), "email", None)
        except Exception:
            return None  # account deleted or lookup failed; show the rest

    def patients_for(ids):
        # Patient rows for the given ids, keyed by id.
        # Result goes to: /scans, /models/{model}/stats and /scans/{id}.
        ids = [i for i in set(ids) if i]
        if not ids:
            return {}
        rows = _rows(supabase.table("patients").select("id, patient_code, age_months, sex").in_("id", ids).execute())
        return {r["id"]: r for r in rows}

    def results_for(scan_ids):
        # Saved AI results for the given scans, keyed by scan id.
        # Result goes to: /scans and /models/{model}/stats.
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
        # Confirms the caller is an admin. Result goes to: the website's App.tsx,
        # which opens the dashboard on 200 and signs the account out on 403.
        return {"email": user.email, "role": "admin"}

    @router.get("/users")
    def users(_=Depends(require_admin)):
        # Every account with name, organisation and role, newest first.
        # Result goes to: the website's Users page (dashboard_pages/Users.tsx).
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
        model: str | None = Query(None),
        limit: int = Query(50, ge=1, le=200),
        offset: int = Query(0, ge=0),
    ):
        # One page of scans, filtered by status / user / AI model, each joined with its
        # patient, owner email and result. Result goes to: the website's Scans page
        # (dashboard_pages/Scans.tsx).
        q = supabase.table("scans").select("id, user_id, patient_id, status, analysis_mode, created_at", count="exact")
        if status:
            if status not in SCAN_STATUSES:
                raise HTTPException(400, "Unknown status")
            q = q.eq("status", status)
        if user_id:
            q = q.eq("user_id", user_id)
        if model:
            if model not in MODEL_MODES:
                raise HTTPException(400, "Unknown model")
            q = q.in_("analysis_mode", MODEL_MODES[model])
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

    @router.get("/models/{model}/stats")
    def model_stats(model: str, _=Depends(require_admin)):
        """Live numbers for one AI model, from every scan that ran it.

        Result goes to: the website's AI model page (dashboard_pages/AiModel.tsx),
        which draws the counters and charts from these numbers.
        """
        if model not in MODEL_MODES:
            raise HTTPException(404, "Unknown model")
        rows = _rows(
            supabase.table("scans").select("id, patient_id, status")
            .in_("analysis_mode", MODEL_MODES[model]).limit(MAX_ROWS).execute()
        )
        # Numbers shared by both models: how many scans, finished, failed, still running.
        counts = {s: sum(1 for r in rows if r.get("status") == s) for s in SCAN_STATUSES}
        results = results_for([r["id"] for r in rows])
        stats = {
            "model": model,
            "scans": len(rows),
            "completed": len(results),  # a saved result means the analysis finished
            "failed": counts["failed"],
            "in_progress": counts["uploaded"] + counts["analyzing"],
        }
        if model == "fracture":
            # Fracture model: how many findings, their average confidence and a
            # 10-bar histogram of confidences.
            done = [r for r in results.values() if r.get("fracture_detected") is not None]
            positive = [r for r in done if r["fracture_detected"]]
            confs = [float(r["confidence"]) for r in positive if r.get("confidence") is not None]
            bins = [0] * 10
            for c in confs:
                bins[min(9, int(c * 10))] += 1
            stats.update({
                "fracture_suggested": len(positive),
                "no_fracture": len(done) - len(positive),
                "lower_confidence": sum(1 for c in confs if c < LOW_CONFIDENCE_THRESHOLD),
                "low_confidence_threshold": LOW_CONFIDENCE_THRESHOLD,
                "mean_confidence": round(sum(confs) / len(confs), 4) if confs else None,
                "confidence_bins": bins,  # top confidence of each finding, in 10% steps
            })
        else:
            # Bone age model: estimated age next to the age the user entered, and the gap between them.
            patients = patients_for([r.get("patient_id") for r in rows])
            points = []
            for r in rows:
                res = results.get(r["id"]) or {}
                age = (patients.get(r.get("patient_id")) or {}).get("age_months")
                if res.get("bone_age_months") is not None and age is not None:
                    points.append({"actual_months": float(age), "bone_age_months": float(res["bone_age_months"])})
            gaps = [p["bone_age_months"] - p["actual_months"] for p in points]
            stats.update({
                "with_estimate": len(points),
                # Gap to the age the user entered. Not an error: bone age can
                # truly differ from age, but large gaps deserve a second look.
                "mean_abs_gap_months": round(sum(abs(g) for g in gaps) / len(gaps), 2) if gaps else None,
                "mean_gap_months": round(sum(gaps) / len(gaps), 2) if gaps else None,
                "within_12_months": sum(1 for g in gaps if abs(g) <= 12),
                "points": points[:500],
            })
        return stats

    @router.get("/scans/{scan_id}")
    def scan_detail(scan_id: str, _=Depends(require_admin)):
        # Everything about one scan: the scan row, patient, saved result, owner email and
        # a 10-minute link to the X-ray image. Result goes to: the website's scan drawer
        # (dashboard_components/ScanDrawer.tsx).
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
            "user_email": email_of(scan["user_id"]),
            "image_url": image_url,
        }

    return router


class AdminSiteFiles(StaticFiles):
    """Static files with cache rules that make every deploy visible at once.

    The page (index.html) is revalidated on every visit, so browsers always
    load the current version. The bundles in assets/ have a content hash in
    their name, so a new deploy gets new names and they can be cached forever.
    """

    async def get_response(self, path, scope):
        # Adds the cache header to each file before it is sent to the admin's browser.
        response = await super().get_response(path, scope)
        if path.replace("\\", "/").startswith("assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif response.media_type == "text/html":
            response.headers["Cache-Control"] = "no-cache"
        return response


def mount_admin_site(app, site_dir):
    """Serves the built admin website at /admin. Call after include_router so
    /admin/api routes match before the static files.

    Called by main.py. site_dir is the built website copied in by the Dockerfile
    (/srv/admin_site); its files go straight to the admin's browser."""

    @app.get("/admin", include_in_schema=False)
    def admin_root():
        return RedirectResponse("/admin/")

    if os.path.isdir(site_dir):
        app.mount("/admin", AdminSiteFiles(directory=site_dir, html=True), name="admin-site")
