import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
try {
  const { MixedVectorBatches } = await import("../src/mixedVectorBatches.ts");
  const { VectorOrderedBatches } = await import("../src/vectorOrderedBatches.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const indirect = (kind, first, count, extra = {}) => ({ kind, first, count, clipIndex: -2, ...extra });
  const plan = (batches, instances, segments = []) => ({ batches, uintInstances: Uint32Array.from(instances.flat()),
    batchSegments: segments, revision: 1, coverageRevision: 1 });
  const mixed = new MixedVectorBatches();
  const source = plan([indirect("stroke", 2, 2), indirect("fill", 0, 2), indirect("stroke", 4, 1)],
    [[11, 0], [7, 4], [29, 2], [3, 0], [19, 9]]);
  assert.equal(mixed.update(source), true);
  assert.deepEqual(mixed.batches, [{ kind: "mixed-vector", first: 0, count: 5,
    strokeCount: 3, fillCount: 2, clipIndex: -2 }]);
  assert.deepEqual([...mixed.floatInstances.subarray(0, mixed.instanceCount * 3)],
    [29, 2, 0, 3, 0, 0, 11, 0, 1, 7, 4, 1, 19, 9, 0],
    "sparse source ranges retain their IDs, per-instance clips and interleaved painter order");

  // Fractional edge coverage makes overlapping paints order-sensitive even with source alpha 1.
  const colors = new Map([["stroke:29", [1, 0, 0, .35]], ["stroke:3", [0, 1, 0, .7]],
    ["fill:11", [0, 0, 1, .6]], ["fill:7", [1, 1, 0, .4]], ["stroke:19", [1, 0, 1, .8]]]);
  const composite = records => records.reduce((pixel, [kind, id, clip]) => {
    if (clip === 4) return pixel; // This probe lies outside one instance's clip.
    const [r, g, b, alpha] = colors.get(`${kind}:${id}`);
    return [r, g, b].map((value, channel) => value * alpha + pixel[channel] * (1 - alpha));
  }, [1, 1, 1]);
  const expectedPaints = [["stroke", 29, 2], ["stroke", 3, 0], ["fill", 11, 0], ["fill", 7, 4], ["stroke", 19, 9]];
  const mixedPaints = Array.from({ length: mixed.instanceCount }, (_, index) => {
    const offset = index * 3, values = mixed.floatInstances;
    return [values[offset + 2] === 0 ? "stroke" : "fill", values[offset], values[offset + 1]];
  });
  assert.deepEqual(composite(mixedPaints), composite(expectedPaints), "mixed submission retains overlapping edge coverage");
  assert.notDeepEqual(composite([...expectedPaints].sort((a, b) => a[0].localeCompare(b[0]))),
    composite(expectedPaints), "the overlap probe detects unsafe separation into fill and stroke passes");

  const data = mixed.floatInstances, revision = mixed.revision;
  assert.equal(mixed.update(source), false, "unchanged plans reuse mixed data");
  assert.equal(mixed.floatInstances, data);
  assert.equal(mixed.revision, revision);
  source.uintInstances[4] = 31;
  source.revision++;
  assert.equal(mixed.update(source), true, "LOD or clip changes invalidate the cache without a coverage revision");
  assert.equal(mixed.floatInstances[0], 31);
  const replacement = { ...source, uintInstances: source.uintInstances.slice() };
  replacement.uintInstances[4] = 37;
  assert.equal(mixed.update(replacement), true, "another plan with the same revision must not reuse old records");
  assert.equal(mixed.floatInstances[0], 37);
  mixed.update(plan([indirect("stroke", 0, 1), indirect("fill", 1, 1)], [[16_777_217, 3], [16_777_219, 4]]));
  assert.deepEqual([...mixed.uintInstances.subarray(0, 6)], [16_777_217, 3, 0, 16_777_219, 4, 1],
    "WebGPU's integer stream retains IDs beyond float precision");
  assert.equal(mixed.floatInstances[0], Math.fround(16_777_217), "the optional float copy converts integer values for WebGL");

  // Each unsupported paint is a source-order barrier, including legacy Multiply's extra passes.
  const barriers = [indirect("text", 0, 1), { kind: "raster", first: 0, count: 1 },
    { kind: "gradient-fill", first: 0, count: 1 }, { kind: "gradient-stroke", first: 0, count: 1 },
    indirect("stroke", 0, 1, { blendMode: "Multiply" }), { kind: "fill", first: 0, count: 1, clipIndex: 2 }];
  for (const barrier of barriers) {
    const before = indirect("stroke", 0, 1), after = indirect("fill", 1, 1);
    mixed.update(plan([before, barrier, after], [[1, 0], [2, 1]]));
    assert.deepEqual(mixed.batches, [before, barrier, after], `${barrier.kind} barriers retain ordinary batch offsets`);
    assert.equal(mixed.instanceCount, 0);
  }
  const spanPlan = plan([indirect("stroke", 0, 1), indirect("fill", 1, 1),
    indirect("stroke", 2, 1), indirect("fill", 3, 1)], [[4, 0], [5, 1], [6, 2], [7, 0]], [3, 3, 4, 4]);
  mixed.update(spanPlan);
  assert.deepEqual(mixed.batches.map(run => [run.kind, run.first, run.count]),
    [["mixed-vector", 0, 2], ["mixed-vector", 2, 2]], "compositor spans remain separate submissions");
  assert.deepEqual(mixed.batchSegments, [3, 4]);
  mixed.update(plan([indirect("stroke", 0, 1), indirect("fill", 1, 1)], [[4, 0], [5, 1]], [3, 4]));
  assert.deepEqual(mixed.batches.map(run => run.kind), ["stroke", "fill"], "adjacent kinds cannot cross a span boundary");
  mixed.update(plan([], []));
  assert.equal(mixed.instanceCount, 0);
  assert.deepEqual(mixed.batches, [], "empty selections remove all previously mixed draws");

  // Exercise the actual ordered planner so indirect offsets and its revision contract stay compatible.
  const scene = { ...createEmptyVectorScene(), segmentCount: 2, fillPathCount: 1,
    endpoints: Float32Array.of(0, 0, 1, 1, 0, 1, 1, 0),
    primitiveMeta: Float32Array.of(1, 1, 0, 1, 1, 0, 0, 1),
    primitiveBounds: Float32Array.of(0, 0, 1, 1, 0, 0, 1, 1),
    styles: Float32Array.of(.1, 1, 0, 0, .1, 0, 1, 0),
    fillPathMetaA: Float32Array.of(0, 4, 0, 0), fillPathMetaB: Float32Array.of(1, 1, 0, 0),
    fillPathMetaC: Float32Array.of(0, 0, 1, 1),
    drawRuns: [{ kind: "stroke", first: 0, count: 1 }, { kind: "fill", first: 0, count: 1 },
      { kind: "stroke", first: 1, count: 1 }] };
  const ordered = new VectorOrderedBatches(scene, null);
  assert.equal(ordered.update(scene.drawRuns, 1), true);
  mixed.update(ordered);
  assert.equal(mixed.batches.length, 1, "interleaved ordered batches become one mixed draw");
  assert.deepEqual([...mixed.floatInstances.subarray(0, mixed.instanceCount * 3)], [0, 0, 0, 0, 0, 1, 1, 0, 0]);
  assert.equal(ordered.update(scene.drawRuns, 1), false);
  assert.equal(mixed.update(ordered), false);

  const denseCount = 4_096;
  const dense = plan(Array.from({ length: denseCount }, (_, index) =>
    indirect(index % 2 === 0 ? "stroke" : "fill", index, 1)),
    Array.from({ length: denseCount }, (_, index) => [index + 100, index % 5]));
  mixed.update(dense);
  assert.equal(mixed.batches.length, 1, "thousands of alternating paints require one mixed submission");
  assert.equal(mixed.instanceCount, denseCount);
  for (let index = 0; index < denseCount; index++) {
    const offset = index * 3;
    assert.deepEqual([...mixed.floatInstances.subarray(offset, offset + 3)], [index + 100, index % 5, index % 2]);
  }
  const pure = plan(Array.from({ length: denseCount }, (_, index) => indirect("stroke", index, 1)), []);
  let visits = 0;
  pure.batches = new Proxy(pure.batches, { get(target, key) {
    if (/^\d+$/.test(String(key))) visits++;
    return Reflect.get(target, key, target);
  } });
  mixed.update(pure);
  assert.equal(mixed.batches.length, denseCount, "one-kind plans retain their existing submissions");
  assert.equal(mixed.instanceCount, 0);
  assert(visits <= denseCount * 3, `one-kind plans must be scanned linearly: ${visits} accesses`);
  console.log("Mixed vector batches: painter/clip order, overlap coverage, LOD cache invalidation, barriers, spans and ordered-plan integration passed");
} finally { hooks.deregister(); }
