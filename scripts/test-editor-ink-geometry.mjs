import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
try {
  const { fitEditorInkPaths, flattenEditorInkPaths, editorInkBounds, editorInkPathData } = await import("../src/editorInkGeometry.ts");
  const { compileEditorObjectGeometry } = await import("../src/editorSceneObjects.ts");
  const { getScenePrimitive } = await import("../src/scenePrimitives.ts");
  const { transformWholeEditorScene } = await import("../src/editorScene.ts");
  const { writeScenePdf } = await import("../src/editorPdfWriter.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const curve = Array.from({ length: 801 }, (_, index) => {
    const t = index / 800; return [20 + 160 * t, 20 + 140 * t * (1 - t) + Math.sin(index * .8) * .025];
  });
  const original = structuredClone(curve), tolerance = .2;
  const fitted = fitEditorInkPaths([curve], tolerance), flat = flattenEditorInkPaths(fitted, .005)[0];
  assert(fitted[0].length < curve.length / 8, "bounded smoothing removes redundant pointer samples");
  assert(fitted[0].some(segment => segment.control), "smooth handwriting retains quadratic centerlines");
  assert.deepEqual(fitted[0][0].start, curve[0]); assert.deepEqual(fitted[0].at(-1).end, curve.at(-1)); assert.deepEqual(curve, original);
  const distance = (p, a, b) => {
    const x = b[0] - a[0], y = b[1] - a[1], square = x * x + y * y;
    const t = square ? Math.max(0, Math.min(1, ((p[0] - a[0]) * x + (p[1] - a[1]) * y) / square)) : 0;
    return Math.hypot(p[0] - a[0] - t * x, p[1] - a[1] - t * y);
  };
  const nearest = (p, path) => { let result = Infinity; for (let i = 1; i < path.length; i++) result = Math.min(result, distance(p, path[i - 1], path[i])); return result; };
  for (const p of flat) assert(nearest(p, curve) <= tolerance + .006, "fitted curves cannot leave the original sampled path's tolerance");
  for (const p of curve) assert(nearest(p, flat) <= tolerance + .006, "the original handwriting stays within the fitted path's tolerance");
  const raw = fitEditorInkPaths([[[0, 0], [5, 8], [10, 0]]]);
  assert.equal(raw[0].length, 2); assert(raw[0].every(segment => !segment.control), "legacy programmatic paths are unsmoothed by default");
  const corner = fitEditorInkPaths([[[0, 0], [10, 0], [10, 10]]], .2);
  assert.deepEqual(corner, [[{ start: [0, 0], end: [10, 0] }, { start: [10, 0], end: [10, 10] }]], "visible corners remain exact anchors");
  assert.deepEqual(fitEditorInkPaths([[[0, 0], [10, 0], [5, 0]]], .2), [[{ start: [0, 0], end: [10, 0] }, { start: [10, 0], end: [5, 0] }]], "reversal cusps remain exact");
  const loop = Array.from({ length: 241 }, (_, i) => [30 + 20 * Math.cos(i / 240 * Math.PI * 2), 30 + 20 * Math.sin(i / 240 * Math.PI * 2)]);
  loop[loop.length - 1] = [...loop[0]];
  const loops = fitEditorInkPaths([loop, [[70, 20], [80, 30]]], .15);
  assert.equal(loops.length, 2); assert.deepEqual(loops[0][0].start, loops[0].at(-1).end);
  assert(editorInkBounds([loops[0]]).maxX - editorInkBounds([loops[0]]).minX > 39.7, "closed loops are not collapsed");
  assert.equal((editorInkPathData(loops).match(/M/g) ?? []).length, 2, "pen lifts remain distinct SVG paths");
  const dot = fitEditorInkPaths([[[4, 7], [4, 7], [4, 7]]], .2);
  assert.deepEqual(dot, [[{ start: [4, 7], end: [4, 7] }]]); assert.deepEqual(flattenEditorInkPaths(dot), [[[4, 7], [4, 7]]]);
  const arch = [[{ start: [0, 0], control: [10, 20], end: [20, 0] }]];
  assert.deepEqual(editorInkBounds(arch), { minX: 0, minY: 0, maxX: 20, maxY: 10 }, "quadratic bounds use the curve extremum rather than the control hull");
  assert.equal(editorInkBounds([[]]), null);
  for (const value of [-1, NaN, Infinity]) assert.throws(() => fitEditorInkPaths([curve], value), RangeError);
  for (const value of [0, -1, NaN, Infinity]) assert.throws(() => flattenEditorInkPaths(fitted, value), RangeError);
  assert.throws(() => fitEditorInkPaths([[[0, NaN]]]), TypeError);
  assert.throws(() => fitEditorInkPaths([curve], .2, AbortSignal.abort()), { name: "AbortError" });
  assert.throws(() => flattenEditorInkPaths(fitted, .01, AbortSignal.abort()), { name: "AbortError" });
  const tinyTolerance = flattenEditorInkPaths(arch, Number.MIN_VALUE);
  assert(tinyTolerance[0].length > 2 && tinyTolerance[0].length < 100_000, "sub-Float32 tolerances stop at useful coordinate precision");
  assert.deepEqual(tinyTolerance[0][0], [0, 0]); assert.deepEqual(tinyTolerance[0].at(-1), [20, 0]);
  const pdfCurve = [{ start: [1e9, -1e9], control: [1e9 + 20_000, -1e9 + 70_000], end: [1e9 + 50_000, -1e9 + 10_000] }];
  const pdfPoints = flattenEditorInkPaths([pdfCurve], .05, undefined, "float64")[0];
  const gpuPoints = flattenEditorInkPaths([pdfCurve], .05)[0];
  assert(pdfPoints.length > gpuPoints.length, "PDF-space paths are not relaxed to a Float32 coordinate error floor");
  for (let i = 0; i <= 1000; i++) {
    const t = i / 1000, s = 1 - t, { start, control, end } = pdfCurve[0];
    const p = [s * s * start[0] + 2 * s * t * control[0] + t * t * end[0], s * s * start[1] + 2 * s * t * control[1] + t * t * end[1]];
    assert(nearest(p, pdfPoints) < .05001, "large translated/scaled PDF curves keep the requested page-point tolerance");
  }
  const precisionCurve = [[{ start: [1e12, 1e12], control: [1e12 + .5, 1e12 + 1], end: [1e12 + 1, 1e12] }]];
  const preciseTiny = flattenEditorInkPaths(precisionCurve, Number.MIN_VALUE, undefined, "float64")[0];
  assert(preciseTiny.length > 2 && preciseTiny.length < 1000, "sub-Double requests terminate at the coordinates' useful numerical precision");
  assert.deepEqual(preciseTiny[0], precisionCurve[0][0].start); assert.deepEqual(preciseTiny.at(-1), precisionCurve[0][0].end);
  assert.throws(() => flattenEditorInkPaths([pdfCurve], .05, AbortSignal.abort(), "float64"), { name: "AbortError" });
  assert.throws(() => flattenEditorInkPaths(arch, .05, undefined, "float16"), RangeError);

  const object = { kind: "ink", id: "test-ink", pageIndex: 0, transform: [1, 0, 0, 1, 0, 0], paths: [curve], smoothing: tolerance,
    color: "#336699", strokeWidth: 2, fill: "#abcdef", opacity: .7 };
  const scene = await compileEditorObjectGeometry(object);
  assert.equal(scene.segmentCount, fitted[0].length); assert.equal(scene.fillPathCount, 1);
  assert(scene.primitiveMeta.some((value, index) => index % 4 === 2 && value === 1));
  assert(scene.fillSegmentsB.some((value, index) => index % 4 === 2 && value === 1), "ink fill uses the same curves as its stroke");
  for (let i = 0; i < scene.segmentCount; i++) {
    const actual = getScenePrimitive(scene, { kind: "stroke", index: i }).getSegment(0), expected = fitted[0][i];
    for (const key of ["start", "end", "control"]) if (expected[key]) {
      assert.equal(actual[key].x, Math.fround(expected[key][0])); assert.equal(actual[key].y, Math.fround(expected[key][1]));
    }
    assert(Math.abs(scene.primitiveMeta[i * 4 + 3] % 2 - .7) < 1e-6);
  }
  const dotScene = await compileEditorObjectGeometry({ ...object, paths: [[[4, 7]]], fill: null });
  assert.equal(dotScene.segmentCount, 1); assert.equal(Math.floor(dotScene.primitiveMeta[3] / 2) & 2, 2, "dots retain a round cap instead of disappearing");
  assert.deepEqual(dotScene.bounds, { minX: 3, minY: 6, maxX: 5, maxY: 8 });
  const scaled = transformWholeEditorScene(scene, [2, .2, .1, .7, 3, -5]);
  assert(scaled.fillPathCount > scene.fillPathCount, "nonuniform transforms retain curved pens as vector outlines");
  const pdf = new Uint8Array(await (await writeScenePdf(scene)).arrayBuffer()), document = await NativePdfDocument.open({ kind: "bytes", bytes: pdf });
  try {
    const content = (await document.getDecodedPageContents(0)).map(part => new TextDecoder().decode(part)).join("\n");
    assert.match(content, / c\n/); assert(!content.includes(" Do"), "curved handwriting remains vector PDF content");
  } finally { await document.close(); }
  const hep = await buildHep(scene, { withVectorLod: false, withTextLod: false, encodeRasterImages: false });
  const restored = await loadSceneFromHep(await hep.arrayBuffer());
  for (const key of ["primitiveMeta", "fillSegmentsB"]) {
    assert.equal(restored[key].length, scene[key].length);
    for (let i = 0; i < scene[key].length; i++) {
      if (i % 4 === 2) assert.equal(restored[key][i], scene[key][i], "HEP retains the quadratic segment kind");
      else assert(Math.abs(restored[key][i] - scene[key][i]) < .002, "HEP retains curve coordinates within its existing compact encoding precision");
    }
  }
  console.log("Ink geometry: bounded fitting, corners/loops/dots, raw compatibility, vector fills/transforms, PDF curves and HEP passed.");
} finally { hooks.deregister(); }
