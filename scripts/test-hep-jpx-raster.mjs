// Small existing JP2 fixtures only: no production image decode, browser or server.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { HEP_JPX_RASTER_HEADER_BYTES, encodeHepJpxRaster, inspectHepJpxRaster, decodeHepJpxRaster } =
    await import("../src/hepJpxRaster.ts");
  const { hashSourceJpxRgba, hashSourceJpxEncoded } = await import("../src/sourceJpxRaster.ts");
  const fixture = async name => new Uint8Array(await readFile(new URL(`./fixtures/codecs/${name}-8x8.jp2`, import.meta.url)));
  const rgba = color => Uint8Array.from({ length: 8 * 8 * 4 }, (_, index) => color[index % 4]);
  const source = (encoded, components, pixels) => ({ width: 8, height: 8, components, encoded,
    rgbaHash: hashSourceJpxRgba(pixels, 8, 8), encodedHash: hashSourceJpxEncoded(encoded) });
  const rgbPixels = rgba([16, 85, 204, 255]), grayPixels = rgba([64, 64, 64, 255]);
  const rgb = source(await fixture("rgb"), 3, rgbPixels), gray = source(await fixture("gray"), 1, grayPixels);
  const valid = encodeHepJpxRaster(rgb);
  assert.equal(HEP_JPX_RASTER_HEADER_BYTES, 32);
  assert.equal(valid.length, 32 + rgb.encoded.length, "storage keeps the original codestream without another image encoding");
  const reference = new Uint8Array(valid.length), header = new DataView(reference.buffer);
  reference.set([0x48, 0x4a, 0x50, 0x31, 0, 3, 0, 0]);
  header.setUint32(8, 8, true); header.setUint32(12, 8, true);
  header.setUint32(16, rgb.encoded.length, true);
  header.setUint32(20, rgb.rgbaHash[0], true); header.setUint32(24, rgb.rgbaHash[1], true);
  reference.set(rgb.encoded, 32);
  assert.deepEqual(valid, reference, "independent HJP1 envelope reference matches every header and source byte");
  const encodedBefore = rgb.encoded.slice(), pixelsBefore = rgbPixels.slice();
  const padded = new Uint8Array(valid.length + 13); padded.set(valid, 7);
  const inspected = await inspectHepJpxRaster(padded.subarray(7, 7 + valid.length), 8, 8);
  assert.deepEqual(inspected, rgb);
  assert.equal(inspected.encoded.buffer, padded.buffer, "inspection retains a view instead of copying an encoded image");
  assert.equal(inspected.encoded.byteOffset, padded.byteOffset + 7 + 32);
  assert.deepEqual(encodeHepJpxRaster(inspected), valid, "verified provenance can be re-exported without quantization");

  const corrupt = edit => { const bytes = valid.slice(); edit(bytes, new DataView(bytes.buffer)); return bytes; };
  const malformed = [
    [new Uint8Array(), 8, 8, /header/],
    [valid.subarray(0, 31), 8, 8, /header/],
    [corrupt(bytes => { bytes[0] ^= 1; }), 8, 8, /header/],
    ...[4, 6, 7, 28, 31].map(offset => [corrupt(bytes => { bytes[offset] = 1; }), 8, 8, /reserved/]),
    [corrupt(bytes => { bytes[5] = 2; }), 8, 8, /component/],
    [corrupt(bytes => { bytes[5] = 4; }), 8, 8, /component/],
    [valid, 7, 8, /dimensions/],
    [valid, 8, 7, /dimensions/],
    [corrupt((_, view) => view.setUint32(8, 7, true)), 7, 8, /codestream dimensions/],
    [corrupt((_, view) => view.setUint32(16, 0, true)), 8, 8, /encoded length/],
    [corrupt((_, view) => view.setUint32(16, rgb.encoded.length + 1, true)), 8, 8, /encoded length/],
    [valid.subarray(0, valid.length - 1), 8, 8, /encoded length/],
    [Uint8Array.from([...valid, 0]), 8, 8, /encoded length/],
    [encodeHepJpxRaster(source(rgb.encoded.subarray(0, 10), 3, rgbPixels)), 8, 8, /codestream|JPEG 2000/],
    [encodeHepJpxRaster(source(rgb.encoded.subarray(0, rgb.encoded.length - 15), 3, rgbPixels)), 8, 8, /codestream|JPEG 2000/],
    [encodeHepJpxRaster(source(await fixture("graya"), 1, grayPixels)), 8, 8, /components/],
    [encodeHepJpxRaster(source(await fixture("rgba"), 3, rgbPixels)), 8, 8, /components/],
    [encodeHepJpxRaster(source(await fixture("gray16"), 1, grayPixels)), 8, 8, /unsigned eight-bit/]
  ];
  const signed = new Uint8Array(await readFile(new URL("./fixtures/codecs/gray8s-3x2.jp2", import.meta.url)));
  malformed.push([encodeHepJpxRaster({ ...source(signed, 1, grayPixels), width: 3, height: 2 }), 3, 2, /unsigned eight-bit/]);

  // Invalid headers and SIZ layouts must fail before any native decoding heap.
  const OriginalInstance = WebAssembly.Instance;
  let instances = 0;
  WebAssembly.Instance = new Proxy(OriginalInstance, { construct(target, args, newTarget) {
    instances++; return Reflect.construct(target, args, newTarget);
  } });
  try {
    for (const [bytes, width, height, pattern] of malformed) {
      await assert.rejects(inspectHepJpxRaster(bytes, width, height), pattern);
      await assert.rejects(decodeHepJpxRaster(bytes, width, height), pattern);
    }
    assert.equal(instances, 0, "preflight rejects invalid envelopes and codestream layouts before kernel allocation");
  } finally { WebAssembly.Instance = OriginalInstance; }
  for (const invalid of [
    { ...rgb, width: 0 }, { ...rgb, height: -1 }, { ...rgb, width: 1.5 },
    { ...rgb, width: Number.MAX_SAFE_INTEGER }, { ...rgb, width: 0xffffffff, height: 0xffffffff },
    { ...rgb, components: 2 }, { ...rgb, encoded: new Uint8Array() },
    { ...rgb, rgbaHash: [0] }, { ...rgb, rgbaHash: [0, -1] },
    { ...rgb, encodedHash: [0] }, { ...rgb, encodedHash: [0, 0x100000000] }
  ]) assert.throws(() => encodeHepJpxRaster(invalid), /out of range|component|fingerprint/);

  for (const [input, expected] of [[rgb, rgbPixels], [gray, grayPixels]]) {
    const section = encodeHepJpxRaster(input), decoded = await decodeHepJpxRaster(section, 8, 8);
    assert.deepEqual(decoded.data, expected, "the bundled decoder reconstructs exact opaque canonical RGB/Gray pixels");
    assert.deepEqual(decoded.sourceJpx, input);
    assert.deepEqual(encodeHepJpxRaster(decoded.sourceJpx), section);
    assert.notEqual(decoded.data.buffer, section.buffer, "RGBA owns storage independent of the encoded envelope");
  }
  const rawStart = Buffer.from(rgb.encoded).indexOf(Buffer.from([0xff, 0x4f, 0xff, 0x51]));
  assert(rawStart >= 0);
  const raw = source(rgb.encoded.subarray(rawStart), 3, rgbPixels);
  assert.deepEqual((await decodeHepJpxRaster(encodeHepJpxRaster(raw), 8, 8)).data, rgbPixels,
    "raw codestreams use the same decode path as boxed JP2");
  const wrongHash = corrupt((_, view) => view.setUint32(20, view.getUint32(20, true) ^ 1, true));
  await inspectHepJpxRaster(wrongHash, 8, 8);
  await assert.rejects(decodeHepJpxRaster(wrongHash, 8, 8), /stored RGBA fingerprint/,
    "a valid envelope cannot silently return pixels different from the saved canonical image");
  const wrongPixels = rgbPixels.slice(); wrongPixels[3] = 254;
  await assert.rejects(decodeHepJpxRaster(encodeHepJpxRaster(source(rgb.encoded, 3, wrongPixels)), 8, 8), /stored RGBA fingerprint/,
    "the fingerprint includes canonical alpha, even though accepted source streams reconstruct opaque pixels");
  const broken = rgb.encoded.slice(); broken.fill(0, rawStart + 42 + 9);
  await assert.rejects(decodeHepJpxRaster(encodeHepJpxRaster(source(broken, 3, rgbPixels)), 8, 8),
    error => error.details?.codec === "jpeg2000" && error.details?.reason === "invalid-jpx-data");
  assert.deepEqual((await decodeHepJpxRaster(valid, 8, 8)).data, rgbPixels, "a failed decoder does not poison the next image");
  assert.deepEqual(rgb.encoded, encodedBefore); assert.deepEqual(rgbPixels, pixelsBefore);

  const controller = new AbortController(); controller.abort(new Error("cancelled JPX section"));
  await assert.rejects(inspectHepJpxRaster(valid, 8, 8, controller.signal), /cancelled JPX section/);
  await assert.rejects(decodeHepJpxRaster(valid, 8, 8, controller.signal), /cancelled JPX section/);
  let checks = 0;
  await assert.rejects(decodeHepJpxRaster(valid, 8, 8, {
    get aborted() { return false; },
    throwIfAborted() { if (++checks === 7) throw new Error("cancelled JPX decode transition"); }
  }), /cancelled JPX decode transition/);
  console.log("HEP JPX raster passed: exact original streams/RGBA, Gray/RGB/raw JP2, preflight/layout corruption, fingerprints, decoder recovery and cancellation.");
} finally { hooks.deregister(); }
