"""Score room predictions from scripts/eval-rooms.mjs against pdf-tsv ground truth.

Joins each prediction JSON (folder + stem) to its npz page in data/vector-dataset/pages
and rasterizes GT + predicted polygons with the exact conventions of
roomdet.vector_metrics.evaluate_rooms_on_page (1536px letterbox, room id 1, separator
ring width 3, Y-up flip), so pdfTsvMatchedRoomMeanIou / RecallAt50 stay directly
comparable with the historical CNN/vector baselines. On top of the canonical metrics it
adds recall@0.7 (same per-target best-IoU semantics as recall@0.5) and precision@0.5 /
precision@0.7 via greedy one-to-one matching (each GT and each prediction matched at
most once), which punishes hallucinated extra rooms that recall alone ignores.

Usage:
    .venv/bin/python score_predictions.py --predictions ../../.eval/<run>/predictions \
        [--split all|gt|train|val|test|smoke] [--image-size 1536] [--separator-width 3]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from roomdet.classes import classes_for_taxonomy
from roomdet.pdf_tsv_dataset import PDF_TSV_ROOM_ID
from roomdet.pdf_tsv_metrics import PdfTsvMetricConfig, compute_instance_metrics
from roomdet.vector_dataset import load_vector_page, safe_page_filename
from roomdet.vector_metrics import aggregate_page_metrics, letterbox_frame, rasterize_rooms

SCRIPT_DIR = Path(__file__).resolve().parent

# Pages where the 90% per-PDF goal is structurally unreachable, with reasons
# (see .eval/ledger.md). They stay in the aggregates for baseline comparability but
# are excluded from the goal-page tracking.
INTRACTABLE_PAGES = {
    "uci/Tenet - Wound Care_Level 1": "content is a raster image (305 stroke segments)",
    "uci/Tenet - Electrical C_Level 1": "2-room micro-GT; single-room scoring noise",
    "uci/EUC - Brea GHEI ENT Clinic_Brea Floor 1": "partial-scope GT (TSV covers one suite of a whole building)",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--predictions", type=Path, required=True, help="Directory of prediction JSONs")
    parser.add_argument("--pages-root", type=Path, default=SCRIPT_DIR / "data" / "vector-dataset")
    parser.add_argument("--splits", type=Path, default=SCRIPT_DIR / "vector-splits.json")
    parser.add_argument("--split", default="all", help="all | gt | train | val | test | smoke")
    parser.add_argument("--image-size", type=int, default=1536)
    parser.add_argument("--separator-width", type=int, default=3)
    parser.add_argument("--out", type=Path, default=None, help="scores.json path (default: sibling of predictions dir)")
    parser.add_argument("--top", type=int, default=0, help="Only print the N worst rows (0 = all)")
    return parser.parse_args()


def split_keys(splits_path: Path, split: str) -> set[str] | None:
    if split == "all":
        return None
    with splits_path.open() as handle:
        splits = json.load(handle)
    names = ["train", "val", "test"] if split == "gt" else [split]
    keys: set[str] = set()
    for name in names:
        rows = splits.get(name)
        if not isinstance(rows, list):
            raise SystemExit(f"Unknown split '{name}' in {splits_path}")
        keys.update(f"{row['folder']}/{row['stem']}" for row in rows)
    return keys


def compute_extended_metrics(pred_mask: np.ndarray, target_mask: np.ndarray, config: PdfTsvMetricConfig) -> dict[str, int]:
    """recall@0.7 (per-target best IoU) + one-to-one greedy precision hits at 0.5/0.7.

    Component labeling mirrors compute_instance_metrics exactly (scipy 4-connectivity),
    so the extended numbers share the canonical metric's instance semantics.
    """
    from scipy import ndimage

    structure = np.asarray([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=np.uint8)
    pred_components, pred_count = ndimage.label(np.isin(pred_mask, config.room_ids), structure=structure)
    target_components, target_count = ndimage.label(np.isin(target_mask, config.room_ids), structure=structure)

    pairs: list[tuple[int, int, float]] = []
    if target_count > 0 and pred_count > 0:
        overlap_mask = (pred_components > 0) & (target_components > 0)
        if overlap_mask.any():
            pred_areas = np.bincount(pred_components.reshape(-1), minlength=pred_count + 1)
            target_areas = np.bincount(target_components.reshape(-1), minlength=target_count + 1)
            pair_base = pred_count + 1
            pair_keys = (
                target_components[overlap_mask].astype(np.int64) * pair_base
                + pred_components[overlap_mask].astype(np.int64)
            )
            for key, overlap in enumerate(np.bincount(pair_keys)):
                if overlap <= 0:
                    continue
                target_id = key // pair_base
                pred_id = key % pair_base
                if target_id <= 0 or pred_id <= 0:
                    continue
                union = target_areas[target_id] + pred_areas[pred_id] - overlap
                pairs.append((int(target_id), int(pred_id), float(overlap / max(1, union))))

    best_by_target: dict[int, float] = {}
    for target_id, _, iou in pairs:
        if iou > best_by_target.get(target_id, 0.0):
            best_by_target[target_id] = iou
    recall_70_count = sum(1 for iou in best_by_target.values() if iou >= 0.7)

    matched_targets: set[int] = set()
    matched_preds: set[int] = set()
    matched_ious: list[float] = []
    for target_id, pred_id, iou in sorted(pairs, key=lambda pair: -pair[2]):
        if target_id in matched_targets or pred_id in matched_preds:
            continue
        matched_targets.add(target_id)
        matched_preds.add(pred_id)
        matched_ious.append(iou)

    return {
        "pred_components": int(pred_count),
        "recall_70_count": int(recall_70_count),
        "precision_50_hits": int(sum(1 for iou in matched_ious if iou >= 0.5)),
        "precision_70_hits": int(sum(1 for iou in matched_ious if iou >= 0.7)),
    }


def score_page(page, prediction: dict, image_size: int, separator_width: int) -> dict:
    config = PdfTsvMetricConfig(classes=classes_for_taxonomy("geometry"), target_mode="geometry", instance_matching=True)
    pred_polygons = [np.asarray(room["polygon"], dtype=np.float32).reshape(-1, 2) for room in prediction["rooms"]]
    gt_ids = [PDF_TSV_ROOM_ID] * len(page.gt_polygons)
    pred_ids = [PDF_TSV_ROOM_ID] * len(pred_polygons)

    frame_params = letterbox_frame(page.page_bounds, [page.gt_polygons, pred_polygons], image_size)
    target_mask = rasterize_rooms(page.gt_polygons, gt_ids, None, frame_params, image_size, config.separator_id, separator_width)
    pred_mask = rasterize_rooms(
        pred_polygons, pred_ids, [[] for _ in pred_polygons], frame_params, image_size, config.separator_id, separator_width
    )

    row = compute_instance_metrics(pred_mask, target_mask, config)
    row.update(compute_extended_metrics(pred_mask, target_mask, config))
    room_pred = np.isin(pred_mask, config.room_ids)
    room_target = np.isin(target_mask, config.room_ids)
    row["room_intersection"] = float(np.logical_and(room_pred, room_target).sum())
    row["room_union"] = float(np.logical_or(room_pred, room_target).sum())
    row["pred_count"] = len(pred_polygons)
    return row


def top_failures(prediction: dict, limit: int = 3) -> str:
    counts = prediction.get("failureCounts") or {}
    ranked = sorted(counts.items(), key=lambda item: -item[1])[:limit]
    return ",".join(f"{reason}:{count}" for reason, count in ranked)


def main() -> None:
    args = parse_args()
    wanted = split_keys(args.splits, args.split)
    prediction_files = sorted(args.predictions.glob("*.json"))
    if not prediction_files:
        raise SystemExit(f"No prediction JSONs in {args.predictions}")

    pages_dir = args.pages_root / "pages"
    scored_rows: list[dict] = []
    no_gt_rows: list[dict] = []
    missing: list[str] = []

    for prediction_file in prediction_files:
        with prediction_file.open() as handle:
            prediction = json.load(handle)
        key = f"{prediction['folder']}/{prediction['stem']}"
        if wanted is not None and key not in wanted:
            continue
        npz_path = pages_dir / safe_page_filename(prediction["folder"], prediction["stem"])
        if not npz_path.exists():
            missing.append(key)
            continue
        page = load_vector_page(npz_path)
        row = score_page(page, prediction, args.image_size, args.separator_width)
        row["page"] = key
        row["failures"] = top_failures(prediction)
        row["detect_ms"] = prediction.get("detectMs")
        if row["target_count"] > 0:
            row["mean_iou"] = row["iou_sum"] / row["target_count"]
            row["recall_50"] = row["recall_50_count"] / row["target_count"]
            row["recall_70"] = row["recall_70_count"] / row["target_count"]
            denominator = max(1, row["pred_components"])
            row["precision_50"] = row["precision_50_hits"] / denominator
            row["precision_70"] = row["precision_70_hits"] / denominator
            row["interior_iou"] = row["room_intersection"] / max(1.0, row["room_union"])
            scored_rows.append(row)
        else:
            no_gt_rows.append(row)

    def sort_key(row: dict) -> float:
        return min(row["recall_70"], row["precision_70"])

    scored_rows.sort(key=sort_key)

    header = f"{'page':<58} {'#gt':>4} {'#pred':>5} {'mIoU':>6} {'r@50':>6} {'r@70':>6} {'p@50':>6} {'p@70':>6}  failures"
    print(header)
    print("-" * len(header))
    display_rows = scored_rows[: args.top] if args.top > 0 else scored_rows
    for row in display_rows:
        print(
            f"{row['page']:<58} {row['target_count']:>4} {row['pred_count']:>5} "
            f"{row['mean_iou']:>6.3f} {row['recall_50']:>6.3f} {row['recall_70']:>6.3f} "
            f"{row['precision_50']:>6.3f} {row['precision_70']:>6.3f}  {row['failures']}"
        )

    if no_gt_rows:
        print("\npages without GT rooms (false-positive gauge; not aggregated):")
        for row in sorted(no_gt_rows, key=lambda item: -item["pred_count"]):
            print(f"  {row['page']:<56} predicted rooms: {row['pred_count']}")
    if missing:
        print(f"\npredictions without npz GT page ({len(missing)}): {', '.join(missing)}")

    aggregates: dict = {}
    if scored_rows:
        aggregates = aggregate_page_metrics(scored_rows)
        targets = sum(row["target_count"] for row in scored_rows)
        pred_components = sum(row["pred_components"] for row in scored_rows)
        aggregates["pdfTsvMatchedRoomRecallAt70"] = sum(row["recall_70_count"] for row in scored_rows) / max(1, targets)
        aggregates["pdfTsvRoomPrecisionAt50"] = sum(row["precision_50_hits"] for row in scored_rows) / max(1, pred_components)
        aggregates["pdfTsvRoomPrecisionAt70"] = sum(row["precision_70_hits"] for row in scored_rows) / max(1, pred_components)
        goal_pages = sum(1 for row in scored_rows if row["recall_70"] >= 0.9 and row["precision_70"] >= 0.9)
        aggregates["pagesMeetingGoal"] = goal_pages
        tractable_rows = [row for row in scored_rows if row["page"] not in INTRACTABLE_PAGES]
        aggregates["tractablePages"] = len(tractable_rows)
        aggregates["meanGoalMetricTractable"] = sum(
            min(row["recall_70"], row["precision_70"]) for row in tractable_rows
        ) / max(1, len(tractable_rows))
        print(
            f"\naggregate ({len(scored_rows)} pages, split={args.split}): "
            f"meanIoU={aggregates['pdfTsvMatchedRoomMeanIou']:.3f} "
            f"recall@50={aggregates['pdfTsvMatchedRoomRecallAt50']:.3f} "
            f"recall@70={aggregates['pdfTsvMatchedRoomRecallAt70']:.3f} "
            f"precision@50={aggregates['pdfTsvRoomPrecisionAt50']:.3f} "
            f"precision@70={aggregates['pdfTsvRoomPrecisionAt70']:.3f} "
            f"interiorIoU={aggregates['pdfTsvRoomInteriorIou']:.3f}"
        )
        print(f"pages meeting goal (recall@70 >= 0.9 and precision@70 >= 0.9): {goal_pages}/{len(scored_rows)}")
        print(
            f"tractable pages ({len(tractable_rows)} = all minus {len(INTRACTABLE_PAGES)} intractable): "
            f"mean per-page min(recall@70, precision@70) = {aggregates['meanGoalMetricTractable']:.3f}"
        )

    out_path = args.out if args.out is not None else args.predictions.parent / "scores.json"
    payload = {
        "split": args.split,
        "imageSize": args.image_size,
        "separatorWidth": args.separator_width,
        "aggregates": aggregates,
        "pages": scored_rows,
        "pagesWithoutGt": no_gt_rows,
        "missingNpz": missing,
    }
    with out_path.open("w") as handle:
        json.dump(payload, handle, indent=1)
    print(f"\nwrote {out_path}")


if __name__ == "__main__":
    main()
