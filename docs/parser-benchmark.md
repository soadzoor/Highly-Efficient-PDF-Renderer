# Parser benchmark

Use the production-bundle benchmark for parser cutover decisions. The older
`benchmark:native-vector-page` script intentionally calls the TypeScript
session directly, so it omits worker startup and transfer costs. Likewise,
`benchmark:native-dense-cutover` is a useful dense-pipeline microbenchmark but
does not exercise tier routing or detect a PDF.js fallback.

Build each checkout first, then run the same benchmark driver against each
build directory. For example, from the current checkout:

```sh
npm run build:lib
npm run benchmark:production-parser -- "public/examples/pdfs/Level 1.pdf" --runs 5 --json /tmp/hepr-current.json --fail-on-pdfjs-fallback
node --max-old-space-size=12288 --expose-gc scripts/benchmark-production-parser.mjs "public/examples/pdfs/Level 1.pdf" --package-root /path/to/main-worktree --runs 5 --json /tmp/hepr-main.json
```

The input file is read before timing. Package import is reported separately.
Each measured run gets a fresh process and a cold production worker. The
`parser engine boundary` is the number to compare; the script stops at the
first vector-LOD event, before LOD generation, upload, renderer construction,
or viewer work. `main-thread-fallback` is reported explicitly as a PDF.js
fallback. On the old `main` dense path, PDF.js text processing is part of the
dense route and therefore correctly remains inside its parser time.

For the browser check, build production assets in separate worktrees and serve
both `dist` directories with the same static server. Use the same browser and
PDF, reload between runs to clear the in-memory page-scene cache, discard one
warm-up, and record five `[Page grid] ... parsed ... ms` lines. That log starts
after source bytes are loaded and ends before vector LOD and GPU upload. Do not
compare the later `total` line as parser time. Also record the preceding HEPR
route line and reject a current-build run that reports a native or PDF.js
fallback unexpectedly.

## Local validation snapshot — 2026-09-07

These are development measurements, not a release-gate result. Environment:
Linux x64, Intel Core i5-7600K, Node 24.5.0 / V8 13.6.233.10-node.21.
The reference was a separately built read-only snapshot of `main` at
`6f32df28b0acde5cdc943dd5c332b9cd858bc74b`. The native build was the current
uncommitted migration worktree. Both used the same production benchmark driver,
all pages, a fresh process/worker per run, and no concurrent benchmark/test jobs.

Each entry is the median of three runs. Input read, package import, LOD,
upload, HEP export, and viewer rendering are excluded from parser time.

| PDF | main parser | native parser | Time change | main RSS increase | native RSS increase |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dublin 1st Floor 2018 06 01 | 2,561 ms | 1,806 ms | −29.5% | 250.5 MiB | 161.5 MiB |
| Level 1 | 12,575 ms | 7,700 ms | −38.8% | 1,450.9 MiB | 603.9 MiB |
| Broschuere Leo (15 pages) | 16,168 ms | 24,253 ms | +50.0% | 1,259.0 MiB | 1,251.7 MiB |

RSS is the sampled increase of the whole benchmark process, including worker
and native-canvas allocations; it is not an exact isolated parser-memory peak.
Dublin and Level 1 were measured before the subsequent image-loop changes,
which do not affect their dense route. The brochure native figures include
the byte-image optimizations and explicit temporary-surface cleanup. Its main
reference was measured immediately beforehand in an alternating main/native
series; individual main times were 16,168 / 17,600 / 16,017 ms. Native final
times were 24,342 / 24,253 / 23,857 ms. Earlier single-run brochure comparisons
were too variable to establish parity and are superseded by this table.

The image-heavy route is still slower than main. This snapshot therefore does
**not** meet the no-document-regression or corpus-wide performance gates.
The next profiling target at that point was duplicate image/resource preparation
when the legacy scene adapter needs a second compilation for selective
compositing; the follow-up below addresses that work.
Any reuse must remain operation-scoped and preserve resource limits, color
spaces, masks, cancellation, and returned-pixel ownership. Lowering image
resolution or changing the viewer is not an acceptable speed optimization.

The temporary PDF.js oracle is an isolated opt-in installation, not a root
workspace or published runtime dependency. The package test checks root
dependencies, emitted JavaScript/declarations, worker paths, and native Node
worker startup. Runtime attribution in `THIRD_PARTY_NOTICES` is intentionally
retained even though neither PDF library ships as a dependency.

The all-pages routing audit blocks both PDF libraries in the host and parser
workers and fails on any unsuccessful document:

```sh
node --max-old-space-size=12288 --experimental-strip-types scripts/audit-native-corpus-routing.mjs --timeout-ms 120000
```

This snapshot passed all 14 tracked PDFs on every page with dependency imports
blocked, all 86 selected native/parser/session/compatibility suites,
`npm run build:all`, and `git diff --check`. The routing audit ran alongside
the final regression suites, so its elapsed times are not benchmark results.
New image tests compare output bytes against the general color evaluator;
surface-lifetime tests cover successful extraction, failed pixel readback,
failed context creation, and session reuse without invalidating returned pixels.

The image work is in `src/pdf/nativeImage.ts`, `src/pdf/nativeColor.ts`, and
`src/pdf/deviceCmyk.ts`; parser-owned surface cleanup is in `src/pdfSession.ts`.
Regression coverage is in `scripts/test-native-image-semantics.mjs`,
`scripts/test-native-color-semantics.mjs`, and
`scripts/test-native-composite-lifetime.mjs` (selected through the shared test runner).
It introduces no viewer changes or lower-resolution rendering.

Routing success is not a visual, search/selection, or general PDF-feature
conformance result. Production Chrome/Firefox/Safari comparisons, cold tiny-PDF
startup, Node 22.13 compatibility, full corpus timing/memory gates, and manual
HEP v6 export/reload checks remain outstanding. No HEP format migration or
corpus HEP regeneration is part of this parser-performance validation.

## Operation-scoped resource reuse follow-up

The second compilation now reuses prepared page input, bound inline images,
font/image/color registries, and Form definitions from the first compilation.
Graphics/text interpreter state is still created afresh for each pass. The
reuse container lives only on that page operation's stack; it is not a session
or document cache. Compile limits are snapshotted for that operation, while
later calls (including queued calls) use their own limits and preparation.

The direct-engine benchmark now separates root font/image loading, the second
compilation, and selective compositing. Resource counters include newly
decoded images/masks and their decoded byte-store sizes, not encoded requests.
Use the internal profiling switch to reproduce the A/B comparison:

```sh
npm run benchmark:native-vector-page -- "path/to/document.pdf" --page-index 0 --no-resource-reuse --json /tmp/hepr-no-reuse.json
npm run benchmark:native-vector-page -- "path/to/document.pdf" --page-index 0 --json /tmp/hepr-reuse.json
```

The JSON reports include an exact scene fingerprint computed after timing and
memory sampling finish. It covers every scene field, typed-array byte, image
pixel, and text record; it is an internal validation artifact, not a new HEP
format. The switch is confined to the internal profiling method and is not a
public parser/engine selection option.

All 15 brochure pages produced matching fingerprints with reuse enabled and
disabled. Additional second-pass image/mask decodes fell from 44 to 5. On
source pages 0 and 6, second-pass preparations fell from 3/9 fonts and 2/4
images respectively to zero; these had regenerated 45.5/84.7 MiB of pixel
storage. This byte-for-byte check preserves the previous native output; it
does not establish visual parity with main on previously unreviewed content.

New focused tests cover codec invocation counts, scoped color aliases, soft
masks, Form inline images, caller-byte ownership, cancelled/queued operations,
session reuse, and lower limits on subsequent operations.

Production brochure comparison, all 15 pages, three fresh-process runs per
build, measured serially in before/current/main order with no competing test
jobs. The before build was preserved separately before rebuilding this branch;
main is the same revision and environment recorded above.

| Build | Median parser time | Sampled RSS increase |
| --- | ---: | ---: |
| Native before resource reuse | 23,910 ms | 1,227.4 MiB |
| Native with resource reuse | 18,575 ms | 1,244.2 MiB |
| main | 17,139 ms | 1,255.5 MiB |

Native time improved by 22.3%, but remains 8.4% slower than main in this sample.
There is no demonstrated RSS reduction from this change; the values are
comparable. Individual parser times (ms): before 23,910 / 25,281 / 23,033;
current 18,575 / 18,206 / 19,052; main 15,579 / 17,159 / 17,139. These figures
supersede the earlier brochure snapshot, not the outstanding browser and
full-corpus release gates. The measured compositing work remains substantial
after preparation reuse; further optimizations need separate profiling.

Separate production smoke checks (one fresh process per build/document, not
statistical release-gate results) retained the dense-route gains:

| PDF | main parser | native parser |
| --- | ---: | ---: |
| Dublin | 2,282 ms | 1,645 ms |
| Level 1 | 12,355 ms | 7,676 ms |
| Livermore | 8,316 ms | 6,606 ms |
| Lower Level | 18,560 ms | 13,520 ms |

Changed files for this follow-up: `src/pdfSession.ts`,
`scripts/benchmark-native-vector-page.mjs`, `scripts/lib/sceneFingerprint.mjs`,
`scripts/test-native-resource-reuse.mjs`, `package.json`, and this document.

Final automated checks passed: all 87 selected native/parser/session/
compatibility suites, the all-pages 14/14 corpus routing audit with both PDF
dependencies blocked, `npm run build:all` (including package/worker checks),
and `git diff --check`. The audit and test-suite runs were separate from the
production timing runs. Browser and manual HEP checks below have not been run.

### Human verification checkpoint

Use production builds of this branch and main, served separately. On this
branch, `npm run build` builds the demo and `npm run preview` serves it; the
user starts the server. Reload between PDF loads to avoid the scene cache.

Check the brochure (especially pages 1, 7, 10, and 11) for images, masks, text,
clipping, and overlaps. Check Dublin, Level 1, Livermore, and Lower Level for
sharp vectors, zoom/pan, and search/selection. Record the `[Page grid] ...
parsed ... ms` lines separately from total/LOD/upload times. Finally, export
HEP v6 from an already-loaded page/document and reload it to check appearance,
search, and navigation. Do not regenerate the entire HEP corpus at this stage.

## Selective compositing pixel-work follow-up

The parser's existing selective compositor now retains immutable image surfaces
across the serial passes of one page operation. It never retains output, group,
or rendered soft-mask surfaces. The cache admits at most 16 million pixels
(64 MB of RGBA backing pixels, excluding canvas implementation overhead),
counts retained pixels against the working budget, and releases unused entries
under budget pressure. A surface referenced by the active pass cannot be
evicted. Resources/factories cannot cross cache scopes, stencil paint colors
are part of the key, and cancellation/failure/page completion releases both
cached and scratch canvases. No cache persists across pages or session calls.

Soft masks now read and update only the exact nonzero-alpha content bounds.
Backdrop correction reads only the already-known selection rectangle, keeping
the same source coordinates, blend calculations, and pixel reconstruction
checks. Alpha-bound discovery finds each row's first/last visible pixel instead
of computing min/max for every interior pixel. There is no alpha thresholding.
Rendering surfaces and resolution remain unchanged: this intentionally stops
short of viewport-sized render surfaces, whose effect on gradient extents and
antialiasing would need separate validation. The GPU viewer and HEP v6 are
unchanged.

Direct page-7 diagnostics (single runs, not production performance gates):

| Work | Before | After |
| --- | ---: | ---: |
| Selective compositing | 1,625 ms | 1,195 ms |
| Image surfaces created | 7 | 3 (4 cache hits) |
| Image-surface pixels materialized | 15,329,685 | 6,569,865 |
| Group soft-mask pixels processed | 13,067,730 | 1,141,794 |
| Output pixels read back | 30,491,370 | 22,175,978 |

The page-7 exact scene fingerprint also matches the pre-change artifact.
All 15 brochure pages match byte-for-byte with cache/bounded work enabled and
disabled, including image pixels, text, geometry, and paint order. Image
surfaces materialized across those passes fell from 35 to 25. This is output
preservation against the accepted native path, not a new visual-oracle result.

Reproduce the internal diagnostic comparison without changing public options:

```sh
npm run benchmark:native-vector-page -- "path/to/brochure.pdf" --page-index 6 --no-composite-reuse --no-bounded-composite --json /tmp/hepr-composite-off.json
npm run benchmark:native-vector-page -- "path/to/brochure.pdf" --page-index 6 --json /tmp/hepr-composite-on.json
npm run test:file -- scripts/test-native-composite-reuse.mjs
# Optional: exact comparison of each page; no HEP output is generated.
npm run test:file -- scripts/test-native-composite-reuse.mjs "path/to/brochure.pdf"
```

The internal switches retain the common alpha-bounds scan and mask-loop
improvements. Production before/after timing uses the separately preserved
pre-change bundle, not these switches.

New regression coverage includes Alpha/Luminosity/empty masks, fractional
placement, Multiply backdrop reconstruction, pixel-budget pressure, cache
admission/ownership, source-page isolation, exact alpha bounds against a
deterministic brute-force reference, and readback cancellation/failure cleanup.
Changed files: `src/pdfSession.ts`, `src/heprCanvas2dRenderer.ts`,
`src/rgbaBounds.ts`, `scripts/benchmark-native-vector-page.mjs`,
`scripts/test-native-composite-reuse.mjs`,
`scripts/test-native-composite-lifetime.mjs`, `package.json`, and this document.

Production comparison on the same machine/Node/main revision as above: all
15 brochure pages, three fresh processes per build, no competing test/build
jobs. Each round rotated the build order: before/current/main,
current/main/before, main/before/current. The pre-change production bundle was
preserved separately before rebuilding. Input I/O, import, LOD, upload, and
viewer work remain outside parser timing.

| Build | Median parser time | Median sampled RSS increase |
| --- | ---: | ---: |
| Native before this change | 18,825 ms | 1,224.7 MiB |
| Native with surface reuse/bounded pixel work | 16,246 ms | 1,175.2 MiB |
| main | 17,750 ms | 1,232.8 MiB |

Native improved by 13.7% relative to the pre-change build and was 8.5% faster
than main by median in this sample. Individual times (ms): before
18,825 / 18,729 / 18,946; current 16,095 / 18,353 / 16,246; main
17,750 / 18,144 / 16,123. The overlapping ranges do not establish a guarantee
that every run is faster. Sampled RSS is a process-wide increase, not an exact
parser-owned allocation count, and no 25% memory-reduction claim is made.
Raw reports are `/tmp/hepr-compositing-{before,current,main}-{1,2,3}.json` in
this workspace session.

Validation passed: `npm run build:all` (type checks, persistent-viewer contract,
production demo/library, package/worker boundary), the eight focused
composite-lifetime/composite-reuse/Canvas2D/vector-page/vector-Forms/resource-
reuse/session-worker/Node-worker suites, the exact 15-page comparison above,
and `git diff --check`. No development server, browser session, HEP regeneration,
or git-history operation was run.

Human checkpoint: serve the rebuilt production demo with `npm run preview`
(user-started). Compare production builds of current/main in the same browser,
reloading between loads; use repeated `[Page grid] ... parsed ... ms` values,
not combined LOD/upload totals. Check brochure pages 1, 7, 8, 10, 11, and 15
for masks, overlaps, and image edges at high zoom, then search/selection and
one HEP v6 export/reload. Also smoke-test Dublin/Level 1 zoom/pan/search. Browser
performance/visual checks, other supported browser/Node versions, and the
long corpus/release gates remain manual; no full HEP regeneration is needed.

## Text-heavy PDF parsing follow-up

WarAndPeace and optimizing_cpp both use the dense production route. The native
cutover added a second content compilation for retained text, with three costs
that accumulate across pages:

- Each compiler eagerly allocated 12 MiB of stroke/duplicate-detection buffers,
  plus fill buffers, even for text-only content. Both passes now allocate these
  buffers only on first use, preserving the original capacity and growth policy
  for dense geometry. This avoids allocation and garbage-collection work; it is
  not a claim that all those temporary buffers were simultaneously retained.
- Simple-font encoding setup repeatedly rebuilt and searched `Object.entries(AGL)`
  for each Unicode character. A single inverse map now preserves the first AGL
  alias with constant-time lookups. Font substitution and glyph selection rules
  are unchanged.
- Forced finalization checkpoints used `setTimeout(0)` in both passes. Their
  host-timer delays accumulated per page, including the new retained-text pass.
  Checkpoints now use message-channel tasks, closing both ports after delivery,
  with the timer fallback retained for hosts without `MessageChannel`. Progress
  events and cancellation checks still run at the same checkpoints.

HEP loading bypasses these compilation stages, explaining why it did not show
the PDF parsing regression. There are no HEP, renderer, or text-quality changes.

In the direct source benchmark, optimizing_cpp went from 7,676 ms to 4,785 ms
(single diagnostic runs; the first was CPU-profiled). Its geometry/text semantic
hash was unchanged. A separate full-field fingerprint comparison against a
source snapshot of the original branch passed on **all 1,259 WarAndPeace pages
and all 179 optimizing_cpp pages**, including every compiled geometry field and
text scene field. Those comparisons generate no HEP archives.

Final production comparison: three fresh-process runs per build/document,
alternating current/main, on the same Intel i5-7600K / Node 24.5.0 environment
recorded above. The reference snapshot's parser sources and configuration
match `main` at `6f32df2`. Input reading, package import, LOD, upload, and
rendering are excluded. All runs used the dense route without fallback.

| PDF | main median parser | Fixed branch median parser | Time change |
| --- | ---: | ---: | ---: |
| WarAndPeace (1,259 pages) | 27,399 ms | 23,682 ms | −13.6% |
| optimizing_cpp (179 pages) | 5,476 ms | 4,812 ms | −12.1% |

Individual parser times (ms): WarAndPeace main 26,055 / 28,319 / 27,399,
current 23,682 / 23,371 / 27,370; optimizing_cpp main 5,476 / 6,301 / 5,179,
current 4,812 / 6,646 / 4,561. Earlier exploratory runs coincided with much
higher host load and are separate from this final series; every sample in the
final series is included. The overlapping ranges do not guarantee that each
individual run beats main. These are Node measurements, not browser timings.
Raw final reports are `/tmp/hepr-text-war-final-{current,main}-{1,2,3}.json`
and `/tmp/hepr-text-optimizing-quiet-{current,main}-{1,2,3}.json`.

Reproduce using separately built packages and the production driver described
at the start of this document:

```sh
npm run benchmark:production-parser -- public/examples/pdfs/WarAndPeace.pdf --runs 3 --fail-on-pdfjs-fallback
npm run benchmark:production-parser -- public/examples/pdfs/optimizing_cpp.pdf --runs 3 --fail-on-pdfjs-fallback
```

Validation passed: `npm run build`, `npm run build:lib`, `git diff --check`, and
these 12 focused suites:

```sh
npm run test:file -- scripts/test-text-parser-work.mjs
npm run test:file -- scripts/test-dense-pdf-content-compiler.mjs
npm run test:file -- scripts/test-native-content-compiler.mjs
npm run test:file -- scripts/test-native-font-text.mjs
npm run test:file -- scripts/test-native-font-cmap-semantics.mjs
npm run test:file -- scripts/test-native-retained-text-compiler.mjs
npm run test:file -- scripts/test-native-text-semantics.mjs
npm run test:file -- scripts/test-dense-pdf-fast-worker.mjs
npm run test:file -- scripts/test-dense-pdf-integration.mjs
npm run test:file -- scripts/test-pdf-fast-progress.mjs
npm run test:file -- scripts/test-native-vector-page.mjs
npm run test:file -- scripts/test-pdf-session-worker.mjs
```

The new test counts backing allocations rather than sampling retained memory;
text-only compilation must allocate less than 64 KiB of geometry arrays. It
also checks first-stroke duplicate detection across separate compilations,
progress, cancellation, message-port cleanup, and the timer fallback.

Changed files: `src/densePdfContentCompiler.ts`,
`src/pdf/nativeContentCompiler.ts`, `src/pdf/nativeFont.ts`,
`scripts/test-text-parser-work.mjs`, `package.json`, and this document.

Manual verification: use the rebuilt demo in the same browser as main, reload
between each original PDF load, and compare the `[Page grid] ... parsed ... ms`
values. Check page appearance at high zoom and search/selection in both books,
then load their existing HEP files. The user starts any server; no browser,
server, HEP regeneration, or git-history operation was run during this fix.
