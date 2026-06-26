# PDF-TSV Room Detection

This workspace trains and exports the room detector used by the browser ONNX demo. The current model is trained from local PDF/TSV room geometry and room type annotations.

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
```

Run commands below from the repository root unless noted otherwise.

## Prepare PDF-TSV Data

Put local paired `*.pdf` and `*.tsv` files in `pdf-tsv/`. Files are paired by filename stem. The raw `pdf-tsv/` directory and generated `data/` cache are ignored by Git.

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

The preparer reads `geometryData`, `roomType`, and `roomNumber`; it ignores `boundaryID` and `boundaryType`. It renders the first PDF page, applies the rotation-aware PDF coordinate transform, rasterizes class masks, and writes cached images, masks, metadata, and debug overlays.

QC overlays are written under:

```text
data/pdf-tsv-roomtypes-sep3-v1/debug/
```

Check the overlays before training. Green regions represent room interiors and dark separator pixels represent room boundaries. Warnings such as `empty_mask`, `tiny_geometry`, or `huge_geometry` usually mean a PDF/TSV alignment issue should be fixed first.

## Train

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
