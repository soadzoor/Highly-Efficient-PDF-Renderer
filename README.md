# Highly Efficient PDF Renderer (HEPR)

GPU-first PDF renderer for large technical documents, floorplans, and mixed vector/raster PDFs.

HEPR is built around analytic vector rendering. Strokes, fills, and text are extracted from PDF operator streams and rendered on the GPU instead of being flattened into a giant page bitmap. Embedded PDF image layers are still supported, but vector floorplan geometry stays vector geometry.

The project also exposes an npm package API (`hepr`) with a native renderer and a three.js wrapper.

## Demos

- Native demo: <https://soadzoor.github.io/Highly-Efficient-PDF-Renderer>
- Local native demo: `index.html`
- Local three.js demo: `three-example.html`

![Demo GIF](./demo/demo.gif)

- [`demo/demo.gif`](demo/demo.gif)
- <https://youtu.be/HDMntIG-1e4>

## Current Highlights

- WebGL and WebGPU renderer backends.
- Native canvas renderer plus a three.js `THREE.Group` wrapper.
- Three.js material-layer mode for strokes, fills, text, and raster layers, including WebGPU-compatible material implementations.
- Nanite-inspired Vector LOD for very large vector stroke sets.
- Multi-page PDF extraction and grid composition.
- Stroked paths, filled paths, vector text, and embedded raster image layers.
- Parsed-data ZIP export/import to skip repeated PDF extraction.
- Runtime diagnostics for FPS, draw counts, Vector LOD state, parse/upload timing, texture usage, and culling stats.

## Nanite-Inspired Vector LOD

The Vector LOD path borrows the useful idea from Nanite-style rendering without importing `three-nanite` or treating PDF strokes as triangle meshes.

The core idea is:

1. Keep the exact source stroke level.
2. Build simplified analytic stroke levels during load/preprocessing.
3. Bucket those levels into a shared tile hierarchy.
4. At runtime, choose per-tile LOD levels from camera scale, visible tile count, local screen error, and local segment density.
5. Render the selected analytic stroke IDs through the existing GPU material path.

Important details:

- Vector LOD is not a raster fallback.
- It targets stroke-heavy floorplan PDFs first.
- It uses predefined simplification tolerances from `VECTOR_STROKE_LOD_TOLERANCES`.
- It preserves exact geometry when the screen error says exact is needed.
- It uses smarter tile generation so dense furniture/detail clusters and sparse architectural lines are not forced into one uniform decision.
- It applies perspective/projected-area budget weighting only when a three.js camera actually creates meaningful near/far scale differences.
- `VECTOR_STROKE_LOD_TARGET_VISIBLE_SEGMENTS` is a runtime budget target, not a hard cap. The final draw count depends on tile distribution and available simplification levels.

The default mode is `vectorLod: "auto"`:

- `"auto"` enables Vector LOD for large vector-heavy scenes.
- `"off"` disables Vector LOD and uses exact vector strokes, with pan optimization available in the demos.
- `"force"` builds and uses Vector LOD even below the usual large-scene threshold.

## Renderer Modes

### Native Demo

The native demo renders directly into the app canvas through `WebGlFloorplanRenderer` or `WebGpuFloorplanRenderer`.

Controls include:

- backend switcher: WebGL / WebGPU
- Vector LOD mode: Auto / Off / Force
- pan optimization toggle when Vector LOD is off
- page background color/opacity
- vector override color/opacity
- collapsible diagnostics panel

### Three.js Demo

The three.js demo creates a real `THREE.Group` with camera-driven material layers. It supports perspective camera pan, zoom, and rotation without switching back to a raster-hosted page texture.

Controls include:

- backend switcher: WebGL / WebGPU
- Vector LOD mode: Auto / Off / Force
- pan optimization toggle when Vector LOD is off
- optional touch rotation on touch-capable devices
- page background color/opacity
- vector override color/opacity
- collapsible diagnostics panel

Backend switches reuse the loaded scene and preserve the camera where possible.

## npm Package API (`hepr`)

Use `pdfObjectGenerator` to load a PDF or parsed ZIP and create a `THREE.Group`.

```ts
import * as THREE from "three";
import { pdfObjectGenerator } from "hepr";

const pdfObject = await pdfObjectGenerator(
  source,
  {
    segmentMerge: true,
    invisibleCull: true,
    vectorLod: "auto",
    threeCameraDriven: true,
    pageBackground: "#ffffff",
    pageBackgroundOpacity: 1,
    vectorOverrideColor: "#000000",
    vectorOverrideOpacity: 0,
    onProgress: (progress) => {
      console.log(progress.stage, progress.value);
    }
  },
  "webgl" // "webgl" (default) | "webgpu"
);

const scene = new THREE.Scene();
scene.add(pdfObject);

pdfObject.fitToBounds();
```

Supported `source` inputs:

- `File` / `Blob`
- `Uint8Array` / `ArrayBuffer`
- `string` path or URL to `.pdf` / `.zip`
- base64 payload string (`PDF` or `ZIP`)
- base64 data URL (`data:application/pdf;base64,...`)

Useful object APIs:

- `pdfObject.attachControls(renderer.domElement)`
- `pdfObject.fitToBounds()`
- `pdfObject.getViewState()`
- `pdfObject.setViewState(...)`
- `pdfObject.setVectorLodMode("auto" | "off" | "force")`
- `pdfObject.getVectorStrokeLodStats()`
- `pdfObject.setPageBackgroundColor(...)`
- `pdfObject.setVectorColorOverride(...)`
- `pdfObject.dispose()`

Package exports:

- `hepr`
- `hepr/three`

## Architecture

### 1. PDF Extraction

`src/pdfVectorExtractor.ts` uses `pdfjs-dist` operator streams to build structured scene data:

- stroke primitives and style metadata
- fill path primitives
- text instances and glyph primitives
- raster image layers and placement transforms
- page rectangles/bounds for multi-page composition

Parse-time optimizations include segment merging, invisible/contained stroke culling, duplicate removal, glyph deduplication, and multi-page layout composition.

### 2. Scene Loading

`src/pdfObjectGenerator.ts` and `src/main.ts` handle:

- PDF or parsed ZIP source detection
- page extraction
- page-grid composition
- Vector LOD prebuild with progress callbacks
- renderer upload

Vector LOD building yields back to the browser periodically so loading indicators can update during large PDF loads.

### 3. Native GPU Rendering

Native renderers:

- `src/webGlFloorplanRenderer.ts`
- `src/webGpuFloorplanRenderer.ts`

Both renderers use GPU buffers/textures for scene data and analytic shader evaluation for vector content. They share the same Vector LOD runtime in `src/vectorStrokeLodCore.ts`.

### 4. Three.js Material Rendering

The three.js wrapper is implemented in `src/threePdfObject.ts`.

Material layers:

- `src/threeMaterialStrokeLayer.ts`
- `src/threeMaterialFillLayer.ts`
- `src/threeMaterialTextLayer.ts`
- `src/threeMaterialRasterLayer.ts`
- `src/vectorStrokeLod.ts`

WebGPU-compatible three.js materials live in:

- `src/threeWebGpuStrokeMaterial.ts`
- `src/threeWebGpuFillMaterial.ts`
- `src/threeWebGpuTextMaterial.ts`
- `src/threeWebGpuRasterMaterial.ts`

## Parsed Data ZIP Format

The exported ZIP contains parsed scene data:

- `manifest.json`
- vector texture payloads
- optional raster layers
- optional embedded source PDF fallback

Parsed ZIPs are designed to skip expensive PDF extraction. The runtime Vector LOD hierarchy is currently rebuilt from parsed vector data at load time instead of being persisted, because storing every LOD level can make ZIPs much larger than the original parsed scene.

Open the native demo with `?bulkZip=1` or `?downloadAllZips=1` to reveal the `Download All Example ZIPs` button.

## Example Assets

Folder layout:

- `public/examples/pdfs/`
- `public/examples/zips/`
- `public/examples/manifest.json`

Regenerate the example manifest with:

```bash
npm run generate-manifest
```

## Development

Install:

```bash
npm install
```

Run dev server:

```bash
npm run dev
```

Build app:

```bash
npm run build
```

Build library artifacts:

```bash
npm run build:lib
```

Build app and library:

```bash
npm run build:all
```

Preview production build:

```bash
npm run preview
```

## Notes

- WebGPU requires browser and GPU support.
- Three.js WebGPU support is implemented through Three's WebGPU renderer/material path, not by mixing a WebGPU-rendered canvas texture into a WebGL scene.
- Embedded PDF image layers remain raster images by definition; the "no raster fallback" rule applies to vector floorplan geometry.
- Parsed ZIPs improve load time by skipping PDF extraction, but large stroke-heavy scenes may still spend time building Vector LOD.
