"""Train the gap bridger (Head B: link prediction over free-endpoint pairs).

Uses the frozen segment encoder to embed each page once, then trains a small MLP
on GT-derived bridge candidates (positives = candidates whose straight bridge
tracks the snapped GT boundary through ink-free gaps, i.e. doors and wall breaks).

    python train_gap_bridger.py --encoder runs/vector-seg/best.pt --output-dir runs/vector-bridge
"""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import numpy as np
import torch

from roomdet.vector_dataset import (
    PageNormalizers,
    build_bridge_features,
    build_page_inputs,
    load_split_pages,
)
from roomdet.vector_model import BridgeScorer, encode_page_chunked, load_encoder_checkpoint, resolve_device


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--encoder", type=Path, required=True)
    parser.add_argument("--splits", type=Path, default=Path("vector-splits.json"))
    parser.add_argument("--pages-root", type=Path, default=None)
    parser.add_argument("--output-dir", type=Path, default=Path("runs/vector-bridge"))
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch-size", type=int, default=4096)
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
    encoder, encoder_payload = load_encoder_checkpoint(args.encoder)
    encoder = encoder.to(device)
    encoder.eval()
    knn = encoder.config.knn

    start = time.perf_counter()
    design: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for split in ("train", "val"):
        rows: list[np.ndarray] = []
        labels: list[np.ndarray] = []
        pages = [page for page in load_split_pages(args.splits, split, pages_root) if page.has_labels]
        last_log = time.perf_counter()
        for page_index, page in enumerate(pages, start=1):
            if page.bridge_a is None or len(page.bridge_a) == 0:
                continue
            features, knn_idx, edge = build_page_inputs(
                page.seg_p0, page.seg_p1, page.half_width, page.color, page.alpha, page.flags, page.page_bounds, knn
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
            normalizers = PageNormalizers.for_page(page)
            pair = build_bridge_features(
                page.seg_p0, page.seg_p1, page.half_width, page.bridge_a, page.bridge_b, page.bridge_coords, normalizers
            )
            # fp16 storage: dense hospital sheets alone yield 100k+ candidates.
            rows.append(
                np.concatenate([embedding[page.bridge_a], embedding[page.bridge_b], pair], axis=1).astype(np.float16)
            )
            labels.append(page.bridge_pos.astype(np.float32))
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
                            "candidates": int(sum(len(row) for row in rows)),
                        }
                    ),
                    flush=True,
                )
        if rows:
            design[split] = (np.concatenate(rows), np.concatenate(labels))
        else:
            design[split] = (np.zeros((0, 1), dtype=np.float32), np.zeros(0, dtype=np.float32))

    train_x, train_y = design["train"]
    val_x, val_y = design["val"]
    if len(train_x) == 0:
        raise SystemExit("No bridge candidates in the train split; re-run prepare_vector_dataset.py.")

    positives = float(train_y.sum())
    pos_weight = min(50.0, max(1.0, (len(train_y) - positives) / max(1.0, positives)))
    embedding_dim = encoder.config.width
    pair_dim = train_x.shape[1] - 2 * embedding_dim
    model = BridgeScorer(embedding_dim, pair_dim=pair_dim).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    loss_fn = torch.nn.BCEWithLogitsLoss(pos_weight=torch.tensor(pos_weight, device=device))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    print(
        json.dumps(
            {
                "event": "vector_bridge_config",
                "device": str(device),
                "trainCandidates": len(train_y),
                "trainPositives": int(positives),
                "valCandidates": len(val_y),
                "posWeight": round(pos_weight, 2),
                "embeddingDim": embedding_dim,
                "pairDim": pair_dim,
                "embedSeconds": round(time.perf_counter() - start, 1),
            }
        ),
        flush=True,
    )

    train_x_t = torch.from_numpy(train_x)
    train_y_t = torch.from_numpy(train_y)
    best_f1 = -1.0
    history: list[dict[str, object]] = []
    training_start = time.perf_counter()
    for epoch in range(1, args.epochs + 1):
        model.train()
        order = torch.randperm(len(train_y_t))
        total_loss = 0.0
        seen = 0
        batches = range(0, len(order), args.batch_size)
        last_log = time.perf_counter()
        for batch_index, batch_start in enumerate(batches, start=1):
            batch = order[batch_start : batch_start + args.batch_size]
            x = train_x_t[batch].to(device).float()
            y = train_y_t[batch].to(device)
            logits = model(x[:, :embedding_dim], x[:, embedding_dim : 2 * embedding_dim], x[:, 2 * embedding_dim :])
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
                            "phase": "train_gap_bridger",
                            "epoch": epoch,
                            "epochs": args.epochs,
                            "batch": batch_index,
                            "batches": len(batches),
                            "percent": round(batch_index / len(batches) * 100.0, 1),
                            "avg_loss": round(total_loss / max(1, seen), 6),
                            "total_elapsed": format_duration(now - training_start),
                        }
                    ),
                    flush=True,
                )

        metrics = evaluate_bridger(model, val_x, val_y, embedding_dim, device) if len(val_y) else {}
        row = {
            "event": "epoch_complete",
            "epoch": epoch,
            "train_loss": round(total_loss / max(1, seen), 6),
            **metrics,
        }
        history.append(row)
        print(json.dumps(row), flush=True)

        f1 = float(metrics.get("valBestF1", 0.0))
        payload = {
            "model": model.state_dict(),
            "embedding_dim": embedding_dim,
            "pair_dim": pair_dim,
            "encoder": str(args.encoder),
            "threshold": float(metrics.get("valBestThreshold", 0.5)),
            "epoch": epoch,
            "history": history,
        }
        torch.save(payload, args.output_dir / "last.pt")
        if f1 > best_f1:
            best_f1 = f1
            torch.save(payload, args.output_dir / "best.pt")
            print(json.dumps({"event": "best_updated", "epoch": epoch, "valBestF1": round(f1, 5)}), flush=True)

    (args.output_dir / "history.json").write_text(json.dumps(history, indent=2) + "\n", encoding="utf-8")


@torch.no_grad()
def evaluate_bridger(model, val_x, val_y, embedding_dim, device) -> dict[str, float]:
    model.eval()
    x = torch.from_numpy(val_x).to(device).float()
    logits = model(x[:, :embedding_dim], x[:, embedding_dim : 2 * embedding_dim], x[:, 2 * embedding_dim :])
    probs = torch.sigmoid(logits).cpu().numpy()
    labels = val_y > 0.5
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
    best["valCandidates"] = int(len(labels))
    best["valPositives"] = int(labels.sum())
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
