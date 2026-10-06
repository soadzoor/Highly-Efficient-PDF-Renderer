# Bundled PDFium JBIG2 decoder

The upstream files come from [PDF.js v6.4.299](https://github.com/mozilla/pdf.js/tree/v6.4.299/external/jbig2),
using PDFium revision `bb1f9f71e7b15afdd5937adf8cfe5807522b882f`.
`manifest.json` records the original and modified lengths and SHA-256 hashes.
`LICENSE_JBIG2` contains the upstream PDFium BSD notice and Apache license.

`upstream-jbig2.wasm` and `upstream-jbig2.js` are source-checkout references for
reproduction and ABI verification. Only `jbig2-6.4.299.wasm` is shipped as a
runtime asset; HEPR supplies its local imports directly, without the upstream
loader or a remote decoder fallback.

Reproduce the runtime binary from the pinned upstream binary:

```sh
node scripts/lib/instrumentJbig2Wasm.mjs src/assets/codecs/jbig2/upstream-jbig2.wasm src/assets/codecs/jbig2/jbig2-6.4.299.wasm
```

The script verifies the upstream hash, adds a balanced work/cancellation check
at every defined function entry and loop header, and caps defined memory at
8192 WASM pages (512 MiB). A private counter batches callbacks every 1024
entries, leaving at most 1023 uncharged entries when decoding completes. The
adapter further caps each fresh instance using the operation's byte budget;
the upstream 16 MiB initial heap still applies. Work units differ from the
former JavaScript decoder's algorithm-specific steps. Metadata preflight keeps
page, segment, reference, symbol, region and grid checks before decoding.
