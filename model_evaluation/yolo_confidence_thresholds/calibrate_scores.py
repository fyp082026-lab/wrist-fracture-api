"""Calibrated confidence: turns YOLO's raw fracture score into a chance that is honest.

YOLO's score is a ranking number, not a probability: a score of 0.60 does not mean
"60 out of 100 such X-rays really have a fracture". This script fits a small
logistic curve (Platt scaling) that maps the raw score to a probability, using only
the VALIDATION split, then checks it on the TEST split.

It needs no numpy or sklearn (plain Python), and it does not change any decision:
the mapping is increasing, so the ranking and the sensitivity/specificity at a
matched cut-off stay the same. What changes is the number shown to the clinician.

Usage: python calibrate_scores.py image_scores.csv
Input:  image_scores.csv from evaluate_confidence.py (split, has_fracture, max_conf)
Output: printed tables. Used to decide what the app should display (not wired in yet).
"""
import csv
import math
import sys

EPS = 1e-4  # scores are clipped to [EPS, 1-EPS] before taking the logit


def load(path):
    """Reads image_scores.csv. Result goes to: main()."""
    with open(path, newline="") as fh:
        rows = []
        for r in csv.DictReader(fh):
            p = min(max(float(r["max_conf"]), EPS), 1 - EPS)
            rows.append({"split": r["split"], "y": int(r["has_fracture"]), "p": float(r["max_conf"]),
                         "x": math.log(p / (1 - p))})
    return rows


def sigmoid(z):
    """Logistic function, safe for large |z|. Used by fit_platt() and calibrated()."""
    if z >= 0:
        return 1 / (1 + math.exp(-z))
    e = math.exp(z)
    return e / (1 + e)


def fit_platt(rows):
    """Fits p = sigmoid(a * logit(score) + b) by maximum likelihood (Newton steps).
    Input: validation rows. Result goes to: calibrated(), used by main() for the test check."""
    a, b = 1.0, 0.0
    for _ in range(100):
        g0 = g1 = h00 = h01 = h11 = 0.0
        for r in rows:
            x = r["x"]
            p = sigmoid(b + a * x)
            w = p * (1 - p)
            d = p - r["y"]
            g0 += d
            g1 += d * x
            h00 += w
            h01 += w * x
            h11 += w * x * x
        det = h00 * h11 - h01 * h01
        db = (h11 * g0 - h01 * g1) / det
        da = (h00 * g1 - h01 * g0) / det
        b -= db
        a -= da
        if abs(db) + abs(da) < 1e-10:
            break
    return a, b


def calibrated(score, a, b):
    """Chance of a fracture for one raw YOLO score. Result goes to: the mapping table
    and the reliability check in main()."""
    p = min(max(score, EPS), 1 - EPS)
    return sigmoid(a * math.log(p / (1 - p)) + b)


def fit_isotonic(rows):
    """Fits a step-shaped mapping from score to chance: scores sorted, neighbouring groups
    merged while the real rate would go down (pool adjacent violators). Makes no assumed
    shape, so it can follow the middle range better than Platt. Input: validation rows.
    Result goes to: iso_prob(), used by main()."""
    blocks = []  # [count of fractures, count of X-rays, highest score in the block]
    for r in sorted(rows, key=lambda r: r["p"]):
        blocks.append([r["y"], 1, r["p"]])
        while len(blocks) > 1 and blocks[-2][0] / blocks[-2][1] > blocks[-1][0] / blocks[-1][1]:
            pos, n, top = blocks.pop()
            blocks[-1][0] += pos
            blocks[-1][1] += n
            blocks[-1][2] = top
    return [(top, pos / n) for pos, n, top in blocks]


def iso_prob(score, fit):
    """Chance for one raw score from the step mapping of fit_isotonic(). Result goes to: main()."""
    for upper, value in fit:
        if score <= upper:
            return value
    return fit[-1][1]


def metrics(rows, prob):
    """Log loss, Brier score and expected calibration error (10 bins) for probabilities
    prob(r) on the rows. Result goes to: main()."""
    n = len(rows)
    ll = sum(-(r["y"] * math.log(max(prob(r), 1e-12)) + (1 - r["y"]) * math.log(max(1 - prob(r), 1e-12)))
             for r in rows) / n
    brier = sum((prob(r) - r["y"]) ** 2 for r in rows) / n
    bins = [[] for _ in range(10)]
    for r in rows:
        bins[min(9, int(prob(r) * 10))].append(r)
    ece = sum(len(bin_) / n * abs(sum(prob(r) for r in bin_) / len(bin_) - sum(r["y"] for r in bin_) / len(bin_))
              for bin_ in bins if bin_)
    return {"log_loss": ll, "brier": brier, "ece": ece}


def reliability(rows, prob):
    """Test X-rays grouped by predicted chance: how many, the predicted and the real rate.
    Result goes to: main(), printed as the reliability table."""
    out = []
    for k in range(10):
        lo, hi = k / 10, (k + 1) / 10
        group = [r for r in rows if lo <= prob(r) < hi or (k == 9 and prob(r) == 1.0)]
        if group:
            out.append((lo, hi, len(group), sum(prob(r) for r in group) / len(group),
                        sum(r["y"] for r in group) / len(group)))
    return out


def main():
    """Fits on validation, checks on test, prints the mapping and the reliability table."""
    rows = load(sys.argv[1])
    val = [r for r in rows if r["split"] == "val"]
    test = [r for r in rows if r["split"] == "test"]
    a, b = fit_platt(val)
    print(f"fitted on validation ({len(val)} X-rays): a = {a:.4f}, b = {b:.4f}\n")

    iso = fit_isotonic(val)
    prob = lambda r: calibrated(r["p"], a, b)
    iso_p = lambda r: iso_prob(r["p"], iso)
    raw = lambda r: min(max(r["p"], 0.0), 1.0)  # raw score used as if it were a probability
    print("test split (%d X-rays):" % len(test))
    print(f"  {'':34} {'log loss':>9} {'Brier':>7} {'ECE':>7}")
    methods = [("raw score read as a probability", raw), ("Platt (logistic curve)", prob),
               ("isotonic (step curve)", iso_p)]
    for name, f in methods:
        m = metrics(test, f)
        print(f"  {name:34} {m['log_loss']:9.4f} {m['brier']:7.4f} {m['ece']:7.4f}")

    print("\nraw score -> chance of a fracture (Platt | isotonic):")
    for s in [0.05, 0.10, 0.25, 0.40, 0.50, 0.65, 0.80, 0.90, 0.95]:
        print(f"  raw {s:4.2f} -> {100 * calibrated(s, a, b):5.1f}% | {100 * iso_prob(s, iso):5.1f}%")

    for name, f in [("Platt", prob), ("isotonic", iso_p)]:
        print(f"\ntest reliability, {name} (predicted chance vs. real rate):")
        print(f"  {'predicted':>13} {'X-rays':>7} {'predicted':>10} {'real':>7}")
        for lo, hi, n, pred, real in reliability(test, f):
            print(f"  {lo:5.0%}-{hi:4.0%} {n:7d} {pred:10.1%} {real:7.1%}")

    # The decision is unchanged: the same X-rays are flagged at a matched cut-off.
    cut = calibrated(0.25, a, b)
    flagged_raw = sum(r["p"] >= 0.25 for r in test)
    flagged_cal = sum(prob(r) >= cut for r in test)
    print(f"\nmatched cut-off: raw 0.25 = Platt {cut:.1%}; X-rays flagged: {flagged_raw} vs {flagged_cal}")


if __name__ == "__main__":
    main()
