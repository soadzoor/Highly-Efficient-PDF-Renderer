import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";

import { readLegacyHepZip } from "./lib/legacyHepZip.mjs";
import { repackHeps } from "./repack-heps.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
        !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  }
});

// Independent fixture checksum and ZIP encoder: neither uses the migrated
// writer nor its checksum implementation to construct the legacy inputs.
function fixtureCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries) {
  const localRecords = [];
  const centralRecords = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data);
    const method = entry.method ?? 0;
    const flags = /[^\x00-\x7f]/u.test(entry.name) ? 0x800 : 0;
    const stored = entry.stored ?? (method === 8 ? deflateRawSync(data) : data);
    const checksum = fixtureCrc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    local.copy(central, 6, 4, 26);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(entry.name.endsWith("/") ? 0x10 : 0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    localRecords.push(local, stored);
    centralRecords.push(central);
    offset += local.length + stored.length;
  }
  const index = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localRecords, index, end]);
}

const manifest = '{\n  "formatVersion": 6,\n  "createdAt": "2026-01-02T03:04:05.000Z"\n}\n';
const fixtureEntries = [
  { name: "manifest.json", data: manifest, method: 8 },
  { name: "vectors/", data: "" },
  { name: "vectors/empty.bin", data: "" },
  { name: "vectors/first.bin", data: "abc", method: 8 },
  { name: "vectors/second.bin", data: "def" },
  { name: "vectors/large.bin", data: "geometry".repeat(10_000), method: 8 },
  { name: "text/é.bin", data: "UTF-8 fixture", method: 8 },
  { name: "raster/page.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]) },
  { name: "source/source.pdf", data: "opaque source bytes" }
];

let temporary;
try {
  const { HepArchive, crc32 } = await import("../src/hepContainer.ts");
  assert.equal(fixtureCrc32(Buffer.from("123456789")), 0xcbf43926);
  const fixture = makeZip(fixtureEntries);
  const sections = await readLegacyHepZip(fixture, { crc32 });
  assert.equal(sections.size, fixtureEntries.length - 1);
  for (const entry of fixtureEntries.filter((entry) => !entry.name.endsWith("/"))) {
    assert.deepEqual(Buffer.from(sections.get(entry.name)), Buffer.from(entry.data));
  }
  const rejected = async (mutate, pattern) => {
    const bytes = Buffer.from(fixture);
    const end = bytes.length - 22;
    const index = bytes.readUInt32LE(end + 16);
    mutate(bytes, { end, index });
    await assert.rejects(readLegacyHepZip(bytes, { crc32 }), pattern);
  };
  await assert.rejects(readLegacyHepZip(fixture.subarray(0, -1), { crc32 }), /end record/);
  await assert.rejects(readLegacyHepZip(Buffer.concat([fixture, Buffer.from([0])]), { crc32 }), /end record/);
  await rejected((bytes, { end }) => bytes.writeUInt16LE(1, end + 4), /multi-disk/);
  await rejected((bytes, { end }) => bytes.writeUInt16LE(0xffff, end + 10), /ZIP64/);
  await rejected((bytes, { end }) => bytes.writeUInt32LE(0xfffffffe, end + 16), /directory bounds/);
  await rejected((bytes, { index }) => bytes.writeUInt16LE(1, index + 8), /unsupported ZIP feature/);
  await rejected((bytes, { index }) => bytes.writeUInt16LE(8, index + 8), /unsupported ZIP feature/);
  await rejected((bytes, { index }) => bytes.writeUInt16LE(99, index + 10), /unsupported ZIP feature/);
  await rejected((bytes, { index }) => bytes.writeUInt16LE(1, index + 30), /unsupported ZIP feature/);
  await rejected((bytes, { index }) => bytes.writeUInt32LE(0xffffffff, index + 24), /bounds or ZIP64/);
  await rejected((bytes) => bytes.writeUInt16LE(1, 28), /extra fields disagree/);
  await rejected((bytes) => bytes.writeUInt32LE(0, 14), /metadata disagree/);
  await rejected((bytes) => { bytes[30] = "x".charCodeAt(0); }, /filename or payload bounds/);
  await rejected((bytes, { index }) => {
    bytes.writeUInt32LE(0, 14);
    bytes.writeUInt32LE(0, index + 16);
  }, /CRC32 mismatch/);
  await rejected((bytes, { index }) => {
    bytes.writeUInt32LE(1, 22);
    bytes.writeUInt32LE(1, index + 24);
  }, /output exceeds declared length/);
  for (const name of ["../bad.bin", "/bad.bin", "a//b.bin", "a\\b.bin", "a/./b.bin", "a:b.bin"]) {
    await assert.rejects(readLegacyHepZip(makeZip([...fixtureEntries, { name, data: "x" }]), { crc32 }),
      /unsafe or duplicate filename/);
  }
  await assert.rejects(readLegacyHepZip(makeZip([...fixtureEntries, fixtureEntries[0]]), { crc32 }), /duplicate/);
  await assert.rejects(readLegacyHepZip(makeZip([{ name: "manifest.json", data: '{"formatVersion":5}' }]),
    { crc32 }), /formatVersion 6/);
  await assert.rejects(readLegacyHepZip(makeZip([{ name: "manifest.json", data: "{" }]), { crc32 }), /JSON/);
  await assert.rejects(readLegacyHepZip(makeZip([{ name: "manifest.json", data: manifest, method: 8,
    stored: Buffer.concat([deflateRawSync(manifest), Buffer.from([0])]) }]), { crc32 }), /consumed input mismatch/);
  await assert.rejects(readLegacyHepZip(makeZip([{ name: "data.bin", data: "" }]), { crc32 }), /missing/);
  const controller = new AbortController();
  controller.abort(new Error("cancelled fixture"));
  await assert.rejects(readLegacyHepZip(fixture, { crc32, signal: controller.signal }), /cancelled fixture/);
  const duringDecode = new AbortController();
  const decoding = readLegacyHepZip(fixture, { crc32, signal: duringDecode.signal });
  duringDecode.abort(new Error("cancelled during inflate"));
  await assert.rejects(decoding, /cancelled during inflate/);

  temporary = await mkdtemp(path.join(tmpdir(), "hep-repack-test-"));
  const input = path.join(temporary, "a-valid.hep");
  const badInput = path.join(temporary, "z-invalid.hep");
  const log = () => {};
  await writeFile(input, fixture);
  await repackHeps(["--dry-run", input], { log });
  assert.deepEqual(await readFile(input), fixture, "dry-run must not replace the legacy file");
  await assert.rejects(repackHeps(["--check", input], { log }), /requires migration/);
  await writeFile(badInput, "invalid");
  await assert.rejects(repackHeps([temporary], { log }), /legacy HEP ZIP/);
  assert.deepEqual(await readFile(input), fixture, "failed staging must not replace any earlier input");
  assert.deepEqual((await readdir(temporary)).sort(), ["a-valid.hep", "z-invalid.hep"]);
  await rm(badInput);
  const reports = await repackHeps([temporary], { log });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].migrated, true);
  const repacked = await readFile(input);
  assert.equal(repacked.subarray(0, 4).toString("ascii"), "HEP\0");
  const loaded = await HepArchive.loadAsync(repacked);
  assert.equal(await loaded.files["manifest.json"].async("string"), manifest,
    "migration must preserve manifest whitespace and timestamp exactly");
  for (const [name, data] of sections) {
    assert.deepEqual(Buffer.from(await loaded.files[name].async("uint8array")), Buffer.from(data), name);
  }
  await repackHeps(["--check", input], { log });
  await repackHeps([input], { log });
  assert.deepEqual(await readFile(input), repacked, "rerunning migration must preserve new files");
  await assert.rejects(repackHeps([], { log }), /Usage:/);
  await assert.rejects(repackHeps(["--dry-run", "--check", input], { log }), /Usage:/);
  await assert.rejects(repackHeps(["--timeout-ms=120000", input], { log }), /smaller batches/);
  console.log("HEP legacy repack tests passed");
} finally {
  hooks.deregister();
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
