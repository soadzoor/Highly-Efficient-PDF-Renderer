"""Build the vector-native training dataset from segment dumps + TSV ground truth.

Reads the gzipped dumps produced by scripts/extract-segments.mjs, snaps the
hand-drawn TSV polygons onto real stroke geometry, derives per-segment boundary
labels and gap-bridge candidates, writes one .npz per page plus QC overlay PNGs,
and freezes grouped train/val/test splits.

Run from ml/room-detection (see README "Vector pipeline"):
    python prepare_vector_dataset.py \
        --segments data/vector-segments \
        --pdf-tsv-root ../../pdf-tsv \
        --out data/vector-dataset
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from roomdet.vector_dataset import (
    VectorPage,
    VectorPrepConfig,
    build_vector_splits,
    load_segment_dump,
    prepare_vector_page,
    safe_page_filename,
    save_vector_page,
)
from roomdet.vector_metrics import letterbox_frame, polygon_to_pixels

LABELED_FOLDERS = ("kp", "uci", "zuckerman", "xyicon_lk")
NEGATIVE_FOLDERS = ("not_floorplans",)
SMOKE_FOLDERS = ("withoutTSV",)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--segments", type=Path, default=Path("data/vector-segments"))
    parser.add_argument("--pdf-tsv-root", type=Path, default=Path("../../pdf-tsv"))
    parser.add_argument("--out", type=Path, default=Path("data/vector-dataset"))
    parser.add_argument("--splits-out", type=Path, default=Path("vector-splits.json"))
    parser.add_argument("--labeled-folders", default=",".join(LABELED_FOLDERS))
    parser.add_argument("--negative-folders", default=",".join(NEGATIVE_FOLDERS))
    parser.add_argument("--smoke-folders", default=",".join(SMOKE_FOLDERS))
    parser.add_argument("--seed", type=int, default=1337)
    parser.add_argument("--val-fraction", type=float, default=0.1)
    parser.add_argument("--test-fraction", type=float, default=0.1)
    parser.add_argument("--qc", action=argparse.BooleanOptionalAction, default=True, help="write QC overlay PNGs")
    parser.add_argument("--qc-size", type=int, default=1536)
    parser.add_argument("--force", action="store_true", help="rebuild pages even if the npz already exists")
    parser.add_argument(
        "--max-segments",
        type=int,
        default=1_500_000,
        help="skip (exclude) pages with more segments than this instead of processing them",
    )
    parser.add_argument("--log-seconds", type=float, default=10.0)
    parser.add_argument("--snap-page-fraction", type=float, default=VectorPrepConfig.snap_tolerance_page_fraction)
    parser.add_argument("--angle-tolerance", type=float, default=VectorPrepConfig.angle_tolerance_degrees)
    parser.add_argument(
        "--boundary-positive-fraction",
        type=float,
        default=VectorPrepConfig.boundary_positive_fraction,
        help="min fraction of a segment's length on the snapped GT boundary to label it positive",
    )
    args = parser.parse_args()

    config = VectorPrepConfig(
        snap_tolerance_page_fraction=args.snap_page_fraction,
        angle_tolerance_degrees=args.angle_tolerance,
        boundary_positive_fraction=args.boundary_positive_fraction,
    )
    labeled_folders = [name for name in args.labeled_folders.split(",") if name]
    negative_folders = [name for name in args.negative_folders.split(",") if name]
    smoke_folders = [name for name in args.smoke_folders.split(",") if name]

    tasks: list[tuple[str, Path, Path | None, str]] = []  # (folder, dump, tsv, kind)
    for folder in labeled_folders + negative_folders + smoke_folders:
        kind = "labeled" if folder in labeled_folders else ("negative" if folder in negative_folders else "smoke")
        folder_dir = args.segments / folder
        if not folder_dir.is_dir():
            print(json.dumps({"event": "folder_missing", "folder": folder, "path": str(folder_dir)}), flush=True)
            continue
        for dump_path in sorted(folder_dir.glob("*.segments.json.gz")):
            stem = dump_path.name[: -len(".segments.json.gz")]
            tsv_path = args.pdf_tsv_root / folder / f"{stem}.tsv"
            tasks.append((folder, dump_path, tsv_path if (kind == "labeled" and tsv_path.is_file()) else None, kind))

    if not tasks:
        raise SystemExit(f"No segment dumps found under {args.segments}. Run scripts/extract-segments.mjs first.")

    pages_dir = args.out / "pages"
    qc_dir = args.out / "qc"
    pages_dir.mkdir(parents=True, exist_ok=True)
    if args.qc:
        qc_dir.mkdir(parents=True, exist_ok=True)

    print(
        json.dumps(
            {
                "event": "prepare_vector_config",
                "tasks": len(tasks),
                "segments": str(args.segments),
                "pdfTsvRoot": str(args.pdf_tsv_root),
                "out": str(args.out),
                "config": config.__dict__,
            }
        ),
        flush=True,
    )

    labeled_entries: list[tuple[str, str, str]] = []
    negative_entries: list[tuple[str, str, str]] = []
    smoke_entries: list[tuple[str, str, str]] = []
    excluded_entries: list[tuple[str, str, str]] = []
    summary_rows: list[dict[str, object]] = []
    start_time = time.perf_counter()
    last_log = start_time

    for index, (folder, dump_path, tsv_path, kind) in enumerate(tasks, start=1):
        stem = dump_path.name[: -len(".segments.json.gz")]
        page_filename = safe_page_filename(folder, stem)
        page_path = pages_dir / page_filename
        percent = round(index / len(tasks) * 100.0, 1)
        entry = (folder, stem, f"pages/{page_filename}")

        if kind == "labeled" and tsv_path is None:
            excluded_entries.append(entry)
            print(
                json.dumps({"event": "file_excluded", "file": index, "files": len(tasks), "percent": percent, "stem": stem, "reason": "missing_tsv"}),
                flush=True,
            )
            continue

        if page_path.exists() and not args.force:
            page = None
            with np.load(page_path, allow_pickle=False) as existing:
                summary_rows.append(
                    {"folder": folder, "stem": stem, "kind": kind, "resumed": True, **json.loads(str(existing["stats"]))}
                )
            print(
                json.dumps({"event": "file_skipped", "file": index, "files": len(tasks), "percent": percent, "stem": stem, "reason": "exists"}),
                flush=True,
            )
        else:
            file_start = time.perf_counter()
            page = load_segment_dump(dump_path)
            if page.segment_count > args.max_segments:
                excluded_entries.append(entry)
                print(
                    json.dumps(
                        {
                            "event": "file_excluded",
                            "file": index,
                            "files": len(tasks),
                            "percent": percent,
                            "stem": stem,
                            "reason": "too_many_segments",
                            "segments": page.segment_count,
                            "maxSegments": args.max_segments,
                        }
                    ),
                    flush=True,
                )
                continue

            def heartbeat(fraction: float) -> None:
                nonlocal last_log
                now = time.perf_counter()
                if now - last_log >= args.log_seconds:
                    last_log = now
                    print(
                        json.dumps(
                            {
                                "event": "file_progress",
                                "file": index,
                                "files": len(tasks),
                                "stem": stem,
                                "stage": "labels",
                                "stagePercent": round(fraction * 100.0, 1),
                            }
                        ),
                        flush=True,
                    )

            if kind == "smoke":
                page.has_labels = False
                save_vector_page(page, page_path)
            else:
                page = prepare_vector_page(page, tsv_path, config, progress=heartbeat)
                save_vector_page(page, page_path)
                if args.qc:
                    write_qc_overlay(page, qc_dir / f"{page_filename[:-4]}.png", args.qc_size)

            row = {
                "folder": folder,
                "stem": stem,
                "kind": kind,
                "segments": page.segment_count,
                **{key: value for key, value in page.stats.items()},
            }
            summary_rows.append(row)
            print(
                json.dumps(
                    {
                        "event": "file_complete",
                        "file": index,
                        "files": len(tasks),
                        "percent": percent,
                        "stem": stem,
                        "kind": kind,
                        "segments": page.segment_count,
                        "positiveFraction": round(float(page.stats.get("positiveFraction", 0.0)), 4),
                        "gtPerimeterSupport": round(float(page.stats.get("gtPerimeterSupport", 0.0)), 4),
                        "fileSeconds": round(time.perf_counter() - file_start, 2),
                        "eta": format_duration((time.perf_counter() - start_time) / index * (len(tasks) - index)),
                    }
                ),
                flush=True,
            )

        if kind == "labeled":
            if page is not None:
                gt_count = len(page.gt_polygons)
            else:
                with np.load(page_path, allow_pickle=False) as reopened:
                    gt_count = max(0, len(reopened["gt_offsets"]) - 1)
            if gt_count == 0:
                excluded_entries.append(entry)  # e.g. header-only TSV: roomless vs unlabeled is ambiguous
            else:
                labeled_entries.append(entry)
        elif kind == "negative":
            negative_entries.append(entry)
        else:
            smoke_entries.append(entry)

    splits = build_vector_splits(
        labeled=labeled_entries,
        negatives=negative_entries,
        smoke=smoke_entries,
        excluded=excluded_entries,
        seed=args.seed,
        val_fraction=args.val_fraction,
        test_fraction=args.test_fraction,
    )
    splits["metadata"]["pagesRoot"] = str(args.out)
    splits["metadata"]["prepConfig"] = config.__dict__
    args.splits_out.parent.mkdir(parents=True, exist_ok=True)
    args.splits_out.write_text(json.dumps(splits, indent=2) + "\n", encoding="utf-8")

    summary = {
        "pages": len(summary_rows),
        "train": len(splits["train"]),
        "val": len(splits["val"]),
        "test": len(splits["test"]),
        "smoke": len(splits["smoke"]),
        "excluded": len(splits["excluded"]),
        "meanGtPerimeterSupport": float(
            np.mean([row["gtPerimeterSupport"] for row in summary_rows if "gtPerimeterSupport" in row])
        )
        if any("gtPerimeterSupport" in row for row in summary_rows)
        else None,
        "rows": summary_rows,
    }
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "event": "prepare_vector_complete",
                "pages": len(summary_rows),
                "splits": {key: len(splits[key]) for key in ("train", "val", "test", "smoke", "excluded")},
                "meanGtPerimeterSupport": summary["meanGtPerimeterSupport"],
                "splitsPath": str(args.splits_out),
                "totalSeconds": round(time.perf_counter() - start_time, 1),
            }
        ),
        flush=True,
    )


def write_qc_overlay(page: VectorPage, path: Path, image_size: int) -> None:
    """Segments (positives highlighted) + raw GT (red) + snapped GT (green)."""
    frame_params = letterbox_frame(page.page_bounds, [page.gt_polygons, page.snapped_polygons], image_size)
    frame, _, render_width, render_height, offset_x, offset_y = frame_params
    image = Image.new("RGB", (image_size, image_size), (255, 255, 255))
    draw = ImageDraw.Draw(image)

    def to_pixel(points: np.ndarray) -> list[tuple[float, float]]:
        return polygon_to_pixels(points, frame, render_width, render_height, offset_x, offset_y)

    positive = page.label_positive if page.label_positive is not None else np.zeros(page.segment_count, dtype=np.uint8)
    for segment_index in range(page.segment_count):
        pixels = to_pixel(np.stack([page.seg_p0[segment_index], page.seg_p1[segment_index]]))
        color = (37, 99, 235) if positive[segment_index] else (203, 213, 225)
        draw.line([tuple(pixels[0]), tuple(pixels[1])], fill=color, width=2 if positive[segment_index] else 1)
    for polygon in page.gt_polygons:
        pixels = to_pixel(polygon)
        draw.line([*map(tuple, pixels), tuple(pixels[0])], fill=(220, 38, 38), width=1)
    for polygon in page.snapped_polygons:
        pixels = to_pixel(polygon)
        draw.line([*map(tuple, pixels), tuple(pixels[0])], fill=(22, 163, 74), width=1)
    image.save(path)


def format_duration(seconds: float) -> str:
    seconds = max(0, int(round(seconds)))
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours > 0:
        return f"{hours}h {minutes:02d}m {secs:02d}s"
    if minutes > 0:
        return f"{minutes}m {secs:02d}s"
    return f"{secs}s"


if __name__ == "__main__":
    main()
