"""Evaluate the committed raster ONNX model on the frozen vector val/test split.

Establishes the number the vector pipeline has to beat. Note this bound is
*optimistic*: the committed model was trained with --split-mode train-all, so the
val pages here were part of its training data.

Renders each split page exactly like prepare_pdf_tsv_dataset.py (PyMuPDF, 1536
letterbox, clinical-coarse masks), runs the ONNX model with the manifest's
normalization, and scores argmax masks with the same compute_instance_metrics.

    python evaluate_onnx_baseline.py --split val
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image

from roomdet.classes import classes_for_taxonomy
from roomdet.pdf_tsv_dataset import PdfTsvPair, prepare_pdf_tsv_sample, sanitize_stem
from roomdet.pdf_tsv_metrics import PdfTsvMetricConfig, compute_instance_metrics
from roomdet.vector_dataset import read_vector_split
from roomdet.vector_metrics import aggregate_page_metrics


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=Path("../../public/models/room-detector/model.onnx"))
    parser.add_argument("--manifest", type=Path, default=None, help="defaults to manifest.json next to --model")
    parser.add_argument("--splits", type=Path, default=Path("vector-splits.json"))
    parser.add_argument("--split", default="val")
    parser.add_argument("--pdf-tsv-root", type=Path, default=Path("../../pdf-tsv"))
    parser.add_argument("--cache-dir", type=Path, default=Path("data/onnx-baseline-cache"))
    parser.add_argument("--separator-width", type=int, default=3)
    parser.add_argument("--log-seconds", type=float, default=10.0)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    try:
        import onnxruntime as ort
    except ModuleNotFoundError as error:
        raise SystemExit("onnxruntime is required: pip install -r requirements.txt") from error

    manifest_path = args.manifest or args.model.with_name("manifest.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    image_size = int(manifest.get("inputSize", {}).get("width", 1536))
    mean = np.asarray(manifest.get("mean", (0.485, 0.456, 0.406)), dtype=np.float32)
    std = np.asarray(manifest.get("std", (0.229, 0.224, 0.225)), dtype=np.float32)
    taxonomy = "clinical-coarse"
    classes = classes_for_taxonomy(taxonomy)
    config = PdfTsvMetricConfig(classes=classes, target_mode="class", instance_matching=True)

    entries = [
        entry
        for entry in read_vector_split(args.splits, args.split)
        if (args.pdf_tsv_root / entry["folder"] / f"{entry['stem']}.tsv").is_file()
    ]
    skipped = [
        entry["stem"]
        for entry in read_vector_split(args.splits, args.split)
        if not (args.pdf_tsv_root / entry["folder"] / f"{entry['stem']}.tsv").is_file()
    ]
    if not entries:
        raise SystemExit(f"No TSV-labelled pages in split {args.split!r}.")

    session = ort.InferenceSession(str(args.model), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name

    print(
        json.dumps(
            {
                "event": "onnx_baseline_config",
                "model": str(args.model),
                "split": args.split,
                "pages": len(entries),
                "skippedNoTsv": skipped,
                "imageSize": image_size,
                "note": "committed model trained with train-all; this bound is optimistic",
            }
        ),
        flush=True,
    )

    rows = []
    start = time.perf_counter()
    last_log = start
    for index, entry in enumerate(entries, start=1):
        folder = entry["folder"]
        stem = entry["stem"]
        pair = PdfTsvPair(
            stem=stem,
            pdf_path=args.pdf_tsv_root / folder / f"{stem}.pdf",
            tsv_path=args.pdf_tsv_root / folder / f"{stem}.tsv",
        )
        cache_root = args.cache_dir / sanitize_stem(folder)
        image_path = cache_root / "images" / f"{sanitize_stem(stem)}.png"
        mask_path = cache_root / "masks" / f"{sanitize_stem(stem)}.png"
        if not (image_path.exists() and mask_path.exists()):
            prepare_pdf_tsv_sample(
                pair,
                cache_root,
                image_size=image_size,
                separator_width=args.separator_width,
                debug_overlay=False,
                room_type_taxonomy=taxonomy,
            )

        image = np.asarray(Image.open(image_path).convert("RGB"), dtype=np.float32) / 255.0
        image = (image - mean) / std
        batch = image.transpose(2, 0, 1)[None].astype(np.float32)
        logits = session.run(None, {input_name: batch})[0]
        pred_mask = np.argmax(logits[0], axis=0).astype(np.uint8)
        target_mask = np.asarray(Image.open(mask_path).convert("L"), dtype=np.uint8)
        if pred_mask.shape != target_mask.shape:
            pred_mask = np.asarray(
                Image.fromarray(pred_mask).resize(target_mask.shape[::-1], Image.Resampling.NEAREST), dtype=np.uint8
            )

        row = compute_instance_metrics(pred_mask, target_mask, config)
        room_pred = np.isin(pred_mask, config.room_ids)
        room_target = np.isin(target_mask, config.room_ids)
        row["room_intersection"] = float(np.logical_and(room_pred, room_target).sum())
        row["room_union"] = float(np.logical_or(room_pred, room_target).sum())
        row["pred_count"] = 0
        rows.append(row)

        now = time.perf_counter()
        if now - last_log >= args.log_seconds or index == len(entries):
            last_log = now
            partial = aggregate_page_metrics(rows)
            print(
                json.dumps(
                    {
                        "event": "page_progress",
                        "page": index,
                        "pages": len(entries),
                        "percent": round(index / len(entries) * 100.0, 1),
                        "stem": stem,
                        "runningMeanIou": round(float(partial["pdfTsvMatchedRoomMeanIou"]), 4),
                        "eta": format_duration((now - start) / index * (len(entries) - index)),
                    }
                ),
                flush=True,
            )

    metrics = aggregate_page_metrics(rows)
    metrics.pop("predictedRooms", None)
    result = {"event": "onnx_baseline_metrics", "split": args.split, "taxonomy": taxonomy, **metrics}
    print(json.dumps(result), flush=True)
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")


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
