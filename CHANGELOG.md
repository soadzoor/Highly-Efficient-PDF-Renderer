# Changelog

User-facing changes are recorded here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Add notes under `Unreleased` alongside the implementation. Release automation
moves those notes into a dated version section and uses them for the GitHub Release.

## [Unreleased]

### Fixed

- Speed up inline-image preprocessing in large CAD PDFs by reusing validated
  content after image boundaries, searching candidate boundaries in bounded
  native byte scans, and recognizing numeric operands without temporary
  strings. Preserve boundary ambiguity checks, caller scan limits and cancellation.
- Avoid a second copy of captured retained path and paint resources during
  compiler finalization. Freeze the already-owned snapshots in place, preserving
  geometry, graphics-state isolation and immutable metadata while reducing
  peak memory and temporary allocations on drawings with many path paints.
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

[Unreleased]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.63...HEAD
[0.1.57]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.56...v0.1.57
[0.1.58]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.57...v0.1.58
[0.1.59]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.58...v0.1.59
[0.1.60]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.59...v0.1.60
[0.1.61]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.60...v0.1.61
[0.1.62]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.61...v0.1.62
[0.1.63]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.62...v0.1.63
