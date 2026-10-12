import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });

try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { vectorFillCoverageMetadata } = await import("../src/vectorFillCoverage.ts");
  const line = (a, b) => [a, [NaN, NaN], b, false];
  const polygon = (points) => points.map((a, i) => line(a, points[(i + 1) % points.length]));
  const rectangle = (x, y, width, height, reverse = false) => polygon(
    (reverse ? [[x, y], [x, y + height], [x + width, y + height], [x + width, y]]
      : [[x, y], [x + width, y], [x + width, y + height], [x, y + height]]));
  const arch = (x = 0, y = 0, scale = 1) => [
    [[x, y], [x + scale, y + scale * 2], [x + scale * 2, y], true],
    line([x + scale * 2, y], [x, y])
  ];
  const sceneWith = (paths, rules = paths.map(() => 0)) => {
    const scene = createEmptyVectorScene();
    const a = [], b = [], metaA = [], metaB = [], metaC = [];
    for (const [path, edges] of paths.entries()) {
      // Deliberately stale bounds model HEP's independently quantized geometry.
      metaA.push(a.length / 4, edges.length, 0.25, 0.375);
      metaB.push(0.75, 0.625, 0.125 + path / 100, 0.25 + path / 100);
      metaC.push(rules[path], 1, 0.5 + path / 100, 0.75);
      for (const [p0, p1, p2, curve] of edges) {
        a.push(...p0, ...p1);
        b.push(...p2, curve ? 1 : 0, 0);
      }
    }
    Object.assign(scene, { fillPathCount: paths.length, fillSegmentCount: a.length / 4,
      fillPathMetaA: Float32Array.from(metaA), fillPathMetaB: Float32Array.from(metaB),
      fillPathMetaC: Float32Array.from(metaC), fillSegmentsA: Float32Array.from(a),
      fillSegmentsB: Float32Array.from(b) });
    return scene;
  };
  const bounds = (meta, path = 0) => [...meta.pathMetaA.subarray(path * 4 + 2, path * 4 + 4),
    ...meta.pathMetaB.subarray(path * 4, path * 4 + 2)];
  const area = (meta, path = 0) => meta.pathMetaC[path * 4 + 1];
  const rule = (meta, path = 0) => meta.pathMetaC[path * 4];
  const canonicalArrays = (scene) => [scene.fillPathMetaA, scene.fillPathMetaB, scene.fillPathMetaC,
    scene.fillSegmentsA, scene.fillSegmentsB];

  const scene = sceneWith([
    rectangle(-2, -3, 4, 5),
    rectangle(-2, -3, 4, 5, true),
    arch(),
    [...rectangle(0, 0, 10, 10), ...rectangle(2, 2, 6, 6, true)],
    [...rectangle(0, 0, 2, 2), ...rectangle(10, 10, 3, 3)],
    [...rectangle(0, 0, 2, 2), ...rectangle(0, 0, 2, 2)],
    polygon([[0, 0], [2, 2], [0, 2], [2, 0]]),
    arch(2 ** 30, -(2 ** 30), 128)
  ], [0, 0, 1, 0, 1, 1, 1, 0]);
  const original = canonicalArrays(scene).map((array) => array.slice());
  const meta = vectorFillCoverageMetadata(scene);
  assert.notEqual(meta.pathMetaA, scene.fillPathMetaA);
  assert.notEqual(meta.pathMetaB, scene.fillPathMetaB);
  assert.notEqual(meta.pathMetaC, scene.fillPathMetaC);
  assert.deepEqual(bounds(meta, 0), [-2, -3, 2, 2], "bounds follow decoded geometry, including negative coordinates");
  assert.deepEqual(bounds(meta, 2), [0, 0, 2, 2], "quadratic control hull includes its control point above the actual curve");
  assert.deepEqual([...Array(scene.fillPathCount)].map((_, p) => area(meta, p)),
    [20, -20, Math.fround(-4 / 3), 64, 13, 8, 0, Math.fround(-4 * 128 ** 2 / 3)],
    "signed integral preserves direction, quadratic area, holes, disconnected loops, winding overlap, and cancellation");
  for (let path = 0; path < scene.fillPathCount; path++) {
    const i = path * 4;
    assert.equal(rule(meta, path), scene.fillPathMetaC[i], "eligible paths retain either fill rule");
    assert.deepEqual([...meta.pathMetaA.subarray(i, i + 2)], [...scene.fillPathMetaA.subarray(i, i + 2)],
      "segment start/count are unchanged");
    assert.deepEqual([...meta.pathMetaB.subarray(i + 2, i + 4)], [...scene.fillPathMetaB.subarray(i + 2, i + 4)],
      "red/green are unchanged");
    assert.deepEqual([...meta.pathMetaC.subarray(i + 2, i + 4)], [...scene.fillPathMetaC.subarray(i + 2, i + 4)],
      "blue/alpha are unchanged");
  }
  canonicalArrays(scene).forEach((array, index) => assert.deepEqual(array, original[index],
    "renderer preprocessing never changes canonical/exported metadata or geometry"));

  // Reject an open contour even if another contour in the same paint closes.
  const open = sceneWith([
    [line([-2, -3], [4, 5])],
    [line([0, 0], [1, 1]), ...rectangle(2, 2, 1, 1)],
    [...rectangle(0, 0, 1, 1), line([2, 2], [3, 3])]
  ], [0, 1, 1]);
  const openMeta = vectorFillCoverageMetadata(open);
  assert.deepEqual(bounds(openMeta), [-2, -3, 4, 5], "finite open paths still get conservative decoded bounds");
  assert.deepEqual([rule(openMeta, 0), rule(openMeta, 1), rule(openMeta, 2)], [-1, -2, -2]);
  for (let path = 0; path < open.fillPathCount; path++) {
    assert.equal(area(openMeta, path), 0, "fallback uses an explicit finite marker, not NaN");
    assert.equal(-rule(openMeta, path) - 1, open.fillPathMetaC[path * 4], "fallback marker preserves the fill rule");
  }
  const openDomain = sceneWith([[line([1, 0], [1, 1])]]);
  openDomain.fillPathMetaA[2] = -10;
  const openDomainMeta = vectorFillCoverageMetadata(openDomain);
  assert.deepEqual(bounds(openDomainMeta), [-10, 0, 1, 1],
    "an open vertical edge retains the larger original left domain of its winding integral");
  assert.equal(rule(openDomainMeta), -1);
  const openDomainChanged = { ...openDomain, fillPathMetaB: openDomain.fillPathMetaB.slice() };
  openDomainChanged.fillPathMetaB[0] = 2;
  const openDomainChangedMeta = vectorFillCoverageMetadata(openDomainChanged);
  assert.deepEqual(bounds(openDomainChangedMeta), [-10, 0, 2, 1],
    "open fallback envelopes follow replacement canonical upper bounds");
  assert.equal(openDomainChangedMeta.pathMetaA, openDomainMeta.pathMetaA,
    "open fallback B replacements reuse the geometry scan");

  const invalid = sceneWith([
    [[[0, 0], [NaN, 2], [1, 0], true], line([1, 0], [0, 0])],
    [line([0, 0], [Infinity, 1])], rectangle(0, 0, 1, 1), rectangle(0, 0, 1, 1),
    rectangle(0, 0, 1, 1), []
  ], [0, 1, 0, 1, 0, 1]);
  invalid.fillPathMetaA[2 * 4] = -1;
  invalid.fillPathMetaA[3 * 4 + 1] = 2.5;
  invalid.fillPathMetaA[4 * 4 + 1] = invalid.fillSegmentCount + 1;
  const invalidMeta = vectorFillCoverageMetadata(invalid);
  for (let path = 0; path < invalid.fillPathCount; path++) {
    assert.deepEqual(bounds(invalidMeta, path), [0.25, 0.375, 0.75, 0.625],
      "nonfinite, empty, and out-of-range geometry retains original bounds");
    assert(rule(invalidMeta, path) < 0);
    assert.equal(area(invalidMeta, path), 0);
  }

  // Zero is a valid integral; values that cannot travel in a Float32 texel fall back.
  const extremes = sceneWith([
    [line([-0.1, -0.2], [-0.1, -0.2])],
    rectangle(0, 0, 1e30, 1e30), rectangle(0, 0, 1e-30, 1e-30),
    rectangle(-1e-40, -2e-40, 3e-40, 4e-40)
  ]);
  const extremeMeta = vectorFillCoverageMetadata(extremes);
  assert.equal(rule(extremeMeta, 0), 0, "a finite closed zero-area contour can use the zero integral");
  assert.equal(area(extremeMeta, 0), 0);
  assert.equal(rule(extremeMeta, 1), -1, "area overflow retains ordinary segment evaluation");
  assert.equal(rule(extremeMeta, 2), -1, "nonzero area underflow retains ordinary segment evaluation");
  assert.deepEqual(bounds(extremeMeta, 2), [0, 0, Math.fround(1e-30), Math.fround(1e-30)],
    "closed paths with unrepresentable areas keep decoded hulls rather than the open-path envelope");
  for (let path = 0; path < extremes.fillPathCount; path++) {
    const [minX, minY, maxX, maxY] = bounds(extremeMeta, path);
    const start = extremes.fillPathMetaA[path * 4], count = extremes.fillPathMetaA[path * 4 + 1];
    for (let segment = start; segment < start + count; segment++) {
      const i = segment * 4;
      for (const [x, y] of [[extremes.fillSegmentsA[i], extremes.fillSegmentsA[i + 1]],
        [extremes.fillSegmentsB[i], extremes.fillSegmentsB[i + 1]]]) {
        assert(minX <= x && minY <= y && maxX >= x && maxY >= y,
          "stored Float32 bounds round outward for negative, large, and subnormal decoded values");
      }
    }
  }

  assert.equal(vectorFillCoverageMetadata(scene), meta, "stable source arrays reuse metadata");
  assert.equal(vectorFillCoverageMetadata({ ...scene }), meta, "cache follows source identities across scene wrappers");
  const recolored = { ...scene, fillPathMetaC: scene.fillPathMetaC.slice() };
  recolored.fillPathMetaC[2] = 0.875;
  recolored.fillPathMetaC[3] = 0.5;
  const recoloredMeta = vectorFillCoverageMetadata(recolored);
  assert.notEqual(recoloredMeta, meta, "C replacements invalidate color copies");
  assert.equal(recoloredMeta.pathMetaA, meta.pathMetaA, "C recoloring reuses the geometry scan");
  assert.equal(recoloredMeta.pathMetaC[2], 0.875);
  assert.equal(recoloredMeta.pathMetaC[3], 0.5);
  const redGreen = { ...recolored, fillPathMetaB: recolored.fillPathMetaB.slice() };
  redGreen.fillPathMetaB[2] = 0.625;
  const redGreenMeta = vectorFillCoverageMetadata(redGreen);
  assert.equal(redGreenMeta.pathMetaA, meta.pathMetaA, "B recoloring reuses geometry too");
  assert.equal(redGreenMeta.pathMetaB[2], 0.625);
  assert.equal(redGreenMeta.pathMetaC[2], 0.875);
  const geometryChanged = { ...scene, fillSegmentsA: scene.fillSegmentsA.slice() };
  geometryChanged.fillSegmentsA[0] = -4;
  const changedMeta = vectorFillCoverageMetadata(geometryChanged);
  assert.notEqual(changedMeta.pathMetaA, meta.pathMetaA, "decoded geometry replacements invalidate the hull scan");
  assert.equal(changedMeta.pathMetaA[2], -4);
  assert(rule(changedMeta) < 0, "a changed opening endpoint disables the area shortcut");
  const segmentBChanged = { ...geometryChanged, fillSegmentsB: scene.fillSegmentsB.slice() };
  const changedBMeta = vectorFillCoverageMetadata(segmentBChanged);
  assert.notEqual(changedBMeta.pathMetaA, changedMeta.pathMetaA, "both decoded segment array identities participate in caching");
  const resized = { ...segmentBChanged, fillPathCount: 1 };
  const resizedMeta = vectorFillCoverageMetadata(resized);
  assert.notEqual(resizedMeta.pathMetaA, changedBMeta.pathMetaA, "logical path counts participate in caching");
  const shorter = { ...resized, fillSegmentCount: 3 };
  const shorterMeta = vectorFillCoverageMetadata(shorter);
  assert.notEqual(shorterMeta.pathMetaA, resizedMeta.pathMetaA, "logical segment counts participate in caching");
  assert.deepEqual(bounds(shorterMeta), [0.25, 0.375, 0.75, 0.625], "shorter segment stores revalidate source ranges");
  const movedStart = { ...scene, fillPathMetaA: scene.fillPathMetaA.slice() };
  movedStart.fillPathMetaA[0] = movedStart.fillSegmentCount;
  assert(rule(vectorFillCoverageMetadata(movedStart)) < 0, "metadata array replacements revalidate segment ranges");
  const empty = createEmptyVectorScene();
  const emptyMeta = vectorFillCoverageMetadata(empty);
  assert.deepEqual([emptyMeta.pathMetaA.length, emptyMeta.pathMetaB.length, emptyMeta.pathMetaC.length], [0, 0, 0]);

  console.log("vector fill coverage: decoded hulls, signed curve/compound area, invalid/open fallback, immutability and source-identity caches passed");
} finally { hooks.deregister(); }
