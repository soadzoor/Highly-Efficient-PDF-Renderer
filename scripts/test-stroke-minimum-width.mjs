import assert from "node:assert/strict";
import { registerHooks } from "node:module";
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
      for (const widthPx of [.001, .25, .75, 1, 3]) {
        const original = widthPx / zoom / 2, units = 1 / (zoom * scale);
        assert.equal(resolve(original, units, 0), original, "opt-out retains the exact source width");
        const halfWidth = resolve(original, units, scale);
        const expectedWidth = Math.max(widthPx, 1);
        assert(Math.abs(halfWidth * zoom * 2 - expectedWidth) < 1e-12,
          "the floor measures final pixels independently of zoom and supersampling");
        const aa = .75 * units, extent = halfWidth + aa, steps = 4096;
        let ink = 0;
        for (let i = 0; i < steps; i++) {
          ink += coverage(Math.abs(-extent + (i + .5) * 2 * extent / steps), halfWidth, aa);
        }
        ink *= 2 * extent / steps * zoom;
        assert(Math.abs(ink - expectedWidth) < 1e-6,
          `a ${widthPx}px stroke keeps ${expectedWidth}px of filtered ink at ${scale}x sampling`);
      }
    }
  }
}

const hooks = registerHooks({ resolve(s, c, next) {
  return next(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  for (const Renderer of [WebGlFloorplanRenderer, WebGpuFloorplanRenderer]) {
    let frames = 0, camera;
    const renderer = Object.assign(Object.create(Renderer.prototype), {
      minimumStrokeWidthEnabled: false, zoom: .25, requestFrame: () => frames++,
      gpuDevice: { queue: { writeBuffer(_buffer, _offset, data) { camera = data; } } },
      cameraUniformBuffer: {}, vectorOverrideColor: [.1, .2, .3], vectorOverrideOpacity: .4,
      strokeCurveEnabled: true, strokeRenderingEnabled: true, fillRenderingEnabled: false,
      fillBandBase: 7, fillBandEntries: 11, gradientFillBandBase: 13, gradientFillBandEntries: 17,
      fillCellBase: 19, gradientFillCellBase: 23
    });
    for (const enabled of [false, true, false]) {
      renderer.setMinimumStrokeWidth(enabled);
      for (const [baseZoom, scale] of [1e-8, .25, 128].flatMap(zoom => [1, 2, 4].map(scale => [zoom, scale]))) {
        renderer.zoom = baseZoom;
        const zoom = renderer.zoom * scale;
        if (Renderer === WebGlFloorplanRenderer) {
          assert.equal(renderer.minimumStrokeWidthPixels(zoom), enabled ? scale : 0);
        } else {
          renderer.updateCameraUniforms(800 * scale, 600 * scale, 0, 0, zoom, false);
          assert.equal(camera.byteLength, 112, "camera bindings accommodate the aligned width field");
          assert.equal(camera[24], enabled ? scale : 0);
          assert.deepEqual(Array.from(camera.slice(16, 24)), [7, 11, 13, 17, 20, 24, 1, 0],
            "changing width leaves fill indexing and mixed-paint visibility intact");
        }
      }
    }
    assert.equal(frames, 2, "runtime changes schedule a redraw without requiring camera motion");
  }
} finally { hooks.deregister(); }
console.log("Stroke minimum width: final-device-pixel coverage, opt-out, supersampling and native redraws passed.");
