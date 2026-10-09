# Bundled ICC engines

The preferred engine (qcms by default) is imported and fetched when an ICC color
space is needed for PDF page compilation. If it cannot load or convert a profile,
HEPR tries the other engine, then alternate colors, and warns about the fallback.
Explicit `alternate` and `none` modes load neither engine. No npm runtime dependency
or external service is used. The adapters are `src/pdf/nativeIccLcms.ts` and `nativeIccQcms.ts`.
All source revisions, upstream binary hashes and shipped binary hashes are in
`manifest.json`. Licenses are reproduced in the package's `THIRD_PARTY_NOTICES`.

## Provenance and reproduction

* **Little CMS 2.16:** `dist/lcms.wasm` from the npm archive
  `https://registry.npmjs.org/lcms-wasm/-/lcms-wasm-1.0.4.tgz`.
  The wrapper revision is `4edc5cdbfa5d883a8e4c844168ec2aa9bafb6c1f`, with
  Little CMS source `c2a54017d73080f97c5cd34a78ff2fb51564aade`.
  Source builds use that wrapper's `build.sh` with Emscripten; its npm dependencies
  are not needed to use the binary. HEPR supplies its own small TypeScript host
  adapter instead of the generated JavaScript runtime.
* **Mozilla qcms:** `external/qcms/qcms_bg.wasm` from PDF.js revision
  `1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56` (release 6.3.289), available at
  `https://raw.githubusercontent.com/mozilla/pdf.js/1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56/external/qcms/qcms_bg.wasm`.
  Its binding source is pdf.js.qcms revision
  `2ae4ee72334782928210ba4050e3e77d9b2d35be`; the upstream build command is
  `node build.js -Cco OUTPUT_DIRECTORY` (Docker and Rust/wasm-bindgen).
  HEPR's adapter implements this pinned binary's three host imports without
  the upstream JavaScript module's shared mutable output state.

For byte-for-byte reproduction, download the pinned upstream binaries, check
their `upstreamSha256`, and apply `limitWasmMemory` from
`scripts/lib/limitWasmMemory.mjs`. Write the result as `lcms.wasm` or `qcms.wasm`
and check the shipped `sha256`. The only binary modification sets the memory
section's maximum to 4096 pages (256 MiB); executable code is unchanged.
At runtime the loader rewrites this stored maximum to the WASM32 address
capacity. Memory grows on demand; the stored value is no longer a conversion
admission limit. The shipped binaries and their hashes remain unchanged.
Upstream build scripts do not pin every compiler dependency, so rebuilding from
C/Rust source is not claimed to reproduce the upstream binaries byte-for-byte.

Compiled modules are cached; each profile transform receives a fresh instance.
Little CMS handles Gray/RGB/CMYK/Lab byte inputs; qcms handles Gray/RGB/CMYK.
Both produce relative-colorimetric sRGB with no black-point compensation.
Lab input uses ICC Lab8 encoding (L*: 0–100, a*/b*: −128–127), independently of
the PDF's clipping `/Range`. Transforms are retained as bounded RGB8 lattices;
they are approximations and not intended as a print-proofing pipeline.
