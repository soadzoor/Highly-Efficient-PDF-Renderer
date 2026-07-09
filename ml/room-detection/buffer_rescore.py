"""Boundary-offset experiment: rescore predictions with polygons buffered outward.

If detected rooms are systematically drawn at the walls' inner faces while the TSV
ground truth follows wall centerlines, a small uniform outward buffer should raise
matched-room IoU across the board. Sweeps several buffer distances (fractions of the
page diagonal) and reports the aggregate metrics per distance.

Usage:
    .venv/bin/python buffer_rescore.py --predictions ../../.eval/<run>/predictions \
        [--factors 0,0.0002,0.0004,0.0007,0.001,0.0015]
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from shapely.geometry import Polygon

from roomdet.vector_dataset import load_vector_page, safe_page_filename
from score_predictions import score_page

SCRIPT_DIR = Path(__file__).resolve().parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--pages-root", type=Path, default=SCRIPT_DIR / "data" / "vector-dataset")
    parser.add_argument("--factors", default="0,0.0002,0.0004,0.0007,0.001,0.0015")
    parser.add_argument("--image-size", type=int, default=1536)
    parser.add_argument("--separator-width", type=int, default=3)
    return parser.parse_args()


def buffer_polygon(points: list[float], distance: float) -> list[float]:
    coords = np.asarray(points, dtype=np.float64).reshape(-1, 2)
    if len(coords) < 3 or distance == 0:
        return points
    try:
        polygon = Polygon(coords)
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
        buffered = polygon.buffer(distance, join_style="mitre", mitre_limit=2.0)
        if buffered.is_empty:
            return points
        if buffered.geom_type == "MultiPolygon":
            buffered = max(buffered.geoms, key=lambda geom: geom.area)
        exterior = np.asarray(buffered.exterior.coords[:-1], dtype=np.float64)
        return exterior.reshape(-1).tolist()
    except Exception:
        return points


def main() -> None:
    args = parse_args()
    factors = [float(value) for value in args.factors.split(",")]
    prediction_files = sorted(args.predictions.glob("*.json"))
    pages_dir = args.pages_root / "pages"

    loaded = []
    for prediction_file in prediction_files:
        with prediction_file.open() as handle:
            prediction = json.load(handle)
        npz_path = pages_dir / safe_page_filename(prediction["folder"], prediction["stem"])
        if not npz_path.exists():
            continue
        page = load_vector_page(npz_path)
        if len(page.gt_polygons) == 0:
            continue
        min_x, min_y, max_x, max_y = page.page_bounds
        diagonal = math.hypot(max_x - min_x, max_y - min_y)
        loaded.append((prediction, page, diagonal))

    print(f"{'factor':>8} {'delta@Vermont':>13} {'meanIoU':>8} {'r@50':>7} {'r@70':>7} {'p@70':>7}")
    for factor in factors:
        iou_sum = 0.0
        targets = 0
        recall50 = 0
        recall70 = 0
        prec70_hits = 0
        pred_components = 0
        for prediction, page, diagonal in loaded:
            distance = factor * diagonal
            buffered_rooms = [
                {**room, "polygon": buffer_polygon(room["polygon"], distance)} for room in prediction["rooms"]
            ]
            row = score_page(page, {**prediction, "rooms": buffered_rooms}, args.image_size, args.separator_width)
            iou_sum += row["iou_sum"]
            targets += row["target_count"]
            recall50 += row["recall_50_count"]
            recall70 += row["recall_70_count"]
            prec70_hits += row["precision_70_hits"]
            pred_components += row["pred_components"]
        print(
            f"{factor:>8.4f} {factor * 3716:>13.2f} {iou_sum / max(1, targets):>8.3f} "
            f"{recall50 / max(1, targets):>7.3f} {recall70 / max(1, targets):>7.3f} "
            f"{prec70_hits / max(1, pred_components):>7.3f}"
        )


if __name__ == "__main__":
    main()
