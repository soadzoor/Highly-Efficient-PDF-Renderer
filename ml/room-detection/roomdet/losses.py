from __future__ import annotations

from collections.abc import Sequence

import torch
import torch.nn.functional as F

from .classes import CLASSES, ClassSpec, room_class_ids, separator_class_id

ROOM_CLASS_IDS = tuple(spec.id for spec in CLASSES if spec.kind == "room")
BACKGROUND_CLASS_ID = 0
SEPARATOR_CLASS_ID = next(spec.id for spec in CLASSES if spec.label == "separator")


def room_foreground_logits(logits: torch.Tensor) -> torch.Tensor:
    room_ids = torch.as_tensor(ROOM_CLASS_IDS, dtype=torch.long, device=logits.device)
    non_room_ids = torch.as_tensor((BACKGROUND_CLASS_ID, SEPARATOR_CLASS_ID), dtype=torch.long, device=logits.device)
    non_room_logit = torch.logsumexp(logits.index_select(1, non_room_ids), dim=1)
    room_logit = torch.logsumexp(logits.index_select(1, room_ids), dim=1)
    return torch.stack((non_room_logit, room_logit), dim=1)


def room_foreground_loss(logits: torch.Tensor, foreground_mask: torch.Tensor) -> torch.Tensor:
    return F.cross_entropy(room_foreground_logits(logits), foreground_mask.long())


def room_foreground_prediction(logits: torch.Tensor) -> torch.Tensor:
    return room_foreground_logits(logits).argmax(dim=1)


def pdf_tsv_geometry_logits(logits: torch.Tensor) -> torch.Tensor:
    room_ids = torch.as_tensor(ROOM_CLASS_IDS, dtype=torch.long, device=logits.device)
    background_logit = logits[:, BACKGROUND_CLASS_ID]
    room_logit = torch.logsumexp(logits.index_select(1, room_ids), dim=1)
    separator_logit = logits[:, SEPARATOR_CLASS_ID]
    return torch.stack((background_logit, room_logit, separator_logit), dim=1)


def pdf_tsv_geometry_loss(
    logits: torch.Tensor,
    target_mask: torch.Tensor,
    class_weights: Sequence[float] = (0.35, 1.0, 12.0),
    separator_dice_weight: float = 0.75,
) -> torch.Tensor:
    geometry_logits = pdf_tsv_geometry_logits(logits)
    weights = torch.as_tensor(class_weights, dtype=geometry_logits.dtype, device=geometry_logits.device)
    ce_loss = F.cross_entropy(geometry_logits, target_mask.long(), weight=weights)
    if separator_dice_weight <= 0.0:
        return ce_loss

    separator_prob = F.softmax(geometry_logits, dim=1)[:, 2]
    separator_target = (target_mask == 2).to(dtype=separator_prob.dtype)
    intersection = (separator_prob * separator_target).sum()
    denominator = separator_prob.sum() + separator_target.sum()
    dice_loss = 1.0 - (2.0 * intersection + 1.0) / (denominator + 1.0)
    return ce_loss + separator_dice_weight * dice_loss


def pdf_tsv_geometry_prediction(logits: torch.Tensor) -> torch.Tensor:
    return pdf_tsv_geometry_logits(logits).argmax(dim=1)


def pdf_tsv_multiclass_loss(
    logits: torch.Tensor,
    target_mask: torch.Tensor,
    *,
    class_weights: Sequence[float] | None = None,
    separator_id: int | None = None,
    separator_dice_weight: float = 0.5,
) -> torch.Tensor:
    weights = None
    if class_weights is not None:
        weights = torch.as_tensor(class_weights, dtype=logits.dtype, device=logits.device)
    ce_loss = F.cross_entropy(logits, target_mask.long(), weight=weights)
    if separator_dice_weight <= 0.0 or separator_id is None or separator_id < 0 or separator_id >= logits.shape[1]:
        return ce_loss

    separator_prob = F.softmax(logits, dim=1)[:, separator_id]
    separator_target = (target_mask == separator_id).to(dtype=separator_prob.dtype)
    intersection = (separator_prob * separator_target).sum()
    denominator = separator_prob.sum() + separator_target.sum()
    dice_loss = 1.0 - (2.0 * intersection + 1.0) / (denominator + 1.0)
    return ce_loss + separator_dice_weight * dice_loss


def pdf_tsv_multiclass_prediction(logits: torch.Tensor) -> torch.Tensor:
    return logits.argmax(dim=1)


def class_ids_for_specs(classes: Sequence[ClassSpec]) -> tuple[tuple[int, ...], int]:
    return room_class_ids(classes), separator_class_id(classes)
