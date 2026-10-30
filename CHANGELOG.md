# Changelog

User-facing changes are recorded here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Add notes under `Unreleased` alongside the implementation. Release automation
moves those notes into a dated version section and uses them for the GitHub Release.

## [Unreleased]

### Added

- Add URL and same-document object links to selected content, including precise
  multi-line highlighted text. Provide toolbar/context actions, Ctrl/Cmd+K and
  destination picking, with undo, locks, copy/page-duplication rebinding and local
  draft recovery. Save invisible standard PDF Link annotations and named
  destinations without altering artwork; retain links in flattened PDFs and HEP.
  References follow identifiable targets while editing; anonymous source targets
  reopen as ordinary PDF destinations when their identity cannot be retained.
- Add per-page alignment, equal-gap distribution and cached movement snapping
  guides, with Alt/Option bypass and one-step Undo. Add glyph-bound highlights,
  underlines, strikeouts and comments with standard PDF annotations and explicit
  appearances, plus separate object/group editing locks and reusable host APIs.
- Add local IndexedDB recovery for committed authoring state and pending text,
  form and comment drafts. Offer Restore/Discard/Later without overwriting older
  drafts; encrypt protected-source drafts without storing passwords. Keep
  recovery separate from PDF/HEP persistence, history and the clipboard.
- Add independent fill opacity for editor shapes, ink and signatures, with
  linked sliders and numeric inputs for color/fill opacity in 0.1 steps from
  0 to 1. Preserve separate paint alpha in PDF/HEP output and retain the fill
  when changing stroke opacity; slider drags commit one undoable change.
- Add undoable PDF layer (OCG) management in the native and Three.js editor
  Settings docks: create, rename, nest, reorder, remove while retaining artwork,
  set saved visibility/locks, choose an active layer and assign selected content.
  Put inline naming, default visibility and visibility lock in compact rows;
  mouse/touch/pen drag grips reorder whole layer subtrees with insertion markers,
  edge scrolling, cancellation and keyboard alternatives. Keep normal touch
  scrolling outside grips. The blue active row chooses the creation/paste
  destination without disturbing artwork selection; remove the redundant
  active-layer dropdown and retain an Unlayered row. Add toolbar/context-menu and Ctrl/Cmd copy,
  cut and paste, including paste-in-place, independent current source appearances,
  authored groups, destination-layer assignment and Undo/Redo. Keep clipboard
  data in memory and retain originals when capture fails or is cancelled.
  Retain compound memberships and portable fonts when editing or reassigning
  reopened textboxes; hide text drafts and form controls with their layers
  without discarding their contents.
  Reordering also changes visual stacking while retaining unlayered paint slots
  and atomic compositing groups. Add a Select-tool context menu to bring objects
  to front/forward or send them backward/to back within each layer, with
  multi-selection, undo/redo, matching picking and PDF/HEP persistence. Keep
  drawing order and author models through page rotation, insertion and removal.
  Preserve edited layers in PDF and HEP; offer a
  flattened PDF copy for exact stacking across page graphics and editable
  annotations/form widgets, whose paint passes differ in standard PDF readers.
- Ask whether dropped PDF/HEP documents should replace the loaded document or
  attach their pages at the end, in View or Edit in both viewers. Support ordered
  multi-file drops, password-protected PDF imports and legacy HEP ZIP files;
  attachment keeps current edits and supports Undo without leaving View.
- Insert PNG, JPEG and WebP files dropped onto document pages in Edit, retaining
  full image resolution and transparency with cancellation and stale-drop guards.
- Double-click an editable form field with Select to activate Fill and focus the
  clicked widget, including empty and transformed fields. Recognize click pairs
  across redrawn selection handles and pending object picks; ignore click jitter
  before starting transform previews so it cannot delay or block field activation.
- Show reusable signatures as selectable vector previews beside their names.
  Fit compact quadratic curves for signatures and pencil drawings, straightening
  sampling jitter while retaining endpoints, corners, pen lifts and loops.
  Simplify stored points in new smoothed captures; retain raw template
  compatibility and share curves between previews, rendering and PDF/HEP output.
  Highlight the active signature tool and show a translucent placement preview
  centered on the cursor, matching the placed copy's size, color and stroke.
- Add an on-demand Edit mode to the native and Three.js viewers, with AcroForm
  filling, mixed-format textboxes and portable fonts, vector shapes and ink,
  reusable local handwritten signatures, image import, multi-selection,
  transforms, undo/redo, PDF/HEP saving and PDF printing. View remains the default.
  Show a canvas-bounded loading card before tools load and through the first
  editable frame, including re-entry and with Settings closed. Report setup
  stages with a spinner, measured page/field progress or an indeterminate bar.
  Cancel from the mode button; failed or cancelled setup restores View, retains
  earlier edits and removes setup UI and listeners without stale updates.
- Expose reusable editor sessions, shared interaction controls, font/form
  services and a vector-first scene-to-PDF writer with cancellation and progress
  reporting. PDF saves preserve source forms, annotations and supported
  encryption. Prepare source-operation provenance only on demand for saving;
  rewrite affected paths, text glyphs, images and individual shared Form
  invocations while retaining unrelated operations and resources. Diagnose
  bounded vector fallback for operations that cannot be rewritten independently.
- Bake edits into ordinary HEP rendering data without embedding the original
  PDF, source font files or editor history. HEP-only documents can be transformed
  and rebuilt as PDFs with searchable outline text and layers; original
  authoring semantics are not reconstructed.
- Add PDF output password controls and a direct `changePdfProtection` API to
  preserve, remove or replace protection. New passwords use AES-256; changing
  protection rewrites the final object graph without retaining old revisions.
  Editable and flattened PDF copies support the same settings; HEP remains
  unencrypted and passwords are kept in memory only.
- Add undoable page management: rotate pages in 90-degree increments, remove,
  reorder, duplicate, extract and crop pages, and insert or merge PDFs with
  independent input passwords. Support mouse/touch/pen page reordering and
  keyboard alternatives; cropping retains hidden content. Expose
  matching editor methods and native `manipulatePdfPages` APIs; preserve page
  resources, editable fields/annotations and destination protection, and
  namespace colliding imported fields. Retain authored object models through
  page changes and refresh viewer layouts, picking, thumbnails and search.

### Changed

- Pan the camera with the held middle mouse button in any editing tool across
  native/Three.js Reader and Grid layouts. Restore the complete object context
  menu, including Duplicate, Copy, Cut and Paste alongside drawing order.
- Show mixed/contextual appearance properties and apply supported group changes
  to descendants. Keep drawing defaults independent of the selected objects.
  Report browser downloads separately from confirmed file writes, retaining
  local edits and recovery when a browser save or print dialog may be cancelled.
- Dock Settings to the right of the document in the native, Three.js and room
  detection demos, reserving canvas space instead of covering it. Closing
  Settings restores document width; editing tools stay within the canvas column.
  Keep opacity sliders compact and let their control rows shrink or wrap inside
  the dock, preventing horizontal overflow in the native and Three.js viewers.
- Share compact vector icons across View and Edit controls, including page and
  password actions, PDF/HEP saves, flattening, printing, navigation, zoom, search
  and downloads. Retain descriptive hover titles, accessible labels and keyboard
  focus; mode and busy-state updates preserve icons without rebuilding unchanged
  button contents. View icons do not load editing or font services.
- Expose Print in the main native and Three.js toolbars in View as well as Edit.
  Preserve retained edits and loaded page selections; print unedited PDFs from
  their original resources and HEPs through the vector PDF writer. Reuse supplied
  passwords for temporary printable copies, with a PDF-download fallback.
- Preserve proportions during corner resizing by default; hold Shift for free
  resizing, including while dragging. Textbox frames retain wrapping and their
  proportions; Alt scales their appearance, with Alt+Shift allowing free scaling.
  Snap rotation drags to the nearest absolute multiple of 45 degrees, including
  zero, only within 5 degrees (inclusive); other angles rotate freely. Hold
  Alt/Option to bypass snapping, including modifier changes without pointer
  movement and on release.
  Display the current angle with the rendered frame and make numeric Rotate set
  its absolute signed angle, so repeating a value does not rotate it again.
- Discover choice options, button states, alignment and text limits on entering
  Edit mode so fields can be validated and displayed consistently.

### Fixed

- Compile links attached to original page primitives and groups with their exact
  layer visibility, keeping same-document destinations usable in Read mode and
  preventing failed Edit re-entry. Wait for the current committed frame before
  leaving Edit, including link changes that do not add visible drawing geometry.
- Keep shared ancestor clips fixed when transforming only some of their content,
  while moving clips owned by the transformed objects. Use the same ownership
  rules for cached drag previews and compiled output.
- Restore hidden and partially cropped artwork when resetting page crops after
  restacking, without doubling translucent paint. Move page-owned clips and
  transparency/mask bounds together during whole-page placement.
- Render explicit device-RGB transparency groups in Canvas2D, including saved
  highlight appearances, while retaining checks for other managed blend spaces.
- Keep export preparation and serialization isolated from editing commands;
  retain drafts on cancellation and reject stale picks after camera changes.
- Open saved PDFs whose layer identifiers collide with internal form/annotation
  visibility controls. Allocate distinct controls without changing PDF layers,
  and keep field visibility independent in document rendering and thumbnails.
- Detect artwork that may overlap PDF form fields and offer editable or flattened
  copies at save time. Explain Chrome's separate form-field rendering pass;
  flattened copies keep artwork above fields, while editable copies retain fields
  and annotations. Warn API callers without silently flattening their output.
- Preserve stored butt and round stroke caps in rebuilt and flattened PDFs,
  including dash gaps and zero-length strokes, instead of rounding every line.
- Save added textboxes with PDFium-compatible font encodings, fixing rectangles
  and displaced letters in Chrome. Retain embedded font bytes, Unicode mappings
  and editable appearances; large textboxes share font programs across additional
  encoding resources instead of truncating text or duplicating font data.
  Paint combining-mark continuations as vector outlines while their cluster text
  remains searchable, avoiding fallback control characters in independent readers.
- Keep document selections, handles and editing controls inside the canvas and
  below toolbars, Settings, thumbnails and menus in both viewers. Constrain
  text-selection popups and annotation bubbles to the visible document viewport
  while retaining captured drags beyond its edges.
- Restore Reader wheel scrolling over the editor's Select and drawing overlays
  in both viewers, retaining normal scroll distances and Ctrl/Cmd-wheel zoom.
- Preserve form fields' local dimensions, rotation and scaling while typing and
  regenerating appearances, including HEP-only editing. Retain transformed field
  planes when reopening and filling PDFs saved by HEPR, without adding HEP data.
- Align editable form controls with each document draw in native and Three.js
  viewers so borders stay synchronized during zoom and pan. Preserve focused
  inputs and drafts, and detach frame notifications in View mode.
  Keep current field values visible after blur until their matching regenerated
  appearances are drawn, avoiding stale-value flashes for shared widgets, rapid
  edits and cleared fields. Retain drafts when regeneration fails or is superseded.
- Retain the final pen position, empty-coalesced-event samples, closed pencil
  loops and taps. Keep signature capture proportions consistent with its preview.
  Match pencil and shape previews to committed curves/outlines, document-scaled
  widths, colors, fills, arrowheads and separate opacities. Preview rectangles,
  ellipses, lines, arrows, polygons and polylines; follow the next polygon segment
  on its original page, retain first-click styles and finish only clicked vertices.
  Keep pending drawings and signature copies independently until their matching
  rendered frames take over. Allow another drawing on the same document during
  compilation and wait for preview handoff before returning to View.
- Match form input fonts to their PDF family, weight, color and point size,
  retaining document zoom and using PDFium-style automatic text sizes. Preserve
  original check/radio appearances without duplicate browser marks or doubled
  text; keep declared text sizes when saved field content overflows. Share font
  loading between widgets and omit typing styles from compact HEP exports.
  Use black vector marks following standard PDF button captions during pending
  updates, preserving check-styled radio fields and native keyboard/group behavior.
- Reuse deterministic substitute fonts when recompiling edited form appearances,
  so PDFs with nonembedded Type1 fonts can be saved and printed after filling.
  Preserve source font resources and honor custom font-asset loaders.
  Reuse canonical PDF field appearances across transforms when source, values
  and target widgets match, retaining current geometry, clips and paint slots.
  Cancel obsolete preparation without consumers while preserving reusable work
  and active save snapshots; retain only the current cache per source session.
- Synchronize transform selection frames with the matching rendered preview in
  native and Three.js viewers, including release and cancellation. Coalesce new
  pointer positions and serialize scene publication so older asynchronous updates
  cannot overtake newer content or leave the frame ahead of the objects.
  Reuse identical glyph-store resources across authored moves so the existing
  text-atlas cache survives, while instance and search geometry remain current.
  Prepare supported translations once and update selected text/path/field geometry
  without repeating field, layer or page compilation. Reuse native WebGL/WebGPU
  buffers and Three.js material textures for compatible poses, preserving private
  antialiased clips and paint order; independent Reader page views and unsupported
  transforms/content keep the regular path. Coalesce poses before the next frame,
  avoid redundant toolbar/hidden-field and page/search/thumbnail work, and retain
  normal LOD, commit/cancel/View updates and matching-frame acknowledgments.
- Keep selection frames and handles aligned with rotated or transformed content,
  including rotated corner squares after committing, reselecting and undo/redo.
  Keep corner squares at a constant screen size as the viewport zooms. Resize and
  numeric W/H controls follow the frame's axes, and corner cursors follow its angle.
  Keep handle drags on their page plane across Reader margins. Expose committed
  frame geometry through `EditorSession.getSelectionFrame()`.
- Keep editor cursors and handles aligned with the active tool: show transforms
  only in Select, use rotation, diagonal resize, text and pencil cursors, and
  show a move cursor throughout the selected frame before dragging. Dragging its
  interior moves the entire selection, while modifier clicks retain selection
  behavior. Retain gesture cursors while dragging. Cancel stale gestures and
  pending picks on tool changes so later clicks cannot trigger the previous action.
- Resolve indirect crypt-filter selectors before decrypting PDF streams,
  including encrypted object streams and exempt metadata, so supported protected
  PDFs can be opened and have their protection changed consistently.

## [0.1.71] - 2026-10-22

### Changed

- Rename the native renderer classes and source modules to `WebGlPdfRenderer`
  and `WebGpuPdfRenderer` to reflect support for general PDF content. Update
  internal callers, tests and documentation; retain the old class names,
  WebGL options type and source module paths as deprecated compatibility aliases.
- Use the shared one-device-pixel minimum stroke width for WebGL thumbnails,
  removing thumbnail-only stroke-style copies and widening. Preserve prominent
  overview linework, source geometry, paint ordering and clipping; Canvas2D
  thumbnail coverage and preparation remain unchanged.

### Fixed

- Retry npm publication when Sigstore reports a duplicate transparency-log
  entry, retaining provenance and failing immediately on other publish errors.
  Document how to rerun a failed publication for its existing release tag and
  clarify that successful local release/demo deployment does not confirm npm
  publication.

## [0.1.70] - 2026-10-21

### Added

- Include the page URL and build's HEPR package version in native and Three.js
  demo performance captures so exported measurements identify their source.

### Changed

- Replace the minimum stroke width checkbox in both demos with a numeric
  device-pixel width, defaulting to `0`. Support fractional values such as `0.5`
  and larger widths without changing canonical geometry. The API option and
  setter accept numbers or legacy booleans (`false` = `0`, `true` = `1`);
  `getMinimumStrokeWidth()` now returns the numeric width. Reject negative and
  non-finite API values and widen visibility and paint-overlap bounds as needed.

### Fixed

- Use pixel-area antialiasing for straight vector strokes and round dots across
  native and Three.js WebGL/WebGPU, including gradients and mixed vector batches.
  Reduce excess darkness around tiny round caps and preserve subpixel coverage
  through rotation and scaling. Keep minimum stroke width as a separate display
  adjustment, disabled by default. Curved strokes retain their existing filter.

## [0.1.69] - 2026-10-21

### Added

- Add a minimum stroke width checkbox to the native and Three.js demo settings.
  Keep it unchecked by default, apply changes immediately, and retain the choice
  when loading documents or switching rendering backends.

## [0.1.68] - 2026-10-19

### Added

- Optionally keep vector strokes at least one final device pixel wide in native
  and Three.js WebGL/WebGPU rendering, including gradient strokes, mixed batches
  and stroke LOD. Disabled by default; enable the display adjustment with
  `minimumStrokeWidth: true` or `setMinimumStrokeWidth(true)`. Preserve canonical
  scene/HEP geometry and account for internal supersampling.

## [0.1.67] - 2026-10-17

### Changed

- Remove fixed bundle-size budgets from package tests while retaining initial
  gzip-size reporting and checks for lazy implementations, workers and assets.

### Fixed

- Reduce native and Three.js WebGL/WebGPU work for sparse compound fills by
  drawing separated contour groups with tighter bounds and culling individual
  fills inside large paint runs. Preserve canonical geometry, source IDs,
  clipping, holes, opacity, color overrides, mixed batches and page ownership.
  Retain whole fills when antialiasing footprints can overlap, projection scale
  is uncertain or compositor resolution cannot use those bounds safely. Three
  folded paints retain every selected contour and refresh after zoom/culling.
  Three conservatively bounds inverse pixel footprints for tilted perspective,
  orthographic and per-page projective transforms, including tiny orbit-control
  rotation residues. Horizon-crossing, singular and numerically uncertain
  projections retain whole fills. Performance captures expose whether
  fill selection is active and how many sparse paths use contour groups.
  Existing HEPs benefit without regeneration.
- Tighten Three.js WebGL/WebGPU closed-fill quads in tilted and transformed
  views when analytic footprint and hull bounds preserve filtered coverage.
  Keep existing padding for uncertain projections and compositor targets;
  performance captures expose projected-padding eligibility.
- Reuse stroke LOD selections in stationary tilted views, invalidating them
  for projection, depth clipping, viewport, detail or visibility changes.
  Share projected viewport culling across translated Reader pages in tilted
  perspective views, retaining general page culling near horizons. Degenerate
  planar projections keep their uncached stroke LOD fallback.
- Update renderer regression fixtures for stationary perspective reuse and
  viewport fill culling. Scope simulated thumbnail WebP compilation failures
  to the codec so Node's own WASM initialization remains available during tests.
- Canonicalize packed-consumer fixture paths so macOS temporary-directory
  aliases do not invalidate SSR module checks or bypass bundler graph checks.
- Use consistent static imports for the lightweight document-session wrapper
  and retained-resource builder, eliminating ineffective dynamic-import build
  warnings while keeping document-session runtime and thumbnail scanning lazy.
  Resolve shared TypeScript dependencies in standalone compiler tests.

## [0.1.66] - 2026-10-16

### Added

- Add `buildHepWithScene()` and the matching browser/Node document-session
  method, returning both the HEP Blob and a reusable complete scene for immediate
  viewing without decoding the generated HEP. Preserve applicable prepared LOD
  data and keep successful scenes usable after session close. This opt-in path
  retains full-resolution image pixels and viewer LOD indexes; `buildHep()` keeps
  its existing blob-only, streaming export behavior.

## [0.1.65] - 2026-10-15

### Added

- Add `renderPdfThumbnail()` for single-page PDF/HEP overviews with requested
  pixel dimensions, transparent or colored backgrounds, cancellation, and
  lossless WebP output by default (PNG is also available). Prepare thumbnail
  detail before drawing, approximate unreadable ordinary text, and omit viewer
  LOD, interaction resources and full glyph atlases. Unsupported WebP encoding
  falls back to PNG with a diagnostic.
- Add caller-owned `openDocumentSession()` sessions that reuse PDF parsing and
  font programs across thumbnails and canonical HEP conversion. Cancelling a
  thumbnail preserves the session; closing it releases parser, rendering and
  encoding resources. Thumbnail approximations never enter full-quality HEPs.
- Add a local browser thumbnail benchmark comparing fresh/reused sessions,
  WebGL/Canvas2D, lossless WebP/PNG, and an interactive preparation baseline,
  with stage timings and downloadable reports. Browser speed and visual checks
  remain manual.
- Expose PDF thumbnails and reusable conversion sessions through
  `@soadzoor/hepr/node`, accepting local paths, file URLs, byte buffers and
  random-access sources. Use the optional `@napi-rs/canvas` backend and owned
  Node parser/encoding workers with cancellation and session reuse. Resolve
  worker and standard-font assets from the installed package for SSR bundles.
  Source-free HEP thumbnails still require the browser renderer.
- Add CLI `--output=hep|thumbnail|both`, keeping HEP as the default. Select
  thumbnail page, pixel size, WebP/PNG format and background; generate both
  outputs through one reusable document session. Preserve existing outputs
  independently, copy matching duplicate PDFs, and report each artifact's
  time, size, dimensions and status. PNG fallback uses a matching filename;
  successful outputs remain available when another requested output fails.
- Show HEP-only conversions' peak memory in the `pdf-to-hep` time table and
  diagnostics log. A `Peak RSS` column, next to the conversion time, reports the
  highest resident memory of the worker process that converted the PDF (its
  runtime and parser thread included), also for failed conversions. Copied
  duplicates show `--`. The summary adds `Highest worker peak RSS` with its PDF.
  Concurrent workers overlap, so batch memory can reach several times this value.

### Changed

- Speed up thumbnail preparation with streamed resource loading, shared preview
  transforms/styles, and compact isolated strokes. Batch compatible opaque
  drawing, reuse clipping and paint state, and use output-pixel curve detail
  with stronger one-pixel overview strokes. Keep thin opaque root polylines in
  compact stroke storage with rounded caps and joins, share unchanged graphics
  and text state, save common pen settings separately, reuse the interpreter's
  text transform, and avoid temporary packed resource wrappers during adaptation.
  Recognize complete line and polyline scopes in one byte scan with direct packed
  line coordinates, and share solid-text rendering state. Consolidate opaque root
  strokes with identical quarter-pixel endpoint pairs within compatible Canvas2D
  paint spans,
  preserving logical source counts, clipping and order; translucent overrides and
  explicit scratch budgets retain their compatibility geometry. Eligible opaque
  Canvas2D lines use four-sample antialiased coverage for smoother curves and
  diagonals without a larger rendering bitmap, with quarter-pixel curve detail
  and a diagnostic. Subpixel square caps may be rounded;
  thumbnail approximations remain separate from canonical HEP output. Reuse the
  last successful session thumbnail for identical requests, preserving
  cancellation and reporting only actual total timing on cache hits. Retain one
  prepared thumbnail page for repainting with different colors or formats;
  changing page, resolution, pixel-culling mode or layer-retention policy prepares a new preview.
  Worker fallbacks release storage transferred to the owning host, and session
  close clears both caches. Node parser workers skip native Canvas system-font
  discovery, and lazy encoder startup overlaps PDF preparation with shared
  ownership and cancellation; the host environment remains unchanged.
- Use the shared thumbnail pipeline in native and Three Reader sidebars, with
  direct pixels instead of an encode/decode round trip. Share active PDF parser
  sessions, prioritize viewport work, and preserve appearance controls and
  cancellation when thumbnails become obsolete.

### Fixed

- Speed up PDF-to-HEP conversion of photo-heavy PDFs. Before the regular
  row-band probe decides whether a large image needs a whole-image PNG
  encode, a probe one eighth its size now rules PNG out for photographs, whose
  PNG is typically 5–30 times larger than WebP. Images where PNG could still
  win continue through the regular probe and the exact size comparison, so
  generated HEPs are unchanged.
- Reduce PDF-to-HEP peak memory for large PDFs. The `pdf-to-hep` worker passes
  a file-backed Blob to the builder, and HEP export hands its single loaded
  copy of the PDF to the parser worker instead of keeping further copies for
  the whole conversion. Viewer loading still retains its source bytes for
  re-parsing.
- Speed up decoding of 8-bit DeviceGray/DeviceRGB images by writing each opaque
  pixel as one 32-bit word, and speed up xref repair scans of large damaged
  PDFs with Node's latin1 Buffer decoding (a windows-1252 `TextDecoder`
  elsewhere) instead of building strings byte by byte. Decoded pixels and
  repaired object offsets are unchanged.

## [0.1.64] - 2026-10-14

### Fixed

- Speed up inline-image preprocessing in large CAD PDFs by reusing validated
  content after image boundaries, searching candidate boundaries in bounded
  native byte scans, and recognizing numeric operands without temporary
  strings. Preserve boundary ambiguity checks, caller scan limits and cancellation.
- Reduce retained PDF rendering memory by capturing exact paths and paints
  directly in chunked numeric buffers and sharing identical transforms, colors
  and stroke styles. Preserve coordinate precision, graphics-state isolation,
  paint order and caller limits. Finalization adopts the owned resources
  without another complete copy.
- Reduce PDF-to-HEP peak memory by reusing decoded images and fonts when retrying
  retained rendering, releasing the PDF worker before final image encoding, and
  adopting the bundled JPEG 2000 decoder's owned sample buffers. Upload Node
  canvas images in reusable row bands instead of another full-size pixel copy.
  Hash raster data incrementally in Node without a full-image snapshot and
  release the legacy first-image reference as soon as its pixels are replaced.
  Full resolution, canonical pixels and image encoding settings are preserved.
- Keep eligible oversized JPEG 2000 images in their original compressed form
  during HEP export instead of expanding them to PNG when they exceed WebP's
  dimension limit. Preserve full resolution and decoded pixels without another
  lossy encoding, and reuse shared image sections. Preserve eligible originals
  through retained page rendering too, including when a different image's mask
  requires that path. Edited images, masks and color conversions continue through
  ordinary encoding. These exports use scene v16
  and require the updated reader; existing scene v9–v15 HEPs remain supported.
- Include successfully copied duplicate PDFs in CLI attempted/successful counts,
  original PDF and output HEP size totals, size comparisons, and raster-fallback
  counts. Timing statistics include actual copy time while estimated conversion
  time saved remains separate; warnings continue to count emitted diagnostics.

## [0.1.63] - 2026-10-13

### Added

- Convert identical PDFs once per `pdf-to-hep` batch. Pending PDFs that share
  their exact size are compared by SHA-256; each later copy receives a copy of
  the first one's HEP (cloned on copy-on-write filesystems) instead of a new
  conversion. If that PDF produces no HEP, its duplicates are converted as
  before. The terminal table marks these files `duplicate`, the summary counts
  them separately from attempted conversions with an estimate of the time saved,
  and the diagnostics log names the PDF each one matched. Only HEPs written by
  the current batch are copied.

### Changed

- Stop storing the source PDF's file name in new HEP manifests (`sourceFile`),
  so identical PDFs produce identical HEPs whatever their names. No reader used
  the field; existing HEPs keep it and still load unchanged. `buildHep()`'s
  `sourceLabel` still names the document in size warnings. Because the manifest
  changes, the next `--force --keep-unchanged` run rewrites existing HEPs once.

- Cut Three.js per-frame CPU work for documents with thousands of ordered paint
  batches once mixed vector batching replaces them. The mixed layer reuses its
  collected batches while their source layer is unchanged, and hides a fully
  mixed layer as one object instead of each batch. Batches follow their layer's
  world matrix without per-batch matrix updates, and unchanged stroke-LOD
  frames no longer revisit every batch. On a 217k-fill drawing panned at
  fit-all, CPU time per frame in `renderer.render` fell from 6.2 ms to 0.3 ms
  in a headless Chrome profile, with identical pixels.
- Make Three.js culling and LOD selection changes proportional to the visible
  paints rather than the whole drawing. Ordered batches merge the sorted
  selection with their paint ranges instead of scanning every paint, detect
  unchanged selections without per-record lookup tables, and the mixed layer
  rewrites its instance buffer in place. Large drawings keep the native
  renderer's culling margin for fills, so small pans reuse the selection. As in
  the native renderer, ordered Vector LOD selects stored
  records straight from its levels, and layers drawn entirely through the mixed
  batch no longer write their own instance IDs; the mixed batch reads the
  selection directly, and the IDs are written again before those layers can
  draw. Panning the same drawing zoomed in now takes about the same CPU time
  per frame as the native renderer (from 13.9 to 5.7 ms and from 20.6 to 9.8 ms
  in a headless profile, at two pan speeds), with identical pixels.
- Reuse stroke Vector LOD selections while panning across tile boundaries, in
  the native renderers and Three.js. The selection now includes whole tiles
  within the offscreen margin, and is kept while the view stays inside it; each
  tile's detail budget is the one of the view that made the selection until the
  next one. Native paint culling, Three.js fill culling and the LOD share a
  256-pixel margin (previously 64 pixels), so they select again on the same
  frames. Offscreen instances add vertex work only. On the 217k-fill drawing
  panned zoomed in, LOD reselections fell from 50–86% to 0.4–10% of frames, and
  Three.js CPU time per frame from 5.7/9.8 ms to 0.4/2.1 ms on average in a
  headless profile; frames that do select again cost more than before. Stroke
  detail can differ slightly from the previous selection (about 0.1% of total
  ink in a headless comparison).
- Keep HEP export encoders (integer, palette and path chunk codecs) in
  writer-only modules, so bundled viewers no longer ship them with the HEP
  reader; the initial viewer bundle shrinks by about 1 kB gzip.

### Fixed

- Give the fill shader's indexed winding helper a single exit. ANGLE's D3D
  compiler reported its early return as warning X4000 ("potentially
  uninitialized variable") in Three.js WebGL. Coverage and texture reads are
  unchanged.
- Speed up PDF worker responses containing many pattern placements by cloning
  small buffers instead of transferring each tiny matrix or clip separately.
  Large image and geometry buffers still transfer without copying; scene values,
  shared resource identities and cancellation behavior are preserved.
- Avoid repeated spot-color, palette and ICC conversions for identical image
  samples, preserving the existing color arithmetic and transparency. Convert
  8-bit three- and four-component calibrated or ICC images without a color-key
  mask through a per-image color memo sized to the image and specialized pixel
  loops, and convert retained ICC lattices straight from component bytes with
  per-byte cell and weight tables, giving identical colors. Keep
  unpacked 1-, 2- and 4-bit samples in byte storage instead of widening to 16 bits.
  Store proven uniform opaque black or white images as exact packed bits while
  preserving their dimensions, masks and original color metadata.
- Reuse one canvas upload when choosing between WebP and PNG during HEP export,
  and avoid redundant copies of internally owned encoded images. Preserve public
  archive read isolation and the existing encoded image quality. Skip the
  whole-image PNG when a PNG of evenly spaced row bands predicts it clearly
  larger than the WebP: at least 1.2 times for images of one megapixel and
  1024 rows or more, and 2.5 times for images from 65,536 pixels, whose smaller
  samples predict less precisely. Closer or winning predictions still compare
  both encodings exactly. Photographs and scans previously spent more time on a
  PNG that was several times larger. Hash and compare raster layers by whole
  pixels when finding repeated images.
- Convert PDFs to HEP without keeping every decoded page image in memory. Each
  page's larger images are encoded as soon as the page is parsed, while the
  worker decodes the next page, and their pixels are released; small images
  still pack into document-wide atlases, and the HEP is byte-identical to a
  whole-scene export. A 13-page set of 50-megapixel scans now converts in 22 s
  instead of 27 s with a 2.0 GB peak instead of 6.5 GB. On macOS the
  PDF-to-HEP command runs conversion workers with `MallocLargeCache=0`, so freed
  encoder buffers are returned instead of retained; a value already set in the
  environment takes precedence.
- Store a repeated larger raster image, such as a plan or logo painted on many
  pages, once and reference it from its other placements, instead of writing
  identical bytes for each copy; identical packed monochrome layers share their
  section too. Readers decode a shared section once for all its placements.
  Exports with shared sections use HEP scene format v15 and require an updated
  reader; other exports keep their previous format.
- Store raster layers with exactly two colors as exact packed 1-bit sections
  instead of WebP or PNG, as monochrome layers already were. Readers restore
  the renderers' 1-bit textures, which lossy WebP would lose, and such HEP
  files can be several times smaller. Images small enough for a raster atlas
  keep their lossless atlas. Exports containing such layers advertise scene
  format v10 or v12 and require a reader that supports packed raster sections.
- Speed up HEP export of dense vector drawings: build vector LOD point-recipe
  tables with numeric coordinate keys instead of a string per source point, and
  decide whether recipes save space by compressing only the sections they replace
  when those are large. Decoded LOD data is unchanged, tested exports stayed
  byte-identical, and peak memory drops for drawings with millions of segments.
  Rank plain deflate and the three integer codecs of large vector LOD sections
  on evenly spaced slices, compressing only the best candidates whole instead
  of all four; the chosen encodings matched the exhaustive choice on every
  tested section. Compute container checksums eight bytes at a time, which
  also speeds up HEP loading.
- Share repeated HEP atlas cells and native WebGL image textures across independent
  placements, retaining sampler settings and safe replacement/disposal. Batch
  nearest-neighbor images and reuse identical raster tile plans to avoid excessive
  GPU allocations and planning memory when opening densely patterned drawings.
- Keep proven uniform stencil tiling patterns as reusable grids instead of
  allocating a scene object, execution group and rectangular clips per cell.
  Native and Three WebGL/WebGPU renderers draw packed instances with the original
  Float32 placements, gaps, colors, clipping, opacity and paint order. Preserve
  page composition, layer visibility, structure attribution, picking and caller
  limits; complex, overlapping or sheared source cells keep general execution.
  Index Type3 glyph transforms once and release temporary compiler clips sooner.
  Compact grids use HEP scene v14 and require an updated reader; existing HEP
  scene formats remain readable and ordinary exports keep their previous format.
- Open and convert PDFs that paint many page-sized images under small vector
  clips, such as flattened labels, without decoding, encoding and uploading
  every whole image. Vector-clipped images keep only the source texels their
  clip bounds can reach, on an aligned grid with padding that preserves sampling,
  mip filtering and clip antialiasing; single-color images under a vector clip
  draw as one solid texel. Images also painted unclipped keep sharing their whole
  texture, and overlapping crops never store more texels than the source image.
  Reconstruct PNG-predicted streams with one loop per predictor algorithm, about
  three times faster with identical output.
- Report lost WebGL contexts and unavailable GPU limits directly instead of
  misidentifying them as invalid HEP vector clip capacity.
- Prevent subpixel gaps in opaque tiled PDF images from flashing as white
  lines during native WebGL zooming. Integrate the original gap coverage across
  shared tile boundaries, preserving source pixels, nearest sampling, paint
  order and visible gaps at high zoom while reusing existing image textures.
  Apply the same treatment when image batching falls back to individual draws.
  Preserve original sampling when minified pixels reach farther tiles, and skip
  opacity scans for unrelated images.

## [0.1.62] - 2026-10-12

### Changed

- Batch consecutive fills and strokes in one ordered vector draw across native
  WebGL/WebGPU and Three.js WebGL/WebGPU, reducing submissions for densely
  interleaved technical drawings while preserving
  analytic coverage, clipping and stroke LOD. Reuse unchanged instance buffers,
  retain separate draws for composited or incompatible paints, and fall back when
  the combined shader is unavailable. Three.js borrows existing geometry textures
  and retains page transforms and split stroke-LOD stores. Add a console switch
  in both viewers for same-view comparisons without waking dormant native fallbacks.
- Make native WebGL geometry-area diagnostics separately opt-in with
  `geometryDiagnostics: true`, so ordinary performance captures avoid scanning
  every submitted fill and image instance. Identify mixed vector draws and their
  source kinds in GPU operation reports.
- Reduce GPU fill work across native and Three.js WebGL/WebGPU with cached
  conservative bounds from decoded geometry and a signed-area shortcut for
  closed paths no larger than a pixel's filter footprint. Pixels covering
  only part of such a path share its area by overlap with its bounds, which is
  exact for axis-aligned rectangles and preserves total ink; other subpixel
  shapes may shift some ink between the neighbouring pixels they touch. This
  removes the per-segment loop from nearly every fill at overview zooms of
  dense drawings. Use those bounds for
  culling, paint ordering and spatial indexes. Tighten flat fill padding while
  retaining the existing projected, open-path and glyph coverage paths,
  clipping, fill rules and canonical HEP data. Integrate individual quadratic
  curves and row-clipped curve pieces directly when their control hulls stay
  inside the pixel columns, reducing subdivision work in fill, gradient and
  glyph coverage while preserving the column-crossing fallback. Defer ordinary
  fill spatial-index header reads until segment coverage is needed, checking
  cells before bands, and reduce mixed-shader vertex texture requirements.
  Skip both headers for paths below the index builders' shared segment threshold,
  preserving the existing direct scan for small paths.
- Expose native `heprPerf.status()` to inspect document loading state and pending
  operations. Document performance report export without the DevTools `copy()`
  helper.
- Add `heprPerf.vectors("all" | "fills" | "strokes" | "none")` in both
  viewers for controlled GPU comparisons. Retain mixed vector batching when
  disabling one kind, record fill/stroke visibility in captures, and stop an
  active capture before changing comparison modes.

### Fixed

- Clear native PDF/HEP loading state when a source is superseded before its
  scene-load continuation resumes, so a failed replacement read cannot leave
  the previous document marked as loading with backend switching and export
  blocked.

## [0.1.61] - 2026-10-12

### Fixed

- Preserve vector content in production PDF conversions with recoverable CFF,
  TrueType and Type3 font defects, malformed text/marked-content scopes,
  incomplete annotation metadata, and redundant path-closing coordinates.
  Diagnose compatibility repairs instead of rejecting otherwise usable documents.
- Support non-painting `/None` colorants in PDF and HEP rendering while retaining
  clipping, searchable text and independently colored images, patterns and glyphs.
  Recover missing FreeText appearance fonts from declared annotation styles,
  preserving positioned text and diagnosing the approximate font repair.
- Recover unambiguous Unicode mappings from embedded TrueType fonts when composite
  fonts omit usable text mappings, preserving explicit mappings and caller limits.
  Reuse identical ToUnicode programs within a document, and recognize exact
  missing-bearing repairs for empty glyphs. Report a missing PDF
  layer catalog once per document while retaining individual layers and explicit
  visibility settings; avoid warnings for unused empty catalogs.
- Elide provably redundant rectangular PDF clips before HEP coordinate encoding,
  avoiding clamping unused oversized coordinates while preserving meaningful clips
  and Type3 glyph clipping. Reuse shading color samples across placements without
  changing gradient colors, transforms, clipping or opacity.
- Recover padded image samples, redundant stencil color spaces, packed
  RunLength images, excess CCITT rows, and validated Flate framing defects
  while retaining cancellation, configured limits and corrupt-data checks.
  Retain JPEG samples after recoverable decoder warnings, preserve supplied
  Indexed palette entries while diagnosing approximated missing entries, and recover
  complete raw inline images whose final EI samples replace their terminator.
- Keep intact font, image and object streams during safe xref repair when only
  the EOL before their exact declared endstream boundary is missing.
- Remove image mattes before applying soft masks in retained vector output,
  avoiding unnecessary raster fallback for surrounding transparency groups,
  patterns and page soft masks. Preserve valid PDF values split across content
  streams when preparing inline images, and retain small invertible shading
  transforms. Allow complex shading meshes beyond the former default triangle
  and subdivision ceilings while preserving caller-selected limits.
- Keep Reader zoom focused through scroll boundaries and high magnification in
  both demos. Preserve precise camera positions independently of browser scroll
  limits and rounding, with bounded scrollbar ranges and consistent touch,
  wheel and keyboard movement. Prevent finger-lift motion after touchscreen
  pinch zoom from launching unintended inertial scrolling.
- Activate PDF links when clicking their text with text selection enabled in
  both demos, while preserving drag and double-click selection. Keep link hover
  previews available after selecting a link without replacing pinned comments.
- Improve the Examples dropdown's count, arrow and hover contrast in the shared
  toolbar, including the Three demo's light toolbar.
- Show a pointer cursor over the Reader toolbar's Layout dropdown in both demos.
- Skip the native demo's Vector LOD loading stage when no stroke LOD work is
  needed, including the bundled WarAndPeace example.
- Reuse stored Text LOD when opening HEPs in native Reader mode and switching
  between Reader and Grid, translating the cached hierarchy with the pages
  instead of rebuilding it.
- Reduce Three Reader frame preparation by sharing viewport calculations across
  flat pages, skipping offscreen page projections, and reusing unchanged page
  matrices and frame results. Per-frame work now follows the visible and
  changed pages rather than the page count, and Text LOD keeps its selection
  while scrolling a translated page column instead of reselecting every frame.
  Check overlaps along the more separated screen axis to avoid comparing every
  pair in long page columns. Preserve the general path for 3D page layouts, and
  include page preparation timings in captures.
- Stop Three annotation picking and drawing selection from updating every page
  subtree and stringifying every page transform each frame, which cost
  milliseconds per frame in long documents with links, in both Reader and Grid.
  Drawing selection now also discards stale hover and pending clicks when pages
  move while the camera holds still, such as during layout animations.
- Reuse glyph raster atlases across Reader thumbnails and shared page scenes,
  avoiding repeated glyph rasterization while scrolling. Skip unchanged toolbar
  updates and schedule native scroll rendering without an extra animation frame.

## [0.1.60] - 2026-10-11

### Added

- Add opt-in loading diagnostics to the Three demo, with copyable phase timings,
  CPU buffer and partial GPU resource estimates, error/device-loss events, and
  best-effort checkpoint recovery after a tab reload. Use Settings or
  `?loadDiagnostics=1`; `&initialLayout=grid` enables a comparison that skips
  initial Reader page preparation. Reports include recorder and viewer state
  even when no load checkpoints were captured; show/copy feedback identifies
  empty captures explicitly.

### Fixed

- Release temporary combined Text LOD arrays after Three material construction
  instead of retaining them through paint batching and visibility. This reduces
  memory pressure when opening large text documents in WebGL and WebGPU.
- Reuse canonical text buffers for contiguous page views, retaining private
  clip-index arrays when remapping is needed. This reduces Reader memory use
  without changing page content or appearance overrides.
- Reduce Three Reader startup memory and preparation by keeping compatible
  static pages' independent materials lazy and releasing dormant document
  materials when shared page batches take over. Compile only the selected
  rendering path; preserve overlays and initialize independent materials when
  page appearance, layout or host capabilities require them. Streaming and
  composited documents retain their existing preparation path.
- Show Reader preparation, shader/resource preparation, first-frame and warm-up
  stages separately in the Three demo's loading indicator.

## [0.1.59] - 2026-10-11

### Changed

- Keep PDF and HEP download controls inside the expanded Settings panel in both
  demos, and hide the entire panel when closed.
- Add Hide toolbar and a compact floating Show toolbar control to both demos,
  reclaiming screen space while preserving Reader position and zoom. Fit modes
  adjust to the available viewport size.

## [0.1.58] - 2026-10-11

### Added

- Add a Reader layout to the native and Three demos, with vertically stacked
  pages, scrollbars, page navigation, zoom controls, Fit Width and Fit Page.
  Support keyboard scrolling, touch dragging and flicking, and pointer-anchored
  wheel and pinch zoom. Search and internal PDF links navigate through the
  scrolling viewport; text selection, annotations and drawing selection remain
  available.
- Add lazy, clickable page thumbnails, including HEPs without their source PDF.
  Expose cancellable previews through
  `HeprThreePdfObject.getPagePreviewScene(index, { maximumDimension, signal? })`,
  prioritize main-view loading, and preserve scan appearance while honoring
  explicitly selected OCR-only mode and optional-layer visibility.

### Changed

- Open multipage PDFs and HEPs in Reader at page 1 with Fit Width. Initially show
  thumbnails on screens at least 800 pixels wide and collapse advanced settings
  and diagnostics. Retain Grid, Three's Sphere and Helix, and the existing
  single-page default. Restore Reader position and zoom across layout changes,
  streaming updates, backend replacement and same-document reloads.
- Refresh the bundled Leo brochure and TIKA-2848 HEP examples.
- Require coding agents to maintain `Unreleased` notes automatically after each
  task that changes repository files, based on the implemented changes.

### Fixed

- Update the native PDF demand-swap test fixture for Reader layout state, fixing
  its release-preflight failure and covering deferred and cancelled page swaps
  during layout changes.
- Keep the previous document and reading position usable when replacement
  preparation fails or is cancelled. Restore the native scene, camera, layers
  and highlights after failed or cancelled warm-up; reconnect Reader input
  handlers to the restored canvas after a failed backend switch.

### Upgrade notes and limitations

- Reader is a demo presentation mode. Package loading defaults, the HEP format
  and canonical document layouts saved by HEP export remain unchanged.
- Update separately deployed parser-worker assets alongside the library; the
  worker protocol is now version 15 to support scan-appearance previews.

## [0.1.57] - 2026-10-11

### Added

- Render embedded PFA/PFB Type1 glyph outlines with their original encodings,
  replacing substitute-font approximations when the source font is supported.
- Expand CFF/Type2 support with Expert encodings, Type1 charstrings, synthetic
  font inheritance and Multiple Master interpolation. Add CFF2 variation support;
  PDF conversion uses the embedded font's default variation instance.
- Support more embedded font programs through a font-local PostScript
  interpreter, including computed font data, custom OtherSubrs, streams and
  filters, sampled images, masks, tiling patterns and mesh shadings. Retain
  supported geometry and image assets through HEP export and reload.
- Support font-local CIE and spot colors, color-rendering dictionaries, and JPEG,
  CCITT, JBIG2 and JPX decoding. Apply supplied `DefaultCMYK` or embedded CMYK
  output-intent profiles to supported paints for calibrated display output.
- Add an `embeddedFontPaint: "font"` compatibility option for intrinsic Type1/CFF
  stroked fonts. The default continues to follow the PDF text rendering mode.
- Add curated changelogs, release-note validation and GitHub Releases generated
  from the same notes shipped in the npm package.

### Fixed

- Recover JPEG images with otherwise usable `/Blend` decode parameters instead
  of rejecting their pages.
- Recover layer references omitted from the PDF catalog's optional-content group
  list, retaining diagnostics and layer visibility behavior.
- Read updated cross-reference data in linearized PDFs.
- Remove white seams between mesh shading triangles in the Canvas2D renderer,
  while retaining vector mesh geometry in HEP files.
- Preserve more font-local image interpolation, composite glyph state,
  transformed paints, nonunit CIE shading ranges and CMYK profile information.
- Keep JPEG 2000 and JBIG2 decoders loaded on demand when using embedded font
  programs, avoiding extra code in the parser worker's initial load.
- Build releases after the version bump so the viewer displays the new version.

### Upgrade notes and limitations

- Reconvert source PDFs to benefit from restored embedded-font outlines and
  other conversion improvements. Existing HEP files retain the geometry and
  assets saved by their original converter.
- Original glyph appearance and Unicode mapping are independent. Missing
  Unicode mappings can still affect search and copied text, even when the glyph
  renders correctly; embedding font outlines does not reconstruct those mappings.
- Unsupported font programs retain diagnosed fallback where possible. This is a
  font-local interpreter, not a general PostScript or physical printer engine.
  Remaining JPX palette/channel mappings, multiple alpha planes, mixed precision,
  more than four codestream components, transparent or high-dimensional spot
  shadings, and physical press calibration are tracked in the
  [follow-up checklist](docs/development.md#font-local-postscript-follow-ups).

[Unreleased]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.71...HEAD
[0.1.57]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.56...v0.1.57
[0.1.58]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.57...v0.1.58
[0.1.59]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.58...v0.1.59
[0.1.60]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.59...v0.1.60
[0.1.61]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.60...v0.1.61
[0.1.62]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.61...v0.1.62
[0.1.63]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.62...v0.1.63
[0.1.64]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.63...v0.1.64
[0.1.65]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.64...v0.1.65
[0.1.66]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.65...v0.1.66
[0.1.67]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.66...v0.1.67
[0.1.68]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.67...v0.1.68
[0.1.69]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.68...v0.1.69
[0.1.70]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.69...v0.1.70
[0.1.71]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.70...v0.1.71
