"""Turns raw model output into the saved/returned analysis result (no ML imports).

Values are made safe before they are stored, because the app rejects results
it cannot trust: boxes are clamped to the image, degenerate boxes dropped, and
a bone age outside 0-300 months is reported as unavailable.
"""
DISCLAIMER = "AI-assisted finding. Decision support only, not a diagnosis."
BONE_AGE_MIN, BONE_AGE_MAX = 0.0, 300.0


def _clamp01(v):
    return min(1.0, max(0.0, float(v)))


def normalize_boxes(raw, width, height):
    """raw = [(confidence, x1, y1, x2, y2), ...] in pixels -> detections, top confidence."""
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
    """Rounded months, or None when the model output is missing or implausible."""
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
    if months is None:
        return None
    m = int(round(months))
    return f"{m // 12}y {m % 12}m"


def build_result(scan_id, raw_boxes, width, height, bone_age, patient_age_months):
    """Returns (row for analysis_results, API response)."""
    detections, top = normalize_boxes(raw_boxes, width, height)
    age = safe_bone_age(bone_age)
    payload = {
        "scan_id": scan_id,
        "fracture_detected": bool(detections),
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
