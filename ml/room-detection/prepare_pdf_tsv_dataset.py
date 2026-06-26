from __future__ import annotations

import argparse
import json
from pathlib import Path

from roomdet.pdf_tsv_dataset import (
    discover_pdf_tsv_pairs,
    prepare_pdf_tsv_sample,
    serialize_prepared_sample,
    write_pdf_tsv_splits,
)
from roomdet.classes import classes_for_taxonomy, manifest_classes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf-tsv-root", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--splits", required=True, type=Path)
    parser.add_argument("--image-size", type=int, default=1024)
    parser.add_argument("--separator-width", type=int, default=3)
    parser.add_argument("--no-debug-overlays", action="store_true")
    parser.add_argument("--seed", type=int, default=1337)
    parser.add_argument("--split-mode", choices=("standard", "train-all"), default="standard")
    parser.add_argument("--room-type-taxonomy", choices=("geometry", "clinical-coarse"), default="geometry")
    args = parser.parse_args()

    discovery = discover_pdf_tsv_pairs(args.pdf_tsv_root)
    if discovery.missing_pdfs or discovery.missing_tsvs:
        print(
            json.dumps(
                {
                    "event": "pair_warnings",
                    "missing_pdfs": discovery.missing_pdfs,
                    "missing_tsvs": discovery.missing_tsvs,
                }
            ),
            flush=True,
        )
    if not discovery.pairs:
        raise SystemExit(f"No matched PDF/TSV pairs found in {args.pdf_tsv_root}.")

    samples = []
    class_specs = classes_for_taxonomy(args.room_type_taxonomy)
    for index, pair in enumerate(discovery.pairs, start=1):
        print(
            json.dumps(
                {
                    "event": "prepare_start",
                    "index": index,
                    "count": len(discovery.pairs),
                    "stem": pair.stem,
                }
            ),
            flush=True,
        )
        sample = prepare_pdf_tsv_sample(
            pair,
            args.output_root,
            image_size=args.image_size,
            separator_width=args.separator_width,
            debug_overlay=not args.no_debug_overlays,
            room_type_taxonomy=args.room_type_taxonomy,
        )
        samples.append(sample)
        print(
            json.dumps(
                {
                    "event": "prepare_complete",
                    "stem": sample.stem,
                    "rows": sample.geometry_rows,
                    "skipped_rows": sample.skipped_rows,
                    "exterior_rows": sample.exterior_rows,
                    "rotation": sample.rotation,
                    "page_box": sample.page_box,
                    "foreground_coverage": round(sample.foreground_coverage, 6),
                    "separator_coverage": round(sample.separator_coverage, 6),
                    "mask_bbox": sample.mask_bbox,
                    "qc_warnings": sample.qc_warnings,
                    "target_mode": sample.target_mode,
                    "taxonomy": sample.taxonomy,
                    "room_class_counts": sample.room_class_counts,
                    "room_number_count": sample.room_number_count,
                    "image": str(sample.image_path),
                    "mask": str(sample.mask_path),
                    "debug": str(sample.debug_path) if sample.debug_path else None,
                }
            ),
            flush=True,
        )

    write_pdf_tsv_splits(
        samples,
        args.splits,
        seed=args.seed,
        split_mode=args.split_mode,
        class_specs=class_specs,
        taxonomy=args.room_type_taxonomy,
    )
    manifest_path = args.output_root / "metadata.json"
    total_class_pixel_counts: dict[str, int] = {}
    total_room_type_counts: dict[str, int] = {}
    total_room_class_counts: dict[str, int] = {}
    for sample in samples:
        for key, value in (sample.class_pixel_counts or {}).items():
            total_class_pixel_counts[key] = total_class_pixel_counts.get(key, 0) + int(value)
        for key, value in (sample.room_type_counts or {}).items():
            total_room_type_counts[key] = total_room_type_counts.get(key, 0) + int(value)
        for key, value in (sample.room_class_counts or {}).items():
            total_room_class_counts[key] = total_room_class_counts.get(key, 0) + int(value)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(
            {
                "imageSize": args.image_size,
                "separatorWidth": args.separator_width,
                "debugOverlays": not args.no_debug_overlays,
                "splitMode": args.split_mode,
                "roomTypeTaxonomy": args.room_type_taxonomy,
                "classes": manifest_classes(class_specs),
                "sampleCount": len(samples),
                "classPixelCounts": dict(sorted(total_class_pixel_counts.items())),
                "roomTypeCounts": dict(sorted(total_room_type_counts.items())),
                "roomClassCounts": dict(sorted(total_room_class_counts.items())),
                "samples": [serialize_prepared_sample(sample) for sample in samples],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "event": "prepare_all_complete",
                "samples": len(samples),
                "splits": str(args.splits),
                "metadata": str(manifest_path),
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
