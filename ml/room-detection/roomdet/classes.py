from __future__ import annotations

from collections.abc import Sequence
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class ClassSpec:
    id: int
    label: str
    color: str
    kind: str


PDF_TSV_CLINICAL_CLASSES: tuple[ClassSpec, ...] = (
    ClassSpec(0, "background", "#0f172a", "background"),
    ClassSpec(1, "office", "#2563eb", "room"),
    ClassSpec(2, "toilet", "#0891b2", "room"),
    ClassSpec(3, "shower", "#06b6d4", "room"),
    ClassSpec(4, "patient_room", "#16a34a", "room"),
    ClassSpec(5, "exam_treatment", "#d97706", "room"),
    ClassSpec(6, "corridor", "#7c3aed", "room"),
    ClassSpec(7, "storage_supply", "#64748b", "room"),
    ClassSpec(8, "vertical_transport", "#dc2626", "room"),
    ClassSpec(9, "building_services", "#475569", "room"),
    ClassSpec(10, "public_waiting", "#65a30d", "room"),
    ClassSpec(11, "staff_support", "#c026d3", "room"),
    ClassSpec(12, "other", "#0f766e", "room"),
    ClassSpec(13, "separator", "#111827", "separator"),
)

PDF_TSV_CLINICAL_CLASS_COUNT = len(PDF_TSV_CLINICAL_CLASSES)

PDF_TSV_GEOMETRY_CLASSES: tuple[ClassSpec, ...] = (
    ClassSpec(0, "background", "#0f172a", "background"),
    ClassSpec(1, "room", "#0f766e", "room"),
    ClassSpec(2, "separator", "#111827", "separator"),
)

CLASSES = PDF_TSV_GEOMETRY_CLASSES
CLASS_COUNT = len(CLASSES)


PDF_TSV_ROOM_TYPE_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("shower", ("shower", "bath", "bathing")),
    ("toilet", ("toilet", "toilette", "restroom", "wc", "lavatory")),
    ("patient_room", ("patient room", "icu", "med/surg", "med surg", "protective environment")),
    (
        "exam_treatment",
        (
            "exam",
            "treatment",
            "operating room",
            "operating",
            "procedure",
            "pacu",
            "therapy",
            "infusion",
            "observation",
            "patient holding",
            "holding",
            "consult",
            "reading room",
            "control room",
            "dressing",
        ),
    ),
    ("office", ("office", "director office", "provider", "manager")),
    ("corridor", ("corridor", "hallway", "hall", "vestibule", "lobby", "entry", "foyer")),
    (
        "vertical_transport",
        ("elevator", "stair", "stairs", "staircase", "lift", "escalator"),
    ),
    (
        "building_services",
        (
            "electrical",
            "mechanical",
            "idf",
            "mdf",
            "shaft",
            "evs",
            "housekeeping",
            "equipment room",
            "control",
        ),
    ),
    (
        "storage_supply",
        (
            "storage",
            "supply",
            "clean supply",
            "soiled utility",
            "soiled holding",
            "utility",
            "closet",
            "linen",
            "medication",
            "equipment",
            "crash cart",
            "alcove",
            "pantry",
        ),
    ),
    (
        "public_waiting",
        ("waiting", "reception", "amenities", "public", "lounge, public"),
    ),
    (
        "staff_support",
        (
            "workroom",
            "work room",
            "work station",
            "work area",
            "charting",
            "conference",
            "break room",
            "lounge",
            "staff",
            "lockers",
            "phone room",
            "cubicle",
            "copy",
            "printer",
            "fax",
            "nurse",
            "sink",
            "pts",
            "wow",
        ),
    ),
)


def manifest_classes(classes: Sequence[ClassSpec] = CLASSES) -> list[dict[str, object]]:
    return [asdict(spec) for spec in classes]


def class_specs_from_manifest(value: object) -> tuple[ClassSpec, ...]:
    if not isinstance(value, list):
        return CLASSES

    specs: list[ClassSpec] = []
    for entry in value:
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

    if not specs:
        return CLASSES
    return tuple(sorted(specs, key=lambda spec: spec.id))


def classes_for_taxonomy(taxonomy: str) -> tuple[ClassSpec, ...]:
    if taxonomy == "clinical-coarse":
        return PDF_TSV_CLINICAL_CLASSES
    if taxonomy == "geometry":
        return PDF_TSV_GEOMETRY_CLASSES
    raise ValueError(f"Unknown room type taxonomy: {taxonomy}")


def separator_class_id(classes: Sequence[ClassSpec]) -> int:
    for spec in classes:
        if spec.kind == "separator":
            return spec.id
    return max(spec.id for spec in classes)


def room_class_ids(classes: Sequence[ClassSpec]) -> tuple[int, ...]:
    return tuple(spec.id for spec in classes if spec.kind == "room")


def pdf_tsv_room_type_label(raw_room_type: str, taxonomy: str = "clinical-coarse") -> str:
    if taxonomy != "clinical-coarse":
        return "other"

    normalized = " ".join(raw_room_type.replace("_", " ").replace("-", " ").lower().split())
    if not normalized:
        return "other"

    for label, keywords in PDF_TSV_ROOM_TYPE_KEYWORDS:
        if any(keyword in normalized for keyword in keywords):
            return label
    return "other"
