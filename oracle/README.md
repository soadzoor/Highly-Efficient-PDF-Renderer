# Differential oracle

This standalone private package pins `pdfjs-dist` 6.1.200 for the HEPR v1
migration. Binary microfixtures use the repository's deliberately small test
writer, so `pdf-lib` is not present. Nothing under `oracle/` is included by the
root package's published `files` allowlist.

It is intentionally not a root npm workspace: a normal HEPR install does not
install either PDF library. Install the temporary oracle separately only when
running differential comparisons:

```bash
npm --prefix oracle install
```

Keep it until the remaining fidelity and performance gates are reviewed, then
remove the oracle before release.

The harness covers the 14 PDFs pinned by `corpus.json` and cross-checks that
list against `public/examples/manifest.json`. Each PDF is collected in a fresh
Node process. A report freezes:

- document and zero-based page metadata;
- normalized Unicode text per page, as checked-in `.txt` artifacts and hashes;
- PDF.js display-operator counts, histograms, ordered semantic hashes, and
  256-operation chunk hashes;
- representative or all-page PNG screenshots at both 1x and 2x;
- source checksums, phase/page timings, cold-process timings, and peak memory.

No corpus command runs during install, build, test, or publish. These are
manual release-gate operations because the complete corpus and all-page image
set can be expensive.

## Safe default and baseline updates

Validate only the manifest, filenames, and pinned byte lengths:

```bash
npm run oracle:validate
```

Compare the current pinned PDF.js result with the checked-in baseline:

```bash
npm run oracle:compare
```

Comparison writes current artifacts under the operating system's temporary
directory and removes them afterward. It never changes the baseline. Use a new
explicit output directory to keep current artifacts for inspection:

```bash
npm run oracle:compare -- --output /tmp/hepr-oracle-current
```

Only `--write` can replace the baseline, and it refuses a partial corpus or a
non-PDF.js adapter. Collection happens in a staging directory and is published
only after every document succeeds:

```bash
npm run oracle:write -- --samples 3 --screenshots representative
```

To freeze every page at 1x and 2x, use the intentionally long form manually:

```bash
npm run oracle:write -- --samples 3 --screenshots all
```

Review `oracle/baselines/pdfjs-6.1.200/report.json`, its text artifacts, and its
PNGs before committing them. A compare run automatically adopts the baseline's
screenshot policy unless `--screenshots` is supplied explicitly.

Useful focused comparisons include:

```bash
npm run oracle:compare -- --document lk_office_level_1
npm run oracle:compare -- --document livermore_l1,lower_level --samples 3
```

Visual differences first use exact SHA-256 comparison. Non-identical PNGs are
decoded and accepted only when dimensions match, SSIM is at least 0.995, and at
least 99.5% of baseline non-edge pixels are within 8/255 in every channel.
These thresholds can be tightened from the command line.

Timing is reported by default but is noisy and does not fail an ordinary
correctness comparison. `--enforce-performance` applies the v1 cutover gates:
25% better corpus-median parse/compile time and peak parser RSS, no individual
document over 10% slower, and no more than a 10% cold-start regression on the
smallest tracked PDF.

## Candidate adapter

The harness's adapter switch is internal tooling, not a public parser option.
Pass a file URL or module path that exports `createEngine()`:

```js
export async function createEngine({ repositoryRoot }) {
  return {
    identity: { id: "hepr", version: "1.0.0", build: "optional revision" },
    async openDocument({ bytes, label, sourcePath }) {
      return {
        pageCount,
        async getDocumentMetadata() {},
        async getPage(sourcePageIndex) {
          return {
            async getMetadata() {},
            async getNormalizedText() {},
            async getSemanticSummary() {},
            async renderPng(scale, { maxRenderPixels }) {},
            async close() {}
          };
        },
        async close() {}
      };
    }
  };
}
```

`renderPng()` returns `{ width, height, bytes: Uint8Array }`. Metadata and the
semantic summary must use the frozen report schema; the candidate adapter is
where HEPR commands are normalized into the oracle vocabulary. It must render
the static default view without fetching external resources.

Run a candidate comparison and the release performance gates with:

```bash
npm run oracle:compare:hepr -- \
  --samples 5 \
  --enforce-performance
```

`scripts/adapters/hepr.mjs` imports the current TypeScript source engine, not a
previous build. It opens the dependency-free native session, compiles each page
once, and renders the ordered HEP v7 program through the page-native Canvas2D
reference backend on `@napi-rs/canvas`. The adapter does not import PDF.js.
PDF.js remains confined to `scripts/adapters/pdfjs.mjs` as the baseline oracle.

PDF.js operator-list hashes and HEPR display-program hashes describe different
ABIs and are not equated. During a cross-engine comparison the harness validates
the complete, deterministic `hepr-display-program-v7` summary and reports one
scope warning per document. Exact document/page metadata and normalized-text
comparisons are unchanged, as are the 1x/2x screenshot thresholds. A comparison
therefore cannot pass by selecting a different semantic schema.

The private candidate uses HEPR's lazy, pinned Standard-14 substitute resolver
(Liberation Mono/Sans/Serif plus Noto Sans Symbols 2) and a conservative 8-bit
one/three-component JPEG bridge. JPEG 2000, JBIG2, CMYK JPEG, XMP metadata, and
annotation dictionary metadata remain explicit candidate failures or exact-gate
differences until their native public boundaries and pinned kernels land; they
are not silently omitted.

Run the fixture-only adapter check (it does not read or write corpus baselines):

```bash
npm --prefix oracle run test:hepr
```

Run `npm run oracle:compare -- --help` for all limits, visual thresholds,
selection, output, and JSON-reporting flags.
