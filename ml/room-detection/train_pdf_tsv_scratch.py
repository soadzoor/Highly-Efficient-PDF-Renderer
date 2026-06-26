from __future__ import annotations

import argparse
from functools import partial
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image
import torch
from torch.utils.data import DataLoader

from roomdet.classes import manifest_classes, room_class_ids, separator_class_id
from roomdet.losses import pdf_tsv_multiclass_loss
from roomdet.model import create_model
from roomdet.pdf_tsv_dataset import PdfTsvGeometryDataset, read_pdf_tsv_class_specs, read_pdf_tsv_metadata, read_pdf_tsv_split
from roomdet.pdf_tsv_metrics import PdfTsvMetricConfig, evaluate_pdf_tsv_model


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf-tsv-splits", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--init", choices=("imagenet", "random"), default="imagenet")
    parser.add_argument("--epochs", type=int, default=250)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--train-split", default="train")
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--separator-dice-weight", type=float, default=0.5)
    parser.add_argument("--class-weight-mode", choices=("auto", "none"), default="auto")
    parser.add_argument("--max-class-weight", type=float, default=16.0)
    parser.add_argument("--augment", action="store_true")
    parser.add_argument("--metric-interval", type=int, default=1)
    parser.add_argument("--log-interval", type=int, default=5)
    parser.add_argument("--log-seconds", type=float, default=15.0)
    args = parser.parse_args()

    split_metadata = read_pdf_tsv_metadata(args.pdf_tsv_splits)
    target_mode = str(split_metadata.get("targetMode", "class"))
    if target_mode != "class":
        raise SystemExit("train_pdf_tsv_scratch.py requires class masks. Re-run prepare_pdf_tsv_dataset.py with --room-type-taxonomy clinical-coarse.")

    classes = read_pdf_tsv_class_specs(args.pdf_tsv_splits)
    class_count = max(spec.id for spec in classes) + 1
    separator_id = separator_class_id(classes)
    image_size = infer_image_size(read_pdf_tsv_split(args.pdf_tsv_splits, args.train_split))
    device = torch.device(args.device)

    train_samples = read_pdf_tsv_split(args.pdf_tsv_splits, args.train_split)
    if not train_samples:
        raise SystemExit(f"Split {args.train_split!r} has no samples.")
    train_loader = DataLoader(
        PdfTsvGeometryDataset(train_samples, augment=args.augment),
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.workers,
        pin_memory=str(device).startswith("cuda"),
    )
    metric_loader = DataLoader(
        PdfTsvGeometryDataset(train_samples),
        batch_size=max(1, args.batch_size),
        shuffle=False,
        num_workers=args.workers,
        pin_memory=str(device).startswith("cuda"),
    )

    model = create_model(class_count, pretrained=args.init == "imagenet").to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    class_weights = (
        compute_auto_class_weights(train_samples, class_count, classes, args.max_class_weight)
        if args.class_weight_mode == "auto"
        else None
    )
    loss_fn = partial(
        pdf_tsv_multiclass_loss,
        class_weights=class_weights,
        separator_id=separator_id,
        separator_dice_weight=args.separator_dice_weight,
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    history: list[dict[str, object]] = []
    best_matched_iou = -1.0
    best_foreground_iou = -1.0
    training_start = time.perf_counter()
    print(
        json.dumps(
            {
                "event": "pdf_tsv_scratch_config",
                "splits": str(args.pdf_tsv_splits),
                "train_samples": len(train_samples),
                "epochs": args.epochs,
                "batch_size": args.batch_size,
                "image_size": image_size,
                "workers": args.workers,
                "device": str(device),
                "init": args.init,
                "lr": args.lr,
                "class_count": class_count,
                "classes": manifest_classes(classes),
                "class_weights": class_weights,
                "separator_dice_weight": args.separator_dice_weight,
                "metric_interval": args.metric_interval,
            }
        ),
        flush=True,
    )
    if device.type == "cuda":
        print(
            json.dumps(
                {
                    "event": "cuda_device",
                    "name": torch.cuda.get_device_name(device),
                    "memory_gb": round(torch.cuda.get_device_properties(device).total_memory / (1024**3), 2),
                }
            ),
            flush=True,
        )

    for epoch in range(1, args.epochs + 1):
        epoch_start = time.perf_counter()
        print(json.dumps({"event": "epoch_start", "epoch": epoch, "epochs": args.epochs}), flush=True)
        train_loss, train_seconds = run_train_epoch(
            model,
            train_loader,
            loss_fn,
            optimizer,
            device,
            epoch=epoch,
            epochs=args.epochs,
            log_interval=args.log_interval,
            log_seconds=args.log_seconds,
            training_start=training_start,
        )
        row: dict[str, object] = {
            "event": "epoch_complete",
            "epoch": epoch,
            "train_loss": train_loss,
            "train_seconds": train_seconds,
            "epoch_seconds": time.perf_counter() - epoch_start,
            "rough_remaining": format_duration((time.perf_counter() - epoch_start) * max(0, args.epochs - epoch)),
        }

        should_measure = args.metric_interval > 0 and (epoch == 1 or epoch == args.epochs or epoch % args.metric_interval == 0)
        if should_measure:
            metrics = evaluate_pdf_tsv_model(
                model,
                metric_loader,
                device,
                PdfTsvMetricConfig(classes=classes, target_mode="class", instance_matching=True),
                loss_fn=loss_fn,
            )
            row.update(metrics)
            matched_iou = float(metrics.get("pdfTsvMatchedRoomMeanIou", 0.0))
            foreground_iou = float(metrics.get("pdfTsvForegroundIou", 0.0))
            print(json.dumps({"event": "train_metrics", "epoch": epoch, **metrics}), flush=True)
        else:
            matched_iou = best_matched_iou
            foreground_iou = best_foreground_iou

        history.append(row)
        print(json.dumps(row), flush=True)
        checkpoint = {
            "model": model.state_dict(),
            "epoch": epoch,
            "image_size": image_size,
            "class_count": class_count,
            "classes": manifest_classes(classes),
            "target_mode": "class",
            "taxonomy": split_metadata.get("taxonomy", "clinical-coarse"),
            "history": history,
            "init": args.init,
            "training_sources": ["pdf-tsv roomType geometry"],
            "class_weights": class_weights,
            "separator_dice_weight": args.separator_dice_weight,
        }
        torch.save(checkpoint, args.output_dir / "last.pt")
        if matched_iou > best_matched_iou or (matched_iou == best_matched_iou and foreground_iou > best_foreground_iou):
            best_matched_iou = matched_iou
            best_foreground_iou = foreground_iou
            torch.save(checkpoint, args.output_dir / "best.pt")

    (args.output_dir / "history.json").write_text(json.dumps(history, indent=2) + "\n", encoding="utf-8")


def run_train_epoch(
    model: torch.nn.Module,
    loader: DataLoader,
    loss_fn,
    optimizer: torch.optim.Optimizer,
    device: torch.device,
    *,
    epoch: int,
    epochs: int,
    log_interval: int,
    log_seconds: float,
    training_start: float,
) -> tuple[float, float]:
    model.train()
    total_loss = 0.0
    total_count = 0
    batch_count = len(loader)
    phase_start = time.perf_counter()
    last_log_time = phase_start
    for batch_index, (images, masks) in enumerate(loader, start=1):
        images = images.to(device, non_blocking=True)
        masks = masks.to(device, non_blocking=True)
        logits = model(images)
        loss = loss_fn(logits, masks)
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        optimizer.step()
        total_loss += float(loss.detach()) * images.shape[0]
        total_count += images.shape[0]
        now = time.perf_counter()
        if should_log_progress(batch_index, batch_count, log_interval, log_seconds, now, last_log_time):
            if device.type == "cuda":
                torch.cuda.synchronize(device)
                now = time.perf_counter()
            elapsed = max(1e-6, now - phase_start)
            total_elapsed = now - training_start
            batches_per_second = batch_index / elapsed
            print(
                json.dumps(
                    {
                        "event": "batch_progress",
                        "phase": "train_pdf_tsv_scratch",
                        "epoch": epoch,
                        "epochs": epochs,
                        "batch": batch_index,
                        "batches": batch_count,
                        "samples": total_count,
                        "avg_loss": round(total_loss / max(1, total_count), 6),
                        "samples_per_second": round(total_count / elapsed, 2),
                        "elapsed": format_duration(elapsed),
                        "phase_eta": format_duration((batch_count - batch_index) / max(1e-6, batches_per_second)),
                        "total_elapsed": format_duration(total_elapsed),
                    }
                ),
                flush=True,
            )
            last_log_time = now
    return total_loss / max(1, total_count), time.perf_counter() - phase_start


def compute_auto_class_weights(
    samples,
    class_count: int,
    classes,
    max_weight: float,
) -> list[float]:
    counts = np.zeros(class_count, dtype=np.float64)
    for sample in samples:
        mask = np.asarray(Image.open(sample.mask_path).convert("L"), dtype=np.uint8)
        counts += np.bincount(mask.reshape(-1), minlength=class_count)[:class_count]
    nonzero = counts[counts > 0]
    if nonzero.size <= 0:
        return [1.0] * class_count
    median = float(np.median(nonzero))
    weights = np.sqrt(median / np.maximum(counts, 1.0))
    room_ids = set(room_class_ids(classes))
    sep_id = separator_class_id(classes)
    for class_id in range(class_count):
        if class_id == 0:
            weights[class_id] = min(weights[class_id], 0.35)
        elif class_id == sep_id:
            weights[class_id] = max(weights[class_id], 8.0)
        elif class_id in room_ids:
            weights[class_id] = max(weights[class_id], 1.0)
    weights = np.clip(weights, 0.05, max_weight)
    return [float(value) for value in weights]


def infer_image_size(samples) -> int:
    if not samples:
        return 1024
    with Image.open(samples[0].image_path) as image:
        return int(image.size[0])


def should_log_progress(
    batch_index: int,
    batch_count: int,
    log_interval: int,
    log_seconds: float,
    now: float,
    last_log_time: float,
) -> bool:
    return (
        batch_index == 1
        or batch_index == batch_count
        or (log_interval > 0 and batch_index % log_interval == 0)
        or (log_seconds > 0 and now - last_log_time >= log_seconds)
    )


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
