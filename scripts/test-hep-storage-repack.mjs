import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HepArchive } from "./lib/hepContainer.mjs";
import { repackHepStorageBytes, repackHepStorage } from "./repack-hep-storage.mjs";

const bytePlanes = words => {
  const bytes = new Uint8Array(words.length * 4);
  for (let lane = 0; lane < 4; lane++) for (let index = 0; index < words.length; index++) {
    bytes[lane * words.length + index] = words[index] >>> (lane * 8);
  }
  return bytes;
};
const archive = new HepArchive();
archive.file("manifest.json", JSON.stringify({ formatVersion: 9, sourceFile: "fixture.pdf",
  lod: { vector: { version: 3, precision: "compact", file: "lod-vector/index.json" } } }));
// The storage repacker need not understand a scene or decode its LOD schema.
archive.file("lod-vector/index.json", JSON.stringify({ preserved: true, positionQuantum: 1 / 512 }));
archive.file("lod-vector/2.bin", bytePlanes(Uint32Array.from({ length: 8192 }, (_value, index) =>
  index % 8 < 4 ? (index % 129) - 64 : 0)), { compression: "STORE" });
archive.file("lod-vector/6.bin", bytePlanes(Uint32Array.from({ length: 8192 }, (_value, index) =>
  index * 17)), { compression: "STORE" });
archive.file("geometry/clip-paths.d512", Uint8Array.of(1, 7, 31, 255));
archive.file("raster/0.png", Uint8Array.of(137, 80, 78, 71, 1, 2, 3), { compression: "STORE" });
archive.file("empty", new Uint8Array());
const original = await archive.generateAsync({ type: "uint8array", compression: "DEFLATE" });
const inputCopy = original.slice();
const result = await repackHepStorageBytes(original);
assert(result.bytes.length < original.length);
assert.equal(result.changedChunks, 2);
assert.equal(new DataView(result.bytes.buffer).getUint16(4, true), 3);
assert.deepEqual(original, inputCopy, "repacking cannot mutate the caller's original file");
const buffer = Buffer.alloc(original.length + 23, 0xab);
buffer.set(original, 11);
const bufferCopy = Buffer.from(buffer);
const fromBuffer = await repackHepStorageBytes(buffer.subarray(11, 11 + original.length));
assert.deepEqual(fromBuffer.bytes, result.bytes, "Buffer views with a nonzero offset are supported");
assert.deepEqual(buffer, bufferCopy, "Buffer.slice must not cause repacking to mutate input bytes");
const restored = await HepArchive.loadAsync(result.bytes);
assert.deepEqual(Object.keys(restored.files), Object.keys(archive.files));
for (const name of Object.keys(archive.files)) {
  assert.deepEqual(await restored.file(name).async("uint8array"), await archive.file(name).async("uint8array"),
    `all decoded bytes remain identical, including existing LOD and manifest: ${name}`);
}
const unchanged = await repackHepStorageBytes(result.bytes);
assert.equal(unchanged.changedChunks, 0, "already compacted chunks are never rewritten without a size improvement");
assert.deepEqual(unchanged.bytes, result.bytes);
const plain = new HepArchive();
plain.file("manifest.json", "{}");
plain.file("geometry/strokes.bin", new Uint8Array(2048));
plain.file("\uFEFFlod-vector/2.bin", new Uint8Array(8192), { compression: "STORE" });
const withoutLod = await plain.generateAsync({ type: "uint8array", compression: "DEFLATE" });
assert.deepEqual(await repackHepStorageBytes(withoutLod), { bytes: withoutLod, changedChunks: 0 },
  "unrelated sections retain their complete original container bytes");
await assert.rejects(repackHepStorageBytes(original, { signal: AbortSignal.abort(new Error("cancel test")) }), /cancel test/);
const corrupt = original.slice();
const view = new DataView(corrupt.buffer), entryCount = view.getUint32(8, true), chunkCount = view.getUint32(12, true);
let cursor = 32 + chunkCount * 20;
for (let index = 0; index < entryCount; index++) {
  const length = view.getUint16(cursor, true);
  const name = new TextDecoder().decode(corrupt.subarray(cursor + 16, cursor + 16 + length));
  if (name === "lod-vector/2.bin") {
    const chunk = view.getUint32(cursor + 4, true);
    corrupt[view.getUint32(32 + chunk * 20, true)] ^= 1;
    break;
  }
  cursor += Math.ceil((16 + length) / 4) * 4;
}
await assert.rejects(repackHepStorageBytes(corrupt), /checksum/);

const directory = await mkdtemp(path.join(os.tmpdir(), "hepr-storage-repack-"));
try {
  const file = path.join(directory, "fixture.hep"), messages = [];
  await writeFile(file, original);
  await writeFile(path.join(directory, "untouched.pdf"), "PDF sentinel");
  const measured = await repackHepStorage([directory], { log: message => messages.push(message) });
  assert.equal(measured.length, 1);
  assert.equal(measured[0].written, false);
  assert.deepEqual(new Uint8Array(await readFile(file)), original, "measurement is read-only by default");
  const written = await repackHepStorage(["--write", directory], { log: message => messages.push(message) });
  assert.equal(written[0].written, true);
  assert.deepEqual(new Uint8Array(await readFile(file)), result.bytes, "explicit writes replace the verified smaller file");
  assert.equal(await readFile(path.join(directory, "untouched.pdf"), "utf8"), "PDF sentinel");
  assert.deepEqual((await readdir(directory)).sort(), ["fixture.hep", "untouched.pdf"], "staging directories are removed");
  const repeated = await repackHepStorage(["--write", file], { log() {} });
  assert.equal(repeated[0].written, false);
  await assert.rejects(repackHepStorage(["--timeout-ms=0", file]), /positive integer/);
  await assert.rejects(repackHepStorage(["--unknown", file]), /Unknown option/);
  await assert.rejects(repackHepStorage([]), /Usage/);
  assert(messages.some(message => message.includes("measurement only")));
} finally { await rm(directory, { recursive: true, force: true }); }
console.log("HEP storage repack: exact section bytes, existing LOD preservation, read-only measurement, atomic writes and cancellation passed");
