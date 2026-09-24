# Broschuere gradient zoom investigation

The strongest identified hotspot is the polygon clip applied to the orange/red
gradients. Both native backends evaluate every edge of that clip for every
fragment. Enlarging the object increases the number of fragments without
reducing the edge list. The supplied live-PDF capture below supports a GPU
bottleneck that grows with clipping work. Isolated pass timing or a before/after
comparison is still needed to establish exactly how much time clipping accounts for.

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

- [vectorClipShaders.ts](../src/vectorClipShaders.ts): `heprVectorClip` fetches
  every polygon edge and evaluates its crossing predicate per fragment in both
  GLSL and WGSL. Polygon clips have no spatial index.
- [vectorClips.ts](../src/vectorClips.ts): `packVectorClips` already replaces
  exact rectangles with bounds checks and intersects consecutive rectangular
  ancestors. Dense polygon children still retain their complete edge lists.
- [nativeVectorClips.ts](../src/pdf/nativeVectorClips.ts): curve subdivision uses
  a fixed `0.0001` coordinate-unit flatness tolerance, producing many line edges.
- [nativeGradientWebGlShaders.ts](../src/nativeGradientWebGlShaders.ts) and
  [nativeGradientWebGpuShaders.ts](../src/nativeGradientWebGpuShaders.ts): clipping
  runs after fill coverage and gradient sampling. The axial color calculation
  itself is a projection followed by a lookup into the existing color table.

For scale, a 4,096-edge clip evaluated over 1920 x 1080 framebuffer pixels implies
about 8.49 billion edge-loop visits per draw. This is a work estimate, not a
measurement of executed GPU instructions: clipping, discarded fragments, overlap,
driver behavior, and the actual viewport all affect execution.

The first recommended optimization is a horizontal-band index for polygon clips,
modeled on [vectorFillBands.ts](../src/vectorFillBands.ts). Assign each original
edge to every band touched by its vertical extent. A fragment reads its own band's
candidate list and applies the unchanged crossing and winding calculation.
Retain the original Float32 endpoints, fill rules, parent chains, and half-open
endpoint comparisons; conservatively include boundaries with matching CPU/GPU
Float32 addressing. Cap index memory and keep the full scan as a fallback for
paths whose edges span most bands. This targets both backends through their shared
clip implementation and needs no HEP regeneration or geometry simplification.

A static candidate-count experiment on the existing clip coordinates gives:

| Clip | Original edges per fragment | Average candidates with 256 bands | Worst band | Middle band |
| --- | --- | --- | --- | --- |
| 15 (page 2) | 4,096 | 17.99 | 164 | 12 |
| 82 (page 12) | 4,096 | 17.99 | 160 | 12 |
| 101 (last page) | 2,945 | 13.50 | 191 | 7 |

These averages weight bands equally; they are not viewport-weighted GPU timings
or predicted FPS improvements. The experiment includes both endpoints in band
assignment and leaves the final crossing test unchanged. Production code still
needs boundary, nesting, both-fill-rule, and GPU parity validation.

The user supplied a live-PDF WebGL capture at 1920 x 945 framebuffer pixels,
DPR 1: 172 rendered frames and 43 available GPU timer samples, with no dropped
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

Polygon clip indexing belongs in the shared renderer preparation/shaders so that
both PDF and HEP loading benefit. A comparison capture after that optimization is
more useful now than repeating the same baseline; FPS improvement is unmeasured.

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

The investigation adds profiling diagnostics and the clip precision parity fix
described above; clip-edge indexing is not yet implemented. Native WebGL's
existing `heprPerf` captures now include gradient submission CPU sections,
analytic/mesh counts, clip polygon edge counts, and estimated quad pixels and
clip-edge visits. See [the manual](manual.md) for counter definitions. GPU timing
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
`frameCpuMs`, `gpu.frameMs`, the gradient clip-edge/pixel estimates, and correlated
`frameRecords`. Low CPU time with rising GPU time and clip-edge estimates supports
the clip bottleneck. If GPU timers are unavailable, the report says so explicitly.
Rendering is demand-driven, so an idle view alone will not produce a useful sample.
No development server or browser session was started during this investigation.

Validation passed: TypeScript typecheck and the headless render-performance,
WebGL-performance, WebGL-draw-calls, and vector-gradient-clips tests. The latter
also checks clip-chain counters, rectangle fast paths, viewport area estimates,
mesh/projected exclusions, and inactive-capture behavior. The supplied GPU capture
was analyzed without running a browser locally. Future shader optimizations still
need manual visual checks and before/after GPU measurements.

The parity follow-up also passed TypeScript typecheck and the headless
`test-hep-scene-parity.mjs` and `test-hep-scene-sections.mjs` tests. These build
small synthetic in-memory scenes, not converted PDF assets. Manual PDF/exported-HEP
visual comparison remains useful for checking clip boundaries at high zoom.
