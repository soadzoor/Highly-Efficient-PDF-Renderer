from __future__ import annotations

import json
from pathlib import Path

import pytest
import torch

from roomdet.classes import CLASS_COUNT
from roomdet.classes import PDF_TSV_CLINICAL_CLASSES, pdf_tsv_room_type_label
from roomdet.losses import pdf_tsv_geometry_loss, pdf_tsv_geometry_prediction
from roomdet.pdf_tsv_dataset import (
    PDF_TSV_ROOM_ID,
    PDF_TSV_SEPARATOR_ID,
    PdfTsvGeometryDataset,
    PdfTsvPair,
    Point,
    PreparedPdfTsvSample,
    build_page_matrix,
    discover_pdf_tsv_pairs,
    filter_exterior_polygons,
    parse_pdf_tsv_geometry,
    prepare_pdf_tsv_sample,
    read_pdf_tsv_class_specs,
    read_pdf_tsv_split,
    select_page_view_box,
    write_pdf_tsv_splits,
)


def test_parse_pdf_tsv_geometry_uses_only_geometry_data(tmp_path: Path) -> None:
    valid_geometry = json.dumps([
        {"x": 0, "y": 0},
        {"x": 10, "y": 0},
        {"x": 10, "y": 10},
        {"x": 0, "y": 0},
    ])
    tsv_path = tmp_path / "rooms.tsv"
    tsv_path.write_text(
        "\ufeffboundaryID\tboundaryType\troomType\troomNumber\tgeometryData\n"
        f"b1\tIgnored\tIgnored\tIgnored\t\"{valid_geometry.replace('"', '""')}\"\n"
        "b2\tIgnored\tIgnored\tIgnored\tnot-json\n"
        "b3\tIgnored\tIgnored\tIgnored\t[]\n",
        encoding="utf-8",
    )

    parsed = parse_pdf_tsv_geometry(tsv_path)

    assert parsed.row_count == 3
    assert parsed.skipped_rows == 2
    assert len(parsed.polygons) == 1
    assert parsed.polygons[0] == [Point(0, 0), Point(10, 0), Point(10, 10)]
    assert parsed.room_types == ["Ignored"]
    assert parsed.room_numbers == ["Ignored"]


@pytest.mark.parametrize(
    ("raw_room_type", "expected"),
    [
        ("Toilet", "toilet"),
        ("Toilet, Patient", "toilet"),
        ("Shower", "shower"),
        ("Corridor", "corridor"),
        ("Office, General", "office"),
        ("Exam Room", "exam_treatment"),
        ("Patient Room, Med/Surg", "patient_room"),
        ("Storage", "storage_supply"),
        ("Elevator", "vertical_transport"),
        ("Stairs", "vertical_transport"),
        ("Electrical", "building_services"),
        ("Waiting Area, General", "public_waiting"),
        ("Work Station, Nurse", "staff_support"),
        ("", "other"),
    ],
)
def test_pdf_tsv_room_type_label_maps_common_values(raw_room_type: str, expected: str) -> None:
    assert pdf_tsv_room_type_label(raw_room_type) == expected


def test_discover_pdf_tsv_pairs_reports_missing_files(tmp_path: Path) -> None:
    (tmp_path / "paired.pdf").write_bytes(b"%PDF-1.7\n")
    (tmp_path / "paired.tsv").write_text("geometryData\n[]\n", encoding="utf-8")
    (tmp_path / "pdf-only.pdf").write_bytes(b"%PDF-1.7\n")
    (tmp_path / "tsv-only.tsv").write_text("geometryData\n[]\n", encoding="utf-8")

    discovery = discover_pdf_tsv_pairs(tmp_path)

    assert [pair.stem for pair in discovery.pairs] == ["paired"]
    assert discovery.missing_pdfs == ["tsv-only"]
    assert discovery.missing_tsvs == ["pdf-only"]


@pytest.mark.parametrize(
    ("rotation", "expected"),
    [
        (0, (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)),
        (90, (0.0, -1.0, 1.0, 0.0, 0.0, 100.0)),
        (180, (-1.0, 0.0, 0.0, -1.0, 100.0, 200.0)),
        (270, (0.0, 1.0, -1.0, 0.0, 200.0, 0.0)),
    ],
)
def test_build_page_matrix_matches_room_overlay_demo(rotation: int, expected: tuple[float, ...]) -> None:
    assert build_page_matrix((0.0, 0.0, 100.0, 200.0), rotation) == pytest.approx(expected)


def test_filter_exterior_polygons_removes_containing_shell() -> None:
    outside = [Point(0, 0), Point(10, 0), Point(10, 10), Point(0, 10)]
    room_a = [Point(1, 1), Point(2, 1), Point(2, 2), Point(1, 2)]
    room_b = [Point(5, 5), Point(6, 5), Point(6, 6), Point(5, 6)]

    filtered, removed = filter_exterior_polygons([outside, room_a, room_b])

    assert removed == 1
    assert filtered == [room_a, room_b]


def test_pdf_tsv_dataset_reads_cached_images_deterministically(tmp_path: Path) -> None:
    from PIL import Image

    image_path = tmp_path / "image.png"
    mask_path = tmp_path / "mask.png"
    Image.new("RGB", (8, 8), (255, 255, 255)).save(image_path)
    mask_image = Image.new("L", (8, 8), PDF_TSV_ROOM_ID)
    mask_image.putpixel((0, 0), PDF_TSV_SEPARATOR_ID)
    mask_image.save(mask_path)
    sample = PreparedPdfTsvSample(
        image_path=image_path,
        mask_path=mask_path,
        source_pdf=tmp_path / "source.pdf",
        source_tsv=tmp_path / "source.tsv",
        stem="source",
        geometry_rows=1,
        skipped_rows=0,
        exterior_rows=0,
        rotation=0,
        page_width=8,
        page_height=8,
    )
    dataset = PdfTsvGeometryDataset([sample])

    image_a, mask_a = dataset[0]
    image_b, mask_b = dataset[0]

    assert torch.equal(image_a, image_b)
    assert torch.equal(mask_a, mask_b)
    assert mask_a.unique().tolist() == [PDF_TSV_ROOM_ID, PDF_TSV_SEPARATOR_ID]


def test_write_pdf_tsv_splits_train_all_records_class_specs(tmp_path: Path) -> None:
    from PIL import Image

    image_path = tmp_path / "image.png"
    mask_path = tmp_path / "mask.png"
    Image.new("RGB", (8, 8), (255, 255, 255)).save(image_path)
    Image.new("L", (8, 8), 1).save(mask_path)
    sample = PreparedPdfTsvSample(
        image_path=image_path,
        mask_path=mask_path,
        source_pdf=tmp_path / "source.pdf",
        source_tsv=tmp_path / "source.tsv",
        stem="source",
        geometry_rows=1,
        skipped_rows=0,
        exterior_rows=0,
        rotation=0,
        page_width=8,
        page_height=8,
        target_mode="class",
        taxonomy="clinical-coarse",
    )
    splits_path = tmp_path / "splits.json"

    write_pdf_tsv_splits(
        [sample],
        splits_path,
        split_mode="train-all",
        class_specs=PDF_TSV_CLINICAL_CLASSES,
        taxonomy="clinical-coarse",
    )

    assert [entry.stem for entry in read_pdf_tsv_split(splits_path, "train")] == ["source"]
    assert read_pdf_tsv_split(splits_path, "val") == []
    assert [spec.label for spec in read_pdf_tsv_class_specs(splits_path) if spec.kind == "room"][:3] == [
        "office",
        "toilet",
        "shower",
    ]


def test_pdf_tsv_geometry_loss_can_overfit_tiny_logits() -> None:
    logits = torch.nn.Parameter(torch.zeros(1, CLASS_COUNT, 2, 2))
    mask = torch.tensor([[[PDF_TSV_ROOM_ID, PDF_TSV_SEPARATOR_ID], [0, PDF_TSV_ROOM_ID]]], dtype=torch.long)
    optimizer = torch.optim.SGD([logits], lr=0.5)
    initial = float(pdf_tsv_geometry_loss(logits, mask).detach())
    for _ in range(60):
        optimizer.zero_grad(set_to_none=True)
        loss = pdf_tsv_geometry_loss(logits, mask)
        loss.backward()
        optimizer.step()
    final = float(pdf_tsv_geometry_loss(logits, mask).detach())
    prediction = pdf_tsv_geometry_prediction(logits).detach()

    assert final < initial
    assert int(prediction[0, 0, 1]) == PDF_TSV_SEPARATOR_ID


def test_select_page_view_box_prefers_box_containing_negative_geometry() -> None:
    class Box:
        def __init__(self, x0: float, y0: float, x1: float, y1: float) -> None:
            self.x0 = x0
            self.y0 = y0
            self.x1 = x1
            self.y1 = y1

    class Page:
        cropbox = Box(0, 0, 100, 100)
        mediabox = Box(0, -100, 100, 0)
        rect = Box(0, 0, 100, 100)

    polygon = [Point(10, -90), Point(90, -90), Point(90, -10), Point(10, -10)]

    assert select_page_view_box(Page(), [polygon]) == (0.0, -100.0, 100.0, 0.0)


def test_prepare_pdf_tsv_sample_with_rotated_synthetic_pdf(tmp_path: Path) -> None:
    fitz = pytest.importorskip("fitz")

    pdf_path = tmp_path / "rotated.pdf"
    tsv_path = tmp_path / "rotated.tsv"
    document = fitz.open()
    page = document.new_page(width=100, height=200)
    page.set_rotation(90)
    document.save(pdf_path)
    document.close()
    geometry = json.dumps([
        {"x": 10, "y": 20},
        {"x": 50, "y": 20},
        {"x": 50, "y": 70},
        {"x": 10, "y": 70},
    ])
    tsv_path.write_text(f"geometryData\n\"{geometry.replace('"', '""')}\"\n", encoding="utf-8")

    sample = prepare_pdf_tsv_sample(PdfTsvPair("rotated", pdf_path, tsv_path), tmp_path / "prepared", image_size=64)

    assert sample.rotation == 90
    assert sample.mask_path.exists()
    assert sample.image_path.exists()
    assert sample.debug_path is not None
    assert sample.debug_path.exists()
    assert sample.foreground_coverage > 0.0
    assert sample.separator_coverage > 0.0
