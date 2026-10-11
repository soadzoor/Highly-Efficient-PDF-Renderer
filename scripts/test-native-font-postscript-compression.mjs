import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { deflateSync, inflateSync, constants } from "node:zlib";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createNativeFontPostScriptMemoryFile: memory, createNativeFontPostScriptFilter: filter,
    cloneNativeFontPostScriptFile: cloneFile, sourceNativeFontPostScriptFile: upstream } = await import("../src/pdf/nativeFontPostScriptFile.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");
  const bytes = value => new TextEncoder().encode(value);
  const concat = (...parts) => { const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; } return result; };
  const all = input => { const output = []; for (let byte; (byte = input.readByte()) >= 0;) output.push(byte); return Uint8Array.from(output); };
  const failure = (run, code = "unsupported-font") => assert.throws(run, error => error instanceof PdfError && error.code === code);
  let state = 0x12345678;
  const random = Uint8Array.from({ length: 70000 }, () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state & 255; });
  const corpus = [new Uint8Array(), bytes("/FontType 1 def /answer 20 22 add def"), Uint8Array.from({ length: 256 }, (_, i) => i),
    new Uint8Array(100000).fill(65), random, concat(random.subarray(0, 30000), random.subarray(0, 30000))];
  const trailer = bytes("/resume 42 def");
  for (const original of corpus) for (const settings of [{ level: 0 }, { strategy: constants.Z_FIXED }, { level: 9 }]) {
    const compressed = deflateSync(original, settings), source = memory(concat(compressed, trailer)), decoded = filter(source, "FlateDecode");
    assert.equal(source.tell(), 0, "constructing FlateDecode never reads its source");
    assert.deepEqual(all(decoded), original, `zlib oracle: ${original.length} bytes ${JSON.stringify(settings)}`);
    assert.equal(source.tell(), compressed.length, "FlateDecode stops after the Adler-32 trailer");
    assert.deepEqual(all(source), trailer); assert.equal(decoded.closed, true);
  }
  const lazyEncoded = deflateSync(new Uint8Array(100000).fill(65));
  const lazySource = memory(lazyEncoded), lazy = filter(lazySource, "FlateDecode");
  assert.equal(lazy.readByte(), 65); assert(lazySource.tell() < lazyEncoded.length, "one decoded byte does not materialize the whole stream");

  // Independent canonical-code writer creates wire cases zlib's compressor
  // normally avoids: a full 32768-byte distance and malformed reserved codes.
  const distancePlain = concat(random.subarray(0, 32768), random.subarray(0, 3));
  const distanceWriter = bitWriter();
  distanceWriter.number(0, 1); distanceWriter.number(0, 2); distanceWriter.align();
  distanceWriter.number(32768, 16); distanceWriter.number(32767, 16);
  for (const byte of random.subarray(0, 32768)) distanceWriter.number(byte, 8);
  distanceWriter.number(1, 1); distanceWriter.number(1, 2);
  fixedSymbol(distanceWriter, 257); distanceWriter.code(29, 5); distanceWriter.number(8191, 13); fixedSymbol(distanceWriter, 256);
  const distant = zlib(distanceWriter.finish(), distancePlain);
  assert.deepEqual(inflateSync(distant), Buffer.from(distancePlain), "independent zlib confirms the maximum-distance fixture");
  assert.deepEqual(all(filter(distant, "FlateDecode")), distancePlain);
  const invalidMatch = bitWriter(); invalidMatch.number(1, 1); invalidMatch.number(1, 2);
  fixedSymbol(invalidMatch, 257); invalidMatch.code(0, 5); fixedSymbol(invalidMatch, 256);
  failure(() => all(filter(zlib(invalidMatch.finish(), bytes("AAA")), "FlateDecode")));
  const reservedLiteral = bitWriter(); reservedLiteral.number(1, 1); reservedLiteral.number(1, 2); fixedSymbol(reservedLiteral, 286);
  failure(() => all(filter(zlib(reservedLiteral.finish(), new Uint8Array()), "FlateDecode")));
  const reservedDistance = bitWriter(); reservedDistance.number(1, 1); reservedDistance.number(1, 2);
  fixedSymbol(reservedDistance, 65); fixedSymbol(reservedDistance, 257); reservedDistance.code(30, 5);
  failure(() => all(filter(zlib(reservedDistance.finish(), bytes("AAAA")), "FlateDecode")));
  const badStored = Uint8Array.of(0x78, 1, 1, 1, 0, 0, 0, 65, 0, 0, 0, 1);
  failure(() => all(filter(badStored, "FlateDecode")));
  failure(() => all(filter(Uint8Array.of(0x78, 1, 7, 0, 0, 0, 1), "FlateDecode")));
  failure(() => all(filter(Uint8Array.of(0x78, 0x20), "FlateDecode")));
  failure(() => all(filter(Uint8Array.of(0x78, 2), "FlateDecode")));
  const valid = deflateSync(bytes("checksum and truncation"));
  const checksum = valid.slice(); checksum[checksum.length - 1] ^= 1;
  failure(() => all(filter(checksum, "FlateDecode")));
  for (let cut = 0; cut < valid.length; cut++) failure(() => all(filter(valid.subarray(0, cut), "FlateDecode")));
  for (const mutate of [writer => { writer.number(31, 5); writer.number(0, 5); writer.number(0, 4); },
    writer => { writer.number(0, 5); writer.number(0, 5); writer.number(0, 4); for (let i = 0; i < 4; i++) writer.number(1, 3); },
    writer => { writer.number(0, 5); writer.number(0, 5); writer.number(0, 4); for (let i = 0; i < 4; i++) writer.number(0, 3); }]) {
    const writer = bitWriter(); writer.number(1, 1); writer.number(2, 2); mutate(writer);
    failure(() => all(filter(zlib(writer.finish(), new Uint8Array()), "FlateDecode")));
  }

  const plrmOutput = Uint8Array.of(45, 45, 45, 45, 45, 65, 45, 45, 45);
  assert.deepEqual(all(filter(Uint8Array.of(0x80, 0x0b, 0x60, 0x50, 0x22, 0x0c, 0x0e, 0x02), "LZWDecode")), plrmOutput,
    "Adobe PLRM Table3.18 published MSB-first bytes");
  assert.deepEqual(all(filter(Uint8Array.of(0x00, 0x5b, 0x08, 0x14, 0x18, 0x64, 0x60, 0x40), "LZWDecode", { LowBitFirst: true })), plrmOutput,
    "Adobe PLRM published LSB-first bytes");
  for (const EarlyChange of [0, 1]) for (const LowBitFirst of [false, true]) {
    const original = random.subarray(0, 5000), codes = [256, ...original.subarray(0, 3000), 256, ...original.subarray(3000), 257];
    const compressed = packLzw(codes, { EarlyChange, LowBitFirst }), source = memory(concat(compressed, trailer));
    assert.deepEqual(all(filter(source, "LZWDecode", { EarlyChange, LowBitFirst })), original, "LZW widths9/10/11/12 and table resets");
    assert.equal(source.tell(), compressed.length); assert.deepEqual(all(source), trailer);
  }
  for (const UnitLength of [3, 4, 5, 6, 7]) for (const LowBitFirst of [false, true]) {
    const clear = 1 << UnitLength, compressed = packLzw([clear, 1, clear + 2, clear + 1], { UnitLength, LowBitFirst });
    assert.deepEqual([...all(filter(compressed, "LZWDecode", { UnitLength, LowBitFirst }))], [1, 1, 1], "LZW non-byte units retain byte-per-unit output");
  }
  const fills = Array(3839).fill(65);
  assert.equal(all(filter(packLzw([256, ...fills, 256, 66, 257]), "LZWDecode")).length, 3840);
  failure(() => all(filter(packLzw([256, ...fills, 66, 257]), "LZWDecode")));
  failure(() => all(filter(packLzw([256, 300, 257]), "LZWDecode")));
  failure(() => all(filter(packLzw([256, 65]), "LZWDecode")));
  const badPadding = packLzw([256, 65, 257]); badPadding[badPadding.length - 1] |= 1;
  failure(() => all(filter(badPadding, "LZWDecode")));
  for (const parameters of [{ EarlyChange: 2 }, { UnitLength: 2 }, { UnitLength: 9 }, { LowBitFirst: 1 }, { UnitLength: 3, Predictor: 2 }]) {
    failure(() => filter(new Uint8Array(), "LZWDecode", parameters));
  }

  for (const BitsPerComponent of [1, 2, 4, 8, 16]) for (const Colors of [1, 3]) {
    const Columns = 7, samples = Columns * Colors, rowBytes = Math.ceil(samples * BitsPerComponent / 8), mask = 2 ** BitsPerComponent - 1;
    const original = random.subarray(0, rowBytes * 3), encoded = original.slice();
    for (let row = 0; row < 3; row++) for (let sample = Colors; sample < samples; sample++) {
      writePacked(encoded, row * rowBytes, sample, BitsPerComponent,
        (readPacked(original, row * rowBytes, sample, BitsPerComponent) - readPacked(original, row * rowBytes, sample - Colors, BitsPerComponent)) & mask);
    }
    for (const name of ["FlateDecode", "LZWDecode"]) {
      const compressed = name === "FlateDecode" ? deflateSync(encoded) : packLzw([256, ...encoded, 257]);
      assert.deepEqual(all(filter(compressed, name, { Predictor: 2, BitsPerComponent, Colors, Columns })), original,
        `${name} TIFF packed${BitsPerComponent} color${Colors}`);
    }
  }
  for (const BitsPerComponent of [1, 2, 4, 8, 16]) for (const Colors of [1, 3]) {
    const Columns = 11, rowBytes = Math.ceil(Columns * Colors * BitsPerComponent / 8), pixel = Math.max(1, Math.ceil(Colors * BitsPerComponent / 8));
    const original = random.subarray(0, rowBytes * 5), rows = [];
    for (let row = 0; row < 5; row++) {
      const encoded = new Uint8Array(rowBytes + 1); encoded[0] = row;
      for (let i = 0; i < rowBytes; i++) {
        const left = i >= pixel ? original[row * rowBytes + i - pixel] : 0;
        const up = row ? original[(row - 1) * rowBytes + i] : 0;
        const corner = row && i >= pixel ? original[(row - 1) * rowBytes + i - pixel] : 0;
        const prediction = row === 0 ? 0 : row === 1 ? left : row === 2 ? up : row === 3 ? Math.floor((left + up) / 2) : paeth(left, up, corner);
        encoded[i + 1] = (original[row * rowBytes + i] - prediction) & 255;
      }
      rows.push(encoded);
    }
    for (const name of ["FlateDecode", "LZWDecode"]) {
      const encoded = concat(...rows), compressed = name === "FlateDecode" ? deflateSync(encoded) : packLzw([256, ...encoded, 257]);
      assert.deepEqual(all(filter(compressed, name, { Predictor: 99, BitsPerComponent, Colors, Columns })), original,
        `${name} all PNG algorithms, packed${BitsPerComponent} color${Colors}`);
    }
  }
  assert.equal(new TextDecoder().decode(all(filter(deflateSync(Uint8Array.of(1, 97, 1, 1)), "FlateDecode",
    { Predictor: 11, Columns: 5 }))), "abc", "Ghostscript FlateEncode valid final partial predictor row is preserved");
  assert.deepEqual([...all(filter(deflateSync(Uint8Array.of(5, 1, 1)), "FlateDecode", { Predictor: 2, Columns: 5 }))], [5, 6, 7]);
  assert.deepEqual([...all(filter(deflateSync(Uint8Array.of(0, 65)), "FlateDecode", { Predictor: 15, Columns: 1000000000 },
    { maxDecodedBytes: 1 }))], [65], "large declared rows never force allocation of nonexistent samples");
  failure(() => all(filter(deflateSync(Uint8Array.of(5, 65)), "FlateDecode", { Predictor: 15 })));
  failure(() => all(filter(deflateSync(Uint8Array.of(0)), "FlateDecode", { Predictor: 15 })));
  for (const parameters of [{ Predictor: 3 }, { Predictor: 2, Columns: 0 }, { Predictor: 2, Colors: 0 }, { Predictor: 2, BitsPerComponent: 3 }]) {
    failure(() => filter(new Uint8Array(), "FlateDecode", parameters));
  }
  failure(() => filter(new Uint8Array(), "FlateDecode", { Predictor: 2, Columns: Number.MAX_SAFE_INTEGER }), "resource-limit");

  for (const [name, compressed, parameters] of [
    ["FlateDecode", lazyEncoded, {}], ["LZWDecode", packLzw([256, 65, 258, 259, 260, 257]), {}],
    ["FlateDecode", deflateSync(Uint8Array.of(0, 65, 66, 67, 2, 1, 1, 1)), { Predictor: 15, Columns: 3 }],
    ["ASCII85Decode", bytes("87cURD]j7BEbo80~>"), {}], ["ASCIIHexDecode", bytes("41424344>"), {}],
    ["RunLengthDecode", Uint8Array.of(253, 65, 128), {}], ["SubFileDecode", bytes("abcENDtail"), { EODCount: 0, EODString: bytes("END") }]
  ]) {
    const source = memory(concat(compressed, trailer)), original = filter(source, name, parameters);
    original.readByte(); original.peekByte();
    const clones = new Map(), copiedBytes = new Map();
    const copy = value => { if (copiedBytes.has(value)) return copiedBytes.get(value); const result = value.slice(); copiedBytes.set(value, result); return result; };
    const clone = value => { if (clones.has(value)) return clones.get(value); const result = cloneFile(value, clone, copy);
      assert(result); clones.set(value, result); return result; };
    const owned = clone(original); assert.notStrictEqual(upstream(owned), upstream(original));
    assert.deepEqual(all(owned), all(original), `${name}: active clone preserves buffered lookahead and decoder state`);
    assert.equal(upstream(owned).tell(), upstream(original).tell());
    assert.strictEqual(clone(source), upstream(owned), "upstream clone aliases are memoized");
  }
  for (const [name, compressed] of [["FlateDecode", lazyEncoded], ["LZWDecode", packLzw([256, 65, 258, 259, 260, 257])]]) {
    failure(() => all(filter(compressed, name, {}, { maxDecodedBytes: 2 })), "resource-limit");
    const controller = new AbortController(), decoded = filter(compressed, name, {}, { signal: controller.signal });
    decoded.readByte(); controller.abort(); failure(() => decoded.readByte(), "aborted");
  }
  failure(() => all(filter(deflateSync(Uint8Array.of(0, 65, 66, 67)), "FlateDecode", { Predictor: 15, Columns: 3 },
    { maxDecodedBytes: 2 })), "resource-limit");
  console.log("Font PostScript compression passed: zlib independent oracle, all DEFLATE blocks/history/checksums, LZW bit orders/units/widths, TIFF/PNG predictors, EOD cursors, active cloning, malformed data, limits and cancellation.");
} finally { hooks.deregister(); }

function bitWriter() {
  const output = []; let pending = 0, count = 0;
  const bit = value => { pending |= value << count; if (++count === 8) { output.push(pending); pending = count = 0; } };
  return { number(value, width) { for (let i = 0; i < width; i++) bit((value >>> i) & 1); },
    code(value, width) { for (let i = width - 1; i >= 0; i--) bit((value >>> i) & 1); },
    align() { if (count) { output.push(pending); pending = count = 0; } },
    finish() { if (count) output.push(pending); return Uint8Array.from(output); } };
}
function fixedSymbol(writer, code) {
  if (code <= 143) writer.code(0x30 + code, 8);
  else if (code <= 255) writer.code(0x190 + code - 144, 9);
  else if (code <= 279) writer.code(code - 256, 7);
  else writer.code(0xc0 + code - 280, 8);
}
function zlib(deflate, plain) {
  let a = 1, b = 0; for (const value of plain) { a = (a + value) % 65521; b = (b + a) % 65521; }
  const result = new Uint8Array(deflate.length + 6); result.set([0x78, 1]); result.set(deflate, 2);
  new DataView(result.buffer).setUint32(result.length - 4, ((b << 16) | a) >>> 0); return result;
}
function packLzw(codes, { EarlyChange = 1, UnitLength = 8, LowBitFirst = false } = {}) {
  const output = [], clear = 1 << UnitLength;
  let pending = 0, pendingBits = 0;
  let width = UnitLength + 1, next = clear + 2, previous = false;
  for (const code of codes) {
    for (let bit = 0; bit < width; bit++) {
      const value = (code >>> (LowBitFirst ? bit : width - bit - 1)) & 1;
      pending = LowBitFirst ? pending | (value << pendingBits) : (pending << 1) | value;
      if (++pendingBits === 8) { output.push(pending); pending = pendingBits = 0; }
    }
    if (code === clear) { width = UnitLength + 1; next = clear + 2; previous = false; }
    else if (code !== clear + 1) { if (previous && next < 4096) { next++; if (width < 12 && next + EarlyChange === 2 ** width) width++; } previous = true; }
  }
  if (pendingBits) output.push(LowBitFirst ? pending : pending << (8 - pendingBits));
  return Uint8Array.from(output);
}
function readPacked(bytes, row, sample, bits) {
  const offset = row + Math.floor(sample * bits / 8), shift = 8 - bits - ((sample * bits) % 8);
  return bits === 16 ? bytes[offset] * 256 + bytes[offset + 1] : (bytes[offset] >>> shift) & (2 ** bits - 1);
}
function writePacked(bytes, row, sample, bits, value) {
  const offset = row + Math.floor(sample * bits / 8), shift = 8 - bits - ((sample * bits) % 8);
  if (bits === 16) { bytes[offset] = value >>> 8; bytes[offset + 1] = value & 255; }
  else { const mask = (2 ** bits - 1) << shift; bytes[offset] = (bytes[offset] & ~mask) | (value << shift); }
}
function paeth(left, up, corner) {
  const prediction = left + up - corner, a = Math.abs(prediction - left), b = Math.abs(prediction - up), c = Math.abs(prediction - corner);
  return a <= b && a <= c ? left : b <= c ? up : corner;
}
