"""The two AI models: YOLOv8m fracture detection and EfficientNet-B3 bone age.

Imported only inside the Docker image (it needs torch, ultralytics, timm and
OpenCV from requirements-ml.txt). Weights are mounted read-only at
/srv/models from ~/app/models on the server. The models were trained
elsewhere and are only used for inference here.

FLOW: main.py /analyze passes the opened X-ray image in ->
  detect_fractures() returns fracture boxes, predict_bone_age() returns months ->
  both go back to /analyze, which hands them to results.build_result().
"""
import os

import cv2
import numpy as np
import timm
import torch
import torch.nn as nn
from ultralytics import YOLO

# Where the models run (the EC2 server has no GPU, so "cpu"). Reported by status().
device = "cuda" if torch.cuda.is_available() else "cpu"

YOLO_PATH = "models/yolov8m_wrist_best.pt"
BONE_PATH = "models/bone_age_best.pt"

# YOLOv8m classes: 0 boneanomaly, 1 bonelesion, 2 foreignbody, 3 fracture,
# 4 metal, 5 periostealreaction, 6 pronatorsign, 7 softtissue, 8 text.
# Only the "fracture" class counts as a fracture finding.
FRACTURE_LABEL = "fracture"
# Loaded once when the server starts; used by detect_fractures().
yolo_model = YOLO(YOLO_PATH)

# Bone age model settings (from bone_age_config.json of the training run).
IMG = 384
Y_MEAN = 127.1987533569336
Y_STD = 41.25189971923828
SEX_CODE = {"M": 1.0, "F": 0.0}


class BoneAgeNet(nn.Module):
    """The bone age network: EfficientNet-B3 reads the X-ray, a small layer reads
    the sex, and a final layer combines both into one number.
    Used by predict_bone_age(); the layout must match the trained weights file."""

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
        # x = prepared X-ray, sex = 1.0 (M) / 0.0 (F). Returns a standardised age
        # (z-score) to predict_bone_age(), which converts it to months.
        f = self.backbone(x)
        s = self.sex(sex)
        return self.head(torch.cat([f, s], dim=1)).squeeze(1)


# Load the bone age weights once at start-up. bone_model is used by
# predict_bone_age() and checked by /analyze; bone_error is shown by /health.
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


def warm_up():
    """Runs each model once on a blank image when the server starts.

    The first run of a model is slow (it builds its internal pipeline). Doing it
    here means the first real scan after a deploy is as fast as every later one.
    Result goes to: nowhere; a failure is only printed, the server still starts.
    """
    try:
        from PIL import Image
        blank = Image.new("RGB", (640, 640))
        detect_fractures(blank)
        if bone_model is not None:
            predict_bone_age(blank, "M")
    except Exception as e:
        print("Model warm-up skipped:", e, flush=True)


def preprocess_xray(gray):
    """Same preprocessing used in training (percentile clip + letterbox to 384).

    Input: grayscale X-ray array from predict_bone_age().
    Result goes to: predict_bone_age(), as a 384 x 384 image ready for the model.
    """
    # Stretch the contrast between the 1st and 99th percentile, then scale to 0-255.
    g = gray.astype(np.float32)
    lo, hi = np.percentile(g, 1), np.percentile(g, 99)
    g = np.clip((g - lo) / max(hi - lo, 1e-6), 0, 1)
    g = (g * 255).astype(np.uint8)
    # Shrink so the longer side is 384 px, keeping the shape of the X-ray.
    h, w = g.shape
    s = IMG / max(h, w)
    g = cv2.resize(
        g, (max(1, int(round(w * s))), max(1, int(round(h * s)))),
        interpolation=cv2.INTER_AREA,
    )
    # Paste it in the centre of a black 384 x 384 square (letterbox).
    out = np.zeros((IMG, IMG), np.uint8)
    y0 = (IMG - g.shape[0]) // 2
    x0 = (IMG - g.shape[1]) // 2
    out[y0:y0 + g.shape[0], x0:x0 + g.shape[1]] = g
    return out


def predict_bone_age(image, sex):
    """Estimates bone age in months with the EfficientNet model.

    Input: the X-ray image and patient sex ("M"/"F") from main.py /analyze.
    Result goes to: /analyze -> results.build_result() -> results.safe_bone_age(),
    then the app and admin website show it as "Xy Ym".
    """
    # Prepare the image the same way as in training and scale pixels to -1..1.
    gray = np.array(image.convert("L"))
    x = preprocess_xray(gray).astype(np.float32) / 255.0
    x = (x - 0.5) / 0.5
    x = torch.from_numpy(x)[None, None].to(device)
    s = torch.tensor([[SEX_CODE.get(sex.upper(), 1.0)]], dtype=torch.float32, device=device)
    # Run the model, then turn its standardised output back into months.
    with torch.inference_mode():
        z = float(bone_model(x, s).item())
    return z * Y_STD + Y_MEAN


def detect_fractures(image):
    """Returns [(confidence, x1, y1, x2, y2), ...] in pixels, fracture class only.

    Input: the X-ray image from main.py /analyze.
    Result goes to: /analyze -> results.build_result() -> results.normalize_boxes(),
    then the app draws the boxes on the X-ray (ui_components/XrayView.tsx).
    """
    # Same image size as training (imgsz 640 in args.yaml); 0.25 is YOLO's default threshold.
    r = yolo_model(image, imgsz=640, conf=0.25, verbose=False)[0]
    # Keep only boxes of the "fracture" class; the other 8 classes are ignored.
    out = []
    for b in r.boxes:
        if yolo_model.names[int(b.cls[0])].lower() != FRACTURE_LABEL:
            continue
        x1, y1, x2, y2 = b.xyxy[0].tolist()
        out.append((float(b.conf[0]), x1, y1, x2, y2))
    return out


def status():
    """Which device and models are loaded. Result goes to: main.py GET /health."""
    return {"device": device, "bone_age_model": bone_model is not None, "bone_age_error": bone_error}


# Called once, when main.py imports this file at server start-up.
warm_up()
