# Thumbnail lossless WebP encoder

`libwebp-3757b8a-simd.wasm` is derived from Playwright revision
`f3114b3e9f1aea9f0c123551ebf67ded08dddca2`, file
`packages/utils/webp/webp_codec.wasm`. It contains libwebp revision
`3757b8afeb54e305eaef18502812a9a88b7ed662`, a post-1.6.0 revision with
upstream Emscripten SIMD fixes. Playwright built it with Emscripten 6.0.2.
The codec is local, loaded on demand; it makes no runtime network request
outside the package's own WASM asset.

HEPR's hash-checked patch changes the wrapper configuration to `method=0`,
`near_lossless=100`, `exact=1`. The adapter passes `lossless=1`, `quality=0`.
These settings prioritize speed while preserving every RGBA byte, including
hidden RGB values in transparent pixels. The equivalent modified C wrapper is
included as `webp_wasm.c`. The upstream decoder export is retained for exact
offline round-trip verification; thumbnail generation only uses the encoder.

Reproduce the shipped binary without a compiler:

```sh
curl -fL https://raw.githubusercontent.com/microsoft/playwright/f3114b3e9f1aea9f0c123551ebf67ded08dddca2/packages/utils/webp/webp_codec.wasm -o /tmp/hepr-webp-upstream.wasm
node src/assets/codecs/webp/prepare-runtime.mjs /tmp/hepr-webp-upstream.wasm src/assets/codecs/webp/libwebp-3757b8a-simd.wasm
```

`manifest.json` records source revisions and upstream/runtime SHA-256 hashes.
The patch rejects any different upstream binary and validates the output.
The upstream source build recipe is at
`https://github.com/microsoft/playwright/blob/f3114b3e9f1aea9f0c123551ebf67ded08dddca2/utils/libwebp-wasm/build.sh`.
For a fresh source build, use the pinned toolchain and libwebp revision and
substitute this directory's modified `webp_wasm.c` for the upstream wrapper.
Source builds can differ bytewise; use the patch recipe for identical bytes.

`webp_codec.LICENSE` reproduces libwebp's BSD notice, patent grant, and the
Emscripten MIT/University of Illinois notices. The wrapper is Apache-2.0;
its notice is retained and HEPR's `THIRD_PARTY_NOTICES` includes Apache-2.0.
Only the runtime WASM is emitted as a codec asset.
