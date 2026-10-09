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
| `npm test` | Type check and fast regression suite. |
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
measurements and their scope. Run corpus benchmarks manually; the default tests
do not establish full-corpus visual fidelity or browser performance.

All four backends batch page backgrounds before page content. Native WebGL
instances the visible page rectangles; native WebGPU instances the document's
rectangles and lets the GPU clip offscreen pages. WebGPU splits unusually large
page sets only when needed to respect device buffer limits. Both Three backends
use one indexed quad with `InstancedBufferGeometry`: each page has one packed
`(x, y, width, height)` instance (16 bytes), in `scene.pageRects` order. Camera,
document/ancestor transforms and background-color changes reuse the geometry in
all four paths. Both Three shaders apply the same document-to-clip matrix used
by content after reconstructing each background corner.
Native captures report `pageBackgroundBatches` and `pageBackgroundInstances`
separately from content batches. The viewer's draw-call total includes both,
plus any compositing and overlay draws. The `webgl-page-background-batching`,
`webgpu-draw-calls` and `three-page-background-batching` tests cover 396 pages,
upload reuse, color and cleanup. WebGL also tests visibility changes; WebGPU
checks bounded allocations; Three verifies both materials, document/ancestor
translation, tilt, nonuniform scale and reflection, and generates WGSL without
a GPU. Browser draw counts and visual checks remain manual. In each Three
backend, check the CS-MAP overview, zoom into individual pages, then translate,
rotate and scale the PDF group under a transformed parent; backgrounds must
stay aligned with content and contribute one draw call.

Independent page transforms are opt-in through `pdf.getPage(index)` / `getPages()`.
The original batched object stays visible during preparation; completed page
views replace its rendering and depth rectangle. `scenePageViews.ts` compacts
page stores and remaps clips, glyphs, gradients, retained replay and paint graphs
while preserving canonical coordinates and a primitive-ID map. The original
scene stays immutable. The views share layer visibility and a native fallback
context (`sharedPageRenderer.ts`). Compatible material rendering uses a shared
batch object and `threePageTransforms.ts`: canonical primitive IDs resolve an
immutable page-owner texture, then a small mutable matrix/visibility table.
Backgrounds and raster strips carry instanced page IDs; gradients and individual
images use constant IDs. GLSL and WGSL share the same tables. Camera/document
movement updates only the document projection. Text LOD selects per page;
stroke LOD uses the finest visible page tolerance. Page views' material resources
stay dormant until needed for fallback. Runtime matrices are not persisted in HEP.

`threePageBatchFrame.ts` projects paint extents, including coarse text and AA,
to prove screen-space independence or opaque depth separation. Only then may
the scheduler interleave page streams independently of their original layout.
Compositing, unsafe overlaps, per-page appearance differences, and capability
limits use independent submissions, and compatible layouts automatically rejoin
the shared batches. `getPageBatchingStats()` exposes the decision.

The `three-page-transform-batching`, `three-page-transforms`, `scene-page-views`,
and `shared-page-renderer` tests
cover both material backends, affine transforms, automatic scene preparation,
picking, highlights, rollback, cancellation, shared native state, all paint types
and synthetic HEP ownership round trips. Compositor tests check projected page
depth and generate WGSL without starting a browser.

Manual verification: in an existing Three.js integration, load the CS-MAP HEP and
call `await pdf.getPages()`. Move, tilt, rotate, reflect and scale individual pages
under a transformed document; include overlapping pages at different Z values.
Check backgrounds, text, images, gradients, clips, search highlights and picking
at overview and close zoom. Repeat with WebGL and WebGPU hosts, a layered or
composited document, and a native texture fallback. Confirm layer toggles and
cleanup, and measure FPS/draw calls separately before and after accessing page
views. Confirm `getPageBatchingStats().mode` is `pages-batched` for disjoint pages
and remains so during animation; move translucent pages into overlap and back
to verify the separate-rendering transition. Headless tests count content meshes
and generate shaders; browser FPS and driver shader validation remain manual.
Transparent intersecting pages retain Three's object-level transparency
sorting; exact order-independent transparency is not provided.

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
Unchanged selected IDs reuse their ordered instance list. Three's ordered LOD
batches also assign paint ranks once at setup. On selection changes, a two-level
bitset orders the selected ranks, and each scheduled paint reads only its selected
interval. It does not scan all stored LOD representatives to recover a small
visible subset. This preserves origin ties, per-instance clip roots, OCG
visibility, replanning and the two passes of legacy Multiply paints. Tilted views
still recompute LOD selection; sparse batching reduces the subsequent instance
preparation cost without relaxing the segment budget or changing visible IDs.
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
Native and Three WebGL/WebGPU share the soft 50,000-stroke LOD target. Divide
that target among occupied visible source tiles; per-tile quality floors must
not multiply it into hundreds of thousands of strokes. Large simple scenes
build a conservative fine level followed by overview levels that omit tiny
geometry and merge parallel lines at the level's tolerance. They retain source
paint/clip identity and flush legacy color cohorts in order. Effect scenes keep
the conservative hierarchy. The fine level preserves weighted subpixel coverage
and remains preferred when it fits the tile budget.

Native and Three WebGL/WebGPU apply text LOD to source-ordered scenes. Coarse
text runs stop at each PDF paint boundary and retain its clip and layer. Selected
IDs are grouped back into canonical paint order; unchanged selections reuse the
instance buffer during panning. Coarse text keeps its original clips. Native
paint scheduling includes both exact glyph bounds and all coarse replacement
bounds, so Auto retains safe batching across disjoint or equal-color paints.
Adding coarse bounds invalidates cached dependencies even at an unchanged zoom;
subsequent exact/coarse selection changes reuse those conservative dependencies.
Text with Multiply blending and scenes requiring effect composition stay exact.
Readable text and primitive color overrides also retain exact glyphs. This keeps direct rendering practical for
large books without changing HEP data. Three batches consume selected exact or
coarse IDs directly, without scanning the full glyph store. Its shared paint plan
keeps canonical order while text LOD is active. The synthetic
`native-ordered-text-lod` and `three-ordered-text-lod` tests cover all four paths,
paint boundaries, clips, layers, selection reuse, exact zoom and resource
fallback. Three also exercises MapControls panning, perspective tilt, lazy
Off-to-Auto material replacement and temporary text colors. Browser FPS and
visual checks remain manual.

Text LOD's 0.5/0.75 ink-height thresholds use CSS pixels on high-DPI canvases;
the GPU still renders at full backing resolution. Native rendering uses the
canvas backing-to-client size ratio, and Three uses the host renderer's pixel
ratio. Offscreen targets and resolution below DPR 1 retain device-pixel
thresholds. This prevents DPR alone from expanding unreadable overview text
into millions of exact glyphs; zooming restores exact detail. The 200,000-glyph
soft target remains diagnostic, not a cap on readable text.

Text LOD measures glyph height perpendicular to the projected text baseline,
so steep perspective views can simplify distant text even when it stretches
sideways on screen. The height bounds cover the complete cluster; nearby
readable text and camera-plane crossings stay exact. Mixed text orientations
use conservative direction or maximum-stretch bounds. Affine selection reuse
includes the projected basis, so rotating an anisotropic view cannot reuse an
incorrect detail decision. Ordered selection searches paint ranges only when
leaving the current paint, instead of once per glyph. The
`text-lod-foreshortening` test checks sampled projection bounds, near/far text,
orientation changes, and the paint-lookup work budget.

The normal zoom baseline uses a 1.25-pixel tolerance. Tile pressure may choose
coarser levels up to a 5-pixel nominal overview tolerance, also past the first
normal LOD threshold. Planar and tilted views first select within those limits
and count the actual culled, deduplicated draw IDs. Only if that count exceeds the global
soft budget (82,500 strokes) may tiles exceeding their share search coarser
overview levels beyond that limit, stopping at the finest one that fits. If none
fits, they use the smallest available representation. This prevents a zoom
threshold from forcing a dense tile back to millions of strokes without thinning out affordable hatching just
because it crosses multiple tiles. The initial counting pass stops at 82,501 IDs;
only over-budget views need a second selection pass. Exact geometry returns
whenever it fits the tile budget. Effect scenes have no overview levels and stay
exact past the threshold; force-exact bypasses budget selection. Tilted views
keep their projected budget shares and frustum culling during the retry.
Visibility cache keys include both the normal baseline and the pressure limit, including
when discarded build levels leave gaps in the tolerance sequence. Active-level
stats mark overview approximations for the HUD.

Tilted perspective views have no uniform pixel scale, so each tile derives its
limits from the projection. Tiles are clipped to the frustum side planes with a
16-pixel margin. Hidden tiles are skipped, and primitives in cut tiles are
culled against the same planes. The plane's pixel Jacobian is N / W^2 with N
affine, so the vertex maxima of |N| and 1 / W^2 bound its largest singular value
over a clipped polygon. That bound, over the tile widened by a quarter tile,
sets the tile's baseline and pressure limit. The budget is shared by screen-area
magnification, |det H| / W^3 for the plane homography H, normalized over the
visible area of occupied tiles, so nearer tiles receive more strokes. Merged
lines can reach far past their tile into nearer, more magnified tiles. The first
selection pass allows a level only while everything it lists in the tile stays
within the 5-pixel limit wherever visible; these per-level tile bounds are built
on first tilted use. The over-budget retry may relax this primitive-reach limit
for overview levels as well. The HUD reports the nearest tile's baseline and the
mean tile target from the final selection pass.
Tilted selections are recomputed every frame.
Canonical PDF/HEP geometry is unchanged. Native panning, inertia, zooming and
settled frames render directly at the current camera and viewport, with vector
LOD and visibility selection active throughout. The Draw counter reports the
vector representatives submitted for that frame.
