"""Train the room-type head (Head C: clinical-coarse class per extracted face).

Teacher-forced on ground truth: each snapped GT polygon is a face whose members are
the segments labelled with that polygon as owner; the target is the clinical-coarse
mapping of its TSV roomType. Pages without roomType labels (zuckerman, xyicon_lk)
contribute geometry to the encoder but are skipped here.

    python train_room_type_head.py --encoder runs/vector-seg/best.pt --output-dir runs/vector-type
"""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import numpy as np
import torch

from roomdet.classes import PDF_TSV_CLINICAL_CLASSES, room_class_ids
from roomdet.vector_dataset import build_page_inputs, load_split_pages
from roomdet.vector_faces import face_shape_features
from roomdet.vector_model import FaceTypeHead, encode_page_chunked, load_encoder_checkpoint, resolve_device

ROOM_CLASS_IDS = room_class_ids(PDF_TSV_CLINICAL_CLASSES)
CLASS_ID_TO_INDEX = {class_id: index for index, class_id in enumerate(ROOM_CLASS_IDS)}
CLASS_LABELS = {spec.id: spec.label for spec in PDF_TSV_CLINICAL_CLASSES}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--encoder", type=Path, required=True)
    parser.add_argument("--splits", type=Path, default=Path("vector-splits.json"))
    parser.add_argument("--pages-root", type=Path, default=None)
    parser.add_argument("--output-dir", type=Path, default=Path("runs/vector-type"))
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--infer-chunk", type=int, default=16_384)
    parser.add_argument("--log-seconds", type=float, default=10.0)
    parser.add_argument("--seed", type=int, default=1337)
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    device = resolve_device(args.device)
    pages_root = args.pages_root or Path(json.loads(args.splits.read_text(encoding="utf-8"))["metadata"]["pagesRoot"])
    encoder, _ = load_encoder_checkpoint(args.encoder)
    encoder = encoder.to(device)
    encoder.eval()

    start = time.perf_counter()
    design: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for split in ("train", "val"):
        rows: list[np.ndarray] = []
        targets: list[int] = []
        pages = [page for page in load_split_pages(args.splits, split, pages_root) if page.has_labels and page.gt_polygons]
        last_log = time.perf_counter()
        for page_index, page in enumerate(pages, start=1):
            labelled = [index for index, room_type in enumerate(page.gt_room_types) if room_type.strip()]
            if not labelled:
                continue
            features, knn_idx, edge = build_page_inputs(
                page.seg_p0, page.seg_p1, page.half_width, page.color, page.alpha, page.flags, page.page_bounds, encoder.config.knn
            )
            embedding, _ = encode_page_chunked(
                encoder,
                torch.from_numpy(features).float(),
                torch.from_numpy(knn_idx).long(),
                torch.from_numpy(edge).float(),
                device,
                chunk_size=args.infer_chunk,
            )
            embedding = embedding.numpy()
            owners = page.owner if page.owner is not None else np.full(page.segment_count, -1, dtype=np.int32)
            for polygon_index in labelled:
                members = np.nonzero(owners == polygon_index)[0]
                pooled = embedding[members].mean(axis=0) if len(members) else np.zeros(embedding.shape[1], dtype=np.float32)
                shape = face_shape_features(page.snapped_polygons[polygon_index], page.page_bounds)
                rows.append(np.concatenate([pooled, shape]).astype(np.float32))
                targets.append(CLASS_ID_TO_INDEX[int(page.gt_class_ids[polygon_index])])
            now = time.perf_counter()
            if now - last_log >= args.log_seconds or page_index == len(pages):
                last_log = now
                print(
                    json.dumps(
                        {
                            "event": "embed_progress",
                            "split": split,
                            "page": page_index,
                            "pages": len(pages),
                            "percent": round(page_index / len(pages) * 100.0, 1),
                            "faces": len(targets),
                        }
                    ),
                    flush=True,
                )
        design[split] = (
            np.stack(rows) if rows else np.zeros((0, 1), dtype=np.float32),
            np.asarray(targets, dtype=np.int64),
        )

    train_x, train_y = design["train"]
    val_x, val_y = design["val"]
    if len(train_x) == 0:
        raise SystemExit("No roomType-labelled faces in the train split.")

    counts = np.bincount(train_y, minlength=len(ROOM_CLASS_IDS)).astype(np.float64)
    weights = np.sqrt(np.median(counts[counts > 0]) / np.maximum(counts, 1.0))
    weights = np.clip(weights, 0.25, 8.0)

    embedding_dim = encoder.config.width
    shape_dim = train_x.shape[1] - embedding_dim
    model = FaceTypeHead(embedding_dim, num_classes=len(ROOM_CLASS_IDS), shape_dim=shape_dim).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    loss_fn = torch.nn.CrossEntropyLoss(weight=torch.tensor(weights, dtype=torch.float32, device=device))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    print(
        json.dumps(
            {
                "event": "vector_type_config",
                "device": str(device),
                "trainFaces": len(train_y),
                "valFaces": len(val_y),
                "classCounts": {CLASS_LABELS[ROOM_CLASS_IDS[i]]: int(count) for i, count in enumerate(counts)},
                "embedSeconds": round(time.perf_counter() - start, 1),
            }
        ),
        flush=True,
    )

    train_x_t = torch.from_numpy(train_x)
    train_y_t = torch.from_numpy(train_y)
    best_accuracy = -1.0
    history: list[dict[str, object]] = []
    training_start = time.perf_counter()
    for epoch in range(1, args.epochs + 1):
        model.train()
        order = torch.randperm(len(train_y_t))
        total_loss = 0.0
        seen = 0
        last_log = time.perf_counter()
        batch_starts = range(0, len(order), args.batch_size)
        for batch_index, batch_start in enumerate(batch_starts, start=1):
            batch = order[batch_start : batch_start + args.batch_size]
            x = train_x_t[batch].to(device)
            y = train_y_t[batch].to(device)
            logits = model(x[:, :embedding_dim], x[:, embedding_dim:])
            loss = loss_fn(logits, y)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
            total_loss += float(loss.detach()) * len(y)
            seen += len(y)
            now = time.perf_counter()
            if now - last_log >= args.log_seconds:
                last_log = now
                print(
                    json.dumps(
                        {
                            "event": "batch_progress",
                            "phase": "train_room_type_head",
                            "epoch": epoch,
                            "epochs": args.epochs,
                            "batch": batch_index,
                            "batches": len(batch_starts),
                            "percent": round(batch_index / len(batch_starts) * 100.0, 1),
                            "avg_loss": round(total_loss / max(1, seen), 6),
                            "total_elapsed": format_duration(now - training_start),
                        }
                    ),
                    flush=True,
                )

        metrics = evaluate_type_head(model, val_x, val_y, embedding_dim, device) if len(val_y) else {}
        row = {"event": "epoch_complete", "epoch": epoch, "train_loss": round(total_loss / max(1, seen), 6), **metrics}
        history.append(row)
        print(json.dumps(row), flush=True)

        accuracy = float(metrics.get("valAccuracy", 0.0))
        payload = {
            "model": model.state_dict(),
            "embedding_dim": embedding_dim,
            "shape_dim": shape_dim,
            "class_ids": list(ROOM_CLASS_IDS),
            "encoder": str(args.encoder),
            "epoch": epoch,
            "history": history,
        }
        torch.save(payload, args.output_dir / "last.pt")
        if accuracy > best_accuracy:
            best_accuracy = accuracy
            torch.save(payload, args.output_dir / "best.pt")
            print(json.dumps({"event": "best_updated", "epoch": epoch, "valAccuracy": round(accuracy, 5)}), flush=True)

    (args.output_dir / "history.json").write_text(json.dumps(history, indent=2) + "\n", encoding="utf-8")


@torch.no_grad()
def evaluate_type_head(model, val_x, val_y, embedding_dim, device) -> dict[str, float]:
    model.eval()
    x = torch.from_numpy(val_x).to(device)
    logits = model(x[:, :embedding_dim], x[:, embedding_dim:])
    predicted = logits.argmax(dim=1).cpu().numpy()
    accuracy = float((predicted == val_y).mean()) if len(val_y) else 0.0
    per_class = []
    for class_index in range(len(ROOM_CLASS_IDS)):
        mask = val_y == class_index
        if mask.any():
            per_class.append(float((predicted[mask] == class_index).mean()))
    return {
        "valAccuracy": round(accuracy, 5),
        "valMacroAccuracy": round(float(np.mean(per_class)), 5) if per_class else 0.0,
        "valFaces": int(len(val_y)),
    }


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
