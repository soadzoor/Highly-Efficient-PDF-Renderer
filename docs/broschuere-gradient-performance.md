# Broschuere rendering performance investigation

> Current status: native pan-cache has been removed in favor of direct rendering
> during all camera motion. Cache measurements and implementation notes below
> describe the historical implementation, not the current rendering policy.


## Half the Three render calls, and WebGPU frame pacing (September 26)

Captures at fit-all, with mask-content folding and lighting off in Three:

| Backend | Frame interval p50 | CPU p50 | GPU p50 |
| --- | --- | --- | --- |
| Native WebGL | 4.2 ms (238 FPS) | 1.9–2.5 ms | 3.7–3.8 ms |
| Native WebGPU | 12.5 ms (80 FPS) | 1.7 ms | 3.0 ms |
| Three WebGL | 8.4 ms (119 FPS) | 6.2–6.7 ms | 5.8–6.3 ms |
| Three WebGPU | 25 ms (40 FPS) | 19.9–21.2 ms | 3.2 ms |

### Native WebGPU frame pacing

Native WebGPU needed about 4.7 ms of CPU and GPU time but presented every
third 240 Hz vsync. Its loop waited for each frame's `onSubmittedWorkDone`
before it requested the next animation frame. Encoding therefore never
overlapped GPU work, and a frame plus the completion's trip back to the page
missed two vsyncs.

A frame may now start while the frame before it is still on the GPU, but never
while two frames are. This is not a queue of finished frames waiting to be
shown. Here the next frame spends 1.7 ms encoding, which is longer than the
0.5 ms or so the previous frame still needs on the GPU. So the previous frame
has finished before the next one is submitted, and input waits for nothing.
Only a GPU slower than the display makes a frame wait, and then only for the
rest of the one frame ahead of it. Chrome gives WebGL the same overlap: its
next animation frame does not wait for the GPU either. Afterwards native WebGPU
ran close to native WebGL.

### Three: one render call per surface, not per operation

Three WebGPU gives every `renderer.render()` call its own command encoder,
render pass and `queue.submit`. Chrome's `GPUQueue::submit` flushes to the GPU
process at once (`FlushNow()`), so each call costs about 110 µs of page time
here. Three's own JavaScript is about 34 µs of that in the mock-device run.
The compositor made 149 calls a frame, and cutting the call count is the fix
that stays within Three's normal rendering.

- **Batching.** Consecutive compositor operations into the same surface now
  share one host render.
  - Each queued mesh applies its own state in `onBeforeRender` and restores it
    in `onAfterRender`. That state is a folded paint's opacity and mask, shape
    coverage, or a composite pass's inputs. Three WebGPU reads per-object
    uniforms and textures as it draws each mesh. WebGL uploads them again
    because `uniformsNeedUpdate` is set.
  - A paint drawn twice in one batch uses a separate stand-in mesh and subset
    buffer each time.
  - Composite passes cover their rectangle with a unit quad placed by a
    clip-space uniform instead of a scissor. Three sets the scissor per render
    call, so a scissored pass could not join a batch.
  - A batch renders before anything writes a surface it reads or draws into.
- **Computed gradient masks.** 28 of the 29 folded masks were one axial
  gradient over the page, under one four-edge clip inside the folded paint's
  own clip. Rendering each one cost a clear and a render. It also split the
  running surface's batch in two.
  - The folded paint now computes such a mask at each fragment. It uses the
    gradient's colour table, bound in place of the mask surface, and a
    pixel-to-gradient homography. Coverage comes from up to eight half-planes
    for the paint's outline and its one extra clip.
  - Anything else keeps the rendered mask: a mesh gradient, a gradient masked
    by another, a curved or concave outline or clip, a deeper clip chain, a
    colour override, or geometry behind the camera.
- **Smaller fixes.**
  - The blend pass material was `transparent` and double-sided, and Three r185
    draws such a material twice, back faces first. That cost 12 wasted draws a
    frame.
  - The page background texture was re-uploaded every frame because its colour
    was set unconditionally.
  - Pass inputs switched between nearest and linear placeholders, which made
    Three free and recreate a sampler every frame.
  - The compositor's scene and camera no longer update their world matrices on
    every call.

In the mock-device run, a frame now makes 71 compositor render calls (was
149), 3 clears and 75 queue submissions (was 153), and 193 indexed draws (was
220). A capture is needed to see what that buys in Chrome. At about 110 µs
per call, it should roughly halve Three WebGPU's CPU time. Three WebGL makes
the same calls, so it should gain too.

The remaining calls are mostly masked isolated groups, whose mask content
renders and then converts in a pass of its own. The rest are blend-mode groups,
which copy their backdrop, and three non-isolated groups.

## Three WebGPU: where the CPU time goes (September 26)

Captures after the changes below, at fit-all on the same machine:

| Backend | Frame interval p50 | CPU p50 | GPU p50 |
| --- | --- | --- | --- |
| Native WebGL | 4.2 ms (238 FPS) | 2.4 ms | 4.6 ms |
| Three WebGL | 8.4 ms (119 FPS) | 6.7 ms | 7.9 ms |
| Three WebGPU | 29.2 ms (34 FPS) | 24.9 ms | 8.5 ms |

Three WebGPU is bound by CPU. Of its 24.9 ms, 12.4 ms go to about 104
`renderer.render()` calls that draw paints and 7.0 ms to 73 that run passes,
about 110 µs per call. Each call begins a command encoder and a render pass
and submits them: 182 of each per frame.

Driving the real WebGPURenderer and Three object against a mock device in
Node measures Three's own JavaScript at 6.9 ms per frame, so the rest of the
browser's cost is most likely in its WebGPU calls. Two findings from that
profile are fixed:

- With lighting enabled, WebGPURenderer rehashes the scene's lights node once
  per render call, which was 16–20% of the JavaScript. The compositor now turns
  lighting off while it renders; none of its materials are lit.
- 35 soft masks are one gradient each with a luminosity conversion and no
  transfer function, and 29 of them feed folded paints. Both conversions are
  linear in the premultiplied pixel, so the folded paint now reads the mask's
  rendered content and converts it itself, as `dot(pixel, weights) + bias`.
  That saves 29 passes on every backend.

In the mock-device run, Three WebGPU now makes 149 render calls (was 178) and
44 composite passes (was 73), and its JavaScript takes 4.8 ms per frame.

## Three and WebGPU: native WebGL's savings, and captures (September 26)

The first three differences below are now fixed; no captures yet.

- Three's gradient quads are clamped to their clip chain's bounds. Three always
  projects through local-to-clip, so the margin is the largest at any of the
  clamped rectangle's corners. On Broschuere this shades 0.26 M gradient pixels
  instead of 1.87 M.
- Three (WebGL and WebGPU) and native WebGPU fold single-paint group chains
  holding a fill or an analytic gradient fill. All 29 folds on Broschuere are
  such fills (21) and gradients (8), each with a soft mask. The compositor then
  issues 55 clears, 61 passes, 12 copies and 75 spans plus 29 folded draws,
  instead of 104 clears, 110 passes, 12 copies and 104 spans.
- On WebGPU a clear waits for the next pass into its surface, which clears as
  it loads. Native WebGPU then encodes 171 render passes for Broschuere instead
  of about 320, and only 4 of them only clear. Three WebGPU does the same with
  `autoClear`, saving each clear's pass and submission.
- `heprPerf` captures native WebGPU, with CPU sections and GPU times from
  timestamp queries on every render pass, and Three WebGPU through Three's
  timestamps.

## Three WebGL: what the first capture shows (September 26)

At fit-all, Three WebGL frames arrive 8.4 ms apart at the median (120 FPS)
and 10.5 ms on average. CPU time is 7.3 ms per frame, against 2.3–2.7 ms
native. The GPU command span is 8.2 ms. Fills and gradient fills match native
draw for draw (same instance counts), and so do their stores (579 cell-indexed
fill paths), clip packing and shaders. Three frames the document smaller,
though, at zoom 0.183 against native's 0.224; at that zoom the fill model
predicts 2.08 ms for native, against 2.26 ms at 0.224.

Four differences account for the gap:

- Three's gradient quads cover the whole path, not its intersection with the
  clip chain's bounds. That is 1.87 M pixels per frame against native's
  0.26 M, and gradient fills take 2.14 ms against 1.01 ms.
- Three does not fold single-paint group chains. The shared compositor then
  issues 104 clears, 122 passes and copies, and 104 spans, where native WebGL
  issues 55, 73, and 75 spans plus 29 folded draws. The capture's 105 clears
  and 122 passes match the unfolded counts.
- Each `renderer.render()` costs about 14 µs of CPU per mesh (native: about
  6 µs per operation), and a frame makes 229 of them: 105 draw groups and
  124 passes.
- Fills take 3.56 ms, against the 2.08 ms the model predicts, with the same
  program and data. The capture cannot tell why. One candidate is a GPU held
  at lower clocks while a CPU-bound frame keeps it waiting. To be rechecked
  once the CPU cost falls.

Native WebGPU cannot be captured yet: `heprPerf` in the native viewer supports
WebGL only, and Three WebGPU reports CPU sections without GPU times. Native
WebGPU does not fold either, and there a clear, a span and a pass each begin
their own render pass, about 340 per frame.

## WebGPU and Three: the same indexes (September 26)

Native WebGPU, Three WebGL and Three WebGPU now use the fill cells, gradient
fill cells and cell-indexed clips that native WebGL uses. Clip antialiasing is
also sample-only on all four. Three WebGL already ran native WebGL's GLSL, so it
needed only the stores and the cell uniform. The WGSL cell coverage matches
the GLSL on every test box to 1e-12. The WGSL clip was translated to C++ and
compared with a brute-force point-in-polygon test over 9,919 points per layout
(cells and bands): 0 mismatches in point tests and in 4×4 sample coverage.
Each of ten deliberate errors in it was caught. No captures yet.

The native WebGPU gradient mesh shader has not compiled since the band header
joined the gradient fill's varyings (49ffc7a): both used location 9. The mesh
color now has a location of its own.

## Native WebGL: a draw's pieces come from memory (September 26)

With one texel per line, frames arrive 5.5 ms apart on average at fit-all
(181 FPS, up from 175) and 4.2 ms at the median. The GPU command span fell from
5.1 to 4.8 ms p50. The capture now times every operation position
(`byPosition`), and their medians attribute 3.8 ms of the frame. Fills take
2.25 ms of that, gradient fills 1.03 ms, and everything else, including 55
clears and 35 soft-mask passes, 0.5 ms. The logo draws fell as the model
predicted: #303 from 0.21 to 0.13 ms, #60 from 0.10 to 0.06 ms. #354, whose
densest path is 60% quadratics, stayed at 0.22 ms.

Fitted over all 80 fill draws, a draw costs about 0.7 µs per dependent read
step of its worst pixel, plus about 0.1 ms per million texel fetches
(R² 0.74). A step of 0.4–0.8 µs is about one trip to GPU memory. A draw's
pieces are rarely cached: the piece textures (39 MB) exceed the L2 cache, and
each draw reads different paths. Coarser cells than half the footprint model
20% worse; finer ones gain 1–10%, depending on where each path's cell sizes
fall.

Reading more pieces per step did not pay off. Line cells read eight texels
per step and curve cells four pieces per step; the fitted model predicted
fills falling from 2.26 to 1.56 ms, and the capture measured 2.25 against
2.26 ms. The logo draw #303 fell from 0.131 to 0.114 ms, but the wide draws
each grew by 5–8 µs, and #354 stayed at 0.22 ms. #354 is limited by curve
arithmetic, not by fetches, and the step model overrates wider reads. The
change was reverted. Native WebGL now runs at 240 FPS at the median while
panning at fit-all, with about 4.7 ms of GPU time per frame.

## Native WebGL: fills fetch one texel per line (September 26)

Captures at fit-all after sample-only clip antialiasing. Frames now arrive
4.2 ms apart at the median on the 240 Hz display, 240 FPS, but 5.7 ms on
average (175 FPS): about a third of frames miss a refresh. The GPU command span
fell from 6.5 to 5.1 ms p50, and CPU time is 2.4 ms p50 and 4.7 ms p95. Timed
operations sum to 4.9 ms. Gradient fills fell from 2.7 to 1.0 ms per frame
(the model predicted −57%, the capture shows −63%). Fills fell only from 3.0
to 2.8 ms and are now most of the frame. Clears come next, at 0.6 ms for 55
per frame.

Fill draws cost time in two ways. Tiny dense draws, such as logos of 555–692
segments in 7×6 pixels, last as long as their slowest pixel. Reading one piece
ahead cut them by 12–19%. Wide draws of 40,000–67,000 pixels have worst pixels
under 200 units, yet take 0.07–0.10 ms. The frame's fills do 11.2 M units of
work, and those draws get through it at about 8 G units/s, so fetch
throughput matters too. 99.5% of cell pieces are lines, yet each piece took
two RGBA32F texels. The two piece textures hold 1099² texels each, 39 MB
together, more than the GPU's 24 MB L2 cache.

- **One texel per line.** A piece now keeps its endpoints in texture A and a
  curve's control point and flag in B. A cell holding a curve (1,017 of
  27,552 cells in this frame) stores its piece count negated. Other cells read
  their lines four at a time, one texel each. In the model, the fill draws'
  worst-pixel read steps drop from 6.6k to 2.7k and total fetches from 11.4 M
  to 9.5 M. Gradient fills use the same cells.

Two questions remain open. Draw #354 is bound by curve arithmetic: its densest
path is 60% quadratics, so its cells take the curve loop. Draws #303 and #60
draw the same logo with the same modelled work, yet #303 takes twice as long.
The profiler now lists every operation position (`byPosition`), so the next
capture can account for all 364 operations, not just the slowest 16.

## Native WebGL: draws last as long as their slowest pixels (September 25)

After the previous round, a `gpuOperations` capture panning at fit-all
measured fills at 3.0 ms and gradient fills at 2.7 ms per frame (medians),
against a model that predicted about 2.0 and 1.5 ms. The capture's per-position
medians (`typical`) show why. The most expensive draws are tiny: a fill draw
covering 426 pixels takes 0.26 ms, and gradient fills of 182 pixels take 0.23
ms, while a fill covering 67,000 pixels takes 0.12 ms.

The model ranks draws by their slowest pixel, the one with the most
dependent texture reads. That ranking reproduces the capture's list almost in
order. For gradient fills, the draws whose worst pixel does 1,100–1,450 units
of work take 0.22–0.27 ms, and those near 550 take about 0.15 ms: roughly 0.2
µs per unit, about one texture read's latency plus its arithmetic. Summed over
the frame, the slowest pixel of each fill and gradient-fill draw comes to 27k
units, about 6 ms of a 7 ms frame. Pixel counts and total work barely matter.
Draws effectively run one after another, and each takes as long as its
slowest group of 32 pixels. Untimed spans match the timed sums, so this is
not an artefact of the per-operation queries.

Those worst pixels come from small, very dense geometry. One fill path packs
688 segments into 7×5 pixels. Gradient clips are flattened into 1,027–4,824
edges; at a clip's edge the worst pixel spent 566 units on the distance probe
and another 875 on its samples.

- **Clip antialiasing from the samples alone.** The distance probe only
  decided whether to sample, but the 16 samples already give inside or
  outside. Each node now clears the bits of the samples outside it, reading
  cells about the size of the sample spread (0.75 pixels) rather than the
  probe's 1.5. Antialiased clips no longer run the point test either. In the model, the
  sum of gradient draws' worst pixels drops from 13.2k to 5.7k units at
  fit-all, and from 3.5k to 2.1k at zoom 0.56.
- **Reads before use.** Sample loops read four edges before testing any, and
  fill cells read the next piece and the next cell's record before computing
  the current piece. The dependent latencies then overlap instead of adding
  up. The model counts reads, not latency, so it cannot estimate this.

Coverage is unchanged. The shipped clip GLSL compiled as C++ still matches
brute-force 16-sample coverage on every checked query, for cells and bands,
and catches broken closures, rows, band rows, rectangle bounds and unroll
masks. `test-vector-cell-index` evaluates the read-ahead fill loop and fails
if the read-ahead or the pair mask is off by one.

## Native WebGL: after the cell index (September 25)

Two captures at fit-all (zoom 0.224, panning), one with `gpuOperations`,
measure the cell index. The GPU command span fell from 15.3 ms p50 to 6.6–6.7
ms. Frames now arrive 8.3 ms apart at the median on a 240 Hz display, which is
120 FPS: the GPU still misses every other refresh. CPU time per frame is 3.1 ms
p50 and 6.7 ms p95.

The timed operations sum to 6.7 ms p50, matching the span. Means per frame
were gradient fills 3.4 ms, fills 2.8 ms, clears 0.8 ms (55 per frame), text
0.6 ms, blits 0.5 ms and compositor passes 0.4 ms. The first timed frame after
the view settled took 89 ms and inflates each of these means; the profiler now
also reports medians (see the manual).

The frame model, updated for cells, explains most of the remaining gradient
time. At a clip's boundary, each of the 16 antialiasing samples walked the
whole clip chain again, which made up two thirds of the clip work. Fills spend
theirs on dense small paths, such as 1,294 segments in 49×49 pixels: with a
level step of four, a pixel read cells up to four times its size.

- **Clip samples in one pass.** A clip node with an edge near the pixel now
  clears the bits of the samples outside it, reading the cells or bands the
  probe already chose. Nodes with no edge in reach hold every sample or none.
  The frame model's sample work drops from 0.49 M to 0.09 M units, and the
  gradient fills' total from 0.74 M to 0.35 M.
- **Finer fill cells.** A pixel reads the finest level whose cells are at least
  half its footprint, up to 3×3 cells. Fill work drops from 1.14 M to 0.88 M
  units at fit-all and from 0.79 M to 0.63 M at zoom 0.158, with no change in
  memory. Level step 2, compared with step 1, fits 579 paths instead of 109 in
  the same budget.

Both keep coverage unchanged. The shipped clip GLSL, compiled as C++ with
float32 arithmetic, matches brute-force 16-sample coverage on 9,833 queries
for cell and band layouts, and fails when its closures, row selection, band
rows or rectangle test are broken. The same check against a JS mirror runs in
`test-vector-cell-index`.

The cell uniforms now count from one: Three's WebGL materials reuse the core
fill shader without setting them, and a zero base would have read segment data
as cell headers. Zero now means that no path has cells.

## Native WebGL: per-operation GPU times and the cell index (September 25)

A `gpuOperations` capture (zoom 0.158, panning) settled where the frame's GPU
time goes. The timed operations sum to 16.2 ms p50 against a 15.8 ms command
span, so the GPU is busy, not waiting for commands:

| Operations | Per frame | GPU ms per frame |
| --- | ---: | ---: |
| Gradient fills | 64 | 7.96 |
| Fills | 80 | 7.15 |
| Clears, raster, text, blits, composites, strokes | 220 | about 1.6 |

One fill draw of 13 paths took about 2.1 ms in every timed frame. Three of
its paths have 1,540–1,708 segments in only 12–13 horizontal bands, each 0.01
px tall at that zoom, so every pixel's footprint covered all the bands and
visited every segment about twice: 3,000 on average, 6,100 at worst. Gradient
fills are mostly four-segment rectangles, but their clips are polygons of
1,027–4,096 flattened edges in bands 0.03–0.25 px tall; the antialiased clip
probe visited 350–570 edges per pixel. Bands only divide paths vertically, so
once they are thinner than a pixel they stop limiting the work. That is why
zooming out never made frames cheaper.

Native WebGL now indexes fills, gradient fills and clip polygons with a
multi-level grid of cells (`src/vectorCellIndex.ts`). A pixel reads the finest
level whose cells span its footprint, splits its box at the cells' column
edges, evaluates only the segment pieces in those cells exactly, and accounts
for everything right of a column through a few closures per cell: the
vertical extents of right-hand geometry telescope to the points where the
path crosses the column's edge. Coverage matches the unindexed sum up to
rounding; `test-vector-cell-index` checks exact agreement on dyadic geometry,
Float32 and curve tolerances elsewhere, and 7,078 clip winding and distance
probes against brute force.

Modelled per-tile work at the captured view (the slowest pixel of each 8×4
block, summed; it matched the measured 15 ms before this change):

| Work | Bands | Cells |
| --- | ---: | ---: |
| Fill segment visits | 1.08 M | 0.45 M |
| Gradient clip edge visits | 0.97 M | 0.30 M |

Fill iterations also drop from three dependent fetches to two independent
ones. Of the remaining clip work, 0.18 M is antialiasing samples, each still a
full point test; evaluating all 16 samples in the probe's pass over the same
cells would remove most of it. The index adds about 0.3 s to scene upload for
this document and uses 1.2 M texels for fills (from 0.24 M segments) and 0.4 M
for clips. Only a new capture can show the resulting frame time.

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

- A recording WebGL2 context under the real `WebGlPdfRenderer` traced the
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
  `src/webGlPdfRenderer.ts`, `src/webGpuPdfRenderer.ts`: cache
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

## Compositor source layers and post-render statistics

The Three compositor submits source paints through proxy meshes into its render
targets, then presents the finished composite as one mesh in the host scene.
The proxy meshes share source materials and, for complete batches, geometry;
partial effect spans use their own instance selections. This does not draw the
complete PDF twice. Shape and mask passes may legitimately replay paints.

Previously the source layers remained attached to the PDF object and were hidden
after compositing. That prevented duplicate drawing, but the outer scene still
visited them during matrix updates. It also made the stroke/text statistics
getters treat the composited layers as inactive: the example's HUD substituted
zero for an unavailable stroke count.

Composited source layers now remain detached from the host scene. Their visibility
continues to describe the active layer selection, while only the presentation
mesh is attached for composited color output. Switching to direct material
rendering reattaches the layers and hides the composite.

A bounded headless check loaded the existing Broschuere HEP at fit-all with exact
stroke and text layers, without parsing the PDF or generating an archive. Both
Three backends reported 2,897 strokes and 20,881 text instances after compositing.
The compositor submitted 2,897 stroke instances, while the outer scene contained
no source paint meshes. Detaching the layers removed 224 source objects from the
outer scene's matrix traversal. Compositing still used 71 host render calls and
236 mesh submissions in this configuration. These are submission counts from a
mock host, not browser timings or GPU measurements, and do not establish the
cause of the reported native/Three performance gap.

Regression coverage checks scene-hook preparation, required knockout passes,
post-render statistics, shared proxy materials, offscreen/back-in-view selection,
source matrix traversal, and switching between composited and direct rendering
in both backends. Browser checks should compare fit-all appearance and frame
timings for the same PDF/HEP, viewport, DPR, and LOD settings.

## Native mask folding, pass batching, and backdrop reuse (September 27)

Native WebGL and WebGPU now compute eligible single-gradient soft masks inside
the folded paint shader, using the same eligibility, projection, coverage and
gradient sampling code as Three. Curved/non-convex boundaries, unsupported clip
chains, transfer functions, and color overrides retain the rendered-mask path.
Native projected views without an axis-aligned projector also keep that path.
The gradient LUT uses the existing mask binding; WebGPU fold uniforms retain a
distinct aligned slot for every draw, including the gradient parameters.

Native WebGPU keeps consecutive spans, folded paints and composite draws in one
render pass when they write the same attachment. Target changes, texture copies,
clears and presentation close the pass. Each operation resets the scissor before
applying its own bounds, so a small composite cannot clip the following paint.

All three compositor adapters now paint into their private initial backdrop
instead of copying it into another root texture. The shared executor still
supports callers that require an unchanged backdrop. Result/backdrop aliases
are released once, and Three retains the presented texture until its replacement
is ready. Native's initial framebuffer capture and final presentation remain.

A bounded headless comparison against the previous source loaded the existing
`20260415_Broschuere_Leo_B2C_RZ_online_reduz_-parsed-data.hep`, with all paints
selected, a 1920×945 viewport, and an orthographic fit-all view at 90% coverage:

| Native WebGPU compositor work | Before | After |
| --- | ---: | ---: |
| Encoded render passes, including parent start/resume | 142 | 64 |
| Texture copies | 12 | 11 |
| Paint span callbacks | 75 | 48 |
| Folded paints | 29 | 29 |
| Masks computed inside folded paints | 0 | 27 |
| Allocated pooled surfaces | 10 | 9 |
| Submitted stroke instances | 2,897 | 2,897 |

These are mock-device command counts, not GPU timings or FPS measurements.
No PDF conversion or browser session was run.

Implementation files: `gradientMaskFold.ts`, `nativePaintFold.ts`,
`scenePaintCompositor.ts`, `threePaintFold.ts`, `threePaintCompositor.ts`,
`webGlPdfRenderer.ts`, `webGlPaintCompositor.ts`,
`webGpuPdfRenderer.ts`, `webGpuPaintCompositor.ts`, and `webGpuPaintFold.ts`.
Regression changes are in `test-native-paint-compositor.mjs`,
`test-pdf-compositing.mjs`, `test-three-gradient-mask-fold.mjs`,
`test-three-paint-compositor.mjs`, and `test-webgpu-draw-calls.mjs`.

Validation covers native mask bindings and fallback, native/Three projection
parity at full and reduced surface resolution, merged passes and scissor resets,
per-draw uniform isolation, pooled surface ownership, failure cleanup, and
backdrop-reuse equivalence across 1,500 randomized compositing graphs. Type
checking and affected tests pass. The fast suite still has the existing
`test-pdf-session-render-fallback.mjs` blue glyph-stroke assertion failure,
reproduced with the modified source modules loaded from HEAD instead.

Manual verification: compare Broschuere at fit-all and while zooming/panning in
native WebGL/WebGPU and Three WebGL/WebGPU, with matching viewport, DPR and LOD.
Check soft-mask edges and opacity groups (including page 14), move the document
outside the frustum and back, resize the viewport, and inspect GPU validation
errors. Capture frame timings to determine the actual FPS improvement.
