# Manual

[Home](../README.md) · [Examples](examples.md) · [API reference](api.md)

HEPR loads PDF or pre-parsed HEP files into a scene of strokes, fills, text,
and raster layers. Use the three.js integration to add that scene to your
application, or explore the standalone canvas viewer in the
[examples](examples.md).

## Installation and platform requirements

```bash
npm install @soadzoor/hepr three
```

The browser integration requires a canvas and a supported GPU backend:

| Backend | Requirements |
| --- | --- |
| WebGL (default) | WebGL 2; use a three.js `WebGLRenderer` for the three.js integration. |
| WebGPU | `navigator.gpu` and an available GPU adapter; use a three.js `WebGPURenderer` for the three.js integration. |

PDF parsing uses workers. Deploy the worker assets emitted by your bundler
alongside your application. Browser image processing uses browser canvas APIs;
the optional Node canvas dependency is unnecessary in a browser.

Compressed HEP exports require `CompressionStream("deflate")`; reading them
requires `DecompressionStream("deflate")`. See [HEP files](#hep-files) for an
uncompressed option and [Node conversion](#node-conversion) for server requirements.

## Loading documents

`pdfObjectGenerator(source, options, backend)` accepts:

- A browser `File` or `Blob`.
- A `Uint8Array` or `ArrayBuffer` containing PDF or HEP bytes.
- A URL or browser-relative URL path.
- A base64 payload or base64 data URL, such as `data:application/pdf;base64,...`.

URL inputs are fetched, so remote servers must permit your application's
cross-origin requests. For a Node filesystem path, use the repository CLI or
read the file into bytes before passing it to `buildHep`.

The loader detects the format from the source. Set `sourceKind: "pdf"` or
`sourceKind: "hep"` when you need to select it explicitly.

```ts
import { pdfObjectGenerator } from "@soadzoor/hepr";

const pdf = await pdfObjectGenerator("/documents/plan.pdf", {
  pages: "1-3, 5",
  maxPagesPerRow: 2,
  onProgress: ({ stage, value }) => {
    console.log(stage, `${Math.round(value * 100)}%`);
  }
});

scene.add(pdf);
```

The returned object is a `THREE.Group`. Position, scale, and rotate it like
other scene objects. Frame your camera using the object's bounds; the
[examples](examples.md) include a complete setup.

PDF extraction uses HEPR's native parser. Encrypted documents, unsupported
visible content, and unrecoverable malformed resources reject the load with
typed PDF errors. Display load errors in your application so users can tell
when a document could not be opened.

### Selecting and arranging pages

The `pages` option uses one-based ASCII page numbers:

| Selection | Pages loaded |
| --- | --- |
| `"2"` | Page 2 |
| `"2-5"` | Pages 2 through 5, inclusive |
| `"1-3, 5, 8"` | Several ranges or individual pages |
| `"5-"` | Page 5 through the end |
| `"-3"` | The first three pages |
| Omitted or blank | Every page |

Whitespace is allowed. Duplicate and overlapping selections are merged, and
pages appear in ascending document order. Invalid selections reject with a
`RangeError`. `maxPagesPerRow` controls the composed grid; omitting it lets HEPR
choose a compact layout.

Page selection and grid options apply when loading a PDF. A HEP file contains
an already-composed scene, so these options do not change its pages or layout.

Search and selection APIs return zero-based page indexes within the composed
subset. Page-scoped progress includes `pageIndex` / `pageCount` for that subset
and `sourcePageIndex` / `sourcePageCount` for the original PDF.

## Rendering and level of detail

The three.js object follows your camera and synchronizes itself during normal
`renderer.render(scene, camera)` calls. Use your existing camera controls for
pan, zoom, and rotation. The object's `fitToBounds()`, `setViewState()`, and
`attachControls()` helpers target its internal fallback view; they do not frame
or control your application's three.js camera.

The standalone viewer renders directly to its canvas through
`WebGlFloorplanRenderer` or `WebGpuFloorplanRenderer`. Both backends support
vector content, raster layers, search highlights, and selection highlights.
See the [API reference](api.md) for integration points.

Vector LOD simplifies stroke geometry according to the current view. It keeps
exact stroke geometry available and chooses detail per tile as you zoom.
The visible-segment budget is a target, so it does not guarantee a fixed draw
count. Embedded PDF images remain raster layers.

| `vectorLod` | Behavior |
| --- | --- |
| `"auto"` (default) | Enables LOD for large stroke scenes. |
| `"off"` | Uses exact strokes. |
| `"force"` | Enables LOD preparation even below the usual size threshold. |

Change the mode with `pdf.setVectorLodMode(...)` and inspect the result with
`pdf.getVectorStrokeLodStats()`.

Text has a separate `textLod` option. The default `"auto"` uses coarse runs for
subpixel text clusters; `"off"` selects exact glyphs. To disable raster glyph
atlas rendering, set `vectorOnly: true`.

HEP avoids PDF extraction, but large scenes still need LOD preparation and GPU
upload. The Vector LOD hierarchy is rebuilt during loading rather than stored
in the HEP file. Use `onProgress` to keep loading feedback visible through
these stages.

## Cancellation and cleanup

Pass an `AbortSignal` when the user can switch documents or close the viewer
before loading finishes:

```ts
const controller = new AbortController();
const pending = pdfObjectGenerator(source, { signal: controller.signal });

// In your document-switch or teardown handler:
controller.abort();

try {
  const pdf = await pending;
  scene.add(pdf);
} catch (error) {
  if (!controller.signal.aborted) throw error;
}
```

Cancellation covers source reads, parser workers, HEP loading, LOD preparation,
and provisional renderer resources. Synchronous work stops at its next
cooperative checkpoint; an image decode already running may finish first.

Once an object has been returned, the application owns it. Remove it from the
scene and dispose its resources when replacing or closing the document:

```ts
pdf.removeFromParent();
pdf.dispose();
```

Dispose any separately created text selection controller as well. Keep the
previous document visible until a replacement loads successfully, and abort
superseded loads to avoid unnecessary work.

## Search and text selection

Use `hasSearchableText` to check for an extracted text index. `searchText()`
returns matches in page and reading order; queries are case-insensitive by
default and can span whitespace and line breaks. `setSearchHighlights()` draws
the results and emphasizes the current match. Your application owns the search
field, next/previous navigation, and camera movement.

Text selection is optional. `createTextSelectionController()` connects your
canvas and coordinate transforms to desktop drag selection, double-click word
selection, touch long-press selection, drag handles, and clipboard copy.

Call the controller's `updateOverlay()` after rendering to keep touch handles
aligned with the camera. After swapping renderer backends, call
`refreshHighlights()`. Dispose the controller during teardown.

Search and selection work with both PDF and HEP scenes that have extracted
text. See the [examples](examples.md) and [API reference](api.md) for adapters,
highlight coordinates, and copy behavior.

## HEP files

HEP (`.hep`) stores a pre-parsed document for reuse. It includes geometry, page
layout, a searchable text index, and optional raster layers. Load it through
the same `pdfObjectGenerator()` entry point as a PDF.

Create a HEP file from a PDF source or an already-loaded scene:

```ts
import { buildHep } from "@soadzoor/hepr";

const fromPdf = await buildHep(pdfSource, { pages: "3-5" });
const fromScene = await buildHep(pdf.sceneData, {
  sourceLabel: pdf.sourceLabel
});
```

The result is an `application/x-hep` `Blob`; save or upload it with a `.hep`
filename. Exporting a loaded scene reuses its parsed data. If that scene has
image operations but no raster layers, also provide `sourcePdf`; use
`sourcePdfPages` to preserve its original page selection for image recovery.

By default, `buildHep` uses DEFLATE compression and stores each raster as the
smaller of WebP or PNG, with raw RGBA as a fallback when encoding is unavailable.
Set `encodeRasterImages: false` to store raw raster pixels. Set
`compression: "store"` to write uncompressed container sections without native
compression stream APIs. Such files can also be loaded without native
decompression streams. Both options can increase file size.

The builder accepts `signal` and `onProgress`, including raster encoding and
container build progress. Browser and Node exports use the same format but may
differ in encoded image bytes.

The loader supports HEP container v1 with scene schema v6. The
[container specification](HEP_CONTAINER.md) describes the binary format and
resource limits.

## Node conversion

Node applications need the optional canvas backend for PDF operations that use
Canvas2D and for decoding encoded HEP images:

```bash
npm install @napi-rs/canvas
```

Vector/text-only extraction does not need this dependency. Without an encoder,
HEP raster export falls back to raw RGBA and can produce much larger files.
Repository development installs already include the canvas backend.

The repository provides `PDFtoHEP.js` for batch conversion. It requires a normal
checkout with development dependencies and Node.js 22.15+, 23.5+, or 24+.
The CLI is not included in the published npm package.

```bash
npm install
node PDFtoHEP.js ./Level1.pdf
node PDFtoHEP.js --output-dir=./heps ./pdfs
node PDFtoHEP.js --force ./pdfs
```

Directory input is scanned recursively and converted one PDF at a time in
isolated child processes. `Level1.pdf` produces `Level1-parsed-data.hep` beside
the input unless `--output-dir=<directory>` is supplied. Output-name collisions
are rejected. Existing files are skipped; `--force` replaces them only after a
successful conversion. Use `--help` for the complete command syntax.

The worker heap ceiling defaults to 12,288 MiB for dense documents. Override it
with `HEPR_PDF_TO_HEP_HEAP_MB` or Node's `--max-old-space-size=<MiB>` argument.
The CLI reports per-file and total attempted conversion times.
