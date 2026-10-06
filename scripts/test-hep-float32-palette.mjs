import assert from "node:assert/strict";
import { decodeFloat32Palette, encodeFloat32Palette } from "./lib/hepContainer.mjs";
import { decodeXorDeltaByteShuffledFloat32, encodeXorDeltaByteShuffledFloat32 } from "../src/parsedDataEncoding.ts";

const bits = value => new Uint32Array(value.buffer, value.byteOffset, value.length);
const bitPatterns = [0, 0x80000000, 0x3dcccccd, 0x7f800000, 0xff800000, 0x7fc12345, 0x7fa54321, 0xffffffff];
const storage = new Uint32Array(4 + 32 * 4);
const words = storage.subarray(4);
for (let index = 0; index < words.length; index++) words[index] = bitPatterns[index % bitPatterns.length];
const source = new Float32Array(words.buffer, words.byteOffset, words.length);
const original = words.slice();
const encoded = encodeFloat32Palette(source);
assert(encoded && encoded.length < source.byteLength);
assert.deepEqual(words, original, "encoding cannot rewrite source Float32 bits");
const encodedCopy = encoded.slice();
const decoded = decodeFloat32Palette(encoded, source.length / 4);
assert.deepEqual(bits(decoded), original, "palette preserves signed zero, infinities and distinct NaN payloads");
assert.notEqual(decoded.buffer, source.buffer);
assert.notEqual(decoded.buffer, encoded.buffer);
assert.deepEqual(encoded, encodedCopy, "decoding cannot rewrite the encoded payload");

// Palette headers may arrive in an unaligned archive view.
const unaligned = new Uint8Array(encoded.length + 1);
unaligned.set(encoded, 1);
assert.deepEqual(bits(decodeFloat32Palette(unaligned.subarray(1), source.length / 4)), original);

const allIndices = new Uint32Array(256 * 2 * 4);
for (let index = 0; index < 512; index++) allIndices[index * 4] = index % 256;
const maximal = encodeFloat32Palette(new Float32Array(allIndices.buffer));
assert(maximal);
assert.equal(new DataView(maximal.buffer).getUint16(0, true), 256);
assert.deepEqual(bits(decodeFloat32Palette(maximal, 512)), allIndices);
const manyStyles = new Uint32Array(257 * 4);
for (let index = 0; index < 257; index++) manyStyles[index * 4] = index;
assert.equal(encodeFloat32Palette(new Float32Array(manyStyles.buffer)), null, "high cardinality retains the original encoding");
assert.equal(encodeFloat32Palette(new Float32Array(4)), null, "do not enlarge tiny payloads");
assert.equal(encodeFloat32Palette(new Float32Array(0)), null);
assert.throws(() => encodeFloat32Palette(new Float32Array(3)), /complete vec4/);

for (const count of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER]) {
  assert.throws(() => decodeFloat32Palette(encoded, count), /count|length|header|limit/);
}
assert.throws(() => decodeFloat32Palette(encoded.subarray(0, 3), 32), /header/);
assert.throws(() => decodeFloat32Palette(encoded.subarray(0, encoded.length - 1), 32), /length/);
const invalid = encoded.slice();
invalid[2] = 1;
assert.throws(() => decodeFloat32Palette(invalid, 32), /reserved/);
invalid[2] = 0;
invalid[0] = 0;
assert.throws(() => decodeFloat32Palette(invalid, 32), /count/);
invalid[0] = encoded[0];
invalid[invalid.length - 1] = 255;
assert.throws(() => decodeFloat32Palette(invalid, 32), /index/);

const xorBytes = encodeXorDeltaByteShuffledFloat32(source);
const xorOriginal = xorBytes.slice();
assert.deepEqual(bits(decodeXorDeltaByteShuffledFloat32(xorBytes)), original,
  "in-place XOR decoding retains all Float32 payload bits");
assert.deepEqual(xorBytes, xorOriginal, "XOR decoding retains caller ownership of input bytes");
console.log("HEP Float32 palette: exact bits, all 256 indices, ownership, fallback and malformed payloads passed");
