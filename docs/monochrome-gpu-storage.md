# Monochrome GPU storage

Native WebGL/WebGPU and both Three material backends automatically select the
smallest supported representation for each prepared monochrome tile. No runtime
dependency, user configuration, PDF re-encoding or OCR inference is added.

The fallback remains an exact one-bit base plus four-bit coverage mips, or an
averaged R8 base plus four-bit mips at reduced display resolution. Compact
storage must save at least 5%, including index and physical atlas padding. It
preserves every visible base sample and every existing mip sample. Filtering
uses the same bilinear/trilinear rules; mip quantization remains sixteen shades.

## Compact blocks and decoded symbols

Every logical level is divided into 32x32 blocks. Uniform blocks need only a
marker. Other blocks share payloads when their bytes match exactly. Hash matches
are verified, and collision chains are bounded. Incompressible tiles keep the
ordinary packed representation.

The bundled symbol-preserving decoder retains actual JBIG2 symbol bitmaps and
positions from supported text regions, including arithmetic refinements. It
composes directly into a packed page without allocating a full-size eight-bit
text-region bitmap. These are scanned shapes, independent of the PDF's OCR text
and fonts. Dictionaries, globals and clipped placements are supported. Large
arithmetic generic regions, transposed text, halftones and unsupported
composition fall back to the existing metered PDFium decoder.

At the original binary level, symbol bins reference each used bitmap once and
combine it with a residual block. The remaining image content is preserved.
Traces are checked against the canonical pixels before use. Bins with more than
eight placements keep ordinary blocks, and symbol preprocessing has a work
ceiling. Higher levels retain the ordinary averaged coverage, avoiding errors
from overlapping filtered symbols. The block-only and symbol candidates are
compared; the smaller atlas wins. Sharing currently occurs within each tile,
including its mip levels. GPU dictionaries are not shared between pages.

The canonical packed CPU image remains available for compatibility and exports.
Symbol metadata is retained in native vector scenes and copied safely through
workers. The existing HEP container stores canonical pixels; symbol metadata is
not serialized, so a reopened HEP uses the block path.

## Texture layout and accounting

One RGBA8 atlas texel stores a little-endian 32-bit **data word**, rather than
one RGBA source pixel. There are no hardware mips. Header words hold logical
width, height, level count, block side and base bit depth, followed by a map
offset for each level. Maps contain one word per block:

| Entry | Meaning |
| --- | --- |
| `0x80000000 + value` | Uniform sample, in the level's bit depth |
| `0x40000000 + pointer` | Symbol bin: residual entry, count, then bitmap pointer/x/y triples |
| Other values | Pointer to a shared packed block payload |

Block samples are packed consecutively from the low bits of each word, with
1, 4 or 8 bits per sample. Symbol payloads have width/height words followed by
MSB-first packed rows. GLSL and WGSL use exact texture loads before filtering.
The base and coverage bindings alias the same compact texture, which is
uploaded and destroyed once. Native WebGPU marks this mode with a half-integer
logical width in the existing 96-byte uniform buffer.

Resident caches charge the complete physical atlas, plus existing uniform
allocations where applicable. Budget planning learns measured tile-plan costs
by canonical source identity, retaining at most eight plans per source. New
contents and unprepared resolutions use the conservative packed estimate.
The device target still comes from `navigator.deviceMemory`, not measured VRAM.

Savings depend on page content. The earlier 5.9-gigapixel TIKA estimate cannot
give an exact compact size: blank blocks, repeated samples and actual JBIG2
segment types must be measured. No full TIKA conversion or GPU/browser run was
performed for this change.

## Verification

The native and Three examples expose **GPU compress scans (experimental)**.
Enable it with **Use OCR text instead of scans** off, then open the PDF. It
overrides streaming and decodes all selected pages before display. Packed scans
prepare their compact atlas candidates during parsing, with a per-page share of
the automatic raster target. The display tier can be smaller than the original;
zoom detail and exports retain the canonical packed pixels. Color/grayscale
scans can instead use optional lossy BC7/ASTC blocks, with a fidelity diagnostic.

Zoom refinement extracts complete compact blocks directly from packed bytes,
uses exact 2×2 averaging for even mip reductions, and reuses horizontal coverage
endpoints across rows. The resulting texture bytes and raster target are
unchanged. Reduced-tier worker inputs omit unused JBIG2 dictionaries; full-tier
outputs release those dictionaries after compact encoding.

HEP downloads retain the canonical packed pixels and two-color RGBA palette in
scene v10 monochrome sections, compressed by the container. Export skips RGBA
expansion and PNG/WebP encoding for these layers. Reloading keeps packed storage
and generates GPU derivatives as needed; palettes, alpha, row padding, and zoom
detail remain exact. See [HEP container format](HEP_CONTAINER.md).

The all-pages trial targets `C:\Users\soadz\Desktop\TIKA\TIKA-2848-1.pdf`.
Lightweight inspection of direct PDF dictionaries found 614 pages and 614
1-bit DeviceGray/JBIG2 scans, approximately 641 MiB of packed base pixels.
No pages were decoded for that inspection. Original CPU pixels remain resident
in this experimental mode, in addition to bounded display preparation data.
Actual browser/GPU stability and VRAM use require a manual run.

Synthetic checks cover all base/mip texels, exact atlas byte snapshots,
fractional coverage endpoints, odd dimensions, repeated blocks,
clipped symbols, mismatched traces, fallback selection, cooperative preparation,
native uploads, Three WGSL bindings, memory accounting and resource cleanup.
JBIG2 fixtures compare symbol reconstruction with the existing WASM decoder,
including globals and placements outside the page. Decoder loops and typed
allocations are checked for work/heap accounting. The packaged preparation
worker is exercised using Node worker threads, without a browser or server.

Manual verification: start the viewer as usual, open TIKA-2848-1.pdf, and zoom
between overview and full scan detail in native WebGL/WebGPU and the Three
viewers. Check scan appearance, cropped image edges, minification, demotion,
the delay until scans become sharp, and resident raster bytes. Compare recorded
GPU/upload timings against the previous branch; shader execution time needs a
real GPU.

## Files

| Area | Modified files |
| --- | --- |
| Storage and shaders | `src/compactMonochromeRaster.ts`, `src/compactMonochromeShaders.ts`, `src/monochromeRaster.ts`, `src/monochromeRasterWebGlShader.ts`, `src/monochromeRasterWebGpuShaders.ts` |
| Preparation and budgets | `src/rasterPreparationCore.ts`, `src/rasterPreparationWorker.ts`, `src/rasterMemoryBudget.ts` |
| Native and Three GPU integration | `src/webGlFloorplanRenderer.ts`, `src/webGpuFloorplanRenderer.ts`, `src/threeRasterTextures.ts`, `src/threeWebGpuRasterMaterial.ts` |
| PDF decoding and metadata | `src/pdf/codecs/jbig2SymbolKernel.ts`, `src/pdf/codecs/jbig2ArithmeticDecoder.ts`, `src/pdf/nativeJbig2Codec.ts`, `src/pdf/nativeCcitt.ts`, `src/pdf/nativeImage.ts`, `src/pdf/nativeVectorPage.ts` |
| Tests | `scripts/test-compact-monochrome-raster.mjs`, `scripts/test-jbig2-symbol-storage.mjs`, `scripts/test-webgl-monochrome-raster.mjs`, `scripts/test-webgpu-monochrome-raster.mjs`, `scripts/test-three-raster-storage.mjs`, `scripts/test-webgpu-raster-memory-budget.mjs`, `scripts/test-webgl-raster-memory-budget.mjs`, `scripts/test-webgl-raster-atlas-batches.mjs`, `scripts/test-raster-worker-package.mjs`, `scripts/lib/imageCodecFixtures.mjs`, `scripts/lib/testSuites.mjs` |
| Documentation and attribution | `docs/api.md`, `docs/monochrome-gpu-storage.md`, `THIRD_PARTY_NOTICES` |
