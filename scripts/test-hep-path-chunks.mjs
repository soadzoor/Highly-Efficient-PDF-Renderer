import assert from "node:assert/strict";
import { deflateSync, inflateSync } from "node:zlib";
import { HepArchive } from "./lib/hepContainer.mjs";
const { pathChainMaxLength, encodePathChains, decodePathChains, chooseHepPathEncoding } =
  await import("../src/hepContainerPaths.ts");

function uint(output, value) {
  while (value >= 128) { output.push(value % 128 + 128); value = Math.floor(value / 128); }
  output.push(value);
}
function signed(output, value) { uint(output, value < 0 ? -value * 2 - 1 : value * 2); }
function section(paths) {
  const header = []; uint(header, paths.length);
  const columns = [[], [], [], []], previous = [0, 0, 0, 0];
  for (const [index, path] of paths.entries()) {
    signed(header, path.parent ?? -1); header.push(path.fill ?? (index & 1)); uint(header, path.edges.length);
    for (const edge of path.edges) for (let channel = 0; channel < 4; channel++) {
      signed(columns[channel], edge[channel] - previous[channel]); previous[channel] = edge[channel];
    }
  }
  for (const column of columns) uint(header, column.length);
  return Uint8Array.from([...header, ...columns.flat()]);
}

const clamp = 0x3fffffff;
const cases = [
  [], [{ edges: [] }],
  [{ edges: [[0, 0, 128, 256], [128, 256, -16384, -32768], [15, 44, 19, 11]] }],
  [{ edges: [[clamp, -clamp, -clamp, clamp], [-clamp, clamp, clamp, -clamp]] }],
  [{ edges: [[7, 9, 7, 9]] }, { parent: 0, edges: [] }, { parent: 1, edges: [[7, 9, 21, 23]] }]
];
let state = 0x13579bdf;
const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
for (let iteration = 0; iteration < 100; iteration++) {
  const paths = [];
  for (let path = 0; path < iteration % 9 + 1; path++) {
    const edges = [];
    let x = (random() % 1000000) - 500000, y = (random() % 1000000) - 500000;
    for (let edge = 0; edge < random() % 100; edge++) {
      const ex = x + (random() % 20001) - 10000, ey = y + (random() % 20001) - 10000;
      edges.push([x, y, ex, ey]);
      x = ex; y = ey;
      if (!(random() & 7)) { x += 40000; y -= 25000; }
    }
    paths.push({ parent: path ? path - 1 : -1, fill: random() & 1, edges });
  }
  cases.push(paths);
}
for (const paths of cases) {
  const source = section(paths), original = source.slice(), packed = encodePathChains(source), packedCopy = packed.slice();
  const unaligned = Buffer.alloc(packed.length + 17, 0xac); unaligned.set(packed, 9);
  const decoded = decodePathChains(unaligned.subarray(9, 9 + packed.length), source.length);
  assert.deepEqual(decoded, source, "the independently encoded original section is preserved exactly");
  assert.deepEqual(source, original); assert.deepEqual(packed, packedCopy);
  assert.notEqual(decoded.buffer, source.buffer); assert.notEqual(decoded.buffer, packed.buffer);
  assert(packed.length <= pathChainMaxLength(source.length));
}
assert.equal(pathChainMaxLength(5), 51);
for (const length of [0, 4, -1, 5.5, NaN, Number.MAX_SAFE_INTEGER]) {
  assert.throws(() => pathChainMaxLength(length), /length is invalid/);
}
for (const source of [Uint8Array.of(0), Uint8Array.of(128, 0, 0, 0, 0, 0),
  Uint8Array.of(255, 255, 255, 255, 127), Uint8Array.of(1, 0, 2, 0, 0, 0, 0, 0)]) {
  assert.throws(() => encodePathChains(source), /path chunk/);
  assert.equal(await chooseHepPathEncoding(source, 1000), null, "unknown and malformed old data retains its original encoding");
}
const empty = encodePathChains(section([]));
for (const malformed of [new Uint8Array(), Uint8Array.of(1, ...empty.subarray(1)),
  Uint8Array.of(0, 128, 0), Uint8Array.of(0, 255, 255, 255, 255, 16),
  empty.subarray(0, empty.length - 1), Uint8Array.of(...empty, 0)]) {
  assert.throws(() => decodePathChains(malformed, 5), /path chunk/);
}
assert.throws(() => decodePathChains(empty, 0xffffffff), /original section/,
  "forged expanded sizes are rejected without allocating an output array");
const corruptParent = encodePathChains(section([{ edges: [] }]));
corruptParent[3] = 0;
assert.throws(() => decodePathChains(corruptParent, 8), /parent/);
const source = section([{ edges: [[10, 11, 14, 17], [14, 17, 0, 0]] }]);
const packed = encodePathChains(source);
for (let end = 0; end < packed.length; end++) {
  assert.throws(() => decodePathChains(packed.subarray(0, end), source.length), /path chunk/);
}

// Endpoint continuity creates compressible zero corrections even for unique paths.
const paths = [];
for (let index = 0; index < 200; index++) {
  const edges = [];
  let x = index * 20000, y = -index * 11000;
  for (let edge = 0; edge < 250; edge++) {
    const ex = x + (random() % 8193) - 4096, ey = y + (random() % 8193) - 4096;
    edges.push([x, y, ex, ey]); x = ex; y = ey;
  }
  paths.push({ edges });
}
const large = section(paths), originalStored = deflateSync(large);
const selected = await chooseHepPathEncoding(large, originalStored.length);
assert(selected && selected.length < originalStored.length * 0.7, "connected path endpoints reduce stored size materially");
assert.deepEqual(decodePathChains(inflateSync(selected), large.length), large);
assert.equal(await chooseHepPathEncoding(large, 1), null, "an existing smaller payload is retained");
const cancelled = new AbortController(); cancelled.abort();
await assert.rejects(chooseHepPathEncoding(large, originalStored.length, cancelled.signal), { name: "AbortError" });

const archive = new HepArchive().file("geometry/clip-paths.d512", large).file("manifest.json", '{"formatVersion":9}');
const output = await archive.generateAsync({ type: "uint8array" });
assert.equal(new DataView(output.buffer).getUint16(4, true), 4, "selected path storage uses container v4");
assert.equal(output[48], 4, "the large clip section selects the path codec");
assert.deepEqual(await (await HepArchive.loadAsync(output)).file("geometry/clip-paths.d512").async("uint8array"), large);
for (const options of [{ compression: "STORE" }, { entryStore: true }]) {
  const stored = await new HepArchive().file("geometry/clip-paths.d512", large,
    options.entryStore ? { compression: "STORE" } : undefined)
    .generateAsync({ type: "uint8array", compression: options.compression });
  assert.equal(stored[48], 0, "STORE bypasses the path transform");
  assert.equal(new DataView(stored.buffer).getUint16(4, true), 1);
}
for (const version of [1, 2, 3]) {
  const older = output.slice(); new DataView(older.buffer).setUint16(4, version, true);
  await assert.rejects(HepArchive.loadAsync(older), /codec/, "earlier versions reject the new codec");
}
const unsupported = Uint8Array.of(1, 7, 31, 255);
const preserved = await new HepArchive().file("geometry/clip-paths.d512", unsupported).generateAsync({ type: "uint8array" });
assert.equal(new DataView(preserved.buffer).getUint16(4, true), 1, "unsupported old section bytes keep their original encoding");
assert.deepEqual(await (await HepArchive.loadAsync(preserved)).file("geometry/clip-paths.d512").async("uint8array"), unsupported);
const other = await new HepArchive().file("geometry/unrelated.bin", large).generateAsync({ type: "uint8array" });
assert.equal(new DataView(other.buffer).getUint16(4, true), 1, "unmeasured sections keep existing codecs");
console.log("HEP path chunks: exact connected contours, discontinuities, extrema, independent fixtures, compression, cancellation and malformed input passed.");
