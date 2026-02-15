# Highly Efficient PDF Renderer (TypeScript)

GPU-first PDF renderer for large technical documents, floorplans, and general mixed-content PDFs.

The project started from vector-texture ideas inspired by:
- <https://wdobbie.com/post/gpu-text-rendering-with-vector-textures/>
- <https://wdobbie.com/post/war-and-peace-and-webgl/>

It has since evolved beyond a floorplan-only proof of concept into a broader PDF renderer with multi-page layout, vector + raster support, parsed-data export/import, and both WebGL and WebGPU backends.

## Demo
- <https://soadzoor.github.io/Highly-Efficient-PDF-Renderer>

<video src="./public/demo.mp4" controls muted loop playsinline></video>

- [`public/demo.mp4`](public/demo.mp4)
- <https://youtu.be/HDMntIG-1e4>

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
