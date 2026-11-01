"""Confidence tuning for the YOLOv8m wrist model (no training).

Runs on a Kaggle GPU with the weights produced by the training notebook
splintered2026/yolov8m-wrist-fracture. It rebuilds the exact same patient
split (same code, seed 42), then measures the "fracture" class on the
validation and test splits:

  box level    precision / recall / F1 at every confidence (Ultralytics val)
  image level  does the X-ray get a fracture finding at confidence t?
               (what the app tells the user), from the highest fracture
               confidence YOLO gives each image

Thresholds are chosen on VALIDATION and reported on TEST, so the test
figures are not tuned to the test set.

Outputs in /kaggle/working:
  confidence_report.json   all numbers used by the app and the website
  image_scores.csv         per-image highest fracture confidence + label
"""
import collections
import hashlib
import json
import os
import random
import shutil
import subprocess
from pathlib import Path

import numpy as np

subprocess.run("pip install -q ultralytics", shell=True, check=True)
from ultralytics import YOLO  # noqa: E402

FRACTURE = 3
NAMES = ["boneanomaly", "bonelesion", "foreignbody", "fracture", "metal",
         "periostealreaction", "pronatorsign", "softtissue", "text"]
EXPECTED_MD5 = "fc396c5f057af950c5506acaed642590"  # the weights on the server
GRID = [round(x, 2) for x in np.arange(0.05, 0.96, 0.01)]
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
subprocess.run(r"""
set -e
mkdir -p /kaggle/temp/graz && cd /kaggle/temp/graz
if [ ! -d folder_structure ]; then
  wget -nv --user-agent="Mozilla/5.0" -O folder_structure.zip https://ndownloader.figshare.com/files/34268819
  unzip -q -o folder_structure.zip -d folder_structure && rm folder_structure.zip
fi
mkdir -p images_raw
if [ "$(ls images_raw | wc -l)" -lt 20327 ]; then
  for pair in 1:34268828 2:34268849 3:34268864 4:34268891; do
    n=${pair%%:*}; id=${pair##*:}
    wget -c -nv --user-agent="Mozilla/5.0" -O images_part$n.zip https://ndownloader.figshare.com/files/$id
    unzip -q -o images_part$n.zip -d images_raw
    rm images_part$n.zip
    echo "part $n done"
  done
fi
echo "images:" $(ls images_raw | wc -l)
""", shell=True, check=True, executable="/bin/bash")

random.seed(42)
IMG_DIR = Path("/kaggle/temp/graz/images_raw")
LBL_DIR = Path("/kaggle/temp/graz/folder_structure/yolov5/labels")
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
    for src, dst in [(IMG_DIR / f"{st}.png", ROOT / "images" / s / f"{st}.png"),
                     (LBL_DIR / f"{st}.txt", ROOT / "labels" / s / f"{st}.txt")]:
        try:
            os.link(src, dst)
        except OSError:
            shutil.copy2(src, dst)

counts = collections.Counter(split_of[s.split("_")[0]] for s in stems)
print("split sizes:", dict(counts))  # training run: compare with its split.csv
data_yaml = WORK / "data.yaml"
data_yaml.write_text(
    f"path: {ROOT}\ntrain: images/train\nval: images/val\ntest: images/test\nnames:\n"
    + "".join(f"  {i}: {nm}\n" for i, nm in enumerate(NAMES))
)

model = YOLO(str(WEIGHTS))

# ---------------------------------------------------------------------------
# 3. Box level: Ultralytics curves for the fracture class
# ---------------------------------------------------------------------------
def box_level(split):
    m = model.val(data=str(data_yaml), split=split, imgsz=640, device=0, plots=False, verbose=False)
    row = list(m.box.ap_class_index).index(FRACTURE)
    px = np.linspace(0, 1, 1000)
    p, r, f1 = m.box.p_curve[row], m.box.r_curve[row], m.box.f1_curve[row]
    at = lambda t: {"precision": float(np.interp(t, px, p)), "recall": float(np.interp(t, px, r)),
                    "f1": float(np.interp(t, px, f1))}
    return {
        "map50": float(m.box.ap50[row]), "map50_95": float(m.box.ap[row]),
        "curve": {f"{t:.2f}": at(t) for t in GRID},
    }

box = {s: box_level(s) for s in ["val", "test"]}

# ---------------------------------------------------------------------------
# 4. Image level: highest fracture confidence per X-ray
# ---------------------------------------------------------------------------
rows = []
for s in ["val", "test"]:
    files = sorted((ROOT / "images" / s).glob("*.png"))
    for i in range(0, len(files), 32):
        batch = files[i:i + 32]
        for f, res in zip(batch, model.predict([str(x) for x in batch], imgsz=640, conf=0.01,
                                               device=0, verbose=False)):
            confs = [float(c) for c, k in zip(res.boxes.conf.tolist(), res.boxes.cls.tolist()) if int(k) == FRACTURE]
            lbl = (ROOT / "labels" / s / f"{f.stem}.txt").read_text().split("\n")
            has = any(line.split()[:1] == [str(FRACTURE)] for line in lbl)
            rows.append({"split": s, "stem": f.stem, "has_fracture": has, "max_conf": max(confs, default=0.0)})

with open(WORK / "image_scores.csv", "w") as fh:
    fh.write("split,stem,has_fracture,max_conf\n")
    for r_ in rows:
        fh.write(f"{r_['split']},{r_['stem']},{int(r_['has_fracture'])},{r_['max_conf']:.4f}\n")


def image_level(split, t):
    rs = [r_ for r_ in rows if r_["split"] == split]
    tp = sum(r_["has_fracture"] and r_["max_conf"] >= t for r_ in rs)
    fn = sum(r_["has_fracture"] and r_["max_conf"] < t for r_ in rs)
    fp = sum((not r_["has_fracture"]) and r_["max_conf"] >= t for r_ in rs)
    tn = sum((not r_["has_fracture"]) and r_["max_conf"] < t for r_ in rs)
    sens = tp / (tp + fn) if tp + fn else 0.0
    spec = tn / (tn + fp) if tn + fp else 0.0
    ppv = tp / (tp + fp) if tp + fp else 0.0
    return {"tp": tp, "fn": fn, "fp": fp, "tn": tn, "sensitivity": sens, "specificity": spec,
            "ppv": ppv, "f1": 2 * ppv * sens / (ppv + sens) if ppv + sens else 0.0,
            "youden": sens + spec - 1}


image = {s: {f"{t:.2f}": image_level(s, t) for t in GRID} for s in ["val", "test"]}

# ---------------------------------------------------------------------------
# 5. Choose on validation, report on test
# ---------------------------------------------------------------------------
def best(table, key):
    return max(table, key=lambda t: (table[t][key], -abs(float(t) - 0.25)))


def lowest_with(table, key, minimum):
    ok = [t for t in table if table[t][key] >= minimum]
    return min(ok, key=float) if ok else None


choice = {
    "box_best_f1": best(box["val"]["curve"], "f1"),
    "image_best_f1": best(image["val"], "f1"),
    "image_best_youden": best(image["val"], "youden"),
    # Lowest confidence at which >= 95% of image-level findings are real fractures:
    # a candidate for the "lower confidence, review carefully" label.
    "image_ppv_95": lowest_with(image["val"], "ppv", 0.95),
}
report = {
    "weights_md5": md5,
    "weights_match_server": md5 == EXPECTED_MD5,
    "split_sizes": dict(counts),
    "images": {s: {"total": sum(r_["split"] == s for r_ in rows),
                   "with_fracture": sum(r_["split"] == s and r_["has_fracture"] for r_ in rows)} for s in ["val", "test"]},
    "chosen_on_val": choice,
    "at_chosen_on_test": {name: {"threshold": t, "box": box["test"]["curve"].get(t), "image": image["test"].get(t)}
                          for name, t in choice.items() if t},
    "current_server_0.25_on_test": {"box": box["test"]["curve"]["0.25"], "image": image["test"]["0.25"]},
    "current_review_0.65_on_test": {"box": box["test"]["curve"]["0.65"], "image": image["test"]["0.65"]},
    "box": box,
    "image": image,
}
(WORK / "confidence_report.json").write_text(json.dumps(report, indent=1, default=float))
print(json.dumps({k: report[k] for k in ["weights_match_server", "split_sizes", "images", "chosen_on_val",
                                          "at_chosen_on_test", "current_server_0.25_on_test",
                                          "current_review_0.65_on_test"]}, indent=1, default=float))
shutil.rmtree(WORK / "runs", ignore_errors=True)
