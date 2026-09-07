import assert from "node:assert/strict";

import { compileDensePdfContent as compileDense } from "../src/densePdfContentCompiler.ts";
import { compileDensePdfContent as compileNative } from "../src/pdf/nativeContentCompiler.ts";

const nativeSort = Array.prototype.sort;
const options = {
  pageMatrix: [1, 0, 0, 1, 0, 0],
  pageBounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
  enableSegmentMerge: true,
  enableInvisibleCull: true,
  yieldIntervalMs: 1000
};

// A second valid stable sort makes ordering dependence reproducible without
// requiring another browser. With the old epsilon comparator, seed 1 kept two
// strokes under Node's native sort and one under insertion sort.
function insertionSort(compare) {
  if (!compare) return nativeSort.call(this);
  for (let index = 1; index < this.length; index += 1) {
    const value = this[index];
    let destination = index;
    while (destination > 0 && compare(this[destination - 1], value) > 0) {
      this[destination] = this[destination - 1];
      destination -= 1;
    }
    this[destination] = value;
  }
  return this;
}

function assertGeometryEqual(actual, expected, context) {
  for (const field of ["segmentCount", "discardedContainedCount", "discardedDuplicateCount",
    "endpoints", "primitiveMeta", "primitiveBounds", "styles"]) {
    assert.deepEqual(actual[field], expected[field], `${context}: ${field}`);
  }
}

for (let seed = 1; seed <= 30; seed += 1) {
  let state = seed;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const commands = [];
  for (let index = 0; index < 80; index += 1) {
    const start = Math.floor(random() * 80) / 1000;
    const end = 10 + Math.floor(random() * 100) / 1000;
    const width = 1 + Math.floor(random() * 3) * 0.00015;
    commands.push(`${width} w ${start} 0 m ${end} 0 l S`);
  }
  const content = new TextEncoder().encode(commands.join("\n"));
  const dense = await compileDense(content, options);
  const native = await compileNative(content, options);
  assert.ok(dense.discardedContainedCount > 0, "fixture must exercise containment culling");
  assertGeometryEqual(native, dense, `parser parity, seed ${seed}`);
  try {
    Array.prototype.sort = insertionSort;
    assertGeometryEqual(await compileDense(content, options), dense, `dense sort parity, seed ${seed}`);
    assertGeometryEqual(await compileNative(content, options), native, `native sort parity, seed ${seed}`);
  } finally {
    Array.prototype.sort = nativeSort;
  }
}

console.log("Stroke containment ordering is consistent across sorting algorithms and parser paths.");
