import assert from "node:assert/strict";

import { buildVectorStrokeLodScenes } from "../src/vectorStrokeLodCore.ts";

const segmentsPerClip = 20;
const segmentCount = segmentsPerClip * 2;
const endpoints = new Float32Array(segmentCount * 4);
const primitiveMeta = new Float32Array(segmentCount * 4);
const primitiveBounds = new Float32Array(segmentCount * 4);
const styles = new Float32Array(segmentCount * 4);

for (let index = 0; index < segmentCount; index += 1) {
  const offset = index * 4;
  endpoints.set([-1, 0, 11, 0], offset);
  // alpha 1 + clipped flag (4) * packed-style offset 2.
  primitiveMeta.set([11, 0, 0, 9], offset);
  primitiveBounds.set(
    index < segmentsPerClip ? [0, -1, 5, 1] : [5, -1, 10, 1],
    offset
  );
  styles.set([0.5, 0, 0, 0], offset);
}

const scene = {
  segmentCount,
  endpoints,
  primitiveMeta,
  primitiveBounds,
  styles,
  bounds: { minX: 0, minY: -1, maxX: 10, maxY: 1 },
  maxHalfWidth: 0.5
};

const levels = buildVectorStrokeLodScenes(scene);
assert.ok(levels.length > 1, "the fixture must produce a simplified level");
const simplified = levels[1].scene;
assert.equal(simplified.segmentCount, 2);
assert.deepEqual(
  Array.from(simplified.primitiveBounds),
  [0, -1, 5, 1, 5, -1, 10, 1],
  "LOD merging must not widen two independently clipped paints into one clip"
);
for (let index = 0; index < simplified.segmentCount; index += 1) {
  assert.equal(Math.trunc(simplified.primitiveMeta[index * 4 + 3] / 2 + 1e-6) & 4, 4);
}

console.log("vector stroke clip LOD regression tests passed");
