"""Does test-time augmentation (TTA) make the YOLOv8m fracture confidence better?

No training. Same weights, same data and same patient split as
../yolo_confidence_thresholds/evaluate_confidence.py (the split code is copied
from it; the files come from the Kaggle copy of the dataset). Every validation and test X-ray is scored twice:

  plain  one pass at 640 px (what the server does today)
  tta    Ultralytics augment=True: the X-ray at three sizes, one of them
         mirrored, with the boxes merged

FLOW: this script (Kaggle GPU) -> tta_image_scores.csv + tta_report.json ->
compare_tta.py (run on a PC) prints the plain-versus-TTA table for the README.

Outputs in /kaggle/working:
  tta_image_scores.csv   per X-ray: true label, highest fracture confidence plain and with TTA
  tta_report.json        box-level accuracy and CPU seconds per X-ray, plain and with TTA
"""
import collections
import hashlib
import json
import os
import random
import shutil
import subprocess
import time
from pathlib import Path

import numpy as np

subprocess.run("pip install -q ultralytics", shell=True, check=True)
from ultralytics import YOLO  # noqa: E402

FRACTURE = 3
NAMES = ["boneanomaly", "bonelesion", "foreignbody", "fracture", "metal",
         "periostealreaction", "pronatorsign", "softtissue", "text"]
EXPECTED_MD5 = "fc396c5f057af950c5506acaed642590"  # the weights on the server
WORK = Path("/kaggle/working")

# ---------------------------------------------------------------------------
# 1. Weights from the training notebook's output
# ---------------------------------------------------------------------------
found = sorted(Path("/kaggle/input").rglob("yolov8m_wrist_best.pt"))
assert found, "yolov8m_wrist_best.pt not found under /kaggle/input"
WEIGHTS = found[0]
md5 = hashlib.md5(WEIGHTS.read_bytes()).hexdigest()
print("weights:", WEIGHTS, "md5:", md5, "(matches server)" if md5 == EXPECTED_MD5 else "(DIFFERENT from server!)")

# ---------------------------------------------------------------------------
# 2. Data and split: identical to the training notebook
# ---------------------------------------------------------------------------
# Figshare (the original source) refused downloads from Kaggle on 2026-11-15, so the
# X-rays and labels are read from the Kaggle copy of the same dataset, attached in
# kernel-metadata.json. Section 3 scores are compared with image_scores.csv of the
# earlier run by compare_tta.py, which proves the copy holds the same files.
INPUT = Path("/kaggle/input")
label_dirs = [p for p in INPUT.rglob("labels") if p.is_dir() and p.parent.name == "yolov5"]
assert label_dirs, "yolov5/labels not found under /kaggle/input"
LBL_DIR = label_dirs[0]
IMAGE_OF = {p.stem: p for p in INPUT.rglob("*.png")}
print("labels:", LBL_DIR, "images:", len(IMAGE_OF), flush=True)

random.seed(42)
ROOT = Path("/kaggle/temp/wrist")
if ROOT.exists():
    shutil.rmtree(ROOT)

stems = sorted(p.stem for p in LBL_DIR.glob("*.txt"))
patients = sorted({s.split("_")[0] for s in stems})
random.shuffle(patients)
n = len(patients)
n_tr, n_va = int(0.70 * n), int(0.20 * n)
split_of = {pid: "train" if i < n_tr else "val" if i < n_tr + n_va else "test" for i, pid in enumerate(patients)}

for s in ["val", "test"]:  # training images are not needed here
    (ROOT / "images" / s).mkdir(parents=True)
    (ROOT / "labels" / s).mkdir(parents=True)
    (ROOT / "images" / "train").mkdir(parents=True, exist_ok=True)

for st in stems:
    s = split_of[st.split("_")[0]]
    if s == "train":
        continue
    os.symlink(IMAGE_OF[st], ROOT / "images" / s / f"{st}.png")  # no copy of the X-ray
    shutil.copy2(LBL_DIR / f"{st}.txt", ROOT / "labels" / s / f"{st}.txt")

counts = collections.Counter(split_of[s.split("_")[0]] for s in stems)
print("split sizes:", dict(counts))  # training run: compare with its split.csv
assert dict(counts) == {"train": 14403, "val": 3986, "test": 1938}, "split differs from the training run"
data_yaml = WORK / "data.yaml"
data_yaml.write_text(
    f"path: {ROOT}\ntrain: images/train\nval: images/val\ntest: images/test\nnames:\n"
    + "".join(f"  {i}: {nm}\n" for i, nm in enumerate(NAMES))
)

model = YOLO(str(WEIGHTS))

# ---------------------------------------------------------------------------
# 3. Image level: highest fracture confidence per X-ray, plain and with TTA
# ---------------------------------------------------------------------------
def max_fracture_conf(files, augment):
    """Highest "fracture" confidence for each file (0.0 when YOLO finds none).
    Result goes to: the plain / tta columns of tta_image_scores.csv."""
    out = []
    for res in model.predict([str(x) for x in files], imgsz=640, conf=0.01, device=0,
                             augment=augment, verbose=False):
        confs = [float(c) for c, k in zip(res.boxes.conf.tolist(), res.boxes.cls.tolist()) if int(k) == FRACTURE]
        out.append(max(confs, default=0.0))
    return out


rows = []
for s in ["val", "test"]:
    files = sorted((ROOT / "images" / s).glob("*.png"))
    for i in range(0, len(files), 16):
        batch = files[i:i + 16]
        plain = max_fracture_conf(batch, False)
        tta = max_fracture_conf(batch, True)
        for f, p, t in zip(batch, plain, tta):
            lbl = (ROOT / "labels" / s / f"{f.stem}.txt").read_text().split("\n")
            has = any(line.split()[:1] == [str(FRACTURE)] for line in lbl)
            rows.append((s, f.stem, int(has), p, t))
    print(s, "scored", len(files), flush=True)

with open(WORK / "tta_image_scores.csv", "w") as fh:
    fh.write("split,stem,has_fracture,max_conf_plain,max_conf_tta\n")
    for s, stem, has, p, t in rows:
        fh.write(f"{s},{stem},{has},{p:.4f},{t:.4f}\n")

# ---------------------------------------------------------------------------
# 4. Box level on the test split: are the boxes themselves better with TTA?
# ---------------------------------------------------------------------------
def box_level(augment):
    """Fracture-class precision, recall and mAP on the test split. Result goes to: tta_report.json."""
    m = model.val(data=str(data_yaml), split="test", imgsz=640, device=0, augment=augment,
                  plots=False, verbose=False)
    row = list(m.box.ap_class_index).index(FRACTURE)
    return {"precision": float(m.box.p[row]), "recall": float(m.box.r[row]),
            "map50": float(m.box.ap50[row]), "map50_95": float(m.box.ap[row])}


box = {"plain": box_level(False), "tta": box_level(True)}

# ---------------------------------------------------------------------------
# 5. Cost: seconds per X-ray on a CPU (the server has no GPU)
# ---------------------------------------------------------------------------
def cpu_seconds(files, augment):
    """Median seconds for one X-ray on the CPU. Result goes to: tta_report.json."""
    cpu_model = YOLO(str(WEIGHTS))  # a fresh copy, so the GPU model above is not moved
    times = []
    for f in files:
        t0 = time.perf_counter()
        cpu_model.predict(str(f), imgsz=640, conf=0.25, device="cpu", augment=augment, verbose=False)
        times.append(time.perf_counter() - t0)
    return float(np.median(times[2:]))  # the first runs include set-up time


sample = sorted((ROOT / "images" / "test").glob("*.png"))[:30]
cpu = {"plain": cpu_seconds(sample, False), "tta": cpu_seconds(sample, True),
       "cpu_count": int(os.cpu_count() or 0)}

report = {"weights_md5": md5, "weights_match_server": bool(md5 == EXPECTED_MD5),
          "split_sizes": {k: int(v) for k, v in counts.items()},
          "box_test": box, "cpu_seconds_per_xray": cpu}
(WORK / "tta_report.json").write_text(json.dumps(report, indent=1, default=float))
print(json.dumps(report, indent=1, default=float))
shutil.rmtree(WORK / "runs", ignore_errors=True)
