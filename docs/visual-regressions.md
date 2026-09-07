# Accepted native appearance and honest statistics

This change freezes the accepted current appearance, not main's extra labels.
It does not change the GPU renderer, page layout, camera, zoom/pan, paint
resolution, or search/selection implementation. HEP remains v6.

## Automated coverage

```sh
npm run test:native-visual-regressions
npm run test:native-text-clip-index
npm run test:scene-statistics
```

The visual suite compiles only physical brochure page 5 (zero-based source
index 4, printed spread 8–9), plus a tiny original synthetic PDF. It requires
the tracked brochure at its existing `public/examples/pdfs` path. It does not
load main or PDF.js, start a browser/server, or regenerate any tracked HEP.

`scripts/fixtures/brochure-page5.json` records the accepted native output:

- Source PDF SHA-256, all scene paint/text stores, clip/transform data, every
  image layer's RGBA hash, size, placement and source paint order.
- 2,469 vector glyph instances and 11 image layers. The 90 clipped source
  glyphs must not leak back into the vector store and paint a second time.
- Exact searchable text and search bounds for the six diagram legend labels.
  The actual selection controller runs against a minimal DOM/event host:
  double-click hit tests must select the expected visible word, character
  range and highlight, including after page-grid translation.

The synthetic fixture independently probes background-image / clipped-glyph /
later-image pixels. It checks that the clipped-out glyph region stays absent,
retained ink stays visible and the later image covers it. The genuinely
visible composited glyph must remain searchable/selectable through fallback
geometry, also after a tiny in-memory HEP round trip.

Reference environment: Node 24.5.0, Linux x64, `@napi-rs/canvas` 1.0.6. Exact
RGBA hashes are CPU-backend-specific, not cross-browser screenshot goldens.
The suite freezes the parser output supplied to the existing GPU renderer;
it does not replace final browser visual verification. There is deliberately
no automatic reference rewrite. `--print-reference` prints a candidate for
diagnosis; any baseline change requires review of the accepted appearance,
not blindly copying a new hash after a failure. No source PDF or extracted
artwork is duplicated in the reference file.

The page-5 hidden-label indexing limitation is now fixed. Exact shared clip
chains survive the native text bridge and Form flattening. For text routed
to compositing, indexing tests the glyph ink bounds against the polygon clip,
including nonzero/even-odd holes, transforms and parent clips. Text proved
fully clipped away is excluded; retained composited glyphs use ink-based
fallback geometry. Ordinary rendering-mode-3 and zero-alpha OCR text remain
indexed. No changes to the renderer or selection controller were needed.

This is a conservative visibility proof, not pixel sampling: curves, boundary
contact and clips beyond the proof's work bounds remain indexable when their
visibility is uncertain. It does not filter text hidden by later paint or
arbitrary soft masks. Path retention uses existing parser resource ceilings;
polygon preparation is cached within one page adaptation.

The updated regressions require one highlight rectangle per visible legend
word and per drag across “D Wärmepumpe,” and no searchable clipped duplicate
of the six legend labels. The accepted paint-only hash and every image RGBA
hash remain unchanged; only the text/index-dependent hashes were updated.
Synthetic tests cover nested clips, holes/islands, winding rules, partial and
boundary glyphs, restored graphics state, OCR and HEP persistence. Existing
HEP files still carry their old text index: regenerate the affected HEP from
the PDF to obtain the correction. No format bump or full-corpus regeneration
is required for testing this fix.

## Statistics contract

Stroke counts reconcile as:

`source = removed by merging + genuinely culled + moved to image layers + emitted vectors`

Image-layer transfers count post-cull **stroke segments** explicitly at the
selective-span suppression step, not as a guessed residual. They are still
painted. This count excludes original image pixels, fill edges and glyph
outlines. It is not a measure of all compositing work.

For the previously measured 15-page brochure totals:

| Category | Segments |
| --- | ---: |
| Source | 11,257 |
| Removed by merging | 1,229 |
| After merging | 10,028 |
| Genuinely culled | 34 |
| Moved to image layers (still painted) | 1,160 |
| Emitted vectors | 8,834 |

The UI no longer labels the last two categories' combined drop as invisible
culling. `Parser Ops` is explicitly engine-specific: native compatibility
estimates include expanded Form occurrences and are neither raw PDF operator
counts nor GPU draw calls. Do not compare that number across engines as
equivalent work. Compare timings and accepted output instead.

New HEP exports preserve image-transfer counts, cull diagnostics and operator
counter provenance as additive v6 metadata. Old v6 files still load, but the
missing cull/image breakdown is shown as unavailable, not fabricated zeros.
Mixed old/new page grids also retain that uncertainty. Tests cover all three
categories, optimization disabled, grid aggregation, HEP round trips, missing
metadata and inconsistent counts.

## Manual verification

After `npm run build:all`, start `npm run preview` yourself. Open the **PDF**,
not an older pre-generated HEP, to exercise the parser and new metadata.

1. Inspect physical page 5 / spread 8–9 at normal size, 2× and high zoom. Check
   A–F and SolvisLeo/Wechselrichter/Batteriespeicher/Wärmepumpe/Wallbox/
   Photovoltaik: no extra labels, lost clip edges, or changed image overlap.
2. Search these words and double-click/drag-select the visible legend. Check
   highlight placement and copy/paste, including in the four-column grid.
3. Pan/zoom freely. Repeat on WebGPU if used, then switch back to WebGL.
4. Check the stroke accounting against the table. Export/reload HEP manually
   and verify appearance, selection and metrics persist. An older HEP should
   say its cull/image-layer breakdown is unavailable.

No new performance claim is made by this regression/statistics work.

## Files touched for this follow-up

- Accounting: `src/pdf/nativeContentCompiler.ts`, `src/pdfSession.ts`,
  `src/pdf/nativeVectorPage.ts`, `src/pdfVectorExtractor.ts`,
  `src/sceneStatistics.ts`, `src/parsedDataZip.ts`.
- Metric labels/output only: `index.html`, `src/main.ts`.
- Coverage: `scripts/test-native-visual-regressions.mjs`,
  `scripts/test-scene-statistics.mjs`, `scripts/lib/selectionTestHost.mjs`,
  `scripts/fixtures/brochure-page5.json`, `package.json`, this document.

Additional files for the hidden-label selection fix: `src/pdf/nativeTextClip.ts`,
`src/pdf/nativeContentCompiler.ts`, `src/pdf/nativeVectorPage.ts`,
`src/pdfSession.ts`, `scripts/test-native-text-clip-index.mjs`, plus the
visual regression script, page-5 reference, package scripts and this document.
