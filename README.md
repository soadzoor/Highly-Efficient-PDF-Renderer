# Highly Efficient PDF Renderer (HEPR)

GPU-first PDF renderer for large technical documents, floorplans, and mixed vector/raster PDFs.

HEPR is built around analytic vector rendering. Strokes, fills, and text are extracted from PDF operator streams and rendered on the GPU instead of being flattened into a giant page bitmap. Embedded PDF image layers are still supported, but vector floorplan geometry stays vector geometry.

The project also exposes an [npm package API (`@soadzoor/hepr`)](https://www.npmjs.com/package/@soadzoor/hepr) with a native renderer and a three.js wrapper.

## Demos

- "Native" WebGL and WebGPU demo: <https://soadzoor.github.io/Highly-Efficient-PDF-Renderer>
- Three.js demo: <https://soadzoor.github.io/Highly-Efficient-PDF-Renderer/three-example.html>

![Demo GIF](./demo/demo.gif)

- [`demo/demo.gif`](demo/demo.gif)
- <https://youtu.be/HDMntIG-1e4>

## Credits

HEPR was mostly inspired by the PDF GPU-text rendering work shared at <https://wdobbie.com/>, and Unreal Engine's Nanite Technology. Thanks for publishing the ideas and experiments that helped shape this project.

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
- `"off"` disables Vector LOD and uses exact vector strokes.
- `"force"` builds and uses Vector LOD even below the usual large-scene threshold.

## Renderer Modes

### Native Demo

The native demo renders directly into the app canvas through `WebGlFloorplanRenderer` or `WebGpuFloorplanRenderer`.

Controls include:

- backend switcher: WebGL / WebGPU
- Vector LOD mode: Auto / Off / Force
- page background color/opacity
- vector override color/opacity
- collapsible diagnostics panel

### Three.js Demo

The three.js demo creates a real `THREE.Group` with camera-driven material layers. It supports perspective camera pan, zoom, and rotation without switching back to a raster-hosted page texture.

Controls include:

- backend switcher: WebGL / WebGPU
- Vector LOD mode: Auto / Off / Force
- optional touch rotation on touch-capable devices
- page background color/opacity
- vector override color/opacity
- collapsible diagnostics panel

Backend switches reuse the loaded scene and preserve the camera where possible.

## npm Package API ([`@soadzoor/hepr`](https://www.npmjs.com/package/@soadzoor/hepr))

Use `pdfObjectGenerator` to load a PDF or parsed ZIP and create a `THREE.Group`.
The three.js wrapper is camera-driven by default, so the PDF follows your
existing `THREE.Camera` and controls.
The generated TypeScript declaration files include JSDoc comments for the main
options, return types, and runtime methods.

```ts
import * as THREE from "three";
import { pdfObjectGenerator } from "@soadzoor/hepr";

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 2000);
const renderer = new THREE.WebGLRenderer({ canvas });

const pdfObject = await pdfObjectGenerator(
  source,
  {
    onProgress: (progress) => {
      console.log(progress.stage, progress.value);
    }
  },
  "webgl" // "webgl" (default) | "webgpu"
);

scene.add(pdfObject);

function frame(): void {
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

frame();
```

A minimal typed setup can look like this:

```ts
import { pdfObjectGenerator } from "@soadzoor/hepr";
import type { HeprThreePdfObject, PDFLoadProgress } from "@soadzoor/hepr";

const dublinPdfUrl = "/examples/pdfs/dublin.pdf";

const pdf: HeprThreePdfObject = await pdfObjectGenerator(dublinPdfUrl, {
  onProgress: (progress: PDFLoadProgress) => {
    console.log(`${progress.stage}: ${progress.value}`);
  }
});

const bounds = pdf.sceneData.pageBounds;
const width = bounds.maxX - bounds.minX;
const height = bounds.maxY - bounds.minY;
const maxSize = Math.max(width, height);

pdf.scale.set(1 / maxSize, 1 / maxSize, 1);
scene.add(pdf);
```

Supported `source` inputs:

- `File` / `Blob`
- `Uint8Array` / `ArrayBuffer`
- `string` path or URL to `.pdf` / `.zip`
- base64 payload string (`PDF` or `ZIP`)
- base64 data URL (`data:application/pdf;base64,...`)

Useful object APIs:

- `pdfObject.getViewState()`
- `pdfObject.setViewState(...)`
- `pdfObject.setVectorLodMode("auto" | "off" | "force")`
- `pdfObject.getVectorStrokeLodStats()`
- `pdfObject.setPageBackgroundColor(...)`
- `pdfObject.setVectorColorOverride(...)`
- `pdfObject.fitToBounds()` for the internal fallback view state
- `pdfObject.attachControls(renderer.domElement)` for HEPR's fallback 2D controls
- `pdfObject.dispose()`

Advanced render pipelines can call
`pdfObject.prepareFrameForThreeRenderer(renderer, camera)` manually before
`renderer.render(scene, camera)`, but normal three.js render loops do not need
it because the PDF object synchronizes itself through `onBeforeRender`.

Package exports:

- `@soadzoor/hepr`
- `@soadzoor/hepr/three`

### Room Detection

`detectRooms` finds wall-bounded rooms on architectural floorplan pages and
returns one closed polygon per room (scene coordinates), with the room-label
text attached when the scene was parsed with text extraction enabled:

```ts
import { detectRooms, loadPdfSceneFromSource } from "@soadzoor/hepr";

const loaded = await loadPdfSceneFromSource(source, { extractText: true });
const { rooms, failedSeeds } = detectRooms(loaded.scene);

for (const room of rooms) {
  console.log(room.labelText, room.area, room.polygon); // polygon: [x0, y0, x1, y1, ...]
}
```

The detector classifies thick/long strokes as wall candidates, bridges door
openings with virtual closures, rasterizes the walls into an occupancy bitmap,
flood-fills from each text label (plus a coarse grid for unlabeled rooms),
traces the region contours, and snaps the polygons back onto the inner wall
faces. All thresholds are adaptive and can be overridden through
`RoomDetectionOptions`; pass `collectDebugInfo: true` to inspect wall
candidates, closures, raw contours, and per-page statistics.

The native demo exposes this via a **Detect Rooms** button with overlay modes
(rooms / walls / closures / contours), and
`scripts/room-detect-debug.mjs --all` runs the detector headlessly against the
example floorplans, writing annotated PNG snapshots to `.debug/`.

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

Create a local install tarball:

```bash
npm run pack:local
```

Run the npm publish dry run:

```bash
npm run publish:dry-run
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
- Most of this repo was "vibe-coded" with Codex. It would've taken a lot more time (~forever) without AI tools to get to this stage for me, even though I'm a professional graphical programmer. The know-hows, and technical details about PDFs are way out of my expertise.
