import os, io
import torch
import timm
import torchvision.transforms as T
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

# ---------- YOLO ----------
yolo_model = YOLO("models/best.pt")

# Map YOLO class names to the two allowed DB values. EDIT to match your model's class names.
TYPE_MAP = {
    "growth-plate": "Growth-Plate", "growth_plate": "Growth-Plate", "physis": "Growth-Plate",
    "shaft": "Shaft", "diaphysis": "Shaft", "metaphysis": "Shaft",
}

# ---------- Bone age (EDIT these 3 lines to match your Kaggle training) ----------
BONE_ARCH = "efficientnet_b0"
BONE_SIZE = 256
BONE_PATH = "models/bone_age.pth"

bone_model = None
if os.path.exists(BONE_PATH):
    bone_model = timm.create_model(BONE_ARCH, pretrained=False, num_classes=1)
    bone_model.load_state_dict(torch.load(BONE_PATH, map_location="cpu"))
    bone_model.eval().to(device)

bone_tf = T.Compose([
    T.Resize((BONE_SIZE, BONE_SIZE)),
    T.ToTensor(),
    T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])


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
    res = supabase.auth.get_user(authorization.split(" ", 1)[1])
    if not res or not res.user:
        raise HTTPException(401, "Invalid or expired token")
    return res.user


@app.get("/health")
def health():
    return {"status": "ready", "device": device, "bone_age_model": bone_model is not None}


@app.post("/analyze")
def analyze(req: AnalyzeRequest, user=Depends(verify_token)):
    # Ownership checks (service role bypasses RLS, so we must check ourselves)
    if not req.image_path.startswith(f"{user.id}/"):
        raise HTTPException(403, "Not your image")
    scan = supabase.table("scans").select("id").eq("id", req.scan_id).eq("user_id", user.id).execute()
    if not scan.data:
        raise HTTPException(403, "Scan not found")

    try:
        supabase.table("scans").update({"status": "analyzing"}).eq("id", req.scan_id).execute()

        data = supabase.storage.from_("wrist-xrays").download(req.image_path)
        image = Image.open(io.BytesIO(data)).convert("RGB")
        w, h = image.size

        # YOLO
        r = yolo_model(image, verbose=False)[0]
        detections, top_conf, fracture_type = [], None, None
        for b in r.boxes:
            conf = float(b.conf[0])
            x1, y1, x2, y2 = b.xyxy[0].tolist()
            label = yolo_model.names[int(b.cls[0])]
            detections.append({"label": label, "confidence": round(conf, 4),
                               "box_normalized": [x1 / w, y1 / h, x2 / w, y2 / h]})
            if top_conf is None or conf > top_conf:
                top_conf = conf
                fracture_type = TYPE_MAP.get(label.lower())
        fracture_detected = len(detections) > 0

        # Bone age
        bone_age = None
        if bone_model is not None:
            with torch.inference_mode():
                x = bone_tf(image).unsqueeze(0).to(device)
                bone_age = float(bone_model(x).squeeze().cpu())
            # If you normalised months during training, undo it here:
            # bone_age = bone_age * STD + MEAN

        payload = {
            "scan_id": req.scan_id,
            "fracture_detected": fracture_detected,
            "fracture_type": fracture_type,
            "confidence": round(top_conf, 4) if top_conf is not None else None,
            "detections": detections,
            "bone_age_months": round(bone_age, 2) if bone_age is not None else None,
            "grad_cam_path": None,
            "clinical_disclaimer": DISCLAIMER,
        }
        supabase.table("analysis_results").insert(payload).execute()
        supabase.table("scans").update({"status": "completed"}).eq("id", req.scan_id).execute()

        return {**payload, "status": "completed",
                "bone_age_formatted": fmt(bone_age),
                "chronological_age_formatted": fmt(req.patient_age_months)}
    except Exception as e:
        supabase.table("scans").update({"status": "failed"}).eq("id", req.scan_id).execute()
        raise HTTPException(500, str(e))
