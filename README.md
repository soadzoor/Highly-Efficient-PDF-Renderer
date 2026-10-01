# Highly Efficient PDF Renderer (HEPR)

GPU rendering for detailed floorplans, technical drawings, and entire books — in a standalone viewer or your three.js scene.

HEPR brings PDF vector content, text, and embedded images to the GPU. WebGL and WebGPU backends, adaptive level of detail, and a reusable `.hep` document format help keep detailed documents practical to explore.

**[Live demo](https://soadzoor.github.io/Highly-Efficient-PDF-Renderer/)** · **[Examples](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/examples.md)** · **[Manual](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/manual.md)** · **[API](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/api.md)** · **[Documentation](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/README.md)**

## Try it

Open the [standalone viewer](https://soadzoor.github.io/Highly-Efficient-PDF-Renderer/) or the [three.js demo](https://soadzoor.github.io/Highly-Efficient-PDF-Renderer/three-example.html). Choose a bundled example or drop in a PDF or HEP file, then pan, zoom, search, and select text. Both demos offer WebGL and WebGPU modes.

## Features

- **GPU vector rendering:** strokes, fills, and text stay sharp as you zoom; embedded images and composited PDF content are supported too.
- **Adaptive detail:** vector and text LOD reduce work when detail is too small to see.
- **Three.js integration:** add a `THREE.Group` to your scene and use your camera and controls.
- **Multiple pages:** load a whole PDF or selected pages, arranged in a grid.
- **Search and selection:** find text, highlight matches, and copy selections on desktop and touch devices.
- **Drawing selection:** select drawing elements, inspect their geometry and layer membership, and temporarily recolor vectors.
- **PDF layers:** toggle optional content in the main viewer, inspect layer dependencies when picking geometry, or use the shared library APIs.
- **Reusable documents:** export `.hep` files with geometry, images, and a searchable text index to skip PDF parsing on subsequent loads.

## See it in action

### Toggle PDF layers

Show or hide individual layers (PDF OCG) to focus on the parts of a drawing you need.

![Toggling layer visibility in a PDF drawing](demo/layers.webp)

### Zoom into every detail

Vector graphics stay vector. Zoom deep into a detailed floorplan while lines and curves stay sharp and navigation stays smooth.

![Zooming into a vector floorplan while preserving sharp detail](demo/floorplan.webp)

### Explore whole books

Load an entire book, then find, select, and copy text with crisp rendering and smooth navigation. Here, HEPR handles *War and Peace*.

![Navigating War and Peace and finding and selecting text](demo/war-and-peace.webp)

## Quick start

Install the browser package alongside three.js:

```bash
npm install @soadzoor/hepr three
```

For browser apps built with Vite, use `@soadzoor/hepr/bundler` throughout your
application and add these settings to your existing Vite configuration:

```js
import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: { exclude: ["@soadzoor/hepr/bundler"] },
  worker: { format: "es" }
});
```

No HEPR plugin or manual asset copying is required. See
[package entry points](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/api.md#package-entry-points)
for other bundlers, prebuilt assets, and Node usage.

Serve a PDF at `/document.pdf` and add this to your entry module:

```js
import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { pdfObjectGenerator } from "@soadzoor/hepr/bundler";

const width = 800;
const height = 600;
const aspect = width / height;
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 100);
camera.position.z = 10;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(width, height);
document.body.appendChild(renderer.domElement);

const controls = new MapControls(camera, renderer.domElement);
controls.enableRotate = false;
controls.screenSpacePanning = true;
controls.update();

const pdf = await pdfObjectGenerator("/document.pdf");

// HEPR centers the document at the origin. Fit its longest side into the view.
const bounds = pdf.sceneData.pageBounds;
const size = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1);
pdf.scale.setScalar(1.8 / size);
scene.add(pdf);

renderer.setAnimationLoop(() => renderer.render(scene, camera));
```

Drag to pan and scroll or pinch to zoom. The
[responsive viewer example](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/examples.md#responsive-threejs-viewer)
adds window resizing and complete viewer cleanup.

Individual pages also expose normal Three.js transforms on both backends:

```js
const page = await pdf.getPage(0); // Zero-based displayed page index
page.position.z = 20;
page.rotation.y = Math.PI / 6;
page.scale.setScalar(0.8);
// Also available: getPages(), setPagePosition(index, x, y, z),
// and setPageTransform(index, matrix4).
```

Page views preserve the initial layout and use the page center as their pivot.
Compatible pages keep cross-page batching while moving independently, using a
shared GPU transform table on both Three.js backends. Paint-order constraints
automatically use separate page rendering when needed. See the
[page API](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/api.md#heprthreepdfobject)
for matrix, ownership, coordinate and HEP compatibility details.

The same loader accepts `.hep` files, `File`/`Blob` objects, bytes, and base64 data. Select PDF pages with `{ pages: "1-3, 5" }`; report loading progress with `{ onProgress: ({ stage, value }) => console.log(stage, value) }`.

When removing a document, call `pdf.removeFromParent()` and `pdf.dispose()`. When closing the viewer, also stop its animation loop and dispose its controls and renderer. See the [examples](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/examples.md) to add search, text selection, and drawing selection.

## Render your own polylines

Use `buildStrokeScene` and `createThreePdfObject` to render your own polylines
with HEPR's stroke batching and camera-driven LOD, without a PDF. See the
[polyline example](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/examples.md#render-your-own-polylines)
for geometry, placement, and cleanup.

## Save a HEP file

Build a reusable document from a PDF, or export the scene you already loaded:

```js
import { buildHep } from "@soadzoor/hepr/bundler";

const hepBlob = await buildHep("/document.pdf");
// Or: const hepBlob = await buildHep(pdf.sceneData);
// Save or upload the Blob with a .hep filename.
```

HEP skips PDF extraction; loading still prepares LOD and GPU resources. See the [manual](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/manual.md#hep-files) for browser export and Node conversion.

HEP uses scene schema **v9 only**. Regenerate older archives from the original
PDFs. Exports retain hidden content and original layer defaults; temporary layer
visibility and primitive colors remain per-view settings.

## Learn more

| Page | What you will find |
| --- | --- |
| [Examples](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/examples.md) | Live demos and integration recipes. |
| [Manual](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/manual.md) | Loading, rendering options, interaction, and HEP conversion. |
| [API reference](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/api.md) | Public functions, options, and object methods. |
| [Documentation](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/README.md) | How rendering works and links to technical references. |
| [Development](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/development.md) | Local setup, builds, tests, and example assets. |

## Requirements and scope

Use a modern browser with WebGL2, or WebGPU support for the WebGPU backend. The browser package uses browser canvas APIs; Node PDF conversion may also need the optional `@napi-rs/canvas` dependency.

HEPR prepares all selected pages before returning a document. It prefers usable output over rejecting a PDF: supported content stays vector-based, while some pages use bounded raster fallback or diagnosed visual approximations. Rasterized pages lose vector sharpness and drawing geometry; searchable text is retained where available. Encrypted PDFs that open without a password are decrypted; PDFs that require a password, and features unsupported by both compilation and rendering, still produce errors. See the [manual](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/manual.md) for platform and format details.

## Contributing

Bug reports and focused contributions are welcome. For rendering issues, include a reproducible PDF when possible, the affected page, browser, and backend in an [issue](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/issues). Start with the [development guide](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/development.md) for local checks.

## License and credits

[MIT](LICENSE). Inspired by [Will Dobbie's GPU text rendering work](https://wdobbie.com/) and Unreal Engine's Nanite. Third-party attributions are listed in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
