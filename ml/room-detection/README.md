# PDF-TSV Room Detection

This workspace trains and exports the room detector used by the browser ONNX demo. The current model is trained from local PDF/TSV room geometry and room type annotations.

There are two independent pipelines with two different trainers — don't mix their commands:

| Pipeline | Input | Trainer | Sections |
|---|---|---|---|
| Raster CNN (shipped model) | rendered page images | `train_pdf_tsv_scratch.py` | Prepare / Train / Evaluate / Export below |
| Vector-native (experimental) | PDF stroke segments | `train_segment_classifier.py` | "Vector Pipeline" at the bottom |

The app expects the exported files at:

```text
public/models/room-detector/model.onnx
public/models/room-detector/manifest.json
```

The model contract is manifest-driven:

- input: `float32[1,3,H,W]`, RGB, ImageNet normalization
- output: `float32[1,C,h,w]`, class logits
- classes: read from `manifest.json`

## Setup

```bash
cd ml/room-detection
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cd ../..
```

Run commands below from the repository root unless noted otherwise. If you stay
in `ml/room-detection`, omit the leading `ml/room-detection/` from script paths
and adjust repo-root-relative data paths accordingly.

## Prepare PDF-TSV Data

Put local paired `*.pdf` and `*.tsv` files in `pdf-tsv/`, either flat or organized
into subfolders (`pdf-tsv/kp`, `pdf-tsv/uci`, ...). Files are paired by filename
stem within each folder; subfolder samples get a `<folder>__` stem prefix. PDFs
without a matching TSV (`withoutTSV/`, `not_floorplans/`) are reported and
skipped. The raw `pdf-tsv/` directory and generated `data/` cache are ignored by
Git.

```bash
python3 ml/room-detection/prepare_pdf_tsv_dataset.py \
  --pdf-tsv-root pdf-tsv \
  --output-root data/pdf-tsv-roomtypes-sep3-v1 \
  --splits ml/room-detection/pdf_tsv_roomtypes_sep3_splits.json \
  --image-size 1536 \
  --separator-width 3 \
  --split-mode train-all \
  --room-type-taxonomy clinical-coarse
```

`--split-mode train-all` (used for the shipped model) trains on everything and
keeps no validation split. To retrain the raster model as a *fair baseline* for
the vector pipeline, mirror the vector splits instead so both models share the
exact same held-out pages:

```bash
python3 ml/room-detection/prepare_pdf_tsv_dataset.py \
  --pdf-tsv-root pdf-tsv \
  --output-root data/pdf-tsv-roomtypes-sep3-vecmatch \
  --splits ml/room-detection/pdf_tsv_vecmatch_splits.json \
  --image-size 1536 \
  --separator-width 3 \
  --room-type-taxonomy clinical-coarse \
  --match-vector-splits ml/room-detection/vector-splits.json
```

The preparer reads `geometryData`, `roomType`, and `roomNumber`; it ignores `boundaryID` and `boundaryType`. It renders the first PDF page, applies the rotation-aware PDF coordinate transform, rasterizes class masks, and writes cached images, masks, metadata, and debug overlays.

QC overlays are written under:

```text
data/pdf-tsv-roomtypes-sep3-v1/debug/
```

Check the overlays before training. Green regions represent room interiors and dark separator pixels represent room boundaries. Warnings such as `empty_mask`, `tiny_geometry`, or `huge_geometry` usually mean a PDF/TSV alignment issue should be fixed first.

## Train (raster CNN)

This trains the raster segmentation CNN (`train_pdf_tsv_scratch.py`). The vector
model has its own trainer — see "Vector Pipeline" below.

Train the ImageNet-initialized PDF-TSV room-type model:

```bash
python3 ml/room-detection/train_pdf_tsv_scratch.py \
  --pdf-tsv-splits ml/room-detection/pdf_tsv_roomtypes_sep3_splits.json \
  --output-dir ml/room-detection/runs/pdf-tsv-roomtypes-imagenet-sep3-v1 \
  --init imagenet \
  --epochs 250 \
  --batch-size 2 \
  --workers 4 \
  --lr 3e-4
```

For a fully random baseline:

```bash
python3 ml/room-detection/train_pdf_tsv_scratch.py \
  --pdf-tsv-splits ml/room-detection/pdf_tsv_roomtypes_sep3_splits.json \
  --output-dir ml/room-detection/runs/pdf-tsv-roomtypes-random-sep3-v1 \
  --init random \
  --epochs 350 \
  --batch-size 2 \
  --workers 4 \
  --lr 3e-4
```

The script logs JSON progress, writes `last.pt` after every epoch, and selects `best.pt` by train matched-room IoU with foreground IoU as the tie-breaker.

## Evaluate

Evaluate the training PDFs with instance matching:

```bash
python3 ml/room-detection/evaluate_pdf_tsv.py \
  --splits ml/room-detection/pdf_tsv_roomtypes_sep3_splits.json \
  --checkpoint ml/room-detection/runs/pdf-tsv-roomtypes-imagenet-sep3-v1/best.pt \
  --split train \
  --output ml/room-detection/runs/pdf-tsv-roomtypes-imagenet-sep3-v1/train-metrics.json \
  --instance-matching
```

Key metrics:

- `pdfTsvForegroundIou`: room foreground quality
- `pdfTsvRoomInteriorIou`: interior quality excluding separators
- `pdfTsvSeparatorIou`: boundary/separator quality
- `pdfTsvMatchedRoomMeanIou`: detected room-instance overlap
- `pdfTsvMatchedRoomRecallAt50`: room-instance recall at IoU `0.50`
- `pdfTsvMatchedRoomTypeAccuracyAt50`: room-type accuracy for matched rooms

## Export ONNX

Export the best checkpoint for the browser demo:

```bash
python3 ml/room-detection/export_onnx.py \
  --checkpoint ml/room-detection/runs/pdf-tsv-roomtypes-imagenet-sep3-v1/best.pt \
  --metrics ml/room-detection/runs/pdf-tsv-roomtypes-imagenet-sep3-v1/train-metrics.json \
  --version pdf-tsv-roomtypes-sep3-v1 \
  --output public/models/room-detector/model.onnx \
  --manifest public/models/room-detector/manifest.json
```

The browser loads `model.onnx` through `onnxruntime-web`. Keep `public/ort/` committed so the WASM fallback can load its runtime assets from the same origin.

## Runtime Check

```bash
npm run build
```

Open `three-example.html`, load a PDF, run `Detect Rooms`, and verify:

- room polygons track pan, zoom, resize, and backend switching
- room labels use manifest class names and colors
- room numbers appear when the PDF exposes extractable room-number text
- `Download Rooms JSON` includes the displayed detections

## Vector Pipeline (no rasterization)

A second, vector-native pipeline detects rooms directly from PDF stroke segments:
a small neighbour-attention encoder classifies each segment as room-boundary or
not, a learned link predictor bridges ink-free gaps (doors), and shapely
polygonizes the surviving segments into faces scored by perimeter support.
Rasterization only happens inside the scorer, so results are scale invariant —
`--scale-check` re-runs the whole pipeline at x0.25 / x4 coordinates and the
metrics must not move.

Modules live in `roomdet/vector_*.py`; supervision is derived from the same TSVs
(hand-drawn polygons are snapped onto real strokes first; `boundaryID`/
`boundaryType` are ignored). Splits are grouped by building stem so floors of one
building never straddle train/val, and are deterministic from the seed
(`vector-splits.json` is gitignored like the raster split manifests; regenerate it
with the same seed, or `git add -f` to pin it).

All long-running scripts print JSON progress lines at least every `--log-seconds`
(default 10) with percentages and ETAs; every trainer writes `last.pt`/`best.pt`.
`--device auto` picks cuda, then mps, then cpu.

All vector commands below run from `ml/room-detection`. The Node dump script is
the one exception in spirit: its `--root`/`--out` arguments (and their defaults,
`pdf-tsv` and `ml/room-detection/data/vector-segments`) always resolve against
the repository root, no matter where you invoke it from.

```bash
cd ml/room-detection

# 0. one-time: segment dumps via the browser extractor running headless in Node
node ../../scripts/extract-segments.mjs

# 1. labels, bridge candidates, QC overlays (data/vector-dataset/qc), splits
python prepare_vector_dataset.py

# 2. raster baseline (optimistic upper bound: the committed model trained on all pages)
#    For a fair clean-split baseline instead, retrain the raster CNN on splits
#    prepared with --match-vector-splits (see "Prepare PDF-TSV Data"), then
#    evaluate it with evaluate_pdf_tsv.py --split val --instance-matching.
python evaluate_onnx_baseline.py --split val

# 3. segment classifier (Head A)
python train_segment_classifier.py --device auto --output-dir runs/vector-seg

# 4. end-to-end faces vs the same instance-matching harness + scale invariance
python evaluate_vector_rooms.py --checkpoint runs/vector-seg/best.pt --split val --scale-check

# 5. learned gap bridging (Head B), then re-evaluate with --bridger
python train_gap_bridger.py --encoder runs/vector-seg/best.pt --output-dir runs/vector-bridge
python evaluate_vector_rooms.py --checkpoint runs/vector-seg/best.pt --bridger runs/vector-bridge/best.pt --split val

# 6. room types (Head C, kp+uci labels only), then clinical-coarse evaluation
python train_room_type_head.py --encoder runs/vector-seg/best.pt --output-dir runs/vector-type
python evaluate_vector_rooms.py --checkpoint runs/vector-seg/best.pt \
  --bridger runs/vector-bridge/best.pt --type-head runs/vector-type/best.pt \
  --taxonomy clinical-coarse --split val
```

Follow-up (not wired yet): ONNX export of the encoder + heads for onnxruntime-web
(the kNN graph build and polygonization stay in TypeScript at runtime; the demo's
`pdfVectorExtractor` already produces the exact segments the dumps contain), with
the raster model kept as the fallback for scanned PDFs.
