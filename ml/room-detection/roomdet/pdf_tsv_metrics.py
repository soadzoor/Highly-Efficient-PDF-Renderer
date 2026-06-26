from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

import numpy as np
import torch
from torch.utils.data import DataLoader

from .classes import ClassSpec, room_class_ids, separator_class_id
from .losses import pdf_tsv_geometry_prediction, pdf_tsv_multiclass_prediction


@dataclass(frozen=True)
class PdfTsvMetricConfig:
    classes: Sequence[ClassSpec]
    target_mode: str = "class"
    instance_matching: bool = False

    @property
    def class_count(self) -> int:
        return max(spec.id for spec in self.classes) + 1

    @property
    def separator_id(self) -> int:
        if self.target_mode == "geometry":
            return 2
        return separator_class_id(self.classes)

    @property
    def room_ids(self) -> tuple[int, ...]:
        if self.target_mode == "geometry":
            return (1,)
        return room_class_ids(self.classes)


def evaluate_pdf_tsv_model(
    model: torch.nn.Module,
    loader: DataLoader,
    device: torch.device | str,
    config: PdfTsvMetricConfig,
    loss_fn: Callable[[torch.Tensor, torch.Tensor], torch.Tensor] | None = None,
) -> dict[str, object]:
    device = torch.device(device)
    class_count = config.class_count if config.target_mode != "geometry" else 3
    intersection = np.zeros(class_count, dtype=np.float64)
    union = np.zeros(class_count, dtype=np.float64)
    foreground_intersection = 0.0
    foreground_union = 0.0
    room_intersection = 0.0
    room_union = 0.0
    separator_intersection = 0.0
    separator_union = 0.0
    matched_room_iou_sum = 0.0
    matched_room_count = 0
    matched_room_recall_50_count = 0
    matched_room_type_correct_50_count = 0
    total_loss = 0.0
    total_count = 0

    model.eval()
    with torch.no_grad():
        for images, masks in loader:
            images = images.to(device, non_blocking=True)
            masks = masks.to(device, non_blocking=True)
            logits = model(images)
            if loss_fn is not None:
                loss = loss_fn(logits, masks)
                total_loss += float(loss.detach().cpu()) * images.shape[0]
            pred = predict_pdf_tsv_mask(logits, config).detach().cpu().numpy()
            target = masks.detach().cpu().numpy()
            total_count += images.shape[0]

            for pred_mask, target_mask in zip(pred, target):
                foreground_intersection += float(np.logical_and(pred_mask > 0, target_mask > 0).sum())
                foreground_union += float(np.logical_or(pred_mask > 0, target_mask > 0).sum())

                pred_room = np.isin(pred_mask, config.room_ids)
                target_room = np.isin(target_mask, config.room_ids)
                room_intersection += float(np.logical_and(pred_room, target_room).sum())
                room_union += float(np.logical_or(pred_room, target_room).sum())

                pred_separator = pred_mask == config.separator_id
                target_separator = target_mask == config.separator_id
                separator_intersection += float(np.logical_and(pred_separator, target_separator).sum())
                separator_union += float(np.logical_or(pred_separator, target_separator).sum())

                for class_id in range(class_count):
                    pred_class = pred_mask == class_id
                    target_class = target_mask == class_id
                    intersection[class_id] += np.logical_and(pred_class, target_class).sum()
                    union[class_id] += np.logical_or(pred_class, target_class).sum()

                if config.instance_matching:
                    instance = compute_instance_metrics(pred_mask, target_mask, config)
                    matched_room_iou_sum += instance["iou_sum"]
                    matched_room_count += instance["target_count"]
                    matched_room_recall_50_count += instance["recall_50_count"]
                    matched_room_type_correct_50_count += instance["type_correct_50_count"]

    iou = np.divide(intersection, np.maximum(union, 1), dtype=np.float64)
    room_ids = [class_id for class_id in config.room_ids if class_id < len(iou)]
    per_class = {
        spec.label: float(iou[spec.id])
        for spec in config.classes
        if spec.id < len(iou)
    }
    metrics: dict[str, object] = {
        "status": "evaluated",
        "pdfTsvForegroundIou": float(foreground_intersection / max(1.0, foreground_union)),
        "pdfTsvRoomInteriorIou": float(room_intersection / max(1.0, room_union)),
        "pdfTsvSeparatorIou": float(separator_intersection / max(1.0, separator_union)),
        "pdfTsvMeanRoomClassIou": float(iou[room_ids].mean()) if room_ids else 0.0,
        "pdfTsvPerClassIou": per_class,
        "pdfTsvValidationSamples": total_count,
    }
    if loss_fn is not None:
        metrics["pdfTsvLoss"] = total_loss / max(1, total_count)
    if config.instance_matching:
        metrics.update(
            {
                "pdfTsvMatchedRoomMeanIou": float(matched_room_iou_sum / max(1, matched_room_count)),
                "pdfTsvMatchedRoomRecallAt50": float(matched_room_recall_50_count / max(1, matched_room_count)),
                "pdfTsvMatchedRoomTypeAccuracyAt50": float(
                    matched_room_type_correct_50_count / max(1, matched_room_recall_50_count)
                ),
                "pdfTsvMatchedRoomTargets": matched_room_count,
            }
        )
    return metrics


def predict_pdf_tsv_mask(logits: torch.Tensor, config: PdfTsvMetricConfig) -> torch.Tensor:
    if config.target_mode == "geometry":
        return pdf_tsv_geometry_prediction(logits)
    return pdf_tsv_multiclass_prediction(logits)


def compute_instance_metrics(pred: np.ndarray, target: np.ndarray, config: PdfTsvMetricConfig) -> dict[str, float | int]:
    try:
        from scipy import ndimage  # type: ignore[import-not-found]
    except ModuleNotFoundError as error:
        raise RuntimeError("Instance matching requires scipy. Install ml/room-detection/requirements.txt.") from error

    structure = np.asarray([[0, 1, 0], [1, 1, 1], [0, 1, 0]], dtype=np.uint8)
    pred_room = np.isin(pred, config.room_ids)
    target_room = np.isin(target, config.room_ids)
    pred_components, pred_count = ndimage.label(pred_room, structure=structure)
    target_components, target_count = ndimage.label(target_room, structure=structure)
    if target_count <= 0:
        return {"iou_sum": 0.0, "target_count": 0, "recall_50_count": 0, "type_correct_50_count": 0}

    pred_areas = np.bincount(pred_components.reshape(-1), minlength=pred_count + 1)
    target_areas = np.bincount(target_components.reshape(-1), minlength=target_count + 1)
    pred_labels = component_majority_labels(pred_components, pred, pred_count)
    target_labels = component_majority_labels(target_components, target, target_count)

    overlap_mask = (pred_components > 0) & (target_components > 0)
    best_iou_by_target = np.zeros(target_count + 1, dtype=np.float64)
    best_pred_by_target = np.zeros(target_count + 1, dtype=np.int64)
    if overlap_mask.any():
        pair_base = pred_count + 1
        pair_keys = target_components[overlap_mask].astype(np.int64) * pair_base + pred_components[overlap_mask].astype(np.int64)
        pair_counts = np.bincount(pair_keys)
        for key, overlap in enumerate(pair_counts):
            if overlap <= 0:
                continue
            target_id = key // pair_base
            pred_id = key % pair_base
            if target_id <= 0 or pred_id <= 0:
                continue
            union = target_areas[target_id] + pred_areas[pred_id] - overlap
            iou = float(overlap / max(1, union))
            if iou > best_iou_by_target[target_id]:
                best_iou_by_target[target_id] = iou
                best_pred_by_target[target_id] = pred_id

    iou_sum = float(best_iou_by_target[1:].sum())
    recall_50 = best_iou_by_target[1:] >= 0.5
    type_correct_50 = 0
    for target_id in np.nonzero(recall_50)[0] + 1:
        pred_id = best_pred_by_target[target_id]
        if pred_id > 0 and pred_labels[pred_id] == target_labels[target_id]:
            type_correct_50 += 1
    return {
        "iou_sum": iou_sum,
        "target_count": int(target_count),
        "recall_50_count": int(recall_50.sum()),
        "type_correct_50_count": int(type_correct_50),
    }


def component_majority_labels(components: np.ndarray, labels: np.ndarray, count: int) -> np.ndarray:
    result = np.zeros(count + 1, dtype=np.int64)
    valid = components > 0
    if not valid.any():
        return result
    label_count = int(labels.max()) + 1
    keys = components[valid].astype(np.int64) * label_count + labels[valid].astype(np.int64)
    counts = np.bincount(keys)
    best_count = np.zeros(count + 1, dtype=np.int64)
    for key, value in enumerate(counts):
        if value <= 0:
            continue
        component_id = key // label_count
        label = key % label_count
        if component_id <= 0 or component_id > count:
            continue
        if value > best_count[component_id]:
            best_count[component_id] = value
            result[component_id] = label
    return result
