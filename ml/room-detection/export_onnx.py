from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from roomdet.classes import CLASS_COUNT, CLASSES, class_specs_from_manifest, manifest_classes
from roomdet.image_config import IMAGE_MEAN, IMAGE_STD
from roomdet.model import create_model


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--metrics", type=Path)
    parser.add_argument("--extra-metrics", type=Path)
    parser.add_argument("--version", default="pdf-tsv-roomtypes-only-v1")
    args = parser.parse_args()

    checkpoint = torch.load(args.checkpoint, map_location="cpu")
    image_size = int(checkpoint.get("image_size", 1024))
    classes = class_specs_from_manifest(checkpoint.get("classes")) if checkpoint.get("classes") else CLASSES
    class_count = int(checkpoint.get("class_count", max((spec.id for spec in classes), default=CLASS_COUNT - 1) + 1))
    model = create_model(class_count, pretrained=False)
    model.load_state_dict(checkpoint["model"])
    model.eval()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    dummy = torch.zeros(1, 3, image_size, image_size, dtype=torch.float32)
    torch.onnx.export(
        model,
        dummy,
        args.output,
        input_names=["image"],
        output_names=["logits"],
        opset_version=18,
        do_constant_folding=True,
        external_data=False,
    )

    metrics = {
        "status": "exported; run evaluate_pdf_tsv.py to populate validation metrics",
        "foregroundIou": None,
        "meanClassIou": None,
        "validationSamples": None,
    }
    if args.metrics and args.metrics.exists():
        metrics = json.loads(args.metrics.read_text(encoding="utf-8"))
    if args.extra_metrics and args.extra_metrics.exists():
        metrics.update(json.loads(args.extra_metrics.read_text(encoding="utf-8")))
    metrics.setdefault("trainingSources", checkpoint.get("training_sources", ["pdf-tsv roomType geometry"]))

    license_text = "Model trained from local PDF-TSV roomType geometry annotations."

    manifest = {
        "version": args.version,
        "onnxPath": "models/room-detector/model.onnx",
        "inputSize": {"width": image_size, "height": image_size},
        "classes": manifest_classes(classes),
        "mean": list(IMAGE_MEAN),
        "std": list(IMAGE_STD),
        "thresholds": {
            "minConfidence": 0.45,
            "minAreaPixels": 96,
            "simplifyTolerancePixels": 2.5,
            "maxDetectionsPerPage": 512,
            "foregroundIouExperimentalThreshold": 0.6,
            "separatorBarrierProbability": 0.12,
            "separatorBarrierPixels": 2,
            "contourExpansionPixels": 3,
            "roomSplitErosionPixels": 1,
            "doorArcStraightenMaxChordPixels": 0,
            "doorArcStraightenMaxDepthPixels": 0,
            "doorArcStraightenMinDepthPixels": 0,
            "orthogonalizePolygons": True,
            "orthogonalSnapAngleDegrees": 12,
            "orthogonalMinEdgePixels": 8,
            "notchRemovalMaxDepthPixels": 18,
            "notchRemovalMaxWidthPixels": 80,
            "polygonCleanupMaxPasses": 2,
        },
        "license": license_text,
        "metrics": metrics,
    }
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Exported {args.output}")
    print(f"Updated {args.manifest}")


if __name__ == "__main__":
    main()
