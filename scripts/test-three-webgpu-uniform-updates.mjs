import assert from "node:assert/strict";
import { installThreeWebGpuUniformUpdates } from "../src/threeWebGpuUniformUpdates.ts";

let active = false;
const writes = [], originalCalls = [];
const backend = {
  isWebGPUBackend: true,
  device: { queue: { writeBuffer(...args) { writes.push(args); } } },
  get(binding) { assert.equal(this, backend); return binding.gpu; },
  updateBinding(...args) { originalCalls.push({ receiver: this, args }); return "original"; }
};
const original = backend.updateBinding;
const restore = installThreeWebGpuUniformUpdates(backend, () => active);
assert.ok(restore);
const binding = {
  isUniformBuffer: true, buffer: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]), byteLength: 32,
  gpu: { buffer: { size: 32, usage: 72, mapState: "unmapped" } },
  updateRanges: [{ start: 0, count: 2 }, { start: 6, count: 2 }]
};
assert.equal(backend.updateBinding(binding), "original", "updates outside the compositor keep Three's original method");
active = true;
backend.updateBinding(binding);
assert.equal(writes.length, 1);
assert.deepEqual(writes[0], [binding.gpu.buffer, 0, binding.buffer, 0],
  "one whole uniform upload includes unchanged fields between changed ranges");
assert.deepEqual(binding.updateRanges, [{ start: 0, count: 2 }, { start: 6, count: 2 }],
  "Three retains ownership of clearing its update ranges");

let layoutReads = 0;
const lazyLayout = { ...binding, get byteLength() {
  layoutReads++;
  throw new Error("uniform layout must not be recalculated during an upload");
} };
backend.updateBinding(lazyLayout);
assert.equal(layoutReads, 0, "the upload checks allocated buffer sizes without reading Three's layout getter");
assert.deepEqual(writes[1], [binding.gpu.buffer, 0, binding.buffer, 0]);

// Only known CPU-authoritative uniform layouts use the faster path. Preserve
// original validation and upload behavior for every unsupported case.
for (const change of [
  { isUniformBuffer: false }, { isStorageBuffer: true },
  { buffer: new Uint32Array(8) }, { buffer: new Float32Array(0), byteLength: 0 },
  { updateRanges: [] }, { updateRanges: [{ start: 0, count: 1 }] },
  { updateRanges: [{ start: -1, count: 1 }, { start: 6, count: 2 }] },
  { updateRanges: [{ start: 0, count: 0 }, { start: 6, count: 2 }] },
  { updateRanges: [{ start: 0, count: 1.5 }, { start: 6, count: 2 }] },
  { updateRanges: [{ start: 0.5, count: 1 }, { start: 6, count: 2 }] },
  { updateRanges: [{ start: 0, count: 4 }, { start: 2, count: 2 }] },
  { updateRanges: [{ start: 6, count: 2 }, { start: 0, count: 2 }] },
  { updateRanges: [{ start: 0, count: 1 }, { start: 7, count: 2 }] },
  { updateRanges: [{ start: 0, count: 1 }, null] },
  { gpu: { buffer: { size: 16, usage: 72, mapState: "unmapped" } } },
  { gpu: { buffer: { size: 32, usage: 136, mapState: "unmapped" } } },
  { gpu: { buffer: { size: 32, usage: 72, mapState: "mapped" } } },
  { gpu: {} },
  { buffer: new Float32Array(16388), byteLength: 65552,
    gpu: { buffer: { size: 65552, usage: 72, mapState: "unmapped" } } }
]) {
  const candidate = { ...binding, ...change };
  assert.equal(backend.updateBinding(candidate), "original", JSON.stringify(change));
  assert.equal(originalCalls.at(-1).receiver, backend);
  assert.equal(originalCalls.at(-1).args[0], candidate);
}
assert.equal(writes.length, 2, "fallbacks never replace Three's own updates");
const borrowed = { name: "borrowed receiver" };
assert.equal(backend.updateBinding.call(borrowed, binding), "original");
assert.equal(originalCalls.at(-1).receiver, borrowed, "borrowed methods retain the caller's receiver");
assert.equal(backend.updateBinding(binding, "extension"), "original", "extended method signatures retain Three's method");
restore(); restore();
assert.equal(backend.updateBinding, original);
assert.equal(backend.updateBinding(binding), "original");

const inherited = Object.create(backend);
const inheritedRestore = installThreeWebGpuUniformUpdates(inherited, () => false);
assert.ok(inheritedRestore);
inheritedRestore();
assert.equal(Object.hasOwn(inherited, "updateBinding"), false, "dispose restores inherited methods");
const changedRestore = installThreeWebGpuUniformUpdates(backend, () => false);
const replacement = () => "later wrapper";
backend.updateBinding = replacement;
changedRestore();
assert.equal(backend.updateBinding, replacement, "dispose preserves a later host method replacement");
for (const unsupported of [null, {}, { isWebGPUBackend: false }, Object.freeze({
  isWebGPUBackend: true, get() {}, updateBinding() {}
})]) assert.equal(installThreeWebGpuUniformUpdates(unsupported, () => true), null);
console.log("Three WebGPU uniform updates: bounded CPU buffers, byte ranges, fallback and disposal passed");
