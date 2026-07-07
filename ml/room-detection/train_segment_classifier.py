"""Train the vector segment classifier (Head A: per-segment boundary probability).

Trains a small neighbour-attention encoder over spatial crops of segment graphs,
validates on full pages, and selects best.pt by validation boundary F1 (threshold
swept on val and stored in the checkpoint). Progress is logged as JSON at least
every --log-seconds (default 10s) with percentages and ETA.

    python train_segment_classifier.py --device auto --output-dir runs/vector-seg
"""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import numpy as np
import torch

from roomdet.vector_dataset import SegmentCropDataset, build_page_inputs, load_split_pages
from roomdet.vector_model import (
    SegmentEncoder,
    VectorModelConfig,
    encode_page_chunked,
    resolve_device,
    save_encoder_checkpoint,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--splits", type=Path, default=Path("vector-splits.json"))
    parser.add_argument("--pages-root", type=Path, default=None, help="defaults to metadata.pagesRoot from --splits")
    parser.add_argument("--output-dir", type=Path, default=Path("runs/vector-seg"))
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--crops-per-page", type=int, default=4)
    parser.add_argument("--batch-crops", type=int, default=2)
    parser.add_argument("--max-crop-segments", type=int, default=16_000)
    parser.add_argument("--k", type=int, default=12)
    parser.add_argument("--width", type=int, default=128)
    parser.add_argument("--layers", type=int, default=5)
    parser.add_argument("--dropout", type=float, default=0.1)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--pos-weight", type=float, default=0.0, help="0 = derive from label balance")
    parser.add_argument("--augment", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--metric-interval", type=int, default=1)
    parser.add_argument("--log-seconds", type=float, default=10.0)
    parser.add_argument("--infer-chunk", type=int, default=16_384)
    parser.add_argument("--seed", type=int, default=1337)
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    np.random.seed(args.seed)
    device = resolve_device(args.device)
    pages_root = args.pages_root or Path(json.loads(args.splits.read_text(encoding="utf-8"))["metadata"]["pagesRoot"])

    load_start = time.perf_counter()
    train_pages = [page for page in load_split_pages(args.splits, "train", pages_root) if page.has_labels]
    val_pages = [page for page in load_split_pages(args.splits, "val", pages_root) if page.has_labels]
    if not train_pages:
        raise SystemExit("Train split is empty. Run prepare_vector_dataset.py first.")

    dataset = SegmentCropDataset(
        train_pages,
        k=args.k,
        max_segments=args.max_crop_segments,
        crops_per_page=args.crops_per_page,
        augment=args.augment,
        seed=args.seed,
    )
    positives = sum(float(page.label_positive.sum()) for page in train_pages)
    total = sum(page.segment_count for page in train_pages)
    pos_weight_value = args.pos_weight if args.pos_weight > 0 else min(20.0, max(1.0, (total - positives) / max(1.0, positives)))

    config = VectorModelConfig(width=args.width, layers=args.layers, knn=args.k, dropout=args.dropout)
    model = SegmentEncoder(config).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=max(1, args.epochs))
    loss_fn = torch.nn.BCEWithLogitsLoss(pos_weight=torch.tensor(pos_weight_value, device=device))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    print(
        json.dumps(
            {
                "event": "vector_seg_config",
                "device": str(device),
                "trainPages": len(train_pages),
                "valPages": len(val_pages),
                "trainSegments": total,
                "positiveFraction": round(positives / max(1, total), 5),
                "posWeight": round(pos_weight_value, 3),
                "epochs": args.epochs,
                "cropsPerEpoch": len(dataset),
                "batchCrops": args.batch_crops,
                "maxCropSegments": args.max_crop_segments,
                "model": config.__dict__,
                "parameters": sum(parameter.numel() for parameter in model.parameters()),
                "loadSeconds": round(time.perf_counter() - load_start, 1),
            }
        ),
        flush=True,
    )

    history: list[dict[str, object]] = []
    best_f1 = -1.0
    training_start = time.perf_counter()
    for epoch in range(1, args.epochs + 1):
        epoch_start = time.perf_counter()
        print(json.dumps({"event": "epoch_start", "epoch": epoch, "epochs": args.epochs}), flush=True)
        train_loss = run_train_epoch(model, dataset, loss_fn, optimizer, device, epoch, args, training_start)
        scheduler.step()

        row: dict[str, object] = {
            "event": "epoch_complete",
            "epoch": epoch,
            "train_loss": round(train_loss, 6),
            "lr": scheduler.get_last_lr()[0],
            "epoch_seconds": round(time.perf_counter() - epoch_start, 1),
            "rough_remaining": format_duration((time.perf_counter() - epoch_start) * max(0, args.epochs - epoch)),
        }
        should_measure = val_pages and args.metric_interval > 0 and (
            epoch == 1 or epoch == args.epochs or epoch % args.metric_interval == 0
        )
        threshold = 0.5
        f1 = best_f1
        if should_measure:
            metrics = evaluate_full_pages(model, val_pages, device, args)
            row.update(metrics)
            f1 = float(metrics["valBestF1"])
            threshold = float(metrics["valBestThreshold"])
            print(json.dumps({"event": "val_metrics", "epoch": epoch, **metrics}), flush=True)

        history.append(row)
        print(json.dumps(row), flush=True)
        extra = {
            "epoch": epoch,
            "threshold": threshold,
            "history": history,
            "posWeight": pos_weight_value,
            "featureVersion": 1,
        }
        save_encoder_checkpoint(args.output_dir / "last.pt", model, extra)
        if f1 > best_f1:
            best_f1 = f1
            save_encoder_checkpoint(args.output_dir / "best.pt", model, extra)
            print(json.dumps({"event": "best_updated", "epoch": epoch, "valBestF1": round(f1, 5)}), flush=True)

    (args.output_dir / "history.json").write_text(json.dumps(history, indent=2) + "\n", encoding="utf-8")


def run_train_epoch(model, dataset, loss_fn, optimizer, device, epoch, args, training_start) -> float:
    model.train()
    order = list(range(len(dataset)))
    random.Random(hash((args.seed, epoch))).shuffle(order)
    batches = [order[i : i + args.batch_crops] for i in range(0, len(order), args.batch_crops)]

    total_loss = 0.0
    total_segments = 0
    phase_start = time.perf_counter()
    last_log = phase_start
    for batch_index, crop_ids in enumerate(batches, start=1):
        crops = [dataset.crop(crop_id, epoch=epoch) for crop_id in crop_ids]
        features, knn_idx, edge, labels = collate_crops(crops)
        features = features.to(device)
        knn_idx = knn_idx.to(device)
        edge = edge.to(device)
        labels = labels.to(device)

        _, logits = model(features, knn_idx, edge)
        loss = loss_fn(logits, labels)
        optimizer.zero_grad(set_to_none=True)
        loss.backward()
        optimizer.step()

        total_loss += float(loss.detach()) * len(labels)
        total_segments += len(labels)
        now = time.perf_counter()
        if batch_index == 1 or batch_index == len(batches) or now - last_log >= args.log_seconds:
            elapsed = max(1e-6, now - phase_start)
            print(
                json.dumps(
                    {
                        "event": "batch_progress",
                        "phase": "train_segment_classifier",
                        "epoch": epoch,
                        "epochs": args.epochs,
                        "batch": batch_index,
                        "batches": len(batches),
                        "percent": round(batch_index / len(batches) * 100.0, 1),
                        "avg_loss": round(total_loss / max(1, total_segments), 6),
                        "segments_per_second": round(total_segments / elapsed),
                        "elapsed": format_duration(elapsed),
                        "phase_eta": format_duration((len(batches) - batch_index) * elapsed / batch_index),
                        "total_elapsed": format_duration(now - training_start),
                    }
                ),
                flush=True,
            )
            last_log = now
    return total_loss / max(1, total_segments)


def collate_crops(crops) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    """Concatenate crops into one graph; kNN indices are offset per crop so
    attention never crosses crop boundaries."""
    features = []
    knn_idx = []
    edge = []
    labels = []
    offset = 0
    for crop in crops:
        features.append(torch.from_numpy(crop.features))
        knn_idx.append(torch.from_numpy(crop.knn_idx + offset))
        edge.append(torch.from_numpy(crop.edge))
        labels.append(torch.from_numpy(crop.label))
        offset += len(crop.features)
    return (
        torch.cat(features).float(),
        torch.cat(knn_idx).long(),
        torch.cat(edge).float(),
        torch.cat(labels).float(),
    )


@torch.no_grad()
def evaluate_full_pages(model, pages, device, args) -> dict[str, float]:
    """Full-page (no crop, no augmentation) precision/recall/F1 with threshold sweep."""
    all_probs: list[np.ndarray] = []
    all_labels: list[np.ndarray] = []
    for page in pages:
        features, knn_idx, edge = build_page_inputs(
            page.seg_p0, page.seg_p1, page.half_width, page.color, page.alpha, page.flags, page.page_bounds, args.k
        )
        _, logits = encode_page_chunked(
            model,
            torch.from_numpy(features).float(),
            torch.from_numpy(knn_idx).long(),
            torch.from_numpy(edge).float(),
            device,
            chunk_size=args.infer_chunk,
        )
        all_probs.append(torch.sigmoid(logits).numpy())
        all_labels.append(page.label_positive.astype(np.float32))

    probs = np.concatenate(all_probs)
    labels = np.concatenate(all_labels) > 0.5
    best = {"valBestF1": 0.0, "valBestThreshold": 0.5, "valBestPrecision": 0.0, "valBestRecall": 0.0}
    for threshold in np.linspace(0.05, 0.95, 19):
        predicted = probs >= threshold
        tp = float(np.logical_and(predicted, labels).sum())
        precision = tp / max(1.0, float(predicted.sum()))
        recall = tp / max(1.0, float(labels.sum()))
        f1 = 2 * precision * recall / max(1e-9, precision + recall)
        if f1 > best["valBestF1"]:
            best = {
                "valBestF1": round(f1, 5),
                "valBestThreshold": round(float(threshold), 3),
                "valBestPrecision": round(precision, 5),
                "valBestRecall": round(recall, 5),
            }
    predicted = probs >= 0.5
    tp = float(np.logical_and(predicted, labels).sum())
    precision = tp / max(1.0, float(predicted.sum()))
    recall = tp / max(1.0, float(labels.sum()))
    best["valF1At50"] = round(2 * precision * recall / max(1e-9, precision + recall), 5)
    best["valSegments"] = int(len(labels))
    return best


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
