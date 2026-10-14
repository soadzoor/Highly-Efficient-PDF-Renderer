import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { imagePdf } from "./lib/imageCodecFixtures.mjs";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+(?:[?#]|$)/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const { hashSourceJpxRgba, hashSourceJpxGray, hashSourceJpxEncoded, isSourceJpxRaster, registerBundledJpxResolver, isBundledJpxResolver } =
    await import("../src/sourceJpxRaster.ts");
  const { createBundledImageCodecResolver } = await import("../src/pdf/nativeJpegCodec.ts");
  const { openNativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfImageRegistry } = await import("../src/pdf/nativeImage.ts");
  const { compileDensePdfContent } = await import("../src/pdf/nativeContentCompiler.ts");
  const { buildNativeVectorPage } = await import("../src/pdf/nativeVectorPage.ts");
  const { HEPR_IMAGE_FORMAT } = await import("../src/heprDocumentData.ts");
  const aligned = Uint8Array.from({ length: 64 }, (_, index) => index * 17 & 255), backing = new Uint8Array(67);
  backing.set(aligned, 1);
  assert.deepEqual(hashSourceJpxRgba(aligned, 8, 2), [1329483439, 2213673321], "the HJP1 pixel fingerprint stays wire-compatible");
  assert.deepEqual(hashSourceJpxEncoded(aligned), [2358012127, 3663790931], "the provenance byte fingerprint stays stable");
  assert.deepEqual(hashSourceJpxRgba(backing.subarray(1, 65), 8, 2), hashSourceJpxRgba(aligned, 8, 2),
    "unaligned views fingerprint the same little-endian RGBA words without staging a copy");
  assert.notDeepEqual(hashSourceJpxRgba(aligned, 8, 2), hashSourceJpxRgba(aligned, 4, 4), "dimensions bind the fingerprint");
  const changed = aligned.slice(); changed[63] ^= 1;
  assert.notDeepEqual(hashSourceJpxRgba(aligned, 8, 2), hashSourceJpxRgba(changed, 8, 2), "last-pixel alpha mutations are detected");
  assert.notDeepEqual(hashSourceJpxEncoded(aligned), hashSourceJpxEncoded(changed), "encoded body edits are detected");
  assert.throws(() => hashSourceJpxRgba(aligned, 17, 1), /dimensions/);
  const aborted = new AbortController(); aborted.abort();
  assert.throws(() => hashSourceJpxRgba(aligned, 8, 2, aborted.signal), { name: "AbortError" });
  assert.throws(() => hashSourceJpxEncoded(aligned, aborted.signal), { name: "AbortError" });
  let checks = 0;
  assert.throws(() => hashSourceJpxRgba(new Uint8Array(65537 * 4), 65537, 1,
    { throwIfAborted() { if (++checks === 3) throw new DOMException("cancelled", "AbortError"); } }), { name: "AbortError" });
  assert.equal(checks, 3, "long fingerprints check cancellation during the pixel loop");
  const grayPixels = Uint8Array.of(0, 1, 64, 128, 254, 255), grayRgba = new Uint8Array(grayPixels.length * 4);
  grayPixels.forEach((value, index) => grayRgba.set([value, value, value, 255], index * 4));
  assert.deepEqual(hashSourceJpxGray(grayPixels, 3, 2), hashSourceJpxRgba(grayRgba, 3, 2),
    "a compact gray plane binds the exact opaque RGBA fingerprint without expanding it");
  const grayBacking = new Uint8Array(grayPixels.length + 1); grayBacking.set(grayPixels, 1);
  assert.deepEqual(hashSourceJpxGray(grayBacking.subarray(1), 3, 2), hashSourceJpxRgba(grayRgba, 3, 2));
  assert.throws(() => hashSourceJpxGray(grayPixels, 7, 1), /dimensions/);
  assert.throws(() => hashSourceJpxGray(grayPixels, 3, 2, aborted.signal), { name: "AbortError" });
  checks = 0;
  assert.throws(() => hashSourceJpxGray(new Uint8Array(65537), 65537, 1,
    { throwIfAborted() { if (++checks === 3) throw new DOMException("cancelled", "AbortError"); } }), { name: "AbortError" });
  assert.equal(checks, 3, "compact gray fingerprints check cancellation during the pixel loop");
  assert(isBundledJpxResolver(createBundledImageCodecResolver()));
  assert(!isBundledJpxResolver(async () => {}), "a caller resolver is not automatically trusted");

  // SIZ-only oversized metadata plus a bounded synthetic package resolver
  // isolates provenance eligibility; real bundled JPX decoding has its own suite.
  const fixture = async (name, precision) => {
    const bytes = new Uint8Array(await readFile(new URL(`./fixtures/codecs/${name}-8x8.jp2`, import.meta.url)));
    const start = Buffer.from(bytes).indexOf(Buffer.from([255, 79, 255, 81])), view = new DataView(bytes.buffer);
    view.setUint32(start + 8, 16384); view.setUint32(start + 12, 1);
    if (precision !== undefined) for (let i = 0; i < view.getUint16(start + 40); i++) bytes[start + 42 + i * 3] = precision;
    return bytes;
  };
  const rgb = await fixture("rgb"), gray = await fixture("gray");
  const samples = request => Uint8Array.from({ length: request.width * request.height * request.components }, (_, index) => index % 251);
  const resolver = request => ({ samples: samples(request), width: request.width, height: request.height,
    components: request.components, bitsPerComponent: 8 });
  const bundled = registerBundledJpxResolver(request => resolver(request));
  const parse = async ({ encoded = rgb, extra = "", width = 16384, height = 1, colorSpace = "/DeviceRGB",
    codec = bundled, trusted = true, colorResources } = {}) => {
    const document = await openNativePdfDocument({ kind: "bytes", bytes: imagePdf(encoded, { width, height, colorSpace, extra }) });
    try {
      const registry = new NativePdfImageRegistry(document, undefined, { codecResolver: codec, trustedCodecResolver: trusted });
      await registry.add({ kind: "ref", objectNumber: 5, generation: 0 }, colorResources);
      return registry;
    } finally { await document.close(); }
  };
  const registry = await parse(), image = registry.describe(0);
  assert(image.originalJpx, "eligible oversized RGB keeps original encoded samples");
  assert.deepEqual(image.originalJpx.encoded, rgb);
  assert.equal(image.originalJpx.components, 3);
  const grayRegistry = await parse({ encoded: gray, colorSpace: "/DeviceGray" });
  assert.equal(grayRegistry.describe(0).originalJpx.components, 1);
  for (const options of [
    { codec: resolver }, { trusted: false }, { width: 8, height: 8 },
    { extra: "/Decode [1 0 0 1 0 1]" }, { extra: "/Decode /IgnoredMalformedJpxValue" },
    { extra: "/Mask [0 0 0 0 0 0]" },
    { encoded: await fixture("rgb", 15) }, { encoded: await fixture("rgb", 135) },
    { colorResources: new Map([["DefaultRGB", [{ kind: "name", value: "CalRGB" },
      new Map([["WhitePoint", [.9505, 1, 1.089]]])]]]) }
  ]) assert.equal((await parse(options)).describe(0).originalJpx, undefined,
    "custom, small, mapped, masked, calibrated, signed and high-precision images retain ordinary encoding");
  assert((await parse({ extra: "/Decode [0 1 0 1 0 1]" })).describe(0).originalJpx,
    "an explicit identity Decode remains eligible");

  const build = async (imageRegistry, content = "q 4 0 0 2 0 0 cm /Im Do /Im Do Q") => {
    const pageBounds = { minX: 0, minY: 0, maxX: 4, maxY: 2 };
    const compiled = await compileDensePdfContent(new TextEncoder().encode(content), { output: "vector-scene",
      pageBounds, pageMatrix: [1, 0, 0, 1, 0, 0], imageXObjects: new Map([["Im", 0]]) });
    return buildNativeVectorPage({ pageInfo: { sourcePageIndex: 0, width: 4, height: 2 }, pageBounds, compiled,
      textCompilation: emptyText(), fontResources: [], imageRegistry, maxPaths: 16 });
  };
  const scene = await build(registry), source = scene.rasterLayers[0].sourceJpx;
  assert(isSourceJpxRaster(source));
  assert(!isSourceJpxRaster({ ...source, rgbaHash: new Array(2) }), "sparse fingerprint arrays are not valid metadata");
  assert.equal(scene.rasterLayers[1].sourceJpx, source, "placements share one page-owned provenance object");
  assert.notEqual(source.encoded.buffer, image.originalJpx.encoded.buffer, "public bytes cannot detach the registry's reusable source");
  assert.deepEqual(source.rgbaHash, hashSourceJpxRgba(scene.rasterLayers[0].data, source.width, source.height));
  assert.deepEqual(source.encodedHash, hashSourceJpxEncoded(source.encoded));
  const cloned = structuredClone(scene, { transfer: [source.encoded.buffer] });
  assert(isSourceJpxRaster(cloned.rasterLayers[0].sourceJpx), "structured worker cloning retains valid metadata/fingerprints");
  assert.equal(cloned.rasterLayers[0].sourceJpx, cloned.rasterLayers[1].sourceJpx);
  assert.equal(image.originalJpx.encoded.length, rgb.length, "worker transfer leaves cached original bytes alive");
  const replay = await build(registry), replaySource = replay.rasterLayers[0].sourceJpx;
  assert.deepEqual(replaySource.encoded, rgb, "a second page/replay gets another complete encoded copy");
  const originalHash = replaySource.rgbaHash;
  replay.rasterLayers[0].data[0] ^= 1;
  assert.notDeepEqual(hashSourceJpxRgba(replay.rasterLayers[0].data, replaySource.width, replaySource.height), originalHash);
  const later = await build(registry);
  assert.deepEqual(later.rasterLayers[0].sourceJpx.rgbaHash, originalHash,
    "public mutation cannot be rebound as original samples during a later page build");
  assert.notDeepEqual(hashSourceJpxRgba(later.rasterLayers[0].data, replaySource.width, replaySource.height), originalHash);
  replaySource.encoded[replaySource.encoded.length - 1] ^= 1;
  assert.notDeepEqual(hashSourceJpxEncoded(replaySource.encoded), replaySource.encodedHash);
  const grayScene = await build(grayRegistry), graySource = grayScene.rasterLayers[0].sourceJpx;
  assert.equal(graySource.components, 1);
  assert.equal(grayScene.rasterLayers[0].data.length, graySource.width * 4, "Gray8 widens once before its canonical fingerprint");
  assert.deepEqual(graySource.rgbaHash, hashSourceJpxRgba(grayScene.rasterLayers[0].data, graySource.width, graySource.height));
  const authoritativeGrayHash = [...graySource.rgbaHash], authoritativeEncodedHash = [...graySource.encodedHash];
  for (const hash of [graySource.rgbaHash, graySource.encodedHash]) {
    try { hash[0] ^= 1; } catch (error) { assert(error instanceof TypeError); }
  }
  const grayReplay = (await build(grayRegistry)).rasterLayers[0].sourceJpx;
  assert.deepEqual(grayReplay.rgbaHash, authoritativeGrayHash, "public fingerprint edits cannot change a later replay's pixel authority");
  assert.deepEqual(grayReplay.encodedHash, authoritativeEncodedHash, "public fingerprint edits cannot change a later replay's encoded authority");
  const cropped = await build(grayRegistry, "q 0 0 1 2 re W n 4 0 0 2 0 0 cm /Im Do Q");
  assert(cropped.rasterLayers[0].width < 16384, "fixture exercises a real texel crop");
  assert.equal(cropped.rasterLayers[0].sourceJpx, undefined, "cropped pixels cannot reuse the full original source");
  const uniform = Object.freeze({ ...grayRegistry.describe(0), data: new Uint8Array(16384).fill(255), format: HEPR_IMAGE_FORMAT.Gray8 });
  const collapsed = await build({ size: 1, describe: () => uniform }, "q 0 0 1 2 re W n 4 0 0 2 0 0 cm /Im Do Q");
  assert.equal(collapsed.rasterLayers[0].width, 1);
  assert.equal(collapsed.rasterLayers[0].sourceJpx, undefined, "uniform collapsed planes keep their smaller canonical representation");
  console.log("Source JPX provenance: portable/cancellable fingerprints, eligibility, canonical Gray/RGB binding, mutation, cropped pixels, worker ownership and replay passed.");
} finally { hooks.deregister(); }

function emptyText() {
  return { transforms: { values: Float32Array.of(1, 0, 0, 1, 0, 0) },
    glyphs: { fontIndices: new Uint32Array(), characterCodes: new Uint32Array(), glyphIds: new Uint32Array(),
      transformIndices: new Uint32Array(), advances: new Float32Array(), flags: new Uint8Array() },
    textIndex: { version: 1, text: "", charGlyphIndices: new Int32Array(), fallbackQuads: new Float32Array() },
    glyphAdvanceEms: new Float32Array(), runs: [], diagnostics: [] };
}
