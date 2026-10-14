import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { compileDensePdfContent } = await import("../src/pdf/nativeContentCompiler.ts");
  const source = new TextEncoder().encode("10 10 m 30 10 l S " +
    "q 1 0 0 RG [3 2] 1 d 10 20 m 30 20 l S Q " +
    "10 30 m 30 30 l S 10 40 20 10 re B");
  const gray = { resourceName: "DeviceGray", colorSpaceIndex: -1, componentCount: 1,
    initialComponents: [0], convertToSrgb: values => [values[0], values[0], values[0]] };
  const matrix = [1.25, .1, .2, .75, 2, 3], bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const dash = [2, 1], strokeColor = [.2, .4, .6], fillColor = [.3, .5, .7];
  const initialGraphicsState = { lineWidth: .5, lineCap: 2, lineJoin: 1, miterLimit: 7,
    lineDash: dash, dashPhase: .25, strokeColor, fillColor,
    strokeColorSpace: gray, fillColorSpace: gray, strokeAlpha: 1, fillAlpha: 1 };
  const options = { output: "display-program", pageMatrix: matrix, pageBounds: bounds, initialGraphicsState,
    enableSegmentMerge: false, enableInvisibleCull: false };
  const compiled = await compileDensePdfContent(source, options), before = structuredClone(compiled);
  assert.equal(compiled.pagePaths.length, 4);
  assert.equal(compiled.genericPathPaints.length, 4);
  assert.deepEqual(compiled.genericPathPaints.map(p => p.strokeStyle.dash), [[2, 1], [3, 2], [2, 1], [2, 1]],
    "each paint captures its own dash state across q/Q and later operators");
  assert.deepEqual(compiled.genericPathPaints.map(p => p.stroke.color), [[.2, .4, .6, 1], [1, 0, 0, 1], [.2, .4, .6, 1], [.2, .4, .6, 1]]);
  source.fill(0); matrix.fill(9); dash.fill(9); strokeColor.fill(9); fillColor.fill(9); bounds.maxX = 9;
  initialGraphicsState.lineWidth = 9; initialGraphicsState.dashPhase = 9;
  assert.deepEqual(compiled, before, "caller source, matrices, bounds, colors and dash edits cannot change captured resources");
  for (const list of [compiled.pagePaths, compiled.genericPathPaints]) assert(Object.isFrozen(list));
  for (const path of compiled.pagePaths) {
    assert(Object.isFrozen(path)); assert(Object.isFrozen(path.transform)); assert(Object.isFrozen(path.bounds));
    assert.throws(() => path.transform[0] = 5, TypeError);
    assert.throws(() => path.bounds.minX = 5, TypeError);
  }
  for (const paint of compiled.genericPathPaints) {
    assert(Object.isFrozen(paint)); assert(Object.isFrozen(paint.stroke)); assert(Object.isFrozen(paint.stroke.color));
    assert(Object.isFrozen(paint.strokeStyle)); assert(Object.isFrozen(paint.strokeStyle.dash));
    assert.throws(() => paint.strokeStyle.lineWidth = 5, TypeError);
    assert.throws(() => paint.strokeStyle.dash.push(5), TypeError);
    assert.throws(() => paint.stroke.color[0] = 5, TypeError);
    if (paint.fill) { assert(Object.isFrozen(paint.fill)); assert(Object.isFrozen(paint.fill.color)); }
  }
  const secondPath = compiled.pagePaths[1].data.slice();
  compiled.pagePaths[0].data[1] = 999;
  assert.deepEqual(compiled.pagePaths[1].data, secondPath, "the existing mutable typed payload belongs to its path alone");

  const repeated = new TextEncoder().encode("2 J 1 j .5 w [2 1] 0 d " +
    Array.from({ length: 512 }, (_, index) => `10 ${index % 90} m 30 ${index % 90} l S`).join(" "));
  const plain = { output: "display-program", pageMatrix: [1, 0, 0, 1, 0, 0],
    pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } };
  const originalSlice = Float32Array.prototype.slice;
  let pathCopies = 0;
  Float32Array.prototype.slice = function (...args) {
    if (this.length === 6 && this[0] === 0 && this[3] === 1) pathCopies++;
    return originalSlice.apply(this, args);
  };
  try {
    const result = await compileDensePdfContent(repeated, plain);
    assert.equal(result.pagePaths.length, 512);
    assert.equal(pathCopies, 512, "retained paths take one ownership copy at capture, with no second copy at finalization");
  } finally { Float32Array.prototype.slice = originalSlice; }
  for (const [limit, value] of [["maxPathResources", 511], ["maxPathVerbs", 1023], ["maxPathCoordinates", 2047],
    ["maxStrokeStyles", 511], ["maxDashValues", 1023]]) {
    await assert.rejects(compileDensePdfContent(repeated, { ...plain, [limit]: value }),
      error => error.name === "DensePdfResourceLimitError", `${limit} retains its caller-controlled count`);
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(compileDensePdfContent(repeated, { ...plain, signal: controller.signal }), { name: "AbortError" });
  const duringFinish = new AbortController(), originalFreeze = Object.freeze;
  let frozenPaths = 0;
  Object.freeze = function (value) {
    if (value?.data instanceof Float32Array && Array.isArray(value.transform) && value.bounds) {
      frozenPaths++;
      duringFinish.abort();
    }
    return originalFreeze(value);
  };
  try {
    await assert.rejects(compileDensePdfContent(repeated, { ...plain, signal: duringFinish.signal }), { name: "AbortError" });
    assert.equal(frozenPaths, 1, "final resource adoption checks cancellation during its freeze pass");
  } finally { Object.freeze = originalFreeze; }
  console.log("Retained resource ownership passed: one path copy, isolated snapshots, frozen metadata, independent typed payloads, caller limits and cancellation.");
} finally { hooks.deregister(); }
