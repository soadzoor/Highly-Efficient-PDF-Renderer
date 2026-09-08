# Highly Efficient PDF Renderer (HEPR)

GPU rendering for large PDFs, technical drawings, and floorplans — in a standalone viewer or your three.js scene.

HEPR brings PDF vector content, text, and embedded images to the GPU. WebGL and WebGPU backends, adaptive level of detail, and a reusable `.hep` document format help keep detailed documents practical to explore.

**[Live demo](https://soadzoor.github.io/Highly-Efficient-PDF-Renderer/)** · **[Examples](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/examples.md)** · **[Manual](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/manual.md)** · **[API](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/api.md)** · **[Documentation](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/README.md)**

[![HEPR rendering and navigating a detailed PDF floorplan](demo/demo.gif)](https://soadzoor.github.io/Highly-Efficient-PDF-Renderer/)

## Try it

Open the [standalone viewer](https://soadzoor.github.io/Highly-Efficient-PDF-Renderer/) or the [three.js demo](https://soadzoor.github.io/Highly-Efficient-PDF-Renderer/three-example.html). Choose a bundled example or drop in a PDF or HEP file, then pan, zoom, search, and select text. Both demos offer WebGL and WebGPU modes.

## Features

- **GPU vector rendering:** strokes, fills, and text stay sharp as you zoom; embedded images and composited PDF content are supported too.
- **Adaptive detail:** vector and text LOD reduce work when detail is too small to see.
- **Three.js integration:** add a `THREE.Group` to your scene and use your camera and controls.
- **Multiple pages:** load a whole PDF or selected pages, arranged in a grid.
- **Search and selection:** find text, highlight matches, and copy selections on desktop and touch devices.
- **Reusable documents:** export `.hep` files with geometry, images, and a searchable text index to skip PDF parsing on subsequent loads.

## Quick start

Install the browser package alongside three.js:

```bash
npm install @soadzoor/hepr three
```

In a browser app with an ES module bundler, serve a PDF at `/document.pdf` and add this to your entry module:

```js
import * as THREE from "three";
import { pdfObjectGenerator } from "@soadzoor/hepr";

const width = 800;
const height = 600;
const aspect = width / height;
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 100);
camera.position.z = 10;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(width, height);
document.body.appendChild(renderer.domElement);

const pdf = await pdfObjectGenerator("/document.pdf");

// HEPR centers the document at the origin. Fit its longest side into the view.
const bounds = pdf.sceneData.pageBounds;
const size = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1);
pdf.scale.setScalar(1.8 / size);
scene.add(pdf);

renderer.setAnimationLoop(() => renderer.render(scene, camera));
```

The same loader accepts `.hep` files, `File`/`Blob` objects, bytes, and base64 data. Select PDF pages with `{ pages: "1-3, 5" }`; report loading progress with `{ onProgress: ({ stage, value }) => console.log(stage, value) }`.

When removing a document, call `pdf.removeFromParent()` and `pdf.dispose()`. See the [examples](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/examples.md) for camera controls, resizing, search, selection, and cleanup.

## Save a HEP file

Build a reusable document from a PDF, or export the scene you already loaded:

```js
import { buildHep } from "@soadzoor/hepr";

const hepBlob = await buildHep("/document.pdf");
// Or: const hepBlob = await buildHep(pdf.sceneData);
// Save or upload the Blob with a .hep filename.
```

HEP skips PDF extraction; loading still prepares LOD and GPU resources. See the [manual](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/manual.md#hep-files) for browser export and Node conversion.

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

HEPR prepares all selected pages before returning a document. Encrypted PDFs are unsupported, and unsupported visible content produces an error. See the [manual](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/manual.md) for platform and format details.

## Contributing

Bug reports and focused contributions are welcome. For rendering issues, include a reproducible PDF when possible, the affected page, browser, and backend in an [issue](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/issues). Start with the [development guide](https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/blob/main/docs/development.md) for local checks.

## License and credits

[MIT](LICENSE). Inspired by [Will Dobbie's GPU text rendering work](https://wdobbie.com/) and Unreal Engine's Nanite. Third-party attributions are listed in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
