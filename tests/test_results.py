"""The saved/returned result is always something the app can display."""
from app.results import build_result, normalize_boxes, safe_bone_age


def test_normal_fracture_result():
    row, resp = build_result("s1", [(0.83, 410, 520, 550, 660)], 1000, 1000, 104.371, 96)
    assert row["fracture_detected"] is True
    assert row["confidence"] == 0.83
    assert row["detections"][0]["box_normalized"] == [0.41, 0.52, 0.55, 0.66]
    assert row["bone_age_months"] == 104.37
    assert resp["status"] == "completed"
    assert resp["bone_age_formatted"] == "8y 8m" and resp["chronological_age_formatted"] == "8y 0m"


def test_no_fracture():
    row, resp = build_result("s1", [], 800, 600, 50.0, 60)
    assert row["fracture_detected"] is False and row["confidence"] is None and row["detections"] == []


def test_boxes_are_clamped_inside_the_image():
    dets, _ = normalize_boxes([(0.7, -3, 10, 1001, 50)], 1000, 100)
    assert dets[0]["box_normalized"] == [0.0, 0.1, 1.0, 0.5]


def test_zero_size_boxes_are_dropped_and_best_box_comes_first():
    dets, top = normalize_boxes([(0.5, 10, 10, 10, 50), (0.6, 0, 0, 10, 10), (0.9, 20, 20, 40, 40)], 100, 100)
    assert [d["confidence"] for d in dets] == [0.9, 0.6]
    assert top == 0.9


def test_implausible_bone_age_is_reported_as_unavailable():
    assert safe_bone_age(-3.2) is None
    assert safe_bone_age(400) is None
    assert safe_bone_age(float("nan")) is None
    assert safe_bone_age(None) is None
    assert safe_bone_age(0) == 0.0
    _, resp = build_result("s1", [], 10, 10, -3.2, 12)
    assert resp["bone_age_months"] is None and resp["bone_age_formatted"] is None
