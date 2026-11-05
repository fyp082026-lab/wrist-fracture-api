"""The AI model: YOLOv8m fracture detection.

Imported only inside the Docker image (it needs torch and ultralytics from
requirements-ml.txt). Weights are mounted read-only at /srv/models from
~/app/models on the server. The model was trained elsewhere and is only used
for inference here.
"""
import torch
from ultralytics import YOLO

device = "cuda" if torch.cuda.is_available() else "cpu"

YOLO_PATH = "models/yolov8m_wrist_best.pt"

# YOLOv8m classes: 0 boneanomaly, 1 bonelesion, 2 foreignbody, 3 fracture,
# 4 metal, 5 periostealreaction, 6 pronatorsign, 7 softtissue, 8 text.
# Only the "fracture" class counts as a fracture finding.
FRACTURE_LABEL = "fracture"
yolo_model = YOLO(YOLO_PATH)

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
    return {"device": device}
