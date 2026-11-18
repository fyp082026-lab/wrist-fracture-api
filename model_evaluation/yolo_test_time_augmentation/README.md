# Test-time augmentation for the fracture model (tested, not adopted)

Question: without new data or retraining, does scoring each X-ray several times
(Ultralytics `augment=True`: three sizes, one mirrored, boxes merged) give a better
fracture confidence than the single 640 px pass the server uses?

## How it was run

1. `evaluate_tta.py` ran on a Kaggle T4 GPU as the private notebook
   `splintered2026/yolov8m-tta-evaluation` (16 Nov 2026), with the server's weights
   (md5 `fc396c5f057af950c5506acaed642590`) and the training run's patient split.
   The X-rays come from the Kaggle dataset `jasonroggy/grazpedwri-dx`, because Figshare
   refused downloads from Kaggle. The plain scores match `../yolo_confidence_thresholds/image_scores.csv`
   to 0.0001 on all 5,924 X-rays, so the copy and the split are the same.
2. `python compare_tta.py tta_image_scores.csv` prints the comparison below.

To rerun: `kaggle kernels push -p model_evaluation/yolo_test_time_augmentation`.

## Result (test set, 1,938 X-rays, 1,208 with a fracture)

| | Plain (in use) | With augmentation |
| --- | --- | --- |
| Missed fractures / false alarms at 0.25 | 37 / 63 | 25 / 75 |
| Missed fractures at the same 63 false alarms | 37 | 39 (cut-off 0.36) |
| Ranking quality (AUC) | 0.9842 | 0.9866 |
| Box mAP@0.5 / mAP@0.5:0.95 (fracture) | 0.936 / 0.551 | 0.941 / 0.558 |
| Box precision / recall (fracture) | 0.884 / 0.904 | 0.879 / 0.902 |
| Findings at 65% or above that are real | 97.9% | 97.4% |
| Findings between 25% and 65% that are real | 65.2% | 55.0% |
| CPU seconds per X-ray (Kaggle, 4 cores) | 0.31 | 0.69 |

## Decision

Not adopted. Augmentation raises every score a little (about +0.02), so at the same
cut-off it finds 12 more fractures and raises 12 more false alarms. Once the cut-off is
moved to give the same number of false alarms, the result is mixed: slightly more misses
on test (39 against 37) and slightly fewer on validation (74 against 84). A gain that
does not repeat on the test set is not reliable, and each scan would take about twice as
long on the server.
