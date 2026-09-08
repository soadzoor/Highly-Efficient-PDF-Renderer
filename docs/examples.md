# Examples

[Home](../README.md) · **Examples** · [Manual](manual.md) · [API reference](api.md)

Start with a live viewer, then adapt the examples below to your application.

| Viewer | Try it | Source |
| --- | --- | --- |
| Native WebGL / WebGPU | [Open demo](https://soadzoor.github.io/Highly-Efficient-PDF-Renderer/) | [main.ts](../src/main.ts) |
| three.js WebGL / WebGPU | [Open demo](https://soadzoor.github.io/Highly-Efficient-PDF-Renderer/three-example.html) | [three-example.ts](../src/three-example.ts) |

Both viewers support PDF and HEP loading, text search, text selection, and rendering diagnostics. For the optional room overlay workflow, see [room-overlay-demo.ts](../src/room-overlay-demo.ts).

## Responsive three.js viewer

This browser TypeScript module fills the window and adds mouse/touch pan and zoom. Use it in an application with a bundler after installing `@soadzoor/hepr` and `three`. Replace `/drawing.pdf` with a PDF or HEP URL served by your application.

For TypeScript, also install the three.js declarations with `npm install --save-dev @types/three`.

```ts
import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { pdfObjectGenerator } from "@soadzoor/hepr";

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
import { createTextSelectionController } from "@soadzoor/hepr";

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

## Export a HEP file in the browser

Build from an already loaded scene to avoid parsing the PDF again. This example adds a download link; the user chooses when to save it.

```ts
import { buildHep } from "@soadzoor/hepr";

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

For a scene that reports PDF images but has no extracted raster layers, also supply `sourcePdf` and, if pages were selected, `sourcePdfPages` with the same page selection. See the [manual](manual.md) for compression support and Node.js conversion.

## Detect rooms in a vector floorplan

Room detection is optional and loads on first use. It derives room candidates from vector strokes and text labels; results depend on the drawing and should be reviewed.

```ts
import { detectRooms, pdfObjectGenerator } from "@soadzoor/hepr";

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

`pageIndexes` contains zero-based positions in the composed scene. Polygons and areas use scene coordinates and squared scene units, so real-world measurements require a drawing scale. Browser detection requires Web Workers; pass `signal` to cancel it. HEP inputs use their searchable text index for labels. This detector does not require training the separate [ML project](../ml/room-detection/README.md).
