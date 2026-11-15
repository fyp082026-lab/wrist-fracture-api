"""Turns raw model output into the saved/returned analysis result (no ML imports).

Values are made safe before they are stored, because the app rejects results
it cannot trust: boxes are clamped to the image, degenerate boxes dropped, and
a bone age outside 0-300 months is reported as unavailable.

FLOW: main.py /analyze calls build_result() with the raw model output ->
  build_result() uses normalize_boxes(), safe_bone_age() and fmt_months() ->
  returns the database row and the API response back to /analyze.
admin.py also uses fmt_months() for the admin website.
"""
# Shown under every result in the app and the admin website.
DISCLAIMER = "AI-assisted finding. Decision support only, not a diagnosis."
BONE_AGE_MIN, BONE_AGE_MAX = 0.0, 300.0


def _clamp01(v):
    """Forces a number into 0..1. Used by normalize_boxes() for box corners and confidence."""
    return min(1.0, max(0.0, float(v)))


def normalize_boxes(raw, width, height):
    """raw = [(confidence, x1, y1, x2, y2), ...] in pixels -> detections, top confidence.

    Input: boxes from inference.detect_fractures() and the image size.
    Result goes to: build_result(). Boxes become fractions of the image (0..1) so
    the app can draw them at any screen size; sorted most confident first.
    """
    detections = []
    for conf, x1, y1, x2, y2 in raw:
        box = [_clamp01(x1 / width), _clamp01(y1 / height), _clamp01(x2 / width), _clamp01(y2 / height)]
        if box[2] <= box[0] or box[3] <= box[1]:
            continue  # zero-size box: nothing to draw
        detections.append({
            "label": "Fracture",
            "confidence": round(_clamp01(conf), 4),
            "box_normalized": [round(v, 6) for v in box],
        })
    detections.sort(key=lambda d: d["confidence"], reverse=True)
    top = detections[0]["confidence"] if detections else None
    return detections, top


def safe_bone_age(months):
    """Rounded months, or None when the model output is missing or implausible.

    Input: months from inference.predict_bone_age(). Result goes to: build_result().
    """
    if months is None:
        return None
    try:
        m = float(months)
    except (TypeError, ValueError):
        return None
    if m != m or m < BONE_AGE_MIN or m > BONE_AGE_MAX:  # NaN or out of range
        return None
    return round(m, 2)


def fmt_months(months):
    """Months -> text such as "7y 3m". Result goes to: build_result() (API response
    for the app) and admin.py (scan details for the admin website)."""
    if months is None:
        return None
    m = int(round(months))
    return f"{m // 12}y {m % 12}m"


# Which models run for each analysis mode. Read by main.py /analyze and build_result().
MODES = {
    "fracture": {"fracture": True, "bone_age": False},
    "bone_age": {"fracture": False, "bone_age": True},
    "both": {"fracture": True, "bone_age": True},
}


def build_result(scan_id, raw_boxes, width, height, bone_age, patient_age_months, mode="both"):
    """Returns (row for analysis_results, API response).

    raw_boxes is None when fracture detection was not run (mode "bone_age"):
    fracture_detected is then None, meaning "not checked", never "no fracture".

    Result goes to: main.py /analyze. `payload` is saved to the analysis_results
    table; `response` (payload + readable ages + status) is returned to the app.
    """
    ran_fracture = raw_boxes is not None
    detections, top = normalize_boxes(raw_boxes or [], width, height)
    age = safe_bone_age(bone_age) if MODES[mode]["bone_age"] else None
    payload = {
        "scan_id": scan_id,
        "analysis_mode": mode,
        "fracture_detected": bool(detections) if ran_fracture else None,
        "fracture_type": None,  # no fracture-typing model yet
        "confidence": top,
        "detections": detections,
        "bone_age_months": age,
        "grad_cam_path": None,
        "clinical_disclaimer": DISCLAIMER,
    }
    response = {
        **payload,
        "status": "completed",
        "bone_age_formatted": fmt_months(age),
        "chronological_age_formatted": fmt_months(patient_age_months),
    }
    return payload, response
