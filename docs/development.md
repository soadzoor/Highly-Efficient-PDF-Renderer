# Development

[Project home](../README.md) · [Documentation](README.md) · [Examples](examples.md)

## Local setup

Use Node.js 24 or newer and install dependencies from the repository root:

```bash
npm install
```

The repository includes `@napi-rs/canvas` as a development dependency for Node
conversion and raster tests. Browser package consumers do not need it.

Start the development server when you want to run the demos locally:

```bash
npm run dev
```

Open the URL printed by Vite. The demo entry points are:

| Path | Demo |
| --- | --- |
| `/` | Standalone WebGL/WebGPU viewer. |
| `/three-example.html` | Three.js integration with camera controls. |
| `/room-overlay-demo.html` | Floorplan room detection and TSV overlays. |

## Builds and checks

| Command | Purpose |
| --- | --- |
| `npm test` | Type check and bounded fast regression suite. |
| `npm run typecheck` | TypeScript checks only. |
| `npm run test:file -- scripts/test-text-search.mjs` | Run one regression file. |
| `npm run build` | Build the demo app. |
| `npm run build:lib` | Build the package and run package checks. |
| `npm run build:bundler` | Emit the optional browser bundler modules and their assets. |
| `npm run build:all` | Build the app and package. |
| `npm run pack:local` | Build the package and create an installable tarball. |
| `npm run preview` | Serve the built app for manual review. |

See [Development validation](development-validation.md) for suite selection,
timeouts, CI coverage, and manual browser checks. Corpus tests, conversion runs,
and visual comparisons are separate from the default fast checks and can be
expensive. Select those checks deliberately for the change you are making.

For rendering changes, manually check both demos and backends with representative
PDFs. Exercise pan/zoom, text search and selection, document switching, and HEP
export/reload. The [visual regression guide](visual-regressions.md) lists specific
appearance checkpoints.

### Published-package consumer check

`npm run build:lib` also builds `dist/bundler`, exposed as
`@soadzoor/hepr/bundler`, and runs a Vite consumer test against an unpacked npm
tarball. It checks emitted WASM, fonts, workers, and lazy imports, then exercises
the emitted parser worker with Node worker threads. This does not verify browser
fetching or rendering.

To retain that isolated consumer for manual browser verification:

```bash
npm run test:file -- scripts/test-bundler-package.mjs -- --keep-fixture
```

In the temporary directory printed by the test, run `npm run dev` manually and
open `/hepr-smoke/`. Choose a small PDF; the page loads it twice. Also try a PDF
with JPEG images, standard fonts, and ICC colors. Check the browser Network and
Console panels for missing assets, dynamic-import failures, or worker session
errors. Repeat using `npm run build` followed by `npm run preview` to check the
production output. The fixture uses the same Vite configuration documented in
the quick start and a non-root deployment path. It never converts PDFs to HEP.

## Example assets

The demos read paired PDF and HEP entries from these locations:

```text
public/examples/pdfs/          Source documents
public/examples/heps/          Prepared HEP documents
public/examples/manifest.json  Demo menu entries and file sizes
```

After adding or updating matching assets, refresh the manifest:

```bash
npm run generate-manifest
```

This command indexes existing files; it does not convert PDFs. For conversion,
follow the [manual](manual.md#node-conversion). A full example refresh with
`npm run regenerate:heps` converts all bundled PDFs and updates the manifest;
allow time and memory for large documents before starting it.

## Room detection tools

The room overlay demo runs detection on demand. **Download Generated TSV** saves
the detected room polygons and labels for inspection. The
[room detection example](examples.md#detect-rooms-in-a-vector-floorplan) shows the public API.

For focused geometry checks:

```bash
npm run test:file -- scripts/test-room-detector.mjs
```

`scripts/eval-rooms.mjs --from-pdf` evaluates the live PDF text extraction path;
`--score` also scores predictions against the available annotations. Those labels
are incomplete, so unmatched predictions need review. Audit saved predictions
for invalid polygons, duplicates, containment, and overlap with:

```bash
npm run audit:rooms -- .eval/my-room-run
```

Use the [gold-set review protocol](room-gold-set.md) to create and validate a
reviewed evaluation set. See [detector quality](room-detector-quality.md) for
recorded results and limits.

## Performance and fidelity

### Manual PDF layer and effect checks

After running type checking and the fast synthetic suites, manually check both
native backends and both Three.js backends with layered drawings. These checks
require a browser and are not part of the automated non-browser acceptance:

- Toggle default-off layers, nested memberships, locked groups, and radio groups;
  verify the lower paint becomes visible and pickable when an upper layer is hidden.
- Inspect overlapping transparency groups, knockout, blend modes, transformed
  alpha/luminosity masks, and gradients at several zoom levels. Check tiling
  patterns, Type3 text, mesh shadings, compound-fill holes, and rotated pages.
- Pan using cached frames, change DPR/viewport size, switch backends, and hide/show
  a recolored primitive. Layer state and colors should survive a backend switch;
  new documents should use their own defaults.
- Confirm hidden text disappears from search and selection, hidden drawing traces
  clear, and layer changes remain independent of the Drawing Selection checkbox.
- Exercise rapid layer changes on a fallback-heavy page. Progress should appear,
  obsolete work should not commit, and a failure should keep the applied state.
- Export a synthetic layered scene after toggling it, then reopen the v7 file.
  It should restore PDF defaults and replay remaining composites without a PDF.

Regenerate bundled HEP files manually before using those examples with v7. The
synthetic suites deliberately do not regenerate them or convert real-PDF corpora.

### Rendering performance

The [parser benchmark guide](parser-benchmark.md) describes production parser
measurements and their scope. The optional [oracle harness](../oracle/README.md)
has a separate dependency installation for rendering comparisons. Run corpus
benchmarks and baseline generation manually; the default tests do not establish
full-corpus visual fidelity or browser performance.

Adjacent strokes, fills, or text share instanced draws even when their clip roots
differ. Spatially independent
pages also share draws: their paint streams are interleaved by type while keeping
the order of overlapping paints. Actual content bounds determine those
groups, including all stroke LOD levels, vector clips, and screen-space AA;
page rectangles alone do not establish independence. A bounded look-ahead pass
also combines paints within a page when they can move across every intervening
paint without overlap. Unknown bounds remain ordering barriers. The search has
both a short window and a comparison budget to bound CPU work during rebuilds.
Arbitrary WebGL local-to-clip projections keep the original global order.
The draw list is reused until visibility, LOD, or the AA scale bucket changes.
Stroke paint ranks are computed at scene setup. When selection changes, a
hierarchical bitmask filters that static order without comparison sorting.
Unchanged selected IDs reuse their ordered instance list.
For a planar overview containing every LOD's geometry and every paint bound,
panning reuses both the LOD selection and the source paint list. Partial views
can reuse a bounded offscreen margin. Three.js also reuses the selection for a
front-facing PerspectiveCamera when clip W is constant over the PDF plane and
valid local culling bounds are available. Camera-control roundoff is tolerated
only when its clip-W contribution across the entire drawing is at most 1e-12
of constant W. Selection reuse compares the normalized XY basis with its cached
value; near/far clipping changes affect depth only and do not invalidate it.
Unchanged selections update camera uniforms and paint schedules without copying
or scanning stroke IDs. A changed LOD budget, exhausted margin, screen scale or
orientation change, or explicit reset resumes selection work; tilted perspective
views keep their existing update path. The headless Three camera regression uses
real MapControls and the PDF object's frame preparation on both material backends.
Native WebGL/WebGPU ordered scenes use the existing soft 50,000-stroke LOD target;
merging stays within each source paint, clip, and consecutive opaque color.
Exact tile geometry returns when it fits the budget or the screen-error limit
requires it; tile budgets and hysteresis cannot select a coarser level than that
limit. Dense opaque marks use runtime-only negative primitive types to encode
source-over multiplicity, preserving coincident coverage without widening the
pen. Small spatial clusters use bounded cells and subdivision; hairlines,
transparency effects, and isolated details remain exact. Density levels are
excluded from tilted perspective views without a reliable uniform error bound.
Canonical PDF/HEP geometry is unchanged. Native translation-only pan caching
also supports active LOD: refresh selects vectors for the complete cache bounds
at the current zoom. Zooming still renders directly, and scene/style/layer
changes invalidate cached pixels. The Draw counter reports selected vector
representatives, including those represented by a reused native pan cache.
