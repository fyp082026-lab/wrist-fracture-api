# YOLO confidence tuning (no retraining)

Checks the two confidence cut-offs the app uses for the fracture model
(`yolov8m_wrist_best.pt`, md5 `fc396c5f057af950c5506acaed642590`, the file on the server):

- **25%**: a box at or above this counts as a fracture (`app/inference.py`)
- **65%**: findings below this are labelled "lower confidence, review carefully" (app and admin website)

## How it was run

1. `evaluate_confidence.py` ran on a Kaggle T4 GPU as the private notebook
   `splintered2026/yolov8m-confidence-tuning`, with the training notebook
   `splintered2026/yolov8m-wrist-fracture` attached for the weights. It rebuilds the
   training run's exact patient split (seed 42) and saves, for every validation and
   test X-ray, whether it has a fracture and the highest fracture confidence YOLO gives
   it: `image_scores.csv`.
2. `analyze_scores.py image_scores.csv confidence_report.json` chooses cut-offs on the
   **validation** split (3,986 X-rays) and reports them on the **test** split
   (1,938 X-rays, 1,208 with a fracture).

To rerun: `kaggle kernels push -p training/yolo_confidence`.

## Result (test set, per X-ray)

| Cut-off | Sensitivity | Specificity | PPV | NPV | F1 |
| --- | --- | --- | --- | --- | --- |
| 0.25 (in use) | 0.969 | 0.914 | 0.949 | 0.947 | 0.959 |
| 0.33 (best F1 on validation) | 0.961 | 0.923 | 0.954 | 0.935 | 0.958 |
| 0.41 (best sensitivity + specificity on validation) | 0.955 | 0.934 | 0.960 | 0.927 | 0.958 |

Findings at 65% or above are real fractures 97.9% of the time (91% of all findings);
findings between 25% and 65% only 65% of the time.

**Decision:** keep both cut-offs. 25% has the same F1 as the best alternatives and misses
fewer fractures; 65% separates very reliable findings from ones that need a second look.

Box-level figures for the same model (Ultralytics `val(split="test")` in the training
notebook): fracture precision 0.884, recall 0.904, mAP@0.5 0.936, mAP@0.5:0.95 0.551.
