# Development validation

`package.json` exposes suite commands. Individual tests remain in `scripts/`
and are selected by `scripts/run-tests.mjs`, using Node's built-in test runner.
No additional test framework is required.

| Command | Scope |
| --- | --- |
| `npm test` | Typecheck plus the bounded fast regression suite. |
| `npm run test:fast` | Explicit CI selection covering loading, cancellation, parsing, workers, compositing, text/search, LOD, and the runner itself. |
| `npm run test:unit` | Discovered algorithm and source-contract tests. |
| `npm run test:integration` | Discovered Node session, worker, codec, and component-interaction tests. |
| `npm run test:package` | Built worker resolution and browser bundling; requires library artifacts. |
| `npm run test:browser` | Opt-in Vite middleware and browser-facing checks; may start Vite. |
| `npm run test:conversion` | Opt-in HEP serialization/conversion tests; some require Vite, corpus files, and built artifacts. |
| `npm run test:corpus` | Opt-in tests using the PDFs in `public/examples/pdfs`. |
| `npm run test:oracle` | The separately installed oracle harness. |
| `npm run test:file -- <path>` | Run one file, forwarding any following arguments to it. |

The shared runner executes each file in a fresh Node process, sequentially,
with TypeScript stripping enabled. It enforces a 60-second per-file timeout
and a ten-minute suite budget, reports failures, and exits nonzero. The total
budget cancels running and queued tests. These defaults also apply to individual
files; increase them explicitly for a longer manual check.

Preview a selection without importing or executing any test:

```bash
npm run test:fast -- --list
npm run test:conversion -- --list
```

Run an individual test or pass arguments to it:

```bash
npm run test:file -- scripts/test-optional-node-canvas.mjs
npm run test:file -- --timeout=300000 scripts/test-native-composite-reuse.mjs "path/to/brochure.pdf"
npm run test:corpus -- --timeout=300000 --budget=1200000
```

Runner options go before the file path; everything after it is passed to the
test (an optional `--` separator is removed). Test paths are resolved from the
repository root. The former per-file npm aliases have been removed; use the
corresponding `scripts/test-*.mjs` path instead. `scripts/test-fast.mjs` remains
as a compatibility entry point for direct callers.

Suite selection is defined in `scripts/lib/testSuites.mjs`. Ordinary files are
discovered by the `scripts/test-*.mjs` naming convention. Integration prefixes
are matched there; remaining ordinary files join `unit`. Register tests needing
servers, corpus data, or conversions in the explicit opt-in suites before adding
them. Add fast regressions explicitly to `fastTests`; discovery never expands
the CI gate. Tiny synthetic in-memory scene/HEP roundtrips already in the fast
selection remain there. Corpus PDF-to-HEP conversion stays opt-in.

`build:lib` builds the artifacts and then runs `test:package`. The HEP package
conversion test is deliberately separate to preserve the existing build gate:

```bash
npm run build:lib
npm run test:file -- scripts/test-hep-package.mjs
```

The `Validate` GitHub workflow uses Node 24 and runs `npm test` plus
`npm run build:all` for pull requests, main-branch pushes, and manual dispatch.
The npm `prepublishOnly` hook runs the same checks. No server is started by
these commands. Dependencies currently use `npm install` because the repository
does not track a lockfile.

## Manual checks

Build with `npm run build:all`, then start `npm run preview` yourself.

1. Load a valid PDF A, then an invalid PDF B. A should remain visible, retain
   its metrics, and still export/download A. Repeat with an invalid HEP file.
2. Start loading a large document and drop a different file before it finishes.
   The newest load should win, with no stale progress or downloads. Repeat in
   the Three.js demo and close the viewer during loading.
3. Verify WebGL/WebGPU switching, search, selection, zoom/pan, and a manual
   HEP export/reload. Inspect the brochure's masks, clipped text, and overlaps
   using the checkpoints in [visual regressions](visual-regressions.md).
4. Follow [parser benchmark](parser-benchmark.md) for production timing/memory
   comparisons. The long corpus and browser gates are separate from `npm test`.

The oracle baseline directory is not populated in this checkout. Generating
and reviewing corpus baselines remains a manual operation; CI does not create
or silently accept new visual goldens. No corpus HEP regeneration is needed
for the loading and cancellation regressions.

## Deferred work

Progressive page loading is deferred. The current APIs still prepare all
selected pages before returning the PDF object. Encrypted PDFs and JPEG 2000 /
JBIG2 support are also outside these changes.
