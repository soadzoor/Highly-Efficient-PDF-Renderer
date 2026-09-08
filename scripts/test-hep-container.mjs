import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { HepArchive, crc32, hasHepSignature, hasLegacyZipSignature } from "../src/hepContainer.ts";

// Independent bit-at-a-time CRC and fixture layout do not use the production writer.
function referenceCrc(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const align = value => Math.ceil(value / 4) * 4;
function fixture(sections, { compress = false, grouped = false, declaredLength } = {}) {
  const records = sections.map(([name, data]) => ({ name: Buffer.from(name), data: Buffer.from(data), offset: 0 }));
  const chunks = [];
  for (const record of records) {
    if (!record.data.length) { record.id = 0xffffffff; continue; }
    let chunk = grouped ? chunks[0] : undefined;
    if (!chunk) { chunk = { parts: [], decodedLength: 0 }; chunks.push(chunk); }
    record.id = chunks.indexOf(chunk);
    record.offset = align(chunk.decodedLength);
    chunk.parts.push(Buffer.alloc(record.offset - chunk.decodedLength), record.data);
    chunk.decodedLength = record.offset + record.data.length;
  }
  const indexLength = chunks.length * 20 + records.reduce((sum, record) => sum + align(16 + record.name.length), 0);
  let total = 32 + indexLength;
  for (const chunk of chunks) {
    chunk.decoded = Buffer.concat(chunk.parts);
    chunk.stored = compress ? deflateSync(chunk.decoded) : chunk.decoded;
    chunk.offset = total;
    total += align(chunk.stored.length);
  }
  const bytes = Buffer.alloc(total);
  bytes.set([0x48, 0x45, 0x50, 0]);
  bytes.writeUInt16LE(1, 4);
  bytes.writeUInt32LE(records.length, 8);
  bytes.writeUInt32LE(chunks.length, 12);
  bytes.writeUInt32LE(indexLength, 16);
  let cursor = 32;
  for (const chunk of chunks) {
    bytes.writeUInt32LE(chunk.offset, cursor);
    bytes.writeUInt32LE(chunk.stored.length, cursor + 4);
    bytes.writeUInt32LE(declaredLength ?? chunk.decodedLength, cursor + 8);
    bytes.writeUInt32LE(referenceCrc(chunk.decoded), cursor + 12);
    bytes[cursor + 16] = compress ? 1 : 0;
    bytes.set(chunk.stored, chunk.offset);
    cursor += 20;
  }
  for (const record of records) {
    record.recordOffset = cursor;
    bytes.writeUInt16LE(record.name.length, cursor);
    bytes.writeUInt32LE(record.id, cursor + 4);
    bytes.writeUInt32LE(record.offset, cursor + 8);
    bytes.writeUInt32LE(declaredLength ?? record.data.length, cursor + 12);
    bytes.set(record.name, cursor + 16);
    cursor += align(16 + record.name.length);
  }
  bytes.writeUInt32LE(referenceCrc(bytes.subarray(32, 32 + indexLength)), 20);
  return { bytes, records, chunks };
}
function edit(original, mutate, repairIndex = true) {
  const bytes = Buffer.from(original);
  mutate(bytes);
  if (repairIndex) bytes.writeUInt32LE(referenceCrc(bytes.subarray(32, 32 + bytes.readUInt32LE(16))), 20);
  return bytes;
}
async function rejects(bytes, pattern, name) {
  await assert.rejects(async () => {
    const archive = await HepArchive.loadAsync(bytes);
    if (name) await archive.file(name).async("uint8array");
  }, pattern);
}

assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
assert.equal(crc32(new Uint8Array(0)), 0);
assert.equal(hasHepSignature(Buffer.from([72, 69, 80, 0])), true);
assert.equal(hasHepSignature(Buffer.from([72, 69, 80])), false);
for (const suffix of [[3, 4], [5, 6], [7, 8]]) {
  assert.equal(hasLegacyZipSignature(Buffer.from([80, 75, ...suffix])), true);
  await rejects(Buffer.from([80, 75, ...suffix]), /Legacy ZIP.*repack-heps/);
}
assert.equal(hasLegacyZipSignature(Buffer.from("HEP\0")), false);

const small = fixture([["x", "abc"]]);
assert.equal(small.bytes.length, 76);
assert.equal(small.bytes.readUInt32LE(44), 0x352441c2);
assert.equal(await (await HepArchive.loadAsync(small.bytes)).file("x").async("string"), "abc");
const offsetInput = Buffer.concat([Buffer.from("prefix"), small.bytes, Buffer.from("suffix")]);
assert.equal(await (await HepArchive.loadAsync(offsetInput.subarray(6, -6))).file("x").async("string"), "abc");

for (const compress of [false, true]) {
  const fixtureData = fixture([["geometry/a", "abc"], ["geometry/b", "defgh"], ["empty", ""]], { compress, grouped: true });
  const read = await HepArchive.loadAsync(fixtureData.bytes);
  assert.equal(await read.file("geometry/a").async("string"), "abc");
  assert.equal(await read.file("geometry/b").async("string"), "defgh");
  assert.equal((await read.file("empty").async("arraybuffer")).byteLength, 0);
  const returned = await read.file("geometry/a").async("uint8array");
  returned[0] = 0;
  assert.equal(await read.file("geometry/a").async("string"), "abc", "caller mutation must not corrupt cached chunks");
}

const source = new HepArchive();
const expected = new Map([
  ["manifest.json", Buffer.from('{"formatVersion":6}')],
  ["geometry/a", Buffer.alloc(4096, 7)], ["geometry/b", Buffer.from("abc")],
  ["geometry/empty", Buffer.alloc(0)], ["text/a", Buffer.from("searchable text é 🚀")],
  ["large/data", Buffer.alloc(128 * 1024, 42)], ["binary/noise", randomBytes(8192)],
  ["raster/layer-0.png", Buffer.alloc(6000, 23)], ["raster/layer-1.webp", Buffer.alloc(6000, 42)],
  ["source/source.pdf", Buffer.from("%PDF-1.7")]
]);
for (const [name, bytes] of expected) source.file(name, bytes);
source.file("remove/me", "temporary").remove("remove/me");
assert.equal(source.file("remove/me"), null);
assert.equal(source.files["manifest.json"].dir, false);
assert.equal(source.files["manifest.json"].uncompressedSize, 19);
for (const compression of ["STORE", "DEFLATE"]) {
  const progress = [];
  const bytes = await source.generateAsync({ type: "uint8array", compression }, event => progress.push(event.percent));
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 100);
  assert.ok(progress.every((value, index) => value >= 0 && value <= 100 && (!index || value >= progress[index - 1])));
  const read = await HepArchive.loadAsync(bytes);
  assert.deepEqual(Object.keys(read.files), [...expected.keys()]);
  for (const [name, data] of expected) assert.deepEqual(Buffer.from(await read.file(name).async("uint8array")), data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let compressed = 0;
  for (let index = 0; index < view.getUint32(12, true); index += 1) {
    const cursor = 32 + index * 20;
    const stored = bytes.subarray(view.getUint32(cursor, true), view.getUint32(cursor, true) + view.getUint32(cursor + 4, true));
    const decoded = bytes[cursor + 16] === 1 ? inflateSync(stored) : stored;
    compressed += bytes[cursor + 16];
    assert.equal(decoded.length, view.getUint32(cursor + 8, true));
    assert.equal(referenceCrc(decoded), view.getUint32(cursor + 12, true));
  }
  assert.equal(compressed > 0, compression === "DEFLATE");
}
assert.equal((await source.generateAsync({ type: "blob", compression: "STORE" })).type, "application/x-hep");
assert.ok(await source.generateAsync({ type: "arraybuffer", compression: "STORE" }) instanceof ArrayBuffer);
const empty = await new HepArchive().generateAsync({ type: "uint8array" });
assert.equal(empty.length, 32);
assert.deepEqual(Object.keys((await HepArchive.loadAsync(empty)).files), []);

// Group packing includes alignment bytes and never exceeds 64 KiB.
const grouped = new HepArchive();
for (let i = 0; i < 20; i += 1) grouped.file(`geometry/${i}`, new Uint8Array(4095));
grouped.file("geometry/forced-store", new Uint8Array(2), { compression: "STORE" });
const packed = await grouped.generateAsync({ type: "uint8array" });
const packedView = new DataView(packed.buffer);
assert.equal(packedView.getUint32(12, true), 3);
for (let i = 0; i < 3; i += 1) assert.ok(packedView.getUint32(32 + i * 20 + 8, true) <= 65536);
assert.equal(packed[32 + 2 * 20 + 16], 0);

// Grouped chunks share one in-flight decompression, but standalone chunks do not persist.
const originalDecompression = globalThis.DecompressionStream;
let decompressions = 0;
globalThis.DecompressionStream = class {
  constructor(format) { decompressions += 1; return new originalDecompression(format); }
};
try {
  const shared = await HepArchive.loadAsync(fixture([["g/a", "abc"], ["g/b", "def"]], { compress: true, grouped: true }).bytes);
  await Promise.all([shared.file("g/a").async("uint8array"), shared.file("g/b").async("uint8array")]);
  await shared.file("g/a").async("uint8array");
  assert.equal(decompressions, 1);
  const standalone = await HepArchive.loadAsync(fixture([["a", "abc"]], { compress: true }).bytes);
  await standalone.file("a").async("uint8array");
  await standalone.file("a").async("uint8array");
  assert.equal(decompressions, 3);
} finally { globalThis.DecompressionStream = originalDecompression; }

const two = fixture([["g/a", "abc"], ["g/b", "def"]]);
const groupedFixture = fixture([["g/a", "abc"], ["g/b", "def"]], { grouped: true });
const emptyFixture = fixture([["x", ""]]);
await rejects(Buffer.alloc(0), /header/);
await rejects(small.bytes.subarray(0, 31), /header/);
await rejects(edit(small.bytes, b => b.writeUInt16LE(2, 4)), /version/);
await rejects(edit(small.bytes, b => b.writeUInt16LE(1, 6)), /reserved/);
await rejects(edit(small.bytes, b => b.writeUInt32LE(1, 24)), /reserved/);
await rejects(edit(small.bytes, b => b.writeUInt32LE(8193, 8)), /too many/);
await rejects(edit(small.bytes, b => b.writeUInt32LE(8193, 12)), /too many/);
await rejects(edit(small.bytes, b => b.writeUInt32LE(16 * 1024 * 1024 + 4, 16), false), /index length/);
await rejects(edit(small.bytes, b => b.writeUInt32LE(39, 16), false), /index length/);
await rejects(edit(small.bytes, b => { b[20] ^= 1; }, false), /index checksum/);
await rejects(edit(small.bytes, b => { b[48] = 2; }), /codec/);
await rejects(edit(small.bytes, b => { b[49] = 1; }), /reserved/);
await rejects(edit(small.bytes, b => b.writeUInt32LE(73, 32)), /offset/);
await rejects(edit(small.bytes, b => b.writeUInt32LE(0, 36)), /stored length/);
await rejects(edit(small.bytes, b => b.writeUInt32LE(2, 40)), /lengths differ/);
await rejects(edit(small.bytes, b => b.writeUInt32LE(1024 * 1024 * 1024 + 1, 40)), /decoded chunk length/);
await rejects(edit(small.bytes, b => { b[54] = 1; }), /reserved/);
await rejects(edit(small.bytes, b => { b[68] = 0xff; }), /UTF-8/);
await rejects(edit(small.bytes, b => { b[68] = 0; }), /section name/);
await rejects(edit(small.bytes, b => { b[69] = 1; }), /section padding/);
await rejects(edit(two.bytes, b => { b[two.records[1].recordOffset + 18] = 97; }), /duplicate/);
await rejects(edit(small.bytes, b => b.writeUInt32LE(99, 56)), /reference/);
await rejects(edit(emptyFixture.bytes, b => b.writeUInt32LE(0, 36)), /empty section reference/);
await rejects(edit(emptyFixture.bytes, b => b.writeUInt32LE(4, 40)), /empty section reference/);
await rejects(edit(small.bytes, b => b.writeUInt32LE(1, 60)), /reference or range/);
await rejects(edit(small.bytes, b => b.writeUInt32LE(2, 64)), /standalone/);
await rejects(edit(two.bytes, b => b.writeUInt32LE(two.chunks[0].offset, 52)), /overlapping chunks/);
await rejects(edit(groupedFixture.bytes, b => b.writeUInt32LE(0, groupedFixture.records[1].recordOffset + 8)), /grouped section layout/);
await rejects(edit(groupedFixture.bytes, b => { b[groupedFixture.records[1].recordOffset + 16] = 104; }), /grouped section layout/);
await rejects(fixture([["g/a", Buffer.alloc(4097)], ["g/b", "b"]], { grouped: true }).bytes, /grouped section layout/);
await rejects(fixture([["raster/a", "abc"], ["raster/b", "def"]], { grouped: true }).bytes, /invalid grouped chunk/);
await rejects(fixture(Array.from({ length: 17 }, (_, i) => [`g/${i}`, Buffer.alloc(4096)]), { grouped: true }).bytes, /invalid grouped chunk/);
await rejects(edit(small.bytes, b => { b[72] ^= 1; }), /chunk checksum/, "x");
await rejects(edit(small.bytes, b => { b[75] = 1; }), /payload padding/);
await rejects(small.bytes.subarray(0, -1), /truncated trailing/);
await rejects(Buffer.concat([small.bytes, Buffer.alloc(4)]), /trailing payload/);
await rejects(edit(groupedFixture.bytes, b => {
  b[groupedFixture.chunks[0].offset + 3] = 1;
  b.writeUInt32LE(referenceCrc(b.subarray(groupedFixture.chunks[0].offset, groupedFixture.chunks[0].offset + 7)), 44);
}), /group alignment padding/, "g/a");
await assert.rejects(HepArchive.loadAsync(small.bytes, { entryByteLimits: { x: 2 } }), /byte limit/);
await assert.rejects(HepArchive.loadAsync(small.bytes, { entryByteLimits: { x: -1 } }), /byte limit/);
await rejects(fixture([["manifest.json", "x"]], { compress: true, declaredLength: 16 * 1024 * 1024 + 1 }).bytes, /section.*byte limit/);
for (const name of ["source/source.pdf", "source.pdf"]) {
  await rejects(fixture([[name, "x"]], { compress: true, declaredLength: 512 * 1024 * 1024 + 1 }).bytes, /section.*byte limit/);
}
await rejects(fixture([["a", "a"], ["b", "b"], ["c", "c"]], {
  compress: true, declaredLength: 1024 * 1024 * 1024
}).bytes, /aggregate decoded byte limit/);
await rejects(fixture([["raster/a", "a"], ["raster/b", "b"]], {
  compress: true, declaredLength: 600 * 1024 * 1024
}).bytes, /aggregate raster byte limit/);
const excessive = fixture([["x", Buffer.alloc(2 * 1024 * 1024)]], { compress: true, declaredLength: 16 });
await rejects(excessive.bytes, /decompressed output exceeds/, "x");
await rejects(fixture([["x", "abc"]], { compress: true, declaredLength: 4 }).bytes, /decoded chunk length mismatch/, "x");
const corruptDeflate = fixture([["x", "abc"]], { compress: true });
await rejects(edit(corruptDeflate.bytes, b => { b[corruptDeflate.chunks[0].offset] = 0; }), /./, "x");

for (const name of ["", "a//b", "../a", "/x", "x/", "x\\y", "x\0", "\ud800"]) {
  assert.throws(() => new HepArchive().file(name, "x"), /section name/);
}
const bom = new HepArchive().file("\ufeffname", "kept");
assert.equal(await (await HepArchive.loadAsync(await bom.generateAsync({ type: "uint8array" }))).file("\ufeffname").async("string"), "kept");
const prototypeName = new HepArchive().file("__proto__", "safe");
assert.equal(await prototypeName.file("__proto__").async("string"), "safe");
await assert.rejects(source.generateAsync({ type: "uint8array", compressionLevel: 9 }), /does not support compressionLevel/);
await assert.rejects(source.generateAsync({ type: "uint8array", compression: "invalid" }), /compression must/);

const originalCompression = globalThis.CompressionStream;
globalThis.CompressionStream = undefined;
globalThis.DecompressionStream = undefined;
try {
  const bytes = await source.generateAsync({ type: "uint8array", compression: "STORE" });
  assert.equal(await (await HepArchive.loadAsync(bytes)).file("text/a").async("string"), "searchable text é 🚀");
  await assert.rejects(source.generateAsync({ type: "uint8array" }), /requires native CompressionStream/);
  const compressed = await HepArchive.loadAsync(fixture([["x", "abc"]], { compress: true }).bytes);
  await assert.rejects(compressed.file("x").async("uint8array"), /requires native DecompressionStream/);
} finally {
  globalThis.CompressionStream = originalCompression;
  globalThis.DecompressionStream = originalDecompression;
}

const controller = new AbortController();
const reason = new Error("cancelled HEP test");
controller.abort(reason);
await assert.rejects(HepArchive.loadAsync(small.bytes, { signal: controller.signal }), error => error === reason);
await assert.rejects(source.generateAsync({ type: "uint8array", signal: controller.signal }), error => error === reason);
const later = new AbortController();
const cancelledReader = await HepArchive.loadAsync(small.bytes, { signal: later.signal });
later.abort(reason);
await assert.rejects(cancelledReader.file("x").async("uint8array"), error => error === reason);
const activeWrite = new AbortController();
const large = new HepArchive().file("data", randomBytes(4 * 1024 * 1024));
const writing = large.generateAsync({ type: "uint8array", signal: activeWrite.signal });
setTimeout(() => activeWrite.abort(reason), 0);
await assert.rejects(writing, error => error === reason);
const activeRead = new AbortController();
const huge = await HepArchive.loadAsync(fixture([["data", Buffer.alloc(4 * 1024 * 1024)]], { compress: true }).bytes, { signal: activeRead.signal });
const reading = huge.file("data").async("uint8array");
setTimeout(() => activeRead.abort(reason), 0);
await assert.rejects(reading, error => error === reason);

console.log("HEP container tests passed (independent fixtures, native zlib interoperability, limits, corruption, and cancellation).");
