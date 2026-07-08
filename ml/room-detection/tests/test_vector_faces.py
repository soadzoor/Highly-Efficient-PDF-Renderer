from __future__ import annotations

import numpy as np
import pytest

from roomdet.vector_dataset import VectorPrepConfig
from roomdet.vector_faces import FaceConfig, extract_rooms, face_shape_features
from roomdet.vector_metrics import (
    aggregate_page_metrics,
    evaluate_rooms_on_page,
    scale_vector_page,
)
from tests.test_vector_dataset import make_page, square_walls

shapely = pytest.importorskip("shapely")


def two_room_page():
    """Two 40x30 rooms side by side sharing a middle wall."""
    segments = [
        ((10.0, 10.0), (90.0, 10.0), 0.5),
        ((90.0, 10.0), (90.0, 40.0), 0.5),
        ((90.0, 40.0), (10.0, 40.0), 0.5),
        ((10.0, 40.0), (10.0, 10.0), 0.5),
        ((50.0, 10.0), (50.0, 40.0), 0.5),  # shared wall
    ]
    return make_page(segments)


def test_extract_rooms_splits_on_shared_wall() -> None:
    page = two_room_page()
    probs = np.ones(page.segment_count, dtype=np.float32)
    faces = extract_rooms(page, probs, face_config=FaceConfig(min_perimeter_coverage=0.5))
    assert len(faces) == 2
    areas = sorted(face.area for face in faces)
    assert areas[0] == pytest.approx(40 * 30, rel=0.05)
    assert areas[1] == pytest.approx(40 * 30, rel=0.05)
    assert all(face.coverage > 0.9 for face in faces)
    assert all(len(face.member_segments) >= 3 for face in faces)


def test_low_probability_walls_are_ignored() -> None:
    page = two_room_page()
    probs = np.ones(page.segment_count, dtype=np.float32)
    probs[4] = 0.1  # shared wall below threshold -> rooms merge
    faces = extract_rooms(page, probs, face_config=FaceConfig(min_perimeter_coverage=0.5))
    assert len(faces) == 1
    assert faces[0].area == pytest.approx(80 * 30, rel=0.05)


def test_bridge_closes_door_gap() -> None:
    segments = [
        ((20.0, 20.0), (35.0, 20.0), 0.5),  # bottom wall with a door gap 35..45
        ((45.0, 20.0), (60.0, 20.0), 0.5),
        ((60.0, 20.0), (60.0, 60.0), 0.5),
        ((60.0, 60.0), (20.0, 60.0), 0.5),
        ((20.0, 60.0), (20.0, 20.0), 0.5),
    ]
    page = make_page(segments)
    probs = np.ones(page.segment_count, dtype=np.float32)
    # The 15-unit door stubs are shorter than the default chain gate; chaining
    # has its own tests below, this one exercises bridging.
    config = FaceConfig(min_perimeter_coverage=0.5, chain_min_length_tolerances=0.0)
    assert extract_rooms(page, probs, face_config=config) == []
    bridge = np.asarray([[35.0, 20.0, 45.0, 20.0]], dtype=np.float32)
    faces = extract_rooms(page, probs, face_config=config, bridge_coords=bridge)
    assert len(faces) == 1
    assert faces[0].area == pytest.approx(40 * 40, rel=0.05)


def test_metrics_adapter_scores_perfect_prediction_near_one() -> None:
    page = two_room_page()
    page.has_labels = True
    page.gt_polygons = [
        np.asarray([[10, 10], [50, 10], [50, 40], [10, 40]], dtype=np.float32),
        np.asarray([[50, 10], [90, 10], [90, 40], [50, 40]], dtype=np.float32),
    ]
    probs = np.ones(page.segment_count, dtype=np.float32)
    faces = extract_rooms(page, probs, face_config=FaceConfig(min_perimeter_coverage=0.5))
    row = evaluate_rooms_on_page(page, faces, image_size=512, separator_width=2)
    metrics = aggregate_page_metrics([row])
    assert metrics["pdfTsvMatchedRoomTargets"] == 2
    assert metrics["pdfTsvMatchedRoomMeanIou"] > 0.9
    assert metrics["pdfTsvMatchedRoomRecallAt50"] == 1.0


def test_pipeline_is_scale_invariant() -> None:
    page = two_room_page()
    page.has_labels = True
    page.gt_polygons = [
        np.asarray([[10, 10], [50, 10], [50, 40], [10, 40]], dtype=np.float32),
        np.asarray([[50, 10], [90, 10], [90, 40], [50, 40]], dtype=np.float32),
    ]
    probs = np.ones(page.segment_count, dtype=np.float32)
    config = FaceConfig(min_perimeter_coverage=0.5)

    base_faces = extract_rooms(page, probs, face_config=config)
    base = aggregate_page_metrics([evaluate_rooms_on_page(page, base_faces, image_size=512, separator_width=2)])

    for factor in (0.25, 4.0):
        scaled_page = scale_vector_page(page, factor)
        scaled_faces = extract_rooms(scaled_page, probs, face_config=config)
        scaled = aggregate_page_metrics([evaluate_rooms_on_page(scaled_page, scaled_faces, image_size=512, separator_width=2)])
        assert len(scaled_faces) == len(base_faces)
        assert scaled["pdfTsvMatchedRoomMeanIou"] == pytest.approx(base["pdfTsvMatchedRoomMeanIou"], abs=5e-3)


def test_face_shape_features_scale_invariant() -> None:
    polygon = np.asarray([[10, 10], [50, 10], [50, 40], [10, 40]], dtype=np.float32)
    bounds = (0.0, 0.0, 100.0, 100.0)
    base = face_shape_features(polygon, bounds)
    assert base.shape == (6,)
    scaled = face_shape_features(polygon * 4.0, tuple(value * 4.0 for value in bounds))
    assert np.allclose(base, scaled, atol=1e-6)


def test_prep_config_defaults_referenced_by_face_config() -> None:
    # FaceConfig thresholds are fractions of the snap tolerance; both must stay
    # scale-free (pure fractions), otherwise scale invariance silently breaks.
    prep = VectorPrepConfig()
    face = FaceConfig()
    assert 0 < face.weld_tolerance_fraction < 1
    assert 0 < prep.snap_tolerance_page_fraction < 0.01


def test_chain_filter_keeps_pieced_walls_and_drops_short_strokes() -> None:
    from roomdet.vector_faces import chain_filter_selected

    segments = [
        # wall drawn as four collinear 10-unit pieces (total 40)
        ((10.0, 10.0), (20.0, 10.0), 0.5),
        ((20.0, 10.0), (30.0, 10.0), 0.5),
        ((30.0, 10.0), (40.0, 10.0), 0.5),
        ((40.0, 10.0), (50.0, 10.0), 0.5),
        # perpendicular stub at a wall joint: must not chain into the wall run
        ((30.0, 10.0), (30.0, 13.0), 0.5),
        # isolated short stroke in the room interior (equipment)
        ((60.0, 50.0), (63.0, 50.0), 0.5),
        # gentle arc as near-collinear pieces (5 degrees per joint, total ~30)
        ((10.0, 80.0), (20.0, 80.0), 0.5),
        ((20.0, 80.0), (29.96, 80.87), 0.5),
        ((29.96, 80.87), (39.81, 82.61), 0.5),
    ]
    page = make_page(segments)
    selected = np.arange(page.segment_count, dtype=np.int64)
    kept = chain_filter_selected(
        page.seg_p0,
        page.seg_p1,
        selected,
        min_chain_length=20.0,
        join_tolerance=0.5,
        angle_tolerance_degrees=10.0,
    )
    assert sorted(kept.tolist()) == [0, 1, 2, 3, 6, 7, 8]


def test_chain_filter_defragments_room_split_by_short_strokes() -> None:
    # A single room whose interior is crossed by a zigzag of short strokes
    # (equipment): without the chain filter the zigzag chords the room into two
    # faces; with the default filter the room comes back in one piece.
    segments = [
        *square_walls(10, 10, 90, 40),
        ((50.0, 10.0), (54.0, 18.0), 0.5),
        ((54.0, 18.0), (50.0, 26.0), 0.5),
        ((50.0, 26.0), (54.0, 34.0), 0.5),
        ((54.0, 34.0), (50.0, 40.0), 0.5),
    ]
    page = make_page(segments)
    probs = np.ones(page.segment_count, dtype=np.float32)
    fragmented = extract_rooms(
        page, probs, face_config=FaceConfig(min_perimeter_coverage=0.5, chain_min_length_tolerances=0.0)
    )
    assert len(fragmented) == 2
    faces = extract_rooms(page, probs, face_config=FaceConfig(min_perimeter_coverage=0.5))
    assert len(faces) == 1
    assert faces[0].area == pytest.approx(80 * 30, rel=0.05)


def test_chain_filter_disabled_or_empty_is_identity() -> None:
    from roomdet.vector_faces import chain_filter_selected

    page = make_page(square_walls(20, 20, 60, 60))
    selected = np.arange(page.segment_count, dtype=np.int64)
    unchanged = chain_filter_selected(page.seg_p0, page.seg_p1, selected, 0.0, 0.5)
    assert np.array_equal(unchanged, selected)
    empty = np.zeros(0, dtype=np.int64)
    assert len(chain_filter_selected(page.seg_p0, page.seg_p1, empty, 10.0, 0.5)) == 0
