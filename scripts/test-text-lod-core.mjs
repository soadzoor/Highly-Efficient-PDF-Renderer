import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";

import {
  buildTextLod,
  buildTextLodAsync,
  createTextLodCombinedPayload,
  TEXT_LOD_MAX_CLUSTER_AREA_RATIO,
  TEXT_LOD_MAX_CLUSTER_GLYPHS,
  TEXT_LOD_MAX_CLUSTER_RUNS
} from "../src/textGreekLod.ts";
import {
  analyzePlanarBoundsProjection,
  createOrthographicLocalToClip,
  largestSingularValue2x2
} from "../src/planarProjection.ts";

// Node's type-stripper intentionally does not add extension resolution. Load
// the core through a data URL whose two runtime imports are explicit file URLs,
// keeping this focused test runnable without a dev server or third-party loader.
const corePath = new URL("../src/textLodCore.ts", import.meta.url);
const projectionPath = new URL("../src/planarProjection.ts", import.meta.url);
const greekPath = new URL("../src/textGreekLod.ts", import.meta.url);
const coreSource = (await readFile(corePath, "utf8"))
  .replaceAll('"./planarProjection"', JSON.stringify(pathToFileURL(projectionPath.pathname).href))
  .replaceAll('"./textGreekLod"', JSON.stringify(pathToFileURL(greekPath.pathname).href));
const coreModule = await import(
  `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(coreSource, {mode: "strip"})).toString("base64")}`
);
const {
  getOrBuildTextLod,
  prebuildTextLod,
  TEXT_LOD_COARSE_ENTER_PX,
  TEXT_LOD_EXACT_ENTER_PX,
  TextLodRuntime
} = coreModule;

const scene = createDenseTextScene();
const syncBuildStartedAt = performance.now();
const result = buildTextLod(scene);
const syncBuildElapsedMs = performance.now() - syncBuildStartedAt;
assert.equal(result.fallbackReason, null);
assert.ok(result.data);
assert.ok(result.buildTimeMs > 0);
assert.ok(result.buildTimeMs <= syncBuildElapsedMs + 1);
assert.ok(syncBuildElapsedMs - result.buildTimeMs < 5, "sync timing must include hierarchy finalization and array trims");
const data = result.data;

const cancelled = new AbortController();
cancelled.abort();
await assert.rejects(
  buildTextLodAsync(scene, {signal: cancelled.signal}),
  (error) => error?.name === "TextLodBuildCancelledError"
);
const progressValues = [];
const asyncBuildStartedAt = performance.now();
const asyncResult = await buildTextLodAsync(scene, {
  yieldIntervalMs: 1,
  onProgress: ({value}) => progressValues.push(value)
});
const asyncBuildElapsedMs = performance.now() - asyncBuildStartedAt;
assert.ok(asyncResult.data);
assert.ok(asyncResult.buildTimeMs > 0);
assert.ok(asyncResult.buildTimeMs <= asyncBuildElapsedMs + 1);
assert.ok(asyncBuildElapsedMs - asyncResult.buildTimeMs < 5, "async timing must include cooperative finalization");
assert.equal(progressValues.at(-1), 1);
assert.ok(progressValues.every((value, index) => index === 0 || value >= progressValues[index - 1]));

let reachedHierarchy = false;
let cancelHierarchy = false;
await assert.rejects(
  buildTextLodAsync(scene, {
    yieldIntervalMs: 1,
    shouldCancel: () => cancelHierarchy,
    onProgress: ({message}) => {
      if (message === "Clustering Text LOD hierarchy") {
        reachedHierarchy = true;
        cancelHierarchy = true;
      }
    }
  }),
  (error) => error?.name === "TextLodBuildCancelledError"
);
assert.equal(reachedHierarchy, true, "cancellation must remain observable during hierarchy construction");

assert.equal(data.exactInstanceCount, scene.textInstanceCount);
assert.ok(data.coarseInstanceCount > 0);
assert.ok(data.coarseInstanceCount < scene.textInstanceCount * 0.7);
assert.equal(data.combinedInstanceCount, data.exactInstanceCount + data.coarseInstanceCount);

let sourceCursor = 0;
for (const run of data.runs) {
  assert.equal(run.exactStart, sourceCursor, "runs must partition source instances without gaps");
  assert.ok(run.exactCount > 0);
  sourceCursor += run.exactCount;
  assert.equal(run.pageIndex, 0);
  assert.ok(Object.isFrozen(run));
}
assert.equal(sourceCursor, scene.textInstanceCount);
assert.ok(data.runs.some((run) => !run.eligible && run.exactStart <= 1000 && run.exactStart + run.exactCount > 1000));

const rtlRun = data.runs.find((run) => run.exactStart === 100);
assert.ok(rtlRun?.eligible, "RTL origins should form an eligible run");
assert.equal(rtlRun.exactCount, 100);
const resetRun = data.runs.find((run) => run.exactStart === 200);
assert.equal(resetRun?.exactCount, 50, "a backwards column reset must flush the LTR run");
const nextColumnRun = data.runs.find((run) => run.exactStart === 250);
assert.equal(nextColumnRun?.exactCount, 50);
const rotatedRun = data.runs.find((run) => run.exactStart === 400);
assert.equal(rotatedRun?.exactCount, 100, "rotated baselines should merge in run-local space");

for (const cluster of data.clusters) {
  assert.ok(cluster.exactCount <= TEXT_LOD_MAX_CLUSTER_GLYPHS);
  assert.ok(cluster.coarseCount <= TEXT_LOD_MAX_CLUSTER_RUNS);
  assert.equal(cluster.pageIndex, 0);
  const members = data.runs.slice(cluster.runStart, cluster.runStart + cluster.runCount);
  const summedArea = members.reduce((sum, run) => sum + area(run.bounds), 0);
  assert.ok(
    cluster.runCount === 1 || area(cluster.bounds) <= Math.max(1e-9, summedArea) * TEXT_LOD_MAX_CLUSTER_AREA_RATIO + 1e-4
  );
}
assert.equal(data.pages.length, 1);
assert.equal(data.pages[0].clusterCount, data.clusters.length);
assert.equal(data.pages[0].eligible, false, "the exact-only malformed glyph makes its page ineligible for bulk coarse selection");
assert.ok(data.pages[0].bounds.maxX >= Math.max(...data.clusters.map((cluster) => cluster.bounds.maxX)));

const combined = createTextLodCombinedPayload(scene, data);
assert.equal(combined.scene.textInstanceCount, data.combinedInstanceCount);
assert.equal(combined.scene.textGlyphCount, scene.textGlyphCount + 1);
assert.equal(combined.scene.textGlyphSegmentCount, scene.textGlyphSegmentCount + 4);
assert.deepEqual(
  combined.scene.textInstanceA.slice(0, scene.textInstanceA.length),
  scene.textInstanceA,
  "the exact prefix must remain byte-for-byte unchanged"
);
for (let i = 0; i < data.coarseInstanceCount; i += 1) {
  assert.equal(combined.scene.textInstanceB[(data.exactInstanceCount + i) * 4 + 2], data.solidGlyphIndex);
}

assert.equal(largestSingularValue2x2(3, 0, 0, 2), 3);
assert.ok(Math.abs(largestSingularValue2x2(1, 2, 3, 4) - 5.464985704219043) < 1e-12);
const affineBounds = {minX: -1, minY: -2, maxX: 3, maxY: 4};
const affineMatrix = new Float64Array([
  0.02, 0, 0, 0,
  0, 0.04, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
]);
const affineProjection = analyzePlanarBoundsProjection(affineBounds, affineMatrix, {width: 100, height: 100});
assert.equal(affineProjection.stable, true);
assert.ok(Math.abs(affineProjection.maxPixelsPerLocalUnit - 2) < 1e-12);

const perspectiveMatrix = new Float64Array([
  0.02, 0, 0, 0,
  0.08, 0.03, 0, 0.01,
  0, 0, 1, 0,
  0, 0, 0, 1
]);
const nearBounds = {minX: 0, minY: 0, maxX: 10, maxY: 10};
const farBounds = {minX: 0, minY: 60, maxX: 10, maxY: 70};
const nearProjection = analyzePlanarBoundsProjection(nearBounds, perspectiveMatrix, {width: 1000, height: 800});
const farProjection = analyzePlanarBoundsProjection(farBounds, perspectiveMatrix, {width: 1000, height: 800});
assert.ok(nearProjection.maxPixelsPerLocalUnit > farProjection.maxPixelsPerLocalUnit);
assertConservativeAgainstSamples(nearBounds, perspectiveMatrix, {width: 1000, height: 800}, nearProjection.maxPixelsPerLocalUnit);
assertConservativeAgainstSamples(farBounds, perspectiveMatrix, {width: 1000, height: 800}, farProjection.maxPixelsPerLocalUnit);

// Regression: the numerator coefficient for d/dy is m4/m5, not m0/m1.
const yDerivativeDominant = new Float64Array([
  0.001, 0, 0, 0.002,
  0.3, 0.2, 0, 0.015,
  0, 0, 1, 0,
  0, 0, 0, 1
]);
const yDominantProjection = analyzePlanarBoundsProjection(
  {minX: 0, minY: 0, maxX: 8, maxY: 8},
  yDerivativeDominant,
  {width: 1600, height: 900}
);
assertConservativeAgainstSamples(
  {minX: 0, minY: 0, maxX: 8, maxY: 8},
  yDerivativeDominant,
  {width: 1600, height: 900},
  yDominantProjection.maxPixelsPerLocalUnit
);

const crossingMatrix = perspectiveMatrix.slice();
crossingMatrix[7] = 1;
crossingMatrix[15] = 0;
const crossing = analyzePlanarBoundsProjection(
  {minX: -1, minY: -1, maxX: 1, maxY: 1}, crossingMatrix, {width: 100, height: 100}
);
assert.equal(crossing.stable, false);
assert.equal(crossing.maxPixelsPerLocalUnit, Number.POSITIVE_INFINITY);
const behindEyeMatrix = new Float64Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, -1
]);
const behindEye = analyzePlanarBoundsProjection(
  {minX: -1, minY: -1, maxX: 1, maxY: 1},
  behindEyeMatrix,
  {width: 100, height: 100}
);
assert.equal(behindEye.stable, true);
assert.equal(behindEye.visible, false, "bounds wholly behind the eye are safely culled by clip W alone");
assert.equal(behindEye.maxPixelsPerLocalUnit, 0);
const offscreen = analyzePlanarBoundsProjection(
  {minX: 10, minY: 0, maxX: 11, maxY: 1},
  new Float64Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ]),
  {width: 100, height: 100}
);
assert.equal(offscreen.visible, false);

const runtime = new TextLodRuntime(result);
const viewportWidth = 2000;
const viewportHeight = 2000;
const centerX = 500;
const centerY = 500;
const atCoarseThreshold = runtime.update({
  localToClip: createOrthographicLocalToClip(centerX, centerY, TEXT_LOD_COARSE_ENTER_PX, viewportWidth, viewportHeight),
  viewportWidth,
  viewportHeight
});
assert.ok(atCoarseThreshold.stats.coarseClusters > 0);
assert.ok(atCoarseThreshold.stats.exactClusters > 0, "exact-only malformed data must remain exact");
assert.equal(new Set(atCoarseThreshold.instanceIds).size, atCoarseThreshold.instanceIds.length);
assertSourceOrdered(atCoarseThreshold.instanceIds, data);

const inHysteresisBand = runtime.update({
  localToClip: createOrthographicLocalToClip(centerX, centerY, 0.6, viewportWidth, viewportHeight),
  viewportWidth,
  viewportHeight
});
assert.equal(inHysteresisBand.stats.coarseClusters, atCoarseThreshold.stats.coarseClusters);
assert.strictEqual(
  inHysteresisBand.instanceIds,
  atCoarseThreshold.instanceIds,
  "a hysteresis-stable camera update must reuse the selected ID array"
);
const unchanged = runtime.update({
  localToClip: createOrthographicLocalToClip(centerX, centerY, 0.6, viewportWidth, viewportHeight),
  viewportWidth,
  viewportHeight
});
assert.equal(unchanged.changed, false);
assert.equal(unchanged.stats.selectionUploads, inHysteresisBand.stats.selectionUploads);
assert.strictEqual(
  unchanged.instanceIds,
  inHysteresisBand.instanceIds,
  "an identical frame must not replace or reallocate the selected ID array"
);

const exactInputRuntime = new TextLodRuntime(result);
const exactInputMatrixValues = createOrthographicLocalToClip(
  centerX,
  centerY,
  0.6,
  viewportWidth,
  viewportHeight
);
let matrixElementReads = 0;
const trackedMatrix = {length: 16};
for (let i = 0; i < 16; i += 1) {
  Object.defineProperty(trackedMatrix, i, {
    get() {
      matrixElementReads += 1;
      return exactInputMatrixValues[i];
    }
  });
}
const trackedFirst = exactInputRuntime.update({
  localToClip: trackedMatrix,
  viewportWidth,
  viewportHeight
});
assert.ok(matrixElementReads > 16, "the initial update should traverse projected page/cluster bounds");
matrixElementReads = 0;
const trackedSecond = exactInputRuntime.update({
  localToClip: trackedMatrix,
  viewportWidth,
  viewportHeight
});
assert.equal(matrixElementReads, 16, "an exact-input match should skip projection traversal");
assert.strictEqual(trackedSecond.instanceIds, trackedFirst.instanceIds);
assert.equal(trackedSecond.changed, false);
exactInputRuntime.dispose();

const exactAgain = runtime.update({
  localToClip: createOrthographicLocalToClip(centerX, centerY, TEXT_LOD_EXACT_ENTER_PX, viewportWidth, viewportHeight),
  viewportWidth,
  viewportHeight
});
assert.equal(exactAgain.stats.coarseClusters, 0);
assert.equal(exactAgain.stats.renderedGlyphs, scene.textInstanceCount);
const exactAgainStable = runtime.update({
  localToClip: createOrthographicLocalToClip(centerX, centerY, 0.8, viewportWidth, viewportHeight),
  viewportWidth,
  viewportHeight
});
assert.equal(exactAgainStable.changed, false);
assert.strictEqual(
  exactAgainStable.instanceIds,
  exactAgain.instanceIds,
  "the all-exact identity fast path must stay allocation-free while decisions are clean"
);

runtime.update({
  localToClip: createOrthographicLocalToClip(centerX, centerY, 0.4, viewportWidth, viewportHeight),
  viewportWidth,
  viewportHeight
});
runtime.setMode("off");
assert.equal(runtime.getStats().mode, "off");
runtime.setMode("auto");
const resetHysteresis = runtime.update({
  localToClip: createOrthographicLocalToClip(centerX, centerY, 0.6, viewportWidth, viewportHeight),
  viewportWidth,
  viewportHeight
});
assert.equal(resetHysteresis.stats.coarseClusters, 0, "Off must reset coarse hysteresis state to exact");

const retentionRuntime = new TextLodRuntime(result);
const beforeCulling = retentionRuntime.update({
  localToClip: createOrthographicLocalToClip(centerX, centerY, 0.4, viewportWidth, viewportHeight),
  viewportWidth,
  viewportHeight
});
const retainedCoarseCount = beforeCulling.stats.coarseClusters;
assert.ok(retainedCoarseCount > 0);
const fullyCulled = retentionRuntime.update({
  localToClip: createOrthographicLocalToClip(centerX, centerY, 0.6, viewportWidth, viewportHeight),
  viewportWidth,
  viewportHeight,
  cullingBounds: {minX: 10_000, minY: 10_000, maxX: 10_001, maxY: 10_001}
});
assert.equal(fullyCulled.stats.visibleClusters, 0);
const afterCulling = retentionRuntime.update({
  localToClip: createOrthographicLocalToClip(centerX, centerY, 0.6, viewportWidth, viewportHeight),
  viewportWidth,
  viewportHeight
});
assert.equal(afterCulling.stats.coarseClusters, retainedCoarseCount, "offscreen cluster hysteresis state must be retained");
retentionRuntime.dispose();

runtime.setResourceFallback("resource-capacity");
const unavailable = runtime.update({
  localToClip: createOrthographicLocalToClip(centerX, centerY, 0.4, viewportWidth, viewportHeight),
  viewportWidth,
  viewportHeight
});
assert.equal(unavailable.stats.available, false);
assert.equal(unavailable.stats.fallbackReason, "resource-capacity");
assert.equal(unavailable.instanceIds.length, 0);
runtime.dispose();

const cachedResult = getOrBuildTextLod(scene);
assert.equal(getOrBuildTextLod(scene), cachedResult, "sync builds must be shared by scene identity");
assert.equal(await prebuildTextLod(scene), cachedResult, "async prebuild must reuse the completed WeakMap entry");

const capacityScene = {...scene};
Object.defineProperty(capacityScene, "textGlyphCount", {
  get() {
    throw new RangeError("Array buffer allocation failed");
  }
});
const capacityFallback = getOrBuildTextLod(capacityScene);
assert.equal(capacityFallback.data, null);
assert.equal(capacityFallback.fallbackReason, "resource-capacity");
assert.strictEqual(getOrBuildTextLod(capacityScene), capacityFallback);
assert.strictEqual(
  await prebuildTextLod(capacityScene),
  capacityFallback,
  "resource-capacity must be cached instead of retrying or aborting load"
);

const asyncCapacityScene = {...scene};
Object.defineProperty(asyncCapacityScene, "textGlyphCount", {
  get() {
    throw new RangeError("Invalid typed array length: 999999999999");
  }
});
const asyncCapacityFallback = await buildTextLodAsync(asyncCapacityScene);
assert.equal(asyncCapacityFallback.data, null);
assert.equal(asyncCapacityFallback.fallbackReason, "resource-capacity");

const programmingErrorScene = {...scene};
Object.defineProperty(programmingErrorScene, "textGlyphCount", {
  get() {
    throw new RangeError("Offset is outside the bounds of the DataView");
  }
});
assert.throws(
  () => buildTextLod(programmingErrorScene),
  /Offset is outside the bounds/,
  "unrelated programming RangeErrors must not be hidden as optional-resource fallback"
);

console.log("text LOD core tests passed");

function createDenseTextScene(instanceCount = 50_000) {
  const textInstanceA = new Float32Array(instanceCount * 4);
  const textInstanceB = new Float32Array(instanceCount * 4);
  const textInstanceC = new Float32Array(instanceCount * 4);
  for (let i = 0; i < instanceCount; i += 1) {
    const line = Math.floor(i / 100);
    const column = i % 100;
    let a = 1;
    let b = 0;
    let c = 0;
    let d = 1;
    let originX = column * 1.1;
    let originY = line * 2;
    if (line === 1) originX = (99 - column) * 1.1;
    if (line === 2 && column >= 50) originX = (column - 50) * 1.1;
    if (line === 3 && column >= 50) originX += 500;
    if (line === 4) {
      a = 0;
      b = 1;
      c = -1;
      d = 0;
      originX = 400;
      originY = column * 1.1;
    }
    if (i === 1000) {
      a = 0;
      d = 0;
    }
    const offset = i * 4;
    textInstanceA.set([a, b, c, d], offset);
    textInstanceB.set([originX, originY, 0, 0], offset);
    textInstanceC.set([0.1, 0.1, 0.1, 1], offset);
  }
  return {
    pageCount: 1,
    pageRects: new Float32Array([-1000, -1000, 2000, 2000]),
    pageTextRanges: new Uint32Array([0, instanceCount]),
    textIndex: null,
    textInstanceCount: instanceCount,
    textInstanceA,
    textInstanceB,
    textInstanceC,
    textGlyphCount: 1,
    textGlyphSegmentCount: 4,
    textGlyphMetaA: new Float32Array([0, 4, 0, 0]),
    textGlyphMetaB: new Float32Array([1, 1, 0, 0]),
    textGlyphSegmentsA: new Float32Array([
      0, 0, 0, 0,
      1, 0, 0, 0,
      1, 1, 0, 0,
      0, 1, 0, 0
    ]),
    textGlyphSegmentsB: new Float32Array([
      1, 0, 0, 0,
      1, 1, 0, 0,
      0, 1, 0, 0,
      0, 0, 0, 0
    ]),
    textGlyphCountBeforeLod: 1,
    bounds: {minX: -1000, minY: -1000, maxX: 2000, maxY: 2000},
    pageBounds: {minX: -1000, minY: -1000, maxX: 2000, maxY: 2000},
    textGlyphSegmentCountBeforeLod: 4
  };
}

function area(bounds) {
  return Math.max(0, bounds.maxX - bounds.minX) * Math.max(0, bounds.maxY - bounds.minY);
}

function assertSourceOrdered(ids, data) {
  let previousSourceStart = -1;
  for (const id of ids) {
    const sourceStart = id < data.exactInstanceCount
      ? id
      : data.runs.find((run) => run.coarseIndex === id - data.exactInstanceCount)?.exactStart;
    assert.notEqual(sourceStart, undefined);
    assert.ok(sourceStart >= previousSourceStart);
    previousSourceStart = sourceStart;
  }
}

function assertConservativeAgainstSamples(bounds, matrix, viewport, bound) {
  let sampledMaximum = 0;
  for (let yi = 0; yi <= 10; yi += 1) {
    const y = bounds.minY + (bounds.maxY - bounds.minY) * yi / 10;
    for (let xi = 0; xi <= 10; xi += 1) {
      const x = bounds.minX + (bounds.maxX - bounds.minX) * xi / 10;
      sampledMaximum = Math.max(sampledMaximum, exactPixelJacobianSigma(x, y, matrix, viewport));
    }
  }
  assert.ok(bound + 1e-9 >= sampledMaximum, `${bound} must conservatively bound sampled ${sampledMaximum}`);
}

function exactPixelJacobianSigma(x, y, matrix, viewport) {
  const X = matrix[0] * x + matrix[4] * y + matrix[12];
  const Y = matrix[1] * x + matrix[5] * y + matrix[13];
  const W = matrix[3] * x + matrix[7] * y + matrix[15];
  const w2 = W * W;
  const a = (matrix[0] * W - X * matrix[3]) / w2 * viewport.width * 0.5;
  const c = (matrix[4] * W - X * matrix[7]) / w2 * viewport.width * 0.5;
  const b = (matrix[1] * W - Y * matrix[3]) / w2 * viewport.height * 0.5;
  const d = (matrix[5] * W - Y * matrix[7]) / w2 * viewport.height * 0.5;
  return largestSingularValue2x2(a, b, c, d);
}
