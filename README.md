# Highly Efficient PDF Renderer (TypeScript)

GPU-first PDF renderer for large technical documents, floorplans, and general mixed-content PDFs.

This repo now also exposes an npm package API (`hepr`) with a native-renderer-backed three.js wrapper.

## Demo
- <https://soadzoor.github.io/Highly-Efficient-PDF-Renderer>
- Local three.js wrapper demo: `three-example.html`

![Demo GIF](./demo/demo.gif)

- [`demo/demo.gif`](demo/demo.gif)
- <https://youtu.be/HDMntIG-1e4>


The project started from vector-texture ideas inspired by:
- <https://wdobbie.com/post/gpu-text-rendering-with-vector-textures/>
- <https://wdobbie.com/post/war-and-peace-and-webgl/>

It has since evolved beyond a floorplan-only proof of concept into a broader PDF renderer with multi-page layout, vector + raster support, parsed-data export/import, and both WebGL and WebGPU backends.

## Current Feature Set

- Input sources:
  - Open local `PDF` or parsed-data `ZIP`
  - Drag and drop `PDF` / `ZIP`
  - Built-in examples loaded from `public/examples/manifest.json`
- Rendering backends:
  - WebGL (default)
  - WebGPU (preview toggle)
- PDF coverage:
  - multi-page extraction
  - pages composed into a grid (max pages per row configurable)
  - stroked paths, filled paths, text, and embedded raster image layers
- Camera and interaction:
  - pointer/mouse drag pan
  - wheel zoom around cursor
  - touch pan + pinch zoom
  - damping + inertia camera behavior
- Runtime options:
  - `Pan optimization`
  - `Segment merge`
  - `Invisible cull`
  - `Curve strokes`
  - `Vector only`
- Export/import:
  - `Download Parsed Data` exports current scene into ZIP
  - ZIP can be reloaded directly (skips fresh PDF vector extraction)
- Diagnostics:
  - FPS + parse/upload timing
  - segment/fill/text counts
  - texture usage and cull stats

## npm Package API (`hepr`)

Use the package API to load a PDF/parsed ZIP and get a `THREE.Group` that is rendered by the native HEPR renderer internally.

```ts
import * as THREE from "three";
import { pdfObjectGenerator } from "hepr";

const source = fileOrPathOrBase64ToPdfOrZip;

const pdfObject = await pdfObjectGenerator(
  source,
  {
    segmentMerge: true,
    invisibleCull: true,
    curveStrokes: true,
    pageBackground: 0xffffff,
    vectorOverrideColor: 0xff0000
  },
  "webgpu" // optional: "webgl" (default) | "webgpu"
);

const scene = new THREE.Scene();
scene.add(pdfObject);

// Optional: attach native HEPR controls (same pointer/wheel/touch logic as core app).
pdfObject.attachControls(renderer.domElement);
```

Supported `source` inputs:
- `File` / `Blob`
- `Uint8Array` / `ArrayBuffer`
- `string` path or URL to `.pdf` / `.zip`
- base64 payload string (`PDF` or `ZIP`)
- base64 data URL (`data:application/pdf;base64,...`)

Notes:
- The wrapper uses the same native core renderer classes (`WebGlFloorplanRenderer` / `WebGpuFloorplanRenderer`) internally.
- For best parity with the core app camera behavior, use an orthographic camera in three.js.
- You can call `pdfObject.fitToBounds()`, `pdfObject.getViewState()`, `pdfObject.setViewState(...)`, and `pdfObject.dispose()`.

## High-Level Architecture

### 1) Extraction (`src/pdfVectorExtractor.ts`)

Uses `pdfjs-dist` operator streams to build scene data:
- stroke primitives and style metadata
- fill path metadata and primitives
- text instances and glyph primitives
- raster layers with placement transforms
- page rectangles/bounds for multi-page composition

### 2) Scene Composition (`src/main.ts`)

- Extracts all requested pages (`extractPdfPageScenes`)
- Composes pages into a grid (`composeVectorScenesInGrid`)
- Applies parse-time optimizations (merge / invisible cull)
- Uploads scene into active renderer backend

### 3) GPU Rendering

Backends:
- `src/webGlFloorplanRenderer.ts`
- `src/webGpuFloorplanRenderer.ts`

Both renderers use texture-driven scene data and camera uniforms (`center + zoom`) to draw vector/raster content with analytic antialiasing and visibility culling.

## Parsed Data ZIP Format

The exported ZIP contains:
- `manifest.json` (scene metadata + texture descriptors)
- vector textures (`textures/*.f32` or channel-major variants)
- optional raster layers (`raster/layer-*.webp|png|rgba`)
- optional source PDF fallback (`source/source.pdf`) when needed

On load, the app reconstructs the scene from ZIP. If raster layers are missing but source PDF is embedded, raster data is restored from that source PDF.

## Example Assets

Folder layout:
- `public/examples/pdfs/`
- `public/examples/zips/`
- `public/examples/manifest.json`

## Getting Started

### Install

```bash
npm install
```

### Run dev

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Build library artifacts

```bash
npm run build:lib
```

### Build app + library

```bash
npm run build:all
```

### Preview production build

```bash
npm run preview
```

### Regenerate example manifest

```bash
npm run examples:generate
```

## Notes

- WebGPU mode is marked preview and depends on browser/GPU support.
- Parsed ZIP loading is generally faster than parsing the original PDF again, especially on large files.
