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
- Browser-style find-in-text: full-document search over the extracted text with GPU-drawn match highlights, exposed through the package API.
- Native-viewer text selection: drag to select on desktop (with a `text` cursor over selectable text), long-press with drag handles and a Copy popup on touch devices, blue GPU-drawn highlights, and clipboard copy — optional and exposed through the package API.
- Parsed-data ZIP export/import to skip repeated PDF extraction, with delta/varint-compressed geometry and a searchable text index (exported ZIPs are typically smaller than the source PDFs).
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
- find-in-text search (also on `Ctrl`/`Cmd+F`) with next/prev, match counter, and case-sensitivity toggle
- text selection on/off toggle: drag over text with the primary button (double-click selects a word, `Ctrl`/`Cmd+C` copies); long-press on touch
- page background color/opacity
- vector override color/opacity
- collapsible diagnostics panel

### Three.js Demo

The three.js demo creates a real `THREE.Group` with camera-driven material layers. It supports perspective camera pan, zoom, and rotation without switching back to a raster-hosted page texture.

Controls include:

- backend switcher: WebGL / WebGPU
- Vector LOD mode: Auto / Off / Force
- find-in-text search with next/prev, match counter, case-sensitivity toggle, and camera fly-to
- text selection on/off toggle: drag over text with the primary button (double-click selects a word, `Ctrl`/`Cmd+C` copies); long-press on touch
- optional touch rotation on touch-capable devices
- page background color/opacity
- vector override color/opacity
- collapsible diagnostics panel

Backend switches reload the current source through `pdfObjectGenerator` and
preserve the camera where possible.

## npm Package API ([`@soadzoor/hepr`](https://www.npmjs.com/package/@soadzoor/hepr))

Use `pdfObjectGenerator`, the package's single PDF-object construction entry
point, to load a PDF or parsed ZIP and create a `THREE.Group`. The three.js
wrapper is camera-driven by default, so the PDF follows your existing
`THREE.Camera` and controls.
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

Build a parsed-data ZIP directly from any supported PDF input. The result is
an `application/zip` `Blob` that can be downloaded, uploaded, or stored:

```ts
import { buildParsedDataZip } from "@soadzoor/hepr";

// URL, File, Blob, Uint8Array, ArrayBuffer, base64, or data URL
const controller = new AbortController();
const zipBlob = await buildParsedDataZip(pdfSource, {
  // Default: store each raster as the smaller of WebP/PNG, with RGBA fallback.
  encodeRasterImages: true,
  signal: controller.signal,
  onProgress: ({ value, stage }) => {
    console.log(`${(value * 100).toFixed(1)}%`, stage);
  }
});
```

If the PDF is already loaded, pass its parsed scene to avoid parsing it again:

```ts
const zipBlob = await buildParsedDataZip(pdfObject.sceneData, {
  sourceLabel: pdfObject.sourceLabel,
  // Needed only if the scene has PDF image operations but no raster layers.
  sourcePdf: originalPdfSource,
  // If pages were selected, use the same selection for raster fallback.
  sourcePdfPages: "3-5"
});
```

Select pages with Chrome-style, one-based ASCII print syntax:

```ts
// Only PDF page 2.
const page2 = await pdfObjectGenerator(source, {
  pages: "2"
});

// An inclusive range.
const pages2To5 = await pdfObjectGenerator(source, {
  pages: "2-5"
});

// Ranges and individual pages can be combined.
const selectedPages = await pdfObjectGenerator(source, {
  pages: "1-3, 5, 8, 11-13"
});
```

Ranges are inclusive. Whitespace is allowed, overlaps and duplicates are
ignored, and selected pages are composed in ascending document order. Open
ranges are supported too: `"5-"` means page 5 through the end, while `"-3"`
means the first three pages. Omitting `pages` or passing a blank string selects
every page. Page selection applies to PDF sources; parsed-data ZIPs already
contain one composed scene and currently ignore this option.

Page indexes returned by scene search/selection APIs are zero-based positions
within the normalized composed subset. Page-scoped progress events expose both
the composed `pageIndex` / `pageCount` and the original PDF's
`sourcePageIndex` / `sourcePageCount`.

Useful object APIs:

- `pdfObject.getViewState()`
- `pdfObject.setViewState(...)`
- `pdfObject.setVectorLodMode("auto" | "off" | "force")`
- `pdfObject.getVectorStrokeLodStats()`
- `pdfObject.setPageBackgroundColor(...)`
- `pdfObject.setVectorColorOverride(...)`
- `pdfObject.fitToBounds()` for the internal fallback view state
- `pdfObject.attachControls(renderer.domElement)` for HEPR's fallback 2D controls
- `pdfObject.hasSearchableText`, `pdfObject.searchText(...)`, `pdfObject.setSearchHighlights(...)` (see below)
- `pdfObject.clientToScenePoint(...)`, `pdfObject.sceneToClientPoint(...)`, `pdfObject.setTextSelectionHighlights(...)` (see "Text Selection" below)
- `pdfObject.dispose()`

### Find in Text

`HeprThreePdfObject` exposes everything needed for a browser-style `Ctrl+F`
feature. Matching is case-insensitive by default, and whitespace in the query
matches across line breaks and word gaps, so multi-word phrases work.

```ts
import type { HeprTextSearchMatch } from "@soadzoor/hepr";

if (pdfObject.hasSearchableText) {
  // Matches come back in page/reading order.
  const matches: HeprTextSearchMatch[] = pdfObject.searchText("kitchen 12", {
    caseSensitive: false, // default
    maxMatches: 5000 // default
  });

  // Show browser-find style highlights (semi-transparent fill + solid
  // outline). They are plain three.js meshes parented to the PDF object, so
  // they stay in sync with your camera automatically. The match at
  // `currentIndex` is emphasized.
  pdfObject.setSearchHighlights(matches, { currentIndex: 0 });

  // Frame your own camera on the current match. `localBounds` is in the PDF
  // object's local space (the space of the THREE.Group's children);
  // `bounds` is the same union in PDF scene coordinates. Wrapped matches also
  // expose tight per-line `localHighlightBounds` / `highlightBounds` arrays.
  const target = matches[0].localBounds;
  const centerX = (target.minX + target.maxX) / 2;
  const centerY = (target.minY + target.maxY) / 2;
  // ...point your camera/controls at (centerX, centerY) on the PDF plane...

  // Clear highlights when the search UI closes.
  pdfObject.setSearchHighlights(null);
}
```

For next/prev cycling, keep the match array plus a current index in your app
state and call `setSearchHighlights(matches, { currentIndex })` again — the
highlights update in place. See `src/three-example.ts` for a complete working
implementation (input field, match counter, case toggle, and camera fly-to).

Search works on scenes loaded from PDFs and from parsed-data ZIPs (the ZIP
stores a compact text index alongside the geometry).

For custom pipelines that do not use the three.js wrapper, the same search
core is available directly:

```ts
import { createSceneTextSearcher } from "@soadzoor/hepr";

const searcher = createSceneTextSearcher(pdfObject.sceneData);
const matches = searcher.search("room 101", { maxMatches: 100 });
// matches[i].bounds frames the whole hit. For drawing, use
// matches[i].highlightBounds ?? [matches[i].bounds] (tight wrap-aware rects).
```

The native renderers (`WebGlFloorplanRenderer` / `WebGpuFloorplanRenderer`)
also accept `setSearchHighlights({ rects, count, currentIndex, currentCount })`.
Here `count` is the rectangle count; `currentIndex` and optional `currentCount`
identify a consecutive rectangle range for the active logical match
(`currentCount` defaults to `1`). The renderers draw the rectangles as part of
every frame with the live camera transform, so highlights never lag behind
pans or zooms.

Advanced render pipelines can call
`pdfObject.prepareFrameForThreeRenderer(renderer, camera)` manually before
`renderer.render(scene, camera)`, but normal three.js render loops do not need
it because the PDF object synchronizes itself through `onBeforeRender`.

### Text Selection

`createTextSelectionController` adds native-viewer style text selection on top
of any HEPR-rendered canvas. It is fully optional — nothing is selectable
unless you create the controller.

What it does out of the box:

- **Desktop:** the cursor turns into a `text` caret over selectable text, and a
  primary-button drag that starts on text selects instead of panning (drags on
  empty space keep panning as usual). Double-click selects a word, a click on
  empty space clears the selection, and `Ctrl`/`Cmd+C` copies it. Right-clicking
  the selection opens a custom context menu with a **Copy** action (the
  browser's native menu cannot offer "Copy" for canvas-rendered text).
- **Touch (Android/iOS):** a long-press on text selects the word under the
  finger; dragging on extends the selection word by word. On release, two
  native-style drag handles adjust the range character-precisely and a floating
  **Copy** button writes the text to the clipboard. One-finger pan and
  two-finger pinch are untouched.
- Selection highlights use the search-highlight style in browser-selection
  blue and are GPU-drawn, so they stick to the text through pans and zooms.
- Selections can span multiple pages; pages are joined with `\n` in the copied
  text.

The controller is renderer-agnostic: it talks to your setup through a small
adapter. With the three.js wrapper and `MapControls`/`OrbitControls`:

```ts
import { createTextSelectionController } from "@soadzoor/hepr";

const textSelection = createTextSelectionController({
  getCanvas: () => renderer.domElement,
  enabled: true, // optional feature toggle (default true)
  adapter: {
    getScene: () => pdfObject.sceneData,
    clientToScenePoint: (x, y) =>
      pdfObject.clientToScenePoint(camera, x, y, renderer.domElement),
    sceneToClientPoint: (x, y) =>
      pdfObject.sceneToClientPoint(camera, x, y, renderer.domElement),
    setSelectionHighlights: (rects) => pdfObject.setTextSelectionHighlights(rects),
    // Suspends the camera controls while a touch selection gesture owns the pointer.
    setCameraInteractionEnabled: (enabled) => {
      controls.enabled = enabled;
    }
  },
  onSelectionChange: (range, text) => console.log(text),
  onCopy: (text) => console.log("copied:", text)
});

// In your render loop, after renderer.render(...): keeps the touch handles
// and Copy button glued to the selection while the camera moves.
textSelection.updateOverlay();

// Later:
textSelection.disable(); // or .enable(); construction option `enabled` sets the initial state
textSelection.getSelectedText();
await textSelection.copySelection();
textSelection.dispose();
```

For the native renderers, the adapter maps straight onto `RendererApi` — the
new `clientToScenePoint` / `sceneToClientPoint` coordinate helpers and
`setTextSelectionHighlights(rects)` exist on both `WebGlFloorplanRenderer` and
`WebGpuFloorplanRenderer`. If you use HEPR's built-in 2D controls, pass the
interaction controller's `cancelActiveGesture()` so a long-press can take over
an in-flight pan:

```ts
const textSelection = createTextSelectionController({
  getCanvas: () => canvas,
  adapter: {
    getScene: () => scene,
    clientToScenePoint: (x, y) => renderer.clientToScenePoint?.(x, y) ?? null,
    sceneToClientPoint: (x, y) => renderer.sceneToClientPoint?.(x, y) ?? null,
    setSelectionHighlights: (rects) => renderer.setTextSelectionHighlights?.(rects),
    setCameraInteractionEnabled: (enabled) => {
      if (!enabled) canvasInteractionController.cancelActiveGesture();
    }
  }
});
```

Notes:

- Call `textSelection.refreshHighlights()` after swapping renderer backends
  (highlights live in renderer-owned GPU buffers).
- The controller resets itself automatically when `adapter.getScene()` starts
  returning a different scene (new document loaded).
- Selection works on scenes loaded from PDFs and from parsed-data ZIPs, and
  coexists with search highlights (the current search match stays visible on
  top of a selection).
- Rotated/vertical text falls back to axis-aligned boxes, mirroring search.
- See `src/three-example.ts` and `src/main.ts` for the two complete working
  integrations.

Package exports:

- `@soadzoor/hepr`
- `@soadzoor/hepr/three`

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
- compact stroke/text geometry sections (chained delta + varint columns over the quantized grids)
- a searchable text index (per-page text plus a char-to-glyph-instance map for find-in-text)
- optional raster layers
- optional embedded source PDF fallback

Parsed ZIPs are designed to skip expensive PDF extraction. Thanks to the delta/varint encoding, exported ZIPs are typically smaller than the source PDFs themselves. Format v6 stores each raster layer whole as WebP or PNG, whichever is smaller, and falls back to RGBA8 when image encoding is unavailable. WebP/PNG entries are already compressed and are therefore stored without redundant ZIP compression.

Exports report separate `raster-encode` and `zip-build` progress stages. Pass an `AbortSignal` as `signal` to cancel source fetching/PDF.js parsing, between raster encodes, or while the ZIP stream is being generated. Cancellation inside synchronous extraction work takes effect at the next asynchronous/check boundary. The loader accepts format v6 only; older or experimental format versions must be re-exported.

The Three.js integration keeps only one raster GPU owner active at a time. Its material textures are released before the native-canvas fallback allocates raster textures, and native raster textures remain nonresident while the Three.js material path is active. This avoids the previous persistent duplicate raster allocation across the two renderer paths. The active texture set is still ordinary RGBA8 with mipmaps; this is an ownership fix, not GPU texture compression.

The runtime Vector LOD hierarchy is currently rebuilt from parsed vector data at load time instead of being persisted, because storing every LOD level can make ZIPs much larger than the original parsed scene.

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

The room overlay demo is available at `/room-overlay-demo.html`. After running room
detection, use **Download Detection Debug** to save the browser-side room probability,
separator probability, predicted mask, and detection metadata as a zip. Room detection
uses the PDF's vector wall geometry and text when available; it also discovers sealed,
unlabeled spaces such as shafts. Each returned room includes `hasDoorEvidence`, so callers
can distinguish accessible-room candidates from sealed service spaces without making text
or door annotations a prerequisite for geometry. Returned room cells do not overlap or
contain one another: enclosing “super room” contours are discarded, while unsafe
snapping/offset geometry falls back to the underlying connected-component boundary.
For uniform-pen CAD exports, the detector also tests whether one long-line color cohort
dominates the page (typically the architectural layer). It uses that trace only to replace
an individual jagged outline when the simpler polygon contains exactly one room anchor,
has a bounded area change, is simple, and remains disjoint from every neighboring room.
Density-pruned paired partitions are restored only when a structural cap, validated door
swing, and nearby architectural-scale room numbers on opposite sides agree. Likewise, a
complete equipment-displaced room side is recovered only when the other three contour
sides match an orthogonal paired-wall envelope and the expanded cell remains label-owned,
simple, and non-overlapping. Deep furniture peninsulas are also removed from a labeled
room when their narrow mouth lies on a long, room-extremal paired wall with substantial
support beyond both endpoints; bounded-area, label-retention, and overlap checks still
apply.

Run the synthetic topology regressions with:

```bash
npm run test:rooms
```

For corpus evaluation, `scripts/eval-rooms.mjs --from-pdf` exercises the same live text
extraction path as the demo. Its `--score` option uses the dependency-free
`scripts/score-rooms.mjs` scorer, which treats TSV polygons as incomplete positive labels
and reports unmatched predictions for review instead of automatically calling them false
positives.

Audit saved predictions independently of TSV annotations with:

```bash
npm run audit:rooms -- .eval/my-room-run
```

This command rejects invalid/self-intersecting polygons, duplicates, containment, and
positive-area overlap while allowing rooms to share boundaries.

For an evaluation set that is independent of the noisy TSV geometry, create a deterministic
stratified review manifest and follow [the room gold-set adjudication protocol](docs/room-gold-set.md):

```bash
npm run gold:rooms -- select \
  --score-report .eval/my-room-run/scores-iou50.json \
  --output .eval/room-gold/gold.json \
  --count 12
npm run gold:rooms -- validate .eval/room-gold/gold.json --check-files
```

Detector polygons start as `ambiguous`; reviewers inspect the PDF first, add omissions,
and classify each candidate as `room`, `shaft-service`, `non-room`, or `ambiguous`.

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
- Most of this repo was "vibe-coded" with Codex and Fable. It would've taken a lot more time (~forever) without AI tools to get to this stage for me, even though I'm a professional graphical programmer. The know-hows, and technical details about PDFs are way out of my expertise.
