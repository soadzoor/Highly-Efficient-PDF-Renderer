# Documentation

[Project home](../README.md) · [Examples](examples.md) · [Manual](manual.md) · [API](api.md)

Start with the [quick start](../README.md#quick-start) to render a document, then
choose a guide for the task at hand.

| Guide | Use it to |
| --- | --- |
| [Examples](examples.md) | Try the demos and add rendering, search, selection, or export to an app. |
| [Manual](manual.md) | Choose inputs, pages, rendering options, and a PDF-to-HEP workflow. |
| [API reference](api.md) | Find public functions, types, and methods. |
| [Development](development.md) | Set up the repository, build it, and run checks. |

## How rendering works

HEPR parses PDF content in a worker and compiles it into a `VectorScene` containing
strokes, fills, glyphs, raster layers, and page bounds. Selected pages are composed
into one scene. Loading a HEP file restores this representation from stored data.

```text
PDF → parser and scene compiler ─┐
                               ├→ VectorScene → LOD preparation → GPU rendering
HEP → scene loader ─────────────┘
```

The native PDF engine handles document structure, fonts, graphics state, and
content streams. A specialized streaming compiler handles compatible dense vector
pages; other pages use the full native session compiler. Both produce the same
scene representation. PDF parsing has no PDF.js or pdf-lib runtime dependency.

Analytic shaders render vector strokes, fills, and glyph outlines. Embedded images
and PDF operations that need compositing use raster layers. Vector LOD selects
stroke detail by projected size and density; text LOD simplifies text when its
detail becomes too small to resolve. The manual describes the available controls.

The standalone viewer uses HEPR's WebGL2 or WebGPU canvas renderer. The three.js
integration creates material layers inside a `THREE.Group`, synchronizing them
with the application's camera during rendering. Both consume the same scene data.

HEP stores the composed scene and text index to avoid repeated PDF parsing. Its
binary container uses compressed geometry and optional encoded images; runtime
LOD is prepared during loading. See the [HEP manual](manual.md#hep-files) for
usage and the [container specification](HEP_CONTAINER.md) for the wire format.

## Source map

| Area | Entry points |
| --- | --- |
| Public package | [`src/index.ts`](../src/index.ts) |
| Source loading and page composition | [`pdfObjectGenerator.ts`](../src/pdfObjectGenerator.ts), [`pdfVectorExtractor.ts`](../src/pdfVectorExtractor.ts) |
| Native PDF engine | [`src/pdf/`](../src/pdf/), [`pdfSession.ts`](../src/pdfSession.ts) |
| HEP export and import | [`hepBuilder.ts`](../src/hepBuilder.ts), [`hep.ts`](../src/hep.ts), [`hepContainer.ts`](../src/hepContainer.ts) |
| Standalone rendering | [`webGlFloorplanRenderer.ts`](../src/webGlFloorplanRenderer.ts), [`webGpuFloorplanRenderer.ts`](../src/webGpuFloorplanRenderer.ts) |
| Three.js object | [`threePdfObject.ts`](../src/threePdfObject.ts) |
| Level of detail | [`vectorStrokeLodCore.ts`](../src/vectorStrokeLodCore.ts), [`textLodCore.ts`](../src/textLodCore.ts) |
| Search and selection | [`textSearch.ts`](../src/textSearch.ts), [`textSelection.ts`](../src/textSelection.ts) |

## Technical references

- [HEP container specification](HEP_CONTAINER.md): layout, compression, checksums, and resource limits.
- [Development validation](development-validation.md): test suites, CI scope, and manual checks.
- [Parser benchmarks](parser-benchmark.md): measurement commands, recorded results, and remaining validation gates.
- [Visual regression checks](visual-regressions.md): appearance checkpoints and renderer statistics.
- [Room detector quality](room-detector-quality.md): evaluation results and known limits.
- [Room gold-set review](room-gold-set.md): annotation and adjudication protocol.

These pages live alongside the code so documentation changes can be reviewed with
the implementation they describe.
