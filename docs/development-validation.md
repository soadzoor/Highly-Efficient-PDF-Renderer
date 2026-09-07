# Development validation

`npm test` runs the TypeScript check and `npm run test:fast`. The fast runner has
an explicit list of 25 suites covering document replacement/export ownership,
public load cancellation, native parser/session/worker boundaries, compositing,
text/search, LOD, and scene statistics. It includes the room-overlay page-matrix
and stroke-clip LOD tests, which also have individual package scripts.

Each suite runs in a fresh Node process with a 60-second timeout. The runner
stops launching tests after ten minutes, reports failures, and exits nonzero.
It does not discover every `test-*.mjs` automatically: several other repository
tests require production artifacts, large corpus inputs, or Vite middleware.
Add new fast regressions explicitly to `scripts/test-fast.mjs`.

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
