"""Face extraction: classified segments -> planar arrangement -> room polygons.

Segments with boundary probability above threshold (plus any accepted virtual gap
bridges) are noded into a planar arrangement and polygonized; each candidate face is
scored by how much of its perimeter is supported by high-probability segments.
Everything is in scene space; no rasterization anywhere in this module.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Sequence

import numpy as np

from .vector_dataset import VectorPage, VectorPrepConfig, snap_tolerance, weld_endpoints

FACE_SHAPE_DIM = 6


def chain_filter_selected(
    seg_p0: np.ndarray,
    seg_p1: np.ndarray,
    selected: np.ndarray,
    min_chain_length: float,
    join_tolerance: float,
    angle_tolerance_degrees: float = 10.0,
) -> np.ndarray:
    """Drop selected segments whose near-collinear chain is shorter than min_chain_length.

    Walls survive as long runs of near-touching, near-collinear strokes (chains are
    grown across endpoint welds, so a wall drawn as many short pieces still counts
    its full run length); isolated short strokes (equipment, furniture, text) form
    short chains and are removed before polygonization so they cannot chord a room
    into fragments. Corners do not chain: an L stays two independently-measured runs.
    """
    count = len(selected)
    if count == 0 or min_chain_length <= 0:
        return selected
    p0 = seg_p0[selected].astype(np.float64)
    p1 = seg_p1[selected].astype(np.float64)
    delta = p1 - p0
    # sqrt(dx^2 + dy^2) instead of np.hypot for bit-parity with the TS runtime
    # (same convention as build_segment_features).
    lengths = np.sqrt(delta[:, 0] * delta[:, 0] + delta[:, 1] * delta[:, 1])
    safe_length = np.maximum(lengths, 1e-12)
    ux = delta[:, 0] / safe_length
    uy = delta[:, 1] / safe_length

    parent = np.arange(count, dtype=np.int64)

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = int(parent[index])
        return index

    min_dot = math.cos(math.radians(angle_tolerance_degrees))
    node_ids = weld_endpoints(np.concatenate([p0, p1], axis=0), max(join_tolerance, 1e-9))
    buckets: dict[int, list[int]] = {}
    for point_index, node in enumerate(node_ids):
        buckets.setdefault(int(node), []).append(point_index % count)
    for members in buckets.values():
        unique = list(dict.fromkeys(members))
        for i in range(len(unique)):
            for j in range(i + 1, len(unique)):
                a = unique[i]
                b = unique[j]
                if abs(ux[a] * ux[b] + uy[a] * uy[b]) >= min_dot:
                    root_a = find(a)
                    root_b = find(b)
                    if root_a != root_b:
                        parent[root_b] = root_a

    roots = np.fromiter((find(index) for index in range(count)), dtype=np.int64, count=count)
    chain_length = np.zeros(count, dtype=np.float64)
    np.add.at(chain_length, roots, lengths)
    return selected[chain_length[roots] >= min_chain_length]


def select_boundary_segments(
    seg_p0: np.ndarray,
    seg_p1: np.ndarray,
    probabilities: np.ndarray,
    tolerance: float,
    config: FaceConfig,
) -> np.ndarray:
    """Threshold + chain-filter: the boundary selection every downstream stage uses."""
    selected = np.nonzero(probabilities >= config.threshold)[0].astype(np.int64)
    if config.chain_min_length_tolerances > 0 and len(selected):
        selected = chain_filter_selected(
            seg_p0,
            seg_p1,
            selected,
            min_chain_length=config.chain_min_length_tolerances * tolerance,
            join_tolerance=config.chain_join_tolerance_fraction * tolerance,
            angle_tolerance_degrees=config.chain_angle_tolerance_degrees,
        )
    return selected


@dataclass(frozen=True)
class FaceConfig:
    threshold: float = 0.5
    weld_tolerance_fraction: float = 0.25  # of snap tolerance
    min_area_fraction: float = 5e-5  # of page area
    max_area_fraction: float = 0.35
    min_perimeter_coverage: float = 0.55
    # Faces narrower on average than the snap tolerance are slivers between double
    # wall lines / door frames, not rooms (mean width ~ 2*area/perimeter).
    min_mean_width_tolerance_factor: float = 1.0
    simplify_fraction: float = 0.5  # of snap tolerance
    max_perimeter_samples: int = 256
    # Boundary segments must belong to a near-collinear chain at least this many
    # snap tolerances long (walls chain up across piecewise strokes; equipment and
    # furniture form short chains that would otherwise chord rooms into fragments).
    # 0 disables the filter.
    chain_min_length_tolerances: float = 8.0
    chain_angle_tolerance_degrees: float = 10.0
    chain_join_tolerance_fraction: float = 0.5  # of snap tolerance


@dataclass
class RoomFace:
    polygon: np.ndarray  # (K, 2) exterior ring, scene space
    holes: list[np.ndarray] = field(default_factory=list)
    coverage: float = 0.0
    mean_probability: float = 0.0
    area: float = 0.0
    member_segments: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.int64))
    class_id: int | None = None


def _require_shapely():
    try:
        import shapely  # noqa: F401
        from shapely import geometry, ops  # noqa: F401
    except ModuleNotFoundError as error:
        raise RuntimeError("Face extraction requires shapely>=2.0. Install ml/room-detection/requirements.txt.") from error
    import shapely

    return shapely


def polygonize_boundary_segments(
    seg_p0: np.ndarray,
    seg_p1: np.ndarray,
    selected: np.ndarray,
    weld_tolerance: float,
    bridge_coords: np.ndarray | None = None,
):
    """Node the selected segments (+ virtual bridges) and return arrangement faces."""
    shapely = _require_shapely()
    from shapely.geometry import MultiLineString
    from shapely.ops import polygonize, unary_union

    lines: list[tuple[tuple[float, float], tuple[float, float]]] = [
        ((float(seg_p0[i, 0]), float(seg_p0[i, 1])), (float(seg_p1[i, 0]), float(seg_p1[i, 1]))) for i in selected
    ]
    if bridge_coords is not None:
        lines.extend(
            ((float(ax), float(ay)), (float(bx), float(by))) for ax, ay, bx, by in bridge_coords
        )
    if not lines:
        return []

    linework = MultiLineString(lines)
    if weld_tolerance > 0:
        linework = shapely.set_precision(linework, grid_size=weld_tolerance)
    noded = unary_union(linework)
    return [polygon for polygon in polygonize(noded) if not polygon.is_empty]


def score_faces(
    faces: Sequence[object],
    seg_p0: np.ndarray,
    seg_p1: np.ndarray,
    probabilities: np.ndarray,
    selected: np.ndarray,
    tolerance: float,
    page_bounds: tuple[float, float, float, float],
    config: FaceConfig,
) -> list[RoomFace]:
    """Perimeter-support scoring; keeps faces that look like rooms."""
    _require_shapely()
    from shapely.geometry import LineString, Point
    from shapely.strtree import STRtree

    min_x, min_y, max_x, max_y = page_bounds
    page_area = max((max_x - min_x) * (max_y - min_y), 1e-9)

    segment_geoms = [
        LineString([(float(seg_p0[i, 0]), float(seg_p0[i, 1])), (float(seg_p1[i, 0]), float(seg_p1[i, 1]))])
        for i in selected
    ]
    if not segment_geoms:
        return []
    tree = STRtree(segment_geoms)
    selected_probs = probabilities[selected]

    accepted: list[RoomFace] = []
    for face in faces:
        area = float(face.area)
        if area < config.min_area_fraction * page_area or area > config.max_area_fraction * page_area:
            continue

        exterior = face.exterior
        perimeter = float(exterior.length)
        if 2.0 * area / max(perimeter, 1e-9) < config.min_mean_width_tolerance_factor * tolerance:
            continue
        sample_count = int(min(config.max_perimeter_samples, max(8, math.ceil(perimeter / max(tolerance, 1e-9)))))
        supported = 0
        supporting: set[int] = set()
        support_prob_sum = 0.0
        for step in range(sample_count):
            point = exterior.interpolate((step + 0.5) / sample_count, normalized=True)
            nearest_index = int(tree.nearest(point))
            if segment_geoms[nearest_index].distance(point) <= tolerance:
                supported += 1
                supporting.add(nearest_index)
                support_prob_sum += float(selected_probs[nearest_index])
        coverage = supported / sample_count
        if coverage < config.min_perimeter_coverage:
            continue

        simplified = face.simplify(config.simplify_fraction * tolerance, preserve_topology=True)
        if simplified.is_empty or simplified.geom_type != "Polygon":
            simplified = face
        accepted.append(
            RoomFace(
                polygon=np.asarray(simplified.exterior.coords, dtype=np.float32)[:-1],
                holes=[np.asarray(ring.coords, dtype=np.float32)[:-1] for ring in simplified.interiors],
                coverage=coverage,
                mean_probability=support_prob_sum / max(1, supported),
                area=area,
                member_segments=np.asarray(sorted(selected[list(supporting)]), dtype=np.int64),
            )
        )
    return accepted


def extract_rooms(
    page: VectorPage,
    probabilities: np.ndarray,
    face_config: FaceConfig | None = None,
    prep_config: VectorPrepConfig | None = None,
    bridge_coords: np.ndarray | None = None,
) -> list[RoomFace]:
    """Full geometric stage: probabilities -> arrangement -> scored room faces."""
    face_config = face_config or FaceConfig()
    prep_config = prep_config or VectorPrepConfig()
    tolerance = snap_tolerance(page, prep_config)
    weld_tolerance = tolerance * face_config.weld_tolerance_fraction

    selected = select_boundary_segments(page.seg_p0, page.seg_p1, probabilities, tolerance, face_config)
    if len(selected) == 0:
        return []
    faces = polygonize_boundary_segments(page.seg_p0, page.seg_p1, selected, weld_tolerance, bridge_coords)
    if not faces:
        return []
    return score_faces(
        faces,
        page.seg_p0,
        page.seg_p1,
        probabilities,
        selected,
        tolerance,
        page.page_bounds,
        face_config,
    )


def face_shape_features(polygon: np.ndarray, page_bounds: tuple[float, float, float, float]) -> np.ndarray:
    """Scale-invariant shape descriptor for the room-type head, shape (FACE_SHAPE_DIM,)."""
    min_x, min_y, max_x, max_y = page_bounds
    diag = max(math.hypot(max_x - min_x, max_y - min_y), 1e-9)
    page_area = max((max_x - min_x) * (max_y - min_y), 1e-9)

    xs = polygon[:, 0].astype(np.float64)
    ys = polygon[:, 1].astype(np.float64)
    area = 0.5 * abs(float(np.dot(xs, np.roll(ys, -1)) - np.dot(ys, np.roll(xs, -1))))
    perimeter = float(np.hypot(np.diff(np.append(xs, xs[0])), np.diff(np.append(ys, ys[0]))).sum())
    width = float(xs.max() - xs.min()) or 1e-9
    height = float(ys.max() - ys.min()) or 1e-9

    return np.asarray(
        [
            math.sqrt(max(area, 0.0)) / diag,
            math.log1p(area / page_area * 100.0),
            min(width, height) / max(width, height),
            4.0 * math.pi * area / max(perimeter * perimeter, 1e-9),
            min(len(polygon), 64) / 64.0,
            perimeter / diag,
        ],
        dtype=np.float32,
    )


def pooled_face_embedding(embedding: np.ndarray, member_segments: np.ndarray) -> np.ndarray:
    """Mean member-segment embedding (zeros when a face somehow has no members)."""
    if len(member_segments) == 0:
        return np.zeros(embedding.shape[1], dtype=np.float32)
    return embedding[member_segments].mean(axis=0).astype(np.float32)
