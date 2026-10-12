# Changelog

User-facing changes are recorded here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Add notes under `Unreleased` alongside the implementation. Release automation
moves those notes into a dated version section and uses them for the GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.61...HEAD
[0.1.57]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.56...v0.1.57
[0.1.58]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.57...v0.1.58
[0.1.59]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.58...v0.1.59
[0.1.60]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.59...v0.1.60
[0.1.61]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.60...v0.1.61
