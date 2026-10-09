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

PDFs encrypted with the standard password handler (RC4, AES-128 or AES-256)
open directly when they need no password to view, as with documents that only
restrict permissions. Pass the `password` option for documents that require one;
see [password-protected PDFs](api.md#password-protected-pdfs). HEPR does not
enforce permission flags. A missing or wrong password, unrecoverable malformed
resources, resource-limit violations, and features unsupported by both paths can
still reject the load. Display load errors in your application so users can tell
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

The native and Three demos enable **GPU compress scans** by default. They decode
every selected PDF page before display and prepare bounded scan textures during
parsing, trading longer loading and more CPU memory for faster zoom refinement.
Packed monochrome scans use compact storage; eligible opaque color/grayscale
scans can use lossy BC7/ASTC blocks. Preparation targets image-only pages with a
raster covering at least half the page. Pages with visible vectors or text skip
scan preparation, but still load upfront while the option is enabled. It overrides page streaming,
is bypassed by **Use OCR text instead of scans**, and does not affect HEP loading.
Selecting **GPU compress scans** unchecks both **Use OCR text instead of scans**
and **Stream pages**. Selecting either of those unchecks **GPU compress scans**;
OCR-only viewing and streaming can be used together. HEP loads preserve the
PDF scan-compression choice.

The public API also resolves conflicting PDF options and warns through
`onDiagnostic` and `console.warn`: `ocrTextOnly: true` disables `compressScans`;
otherwise `compressScans: true` replaces `pageLoading: "auto"` with `"eager"`.
When all three are requested, OCR wins and automatic streaming remains available.
The returned `sourceOptions` stores the resolved choices without changing the
caller's options. HEP loads ignore these PDF-only options. See the
[loading options and warning codes](api.md#loading-options).

The Three.js package defaults and demos with **GPU compress scans** unchecked
prepare all selected page overviews before display, then upload the initial
scene once.
They do not rebuild the growing scene or wait for a frame after each parsed page.
The **Stream pages** checkbox opts into viewport-driven loading for PDFs with
more than 16 selected pages, starting from metadata and loading pages near the
camera in one worker. It is unchecked by default; switching it reloads the
retained PDF while preserving the camera and page layout. In the package, use
`pageLoading: "auto"` to stream or `pageLoading: "all"` (the default) to prepare all
overviews. Streaming uses a bounded overview cache; full loading retains every
overview and uses more CPU memory for vector-heavy documents.
Vector pages keep their original geometry at every zoom in both modes.
Image-dominated scanned pages with usable invisible OCR show that text as visible
vectors at a distance, without decoding scan images. Only scans without usable
OCR get small bitmap previews, with a longest edge of at most 96 pixels.
Unsupported drawing features can still use a diagnosed bounded raster fallback.
Scan pixels load when a page occupies more than 256 screen pixels; zooming back
out below 224 pixels restores the OCR vectors or scan preview. The gap prevents
flicker near the transition. At most 12 detailed pages remain cached, with a
further limit based on estimated CPU payload bytes. Vector-only documents return
complete vector scenes after full loading. During streaming, evicted pages
regenerate as you navigate. OCR/scan transitions retain the page geometry, glyph
resources and search index. Scan pixels and coverage mips prepare in a shared
worker, with a cooperative fallback, while the previous representation stays
visible. Submissions are spread across images; Three initializes prepared textures
through its active host before switching page visibility. Recent GPU resolution
tiers stay warm inside
the same automatic raster budget, so repeated zoom cycles can reuse them. Pages
with additional vector paints or clips install their detail geometry once;
compositing effects can still require a diagnosed scene rebuild.
Unloaded pages retain their outlines
and positions. Search progressively loads preview text for the rest of the
document; explicit HEP export compiles the complete original PDF.

Pages waiting for their first overview show an animated book-page skeleton:
a heading and groups of horizontal lines. Native and Three WebGL/WebGPU draw
these shapes analytically in the page background, keeping them sharp at any
zoom without allocating image textures. The skeleton disappears when the
overview arrives. Offscreen or hidden pages do not keep animation running;
the system's reduced-motion preference leaves a static skeleton.

Three.js page demand follows camera projections, including moved or hidden pages.
`pdfObjectGenerator` exposes the current viewing window through `sceneData` and
emits `change` events with `reason: "pages-loaded"` when it changes. Use
`loadCompleteScene({ signal })` for complete geometry analysis, or
`pageLoading: "eager"` when complete original scene data, including decoded scans,
is required before rendering.
Extraction APIs and HEP conversion still produce complete scenes for their selected pages;
the Three example reuses its live PDF session and cached full pages to complete
the export scene once. It serializes that scene without reopening the PDF.
Missing full pages still need compilation;
raster and OCR previews cannot stand in for the original page content.
All GPU integrations allocate small raster display tiers first and increase
their resolution automatically with zoom. CPU canonical image data stays available
for refinement; reducing GPU textures alone does not reduce eager parsing memory.

Native WebGL/WebGPU and both Three material backends retain packed one-bit images
at full resolution and an R8 coverage base at smaller tiers. Their monochrome
mipmaps store four-bit grayscale coverage in a compact atlas, with explicit
bilinear/trilinear shader filtering. This halves the mip payload for large pages
and lowers full-resolution texture memory from about 0.46 to 0.29 bytes per pixel
(roughly 2.70 GB to 1.72 GB for 5.9 gigapixels, before allocation overhead).
Inspect scanned text while zooming through intermediate sizes on each backend;
four-bit mips can slightly change stroke darkness, while close-up binary pixels,
canonical PDF data and exports remain exact. Check repeated OCR/scan swaps for
stall regressions and consistent zoom-out demotion. No compression extension or
additional runtime dependency is needed. Eligible color images can use BC7/ASTC 4x4 through
the host's `ExternalTexture` support, with one shared encoder workspace.
Independent page views share the document's automatic raster memory target.

The native and Three demos offer **Use OCR text instead of scans** for PDF
sources. It reconstructs existing text with vector fonts, preserving
text positions and widths, while skipping scan decoding and scan GPU textures.
Glyphless or missing outlines use bundled substitute fonts.
It is an approximate text-only view: pictures, diagrams, colors, clipping and
annotation appearances are omitted; pages without drawable stored text are
blank and emit a diagnostic. Search and selection remain available. The checkbox
forces text at every zoom; unchecking it restores automatic OCR overviews and
scan detail while retaining the camera and page layout. HEP sources do not
support this option. HEP export uses the original PDF content.

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
roughly 50,000 visible strokes. Large drawings build a fine representation and
additional overview levels. When a tile exceeds its budget, overview levels can
omit tiny marks and merge nearby lines more aggressively. This trades some fine
detail and hatch density for performance while keeping vector rendering.
The HUD labels these selections `(overview)` and shows the total target.

LOD construction keeps the original tolerances and level-selection rules. It
streams completed paint groups, stores merge membership as compact source IDs,
and builds geometry in fixed-size chunks. All levels share one stroke store:
a simplified record that is bit-identical to its source stroke refers to that
stroke instead of copying it, and only records that differ are stored, once.
Levels share culling bounds per stored stroke. Native backends upload the
canonical strokes and these LOD-only records into shared exact/LOD GPU textures
directly from their arrays, without a combined CPU copy. Three data textures
upload one array each, so Three stroke materials read two texture sets: the
canonical strokes' complete rows, viewed in the scene's own arrays, and a
second set holding their partial last row and the LOD-only records. Recoloring
an individual stroke copies the style data of both sets on first use.
Selection scratch grows with visible work.
These storage changes preserve the geometry, paint order, clipping, and detail
transitions of the existing LOD hierarchy; they do not skip levels to meet an
allocation budget.

For a bounded Node measurement on an existing HEP (without PDF conversion or a
browser), run `node scripts/benchmark-vector-lod-memory.mjs path/to/file.hep`.
`--output=path.json` records a parity snapshot; `--compare=path.json` checks every
level's geometry bits, paint origins, spatial buckets, and sampled zoom/pan
selections. Add `--ordered` to include ordered draw preparation and its first
overview frame. Node process memory is a comparative measurement, not an iOS tab
memory estimate. See [the memory optimization report](vector-lod-memory.md) for
measurements, changed files, and device verification steps.

Tiles that fit their budget retain exact or fine geometry. Very dense views can
retain coarser overview levels when zoomed in: front-facing and tilted views
prioritize the budget over the usual 5-pixel overview error limit only when the
whole visible draw list exceeds the soft budget. Hatching in affordable views keeps its usual
detail even when individual tiles exceed their share. Detail returns as the
visible tiles fit their budget; zoom alone does not force every tiny mark to render.
Tilted three.js cameras choose detail per tile:
content near the camera receives more of the budget and finer geometry, distant
content thins out, and tiles outside the view are skipped. The antialiasing filter
still fades retained thin strokes continuously. The target is soft: limited
simplification, clipping, or complex compositing can keep a document above it.
Set Vector LOD to Off for exact strokes at every zoom. Embedded PDF images remain raster layers.

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

For temporary performance captures in the main viewer, select **WebGL** or
**WebGPU**, load the drawing, then run this in the browser console:

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
document or renderer is replaced; demand-driven page updates keep it running.
`heprPerf.report()` reads the current report;
starting again clears the previous capture. The report includes the starting view,
drawing label, settings, per-frame averages/percentiles for CPU phases, batch and
upload counters, and sampled GPU command-span timing when supported.

`transitionSections` measures work between frames, including `pageSwap.decode`,
`pageSwap.rasterPreparation`, `pageSwap.total`, `rasterRefinement.prepare` and
`rasterUpload.submit`. `rasterUpload.cacheHit` identifies texture reuse, and
`rasterUpload.threeHost` measures Three host texture initialization before the
page switch. Cold scene generations also record composition, preparation,
`pageSwap.textLod`, `pageSwap.textUpload`, and native scene/atlas construction. `transitions` keeps the latest 120 events. These spans
can overlap, and worker preparation includes queue/wait time; upload submission
measures CPU wall time rather than asynchronous GPU execution. Compare the first
zoom-in with repeated OCR/scan cycles when investigating a stall.

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
  `msPerFrame` is the mean; `medianMsPerFrame`, which orders the list, is not
  inflated by a one-off stall such as the first frame after a document loads.
- `slowest`, the 16 slowest single operations, with vertex and instance counts,
  viewport, scissor and blit area. One stall can fill this list.
- `typical`, the 16 slowest operation positions in the frame (`order`), each by
  its median over the timed frames that reached it (`frames`). When frames issue
  the same operations, as while panning at one zoom with the whole document in
  view, this names the draws that cost time in every frame.
- `byPosition`, every such position in frame order, with its label, instance
  count and median, so that the whole frame can be accounted for.

Native WebGL fill and gradient-fill operations also include `source`: up to 32
canonical path IDs (`ids`), their clip roots (`clips`, with -1 meaning no clip),
and `truncated` when more instances were submitted. For indirect fill draws,
`first` is an instance-buffer offset; use `ids` to locate the source paths.
Position summaries describe the first sampled draw at that position; later
frames can select different paths as visibility and scheduling change.

Native WebGL batches compatible small images into bounded atlases, including
inside transparency groups. Other consecutive images can share one draw using
up to fourteen original textures, with a separate clip root on each instance.
Texture selection uses at most four comparisons per fragment; two additional
fragment samplers remain available for clipping and a folded soft mask.
These texture batches preserve the original hardware mip filtering and do not
copy image pixels. They flush before vector paints, compositor transitions,
folded paints and Multiply passes; tiled images retain individual quads.
`rasterAtlasBatches`, `rasterStripBatches`, `rasterTextureBatches` and
`rasterStandaloneDraws` count submissions. `rasterInstances` counts all image
instances, and `rasterTextureBatchInstances` counts those using texture batches.
Atlas storage retains independent mip chains and reuses them during camera
motion. Images fall back to individual draws if batch resources are unavailable.

Native WebGL also bounds ordinary fill quads by each instance's clip-chain
bounds in the orthographic view. The original path coverage, cell-index origin,
clip tests, masks and paint order remain intact. During a capture,
`fillUnclippedQuadPixelsEstimate` counts their original expanded quad areas and
`fillQuadPixelsEstimate` counts the bounded areas, both intersected with the
viewport and rounded outward. Overlapping instances count again; these are
area estimates, not actual shaded pixels or GPU instructions. Compare them to
see whether bounding removes work in the current view. `fillClipBoundedInstances`
counts smaller quads and `fillClipCulledInstances` counts empty quads.
`fillClipBoundsAvailable` reports whether bounds were uploaded,
`fillClipBoundsTexels` counts their records, and `vectorClipStoreTexels` counts
the original clip/index store's records. Bounds occupy their own texture,
limited by the device's texture dimensions, so a full clip index store cannot
disable quad shrinking.
Clip geometry with identical Float32 coordinates shares GPU storage across
parents and fill rules, while each clip retains its own header. When the clip
store cannot fit a polygon's finest cell grids or its band index, it retains
the coarser complete grids that fit before falling back to a full edge scan.
This changes the candidate lookup, not the geometry or fill rule. `vectorClipUniquePayloads`
and `vectorClipSharedPayloads` count distinct payloads and nodes reusing them.
`vectorClipRectangleNodes`, `vectorClipCellIndexedNodes`,
`vectorClipBandIndexedNodes`, and `vectorClipUnindexedPolygonNodes` count nodes
using each layout; `vectorClipCoarsenedCellNodes` counts cell-indexed nodes with
finer levels removed to fit the budget. These are whole-document upload
statistics, independent of the current view, and shared nodes count separately.
`fillClipBoundsTestedInstances` counts fills with an available clip bound,
including those whose path bounds already fit inside it. These diagnostics
distinguish disabled bounds from clips that remove no area. Allocation failure
warns and retains the original quads and exact clip tests. Projected views
retain their original expansion and omit the area estimates. The area
calculation runs only while a capture is active.

Native WebGL original-texture image batches also bound their quads by each
image's clip chain in the orthographic view. Inverse transforms are cached per
image and clip; the vertex shader expands them for the live antialiasing
footprint. Mirrored, rotated and sheared images retain their UV interpolation,
mip filtering, masks and paint order. Projected views and unstable inverses
retain the original image quad. During a capture,
`rasterTextureUnclippedQuadPixelsEstimate` and `rasterTextureQuadPixelsEstimate`
estimate the original and bounded image areas. They count outward-rounded
world bounding boxes intersected with the viewport, including overlaps, so
rotated image estimates can exceed actual quad area. They cover texture
batches; standalone images and atlases are excluded.
`rasterTextureClipBoundsTestedInstances`, `rasterTextureClipBoundedInstances`,
and `rasterTextureClipCulledInstances` report tested, smaller and empty image
quads. These diagnostics omit projected views and add no area scans outside
captures. Compare GPU spans without operation timing as well as a separate
capture with operation timing, since individual timer queries add overhead.

Original-texture image batches cache their instance buffers and VAOs by paint
position. Comparing all instance values before each draw
keeps cached geometry current when visibility, clips, transforms or opacity
change. Textures, camera uniforms, masks and compositing state are bound live.
The cache holds at most 512 batches and 4 MiB of GPU instance data, plus an equal
CPU copy for comparison. Unused trailing slots and document replacement release
their resources. Batches beyond either limit use the streaming path; allocation
failure warns once and retains streaming draws. During captures,
`rasterTextureBatchCacheHits` and `rasterTextureBatchCacheMisses` count reused and
uncached batches, `rasterTextureInstanceUploadBytes` counts actual image-instance
uploads, and `rasterTextureBatchCacheBytes` reports resident instance bytes.
Panning or zooming a stable batch sequence should produce cache hits and no
image-instance uploads after the cache is warm. This reduces submission work
without changing the draw count.

Each timed operation runs between its own queries, so the GPU cannot overlap it
with its neighbours, and those frames run slower. Operation times can therefore
add up to more than an untimed span. The context's own methods are restored
when the capture stops.

On WebGPU, GPU times come from timestamp queries, which the native renderer
requests when the adapter supports them. Every render pass of a sampled frame
writes a timestamp at its start and end. `gpu.frameMs` spans the frame's first
pass's start to its last pass's end. With `gpuOperations`, each operation is a
whole render pass, and its `instances` count the pass's draws. Compositor passes
are labelled `span`, `fold`, `clear` and `composite:<kind>`, and the pass that
presents to the canvas is `frame`. Chrome rounds WebGPU timestamps to 100 µs
unless its WebGPU developer features (`chrome://flags`) are enabled, so pass
times need that flag. The Three example on WebGPU uses Three's own timestamps:
its `gpu.frameMs` is the sum of the frame's render passes, without the gaps
between them.

The Three example also exposes `heprPerf`. Reports with
`context.diagnosticsVersion: 3` include the source kind (PDF/HEP), scene
geometry/clip/raster counts, transparency-group structure, Three revision,
browser and shader-error-check setting. These describe the loaded scene, without
exporting document text, shader source or image pixels.

Version 3 also records `context.initialCamera` and camera values in every retained
`frameRecords[].context`: position, quaternion, up vector, controls target,
distance to target, vertical FOV, aspect, near/far planes and camera zoom.
`cameraTiltDegrees` is measured from the world XY plane's normal (the example's
PDF plane): 0 is top-down and 90 is edge-on. `controlsChanged` is 1 when
MapControls moved the camera during that frame, otherwise 0. `cameraZoom` is the
Three camera's projection zoom; the existing `zoom` and `unitsPerPixel` describe
the derived PDF view. Snapshots are detached numeric values, so moving the camera
later does not change earlier records.

Three CPU sections split `render` into `three.sync` (PDF preparation and
compositing) and the remaining outer host render. Inside `three.sync`,
`three.schedule`, `three.strokeLod`, `three.textLod`,
`three.vectorUpdate` and `three.textUpdate` identify camera-dependent work.
Within `three.vectorUpdate`, `three.strokeLodSelection` measures stroke ID
selection, including projected tile culling, error/reach checks and any budget
retry. `three.strokeLodInstances` measures preparing the selected instances or
refreshing unchanged selections, including any nested batch updates. The earlier
`three.strokeLod` section only handles LOD visibility/scale setup.
`three.strokeLodSelections` and `three.strokeLodReuses` count recomputed and reused
selections per frame; recomputation does not necessarily change the resulting
IDs. `three.strokeLodInstanceUpdates` counts calls that prepare instance lists,
not completed GPU uploads. `three.strokeLodVisibleTiles` and
`three.strokeLodActiveLevels` describe the selected workload.
`three.batchRebuild` and `three.batchUpdate` are nested within layer updates.
`three.batchCandidateInstances` counts candidate IDs visited when assembling
batches, before visibility/redundancy filtering; repeated passes count again.
Ordered stroke LOD batches visit selected IDs only, so this work follows the
visible selection rather than the combined size of all stored LOD levels.
`three.compositor` includes setup, batch lookup/geometry preparation, target
binding, `three.hostDraw` (batches that draw paints) and `three.hostPass`
(batches of composite passes alone). Consecutive compositor operations
into one surface share a batch. `three.hostRenders` counts full calls to the
host's `render(scene, camera)`; `three.directPasses` counts batches drawn through
the specialized compositor path. Inside `three.compositorSetup`,
`three.compositorCollect` measures proxy/range-index maintenance and
`three.compositorSelection` measures visible-paint selection. Compare collection
with `three.scheduleChanges` to diagnose zoom replans. These sections overlap:
do not sum parent and child durations.

`three.cachedPaintPlans` counts frames that replay a stable compositor plan;
`three.paintPlanBuilds` counts frames that rebuild it. Visibility revisions,
paint selection, proxy replacement, surface size and fold eligibility invalidate
the plan. Projected rectangles and computed mask vectors still update every
frame. `three.cachedProxyLookups` and `three.cachedGeometrySelections` count
reused draw lookups and complete geometry selections.

Native WebGL and WebGPU also replay stable paint plans. Their `cachedPaintPlans`,
`paintPlanBuilds` and `paintPlanOperations` counters describe this reuse. Canonical
span coverage is resolved once per paint selection; LOD-only batch changes
refresh the batch intervals without rescanning the full canonical paint list.

Unmasked singleton Darken groups drawing exact black at full group opacity share
ordinary source-over spans. Black Darken is equivalent to alpha blending even at AA edges
and over a translucent background. A global tint that changes black restores
the Darken boundaries while retaining equal-color batching. Different gray
Darken paints retain their order and composite passes because merging them can
change overlapping antialiased pixels. These runtime optimizations also apply
to existing HEP files; re-export is unnecessary.

On Three revision 186, `three.glAutoUniformUploads` counts compositor draws
whose changed material lets Three upload uniforms automatically;
`three.glForcedUniformUploads` counts draws that require an explicit refresh,
including consecutive uses of one material. Other hosts or unverified revisions
keep explicit refreshes. During Three WebGPU compositing, eligible uniform groups
upload their complete CPU buffer once rather than each small changed range.
`three.gpuRequestedBufferWrites` counts these requests before the existing packed
upload, while `three.gpuBufferWrites` counts actual queue uploads. The complete
updates reduce request/copy count but increase `three.gpuStagedUploadBytes`.

Ordinary Three WebGPU fill draws use an opacity/surface-mask shader variant
without the fifteen computed-gradient mask uniforms. `three.surfaceFoldDraws`
counts these draws; paints that compute a gradient mask keep the full shader.
Both variants share live paint, clipping and fold inputs and prepare their
programs before the first draw, including hidden paints that can appear later.

Private Three compositor scenes draw meshes in queued order with host sorting
temporarily disabled. Surface dependencies and opaque/transparent transitions
still split batches; the host's sorting setting is restored after each render.

On Three revision 186, WebGL records the frame's target switches, bounded clears
and batches, then initializes their geometry in one private driver render.
Its driver hook replays the batches through Three's `renderBufferDirect`, with
the usual object/material hooks and matrix updates. `three.directFrame` measures
the driver render including replay, so it overlaps `three.hostDraw` and
`three.hostPass`. WebGPU draws each batch through Three's render-object managers
without repeated scene traversal, render-list construction or sorting. Shader,
geometry, binding, pipeline and texture ownership stays with Three, and each
WebGPU pass gets a fresh render ID for its live mask and opacity inputs.
For the Broschuere workload this replaces 72 full compositor renders with one
on WebGL and zero on WebGPU; its drawing and surface-pass dependencies remain.
These counts exclude the application's outer render and presentation draw.
Unknown renderer versions and unsupported host states use the regular path,
visible as full calls in `three.hostRenders`.

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

To compare top-down and tilted performance, open the same region of the same
document with the same backend, viewport, DPR and LOD settings. Let loading and
initial camera movement settle before each capture. Save one report top-down
and a second at the slow tilt; use similar small pans in each, without changing
the tilt during the capture. Leave per-operation GPU timing off and disable GL
wrappers for this initial comparison:

```js
heprPerf.start({ maxFrames: 1200, maxFrameRecords: 240, webglCalls: false });
// Make similar small pans, then let controls settle. Repeat for each view.
heprPerf.stop();
copy(heprPerf.json()); // Chrome/Edge DevTools helper; save each report separately.
```

The example renders on demand, so a stationary view may produce only a few
frames. Compare CPU section summaries and sampled GPU time, not just the FPS
readout. Top-down views can reuse stroke selections; tilted perspective views
currently recompute them every rendered frame. A similar Draw count can therefore
have a different CPU cost. High `three.strokeLodSelection` or
`three.strokeLodInstances` time points to that preparation path; high GPU time
with low CPU preparation instead calls for investigating the rendering work.
CPU and GPU spans overlap and must not be added. Send both complete JSON reports.

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

Native panning, inertia, zooming and settled frames all render directly using
the current camera and viewport. Vector LOD and visibility selection remain
active during movement; no previous pan image is reused.

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

Bands stop helping once they are thinner than a pixel: every pixel then visits
all the segments in its rows. Every backend therefore indexes fill paths,
gradient fill paths and clip polygons with a multi-level grid of cells as
well (`src/vectorCellIndex.ts`). A fill pixel reads the finest level whose
cells are at least half its footprint, so it visits at most three cells each
way at any zoom, and gets the same coverage as the unindexed sum up to
rounding. The index is built when a scene is uploaded (about 0.3 s for the
Broschuere HEP). Paths are indexed from the largest down within the available
texture capacity, and a path left out keeps its bands. Clips have no per-path
edge cutoff or default index-to-edge allowance. Large collections of small
contours can use cells even when bands scan hundreds of unrelated edges at
close zoom. Cell construction stops when further refinement no longer reduces
candidate work, coordinate precision prevents refinement, or the next complete
level would exceed the texture capacity. It keeps complete coarser levels;
bands and the complete edge scan preserve the original geometry when needed.
The packed GPU format uses exact Float32 addresses, with a capacity of 2^24
texels independently of available memory. Native WebGPU passes the cell
headers in its camera uniforms, Three's WebGL materials set `uFillCellHeaders`
and its node materials take `fillCellBase`. Three's layers do not know the
device's texture limit until upload, so they initially use the packed format's
capacity and adapt their stores to the host renderer during upload.
A host that reuses the GL fill
shaders and never sets the cell uniforms (`uFillCellHeaders`, `uCellHeaders`)
leaves them at zero, which means no cells.

Antialiased clips test a 4×4 grid of samples over the pixel. Each node of the
clip chain clears the bits of the samples outside it, reading only the cells
(or bands) that hold the samples, and the pixel's coverage is the share of
samples left. Every backend does this; the GLSL and WGSL clips read the same
layout.

These shaders issue several texture reads before using any: most of a
pixel's time is the latency of its reads, and a draw takes as long as its
slowest pixels. A fill cell's line pieces take one texel each, read four at a
time; only the few cells holding a curve read a second texel per piece.

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
estimate above. Projected views keep whole quads and are excluded. The Three
materials clamp their gradient quads too. Three always projects through its
local-to-clip matrix, so the margin there is the largest at any corner of the
clamped rectangle, which all four corners agree on.

`foldedPaints` counts compositor group chains drawn as a single paint. A chain
of Normal-blend groups holding one fill path, analytic gradient fill or image
(no knockout, at most one soft mask) scales that paint by the groups' opacity
and mask instead of rendering group surfaces and composite passes. A soft mask
without a transfer function is rendered but not converted: the folded paint
reads the mask's content and computes its alpha or luminosity over the mask
backdrop itself, so the mask needs no conversion pass. A mask with a transfer
function is still converted by its own pass first. Native WebGL folds these
chains; native WebGPU and both Three backends fold fills and analytic gradient
fills (`three.foldedPaints` in Three), but not images.

In Three, a folded paint whose soft mask holds one analytic gradient fill, and
nothing else, computes that mask itself (`three.computedMasks`), so the mask
needs no surface or render at all. The gradient must be axial or radial and
not masked by another gradient. Its outline, and its one clip beyond the
folded paint's own chain, must be convex and made of line segments, with up to
eight edges between them. The paint must be in front of the camera, with no
colour override. Any other mask is rendered as above.

While the Three compositor renders, it turns off WebGPURenderer's lighting,
which none of its materials use, and restores it afterwards. With lighting on,
every `renderer.render()` call rehashes the scene's lights node.

On WebGPU a clear is a render pass of its own, and in Three also a queue
submission. The native and Three compositors therefore clear a surface as the
next pass that renders into it loads. A surface that is read, or partly copied
into, before anything renders into it is still cleared on its own
(`three.clearPasses` in Three).

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

## Annotations

All three demos show a collapsible **Annotations** panel below **PDF Layers**. It
lists the document's annotations, such as comments, markups, stamps, form fields
and links, with their type, page and text or link target. Popups and annotations
the PDF marks as hidden are not listed. Every row has a checkbox. Turning an
annotation off hides its drawn appearance and stops its bubble, link preview and
link activation. **All** turns every annotation on or off. While a filter is
active it becomes **All matching** and affects only the matching annotations,
for example every link. The filter matches type, page, text, author and ID. Long
lists show the first 500 matches; refine the filter to reach the rest.

A change reaches bubbles and links at once, and drawn appearances once the
renderer applies it. Some appearances cannot be hidden: those on pages drawn as
a single image, and all appearances in HEP files converted before annotation
layers existed. For these, turning the annotation off only stops its bubble and
link. Switching backends keeps these choices; opening another document turns
every annotation on again. Annotation choices are never exported. Hosts can
mount `createPdfAnnotationControls()` or use the
[annotation APIs](api.md#hiding-annotation-appearances) with their own controls.

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
PDF is not required to replay those resources after reopening the HEP file.

By default, `buildHep` uses DEFLATE compression and stores each raster as the
smaller of WebP or PNG, with raw RGBA as a fallback when encoding is unavailable.
Set `encodeRasterImages: false` to store raw raster pixels. Set
`compression: "store"` to write uncompressed container sections without native
compression stream APIs. Such files can also be loaded without native
decompression streams. Both options can increase file size.

`buildHep` includes applicable vector and text LOD caches by default. Set
`withVectorLod: false` and/or `withTextLod: false` to omit them for smaller files.
Vector caches share unchanged canonical strokes and identical derived records
across levels. Spatial indexes are rebuilt
cooperatively on load, with cancellation support; expensive simplification is skipped.
Text caches include runs, clusters and
coarse instances. Export reuses an available build or creates the requested
LOD. Text caches are omitted when the scene does not qualify for text LOD.

Stored vector LODs default to compact precision; text LODs remain lossless. Vector cache v3 omits tile indexes and
shares identical derived records; text cache v2 remains unchanged. Encoding predicts repeated
coordinates/bounds from existing strokes and packs text metadata into numeric
columns. Both caches and compact vector precision are automatic when applicable:

```ts
const hep = await buildHep(pdf.sceneData);
```

Set `vectorLodPrecision: "lossless"` (CLI: `--vector-lod-precision=lossless`)
to disable additional rounding.

Compact mode rounds derived vector coordinates to power-of-two grids no larger
than 1/32 of the finest referencing level's simplification tolerance. Per-axis
rounding error is at most half a grid step. For example, tolerance 0.5 uses a
1/64-unit grid; a record used only at tolerance 32 can use a 1-unit grid. Shared
records keep the finer precision. Rounding displacement is added to the level's
selection tolerance, preserving the renderer's screen-space error budget.
Exact canonical geometry, stroke widths/colors/opacity and clipping windows stay
unchanged. Bounds cover the rounded geometry, and tile indexes are rebuilt from it.
Text LOD storage remains lossless. Very large coordinates outside the compact
integer range retain lossless storage with a warning. Re-exporting a compact
cache preserves its existing rounding; selecting lossless does not recover
precision already discarded. Rebuild from the original PDF or compact HEP
without LODs to recover the original LOD geometry.

Text LOD v3 predicts run transforms and bounds from the canonical glyphs, then
stores exact XOR corrections. Coarse glyph transforms and colors reuse those
predictions. This avoids storing the same geometry several times while preserving
every decoded cache value. Existing text LOD v1/v2 remains readable and can be
repacked without parsing the PDF or clustering the text again.

On load, matching caches skip simplification and clustering. Missing caches are
built when the viewer needs them. Invalid or incompatible caches produce a
console warning recommending regeneration and fall back to normal generation.
Vector and text cache versions are independent of each other and of the HEP
scene/container versions. Older viewers can ignore the optional sections.
Version 1 caches remain usable with a warning recommending re-export/repacking
for smaller files; no simplification or clustering is repeated. The reader also
recovers the v1 JSON null sentinel for exact-only text nodes. GPU upload and
mutable selection state are still prepared at load time.

Fresh HEP exports build vector LOD geometry without allocating viewer culling
bounds, tile indexes, or selection buffers. These are reconstructed when the HEP
opens. Exporting a scene with an existing LOD hierarchy reuses that geometry.

Both example viewers' **Download HEP** button offers independent vector/text
checkboxes when applicable, checked by default. Cancel or Escape stops the
export. Vector LOD offers Lossless and Compact precision choices, with Compact
selected by default. Downloads with either LOD option use a
`-parsed-data-lod.hep` suffix.

Monochrome scans always use the fast, lossless binary encoding with DEFLATE,
falling back to plain packed pixels when binary runs would grow. Each click
downloads one `-parsed-data.hep` file, or `-parsed-data-lod.hep` when LOD is
included. When neither vector nor text LOD is available, export starts without
a dialog. Full-resolution image quality is preserved. Older HEPs containing
original JBIG2 streams remain readable and use the fast encoding on re-export.

Download HEP reuses a complete loaded scene immediately. For paged viewing, it
reuses the existing PDF worker and cached full pages, loading only the remaining
complete content. Export
leaves the viewing window unchanged and releases the temporary full scene afterward.

Exports compare the complete HEP against the original PDF's byte length and
show a warning when the HEP is at least as large. Downloads still succeed and
retain all selected LOD caches. The viewer displays both file sizes after the
download; library callers can use `onWarning(message)`. A custom scene or an
older HEP without a recorded source size needs the
`sourcePdfByteLength` build option for this check.

The builder accepts `signal` and `onProgress`, including LOD building, raster encoding and
container build progress. Browser and Node exports use the same format but may
differ in encoded image bytes.

The loader supports HEP containers v1 and v2 with scene schemas v9–v13. Scene v13
stores repeated transparency wrappers and matching draw-run metadata compactly,
preserving the original group boundaries and paint order exactly. Exports use it
when repeated wrappers can share storage. New exports
use v2 only when an exact stroke-style palette makes the file smaller; these
files require an updated viewer. Existing v1 files remain supported. The palette
changes no rendering values; optional LOD caches are separate sections. Earlier scene schemas
must be regenerated from the original PDF; repacking a container cannot restore
layer definitions or content omitted by an earlier conversion. The
[container specification](HEP_CONTAINER.md) describes the binary format and
resource limits.

## Node conversion

Node applications need the optional canvas backend for PDF operations that use
Canvas2D and for decoding encoded HEP images. npm installs `@napi-rs/canvas` as an
optional dependency by default. Browser-only consumers can use
`npm install @soadzoor/hepr three --omit=optional`. If the native backend's
installation fails or optional dependencies were omitted, install it explicitly:

```bash
npm install @napi-rs/canvas
```

Library vector/text-only extraction does not need this dependency. Without an encoder,
HEP raster export falls back to raw RGBA and can produce much larger files.
The CLI checks for the canvas backend before converting so PDFs that need raster
fallback can be processed; if it is missing, the CLI prints installation
instructions. Normal repository installs also include the canvas backend.

Offline conversion compiles every selected page's complete original content,
but does not prepare or store GPU display caches. The **GPU compress scans**
viewing option does not apply to `PDFtoHEP.js` or `buildHep`; enabling preparation
alone would add conversion work without changing the saved HEP. Monochrome scans
still use the fast, lossless binary storage, and viewers build display data on load
or zoom. Normal Node provides Canvas2D rather than the WebGL context needed to
prepare BC7/ASTC color blocks.

The npm package includes the `pdf-to-hep` CLI for single-file and batch conversion.
It includes applicable vector and text LOD caches by default, using compact vector
precision. It requires Node.js 22.15+, 23.5+, or 24+ and runs the compiled library
without a repository checkout or development dependencies:

```bash
npx @soadzoor/hepr ./Level1.pdf
npx @soadzoor/hepr --output-dir=./heps-lod ./pdfs
npx @soadzoor/hepr --without-vector-lod --without-text-lod --output-dir=./heps ./pdfs
npx @soadzoor/hepr --without-text-lod --vector-lod-precision=lossless --output-dir=./heps-vector-lod ./pdfs
npx @soadzoor/hepr --force ./pdfs
npx @soadzoor/hepr --workers=4 --output-dir=./heps ./pdfs
npx @soadzoor/hepr --annotation-appearances=none ./pdfs
HEPR_PDF_PASSWORD='secret' npx @soadzoor/hepr ./protected.pdf
```

For repeated use, install the package in your project and invoke its executable:

```bash
npm install @soadzoor/hepr
npx pdf-to-hep ./Level1.pdf --output-dir=./heps
npx -- pdf-to-hep --help
```

If a one-off `npx` run cannot load canvas, install both packages in the same project
with `npm install @soadzoor/hepr @napi-rs/canvas`, then use `npx pdf-to-hep`.
Installing canvas only in the caller's directory does not add it to an existing
`npx` cache installation.

The repository's existing command remains available after `npm install` and uses
the same flags:

```bash
node PDFtoHEP.js --output-dir=./heps ./pdfs
```

Directory input is scanned recursively and converted in isolated child processes,
with automatic concurrency limited by available memory, CPU threads, and the
number of pending PDFs. Whenever a child finishes, its slot takes the next
PDF without waiting for other conversions. Each PDF gets a fresh child process
to release its memory after conversion. A single PDF still uses one conversion
process. `--workers=<count>` overrides the automatic limit; `--workers=1` runs serially.
Progress lines identify their PDF, and the final summary includes per-file
durations and batch wall time. Summed conversion durations overlap in parallel
and can exceed wall time.

The final **Raster fallback by PDF** section lists successful conversions that
needed selective raster layers or whole-page raster rendering, with affected
page numbers and diagnostic reasons. It reports when none occurred. Original
PDF images, font/color approximations, and failed conversion attempts are not
counted as raster fallback in generated HEPs.

Each child retains its own heap limit of 12288 MiB by default (not preallocated).
`HEPR_PDF_TO_HEP_HEAP_MB` or the parent's `--max-old-space-size` overrides this
per-child limit. Automatic concurrency budgets 75% of the memory available at
batch startup, allowing each child its heap ceiling plus 1024 MiB for native
allocations, and always permits at least one conversion. With the default heap,
16 GiB of available RAM selects one worker. This is a conservative scheduling
estimate, not a hard memory limit: typed arrays and canvas allocations are outside
the JavaScript heap. Explicit `--workers` bypasses this estimate. Ctrl+C stops new
dispatch and cancels all active children; a second signal force-stops them.
Failed conversions do not stop other PDFs.

`Level1.pdf` produces `Level1-parsed-data.hep` beside
the input unless `--output-dir=<directory>` is supplied. Output-name collisions
are rejected. Relative input and output paths use the current working directory.
Existing files are skipped; `--force` replaces them only after a
successful conversion. `--annotation-appearances=render|forms|none` chooses which
annotation appearances become page content (default `render`); annotation metadata
is kept in every mode. PDFs that require a password take it from
`--password=<password>` or, kept out of process lists and shell history, from
the `HEPR_PDF_PASSWORD` environment variable; the same password is tried for
every PDF, and the HEP output is not password protected. Use `--help` for the
complete command syntax.

The flags `--without-vector-lod` and `--without-text-lod` independently disable
the corresponding stored caches. Use both for a file without stored LODs. These
flags do not change the CLI output filename; use a separate output directory to
keep files with and without caches side by side. Existing outputs are skipped
even when the LOD options change; use `--force` to replace them. The JavaScript
`buildHep` API also includes both applicable caches by default; pass
`withVectorLod: false` or `withTextLod: false` to omit either one.

For the bundled examples, run `npm run regenerate:heps:lod` manually. It writes
to `public/examples/heps-lod` and updates the manifest with **HEP+LOD** actions
and file sizes. The existing `npm run regenerate:heps` explicitly disables both
LOD caches and keeps writing files to `public/examples/heps`. HEP+LOD actions
appear only for files present when the manifest is generated.

To shrink already-generated example caches without parsing PDFs or repeating
LOD simplification, run:

```bash
npm run repack:heps:lod  # shared geometry, rebuilt indexes, compact vector precision
```

This updates the manifest after successful repacking. The tool rebuilds spatial
indexes to verify the result; it never generates missing LOD geometry. The underlying tool defaults
to measurement only, supports individual files, and has a hard 60-second deadline
per file in isolated workers:

```bash
node scripts/repack-hep-lods.mjs public/examples/heps-lod/Level_1-parsed-data.hep
```

For an older HEP without recorded PDF size, add
`--source-pdf="/path/to/original.pdf"` for a single HEP file. This reads only the
PDF's file size and enforces the same strict budget; it does not parse the PDF.

`--write` enables atomic replacement, only when smaller. Repacking verifies
canonical section bytes and all decoded LOD data against the expected lossless
or compact result before writing. Invalid/missing caches are rejected
without starting a LOD build. Existing files are unchanged during measurement.

The worker heap ceiling defaults to 12,288 MiB for dense documents. Override it
with `HEPR_PDF_TO_HEP_HEAP_MB` or Node's `--max-old-space-size=<MiB>` argument.
The CLI reports per-file and total attempted conversion times.
