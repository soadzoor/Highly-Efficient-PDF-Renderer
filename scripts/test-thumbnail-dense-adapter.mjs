import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const { compileDensePdfContent } = await import("../src/pdf/nativeContentCompiler.ts");
  const { createHeprPageDataFromDense } = await import("../src/densePdfPageData.ts");
  const { validateHeprPageData } = await import("../src/heprDocumentDataValidation.ts");
  const { getDensePdfPagePath, getDensePdfGenericPathPaint, densePdfPagePathCount,
    densePdfGenericPathPaintCount, readDensePdfPagePathInto, readDensePdfGenericPathPaintInto } =
    await import("../src/pdf/nativeRetainedResources.ts");
  const pageInfo = { sourcePageIndex: 0, width: 100, height: 100,
    mediaBox: [0, 0, 100, 100], cropBox: [0, 0, 100, 100], bleedBox: null,
    trimBox: null, artBox: null, rotation: 0, userUnit: 1 };
  const defaults = { output: "display-program", pageMatrix: [1, 0, 0, 1, 0, 0],
    pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    enableSegmentMerge: false, enableInvisibleCull: false };
  const source = "2 J .4 w [3 2] .5 d " + Array.from({ length: 40 }, (_, index) =>
    `q 1 0 0 1 ${index % 4} ${index % 7} cm 10 ${index % 80} m 80 ${index % 80} l S Q`).join(" ") +
    " q 2 .1 .3 1 0 0 cm 10 10 m 20 30 40 20 50 50 c S Q";
  const packed = await compileDensePdfContent(new TextEncoder().encode(source), { ...defaults, compactRetainedResources: true });
  const legacy = materialize(packed), original = structuredClone(packed);
  const canonical = createHeprPageDataFromDense(pageInfo, packed);
  const originalSubarray = Float32Array.prototype.subarray;
  let geometryViews = 0;
  Float32Array.prototype.subarray = function (...args) {
    geometryViews++;
    return originalSubarray.apply(this, args);
  };
  let preview;
  try { preview = createHeprPageDataFromDense(pageInfo, packed, { thumbnail: true }); }
  finally { Float32Array.prototype.subarray = originalSubarray; }
  assert.equal(geometryViews, 0, "thumbnail adaptation reads packed geometry spans without allocating per-path views");
  assert.deepEqual(preview, createHeprPageDataFromDense(pageInfo, legacy, { thumbnail: true }),
    "packed cursors and legacy resources produce identical preview stores and commands");
  validateHeprPageData(preview);
  assert.deepEqual(packed, original, "reusable read targets never mutate packed capture resources");
  assert.deepEqual(createHeprPageDataFromDense(pageInfo, packed), canonical,
    "a later canonical conversion is unchanged after thumbnail adaptation");

  const pathTarget = { data: new Float32Array(), dataOffset: 0, dataLength: 0,
    transform: [1, 0, 0, 1, 0, 0], minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const paintTarget = { pathIndex: 0, fillRule: 0, fill: null, stroke: null, strokeStyle: null };
  for (const page of [packed, structuredClone(packed), legacy]) {
    for (const index of [0, 7, 8, 39, 40]) {
      assert(readDensePdfPagePathInto(page, index, pathTarget));
      const exact = getDensePdfPagePath(page, index);
      assert.deepEqual(pathTarget.data.subarray(pathTarget.dataOffset, pathTarget.dataOffset + pathTarget.dataLength), exact.data);
      assert.deepEqual(pathTarget.transform, exact.transform);
      assert.deepEqual([pathTarget.minX, pathTarget.minY, pathTarget.maxX, pathTarget.maxY],
        [exact.bounds.minX, exact.bounds.minY, exact.bounds.maxX, exact.bounds.maxY]);
      assert(readDensePdfGenericPathPaintInto(page, index, paintTarget));
      assert.deepEqual(paintTarget, getDensePdfGenericPathPaint(page, index));
    }
    for (const index of [-1, .5, NaN, Infinity, 41]) {
      assert.equal(readDensePdfPagePathInto(page, index, pathTarget), false);
      assert.equal(readDensePdfGenericPathPaintInto(page, index, paintTarget), false);
    }
  }

  // Dense source runs can merge before allocating a draw object, but graphics
  // scope, color, overprint and alpha changes must still form real boundaries.
  const scoped = await compileDensePdfContent(new TextEncoder().encode(
    ".5 w 0 G 10 10 m 90 10 l S 10 20 m 90 20 l S " +
    "/Span BMC 10 30 m 90 30 l S 10 40 m 90 40 l S EMC " +
    "1 0 0 RG 10 50 m 90 50 l S /Over gs 10 60 m 90 60 l S " +
    "q /Half gs 10 70 m 90 70 l S 10 70 m 90 70 l S Q " +
    "0 G 10 80 m 90 80 l S 10 90 m 90 90 l S"), {
    ...defaults, compactRetainedResources: true,
    extGStates: [{ resourceName: "Over", strokeOverprint: true, overprintMode: 1 },
      { resourceName: "Half", strokeAlpha: .5 }]
  });
  const scopedPreview = createHeprPageDataFromDense(pageInfo, scoped, { thumbnail: true });
  validateHeprPageData(scopedPreview);
  assert.deepEqual(scopedPreview, createHeprPageDataFromDense(pageInfo, materialize(scoped), { thumbnail: true }));
  const commands = scopedPreview.displayProgram.groups[0].commands;
  assert.deepEqual(commands.map(command => [command.kind, command.count ?? 0]),
    [["draw", 2], ["draw", 2], ["draw", 1], ["draw", 1], ["invoke-group", 0], ["invoke-group", 0], ["draw", 2]]);
  assert.notEqual(commands[0].markedContentIndex, commands[1].markedContentIndex);
  assert.notEqual(commands[2].paintIndex, commands[3].paintIndex, "equal RGB with different overprint state retains a paint boundary");
  assert.equal(scopedPreview.stores.paints.overprint[commands[2].paintIndex], 0);
  assert.equal(scopedPreview.stores.paints.overprint[commands[3].paintIndex], 1);
  assert.equal(scopedPreview.displayProgram.groups[commands[4].groupIndex].alpha, .5);
  const invalidScope = structuredClone(scoped);
  invalidScope.paintRunMarkedContentIndices[1] = 999;
  assert.throws(() => createHeprPageDataFromDense(pageInfo, invalidScope, { thumbnail: true }), /invalid marked content/,
    "a run that would otherwise merge still validates its source scope");
  const invalidSpan = structuredClone(packed);
  invalidSpan.packedRetainedResources.pathChunks[0].records[2] = 3.5;
  assert.throws(() => createHeprPageDataFromDense(pageInfo, invalidSpan, { thumbnail: true }), /invalid geometry span/);
  console.log("Lean thumbnail adapter passed: packed/legacy equivalence, no temporary geometry views, source immutability, chunk cursors, scope/paint/alpha barriers and validation.");

  function materialize(compiled) {
    const result = { ...compiled,
      pagePaths: Array.from({ length: densePdfPagePathCount(compiled) }, (_, index) => getDensePdfPagePath(compiled, index)),
      genericPathPaints: Array.from({ length: densePdfGenericPathPaintCount(compiled) }, (_, index) => getDensePdfGenericPathPaint(compiled, index)) };
    delete result.packedRetainedResources;
    return result;
  }
} finally { hooks.deregister(); }
