"""ONNX export of the vector pipeline's networks for onnxruntime-web.

Exports up to three graphs — the segment encoder (+ boundary head), the gap
bridge scorer, and the face room-type head — with a dynamic segment/candidate/
face count. Everything that is *not* a network stays in TypeScript at runtime:
feature building, the kNN graph, bridge candidate generation, polygonization and
face scoring. The manifest therefore records the full runtime contract (feature
slot layout, thresholds, face/prep constants, class ids) next to the graphs.

    python export_vector_onnx.py \
      --encoder runs/vector-seg/best.pt \
      --bridger runs/vector-bridge/best.pt \
      --type-head runs/vector-type/best.pt \
      --output-dir ../../public/models/room-detector-vector

Each export is checked with onnx.checker and verified against the PyTorch
modules through onnxruntime at several sizes (which also proves the dynamic
axes really are dynamic).
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

import numpy as np
import torch
from torch import nn

from roomdet.classes import PDF_TSV_CLINICAL_CLASSES, manifest_classes
from roomdet.vector_dataset import EDGE_FEATURE_DIM, FEATURE_DIM, VectorPrepConfig
from roomdet.vector_faces import FaceConfig
from roomdet.vector_model import (
    BRIDGE_PAIR_DIM,
    FACE_SHAPE_DIM,
    BridgeScorer,
    FaceTypeHead,
    SegmentEncoder,
    load_encoder_checkpoint,
)

OPSET = 18  # matches the shipped raster model; supported by onnxruntime-web >= 1.14
PARITY_TOLERANCE = 2e-4

SEGMENT_FEATURE_SLOTS = [
    "midXCentered",  # (mid - pageCenter) / (0.5 * pageDiag)
    "midYCentered",
    "cos2Theta",  # undirected orientation
    "sin2Theta",
    "lengthOverDiag",
    "log1pLengthOverMedianLength",
    "lengthRank",  # argsort rank in [0, 1]
    "log1pHalfWidthOverMedianHalfWidth",
    "halfWidthOverMedianHalfWidthClip16",  # clip(hw / medianHw, 0, 16) / 16
    "widthRank",
    "colorR",
    "colorG",
    "colorB",
    "alpha",
    "luma",  # 0.299 R + 0.587 G + 0.114 B
    "flagHairline",
    "flagRoundCap",
    "flagClipped",
    "flagFillOutline",
    "flagQuadratic",
    "log1pLengthOverStrokeWidth",  # log1p(len / (2 * max(hw, 0.25 * medianHw)))
]

EDGE_FEATURE_SLOTS = [
    "relMidXOverLocalScale",  # localScale = median 1st-neighbour distance
    "relMidYOverLocalScale",
    "distanceOverLocalScale",
    "log1pDistanceOverLocalScale",
    "absDirectionDot",
    "absDirectionCross",
]

BRIDGE_PAIR_SLOTS = [
    "log1pLengthOver2MedianHalfWidth",
    "lengthOverDiag",
    "lengthOver24MedianHalfWidthClip4",
    "absAlignBridgeSegA",
    "absAlignBridgeSegB",
    "absDirectionDotAB",
    "absDirectionCrossAB",
    "halfWidthRatioMinOverMax",
]

FACE_SHAPE_SLOTS = [
    "sqrtAreaOverDiag",
    "log1pAreaPercentOfPage",
    "bboxAspectMinOverMax",
    "isoperimetricQuotient",  # 4 * pi * area / perimeter^2
    "vertexCountOver64Clip1",
    "perimeterOverDiag",
]


class EncoderOnnx(nn.Module):
    """SegmentEncoder forward without chunking or count==0 branches (export-safe).

    Takes int32 kNN indices so the browser can pass an Int32Array instead of
    BigInt64Array; the graph casts before gathering.
    """

    def __init__(self, encoder: SegmentEncoder) -> None:
        super().__init__()
        self.encoder = encoder

    def forward(self, features: torch.Tensor, knn_idx: torch.Tensor, edge: torch.Tensor):
        index = knn_idx.to(torch.long)
        hidden = self.encoder.input_proj(features)
        for block in self.encoder.blocks:
            normed = block.norm(hidden)
            neighbours = normed[index]  # (N, k, C) pure gather
            anchors = normed.unsqueeze(1).expand_as(neighbours)
            pair = torch.cat([anchors, neighbours, edge], dim=-1)
            logits = block.attn_logits(pair)
            weights = torch.softmax(logits, dim=1)
            values = block.values(pair)
            values = values.reshape(values.shape[0], values.shape[1], block.heads, block.head_dim)
            pooled = (weights.unsqueeze(-1) * values).sum(dim=1)
            hidden = hidden + block.out(pooled.flatten(start_dim=1))
            hidden = hidden + block.ffn(block.ffn_norm(hidden))
        embedding = self.encoder.final_norm(hidden)
        boundary_prob = torch.sigmoid(self.encoder.boundary_head(embedding).squeeze(-1))
        return embedding, boundary_prob


class BridgerOnnx(nn.Module):
    def __init__(self, bridger: BridgeScorer) -> None:
        super().__init__()
        self.bridger = bridger

    def forward(self, embedding_a: torch.Tensor, embedding_b: torch.Tensor, pair_features: torch.Tensor):
        return torch.sigmoid(self.bridger(embedding_a, embedding_b, pair_features))


class TypeHeadOnnx(nn.Module):
    def __init__(self, type_head: FaceTypeHead) -> None:
        super().__init__()
        self.type_head = type_head

    def forward(self, pooled_embedding: torch.Tensor, shape_features: torch.Tensor):
        return self.type_head(pooled_embedding, shape_features)


def export_graph(module: nn.Module, dummy_inputs: tuple, path: Path, input_names: list[str], output_names: list[str], dynamic_dim: str) -> None:
    module.eval()
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        module,
        dummy_inputs,
        path,
        input_names=input_names,
        output_names=output_names,
        dynamic_axes={name: {0: dynamic_dim} for name in [*input_names, *output_names]},
        opset_version=OPSET,
        do_constant_folding=True,
        external_data=False,
    )
    import onnx

    onnx.checker.check_model(onnx.load(path))


def encoder_inputs(count: int, knn: int, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    features = rng.standard_normal((count, FEATURE_DIM)).astype(np.float32)
    knn_idx = rng.integers(0, count, size=(count, knn)).astype(np.int32)
    edge = rng.standard_normal((count, knn, EDGE_FEATURE_DIM)).astype(np.float32)
    return features, knn_idx, edge


def parity_check(path: Path, torch_module: nn.Module, make_inputs, counts: tuple[int, ...]) -> float:
    """Max abs diff between onnxruntime and PyTorch across several dynamic sizes."""
    import onnxruntime

    session = onnxruntime.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    input_names = [item.name for item in session.get_inputs()]
    worst = 0.0
    for count in counts:
        arrays = make_inputs(count)
        ort_outputs = session.run(None, dict(zip(input_names, arrays)))
        with torch.no_grad():
            torch_outputs = torch_module(*[torch.from_numpy(array) for array in arrays])
        if isinstance(torch_outputs, torch.Tensor):
            torch_outputs = (torch_outputs,)
        for ort_out, torch_out in zip(ort_outputs, torch_outputs):
            worst = max(worst, float(np.abs(ort_out - torch_out.numpy()).max()))
    if worst > PARITY_TOLERANCE:
        raise SystemExit(f"Parity check failed for {path.name}: max abs diff {worst:.6f} > {PARITY_TOLERANCE}")
    return worst


def camel_case(name: str) -> str:
    head, *tail = name.split("_")
    return head + "".join(part.capitalize() for part in tail)


def camel_dict(payload: dict[str, object]) -> dict[str, object]:
    return {camel_case(key): value for key, value in payload.items()}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--encoder", type=Path, default=Path("runs/vector-seg/best.pt"))
    parser.add_argument("--bridger", type=Path, default=None, help="optional runs/vector-bridge/best.pt")
    parser.add_argument("--type-head", type=Path, default=None, help="optional runs/vector-type/best.pt")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--asset-prefix", default="models/room-detector-vector", help="onnxPath prefix as served to the app")
    parser.add_argument("--version", default="vector-rooms-v1")
    parser.add_argument("--metrics", type=Path, default=None, help="optional evaluate_vector_rooms.py --output JSON")
    args = parser.parse_args()

    rng = np.random.default_rng(1337)
    counts = (1, 7, 500)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    encoder, encoder_payload = load_encoder_checkpoint(args.encoder)
    encoder.eval()
    config = encoder.config
    boundary_threshold = float(encoder_payload.get("threshold", 0.5))
    encoder_module = EncoderOnnx(encoder)

    encoder_path = args.output_dir / "encoder.onnx"
    dummy = tuple(torch.from_numpy(array) for array in encoder_inputs(64, config.knn, rng))
    export_graph(
        encoder_module,
        dummy,
        encoder_path,
        input_names=["features", "knn_idx", "edge"],
        output_names=["embedding", "boundary_prob"],
        dynamic_dim="segments",
    )
    encoder_diff = parity_check(encoder_path, encoder_module, lambda count: encoder_inputs(count, config.knn, rng), counts)
    # The export wrapper must match the training-time forward bit for bit.
    with torch.no_grad():
        features, knn_idx, edge = (torch.from_numpy(array) for array in encoder_inputs(200, config.knn, rng))
        reference_embedding, reference_logits = encoder(features, knn_idx.long(), edge)
        wrapper_embedding, wrapper_prob = encoder_module(features, knn_idx, edge)
    wrapper_diff = max(
        float((reference_embedding - wrapper_embedding).abs().max()),
        float((torch.sigmoid(reference_logits) - wrapper_prob).abs().max()),
    )
    if wrapper_diff > PARITY_TOLERANCE:
        raise SystemExit(f"Export wrapper diverges from SegmentEncoder.forward: {wrapper_diff:.6f}")
    print(json.dumps({"event": "exported", "model": "encoder", "path": str(encoder_path), "maxAbsDiff": encoder_diff}), flush=True)

    models: dict[str, dict[str, object]] = {
        "encoder": {
            "onnxPath": f"{args.asset_prefix}/encoder.onnx",
            "inputs": {
                "features": ["segments", FEATURE_DIM],
                "knn_idx": ["segments", config.knn],
                "edge": ["segments", config.knn, EDGE_FEATURE_DIM],
            },
            "outputs": {"embedding": ["segments", config.width], "boundary_prob": ["segments"]},
            "knnIndexType": "int32",
            "checkpoint": str(args.encoder),
        }
    }
    thresholds: dict[str, float] = {"boundaryProbability": boundary_threshold}

    if args.bridger is not None:
        payload = torch.load(args.bridger, map_location="cpu", weights_only=False)
        bridger = BridgeScorer(payload["embedding_dim"], pair_dim=payload["pair_dim"])
        bridger.load_state_dict(payload["model"])
        bridger_module = BridgerOnnx(bridger)
        bridger_path = args.output_dir / "bridger.onnx"

        def bridger_inputs(count: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
            return (
                rng.standard_normal((count, payload["embedding_dim"])).astype(np.float32),
                rng.standard_normal((count, payload["embedding_dim"])).astype(np.float32),
                rng.standard_normal((count, payload["pair_dim"])).astype(np.float32),
            )

        export_graph(
            bridger_module,
            tuple(torch.from_numpy(array) for array in bridger_inputs(64)),
            bridger_path,
            input_names=["embedding_a", "embedding_b", "pair_features"],
            output_names=["bridge_prob"],
            dynamic_dim="candidates",
        )
        diff = parity_check(bridger_path, bridger_module, bridger_inputs, counts)
        print(json.dumps({"event": "exported", "model": "bridger", "path": str(bridger_path), "maxAbsDiff": diff}), flush=True)
        models["bridger"] = {
            "onnxPath": f"{args.asset_prefix}/bridger.onnx",
            "inputs": {
                "embedding_a": ["candidates", payload["embedding_dim"]],
                "embedding_b": ["candidates", payload["embedding_dim"]],
                "pair_features": ["candidates", payload["pair_dim"]],
            },
            "outputs": {"bridge_prob": ["candidates"]},
            "checkpoint": str(args.bridger),
        }
        thresholds["bridgeProbability"] = float(payload.get("threshold", 0.5))

    if args.type_head is not None:
        payload = torch.load(args.type_head, map_location="cpu", weights_only=False)
        class_ids = [int(value) for value in payload["class_ids"]]
        type_head = FaceTypeHead(payload["embedding_dim"], num_classes=len(class_ids), shape_dim=payload["shape_dim"])
        type_head.load_state_dict(payload["model"])
        type_module = TypeHeadOnnx(type_head)
        type_path = args.output_dir / "type-head.onnx"

        def type_inputs(count: int) -> tuple[np.ndarray, np.ndarray]:
            return (
                rng.standard_normal((count, payload["embedding_dim"])).astype(np.float32),
                rng.standard_normal((count, payload["shape_dim"])).astype(np.float32),
            )

        export_graph(
            type_module,
            tuple(torch.from_numpy(array) for array in type_inputs(64)),
            type_path,
            input_names=["pooled_embedding", "shape_features"],
            output_names=["type_logits"],
            dynamic_dim="faces",
        )
        diff = parity_check(type_path, type_module, type_inputs, counts)
        print(json.dumps({"event": "exported", "model": "typeHead", "path": str(type_path), "maxAbsDiff": diff}), flush=True)
        models["typeHead"] = {
            "onnxPath": f"{args.asset_prefix}/type-head.onnx",
            "inputs": {
                "pooled_embedding": ["faces", payload["embedding_dim"]],
                "shape_features": ["faces", payload["shape_dim"]],
            },
            "outputs": {"type_logits": ["faces", len(class_ids)]},
            # argmax over type_logits indexes into classIds (background is never predicted)
            "classIds": class_ids,
            "checkpoint": str(args.type_head),
        }

    metrics: dict[str, object] = {"status": "exported; run evaluate_vector_rooms.py --output to populate metrics"}
    if args.metrics and args.metrics.exists():
        metrics = json.loads(args.metrics.read_text(encoding="utf-8"))

    manifest = {
        "version": args.version,
        "kind": "vector-room-detection",
        "featureVersion": int(encoder_payload.get("featureVersion", 1)),
        "models": models,
        "encoderConfig": camel_dict(asdict(config)),
        "thresholds": thresholds,
        # Constants the TypeScript runtime needs to mirror roomdet exactly:
        # feature building + kNN (vector_dataset.build_page_inputs), bridge
        # candidates (build_bridge_candidates/build_bridge_features) and face
        # extraction (vector_faces.extract_rooms) all run in the browser.
        "prep": camel_dict(asdict(VectorPrepConfig())),
        "faceExtraction": camel_dict(asdict(FaceConfig(threshold=boundary_threshold))),
        "featureSpec": {
            "segment": SEGMENT_FEATURE_SLOTS,
            "edge": EDGE_FEATURE_SLOTS,
            "bridgePair": BRIDGE_PAIR_SLOTS,
            "faceShape": FACE_SHAPE_SLOTS,
        },
        "featureDims": {
            "segment": FEATURE_DIM,
            "edge": EDGE_FEATURE_DIM,
            "bridgePair": BRIDGE_PAIR_DIM,
            "faceShape": FACE_SHAPE_DIM,
        },
        "classes": manifest_classes(PDF_TSV_CLINICAL_CLASSES),
        "license": "Model trained from local PDF-TSV roomType geometry annotations.",
        "metrics": metrics,
    }
    manifest_path = args.output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"event": "manifest_written", "path": str(manifest_path)}), flush=True)


if __name__ == "__main__":
    main()
