import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const {
    DensePdfRetainedResourceBuilder,
    densePdfPagePathCount, densePdfGenericPathPaintCount,
    getDensePdfPagePath, getDensePdfGenericPathPaint,
  } = await import("../src/pdf/nativeRetainedResources.ts");
  const matrix = [1.0000000000000002, -0, .12500000000000003, 1, 2 ** 40 + .5, -(2 ** 40) - .25];
  const bounds = { minX: -0, minY: -(2 ** 40) - .25, maxX: 2 ** 40 + .5, maxY: .10000000000000002 };
  const bits = new Uint32Array([0x80000000, 0x7fc01234, 0x3f800000, 0x00000001, 0x7f800000]);
  const data = new Float32Array(bits.buffer);
  const fill = { color: [.10000000000000002, -0, .30000000000000004, .9000000000000001],
    sourceColorSpaceIndex: 2 ** 40 + 1, inheritType3Paint: true };
  const stroke = { color: [1, .2, .3, .4], sourceColorSpaceIndex: -0 };
  const style = { lineWidth: .10000000000000002, lineCap: 2, lineJoin: 1,
    miterLimit: 2 ** 40 + .25, dash: [.10000000000000002, -0, 2 ** 40 + .5],
    dashPhase: -0, hairline: true, strokeAdjust: true };
  const expectedMatrix = matrix.slice(), expectedBounds = { ...bounds }, expectedBits = bits.slice();
  const expectedPaint = structuredClone({ pathIndex: 0, fillRule: 1, fill, stroke, strokeStyle: style });
  const builder = new DensePdfRetainedResourceBuilder();
  assert.equal(builder.pathCount, 0); assert.equal(builder.paintCount, 0);
  assert.equal(builder.getPath(0), undefined); assert.equal(builder.getPaint(0), undefined);
  assert.equal(builder.appendPath(data, matrix, bounds), 0);
  assert.equal(builder.appendPaint({ pathIndex: 0, fillRule: 1, fill, stroke, strokeStyle: style }), 0);
  const borrowedData = builder.getPath(0).data;
  assert.notEqual(borrowedData.buffer, data.buffer, "capture owns its geometry rather than borrowing caller buffers");
  bits.fill(0); matrix.fill(9); Object.assign(bounds, { minX: 9, minY: 9, maxX: 9, maxY: 9 });
  fill.color.fill(9); stroke.color.fill(9); style.dash.fill(9); style.lineWidth = 9;
  const path = builder.getPath(0), paint = builder.getPaint(0);
  assert.deepEqual(new Uint32Array(path.data.buffer, path.data.byteOffset, path.data.length), expectedBits,
    "capture preserves every Float32 bit, including signed zero, subnormal and NaN payloads");
  assert.deepEqual(path.transform, expectedMatrix); assert.deepEqual(path.bounds, expectedBounds);
  assert.deepEqual(paint, expectedPaint, "paints and styles retain exact Float64 values and source color-space IDs");
  assert(Object.is(path.bounds.minX, -0)); assert(Object.is(path.transform[1], -0));
  assert(Object.is(paint.stroke.sourceColorSpaceIndex, -0)); assert(Object.is(paint.strokeStyle.dashPhase, -0));
  assert.notEqual(builder.getPath(0), path, "accessors do not cache millions of metadata snapshots");
  assert.notEqual(builder.getPaint(0), paint);
  for (const invalid of [-1, .5, NaN, Infinity, 1]) {
    assert.equal(builder.getPath(invalid), undefined); assert.equal(builder.getPaint(invalid), undefined);
  }
  let checkpoints = 0;
  const packed = await builder.finish(async () => { checkpoints++; });
  assert.equal(checkpoints, 4, "finalization checks cancellation before, between, and after record chunks");
  assert.equal(builder.getPath(0).data.buffer, borrowedData.buffer, "finalization adopts capture buffers without recopying geometry");
  assert.equal(packed.pathChunks[0].records.length, 8 * 8);
  assert.equal(packed.paintChunks[0].records.length, 8 * 5);
  assert.equal(packed.geometryChunks[0].length, 256, "tiny nested programs start with small arenas");
  assert.equal(packed.pathChunks[0].records.byteLength + packed.paintChunks[0].records.byteLength +
    packed.geometryChunks[0].byteLength, 1856, "a one-path glyph program reserves under two KiB, rather than full-size arenas");
  for (const value of [packed, packed.pathChunks, packed.paintChunks, packed.geometryChunks,
    packed.matrices, packed.solidPaints, packed.strokeStyles, packed.pathChunks[0], packed.paintChunks[0],
    path, path.bounds, path.transform, paint, paint.fill, paint.fill.color, paint.strokeStyle, paint.strokeStyle.dash]) {
    assert(Object.isFrozen(value), "metadata and interned values are immutable");
  }
  assert.throws(() => builder.appendPath(new Float32Array(), expectedMatrix, expectedBounds), /already been finalized/);
  assert.throws(() => builder.appendPaint(expectedPaint), /already been finalized/);
  await assert.rejects(builder.finish(async () => {}), /already been finalized/);

  const legacy = { pagePaths: [path], genericPathPaints: [paint] };
  assert.equal(densePdfPagePathCount(legacy), 1); assert.equal(densePdfGenericPathPaintCount(legacy), 1);
  assert.equal(getDensePdfPagePath(legacy, 0), path); assert.equal(getDensePdfGenericPathPaint(legacy, 0), paint);
  const cloned = structuredClone(packed);
  const page = { ...legacy, packedRetainedResources: cloned };
  assert.equal(densePdfPagePathCount(page), 1); assert.equal(densePdfGenericPathPaintCount(page), 1);
  assert.deepEqual(getDensePdfPagePath(page, 0), path);
  assert.deepEqual(getDensePdfGenericPathPaint(page, 0), paint);
  assert.equal(Object.getPrototypeOf(cloned), Object.prototype, "worker-transfer representation is plain serializable data");

  const repeated = new DensePdfRetainedResourceBuilder();
  const identity = [1, 0, 0, 1, 0, 0], zeroBounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const black = { color: [0, 0, 0, 1], sourceColorSpaceIndex: -1 };
  const basicStyle = { lineWidth: .5, lineCap: 1, lineJoin: 1, miterLimit: 10, dash: [3, 2],
    dashPhase: 0, hairline: false, strokeAdjust: false };
  const large = Float32Array.from({ length: 70001 }, (_, index) => index + .25);
  const normal = Float32Array.from({ length: 17 }, (_, index) => index + .5);
  repeated.appendPath(normal, identity, zeroBounds);
  const firstBuffer = repeated.getPath(0).data.buffer;
  repeated.appendPath(large, identity, zeroBounds);
  repeated.appendPath(normal, identity, zeroBounds);
  assert.equal(repeated.getPath(2).data.buffer, firstBuffer,
    "a large dedicated geometry allocation does not discard unused space in the ordinary chunk");
  assert.notEqual(repeated.getPath(1).data.buffer, firstBuffer);
  const repeatedCount = 11000;
  for (let index = 3; index < repeatedCount; index++) repeated.appendPath(normal, [...identity], { ...zeroBounds });
  for (let index = 0; index < repeatedCount; index++) {
    repeated.appendPaint({ pathIndex: index, fillRule: index % 2, fill: null,
      stroke: { ...black, color: [...black.color] }, strokeStyle: { ...basicStyle, dash: [...basicStyle.dash] } });
  }
  const neighboringData = repeated.getPath(2).data.slice();
  repeated.getPath(0).data[0] = 999;
  assert.deepEqual(repeated.getPath(2).data, neighboringData, "borrowed path views occupy independent geometry ranges");
  const firstPaint = repeated.getPaint(0), secondPaint = repeated.getPaint(1);
  assert.equal(firstPaint.stroke, secondPaint.stroke); assert.equal(firstPaint.strokeStyle, secondPaint.strokeStyle);
  assert.equal(repeated.getPath(0).transform, repeated.getPath(repeatedCount - 1).transform);
  const repeatedPacked = await repeated.finish(async () => {});
  assert.equal(repeatedPacked.matrices.length, 1); assert.equal(repeatedPacked.solidPaints.length, 1);
  assert.equal(repeatedPacked.strokeStyles.length, 1);
  assert.deepEqual(repeatedPacked.pathChunks.map(chunk => chunk.count), [8, 32, 128, 512, 2048, 4096, 4096, 80]);
  assert.deepEqual(repeatedPacked.paintChunks.map(chunk => chunk.count), [8, 32, 128, 512, 2048, 4096, 4096, 80]);
  for (const index of [0, 1, 2, 7, 8, 39, 40, 167, 168, 679, 680, 2727, 2728, 6823, 6824, 10919, 10920, 10999]) {
    const result = getDensePdfPagePath({ ...legacy, packedRetainedResources: repeatedPacked }, index);
    assert.deepEqual(result.data, index === 1 ? large : index === 0 ? new Float32Array([999, ...normal.subarray(1)]) : normal);
    const resultPaint = getDensePdfGenericPathPaint({ ...legacy, packedRetainedResources: repeatedPacked }, index);
    assert.equal(resultPaint.pathIndex, index); assert.equal(resultPaint.fillRule, index % 2); assert.equal(resultPaint.fill, null);
  }
  const recordBytes = [...repeatedPacked.pathChunks, ...repeatedPacked.paintChunks]
    .reduce((total, chunk) => total + chunk.records.byteLength, 0);
  assert.equal(recordBytes, (8 + 32 + 128 + 512 + 2048 + 3 * 4096) * (8 + 5) * Float64Array.BYTES_PER_ELEMENT,
    "millions of path and paint records scale as fixed typed records, without per-record object storage");
  assert(repeatedPacked.geometryChunks.some(chunk => chunk.length === large.length),
    "paths larger than the ordinary chunk are accepted without a physical resource cap");
  const moderate = new DensePdfRetainedResourceBuilder();
  for (let index = 0; index < 20; index++) {
    moderate.appendPath(normal, identity, zeroBounds);
    moderate.appendPaint({ pathIndex: index, fillRule: 0, fill: black, stroke: null, strokeStyle: null });
  }
  const moderatePacked = await moderate.finish(async () => {});
  assert.deepEqual(moderatePacked.pathChunks.map(chunk => chunk.records.length / 8), [8, 32]);
  assert.deepEqual(moderatePacked.paintChunks.map(chunk => chunk.records.length / 5), [8, 32]);
  assert.deepEqual(moderatePacked.geometryChunks.map(chunk => chunk.length), [256, 1024]);
  assert(moderatePacked.pathChunks.reduce((sum, chunk) => sum + chunk.records.byteLength, 0) +
    moderatePacked.paintChunks.reduce((sum, chunk) => sum + chunk.records.byteLength, 0) +
    moderatePacked.geometryChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0) < 16384,
  "modest glyph and form programs grow progressively instead of jumping immediately to full-size chunks");

  const variants = new DensePdfRetainedResourceBuilder();
  const fills = [black, { ...black, inheritType3Paint: false }, { ...black, inheritType3Paint: true },
    { ...black, inheritType3Paint: undefined }, { ...black, color: [-0, 0, 0, 1] },
    { ...black, sourceColorSpaceIndex: 2 ** 40 + 1 }, { ...black, sourceColorSpaceIndex: 2 ** 40 + 2 }];
  for (const value of fills) {
    variants.appendPaint({ pathIndex: 2 ** 40 + 1, fillRule: 0, fill: value, stroke: null, strokeStyle: null });
  }
  variants.appendPaint({ pathIndex: -0, fillRule: 1, fill: null, stroke: null, strokeStyle: basicStyle });
  variants.appendPaint({ pathIndex: 0, fillRule: 1, fill: null, stroke: null, strokeStyle: { ...basicStyle, dashPhase: -0 } });
  variants.appendPaint({ pathIndex: 0, fillRule: 1, fill: null, stroke: null, strokeStyle: { ...basicStyle, dash: [3, -0] } });
  variants.appendPaint({ pathIndex: 0, fillRule: 1, fill: null, stroke: null, strokeStyle: { ...basicStyle, hairline: true } });
  variants.appendPaint({ pathIndex: 0, fillRule: 1, fill: null, stroke: null, strokeStyle: { ...basicStyle, strokeAdjust: true } });
  variants.appendPath(new Float32Array(), identity, zeroBounds);
  variants.appendPath(new Float32Array(), [1, -0, 0, 1, 0, 0], zeroBounds);
  variants.appendPath(new Float32Array(), identity, zeroBounds);
  const variantPacked = await variants.finish(async () => {});
  assert.equal(variantPacked.solidPaints.length, fills.length);
  assert.equal(variantPacked.strokeStyles.length, 5); assert.equal(variantPacked.matrices.length, 2);
  for (let index = 0; index < fills.length; index++) {
    assert.deepEqual(variants.getPaint(index).fill, fills[index]);
    assert.equal(variants.getPaint(index).pathIndex, 2 ** 40 + 1);
    assert.equal(variants.getPaint(index).stroke, null); assert.equal(variants.getPaint(index).strokeStyle, null);
  }
  assert(Object.is(variants.getPaint(fills.length).pathIndex, -0));
  assert.equal(variants.getPath(0).transform, variants.getPath(2).transform,
    "interning also reuses non-adjacent equal matrices");
  assert.notEqual(variants.getPath(0).transform, variants.getPath(1).transform);

  const preview = new DensePdfRetainedResourceBuilder(true);
  const previewMatrix = [1.0000000000000002, -0, .25, .75, 2 ** 40 + .5, -3.0000000000000004];
  const expectedPreviewMatrix = previewMatrix.slice();
  const otherPreviewMatrix = [2, .5, -.25, 1, -7, 11];
  for (const transform of [previewMatrix, [...previewMatrix], otherPreviewMatrix, [...previewMatrix]]) {
    preview.appendPath(normal, transform, zeroBounds);
  }
  previewMatrix.fill(99); otherPreviewMatrix.fill(99);
  assert.equal(preview.getPath(0).transform, preview.getPath(1).transform,
    "thumbnail capture still reuses consecutive equal CTMs");
  assert.notEqual(preview.getPath(0).transform, preview.getPath(3).transform,
    "thumbnail capture avoids global interning of nonadjacent CTMs");
  assert.deepEqual(preview.getPath(0).transform, expectedPreviewMatrix,
    "thumbnail matrices remain owned, exact and immutable after caller mutation");
  assert.deepEqual(preview.getPath(3).transform, expectedPreviewMatrix);
  assert(Object.is(preview.getPath(0).transform[1], -0));
  assert(Object.isFrozen(preview.getPath(0).transform));
  const previewPacked = await preview.finish(async () => {});
  assert.equal(previewPacked.matrices.length, 3);
  const clonedPreview = { ...legacy, packedRetainedResources: structuredClone(previewPacked) };
  for (let index = 0; index < preview.pathCount; index++) {
    assert.deepEqual(getDensePdfPagePath(clonedPreview, index), preview.getPath(index),
      "thumbnail captures remain exact across the parser worker boundary");
  }

  const empty = await new DensePdfRetainedResourceBuilder().finish(async () => {});
  assert.equal(densePdfPagePathCount({ ...legacy, packedRetainedResources: empty }), 0);
  assert.equal(densePdfGenericPathPaintCount({ ...legacy, packedRetainedResources: empty }), 0);
  assert.equal(getDensePdfPagePath({ ...legacy, packedRetainedResources: empty }, 0), undefined);

  const cancelled = new DensePdfRetainedResourceBuilder();
  for (let index = 0; index < 4100; index++) cancelled.appendPath(normal, identity, zeroBounds);
  let cancellationChecks = 0;
  await assert.rejects(cancelled.finish(async () => {
    if (++cancellationChecks === 3) throw new DOMException("Cancelled", "AbortError");
  }), { name: "AbortError" });
  assert.equal(cancellationChecks, 3, "finalization yields between arena chunks so cancellation is observed");
  assert.throws(() => cancelled.appendPath(normal, identity, zeroBounds), /already been finalized/);
  await assert.rejects(cancelled.finish(async () => {}), /already been finalized/);

  console.log("Packed retained resources passed: exact owned geometry, Float64 metadata, signed zero, interned paints/styles, chunk boundaries, large paths, worker cloning, cancellation and lifecycle.");
} finally { hooks.deregister(); }
