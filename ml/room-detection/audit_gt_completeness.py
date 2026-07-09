"""GT-completeness audit: are unmatched predictions hallucinations or unlabeled rooms?

Matches predicted polygons to GT one-to-one (shapely IoU, greedy) and splits the
unmatched predictions by whether they carry a room number. Predictions with a room
number but no GT counterpart point at TSV omissions rather than detector errors, which
caps the achievable precision on this corpus.

Usage:
    .venv/bin/python audit_gt_completeness.py --predictions ../../.eval/<run>/predictions
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from shapely.geometry import Polygon
from shapely.strtree import STRtree

from roomdet.vector_dataset import load_vector_page, safe_page_filename

SCRIPT_DIR = Path(__file__).resolve().parent


def to_polygon(points: np.ndarray) -> Polygon | None:
    if len(points) < 3:
        return None
    polygon = Polygon(points)
    if not polygon.is_valid:
        polygon = polygon.buffer(0)
    return polygon if not polygon.is_empty else None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--pages-root", type=Path, default=SCRIPT_DIR / "data" / "vector-dataset")
    parser.add_argument("--iou", type=float, default=0.5)
    args = parser.parse_args()

    pages_dir = args.pages_root / "pages"
    total = {"pred": 0, "matched": 0, "unmatched_numbered": 0, "unmatched_plain": 0, "gt": 0, "gt_unmatched": 0}
    rows = []

    for prediction_file in sorted(args.predictions.glob("*.json")):
        with prediction_file.open() as handle:
            prediction = json.load(handle)
        npz_path = pages_dir / safe_page_filename(prediction["folder"], prediction["stem"])
        if not npz_path.exists():
            continue
        page = load_vector_page(npz_path)
        if len(page.gt_polygons) == 0:
            continue

        gt_polygons = [to_polygon(np.asarray(points)) for points in page.gt_polygons]
        gt_polygons = [(i, poly) for i, poly in enumerate(gt_polygons) if poly is not None]
        preds = []
        for room in prediction["rooms"]:
            poly = to_polygon(np.asarray(room["polygon"], dtype=np.float64).reshape(-1, 2))
            if poly is not None:
                preds.append((room, poly))

        tree = STRtree([poly for _, poly in gt_polygons])
        pairs = []
        for pred_index, (_, pred_poly) in enumerate(preds):
            for tree_index in tree.query(pred_poly):
                gt_poly = gt_polygons[int(tree_index)][1]
                inter = pred_poly.intersection(gt_poly).area
                union = pred_poly.union(gt_poly).area
                if union > 0 and inter / union >= args.iou:
                    pairs.append((inter / union, pred_index, int(tree_index)))
        pairs.sort(reverse=True)
        matched_pred: set[int] = set()
        matched_gt: set[int] = set()
        for _, pred_index, gt_index in pairs:
            if pred_index in matched_pred or gt_index in matched_gt:
                continue
            matched_pred.add(pred_index)
            matched_gt.add(gt_index)

        unmatched_numbered = 0
        unmatched_plain = 0
        for pred_index, (room, _) in enumerate(preds):
            if pred_index in matched_pred:
                continue
            if room.get("roomNumber"):
                unmatched_numbered += 1
            else:
                unmatched_plain += 1

        key = f"{prediction['folder']}/{prediction['stem']}"
        rows.append((key, len(preds), len(matched_pred), unmatched_numbered, unmatched_plain, len(gt_polygons), len(gt_polygons) - len(matched_gt)))
        total["pred"] += len(preds)
        total["matched"] += len(matched_pred)
        total["unmatched_numbered"] += unmatched_numbered
        total["unmatched_plain"] += unmatched_plain
        total["gt"] += len(gt_polygons)
        total["gt_unmatched"] += len(gt_polygons) - len(matched_gt)

    rows.sort(key=lambda row: -row[3])
    print(f"{'page':<58} {'#pred':>5} {'match':>5} {'un#num':>6} {'unplain':>7} {'#gt':>4} {'gtmiss':>6}")
    for row in rows[:15]:
        print(f"{row[0]:<58} {row[1]:>5} {row[2]:>5} {row[3]:>6} {row[4]:>7} {row[5]:>4} {row[6]:>6}")
    print(
        f"\ntotals: preds={total['pred']} matched={total['matched']} "
        f"unmatched+number={total['unmatched_numbered']} unmatched-plain={total['unmatched_plain']} "
        f"gt={total['gt']} gt-missed={total['gt_unmatched']}"
    )
    unmatched = total["pred"] - total["matched"]
    if unmatched > 0:
        print(
            f"of unmatched predictions, {total['unmatched_numbered'] / unmatched * 100:.0f}% carry a room number "
            f"(likely TSV omissions or boundary mismatches on real rooms)"
        )
    print(f"precision ceiling if all numbered-unmatched were correct: {(total['matched'] + total['unmatched_numbered']) / max(1, total['pred']):.3f}")


if __name__ == "__main__":
    main()
