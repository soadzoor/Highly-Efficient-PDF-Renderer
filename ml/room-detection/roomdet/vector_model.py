"""Segment encoder + heads for vector-native room detection.

A small graph-attention network over PDF stroke segments. All neighbourhood ops are
plain gathers over fixed-k kNN indices (no scatter/sparse kernels), so the model runs
unchanged on cuda / mps / cpu and exports to ONNX later.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path

import torch
from torch import nn

from .vector_dataset import EDGE_FEATURE_DIM, FEATURE_DIM

FACE_SHAPE_DIM = 6
BRIDGE_PAIR_DIM = 8


@dataclass(frozen=True)
class VectorModelConfig:
    feature_dim: int = FEATURE_DIM
    edge_dim: int = EDGE_FEATURE_DIM
    width: int = 128
    layers: int = 5
    heads: int = 4
    knn: int = 12
    dropout: float = 0.1


class NeighborAttention(nn.Module):
    """One round of message passing over the fixed-k neighbourhood."""

    def __init__(self, config: VectorModelConfig) -> None:
        super().__init__()
        width = config.width
        pair_dim = width * 2 + config.edge_dim
        self.norm = nn.LayerNorm(width)
        self.attn_logits = nn.Sequential(nn.Linear(pair_dim, width), nn.GELU(), nn.Linear(width, config.heads))
        self.values = nn.Linear(pair_dim, width)
        self.out = nn.Linear(width, width)
        self.ffn_norm = nn.LayerNorm(width)
        self.ffn = nn.Sequential(
            nn.Linear(width, width * 2),
            nn.GELU(),
            nn.Dropout(config.dropout),
            nn.Linear(width * 2, width),
        )
        self.heads = config.heads
        self.head_dim = width // config.heads

    def forward(self, hidden: torch.Tensor, knn_idx: torch.Tensor, edge: torch.Tensor, chunk_size: int = 0) -> torch.Tensor:
        count = hidden.shape[0]
        if count == 0:  # text-only pages can have zero stroke segments
            return hidden
        normed = self.norm(hidden)
        step = count if chunk_size <= 0 else max(1, chunk_size)
        updates = []
        for start in range(0, count, step):
            stop = min(count, start + step)
            neighbours = normed[knn_idx[start:stop]]  # (n, k, C) pure gather
            anchors = normed[start:stop].unsqueeze(1).expand_as(neighbours)
            pair = torch.cat([anchors, neighbours, edge[start:stop]], dim=-1)  # (n, k, 2C+E)

            logits = self.attn_logits(pair)  # (n, k, H)
            weights = torch.softmax(logits, dim=1)
            values = self.values(pair)  # (n, k, C)
            values = values.view(*values.shape[:2], self.heads, self.head_dim)
            pooled = (weights.unsqueeze(-1) * values).sum(dim=1)  # (n, H, C/H)
            updates.append(self.out(pooled.flatten(start_dim=1)))
        hidden = hidden + (updates[0] if len(updates) == 1 else torch.cat(updates, dim=0))
        hidden = hidden + self.ffn(self.ffn_norm(hidden))
        return hidden


class SegmentEncoder(nn.Module):
    """Per-segment embeddings + boundary logits."""

    def __init__(self, config: VectorModelConfig | None = None) -> None:
        super().__init__()
        self.config = config or VectorModelConfig()
        width = self.config.width
        self.input_proj = nn.Sequential(
            nn.Linear(self.config.feature_dim, width),
            nn.GELU(),
            nn.Linear(width, width),
        )
        self.blocks = nn.ModuleList(NeighborAttention(self.config) for _ in range(self.config.layers))
        self.final_norm = nn.LayerNorm(width)
        self.boundary_head = nn.Linear(width, 1)

    def forward(
        self,
        features: torch.Tensor,
        knn_idx: torch.Tensor,
        edge: torch.Tensor,
        chunk_size: int = 0,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        hidden = self.input_proj(features)
        for block in self.blocks:
            hidden = block(hidden, knn_idx, edge, chunk_size=chunk_size)
        embedding = self.final_norm(hidden)
        boundary_logit = self.boundary_head(embedding).squeeze(-1)
        return embedding, boundary_logit


class BridgeScorer(nn.Module):
    """Link prediction over free-endpoint pairs: bridge this gap or not."""

    def __init__(self, embedding_dim: int, pair_dim: int = BRIDGE_PAIR_DIM, width: int = 128) -> None:
        super().__init__()
        self.mlp = nn.Sequential(
            nn.Linear(embedding_dim * 2 + pair_dim, width),
            nn.GELU(),
            nn.Linear(width, width),
            nn.GELU(),
            nn.Linear(width, 1),
        )

    def forward(self, embedding_a: torch.Tensor, embedding_b: torch.Tensor, pair_features: torch.Tensor) -> torch.Tensor:
        symmetric = torch.cat(
            [embedding_a + embedding_b, (embedding_a - embedding_b).abs(), pair_features],
            dim=-1,
        )
        return self.mlp(symmetric).squeeze(-1)


class FaceTypeHead(nn.Module):
    """Room-type classification for an extracted face from pooled member embeddings."""

    def __init__(self, embedding_dim: int, num_classes: int, shape_dim: int = FACE_SHAPE_DIM, width: int = 128) -> None:
        super().__init__()
        self.num_classes = num_classes
        self.mlp = nn.Sequential(
            nn.Linear(embedding_dim + shape_dim, width),
            nn.GELU(),
            nn.Linear(width, width),
            nn.GELU(),
            nn.Linear(width, num_classes),
        )

    def forward(self, pooled_embedding: torch.Tensor, shape_features: torch.Tensor) -> torch.Tensor:
        return self.mlp(torch.cat([pooled_embedding, shape_features], dim=-1))


def resolve_device(spec: str = "auto") -> torch.device:
    if spec != "auto":
        return torch.device(spec)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def save_encoder_checkpoint(path: Path, model: SegmentEncoder, extra: dict[str, object]) -> None:
    payload = {"model": model.state_dict(), "config": asdict(model.config), **extra}
    torch.save(payload, path)


def load_encoder_checkpoint(path: Path, map_location: str | torch.device = "cpu") -> tuple[SegmentEncoder, dict[str, object]]:
    payload = torch.load(path, map_location=map_location, weights_only=False)
    config = VectorModelConfig(**payload["config"])
    model = SegmentEncoder(config)
    model.load_state_dict(payload["model"])
    return model, payload


@torch.no_grad()
def encode_page_chunked(
    model: SegmentEncoder,
    features: torch.Tensor,
    knn_idx: torch.Tensor,
    edge: torch.Tensor,
    device: torch.device,
    chunk_size: int = 16_384,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Full-page inference with bounded attention memory (chunked over segments)."""
    model.eval()
    embedding, logits = model(features.to(device), knn_idx.to(device), edge.to(device), chunk_size=chunk_size)
    return embedding.cpu(), logits.cpu()
