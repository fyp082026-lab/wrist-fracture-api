"""Image-level threshold analysis from image_scores.csv (output of evaluate_confidence.py).

Each row is one X-ray: does it really contain a fracture, and the highest
fracture confidence YOLO gave it. At a cut-off t the app says "fracture
suggested" when max_conf >= t. Cut-offs are chosen on the validation split
and reported on the test split.

Usage: python analyze_scores.py image_scores.csv [report.json]
"""
import csv
import json
import sys

GRID = [round(0.05 + 0.01 * i, 2) for i in range(91)]  # 0.05 .. 0.95


def load(path):
    with open(path, newline="") as fh:
        return [{"split": r["split"], "y": r["has_fracture"] == "1", "p": float(r["max_conf"])} for r in csv.DictReader(fh)]


def at(rows, t):
    tp = sum(r["y"] and r["p"] >= t for r in rows)
    fn = sum(r["y"] and r["p"] < t for r in rows)
    fp = sum(not r["y"] and r["p"] >= t for r in rows)
    tn = sum(not r["y"] and r["p"] < t for r in rows)
    sens = tp / (tp + fn) if tp + fn else 0.0
    spec = tn / (tn + fp) if tn + fp else 0.0
    ppv = tp / (tp + fp) if tp + fp else 0.0
    npv = tn / (tn + fn) if tn + fn else 0.0
    f1 = 2 * ppv * sens / (ppv + sens) if ppv + sens else 0.0
    return {"t": t, "tp": tp, "fn": fn, "fp": fp, "tn": tn, "sensitivity": sens, "specificity": spec,
            "ppv": ppv, "npv": npv, "f1": f1, "accuracy": (tp + tn) / len(rows)}


def main():
    rows = load(sys.argv[1])
    val = [r for r in rows if r["split"] == "val"]
    test = [r for r in rows if r["split"] == "test"]
    vt = {t: at(val, t) for t in GRID}

    best_f1 = max(GRID, key=lambda t: vt[t]["f1"])
    best_youden = max(GRID, key=lambda t: vt[t]["sensitivity"] + vt[t]["specificity"])
    ppv95 = min((t for t in GRID if vt[t]["ppv"] >= 0.95), default=None)
    ppv97 = min((t for t in GRID if vt[t]["ppv"] >= 0.97), default=None)
    sens95 = max((t for t in GRID if vt[t]["sensitivity"] >= 0.95), default=None)

    chosen = {
        "current detection cut-off": 0.25,
        "best F1 (val)": best_f1,
        "best sensitivity+specificity (val)": best_youden,
        "highest cut-off keeping 95% sensitivity (val)": sens95,
        "current review label": 0.65,
        "lowest cut-off with 95% of findings real (val)": ppv95,
        "lowest cut-off with 97% of findings real (val)": ppv97,
    }
    report = {
        "images": {"val": len(val), "val_fracture": sum(r["y"] for r in val),
                   "test": len(test), "test_fracture": sum(r["y"] for r in test)},
        "chosen": {k: {"t": t, "val": vt[t] if t in vt else at(val, t), "test": at(test, t)}
                   for k, t in chosen.items() if t is not None},
        "test_curve": [at(test, t) for t in GRID],
    }
    print(f"{'rule':48} {'t':>5}  {'sens':>6} {'spec':>6} {'ppv':>6} {'npv':>6} {'f1':>6}   (test)")
    for k, v in report["chosen"].items():
        m = v["test"]
        print(f"{k:48} {v['t']:5.2f}  {m['sensitivity']:6.3f} {m['specificity']:6.3f} {m['ppv']:6.3f} {m['npv']:6.3f} {m['f1']:6.3f}"
              f"   tp {m['tp']} fn {m['fn']} fp {m['fp']} tn {m['tn']}")
    if len(sys.argv) > 2:
        with open(sys.argv[2], "w") as fh:
            json.dump(report, fh, indent=1)


if __name__ == "__main__":
    main()
