import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { normalizeMinimumStrokeWidth } from "../src/minimumStrokeWidth.ts";
import { readMinimumStrokeWidthValue } from "../src/uiControls.ts";
import { STROKE_MINIMUM_WIDTH_GLSL, STROKE_MINIMUM_WIDTH_WGSL,
  STROKE_COVERAGE_GLSL } from "../src/strokeCoverageShaders.ts";

// Evaluate the actual shader functions and integrate their ink in final device
// pixels. Supersampling must not shrink a one-pixel floor back below one pixel.
const body = source => source.slice(source.indexOf("{") + 1, source.lastIndexOf("}"));
const smoothstep = (a, b, value) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const coverage = new Function("smoothstep", "distanceValue", "halfWidth", "aaWorld",
  body(STROKE_COVERAGE_GLSL)).bind(null, smoothstep);
for (const source of [STROKE_MINIMUM_WIDTH_GLSL, STROKE_MINIMUM_WIDTH_WGSL]) {
  const resolve = new Function("max", "halfWidth", "localUnitsPerPixel", "minimumWidthPx", body(source)).bind(null, Math.max);
  for (const zoom of [1e-8, .001, .1, 1, 8, 128]) {
    for (const scale of [1, 2, 4]) {
      for (const minimumWidthPx of [0, .25, .5, 1, 10, 80]) for (const widthPx of [.001, .25, .75, 1, 3]) {
        const original = widthPx / zoom / 2, units = 1 / (zoom * scale);
        assert.equal(resolve(original, units, 0), original, "opt-out retains the exact source width");
        const halfWidth = resolve(original, units, minimumWidthPx * scale);
        const expectedWidth = Math.max(widthPx, minimumWidthPx);
        assert(Math.abs(halfWidth * zoom * 2 - expectedWidth) < 1e-12,
          "the floor measures final pixels independently of zoom and supersampling");
        const aa = .75 * units, extent = halfWidth + aa, steps = 4096;
        let ink = 0;
        for (let i = 0; i < steps; i++) {
          ink += coverage(Math.abs(-extent + (i + .5) * 2 * extent / steps), halfWidth, aa);
        }
        ink *= 2 * extent / steps * zoom;
        assert(Math.abs(ink - expectedWidth) < 1e-6 * Math.max(1, expectedWidth),
          `a ${widthPx}px stroke keeps ${expectedWidth}px of filtered ink at ${scale}x sampling`);
      }
    }
  }
}

for (const value of [undefined, false, true, 0, .05, .5, 1, 10, 1000]) {
  assert.equal(normalizeMinimumStrokeWidth(value), value === true ? 1 : value === false || value === undefined ? 0 : value);
}
for (const value of [-1, NaN, Infinity, -Infinity]) {
  assert.throws(() => normalizeMinimumStrokeWidth(value), RangeError);
}
for (const [value, expected] of [["", 0], ["0", 0], ["0.5", .5], ["10", 10], ["-1", 0], ["bad", 0]]) {
  assert.equal(readMinimumStrokeWidthValue({ value }), expected, "demo inputs support fractional and large widths and tolerate incomplete edits");
}

const hooks = registerHooks({ resolve(s, c, next) {
  return next(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const { WebGlPdfRenderer } = await import("../src/webGlPdfRenderer.ts");
  const { WebGpuPdfRenderer } = await import("../src/webGpuPdfRenderer.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { ThreeMaterialStrokeLayer } = await import("../src/threeMaterialStrokeLayer.ts");
  const { ThreeTriangleStrokeLayer } = await import("../src/threeTriangleStrokeLayer.ts");
  const { VectorStrokeLodRuntime } = await import("../src/vectorStrokeLodCore.ts");
  const { ThreeVectorDrawPlan } = await import("../src/threeVectorDrawPlan.ts");
  const paints = buildStrokeScene([-10, 10].map(y => ({
    points: [[-20, y], [20, y]], width: .1, color: "red"
  })));
  paints.pageRects = Float32Array.of(-100, -100, 100, 100);
  paints.fillPathCount = 1;
  paints.fillSegmentCount = 4;
  paints.fillPathMetaA = Float32Array.of(0, 4, -20, -1);
  paints.fillPathMetaB = Float32Array.of(20, 1, 0, 0);
  paints.fillPathMetaC = Float32Array.of(0, 0, 1, 1);
  paints.fillSegmentsA = Float32Array.of(-20, -1, -20, -1, 20, -1, 20, -1, 20, 1, 20, 1, -20, 1, -20, 1);
  paints.fillSegmentsB = Float32Array.of(20, -1, 0, 0, 20, 1, 0, 0, -20, 1, 0, 0, -20, -1, 0, 0);
  paints.drawRuns = [{ kind: "stroke", first: 0, count: 1 }, { kind: "fill", first: 0, count: 1 },
    { kind: "stroke", first: 1, count: 1 }];
  const plan = new ThreeVectorDrawPlan(paints);
  plan.update(1);
  assert.deepEqual([...plan.order], [0, 2, 1], "separated thin paints may batch equal colors");
  plan.setMinimumStrokeWidth(20);
  assert.deepEqual([...plan.order], [0, 1, 2], "widened overlapping colors preserve source paint order");
  const scene = buildStrokeScene([
    { points: [[0, -5], [0, 5]], width: .1 },
    { points: [[80, -5], [80, 5]], width: .1 }
  ]);
  const view = { cameraCenterX: 0, cameraCenterY: 0, zoom: 1 }, viewport = { width: 100, height: 100 };
  for (const Layer of [ThreeMaterialStrokeLayer, ThreeTriangleStrokeLayer]) {
    const layer = new Layer(scene, { strokeCurveEnabled: true, vectorOverride: [0,0,0,0] });
    try {
      assert.equal(layer.collectVisibleSegments(view, viewport, null, true), 1);
      layer.setMinimumStrokeWidth(100);
      const count = layer.collectVisibleSegments(view, viewport, null, true);
      assert(count < 0 || count === 2, "wide strokes remain visible when their centerlines lie outside the viewport");
    } finally { layer.dispose(); }
  }
  const runtime = new VectorStrokeLodRuntime(scene);
  runtime.setForceExact(true);
  runtime.updateForLocalUnitsPerPixel(1);
  runtime.update(view, viewport);
  assert.equal(runtime.getStats().renderedSegments, 1);
  runtime.setMinimumStrokeWidth(100);
  assert.equal(runtime.update(view, viewport), true, "a wider floor invalidates stationary LOD visibility caches");
  assert.equal(runtime.getStats().renderedSegments, 2, "LOD visibility includes shader-expanded strokes outside the viewport");
  for (const Renderer of [WebGlPdfRenderer, WebGpuPdfRenderer]) {
    let frames = 0, camera;
    const renderer = Object.assign(Object.create(Renderer.prototype), {
      minimumStrokeWidthPx: 0, zoom: .25, requestFrame: () => frames++,
      gpuDevice: { queue: { writeBuffer(_buffer, _offset, data) { camera = data; } } },
      cameraUniformBuffer: {}, vectorOverrideColor: [.1, .2, .3], vectorOverrideOpacity: .4,
      strokeCurveEnabled: true, strokeRenderingEnabled: true, fillRenderingEnabled: false,
      fillBandBase: 7, fillBandEntries: 11, gradientFillBandBase: 13, gradientFillBandEntries: 17,
      fillCellBase: 19, gradientFillCellBase: 23
    });
    for (const input of [0, .5, 10, true, false]) {
      const width = normalizeMinimumStrokeWidth(input);
      renderer.setMinimumStrokeWidth(input);
      for (const [baseZoom, scale] of [1e-8, .25, 128].flatMap(zoom => [1, 2, 4].map(scale => [zoom, scale]))) {
        renderer.zoom = baseZoom;
        const zoom = renderer.zoom * scale;
        if (Renderer === WebGlPdfRenderer) {
          assert.equal(renderer.minimumStrokeWidthPixels(zoom), width * scale);
        } else {
          renderer.updateCameraUniforms(800 * scale, 600 * scale, 0, 0, zoom, false);
          assert.equal(camera.byteLength, 112, "camera bindings accommodate the aligned width field");
          assert.equal(camera[24], width * scale);
          assert.deepEqual(Array.from(camera.slice(16, 24)), [7, 11, 13, 17, 20, 24, 1, 0],
            "changing width leaves fill indexing and mixed-paint visibility intact");
        }
      }
    }
    assert.equal(frames, 4, "runtime changes schedule a redraw without requiring camera motion");
    assert.throws(() => renderer.setMinimumStrokeWidth(-1), RangeError);
    assert.equal(renderer.minimumStrokeWidthPx, 0, "invalid widths leave the current setting unchanged");
  }
} finally { hooks.deregister(); }
console.log("Stroke minimum width: final-device-pixel coverage, opt-out, supersampling and native redraws passed.");
