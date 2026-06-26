from __future__ import annotations

import csv
import json
import random
import re
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np
from PIL import Image, ImageDraw
import torch
from torch.utils.data import Dataset

from .classes import ClassSpec, classes_for_taxonomy, manifest_classes, pdf_tsv_room_type_label, separator_class_id
from .image_config import IMAGE_MEAN, IMAGE_STD

Mat2D = tuple[float, float, float, float, float, float]
PDF_TSV_BACKGROUND_ID = 0
PDF_TSV_ROOM_ID = 1
PDF_TSV_SEPARATOR_ID = 2
QC_TINY_GEOMETRY_COVERAGE = 0.001
QC_HUGE_GEOMETRY_COVERAGE = 0.75


@dataclass(frozen=True)
class Point:
    x: float
    y: float


@dataclass(frozen=True)
class PdfTsvPair:
    stem: str
    pdf_path: Path
    tsv_path: Path


@dataclass(frozen=True)
class PairDiscovery:
    pairs: list[PdfTsvPair]
    missing_pdfs: list[str]
    missing_tsvs: list[str]


@dataclass(frozen=True)
class ParsedTsvGeometry:
    polygons: list[list[Point]]
    room_types: list[str]
    room_numbers: list[str]
    row_count: int
    skipped_rows: int


@dataclass(frozen=True)
class PreparedPdfTsvSample:
    image_path: Path
    mask_path: Path
    source_pdf: Path
    source_tsv: Path
    stem: str
    geometry_rows: int
    skipped_rows: int
    exterior_rows: int
    rotation: int
    page_width: float
    page_height: float
    page_box: tuple[float, float, float, float] | None = None
    foreground_coverage: float = 0.0
    separator_coverage: float = 0.0
    mask_bbox: tuple[int, int, int, int] | None = None
    debug_path: Path | None = None
    qc_warnings: tuple[str, ...] = ()
    target_mode: str = "geometry"
    taxonomy: str = "geometry"
    class_pixel_counts: dict[str, int] | None = None
    room_type_counts: dict[str, int] | None = None
    room_class_counts: dict[str, int] | None = None
    room_number_count: int = 0


def discover_pdf_tsv_pairs(root: Path) -> PairDiscovery:
    pdfs = {path.stem: path for path in sorted(root.glob("*.pdf"))}
    tsvs = {path.stem: path for path in sorted(root.glob("*.tsv"))}
    stems = sorted(set(pdfs) & set(tsvs))
    return PairDiscovery(
        pairs=[PdfTsvPair(stem=stem, pdf_path=pdfs[stem], tsv_path=tsvs[stem]) for stem in stems],
        missing_pdfs=sorted(set(tsvs) - set(pdfs)),
        missing_tsvs=sorted(set(pdfs) - set(tsvs)),
    )


def parse_pdf_tsv_geometry(tsv_path: Path) -> ParsedTsvGeometry:
    with tsv_path.open(newline="", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file, delimiter="\t")
        if not reader.fieldnames:
            raise ValueError(f"{tsv_path} has no TSV header.")
        geometry_header = find_header(reader.fieldnames, "geometryData")
        if geometry_header is None:
            raise ValueError(f"{tsv_path} is missing a geometryData column.")
        room_type_header = find_header(reader.fieldnames, "roomType")
        room_number_header = find_header(reader.fieldnames, "roomNumber")

        polygons: list[list[Point]] = []
        room_types: list[str] = []
        room_numbers: list[str] = []
        row_count = 0
        skipped_rows = 0
        for row in reader:
            row_count += 1
            points = parse_geometry_points(normalize_tsv_cell(row.get(geometry_header, "")))
            if len(points) < 3:
                skipped_rows += 1
                continue
            polygons.append(points)
            room_types.append(normalize_tsv_cell(row.get(room_type_header, "")) if room_type_header else "")
            room_numbers.append(normalize_tsv_cell(row.get(room_number_header, "")) if room_number_header else "")

    return ParsedTsvGeometry(
        polygons=polygons,
        room_types=room_types,
        room_numbers=room_numbers,
        row_count=row_count,
        skipped_rows=skipped_rows,
    )


def find_header(headers: Iterable[str], target: str) -> str | None:
    target_lower = target.lower()
    for header in headers:
        if header.strip().lower() == target_lower:
            return header
    return None


def normalize_tsv_cell(value: str) -> str:
    trimmed = value.strip()
    if len(trimmed) >= 2 and trimmed.startswith('"') and trimmed.endswith('"'):
        return trimmed[1:-1].replace('""', '"')
    return trimmed


def parse_geometry_points(raw_geometry: str) -> list[Point]:
    if not raw_geometry:
        return []

    try:
        parsed = json.loads(raw_geometry)
    except json.JSONDecodeError:
        return []

    if not isinstance(parsed, list):
        return []

    points: list[Point] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        try:
            x = float(item["x"])
            y = float(item["y"])
        except (KeyError, TypeError, ValueError):
            continue
        if not np.isfinite(x) or not np.isfinite(y):
            continue
        previous = points[-1] if points else None
        if previous and abs(previous.x - x) <= 1e-9 and abs(previous.y - y) <= 1e-9:
            continue
        points.append(Point(x=x, y=y))

    if len(points) >= 2:
        first = points[0]
        last = points[-1]
        if abs(first.x - last.x) <= 1e-9 and abs(first.y - last.y) <= 1e-9:
            points.pop()

    return points


def filter_exterior_polygons(polygons: Sequence[Sequence[Point]]) -> tuple[list[list[Point]], int]:
    candidates = [list(polygon) for polygon in polygons if len(polygon) >= 3]
    if len(candidates) < 2:
        return candidates, 0

    remove_indices = find_exterior_polygon_indices(candidates)
    if not remove_indices:
        return candidates, 0
    return [polygon for index, polygon in enumerate(candidates) if index not in remove_indices], len(remove_indices)


def filter_exterior_tsv_rows(parsed: ParsedTsvGeometry) -> tuple[list[list[Point]], list[str], list[str], int]:
    candidates: list[list[Point]] = []
    room_types: list[str] = []
    room_numbers: list[str] = []
    for index, polygon in enumerate(parsed.polygons):
        if len(polygon) < 3:
            continue
        candidates.append(list(polygon))
        room_types.append(parsed.room_types[index] if index < len(parsed.room_types) else "")
        room_numbers.append(parsed.room_numbers[index] if index < len(parsed.room_numbers) else "")

    remove_indices = find_exterior_polygon_indices(candidates)
    if not remove_indices:
        return candidates, room_types, room_numbers, 0
    return (
        [polygon for index, polygon in enumerate(candidates) if index not in remove_indices],
        [room_type for index, room_type in enumerate(room_types) if index not in remove_indices],
        [room_number for index, room_number in enumerate(room_numbers) if index not in remove_indices],
        len(remove_indices),
    )


def find_exterior_polygon_indices(candidates: Sequence[Sequence[Point]]) -> set[int]:
    if len(candidates) < 2:
        return set()

    areas = [abs(polygon_area(polygon)) for polygon in candidates]
    median_area = float(np.median(np.asarray(areas, dtype=np.float64)))
    bounds = combine_polygon_bounds(candidates)
    total_bbox_area = max(1e-6, (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]))
    remove_indices: set[int] = set()

    for index, polygon in sorted(enumerate(candidates), key=lambda item: areas[item[0]], reverse=True)[:3]:
        area = areas[index]
        if area < max(median_area * 8.0, total_bbox_area * 0.25):
            continue
        contained = 0
        comparable = 0
        for other_index, other in enumerate(candidates):
            if other_index == index:
                continue
            other_area = areas[other_index]
            if other_area <= 0 or other_area > area * 0.5:
                continue
            comparable += 1
            centroid = polygon_centroid(other)
            if point_in_polygon(centroid, polygon):
                contained += 1
        if comparable > 0 and contained / comparable >= 0.6:
            remove_indices.add(index)

    return remove_indices


def prepare_pdf_tsv_sample(
    pair: PdfTsvPair,
    output_root: Path,
    image_size: int = 1024,
    separator_width: int = 3,
    debug_overlay: bool = True,
    room_type_taxonomy: str = "geometry",
) -> PreparedPdfTsvSample:
    try:
        import fitz  # type: ignore[import-not-found]
    except ModuleNotFoundError as error:
        raise RuntimeError("PyMuPDF is required for PDF-TSV preparation. Install requirements.txt first.") from error

    parsed = parse_pdf_tsv_geometry(pair.tsv_path)
    polygons, room_types, room_numbers, exterior_rows = filter_exterior_tsv_rows(parsed)
    target_mode = "class" if room_type_taxonomy != "geometry" else "geometry"
    class_specs = classes_for_taxonomy(room_type_taxonomy)
    class_by_label = {spec.label: spec.id for spec in class_specs}
    class_labels_by_id = (
        {0: "background", PDF_TSV_ROOM_ID: "room", PDF_TSV_SEPARATOR_ID: "separator"}
        if target_mode == "geometry"
        else {spec.id: spec.label for spec in class_specs}
    )
    active_separator_id = separator_class_id(class_specs) if target_mode == "class" else PDF_TSV_SEPARATOR_ID
    safe_stem = sanitize_stem(pair.stem)
    image_path = output_root / "images" / f"{safe_stem}.png"
    mask_path = output_root / "masks" / f"{safe_stem}.png"
    debug_path = output_root / "debug" / f"{safe_stem}.png" if debug_overlay else None
    image_path.parent.mkdir(parents=True, exist_ok=True)
    mask_path.parent.mkdir(parents=True, exist_ok=True)
    if debug_path is not None:
        debug_path.parent.mkdir(parents=True, exist_ok=True)

    document = fitz.open(pair.pdf_path)
    try:
        page = document.load_page(0)
        rotation = normalize_rotation_degrees(int(getattr(page, "rotation", 0) or 0))
        view_box = select_page_view_box(page, polygons)
        page_matrix = build_page_matrix(view_box, rotation)
        page_bounds = transformed_page_bounds(view_box, page_matrix)
        page_width = max(1e-6, page_bounds[2] - page_bounds[0])
        page_height = max(1e-6, page_bounds[3] - page_bounds[1])
        scale = min(image_size / page_width, image_size / page_height)
        render_width = max(1, round(page_width * scale))
        render_height = max(1, round(page_height * scale))
        offset_x = (image_size - render_width) // 2
        offset_y = (image_size - render_height) // 2
        rendered = render_pdf_page_image(page, render_width, render_height, scale, rotation)
    finally:
        document.close()

    image = Image.new("RGB", (image_size, image_size), (255, 255, 255))
    image.paste(rendered, (offset_x, offset_y))
    mask = Image.new("L", (image_size, image_size), 0)
    draw = ImageDraw.Draw(mask)
    pixel_polygons: list[list[tuple[float, float]]] = []
    room_type_counts: Counter[str] = Counter()
    room_class_counts: Counter[str] = Counter()
    for polygon, room_type in zip(polygons, room_types):
        pixels = [
            world_to_letterbox_pixel(
                apply_matrix(page_matrix, point.x, point.y),
                page_bounds,
                render_width,
                render_height,
                offset_x,
                offset_y,
            )
            for point in polygon
        ]
        if len(pixels) >= 3:
            if target_mode == "class":
                room_label = pdf_tsv_room_type_label(room_type, room_type_taxonomy)
                fill_id = class_by_label.get(room_label, class_by_label["other"])
                room_type_counts[room_type or "<blank>"] += 1
                room_class_counts[class_labels_by_id.get(fill_id, "other")] += 1
            else:
                fill_id = PDF_TSV_ROOM_ID
            draw.polygon(pixels, fill=fill_id)
            pixel_polygons.append(pixels)

    if separator_width > 0:
        line_width = max(1, int(separator_width))
        for pixels in pixel_polygons:
            draw.line([*pixels, pixels[0]], fill=active_separator_id, width=line_width, joint="curve")

    foreground_coverage, separator_coverage, mask_bbox, qc_warnings = compute_mask_stats(mask, active_separator_id)
    if debug_path is not None:
        write_debug_overlay(image, mask, debug_path, active_separator_id)

    image.save(image_path)
    mask.save(mask_path)
    class_pixel_counts = compute_class_pixel_counts(mask, class_labels_by_id)
    return PreparedPdfTsvSample(
        image_path=image_path,
        mask_path=mask_path,
        source_pdf=pair.pdf_path,
        source_tsv=pair.tsv_path,
        stem=pair.stem,
        geometry_rows=parsed.row_count,
        skipped_rows=parsed.skipped_rows,
        exterior_rows=exterior_rows,
        rotation=rotation,
        page_width=page_width,
        page_height=page_height,
        page_box=view_box,
        foreground_coverage=foreground_coverage,
        separator_coverage=separator_coverage,
        mask_bbox=mask_bbox,
        debug_path=debug_path,
        qc_warnings=qc_warnings,
        target_mode=target_mode,
        taxonomy=room_type_taxonomy,
        class_pixel_counts=class_pixel_counts,
        room_type_counts=dict(sorted(room_type_counts.items())),
        room_class_counts=dict(sorted(room_class_counts.items())),
        room_number_count=sum(1 for room_number in room_numbers if room_number.strip()),
    )


def render_pdf_page_image(page: object, target_width: int, target_height: int, scale: float, rotation: int) -> Image.Image:
    import fitz  # type: ignore[import-not-found]

    matrices = [fitz.Matrix(scale, scale)]
    if rotation:
        matrices.append(fitz.Matrix(scale, scale).prerotate(rotation))

    target_aspect = target_width / max(1, target_height)
    best_image: Image.Image | None = None
    best_score = float("inf")
    for matrix in matrices:
        pixmap = page.get_pixmap(matrix=matrix, alpha=False)
        image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
        aspect = image.width / max(1, image.height)
        score = abs(aspect - target_aspect) + abs(image.width - target_width) / max(1, target_width)
        if score < best_score:
            best_score = score
            best_image = image

    if best_image is None:
        raise RuntimeError("Unable to render PDF page.")
    if best_image.size != (target_width, target_height):
        best_image = best_image.resize((target_width, target_height), Image.Resampling.BILINEAR)
    return best_image.convert("RGB")


def write_pdf_tsv_splits(
    samples: list[PreparedPdfTsvSample],
    output_path: Path,
    seed: int = 1337,
    split_mode: str = "standard",
    class_specs: Sequence[ClassSpec] | None = None,
    taxonomy: str = "geometry",
) -> None:
    shuffled = samples[:]
    random.Random(seed).shuffle(shuffled)
    count = len(shuffled)
    if split_mode == "train-all":
        train_samples = shuffled
        val_samples: list[PreparedPdfTsvSample] = []
        test_samples: list[PreparedPdfTsvSample] = []
    elif split_mode == "standard":
        train_end = int(count * 0.8)
        val_end = int(count * 0.9)
        train_samples = shuffled[:train_end]
        val_samples = shuffled[train_end:val_end]
        test_samples = shuffled[val_end:]
    else:
        raise ValueError(f"Unknown PDF-TSV split mode: {split_mode}")

    class_specs = tuple(class_specs or classes_for_taxonomy(taxonomy))
    payload = {
        "metadata": {
            "splitMode": split_mode,
            "taxonomy": taxonomy,
            "targetMode": "class" if taxonomy != "geometry" else "geometry",
            "classSpecs": manifest_classes(class_specs),
        },
        "train": [serialize_prepared_sample(sample) for sample in train_samples],
        "val": [serialize_prepared_sample(sample) for sample in val_samples],
        "test": [serialize_prepared_sample(sample) for sample in test_samples],
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def read_pdf_tsv_metadata(split_path: Path) -> dict[str, object]:
    payload = json.loads(split_path.read_text(encoding="utf-8"))
    metadata = payload.get("metadata")
    return metadata if isinstance(metadata, dict) else {}


def read_pdf_tsv_class_specs(split_path: Path) -> tuple[ClassSpec, ...]:
    metadata = read_pdf_tsv_metadata(split_path)
    class_specs = metadata.get("classSpecs")
    if isinstance(class_specs, list):
        specs: list[ClassSpec] = []
        for entry in class_specs:
            if not isinstance(entry, dict):
                continue
            try:
                specs.append(
                    ClassSpec(
                        id=int(entry["id"]),
                        label=str(entry["label"]),
                        color=str(entry.get("color", "#64748b")),
                        kind=str(entry["kind"]),
                    )
                )
            except (KeyError, TypeError, ValueError):
                continue
        if specs:
            return tuple(sorted(specs, key=lambda spec: spec.id))
    return classes_for_taxonomy(str(metadata.get("taxonomy", "geometry")))


def read_pdf_tsv_split(split_path: Path, split: str) -> list[PreparedPdfTsvSample]:
    payload = json.loads(split_path.read_text(encoding="utf-8"))
    entries = payload.get(split)
    if not isinstance(entries, list):
        raise ValueError(f"Split {split!r} not found in {split_path}.")
    return [deserialize_prepared_sample(entry) for entry in entries]


def serialize_prepared_sample(sample: PreparedPdfTsvSample) -> dict[str, object]:
    payload = asdict(sample)
    for key in ("image_path", "mask_path", "source_pdf", "source_tsv", "debug_path"):
        value = payload.get(key)
        payload[key] = str(value) if value is not None else None
    return payload


def deserialize_prepared_sample(entry: dict[str, object]) -> PreparedPdfTsvSample:
    mask_bbox = entry.get("mask_bbox")
    page_box = entry.get("page_box")
    qc_warnings = entry.get("qc_warnings", ())
    debug_path = entry.get("debug_path")
    class_pixel_counts = entry.get("class_pixel_counts")
    room_type_counts = entry.get("room_type_counts")
    room_class_counts = entry.get("room_class_counts")
    return PreparedPdfTsvSample(
        image_path=Path(str(entry["image_path"])),
        mask_path=Path(str(entry["mask_path"])),
        source_pdf=Path(str(entry["source_pdf"])),
        source_tsv=Path(str(entry["source_tsv"])),
        stem=str(entry["stem"]),
        geometry_rows=int(entry["geometry_rows"]),
        skipped_rows=int(entry["skipped_rows"]),
        exterior_rows=int(entry["exterior_rows"]),
        rotation=int(entry["rotation"]),
        page_width=float(entry["page_width"]),
        page_height=float(entry["page_height"]),
        page_box=tuple(float(value) for value in page_box) if isinstance(page_box, (list, tuple)) else None,
        foreground_coverage=float(entry.get("foreground_coverage", 0.0)),
        separator_coverage=float(entry.get("separator_coverage", 0.0)),
        mask_bbox=tuple(int(value) for value in mask_bbox) if isinstance(mask_bbox, (list, tuple)) else None,
        debug_path=Path(str(debug_path)) if debug_path else None,
        qc_warnings=tuple(str(value) for value in qc_warnings) if isinstance(qc_warnings, (list, tuple)) else (),
        target_mode=str(entry.get("target_mode", "geometry")),
        taxonomy=str(entry.get("taxonomy", "geometry")),
        class_pixel_counts={str(key): int(value) for key, value in class_pixel_counts.items()}
        if isinstance(class_pixel_counts, dict)
        else None,
        room_type_counts={str(key): int(value) for key, value in room_type_counts.items()}
        if isinstance(room_type_counts, dict)
        else None,
        room_class_counts={str(key): int(value) for key, value in room_class_counts.items()}
        if isinstance(room_class_counts, dict)
        else None,
        room_number_count=int(entry.get("room_number_count", 0)),
    )


class PdfTsvGeometryDataset(Dataset[tuple[torch.Tensor, torch.Tensor]]):
    def __init__(self, samples: Iterable[PreparedPdfTsvSample], augment: bool = False) -> None:
        self.samples = list(samples)
        self.augment = augment

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor]:
        sample = self.samples[index]
        image = Image.open(sample.image_path).convert("RGB")
        mask = Image.open(sample.mask_path).convert("L")
        if self.augment and random.random() < 0.5:
            image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            mask = mask.transpose(Image.Transpose.FLIP_LEFT_RIGHT)

        image_array = np.asarray(image, dtype=np.float32) / 255.0
        image_array = (image_array - np.asarray(IMAGE_MEAN, dtype=np.float32)) / np.asarray(IMAGE_STD, dtype=np.float32)
        image_tensor = torch.from_numpy(image_array.transpose(2, 0, 1)).float()
        mask_tensor = torch.from_numpy(np.asarray(mask, dtype=np.uint8).astype(np.int64)).long()
        return image_tensor, mask_tensor


def select_page_view_box(page: object, polygons: Sequence[Sequence[Point]]) -> tuple[float, float, float, float]:
    candidates = read_page_view_box_candidates(page)
    if not candidates:
        return read_page_view_box(page)
    if not polygons:
        return candidates[0]
    return max(candidates, key=lambda box: score_page_view_box(box, polygons))


def read_page_view_box_candidates(page: object) -> list[tuple[float, float, float, float]]:
    candidates: list[tuple[float, float, float, float]] = []
    for attribute in ("cropbox", "mediabox", "rect"):
        box = getattr(page, attribute, None)
        if box is None:
            continue
        normalized = normalize_box_tuple(box)
        if not any(boxes_close(normalized, existing) for existing in candidates):
            candidates.append(normalized)
    return candidates


def read_page_view_box(page: object) -> tuple[float, float, float, float]:
    candidates = read_page_view_box_candidates(page)
    if candidates:
        return candidates[0]
    box = getattr(page, "rect")
    return normalize_box_tuple(box)


def normalize_box_tuple(box: object) -> tuple[float, float, float, float]:
    x0 = float(getattr(box, "x0", 0.0))
    y0 = float(getattr(box, "y0", 0.0))
    x1 = float(getattr(box, "x1", getattr(box, "width", 1.0)))
    y1 = float(getattr(box, "y1", getattr(box, "height", 1.0)))
    if x1 == x0:
        x1 = x0 + 1.0
    if y1 == y0:
        y1 = y0 + 1.0
    return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def boxes_close(left: tuple[float, float, float, float], right: tuple[float, float, float, float]) -> bool:
    return all(abs(a - b) <= 1e-6 for a, b in zip(left, right))


def score_page_view_box(view_box: tuple[float, float, float, float], polygons: Sequence[Sequence[Point]]) -> float:
    total_bbox_area = 0.0
    covered_bbox_area = 0.0
    total_points = 0
    contained_points = 0
    x0, y0, x1, y1 = view_box
    page_area = max(1e-6, (x1 - x0) * (y1 - y0))

    for polygon in polygons:
        if len(polygon) < 3:
            continue
        bounds = polygon_bounds(polygon)
        bbox_area = max(1e-6, (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]))
        total_bbox_area += bbox_area
        covered_bbox_area += bbox_intersection_area(view_box, bounds)
        for point in polygon:
            total_points += 1
            if x0 <= point.x <= x1 and y0 <= point.y <= y1:
                contained_points += 1

    if total_bbox_area <= 0.0 or total_points == 0:
        return 0.0

    bbox_coverage = covered_bbox_area / total_bbox_area
    point_coverage = contained_points / total_points
    tightness = min(0.25, total_bbox_area / page_area)
    return bbox_coverage * 4.0 + point_coverage + tightness


def bbox_intersection_area(
    left: tuple[float, float, float, float],
    right: tuple[float, float, float, float],
) -> float:
    x0 = max(left[0], right[0])
    y0 = max(left[1], right[1])
    x1 = min(left[2], right[2])
    y1 = min(left[3], right[3])
    return max(0.0, x1 - x0) * max(0.0, y1 - y0)


def build_page_matrix(view_box: tuple[float, float, float, float], rotation: int) -> Mat2D:
    transform, _, viewport_height = build_pdfjs_viewport_transform(view_box, rotation)
    return multiply_matrices((1.0, 0.0, 0.0, -1.0, 0.0, viewport_height), transform)


def build_pdfjs_viewport_transform(
    view_box: tuple[float, float, float, float],
    rotation: int,
    scale: float = 1.0,
) -> tuple[Mat2D, float, float]:
    x0, y0, x1, y1 = view_box
    center_x = (x1 + x0) * 0.5
    center_y = (y1 + y0) * 0.5
    normalized = normalize_rotation_degrees(rotation)
    if normalized == 180:
        rotate_a, rotate_b, rotate_c, rotate_d = -1.0, 0.0, 0.0, 1.0
    elif normalized == 90:
        rotate_a, rotate_b, rotate_c, rotate_d = 0.0, 1.0, 1.0, 0.0
    elif normalized == 270:
        rotate_a, rotate_b, rotate_c, rotate_d = 0.0, -1.0, -1.0, 0.0
    else:
        rotate_a, rotate_b, rotate_c, rotate_d = 1.0, 0.0, 0.0, -1.0

    if rotate_a == 0.0:
        offset_canvas_x = abs(center_y - y0) * scale
        offset_canvas_y = abs(center_x - x0) * scale
        width = abs(y1 - y0) * scale
        height = abs(x1 - x0) * scale
    else:
        offset_canvas_x = abs(center_x - x0) * scale
        offset_canvas_y = abs(center_y - y0) * scale
        width = abs(x1 - x0) * scale
        height = abs(y1 - y0) * scale

    return (
        (
            rotate_a * scale,
            rotate_b * scale,
            rotate_c * scale,
            rotate_d * scale,
            offset_canvas_x - rotate_a * scale * center_x - rotate_c * scale * center_y,
            offset_canvas_y - rotate_b * scale * center_x - rotate_d * scale * center_y,
        ),
        width,
        height,
    )


def normalize_rotation_degrees(rotation: int | float) -> int:
    normalized = (round(float(rotation) / 90.0) * 90) % 360
    return int(normalized)


def multiply_matrices(left: Mat2D, right: Mat2D) -> Mat2D:
    return (
        left[0] * right[0] + left[2] * right[1],
        left[1] * right[0] + left[3] * right[1],
        left[0] * right[2] + left[2] * right[3],
        left[1] * right[2] + left[3] * right[3],
        left[0] * right[4] + left[2] * right[5] + left[4],
        left[1] * right[4] + left[3] * right[5] + left[5],
    )


def apply_matrix(matrix: Mat2D, x: float, y: float) -> Point:
    return Point(
        x=matrix[0] * x + matrix[2] * y + matrix[4],
        y=matrix[1] * x + matrix[3] * y + matrix[5],
    )


def transformed_page_bounds(view_box: tuple[float, float, float, float], matrix: Mat2D) -> tuple[float, float, float, float]:
    x0, y0, x1, y1 = view_box
    points = [
        apply_matrix(matrix, x0, y0),
        apply_matrix(matrix, x1, y0),
        apply_matrix(matrix, x1, y1),
        apply_matrix(matrix, x0, y1),
    ]
    return (
        min(point.x for point in points),
        min(point.y for point in points),
        max(point.x for point in points),
        max(point.y for point in points),
    )


def world_to_letterbox_pixel(
    point: Point,
    page_bounds: tuple[float, float, float, float],
    render_width: int,
    render_height: int,
    offset_x: int,
    offset_y: int,
) -> tuple[float, float]:
    min_x, min_y, max_x, max_y = page_bounds
    nx = (point.x - min_x) / max(1e-6, max_x - min_x)
    ny = (max_y - point.y) / max(1e-6, max_y - min_y)
    return (offset_x + nx * render_width, offset_y + ny * render_height)


def compute_mask_stats(
    mask: Image.Image,
    active_separator_id: int = PDF_TSV_SEPARATOR_ID,
) -> tuple[float, float, tuple[int, int, int, int] | None, tuple[str, ...]]:
    mask_array = np.asarray(mask, dtype=np.uint8)
    room_mask = (mask_array > 0) & (mask_array != active_separator_id)
    separator_mask = mask_array == active_separator_id
    geometry_mask = room_mask | separator_mask
    pixel_count = max(1, mask_array.size)
    foreground_coverage = float(room_mask.sum() / pixel_count)
    separator_coverage = float(separator_mask.sum() / pixel_count)
    geometry_coverage = foreground_coverage + separator_coverage
    warnings: list[str] = []

    if not geometry_mask.any():
        warnings.append("empty_mask")
        bbox = None
    else:
        ys, xs = np.nonzero(geometry_mask)
        bbox = (int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1))
        if geometry_coverage < QC_TINY_GEOMETRY_COVERAGE:
            warnings.append("tiny_geometry")
        if geometry_coverage > QC_HUGE_GEOMETRY_COVERAGE:
            warnings.append("huge_geometry")
        if foreground_coverage > 0.0 and separator_coverage <= 0.0:
            warnings.append("missing_separator")

    return foreground_coverage, separator_coverage, bbox, tuple(warnings)


def compute_class_pixel_counts(mask: Image.Image, labels_by_id: dict[int, str]) -> dict[str, int]:
    mask_array = np.asarray(mask, dtype=np.uint8)
    counts = np.bincount(mask_array.reshape(-1), minlength=max(labels_by_id.keys(), default=0) + 1)
    return {
        labels_by_id.get(class_id, str(class_id)): int(count)
        for class_id, count in enumerate(counts)
        if count > 0
    }


def write_debug_overlay(
    image: Image.Image,
    mask: Image.Image,
    output_path: Path,
    active_separator_id: int = PDF_TSV_SEPARATOR_ID,
) -> None:
    base = np.asarray(image.convert("RGBA"), dtype=np.uint8).copy()
    mask_array = np.asarray(mask, dtype=np.uint8)
    blend_pixels(base, (mask_array > 0) & (mask_array != active_separator_id), np.asarray([0, 160, 80], dtype=np.float32), 0.36)
    blend_pixels(base, mask_array == active_separator_id, np.asarray([255, 0, 180], dtype=np.float32), 0.72)
    Image.fromarray(base, mode="RGBA").save(output_path)


def blend_pixels(base: np.ndarray, selection: np.ndarray, color: np.ndarray, alpha: float) -> None:
    if not selection.any():
        return
    source = base[selection, :3].astype(np.float32)
    base[selection, :3] = np.clip(source * (1.0 - alpha) + color * alpha, 0, 255).astype(np.uint8)
    base[selection, 3] = 255


def polygon_area(points: Sequence[Point]) -> float:
    area = 0.0
    for index, point in enumerate(points):
        next_point = points[(index + 1) % len(points)]
        area += point.x * next_point.y - next_point.x * point.y
    return area * 0.5


def polygon_centroid(points: Sequence[Point]) -> Point:
    area = polygon_area(points)
    if abs(area) <= 1e-9:
        xs = [point.x for point in points]
        ys = [point.y for point in points]
        return Point(sum(xs) / len(xs), sum(ys) / len(ys))
    cx = 0.0
    cy = 0.0
    for index, point in enumerate(points):
        next_point = points[(index + 1) % len(points)]
        cross = point.x * next_point.y - next_point.x * point.y
        cx += (point.x + next_point.x) * cross
        cy += (point.y + next_point.y) * cross
    factor = 1.0 / (6.0 * area)
    return Point(cx * factor, cy * factor)


def point_in_polygon(point: Point, polygon: Sequence[Point]) -> bool:
    inside = False
    j = len(polygon) - 1
    for i, current in enumerate(polygon):
        previous = polygon[j]
        if (current.y > point.y) != (previous.y > point.y):
            x_at_y = (previous.x - current.x) * (point.y - current.y) / max(1e-12, previous.y - current.y) + current.x
            if point.x < x_at_y:
                inside = not inside
        j = i
    return inside


def combine_polygon_bounds(polygons: Sequence[Sequence[Point]]) -> tuple[float, float, float, float]:
    min_x = min(point.x for polygon in polygons for point in polygon)
    min_y = min(point.y for polygon in polygons for point in polygon)
    max_x = max(point.x for polygon in polygons for point in polygon)
    max_y = max(point.y for polygon in polygons for point in polygon)
    return min_x, min_y, max_x, max_y


def polygon_bounds(polygon: Sequence[Point]) -> tuple[float, float, float, float]:
    return (
        min(point.x for point in polygon),
        min(point.y for point in polygon),
        max(point.x for point in polygon),
        max(point.y for point in polygon),
    )


def sanitize_stem(stem: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9._-]+", "_", stem.strip())
    return normalized or "floorplan"
