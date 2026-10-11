# Examples

[Home](../README.md) · **Examples** · [Manual](manual.md) · [API reference](api.md)

Start with a live viewer, then adapt the examples below to your application.

| Viewer | Try it | Source |
| --- | --- | --- |
| Native WebGL / WebGPU | [Open demo](https://soadzoor.github.io/Highly-Efficient-PDF-Renderer/) | [main.ts](../src/main.ts) |
| three.js WebGL / WebGPU | [Open demo](https://soadzoor.github.io/Highly-Efficient-PDF-Renderer/three-example.html) | [three-example.ts](../src/three-example.ts) |

Both viewers support PDF and HEP loading, PDF layer controls, text search, text selection, and rendering diagnostics. The [room overlay demo](../room-overlay-demo.html) also includes the shared PDF Layers panel; its room and TSV overlays have separate visibility controls. See [room-overlay-demo.ts](../src/room-overlay-demo.ts) for that workflow.

Multipage PDFs and HEPs open in **Reader**, a continuous vertical column with
scrollbars and a thumbnail sidebar. The toolbar provides page navigation, zoom,
Fit Width, Fit Page, Find, and Settings. Scroll normally to read; use
Ctrl/Cmd+wheel or pinch to zoom. Touch dragging and flicking scroll the document.
Thumbnails open initially on screens at least 800 pixels wide and can be toggled
at any width. Select a thumbnail to jump to its page.

Choose **Grid** for the previous overview, or **Sphere** / **Helix** in the Three
demo. Returning to Reader restores your reading position. Single-page files keep
their previous default and can also use Reader. Reader changes presentation only;
Download HEP retains the document's canonical layout. Advanced settings and
diagnostics remain available under Settings.

## Responsive three.js viewer

This browser TypeScript module fills the window and adds mouse/touch pan and zoom. Use it in an application with a bundler after installing `@soadzoor/hepr` and `three`. Replace `/drawing.pdf` with a PDF or HEP URL served by your application.

For Vite, apply the [quick-start configuration](../README.md#quick-start).
All browser examples use the `@soadzoor/hepr/bundler` entry consistently.

For TypeScript, also install the three.js declarations with `npm install --save-dev @types/three`.

```ts
import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { pdfObjectGenerator } from "@soadzoor/hepr/bundler";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setClearColor(0xe8e8e8);
renderer.domElement.style.display = "block";
document.body.style.margin = "0";
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
camera.position.set(0, 0, 2);

const controls = new MapControls(camera, renderer.domElement);
controls.enableRotate = false;
controls.screenSpacePanning = true;
controls.update();

const pdf = await pdfObjectGenerator("/drawing.pdf", {
  pageBackground: "#ffffff",
  onProgress: ({ stage, value }) => {
    console.log(`${stage}: ${Math.round(value * 100)}%`);
  }
});

// HEPR already centers the PDF in its local XY plane.
// Normalize the longest side to one three.js world unit.
const bounds = pdf.sceneData.pageBounds;
const longestSide = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1);
pdf.scale.set(1 / longestSide, 1 / longestSide, 1);
scene.add(pdf);

function resize(): void {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const aspect = width / height;
  const halfHeight = 0.6 / Math.min(aspect, 1);
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
}

resize();
window.addEventListener("resize", resize);
renderer.setAnimationLoop(() => renderer.render(scene, camera));

// Call when removing this viewer from your application.
export function disposeViewer(): void {
  renderer.setAnimationLoop(null);
  window.removeEventListener("resize", resize);
  controls.dispose();
  scene.remove(pdf);
  pdf.dispose();
  renderer.dispose();
  renderer.domElement.remove();
}
```

The initial camera framing accommodates portrait and landscape windows. HEPR follows the three.js camera automatically; `fitToBounds()` controls its internal fallback view rather than positioning your camera. Keep using your own three.js controls when embedding a PDF in an existing scene.

The snippets below reuse `pdf`, `scene`, `camera`, `renderer`, and `controls` from this viewer where applicable.

## Select pages and report progress

Replace the viewer's load call with this to compose selected PDF pages into a grid:

```ts
const controller = new AbortController();
const pdf = await pdfObjectGenerator("/drawing.pdf", {
  pages: "1-3, 5, 8",
  maxPagesPerRow: 2,
  signal: controller.signal,
  onProgress: ({ stage, value }) => {
    console.log(stage, `${Math.round(value * 100)}%`);
  }
});
```

Call `controller.abort()` from a Cancel button or document-switch handler while the load is pending. Handle the rejected promise at your application's loading boundary; the [manual](manual.md) covers cancellation and disposal. An object already returned still needs `pdf.dispose()`.

Page numbers are one-based; ranges are inclusive. HEP files contain an already composed scene, so `pages` applies only to PDF inputs.

## Find and highlight text

```ts
const matches = pdf.searchText("room 101", { caseSensitive: false });
pdf.setSearchHighlights(matches, { currentIndex: matches.length > 0 ? 0 : -1 });

if (matches.length > 0) {
  const hit = matches[0].localBounds;
  const center = pdf.localToWorld(new THREE.Vector3(
    (hit.minX + hit.maxX) / 2,
    (hit.minY + hit.maxY) / 2,
    0
  ));
  // Pan to the match while preserving the camera direction and zoom.
  camera.position.add(center.clone().sub(controls.target));
  controls.target.copy(center);
  controls.update();
}

// Call when the search is dismissed:
// pdf.setSearchHighlights(null);
```

Search uses the document's extracted text index. Highlights follow the PDF through pan, zoom, and object transforms. Pass the complete matches to `setSearchHighlights` so wrapped phrases get separate rectangles for each line; use `localBounds` to position a three.js camera.

## Select and copy text

Add this after creating the viewer. The controller handles desktop selection, touch long-press, drag handles, and copying.

```ts
import { createTextSelectionController } from "@soadzoor/hepr/bundler";

const selection = createTextSelectionController({
  getCanvas: () => renderer.domElement,
  adapter: {
    getScene: () => pdf.sceneData,
    clientToScenePoint: (x, y) =>
      pdf.clientToScenePoint(camera, x, y, renderer.domElement),
    sceneToClientPoint: (x, y) =>
      pdf.sceneToClientPoint(camera, x, y, renderer.domElement),
    setSelectionHighlights: (rects) => pdf.setTextSelectionHighlights(rects),
    setCameraInteractionEnabled: (enabled) => {
      controls.enabled = enabled;
    }
  }
});

// Replace the viewer's animation callback to keep touch overlays aligned.
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
  selection.updateOverlay();
});

// Add to viewer teardown, before disposing the PDF and camera controls:
// selection.dispose();
```

Use `selection.getSelectedText()` to read the current selection, or `selection.enable()` / `selection.disable()` for a feature toggle. In a viewer that swaps documents, return the active scene from `getScene`; the controller clears the selection when that scene changes. Call `refreshHighlights()` after replacing a renderer backend.

## Pick, inspect, and recolor drawing primitives

This example treats a short primary-pointer tap as a selection and leaves drag
gestures to the host's camera controls. The host owns event listeners; HEPR does
not install them when a PDF is loaded.

```ts
const canvas = renderer.domElement;
let down: { id: number; x: number; y: number; moved: boolean } | null = null;
let query: AbortController | null = null;
const listeners = new AbortController();

canvas.addEventListener("pointerdown", event => {
  query?.abort();
  // Cancel multi-touch selection; the host can continue panning/pinching.
  if (!event.isPrimary || down) { down = null; return; }
  if (event.button === 0) down = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
}, { signal: listeners.signal });

canvas.addEventListener("pointermove", event => {
  if (down?.id === event.pointerId && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) {
    down.moved = true;
  }
}, { signal: listeners.signal });
canvas.addEventListener("pointercancel", () => { down = null; }, { signal: listeners.signal });
canvas.addEventListener("lostpointercapture", () => { down = null; }, { signal: listeners.signal });
canvas.addEventListener("pointerup", async event => {
  const start = down;
  down = null;
  if (!start || start.moved || start.id !== event.pointerId ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
  query?.abort();
  const current = query = new AbortController();
  try {
    const hit = await pdf.pick({
      camera, element: canvas,
      clientX: event.clientX, clientY: event.clientY,
      tolerancePx: 4, signal: current.signal,
    });
    if (current.signal.aborted) return;
    pdf.setSelection(hit ? [hit.primitive] : []);
    if (!hit) return;

    const ref = hit.primitive; // e.g. { kind: "stroke", index: 12345 }
    const primitive = pdf.getPrimitive(ref);
    const layers = new Map(pdf.getLayers().map(layer => [layer.id, layer.name]));
    console.log("Layer dependencies", hit.optionalContent.layerIds.map(id => ({ id, name: layers.get(id) })));
    if (primitive.segmentCount) {
      const segment = primitive.getSegment(0);
      console.log(segment.start, segment.end, segment.control, primitive.getSegmentStyle(0));
    }
    if (ref.kind !== "raster") pdf.setPrimitiveOverrides([ref], { color: "red" });
    // Later: pdf.clearPrimitiveOverrides([ref]);
  } catch (error) {
    if (!current.signal.aborted) console.error(error);
  }
}, { signal: listeners.signal });

// Teardown before disposing/replacing pdf:
// query?.abort();
// listeners.abort();
// pdf.clearPrimitiveInteraction();
```

For hover, debounce or coalesce pointer moves, abort outdated queries, and pass
the latest hit to `pdf.setHover(hit?.primitive ?? null)`. Keep selection separate.
Also invalidate pending results when camera controls move. Saved references must
be paired with the immutable HEP artifact's ID; independently reconverting the
same PDF does not guarantee matching indices. See the [primitive API](api.md#drawing-primitives)
for coordinate precision, clipping, and memory behavior.

### Shared drawing selection controller

The demos share the library's optional interaction controller and one controls
widget. A host can reuse the controller with its own UI instead of implementing
pointer scheduling and cancellation:

```ts
import { createThreePrimitiveInteractionController } from "@soadzoor/hepr/bundler";

const drawingSelection = createThreePrimitiveInteractionController({
  getCanvas: () => renderer.domElement,
  getCamera: () => camera,
  getPdfObject: () => pdf,
  requestRender, // Schedule a frame in your host's rendering loop.
  onPreparationProgress: percentage => {
    progress.hidden = percentage === null || percentage === 100;
    progress.value = percentage ?? 0; // <progress max="100">
  },
  onSelectionChange: primitive => {
    console.log(primitive?.ref, primitive?.bounds);
  },
  onError: console.error,
});

// Enable in response to your Drawing Selection toggle. Suspend any competing
// text-selection gestures first, retaining the user's text-selection preference.
drawingSelection.enable();

function renderFrame() {
  controls.update();
  drawingSelection.onFrame();
  renderer.render(scene, camera);
}

// Optional color controls:
// drawingSelection.setSelectedColor("red");
// drawingSelection.resetSelectedColor();
// drawingSelection.resetAllColors();

// After changing pdf to another document: drawingSelection.sceneChanged();
// After replacing the canvas/object with the same sceneData:
// drawingSelection.rendererChanged();
// On toggle off: drawingSelection.disable(); then restore text-selection mode.
// Before disposing the viewport/PDF object: drawingSelection.dispose();
```

Use the canvas class for cursor feedback, keeping your existing drag cursor:

```css
canvas.drawing-selection-hover:not(:active) { cursor: pointer; }
canvas:active { cursor: grabbing; }
```

## Export a HEP file in the browser

Build from an already loaded scene to avoid parsing the PDF again. This example adds a download link; the user chooses when to save it.

```ts
import { buildHep } from "@soadzoor/hepr/bundler";

const hepBlob = await buildHep(pdf.sceneData, {
  sourceLabel: pdf.sourceLabel,
  onProgress: ({ stage, value }) => {
    console.log(stage, `${Math.round(value * 100)}%`);
  }
});

const downloadUrl = URL.createObjectURL(hepBlob);
const downloadLink = document.createElement("a");
downloadLink.href = downloadUrl;
downloadLink.download = "drawing.hep";
downloadLink.textContent = "Download HEP";
document.body.appendChild(downloadLink);

// Call when removing the download link:
export function disposeDownload(): void {
  downloadLink.remove();
  URL.revokeObjectURL(downloadUrl);
}
```

To convert without creating a viewer, use `await buildHep(pdfSource)` with a PDF URL, `File`, `Blob`, or bytes. Both forms accept `signal` for cancellation. The result is an `application/x-hep` Blob that the regular loader can open.

HEP exports preserve the PDF's original layer defaults and initially hidden content. Current layer toggles and temporary drawing colors are view settings. Current archives use scene schema v9 and include self-contained fallback resources; older archives must be regenerated from their PDFs. See the [manual](manual.md) for compression support and Node.js conversion.

## Render your own polylines

Compile host geometry into a `VectorScene` and render it using HEPR's Three.js
stroke batching and camera-driven LOD, without a PDF. This example assumes you
already have a Three.js scene, camera, and renderer; frame the camera around the
input geometry in your application's units.

```ts
import { buildStrokeScene, createThreePdfObject } from "@soadzoor/hepr/bundler";

const geometry = buildStrokeScene([
  { points: [[0, 0], [100, 0], [100, 60], [0, 60]], closed: true,
    color: "#334155", width: 0.5 },
  { points: new Float32Array([0, 30, 100, 30]), color: "#dc2626", width: 0.25 }
]);
const drawing = await createThreePdfObject(geometry, { vectorLod: "auto" });

// HEPR centers the group. Restore the input XY origin for placement in a BIM scene.
const b = geometry.pageBounds;
drawing.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 0);
scene.add(drawing);
// Your existing renderer.render(scene, camera) drives LOD automatically.
// On removal: drawing.removeFromParent(); drawing.dispose();
```

Coordinates are Y-up and widths use the same units. The builder supports opaque
solid strokes with round caps/joins; the page background is transparent by
default. See the [geometry API](api.md#buildstrokescenepolylines-defaults) for
input validation, defaults, and placement details.

## Detect rooms in a vector floorplan

Room detection is optional and loads on first use. It derives room candidates from vector strokes and text labels; results depend on the drawing and should be reviewed.

```ts
import { detectRooms, pdfObjectGenerator } from "@soadzoor/hepr/bundler";

const floorplan = await pdfObjectGenerator("/floorplan.pdf", { extractText: true });
try {
  const result = await detectRooms(floorplan.sceneData, { pageIndexes: [0] });
  for (const room of result.rooms) {
    console.log(room.labelText, room.area, room.polygon);
  }
} finally {
  floorplan.dispose();
}
```

`pageIndexes` contains zero-based positions in the composed scene. Polygons and areas use scene coordinates and squared scene units, so real-world measurements require a drawing scale. Browser detection requires Web Workers; pass `signal` to cancel it. HEP inputs use their searchable text index for labels. This deterministic detector requires no trained models or machine-learning runtime.
