# Broschuere rendering performance investigation

## Native WebGL fit-all: follow-up capture (September 25)

A capture after the changes below (same document, viewport, DPR, zoom 0.224,
panning) samples a GPU command span of 15.3 ms p50 (16.0 ms mean) against about
17 ms before. CPU time per frame is 2.1 ms p50, so the frame is limited by the
span. Cutting WebGL calls by 63% bought about 10%, which rules out the
per-call hypothesis below. Across the two captures the span follows the number
of draws (343 to 294, −14%) more closely than calls, clears (−47%) or
render-target switches (−30%): roughly 50 µs of span per draw. The capture
cannot tell whether that is GPU execution or command submission, and the cost
model, which estimates a few milliseconds of shading, disagrees with the span.

`heprPerf.start({ gpuOperations: true })` now times each draw, clear and blit
of one frame in eight with its own GPU query (see the manual). If the summed
operation times fall far below the span, the GPU is waiting for commands; if
they approach it, the per-label totals and the slowest operations identify the
work to reduce.

The capture also reported `GL_INVALID_OPERATION: Feedback loop formed between
Framebuffer and active Texture`, which makes WebGL skip the draw. A composite
surface allocated mid-frame was bound on whichever texture unit was active, a
paint unit the renderer's frame-wide binding cache believed held its own
texture; a later paint into that surface then sampled it. The traced cold
frame showed three such draws, all on unit 11. Warm frames reuse pooled
surfaces, which is why the first trace missed it. The compositor now binds
textures it creates on its own units only.

## Native WebGL fit-all: submission-bound, then clip-bound (September 25)

The supplied native WebGL capture (HEP, 1920 × 945, DPR 1, automatic LOD)
samples GPU command spans of about 17 ms at fit-all (zoom 0.224), 17–19 ms at
zoom 0.103 and 8–9 ms at zoom 0.557. The HEP loaded in Node matches the
capture's source counts (1,410 paints, 2,897 strokes, 3,574 fills, 20,881
glyphs). Two headless tools were run against it; neither executes GPU work:

- A recording WebGL2 context under the real `WebGlFloorplanRenderer` traced the
  complete command stream of one frame at the capture's camera positions.
- A cost model replayed each traced draw's fragment control flow (quads from
  the uploaded textures, band loops, clip-chain walks, antialiased clip probes)
  using the shipped coverage functions.

Zooming out to 0.103 cuts modelled fragment work to a third, yet the capture
shows no GPU saving; zooming in to 0.557 increases it, yet the span halves.
Across the five captured zoom levels the span instead follows the WebGL call
count at roughly 1.2 µs per call (14,011 calls at fit-all), except at 0.557,
where fragment work is the larger term. Fit-all is therefore bound by command
submission (Chrome's GPU process and ANGLE), with fragment work second. This
is a correlation across one capture, not a measured attribution; the
follow-up capture above contradicts the per-call reading.

| Fit-all frame (traced/modelled) | Before | After |
| --- | ---: | ---: |
| WebGL calls | 14,011 | 5,221 |
| Texture binds / uniform calls | 2,395 / 5,562 | 810 / 841 |
| Draws / clears / blits | 343 / 105 / 14 | 294 / 56 / 14 |
| Render-target switches | 229 | 160 |
| Gradient fragments (modelled) | 2.81 M | 0.38 M |
| Texel fetches, whole frame (modelled) | 260 M | 105 M |

At zoom 0.557 calls fall from 4,177 to 1,701 and modelled fetches from 300 M to
81 M; at 0.103 fetches fall from 82 M to 39 M. These are counts and estimates,
not timings; only a new capture can show the resulting frame time.

Three changes produced these reductions; none rasterizes or caches content:

1. **Gradient quads clamp to their clip chain.** 31 of the 35 soft masks are a
   page-sized gradient rectangle under a small clip, and every pixel of the
   page walked the clip's candidate edges. Each native gradient fill now clamps
   its quad to the intersection of its clip chain's bounds, widened by the
   one-pixel coverage margin, and drops quads farther than that from the clip.
   Antialiased clip coverage cannot reach past that margin, so no pixel
   changes; `test-vector-clip-bands` verifies 5,400 points just past clamped
   bounds are uncovered. Native WebGL and WebGPU both clamp; Three keeps whole
   quads.
2. **Native WebGL stops resending constant state.** The compositor sampled from
   units 0–6, the same units as stroke and fill data, so every span reset the
   renderer's binding cache and every draw re-sent its sampler units, texture
   sizes and camera. Composite passes now use units 19–25 with sampler uniforms
   set once, gradient and raster paints bind through the frame's texture cache,
   and frame-invariant uniforms are set once per program per ordered frame.
3. **Single-paint group chains fold into one draw.** The dominant pattern is an
   opacity group around a soft-masked group around one fill: three surfaces,
   three composite passes and about six render-target switches for one shape.
   When a Normal-blend chain holds exactly one fill path, analytic gradient fill
   or image (no knockout, at most one soft mask), the compositor draws that paint
   straight onto the running surface with its alpha scaled by the opacities and
   the mask value at the pixel. The mask surface is still prepared as before.
   The shared compositor decides, so WebGPU and Three can adopt the same adapter
   methods; only native WebGL implements them so far. A randomized differential
   test (1,500 graphs with isolation, knockout, blend modes, nested opacity,
   alpha/luminosity masks with backdrops and transfers) matches unfolded
   compositing to 1e-9, and fails when any fold condition is loosened.

Remaining fit-all work, for follow-up: the 35 mask surfaces (a clear, a gradient
draw and a luminosity pass each, about 105 of 364 operations) could be
evaluated analytically in the folded paint, since each is one gradient under
rectangle clips. Fill coverage loops dominate the remaining modelled fragment
work. WebGPU and Three still composite every group; WebGPU also records a
render pass, bind group and uniform write per composite operation.

Validation: `npm run typecheck`, `git diff --check` and the 110-file fast suite
passed. The new GLSL was compiled with glslangValidator (ESSL 3.00, every shader
the traced renderer submits plus the mesh variants); the WGSL gradient shaders
were validated with naga. No browser, development server or PDF conversion was
run, so visual parity and frame times still need a manual capture.

## HEP-only Three zoom stall: diagnosis and fix

The two diagnostics-version-2 reports isolate the HEP pause to compositor
setup during a draw-schedule change. Both use Three r185, WebGL, 1920 × 945,
DPR 1, and automatic LOD. Their geometry counts match: 2,897 strokes, 3,574
fills, 20,881 text instances, 64 gradient fills, 31 rasters, 184 clip paths,
114 transparency groups and 35 masks. Their canonical paint-run counts differ:
24,887 in the HEP versus 1,410 in the PDF, principally individual fill/text
ranges versus coalesced runs. This describes the supplied scenes; it does not
establish that HEP serialization changes the run count.

| Capture frame | Frame CPU | Compositor setup | Schedule change |
| --- | ---: | ---: | --- |
| HEP 33 | 2,581.8 ms | 2,552.9 ms | version 2 |
| HEP 85 | 2,926.1 ms | 2,906.2 ms | version 3 |
| PDF 101 | 15.6 ms | 2.6 ms | yes |
| PDF 145 | 14.0 ms | 6.4 ms | yes |
| PDF 359 | 10.6 ms | 5.7 ms | yes |

Both HEP stalls spend only single-digit milliseconds rebuilding batches and
have no slow GL-call events. Their long GPU command spans overlap the CPU
pause and must not be read as seconds of GPU shader execution. The PDF has
no comparable pause: its maximum frame CPU time is 27.3 ms.

The compositor appended the new meshes' ranges and then removed each old
mesh's ranges individually using `splice`. With this HEP, every replan removed
24,792 ranges and shifted approximately 659 million array entries. This
quadratic cleanup explains why the scene with finer canonical runs stalls
although its geometry matches the PDF. The fix collects the live proxies,
releases removed proxies' owned subset buffers, then rebuilds and sorts the
range index once when membership changes. Unchanged frames retain the index.
Canonical IDs, paint order, source geometry, masks, resolution and surface
caching are unchanged; the fix introduces no quality or caching tradeoff.

A short headless reproduction loaded the existing HEP, kept one compositor
alive across zooms, and updated the real Three draw plan and material layers.
It did not parse a PDF or execute GPU commands. Zooms used the two stalled
frames' camera positions/scales. The earlier benchmark below created a new
compositor for each view, so it did not exercise removal after replanning.

| Transition | Proxy collection before → after | Whole compositor before → after |
| --- | ---: | ---: |
| First zoom replan | 2,182.1 → 5.7 ms | 2,190.1 → 13.9 ms |
| Second zoom replan | 2,918.7 → 6.8 ms | 2,924.3 → 19.9 ms |

These are single local CPU samples, not browser FPS measurements. Submitted
meshes, clear counts and requested clear pixels matched before/after in all
four views (initial, both zooms and a subsequent pan). Browser rendering and
visual parity still need manual verification. The steady 50–60 FPS versus
native remains a separate issue: fit-all captures submit similar work in the
HEP and PDF, and this cleanup only occurs when mesh membership changes.

Diagnostics version 2 retains the expanded scheduling, LOD, batch, GL-call and
frame-gap measurements described in [the manual](manual.md). Two additional
sections, `three.compositorCollect` and `three.compositorSelection`, now separate
index maintenance from visible-paint selection inside `three.compositorSetup`.
Profiling is opt-in; `webglCalls: false` disables detailed GL timing.

Modified for this fix: `src/threePaintCompositor.ts`,
`scripts/test-three-paint-compositor.mjs`, `docs/manual.md`, and this report.
The regression bounds indexed array work rather than wall time and failed on
the old per-range removal. It covers thousands of disjoint ranges, mesh
replacement, sorting, retained proxies/subset buffers, removal-only updates,
and ownership/disposal on both backend configurations.

Validation passed: TypeScript typecheck, `git diff --check`, and nine targeted
headless test files: three-paint-compositor, three-render-performance,
render-performance, three-vector-draw-batching, three-camera-stroke-lod,
three-ordered-stroke-lod, three-webgpu-composite-material,
composite-span-batching and native-paint-compositor.

Manual verification: reload `three-example.html`, open the same HEP and repeat
the zooms with the same viewport, DPR and LOD settings. Capture with
`heprPerf.start({ maxFrames: 1200, maxFrameRecords: 240 })`, then stop and copy
`heprPerf.json()`. Inspect `three.compositorCollect` on frames with
`three.scheduleChanges`, and check text, clips and transparency while zooming
in and back out. Compare PDF loading and repeat on WebGPU when available.
No browser, development server or PDF conversion was run.

## Three WebGL follow-up, September 24

The supplied Three WebGL capture contains 133 frames at 1920 × 945, DPR 1.
CPU p50 is 5.4 ms and p95 is 16.66 ms; sampled GPU command-span p50 is
11.81 ms. Frame 61 spends 2,626.1 ms on the CPU (2,626 ms inside render) and
has a 1,294.50 ms GPU command span, despite submitting only 188 draws.
That one stall dominates the 26.99 ms CPU average. Frame intervals omit gaps
over 250 ms, so their 12.5 ms median does not describe this hitch. CPU and GPU
measurements overlap. The capture does not distinguish shader compilation,
driver waits, batch preparation or allocation as its cause.

Inspection and a short headless comparison used the existing HEP, without
parsing a PDF or writing an archive. This copy has 24,887 draw runs, 2,897
source segments, 64 gradient fills and 31 raster layers, matching the capture's
two source counts. Earlier asset counts below describe earlier inspections.

Three's compositor now removes three sources of redundant work:

- A merged canonical run was added once for every intersected range owned by
  a mesh. It is now added once per mesh. Coverage checks previously searched
  the entire input span for each range; sorted, coalesced intervals now provide
  binary-search membership and retain the original geometry when fully covered.
  Partial selections still gather every instance attribute together, preserving
  canonical LOD origins, clip roots and holes from hidden paints.
- Raster and gradient slots previously stayed selected even when entirely
  offscreen, keeping their transparency groups active. They now use the existing
  conservative projected paint bounds and two-pixel AA margin. Unknown bounds
  and unsafe perspective projections retain the paint. Vector LOD culling and
  retained replay selection keep their existing behavior.
- WebGL surface clears now use the same effect bounds as composite passes.
  Wholly offscreen clears are skipped on both backends. WebGPU's attachment
  clear still covers the whole surface; no replacement draw pass is added.

The changes preserve paint order, geometry, masks, blending and rendering
resolution. They add no raster cache or geometry approximation.

The headless comparison loaded the real HEP into the Three WebGL material
layers, updated the shared draw plan and ordinary instance culling, and invoked
the compositor with a host that counted submissions and clear rectangles.
Views fit the document or the named page at 90% of the 1920 × 945 viewport.
It did not build the example's combined text/stroke LOD payloads or execute GPU
commands, so these counts are not predictions of the example's exact draw count
or FPS. They isolate the changed compositor work with identical layer inputs.

| View | Submitted meshes before → after | Clear calls before → after | Clear pixels before → after |
| --- | --- | --- | --- |
| Fit all | 348 → 348 | 106 → 106 | 192,326,400 → 2,760,957 |
| Page 14 | 113 → 56 | 38 → 20 | 68,947,200 → 5,176,895 |
| Last page | 114 → 56 | 40 → 20 | 72,576,000 → 3,792,353 |

Clear pixels count the requested rectangles, including repeated clears of a
surface; they are not GPU memory-traffic or timing measurements. The comparison
used the pre-change compositor from git as its baseline. Surface counts stayed
at 11 for fit-all and 7 for the page views. Local warmed compositor preparation
also decreased, but browser profiling is required to measure the end-to-end
gain and establish whether the long stall persists.

Modified files: `src/threePaintCompositor.ts`,
`scripts/test-three-paint-compositor.mjs`, and this report.
Validation passed: `npm run typecheck`, `git diff --check`, and nine headless
regressions: `three-paint-compositor`, `three-vector-draw-batching`,
`three-vector-instance-clip`, `three-ordered-stroke-lod`,
`three-raster-strip-batches`, `three-webgpu-composite-material`,
`composite-span-batching`, `pdf-compositing`, and `native-paint-compositor`
(all `scripts/test-*.mjs`). New cases exercise bounded clears, offscreen
groups, panning back, unknown bounds, perspective fallback, AA margins,
overlapping/adjacent selections and bounded range-check work.

Manual verification: run the viewer yourself and load the same HEP in
`three-example.html`. Capture fit-all panning and zooming separately with
`heprPerf`, including page 14 and the last page, at the same viewport and DPR.
Check mask/gradient edges, the translucent ovals, layer toggles, and content
returning after panning offscreen in Three WebGL and WebGPU. If the large pause
persists, capture a browser Performance trace across it; the current render-only
CPU section cannot identify the blocking call. No server or browser was run
during this investigation.

A Three pan cache remains a separate option: the native cache already avoids
most compositing work during covered pans, but extending it to Three brings
extra GPU storage and fractional-translation interpolation. That tradeoff needs
discussion before implementation.

## Fit-all panning after clip indexing

The follow-up live-PDF WebGL capture confirms indexing is active: fit-all frames
submit 22 indexed clip nodes, 223 paint batches and 64 analytic gradient fills.
The 353-frame capture has a 19.59 ms average rendered-frame interval and a
19.81 ms average GPU command span across 89 samples, with no dropped samples.
It mixes panning and zooming, so those averages are not a fit-all-only benchmark.
Retained fit-all samples are commonly about 22–24 ms; zoomed views with fewer
visible paints are about 9–12 ms even though the estimated gradient quad area
increases. That supports investigating per-frame submission and compositing
costs alongside fragment clipping. GPU command spans include possible gaps
between CPU submissions and must not be added to CPU frame time.

Translation previously replayed the entire ordered paint graph every frame.
WebGL explicitly excluded source-ordered scenes from its pan cache; WebGPU's
stroke/text eligibility thresholds also excluded this brochure. Both native
backends now admit source-ordered scenes with at least 4,096 draw runs, subject
to the existing motion and vector-LOD rules. Cache refresh uses the ordinary
ordered compositor, preserving clips, masks, blending and paint order. A covered
pan at the same zoom then submits one image blit plus any live highlights.

The cache is rebuilt on invalidation, changed zoom or exhausted overscan. Zoom
animation and settled frames still render directly from vector data. Fractional
translation can interpolate cached pixels; no scaled-cache zoom is introduced.
The shared cache-size policy preserves the viewport's pixel-center alignment,
caps the cache at 64 MiB and reserves room within the compositor's conservative
512 MiB budget. It reduces overscan or uses direct rendering when a useful
border cannot fit, rather than forcing extra compositor downscaling.

Native WebGL compositing also receives its known framebuffer/state from the
renderer, removing 12 `getParameter` and three `isEnabled` calls on each ordinary
composited frame. Shared/projected rendering retains state capture/restoration.
Compositor surface-budget estimates are cached per scene. The optional
`HEPR_DEBUG_COMPOSITE_STATS` wrapper now preserves bounds and blending support;
enabling it previously changed the operations it was meant to count.

These changes are covered by headless cache-reuse, invalidation, source-order,
overlay, state-restoration and memory-budget regressions. Runtime FPS and visual
parity remain unmeasured. At 240 FPS the frame budget is 4.17 ms; a cached pan
can avoid most of the recorded work, but cache refreshes and zoom redraws still
need measurement and may exceed that budget.

For comparison, capture fit-all panning and zooming separately at the same
1920 × 945 viewport and DPR 1. In a WebGL `heprPerf` report, inspect
`panCacheReuses` and `panCacheRefreshes` alongside CPU/GPU frame times. Reuse
frames should have no scene paint batches; refreshes still submit the complete
ordered content for the cache viewport. Visually check gradient/mask boundaries,
page 14's translucent ovals, highlights, layer toggles and the end of a drag in
both backends. No PDF conversion, development server or browser was run for this
follow-up.

Follow-up files:

- `src/nativeRenderPolicy.ts`, `src/nativePanCache.ts`,
  `src/webGlFloorplanRenderer.ts`, `src/webGpuFloorplanRenderer.ts`: cache
  eligibility, bounded sizing, ordered refresh and curve-mode invalidation.
- `src/webGlPaintCompositor.ts`, `src/pdfCompositeBudget.ts`,
  `src/scenePaintCompositor.ts`: known native state, cached budget estimates and
  transparent diagnostics.
- `scripts/test-native-pan-cache.mjs`,
  `scripts/test-native-ordered-pan-cache.mjs`,
  `scripts/test-webgl-ordered-state.mjs`,
  `scripts/test-composite-span-batching.mjs`, `scripts/lib/testSuites.mjs`:
  regressions and fast-suite registration.
- This report and `docs/manual.md`: capture interpretation and counter definitions.

Validation passed: `npm run typecheck`, `git diff --check`, and the 12 headless
files `test-native-pan-cache`, `test-native-ordered-pan-cache`,
`test-webgl-ordered-state`, `test-composite-span-batching`,
`test-pdf-compositing`, `test-native-paint-compositor`, `test-native-text-lod`,
`test-webgl-performance`, `test-render-performance`, `test-webgl-draw-calls`,
`test-webgpu-draw-calls`, and `test-native-primitive-interaction` (all `.mjs`).
The full test suite and browser checks were not run.

## Earlier gradient investigation

The strongest identified hotspot is the polygon clip applied to the orange/red
gradients. Before indexing, both native backends evaluated every edge of that
clip for every fragment. Enlarging the object increased the number of fragments
without reducing the edge list. The supplied live-PDF capture below supports a
GPU bottleneck that grows with clipping work. The shared clip implementation now
indexes dense polygons by horizontal bands while retaining their original edges.
A before/after GPU capture is still needed to measure the speedup.

Inspection used the existing
`public/examples/heps/20260415_Broschuere_Leo_B2C_RZ_online_reduz_-parsed-data.hep`
(generated September 20, 2026). No PDF conversion or asset regeneration was run.
The asset contains 31 axial gradients, each painted through a four-line rectangle,
with no gradient masks or gradient meshes. It also contains 103 clip paths with
21,012 edges in total. The curved outlines of several gradient objects are stored
as dense polygon clips, rather than curved gradient-fill paths.

| PDF page (one-based) | Gradient fill index (zero-based) | Clip index | Polygon edges |
| --- | --- | --- | --- |
| 2 | 3 | 15 | 4,096 |
| 3 | 4 / 5 | 20 / 21 | 2,049 each |
| 7 | 14 / 15 | 50 / 51 | 1,027 each |
| 8 | 17 / 18 | 60 / 61 | 1,027 each |
| 12 | 25 | 82 | 4,096 |
| 15 (last) | 30 | 101 | 2,945 |

Page 14's stored gradient (index 29) has only a four-edge clip. Dense gradient
clipping alone does not establish the cause of the reported slowdown on that
page; capture that view separately, including nearby pages if they remain visible.
Its larger overlays include raster layers 41 and 42 (1786 x 1263 and 2482 x 1755
pixels); nearby ordinary curved fills are small lettering and dots, rather than
a large curved mask over the gradient.
These observations describe the saved HEP, which may differ from a newly parsed
PDF or another saved version.

The relevant code is:

- [vectorClipShaders.ts](../src/vectorClipShaders.ts): `heprVectorClip` now selects
  the current row's candidate edges for indexed polygons in both GLSL and WGSL.
  The crossing predicate and winding calculation are unchanged; unindexed
  polygons retain their original full scan.
- [vectorClips.ts](../src/vectorClips.ts): `packVectorClips` builds the optional
  band index during upload and retains the exact-rectangle bounds checks and
  intersection of consecutive rectangular ancestors. The shared packer and
  shaders serve native and Three WebGL/WebGPU rendering.
- [nativeVectorClips.ts](../src/pdf/nativeVectorClips.ts): curve subdivision uses
  a fixed `0.0001` coordinate-unit flatness tolerance, producing many line edges.
- [nativeGradientWebGlShaders.ts](../src/nativeGradientWebGlShaders.ts) and
  [nativeGradientWebGpuShaders.ts](../src/nativeGradientWebGpuShaders.ts): clipping
  runs after fill coverage and gradient sampling. The axial color calculation
  itself is a projection followed by a lookup into the existing color table.

For scale, a 4,096-edge clip evaluated over 1920 x 1080 framebuffer pixels implies
about 8.49 billion edge-loop visits per draw with the original full scan. This is
an unindexed work estimate, not a measurement of executed GPU instructions:
clipping, discarded fragments, overlap, driver behavior, and the actual viewport
all affect execution.

The implemented horizontal-band index assigns each original edge to every band
touched by its vertical extent, with conservative padding at Float32 boundaries.
A fragment reads its own band's candidate list and applies the unchanged crossing
and winding calculation. The original Float32 endpoints, fill rules, parent
chains, and half-open endpoint comparisons are retained. No geometry is simplified
and no fixed-resolution mask is introduced. Index memory is bounded; small paths,
unsuitable edge distributions, and paths that would exceed the packing budget
retain the original full scan. The index is built at runtime for both PDF and HEP
loading, so existing HEP files benefit without regeneration.

Running the production packer over the saved HEP indexes 10 of its 103 clips.
The resulting clip texture payload contains 65,852 texels (1,053,632 bytes),
compared with 21,115 texels for raw headers and edge lists. The additional storage
holds band tables and duplicates unchanged edges across candidate lists. The
following counts include the production guard of one neighboring band on each
side:

| Clip | Original edges per fragment | Bands | Average candidates | Worst band | Middle band |
| --- | --- | --- | --- | --- | --- |
| 15 (page 2) | 4,096 | 256 | 48.65 | 279 | 32 |
| 20 / 21 (page 3) | 2,049 each | 256 | 25.80 | 68 | 18 |
| 50 / 51 (page 7) | 1,027 each | 128 | 24.93 | 95 | 16 |
| 60 / 61 (page 8) | 1,027 each | 128 | 24.99 | 96 | 16 |
| 82 (page 12) | 4,096 | 256 | 48.70 | 274 | 30 |
| 101 (last page) | 2,945 | 256 | 35.03 | 322 | 18 |

These are static candidate counts from the actual packed texture, not measured
GPU timings or predicted FPS improvements. Averages weight bands equally rather
than weighting the visible viewport's pixels. Inspection read the existing HEP;
no PDF conversion was performed. That HEP contains older geometry than the user's
live-PDF capture below, so these counts do not describe that capture's exact scene.
Manual visual parity checks and before/after GPU timing remain necessary.

Before clip indexing, the user supplied a live-PDF WebGL capture at
1920 x 945 framebuffer pixels, DPR 1: 172 rendered frames and 43 available GPU timer samples, with no dropped
samples or disjoint-clock warning. It includes both fit-all panning and a zoom
transition, rather than three independent captures. The 120 retained frame
records are selected examples; their statistics must not be treated as an
unbiased distribution of all 172 frames.

Two directly comparable recorded examples illustrate the change:

| Metric | Frame 29, fit-all | Frame 169, enlarged view |
| --- | --- | --- |
| Zoom | 0.2243 | 1.5766 |
| GPU command span | 23.84 ms | 104.71 ms |
| CPU frame wall time | 21.30 ms | 104.20 ms |
| Recorded paint draw batches | 223 | 27 |
| Gradient draws | 64 | 11 |
| Submitted gradient path segments | 8,046 | 44 |
| Gradient clip-chain polygon edges | 53,964 | 17,447 |
| Estimated gradient quad pixels | 2.78 million | 12.40 million |
| Estimated gradient clip-edge checks | 2.20 billion | 18.71 billion |

Other retained GPU samples after the initial fit-all warmup are about 22-25 ms;
those at the final zoom are about 100-121 ms. The GPU slowdown occurs despite
fewer submitted batches and much simpler gradient fill paths. At the final zoom,
11 gradient draws submit 44 path segments but retain 17,447 polygon clip edges
across their clip chains. This is strong evidence for prioritizing clip indexing.
The quad and edge-check counts remain estimates before clipping/scissor/discard,
not GPU hardware counters. The draw-batch counter excludes compositor fullscreen
passes, so it is not the total number of GPU draw calls.

Frame 141 is particularly useful: CPU frame time is only 3.50 ms while the GPU
command span is 121.15 ms. Slow GPU frames therefore do not require expensive CPU
preparation. The roughly 100 ms CPU readings on later frames are almost entirely
inside `drawSubmission`, whereas gradient submission itself is only 0-0.2 ms.
These are wall-clock durations around JavaScript/WebGL calls; waiting in a driver
or browser call can appear there. GPU queue pressure or synchronization is a
plausible explanation, not a measured attribution. The compositor saves GL state
with `getParameter` calls; [WebGL documentation](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#avoid_blocking_api_calls_in_production)
notes that these can cause synchronous stalls. The report does not identify the
particular call responsible. CPU and GPU times overlap and must not be added.

PDF and HEP loading should produce equivalent prepared rendering data when the
source, parser version, extraction options and page layout match. The viewer's
`loadPdfBuffer` and the public PDF source loader both call
`prepareSceneForHepRendering`; the HEP builder uses that public loader. Both viewer
loading paths then build the same LOD data and upload into the same renderers.
Writing an archive is unnecessary for applying those rendering optimizations.
Gradient geometry is stored as Float32, with no HEP-only simplification pass.

The earlier count comparison was not a same-scene round trip: the bundled HEP was
saved on September 20, before parser/lowering changes on September 22 and 24.
The capture's 8,046 submitted gradient path segments differ from that artifact,
but this is not evidence that direct PDF loading intentionally receives fewer
optimizations. An older snapshot, extraction options or another scene difference
must be distinguished before attributing the counts to a loading-path bug.

Tracing parity did expose one small omission: HEP v8 rounds clip endpoints to its
1/512 coordinate grid, whereas live PDF preparation left them unrounded. The
shared preparation now applies the same clip rounding after page layout. A
synthetic regression first reproduced the mismatch, then verified bit-identical
clip edges and packed GPU clip data, parent chains, fill rules and draw references
across page layouts, compression modes and re-export. Cached parser data remains
untouched. This closes a precision gap; it does not reduce clip edge counts or
explain the large measured slowdown. No Broschuere PDF conversion was performed.

Polygon clip indexing now runs in the shared upload preparation and shaders so
that both PDF and HEP loading benefit. A comparison capture is more useful now
than repeating the same baseline; FPS and GPU-time improvements are unmeasured.

Additional options, in priority order:

1. Add conservative polygon/ancestor bounds rejection and scissoring. This saves
   work outside clips, though it helps less when the oval interior fills the view.
   Any early fragment discard must follow derivative calculations needed for AA.
2. Reuse a stencil or tessellated clip mask across paints. This is a larger change
   requiring checks for nested clips, fill rules, sample coverage, and boundary
   parity. A fixed-resolution raster mask can lose detail when enlarged.
3. For other documents, skip expensive quadratic-distance solves when a segment's
   control-point bounds prove it cannot affect edge AA. The text shader already
   uses this principle. Broschuere's stored gradient paths contain only lines, so
   this is secondary here.

The investigation adds profiling diagnostics, the clip precision parity fix,
and shared clip-edge indexing. Native WebGL's `heprPerf` captures include gradient
submission CPU sections, analytic/mesh counts, original clip polygon edge counts,
and estimated quad pixels and unindexed clip-edge visits. The new
`gradientFillIndexedClipNodes` and `gradientStrokeIndexedClipNodes` counters count
indexed polygon nodes across submitted draw chains; repeated draws count again,
and rectangles are excluded. They confirm that indexing is active without
scanning candidate edges during profiling.

`gradientAnalyticFillClipEdgeTestsEstimate` deliberately remains the unindexed
full-scan baseline. It does not measure the optimized shader's actual candidate
visits and should not decrease merely because indexing is enabled. The original
edge-count counters also remain comparable with earlier captures.
See [the manual](manual.md) for counter definitions. GPU timing
uses asynchronous [WebGL timer queries](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/)
when available. It measures the whole frame command span, not an isolated gradient
shader, and overlaps CPU time. The console capture currently supports native
WebGL only; the shared shader diagnosis applies to WebGPU too.

For manual verification, start the viewer normally and load Broschuere. Select
WebGL and make separate captures for fit-all, the enlarged last-page object, and
the penultimate-page view, keeping the viewport, DPR, and visible layers fixed:

```js
heprPerf.start({ maxFrames: 600, maxFrameRecords: 120 });
// Gently pan at the selected zoom for several seconds to keep frames rendering.
heprPerf.stop();
copy(heprPerf.json()); // Chrome DevTools helper; save each capture separately.
```

Send the three JSON reports along with the browser and GPU model. Compare
`frameCpuMs`, `gpu.frameMs`, indexed clip-node counts, the original clip-edge/pixel
estimates, and correlated `frameRecords`. Compare matching camera views against
the earlier unindexed captures; use GPU time to assess the improvement rather than
expecting the baseline edge-check estimate to fall. If GPU timers are unavailable,
the report says so explicitly.
Rendering is demand-driven, so an idle view alone will not produce a useful sample.
No development server or browser session was started during this investigation.

Validation passed: TypeScript typecheck and the headless render-performance,
WebGL-performance, WebGL-draw-calls, and vector-gradient-clips tests. The latter
also checks clip-chain counters, rectangle fast paths, viewport area estimates,
mesh/projected exclusions, and inactive-capture behavior. The supplied GPU capture
was analyzed without running a browser locally. The indexed shaders still
need manual visual checks and before/after GPU measurements.

The parity follow-up also passed TypeScript typecheck and the headless
`test-hep-scene-parity.mjs` and `test-hep-scene-sections.mjs` tests. These build
small synthetic in-memory scenes, not converted PDF assets. Manual PDF/exported-HEP
visual comparison remains useful for checking clip boundaries at high zoom.

The horizontal-band implementation passed TypeScript typecheck and the headless
`test-vector-clip-bands.mjs`, `test-vector-clips.mjs`,
`test-vector-gradient-clips.mjs`, `test-three-vector-instance-clip.mjs`,
`test-webgl-shader-precision.mjs`, `test-vector-run-clip-elision.mjs`, and
`test-hep-scene-parity.mjs` tests. The new band regression checks 24,679 endpoint
and band-boundary rows and 20,128 Float32 winding comparisons, including both
fill rules, transformed outlines, holes, self-intersections, nested rectangles,
extreme coordinates, and storage-budget fallbacks. These checks do not replace
compilation and visual inspection on actual WebGL/WebGPU drivers.
