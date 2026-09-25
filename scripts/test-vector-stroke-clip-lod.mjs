import assert from "node:assert/strict";

import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
const { buildVectorStrokeLodScenes, prebuildVectorStrokeLodRuntime } = await import("../src/vectorStrokeLodCore.ts");
const { strokePaintOrigins } = await import("../src/vectorStrokePaintOrder.ts");
hooks.deregister();

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

// Detail geometry must reach the antialiasing shader at every zoom. Previous
// LOD levels deleted short strokes outright; sending them through interval
// merging instead would bridge dash gaps and collapse neighbouring marks.
const backgroundCount = 128;
const details = [
  { a: [5, 40, 5.1, 40], b: [5.1, 40, 0, 1], width: .002 },
  { a: [5.2, 40, 5.3, 40], b: [5.3, 40, 0, 1], width: .002 },
  { a: [6, 40, 6.1, 40], b: [6.1, 40, 0, 3], width: 0 },
  { a: [6, 40.05, 6.1, 40.05], b: [6.1, 40.05, 0, 3], width: 0 },
  { a: [7, 40, 7.1, 40.2], b: [7.2, 40, 1, 1], width: .01 },
  { a: [8, 40, 8, 40], b: [8, 40, 0, 7], width: 0 },
  { a: [0, 40, 1e-7, 40], b: [1e-7, 40, 0, 1], width: .5 },
  { a: [10, 40, 10.01, 40], b: [10.01, 40, 0, 11], width: 0,
    clip: [-10, -10, 110, 60] },
  // Long, thin parallel hatches share one paint group and the same overview
  // tolerance bucket. They must retain two widths of ink instead of one.
  { a: [0, 45, 100, 45], b: [100, 45, 0, 1], width: .01 },
  { a: [0, 45.05, 100, 45.05], b: [100, 45.05, 0, 1], width: .01 },
  { a: [0, 48, 100, 48], b: [100, 48, 0, 1], width: .00001 },
  { a: [0, 48, 100, 48], b: [100, 48, 0, 1], width: .00002 }
];
const detailCount = backgroundCount + details.length;
const detailScene = {
  segmentCount: detailCount, maxHalfWidth: .5,
  bounds: { minX: -10, minY: -10, maxX: 110, maxY: 60 },
  drawRuns: [{ kind: "stroke", first: 0, count: detailCount }],
  endpoints: new Float32Array(detailCount * 4), primitiveMeta: new Float32Array(detailCount * 4),
  primitiveBounds: new Float32Array(detailCount * 4), styles: new Float32Array(detailCount * 4)
};
for (let index = 0; index < detailCount; index++) {
  const y = (index % 8) * 2.5;
  const detail = details[index - backgroundCount] ?? {
    a: [0, y, 100, y], b: [100, y, 0, 1], width: .5
  };
  const [x0, y0, cx, cy] = detail.a, [x1, y1] = detail.b;
  detailScene.endpoints.set(detail.a, index * 4);
  detailScene.primitiveMeta.set(detail.b, index * 4);
  detailScene.styles.set([detail.width, 0, 0, 0], index * 4);
  detailScene.primitiveBounds.set(detail.clip ?? [Math.min(x0, cx, x1), Math.min(y0, cy, y1),
    Math.max(x0, cx, x1), Math.max(y0, cy, y1)], index * 4);
}
const original = structuredClone(detailScene);
const detailLevels = buildVectorStrokeLodScenes(detailScene);
assert(detailLevels.length >= 2, "long collinear strokes still build a simplified LOD level");
const assertDetails = level => {
  const origins = strokePaintOrigins(level.scene);
  for (let source = backgroundCount; source < detailCount; source++) {
    const output = origins.indexOf(source);
    assert(output >= 0, `LOD ${level.tolerance} preserves detail stroke ${source - backgroundCount}`);
    for (const field of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) {
      assert.deepEqual(level.scene[field].slice(output * 4, output * 4 + 4),
        detailScene[field].slice(source * 4, source * 4 + 4),
        `LOD ${level.tolerance} preserves exact detail-stroke ${field}`);
    }
  }
};
for (const level of detailLevels) assertDetails(level);
assert(detailLevels.at(-1).scene.segmentCount < detailCount / 2,
  "preserving small marks retains useful simplification of longer strokes");
const runtime = await prebuildVectorStrokeLodRuntime(detailScene, "force", "webgl", { yieldIntervalMs: 1 });
assert.deepEqual(runtime.levels.map(level => level.tolerance), detailLevels.map(level => level.tolerance));
for (let index = 0; index < runtime.levels.length; index++) {
  assertDetails(runtime.levels[index]);
  for (const field of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) {
    assert.deepEqual(runtime.levels[index].scene[field], detailLevels[index].scene[field],
      "cooperative and synchronous LOD builders preserve the same geometry");
  }
}
runtime.setScreenSpaceTransform();
for (const unitsPerPixel of [.01, .4, .8, 1.6, 3.2, 6.4, 12.8, 25.6, 100]) {
  runtime.updateForLocalUnitsPerPixel(unitsPerPixel);
  runtime.update({ cameraCenterX: 50, cameraCenterY: 25, zoom: 1 / unitsPerPixel },
    { width: 20_000, height: 10_000 });
  const visibleOrigins = new Set(runtime.levels.flatMap(level => {
    const origins = strokePaintOrigins(level.scene);
    return Array.from(level.visibleSegmentIds.subarray(0, level.visibleSegmentCount), index => origins[index]);
  }));
  for (let source = backgroundCount; source < detailCount; source++) {
    assert(visibleOrigins.has(source), `zoom ${1 / unitsPerPixel} retains detail-stroke coverage`);
  }
}
assert.deepEqual(detailScene, original, "LOD preserves the canonical source geometry");
console.log("Vector stroke LOD preserves clips, short details, thin hatch density, async parity and exact source geometry.");
