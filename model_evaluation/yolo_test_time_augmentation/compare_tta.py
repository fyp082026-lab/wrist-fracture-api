"""Plain versus test-time augmentation, from tta_image_scores.csv (output of evaluate_tta.py).

Each row is one X-ray: its true label and the highest fracture confidence YOLO
gives it with one plain pass and with TTA. Cut-offs are chosen on the validation
split and reported on the test split, the same rule as
../yolo_confidence_thresholds/analyze_scores.py.

Usage: python compare_tta.py tta_image_scores.csv
Result goes to: the table printed on screen (copied into README.md).
"""
import csv
import sys

GRID = [round(0.05 + 0.01 * i, 2) for i in range(91)]  # 0.05 .. 0.95


def load(path):
    """Reads the CSV. Result goes to: main()."""
    with open(path, newline="") as fh:
        return [{"split": r["split"], "y": r["has_fracture"] == "1",
                 "plain": float(r["max_conf_plain"]), "tta": float(r["max_conf_tta"])} for r in csv.DictReader(fh)]


def at(rows, key, t):
    """Right and wrong answers when "fracture" means rows[key] >= t. Result goes to: main()."""
    tp = sum(r["y"] and r[key] >= t for r in rows)
    fn = sum(r["y"] and r[key] < t for r in rows)
    fp = sum(not r["y"] and r[key] >= t for r in rows)
    tn = sum(not r["y"] and r[key] < t for r in rows)
    sens = tp / (tp + fn) if tp + fn else 0.0
    spec = tn / (tn + fp) if tn + fp else 0.0
    ppv = tp / (tp + fp) if tp + fp else 0.0
    f1 = 2 * ppv * sens / (ppv + sens) if ppv + sens else 0.0
    return {"tp": tp, "fn": fn, "fp": fp, "tn": tn, "sens": sens, "spec": spec, "ppv": ppv, "f1": f1}


def auc(rows, key):
    """Chance that a fracture X-ray scores higher than a non-fracture one (1.0 = perfect
    ranking, independent of any cut-off). Result goes to: main()."""
    ranked = sorted(rows, key=lambda r: r[key])
    rank_sum, i = 0.0, 0
    while i < len(ranked):
        j = i
        while j < len(ranked) and ranked[j][key] == ranked[i][key]:
            j += 1
        rank_sum += sum(r["y"] for r in ranked[i:j]) * (i + j + 1) / 2  # average rank of the tie
        i = j
    pos = sum(r["y"] for r in rows)
    neg = len(rows) - pos
    return (rank_sum - pos * (pos + 1) / 2) / (pos * neg)


def main():
    """Prints the comparison on the test split."""
    rows = load(sys.argv[1])
    val = [r for r in rows if r["split"] == "val"]
    test = [r for r in rows if r["split"] == "test"]
    print(f"test X-rays: {len(test)} ({sum(r['y'] for r in test)} with a fracture)\n")
    print(f"{'method':6} {'cut-off':28} {'sens':>6} {'spec':>6} {'ppv':>6} {'f1':>6}   missed  false alarms")
    for key in ["plain", "tta"]:
        best = max(GRID, key=lambda t: at(val, key, t)["f1"])
        for name, t in [("0.25 (in use)", 0.25), (f"{best:.2f} (best F1 on validation)", best)]:
            m = at(test, key, t)
            print(f"{key:6} {name:28} {m['sens']:6.3f} {m['spec']:6.3f} {m['ppv']:6.3f} {m['f1']:6.3f}   {m['fn']:6d}  {m['fp']:6d}")
    print()
    for key in ["plain", "tta"]:
        print(f"{key:6} ranking quality (AUC) on test: {auc(test, key):.4f}")
    # How reliable is a finding in each confidence band?
    print()
    for key in ["plain", "tta"]:
        low = [r for r in test if 0.25 <= r[key] < 0.65]
        high = [r for r in test if r[key] >= 0.65]
        print(f"{key:6} findings >= 65%: {len(high)}, real {sum(r['y'] for r in high) / max(1, len(high)):.3f};"
              f"  25-65%: {len(low)}, real {sum(r['y'] for r in low) / max(1, len(low)):.3f}")
    fixed = sum((r["plain"] >= 0.25) != r["y"] and (r["tta"] >= 0.25) == r["y"] for r in test)
    broken = sum((r["plain"] >= 0.25) == r["y"] and (r["tta"] >= 0.25) != r["y"] for r in test)
    print(f"\nat 0.25: TTA corrects {fixed} test X-rays and breaks {broken}")


if __name__ == "__main__":
    main()
