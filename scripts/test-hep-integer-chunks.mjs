import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { HepArchive } from "./lib/hepContainer.mjs";
const { bytePlaneVarintMaxLength, chooseHepIntegerEncoding, decodeBytePlaneVarints,
  encodeBytePlaneVarints } = await import("../src/hepContainerIntegers.ts");

const align = length => Math.ceil(length / 4) * 4;
function planeBytes(words) {
  const result = new Uint8Array(words.length * 4);
  for (let lane = 0; lane < 4; lane++) for (let index = 0; index < words.length; index++) {
    result[lane * words.length + index] = words[index] >>> (lane * 8);
  }
  return result;
}
function referenceVarints(words, mode) {
  const result = [mode];
  let previous = 0;
  for (const word of words) {
    let value = mode === 0 ? word : (word - previous + 0x100000000) % 0x100000000;
    if (mode !== 2) value = value < 0x80000000 ? value * 2 : (0x100000000 - value) * 2 - 1;
    while (value >= 128) { result.push(value % 128 + 128); value = Math.floor(value / 128); }
    result.push(value);
    previous = word;
  }
  return Uint8Array.from(result);
}
function referenceCrc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function fixture(decoded, packed, { version = 3, codec = 3, checksum = referenceCrc(decoded) } = {}) {
  const name = Buffer.from("lod-vector/2.bin"), stored = deflateSync(packed);
  const indexLength = 20 + align(16 + name.length), offset = 32 + indexLength;
  const result = Buffer.alloc(offset + align(stored.length));
  result.set([0x48, 0x45, 0x50, 0]);
  result.writeUInt16LE(version, 4);
  result.writeUInt32LE(1, 8); result.writeUInt32LE(1, 12); result.writeUInt32LE(indexLength, 16);
  result.writeUInt32LE(offset, 32); result.writeUInt32LE(stored.length, 36);
  result.writeUInt32LE(decoded.length, 40); result.writeUInt32LE(checksum, 44); result[48] = codec;
  result.writeUInt16LE(name.length, 52); result.writeUInt32LE(decoded.length, 64); result.set(name, 68);
  result.writeUInt32LE(referenceCrc(result.subarray(32, offset)), 20);
  result.set(stored, offset);
  return result;
}
async function rejects(bytes, pattern) {
  await assert.rejects(async () => {
    const archive = await HepArchive.loadAsync(bytes);
    await archive.file("lod-vector/2.bin").async("uint8array");
  }, pattern);
}

// Arbitrary word patterns include Float32 signed zero and distinct NaN payloads.
const edges = Uint32Array.of(0, 1, 0xffffffff, 0x80000000, 0x7fffffff, 0x7fc12345, 0x7fa54321,
  127, 128, 16383, 16384, 0x1fffff, 0x200000, 0x0fffffff, 0x10000000, 0xfffffffe, 0xffffffff, 0, 1);
const noise = randomBytes(4096);
for (const words of [edges, new Uint32Array(noise.buffer.slice(noise.byteOffset, noise.byteOffset + noise.length))]) {
  const source = planeBytes(words), original = source.slice();
  for (const mode of [0, 1, 2]) {
    const encoded = encodeBytePlaneVarints(source, mode);
    assert.deepEqual(encoded, referenceVarints(words, mode), `mode ${mode} matches an independent encoder`);
    const encodedCopy = encoded.slice();
    const unaligned = new Uint8Array(encoded.length + 1); unaligned.set(encoded, 1);
    const decoded = decodeBytePlaneVarints(unaligned.subarray(1), source.length);
    assert.deepEqual(decoded, original);
    assert.notEqual(decoded.buffer, source.buffer); assert.notEqual(decoded.buffer, encoded.buffer);
    assert.deepEqual(encoded, encodedCopy); assert.deepEqual(source, original);
    const file = fixture(source, encoded);
    assert.deepEqual(await (await HepArchive.loadAsync(file)).file("lod-vector/2.bin").async("uint8array"), source);
  }
}
assert.equal(bytePlaneVarintMaxLength(4), 6);
for (const length of [0, -4, 3, 4.5, NaN, Number.MAX_SAFE_INTEGER]) {
  assert.throws(() => bytePlaneVarintMaxLength(length), /complete 32-bit words/);
}
assert.throws(() => encodeBytePlaneVarints(new Uint8Array(3), 0), /complete 32-bit words/);
assert.throws(() => encodeBytePlaneVarints(new Uint8Array(4), 3), /mode/);
for (const [packed, pattern] of [
  [[0], /payload length/], [[3, 0], /mode/], [[0, 128], /truncated/], [[0, 128, 0], /noncanonical/],
  [[0, 255, 255, 255, 255, 16], /32 bits/], [[0, 128, 128, 128, 128, 128], /32 bits/],
  [[0, 0, 0], /trailing/]
]) {
  assert.throws(() => decodeBytePlaneVarints(Uint8Array.from(packed), 4), pattern);
  await rejects(fixture(new Uint8Array(4), Uint8Array.from(packed)), pattern);
}
assert.throws(() => decodeBytePlaneVarints(Uint8Array.of(0, 0), 0xfffffffc), /payload length/,
  "malformed expansion is rejected before allocation");
await rejects(fixture(new Uint8Array(4), new Uint8Array(7)), /decompressed output exceeds/);
for (const version of [1, 2]) await rejects(fixture(new Uint8Array(4), Uint8Array.of(0, 0), { version }), /codec/);
await rejects(fixture(new Uint8Array(4), Uint8Array.of(0, 0), { checksum: 0 }), /checksum/);
await rejects(fixture(new Uint8Array(3), Uint8Array.of(0, 0)), /complete 32-bit words/);

// Signed small residuals favor varints; a sorted origin stream favors modulo deltas.
let state = 0x12345678;
const residuals = new Uint32Array(65536), origins = new Uint32Array(65536);
for (let index = 0; index < residuals.length; index++) {
  state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
  residuals[index] = (state & 127) - 64;
  origins[index] = index * 3;
}
for (const words of [residuals, origins]) {
  const source = planeBytes(words), original = deflateSync(source);
  const selected = await chooseHepIntegerEncoding(source, original.length);
  assert(selected && align(selected.length) < align(original.length));
  assert.deepEqual(decodeBytePlaneVarints(inflateSync(selected), source.length), source);
  const archive = new HepArchive().file("lod-vector/2.bin", source).file("manifest.json", '{"formatVersion":9}');
  const output = await archive.generateAsync({ type: "uint8array" });
  assert.equal(new DataView(output.buffer).getUint16(4, true), 3);
  assert.equal(output[48], 3);
  assert.deepEqual(await (await HepArchive.loadAsync(output)).file("lod-vector/2.bin").async("uint8array"), source);
  for (const options of [{ compression: "STORE" }, { entryStore: true }]) {
    const stored = await new HepArchive().file("lod-vector/2.bin", source, options.entryStore ? { compression: "STORE" } : undefined)
      .generateAsync({ type: "uint8array", compression: options.compression });
    assert.equal(new DataView(stored.buffer).getUint16(4, true), 1);
    assert.equal(stored[48], 0);
  }
}
assert.equal(await chooseHepIntegerEncoding(planeBytes(residuals), 1), null,
  "a repack cannot replace a smaller existing payload with a larger integer candidate");
assert.equal(await chooseHepIntegerEncoding(new Uint8Array(3), 1), null);
assert.equal(await chooseHepIntegerEncoding(new Uint8Array(0), 1), null);
const other = await new HepArchive().file("geometry/data.bin", planeBytes(residuals)).generateAsync({ type: "uint8array" });
assert.equal(new DataView(other.buffer).getUint16(4, true), 1, "unmeasured section types keep existing codecs");
const cancelled = new AbortController(); cancelled.abort();
await assert.rejects(chooseHepIntegerEncoding(planeBytes(residuals), 100000, cancelled.signal), { name: "AbortError" });

// v3 keeps earlier codecs readable. The existing container suite covers v1/v2 fixtures.
for (const compression of ["STORE", "DEFLATE"]) {
  const file = await new HepArchive().file("geometry/plain", "unchanged".repeat(1024)).generateAsync({ type: "uint8array", compression });
  new DataView(file.buffer).setUint16(4, 3, true);
  assert.equal(await (await HepArchive.loadAsync(file)).file("geometry/plain").async("string"), "unchanged".repeat(1024));
}
const paletteSource = new Uint32Array(65536 * 4);
for (let index = 0; index < 65536; index++) paletteSource.set([Math.floor(index / 64) % 77, 0x80000000, 0x7fc12345, 0x3f800000], index * 4);
const paletteBytes = new Uint8Array(paletteSource.buffer);
const paletteFile = await new HepArchive().file("textures/stroke-styles.f32", paletteBytes).generateAsync({ type: "uint8array" });
assert.equal(paletteFile[48], 2);
new DataView(paletteFile.buffer).setUint16(4, 3, true);
assert.deepEqual(await (await HepArchive.loadAsync(paletteFile)).file("textures/stroke-styles.f32").async("uint8array"), paletteBytes);
console.log("HEP integer chunks: exact byte planes, signed/modulo deltas, adaptive sizes, legacy codecs, STORE, cancellation and malformed inputs passed.");
