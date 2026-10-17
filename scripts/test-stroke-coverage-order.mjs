import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

const { compileDensePdfContent: compileNative } = await import("../src/pdf/nativeContentCompiler.ts");

const nativeSort = Array.prototype.sort;
const options = {
  output: "geometry",
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
  const native = await compileNative(content, options);
  assert.ok(native.discardedContainedCount > 0, "fixture must exercise containment culling");
  try {
    Array.prototype.sort = insertionSort;
    assertGeometryEqual(await compileNative(content, options), native, `sort parity, seed ${seed}`);
  } finally {
    Array.prototype.sort = nativeSort;
  }
}

console.log("Stroke containment ordering is consistent across sorting algorithms.");
hooks.deregister();
