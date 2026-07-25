"""
QA script for the Reality Capture Engine.
Run after each engine module is built. All tests must pass before committing.

Usage:
    python qa/qa_rce_full.py
    python qa/qa_rce_full.py --demo     # test demo mode only (no GPU needed)
"""
import sys
import json
import argparse
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "engines"))
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

PASS = 0
FAIL = 0


def test(name: str, fn):
    global PASS, FAIL
    try:
        fn()
        print(f"  PASS  {name}")
        PASS += 1
    except Exception as e:
        print(f"  FAIL  {name}: {e}")
        FAIL += 1


# --- diff.py tests (no GPU needed) ---

def test_diff_added():
    from rce.diff import diff_graphs
    a = {"scan_id": "a", "objects": [{"label": "chair", "position": {"x_norm": 0.5, "y_norm": 0.5}}]}
    b = {"scan_id": "b", "objects": [
        {"label": "chair", "position": {"x_norm": 0.5, "y_norm": 0.5}},
        {"label": "laptop", "position": {"x_norm": 0.3, "y_norm": 0.3}},
    ]}
    result = diff_graphs(a, b)
    assert len(result["changes"]["added"]) == 1
    assert result["changes"]["added"][0]["label"] == "laptop"


def test_diff_removed():
    from rce.diff import diff_graphs
    a = {"scan_id": "a", "objects": [
        {"label": "chair", "position": {"x_norm": 0.5, "y_norm": 0.5}},
        {"label": "box", "position": {"x_norm": 0.1, "y_norm": 0.1}},
    ]}
    b = {"scan_id": "b", "objects": [{"label": "chair", "position": {"x_norm": 0.5, "y_norm": 0.5}}]}
    result = diff_graphs(a, b)
    assert len(result["changes"]["removed"]) == 1
    assert result["changes"]["removed"][0]["label"] == "box"


def test_diff_moved():
    from rce.diff import diff_graphs
    a = {"scan_id": "a", "objects": [{"label": "chair", "position": {"x_norm": 0.1, "y_norm": 0.1}}]}
    b = {"scan_id": "b", "objects": [{"label": "chair", "position": {"x_norm": 0.9, "y_norm": 0.9}}]}
    result = diff_graphs(a, b)
    assert len(result["changes"]["moved"]) == 1


def test_diff_no_change():
    from rce.diff import diff_graphs
    obj = {"label": "chair", "position": {"x_norm": 0.5, "y_norm": 0.5}}
    a = {"scan_id": "a", "objects": [obj]}
    b = {"scan_id": "b", "objects": [obj]}
    result = diff_graphs(a, b)
    assert result["unchanged_count"] == 1
    assert result["summary"] == "No significant changes detected."


def test_diff_summary_format():
    from rce.diff import diff_graphs
    a = {"scan_id": "a", "objects": [{"label": "chair", "position": {"x_norm": 0.1, "y_norm": 0.1}}]}
    b = {"scan_id": "b", "objects": [{"label": "laptop", "position": {"x_norm": 0.5, "y_norm": 0.5}}]}
    result = diff_graphs(a, b)
    assert isinstance(result["summary"], str)
    assert len(result["summary"]) > 0


# --- scene_graph.py tests ---

def test_scene_graph_build():
    from rce.scene_graph import build_scene_graph
    detections = [
        {"label": "chair", "confidence": 0.9, "bbox": [10, 20, 100, 150], "frame_id": "frame_00001", "frame_path": ""},
        {"label": "chair", "confidence": 0.85, "bbox": [12, 22, 102, 152], "frame_id": "frame_00002", "frame_path": ""},
        {"label": "door", "confidence": 0.95, "bbox": [200, 0, 350, 400], "frame_id": "frame_00001", "frame_path": ""},
        {"label": "door", "confidence": 0.93, "bbox": [202, 2, 352, 402], "frame_id": "frame_00002", "frame_path": ""},
    ]
    graph = build_scene_graph(detections, scan_id="test_001")
    assert graph["scan_id"] == "test_001"
    assert len(graph["objects"]) >= 1
    chair_obj = next((o for o in graph["objects"] if o["label"] == "chair"), None)
    assert chair_obj is not None
    assert "position" in chair_obj


def test_scene_graph_filters_noise():
    from rce.scene_graph import build_scene_graph
    detections = [
        # Only seen once — should be filtered
        {"label": "unicorn", "confidence": 0.9, "bbox": [0, 0, 10, 10], "frame_id": "frame_00001", "frame_path": ""},
        # Seen twice — should be kept
        {"label": "chair", "confidence": 0.9, "bbox": [10, 20, 100, 150], "frame_id": "frame_00001", "frame_path": ""},
        {"label": "chair", "confidence": 0.85, "bbox": [12, 22, 102, 152], "frame_id": "frame_00002", "frame_path": ""},
    ]
    graph = build_scene_graph(detections, scan_id="test_002")
    labels = [o["label"] for o in graph["objects"]]
    assert "unicorn" not in labels
    assert "chair" in labels


# --- Demo mode backend test ---

def test_demo_scan():
    import asyncio
    from backend.spatial_impl import _demo_scan_result
    result = _demo_scan_result()
    assert "scan_id" in result
    assert "scene_graph" in result
    graph = result["scene_graph"]
    assert len(graph["objects"]) > 0


def test_demo_diff():
    from backend.spatial_impl import _demo_diff_result
    result = _demo_diff_result()
    assert "changes" in result
    assert "summary" in result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", action="store_true", help="Run demo-mode tests only")
    args = parser.parse_args()

    print("\nQA — Reality Capture Engine")
    print("=" * 40)

    print("\n[diff.py]")
    test("diff: added object detected", test_diff_added)
    test("diff: removed object detected", test_diff_removed)
    test("diff: moved object detected", test_diff_moved)
    test("diff: no change case", test_diff_no_change)
    test("diff: summary string format", test_diff_summary_format)

    print("\n[scene_graph.py]")
    test("scene graph: builds from detections", test_scene_graph_build)
    test("scene graph: filters single-frame noise", test_scene_graph_filters_noise)

    print("\n[backend demo mode]")
    test("demo scan result structure", test_demo_scan)
    test("demo diff result structure", test_demo_diff)

    print("\n" + "=" * 40)
    print(f"Result: {PASS}/{PASS+FAIL} passed")

    if FAIL > 0:
        sys.exit(1)
