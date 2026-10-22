# Development validation

`package.json` exposes suite commands. Individual tests remain in `scripts/`
and are selected by `scripts/run-tests.mjs`, using Node's built-in test runner.
No additional test framework is required.

| Command | Scope |
| --- | --- |
| `npm test` | Typecheck plus the fast regression suite. |
| `npm run test:fast` | Explicit CI selection covering loading, cancellation, parsing, workers, compositing, text/search, LOD, and the runner itself. |
| `npm run test:unit` | Discovered algorithm and source-contract tests. |
| `npm run test:integration` | Discovered Node session, worker, codec, and component-interaction tests. |
| `npm run test:package` | Built worker resolution and browser bundling; requires library artifacts. |
| `npm run test:browser` | Opt-in Vite middleware and browser-facing checks; may start Vite. |
| `npm run test:conversion` | Opt-in HEP serialization/conversion tests; some require Vite, corpus files, and built artifacts. |
| `npm run test:corpus` | Opt-in tests using the PDFs in `public/examples/pdfs`. |
| `npm run test:file -- <path>` | Run one file, forwarding any following arguments to it. |

The shared runner executes each file in a fresh Node process, sequentially,
with TypeScript stripping enabled. It has no per-file timeout or total suite
budget by default, reports failures, and exits nonzero. Set `--timeout=ms` or
`--budget=ms` explicitly to enforce a deadline. An explicit total budget cancels
running and queued tests. Ctrl+C also cancels the run.

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
The npm `prepublishOnly` hook also validates the released changelog entry before
running the same checks. No server is started by these commands. Dependencies
currently use `npm install` because the repository does not track a lockfile.

The fast suite includes real Node worker startup with process-wide flags from
CI, covering the native PDF worker.

## Releases and changelog

Maintain [CHANGELOG.md](../CHANGELOG.md) alongside user-facing changes. Add
concise notes under `Unreleased`, grouped into `Added`, `Changed` or `Fixed` as
appropriate. Include upgrade guidance and known limitations when they affect
users. Describe the resulting behavior rather than copying commit subjects.
Older releases without curated notes remain available through Git tags.

Review the pending notes without changing files:

```bash
npm run changelog:check
npm run changelog:preview
```

`changelog:check` validates the changelog structure and links, allowing an empty
`Unreleased` section after a release. The release preflight additionally requires
pending notes. `changelog:preview` prints those notes for review.

Commit the implementation and reviewed `Unreleased` notes first. npm requires a
clean working tree before creating its version commit. Then run:

```bash
npm run release-new-version
```

This command uses `npm version patch` and pushes the resulting commit and tag
with `git push --follow-tags`. The npm lifecycle performs these steps:

1. `preversion` validates nonempty `Unreleased` notes and runs `npm test`.
2. npm bumps the package version.
3. `version` runs `npm run build:all` with the new version, moves the pending
   notes into a dated version section using the current UTC date, updates the
   comparison links, and stages the changelog for npm's version commit.
4. npm commits the package version and changelog together, creates its tag, and
   the release command pushes them.

The next patch after `0.1.56` is `0.1.57`; the release command determines and
writes the version, so leave pending notes under `Unreleased` until then. The
finalizer leaves an empty `Unreleased` section ready for subsequent changes.

`npm run release-and-deploy` runs the same release command and then builds and
pushes the demo artifacts. npm publication runs separately in GitHub Actions;
successful local completion or demo deployment does not confirm publication.

If a build or version hook fails after the version bump, stop and inspect the
working tree: the package version may already be modified. Resolve the failure
and review that state before retrying; rerunning blindly can bump it again.
A push failure can likewise leave a completed local release commit and tag.

On a release tag, CI checks that the tag, package version and latest dated
changelog version agree. The **Publish to npm** workflow publishes the package,
then creates or updates the GitHub Release with that version's curated notes.
The npm package includes `CHANGELOG.md`. Publishing failures do not create a
GitHub Release; check the workflow result even after the local command succeeds.

The publish step retries npm's duplicate Sigstore transparency-log error up to
three attempts, waiting 10 and then 20 seconds, while keeping provenance enabled.
Other publication errors fail immediately. If a version is missing from npm,
open the failed **Publish to npm** run in GitHub Actions and choose **Re-run failed
jobs**. This retries the existing tag without changing its version or Git history.
Do not rerun `release-new-version` or `release-and-deploy` to repair publication:
they create another patch version.

If npm publication succeeded but the GitHub Release step failed, rerun that
workflow job. It skips npm publication only when the registry identifies the
same version and source commit, then retries the release notes. Other registry
errors or mismatched commits stop the job. Stable versions use npm's `latest`
tag; prerelease versions use `next` and create GitHub prereleases.

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

CI does not create or silently accept new visual goldens. No corpus HEP
regeneration is needed for the loading and cancellation regressions.

## Deferred work

Progressive page loading is deferred. The current APIs still prepare all
selected pages before returning the PDF object. Encrypted PDFs and JPEG 2000 /
JBIG2 support are also outside these changes.
