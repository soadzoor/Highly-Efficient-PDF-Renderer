from __future__ import annotations

import argparse
from functools import partial
import json
import time
from pathlib import Path
from typing import Callable

import torch
from torch.utils.data import DataLoader

from roomdet.classes import CLASS_COUNT
from roomdet.losses import pdf_tsv_geometry_loss
from roomdet.model import create_model
from roomdet.pdf_tsv_dataset import PdfTsvGeometryDataset, read_pdf_tsv_split

LossFn = Callable[[torch.Tensor, torch.Tensor], torch.Tensor]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-checkpoint", required=True, type=Path)
    parser.add_argument("--pdf-tsv-splits", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--lr", type=float, default=5e-5)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--train-split", default="train")
    parser.add_argument("--val-split", default="val")
    parser.add_argument("--pdf-tsv-background-weight", type=float, default=0.35)
    parser.add_argument("--pdf-tsv-room-weight", type=float, default=1.0)
    parser.add_argument("--pdf-tsv-separator-weight", type=float, default=12.0)
    parser.add_argument("--pdf-tsv-separator-dice-weight", type=float, default=0.75)
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    parser.add_argument("--log-interval", type=int, default=5)
    parser.add_argument("--log-seconds", type=float, default=15.0)
    args = parser.parse_args()

    device = torch.device(args.device)
    checkpoint = torch.load(args.base_checkpoint, map_location="cpu")
    image_size = int(checkpoint.get("image_size", 1024))
    model = create_model(CLASS_COUNT, pretrained=False)
    model.load_state_dict(checkpoint["model"])
    model.to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    loss_fn = partial(
        pdf_tsv_geometry_loss,
        class_weights=(args.pdf_tsv_background_weight, args.pdf_tsv_room_weight, args.pdf_tsv_separator_weight),
        separator_dice_weight=args.pdf_tsv_separator_dice_weight,
    )

    train_samples = read_pdf_tsv_split(args.pdf_tsv_splits, args.train_split)
    val_samples = read_pdf_tsv_split(args.pdf_tsv_splits, args.val_split)
    train_loader = DataLoader(
        PdfTsvGeometryDataset(train_samples, augment=True),
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.workers,
        pin_memory=str(device).startswith("cuda"),
    )
    val_loader = DataLoader(
        PdfTsvGeometryDataset(val_samples),
        batch_size=max(1, args.batch_size // 2),
        shuffle=False,
        num_workers=args.workers,
        pin_memory=str(device).startswith("cuda"),
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    history: list[dict[str, object]] = []
    best_val = float("inf")
    training_start = time.perf_counter()
    print(
        json.dumps(
            {
                "event": "pdf_tsv_only_config",
                "base_checkpoint": str(args.base_checkpoint),
                "train_samples": len(train_samples),
                "val_samples": len(val_samples),
                "epochs": args.epochs,
                "batch_size": args.batch_size,
                "image_size": image_size,
                "workers": args.workers,
                "device": str(device),
                "lr": args.lr,
                "pdf_tsv_class_weights": [
                    args.pdf_tsv_background_weight,
                    args.pdf_tsv_room_weight,
                    args.pdf_tsv_separator_weight,
                ],
                "pdf_tsv_separator_dice_weight": args.pdf_tsv_separator_dice_weight,
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
        train_loss, train_seconds = run_phase(
            model,
            train_loader,
            loss_fn,
            optimizer,
            device,
            phase="train_pdf_tsv_only",
            epoch=epoch,
            epochs=args.epochs,
            log_interval=args.log_interval,
            log_seconds=args.log_seconds,
            training_start=training_start,
        )
        val_loss, val_seconds = run_phase(
            model,
            val_loader,
            loss_fn,
            None,
            device,
            phase="val_pdf_tsv_only",
            epoch=epoch,
            epochs=args.epochs,
            log_interval=args.log_interval,
            log_seconds=args.log_seconds,
            training_start=training_start,
        )
        epoch_seconds = time.perf_counter() - epoch_start
        row = {
            "event": "epoch_complete",
            "epoch": epoch,
            "pdf_tsv_train_loss": train_loss,
            "pdf_tsv_val_loss": val_loss,
            "weighted_val_loss": val_loss,
            "pdf_tsv_train_seconds": train_seconds,
            "pdf_tsv_val_seconds": val_seconds,
            "epoch_seconds": epoch_seconds,
            "rough_remaining": format_duration(epoch_seconds * max(0, args.epochs - epoch)),
        }
        history.append(row)
        print(json.dumps(row), flush=True)

        next_checkpoint = {
            "model": model.state_dict(),
            "epoch": epoch,
            "image_size": image_size,
            "class_count": CLASS_COUNT,
            "history": history,
            "base_checkpoint": str(args.base_checkpoint),
            "training_sources": ["pdf-tsv geometry"],
            "pdf_tsv_loss": {
                "class_weights": [
                    args.pdf_tsv_background_weight,
                    args.pdf_tsv_room_weight,
                    args.pdf_tsv_separator_weight,
                ],
                "separator_dice_weight": args.pdf_tsv_separator_dice_weight,
            },
        }
        torch.save(next_checkpoint, args.output_dir / "last.pt")
        if val_loss < best_val:
            best_val = val_loss
            torch.save(next_checkpoint, args.output_dir / "best.pt")

    (args.output_dir / "history.json").write_text(json.dumps(history, indent=2) + "\n", encoding="utf-8")


def run_phase(
    model: torch.nn.Module,
    loader: DataLoader,
    loss_fn: LossFn,
    optimizer: torch.optim.Optimizer | None,
    device: torch.device,
    *,
    phase: str,
    epoch: int,
    epochs: int,
    log_interval: int,
    log_seconds: float,
    training_start: float,
) -> tuple[float, float]:
    is_train = optimizer is not None
    model.train(is_train)
    total_loss = 0.0
    total_count = 0
    batch_count = len(loader)
    phase_start = time.perf_counter()
    last_log_time = phase_start
    with torch.set_grad_enabled(is_train):
        for batch_index, (images, masks) in enumerate(loader, start=1):
            images = images.to(device, non_blocking=True)
            masks = masks.to(device, non_blocking=True)
            logits = model(images)
            loss = loss_fn(logits, masks)
            if optimizer is not None:
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
                            "phase": phase,
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
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours}h {minutes}m {seconds}s"
    if minutes:
        return f"{minutes}m {seconds}s"
    return f"{seconds}s"


if __name__ == "__main__":
    main()
