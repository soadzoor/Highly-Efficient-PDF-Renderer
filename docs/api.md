# API reference

[Overview](../README.md) · [Examples](examples.md) · [Manual](manual.md)

This page covers the main integration APIs. The package ships TypeScript declarations;
[the public entry point](../src/index.ts) lists every exported function and type.

## Package entry points

| Import | Purpose |
| --- | --- |
| `@soadzoor/hepr` | Three.js objects, HEP export, search, selection, LOD utilities, and room detection. |
| `@soadzoor/hepr/three` | Alias for the main entry point, with the same exports. |
| `@soadzoor/hepr/bundler` | Same public API as the main entry, with modules and assets prepared for browser application bundlers. |
| `@soadzoor/hepr/node` | Node PDF thumbnails and reusable conversion sessions, file sources, PDF workers, and bundled standard-font resolution. |
| `@soadzoor/hepr/experimental/pdf-worker` | Worker entry used by the PDF session infrastructure. |
| `@soadzoor/hepr/experimental/thumbnail-encoder-worker` | Node worker entry used for cancellable thumbnail encoding. |

For bundled browser applications, consistently use the `/bundler` entry and the
[Vite settings in the quick start](../README.md#quick-start). This entry provides
separate JavaScript modules and asset references that the application build can
follow. Vite's dependency exclusion keeps those references available to its
development transforms; ES module workers allow lazy imports in production.
No HEPR plugin or manual asset copying is required. Other bundlers need support
for module workers and static `new URL("./asset", import.meta.url)` references;
the package regression checks currently cover Vite.

The main and `/three` entries retain the prebuilt `dist/lib` layout: serve that
directory intact when using it in a browser; do not rebundle it or mix its modules
with the `/bundler` entry. Node usage is unchanged.

Rendering backends and WebGPU materials load on demand. The existing asynchronous
object factories prepare the selected backend before returning, and HEP export
loads its encoder when `buildHep` is called. The first use can require additional
chunk requests; subsequent calls reuse the loaded modules. Deploy every emitted
chunk and asset together. Optional features remain in the package, while named
imports from `/bundler` allow unused modules to be removed by the application build.
Worker startup files are explicitly preserved during tree shaking.

When a WebGL HEPR object is hosted by a WebGPU renderer, its independent highlight
overlay can load the host's materials on first use. Apps that render on demand
can subscribe with `pdfObject.addEventListener("change", requestRender)`, where
`requestRender` schedules their usual frame. The event's reason is
`"primitive-highlights-ready"`. Remove the listener with
`pdfObject.removeEventListener("change", requestRender)` during cleanup.

Shader comments are removed only from build output; TypeScript sources keep their
comments and indentation. Shader code whitespace remains intact for exact source
patches. Vite builds requesting source maps retain the original strings and mappings.

## Editing APIs

`openEditorSession(scene, options?)` opens an immutable compiled `VectorScene`
for editing and returns `Promise<EditorSession>`. It does not start a renderer or
change the supplied scene. The same compiled results work with the native and
Three.js WebGL/WebGPU renderers. Editing/font/writer runtimes load on demand.

```ts
import { openEditorSession } from "@soadzoor/hepr/bundler";

const editor = await openEditorSession(scene, { sourcePdf: originalPdfBytes });
const id = editor.addObject({
  kind: "text", pageIndex: 0, x: 24, y: 120, width: 240, height: 80,
  text: "Hello PDF", fontSize: 18,
  runs: [{ text: "Hello ", fontFamily: "Liberation Sans" },
    { text: "PDF", fontWeight: "bold", color: "#cc0000" }]
});
editor.select([id]);
editor.transformSelection([1, 0, 0, 1, 12, 0]);
const modifiedScene = await editor.getScene({ signal });
const pdf = await editor.savePdf({ signal });
const hep = await editor.saveHep({ signal });
editor.dispose();
```

Objects use displayed page-local coordinates, X right/Y up, with the lower-left
page corner at `(0, 0)`. Their six-component affine `transform` defaults to the
identity. `transformSelection(matrix)` takes a delta in composed scene coordinates
so a shared gesture can transform a multi-object selection about one pivot.
Reader/Grid and camera presentation must be converted by the host adapter.

Shapes, ink and signatures accept `fillOpacity` from 0 to 1 independently of
stroke `opacity`. When omitted, fills retain the legacy `opacity` fallback;
explicit values also work with fully transparent strokes or fills. Arrowheads
follow stroke opacity. Both values compile into ordinary PDF/HEP paint data,
without adding renderer frame work. Text and images continue using `opacity`.

`getSelectionFrame()` returns committed `{ bounds, transform, pageIndex? }` data
for drawing transform handles. The bounds use the frame's local axes; transform
its four corners with the supplied matrix to obtain composed scene coordinates.
The frame follows rotation, shear and reflection; `pageIndex` is available when
the selection belongs to one page. Apply the preview delta captured for the
displayed scene once when drawing a gesture. `getSelectionBounds()` continues to
return axis-aligned scene
bounds for spatial queries. Frame data is detached from the session and does not
add authoring metadata to PDF or HEP output.
Groups contain independently transformed children. A group's `transform`
records its selection axes; its children already include group operations, so
do not apply the group's matrix a second time when rendering those children.
For page-plane picking in a Three.js Reader layout,
`clientToScenePoint(camera, x, y, element, pageIndex?)` can target the frame's
page explicitly, keeping handle drags usable outside that page's border.

The session exposes `getObjects`, `getObjectBounds`, `getSelectionBounds`, `getSelectionFrame`,
`select`, `selectPrimitives`, `selectAnnotations`, `selectArea`, `addObject`, `updateObject`,
`transformSelection`, `cloneSelection`, `deleteSelection`, `groupSelection`,
`ungroupSelection`, `setFieldValue`, `transaction`, `undo`, `redo`, `subscribe`,
`getScene`, `savePdf`, and `saveHep`. Transactions roll back on failure.
`getState()` reports revision, selection, undo/redo availability and dirty state.
Compilation and saving accept `signal` cancellation and `onProgress` callbacks
with normalized `value` and `stage`; failed saves do not clear dirty state.
`setPreviewTransform(matrix | null)` previews a gesture without adding history or
dirty state; saves exclude previews. `getScene({ includeObjects: false, preview:
false })` returns only the edited original content and filled fields.

Layer authoring uses the existing PDF optional-content model. `getLayers()` lists
user OCGs (`id`, `name`, `defaultVisible`, `locked`, `usedInView`), excluding internal
annotation groups; `getLayerOrder()` returns its nested group/label hierarchy.
`createLayer({ name, defaultVisible?, locked?, parentId?, index? })` returns an ID.
`updateLayer(id, { name?, defaultVisible?, locked? })` changes properties;
visibility changes respect locked layers, source View intent and radio groups.
`moveLayer(id, { parentId?, index })` and `setLayerOrder(tree)` change both list
order and stacking: top listed layers paint in front, compound memberships use
their frontmost layer, and unlayered paint slots remain fixed. Compositing units
move together. Creation and renaming alone retain original paint order.

```ts
const notes = editor.createLayer({ name: "Review notes" });
editor.setActiveLayer(notes);
editor.assignSelectionToLayer(notes);
editor.updateLayer(notes, { name: "Approved notes", defaultVisible: true });
editor.moveLayer(notes, { parentId: null, index: 0 });
```

`setActiveLayer(id | null)` controls new objects, without dirtying the document.
An explicit `layerId` on `addObject` overrides it; null means unlayered. The UI
rejects placement on a hidden active layer. `getObjectLayerIds(id)`,
`assignObjectsToLayer(ids, layerId | null)`, `assignSelectionToLayer(layerId | null)`,
`getLayerObjects(id)` and `selectLayerContents(id)` support custom controls.
`copyObjectLayerMembership(sourceId, targetId)` copies the exact current
visibility expression when replacing an object, including compound/negated
OCMD membership, without coupling it to the original annotation's ownership.
The source must be one annotation or one authored object; heterogeneous source
collections and temporary groups retain their per-primitive scopes and cannot
be reduced to a single copied condition.
`getObjectLayerCondition(id)` returns `{ catalog, condition? }` for custom writers.
Advanced authored objects can use `layerCondition` as an index into the session's
current catalog instead of `layerId`; it is session-local and must be remapped
when moving objects between documents. Use the copy operation for replacements.
`removeLayer(id, { targetLayerId? })` keeps artwork: omission/null forgets the
removed visibility variable, retaining other memberships; a destination retargets
it. Negated and compound visibility expressions are projected together so removal
cannot reveal previously impossible content. Layer document changes are undoable.

`canReorderSelection(action)` and `reorderSelection(action)` expose object
arrangement within each layer and page. `EditorStackingAction` is
`"bring-to-front"`, `"bring-forward"`, `"send-backward"` or `"send-to-back"`.
They preserve selected objects' relative order, leave other layers' paint slots
fixed, and treat inseparable compositing scopes as units. Compound memberships
use the same frontmost-layer ownership as layer reordering; unlayered content
arranges within its own page scope. Boundary operations are no-ops and do not
add undo history. Reordering updates compiled drawing order and picking ranks.
PDF/HEP save the resulting ordinary paint data, without editor order/history
sections. Editable PDF still obeys its separate page/annotation/widget paint
passes; flattened PDF reproduces the compiled order across those passes.

`isObjectVisible`, `isPrimitiveVisible` and `isAnnotationVisible` use current
editor visibility. `getPrimitivePaintRank(ref)` and `getObjectPaintRank(id)` supply
matching source and authored-object picking order;
pass it as `ScenePrimitivePickOptions.resolvePaintRank` after reordering layers.
`getLayerRevision()` changes for layer/membership edits, allowing controls to skip
work during transform previews. `getLayerEdits()` returns a detached persistence
snapshot for writers. Compiled scenes and HEP use ordinary optional-content data.
PDF saves preserve OCG identities and visibility configuration. Metadata-only
edits retain original drawing streams; changing source membership, removing
referenced layers or restacking can rebuild affected page/annotation appearances
as vectors, with compatibility warnings. `savePdf({ onDiagnostic })` also reports
the `editor.pdf-layer-stacking` warning for separate annotation paint passes.
Editable PDF
annotations and widgets still obey independent readers' separate paint passes;
use `savePdf({ flatten: true })` for exact displayed order across those passes.

`getPages()` returns current page indexes, displayed dimensions and
rotation. Page indexes are zero-based. `rotatePages(indexes, degrees, options?)`
accepts clockwise multiples of 90 degrees; `removePages(indexes, options?)`
keeps at least one page. `insertPdf(bytes, { at?, pages?, password?, signal?,
onProgress?, onDiagnostic? })` inserts selected pages from another PDF before
`at`, or appends when `at` is omitted. Omit `pages` to import the whole PDF.
The inserted page indexes follow their supplied order. The foreign password is
independent of the primary document's password.
Source-backed sessions require all source pages in their original order for page
management; partial or reordered source scenes reject the operation before
changing the document. Open the complete PDF, or use the direct native API for
physical source-page operations.

```ts
await editor.rotatePages([0, 1], 90, { signal });
await editor.removePages([2], { signal });
await editor.insertPdf(otherPdfBytes, { at: 1, password: otherPassword, signal });
// Repeat insertion to merge additional PDFs.
```

Page changes share undo/redo with object and field edits. They retain the current
authoring state in memory and commit only after the new document is ready;
cancelled, failed or stale operations leave the active document unchanged.
Explicit drawing order is retained in the canonical scene during page changes,
including source content interleaved with authored annotations; editable PDF
materialization alone cannot represent all such interleaving. Source-copy
appearances become ordinary editable source annotations after materialization.
`sourceScene` and `sourcePdf` can change after page operations and undo/redo.
Hosts must refresh picking and page-coordinate adapters when `sourceScene`
changes. The stock UI calls `EditorUiHost.documentChanged(scene, source)` before
installing the replacement scene. Source-specific field/font services can be
recreated with `EditorSessionOptions.createSourceOptions`; its `disposeSource`
hook releases source-owned resources while retained history keeps them usable.

`createEditorAppServices({ sourcePdf?, password?, loadFontAsset?, onDiagnostic? })`
returns `{ sessionOptions, fonts, dispose }`. Pass its `sessionOptions` to
`openEditorSession` when sharing a font registry with a custom interface.
`fonts.loadBundled`, `fonts.register`, `fonts.requestLocalFonts`, `fonts.resolve`
and `fonts.list` manage portable font bytes. `register` accepts complete TTF/OTF
data. Font records are read-only and their byte buffers must not be modified.
Default services support Node font loading; `loadFontAsset` can override it.
The optional `prepareScene` hook enriches form controls only during editor setup.
`AnnotationField.textStyle` then supplies the typing font family, point size
(zero means automatic), weight/style, RGB color, em-based ascent/descent and
the field's content inset when available.
Source font bytes remain in the editor registry; typing styles are omitted from HEP.
`readTextAnnotation(id, scene, signal?, source?)` restores HEPR-authored PDF textboxes and
their embedded fonts for a custom text-editing interface.
Pass `{ pdf: editor.sourcePdf, password }` as `source` after page operations.

`createEditorUi(host, signal?)` supplies optional shared browser controls. Its
`EditorUiHost` supplies the current scene/source, full-quality preparation,
scene installation, canvas and bidirectional client/scene coordinate conversion,
plus edit-mode notifications. Instantiate it when editing or attachment is requested;
`setEditing(false)` removes editor frame work while retaining the session.
For frame-aligned form controls, supply `subscribeToFrames(listener)` and return
an unsubscribe function. Invoke the listener synchronously after drawing or
submitting each document frame, including camera-only frames, while coordinate
conversion still uses that frame's camera. `requestFrame()` schedules an initial
draw when the Fill tool creates controls; provide it with frame notifications
unless the host already guarantees that draw. These hooks are optional; hosts
without frame notifications retain animation-frame positioning. The UI subscribes
only in Edit mode and unsubscribes on returning to View or disposing.
Supply optional `layerControlsContainer` and `showLayerControls()` to mount the
layer editor in a host dock beside the canvas and open that dock from the toolbar.
Without a container, the shared UI uses an accessible layer dialog. Layer controls
unsubscribe when returning to View.
`save("print")` also works while those controls are hidden and does not mark the
document saved. Optional host `onStatus` and `onBusyChange` callbacks let a View
toolbar expose inactive-editor progress/errors and coordinate its controls;
the stock UI also exposes `isBusy()`.
`attachDocuments(files, signal?)` appends PDF or HEP files in order using the same
page history as the Pages dialog. It flushes active text/form drafts and works
while the UI is in View; it does not enable editing controls or mark changes saved.
Each file commits atomically, so earlier attachments remain if a later one fails
or is cancelled. HEP files (including legacy ZIPs) are rebuilt as PDF pages from
their retained scene content; missing original authoring semantics are not recovered.
`dropImages(files, { x, y }, signal?)` accepts client coordinates and PNG/JPEG/WebP
files in active Edit mode. It captures the page position before decoding and
inserts each full-resolution image with undo support. Tool, mode or document
changes cancel stale placement. Drops outside a document page are rejected.
Hosts can instead build their own interface around `EditorSession`.

`await createEditorInteractionController(editor)` supplies the same DOM-free
selection and affine-transform gestures used by the stock toolbar. Feed picked
object IDs to `selectHit(id, { ctrlKey?, metaKey?, shiftKey? })`; Ctrl/Cmd toggles
and Shift adds. `selectArea(bounds, modifiers?)` selects only fully contained
objects. `previewTransform(matrix)`, `applyTransform(matrix?)`,
`cancelTransform()` and `nudge(x, y)` share the session's preview and undo model.
Hosts render `editor.getScene()` themselves. Dispose the controller before its
caller-owned session. The factory and its types are also available from `/node`.

`writeScenePdf(scene, options?)` rebuilds a PDF from rendering data alone. It
supports HEP-only input, source-order vector paths and outline glyphs, searchable
Unicode text where mappings exist, images, clips, gradients and transparency.
PDF layer conditions, defaults and shared identities are retained; `flatten:
true` bakes their default visibility into the output.
Existing raster fallback islands remain images. It cannot recover discarded
source fonts, original text-authoring structure or form semantics.

Newly authored objects remain editable PDF annotations even with HEP-only input.
When `sourcePdf` is supplied, `savePdf` preserves the source document and writes
editable annotations/forms with explicit appearances. Generic source-content
transforms may rebuild the affected page's drawing content; `onWarning` reports
the resulting authoring-structure limitation. `{ flatten: true }` requests a
rendering-data PDF. Existing supported password encryption is preserved by
default, including flattened copies. No cryptographic signing or PDF script
execution occurs.

For editable PDF exports, `onWarning` also reports artwork that may overlap
visible form widgets. Chrome and some other readers draw widgets after ordinary
annotations regardless of their array order. The standalone viewers offer an
editable/flattened copy choice for these overlaps. API callers can request
`flatten: true` to keep the compiled visual stacking; the resulting copy has no
interactive form fields or annotations. Detection uses committed geometry and
conservative bounds, respects moved/deleted/hidden fields, and runs only during
export. It adds no View-mode rendering work and never silently flattens output.

PDF saves accept `protection: { mode: "preserve" }` (the default), `{ mode:
"remove" }`, or `{ mode: "password", password, ownerPassword? }`. Set the existing
source `password` when opening the editor; the output password is separate.
New protection uses AES-256 with the Standard revision-6 handler. Opening and
explicit owner passwords must be nonempty and fit 127 UTF-8 bytes after SASLprep
Unicode preparation; prohibited characters and invalid bidirectional combinations
are rejected. The owner password defaults to the opening password. Password
changes rewrite the final object graph, discarding previous revisions and old
encryption data. They retain document objects and resources without rendering.
Creating new protection requires WebCrypto (HTTPS or localhost in browsers).

```ts
const unlocked = await editor.savePdf({ protection: { mode: "remove" } });
const protectedCopy = await editor.savePdf({
  protection: { mode: "password", password: newPassword }
});
```

`changePdfProtection(bytes, protection, { password?, signal?, onProgress?,
onDiagnostic? })` changes protection directly without creating an editor or
compiling page geometry. It is exported from the root, bundler and Node entries:

```ts
import { changePdfProtection } from "@soadzoor/hepr/node";

const unlocked = await changePdfProtection(pdfBytes, { mode: "remove" }, {
  password: existingPassword
});
```

Password settings remain in memory. HEP has no encryption or password field;
HEP exports contain the decrypted rendering data.

`manipulatePdfPages(bytes, operation, options?)` provides native page operations
without an editor or page rendering. Operations are `{ kind: "rotate", pages,
degrees }`, `{ kind: "remove", pages }`, or `{ kind: "insert", at, bytes,
pages?, password? }`. Options accept the primary `password`, `signal`,
`onProgress`, and `onDiagnostic`. The root, bundler and Node entries export it.
It preserves primary encryption, native page resources and editable fields and
annotations. Imported field names receive a namespace when they collide with
existing names. Imported document bookmarks are not merged. Diagnostics identify
omitted bookmarks and navigation or structure that cannot refer to retained
pages; the stock Pages dialog displays these warnings.

```ts
const merged = await manipulatePdfPages(primaryBytes, {
  kind: "insert", at: 1, bytes: otherPdfBytes, pages: [0, 2],
  password: otherPassword
}, { password: primaryPassword, signal });
```

HEP saves bake current geometry and update searchable text, annotations, clipping
and LOD. They contain no source PDF/font/editor-history sections. There is no
new editor persistence schema or application-defined object count limit.

`createEditorSignatureLibrary(storage)` accepts a `getItem`/`setItem` storage
adapter and exposes `list`, `save`, and `remove`. `normalizeEditorSignature`
normalizes flat handwriting coordinate paths without rasterization. Browser
storage errors propagate, leaving the existing stored library intact.
`normalizeEditorSignature(paths, name, id, smoothing = 0)` accepts a total error
budget in template coordinates. A positive budget uses one quarter to compact
redundant captured points and reserves three quarters in the returned `smoothing`
for curve fitting. Zero retains raw polyline samples. Existing stored templates remain
compatible and are not rewritten when listed or reused.
The optional `smoothing` on ink/signature objects uses local page units; zero
retains the original polylines. SVG previews, compiled curves and explicit PDF
appearances share the fitted geometry; PDF `InkList` samples follow those curves.
HEP stores ordinary line/quadratic geometry without the capture or smoothing model.

## `renderPdfThumbnail(source, options?)`

Returns `Promise<{ blob, width, height }>` for a fast, single-page overview.
Accepts the same PDF/HEP source forms as `pdfObjectGenerator`, including HEPs
without an original PDF. This browser API constructs no Three object, interaction
controller, or vector/text LOD hierarchy.

```js
import { renderPdfThumbnail } from "@soadzoor/hepr/bundler";

const controller = new AbortController();
const thumbnail = await renderPdfThumbnail(file, {
  page: 1, maxDimension: 400, background: "#ffffff", signal: controller.signal,
});
// controller.abort() cancels when a file is removed or the wizard closes.
```

| Option | Default | Meaning |
| --- | --- | --- |
| `page` | `1` | One-based source page number. |
| `maxDimension` | `400` | Longest output side in physical pixels, preserving page aspect ratio with integer rounding. No implicit device-pixel-ratio multiplier. |
| `background` | `"#ffffff"` | `"transparent"`, short/six-digit hex, CSS named colors, packed `0xRRGGBB`, or normalized RGB tuples. |
| `format` | `"webp"` | True lossless WebP or `"png"`. |
| `backend` | `"auto"` | Prefer lightweight WebGL with capability/compatibility fallback, or explicitly select `"webgl"` / PDF-only `"canvas2d"` for comparisons. |
| `signal` | — | Cancels source loading, queued work, preparation, rendering, and encoding. |
| `onDiagnostic` | — | Receives compatibility approximations and encoding fallback diagnostics. |
| `onTiming` | — | Receives stage names and `durationMs` for browser performance comparisons. |

PDF password, ICC, font policy, codec, and parser options can also be supplied
to the one-shot call. The requested resolution reaches preparation before rendering:
images, curves, clipping and compatibility surfaces use thumbnail detail, and
unreadable ordinary glyphs may use inexpensive ink marks. These approximations
prioritize layout, orientation, dominant shapes and colors over tiny labels or
exact fine detail. Thin overview strokes use a one-pixel minimum pen for more
recognizable linework. Canvas2D batches compatible opaque paths, reuses clip
state and flattens overview curves within a quarter output pixel; complex paints
keep their compatibility rendering. Thin, opaque, solid root-page polylines use a compact
one-pixel pen with rounded caps and joins. Eligible opaque Canvas2D line spans
use four-sample antialiased coverage, reported as
`thumbnail.pixel-stroke-approximation`. This smooths curves and diagonals while
retaining the stronger overview pen, without rendering a larger bitmap.
Canvas2D preparation also consolidates opaque root strokes with identical
quarter-pixel endpoint pairs within the same compatible paint span, reported as
`thumbnail.stroke-pixel-culling`. Source counts, clipping and paint order remain
intact; the full-quality representation is prepared independently.
Translucent vector overrides and explicit working-memory limits retain all source
segments so compatibility rendering can preserve their appearance.
Dashed, thick, translucent, masked and nested-program paths retain their
compatibility geometry. Public thumbnails retain scanned-page appearance.

Thumbnail preparation shares saved graphics and text settings until they change,
reuses the graphics interpreter's text transform, and recognizes complete line
and polyline scopes in one byte scan. Solid filled text shares rendering state
while preserving glyph placement and per-glyph alpha. These shortcuts preserve
caller limits and cancellation, and remain separate from canonical HEP conversion.

The parser and snapshot renderer run in a module worker when supported; browser
capabilities determine fallback. The lossless WebP codec is a lazy package-local
WASM asset. WebP is configured for low compression effort to prioritize latency.
If encoding is unavailable or the requested dimensions exceed the WebP format,
PNG is returned with `thumbnail.webp-png-fallback`; inspect `blob.type`.
Encoding settings for HEP images are independent and unchanged.

Aborting rejects with `signal.reason` (normally `AbortError`). Pending work is
cancelled, late results are discarded, and temporary resources are released.
The encoding worker can be terminated without discarding a reusable PDF session.
Individual synchronous native calls, and inline WASM when workers are unavailable,
cannot be interrupted midway; checkpoints run around them.

Both Reader sidebars use the shared snapshot pipeline and direct pixels, avoiding
an encode/decode round trip. Their existing layer, color and OCR viewing settings
apply to previews; viewport loading takes priority over sidebar work.

## `openDocumentSession(source, options?)`

Returns a caller-owned `DocumentSession` for multiple thumbnails and later HEP
conversion. It reuses one PDF document/parser and completed font programs, or
one decoded HEP scene. Opening does not prepare viewer LOD or interactive resources.

```js
import { openDocumentSession } from "@soadzoor/hepr/bundler";

const session = await openDocumentSession(file, { password });
try {
  const preview = await session.renderThumbnail({ maxDimension: 400, signal });
  const hep = await session.buildHep({ signal });
} finally {
  await session.close();
}
```

| Member | Behavior |
| --- | --- |
| `info` | Read-only source kind, page count and page dimensions. |
| `renderThumbnail(options?)` | Same thumbnail options and result as above. |
| `buildHep(options?)` | Canonical HEP conversion with existing page selection, compression and LOD options. Default vector/text LOD export stays enabled. |
| `buildHepWithScene(options?)` | Same conversion options, returning `HepBuildResult`: `{ blob, scene }`. Reuse the complete scene for display without decoding the generated HEP. |
| `getDiagnostics()` | Copy of accumulated diagnostics. |
| `close()` | Idempotently cancel pending work and release parser, renderer, encoder and scene resources. |

Source/password, font policy, codecs, and ICC configuration are fixed at opening;
changing them requires another session. Each operation accepts its own cancellation
signal. Cancelling one thumbnail leaves the session usable. Operations are serialized;
thumbnail derivatives never replace canonical HEP resources. HEP sessions re-encode
their existing canonical scene without recovering detail absent from that HEP.

Use `buildHepWithScene()` when generating a HEP for upload and immediately
displaying the document. Its returned scene remains usable after `close()`;
the caller owns that reference. Pass the same scene object to
`createThreePdfObject(scene, { sourceLabel })` to reuse
applicable vector and text LOD data. Treat the scene and its arrays as read-only.
The operation retains full-resolution raster pixels instead of releasing them
as pages are encoded, so it can use more memory than `buildHep()`. Renderer
resources, camera controls and shaders still need preparation.

A session retains its last completed thumbnail. Repeating the same normalized
page, size, background, format and backend returns the immutable image Blob
without preparing, drawing or encoding again. A different request replaces that
entry only after success; failed or cancelled requests leave the prior result
available. Cache hits still check cancellation and report only their actual
`total` timing. Closing the session releases the cached result.

The parser also retains one prepared thumbnail page after native rendering.
Changing only paint or encoding options, such as background, vector color or
format, redraws that page without interpreting the PDF again. Resolution,
page or layer-retention changes require preparation. Layer visibility is
applied to a separate view of the cached page. Worker capability fallbacks
that transfer a prepared page or scene to the host do not retain that storage.
Closing the session releases this prepared representation too.

For local browser timing and visual checks, open `thumbnail-benchmark.html` on the
manually started development or production-preview server. Select a local document;
it stays in the browser. The matrix compares cold calls and reused sessions,
WebGL/Canvas2D, sizes, and lossless WebP/PNG. Presentation timing is an estimate;
use a browser performance trace to inspect actual paint. No browser speed claim
is established by the offline tests.

## Node thumbnails

`@soadzoor/hepr/node` exports `renderPdfThumbnail` and `openDocumentSession` with
the same thumbnail options, `Blob` result and reusable-session methods shown
above. Node inputs are PDFs: local path strings, `URL` objects or `file:` URL
strings, byte buffers (`Uint8Array`, `Buffer`, `ArrayBuffer`), blobs, and explicit
`PdfSource` objects. Local files use random-access reads rather than loading the
entire PDF into a temporary buffer.

```sh
npm install @soadzoor/hepr @napi-rs/canvas
```

```js
import { writeFile } from "node:fs/promises";
import { renderPdfThumbnail, openDocumentSession } from "@soadzoor/hepr/node";

const { blob, width, height } = await renderPdfThumbnail("drawing.pdf", {
  page: 1,
  maxDimension: 400,
  background: "transparent",
  format: "webp",
});
const outputPath = blob.type === "image/webp" ? "drawing.webp" : "drawing.png";
await writeFile(outputPath, new Uint8Array(await blob.arrayBuffer()));

const session = await openDocumentSession(new URL("file:///data/drawing.pdf"));
try {
  const controller = new AbortController();
  const preview = await session.renderThumbnail({ maxDimension: 160, signal: controller.signal });
  const hep = await session.buildHep();
  await writeFile("drawing.hep", new Uint8Array(await hep.arrayBuffer()));
} finally {
  await session.close();
}
```

Node `backend: "auto"` uses Canvas2D directly; `"canvas2d"` selects the same
path, and explicit `"webgl"` rejects. `@napi-rs/canvas` remains an optional
package dependency, but is required to render these server thumbnails. The
API does not install `Worker`, `document` or `OffscreenCanvas` globals.
Lossless WebP remains the default, with the same diagnostic PNG fallback and
independent full-quality HEP conversion policy as the browser API.
Node codec startup overlaps PDF preparation and is cancelled with the request.
The isolated PDF worker skips native Canvas system-font discovery because PDF
text uses resolved font outlines; the host environment is unchanged.

`NodeDocumentSessionOpenOptions` also accepts `NodePdfWorkerOpenOptions`:
`workerUrl` and `workerName` configure the parser worker, while
`encoderWorkerUrl` overrides the thumbnail encoder worker. Published defaults
resolve workers and bundled font files from the installed HEPR package and
remain usable when the Node entry is included in an SSR bundle. Source-checkout
tests provide explicit compiled worker URLs or TypeScript bootstraps. Each session owns its
workers and closes them through `close()`; an aborted thumbnail rejects with
its original `signal.reason` and leaves the session available for later work.

HEP input is rejected by this Node thumbnail entry: rendering an existing HEP
scene currently requires the browser snapshot backend. Use the browser API for
HEP thumbnails, or retain the original PDF for Node thumbnail generation.

The checkout CLI exposes the same Node thumbnail pipeline with
`--output=thumbnail` or `--output=both`; its existing default is
`--output=hep`. Until these flags are included in a published release, use
the local launcher:

```sh
node bin/pdf-to-hep.js drawing.pdf --output=thumbnail --thumbnail-page=1 --thumbnail-max-dimension=400 --thumbnail-format=webp --thumbnail-background=transparent
node bin/pdf-to-hep.js drawing.pdf --output=both --output-dir=./output
```

The thumbnail flag defaults match the API: page 1, 400 pixels, lossless WebP,
and white background. `both` reuses a document session for overview rendering
and canonical HEP conversion; existing artifacts are skipped independently.
See [Thumbnail CLI output](manual.md#thumbnail-cli-output) for naming, force
behavior, requirements and failure reporting.

## `pdfObjectGenerator(source, options?, rendererType?)`

Returns `Promise<HeprThreePdfObject>`. The result is a `THREE.Group` that follows
your Three.js camera through its render hooks. Add it to your scene and render
normally; frame the camera using the object's bounds as shown in the [examples](examples.md).

```ts
import { pdfObjectGenerator } from "@soadzoor/hepr/bundler";

const pdf = await pdfObjectGenerator("/drawings/plan.pdf", {
  pages: "1-3, 5",
  onProgress: ({ value, stage }) => console.log(value, stage)
});
scene.add(pdf);
```

`source` accepts PDF or HEP bytes as `Uint8Array` / `ArrayBuffer`, a `File` /
`Blob`, a fetchable URL or browser-relative path, a base64 payload, or a data URL.
For local files in Node, read the file into bytes before calling the shared APIs.

`rendererType` is the **third argument**: `"webgl"` (default) or `"webgpu"`.
Use `"webgpu"` with a WebGPU-capable Three.js renderer and browser/GPU support.

### Loading options

| Option | Default | Behavior |
| --- | --- | --- |
| `signal` | — | `AbortSignal` for source reading, parsing, LOD preparation, and object creation. |
| `sourceKind` | `"auto"` | Infer the format from the source, or force `"pdf"` / `"hep"`. |
| `sourceLabel` | Inferred name | Override the name shown for retained bytes or other sources. |
| `pages` | All pages | One-based PDF pages: `"2"`, `"1-3, 5"`, `"5-"`, or `"-3"`. |
| `password` | — | User or owner password of a PDF that requires one to open. See [password-protected PDFs](#password-protected-pdfs). |
| `maxPagesPerRow` | Automatic grid | Maximum pages per row when composing a PDF scene. |
| `pageLoading` | `"all"` | Prepare all viewing pages before display, with one initial scene upload. `"auto"` opts into viewport-driven streaming for PDFs with more than 16 selected pages. Both preserve vector pages, use stored OCR as scan overviews and load scan pixels on zoom; only scans without usable OCR get small bitmap previews. `"eager"` also decodes complete original scan content before returning. |
| `compressScans` | `false` | Eagerly decode all selected PDF pages and prepare bounded scan texture data between page compiles. Packed monochrome uses compact atlases; opaque color/grayscale scans can use lossy BC7/ASTC. `ocrTextOnly: true` disables this option with a warning. Otherwise it overrides `pageLoading: "auto"` with `"eager"` and a warning. |
| `segmentMerge` | `true` | Merge compatible adjacent vector stroke segments during PDF parsing. |
| `invisibleCull` | `true` | Drop known invisible content during PDF parsing. |
| `extractText` | `false` | Also populate scene-space text items for tasks such as room-label seeding. |
| `ocrTextOnly` | `false` | PDF viewing approximation: draw existing visible and invisible text at its stored positions and widths, substituting bundled fonts for glyphless or missing outlines. Skip image decoding and other graphics. Pages without drawable stored text remain blank and emit a diagnostic. |
| `annotationAppearances` | `"render"` | Which annotation appearances become page content: `"render"` all, `"forms"` only form fields (Widgets), `"none"` none. Annotation metadata is extracted in every mode. See [hiding annotation appearances](#hiding-annotation-appearances). |
| `onProgress` | — | Receive overall progress (`value` from 0 to 1) and the current `stage`. |
| `imageCodecResolver` | Bundled codecs | Supply a raw-sample image decoder; works through PDF workers and PDF-to-HEP conversion. See [image compatibility](#rendering-compatibility-and-diagnostics). |
| `iccTransformResolver` | — | Supply a batched ICC-to-sRGB conversion engine; works through PDF workers. |
| `iccEngine` | `"qcms"` | `"qcms"` or `"lcms"`: try the preferred engine, then the other engine, then alternate colors. `"alternate"`: approximate directly. `"none"`: disable built-in conversion and approximation. |
| `onDiagnostic` | — | Receive PDF diagnostics, including conflicting loading options, raster fallback, visual approximation, and ICC warnings. `pageIndex`, when present, is zero-based. |

Page selections are deduplicated and composed in document order. Invalid selections
reject with `RangeError`. HEP files preserve their saved page selection, layout and
annotation appearance mode; PDF parsing options do not reprocess a HEP scene. Search uses the text index and
does not require `extractText: true`.

Use `pdfObjectGenerator(source, { ocrTextOnly: true })` for a text-only PDF view.
This uses the PDF's existing text; it does not perform OCR. Vector overviews stay
sharp at every zoom and do not allocate scan textures. Reopen the retained
`sourceBytes` with `ocrTextOnly: false` to restore the normal view.
`loadCompleteScene()` and the demo's HEP export complete the original PDF content,
reusing the active session and cached full pages when available.

See [loading option types](../src/pdfObjectGenerator.ts) and
[progress fields and stages](../src/loadProgress.ts). By default, PDFs prepare all
selected vector, OCR or scan overviews before resolving and upload their initial
scene once. Scan pixels still load on camera demand. `pageLoading: "auto"` opens
large PDFs from metadata and compiles visible pages as needed; its bounded page
cache uses less CPU memory and installs new page geometry as pages arrive.
OCR/scan swaps retain existing geometry and update scan textures plus paint
visibility. Raster preparation uses a shared worker or cooperative fallback;
recent GPU tiers are cached within the automatic memory allowance. Additional
vector/clip detail installs once, while compositing pages may require full scene
updates to preserve their effects.
`pageLoading: "eager"` prepares the complete original PDF content before resolving.
`compressScans: true` also prepares scan display data page by page during parsing,
retaining a bounded share of the automatic raster target for every selected page.
Compatible renderers reuse that data at upload; zoom can still prepare a higher
resolution from original pixels. This mode retains every original page on the CPU,
so it uses more CPU memory than streaming. Its temporary GPU encoder and retained
display derivatives are bounded independently of the original document pixels.
The native and Three demo viewers enable **GPU compress scans** by default;
selecting it unchecks both **Use OCR text instead of scans** and **Stream pages**.
Selecting either of those unchecks **GPU compress scans**; OCR-only viewing and
streaming can be used together.
The library option remains opt-in. Scan preparation targets image-only pages
with a raster covering at least half the page. Pages containing visible vector
artwork or text skip this preparation, but the option still loads every selected page
upfront and overrides streaming for those PDFs. HEP loading is unaffected.

For PDF sources, conflicting viewing options emit a warning through both
`onDiagnostic` and `console.warn`, once per conflict per load:

| Code | Resolution |
| --- | --- |
| `options.compress-scans-ocr-conflict` | `ocrTextOnly: true` disables `compressScans`. The requested `pageLoading` mode is preserved. |
| `options.compress-scans-streaming-conflict` | Effective `compressScans: true` replaces `pageLoading: "auto"` with `"eager"`, loading every selected page upfront. |

If all three are requested, OCR-only viewing wins, `"auto"` remains available,
and only the OCR conflict warning is emitted. `"all"` and `"eager"` are compatible
with scan preparation. Returned `sourceOptions` records the resolved choices;
the caller's options object is unchanged. HEP sources ignore these PDF-only
options without conflict warnings. These loader warnings are separate from
parser diagnostics and are not retained by `PdfSession.getDiagnostics()`.

Cancellation is cooperative; after a
successful load, the returned object belongs to the caller and needs disposal.
Large stroke and text LOD preparations use a module worker when available,
leaving the browser's main thread available for interaction. Small preparations
and environments without workers use the cooperative local path. Worker failure
also falls back to that path; cancellation remains supported in both cases.
Stored HEP vector LOD is adopted directly and reports the `vector-lod-restore`
stage ("Loading Vector LOD"); `vector-lod` indicates preparation of a new hierarchy.

### Password-protected PDFs

Encrypted PDFs that open without a password, such as documents that only
restrict permissions, load like any other PDF. When a PDF needs a password, the
load rejects with an error that `isPdfPasswordError()` recognizes. Its
`details.reason` is `"password-required"` when no password was given and
`"password-incorrect"` when the given one is wrong. Ask for the password and
load again; the user and the owner password both work:

```ts
import { isPdfPasswordError, pdfObjectGenerator } from "@soadzoor/hepr/bundler";

async function loadPdf(bytes: Uint8Array, askPassword: (retry: boolean) => Promise<string | null>) {
  let password: string | undefined;
  for (;;) {
    try {
      return await pdfObjectGenerator(bytes, { password });
    } catch (error) {
      if (!isPdfPasswordError(error)) throw error;
      const answer = await askPassword(error.details.reason === "password-incorrect");
      if (answer === null) throw error;
      password = answer;
    }
  }
}
```

Pass bytes, a `File`, or a `Blob` so a retry does not download the PDF again.
HEPR supports the standard password security handler (RC4, AES-128, and
AES-256) and does not enforce its permission flags.

### Rendering options

| Option | Default | Behavior |
| --- | --- | --- |
| `vectorLod` | `"auto"` | Use stroke LOD for large scenes; `"off"` keeps exact strokes, `"force"` enables it below the usual threshold. |
| `textLod` | `"auto"` | Simplify subpixel text clusters; `"off"` keeps exact glyphs. |
| `curveStrokes` | `true` | Enable curve-aware stroke joins and caps where supported. |
| `minimumStrokeWidth` | `0` | Minimum vector stroke width in device pixels, for example `0.5`, `1` or `10`. `0` preserves source widths. Legacy `false`/`true` inputs map to `0`/`1`. |
| `vectorOnly` | `false` | Use vector glyph geometry instead of the raster glyph atlas. |
| `pageBackground` | `"#ffffff"` | Page background color. |
| `pageBackgroundOpacity` | `1` | Page background alpha, from 0 to 1. |
| `vectorOverrideColor` | `"#000000"` | Color used to tint or replace vector colors. |
| `vectorOverrideOpacity` | `0` | Override strength: 0 preserves original colors, 1 replaces them. |
| `threeColorCompositing` | `"linear"` | Three/WebGPU alpha-compositing domain; `"display"` requires `renderer.outputColorSpace = THREE.LinearSRGBColorSpace`. |

Colors accept hex strings, numbers such as `0xffffff`, or normalized RGB tuples
such as `[1, 1, 1]`. See [rendering option types](../src/threePdfObject.ts).

The minimum stroke width is measured in drawing-buffer pixels, including internal
supersampling, rather than CSS pixels. It changes display width only; canonical
scene/HEP geometry, fills, text and raster images retain their original data.
PDF hairlines retain their device-width behavior when the option is disabled.
Widths must be finite and non-negative. Both demos expose a numeric control
with a default of `0`. This is a display-width adjustment, so tuning it can
change the apparent darkness of dense linework without changing source colors.

## `buildStrokeScene(polylines, defaults?)`

Synchronously returns a `VectorScene` compiled from host-provided 2D geometry.
No PDF, canvas, or GPU context is needed to build it. Pass the result directly
to `createThreePdfObject` to use the existing Three.js renderer and stroke LOD.

```ts
import { buildStrokeScene, createThreePdfObject } from "@soadzoor/hepr/bundler";

const geometry = buildStrokeScene([
  { points: [[0, 0], [100, 0], [100, 60], [0, 60]], closed: true },
  { points: new Float32Array([0, 30, 100, 30]), color: "#dc2626", width: 0.25 }
], { color: "#334155", width: 0.5 });
const drawing = await createThreePdfObject(geometry, {
  sourceLabel: "Sheet layout",
  vectorLod: "auto"
});
scene.add(drawing);
```

Each `StrokeScenePolyline` contains:

| Field | Default | Meaning |
| --- | --- | --- |
| `points` | Required | Readonly `[x, y]` tuples, or a flat `Float32Array` / `Float64Array` of coordinate pairs. |
| `closed` | `false` | Add the last-to-first edge unless the final point already equals the first. |
| `color` | Inherited | sRGB `#RGB`, `#RRGGBB`, CSS color name, `0xRRGGBB`, or normalized RGB tuple. Tuple channels are clamped to 0–1. |
| `width` | Inherited | Nonnegative full stroke width in scene units; zero means a device-pixel hairline. |

The optional `StrokeSceneStyle` defaults supply `color` (black) and `width` (1)
for polylines that omit them. Strokes are opaque and solid, with round caps and
round joins. This version does not accept dash patterns, other cap/join styles,
curves, fills, text, or images. Keep `curveStrokes` enabled (the rendering default)
for round cap coverage.

Coordinates are X-right/Y-up, with no implicit unit conversion or Y flip. Widths
use the same units and scale with the Three.js object. GPU coordinates are float32;
use coordinates near a local origin and place the group in the larger BIM world
with Three.js transforms. `Float64Array` input is also converted to float32.

The builder copies inputs and computes stroke bounds and a single page rectangle,
including stroke width. Treat the returned scene as immutable while rendering;
changing your original points does not change it. Empty/single-point paths emit
no strokes. Consecutive points equal after float32 conversion are skipped and
reported in `discardedDegenerateCount`; entirely empty geometry has zero pages
and the default bounds `[0, 0, 1, 1]`. Invalid point shapes, nonfinite/out-of-range
coordinates, invalid colors, and invalid widths throw. Scene buffers support at
most 16,777,216 candidate segments; practical limits depend on available memory
and the renderer's GPU texture capacity.

The supported contract is the builder input and rendering workflow. Applications
should not construct or mutate the packed scene metadata themselves. LOD uses
the existing visual approximations at overview scales; use `vectorLod: "off"`
when exact stroke rendering is required.

## `createThreePdfObject(scene, options?)`

Returns `Promise<HeprThreePdfObject>` from a compiled `VectorScene`, including one
returned by `buildStrokeScene`. It skips source loading/parsing, prepares LOD,
and creates the same `THREE.Group` used by `pdfObjectGenerator`. No standalone
viewer UI or custom WebGL lifecycle integration is required.

`CreateThreePdfObjectOptions` accepts the rendering options above, plus
`sourceLabel` (default `"Vector scene"`), `signal`, and `onProgress`. Unlike the
file loader, `rendererType` is an **option**, defaulting to `"webgl"`, and
`pageBackgroundOpacity` defaults to `0`. Set it to `1` for a visible sheet
background. `sourceKind` on the object and `sourceType` in progress events are
`"scene"`. Cancellation and disposal follow the file loader's behavior.

The object lies in its local XY plane and is centered on the page bounds, as
with PDF objects. To retain the input coordinates within a parent BIM/sheet group:

```ts
const b = geometry.pageBounds;
drawing.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 0);
sheetGroup.add(drawing);
// Rotate, translate, or scale sheetGroup to place the drawing in the 3D world.
```

Your normal `renderer.render(scene, camera)` calls drive culling and LOD. Remove
the group from its parent and call `dispose()` when finished. Geometry edits and
incremental buffer updates are outside this API; build a new scene if needed.

## `HeprThreePdfObject`

The object supports normal Three.js transforms. `sceneData` contains its current
`VectorScene`; treat it as read-only and read it again after `pages-loaded` events.
For demand-loaded PDFs this is the viewing window; `loadCompleteScene({ signal, onProgress })`
reuses the active PDF session and cached full pages, then extracts the remaining
complete content for analysis or export. `sourceLabel`, `sourceKind`, and
`rendererType` describe the loaded source and backend.

Transforms apply to the **whole loaded object**, including all pages, backgrounds
and content:

```ts
pdf.position.set(x, y, z);
pdf.rotation.set(rx, ry, rz);
pdf.scale.set(sx, sy, sz);
```

Use `getPage(index)` or `getPages()` to access independently transformable pages
from either a PDF or HEP. Indices are **zero-based displayed page slots**, so
`getPage(0)` is the first loaded page even if the PDF was loaded with `pages: "5-8"`.

```ts
const page = await pdf.getPage(1); // Second displayed page; a THREE.Group
page.position.set(100, 50, 20);
page.rotation.set(0, Math.PI / 6, 0);
page.scale.set(0.8, 1.2, 1);
// page.quaternion, translateX/Y/Z, rotateX/Y/Z, and applyMatrix4 also work.

await pdf.setPagePosition(1, 100, 50, 20); // Convenience setter
await pdf.setPageTransform(1, new THREE.Matrix4().makeRotationY(Math.PI / 4));
```

Each page's origin is its center. Its initial position preserves the loaded
layout relative to the document's centered origin. Page transforms compose with
the document and ancestor transforms. Backgrounds, all paint types, clips,
highlights, culling and picking follow the same page transform on both Three.js
backends. `setPageTransform` replaces the local affine matrix (including shear)
and disables `matrixAutoUpdate`; subsequent `setPagePosition` calls preserve that
matrix's linear part. To resume ordinary position/rotation/scale updates, set
`page.matrixAutoUpdate = true` (a decomposed transform cannot preserve shear).

The first accessor prepares all independent page views asynchronously, in
short slices that keep the page responsive; observe it with
`pdf.subscribePagePreparationProgress(listener)` (integer percentage, or `null`
when idle). Page views share the document's glyph outlines and glyph atlas.
Repeated calls reuse the same page objects. Both Three.js backends keep compatible pages
in shared geometry batches: shaders look up each primitive's page transform,
and backgrounds use one instanced draw. Moving a page updates a small matrix
table; camera/document movement uses the shared projection uniform. Geometry
and primitive ownership stay unchanged. Text LOD uses each page's projection;
stroke LOD conservatively uses the most magnified visible page.

Batching applies to disjoint projected pages and to overlapping opaque pages
whose paint stays inside their background and that depth orders exactly: one
lies wholly in front of the other's plane, or they cross steeply enough that
only about a pixel along the crossing is ambiguous (as with separate rendering).
3D arrangements such as spheres or helices of pages therefore stay batched.
On thumbnail-sized pages, antialiasing may reach past a background and blend
out of page order; `isPaintOrderApproximated()` reports this. Pages with
translucent or nearly coplanar overlaps, paint outside their page, different
appearance settings or primitive overrides, PDF compositing effects, retained
replay, or unsupported host resources use separate page rendering. Safe layouts
automatically rejoin the batch. Independent fallback resources are prepared
with the page views. Images, gradients, clips and paint-order boundaries can
still require multiple draws; there is no fixed draw-count guarantee.

Moving pages can cross nearly coplanar for a few frames, which would drop the
whole document to separate rendering. While animating, call
`pdf.setPageOverlapMode("fast")` to keep opaque pages batched regardless (such
overlaps may z-fight and are reported by `isPaintOrderApproximated()`), and
restore `"exact"` once the pages settle. Translucent overlaps always keep page
order. Depth-based ordering needs depth precision: keep the camera's near plane
close to the nearest content rather than at a tiny fixed value.

While every page view stays in its loaded layout with the document's
appearance (no page transforms, page-level settings or colors), the document
draws itself exactly as before page views existed; page overlays still follow.
Moving any page switches to page rendering, and restoring the loaded layout
switches back.

After rendering, `pdf.getPageBatchingStats()` reports `mode` (`"document"`,
`"pages-batched"`, or `"pages-separate"`), `pageCount`, and a nullable fallback
`reason`. Query document rendering/LOD statistics while pages are batched;
individual page resources are dormant then. Runtime transforms are not saved
to HEP. Documents that do not call page APIs retain their existing rendering
path. Native texture fallback shares the document's GPU context and copies each
rendered page to its own canvas. A one-page document returns itself without
allocating another view.

The document owns its page views: keep them parented to `pdf` and dispose the
whole document with `pdf.dispose()`. `getPage` / `getPages` accept `{ signal }`;
cancelling a caller's wait does not cancel preparation shared by other callers.
Disposing the document aborts preparation and releases all prepared pages.
`page.pageIndex` identifies its owning document slot (`null` on a document,
including a one-page document returned as its own page view).

Document-level picking retains canonical document primitive IDs; picking through
a page returns IDs in that page's compact `sceneData`. Search `bounds` remain in
original scene coordinates; document `localBounds` reflect the current page
transform as an XY bounding box. `sceneToClientPoint` accepts an optional final
`pageIndex` to resolve ambiguous original coordinates. Use page methods when
working directly with page-local primitive IDs. Layer visibility remains shared
across the document; document appearance setters also apply to every page.
While using separate page rendering, query LOD diagnostics on the page views;
the document returns `null` for their independent LOD statistics. While batched,
query those statistics on the document.

Newly composed scenes store exact primitive ownership in HEP. Existing HEP files
without that metadata infer stroke/fill ownership from their original layout.
Paint inside one page rectangle is assigned exactly; a warning reports how many
strokes/fills reach past their nearest page and may be assigned approximately.
Exporting such a HEP again stores exact ownership. Transforms are runtime presentation state and are not saved by
`buildHep(pdf.sceneData)`. Treat `sceneData` as read-only.

| Member | Purpose |
| --- | --- |
| `pageCount` | Number of displayed pages. |
| `getPage(index, options?)` / `getPages(options?)` | Prepare and return independent page objects with automatic shared batching. |
| `getPagePreviewScene(index, { maximumDimension, signal? })` | Return a page's appearance as a `Promise<VectorScene>` for rendering thumbnails. Uses zero-based loaded-page indices, supports cancellation and source-free HEPs, and keeps sidebar work below main-view demand. `maximumDimension` is an integer from 16 through 4096 and bounds raster preview dimensions; vector geometry remains accurate. |
| `getPageBatchingStats()` | Report the current batching mode, page count and fallback reason. |
| `subscribePagePreparationProgress(listener)` | Observe page view preparation as an integer percentage, or `null` when idle; returns an unsubscribe function. |
| `setPageOverlapMode(mode)` / `getPageOverlapMode()` | `"exact"` (default) or `"fast"`: keep opaque overlapping pages batched even where depth cannot order them, e.g. while animating a layout. |
| `setPagePosition(index, x, y, z?)` | Set a page center in document-local coordinates; default Z is zero. |
| `setPageTransform(index, matrix)` | Replace a page's finite affine `THREE.Matrix4`. |
| `hasSearchableText` | Whether the scene has searchable indexed text. |
| `searchText(query, options?)` | Return matches with scene-space and object-local bounds. |
| `setSearchHighlights(matches, { currentIndex }?)` | Highlight matches and emphasize the active one; `null` clears them. |
| `setTextSelectionHighlights(rects)` | Draw scene-space `Bounds[]` or packed `Float32Array` selection rectangles; `null` clears them. |
| `clientToScenePoint(camera, x, y, element)` | Map client CSS pixels to PDF scene coordinates; may return `null`. |
| `sceneToClientPoint(camera, x, y, element, pageIndex?)` | Project PDF scene coordinates to client CSS pixels; may return `null`. |
| `pick(options)` | Asynchronously find a canonical drawing primitive under client coordinates; returns a hit or `null`. |
| `subscribePrimitivePreparationProgress(listener)` | Observe shared picking preparation (integer 0–100, or `null` when idle/reset/failed); returns an unsubscribe function. |
| `getPrimitive(ref)` | Read original style and detached scene-space geometry. |
| `setHover(ref)` / `setSelection(refs)` | Draw amber hover and blue selection traces; `null` / `[]` clears them. |
| `setPrimitiveOverrides(refs, { color })` | Temporarily replace vector RGB, preserving opacity, masks, and drawing order. |
| `clearPrimitiveOverrides(refs?)` | Restore specified primitives, or all overrides when omitted. |
| `clearPrimitiveInteraction()` | Clear hover, selection, and colors and release the picking index. |
| `getLayers()` / `getLayerOrder()` | Read PDF layer records and their display hierarchy. |
| `setLayerVisibility(id, visible)` | Apply one layer change; resolves after resources and visibility commit. |
| `setLayerVisibilities(changes)` | Atomically validate and apply an array of `{ id, visible }` changes. |
| `setAllLayerVisibility(visible, layerIds?)` | Show/hide all editable layers, optionally restricted to IDs, respecting locks and radio groups. |
| `getAllLayerVisibility(layerIds?)` | Read `{ checked, indeterminate, disabled }` for a bulk-toggle control from applied visibility. |
| `resetLayerVisibility()` | Restore the PDF's original visibility defaults. Annotation visibility is kept. |
| `getAnnotationLayers()` | List annotations whose compiled appearance can be shown or hidden, as `{ annotationId, visible }`. |
| `setAnnotationVisibility(annotationIds, visible)` | Show or hide compiled annotation appearances by `SceneAnnotation.id`; metadata and bubbles are unaffected. |
| `getAnnotationPrimitives(id)` | Return detached canonical primitive references for compiled appearances, including hidden paint; metadata-only annotations return `[]`. |
| `setAnnotationSelection(ids)` / `setAnnotationHover(id)` | Draw blue selection / amber hover traces for annotations; `null` clears the corresponding annotation state. |
| `pickAnnotation(options)` | Pick a compiled annotation appearance or metadata geometry in client CSS pixels; returns `{ annotationId, distancePx }` or `null`. |
| `getStructureElement(id)` | Read a detached tagged-PDF structure element, with its user properties, by `markedContent.elementId`. |
| `subscribeLayerVisibility(listener)` | Observe applied visibility snapshots; returns an unsubscribe function. |
| `subscribeLayerVisibilityProgress(listener)` | Observe preparation percentage or `null` when idle; immediately reports current progress and returns an unsubscribe function. |
| `setVectorLodMode(mode)` / `setTextLodMode(mode)` | Change LOD at runtime. |
| `setMinimumStrokeWidth(width)` / `getMinimumStrokeWidth()` | Set or read the minimum stroke width as a number of device pixels; defaults to `0` and persists across page/material changes. The setter also accepts legacy booleans. |
| `setPageBackgroundColor(r, g, b, alpha)` | Set normalized page background components. |
| `setVectorColorOverride(r, g, b, opacity)` | Set normalized vector override components. |
| `getVectorStrokeLodStats()` / `getTextLodStats()` | Inspect LOD statistics; may return `null` before data is available. |
| `prepareFrameForThreeRenderer(renderer, camera)` | Explicit preparation for advanced render pipelines; ordinary loops synchronize automatically. |
| `dispose()` | Release owned GPU resources, textures, geometry, and event listeners. |

Remove the object from its parent when disposing it:

```ts
pdf.removeFromParent();
pdf.dispose();
```

`attachControls()`, `fitToBounds()`, and `setViewState()` manage the internal
fallback viewport. In an ordinary Three.js integration, use your application's
camera and controls. Full method contracts: [HeprThreePdfObject](../src/threePdfObject.ts).

### Annotation selection and picking

An annotation list can select an annotation directly and select its list entry
from a canvas hit:

```ts
pdf.setAnnotationSelection([annotation.id]);
pdf.setAnnotationHover(annotation.id);

const hit = await pdf.pickAnnotation({
  camera,
  element: renderer.domElement,
  clientX: event.clientX,
  clientY: event.clientY,
  tolerancePx: 4,
  includeHidden: true,
  signal: controller.signal,
});
if (hit) selectListEntry(hit.annotationId);

pdf.setAnnotationSelection(null);
pdf.setAnnotationHover(null);
```

The camera and element work exactly as in `pick()`: HEPR handles recentering,
object transforms and independent page transforms. Tolerance and distance use
CSS pixels, independent of the drawing buffer's device pixel ratio. The default
tolerance is 4; it must be finite and nonnegative. `AnnotationPickOptions` and
`AnnotationHit` are exported from the package root.

Compiled appearances use the same canonical native traces as primitive
selection, independent of render LOD. Annotation selection and hover remain
visible after `setAnnotationVisibility(ids, false)`; ordinary primitive selection
keeps its existing visibility behavior. The two selections are independent and
shared primitive traces are deduplicated. Repeating unchanged annotation state
does not rebuild its highlights. PDF layers, Invisible/Hidden/NoView flags and
Popup annotations still restrict interaction.

`includeHidden` defaults to `false`. Setting it to `true` permits picking
appearances suppressed by `setAnnotationVisibility`, without changing rendering
or revealing hidden PDF layers. Annotations without attributable compiled paint
use metadata quadrilaterals, ink, polygon or line geometry, then bounds. This
also supports metadata-only AutoCAD SHX annotations, older HEPs and pages whose
appearances were rasterized together. A miss on usable compiled geometry does
not fall back to its bounding box; empty space inside an ink or polygon remains
empty. Metadata traces and stroke widths are approximations.

Within a page, the smallest projected annotation bounds among actual hits wins,
including metadata-only notes over compiled appearances. Equal areas prefer
the smaller hit distance, then the later source annotation index, later page
slot and lexicographic ID. Overlapping independently transformed pages follow
the same page depth and opaque-background policy as `pick()`.

`getAnnotationPrimitives(id)` uses cached paint-run ownership instead of scanning
all primitives. Its result includes every occurrence of that ID across pages
and is independent of visibility. Known annotations with no attributable paint
return `[]`; unknown IDs throw `RangeError`, as do selection/hover calls with
unknown IDs. Selection batches validate before applying. Appearance ownership
cannot be recovered from older HEPs or a single raster containing several
annotations; metadata remains usable, without changing the HEP format.

Picking lazily builds a spatial index of annotation geometry, avoiding the
whole-drawing picking index. Appearance indexing is limited to 65,536 spatial
blocks; unusually fragmented appearances use cooperative geometry scans with a
console diagnostic when that budget is reached. Preparation and geometric queries yield and support
cancellation; a visibility change during a query rejects with `AbortError`.
Hosts should cancel stale pointer requests when their camera changes. Very large
annotation traces fall back to metadata bounds with a console diagnostic;
metadata paths exceeding 65,536 points likewise use bounds. Resource limits may
reject an exceptionally large selection. `clearPrimitiveInteraction()` clears
both annotation and primitive interaction and releases their picking indexes.

### PDF annotations and HTML bubbles

Read `pdf.sceneData.annotations ?? []` for clone-safe `SceneAnnotation` records.
HEPR extracts metadata independently of bubble rendering. Native appearances
remain page content; missing highlights, underlines, ink and note icons receive
vector appearances. Unknown missing appearances use a diagnosed outline. Popup
annotations carry relationships only, without a separate drawable or hotspot.
Comment text never enters the page's searchable text index. Each compiled
appearance can be hidden at runtime or left out at load time; see
[hiding annotation appearances](#hiding-annotation-appearances).

Records preserve source `/Annots` order, including hidden annotations. Their
`id` is stable for the source PDF (see [annotation identity](#annotation-identity));
`sourcePageIndex` and `annotationIndex` are zero-based source indexes. `pageIndex` is the composed
scene page slot, so selected or reordered pages keep their source identity.
`bounds`, `quadPoints`, `line`, `vertices` and `inkList` use composed Y-up
scene coordinates. `pdfGeometry` retains the original PDF coordinates before
crop offsets, rotation, UserUnit and page placement. An annotation can extend
beyond its page crop; hosts should clip interaction to `scene.pageRects`.

`scene.pdfPages ?? []` contains `ScenePdfPage` mappings for displayed pages,
including pages without annotations. Each mapping has `pageIndex` (scene slot),
`sourcePageIndex` (PDF page), and a six-number `pdfToScene` matrix. Transform a
PDF destination `(x, y)` with `[a, b, c, d, e, f]` as
`(a*x + c*y + e, b*x + d*y + f)`. These mappings include crop, rotation,
UserUnit and grid placement. Do not assume a source page index is a scene slot;
a selected-page scene may omit the target page.

Decoded fields include `contents` (`/Contents`), `tooltip` (`/TU`),
`author` (`/T` for comments), subject, name, original PDF date strings, icon,
open state, color, opacity and border. Widgets use `field.name` for the
qualified field name, plus type, flags and decoded values; their `/TU` is the
field's alternate UI name and is resolved through the field ancestry.
`popupId`, `parentId` and `replyToId` link records without recursive objects.

`action` and `destination` are inert descriptions. URI, GoTo, GoToR and Named
actions include bounded `next` chains; local destinations resolve to source page
indexes where possible. Destination parameters stay in the target page's
original PDF coordinates. Unresolved names and unsupported action types are
retained. Parsing and loading never execute actions or follow links. The
package does not edit comments or interact with fields. Hosts can opt into
link navigation through the overlay's activation callback.

The optional HTML helper uses your existing projection and layer APIs:

```ts
import { createAnnotationOverlay } from "@soadzoor/hepr";

const bubbles = createAnnotationOverlay({
  getCanvas: () => renderer.domElement,
  adapter: {
    getScene: () => pdf.sceneData,
    getOptionalContentVisibility: () => pdf.getOptionalContentVisibility(),
    clientToScenePoint: (x, y) =>
      pdf.clientToScenePoint(camera, x, y, renderer.domElement),
    sceneToClientPoint: (x, y) =>
      pdf.sceneToClientPoint(camera, x, y, renderer.domElement),
    isInteractionSuppressed: () => drawingSelectionEnabled,
    // Optional: leave annotations the user turned off out of hover and activation.
    isAnnotationEnabled: annotation => !turnedOff.has(annotation.id)
  },
  // Optional: replace the bubble body while keeping its lifecycle and controls.
  renderContent(annotation, container) {
    const text = container.ownerDocument.createElement("p");
    text.textContent = annotation.contents ?? annotation.tooltip ?? annotation.subtype;
    container.appendChild(text); // Treat all PDF strings as text.
  }
});

// Call after camera/layer changes or in your existing frame loop.
bubbles.onFrame();
// After replacing the document or rendering backend:
bubbles.sceneChanged();
// During teardown:
bubbles.dispose();
```

Omit `renderContent` to use selectable plain text with tooltip/comment,
author/date and informational link details. Hover previews one bubble; clicking
or tapping a comment pins it. A pinned comment survives hover and backend
replacement for the same scene object. Another click, the close button, Escape,
hiding its layer or replacing its scene dismisses it. Dragging and multi-touch
never pin a bubble.

Link previews follow the pointer with an offset, flipping near viewport edges.
They have no close or action buttons and pass pointer events through to the
canvas. Links never pin, including unresolved links or links without an
activation handler; leaving the link dismisses its preview. Click or tap the
link itself, or press Enter while it is hovered, to activate it. Programmatic
`show(link)` only previews a link that is currently hovered.

Call `enable()` / `disable()` for a toggle, or `show(annotation)` /
`hide()` for an accessible host-provided annotation list. Call `onFrame()`
after visibility changes even when the camera is idle. Use
`isInteractionSuppressed` to give drawing or active text selection precedence.
Return `false` from `isAnnotationEnabled(annotation)` to leave an annotation out
of hover, previews, pinning, `show()`, activation and `pickSceneAnnotation`;
annotations underneath it can then be picked. A pinned bubble closes at the next
`onFrame()`.

Supply `onActivate(annotation)` to handle a click, tap or Enter on the canvas.
Return `true` when handled to dismiss the bubble; return `false` to keep the
normal pinning behavior for comments. Links dismiss after activation even if
unhandled. The callback runs synchronously in the input event,
so a host can call `window.open(url, "_blank", "noopener,noreferrer")` after
validating the URL. Optionally supply `getActivationLabel(annotation)` to show
an accessible action button in a comment bubble (return `null` for no button).
Link previews always omit this button.
The helper itself does not interpret or execute PDF actions.

The native viewer uses its renderer's `clientToScenePoint` and
`sceneToClientPoint` methods with the same helper. Native, three-example and
room-detection enable **Annotation bubbles** by default, with no permanent
hotspot markers. `pickSceneAnnotation` is also exported for custom UIs; it tests
individual markup quads, ink proximity and other annotation bounds.

All three examples opt into opening HTTP(S) links in a new tab and navigating
local `/GoTo` or `/Dest` links with a distance-aware camera animation: nearby
jumps have a subtle zoom arc, while longer jumps pull back as they move and
zoom in on arrival. Travel takes 450–1200 ms with a smooth departure and
ease-out arrival, preserving the destination's final position and zoom. The
preview follows the mouse while the canvas shows a pointer over interactive
annotations. Clicking the link activates it directly. Camera jumps respect
reduced-motion preferences and stop on user input, document replacement or
backend replacement. Dragging and active selection take precedence. The
**Annotation bubbles** toggle also enables/disables these link interactions.
Relative URLs resolve against the PDF's `/URI /Base` or its source URL when
available. Remote-file, Named, JavaScript and chained `/Next` actions remain
informational; unresolved destinations also retain their preview.

Navigation handles XYZ, Fit, FitB, FitH, FitBH, FitV, FitBV and FitR destinations.
Point destinations are centered for visibility; an unspecified zoom retains a
closer zoom or fits the destination page when leaving an overview. FitB variants
use the page crop because separate visible-content bounds are not available.
Destinations outside the selected pages remain informational.

HEP files preserve these records in an optional JSON section. Supported HEP
files written without that section load with an empty annotation collection.
Recovering their metadata requires reconversion from the original PDF. The
optional page mappings live in the same version-1 section; no HEP format version
changes. Files with older annotation sections still open: URLs work, and an
internal target can fit its page if another annotation identifies that page's
source index. Exact positions and targets on pages without annotations require
reconversion to include `pdfPages`.

### Annotation identity

`SceneAnnotation.id` comes from the PDF, not from load order:
`ref:<object>:<generation>` for an annotation stored as its own PDF object
(nearly all of them), or `page:<sourcePageIndex>:annotation:<annotationIndex>`
for one written inline in its page's `/Annots` array. The same PDF bytes give
the same ids in every session, compile path and page selection. HEP files store
them unchanged, so converting a PDF again keeps them. A page's `/Annots` array
that repeats a reference uses that annotation once and reports
`annotation.duplicate-reference`, so `(sourcePageIndex, id)` identifies one
annotation in a scene. An annotation object listed by several pages keeps its
id on each page.

Ids are local to one document; store them with your own document identity.
Incremental saves keep object numbers, and with them the ids. A tool that
rewrites the whole file (optimizing, linearizing, merging or splitting) can
renumber objects. For a key that survives such edits, prefer `name` (the PDF
`/NM` entry, which most authoring tools fill with a unique value and keep), and
fall back to `id`.

### Hiding annotation appearances

Hosts that draw their own markers over annotations can keep HEPR's compiled
appearances out of the way, either at load time or at runtime. Annotation
metadata, `pickSceneAnnotation` and the bubble overlay keep working in both cases.

At load time, `annotationAppearances: "none"` compiles no appearance and
`"forms"` keeps only form fields (Widgets, which often carry a drawing's title
block). `buildHep()` takes the same option and `PDFtoHEP.js` takes
`--annotation-appearances=render|forms|none`. The HEP records the mode, which
loads as `sceneData.annotationAppearances` (absent means `"render"`). A HEP
source ignores the loading option; convert the PDF again to change it.

```ts
const pdf = await pdfObjectGenerator(file, { annotationAppearances: "none" });
```

At runtime, every compiled appearance has its own annotation layer:

```ts
const ids = (pdf.sceneData.annotations ?? []).map(annotation => annotation.id);
await pdf.setAnnotationVisibility(ids, false);
pdf.getAnnotationLayers(); // [{ annotationId: "ref:12:0", visible: false }, ...]
```

`setAnnotationVisibility(ids, visible)` accepts any `SceneAnnotation.id` and
ignores annotations without a compiled appearance, such as popups, most links
and hidden annotations. Ids missing from the scene reject with a `RangeError`.
The promise resolves once the change is applied, and `subscribeLayerVisibility`
listeners are notified. A hidden appearance stops drawing, and `pick()`, search
and text selection skip it. An appearance inside a PDF layer shows only while
both are visible.

Annotation layers are not PDF layers. `getLayers()`, `getLayerOrder()`, the bulk
layer calls and `resetLayerVisibility()` leave them alone, and primitives report
them as `annotationId` rather than in `optionalContent.layerIds`. In
`sceneData.optionalContent` an annotation layer is a group with an `annotationId`,
stored locked and outside the view intent so that readers without annotation
layers cannot hide it through their layer controls.

`getAnnotationLayers()` omits appearances that cannot be toggled: those on a
page drawn as a single raster, those beyond the scene's layer limit (reported as
`annotation.layer-limit`), and all appearances in HEP files converted before
annotation layers existed. A toggle costs about as much as a PDF layer toggle,
so use it for user actions rather than per-frame effects.

NoZoom and NoRotate appearances, including most sticky-note icons, keep their
page geometry and scale with the page instead of forcing the page into a
raster; `annotation.view-transform-approximated` reports this.

`createPdfAnnotationControls({ container, controller, onChange?, onSelect?, onHover? })` mounts the
reusable **Annotations** panel used by all three demos. It lists every annotation
except popups and Invisible, Hidden or NoView annotations, each with a checkbox.
Turning one off hides its appearance through `controller.setAnnotationVisibility`.
Annotations without an appearance layer, such as most links, are turned off only
in the panel's own state. `isAnnotationEnabled(annotation | id)` reports that state
for every annotation; pass it to the bubble overlay so turned-off annotations stop
responding too:

```ts
import { createAnnotationOverlay, createPdfAnnotationControls } from "@soadzoor/hepr";

const annotations = createPdfAnnotationControls({
  container: document.querySelector<HTMLElement>("#pdf-annotations")!,
  controller: {
    getScene: () => currentPdf?.sceneData ?? null,
    getAnnotationLayers: () => currentPdf?.getAnnotationLayers() ?? [],
    setAnnotationVisibility: (ids, visible) =>
      currentPdf?.setAnnotationVisibility(ids, visible) ?? Promise.reject(new Error("No PDF is loaded."))
  },
  onChange: () => bubbles.onFrame()
});
const bubbles = createAnnotationOverlay({
  getCanvas: () => renderer.domElement,
  adapter: { /* ... */ isAnnotationEnabled: annotation => annotations.isAnnotationEnabled(annotation) }
});

// After replacing the document, its renderer or its PDF object (including null):
annotations.sceneChanged();
// At host teardown:
annotations.dispose();
```

For native views, pass `getAnnotationLayers` and `setAnnotationVisibility` from
`createLayerVisibilityController()`. `sceneChanged()` resets the panel when
`getScene()` returns a different scene object, starting from the applied
appearance state. For the same scene, as after a backend switch, it reapplies the
panel's choices to the new renderer. With a filter active, **All** affects only the
matching annotations. A failed change shows an error in the panel and returns the
checkbox to the applied state. The panel exposes CSS classes under
`.pdf-annotations`; `pdfLayerControls.css` includes them.

Pass `onSelect(annotation | null)` to give each row a selection button separate
from its visibility checkbox and add **Clear selection**. `onHover(annotation | null)`
reports row hover and keyboard focus. Use these callbacks with
`pdf.setAnnotationSelection(annotation ? [annotation.id] : null)` and
`pdf.setAnnotationHover(annotation?.id ?? null)`. After a canvas `pickAnnotation()`
hit, call `annotations.selectAnnotation(hit?.annotationId ?? null, { reveal: true })`.
This updates the selected row without calling `onSelect`, opens the panel, clears
a filter that excludes the hit, and includes the selected row within the 500-row
limit. `getSelection()` returns the selected ID or null.

The native and Three examples wire both directions and hover traces. Canvas
picking includes hidden appearances and annotations without compiled paint;
PDF visibility flags and document layers still apply. Choosing a row exits
Drawing Selection, and canvas picking pauses during drawing or text selection
gestures. Renderer replacement preserves selection for the same document.
The demos use `createAnnotationOverlay({ pointerInteraction: false, ... })` to
let the host's geometric picker own gestures and call `show(annotation, clientPoint?)`
and `hide()`; a client point anchors link previews. The default overlay continues
to handle its own metadata picking when this option is omitted.

### Drawing primitives

`pick({ camera, element, clientX, clientY, tolerancePx?, kinds?, signal? })`
accepts browser `clientX`/`clientY` values directly. Tolerance defaults to four CSS
pixels and does not require device-pixel-ratio adjustment. The result contains
`primitive`, the cursor `point` in composed scene coordinates, `closestPoint`,
`distancePx`, and an optional `segmentIndex` or mesh `triangleIndex`. When the
primitive paints a compiled annotation appearance, the hit and `getPrimitive(ref)`
also carry its `annotationId` (a `SceneAnnotation.id`); page content has none. In
tagged PDFs, `markedContent` identifies the structure content item that painted it
(see [tagged PDF structure](#tagged-pdf-structure-mcids)). The
last eligible painted primitive within tolerance wins. `kinds` filters eligible types, which is useful for a
measurement tool interested only in strokes. This queries canonical geometry,
not antialiased framebuffer pixels or simplified LOD geometry.

`PrimitiveRef` is `{ kind, index }`, where `kind` is `"stroke"`, `"fill"`,
`"text"`, `"raster"`, `"gradient-fill"`, or `"gradient-stroke"`. Stroke indices
identify individual segments; gradient-stroke indices identify complete runs.
Text indices identify glyph instances: a ligature is not necessarily one
Unicode character. Raster references identify whole layers, not shapes inside
their pixels. Invisible OCR text in the original scan view has no pickable render
instance; visible OCR overviews expose ordinary vector text primitives.

Proven uniform stencil patterns use one raster layer per painted grid. Its
optional `repeat: RasterRepeat` describes the reusable cell and its placements;
`data`, `width` and `height` describe the cell's pixels. Picking respects gaps
between cells and returns the grid's raster reference. Inspection and selection
outlines use the enclosing grid quad. `rasterLayers.length` counts stored
resources; `imagePaintOpCount` retains the logical image placement count.

`getPrimitive(ref)` returns `kind`, `index`, `ref`, `bounds`, `pageIndex` (or
`null` when ambiguous), original `color`/`opacity`, `segmentCount`, and
`getSegment(index)` / `getSegmentStyle(index)`. Each segment has detached `start`/`end` points and an
optional quadratic `control`. Stroke inspection includes `strokeWidth`; fill
inspection includes `fillRule`; raster inspection includes its transformed
`quad`, pixel `width`, and pixel `height`. Segment styles expose the original
color, opacity, and applicable stroke width, hairline/cap flags, and rectangular
clip. This preserves differing styles within a gradient-stroke run. Gradient
primitives also expose `gradientIndex` and `maskGradientIndex` into the retained
gradient store (`null` means a solid source or no mask). Gradient or mixed colors are `null`.
Mesh and function shadings use `"gradient-fill"` references with `shadingKind: "mesh"`,
`triangleCount`, and `getTriangle(index)`, which returns detached positions and vertex colors.
Geometry uses the same composed, Y-up scene coordinates as `sceneData`.

These are the retained drawing primitives. Extraction can merge lines, split
dashes, approximate curves, or rasterize content; HEP also quantizes coordinates.
Original CAD endpoints are not guaranteed to survive. Hosts supply drawing scale
for real-world measurements and implement snapping using the exposed segments.

References survive reopening the **exact same HEP artifact**. Store an immutable
document ID or artifact hash alongside `{ kind, index }`. Equal PDF bytes alone
do not establish compatible indices across different conversion settings,
pipelines, or versions. References are not portable between unrelated documents.
Invalid kinds/indices and invalid override batches throw before applying changes.

Hover and selection trace stroke centerlines, fill/glyph contours, and raster
frames inside geometric clips, using their own opacity independently of source
colors or gradient masks. They do not compute a new outline along clip edges.
Mesh highlights trace exterior triangle edges, preserving holes and disconnected
pieces while removing shared seams. Highlight extraction is bounded to 65,536
triangles per mesh and 8,192 paint-clip edges; an oversized highlight update rejects
atomically, leaving inspection and rendering available.
Color overrides accept `0xRRGGBB`, `#rgb`, `#rrggbb`, bare `rrggbb`, CSS named colors such as
`"red"`, or normalized sRGB `[r, g, b]` tuples. Gradients receive a flat RGB
override while retaining their alpha and masks; rasters cannot be recolored.
The existing global vector tint is applied after primitive overrides.

All interaction state is runtime-only. `sceneData`, PDF/HEP export, and file size
remain unchanged. The picking hierarchy is built lazily; very large scenes group
several primitives into each spatial leaf to stay within its 128 MiB estimated
packed-buffer build budget. They retain spatial rejection and the same canonical
references and paint order. The index retains the existing geometry arrays; additional memory is
used for packed bounds, ordering, sparse overrides, and selected/hovered trace
buffers. First-pick latency includes index construction; coarser leaves may
require more candidate checks on dense pages. Index building
and expensive queries yield cooperatively. An `AbortSignal` cancels that request's
wait or query; a shared index build can continue for other requests. Disposing the
object cancels the build and outstanding queries. Hosts should cancel or ignore outdated hover
results when the pointer, camera, or document changes.

`subscribePrimitivePreparationProgress()` immediately reports the current value,
then follows the shared index build even when one hover query is cancelled.
Clearing interaction or disposing the object reports `null`; unsubscribe when
detaching UI from an object. Observer exceptions do not interrupt picking.

For optional built-in mouse/touch handling, use
`createThreePrimitiveInteractionController({ getCanvas, getCamera, getPdfObject,
requestRender, onSelectionChange?, onPreparationProgress?, onError? })`.
The controller starts disabled. `enable()` attaches gestures; `disable()` clears
its selection, colors, picking resources, and listeners. It handles hover,
click/tap selection, Escape, drag/pinch suppression, pointer cursor state, and
outdated query results. It owns the PDF object's primitive interaction state;
use one controller per viewport and coordinate any text-selection mode in the host.

Call `onFrame()` after updating the camera and object transforms,
`sceneChanged()` after replacing the document, and `rendererChanged()` after
replacing a canvas or PDF object for the exact same `sceneData`. The latter
replays selection and colors. `setSelectedColor(color)`, `resetSelectedColor()`,
and `resetAllColors()` support host UI controls. Call `dispose()` before tearing
down the viewport. The controller toggles the canvas's `drawing-selection-hover`
CSS class; the host provides its cursor styling. See the
[controller example](examples.md#shared-drawing-selection-controller).

Overriding ordinary stroke/text colors temporarily forces exact rendering for
that class and restores the requested LOD mode when cleared. Highlighting alone
keeps LOD active. Batch large color changes; Three.js/WebGPU may upload a whole
modified texture even when only a few colors changed. Use hover traces for
frequent pointer feedback. Call `clearPrimitiveInteraction()` to release the
optional interaction resources without disposing the document.

### Tagged PDF structure (MCIDs)

In a tagged PDF, page content is wrapped in marked-content sequences whose MCID
links it to an element of the document's structure tree (PDF 32000-1 §14.7).
When a picked or inspected primitive was painted inside such a sequence, the hit
and `getPrimitive(ref)` carry `markedContent: { pageIndex, sourcePageIndex, mcid,
tag, elementId? }`. `elementId` is present when the structure tree maps the MCID
through the page's `/StructParents` entry; pass it to `getStructureElement(id)`:

```ts
const hit = await pdf.pick({ camera, element: renderer.domElement, clientX, clientY });
const id = hit?.markedContent?.elementId;
const element = id ? pdf.getStructureElement(id) : undefined;
const guid = element?.userProperties?.find(property => property.name === "IfcGuid")?.value;
```

A `StructureElement` has a document-local `id` (`ref:<object>:<generation>`),
its structure `type` (`/S`), `standardType` after the role map when it differs,
and the optional `title`, `alt`, `actualText`, `expansion`, `lang` and
`elementId` (`/ID`) strings. `userProperties` lists the entries of its
UserProperties attributes (§14.7.5.4), attribute classes first, as
`{ name, value, formattedValue?, hidden? }`. Text, number and boolean values keep
their type; other values are `null`. `parentId` leads to ancestors, such as a
storey or the document element. `sceneData.structureElements` holds every element
that owns painted content, plus its ancestors; `sceneData.markedContent` maps
primitive ranges to content items.

Attribution is resolved when the PDF is compiled and stored in HEP files, so it
needs no PDF at runtime, and it never splits draw runs. Items painted directly in
a page's content stream are attributed, together with everything a Form XObject
paints inside them. MCIDs defined inside a Form XObject's own content resolve
through that Form's `/StructParents`, which is not supported yet: that paint keeps
its enclosing page item, if any, and `structure.form-content-items` reports it.
Pages drawn as a single raster, and HEP files converted before attribution
existed, carry none. Malformed or oversized structure trees leave `elementId`
unset and report `structure.invalid`, `structure.limit` or `structure.unavailable`;
the page still opens. Page objects from `getPage()` report their own page slot;
the document object reports the composed slot.

### PDF layers (optional content)

Each PDF object owns its visibility state. Two objects can share a `VectorScene`
and display different layers. `getLayers()` returns detached records containing
`id`, `name`, `defaultVisible`, `visible`, `locked`, and `usedInView`. IDs are
opaque and document-scoped; duplicate names are valid. `getLayerOrder()` exposes
the PDF's group/label hierarchy. The original condition DAG and radio groups
remain available in `sceneData.optionalContent`.

```ts
const layers = pdf.getLayers();
const editable = layers.find(layer => !layer.locked && layer.usedInView);
if (editable) await pdf.setLayerVisibility(editable.id, false);

const unsubscribe = pdf.subscribeLayerVisibility(snapshot => {
  console.log("Applied layer revision", snapshot.revision);
  requestRender();
});

// Hide all editable layers in one batch, using IDs from getLayers().
await pdf.setLayerVisibilities(layers
  .filter(layer => !layer.locked && layer.usedInView)
  .map(layer => ({ id: layer.id, visible: false })));
await pdf.resetLayerVisibility();
// At teardown: unsubscribe();
```

Batches validate before changing anything. Locked groups and groups outside the
View intent cannot be changed. Enabling one member of a radio group disables its
other editable members; a conflicting batch rejects. Rapid changes supersede
pending preparation, which can reject an earlier promise with `AbortError`.
The previous applied state stays on screen until replacement resources are ready.
`subscribeLayerVisibility` reports applied revisions, not pending requests.

`setAllLayerVisibility()` skips locked/non-View layers. Enabling preserves current
radio-group choices, then enables compatible default-on or first eligible members.
`getAllLayerVisibility()` reports checked when all compatible editable layers are
on, mixed when further compatible layers can be enabled, and disabled when there
are no editable targets. The shared panel's **All** checkbox affects every layer,
including those hidden by its name filter.

Both a pick hit and its inspected primitive include
`optionalContent: { conditionId, layerIds }`. `conditionId` addresses the primitive's
draw-run condition (or is `null`); `layerIds` also includes dependencies inherited
through groups and masks. These are visibility dependencies, potentially negated
or involving several layers, rather than an exclusive ownership label. Ungrouped
content has an empty list. Resolve names through `getLayers()`. Annotation layers
are reported as `annotationId`, never in `layerIds`.

Hidden paints cannot be picked. Hidden hover/selection traces are cleared while
temporary colors remain available if the paint reappears. Visibility changes
invalidate stale picks, search results, text-selection layouts, and rendering
caches while preserving canonical references and the picking hierarchy. Library
hosts should refresh their search UI after a visibility notification. OCR/fallback
text uses retained character conditions even when it has no pickable glyph.

For native views, `createLayerVisibilityController({ getScene, getRenderer,
onChange?, onProgress? })` provides the same layer operations and shared fallback
preparation. Call `sceneChanged()` after loading a scene, `rendererChanged()` after
replacing its renderer, and `dispose()` at teardown. Its `onProgress` receives a
percentage or `null`. Separate controllers give separate view states.
`OptionalContentController` is the lower-level model with an optional resource
preparation callback; use the native wrapper when retained raster replay is needed.

`createPdfLayerControls({ container, controller })` mounts the reusable DOM panel
for either a PDF object or native controller. Connect native preparation progress
to its `setProgress()`, call `refresh()` after document replacement, and `dispose()`
at teardown. The panel exposes CSS classes under `.pdf-layers`; the standalone
viewer stylesheet is a styling example. All three demos mount the panel.

For Three.js hosts that replace PDF objects, `createThreePdfLayerControls()` shares
the binding and subscription lifecycle used by the Three.js and room demos:

```ts
const layers = createThreePdfLayerControls({
  container: document.querySelector<HTMLElement>("#pdf-layers")!,
  getPdfObject: () => currentPdfObject,
  requestRender,
  onVisibilityChange: () => {
    // Refresh host search results and text selection for the applied visibility.
  }
});

// After assigning a loaded PDF object (or null), before disposing its predecessor:
layers.objectChanged();

// For a backend replacement built from the same sceneData object:
await layers.prepareReplacement(replacementPdf, abortController.signal);
const previousPdf = currentPdfObject;
currentPdfObject = replacementPdf;
layers.objectChanged();
previousPdf?.dispose();

// At host teardown; PDF objects remain owned by the host:
layers.dispose();
```

The binding forwards preparation progress, requests frames after applied changes,
and ignores callbacks from detached objects. `prepareReplacement()` temporarily
disables panel changes, waits for pending panel operations, and applies the latest
visibility to the replacement before installation. It only transfers between
objects sharing the exact same `sceneData`; new documents use their PDF defaults.
The host remains responsible for its Three.js scene membership and renderer/canvas
lifecycle. Use the shared `pdfLayerControls.css` as the panel styling example.

Layer changes do not modify scene definitions, source geometry, or exports.
HEP stores initially hidden content and the original PDF visibility defaults.
Layer definitions and retained effects add file and memory costs compared with
earlier scenes; ordinary flat pages keep the existing rendering path. Effect
graphs use temporary GPU surfaces at the viewing resolution, subject to memory
budgets. Retained compatibility fallbacks may require asynchronous image replay
on a layer change. These temporary surfaces are never serialized as canonical
geometry. HEP schema v9 is required: regenerate older HEP files from their PDFs.
Replayable raster fallbacks use the retained PDF's original paints when computing
their backdrop correction. Temporary vector recoloring or a global tint does not
recolor that correction; layer-dependent backdrop changes are replayed.

## `buildHep(input, options?)`

Returns `Promise<Blob>` with MIME type `application/x-hep`. Save it with a `.hep`
extension. Import it from `@soadzoor/hepr/bundler` in a bundled browser app,
or `@soadzoor/hepr` in Node.

For conversion followed by display, `buildHepWithScene(input, options?)` accepts
the same inputs and options and returns `Promise<HepBuildResult>`:

```js
import { buildHepWithScene, createThreePdfObject } from "@soadzoor/hepr/bundler";

const { blob, scene } = await buildHepWithScene(file, { signal });
// Save or upload blob as the HEP file.
const pdf = await createThreePdfObject(scene, { sourceLabel: file.name, signal });
```

The scene contains the complete selected pages, including raster pixels and
applicable LOD caches prepared during generation. No generated HEP decode is
needed. Keep the returned scene object intact to preserve those caches; each
viewer still creates its own rendering resources. This API retains renderable
pixels and vector LOD indexes, using more memory than a blob-only export.
`buildHep()` continues returning only a Blob and streams large raster encodes.
Both browser and Node document sessions also expose `buildHepWithScene()`;
closing a session does not invalidate a successful returned scene.

| Input | Options |
| --- | --- |
| PDF source (`PdfObjectSource`) | `BuildHepFromPdfOptions`: shared encoding options, `password`, `pages`, `maxPagesPerRow`, `segmentMerge`, `invisibleCull`, `iccTransformResolver`, `iccEngine`, and `onDiagnostic`. |
| Parsed `VectorScene` | `BuildHepFromSceneOptions`: shared encoding options. |

PDF-to-HEP conversion compiles the complete original content. Viewing options
`compressScans`, `ocrTextOnly`, and `pageLoading` are not `buildHep` options.
Prepared GPU display data is not saved in HEP, including when exporting an
already-prepared scene; viewers rebuild it as needed from canonical pixels.

Shared encoding options are `sourceLabel`, `sourcePdfByteLength`, `encodeRasterImages` (default `true`),
`compression` (`"deflate"` by default, or `"store"`), `onProgress`, `onWarning`, and `signal`.

`withVectorLod` and `withTextLod` both default to `true`; set either to `false`
to omit the corresponding LOD cache. Caches are stored when applicable to the
scene. `vectorLodPrecision` defaults to `"compact"`; use `"lossless"` to disable
additional rounding of derived vector
coordinates. Text LOD storage remains lossless. The CLI includes both applicable
caches by default and offers `--without-vector-lod` and `--without-text-lod` to
omit them. The demo Download HEP dialogs also select available caches by default.
See [Node conversion](manual.md#node-conversion) for CLI usage.

Compressed writing requires native `CompressionStream("deflate")`; loading
compressed files requires `DecompressionStream("deflate")`.

Monochrome layers save full-resolution pixels and their two-color RGBA palette
losslessly, including when `encodeRasterImages` is false. They bypass PNG/WebP
encoding and reload as packed one-bit rows without expanding RGBA.
They use an 8-by-8 bit transpose and run encoding before DEFLATE for fast reload,
falling back to plain packed bytes if runs grow. Original JBIG2 streams are not
retained for export. The native and Three demo Download HEP dialogs offer only
applicable vector/text LOD options and download one file. Demand-loaded
viewers reuse their active PDF session, full vector overviews and cached scan
detail; only missing full pages compile. Raster/OCR previews are replaced by
complete content. Text-only views without an active session extract the original
PDF once. Full extraction leaves the viewing window
unchanged, and does not add a permanent second document to the viewing cache.
These exports use scene v10 (plain packed) or v12 (binary runs). Scene v13
optionally encodes repeated transparency wrappers and matching draw-run metadata
losslessly, preserving their group boundaries and paint order. Exports use v13
when repeated wrappers can share storage. Scene v14 stores compact regular
raster repeat grids with exact cell placement and sequential page translations;
it requires an updated reader. Scene v15 stores a repeated larger image once and
references it from its other placements; it also requires an updated reader.
Other scenes retain v9–v13. The current loader accepts v9–v15, including older JBIG2 HEPs,
which use the fast packed encoding when re-exported.

PDF-source builds measure the original PDF automatically. Scenes loaded through
HEPR carry that size, and HEP exports record it for later re-export. For a custom
scene or an older HEP, supply `sourcePdfByteLength` (a positive safe integer) to
enable the same size comparison. If the complete archive is at least as large
as the PDF, the writer warns through `console.warn` and `onWarning(message)`;
the download still succeeds and keeps all document content and requested LODs.
The demo viewers display the warning after download. Scenes without a known PDF
size skip the comparison.

A HEP built from a password-protected PDF stores the decrypted content and has
no password of its own. Pass an already-loaded `pdf.sceneData` to avoid parsing again. Export preserves
the PDF's original layer defaults, including initially hidden geometry, regardless
of the viewer's current layer settings. HEP retains fallback commands and assets;
it does not embed the original PDF for later image recovery.

Node hosts can install the optional `@napi-rs/canvas` backend for PDF operations
that need Canvas2D, image encoding, and encoded HEP image decoding. See the
[conversion examples](examples.md), [builder types](../src/hepBuilder.ts), and
[HEP format specification](HEP_CONTAINER.md).

### Rendering compatibility and diagnostics

PDF loading and PDF-to-HEP conversion prefer opening a usable document over
rejecting a page because the optimized vector representation cannot express it.
Axial/radial gradients, bounded tessellated shadings, large compound fills,
supported tiling patterns and Type3 programs retain canonical geometry. Groups,
standard blend modes, and alpha/luminosity masks use a shared ordered paint graph
and renderer-owned transient surfaces. Group opacity is applied to the group
result, preserving overlap between its children.

Embedded sfnt subsets may retain unused horizontal-metric bytes; HEPR ignores
these bounded tails with a normalization warning. Embedded PFA/PFB Type1 fonts
retain their original used glyph outlines, including built-in encodings and
PDF encoding differences. Explicit PDF character widths take precedence, and
Unicode mappings remain independent of painted glyph selection. Unsupported or
damaged Type1 programs can still use the configured substitute-font resolver;
`font.type1-substituted` includes the font-program failure reason and marks the
result as approximate. Type1 Multiple Master programs use the embedded
WeightVector, including standard blending OtherSubrs. Computed font records and
custom OtherSubrs can execute in a font-local PostScript interpreter; mutable
font state is shared within each glyph and isolated between glyphs. Unknown
custom OtherSubrs retain the Type1 format's argument-preserving fallback with
`font.type1-othersubr-approximated` diagnostics. The interpreter's font-local
subset supports font data, arithmetic and control flow, strings and token
conversion, dictionary stacks, matrices, local/global resources and VM allocation,
`stopped` error handling and `save`/`restore`. Memory-backed files and lazy
procedure sources support ASCIIHex, ASCII85, RunLength, LZW, Flate with predictors,
JPEG DCT, CCITT Group 3/4 fax (including standard uncompressed mode), SubFile,
reusable-stream and `eexec` decoding. The additional `JBIG2Decode` extension accepts
self-contained sequential pages, and `JPXDecode` accepts boxed/raw JPEG 2000
with 1-, 2-, 4-, 8-, 12- and 16-bit signed/unsigned samples, color output or a
separate `Alpha` plane. Subsampled components and YCbCr conversion are supported.
Low-bit rows are padded to byte boundaries; twelve-bit samples occupy sixteen
bits in big-endian order, matching the Ghostscript filter extension. Both consume through
source EOF; use a bounded SubFile source when executable font code follows the
encoded data. JPX supports a single alpha channel in any position, including
premultiplied samples (the filter preserves the source color values), and raw
two-component streams. Palette/channel-map expansion, multiple alpha planes,
mixed precisions and more than four codestream components retain diagnosed fallback.
JPEG, JBIG2 and JPX reuse the bundled decoders, prepared asynchronously during
PDF font loading; standalone synchronous font/VM callers must first await
`prepareBundledJpegCodec`, `prepareBundledJbig2Codec` or
`prepareBundledJpxCodec`, respectively. Preparation
caches compiled modules without allocating a persistent decoding heap.
Unavailable preparation retains a diagnosed fallback.
Retained streams preserve their
positions within each glyph and start independently for subsequent glyphs.
Glyph path, clipping, color and line-style operations retain ordered vector paint
records alongside the charstring outline. Lasting color, clip and stroke changes
also apply to the final implicit glyph paint. Type1 and CFF Type1 `seac`
components share their parent's glyph-local VM, graphics state and current path;
the combined outline receives one final implicit paint. Component execution
preserves mutable helper data, explicit paint order, clipping and CTM changes,
without using an independently cached component's state. Stroke settings not
changed by the program inherit the invoking PDF state. Type1 charstring
coordinates retain the character-space mapping established at glyph entry;
local PostScript CTMs transform explicit PostScript marks and stroke pens.
Sampled `image`, `imagemask` and
`colorimage` operations support 1-, 2-, 4-, 8-, 12- and 16-bit components and procedure,
file or repeating-string sources. Dictionary images use the current color space,
including Indexed string/procedure palettes, Separation/DeviceN alternate tint
procedures, and CIEBasedA/ABC/DEF/DEFG decoding, matrices and interpolated lookup
tables. These color spaces also support `setcolor`, source component queries and
graphics-state restoration. Standard Type 1 color-rendering dictionaries support
PQR white/black-point adaptation, LMN/ABC matrices and encode/range procedures,
RGB/CMYK RenderTables and their channel transforms. `currentcolorrendering`,
`setcolorrendering` and the ColorRendering resource/procedure-set lookup preserve
VM and graphics-state identity. The default is a canonical sRGB CRD with source
black-point compensation. CMYK device values from vector paints and CRDs remain
available to the PDF page's `DefaultCMYK` ICC profile, including final glyph
paints, stencils and pattern/shading colors. Without `DefaultCMYK`, an embedded
CMYK output-intent profile from PDF/X, PDF/A or PDF/E supplies display calibration
to device paints, images and font programs. The first supported embedded profile
is used; external profiles are not fetched. `color.output-intent-profile` identifies
the selection, and unusable intent entries receive `color.output-intent-ignored`.
This preserves supplied calibration
rather than flattening it to unprofiled RGB. The standalone VM preview and sampled
color images still use display approximations; missing profiles, physical inks,
paper and screening cannot be reconstructed from font data.
Colored and uncolored tiling patterns retain reusable vector cells, locked pattern
matrices, clipping, strokes and implicit charstring paint. Shading patterns and
`shfill` reuse ordinary PDF shading resources for device color spaces, standard
function dictionaries (types 0, 2 and 3), encoded meshes and numeric array meshes
(types 4–7, including reused triangle/patch edges). Numeric meshes stay vector;
32-bit coordinates and 16-bit components emit `font.postscript-mesh-quantized`.
CIE and spot shading spaces use a sampled source/CRD
transform, with `font.postscript-shading-color-sampled` for nonlinear or sharp
transition differences. The sampling grids have 257 points for one component,
17 per axis for two/three components, and 9 per axis for four components. Nonunit
CIE ranges are remapped to PDF unit tints through affine function outputs and
mesh Decode arrays, retaining interpolation, function clipping and vector geometry.
Transparent spot shadings and transforms with more than four inputs
retain diagnosed fallback. Shading data files must have an EOF boundary. Without
an explicit shading BBox, font-local `shfill` uses the font bounding box and diagnoses that finite-extent approximation.
The Canvas2D preview rasterizes mesh source components with 2x2 subpixel coverage
in sequential 32-row strips and composites each pixel once. This removes seams
from independent triangle antialiasing while preserving clipping, opacity and
blend modes. Temporary surfaces and sample buffers count toward `maxWorkingPixels`;
HEP mesh geometry remains vector. Boundary coverage can differ from other viewers.
Sampled images retain reusable RGBA image assets, clipping and source transforms,
with interpolation preserved through HEP save/reload and GPU texture sampling.
Noninterpolated stencils retain coalesced vector runs; interpolated stencils retain
image masks and inherit the invoking paint. Smooth interpolation algorithms can
differ between viewers, as permitted by the PostScript image specification.
ImageType 3 explicit masks support sample-, row- and separate-source interleaving,
independent mask resolution and mask interpolation. ImageType 4 color keys compare
raw samples before Decode. The retained page preserves separate mask assets;
HEP folds coverage into the source image grid. Different mask resolutions or
interpolation on either image emit `font.postscript-image-mask-resampled`, since
this folding can change mask-edge sampling. Standard ImageType 3 requires
coincident image/mask corners (PLRM 4.10.6); malformed, misaligned matrices now
receive `font.postscript-image-mask-misaligned` and a compatibility rendering.
Hard masks retain independently transformed vector clips. Interpolated masks
resample coverage on the source image grid with the edge-approximation diagnostic.
Access permissions, caller limits and cancellation
remain enforced. Device-dependent matrix queries require an explicit execution context.
Host filesystem access, printer/device control, striped/random-access JBIG2
font streams and the JPX layouts listed above remain unsupported; this is not a
general PostScript engine. Ordinary PDF JPEG 2000 images continue to use the
asynchronous codec, including its existing normalized higher-precision output.
Unsupported PostScript retains available geometry with diagnostics identifying
the failing operator.
Unsupported Type1 loader code that leaves readable declarative records uses
`font.type1-postscript-approximated`; failures computing required records can
still use the configured substitute resolver.

Track remaining JPX, spot-shading and physical press-calibration work in the
[font-local PostScript follow-up checklist](development.md#font-local-postscript-follow-ups).

The CFF v1 engine also supports Expert encodings and charsets, Type1 and Type2
charstrings, deterministic Type2 `random`, named FontSets, SyntheticBase
inheritance and legacy Multiple Master interpolation. CFF2 supports variation
stores, `vsindex`/`blend`, blended private dictionaries and FDSelect format 4.
PDF conversion uses the font's default variation instance; OpenType CFF2 metrics
come from `hmtx`. The low-level CFF parser also accepts normalized variation
coordinates. Raw CFF2 requires a CID/GID mapping because it has no glyph-name
Encoding.

PDF loading and conversion default to `embeddedFontPaint: "pdf"`: the PDF text
rendering mode controls fill/stroke and the font program's PaintType is ignored,
as required by the [Adobe PDF Reference, section 5.8, p. 439](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.6.pdf).
For documents that depend on Ghostscript's intrinsic Type1/CFF PaintType 2
behavior, pass `embeddedFontPaint: "font"` to `openPdf`, the PDF scene loader or
`buildHep`. This explicit compatibility mode retains the font's stroke width,
transformed pen, live joins/caps/dashes and zero-width hairlines, and emits
`font.intrinsic-paint-compatibility` once per affected font. Other PDF viewers may
show a different result. Explicit PDF text stroke modes use the raw glyph
contours and PDF line style in both modes. Ghostscript also differs on explicit
text dashes; HEPR retains the graphics-state dash pattern. Positive font strokes
become vector outlines, with diagnostics when curves or round joins require
approximation.
HEP stores the resulting geometry rather than complete font programs.
The retained Canvas2D renderer preserves one-pixel hairlines under affine
transforms; dashed curves can report `device-hairline-approximation` when their
curve or seam treatment is approximate.

Path, clip, glyph and resource complexity
has no default admission budget: conversion attempts vector processing on the
host device. Caller-supplied resource limits remain available. Typed-array and
wire-format ranges, allocation failures, cancellation and malformed-data checks
still apply. Optional clip indices use available GPU texture capacity and can
retain coarser indices or complete edge scans without replacing the geometry.
Unsupported paint features can still use retained lowering or raster fallback
with diagnostics.

Image decoders load on demand: JPEG, JPEG 2000 (`JPXDecode`), JBIG2
(`JBIG2Decode`, including globals), and fax images are supported. The bundled
JPEG 2000 and JBIG2 kernels come from PDF.js 6.4.299. Codec JavaScript and WASM
assets ship with HEPR and load relative to the deployed package, including in
parser workers; no third-party server or CDN is contacted to load a decoder.
The published package and bundler entry include those assets automatically.

Binary DeviceGray images of at least 256 pixels, including JBIG2 and fax images,
keep packed one-bit pixels through native compilation and worker transfer.
At original resolution, native WebGL and WebGPU use eight pixels per R8 base
texel with separate four-bit grayscale coverage mipmaps for filtered minification.
Two coverage values share each R8 atlas texel; shared shaders unpack them and
apply bilinear/trilinear filtering without blending packed bytes. Typical square
images use about 0.29 bytes per source pixel including mipmaps, versus 5.33 for
RGBA8. Full-resolution binary pixels remain exact. Mip coverage uses 16 shades,
with at most 8/255 error relative to the previous R8 mip values; later levels
average unquantized values so this error does not accumulate through the chain.
Reduced display tiers generate an R8 base directly from packed pixels and use
four-bit mips below it, without RGBA expansion or higher-resolution mip intermediates. Exact two-color
images loaded from existing HEPs can use the same GPU path. Both Three material
backends use the same representations. Preparation workers transfer the packed
atlases, and automatic memory planning includes their row/atlas padding.
Canvas 2D and exports retain RGBA compatibility.

When smaller, a shared compact atlas replaces the base and coverage textures:
32x32 blocks use uniform-value markers or share byte-identical payloads across
levels. Supported JBIG2 text regions also retain actual decoded symbol bitmaps
and placements, including arithmetic refinements. The renderer compares block
sharing with symbol sharing and chooses the smaller result, requiring at least
5% savings over ordinary packed storage. Both native and Three backends use the
same layout and filtering. Original pixels and the existing four-bit mip values
are unchanged. GPU residency charges the actual atlas size; subsequent budget
decisions reuse those measured costs without scanning pixels during rendering.
Unmeasured images retain conservative estimates. Unsupported JBIG2 composition
uses the metered PDFium bitmap decoder, and existing HEPs can still use block
sharing without symbol metadata. See [monochrome GPU storage](monochrome-gpu-storage.md)
for the format, limits and manual verification steps.

The bundled JPEG 2000 decoder emits 8-bit samples and requires an explicit PDF color space;
embedded straight alpha (`SMaskInData=1`) is supported. Explicit 16-bit JPX
samples, codec-defined color spaces, and premultiplied alpha (`SMaskInData=2`)
still require further integration, as do JP2 palette mappings that change the
codestream's component count. PDF Indexed images retain their palette indices.
`imageCodecResolver` can replace the bundled
decoders using the exported `NativeImageCodecRequest` / `NativeImageCodecResult`
contract; parser limits and output validation still apply.

Extended graphics states can select a font and size through `/Font`, including
fonts referenced directly from that state. Selection follows `q`/`Q` saves and
restores, `Tf` overrides, and inherited Form graphics state.

Malformed or unsupported effects and exhausted expansion budgets can still use
diagnosed selective or whole-page image fallbacks. HEP retains the replayable
program and assets beside these fallback slots so layer changes can regenerate
their pixels without the original PDF. Print separations and exact overprint
simulation remain outside scope.

The page image targets 2 pixels per PDF point (144 dpi for ordinary pages), capped
at 16 million pixels and 16,384 pixels per dimension. Parser image and decoded-byte
limits can lower these ceilings. Rasterized pages lose vector sharpness and geometry
needed for features such as room detection. Their extracted text index is retained
separately for search and selection; no text is painted twice. HEP stores the image,
text, and retained replay resources, with no source PDF needed when reopening it.

Raster texture resolution follows projected screen size, aggregate scene demand
and `navigator.deviceMemory`, when available. Images initially allocate preview
textures with a longest edge of at most 128 pixels. Visible images refine one per
frame as zoom requires more detail, with hysteresis between resolution tiers;
offscreen images return to preview size. Three also uses page projections and
visibility to select its tiers. This browser hint estimates rounded
system RAM, not total or available VRAM. The resident raster target is 1/32 of
reported RAM, bounded to 16–256 MiB; unavailable or invalid hints use a conservative
64 MiB target. No memory information needs to be provided by the user. Estimates
include mipmaps and overlapping tile gutters, and replacement preparation allows
one extra resident target for old and new textures. Native raster batches are
also charged to this target. These are heuristics rather than hardware allocation
guarantees; vectors, text, compositor surfaces and other applications use memory too.

Screen-sized images that fit retain their RGBA representation or exact packed
binary representation when original dimensions are needed.
Under memory pressure, native and Three WebGL2/WebGPU first try BC7 or ASTC 4x4 GPU
compression for eligible opaque images, then area-filter ordinary rasters to
smaller textures if aggregate demand still exceeds the target. Both formats
store 16 bytes per 4x4 block, about one quarter of RGBA8 storage for large images.
The device's extensions or negotiated features determine which format is usable;
no GPU name or memory information needs to be provided by the user.

Eligibility is conservative: packed binary images, transparency, small or thin
images, and sampled sharp edges or text-like detail avoid block compression.
`compressScans` permits sharp opaque scanned content to
use lossy blocks and emits a fidelity diagnostic. Packed monochrome stays on its
compact/packed path. Parse-time derivatives set a bounded minimum display tier
when their texture format is supported, so all scan pages can remain resident
together without regenerating their display data at the initial upload.
Pixel assessment uses the image contents rather than assuming a PDF codec is
photographic. This heuristic is not a guarantee that every detail is detected.
Packed binary display tiers also participate in the automatic resolution budget.
Original scene pixels and export data are retained regardless of display
compression or resolution. Refinement allocation failures retain the previous
drawable tier and emit a diagnostic.

The bundled MIT encoder kernels run on the renderer's existing GPU context or
device, with no added runtime dependency. A bounded reusable encoding workspace
is charged to the raster target; compressed blocks are uploaded without a
JavaScript readback. All mip levels and block padding are included in the
estimates, and texture coordinates retain the original image placement. Encoder
failures are diagnosed and replan budgeted RGBA textures so the document can
still open. Console warnings distinguish compression and automatic resolution
reduction from device texture-limit reductions.

Three uses its host renderer's public `ExternalTexture` bridge for compression,
with one encoder/workspace shared by independent page materials on that host.
Older Three versions without that bridge keep packed/R8 textures and automatic
resolution sizing. Independent page views share one document raster budget.
Parse-time reduced codec decoding and larger ASTC footprints (including 12x12) remain
separate stages; this implementation selects only the audited BC7 and ASTC 4x4
encoders.

Default PDF loading prepares and retains every overview before display, without
per-page scene rebuilds or waits for a frame between pages. Opt-in
`pageLoading: "auto"` uses metadata-only placeholders for large PDFs and a bounded
overview cache. The native and Three demos expose this choice through **Stream
pages**, unchecked by default; changing it reloads the retained PDF and keeps the
camera and layout. Vector pages retain their original
geometry at every zoom. Image-dominated pages with usable invisible OCR use
visible vector OCR for the overview, without decoding scan pixels. Only scans
without usable OCR get bitmap previews bounded to 96 pixels. Unsupported drawing
features can still use the diagnosed bounded raster compatibility fallback.
Scans load original content when a page exceeds 256 screen pixels and return to
the overview below 224 pixels; a bounded cache holds at most 12 detailed pages.
Both loading modes use the same scan policy. Camera projections include independent
page transforms and hidden pages. Zooming out selects the cached overview again;
cached detail remains available for later zooms without affecting the displayed tier.
`change` events with `reason: "pages-loaded"` tell hosts to refresh search,
annotation and selection UI and request a frame. `"raster-ready"` requests another
frame for texture refinement or an asynchronously prepared encoder.
Pending overviews show sharp animated page skeletons in both native and Three
backends. These are page-background shapes, so picking, search and exports do
not include their lines. `"page-loading-animation"` change events request another
host frame while a pending page is visible. Hosts can also read
`object.needsLoadingAnimation`; offscreen/hidden pages and reduced-motion
preferences stop these frame requests. The skeleton disappears as soon as the
page overview is installed, including when the actual page is blank.
`sceneData` represents the current viewing window when `isPageDemandLoaded` is
true. Search requests remaining previews in the background. For complete geometry,
use `await object.loadCompleteScene({ signal, onProgress })`, or `pageLoading: "eager"` at load.
For complete HEP export, pass that returned scene to `buildHep`; the Three demo
does this once and reuses the complete scene. Cached complete
pages skip parsing; missing full pages still need compilation. Disposing the object closes
its worker and releases page caches.

Images wider or taller than the GPU's texture limit are drawn as several tiles
when the automatic scene budget permits. Native WebGPU requests the adapter's full limit, often 16,384
texels instead of WebGPU's default 8,192. In three.js the host renderer's limit
applies; `WebGPURenderer` uses 8,192 unless it is created with
`requiredLimits: { maxTextureDimension2D }`. An image with more pixels than the
device's largest texture is resampled to fit that many, and a console warning
gives its original and drawn sizes.

`onDiagnostic` receives these diagnostics (also retained by `PdfSession.getDiagnostics()`):

| Code | Meaning |
| --- | --- |
| `page-raster-fallback` | A whole page became an image; details include the original reason, pixel dimensions, and scale. |
| `compositing-approximation` | Unsupported group/stroke behavior was approximated for screen output. |
| `gradient-approximation` | Adaptive gradient sampling reached coordinate precision or a caller-supplied limit before meeting the color tolerance. |
| `extgstate-approximation` | A print color/halftone setting or nonidentity transfer function was omitted for screen output. |
| `image.resolution-reduced` | An image too large to decode within the stream limit was decoded at 1/2, 1/4, or 1/8 resolution. |
| `image.ccitt-size-adjusted` | Fax image data had more or fewer columns or rows than the image declares; it was cropped or padded with white. |
| `image.stencil-resolution-reduced` | A caller-supplied stencil pixel allowance required box-filtering the masks by the same factor, given in details. Full-resolution masks are attempted by default. |
| `clip-curve-approximation` | Informational: curved clip boundaries use vector edges at a 0.0001-point subdivision tolerance before Float32 storage. The tolerance does not increase with the edge count. |
| `clip-curve-precision-limited` | Floating-point subdivision could not refine a curved clip further; it retains the closest representable vector edges. |

Stitching-function boundaries are sampled as hard color transitions. Gradient
color-tolerance misses are nonfatal. Explicit caller resource limits and actual
representation constraints remain enforced. `/BG2`, `/UCR2`, and `/TR2` take precedence over their older entries.
Default resets are accepted; unsupported custom functions use the screen defaults
with a warning. In particular, BG/UCR can affect RGB-to-CMYK conversion inside a
transparency group, so their omission is an approximation even for RGB output.

The low-level Canvas2D renderer also accepts `onDiagnostic` for gradient and
hairline fidelity warnings.
Cancellation, malformed required data, custom resolver errors, and hard resource
limits are not converted into successful output. Fallback uses HEPR's own renderer,
so features that it cannot compile or render can still fail. Node raster fallback
requires the existing optional `@napi-rs/canvas` backend; no dependency is installed
automatically. The CLI prints warning diagnostics.

### ICC colors

PDF loading and PDF-source `buildHep` calls default to **Mozilla qcms**. Both
engines ship as separate WASM assets with HEPR. The preferred engine loads only
when page compilation needs an ICC profile; the second loads only on fallback.
The choice applies per profile, so one unsupported profile does not change the
preferred engine for other profiles. The available settings are:

| `iccEngine` | Conversion order |
| --- | --- |
| `"qcms"` (default) | qcms → Little CMS → alternate colors |
| `"lcms"` | Little CMS → qcms → alternate colors |
| `"alternate"` | Skip both engines and use alternate colors, with an approximation warning. |
| `"none"` | Disable built-in conversion and approximation; reject ICC content requiring conversion unless a custom resolver is supplied. |

Fallback occurs when an engine cannot load or cannot convert the profile;
metadata-only parsing and PDFs without ICC colors load neither. Browser assets
are fetched relative to the HEPR package, and Node reads the packaged files.
There are no new runtime npm dependencies or third-party CDN requests.

```ts
const hep = await buildHep(pdfBytes, {
  iccEngine: "qcms", // optional; this is the default
  onDiagnostic: diagnostic => console.warn(diagnostic.message)
});
```

These options also apply to `openPdf`, worker sessions, and PDF scene loading.
An `icc-engine-fallback` warning identifies a switch to the other engine; this
alone does not mean alternate colors were used. If both engines fail, or
`"alternate"` was selected, an `icc-alternate-used` warning explains that colors
may differ from the intended appearance. Warnings are emitted once per affected
color space per page, not per pixel or paint operation. Their `details` include
the requested `engine`, `effectiveEngine`, and `qcmsFailureReason` /
`lcmsFailureReason` (`engine-load-failed`, `profile-unsupported`, or `null` when
that engine did not fail).
Selecting `"alternate"` on a PDF without ICC colors produces no ICC warning.

Little CMS supports Gray, RGB, CMYK, and Lab inputs; the bundled qcms adapter
supports Gray, RGB, and CMYK, with ICC Lab profiles falling back to Little CMS.
Both engines use relative-colorimetric sRGB and bounded RGB8 lookup tables, so
this is not a print-proofing pipeline.

For a caller-owned engine, supply `iccTransformResolver`. This overrides
`iccEngine` (including `"none"`) and prevents either built-in engine from loading.
HEPR sends isolated profile bytes and normalized sample batches, and expects
packed sRGB samples; see the exported `NativeIccTransformResolver`,
`NativeIccTransformRequest`, and `NativeIccTransformResult` types. The existing
custom-resolver contract is unchanged: `/Range` endpoints map to zero and one.
Built-in engines instead clip source values to `/Range` and encode the profile's
native color model, including ICC Lab8. Caller-resolver errors, malformed profile
headers, cancellation, and resource-limit failures still reject.

The `PDFtoHEP.js` CLI accepts `--icc-engine=qcms|lcms|alternate|none` and prints
fallback warnings. It also accepts `--annotation-appearances=render|forms|none`
(see [hiding annotation appearances](#hiding-annotation-appearances)). The former `iccFallback` API option and `--icc-fallback` CLI
flag have been removed; use `iccEngine` alone. Retained page data uses version 8,
which includes prepared ICC transforms and fallback decisions
for gradients and compositing. Version 7 retained pages must be regenerated;
the HEP container and saved scene formats are unchanged. Existing HEP files keep
their saved colors, and opening them never loads an ICC engine.

## Search and selection

`pdf.searchText(query, { caseSensitive, maxMatches })` defaults to
case-insensitive matching with a 5,000-match limit. Whitespace matches across
line breaks. Results use zero-based composed `pageIndex` values and UTF-16 text
offsets. Use `localBounds` for navigation in the object's local space, and
`highlightBounds` / `localHighlightBounds` for tight rectangles around wrapped hits.

For a custom scene pipeline, `createSceneTextSearcher(scene)` returns a searcher
with `hasText` and `search(query, options?)`. `createTextSearchController(options)`
adds query state and next/previous navigation for native renderer integrations.
See [search contracts](../src/textSearch.ts).

`createTextSelectionController(options)` adds mouse and touch selection, copy,
and selection overlays. Supply `getCanvas` and a `TextSelectionAdapter` that
exposes the scene, coordinate conversions, and highlight drawing. The optional
`setCameraInteractionEnabled` adapter callback coordinates selection with camera controls.

Call `updateOverlay()` after rendering to position touch handles and the copy
popup, `refreshHighlights()` after switching backends, and `dispose()` on teardown.
The controller also provides `enable()`, `disable()`, `clearSelection()`,
`getSelectedText()`, and asynchronous `copySelection()`. See the
[selection adapter and controller types](../src/textSelection.ts) and
[integration examples](examples.md).

Both features use the scene's text index in PDF and HEP documents. Text geometry
helpers `computeCharQuad` and `computeCharRangeBounds` are also exported;
their coordinate and buffer contracts are in [sceneTextGeometry.ts](../src/sceneTextGeometry.ts).

## `detectRooms(scene, options?)`

Returns `Promise<RoomDetectionResult>`. The detector loads on first use and requires
Web Worker support in browsers. Non-browser environments without `Worker` run it
on the calling thread.

Pass `pageIndexes` to select zero-based scene pages, `seeds` for explicit seed
points, `signal` to cancel, or `collectDebugInfo: true` for diagnostics. Enable
`extractText` when loading a PDF to supply room-label text items; HEP scenes use
their saved text index as a seed source.

Results include `rooms` and `failedSeeds`. Each room provides a flat `polygon`
coordinate array, `area` in scene units squared, `labelText`, `roomNumber`, and
`hasDoorEvidence`. Thresholds and wall-detection controls are described in the
[room detection types](../src/roomDetector.ts); see also [quality and evaluation](room-detector-quality.md).

## Node sessions and native viewer integration

The [Node entry](../src/nodePdfSource.ts) exports `createNodeFilePdfSource(path,
options?)` for random-access local-file reads, `openPdfInNodeWorker(source,
options?)` for a PDF parser session, and `createNodeBundledStandardFontResolver(options?)`
for lazy bundled font loading. Close worker sessions with `await session.close()`;
close a file source yourself if it is never handed to a session. Session options
and methods are defined in [workerClient.ts](../src/pdf/workerClient.ts) and
[nativeTypes.ts](../src/pdf/nativeTypes.ts). Pass `password` in the session
options for a PDF that requires one; see [password-protected PDFs](#password-protected-pdfs).

Both direct `PdfSession` and worker sessions expose
`await session.getPageAnnotations(sourcePageIndex, { signal })`. This reads
metadata without compiling page content or decoding appearance streams. It
returns detached `PdfAnnotation` records with page-native Y-up geometry,
including crop, rotation and UserUnit, before scene placement. Newly compiled
`HeprPageData.annotations` and `VectorScene.annotations` are arrays, including
an empty array for pages without annotations. Optional malformed fields emit
`annotation.metadata-invalid` diagnostics while preserving usable fields;
cancellation and resource limits remain enforced.

`compilePage()` and `compilePages()` accept `annotationAppearances` with the same
meaning as the loading option. In `HeprPageData`, each compiled appearance is an
`invoke-program` command carrying a marked-content node tagged `Annot`, whose
`propertyName` is the annotation's `id`; its paint inherits that node, however
deeply its programs nest.

```ts
import { createNodeFilePdfSource, openPdfInNodeWorker } from "@soadzoor/hepr/node";

const session = await openPdfInNodeWorker(await createNodeFilePdfSource("drawing.pdf"));
try {
  const annotations = await session.getPageAnnotations(0);
  console.log(annotations.map(({ id, bounds, contents, tooltip }) =>
    ({ id, bounds, contents, tooltip })));
} finally {
  await session.close();
}
```

The standalone native viewer is a repository application. Its renderer classes
are source modules, not named exports from the npm entry point. Use
[main.ts](../src/main.ts) as the integration example and
[RendererApi](../src/rendererTypes.ts) as the backend contract for
[WebGL](../src/webGlPdfRenderer.ts) and [WebGPU](../src/webGpuPdfRenderer.ts).
The classes are named `WebGlPdfRenderer` and `WebGpuPdfRenderer`. The deprecated
`WebGlFloorplanRenderer` / `WebGpuFloorplanRenderer` names and their old source
module paths forward to the same classes for compatibility. WebGL's former
`WebGlFloorplanRendererOptions` type aliases `WebGlPdfRendererOptions`.
The exported `createCanvasInteractionController(getRenderer)` attaches native
pan/zoom controls; its lifecycle is documented in [canvasInteractions.ts](../src/canvasInteractions.ts).
