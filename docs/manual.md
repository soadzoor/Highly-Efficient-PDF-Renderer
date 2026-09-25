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

For bundled browser applications, use the `@soadzoor/hepr/bundler` entry and
the [Vite configuration in the quick start](../README.md#quick-start).

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
import { pdfObjectGenerator } from "@soadzoor/hepr/bundler";

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

PDF extraction uses HEPR's native parser and prefers usable output over refusing
a document. Content stays vector-based where possible. When a page cannot be
represented safely as vectors, HEPR can render it as a bounded image while
retaining searchable text. Such pages lose vector sharpness and drawing geometry.
Some unsupported color and gradient behavior is approximated with warnings.
Use `onDiagnostic` to display these warnings; see [rendering compatibility](api.md#rendering-compatibility-and-diagnostics).

Encrypted documents, unrecoverable malformed resources, resource-limit violations,
and features unsupported by both paths can still reject the load. Display load
errors in your application so users can tell when a document could not be opened.

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

Vector LOD simplifies stroke geometry according to the current view, aiming for
roughly 50,000 visible strokes. Large drawings keep a fine representation and
additional overview levels. When a tile exceeds its budget, overview levels can
omit tiny marks and merge nearby lines more aggressively. This trades some
far-zoom detail and hatch density for performance while keeping vector rendering.
The HUD labels these selections `(overview)` and shows the total target.

Tiles that fit their budget retain exact or fine geometry. Very dense views can
still use overview levels when zoomed in, but approximations stay within a
5-pixel error limit, so close zoom restores exact geometry. Tilted three.js
cameras choose detail per tile: content near the camera receives more of the
budget and finer geometry, distant content thins out, and tiles outside the
view are skipped. The antialiasing filter still fades retained thin strokes
continuously. The target is soft: limited simplification, clipping, or complex
compositing can keep a document above it. Set Vector LOD to Off for exact strokes
at every zoom. Embedded PDF images remain raster layers.

The Draw counter reports selected vector representatives. During native cached
panning it describes the cached content, not a fresh submission of every stroke
on each frame. Compare direct rendering as well as panning when profiling the
native and Three.js viewers.

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

## Drawing selection

The standalone viewer, Three.js example, and room detection demo share a
**Drawing Selection** checkbox that starts unchecked. Enable it to trace
geometry on hover and select a primitive with a click or tap. The
panel shows its reference and geometry information and lets you change vector
colors temporarily. Images can be selected but not recolored. Dragging and
pinching still move the view; text-selection gestures are suspended until you
turn drawing selection off in viewers with text selection. Empty clicks and
Escape clear the selection. The cursor becomes a pointer over selectable
geometry. In the room demo, selection targets the underlying drawing primitives;
room detection and TSV overlays remain independent.

On the first hover or click, a progress bar shows **Preparing drawing selection**
with the percentage of preparation work completed. It disappears when picking
is ready. You can continue panning and zooming while it prepares, or turn
Drawing Selection off to cancel preparation.

**Reset selected** restores one selected primitive's original color;
**Reset all colors** restores all overrides. Turning the checkbox off clears
interaction state and releases its extra resources. Opening another document
clears selections and overrides; switching rendering backends preserves them.
These changes are never written into exported PDF or HEP files.

Library hosts can opt into the shared `createThreePrimitiveInteractionController()`
or handle their own events with `pick()`, `getPrimitive()`, `setHover()`,
`setSelection()`, and the primitive override methods. See the
[examples](examples.md#pick-inspect-and-recolor-drawing-primitives).

## PDF layers

The native viewer, Three.js example, and room-detection demo share a collapsible
**PDF Layers** panel that displays the PDF's optional
content groups in their original hierarchy. Filter by name, toggle visibility,
use **All** to show or hide all editable layers (including layers hidden by the
filter), or choose **Reset to PDF defaults**. **All** shows a mixed state when some
available layers are visible. Locked layers are disabled; radio groups
allow only one enabled member. PDFs without layers show an empty state.
Bulk enabling preserves the current radio-group choice, or picks an available
default/first member if none is enabled. **All** becomes checked when every
compatible editable layer is enabled, so it can then be unchecked to hide them.
Drawing Selection details show associated layer names and IDs. A primitive can
depend on several layers or a negated visibility expression.

Layer controls work independently of Drawing Selection. Hidden geometry is
excluded from picking and hidden text from search and text selection. Hiding a
selected primitive clears its trace while preserving its temporary color for
later reappearance. Switching backends keeps the layer state; opening another
document restores that document's defaults.

Most visibility changes only invalidate rendering and text caches. Compatibility
effects that need regenerated images show preparation progress; the previous
applied state remains visible until preparation finishes. Failed changes show an
error and leave that state intact. Runtime layer choices are never exported.

Layer eligibility is cached when visibility changes. When every paint is visible,
rendering uses the ordinary culling and batching path without scanning layer
conditions each frame. Layer boundaries remain in the document's canonical data,
but compatible visible ranges can share a GPU draw. Native renderers can also
batch overlapping solid paints with identical colors: normal source-over blending
produces the same result in either order. Different colors and blending effects
retain their ordering dependencies. Temporary primitive recoloring disables this
color-based optimization until the overrides are cleared. Ordinary paint groups
use the direct rendering path; opacity, masks, knockout, and blend effects still
require compositing surfaces.

Dense native drawings use a cached paint schedule for the complete scene. Visible
strokes from different OCGs can share a draw, and disjoint stroke/fill/text paints
can be regrouped while preserving overlap dependencies. Panning and layer changes
filter that schedule instead of repeating the batching search. Coverage-scale
changes during zoom, or temporary color overrides, can require a new schedule.
This trades some subset-specific batching opportunities for cheaper camera updates;
the scheduling search remains bounded for heavily overlapping drawings.
Dependency margins follow the renderer's coverage: strokes include their width
and screen-space antialiasing, while fill and transformed glyph quads need only a
small rasterization margin around their existing bounds. Zooming out therefore
does not artificially expand fill/text dependencies by the larger stroke margin.
Overlapping paints still retain their required order, including all stroke LOD
levels; unknown projection scales keep source order.

For scenes with explicit paint order, native and Three.js rendering also omit
redundant opaque straight strokes from their temporary draw lists. Comparisons
require matching color, caps, clipping, and exact collinearity, within compatible
paint-order regions. A covering stroke
must be selected by the current layer, viewport, and LOD state. Hiding its layer
restores any previously covered stroke; recoloring a solid stroke, fill, or text
instance suspends this optimization until its overrides are cleared. Curves,
translucent strokes, incompatible paints, and compositing effects remain intact.
Like the former extraction-time containment optimization, this can reduce the
extra antialias edge darkening from repeated opaque strokes; it does not use the
old geometric tolerances to remove nearby distinct lines.

The live **Draw** counter reflects these omissions, with **redundant strokes
omitted** reported separately. The document's **culled** statistic still describes
permanent extraction-time removals and may remain zero. Canonical geometry and
primitive references are preserved for picking, inspection, and export. Existing
HEP files benefit without regeneration. Decisions are reused until the selected
stroke IDs or relevant appearance state change. When IDs change, only affected
collinear groups need their coverage recomputed; packed culling metadata adds
runtime memory proportional to the stroke count.

For manual performance verification, compare panning and zooming the same drawing
at the same viewport, DPR, zoom, and LOD settings. Check all layers visible, a subset
hidden, and a recolored overlapping stroke or fill followed by resetting its color.
Check that a contained stroke reappears after hiding its covering layer, and
compare coincident stroke edges at high zoom with the previous optimized output.
Also check native WebGL/WebGPU and switching backends. Draw-call reductions in
non-browser tests do not by themselves establish an FPS or GPU-time improvement.

Native ordered batches also skip geometric rectangle clips when the complete
paint bounds, including every stroke LOD level and screen-space coverage margin,
are strictly inside the entire rectangle clip chain. Clipping stays active near
edges, for polygon clips, and when a conservative projection scale is unavailable.
Canonical clipping metadata remains intact. WebGL retains compatible texture and
vertex state between batches; devices without enough combined texture units use
the original binding layout.

For temporary performance captures in the main viewer, select **WebGL**, load the
drawing, then run this in the browser console:

```js
heprPerf.start({ maxFrames: 1200 });
```

Pan or zoom for several seconds, then run:

```js
heprPerf.stop();          // CPU timing and batch-counter tables, plus the report
copy(heprPerf.json());    // Chrome DevTools helper: copy the report for comparison
```

Capture panning and zooming separately, with the same viewport, DPR, LOD settings,
and visible layers when comparing versions. Capture is off by default, stops after
the requested number of rendered frames (600 by default), and also stops when the
document or renderer is replaced. `heprPerf.report()` reads the current report;
starting again clears the previous capture. The report includes the starting view,
drawing label, settings, per-frame averages/percentiles for CPU phases, batch and
upload counters, and sampled GPU command-span timing when supported.

To see which GPU work fills that span, add `gpuOperations: true`:

```js
heprPerf.start({ maxFrames: 1200, gpuOperations: true });
```

On one frame in eight, never one sampled for the frame span, every draw, clear
and blit gets its own GPU timer query. `gpu.operations` then reports:

- `frameMs`, the summed operation time per timed frame. Compare it with
  `gpu.frameMs`: a sum far below the span means the GPU spent the rest waiting
  for commands, so submission (browser, ANGLE or driver) is the limit. A sum near
  the span means GPU execution is the limit.
- `byLabel`, time and operations per frame for each program and target, such as
  `fill → offscreen` or `composite:softMask → offscreen`. Native WebGL names its
  programs, and compositor passes by kind; other hosts show `program#N`.
- `slowest`, the 16 slowest single operations, with vertex and instance counts,
  viewport, scissor and blit area.

Each timed operation runs between its own queries, so the GPU cannot overlap it
with its neighbours, and those frames run slower. Operation times can therefore
add up to more than an untimed span. The context's own methods are restored
when the capture stops.

The Three example also exposes `heprPerf`. Reports with
`context.diagnosticsVersion: 2` include the source kind (PDF/HEP), scene
geometry/clip/raster counts, transparency-group structure, Three revision,
browser and shader-error-check setting. These describe the loaded scene, without
exporting document text, shader source or image pixels.

Three CPU sections split `render` into `three.sync` (PDF preparation and
compositing) and the remaining outer host render. Inside `three.sync`,
`three.schedule`, `three.strokeLod`, `three.textLod`,
`three.vectorUpdate` and `three.textUpdate` identify camera-dependent work.
`three.batchRebuild` and `three.batchUpdate` are nested within layer updates.
`three.compositor` includes setup, batch lookup/geometry preparation, target
binding, `three.hostDraw` (primitive submissions) and `three.hostPass`
(composite submissions). Inside `three.compositorSetup`,
`three.compositorCollect` measures proxy/range-index maintenance and
`three.compositorSelection` measures visible-paint selection. Compare collection
with `three.scheduleChanges` to diagnose zoom replans. These sections overlap:
do not sum parent and child durations.

During a Three WebGL capture, existing GL calls are timed by default. The
`gl.*` sections distinguish shader-source setup, compilation, linking, program
use, shader/state queries, buffer/texture uploads, drawing, clears, readbacks
and synchronization. No additional GL query, shader check, readback, flush or
wait is issued. `frameRecords[].events` retains up to eight longest instrumented
calls of at least 8 ms, with names such as `gl.getProgramInfoLog` or
`gl.bufferData`, plus slow compositor submissions. A slow GL call can include
a driver wait; it does not establish pure GPU execution time.

Per-frame counters include schedule changes, batch/material creation, selected
paints, per-kind draw submissions, requested live-instance upload bytes, surface
allocation/clear work, program/texture/geometry counts, and LOD selection.
`three.surfaceBytes` is the compositor's RGBA surface estimate, not total GPU
memory; `three.textSelectionUploads` is a cumulative LOD-runtime count, whose
change between frames identifies an upload. Counts of rendered instances are
sampled before compositing hides the layer meshes. `context.frameGapMs` on
each frame preserves long gaps excluded from the interval summary, and the
bounded record selection prioritizes neighbours of major CPU stalls after
the slowest CPU/GPU and highest-draw frames.

Detailed GL timing adds diagnostic overhead. Use
`heprPerf.start({ webglCalls: false })` for a Three capture without GL-call
wrappers; CPU phase timings and the existing optional GPU timer remain.
Wrappers are removed on stop, automatic capture completion, backend replacement
and disposal. `context.webglCalls` reports which methods could be instrumented.
Three WebGPU reports phase/counter diagnostics without WebGL-call or GPU-query
timings.

To investigate the HEP-only Broschuere zoom pause, collect two reports:
one HEP and one PDF, using a fresh page load for each and the same WebGL backend,
viewport, DPR, layer visibility and LOD settings. Open the document, start
capture before the first zoom, pan briefly, then zoom until the HEP stalls.
Zoom out and repeat the movement once to distinguish first-use from repeat
stalls. Follow the same movement for the PDF.

```js
heprPerf.start({ maxFrames: 1200, maxFrameRecords: 240 });
// Pan/zoom, including the first zoom and one repeated zoom.
heprPerf.stop();
copy(heprPerf.json()); // Chrome/Edge DevTools helper
```

Send both complete JSON reports. They should identify whether the pause is in
scheduling/LOD, resource uploads, shader/program queries, or another submission
phase. A browser Performance trace may still be needed for browser-internal
work such as garbage collection.

Native WebGL also reports `panCacheRefreshes` and `panCacheReuses`. A refresh
renders the ordered scene into the bounded cache; a reuse frame translates that
image and draws live highlights without resubmitting the scene paints. Heavy
source-ordered PDFs can use this path during panning; zooming and settled frames
render directly. `panCacheFrames` counts attempts to use the cache, including
frames that fall back to direct rendering when a suitable cache cannot fit.
Compare refreshes and reuse frames separately when interpreting frame costs.

Native WebGL captures include `gradientFillSubmission` and
`gradientStrokeSubmission` CPU sections. These sum gradient setup and draw
submission per frame and can overlap the broader `drawSubmission` section.
`gradientAnalyticFillDraws` / `gradientMeshFillDraws` distinguish bounding-quad
fills from mesh fills; the corresponding `...Segments` counters count submitted
fill-path segments, and `gradientMeshTriangles` counts mesh triangles.
`gradientStrokeDraws` and `gradientStrokeSegments` count submitted stroke runs
and their segments. These include repeated draws in compositing passes.

`gradientFillClipPolygonEdges` and `gradientStrokeClipPolygonEdges` sum the
original polygon edges in each submitted draw's clip chain; packed rectangle
clips are excluded. These counts stay unchanged when clip indexing is active.
`gradientFillIndexedClipNodes` and `gradientStrokeIndexedClipNodes` count indexed
polygon nodes across the same chains, including repeat visits in separate draws;
they confirm indexing is active, not how many candidate edges the GPU examines.
Dense clips use horizontal bands over their original edges at upload time, with
the existing full scan retained when indexing is unsuitable or exceeds its
memory budget. Both native and Three WebGL/WebGPU rendering benefit; these
gradient-specific console counters remain native WebGL only.

For analytic fills in the main orthographic view,
`gradientAnalyticFillBBoxPixelsEstimate` sums viewport-clipped bounding-quad
areas in framebuffer pixels, rounded outward. It includes overlap and ignores
geometric clips, scissor rectangles, transparent pixels, and early exits;
projected views and mesh fills are excluded. Multiplying each quad's estimate
by its clip-chain polygon edge count produces
`gradientAnalyticFillClipEdgeTestsEstimate`, the **unindexed full-scan baseline**
upper-work estimate. It is not the actual indexed candidate count or a GPU
instruction count, and should not fall merely because clip indexing is enabled.
Compare sampled GPU time and corresponding `frameRecords` before and after the
change at the same zoom, viewport, DPR, and visible layers. Diagnostics
do not scan fill segments or clip edges in the render loop and remain off
unless a capture is active.

Both native renderers clamp each analytic gradient fill's quad to its clip
chain's bounds, widened by the one-pixel coverage margin; nothing outside them
survives the clip. `gradientAnalyticFillQuadPixelsEstimate` sums the clamped
quads the same way, so it can be compared with the unclamped bounding-quad
estimate above. Projected views keep whole quads and are excluded.

`foldedPaints` counts compositor group chains drawn as a single paint. A chain
of Normal-blend groups holding one fill path, analytic gradient fill or image
(no knockout, at most one soft mask) scales that paint by the groups' opacity
and mask instead of rendering group surfaces and composite passes. Native
WebGL folds these chains; its soft mask is still prepared on its own surface.

The [Broschuere gradient investigation](broschuere-gradient-performance.md)
documents a dense polygon-clip hotspot and recommended comparison captures.

The report also includes up to 120 `frameRecords` with the camera and viewport,
CPU phases, batch/instance counts, and GPU timing for the same frame when sampled.
It selects slow frames and evenly spaced examples when the report is requested;
selection and sorting do not run in the render loop. Use
`heprPerf.start({ maxFrames: 1200, maxFrameRecords: 240 })` for more examples, or
`maxFrameRecords: 0` for aggregate summaries only. These records distinguish a
costly batch rebuild from a view that repeatedly needs many draws. Missing GPU
timings mean that frame was not sampled or its result was unavailable, not zero
GPU work.

GPU timer queries are asynchronous, sampled every fourth frame, and never wait for
the GPU or force a flush. Unsupported timer queries, disjoint clocks, and dropped
samples are reported explicitly. CPU timings measure JavaScript/submission work;
they do not include asynchronous GPU execution or all browser layout/compositing.
CPU and GPU spans overlap and must not be added. The GPU query brackets the frame's
command stream, including possible gaps while the CPU prepares more commands; it
does not measure only time spent executing shaders.
Frame intervals describe rendered frames, with idle gaps over 250 ms excluded;
they are not an automatic continuous FPS benchmark. Profiling itself has overhead;
`heprPerf.start({ gpu: false })` provides a CPU-only capture. Rendering remains
unchanged by the capture, and the HUD text updates at most ten times per second
while camera and interaction processing continue every frame.

The Three.js example preserves applied layer visibility when switching WebGL/WebGPU
backends, including a panel change still finishing when the switch begins. Layer
changes refresh search and clear stale text selections without moving the camera.
In the room-detection demo, PDF layers control the drawing; detected rooms and TSV
overlays retain their separate visibility controls. Layer toggles do not rerun room
detection. Opening another document resets the layer panel to that PDF's defaults.
Hosts can mount `createThreePdfLayerControls()` for an object that may be replaced,
mount `createPdfLayerControls()` directly, or use the
[layer APIs](api.md#pdf-layers-optional-content) with their own controls.

## HEP files

HEP (`.hep`) stores a pre-parsed document for reuse. It includes geometry, page
layout, a searchable text index, and optional raster layers. Load it through
the same `pdfObjectGenerator()` entry point as a PDF.

Create a HEP file from a PDF source or an already-loaded scene:

```ts
import { buildHep } from "@soadzoor/hepr/bundler";

const fromPdf = await buildHep(pdfSource, { pages: "3-5" });
const fromScene = await buildHep(pdf.sceneData, {
  sourceLabel: pdf.sourceLabel
});
```

The result is an `application/x-hep` `Blob`; save or upload it with a `.hep`
filename. Exporting a loaded scene reuses its parsed data, including original
PDF layer defaults, hidden geometry, and retained fallback resources. The original
PDF is not required to replay those resources after reopening a v7 archive.

By default, `buildHep` uses DEFLATE compression and stores each raster as the
smaller of WebP or PNG, with raw RGBA as a fallback when encoding is unavailable.
Set `encodeRasterImages: false` to store raw raster pixels. Set
`compression: "store"` to write uncompressed container sections without native
compression stream APIs. Such files can also be loaded without native
decompression streams. Both options can increase file size.

The builder accepts `signal` and `onProgress`, including raster encoding and
container build progress. Browser and Node exports use the same format but may
differ in encoded image bytes.

The loader supports HEP container v1 with scene schema v7. Earlier scene schemas
must be regenerated from the original PDF; repacking a container cannot restore
layer definitions or content omitted by an earlier conversion. The
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
