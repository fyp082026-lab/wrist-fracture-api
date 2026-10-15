import os, io
import numpy as np
import cv2
import torch
import torch.nn as nn
import timm
from PIL import Image
from fastapi import FastAPI, Header, HTTPException, Depends
from pydantic import BaseModel
from supabase import create_client
from ultralytics import YOLO

app = FastAPI(title="Wrist Fracture AI Inference")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

DISCLAIMER = "AI-assisted finding. Decision support only, not a diagnosis."
device = "cuda" if torch.cuda.is_available() else "cpu"

YOLO_PATH = "models/yolov8m_wrist_best.pt"
BONE_PATH = "models/bone_age_best.pt"

# ---------------------------------------------------------------------------
# YOLOv8m detector. Classes in this model:
# 0 boneanomaly, 1 bonelesion, 2 foreignbody, 3 fracture, 4 metal,
# 5 periostealreaction, 6 pronatorsign, 7 softtissue, 8 text
# Only the "fracture" class counts as a fracture finding.
# ---------------------------------------------------------------------------
yolo_model = YOLO(YOLO_PATH)
FRACTURE_LABEL = "fracture"

# ---------------------------------------------------------------------------
# Bone age model (EfficientNet-B3, 1 channel, 384 px, sex as a second input).
# Settings come from bone_age_config.json in your Kaggle results.
# ---------------------------------------------------------------------------
IMG = 384
Y_MEAN = 127.1987533569336
Y_STD = 41.25189971923828
SEX_CODE = {"M": 1.0, "F": 0.0}


class BoneAgeNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.backbone = timm.create_model(
            "efficientnet_b3", pretrained=False, num_classes=0, in_chans=1
        )
        self.sex = nn.Sequential(nn.Linear(1, 32), nn.ReLU())
        self.head = nn.Sequential(
            nn.Linear(1536 + 32, 256), nn.ReLU(), nn.Dropout(0.2), nn.Linear(256, 1)
        )

    def forward(self, x, sex):
        f = self.backbone(x)
        s = self.sex(sex)
        return self.head(torch.cat([f, s], dim=1)).squeeze(1)


bone_model = None
bone_error = None
try:
    if os.path.exists(BONE_PATH):
        bone_model = BoneAgeNet()
        state = torch.load(BONE_PATH, map_location="cpu", weights_only=True)
        bone_model.load_state_dict(state, strict=True)
        bone_model.eval().to(device)
    else:
        bone_error = f"{BONE_PATH} not found"
except Exception as e:  # keep the API up even if the bone age model fails to load
    bone_model = None
    bone_error = str(e)
    print("Bone age model failed to load:", e)


def preprocess_xray(gray):
    """Same preprocessing used in training (percentile clip + letterbox to 384)."""
    g = gray.astype(np.float32)
    lo, hi = np.percentile(g, 1), np.percentile(g, 99)
    g = np.clip((g - lo) / max(hi - lo, 1e-6), 0, 1)
    g = (g * 255).astype(np.uint8)
    h, w = g.shape
    s = IMG / max(h, w)
    g = cv2.resize(
        g, (max(1, int(round(w * s))), max(1, int(round(h * s)))),
        interpolation=cv2.INTER_AREA,
    )
    out = np.zeros((IMG, IMG), np.uint8)
    y0 = (IMG - g.shape[0]) // 2
    x0 = (IMG - g.shape[1]) // 2
    out[y0:y0 + g.shape[0], x0:x0 + g.shape[1]] = g
    return out


def predict_bone_age(image, sex):
    gray = np.array(image.convert("L"))
    x = preprocess_xray(gray).astype(np.float32) / 255.0
    x = (x - 0.5) / 0.5
    x = torch.from_numpy(x)[None, None].to(device)
    s = torch.tensor([[SEX_CODE.get(sex.upper(), 1.0)]], dtype=torch.float32, device=device)
    with torch.inference_mode():
        z = float(bone_model(x, s).item())
    return z * Y_STD + Y_MEAN


def fmt(months):
    if months is None:
        return None
    m = int(round(months))
    return f"{m // 12}y {m % 12}m"


class AnalyzeRequest(BaseModel):
    scan_id: str
    image_path: str
    patient_age_months: int = 84
    patient_sex: str = "M"


def verify_token(authorization: str = Header(...)):
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Invalid auth header")
    try:
        res = supabase.auth.get_user(authorization.split(" ", 1)[1])
    except Exception:  # malformed, bad signature, expired: always a 401, never a 500
        raise HTTPException(401, "Invalid or expired token")
    if not res or not res.user:
        raise HTTPException(401, "Invalid or expired token")
    return res.user


@app.get("/health")
def health():
    return {
        "status": "ready",
        "device": device,
        "bone_age_model": bone_model is not None,
        "bone_age_error": bone_error,
    }


@app.post("/analyze")
def analyze(req: AnalyzeRequest, user=Depends(verify_token)):
    # Ownership checks (the service role key bypasses RLS, so we must check ourselves)
    if not req.image_path.startswith(f"{user.id}/"):
        raise HTTPException(403, "Not your image")
    scan = (
        supabase.table("scans").select("id")
        .eq("id", req.scan_id).eq("user_id", user.id).execute()
    )
    if not scan.data:
        raise HTTPException(403, "Scan not found")

    try:
        supabase.table("scans").update({"status": "analyzing"}).eq("id", req.scan_id).execute()

        data = supabase.storage.from_("wrist-xrays").download(req.image_path)
        image = Image.open(io.BytesIO(data)).convert("RGB")
        w, h = image.size

        # Fracture detection (only the "fracture" class)
        r = yolo_model(image, verbose=False)[0]
        detections, top_conf = [], None
        for b in r.boxes:
            label = yolo_model.names[int(b.cls[0])]
            if label.lower() != FRACTURE_LABEL:
                continue
            conf = float(b.conf[0])
            x1, y1, x2, y2 = b.xyxy[0].tolist()
            detections.append({
                "label": "Fracture",
                "confidence": round(conf, 4),
                "box_normalized": [x1 / w, y1 / h, x2 / w, y2 / h],
            })
            top_conf = conf if top_conf is None else max(top_conf, conf)
        fracture_detected = len(detections) > 0

        # Bone age
        bone_age = None
        if bone_model is not None:
            bone_age = predict_bone_age(image, req.patient_sex)

        payload = {
            "scan_id": req.scan_id,
            "fracture_detected": fracture_detected,
            "fracture_type": None,  # no fracture-typing model yet
            "confidence": round(top_conf, 4) if top_conf is not None else None,
            "detections": detections,
            "bone_age_months": round(bone_age, 2) if bone_age is not None else None,
            "grad_cam_path": None,
            "clinical_disclaimer": DISCLAIMER,
        }
        supabase.table("analysis_results").upsert(payload, on_conflict="scan_id").execute()
        supabase.table("scans").update({"status": "completed"}).eq("id", req.scan_id).execute()

        return {
            **payload,
            "status": "completed",
            "bone_age_formatted": fmt(bone_age),
            "chronological_age_formatted": fmt(req.patient_age_months),
        }
    except Exception as e:
        supabase.table("scans").update({"status": "failed"}).eq("id", req.scan_id).execute()
        raise HTTPException(500, str(e))
