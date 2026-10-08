import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });

try {
  const { HEP_BINARY_RASTER_HEADER_BYTES, hepBinaryRasterByteLengthLimit,
    encodeHepBinaryRaster, decodeHepBinaryRaster } = await import("../src/hepBinaryRaster.ts");
  const colors = Uint8Array.of(13, 23, 31, 0, 97, 131, 173, 128);
  assert.equal(HEP_BINARY_RASTER_HEADER_BYTES, 16);

  // Independent bit-by-bit transposition covers every byte value and bit position.
  for (let value = 0; value < 256; value++) {
    const width = 128, height = 128, rowBytes = width / 8;
    const data = new Uint8Array(rowBytes * height);
    for (let y = 0; y < height; y++) data[y * rowBytes + 3] = value;
    const encoded = encodeHepBinaryRaster({ data, colors }, width, height);
    assert(encoded, `sparse byte pattern ${value} selects binary runs`);
    assert.deepEqual(encoded, referenceSection(data, colors, width, height), `independent encoding parity for byte ${value}`);
    const restored = decodeHepBinaryRaster(encoded, width, height);
    assert.deepEqual(restored.data, data, `independent byte ${value} pixel parity`);
    assert.deepEqual(restored.colors, colors);
    assert.equal(restored.colors.buffer, encoded.buffer, "palette remains a view of the decoded section");
    assert.notEqual(restored.data.buffer, encoded.buffer, "canonical packed pixels own their buffer");
    assert(encoded.length <= hepBinaryRasterByteLengthLimit(width, height));
  }

  // Row padding is stored exactly, while rows outside the final 8-row block are zero.
  for (const [width, height] of [[13, 257], [17, 257], [1025, 17], [257, 1025]]) {
    const rowBytes = Math.ceil(width / 8), data = new Uint8Array(rowBytes * height);
    for (let y = 0; y < height; y++) {
      if (y % 8 === 0) data[y * rowBytes] = 0x80;
      data[(y + 1) * rowBytes - 1] |= (1 << (8 - (width & 7))) - 1;
    }
    const source = { data, colors, symbols: { symbols: [], placements: new Int32Array() } };
    const before = data.slice(), encoded = encodeHepBinaryRaster(source, width, height);
    assert(encoded, `odd ${width}x${height} fixture selects binary`);
    assert.deepEqual(encoded, referenceSection(data, colors, width, height));
    assert.deepEqual(decodeHepBinaryRaster(encoded, width, height), { data, colors });
    assert.deepEqual(data, before, "encoding does not mutate canonical pixels or padding");
    assert.deepEqual(colors, Uint8Array.of(13, 23, 31, 0, 97, 131, 173, 128), "straight alpha and hidden RGB survive");
  }

  // Incompressible data never allocates or returns an expanded binary candidate.
  const noise = new Uint8Array(1024 * 1024 / 8);
  let seed = 0x9e3779b9;
  for (let i = 0; i < noise.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; noise[i] = seed >>> 24;
  }
  const beforeNoise = noise.slice();
  assert.equal(encodeHepBinaryRaster({ data: noise, colors }, 1024, 1024), undefined);
  assert.deepEqual(noise, beforeNoise);
  assert.equal(encodeHepBinaryRaster({ data: Uint8Array.of(255), colors }, 1, 1), undefined,
    "small images use their smaller ordinary packed section");

  const width = 128, height = 128, data = new Uint8Array(width / 8 * height);
  const valid = encodeHepBinaryRaster({ data, colors }, width, height), totalBits = data.length * 8;
  assert(valid);
  const header = valid.subarray(0, HEP_BINARY_RASTER_HEADER_BYTES);
  const malformed = runs => Uint8Array.from([...header, ...runs]);
  for (const [name, bytes, pattern] of [
    ["empty run", malformed([0, 0]), /empty runs/],
    ["noncanonical run", malformed([0, 0x81, 0]), /not canonical/],
    ["truncated run", malformed([0, 0x80]), /truncated run/],
    ["overlong run integer", malformed([0, ...new Array(9).fill(128)]), /run length is out of range/],
    ["overrun", malformed([0, ...varint(totalBits + 1)]), /pixel limit/],
    ["short stream", malformed([0, ...varint(totalBits - 1)]), /truncated run/],
    ["trailing run", Uint8Array.from([...valid, 1]), /trailing run/],
    ["invalid first bit", malformed([2, ...varint(totalBits)]), /initial bit/]
  ]) assert.throws(() => decodeHepBinaryRaster(bytes, width, height), pattern, name);
  const corruptMagic = valid.slice(); corruptMagic[0] ^= 1;
  assert.throws(() => decodeHepBinaryRaster(corruptMagic, width, height), /invalid header/);
  const corruptReserved = valid.slice(); corruptReserved[12] = 1;
  assert.throws(() => decodeHepBinaryRaster(corruptReserved, width, height), /reserved header/);
  assert.throws(() => decodeHepBinaryRaster(valid.subarray(0, 17), width, height), /byte length/);
  assert.throws(() => decodeHepBinaryRaster(new Uint8Array(hepBinaryRasterByteLengthLimit(width, height) + 1), width, height), /byte length/);

  const paddedWidth = 13, paddedHeight = 257;
  const paddedBits = Math.ceil(paddedWidth / 8) * Math.ceil(paddedHeight / 8) * 64;
  assert.throws(() => decodeHepBinaryRaster(malformed([1, ...varint(paddedBits)]), paddedWidth, paddedHeight), /padded final rows/,
    "hidden extra rows cannot carry nonzero content");
  for (const dimensions of [[0, 1], [1, 0], [-1, 1], [1.5, 2], [Infinity, 1], [0x7fffffff, 0x7fffffff]]) {
    assert.throws(() => hepBinaryRasterByteLengthLimit(...dimensions), /out of range/);
  }
  assert.throws(() => encodeHepBinaryRaster({ data: data.subarray(1), colors }, width, height), /packed byte length/);
  assert.throws(() => encodeHepBinaryRaster({ data, colors: colors.subarray(1) }, width, height), /palette/);

  const controller = new AbortController(); controller.abort(new Error("cancelled binary preparation"));
  assert.throws(() => encodeHepBinaryRaster({ data, colors }, width, height, controller.signal), /cancelled binary/);
  assert.throws(() => decodeHepBinaryRaster(valid, width, height, controller.signal), /cancelled binary/);
  for (const run of [
    signal => encodeHepBinaryRaster({ data, colors }, width, height, signal),
    signal => decodeHepBinaryRaster(valid, width, height, signal)
  ]) {
    let checks = 0;
    assert.throws(() => run({ throwIfAborted() { if (++checks === 2) throw new Error("cooperative binary cancellation"); } }),
      /cooperative binary cancellation/);
  }
  console.log("HEP binary rasters passed: independent byte parity, odd dimensions and padding, alpha palettes, bounded noise fallback, strict runs and cancellation.");
} finally { hooks.deregister(); }

function varint(value) {
  const out = [];
  do { out.push((value % 128) | (value >= 128 ? 128 : 0)); value = Math.floor(value / 128); } while (value);
  return out;
}

function referenceSection(data, colors, width, height) {
  const rowBytes = Math.ceil(width / 8), transposed = [];
  for (let row = 0; row < height; row += 8) for (let x = 0; x < rowBytes; x++) for (let bit = 0; bit < 8; bit++) {
    let value = 0;
    for (let y = 0; y < 8; y++) value |= (((data[(row + y) * rowBytes + x] ?? 0) >>> (7 - bit)) & 1) << (7 - y);
    transposed.push(value);
  }
  let bit = transposed[0] >>> 7, length = 0;
  const runs = [bit];
  for (const value of transposed) for (let shift = 7; shift >= 0; shift--) {
    const next = (value >>> shift) & 1;
    if (next !== bit) { runs.push(...varint(length)); length = 0; bit = next; }
    length++;
  }
  runs.push(...varint(length));
  return Uint8Array.from([0x48, 0x42, 0x52, 0x31, ...colors, 0, 0, 0, 0, ...runs]);
}
