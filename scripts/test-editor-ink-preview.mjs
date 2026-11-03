import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { editorInkPreviewGeometry, createEditorInkPreviewCache, editorInkPreviewTransform } = await import("../src/editorInkPreview.ts");
  const { editorInkPathData, fitEditorInkPaths } = await import("../src/editorInkGeometry.ts");
  const { compileEditorObjectGeometry } = await import("../src/editorSceneObjects.ts");
  const { getScenePrimitive } = await import("../src/scenePrimitives.ts");
  const identity = [1, 0, 0, 1, 0, 0], close = (actual, expected, message = "") => assert(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} vs ${expected}`);
  const curve = Array.from({ length: 120 }, (_, index) => {
    const t = index / 119; return [20 + 170 * t, 40 + 150 * t * (1 - t) + Math.sin(index * 2) * .03];
  });
  const ink = { kind: "ink", id: "preview", pageIndex: 0, transform: identity,
    paths: [curve, [[220, 40], [235, 60]], [[250, 50], [265, 50], [260, 75], [250, 50]]],
    smoothing: .25, color: "#369", strokeWidth: 7.25, fill: "#abcdef", opacity: .6, fillOpacity: .2 };
  const curves = fitEditorInkPaths(ink.paths, ink.smoothing), preview = editorInkPreviewGeometry(ink), stroke = preview.paths.at(-1);
  assert.equal(preview.paths.length, 3, "only paths with at least three samples receive a separate fill");
  assert.equal(stroke.d, editorInkPathData(curves)); assert(stroke.d.includes("Q"), "preview retains the committed fitted curves");
  assert.equal(stroke.stroke, "rgb(51,102,153)"); assert.equal(stroke["stroke-width"], 7.25);
  assert.equal(stroke["stroke-opacity"], .6); assert.equal(stroke["stroke-linecap"], "round"); assert.equal(stroke["stroke-linejoin"], "round");
  assert.equal(stroke["vector-effect"], undefined, "ordinary pens scale with the full local-to-view matrix");
  assert.deepEqual(preview.paths.slice(0, -1).map(path => path.d), [editorInkPathData([curves[0]]), editorInkPathData([curves[2]])]);
  for (const fill of preview.paths.slice(0, -1)) {
    assert.equal(fill.stroke, "none"); assert.equal(fill.fill, "rgb(171,205,239)");
    assert.equal(fill["fill-opacity"], .2); assert.equal(fill["fill-rule"], "nonzero");
  }
  const committed = await compileEditorObjectGeometry(ink);
  assert.equal(committed.segmentCount, curves.reduce((sum, path) => sum + path.length, 0));
  assert.equal(committed.fillPathCount, 2);
  let index = 0;
  for (const path of curves) for (const expected of path) {
    const actual = getScenePrimitive(committed, { kind: "stroke", index: index++ }).getSegment(0);
    for (const key of ["start", "end", "control"]) if (expected[key]) {
      assert.equal(actual[key].x, Math.fround(expected[key][0])); assert.equal(actual[key].y, Math.fround(expected[key][1]));
    }
  }
  for (let offset = 0; offset < committed.styles.length; offset += 4) close(committed.styles[offset] * 2, stroke["stroke-width"], "committed pen width");
  for (let offset = 3; offset < committed.primitiveMeta.length; offset += 4) close(committed.primitiveMeta[offset] % 2, stroke["stroke-opacity"], "committed stroke alpha");
  for (let offset = 3; offset < committed.fillPathMetaC.length; offset += 4) close(committed.fillPathMetaC[offset], preview.paths[0]["fill-opacity"], "committed fill alpha");

  const { fillOpacity: _fillOpacity, ...legacy } = ink;
  assert.equal(editorInkPreviewGeometry(legacy).paths[0]["fill-opacity"], .6, "legacy fills inherit object opacity");
  assert.equal(editorInkPreviewGeometry({ paths: [[[4, 7]]] }).paths[0].d, "M4 7 L4 7", "a tap retains a round zero-length stroke");
  assert.equal(editorInkPreviewGeometry({ paths: [] }).paths.length, 0);
  const hairline = editorInkPreviewGeometry({ paths: [[[0, 0], [10, 4]]], strokeWidth: 0 }, .5).paths[0];
  assert.equal(hairline["stroke-width"], .5); assert.equal(hairline["vector-effect"], "non-scaling-stroke", "a two-device-pixels-per-CSS-pixel display retains a device-pixel hairline");
  assert.equal(editorInkPreviewGeometry({ paths: [[[0, 0], [1, 2]]], color: [.1, .2, .3] }).paths[0].stroke, "rgb(25.5,51,76.5)", "fractional color channels retain their original precision");
  assert.throws(() => editorInkPreviewGeometry({ paths: [], strokeWidth: -1 }), RangeError);
  assert.throws(() => editorInkPreviewGeometry({ paths: [], opacity: 2 }), RangeError);
  assert.throws(() => editorInkPreviewGeometry({ paths: [] }, 0), RangeError);

  // A camera-only frame can inspect path lengths/endpoints but never iterate
  // the full capture or refit it. Appending a sample invalidates just this ink.
  let iterations = 0;
  const samples = new Proxy([[0, 0], [10, 20], [20, 0]], { get(target, key, receiver) {
    if (key === Symbol.iterator) iterations++; return Reflect.get(target, key, receiver);
  } });
  const cache = createEditorInkPreviewCache(), input = { paths: [samples], smoothing: .1 };
  const first = cache.get(input), fittedIterations = iterations;
  assert(fittedIterations > 0);
  assert.equal(cache.get({ ...input, color: "red", strokeWidth: 12 }).paths.at(-1).d, first.paths.at(-1).d);
  assert.equal(iterations, fittedIterations, "style and camera updates reuse fitted local geometry");
  samples.push([30, 10]); const appended = cache.get(input); assert(iterations > fittedIterations);
  assert.notEqual(appended.paths.at(-1).d, first.paths.at(-1).d);
  const afterAppend = iterations; samples.at(-1)[1] = 12; cache.get(input); assert(iterations > afterAppend, "updating the final captured endpoint also invalidates fitting");
  const afterEndpoint = iterations; cache.get({ ...input, smoothing: .2 }); assert(iterations > afterEndpoint, "tolerance changes refit the active capture");
  const replacement = structuredClone(Array.from(samples)); replacement[1][1] = 40;
  assert.equal(cache.get({ ...input, paths: [replacement] }).paths.at(-1).d, editorInkPreviewGeometry({ ...input, paths: [replacement] }).paths.at(-1).d,
    "replaced paths can edit interior geometry without relying on pointer sample counts");

  const map = (matrix, point) => [matrix[0] * point[0] + matrix[2] * point[1] + matrix[4], matrix[1] * point[0] + matrix[3] * point[1] + matrix[5]];
  for (const object of [identity, [0, 2, -3, 0, 10, -20], [1, .3, .2, -.8, -40, 80]]) {
    for (const camera of [[1, 0, 0, -1, 500, 200], [2, .5, -.8, -3, 1300, -400], [.25, -.2, -.3, -.25, 800, 900]]) {
      const page = [1200, -450], overlay = { x: 127, y: 43 }, project = (x, y) => { const [px, py] = map(camera, [x, y]); return { x: px, y: py }; };
      const matrix = editorInkPreviewTransform(object, page, project, overlay); assert(matrix);
      for (const point of [[0, 0], [20, 40], [-10, 300]]) {
        const transformed = map(object, point), expected = project(page[0] + transformed[0], page[1] + transformed[1]), actual = map(matrix, point);
        close(actual[0], expected.x - overlay.x, "page/object/camera X"); close(actual[1], expected.y - overlay.y, "page/object/camera Y");
      }
    }
  }
  assert.equal(editorInkPreviewTransform(identity, [0, 0], () => null, { x: 0, y: 0 }), null);
  assert.equal(editorInkPreviewTransform(identity, [0, 0], () => ({ x: NaN, y: 0 }), { x: 0, y: 0 }), null);
  assert.equal(editorInkPreviewTransform(identity, [0, 0], (x, _y) => ({ x, y: 0 }), { x: 0, y: 0 }), null, "edge-on projections cannot produce an actionable preview plane");
  console.log("Ink preview: exact committed curve/width/opacity/fill parity, taps, device hairlines, bounded live fitting cache and page/object/camera affine projection passed.");
} finally { hooks.deregister(); }
