import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { WebGpuFloorplanRenderer } = await import("../src/webGpuFloorplanRenderer.ts");
  const layer = value => ({ width: 1, height: 1, data: new Uint8Array([value, 0, 0, 255]), matrix: new Float32Array([1, 0, 0, 1, 0, 0]), opacity: 0.5 });
  for (const [Renderer, resident, slots] of [[WebGlFloorplanRenderer, "rasterTextureResidencyEnabled", "rasterLayers"],
    [WebGpuFloorplanRenderer, "rasterTextureResidency", "rasterLayerResources"]]) {
    let allocations = 0, releases = 0, frames = 0;
    const texture = () => ({ id: ++allocations, destroy() { releases++; } });
    const source = createEmptyVectorScene(); source.rasterLayers = [layer(10)];
    const instance = Object.assign(Object.create(Renderer.prototype), {
      scene: source, isDisposed: false, [resident]: true, [slots]: [], rasterLayerUpdates: new Map(),
      gl: { getParameter: () => 128, bindTexture() {}, texParameteri() {}, texImage2D() {}, generateMipmap() {}, deleteTexture(t) { t.destroy(); } },
      mustCreateTexture: texture, maxTextureSize: () => 128,
      createRasterLayerResource: () => ({ texture: texture(), uniformBuffer: { destroy() {} } }),
      destroyVectorMinifyResources() {}, requestFrame() { frames++; }
    });
    const replacement = layer(20), input = new Map([[0, replacement]]);
    const staged = instance.prepareRasterLayerUpdates(input);
    assert.equal(allocations, 1); assert.equal(instance.getRasterLayerUpdates().size, 0);
    input.clear(); staged.commit(); staged.dispose();
    assert.equal(instance.getRasterLayerUpdates().get(0), replacement, "batch contents captured before commit");
    assert.equal(source.rasterLayers[0].data[0], 10, "source pixels unchanged");
    assert.equal(frames, 1);
    const beforeInvalid = allocations;
    assert.throws(() => instance.prepareRasterLayerUpdates(new Map([[0, layer(30)], [9, layer(30)]])), RangeError);
    assert.equal(allocations, beforeInvalid, "whole batch validated before allocating resources");
    assert.throws(() => instance.prepareRasterLayerUpdates(new Map([[0, { ...layer(30), opacity: NaN }]])), RangeError);
    const cancelled = instance.prepareRasterLayerUpdates(new Map([[0, layer(40)]]));
    cancelled.dispose(); assert.equal(releases, 1); assert.equal(instance.getRasterLayerUpdates().get(0), replacement);
    const dormant = instance.prepareRasterLayerUpdates(new Map([[0, layer(50)]]));
    instance[resident] = false; dormant.commit();
    assert.equal(releases, 2, "staged resources released if backend becomes dormant");
    const beforeWake = allocations;
    const waking = instance.prepareRasterLayerUpdates(new Map([[0, layer(60)]]));
    assert.equal(allocations, beforeWake, "dormant preparation does not allocate textures");
    instance[resident] = true; waking.commit();
    assert.equal(allocations, beforeWake + 1, "residency restored before commit uploads replacement");
    assert.equal(instance.getRasterLayerUpdates().get(0).data[0], 60);
    const stale = instance.prepareRasterLayerUpdates(new Map([[0, layer(70)]]));
    instance.scene = createEmptyVectorScene();
    assert.throws(() => stale.commit(), error => error.name === "AbortError"); stale.dispose();
    assert.equal(instance.getRasterLayerUpdates().get(0).data[0], 60, "old document cannot commit replacement");
  }
  console.log("Native raster updates passed: atomic batches, source preservation, cancellation, residency transitions, stale documents.");
} finally { hooks.deregister(); }
