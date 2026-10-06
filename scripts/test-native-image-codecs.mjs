import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { imagePdf, tinyJbig2, tinyJbig2Globals } from "./lib/imageCodecFixtures.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const originalFetch = globalThis.fetch;
const originalAssetUrls = new Map();
try {
  const { BUNDLED_JPEG_CODEC_ASSET, createBundledImageCodecResolver, resolveBundledImageCodec: decode } = await import("../src/pdf/nativeJpegCodec.ts");
  const { BUNDLED_JPX_CODEC_ASSET } = await import("../src/pdf/nativeJpxCodec.ts");
  const { BUNDLED_JBIG2_CODEC_ASSET } = await import("../src/pdf/nativeJbig2Codec.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const localAssets = new Map(), fetchedAssets = new Set();
  for (const asset of [BUNDLED_JPEG_CODEC_ASSET, BUNDLED_JPX_CODEC_ASSET, BUNDLED_JBIG2_CODEC_ASSET]) {
    assert.equal(asset.url.protocol, "file:", "source codecs must resolve to local files");
    const wasm = await readFile(asset.url);
    assert.equal(wasm.length, asset.byteLength);
    assert.equal(createHash("sha256").update(wasm).digest("hex"), asset.sha256);
    assert(WebAssembly.validate(wasm), "the vendored codec must be valid WASM");
    if (asset !== BUNDLED_JPEG_CODEC_ASSET) assert.equal(wasmMemoryMaximum(wasm), 8192,
      "PDF.js codec memory must be capped at 512 MiB");
    originalAssetUrls.set(asset.url, asset.url.href);
    // Exercise the browser HTTP loading branch without a browser or server.
    // Only the three files shipped with our application may be requested.
    asset.url.href = `https://offline-app.test/nested/assets/${asset.url.pathname.split("/").at(-1)}`;
    localAssets.set(asset.url.href, wasm);
  }
  globalThis.fetch = async input => {
    const url = input instanceof Request ? input.url : String(input);
    assert(localAssets.has(url), `decoder requested an unbundled asset: ${url}`);
    fetchedAssets.add(url);
    return new Response(localAssets.get(url));
  };
  const jpeg = new Uint8Array(await readFile(new URL("./fixtures/jpeg/rgb-8x8.jpg", import.meta.url)));
  constantPixels(await decode({ ...request(jpeg, 3), codec: "jpeg" }), [16, 85, 204]);
  const fixtures = {};
  for (const [name, expected, parameters] of [
    ["rgb", [16, 85, 204], {}], ["gray", [64], {}],
    ["gray16", [64], {}], ["graya", [64, 128], { SMaskInData: 1 }],
    ["rgba", [16, 85, 204, 128], { SMaskInData: 1 }]
  ]) {
    const encoded = fixtures[name] = new Uint8Array(await readFile(new URL(`./fixtures/codecs/${name}-8x8.jp2`, import.meta.url)));
    const before = encoded.slice();
    const result = await decode(request(encoded, expected.length, parameters));
    constantPixels(result, expected);
    assert.deepEqual(encoded, before, "decoding must preserve encoded bytes");
  }
  const rgb = fixtures.rgb;
  const start = Buffer.from(rgb).indexOf(Buffer.from([255, 79, 255, 81]));
  constantPixels(await decode(request(rgb.subarray(start), 3)), [16, 85, 204]);
  for (const [input, reason] of [
    [rgb.subarray(0, 10), "invalid-jpx-header"],
    [Uint8Array.of(255, 79, 255, 81), "invalid-jpx-header"],
    [rgb.subarray(0, rgb.length - 15), "invalid-jpx-header"]
  ]) await assert.rejects(decode(request(input, 3)), error => error?.code === "unsupported-image" && error.details?.reason === reason);
  await assert.rejects(decode({ ...request(rgb, 3), width: 7 }), error => error.details?.reason === "dimension-mismatch");
  await assert.rejects(decode({ ...request(rgb, 3), bitsPerComponent: 16 }), error => error.details?.reason === "unsupported-jpx-layout");
  await assert.rejects(createBundledImageCodecResolver(1024)(request(rgb, 3)), error => error?.code === "resource-limit");
  const malformed = rgb.slice();
  malformed.fill(0, start + 42 + 9);
  await assert.rejects(decode(request(malformed, 3)), error => error?.code === "unsupported-image");
  // A failed kernel must not poison subsequent calls or retain grow-only memory.
  constantPixels(await decode(request(rgb, 3)), [16, 85, 204]);

  const jbig = tinyJbig2(), globals = tinyJbig2Globals();
  const jbigRequest = { ...request(jbig, 1), codec: "jbig2", bitsPerComponent: 1, height: 2, globals };
  assert.deepEqual([...(await decode(jbigRequest)).samples], [255, 0], "JBIG2 black bits must become PDF zero samples");
  assert.deepEqual([...(await decode({ ...jbigRequest, globals: new Uint8Array() })).samples], [255, 0]);
  await assert.rejects(decode({ ...jbigRequest, width: 9 }), error => error.details?.reason === "dimension-mismatch");
  await assert.rejects(decode({ ...jbigRequest, encoded: jbig.subarray(0, jbig.length - 1) }), error => error?.code === "unsupported-image");
  await assert.rejects(createBundledImageCodecResolver(32)(jbigRequest), error => error?.code === "resource-limit");
  const controller = new AbortController(); controller.abort();
  for (const input of [request(rgb, 3), jbigRequest]) await assert.rejects(decode(input, controller.signal), error => error?.code === "aborted");

  for (const [encoded, options, expected] of [
    [rgb, {}, [16, 85, 204, 255]],
    [fixtures.gray, { colorSpace: "/DeviceGray", bitsPerComponent: 0 }, [64, 64, 64, 255]],
    [fixtures.rgba, { extra: "/SMaskInData 1" }, [16, 85, 204, 128]],
    [fixtures.graya, { colorSpace: "/DeviceGray", extra: "/SMaskInData 1" }, [64, 64, 64, 128]],
    [fixtures.gray, { colorSpace: `[/Indexed /DeviceRGB 64 <${"000000".repeat(64)}404040>]` }, [64, 64, 64, 255]],
    [jbig, { filter: "JBIG2Decode", colorSpace: "/DeviceGray", bitsPerComponent: 1, height: 2, globals }, [255, 255, 255, 255]]
  ]) {
    const session = await openPdf({ kind: "bytes", bytes: imagePdf(encoded, options) });
    try {
      const page = await session.compilePage(0, { optimization: "none" });
      assert.deepEqual([...page.stores.images.data.subarray(0, 4)], expected);
      if (encoded === jbig) assert.deepEqual([...page.stores.images.data.subarray(32, 36)], [0, 0, 0, 255]);
    } finally { await session.close(); }
  }
  for (const [options, reason] of [
    [{ colorSpace: "" }, "jpx-codec-defined-color-space"],
    [{ extra: "/SMaskInData 2" }, "jpx-premultiplied-opacity"]
  ]) {
    const session = await openPdf({ kind: "bytes", bytes: imagePdf(rgb, options) });
    try { await assert.rejects(session.compilePage(0), error => error.details?.reason === reason); }
    finally { await session.close(); }
  }
  assert.equal(fetchedAssets.size, localAssets.size, "all codecs must use their locally deployed WASM assets");
  console.log("Lazy image codecs passed: local-only assets, pinned/capped WASM, raw/boxed data, precision, alpha, globals, PDF samples, malformed data, limits and cancellation.");
} finally {
  globalThis.fetch = originalFetch;
  for (const [url, href] of originalAssetUrls) url.href = href;
  hooks.deregister();
}

function request(encoded, components, decodeParameters = {}) {
  return { codec: "jpeg2000", encoded, width: 8, height: 8, components, bitsPerComponent: 8,
    imageMask: false, globals: new Uint8Array(), decodeParameters };
}
function constantPixels(result, expected) {
  assert.deepEqual([result.width, result.height, result.components, result.bitsPerComponent], [8, 8, expected.length, 8]);
  assert.equal(result.samples.length, 64 * expected.length);
  for (let pixel = 0; pixel < 64; pixel++) assert.deepEqual([...result.samples.subarray(pixel * expected.length, (pixel + 1) * expected.length)], expected);
}

function wasmMemoryMaximum(bytes) {
  let offset = 8;
  function readUint() {
    let value = 0, shift = 0, byte;
    do {
      byte = bytes[offset++];
      assert(byte !== undefined && shift <= 28, "invalid WASM integer");
      value += (byte & 127) * 2 ** shift;
      shift += 7;
    } while (byte & 128);
    return value;
  }
  while (offset < bytes.length) {
    const id = bytes[offset++], length = readUint(), end = offset + length;
    assert(end <= bytes.length, "invalid WASM section");
    if (id === 5) {
      assert.equal(readUint(), 1, "one defined codec memory is expected");
      assert.equal(readUint(), 1, "codec memory must have an explicit maximum");
      readUint();
      const maximum = readUint();
      assert.equal(offset, end);
      return maximum;
    }
    offset = end;
  }
  assert.fail("codec WASM has no memory section");
}
