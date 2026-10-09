import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { instrumentJbig2Wasm } from "./lib/instrumentJbig2Wasm.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});
const { decodeBundledJbig2, BUNDLED_JBIG2_CODEC_ASSET: asset } = await import("../src/pdf/nativeJbig2Codec.ts");
const { capJbig2WasmMemory, decodePdfiumJbig2 } = await import("../src/pdf/codecs/jbig2Wasm.ts");
const { preflightJbig2 } = await import("../src/pdf/codecs/jbig2Preflight.ts");
const upstream = new Uint8Array(await readFile(new URL("../src/assets/codecs/jbig2/upstream-jbig2.wasm", import.meta.url)));
const shipped = new Uint8Array(await readFile(asset.url));
const instrumented = instrumentJbig2Wasm(upstream);
assert.deepEqual(instrumented.bytes, shipped, "vendored instrumentation must be reproducible");
assert.equal(instrumented.functions, 119);
assert.equal(instrumented.loops, 236);
assert.equal(instrumented.batchSize, 1024);
assert.equal(shipped.length, asset.byteLength);
assert.equal(createHash("sha256").update(shipped).digest("hex"), asset.sha256);
assert.equal(WebAssembly.validate(shipped), true);
const capped = capJbig2WasmMemory(shipped, 256);
assert.equal(WebAssembly.validate(capped), true);
const cappedInstance = new WebAssembly.Instance(new WebAssembly.Module(capped), {
  a: Object.fromEntries("abcdefgh".split("").map(name => [name, () => 0]))
});
assert.equal(cappedInstance.exports.i.buffer.byteLength, 16 * 1024 * 1024);
assert.throws(() => cappedInstance.exports.i.grow(1), RangeError, "defined memory must enforce the cap");
assert.throws(() => capJbig2WasmMemory(shipped, 255), error => error.code === "resource-limit");
assert.equal(WebAssembly.validate(capJbig2WasmMemory(shipped, 65536)), true,
  "the runtime memory allowance can exceed the vendored 512 MiB policy up to the memory32 ABI");
assert.throws(() => capJbig2WasmMemory(shipped, 65537), error => error.code === "resource-limit");

const uint32 = value => [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
function segment(number, type, payload, references = []) {
  return [...uint32(number), type, references.length << 5, ...references, 1, ...uint32(payload.length), ...payload];
}
function pageInfo(width = 1, height = 1) {
  return [...uint32(width), ...uint32(height), ...uint32(0), ...uint32(0), 0, 0, 0];
}
function regionInfo(width = 1, height = 1, x = 0, y = 0, combination = 0) {
  return [...uint32(width), ...uint32(height), ...uint32(x), ...uint32(y), combination];
}
function decode(segments, maxBytes = 32 * 1024 * 1024, width = 1, height = 1) {
  return decodeBundledJbig2({
    codec: "jbig2", encoded: Uint8Array.from(segments.flat()), globals: new Uint8Array(),
    width, height, components: 1, bitsPerComponent: 1, imageMask: false, decodeParameters: {}
  }, maxBytes);
}
async function invalidData(action) {
  await assert.rejects(action, error => error.code === "unsupported-image" &&
    error.details?.reason === "invalid-jbig2-data" &&
    error.cause instanceof Error);
}
async function resourceLimit(action, reason) {
  await assert.rejects(action, error => error.code === "resource-limit" && error.details?.reason === reason);
}

// One-row MMR: V(0) gives a white pixel; horizontal white-0/black-1 gives black.
assert.deepEqual([...(await decode([
  segment(1, 48, pageInfo()), segment(2, 38, [...regionInfo(), 1, 0x80])
])).samples], [255]);
assert.deepEqual([...(await decode([
  segment(1, 48, pageInfo()), segment(2, 38, [...regionInfo(), 1, 0x26, 0xa8])
])).samples], [127]);

// Crossing a non-byte-aligned page edge must preserve row padding and the next row.
const blackNineBits = "001" + "00110101" + "000100";
const blackNine = Array.from({ length: Math.ceil(blackNineBits.length / 8) }, (_, index) =>
  parseInt(blackNineBits.slice(index * 8, index * 8 + 8).padEnd(8, "0"), 2));
const overflowRegion = [...regionInfo(9, 1, 8), 1, ...blackNine];
assert.deepEqual([...(await decode([
  segment(1, 48, pageInfo(9, 2)), segment(2, 38, overflowRegion)
], undefined, 9, 2)).samples], [255, 127, 255, 255]);
assert.deepEqual([...(await decode([
  segment(1, 48, pageInfo(9, 2)), segment(2, 38, [...regionInfo(1, 3, 0, 1), 1, 0x26, 0xab])
], undefined, 9, 2)).samples], [255, 255, 127, 255]);
assert.deepEqual([...(await decode([
  segment(1, 48, pageInfo(9, 2)), segment(2, 38, [...regionInfo(1, 1, 0xffffffff), 1, 0x26, 0xa8])
], undefined, 9, 2)).samples], [255, 255, 255, 255]);
const xorPage = pageInfo(9, 2); xorPage[16] = 64;
const xorRegion = [...regionInfo(9, 1, 8, 0, 2), 1, ...blackNine];
assert.deepEqual([...(await decode([
  segment(1, 48, xorPage), segment(2, 38, xorRegion), segment(3, 38, xorRegion)
], undefined, 9, 2)).samples], [255, 255, 255, 255]);

// A short payload must never consume metadata from the following segment.
const following = segment(20, 62, new Array(64).fill(0));
await invalidData(() => decode([segment(1, 48, pageInfo().slice(0, 18)), following]), "Truncated");
for (const [type, length] of [[0, 1], [6, 16], [16, 6], [22, 17], [38, 17], [53, 8]]) {
  await invalidData(() => decode([segment(1, 48, pageInfo()), segment(2, type, new Array(length).fill(0)), following]));
}
const complete = Uint8Array.from(segment(1, 48, pageInfo()));
for (let length = 1; length < complete.length; length++) {
  await invalidData(() => decode([complete.slice(0, length)]));
}

// Long-form retention flags include the current segment: eight references need two bytes.
const eightReferences = [
  ...uint32(100), 62, ...uint32(0xe0000008), 0, 0,
  1, 2, 3, 4, 5, 6, 7, 8, 0, ...uint32(0)
];
assert.deepEqual([...(await decode([segment(1, 48, pageInfo()), eightReferences])).samples], [255]);
await invalidData(() => decode([
  segment(1, 48, pageInfo()), [...uint32(100), 62, ...uint32(0xe0100000)]
]), "truncated reference metadata remains invalid independently of symbol counts");
const declaredSymbols = Uint8Array.from([
  ...segment(1, 48, pageInfo()), ...segment(2, 0, [0, 1, ...uint32(1_000_001), ...uint32(1_000_001)])
]);
assert.doesNotThrow(() => preflightJbig2(declaredSymbols, new Uint8Array(), 1, 1, Number.MAX_SAFE_INTEGER),
  "symbol declarations beyond the former count allowance can reach the allocator");

// A tiny Huffman dictionary defining/exporting one black 1x1 symbol.
// DH=1, DW=1, OOB, BMSIZE=0; byte-aligned bitmap; export runs zero then one.
const dictionary = [0, 1, ...uint32(1), ...uint32(1), 0x5f, 0x80, 0x80, 0, 0x40];
assert.deepEqual([...(await decode([segment(1, 48, pageInfo()), segment(2, 0, dictionary)])).samples], [255]);
const oversizedRun = [0, 1, ...uint32(1), ...uint32(0), 0x10]; // B.1 run=2, only one imported symbol.
await invalidData(() => decode([
  segment(1, 48, pageInfo()), segment(2, 0, dictionary), segment(3, 0, oversizedRun, [2])
]), "invalid exported symbol run");
const invalidArithmeticRun = [
  0, 0, 3, 255, 253, 255, 2, 254, 254, 254, ...uint32(1), ...uint32(0), 255, 172
];
await invalidData(() => decode([
  segment(1, 48, pageInfo()), segment(2, 0, dictionary), segment(3, 0, invalidArithmeticRun, [2])
]), "invalid exported symbol run");
const truncatedCollectiveBitmap = [0, 1, ...uint32(1), ...uint32(1), 0x5f, 0x84]; // BMSIZE=1, no bitmap byte.
await invalidData(() => decode([
  segment(1, 48, pageInfo()), segment(2, 0, truncatedCollectiveBitmap)
]), "truncated collective bitmap");

// Declared table lines and retained segment objects consume the allocation budget.
const manyTableLines = [0, ...uint32(0), ...uint32(10000), ...new Array(2501).fill(0)];
await resourceLimit(() => decode([segment(1, 48, pageInfo()), segment(2, 53, manyTableLines)], 16384), "jbig2-working-set");
await resourceLimit(() => decode([
  segment(1, 48, pageInfo()), ...Array.from({ length: 100 }, (_, index) => segment(index + 2, 62, []))
], 4096), "jbig2-working-set");
await resourceLimit(() => decode([
  segment(1, 48, pageInfo()), segment(2, 16, [1, 1, 255, ...uint32(9), ...new Array(32).fill(255)])
], 65536), "jbig2-working-set");
await resourceLimit(() => decode([
  segment(1, 48, pageInfo()), segment(2, 38, [...regionInfo(10000, 1), 1, 0x80])
], 32768), "jbig2-working-set");

// A single reused pattern with a zero grid vector can overlap itself thousands of times.
// Prove its declared 266M-pixel work is accepted without running that decode.
const pattern = [1, 255, 255, ...uint32(0), ...new Array(32).fill(255)];
const overlapGrid = [
  ...regionInfo(255, 255), 1, ...uint32(4096), ...uint32(1),
  ...uint32(0), ...uint32(0), 0, 0, 0, 0
];
const declaredWork = Uint8Array.from([
  ...segment(1, 48, pageInfo()), ...segment(2, 16, pattern), ...segment(3, 22, overlapGrid, [2])
]);
assert.ok(preflightJbig2(declaredWork, new Uint8Array(), 1, 1, Number.MAX_SAFE_INTEGER) > 200_000_000,
  "default work accounting has no guessed complexity allowance");
assert.throws(() => preflightJbig2(declaredWork, new Uint8Array(), 1, 1, Number.MAX_SAFE_INTEGER, undefined, 200_000_000),
  error => error.code === "resource-limit" && error.details?.reason === "jbig2-work",
  "explicit work allowances still apply");

// The instrumentation must stop real WASM execution, not just metadata parsing.
const tall = Uint8Array.from([
  ...segment(1, 48, pageInfo(1, 4096)),
  ...segment(2, 38, [...regionInfo(1, 4096), 1, ...new Array(512).fill(255), 0, 16, 1])
]);
await resourceLimit(() => decodePdfiumJbig2(tall, new Uint8Array(), 1, 4096,
  32 * 1024 * 1024, undefined, 0), "jbig2-work");
const controller = new AbortController();
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted").get;
let interruptedInsideWasm = false;
Object.defineProperty(controller.signal, "aborted", { get() {
  if (!interruptedInsideWasm && new Error().stack.includes("checkWork")) {
    interruptedInsideWasm = true; controller.abort();
  }
  return aborted.call(this);
} });
await assert.rejects(decodePdfiumJbig2(tall, new Uint8Array(), 1, 4096,
  32 * 1024 * 1024, controller.signal), error => error.code === "aborted");
assert.equal(interruptedInsideWasm, true, "abort must be observed by the injected WASM callback");
// This hidden packed region exceeds the runtime heap independently of the
// preflight guard; prove failed WASM growth retains the resource-limit code.
const hiddenAllocation = Uint8Array.from([
  ...segment(1, 48, pageInfo()),
  ...segment(2, 38, [...regionInfo(0x20000000, 1), 1, 0x80])
]);
await resourceLimit(() => decodePdfiumJbig2(hiddenAllocation, new Uint8Array(), 1, 1,
  18 * 1024 * 1024), "jbig2-working-set");
const recovered = await decodePdfiumJbig2(tall, new Uint8Array(), 1, 4096, 32 * 1024 * 1024);
assert.equal(recovered.length, 4096);
assert.equal(recovered.every(byte => byte === 255), true, "interrupted instances must not poison subsequent decoding");

// Compare packed polarity/stride with the original pinned PDFium binary, and
// cover globals, optional file headers, caller ownership and concurrent calls.
const { tinyJbig2, tinyJbig2Globals } = await import("./lib/imageCodecFixtures.mjs");
const encoded = tinyJbig2(), globals = tinyJbig2Globals();
const beforeEncoded = encoded.slice(), beforeGlobals = globals.slice();
const header = [0x97, 0x4a, 0x42, 0x32, 0x0d, 0x0a, 0x1a, 0x0a, 3];
const request = {
  codec: "jbig2", encoded, globals, width: 8, height: 2, components: 1,
  bitsPerComponent: 1, imageMask: false, decodeParameters: {}
};
for (const input of [request, { ...request,
  encoded: Uint8Array.from([...header, ...encoded]), globals: Uint8Array.from([...header, ...globals])
}]) {
  assert.deepEqual([...(await decodeBundledJbig2(input, 32 * 1024 * 1024)).samples], [255, 0]);
}
assert.deepEqual((await Promise.all([0, 1].map(() => decodeBundledJbig2(request, 32 * 1024 * 1024))))
  .map(result => [...result.samples]), [[255, 0], [255, 0]]);
assert.deepEqual(encoded, beforeEncoded); assert.deepEqual(globals, beforeGlobals);
assert.deepEqual(originalPdfium(encoded, globals, 8, 2), Uint8Array.of(255, 0));
assert.deepEqual(originalPdfium(tall, new Uint8Array(), 1, 4096), recovered);

hooks.deregister();
console.log("PDFium JBIG2 passed: reproducible metered WASM, original parity, globals/headers, segment validation, caller heap/work limits, in-kernel abort, ownership and recovery.");

function originalPdfium(bytes, globals, width, height) {
  let wasm, output;
  const instance = new WebAssembly.Instance(new WebAssembly.Module(upstream), { a: {
    a: () => 0, b: size => { wasm.i.grow(Math.ceil(size / 65536) - wasm.i.buffer.byteLength / 65536); return 1; },
    c: () => { throw new Error("Unexpected exit"); }, d: () => {},
    e: () => { throw new Error("Unexpected abort"); }, f: () => {}, g: () => {},
    h: (ptr, pitch, padded, rows) => {
      output = new Uint8Array(pitch * rows);
      for (let row = 0; row < rows; row++) output.set(new Uint8Array(wasm.i.buffer, ptr + row * padded, pitch), row * pitch);
    }
  } });
  wasm = instance.exports; wasm.j();
  const pointer = wasm.k(bytes.length), globalsPointer = globals.length ? wasm.k(globals.length) : 0;
  new Uint8Array(wasm.i.buffer, pointer, bytes.length).set(bytes);
  if (globals.length) new Uint8Array(wasm.i.buffer, globalsPointer, globals.length).set(globals);
  wasm.m(pointer, bytes.length, width, height, globalsPointer, globals.length);
  assert.ok(output); return output;
}
