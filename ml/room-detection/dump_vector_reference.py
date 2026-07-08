"""Reference intermediates of the Python vector pipeline for TS parity checks.

Runs the full pipeline (features -> kNN -> encoder -> bridges -> faces -> types)
on one segments dump and writes every stage's arrays to a gzipped JSON that
scripts/verify-vector-rooms.mjs replays through the TypeScript runtime.

    python dump_vector_reference.py \
      --dump "data/vector-segments/kp/Antioch Hearing Aid Center_Floor 1.segments.json.gz" \
      --checkpoint runs/vector-seg/best.pt \
      --bridger runs/vector-bridge/best.pt \
      --type-head runs/vector-type/best.pt \
      --out /tmp/antioch-reference.json.gz
"""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

import numpy as np
import torch

from roomdet.vector_dataset import (
    PageNormalizers,
    VectorPrepConfig,
    build_bridge_candidates,
    build_bridge_features,
    build_page_inputs,
    load_segment_dump,
    snap_tolerance,
)
from roomdet.vector_faces import FaceConfig, extract_rooms, face_shape_features, pooled_face_embedding
from roomdet.vector_model import BridgeScorer, FaceTypeHead, encode_page_chunked, load_encoder_checkpoint


def rounded(array: np.ndarray, decimals: int = 6) -> list:
    return np.round(np.asarray(array, dtype=np.float64), decimals).tolist()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dump", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, default=Path("runs/vector-seg/best.pt"))
    parser.add_argument("--bridger", type=Path, default=None)
    parser.add_argument("--type-head", type=Path, default=None)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    page = load_segment_dump(args.dump)
    encoder, encoder_payload = load_encoder_checkpoint(args.checkpoint)
    threshold = float(encoder_payload.get("threshold", 0.5))
    prep_config = VectorPrepConfig()
    face_config = FaceConfig(threshold=threshold)

    features, knn_idx, edge = build_page_inputs(
        page.seg_p0, page.seg_p1, page.half_width, page.color, page.alpha, page.flags, page.page_bounds, encoder.config.knn
    )
    embedding, logits = encode_page_chunked(
        encoder,
        torch.from_numpy(features).float(),
        torch.from_numpy(knn_idx).long(),
        torch.from_numpy(edge).float(),
        torch.device("cpu"),
    )
    probs = torch.sigmoid(logits).numpy()
    normalizers = PageNormalizers.for_page(page)

    reference: dict[str, object] = {
        "dump": str(args.dump),
        "stem": page.stem,
        "pageBounds": list(page.page_bounds),
        "segmentCount": page.segment_count,
        "threshold": threshold,
        "snapTolerance": float(snap_tolerance(page, prep_config)),
        "normalizers": {
            "centerX": normalizers.center[0],
            "centerY": normalizers.center[1],
            "diag": normalizers.diag,
            "medianHalfWidth": normalizers.median_half_width,
            "medianLength": normalizers.median_length,
        },
        "segments": {
            "p0": rounded(page.seg_p0),
            "p1": rounded(page.seg_p1),
            "halfWidth": rounded(page.half_width),
            "color": rounded(page.color),
            "alpha": rounded(page.alpha),
            "flags": page.flags.astype(int).tolist(),
        },
        "features": rounded(features),
        "knnIdx": knn_idx.astype(int).tolist(),
        "edge": rounded(edge),
        "probs": rounded(probs),
    }

    bridge_coords = None
    if args.bridger is not None:
        payload = torch.load(args.bridger, map_location="cpu", weights_only=False)
        bridger = BridgeScorer(payload["embedding_dim"], pair_dim=payload["pair_dim"])
        bridger.load_state_dict(payload["model"])
        bridger.eval()
        bridger_threshold = float(payload.get("threshold", 0.5))
        seg_a, seg_b, coords, radius = build_bridge_candidates(page, probs >= threshold, prep_config)
        pair = build_bridge_features(page.seg_p0, page.seg_p1, page.half_width, seg_a, seg_b, coords, normalizers)
        scores = np.zeros(0, dtype=np.float32)
        if len(seg_a):
            with torch.no_grad():
                scores = torch.sigmoid(
                    bridger(embedding[torch.from_numpy(seg_a)], embedding[torch.from_numpy(seg_b)], torch.from_numpy(pair))
                ).numpy()
        accepted = scores >= bridger_threshold if len(seg_a) else np.zeros(0, dtype=bool)
        if accepted.any():
            bridge_coords = coords[accepted]
        reference["bridges"] = {
            "threshold": bridger_threshold,
            "radius": float(radius),
            "segA": seg_a.astype(int).tolist(),
            "segB": seg_b.astype(int).tolist(),
            "coords": rounded(coords),
            "pairFeatures": rounded(pair),
            "scores": rounded(scores),
            "acceptedCount": int(accepted.sum()),
        }

    faces = extract_rooms(page, probs, face_config=face_config, prep_config=prep_config, bridge_coords=bridge_coords)

    type_predictions = None
    if args.type_head is not None and faces:
        payload = torch.load(args.type_head, map_location="cpu", weights_only=False)
        type_head = FaceTypeHead(payload["embedding_dim"], num_classes=len(payload["class_ids"]), shape_dim=payload["shape_dim"])
        type_head.load_state_dict(payload["model"])
        type_head.eval()
        embedding_np = embedding.numpy()
        pooled = np.stack([pooled_face_embedding(embedding_np, face.member_segments) for face in faces])
        shapes = np.stack([face_shape_features(face.polygon, page.page_bounds) for face in faces])
        with torch.no_grad():
            logits_t = type_head(torch.from_numpy(pooled), torch.from_numpy(shapes))
        predicted = logits_t.argmax(dim=1).numpy()
        class_ids = [int(value) for value in payload["class_ids"]]
        type_predictions = [class_ids[int(index)] for index in predicted]
        reference["faceShapeFeatures"] = rounded(shapes)

    reference["faces"] = [
        {
            "polygon": rounded(face.polygon),
            "holes": [rounded(hole) for hole in face.holes],
            "coverage": round(float(face.coverage), 6),
            "meanProbability": round(float(face.mean_probability), 6),
            "area": float(face.area),
            "memberSegments": face.member_segments.astype(int).tolist(),
            "classId": type_predictions[index] if type_predictions is not None else None,
        }
        for index, face in enumerate(faces)
    ]

    args.out.parent.mkdir(parents=True, exist_ok=True)
    payload_bytes = json.dumps(reference).encode("utf-8")
    if args.out.suffix == ".gz":
        args.out.write_bytes(gzip.compress(payload_bytes, compresslevel=6))
    else:
        args.out.write_bytes(payload_bytes)
    print(
        json.dumps(
            {
                "event": "reference_written",
                "out": str(args.out),
                "segments": page.segment_count,
                "bridgeCandidates": len(reference.get("bridges", {}).get("segA", [])) if "bridges" in reference else 0,
                "faces": len(faces),
            }
        )
    )


if __name__ == "__main__":
    main()
