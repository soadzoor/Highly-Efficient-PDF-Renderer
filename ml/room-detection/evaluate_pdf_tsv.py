from __future__ import annotations

import argparse
from functools import partial
import json
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from roomdet.classes import PDF_TSV_GEOMETRY_CLASSES, class_specs_from_manifest, separator_class_id
from roomdet.losses import pdf_tsv_geometry_loss, pdf_tsv_multiclass_loss
from roomdet.model import create_model
from roomdet.pdf_tsv_dataset import PdfTsvGeometryDataset, read_pdf_tsv_class_specs, read_pdf_tsv_metadata, read_pdf_tsv_split
from roomdet.pdf_tsv_metrics import PdfTsvMetricConfig, evaluate_pdf_tsv_model


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--splits", required=True, type=Path)
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--split", default="val")
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--instance-matching", action="store_true")
    args = parser.parse_args()

    checkpoint = torch.load(args.checkpoint, map_location="cpu")
    split_metadata = read_pdf_tsv_metadata(args.splits)
    checkpoint_classes = checkpoint.get("classes")
    classes = class_specs_from_manifest(checkpoint_classes) if checkpoint_classes else read_pdf_tsv_class_specs(args.splits)
    target_mode = str(checkpoint.get("target_mode", split_metadata.get("targetMode", "geometry")))
    class_count = int(checkpoint.get("class_count", max(spec.id for spec in classes) + 1))
    if checkpoint_classes is None and target_mode == "geometry":
        classes = PDF_TSV_GEOMETRY_CLASSES

    model = create_model(class_count, pretrained=False)
    model.load_state_dict(checkpoint["model"])
    model.to(args.device)
    model.eval()

    samples = read_pdf_tsv_split(args.splits, args.split)
    loader = DataLoader(
        PdfTsvGeometryDataset(samples),
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=args.workers,
        pin_memory=str(args.device).startswith("cuda"),
    )

    if target_mode == "geometry":
        loss_fn = pdf_tsv_geometry_loss
    else:
        loss_fn = partial(
            pdf_tsv_multiclass_loss,
            separator_id=separator_class_id(classes),
            separator_dice_weight=float(checkpoint.get("separator_dice_weight", 0.5)),
        )
    metrics = evaluate_pdf_tsv_model(
        model,
        loader,
        args.device,
        PdfTsvMetricConfig(classes=classes, target_mode=target_mode, instance_matching=args.instance_matching),
        loss_fn=loss_fn,
    )
    metrics["pdfTsvSplit"] = args.split
    metrics["pdfTsvTargetMode"] = target_mode
    metrics["trainingSources"] = checkpoint.get("training_sources", split_metadata.get("trainingSources", ["pdf-tsv"]))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
