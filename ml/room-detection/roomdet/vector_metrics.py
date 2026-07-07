"""Score vector-extracted rooms with the existing instance-matching harness.

Predicted faces and raw-TSV ground truth are rasterized into the same letterbox
class masks the raster pipeline uses (room fill + separator outline, identical
conventions to prepare_pdf_tsv_sample), then fed to
roomdet.pdf_tsv_metrics.compute_instance_metrics so pdfTsvMatchedRoomMeanIou /
RecallAt50 / TypeAccuracyAt50 are directly comparable with the CNN baseline.

Rasterization happens only inside the scorer; the model path stays vector-native.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Sequence

import numpy as np
from PIL import Image, ImageDraw

from .classes import classes_for_taxonomy
from .pdf_tsv_dataset import PDF_TSV_ROOM_ID, PDF_TSV_SEPARATOR_ID
from .pdf_tsv_metrics import PdfTsvMetricConfig, compute_instance_metrics
from .vector_dataset import VectorPage
from .vector_faces import RoomFace


def letterbox_frame(
    page_bounds: tuple[float, float, float, float],
    polygon_sets: Sequence[Sequence[np.ndarray]],
    image_size: int,
) -> tuple[tuple[float, float, float, float], float, int, int, int, int]:
    """World frame covering the page plus every polygon, mapped into image_size."""
    min_x, min_y, max_x, max_y = page_bounds
    for polygons in polygon_sets:
        for polygon in polygons:
            if len(polygon) == 0:
                continue
            min_x = min(min_x, float(polygon[:, 0].min()))
            min_y = min(min_y, float(polygon[:, 1].min()))
            max_x = max(max_x, float(polygon[:, 0].max()))
            max_y = max(max_y, float(polygon[:, 1].max()))
    width = max(max_x - min_x, 1e-6)
    height = max(max_y - min_y, 1e-6)
    scale = min(image_size / width, image_size / height)
    render_width = max(1, round(width * scale))
    render_height = max(1, round(height * scale))
    offset_x = (image_size - render_width) // 2
    offset_y = (image_size - render_height) // 2
    return (min_x, min_y, max_x, max_y), scale, render_width, render_height, offset_x, offset_y


def polygon_to_pixels(
    polygon: np.ndarray,
    frame: tuple[float, float, float, float],
    render_width: int,
    render_height: int,
    offset_x: int,
    offset_y: int,
) -> list[tuple[float, float]]:
    min_x, min_y, max_x, max_y = frame
    nx = (polygon[:, 0] - min_x) / max(1e-6, max_x - min_x)
    ny = (max_y - polygon[:, 1]) / max(1e-6, max_y - min_y)  # scene space is Y-up
    return [(offset_x + float(x) * render_width, offset_y + float(y) * render_height) for x, y in zip(nx, ny)]


def rasterize_rooms(
    polygons: Sequence[np.ndarray],
    class_ids: Sequence[int],
    holes: Sequence[Sequence[np.ndarray]] | None,
    frame_params: tuple,
    image_size: int,
    separator_id: int,
    separator_width: int,
) -> np.ndarray:
    frame, _, render_width, render_height, offset_x, offset_y = frame_params
    mask = Image.new("L", (image_size, image_size), 0)
    draw = ImageDraw.Draw(mask)
    outline_rings: list[list[tuple[float, float]]] = []
    for index, polygon in enumerate(polygons):
        if len(polygon) < 3:
            continue
        pixels = polygon_to_pixels(polygon, frame, render_width, render_height, offset_x, offset_y)
        draw.polygon(pixels, fill=int(class_ids[index]))
        outline_rings.append(pixels)
        if holes is not None:
            for hole in holes[index]:
                if len(hole) < 3:
                    continue
                hole_pixels = polygon_to_pixels(hole, frame, render_width, render_height, offset_x, offset_y)
                draw.polygon(hole_pixels, fill=0)
                outline_rings.append(hole_pixels)
    if separator_width > 0:
        for pixels in outline_rings:
            draw.line([*pixels, pixels[0]], fill=separator_id, width=max(1, separator_width), joint="curve")
    return np.asarray(mask, dtype=np.uint8)


def evaluate_rooms_on_page(
    page: VectorPage,
    faces: Sequence[RoomFace],
    image_size: int = 1536,
    separator_width: int = 3,
    taxonomy: str = "geometry",
    predicted_class_ids: Sequence[int] | None = None,
) -> dict[str, float | int]:
    """Instance metrics for one page (sums, ready to aggregate across pages)."""
    classes = classes_for_taxonomy(taxonomy)
    config = PdfTsvMetricConfig(classes=classes, target_mode="class" if taxonomy != "geometry" else "geometry", instance_matching=True)
    separator_id = config.separator_id

    if taxonomy == "geometry":
        gt_ids = [PDF_TSV_ROOM_ID] * len(page.gt_polygons)
        pred_ids = [PDF_TSV_ROOM_ID] * len(faces)
    else:
        gt_ids = [int(value) for value in (page.gt_class_ids if page.gt_class_ids is not None else [])]
        if predicted_class_ids is None:
            other_id = next(spec.id for spec in classes if spec.label == "other")
            pred_ids = [face.class_id if face.class_id is not None else other_id for face in faces]
        else:
            pred_ids = [int(value) for value in predicted_class_ids]

    pred_polygons = [face.polygon for face in faces]
    pred_holes = [face.holes for face in faces]
    frame_params = letterbox_frame(page.page_bounds, [page.gt_polygons, pred_polygons], image_size)
    target_mask = rasterize_rooms(page.gt_polygons, gt_ids, None, frame_params, image_size, separator_id, separator_width)
    pred_mask = rasterize_rooms(pred_polygons, pred_ids, pred_holes, frame_params, image_size, separator_id, separator_width)

    instance = compute_instance_metrics(pred_mask, target_mask, config)
    room_pred = np.isin(pred_mask, config.room_ids)
    room_target = np.isin(target_mask, config.room_ids)
    instance["room_intersection"] = float(np.logical_and(room_pred, room_target).sum())
    instance["room_union"] = float(np.logical_or(room_pred, room_target).sum())
    instance["pred_count"] = len(faces)
    return instance


def aggregate_page_metrics(rows: Sequence[dict[str, float | int]]) -> dict[str, float | int]:
    iou_sum = sum(float(row["iou_sum"]) for row in rows)
    targets = sum(int(row["target_count"]) for row in rows)
    recall = sum(int(row["recall_50_count"]) for row in rows)
    type_correct = sum(int(row["type_correct_50_count"]) for row in rows)
    room_intersection = sum(float(row.get("room_intersection", 0.0)) for row in rows)
    room_union = sum(float(row.get("room_union", 0.0)) for row in rows)
    return {
        "pdfTsvMatchedRoomMeanIou": iou_sum / max(1, targets),
        "pdfTsvMatchedRoomRecallAt50": recall / max(1, targets),
        "pdfTsvMatchedRoomTypeAccuracyAt50": type_correct / max(1, recall),
        "pdfTsvMatchedRoomTargets": targets,
        "pdfTsvRoomInteriorIou": room_intersection / max(1.0, room_union),
        "predictedRooms": sum(int(row.get("pred_count", 0)) for row in rows),
        "pages": len(rows),
    }


def scale_vector_page(page: VectorPage, factor: float) -> VectorPage:
    """Uniformly scaled copy of a page (scale-invariance check input)."""
    a, b, c, d, e, f = page.scene_matrix
    return replace(
        page,
        scene_matrix=(a * factor, b * factor, c * factor, d * factor, e * factor, f * factor),
        page_bounds=tuple(value * factor for value in page.page_bounds),
        seg_p0=page.seg_p0 * np.float32(factor),
        seg_p1=page.seg_p1 * np.float32(factor),
        half_width=page.half_width * np.float32(factor),
        gt_polygons=[polygon * np.float32(factor) for polygon in page.gt_polygons],
        snapped_polygons=[polygon * np.float32(factor) for polygon in page.snapped_polygons],
    )


def scale_invariance_delta(base: dict[str, float | int], scaled: dict[str, float | int]) -> float:
    keys = ("pdfTsvMatchedRoomMeanIou", "pdfTsvMatchedRoomRecallAt50", "pdfTsvRoomInteriorIou")
    return max(abs(float(base[key]) - float(scaled[key])) for key in keys)
