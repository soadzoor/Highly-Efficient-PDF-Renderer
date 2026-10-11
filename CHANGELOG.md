# Changelog

User-facing changes are recorded here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Add notes under `Unreleased` alongside the implementation. Release automation
moves those notes into a dated version section and uses them for the GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.59...HEAD
[0.1.57]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.56...v0.1.57
[0.1.58]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.57...v0.1.58
[0.1.59]: https://github.com/soadzoor/Highly-Efficient-PDF-Renderer/compare/v0.1.58...v0.1.59
