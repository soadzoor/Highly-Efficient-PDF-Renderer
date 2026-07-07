"""Vector-native room detection: segment dumps, TSV ground truth mapping, labels.

Consumes the gzipped JSON dumps written by scripts/extract-segments.mjs (one per PDF,
same segments the browser extractor produces) and derives dense per-segment
supervision from the human-drawn TSV polygons:

- GT polygons are mapped into scene space with the dumped sceneMatrix and then
  *snapped* to nearby stroke geometry (the TSV geometry is hand-traced and drifts a
  few points off the actual walls).
- Each segment gets a boundary label = fraction of its length lying on the snapped
  GT boundary (angle-gated), plus the owning GT polygon index.
- Free-endpoint pairs of boundary segments become gap-bridge candidates, labelled
  positive when the straight bridge follows the snapped GT boundary through ink-free
  space (doors, wall gaps).

Everything geometric is normalized by page diagonal / median stroke stats so the
learning problem is scale invariant.
"""

from __future__ import annotations

import gzip
import json
import math
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np

from .classes import PDF_TSV_CLINICAL_CLASSES, pdf_tsv_room_type_label
from .pdf_tsv_dataset import Point, filter_exterior_tsv_rows, parse_pdf_tsv_geometry, sanitize_stem

SEGMENT_FLAG_HAIRLINE = 1 << 0
SEGMENT_FLAG_ROUND_CAP = 1 << 1
SEGMENT_FLAG_CLIPPED = 1 << 2
SEGMENT_FLAG_FILL_OUTLINE = 1 << 3
SEGMENT_FLAG_QUADRATIC = 1 << 4

FEATURE_DIM = 21
EDGE_FEATURE_DIM = 6

CLINICAL_LABEL_TO_ID = {spec.label: spec.id for spec in PDF_TSV_CLINICAL_CLASSES}


@dataclass(frozen=True)
class VectorPrepConfig:
    """Knobs for label derivation; recorded alongside every prepared page."""

    snap_tolerance_page_fraction: float = 0.002
    snap_tolerance_min_halfwidths: float = 4.0
    angle_tolerance_degrees: float = 10.0
    boundary_positive_fraction: float = 0.5
    boundary_samples_max: int = 9
    weld_tolerance_fraction: float = 0.25
    bridge_radius_halfwidths: float = 24.0
    bridge_radius_page_fraction_max: float = 0.04
    bridge_min_length_fraction: float = 0.1
    bridge_positive_support: float = 0.8


@dataclass
class VectorPage:
    """A single PDF page as segments + (optional) ground truth, all in scene space."""

    stem: str
    folder: str
    source_pdf: str
    scene_matrix: tuple[float, float, float, float, float, float]
    page_bounds: tuple[float, float, float, float]
    seg_p0: np.ndarray  # (N, 2) float32
    seg_p1: np.ndarray  # (N, 2) float32
    half_width: np.ndarray  # (N,) float32
    color: np.ndarray  # (N, 3) float32
    alpha: np.ndarray  # (N,) float32
    flags: np.ndarray  # (N,) uint8
    has_labels: bool = False
    label_boundary: np.ndarray | None = None  # (N,) float32 support fraction
    label_positive: np.ndarray | None = None  # (N,) uint8
    owner: np.ndarray | None = None  # (N,) int32 GT polygon index or -1
    gt_polygons: list[np.ndarray] = field(default_factory=list)  # raw scene space
    snapped_polygons: list[np.ndarray] = field(default_factory=list)
    gt_room_types: list[str] = field(default_factory=list)
    gt_room_numbers: list[str] = field(default_factory=list)
    gt_class_ids: np.ndarray | None = None  # (P,) int64 clinical-coarse ids
    bridge_a: np.ndarray | None = None  # (C,) int64 segment index
    bridge_b: np.ndarray | None = None  # (C,) int64 segment index
    bridge_coords: np.ndarray | None = None  # (C, 4) float32 endpoint pairs
    bridge_pos: np.ndarray | None = None  # (C,) uint8
    stats: dict[str, object] = field(default_factory=dict)

    @property
    def segment_count(self) -> int:
        return int(self.seg_p0.shape[0])

    @property
    def page_diag(self) -> float:
        min_x, min_y, max_x, max_y = self.page_bounds
        return float(math.hypot(max_x - min_x, max_y - min_y)) or 1.0


def load_segment_dump(path: Path) -> VectorPage:
    """Load a scripts/extract-segments.mjs dump into flat segment arrays."""
    with gzip.open(path, "rt", encoding="utf-8") as file:
        dump = json.load(file)

    endpoints = np.asarray(dump["strokes"]["endpoints"], dtype=np.float32).reshape(-1, 4)
    meta = np.asarray(dump["strokes"]["primitiveMeta"], dtype=np.float64).reshape(-1, 4)
    styles = np.asarray(dump["strokes"]["styles"], dtype=np.float32).reshape(-1, 4)

    stroke_flags_raw = np.floor(meta[:, 3] / 2.0 + 1e-6).astype(np.int64)
    stroke_alpha = np.clip(meta[:, 3] - stroke_flags_raw * 2.0, 0.0, 1.0).astype(np.float32)
    stroke_flags = (stroke_flags_raw & 0b111).astype(np.uint8)
    stroke_flags = stroke_flags | np.where(meta[:, 2] >= 0.5, SEGMENT_FLAG_QUADRATIC, 0).astype(np.uint8)

    seg_p0 = [endpoints[:, 0:2]]
    seg_p1 = [endpoints[:, 2:4]]
    half_width = [styles[:, 0]]
    color = [styles[:, 1:4]]
    alpha = [stroke_alpha]
    flags = [stroke_flags]

    fills = dump.get("fills", {})
    fill_meta_a = np.asarray(fills.get("pathMetaA", []), dtype=np.float64).reshape(-1, 4)
    fill_meta_b = np.asarray(fills.get("pathMetaB", []), dtype=np.float64).reshape(-1, 4)
    fill_meta_c = np.asarray(fills.get("pathMetaC", []), dtype=np.float64).reshape(-1, 4)
    fill_a = np.asarray(fills.get("segmentsA", []), dtype=np.float32).reshape(-1, 4)
    fill_b = np.asarray(fills.get("segmentsB", []), dtype=np.float32).reshape(-1, 4)
    if len(fill_meta_a) and len(fill_a):
        fill_color = np.zeros((len(fill_a), 3), dtype=np.float32)
        fill_alpha = np.zeros(len(fill_a), dtype=np.float32)
        for path_index in range(len(fill_meta_a)):
            start = int(fill_meta_a[path_index, 0])
            count = int(fill_meta_a[path_index, 1])
            fill_color[start : start + count, 0] = fill_meta_b[path_index, 2]
            fill_color[start : start + count, 1] = fill_meta_b[path_index, 3]
            fill_color[start : start + count, 2] = fill_meta_c[path_index, 2]
            fill_alpha[start : start + count] = fill_meta_c[path_index, 3]
        fill_p0 = fill_a[:, 0:2]
        fill_p1 = np.where(fill_b[:, 2:3] >= 0.5, fill_b[:, 0:2], fill_a[:, 2:4])
        fill_flags = np.full(len(fill_a), SEGMENT_FLAG_FILL_OUTLINE, dtype=np.uint8)
        fill_flags = fill_flags | np.where(fill_b[:, 2] >= 0.5, SEGMENT_FLAG_QUADRATIC, 0).astype(np.uint8)
        seg_p0.append(fill_p0)
        seg_p1.append(fill_p1)
        half_width.append(np.zeros(len(fill_a), dtype=np.float32))
        color.append(fill_color)
        alpha.append(fill_alpha)
        flags.append(fill_flags)

    page = dump["page"]
    page_bounds = dump["sceneStats"]["pageBounds"]
    return VectorPage(
        stem=str(dump["stem"]),
        folder=str(dump.get("folder", ".")),
        source_pdf=str(dump.get("sourcePdf", "")),
        scene_matrix=tuple(float(value) for value in page["sceneMatrix"]),
        page_bounds=tuple(float(value) for value in page_bounds),
        seg_p0=np.ascontiguousarray(np.concatenate(seg_p0, axis=0), dtype=np.float32),
        seg_p1=np.ascontiguousarray(np.concatenate(seg_p1, axis=0), dtype=np.float32),
        half_width=np.concatenate(half_width, axis=0).astype(np.float32),
        color=np.concatenate(color, axis=0).astype(np.float32),
        alpha=np.concatenate(alpha, axis=0).astype(np.float32),
        flags=np.concatenate(flags, axis=0).astype(np.uint8),
        stats={
            "sourceSegmentCount": int(dump["sceneStats"].get("sourceSegmentCount", 0)),
            "boundsMismatch": bool(dump.get("boundsMismatch", False)),
        },
    )


def transform_points(matrix: Sequence[float], points: np.ndarray) -> np.ndarray:
    a, b, c, d, e, f = (float(value) for value in matrix)
    out = np.empty_like(points, dtype=np.float64)
    out[:, 0] = a * points[:, 0] + c * points[:, 1] + e
    out[:, 1] = b * points[:, 0] + d * points[:, 1] + f
    return out.astype(np.float32)


def load_tsv_ground_truth(tsv_path: Path, scene_matrix: Sequence[float]) -> tuple[list[np.ndarray], list[str], list[str], dict[str, int]]:
    """Parse the TSV, drop the exterior shell, map polygons into scene space."""
    parsed = parse_pdf_tsv_geometry(tsv_path)
    polygons, room_types, room_numbers, exterior_rows = filter_exterior_tsv_rows(parsed)
    scene_polygons = [
        transform_points(scene_matrix, np.asarray([(point.x, point.y) for point in polygon], dtype=np.float64))
        for polygon in polygons
    ]
    stats = {"rows": parsed.row_count, "skippedRows": parsed.skipped_rows, "exteriorRows": exterior_rows}
    return scene_polygons, room_types, room_numbers, stats


def _segment_cells(ax: float, ay: float, bx: float, by: float, cell: float):
    """Grid cells a segment passes through (Amanatides-Woo traversal).

    Inserting only traversed cells (not the segment's whole bounding box) keeps
    hatching-heavy sheets tractable: one page-spanning diagonal touches O(length)
    cells instead of O(width x height).
    """
    x0 = ax / cell
    y0 = ay / cell
    x1 = bx / cell
    y1 = by / cell
    cx = math.floor(x0)
    cy = math.floor(y0)
    end_cx = math.floor(x1)
    end_cy = math.floor(y1)
    yield cx, cy
    if cx == end_cx and cy == end_cy:
        return

    dx = x1 - x0
    dy = y1 - y0
    step_x = 1 if dx > 0 else -1
    step_y = 1 if dy > 0 else -1
    t_max_x = ((cx + (step_x > 0)) - x0) / dx if dx != 0 else math.inf
    t_delta_x = abs(1.0 / dx) if dx != 0 else math.inf
    t_max_y = ((cy + (step_y > 0)) - y0) / dy if dy != 0 else math.inf
    t_delta_y = abs(1.0 / dy) if dy != 0 else math.inf

    max_steps = abs(end_cx - cx) + abs(end_cy - cy) + 4
    for _ in range(max_steps):
        if t_max_x < t_max_y:
            cx += step_x
            t_max_x += t_delta_x
        else:
            cy += step_y
            t_max_y += t_delta_y
        yield cx, cy
        if cx == end_cx and cy == end_cy:
            return


class _SegmentGrid:
    """Uniform hash grid over segments for near-neighbour queries by point."""

    def __init__(self, p0: np.ndarray, p1: np.ndarray, cell: float) -> None:
        self.p0 = p0.astype(np.float64)
        self.p1 = p1.astype(np.float64)
        self.cell = max(cell, 1e-6)
        self.buckets: dict[tuple[int, int], list[int]] = {}
        for index in range(len(p0)):
            for key in _segment_cells(
                self.p0[index, 0], self.p0[index, 1], self.p1[index, 0], self.p1[index, 1], self.cell
            ):
                self.buckets.setdefault(key, []).append(index)

    def near(self, x: float, y: float) -> list[int]:
        cx = int(math.floor(x / self.cell))
        cy = int(math.floor(y / self.cell))
        result: list[int] = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                result.extend(self.buckets.get((cx + dx, cy + dy), ()))
        return result


def point_segment_distance(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> tuple[float, float]:
    """Distance from point to segment and the projection parameter t in [0, 1]."""
    dx = bx - ax
    dy = by - ay
    length_sq = dx * dx + dy * dy
    if length_sq <= 1e-18:
        return math.hypot(px - ax, py - ay), 0.0
    t = ((px - ax) * dx + (py - ay) * dy) / length_sq
    t = min(1.0, max(0.0, t))
    qx = ax + t * dx
    qy = ay + t * dy
    return math.hypot(px - qx, py - qy), t


def snap_tolerance(page: VectorPage, config: VectorPrepConfig) -> float:
    stroke_mask = (page.flags & SEGMENT_FLAG_FILL_OUTLINE) == 0
    median_half_width = float(np.median(page.half_width[stroke_mask])) if stroke_mask.any() else 0.0
    return max(
        config.snap_tolerance_page_fraction * page.page_diag,
        config.snap_tolerance_min_halfwidths * median_half_width,
    )


def snap_polygon_to_segments(polygon: np.ndarray, grid: _SegmentGrid, tolerance: float) -> np.ndarray:
    """Pull each hand-drawn vertex onto nearby stroke geometry.

    Room corners are usually stroke endpoints/intersections, so an endpoint wins
    over a mid-segment projection unless the projection is over twice as close.
    """
    snapped = polygon.astype(np.float64).copy()
    for vertex_index in range(len(snapped)):
        px, py = snapped[vertex_index]
        endpoint_distance = math.inf
        endpoint_point: tuple[float, float] | None = None
        projection_distance = math.inf
        projection_point: tuple[float, float] | None = None
        for seg_index in grid.near(px, py):
            ax, ay = grid.p0[seg_index]
            bx, by = grid.p1[seg_index]
            for ex, ey in ((ax, ay), (bx, by)):
                distance = math.hypot(px - ex, py - ey)
                if distance < endpoint_distance:
                    endpoint_distance = distance
                    endpoint_point = (ex, ey)
            distance, t = point_segment_distance(px, py, ax, ay, bx, by)
            if distance < projection_distance:
                projection_distance = distance
                projection_point = (ax + t * (bx - ax), ay + t * (by - ay))
        if endpoint_point is not None and endpoint_distance <= tolerance and endpoint_distance <= projection_distance * 2.0:
            snapped[vertex_index] = endpoint_point
        elif projection_point is not None and projection_distance <= tolerance:
            snapped[vertex_index] = projection_point
    return snapped.astype(np.float32)


class _EdgeGrid:
    """Uniform hash grid over GT polygon edges, keeping owner polygon + direction."""

    def __init__(self, polygons: Sequence[np.ndarray], cell: float) -> None:
        self.cell = max(cell, 1e-6)
        edges: list[tuple[float, float, float, float, int]] = []
        for polygon_index, polygon in enumerate(polygons):
            count = len(polygon)
            for i in range(count):
                ax, ay = polygon[i]
                bx, by = polygon[(i + 1) % count]
                if abs(bx - ax) + abs(by - ay) <= 1e-9:
                    continue
                edges.append((float(ax), float(ay), float(bx), float(by), polygon_index))
        self.edges = edges
        self.buckets: dict[tuple[int, int], list[int]] = {}
        for edge_index, (ax, ay, bx, by, _) in enumerate(edges):
            for key in _segment_cells(ax, ay, bx, by, self.cell):
                self.buckets.setdefault(key, []).append(edge_index)

    def near(self, x: float, y: float) -> list[int]:
        cx = int(math.floor(x / self.cell))
        cy = int(math.floor(y / self.cell))
        result: list[int] = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                result.extend(self.buckets.get((cx + dx, cy + dy), ()))
        return result

    def support(self, px: float, py: float, seg_dir: tuple[float, float] | None, tolerance: float, max_cross: float) -> int:
        """Owner polygon of the closest aligned edge within tolerance, else -1."""
        best_distance = tolerance
        best_owner = -1
        for edge_index in self.near(px, py):
            ax, ay, bx, by, owner = self.edges[edge_index]
            distance, _ = point_segment_distance(px, py, ax, ay, bx, by)
            if distance > best_distance:
                continue
            if seg_dir is not None:
                ex = bx - ax
                ey = by - ay
                edge_length = math.hypot(ex, ey)
                if edge_length > 1e-9:
                    cross = abs(seg_dir[0] * (ey / edge_length) - seg_dir[1] * (ex / edge_length))
                    if cross > max_cross:
                        continue
            best_distance = distance
            best_owner = owner
        return best_owner


def derive_segment_labels(
    page: VectorPage,
    snapped_polygons: Sequence[np.ndarray],
    config: VectorPrepConfig,
    progress: "callable | None" = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per segment: boundary support fraction, positive flag, owning polygon index."""
    count = page.segment_count
    support = np.zeros(count, dtype=np.float32)
    owner = np.full(count, -1, dtype=np.int32)
    positive = np.zeros(count, dtype=np.uint8)
    if not snapped_polygons or count == 0:
        return support, positive, owner

    tolerance = snap_tolerance(page, config)
    max_cross = math.sin(math.radians(config.angle_tolerance_degrees))
    edge_grid = _EdgeGrid(snapped_polygons, cell=tolerance * 2.0)

    p0 = page.seg_p0.astype(np.float64)
    p1 = page.seg_p1.astype(np.float64)
    delta = p1 - p0
    lengths = np.hypot(delta[:, 0], delta[:, 1])

    progress_step = max(1, count // 50)
    for index in range(count):
        if progress is not None and index % progress_step == 0:
            progress(index / count)
        length = lengths[index]
        sample_count = int(min(config.boundary_samples_max, max(2, math.ceil(length / max(tolerance, 1e-6)) + 1)))
        direction = None
        if length > 1e-9:
            direction = (delta[index, 0] / length, delta[index, 1] / length)
        hits = 0
        owner_votes: dict[int, int] = {}
        for step in range(sample_count):
            t = step / (sample_count - 1) if sample_count > 1 else 0.5
            px = p0[index, 0] + delta[index, 0] * t
            py = p0[index, 1] + delta[index, 1] * t
            vote = edge_grid.support(px, py, direction, tolerance, max_cross)
            if vote >= 0:
                hits += 1
                owner_votes[vote] = owner_votes.get(vote, 0) + 1
        if hits:
            support[index] = hits / sample_count
            owner[index] = max(owner_votes.items(), key=lambda item: item[1])[0]

    positive = (support >= config.boundary_positive_fraction).astype(np.uint8)
    owner[positive == 0] = -1
    return support, positive, owner


def weld_endpoints(points: np.ndarray, tolerance: float) -> np.ndarray:
    """Map each point to a welded-node id (grid quantization at tolerance)."""
    quantized = np.round(points / max(tolerance, 1e-9)).astype(np.int64)
    _, inverse = np.unique(quantized, axis=0, return_inverse=True)
    return inverse


def free_endpoints(seg_p0: np.ndarray, seg_p1: np.ndarray, indices: np.ndarray, weld_tol: float) -> tuple[np.ndarray, np.ndarray]:
    """Endpoints of the given segments with welded degree 1 -> (segment idx, xy)."""
    if len(indices) == 0:
        return np.zeros(0, dtype=np.int64), np.zeros((0, 2), dtype=np.float32)
    stacked = np.concatenate([seg_p0[indices], seg_p1[indices]], axis=0)
    node_ids = weld_endpoints(stacked.astype(np.float64), weld_tol)
    counts = np.bincount(node_ids)
    is_free = counts[node_ids] == 1
    seg_indices = np.concatenate([indices, indices], axis=0)
    return seg_indices[is_free], stacked[is_free]


def build_bridge_candidates(
    page: VectorPage,
    boundary_mask: np.ndarray,
    config: VectorPrepConfig,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Free-endpoint pairs within the bridge radius -> (seg_a, seg_b, points(C,4), radius)."""
    indices = np.nonzero(boundary_mask)[0].astype(np.int64)
    tolerance = snap_tolerance(page, config)
    weld_tol = max(tolerance * config.weld_tolerance_fraction, 1e-6)
    boundary_half_widths = page.half_width[indices]
    median_half_width = float(np.median(boundary_half_widths)) if len(indices) else 0.0
    radius = min(
        max(config.bridge_radius_halfwidths * max(median_half_width, 1e-3), tolerance * 4.0),
        config.bridge_radius_page_fraction_max * page.page_diag,
    )

    seg_of_point, points = free_endpoints(page.seg_p0, page.seg_p1, indices, weld_tol)
    if len(points) < 2:
        return (
            np.zeros(0, dtype=np.int64),
            np.zeros(0, dtype=np.int64),
            np.zeros((0, 4), dtype=np.float32),
            np.float32(radius),
        )

    from scipy.spatial import cKDTree

    tree = cKDTree(points)
    pairs = sorted(tree.query_pairs(r=radius))
    seg_a: list[int] = []
    seg_b: list[int] = []
    coords: list[tuple[float, float, float, float]] = []
    min_length = config.bridge_min_length_fraction * tolerance
    for i, j in pairs:
        if seg_of_point[i] == seg_of_point[j]:
            continue
        ax, ay = points[i]
        bx, by = points[j]
        if math.hypot(bx - ax, by - ay) < min_length:
            continue
        seg_a.append(int(seg_of_point[i]))
        seg_b.append(int(seg_of_point[j]))
        coords.append((float(ax), float(ay), float(bx), float(by)))
    return (
        np.asarray(seg_a, dtype=np.int64),
        np.asarray(seg_b, dtype=np.int64),
        np.asarray(coords, dtype=np.float32).reshape(-1, 4),
        np.float32(radius),
    )


BRIDGE_PAIR_FEATURE_DIM = 8


def build_bridge_features(
    seg_p0: np.ndarray,
    seg_p1: np.ndarray,
    half_width: np.ndarray,
    seg_a: np.ndarray,
    seg_b: np.ndarray,
    coords: np.ndarray,
    normalizers: "PageNormalizers",
) -> np.ndarray:
    """Scale-invariant pair features for bridge candidates, shape (C, 8)."""
    count = len(seg_a)
    features = np.zeros((count, BRIDGE_PAIR_FEATURE_DIM), dtype=np.float32)
    if count == 0:
        return features
    ux, uy = segment_directions(seg_p0, seg_p1)
    delta_x = coords[:, 2] - coords[:, 0]
    delta_y = coords[:, 3] - coords[:, 1]
    length = np.maximum(np.hypot(delta_x, delta_y), 1e-9)
    bridge_ux = delta_x / length
    bridge_uy = delta_y / length
    median_hw = max(normalizers.median_half_width, 1e-9)

    features[:, 0] = np.log1p(length / (2.0 * median_hw))
    features[:, 1] = length / normalizers.diag
    features[:, 2] = np.clip(length / (24.0 * median_hw), 0.0, 4.0)
    features[:, 3] = np.abs(bridge_ux * ux[seg_a] + bridge_uy * uy[seg_a])
    features[:, 4] = np.abs(bridge_ux * ux[seg_b] + bridge_uy * uy[seg_b])
    features[:, 5] = np.abs(ux[seg_a] * ux[seg_b] + uy[seg_a] * uy[seg_b])
    features[:, 6] = np.abs(ux[seg_a] * uy[seg_b] - uy[seg_a] * ux[seg_b])
    hw_a = np.maximum(half_width[seg_a], 1e-9)
    hw_b = np.maximum(half_width[seg_b], 1e-9)
    features[:, 7] = np.minimum(hw_a, hw_b) / np.maximum(hw_a, hw_b)
    return features


def label_bridge_candidates(
    coords: np.ndarray,
    snapped_polygons: Sequence[np.ndarray],
    tolerance: float,
    config: VectorPrepConfig,
) -> np.ndarray:
    """A candidate is positive when the straight bridge tracks the GT boundary."""
    labels = np.zeros(len(coords), dtype=np.uint8)
    if not len(coords) or not snapped_polygons:
        return labels
    edge_grid = _EdgeGrid(snapped_polygons, cell=tolerance * 2.0)
    for index, (ax, ay, bx, by) in enumerate(coords):
        length = math.hypot(bx - ax, by - ay)
        sample_count = int(min(16, max(3, math.ceil(length / max(tolerance, 1e-6)) + 1)))
        hits = 0
        for step in range(sample_count):
            t = step / (sample_count - 1)
            px = ax + (bx - ax) * t
            py = ay + (by - ay) * t
            if edge_grid.support(px, py, None, tolerance, 1.0) >= 0:
                hits += 1
        if hits / sample_count >= config.bridge_positive_support:
            labels[index] = 1
    return labels


def prepare_vector_page(
    page: VectorPage,
    tsv_path: Path | None,
    config: VectorPrepConfig,
    progress: "callable | None" = None,
) -> VectorPage:
    """Attach GT, snapped GT, per-segment labels and bridge candidates to a page."""
    if tsv_path is None:
        page.has_labels = True  # negative page: everything is background
        page.label_boundary = np.zeros(page.segment_count, dtype=np.float32)
        page.label_positive = np.zeros(page.segment_count, dtype=np.uint8)
        page.owner = np.full(page.segment_count, -1, dtype=np.int32)
        page.gt_class_ids = np.zeros(0, dtype=np.int64)
        page.bridge_a = np.zeros(0, dtype=np.int64)
        page.bridge_b = np.zeros(0, dtype=np.int64)
        page.bridge_coords = np.zeros((0, 4), dtype=np.float32)
        page.bridge_pos = np.zeros(0, dtype=np.uint8)
        return page

    polygons, room_types, room_numbers, tsv_stats = load_tsv_ground_truth(tsv_path, page.scene_matrix)
    tolerance = snap_tolerance(page, config)
    grid = _SegmentGrid(page.seg_p0, page.seg_p1, cell=tolerance * 2.0) if page.segment_count else None
    snapped = [
        snap_polygon_to_segments(polygon, grid, tolerance) if grid is not None else polygon.astype(np.float32)
        for polygon in polygons
    ]
    support, positive, owner = derive_segment_labels(page, snapped, config, progress=progress)
    bridge_a, bridge_b, bridge_coords, bridge_radius = build_bridge_candidates(page, positive.astype(bool), config)
    bridge_pos = label_bridge_candidates(bridge_coords, snapped, tolerance, config)

    snap_moves = [
        float(np.hypot(*(snapped_polygon - polygon).T).mean()) if len(polygon) else 0.0
        for polygon, snapped_polygon in zip(polygons, snapped)
    ]
    page.has_labels = True
    page.gt_polygons = polygons
    page.snapped_polygons = snapped
    page.gt_room_types = room_types
    page.gt_room_numbers = room_numbers
    page.gt_class_ids = np.asarray(
        [CLINICAL_LABEL_TO_ID[pdf_tsv_room_type_label(room_type)] for room_type in room_types],
        dtype=np.int64,
    )
    page.label_boundary = support
    page.label_positive = positive
    page.owner = owner
    page.bridge_a = bridge_a
    page.bridge_b = bridge_b
    page.bridge_coords = bridge_coords
    page.bridge_pos = bridge_pos
    page.stats.update(
        {
            **tsv_stats,
            "snapTolerance": tolerance,
            "meanSnapMove": float(np.mean(snap_moves)) if snap_moves else 0.0,
            "positiveSegments": int(positive.sum()),
            "positiveFraction": float(positive.mean()) if len(positive) else 0.0,
            "gtPerimeterSupport": gt_perimeter_support(page, snapped, tolerance),
            "bridgeCandidates": int(len(bridge_a)),
            "bridgePositives": int(bridge_pos.sum()),
            "bridgeRadius": float(bridge_radius),
        }
    )
    return page


def gt_perimeter_support(page: VectorPage, snapped_polygons: Sequence[np.ndarray], tolerance: float) -> float:
    """Fraction of GT perimeter that has stroke ink nearby (M0 milestone metric)."""
    if not snapped_polygons or page.segment_count == 0:
        return 0.0
    grid = _SegmentGrid(page.seg_p0, page.seg_p1, cell=tolerance * 2.0)
    supported = 0
    total = 0
    for polygon in snapped_polygons:
        count = len(polygon)
        for i in range(count):
            ax, ay = polygon[i]
            bx, by = polygon[(i + 1) % count]
            length = math.hypot(bx - ax, by - ay)
            samples = int(min(12, max(2, math.ceil(length / max(tolerance, 1e-6)))))
            for step in range(samples):
                t = (step + 0.5) / samples
                px = ax + (bx - ax) * t
                py = ay + (by - ay) * t
                total += 1
                for seg_index in grid.near(px, py):
                    distance, _ = point_segment_distance(
                        px, py, grid.p0[seg_index, 0], grid.p0[seg_index, 1], grid.p1[seg_index, 0], grid.p1[seg_index, 1]
                    )
                    if distance <= tolerance:
                        supported += 1
                        break
    return supported / max(1, total)


# ---------------------------------------------------------------------------
# npz round-trip
# ---------------------------------------------------------------------------


def _pack_polygons(polygons: Sequence[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    if not polygons:
        return np.zeros((0, 2), dtype=np.float32), np.zeros(1, dtype=np.int64)
    offsets = np.zeros(len(polygons) + 1, dtype=np.int64)
    for index, polygon in enumerate(polygons):
        offsets[index + 1] = offsets[index] + len(polygon)
    points = np.concatenate([polygon.astype(np.float32) for polygon in polygons], axis=0)
    return points, offsets


def _unpack_polygons(points: np.ndarray, offsets: np.ndarray) -> list[np.ndarray]:
    return [points[offsets[i] : offsets[i + 1]].copy() for i in range(len(offsets) - 1)]


def save_vector_page(page: VectorPage, path: Path) -> None:
    gt_points, gt_offsets = _pack_polygons(page.gt_polygons)
    snapped_points, snapped_offsets = _pack_polygons(page.snapped_polygons)
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        path,
        stem=np.str_(page.stem),
        folder=np.str_(page.folder),
        source_pdf=np.str_(page.source_pdf),
        scene_matrix=np.asarray(page.scene_matrix, dtype=np.float64),
        page_bounds=np.asarray(page.page_bounds, dtype=np.float64),
        seg_p0=page.seg_p0,
        seg_p1=page.seg_p1,
        half_width=page.half_width,
        color=page.color,
        alpha=page.alpha,
        flags=page.flags,
        has_labels=np.bool_(page.has_labels),
        label_boundary=page.label_boundary if page.label_boundary is not None else np.zeros(0, dtype=np.float32),
        label_positive=page.label_positive if page.label_positive is not None else np.zeros(0, dtype=np.uint8),
        owner=page.owner if page.owner is not None else np.zeros(0, dtype=np.int32),
        gt_points=gt_points,
        gt_offsets=gt_offsets,
        snapped_points=snapped_points,
        snapped_offsets=snapped_offsets,
        gt_room_types=np.asarray(page.gt_room_types, dtype=np.str_),
        gt_room_numbers=np.asarray(page.gt_room_numbers, dtype=np.str_),
        gt_class_ids=page.gt_class_ids if page.gt_class_ids is not None else np.zeros(0, dtype=np.int64),
        bridge_a=page.bridge_a if page.bridge_a is not None else np.zeros(0, dtype=np.int64),
        bridge_b=page.bridge_b if page.bridge_b is not None else np.zeros(0, dtype=np.int64),
        bridge_coords=page.bridge_coords if page.bridge_coords is not None else np.zeros((0, 4), dtype=np.float32),
        bridge_pos=page.bridge_pos if page.bridge_pos is not None else np.zeros(0, dtype=np.uint8),
        stats=np.str_(json.dumps(page.stats)),
    )


def load_vector_page(path: Path) -> VectorPage:
    with np.load(path, allow_pickle=False) as data:
        segment_count = int(data["seg_p0"].shape[0])
        has_labels = bool(data["has_labels"])
        page = VectorPage(
            stem=str(data["stem"]),
            folder=str(data["folder"]),
            source_pdf=str(data["source_pdf"]),
            scene_matrix=tuple(float(value) for value in data["scene_matrix"]),
            page_bounds=tuple(float(value) for value in data["page_bounds"]),
            seg_p0=data["seg_p0"],
            seg_p1=data["seg_p1"],
            half_width=data["half_width"],
            color=data["color"],
            alpha=data["alpha"],
            flags=data["flags"],
            has_labels=has_labels,
            label_boundary=data["label_boundary"] if len(data["label_boundary"]) == segment_count else None,
            label_positive=data["label_positive"] if len(data["label_positive"]) == segment_count else None,
            owner=data["owner"] if len(data["owner"]) == segment_count else None,
            gt_polygons=_unpack_polygons(data["gt_points"], data["gt_offsets"]),
            snapped_polygons=_unpack_polygons(data["snapped_points"], data["snapped_offsets"]),
            gt_room_types=[str(value) for value in data["gt_room_types"]],
            gt_room_numbers=[str(value) for value in data["gt_room_numbers"]],
            gt_class_ids=data["gt_class_ids"],
            bridge_a=data["bridge_a"],
            bridge_b=data["bridge_b"],
            bridge_coords=data["bridge_coords"].reshape(-1, 4) if "bridge_coords" in data else np.zeros((0, 4), dtype=np.float32),
            bridge_pos=data["bridge_pos"],
            stats=json.loads(str(data["stats"])),
        )
    return page


# ---------------------------------------------------------------------------
# Features
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PageNormalizers:
    """Per-page scale references; recomputed at inference from the page itself."""

    center: tuple[float, float]
    diag: float
    median_half_width: float
    median_length: float

    @classmethod
    def for_page(cls, page: VectorPage) -> "PageNormalizers":
        return cls.for_arrays(page.seg_p0, page.seg_p1, page.half_width, page.flags, page.page_bounds)

    @classmethod
    def for_arrays(
        cls,
        seg_p0: np.ndarray,
        seg_p1: np.ndarray,
        half_width: np.ndarray,
        flags: np.ndarray,
        page_bounds: tuple[float, float, float, float],
    ) -> "PageNormalizers":
        min_x, min_y, max_x, max_y = page_bounds
        diag = float(math.hypot(max_x - min_x, max_y - min_y)) or 1.0
        stroke_mask = (flags & SEGMENT_FLAG_FILL_OUTLINE) == 0
        widths = half_width[stroke_mask]
        widths = widths[widths > 0]
        lengths = np.hypot(*(seg_p1 - seg_p0).T)
        return cls(
            center=((min_x + max_x) * 0.5, (min_y + max_y) * 0.5),
            diag=diag,
            median_half_width=float(np.median(widths)) if len(widths) else diag * 1e-4,
            median_length=float(np.median(lengths)) if len(lengths) else diag * 1e-3,
        )


def build_segment_features(
    seg_p0: np.ndarray,
    seg_p1: np.ndarray,
    half_width: np.ndarray,
    color: np.ndarray,
    alpha: np.ndarray,
    flags: np.ndarray,
    normalizers: PageNormalizers,
) -> np.ndarray:
    """Scale-invariant per-segment features, shape (N, FEATURE_DIM)."""
    count = len(seg_p0)
    delta = (seg_p1 - seg_p0).astype(np.float64)
    length = np.hypot(delta[:, 0], delta[:, 1])
    safe_length = np.maximum(length, 1e-9)
    ux = delta[:, 0] / safe_length
    uy = delta[:, 1] / safe_length
    mid = (seg_p0 + seg_p1) * 0.5
    diag = normalizers.diag

    length_rank = np.argsort(np.argsort(length)) / max(1, count - 1) if count > 1 else np.full(count, 0.5)
    width_rank = np.argsort(np.argsort(half_width)) / max(1, count - 1) if count > 1 else np.full(count, 0.5)

    features = np.zeros((count, FEATURE_DIM), dtype=np.float32)
    features[:, 0] = (mid[:, 0] - normalizers.center[0]) / (0.5 * diag)
    features[:, 1] = (mid[:, 1] - normalizers.center[1]) / (0.5 * diag)
    features[:, 2] = ux * ux - uy * uy  # cos(2 theta): undirected orientation
    features[:, 3] = 2.0 * ux * uy  # sin(2 theta)
    features[:, 4] = length / diag
    features[:, 5] = np.log1p(length / max(normalizers.median_length, 1e-9))
    features[:, 6] = length_rank
    features[:, 7] = np.log1p(half_width / max(normalizers.median_half_width, 1e-9))
    features[:, 8] = np.clip(half_width / max(normalizers.median_half_width, 1e-9), 0.0, 16.0) / 16.0
    features[:, 9] = width_rank
    features[:, 10:13] = color
    features[:, 13] = alpha
    features[:, 14] = color @ np.asarray([0.299, 0.587, 0.114], dtype=np.float32)
    features[:, 15] = (flags & SEGMENT_FLAG_HAIRLINE) > 0
    features[:, 16] = (flags & SEGMENT_FLAG_ROUND_CAP) > 0
    features[:, 17] = (flags & SEGMENT_FLAG_CLIPPED) > 0
    features[:, 18] = (flags & SEGMENT_FLAG_FILL_OUTLINE) > 0
    features[:, 19] = (flags & SEGMENT_FLAG_QUADRATIC) > 0
    features[:, 20] = np.log1p(length / (2.0 * np.maximum(half_width, normalizers.median_half_width * 0.25)))
    return features


def build_knn_graph(mid: np.ndarray, k: int) -> tuple[np.ndarray, np.ndarray]:
    """kNN neighbour indices (N, k) over midpoints + relative edge features (N, k, EDGE_FEATURE_DIM)."""
    from scipy.spatial import cKDTree

    count = len(mid)
    if count <= 1:
        # A page with a single segment has no neighbours; attend to itself with
        # zero edge features (text-only PDFs can produce such pages).
        return np.zeros((count, k), dtype=np.int64), np.zeros((count, k, EDGE_FEATURE_DIM), dtype=np.float32)
    k_effective = min(k, count - 1)
    tree = cKDTree(mid)
    distances, indices = tree.query(mid, k=k_effective + 1)
    distances = np.atleast_2d(distances)[:, 1:]
    indices = np.atleast_2d(indices)[:, 1:]
    # scipy pads missing neighbours with index == count and distance == inf.
    missing = indices >= count
    if missing.any():
        self_ids = np.broadcast_to(np.arange(count, dtype=np.int64)[:, None], indices.shape)
        indices = np.where(missing, self_ids, indices)
        distances = np.where(missing, 0.0, distances)
    if indices.shape[1] < k:
        pad = k - indices.shape[1]
        indices = np.pad(indices, ((0, 0), (0, pad)), mode="edge")
        distances = np.pad(distances, ((0, 0), (0, pad)), mode="edge")
    local_scale = max(float(np.median(distances[:, 0])), 1e-9)

    rel = (mid[indices] - mid[:, None, :]) / local_scale
    edge = np.zeros((count, k, EDGE_FEATURE_DIM), dtype=np.float32)
    edge[:, :, 0] = rel[:, :, 0]
    edge[:, :, 1] = rel[:, :, 1]
    edge[:, :, 2] = distances / local_scale
    edge[:, :, 3] = np.log1p(distances / local_scale)
    return indices.astype(np.int64), edge


def finish_edge_features(edge: np.ndarray, indices: np.ndarray, ux: np.ndarray, uy: np.ndarray) -> np.ndarray:
    """Fill direction-alignment slots (needs per-segment unit directions)."""
    dot = np.abs(ux[:, None] * ux[indices] + uy[:, None] * uy[indices])
    cross = np.abs(ux[:, None] * uy[indices] - uy[:, None] * ux[indices])
    edge[:, :, 4] = dot
    edge[:, :, 5] = cross
    return edge


def segment_directions(seg_p0: np.ndarray, seg_p1: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    delta = (seg_p1 - seg_p0).astype(np.float64)
    length = np.maximum(np.hypot(delta[:, 0], delta[:, 1]), 1e-9)
    return (delta[:, 0] / length).astype(np.float32), (delta[:, 1] / length).astype(np.float32)


def build_page_inputs(
    seg_p0: np.ndarray,
    seg_p1: np.ndarray,
    half_width: np.ndarray,
    color: np.ndarray,
    alpha: np.ndarray,
    flags: np.ndarray,
    page_bounds: tuple[float, float, float, float],
    k: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Features + kNN graph for a full page or crop: (features, knn_idx, edge_feats)."""
    normalizers = PageNormalizers.for_arrays(seg_p0, seg_p1, half_width, flags, page_bounds)
    features = build_segment_features(seg_p0, seg_p1, half_width, color, alpha, flags, normalizers)
    mid = ((seg_p0 + seg_p1) * 0.5).astype(np.float64)
    indices, edge = build_knn_graph(mid, k)
    ux, uy = segment_directions(seg_p0, seg_p1)
    edge = finish_edge_features(edge, indices, ux, uy)
    return features, indices, edge


# ---------------------------------------------------------------------------
# Training crops
# ---------------------------------------------------------------------------


@dataclass
class SegmentCrop:
    features: np.ndarray  # (M, FEATURE_DIM)
    knn_idx: np.ndarray  # (M, k)
    edge: np.ndarray  # (M, k, EDGE_FEATURE_DIM)
    label: np.ndarray  # (M,) float32
    stem: str


def sample_crop_indices(mid: np.ndarray, rng: random.Random, max_segments: int) -> np.ndarray:
    """Spatial window around a random segment, capped at max_segments."""
    count = len(mid)
    if count <= max_segments:
        return np.arange(count, dtype=np.int64)
    center = mid[rng.randrange(count)]
    distances = np.hypot(mid[:, 0] - center[0], mid[:, 1] - center[1])
    return np.argpartition(distances, max_segments - 1)[:max_segments].astype(np.int64)


def augment_crop_geometry(
    seg_p0: np.ndarray,
    seg_p1: np.ndarray,
    page_bounds: tuple[float, float, float, float],
    rng: random.Random,
) -> tuple[np.ndarray, np.ndarray, tuple[float, float, float, float]]:
    """Random 90-degree rotation, flip and uniform scale (validates scale invariance)."""
    p0 = seg_p0.astype(np.float64).copy()
    p1 = seg_p1.astype(np.float64).copy()
    min_x, min_y, max_x, max_y = page_bounds
    cx = (min_x + max_x) * 0.5
    cy = (min_y + max_y) * 0.5
    for arr in (p0, p1):
        arr[:, 0] -= cx
        arr[:, 1] -= cy

    quarter_turns = rng.randrange(4)
    for _ in range(quarter_turns):
        for arr in (p0, p1):
            x = arr[:, 0].copy()
            arr[:, 0] = -arr[:, 1]
            arr[:, 1] = x
    if rng.random() < 0.5:
        for arr in (p0, p1):
            arr[:, 0] = -arr[:, 0]
    scale = math.exp(rng.uniform(math.log(0.5), math.log(2.0)))
    p0 *= scale
    p1 *= scale

    half_w = (max_x - min_x) * 0.5 * scale
    half_h = (max_y - min_y) * 0.5 * scale
    if quarter_turns % 2 == 1:
        half_w, half_h = half_h, half_w
    new_bounds = (-half_w, -half_h, half_w, half_h)
    return p0.astype(np.float32), p1.astype(np.float32), new_bounds


class SegmentCropDataset:
    """Iterable of training crops; kNN graphs are built on the fly (cheap on CPU)."""

    def __init__(
        self,
        pages: Sequence[VectorPage],
        k: int = 12,
        max_segments: int = 20_000,
        crops_per_page: int = 4,
        augment: bool = True,
        seed: int = 1337,
    ) -> None:
        self.pages = [page for page in pages if page.has_labels and page.segment_count > 0]
        self.k = k
        self.max_segments = max_segments
        self.crops_per_page = crops_per_page
        self.augment = augment
        self.seed = seed

    def __len__(self) -> int:
        return len(self.pages) * self.crops_per_page

    def crop(self, index: int, epoch: int = 0) -> SegmentCrop:
        page = self.pages[index // self.crops_per_page]
        rng = random.Random((self.seed, epoch, index).__hash__())
        mid = ((page.seg_p0 + page.seg_p1) * 0.5).astype(np.float64)
        selected = sample_crop_indices(mid, rng, self.max_segments)

        seg_p0 = page.seg_p0[selected]
        seg_p1 = page.seg_p1[selected]
        bounds = page.page_bounds
        if self.augment:
            seg_p0, seg_p1, bounds = augment_crop_geometry(seg_p0, seg_p1, bounds, rng)
        features, knn_idx, edge = build_page_inputs(
            seg_p0,
            seg_p1,
            page.half_width[selected],
            page.color[selected],
            page.alpha[selected],
            page.flags[selected],
            bounds,
            self.k,
        )
        label = page.label_boundary[selected].astype(np.float32)
        return SegmentCrop(features=features, knn_idx=knn_idx, edge=edge, label=label, stem=page.stem)


# ---------------------------------------------------------------------------
# Splits
# ---------------------------------------------------------------------------


def building_group_key(stem: str) -> str:
    """Group floors of one building together to avoid cross-floor leakage."""
    base = stem.split("_")[0].strip().lower()
    return base or stem.strip().lower()


def build_vector_splits(
    labeled: Sequence[tuple[str, str, str]],  # (folder, stem, npz_relpath) with GT rooms
    negatives: Sequence[tuple[str, str, str]],  # not_floorplans pages
    smoke: Sequence[tuple[str, str, str]],  # withoutTSV pages
    excluded: Sequence[tuple[str, str, str]] = (),
    seed: int = 1337,
    val_fraction: float = 0.1,
    test_fraction: float = 0.1,
) -> dict[str, object]:
    groups: dict[str, list[tuple[str, str, str]]] = {}
    group_folder: dict[str, str] = {}
    for entry in labeled:
        key = building_group_key(entry[1])
        groups.setdefault(key, []).append(entry)
        group_folder.setdefault(key, entry[0])

    rng = random.Random(seed)
    shuffled_keys = sorted(groups)
    rng.shuffle(shuffled_keys)
    shuffle_rank = {key: rank for rank, key in enumerate(shuffled_keys)}

    total_pages = len(labeled)
    val_target = max(1, round(total_pages * val_fraction)) if total_pages else 0
    test_target = max(1, round(total_pages * test_fraction)) if total_pages else 0
    assigned: dict[str, str] = {}

    def fill(split_name: str, target: int) -> None:
        # A building larger than the whole split would either swamp it or leak
        # floors across splits, and a folder's only building must stay in train
        # (otherwise that drawing style is never trained on) — both stay out.
        def eligible(folder: str | None = None) -> list[str]:
            unassigned_per_folder: dict[str, int] = {}
            for key in shuffled_keys:
                if key not in assigned:
                    unassigned_per_folder[group_folder[key]] = unassigned_per_folder.get(group_folder[key], 0) + 1
            return [
                key
                for key in shuffled_keys
                if key not in assigned
                and len(groups[key]) <= target
                and unassigned_per_folder[group_folder[key]] >= 2
                and (folder is None or group_folder[key] == folder)
            ]

        count = 0
        for folder in sorted({group_folder[key] for key in shuffled_keys}):  # one group per folder first
            if count >= target:
                break
            candidates = eligible(folder)
            if candidates:
                key = min(candidates, key=lambda key: (len(groups[key]), shuffle_rank[key]))
                assigned[key] = split_name
                count += len(groups[key])
        while count < target:  # then smallest-first, re-checking eligibility each pick
            candidates = eligible()
            if not candidates:
                break
            key = min(candidates, key=lambda key: (len(groups[key]), shuffle_rank[key]))
            assigned[key] = split_name
            count += len(groups[key])

    fill("val", val_target)
    fill("test", test_target)

    val: list[tuple[str, str, str]] = []
    test: list[tuple[str, str, str]] = []
    train: list[tuple[str, str, str]] = []
    for key in shuffled_keys:
        target_list = {"val": val, "test": test}.get(assigned.get(key, "train"), train)
        target_list.extend(groups[key])

    negatives_sorted = sorted(negatives)
    negative_val = negatives_sorted[:1]
    negative_train = negatives_sorted[1:]

    def serialize(entries: Iterable[tuple[str, str, str]]) -> list[dict[str, str]]:
        return [{"folder": folder, "stem": stem, "page": relpath} for folder, stem, relpath in sorted(entries)]

    return {
        "metadata": {
            "kind": "vector-room-detection",
            "seed": seed,
            "valFraction": val_fraction,
            "testFraction": test_fraction,
            "grouping": "building stem prefix before first underscore",
        },
        "train": serialize(train + negative_train),
        "val": serialize(val + negative_val),
        "test": serialize(test),
        "smoke": serialize(smoke),
        "excluded": serialize(excluded),
    }


def read_vector_split(splits_path: Path, split: str) -> list[dict[str, str]]:
    payload = json.loads(splits_path.read_text(encoding="utf-8"))
    entries = payload.get(split)
    if not isinstance(entries, list):
        raise ValueError(f"Split {split!r} not found in {splits_path}")
    return entries


def load_split_pages(splits_path: Path, split: str, pages_root: Path) -> list[VectorPage]:
    return [load_vector_page(pages_root / entry["page"]) for entry in read_vector_split(splits_path, split)]


def safe_page_filename(folder: str, stem: str) -> str:
    return f"{sanitize_stem(folder)}__{sanitize_stem(stem)}.npz"
