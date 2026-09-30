# Lossless vector LOD memory changes

Measured on 2026-09-29 using the existing Lower Level and Level 1 HEP examples.
The baseline is the repository implementation before these changes, including
its original nine-level hierarchy. The earlier level-skipping mitigation is
replaced: tolerances, geometry precision, and LOD selection rules are unchanged.

## What changed

- Build geometry and paint IDs in fixed-size typed chunks instead of repeatedly
  doubling large arrays and retaining JavaScript number arrays.
- Store interval-group membership as compact source IDs. Reconstruct one group
  at a time, preserving floating-point accumulation order. Complete and release
  consecutive paint groups while preserving the original density admission cap.
- Share derived geometry with the combined renderer store. Keep caller-owned
  canonical arrays unchanged.
- Allocate selection and instance scratch as needed. Replace native comparison
  sorting with exact stable counting by paint run, source origin, and ID.
- Share exact and ordered LOD GPU textures in native renderers. Upload source
  views of at most 4 MiB without full-size padded staging arrays. Retain exact
  identity buffers where compositing needs canonical fallback draws.
- Let Three data textures share immutable combined arrays. Clone only the style
  texture on the first individual-stroke color edit, and omit unused LOD culling
  arrays.

## Measurements

Separate Node processes load existing HEP files, build all levels, prepare
ordered batches, and select the first overview frame. Peak RSS is recorded before
parity fingerprinting. These figures exclude GPU allocations and browser/driver
overhead; they are comparative process measurements, not iPhone tab estimates.

| Drawing: peak RSS through ordered preparation | Original | Optimized | Reduction |
| --- | ---: | ---: | ---: |
| Lower Level | 1,241.4 MiB | 894.9 MiB | 27.9% |
| Level 1 | 1,884.2 MiB | 1,157.9 MiB | 38.5% |

| Level 1 measurement | Original | Optimized |
| --- | ---: | ---: |
| Peak RSS through LOD construction | 1,398.7 MiB | 852.3 MiB |
| Reachable typed-array backing storage after overview selection | 1,137.0 MiB | 754.6 MiB |
| LOD construction time | 11.02 s | 9.18 s |
| Ordered-batch construction time | 2.41 s | 1.15 s |

Reachable storage counts unique buffers reachable through the scene, runtime,
and batch planner; it excludes hidden WeakMap metadata and ordinary JS objects.
Timing and RSS vary with garbage collection and machine load.

For Level 1, native allocation accounting additionally removes 156.64 MiB of
duplicate GPU textures plus 9.79 MiB of WebGL identity-buffer storage
(19.57 MiB for WebGPU). The previous four-array WebGL upload also allocated
345.73 MiB of simultaneous CPU staging. These are distinct allocation savings,
not figures to add mechanically to the process peaks. Three's shared textures
alone eliminate another 345.73 MiB of retained CPU texture copies.

## Verification

- Both example files preserve all nine original levels. Comparisons cover every
  Float32 geometry/style bit, source paint origin, duplicate multiplicity,
  runtime bound, spatial bucket, and eight successive zoom/pan selections.
- Exact final ordered draw geometry, clip codes, and batch order match.
- TypeScript checking and 27 distinct server-free regression files passed,
  including clipping, density, perspective, ordering, color restoration,
  compositing, buffer growth, cancellation, and shared-resource disposal.
- A separate synthetic comparison checked compact interval accumulation against
  the original implementation across 30,003 varied strokes, multiple tolerances,
  fine/overview modes, and page reuse.
- Browser/device verification remains manual. The older Three instance-buffer
  test was stopped after detecting its Vite dependency and is unverified.

To profile an existing HEP without conversion or a server:

```sh
node scripts/benchmark-vector-lod-memory.mjs public/examples/heps/Level_1-parsed-data.hep --ordered --output=/tmp/lod-memory.json
```

Use `--compare=previous-snapshot.json` to compare output. The tool's default
deadline is 90 seconds. `--source=original-core.ts` and
`--ordered-source=original-batches.ts` allow an original implementation to be
loaded without modifying git state.

On the iPhone, load Lower Level and Level 1 with Vector LOD enabled, check
overview and close zoom, pan across dense regions, switch LOD off/on, recolor
and restore a stroke if supported, and reopen the documents several times.
Confirm that loading finishes and the page remains stable. No Safari crash fix
is claimed until this device check passes.

## Changed files

- Core: `src/vectorStrokeLodCore.ts`, `src/vectorStrokeIntervalGroups.ts`,
  `src/vectorStrokePaintOrder.ts`.
- Storage and ordering: `src/vectorStrokeLodStorage.ts`,
  `src/vectorOrderedBatches.ts`.
- Renderers: `src/vectorStrokeLod.ts`, `src/threeMaterialStrokeLayer.ts`,
  `src/webGlFloorplanRenderer.ts`, `src/webGpuFloorplanRenderer.ts`.
- Tests and tooling: `scripts/test-vector-lod-memory.mjs`,
  `scripts/test-vector-lod-storage.mjs`,
  `scripts/test-native-stroke-upload-memory.mjs`,
  `scripts/test-vector-ordered-batches.mjs`, `scripts/lib/testSuites.mjs`,
  `scripts/benchmark-vector-lod-memory.mjs`.
- Documentation: `docs/manual.md`, `docs/vector-lod-memory.md`.

Suggested commit: `Reduce vector LOD memory without changing rendered output`.

## Follow-up: shared stroke store (2026-09-30)

The changes above still stored every derived record in full, and ordered
renderers copied all levels, including the canonical strokes, into one more
combined store. Most derived records are unchanged source strokes: on Level 1,
1,970,096 of 3,099,172 (64%), and 1,874,246 of the fine level's 2,344,881
(80%). On devices the peak came after Vector LOD, during the synchronous scene
upload, while the standalone viewer still showed "65.72% Building Vector LOD".

### What changed

- One record store per hierarchy. Storage IDs below the canonical stroke count
  address the canonical scene; larger IDs address LOD-only records. A derived
  record whose 16 Float32 words and paint origin equal its source stroke refers
  to that stroke; any other record is stored once. Each level keeps its record
  order and lists the storage ID of each record.
- Culling bounds are computed once per stored stroke and shared by all levels
  through their records. Selection stamps use one byte per record, resetting
  every 255 selections.
- Ordered batches and their culling, scheduling and redundancy helpers address
  storage IDs. Native WebGL/WebGPU upload the canonical strokes and LOD-only
  records into the shared textures directly from their arrays; only a texture
  row spanning both is staged. Levels that select the same stored stroke submit
  it once.
- Three data textures upload one array each, so Three stroke materials read
  two texture sets, chosen by stroke ID. The canonical strokes' complete
  texture rows are views of the scene's own arrays. The second set holds their
  partial last row (fewer strokes than one row; 369 strokes, about 6 KB per
  field, on Level 1) and the LOD-only records, which it now stores. This also applies with Vector LOD off,
  where Three previously copied the canonical strokes into padded texture
  arrays. The WebGL material opts in with the `HEPR_SPLIT_STROKE_STORE` define,
  so the native renderer and the exported core stroke shader are unchanged.
  Recoloring a stroke copies both style textures on first use.
- Merge and density groups use exact numeric tuple keys instead of a template
  string per primitive, with the same equality (NaN equals NaN, -0 equals 0).
  The paint-group table is released after simplification, and canonical scenes
  use their own IDs as paint origins instead of an identity table.
- One generator implements both the synchronous and cooperative builds.
- The standalone viewer paints its Uploading stage before the synchronous
  scene upload, so progress no longer appears stuck at the end of Vector LOD.

### Measurements

`node scripts/benchmark-vector-lod-memory.mjs <file.hep> --ordered`, run for
the previous and the new implementation in separate processes on the same
machine. The same limitations as above apply: no GPU allocations, and Node
process memory rather than an iOS tab estimate.

| Measurement | Previous | New | Reduction |
| --- | ---: | ---: | ---: |
| Level 1: peak RSS through LOD construction | 888.1 MiB | 632.3 MiB | 28.8% |
| Level 1: peak RSS through ordered preparation | 1,197.4 MiB | 708.3 MiB | 40.8% |
| Level 1: reachable typed arrays after overview selection | 754.6 MiB | 403.5 MiB | 46.5% |
| Level 1: LOD construction time | 7.16 s | 5.87 s | 18.0% |
| Lower Level: peak RSS through LOD construction | 667.9 MiB | 501.9 MiB | 24.9% |
| Lower Level: peak RSS through ordered preparation | 918.3 MiB | 561.0 MiB | 38.9% |
| Lower Level: reachable typed arrays after overview selection | 536.5 MiB | 295.1 MiB | 45.0% |
| Lower Level: LOD construction time | 5.17 s | 4.07 s | 21.3% |

The GPU stroke store shrinks with the stored records: Level 1 from 5,664,343
to 3,694,247 records (345.73 to 225.48 MiB of RGBA32F textures), Lower Level
from 3,772,180 to 2,746,890 (230.24 to 167.66 MiB).

For the Three path, the Three stroke layer itself was constructed in Node for
both implementations, measuring typed arrays after garbage collection. The
figures are what the layer adds to the loaded scene; with LOD on, they include
the prepared hierarchy.

| Three stroke layer | Previous | New | Reduction |
| --- | ---: | ---: | ---: |
| Level 1, Vector LOD on | 646.7 MiB | 261.6 MiB | 59.5% |
| Level 1, Vector LOD off | 528.0 MiB | 371.4 MiB | 29.7% |
| Lower Level, Vector LOD on | 433.6 MiB | 167.7 MiB | 61.3% |
| Lower Level, Vector LOD off | 294.5 MiB | 157.3 MiB | 46.6% |

With LOD off, the Level 1 difference is 156.6 MiB, the size of the canonical
strokes' four fields. GPU texture memory is unchanged by the split: the same
texels are divided between two texture sets.

### Rendering difference

Every level is bit-identical, and per-level selections match in all sampled
views. When neighbouring tiles select different levels, a stroke present in
both was previously submitted twice, once per level. It is now submitted once.
Across 11 sampled views of each drawing, the previous draw lists contained
3,926 such repeats on Level 1 and 4,627 on Lower Level, all opaque round-cap
lines. A second identical opaque draw changes only its antialiased edge (50%
coverage becomes 75%), so these strokes now render as they do away from level
seams. All other draw geometry, clip codes and paint order match. Records with
the same paint origin share one color and alpha, and may now be submitted in a
different order; apart from framebuffer rounding, that does not change blending.

### Verification

- `benchmark-vector-lod-memory.mjs --compare` against a snapshot of the previous
  implementation passed on Level 1: byte-exact geometry, paint origins, bounds,
  multiplicity, all nine levels, tile membership, sampled views and storage order.
- A parity comparison of both drawings across 11 zoom/pan views, using a copy of
  the previous sources, found identical levels and selections. Four views have
  byte-identical ordered draw lists; the others differ only as described above.
- `npm test` (typecheck and 143 files), `test:unit` (170 files) and
  `test:integration` (45 files) passed. New coverage exercises split texture
  uploads (segment boundaries, empty and short sources, batching limits),
  references to unchanged strokes, Three texture sharing, recoloring across
  both texture sets, and the WGSL that Three generates for the split fetch.
- Browser/device verification remains manual. Nothing here compiled the GLSL
  or WGSL on a GPU: check `three-example.html` with both the WebGL and WebGPU
  backends, LOD on and off, including recoloring a stroke. Then run the device
  checks described above.

### Changed files

- Core: `src/vectorStrokeLodCore.ts`, `src/vectorStrokeIntervalGroups.ts`,
  `src/vectorStrokePaintOrder.ts`.
- Storage, ordering and uploads: `src/vectorStrokeLodStorage.ts`,
  `src/strokeRecords.ts` (new), `src/vectorOrderedBatches.ts`,
  `src/vectorDrawRunCulling.ts`, `src/vectorPageDrawScheduler.ts`,
  `src/vectorRunClipElision.ts`, `src/vectorStrokeRedundancy.ts`.
- Renderers and viewer: `src/webGlFloorplanRenderer.ts`,
  `src/webGpuFloorplanRenderer.ts`, `src/vectorStrokeLod.ts`,
  `src/threeVectorDrawPlan.ts`, `src/threeMaterialStrokeLayer.ts`,
  `src/threeWebGpuStrokeMaterial.ts`, `src/threePrimitiveColors.ts`,
  `src/main.ts`.
- Tests and tooling: `scripts/test-vector-lod-storage.mjs`,
  `scripts/test-native-stroke-upload-memory.mjs`,
  `scripts/test-vector-ordered-batches.mjs`,
  `scripts/test-vector-perspective-lod.mjs`, `scripts/test-document-loading.mjs`,
  `scripts/test-three-webgpu-varying-interpolation.mjs`,
  `scripts/test-three-ordered-text-lod.mjs`,
  `scripts/benchmark-vector-lod-memory.mjs`.
- Documentation: `docs/manual.md`, `docs/vector-lod-memory.md`.
