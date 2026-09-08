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

The [parser benchmark guide](parser-benchmark.md) describes production parser
measurements and their scope. The optional [oracle harness](../oracle/README.md)
has a separate dependency installation for rendering comparisons. Run corpus
benchmarks and baseline generation manually; the default tests do not establish
full-corpus visual fidelity or browser performance.
