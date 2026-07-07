from __future__ import annotations

import gzip
import json
from pathlib import Path

import numpy as np
import pytest

from roomdet.vector_dataset import (
    SEGMENT_FLAG_CLIPPED,
    SEGMENT_FLAG_FILL_OUTLINE,
    SEGMENT_FLAG_HAIRLINE,
    VectorPage,
    VectorPrepConfig,
    build_bridge_candidates,
    build_page_inputs,
    build_vector_splits,
    building_group_key,
    derive_segment_labels,
    label_bridge_candidates,
    load_segment_dump,
    load_vector_page,
    prepare_vector_page,
    save_vector_page,
    snap_polygon_to_segments,
    snap_tolerance,
    _SegmentGrid,
)


def make_page(segments: list[tuple[tuple[float, float], tuple[float, float], float]], bounds=(0.0, 0.0, 100.0, 100.0)) -> VectorPage:
    count = len(segments)
    seg_p0 = np.asarray([segment[0] for segment in segments], dtype=np.float32).reshape(-1, 2)
    seg_p1 = np.asarray([segment[1] for segment in segments], dtype=np.float32).reshape(-1, 2)
    half_width = np.asarray([segment[2] for segment in segments], dtype=np.float32)
    return VectorPage(
        stem="synthetic",
        folder="test",
        source_pdf="synthetic.pdf",
        scene_matrix=(1.0, 0.0, 0.0, 1.0, 0.0, 0.0),
        page_bounds=bounds,
        seg_p0=seg_p0,
        seg_p1=seg_p1,
        half_width=half_width,
        color=np.zeros((count, 3), dtype=np.float32),
        alpha=np.ones(count, dtype=np.float32),
        flags=np.zeros(count, dtype=np.uint8),
    )


def square_walls(x0: float, y0: float, x1: float, y1: float, width: float = 0.5):
    return [
        ((x0, y0), (x1, y0), width),
        ((x1, y0), (x1, y1), width),
        ((x1, y1), (x0, y1), width),
        ((x0, y1), (x0, y0), width),
    ]


def test_snap_polygon_pulls_vertices_onto_strokes() -> None:
    page = make_page(square_walls(20, 20, 60, 60))
    tolerance = snap_tolerance(page, VectorPrepConfig())
    assert tolerance >= 0.2
    grid = _SegmentGrid(page.seg_p0, page.seg_p1, cell=tolerance * 2.0)
    # Four drifted corners (should land on stroke endpoints) and one drifted
    # mid-wall vertex (should project onto the wall line, keeping its x).
    hand_drawn = np.asarray(
        [[20.9, 20.7], [40.0, 20.6], [60.6, 20.5], [60.4, 59.5], [19.6, 60.3]], dtype=np.float32
    )
    snapped = snap_polygon_to_segments(hand_drawn, grid, tolerance)
    expected = np.asarray([[20, 20], [40, 20], [60, 20], [60, 60], [20, 60]], dtype=np.float32)
    assert np.abs(snapped - expected).max() < 0.15


def test_derive_segment_labels_marks_walls_not_noise() -> None:
    walls = square_walls(20, 20, 60, 60)
    noise = [((30.0, 30.0), (40.0, 32.0), 0.1), ((70.0, 70.0), (90.0, 90.0), 0.1)]
    page = make_page(walls + noise)
    polygon = np.asarray([[20, 20], [60, 20], [60, 60], [20, 60]], dtype=np.float32)
    support, positive, owner = derive_segment_labels(page, [polygon], VectorPrepConfig())
    assert positive[:4].all()
    assert not positive[4:].any()
    assert (owner[:4] == 0).all()
    assert (owner[4:] == -1).all()
    assert support[:4].min() > 0.9


def test_negative_page_gets_all_zero_labels() -> None:
    page = make_page(square_walls(10, 10, 50, 50))
    page = prepare_vector_page(page, tsv_path=None, config=VectorPrepConfig())
    assert page.has_labels
    assert page.label_positive.sum() == 0
    assert len(page.gt_polygons) == 0


def test_bridge_candidates_cross_door_gap() -> None:
    # Realistic proportions (walls thin relative to the page, like real sheets):
    # bottom wall of a 400x400 room has a 10-unit door gap between x=355 and x=365.
    config = VectorPrepConfig()
    segments = [
        ((200.0, 200.0), (355.0, 200.0), 0.5),
        ((365.0, 200.0), (600.0, 200.0), 0.5),
        ((600.0, 200.0), (600.0, 600.0), 0.5),
        ((600.0, 600.0), (200.0, 600.0), 0.5),
        ((200.0, 600.0), (200.0, 200.0), 0.5),
    ]
    page = make_page(segments, bounds=(0.0, 0.0, 1000.0, 1000.0))
    boundary = np.ones(len(segments), dtype=bool)
    seg_a, seg_b, coords, radius = build_bridge_candidates(page, boundary, config)
    assert len(seg_a) >= 1
    gap = [index for index in range(len(seg_a)) if {int(seg_a[index]), int(seg_b[index])} == {0, 1}]
    assert gap, "expected a candidate bridging the door gap"
    polygon = np.asarray([[200, 200], [600, 200], [600, 600], [200, 600]], dtype=np.float32)
    labels = label_bridge_candidates(coords, [polygon], snap_tolerance(page, config), config)
    assert labels[gap[0]] == 1


def test_npz_round_trip(tmp_path: Path) -> None:
    page = make_page(square_walls(20, 20, 60, 60) + [((30.0, 30.0), (40.0, 32.0), 0.1)])
    tsv = tmp_path / "synthetic.tsv"
    geometry = json.dumps([{"x": 20.6, "y": 20.4}, {"x": 59.7, "y": 20.1}, {"x": 60.2, "y": 59.5}, {"x": 20.2, "y": 60.4}])
    tsv.write_text("boundaryID\tboundaryType\troomNumber\troomType\tgeometryData\nb1\tRoom\t101\tOffice, General\t" + geometry + "\n")
    page = prepare_vector_page(page, tsv, VectorPrepConfig())
    assert page.label_positive[:4].all()
    assert page.gt_room_types == ["Office, General"]
    assert page.gt_class_ids.tolist() == [1]  # clinical "office"

    out = tmp_path / "page.npz"
    save_vector_page(page, out)
    loaded = load_vector_page(out)
    assert loaded.segment_count == page.segment_count
    assert loaded.has_labels
    assert np.array_equal(loaded.label_positive, page.label_positive)
    assert np.array_equal(loaded.owner, page.owner)
    assert len(loaded.gt_polygons) == 1
    assert np.allclose(loaded.snapped_polygons[0], page.snapped_polygons[0])
    assert loaded.gt_room_types == ["Office, General"]
    assert loaded.bridge_coords.shape == page.bridge_coords.shape
    assert loaded.stats["gtPerimeterSupport"] == pytest.approx(page.stats["gtPerimeterSupport"])


def test_build_page_inputs_shapes_and_scale_invariance() -> None:
    page = make_page(square_walls(20, 20, 60, 60) + [((30.0, 30.0), (40.0, 32.0), 0.1)])
    features, knn_idx, edge = build_page_inputs(
        page.seg_p0, page.seg_p1, page.half_width, page.color, page.alpha, page.flags, page.page_bounds, k=3
    )
    assert features.shape == (5, 21)
    assert knn_idx.shape == (5, 3)
    assert edge.shape == (5, 3, 6)

    factor = 4.0
    scaled_bounds = tuple(value * factor for value in page.page_bounds)
    scaled_features, scaled_knn, scaled_edge = build_page_inputs(
        page.seg_p0 * factor,
        page.seg_p1 * factor,
        page.half_width * factor,
        page.color,
        page.alpha,
        page.flags,
        scaled_bounds,
        k=3,
    )
    assert np.array_equal(knn_idx, scaled_knn)
    assert np.allclose(features, scaled_features, atol=1e-5)
    assert np.allclose(edge, scaled_edge, atol=1e-5)


def test_build_page_inputs_handles_tiny_pages() -> None:
    # Text-only PDFs produce 0-2 stroke segments; the kNN graph must not index
    # out of bounds (scipy pads missing neighbours with index == count).
    for segments in (
        [],
        [((10.0, 10.0), (50.0, 10.0), 0.5)],
        [((10.0, 10.0), (50.0, 10.0), 0.5), ((10.0, 30.0), (50.0, 30.0), 0.5)],
    ):
        page = make_page(segments)
        features, knn_idx, edge = build_page_inputs(
            page.seg_p0, page.seg_p1, page.half_width, page.color, page.alpha, page.flags, page.page_bounds, k=12
        )
        count = len(segments)
        assert features.shape == (count, 21)
        assert knn_idx.shape == (count, 12)
        assert edge.shape == (count, 12, 6)
        if count:
            assert knn_idx.min() >= 0 and knn_idx.max() < count
        assert np.isfinite(features).all() and np.isfinite(edge).all()


def test_load_segment_dump_decodes_arrays(tmp_path: Path) -> None:
    payload = {
        "version": 1,
        "stem": "tiny",
        "folder": "kp",
        "sourcePdf": "pdf-tsv/kp/tiny.pdf",
        "page": {"sceneMatrix": [1, 0, 0, 1, 0, 0], "viewBox": [0, 0, 10, 10], "rotation": 0},
        "sceneStats": {"pageBounds": [0, 0, 10, 10], "sourceSegmentCount": 2},
        "strokes": {
            # segment 0: alpha 1.0, flags hairline(1) -> meta 1 + 1*2 = 3.0
            # segment 1: alpha 0.5, flags clipped(4) -> meta 0.5 + 4*2 = 8.5
            "endpoints": [0, 0, 5, 0, 0, 1, 0, 6],
            "primitiveMeta": [5, 0, 0, 3.0, 0, 6, 0, 8.5],
            "styles": [0.4, 1, 0, 0, 0.2, 0, 1, 0],
        },
        "fills": {
            "pathMetaA": [0, 1, 0, 0],
            "pathMetaB": [10, 10, 0.25, 0.5],
            "pathMetaC": [0, 0, 0.75, 0.9],
            "segmentsA": [1, 1, 2, 2],
            "segmentsB": [2, 2, 0, 0],
        },
    }
    dump_path = tmp_path / "tiny.segments.json.gz"
    with gzip.open(dump_path, "wt", encoding="utf-8") as file:
        json.dump(payload, file)

    page = load_segment_dump(dump_path)
    assert page.segment_count == 3
    assert page.half_width[0] == pytest.approx(0.4)
    assert page.alpha[0] == pytest.approx(1.0)
    assert page.flags[0] == SEGMENT_FLAG_HAIRLINE
    assert page.alpha[1] == pytest.approx(0.5)
    assert page.flags[1] == SEGMENT_FLAG_CLIPPED
    assert page.flags[2] & SEGMENT_FLAG_FILL_OUTLINE
    assert page.color[2].tolist() == pytest.approx([0.25, 0.5, 0.75])
    assert page.alpha[2] == pytest.approx(0.9)
    assert page.seg_p1[2].tolist() == [2.0, 2.0]


def test_building_group_key_and_splits() -> None:
    assert building_group_key("1345 N Vermont_L6 MOB 01") == "1345 n vermont"
    assert building_group_key("Baseline MOB Refresh_Level 2") == "baseline mob refresh"

    labeled = [
        (folder, f"{folder} Building {building}_Floor {floor}", f"pages/{folder}b{building}f{floor}.npz")
        for folder in ("kp", "uci")
        for building in range(5)
        for floor in range(3)
    ]
    # An 11-floor building bigger than the 10% split target must stay in train,
    # not swamp val (this happened with zuckerman's JLG building), and a folder
    # whose ONLY building fits the target must also stay in train (xyicon/Colombo).
    labeled += [("zuckerman", f"JLG_Level {floor}", f"pages/jlg{floor}.npz") for floor in range(11)]
    labeled += [("xyicon_lk", f"Colombo_Floor {floor}", f"pages/co{floor}.npz") for floor in range(4)]
    splits = build_vector_splits(
        labeled,
        negatives=[("not_floorplans", "WarAndPeace", "pages/wp.npz"), ("not_floorplans", "thesis", "pages/th.npz")],
        smoke=[("withoutTSV", "Murietta_Level1", "pages/mu.npz")],
    )
    assignment: dict[str, str] = {}
    for split in ("train", "val", "test"):
        for entry in splits[split]:
            key = building_group_key(entry["stem"])
            if entry["folder"] == "not_floorplans":
                continue
            assert assignment.setdefault(key, split) == split, "building leaked across splits"

    val_folders = {entry["folder"] for entry in splits["val"]}
    assert "kp" in val_folders and "uci" in val_folders, "val must cover the multi-building folders"
    for held_out in ("val", "test"):
        assert all(entry["folder"] not in ("zuckerman", "xyicon_lk") for entry in splits[held_out]), (
            "oversized or only-building folders must stay in train"
        )
    assert any(entry["folder"] == "zuckerman" for entry in splits["train"])
    assert sum(entry["folder"] == "xyicon_lk" for entry in splits["train"]) == 4
    labeled_val = [entry for entry in splits["val"] if entry["folder"] != "not_floorplans"]
    assert len(labeled_val) <= round(len(labeled) * 0.1) + 3, "val should stay near its target size"
    assert len(splits["smoke"]) == 1
    total = sum(len(splits[name]) for name in ("train", "val", "test"))
    assert total == len(labeled) + 2
