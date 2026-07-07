"""End-to-end evaluation of the vector pipeline on the instance-matching harness.

encoder -> per-segment probabilities -> (optional) learned gap bridges ->
polygonize -> scored faces -> (optional) room-type head -> rasterized only for
scoring against raw-TSV ground truth with the same compute_instance_metrics the
raster CNN baseline uses. --scale-check re-runs everything at x0.25 and x4
coordinates and reports the metric deltas (they must be ~0: scale invariance).

    python evaluate_vector_rooms.py --checkpoint runs/vector-seg/best.pt --split val --scale-check
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch

from roomdet.vector_dataset import (
    VectorPage,
    VectorPrepConfig,
    PageNormalizers,
    build_bridge_candidates,
    build_bridge_features,
    build_page_inputs,
    load_split_pages,
)
from roomdet.vector_faces import FaceConfig, extract_rooms, face_shape_features, pooled_face_embedding
from roomdet.vector_metrics import (
    aggregate_page_metrics,
    evaluate_rooms_on_page,
    scale_invariance_delta,
    scale_vector_page,
)
from roomdet.vector_model import BridgeScorer, FaceTypeHead, encode_page_chunked, load_encoder_checkpoint, resolve_device


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True, help="segment classifier best.pt")
    parser.add_argument("--splits", type=Path, default=Path("vector-splits.json"))
    parser.add_argument("--pages-root", type=Path, default=None)
    parser.add_argument("--split", default="val")
    parser.add_argument("--threshold", type=float, default=None, help="boundary threshold; default from checkpoint")
    parser.add_argument("--bridger", type=Path, default=None, help="optional runs/vector-bridge/best.pt")
    parser.add_argument("--type-head", type=Path, default=None, help="optional runs/vector-type/best.pt")
    parser.add_argument("--taxonomy", choices=("geometry", "clinical-coarse"), default="geometry")
    parser.add_argument("--image-size", type=int, default=1536)
    parser.add_argument("--separator-width", type=int, default=3)
    parser.add_argument("--min-coverage", type=float, default=FaceConfig.min_perimeter_coverage)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--infer-chunk", type=int, default=16_384)
    parser.add_argument("--scale-check", action="store_true")
    parser.add_argument("--qc-dir", type=Path, default=None)
    parser.add_argument("--log-seconds", type=float, default=10.0)
    parser.add_argument("--output", type=Path, default=None, help="write metrics JSON here as well")
    args = parser.parse_args()

    if args.taxonomy == "clinical-coarse" and args.type_head is None:
        raise SystemExit("--taxonomy clinical-coarse needs --type-head")

    device = resolve_device(args.device)
    pages_root = args.pages_root or Path(json.loads(args.splits.read_text(encoding="utf-8"))["metadata"]["pagesRoot"])
    encoder, encoder_payload = load_encoder_checkpoint(args.checkpoint)
    encoder = encoder.to(device)
    threshold = args.threshold if args.threshold is not None else float(encoder_payload.get("threshold", 0.5))
    face_config = FaceConfig(threshold=threshold, min_perimeter_coverage=args.min_coverage)
    prep_config = VectorPrepConfig()

    bridger = bridger_threshold = None
    if args.bridger is not None:
        payload = torch.load(args.bridger, map_location="cpu", weights_only=False)
        bridger = BridgeScorer(payload["embedding_dim"], pair_dim=payload["pair_dim"]).to(device)
        bridger.load_state_dict(payload["model"])
        bridger.eval()
        bridger_threshold = float(payload.get("threshold", 0.5))

    type_head = type_class_ids = None
    if args.type_head is not None:
        payload = torch.load(args.type_head, map_location="cpu", weights_only=False)
        type_head = FaceTypeHead(payload["embedding_dim"], num_classes=len(payload["class_ids"]), shape_dim=payload["shape_dim"]).to(device)
        type_head.load_state_dict(payload["model"])
        type_head.eval()
        type_class_ids = [int(value) for value in payload["class_ids"]]

    pages = load_split_pages(args.splits, args.split, pages_root)
    print(
        json.dumps(
            {
                "event": "vector_eval_config",
                "split": args.split,
                "pages": len(pages),
                "device": str(device),
                "threshold": round(threshold, 3),
                "taxonomy": args.taxonomy,
                "bridger": str(args.bridger) if args.bridger else None,
                "typeHead": str(args.type_head) if args.type_head else None,
                "scaleCheck": args.scale_check,
            }
        ),
        flush=True,
    )
    if args.qc_dir is not None:
        args.qc_dir.mkdir(parents=True, exist_ok=True)

    def run(scale: float) -> dict[str, object]:
        rows = []
        negative_pred_rooms = 0
        start = time.perf_counter()
        last_log = start
        for page_index, original in enumerate(pages, start=1):
            page = scale_vector_page(original, scale) if scale != 1.0 else original
            faces, probs, embedding = detect_page(
                page, encoder, device, threshold, face_config, prep_config, bridger, bridger_threshold, args
            )
            if type_head is not None and faces:
                assign_face_classes(faces, embedding, page, type_head, type_class_ids, device)
            if page.has_labels:
                row = evaluate_rooms_on_page(
                    page,
                    faces,
                    image_size=args.image_size,
                    separator_width=args.separator_width,
                    taxonomy=args.taxonomy,
                )
                rows.append(row)
                if not page.gt_polygons:
                    negative_pred_rooms += len(faces)
            if scale == 1.0 and args.qc_dir is not None:
                write_eval_overlay(page, faces, probs, args.qc_dir / f"{page.folder}__{page.stem}.png", args.image_size)
            now = time.perf_counter()
            if now - last_log >= args.log_seconds or page_index == len(pages):
                last_log = now
                partial = aggregate_page_metrics(rows) if rows else {}
                print(
                    json.dumps(
                        {
                            "event": "page_progress",
                            "scale": scale,
                            "page": page_index,
                            "pages": len(pages),
                            "percent": round(page_index / len(pages) * 100.0, 1),
                            "stem": page.stem,
                            "faces": len(faces),
                            "runningMeanIou": round(float(partial.get("pdfTsvMatchedRoomMeanIou", 0.0)), 4) if rows else None,
                            "eta": format_duration((now - start) / page_index * (len(pages) - page_index)),
                        }
                    ),
                    flush=True,
                )
        metrics = aggregate_page_metrics(rows) if rows else {"pages": 0}
        metrics["predictedRoomsOnNegativePages"] = negative_pred_rooms
        metrics["scale"] = scale
        return metrics

    base_metrics = run(1.0)
    print(json.dumps({"event": "vector_eval_metrics", "split": args.split, **base_metrics}), flush=True)

    results: dict[str, object] = {"split": args.split, "threshold": threshold, "metrics": base_metrics}
    if args.scale_check:
        deltas = {}
        for factor in (0.25, 4.0):
            scaled_metrics = run(factor)
            print(json.dumps({"event": "vector_eval_metrics", "split": args.split, **scaled_metrics}), flush=True)
            deltas[str(factor)] = round(scale_invariance_delta(base_metrics, scaled_metrics), 6)
            results[f"metricsAtScale{factor}"] = scaled_metrics
        results["scaleInvarianceMaxDelta"] = max(deltas.values())
        print(json.dumps({"event": "scale_check", "deltas": deltas, "maxDelta": max(deltas.values())}), flush=True)

    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")


def detect_page(page, encoder, device, threshold, face_config, prep_config, bridger, bridger_threshold, args):
    features, knn_idx, edge = build_page_inputs(
        page.seg_p0, page.seg_p1, page.half_width, page.color, page.alpha, page.flags, page.page_bounds, encoder.config.knn
    )
    embedding, logits = encode_page_chunked(
        encoder,
        torch.from_numpy(features).float(),
        torch.from_numpy(knn_idx).long(),
        torch.from_numpy(edge).float(),
        device,
        chunk_size=args.infer_chunk,
    )
    probs = torch.sigmoid(logits).numpy()

    bridge_coords = None
    if bridger is not None:
        seg_a, seg_b, coords, _ = build_bridge_candidates(page, probs >= threshold, prep_config)
        if len(seg_a):
            normalizers = PageNormalizers.for_page(page)
            pair = build_bridge_features(page.seg_p0, page.seg_p1, page.half_width, seg_a, seg_b, coords, normalizers)
            with torch.no_grad():
                embedding_t = embedding.to(device)
                scores = torch.sigmoid(
                    bridger(
                        embedding_t[torch.from_numpy(seg_a)],
                        embedding_t[torch.from_numpy(seg_b)],
                        torch.from_numpy(pair).to(device),
                    )
                ).cpu().numpy()
            accepted = scores >= bridger_threshold
            if accepted.any():
                bridge_coords = coords[accepted]

    faces = extract_rooms(page, probs, face_config=face_config, prep_config=prep_config, bridge_coords=bridge_coords)
    return faces, probs, embedding


def assign_face_classes(faces, embedding, page, type_head, type_class_ids, device) -> None:
    embedding_np = embedding.numpy()
    pooled = np.stack([pooled_face_embedding(embedding_np, face.member_segments) for face in faces])
    shapes = np.stack([face_shape_features(face.polygon, page.page_bounds) for face in faces])
    with torch.no_grad():
        logits = type_head(torch.from_numpy(pooled).to(device), torch.from_numpy(shapes).to(device))
        predicted = logits.argmax(dim=1).cpu().numpy()
    for face, class_index in zip(faces, predicted):
        face.class_id = type_class_ids[int(class_index)]


def write_eval_overlay(page: VectorPage, faces, probs, path: Path, image_size: int) -> None:
    from PIL import Image, ImageDraw

    from roomdet.vector_metrics import letterbox_frame, polygon_to_pixels

    frame_params = letterbox_frame(page.page_bounds, [page.gt_polygons, [face.polygon for face in faces]], image_size)
    frame, _, render_width, render_height, offset_x, offset_y = frame_params
    image = Image.new("RGB", (image_size, image_size), (255, 255, 255))
    draw = ImageDraw.Draw(image)

    def to_pixel(points: np.ndarray) -> list[tuple[float, float]]:
        return polygon_to_pixels(points, frame, render_width, render_height, offset_x, offset_y)

    for segment_index in range(page.segment_count):
        pixels = to_pixel(np.stack([page.seg_p0[segment_index], page.seg_p1[segment_index]]))
        strong = probs[segment_index] >= 0.5
        draw.line([tuple(pixels[0]), tuple(pixels[1])], fill=(37, 99, 235) if strong else (226, 232, 240), width=2 if strong else 1)
    for polygon in page.gt_polygons:
        pixels = to_pixel(polygon)
        draw.line([*map(tuple, pixels), tuple(pixels[0])], fill=(22, 163, 74), width=2)
    for face in faces:
        pixels = to_pixel(face.polygon)
        draw.line([*map(tuple, pixels), tuple(pixels[0])], fill=(234, 88, 12), width=3)
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
