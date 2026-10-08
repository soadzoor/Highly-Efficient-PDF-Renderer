# Further parser and HEP memory improvements

Measured on 2026-09-29. These changes follow the
[lossless LOD memory work](vector-lod-memory.md). They preserve geometry,
styles, paint order, and the existing LOD levels and tolerances. Stored vector
LODs remain unimplemented.

## Implemented changes

- Bound the idle LOD cache to one hierarchy per scene and reuse completed
  hierarchies during renderer replacement. Previously, every prebuild created a
  new hierarchy and disposal accumulated the previous ones in an unbounded queue.
  Repeated disposal cannot return a runtime that another viewer has acquired.
  Concurrent Three viewers reserve their prepared runtimes until construction,
  so intervening text preparation cannot discard a completed build or cause a
  synchronous rebuild. Cancellation releases unused reservations.
- Assemble Form, Type3, and pattern geometry with one allocation/copy per store,
  preserving resource order and relocating fill-segment offsets in the destination.
  Root-only and single nonempty stores remain zero-copy. A 64-resource fixture
  producing 2 MiB previously copied 64.97 MiB; it now copies 2 MiB (96.9% less).
- Finalize the compiler's five fill stores using its existing ownership-transfer
  operation. A 10,000-rectangle fixture avoids 1,760,000 bytes of finalization
  copies on runtimes with `ArrayBuffer.transferToFixedLength`; older runtimes
  retain the exact-output copy fallback.
- Build retained-page strokes in 64 KiB typed chunks instead of four growing
  JavaScript number arrays. Aggregate unused chunk capacity stays below 256 KiB.
  Copied chunks are released immediately where buffer transfer is supported.
  Coordinate transforms use scalars, preserving double precision until bounds
  and final Float32 values have been calculated. This also removes three
  temporary coordinate-pair arrays per packed stroke. Fill/text opacity buffers
  keep their existing mutable behavior.
- Reuse exactly sized, owned HEP texture decode buffers and reconstruct XOR
  deltas in the already-owned unshuffled buffer. These remove copies without
  mutating archive input or caller-owned scene arrays.
- Add an exact Float32 style palette as optional HEP container-v2 codec 2.
  Compare actual compressed, padded bytes against ordinary stored/DEFLATE
  output; choose the palette only when the whole archive becomes smaller.
  Logical section bytes and scene schema v9 are unchanged. Existing container-v1
  files remain readable; new palette-bearing files require an updated viewer.
  See the [wire format](HEP_CONTAINER.md#exact-palette-chunks-container-v2).

## Palette measurements

These are measurements of the existing HEPs' style sections, using native
DEFLATE and exact 128-bit records. No PDFs were parsed and no example HEPs were
regenerated. The final expanded renderer style arrays are still required; the
smaller palette reduces decompression intermediates and file bytes.

| Drawing | Original style payload | Palette payload | Original compressed section | Palette compressed section |
| --- | ---: | ---: | ---: | ---: |
| Lower Level | 35,998,144 B | 2,250,656 B | 80,754 B | 8,505 B |
| Level 1 | 41,042,736 B | 2,566,407 B | 105,191 B | 16,687 B |

For Level 1, the intermediate style payload falls from 39.14 MiB to 2.45 MiB.
The compressed section saves 88,504 bytes. These are allocation/payload
measurements, not measured browser peak-memory savings or phone load times.
Existing HEPs receive the decoder copy improvements immediately; palette
benefits apply to files exported with the new writer.

## Estimates for storing every LOD

This is an experiment only. It reads existing HEPs, builds the normal nine-level
hierarchies, and measures lossless compression of their derived geometry and
paint origins. Original PDF sizes come from filesystem metadata, without
parsing the PDFs. The exact level is already stored in the HEP.

| Drawing | Current HEP | Original PDF | HEP + full derived arrays | HEP + source references and literals |
| --- | ---: | ---: | ---: | ---: |
| Lower Level | 1.67 MiB | 48.94 MiB | 22.67 MiB | **11.19 MiB** |
| Level 1 | 2.85 MiB | 29.99 MiB | 50.34 MiB | **25.82 MiB** |

The full-array candidate stores every Float32 bit and source paint ID. The
reference candidate checks each derived stroke's 16 words against the source
stroke at its paint origin. Exact matches store only that origin and a reference
flag; changed records store all 16 words. This preserves every derived level,
its order, and its values. Matches: 1,025,290 of 1,522,296 derived records in
Lower Level, and 1,970,096 of 3,099,172 in Level 1.

For each field and level, the probe chooses the smallest DEFLATE level-6 result
among raw words, byte shuffling, and byte shuffling after component-wise XOR
deltas. Paint IDs also try delta/ZigZag varints; that encoding won at every level.
Reference flags use a compressed bitset. The original measurements used raw
DEFLATE streams; zlib wrapping adds six bytes per stream, well below the displayed
precision. Geometry and origin word transforms were checked by decompression
and bitwise comparison.

These totals add measured payload bytes to the current HEP. They exclude future
container/level descriptors, alignment, and any persisted spatial bucket arrays;
the latter would be rebuilt. They do not subtract the new palette savings.
No complete stored-LOD archive or browser loading path was implemented or timed.

To repeat the estimate from existing inputs, without conversion:

```sh
node scripts/estimate-vector-lod-storage.mjs public/examples/heps/Level_1-parsed-data.hep "public/examples/pdfs/Level 1.pdf" --output=/tmp/level1-lod-size.json
```

The tool uses zlib-wrapped DEFLATE, verifies exact field and reference/literal
reconstruction, and has a 90-second child-process deadline. It writes only an
optional JSON report, never an archive.

The reference candidate leaves about 37.74 MiB and 4.17 MiB below the respective
PDF sizes, so it is worth investigating. It still grows today's HEPs by roughly
6.7× and 9.1×. The writer now compares its complete final file against the
original PDF size and omits stored LODs when that strict budget is reached. If
canonical content still cannot fit, export fails before saving. These two
examples do not establish a size guarantee for other documents.

## TIKA-2848-2 text LOD compression and size policy

The 1,576-page TIKA-2848-2 PDF exposed an unenforced size budget. Its HEP had
4,135,835 exact glyph instances and stored text LOD geometry several times:
run transforms, their bounds, and the coarse glyph transforms. Text LOD v3 now
predicts those values from canonical glyph ranges and previously decoded records,
retaining exact IEEE-754 XOR corrections. Canonical scene sections are unchanged,
and the decoded cache retains every value; text is not clustered again.

Measured by repacking the existing HEP, with no PDF parsing:

| File | Bytes | MiB |
| --- | ---: | ---: |
| Original PDF | 10,181,637 | 9.71 |
| Previous HEP with vector/text LOD | 13,824,412 | 13.18 |
| HEP with text LOD v3 and both caches retained | 7,882,296 | 7.52 |

The result is 43.0% smaller than the previous HEP and 22.6% smaller than the PDF.
The repacker verified every canonical section byte and all decoded LOD data
before atomically replacing a temporary copy. The original download was preserved.
Text LOD v1/v2 remains readable; older viewers can ignore v3 and rebuild the cache.

The builder, demo downloads and converter now check the complete file against
the original PDF length. Optional caches are omitted with a diagnostic if they
exceed the strict budget; oversized canonical output fails before saving, without
discarding document content. New files record the original PDF size for re-export.
Custom scenes and older HEPs need the explicit `sourcePdfByteLength` option or
the repacker's `--source-pdf` argument when their original size is unknown.

TypeScript checking and 13 server-free regression files passed. Coverage includes
lossless residual corrections, signed zero, legacy caches, malformed ranges and
budgets, cancellation, cache omission, source-size provenance, canonical byte
preservation and atomic writes. Browser appearance/zoom verification remains
manual; no development server or PDF conversion was run.

Changed files for this size/compression fix:

- Encoding and policy: `src/hepLodEncoding.ts`, `src/hepLod.ts`,
  `src/hepSizePolicy.ts`, `src/hepBuilder.ts`, `src/hepBuilderRuntime.ts`,
  `src/hepWriter.ts`, `src/hepReader.ts`, `src/hepTypes.ts`.
- Source size and downloads: `src/pdfVectorExtractor.ts`,
  `src/pdfObjectGenerator.ts`, `src/main.ts`, `src/three-example.ts`,
  `src/hepLodPrompt.ts`.
- Tools and tests: `PDFtoHEP.js`, `scripts/repack-hep-lods.mjs`,
  `scripts/test-hep-api.mjs`, `scripts/test-hep-lod.mjs`,
  `scripts/test-hep-lod-repack-budget.mjs`, `scripts/test-pdf-to-hep-cli.mjs`,
  `scripts/lib/testSuites.mjs`.
- Documentation: `docs/HEP_CONTAINER.md`, `docs/api.md`, `docs/manual.md`,
  `docs/parser-memory.md`.

## Validation and manual checks

TypeScript checking, whitespace checks, and 24 distinct server-free regression
files passed. The regressions cover exact output, source immutability,
resource ordering, retained clipping/opacity, transfer and copy fallbacks,
cancellation, cache ownership, malformed palette data, compressed-size fallback,
container-v1 compatibility, and HEP round trips. No development server or browser
session was started, and no PDF-to-HEP conversion was performed.

Device verification remains manual: open Lower Level and Level 1 with LOD on,
zoom and pan, switch renderers repeatedly, and reopen each file. Also verify a
newly exported palette-bearing HEP in the updated viewer when convenient. Check
appearance and successful loading; a Safari crash fix is not established until
the phone check passes.

## Files changed in this follow-up

- Cache and preparation: `src/vectorStrokeLodCore.ts`, `src/vectorStrokeLod.ts`,
  `src/index.ts`, `src/threePdfObject.ts`, `src/three-example.ts`.
- PDF geometry: `src/densePdfPageData.ts`, `src/pdf/nativeContentCompiler.ts`,
  `src/retainedVectorPage.ts`.
- HEP: `src/hepContainer.ts`, `src/hep.ts`, `src/parsedDataEncoding.ts`.
- Regressions: `scripts/test-vector-lod-cache.mjs`,
  `scripts/test-vector-overview-lod.mjs`, `scripts/test-dense-resource-assembly.mjs`,
  `scripts/test-parser-geometry-memory.mjs`, `scripts/test-hep-float32-palette.mjs`,
  `scripts/test-hep-container.mjs`, `scripts/test-public-load-cancellation.mjs`,
  `scripts/test-document-loading.mjs`, `scripts/lib/testSuites.mjs`.
- Tooling: `scripts/estimate-vector-lod-storage.mjs`.
- Documentation: this report, `docs/HEP_CONTAINER.md`, `docs/manual.md`.

Suggested commit: `Reduce parser allocations and bound LOD cache memory`.
