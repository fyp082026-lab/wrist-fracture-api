"""The two AI models: YOLOv8m fracture detection and EfficientNet-B3 bone age.

Imported only inside the Docker image (it needs torch, ultralytics, timm and
OpenCV from requirements-ml.txt). Weights are mounted read-only at
/srv/models from ~/app/models on the server. The models were trained
elsewhere and are only used for inference here.
"""
import os

import cv2
import numpy as np
import timm
import torch
import torch.nn as nn
from ultralytics import YOLO

device = "cuda" if torch.cuda.is_available() else "cpu"

YOLO_PATH = "models/yolov8m_wrist_best.pt"
BONE_PATH = "models/bone_age_best.pt"

# YOLOv8m classes: 0 boneanomaly, 1 bonelesion, 2 foreignbody, 3 fracture,
# 4 metal, 5 periostealreaction, 6 pronatorsign, 7 softtissue, 8 text.
# Only the "fracture" class counts as a fracture finding.
FRACTURE_LABEL = "fracture"
yolo_model = YOLO(YOLO_PATH)

# Bone age model settings (from bone_age_config.json of the training run).
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
    print("Bone age model failed to load:", e, flush=True)


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


def detect_fractures(image):
    """Returns [(confidence, x1, y1, x2, y2), ...] in pixels, fracture class only."""
    # Same image size as training (imgsz 640 in args.yaml); 0.25 is YOLO's default threshold.
    r = yolo_model(image, imgsz=640, conf=0.25, verbose=False)[0]
    out = []
    for b in r.boxes:
        if yolo_model.names[int(b.cls[0])].lower() != FRACTURE_LABEL:
            continue
        x1, y1, x2, y2 = b.xyxy[0].tolist()
        out.append((float(b.conf[0]), x1, y1, x2, y2))
    return out


def status():
    return {"device": device, "bone_age_model": bone_model is not None, "bone_age_error": bone_error}
