import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { editorShapeGeometry, editorArrowHeadPoints } = await import("../src/editorShapeGeometry.ts");
  const { editorShapePreviewGeometry, createEditorShapePreviewCache } = await import("../src/editorShapePreview.ts");
  const { compileEditorObjectGeometry, editorArrowHeadPoints: compatibilityArrowhead } = await import("../src/editorSceneObjects.ts");
  const { getScenePrimitive } = await import("../src/scenePrimitives.ts");
  assert.equal(compatibilityArrowhead, editorArrowHeadPoints, "existing interaction imports retain the shared arrowhead helper");
  const fixture = (shape, extra = {}) => ({ kind: "shape", id: "fixture", pageIndex: 0, transform: [1, 0, 0, 1, 0, 0],
    shape, x: 10, y: 20, width: 90, height: 55, color: "#369", fill: "#abc", strokeWidth: 3.25, opacity: .6, fillOpacity: .2, ...extra });
  const cases = Object.fromEntries(["rectangle", "ellipse", "line", "arrow", "polygon", "polyline"].map(shape => [shape,
    fixture(shape, shape === "polygon" || shape === "polyline" ? { points: [[10, 20], [35, 80], [90, 35], [50, 10]] } : {})]));
  cases.reverseArrow = fixture("arrow", { points: [[100, 70], [-10, 25]], strokeWidth: 8 });
  cases.degenerateRectangle = fixture("rectangle", { height: 0 });
  cases.degenerateEllipse = fixture("ellipse", { width: 0, height: 0 });
  cases.hairline = fixture("line", { strokeWidth: 0, fill: null });
  cases.repeatedPolygon = fixture("polygon", { points: [[10, 20], [10, 20], [60, 20], [60, 50], [10, 20]] });

  // Captured before extracting the shared geometry. Changes to the preview
  // must not silently alter any committed scene buffers, paint runs or bounds.
  const originalHashes = {
    rectangle: "b883c4bcf04c5452e51611652c0f5c014956e57ce0472fb3312ff7c89d19a095",
    ellipse: "ba36054b956ff26f17c56edaebd9593448332c37dc180dcaa4bed7967614e003",
    line: "35d202c2ca6325165e878ccb50aa4f4904f1dc729eefd8a44cb17e928956e9b9",
    arrow: "08e1e0106ceb319ee1fc0e18548d99c9d7f2097c1cf4ae442e3af48e4a8eaaf7",
    polygon: "a5fc4d8f757b588d5dc7a482c848c290a8bbc05b1f99e88fc6a4dd4246eb131b",
    polyline: "7aa53f55f5cef5bdde1787559498a6844b2833fcf7efb266efddb3866fa10d04",
    reverseArrow: "fd193a885124e5ce1105f25e6414b6c32d906f4ca68cbd2975dcfeb7250aa1c4",
    degenerateRectangle: "5c55e5ca25d60973b54d6f56dcb2c5b34aee439eee86f7c75193bea8043e6184",
    degenerateEllipse: "979b21e77d2c1d1a0616bdbd34438c31b3b1fe32de380d2c9039b752a098fa00",
    hairline: "0fa81398fb75e3b0bf1e04eb34e2fb4953e8d08826d120abed62d04a8fb6ab81",
    repeatedPolygon: "05eba7074a11348efc10c819e7efdd8438e2a144960f6b34d8b0656bf34a8211"
  };
  function segments(path) {
    const tokens = path.match(/[MLZ]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? [], result = [];
    let current, start;
    for (let index = 0; index < tokens.length;) {
      const command = tokens[index++];
      if (command === "M") current = start = [Number(tokens[index++]), Number(tokens[index++])];
      else if (command === "L") { const end = [Number(tokens[index++]), Number(tokens[index++])]; result.push([...current, ...end]); current = end; }
      else if (command === "Z") { result.push([...current, ...start]); current = start; }
      else assert.fail(`Unexpected path command ${command}`);
    }
    return result;
  }
  const primitiveSegments = primitive => Array.from({ length: primitive.segmentCount }, (_, index) => {
    const { start, end, control } = primitive.getSegment(index); assert.equal(control, undefined); return [start.x, start.y, end.x, end.y];
  });
  const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} vs ${expected}`);

  for (const [name, input] of Object.entries(cases)) {
    const scene = await compileEditorObjectGeometry(input), serial = JSON.stringify(scene, (_key, value) => ArrayBuffer.isView(value) ? Array.from(value) : value);
    assert.equal(createHash("sha256").update(serial).digest("hex"), originalHashes[name], `${name}: shared geometry leaves committed output unchanged`);
    const preview = editorShapePreviewGeometry(input, .5), stroke = preview.paths.find(path => path.stroke !== "none"), fills = preview.paths.filter(path => path.stroke === "none");
    assert.deepEqual(stroke ? segments(stroke.d) : [], Array.from({ length: scene.segmentCount }, (_, index) => primitiveSegments(getScenePrimitive(scene, { kind: "stroke", index }))[0]), `${name}: preview uses exactly the committed stroke segments`);
    assert.equal(fills.length, scene.fillPathCount);
    for (let index = 0; index < fills.length; index++) {
      const primitive = getScenePrimitive(scene, { kind: "fill", index });
      assert.deepEqual(segments(fills[index].d), primitiveSegments(primitive), `${name}: preview uses exactly the committed fill edges`);
      near(fills[index]["fill-opacity"], primitive.opacity, `${name}: fill opacity`); assert.equal(fills[index]["fill-rule"], "nonzero");
    }
    if (stroke) {
      assert.equal(stroke["stroke-linecap"], "round"); assert.equal(stroke["stroke-linejoin"], "round");
      assert.equal(stroke.stroke, "rgb(51,102,153)"); assert.equal(stroke["stroke-opacity"], .6);
      assert.equal(stroke["stroke-width"], input.strokeWidth || .5);
      assert.equal(stroke["vector-effect"], input.strokeWidth === 0 ? "non-scaling-stroke" : undefined);
      for (let index = 0; index < scene.segmentCount; index++) {
        const style = getScenePrimitive(scene, { kind: "stroke", index }).getSegmentStyle(0);
        near(style.strokeWidth, input.strokeWidth, `${name}: local pen width`); near(style.opacity, .6, `${name}: stroke opacity`);
        assert.equal(style.roundCap, true);
      }
    }
    assert.deepEqual(preview.paths.map(path => path.stroke === "none" ? "fill" : "stroke"),
      [...Array(scene.fillPathCount).fill("fill"), ...(scene.segmentCount ? ["stroke"] : [])], `${name}: matching paint order`);
  }

  assert.equal(editorShapeGeometry(cases.rectangle).closed, true);
  assert.equal(editorShapeGeometry(cases.ellipse).closed, true);
  assert.equal(editorShapeGeometry(cases.polygon).closed, true);
  assert.equal(editorShapeGeometry(cases.polyline).closed, false);
  const polyline = editorShapePreviewGeometry(cases.polyline);
  assert(polyline.paths[0].d.endsWith(" Z"), "an optional polyline fill retains the existing implicitly closed fill area");
  assert(!polyline.paths.at(-1).d.endsWith(" Z"), "the polyline stroke remains open");
  assert.equal(editorShapePreviewGeometry({ ...cases.line, points: [[4, 7], [4, 7]] }).paths.length, 0, "zero-length shape lines are discarded just as the stroke builder discards them");
  assert.equal(editorShapePreviewGeometry(fixture("polygon", { points: [[4, 7]] })).paths.length, 0);
  assert.equal(editorShapePreviewGeometry({ ...cases.arrow, fill: null }).paths[0]["fill-opacity"], .6, "arrowheads use stroke opacity even without an optional fill");
  assert.equal(editorShapePreviewGeometry({ ...cases.arrow, fill: "red", fillOpacity: 0 }).paths[0].fill, "rgb(51,102,153)");
  const { fillOpacity: _fillOpacity, ...legacy } = cases.rectangle;
  assert.equal(editorShapePreviewGeometry(legacy).paths[0]["fill-opacity"], .6);

  for (const end of [[100, 75], [-20, 75], [-20, -30], [100, -30], [10, 75], [10, -30], [100, 20], [-20, 20]]) {
    for (const shape of ["line", "arrow"]) {
      const points = [[10, 20], end], input = fixture(shape, { x: Math.min(10, end[0]), y: Math.min(20, end[1]),
        width: Math.abs(end[0] - 10), height: Math.abs(end[1] - 20), points, fill: null });
      assert.deepEqual(segments(editorShapePreviewGeometry(input).paths.at(-1).d), [[10, 20, ...end]], `${shape}: directed endpoints survive every reverse-drag quadrant`);
      if (shape === "arrow") assert.deepEqual(segments(editorShapePreviewGeometry(input).paths[0].d)[0].slice(0, 2), end, "the arrowhead tip follows the actual directed endpoint");
    }
    for (const shape of ["rectangle", "ellipse"]) {
      const input = fixture(shape, { x: Math.min(10, end[0]), y: Math.min(20, end[1]), width: Math.abs(end[0] - 10), height: Math.abs(end[1] - 20) });
      const geometry = editorShapeGeometry(input);
      assert(geometry.paths[0].every(([x, y]) => x >= input.x - 1e-6 && x <= input.x + input.width + 1e-6 && y >= input.y - 1e-6 && y <= input.y + input.height + 1e-6));
    }
  }
  assert.throws(() => editorShapeGeometry(cases.ellipse, AbortSignal.abort()), { name: "AbortError" });
  assert.throws(() => editorShapePreviewGeometry({ ...cases.rectangle, strokeWidth: -1 }), RangeError);
  assert.throws(() => editorShapePreviewGeometry({ ...cases.rectangle, strokeWidth: 1e40 }), RangeError);
  assert.throws(() => editorShapePreviewGeometry({ ...cases.rectangle, opacity: 2 }), RangeError);
  assert.throws(() => editorShapePreviewGeometry(cases.rectangle, 0), RangeError);

  const cache = createEditorShapePreviewCache(), originalCos = Math.cos; let trigCalls = 0;
  Math.cos = value => { trigCalls++; return originalCos(value); };
  try {
    cache.get(cases.ellipse); assert(trigCalls > 10); const initial = trigCalls;
    const styled = cache.get({ ...cases.ellipse, color: "red", strokeWidth: 20, fillOpacity: .7 });
    assert.equal(trigCalls, initial, "camera and styling updates do not repeat ellipse tessellation"); assert.equal(styled.paths.at(-1)["stroke-width"], 20);
    cache.get({ ...cases.ellipse, width: 120 }); assert(trigCalls > initial, "resizing an ellipse invalidates its outline cache");
  } finally { Math.cos = originalCos; }
  const arrowCache = createEditorShapePreviewCache(), narrow = arrowCache.get(cases.arrow), wide = arrowCache.get({ ...cases.arrow, strokeWidth: 12 });
  assert.notEqual(narrow.paths[0].d, wide.paths[0].d, "arrowhead size is part of the geometry cache key");
  const points = [[0, 0], [10, 10]], capture = fixture("polyline", { points, fill: null }), captureCache = createEditorShapePreviewCache();
  const first = captureCache.get(capture); points.push([20, 0]); const appended = captureCache.get(capture);
  assert.notEqual(first.paths.at(-1).d, appended.paths.at(-1).d);
  points.at(-1)[0] = 30; assert.notEqual(captureCache.get(capture).paths.at(-1).d, appended.paths.at(-1).d);
  assert.equal(captureCache.get({ ...capture, points: [[0, 0], [10, 20], [30, 0]] }).paths.at(-1).d, "M0 0 L10 20 L30 0");
  console.log("Shape previews: unchanged committed scene hashes, all shape/stroke/fill vertices, ellipse tessellation, directed arrows, degenerate paths, opacity, hairlines and outline caches passed.");
} finally { hooks.deregister(); }
