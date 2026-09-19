import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
    return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
} });

try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { ThreePaintCompositor } = await import("../src/threePaintCompositor.ts");
  const { ThreeMaterialStrokeLayer } = await import("../src/threeMaterialStrokeLayer.ts");
  const { ThreeMaterialRasterLayer } = await import("../src/threeMaterialRasterLayer.ts");
  const { setThreePdfShapeOnly } = await import("../src/threePdfShape.ts");
  const f = values => Float32Array.from(values);
  const scene = Object.assign(createEmptyVectorScene(), {
    pageRects: f([0, 0, 10, 10]), pageBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, segmentCount: 2, maxHalfWidth: 1,
    endpoints: f([1, 2, 0, 0, 1, 4, 0, 0]), primitiveMeta: f([9, 2, 0, 0.5, 9, 4, 0, 0]),
    styles: f([1, 1, 0, 0, 1, 0, 0, 1]), primitiveBounds: f([0, 0, 10, 3, 0, 3, 10, 5]),
    rasterLayers: [{ width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 128), matrix: f([10, 0, 0, -10, 0, 10]), opacity: 0.5 }],
    drawRuns: [{ kind: "stroke", first: 0, count: 2, blendMode: "Multiply" }, { kind: "raster", first: 0, count: 1 }],
    paintGraph: { roots: [{ kind: "group", isolated: true, knockout: true, alpha: 0.5, blendMode: "Normal",
      children: [{ kind: "draw", runIndex: 0 }, { kind: "draw", runIndex: 1 }] }] }
  });
  const original = scene.rasterLayers[0].data.slice();
  for (const backend of ["webgl", "webgpu"]) {
    const stroke = new ThreeMaterialStrokeLayer(scene, { materialBackend: backend,
      strokeCurveEnabled: true, vectorOverride: [0, 0, 0, 0] });
    const raster = new ThreeMaterialRasterLayer(scene, { materialBackend: backend, pageBackground: [1, 1, 1, 1] });
    const entry = raster.rasterEntries[0];
    const oldTexture = entry.texture;
    let oldDisposed = 0; oldTexture.addEventListener("dispose", () => oldDisposed++);
    const replacement = { width: 2, height: 1, data: Uint8Array.of(0, 255, 0, 255, 0, 0, 255, 128),
      matrix: f([8, 0, 0, -10, 2, 10]), opacity: 0.25 };
    const staged = raster.prepareRasterLayerUpdates(new Map([[0, replacement]]));
    assert.equal(entry.texture, oldTexture, "preparing must leave the presented texture intact");
    staged.commit(); staged.dispose(); staged.commit();
    assert.equal(oldDisposed, 1);
    assert.notEqual(entry.texture, oldTexture);
    assert.equal(entry.resident, false, "staging cannot wake a dormant renderer");
    assert.equal(entry.mesh.visible, false);
    assert.deepEqual([...entry.texture.image.data], [0, 255, 0, 255, 0, 0, 128, 128]);
    if (backend === "webgl") {
      assert.equal(entry.material.uniforms.uRasterTex.value, entry.texture);
      assert.equal(entry.material.uniforms.uRasterOpacity.value, 0.25);
      assert.deepEqual(entry.material.uniforms.uRasterMatrixEF.value.toArray(), [2, 10]);
    }
    const current = entry.texture;
    const cancelled = raster.prepareRasterLayerUpdates(new Map([[0, scene.rasterLayers[0]]]));
    cancelled.dispose(); cancelled.commit();
    assert.equal(entry.texture, current);
    assert.throws(() => raster.prepareRasterLayerUpdates(new Map([[0, scene.rasterLayers[0]], [3, replacement]])), /Invalid staged/);
    assert.equal(entry.texture, current, "an invalid batch cannot partly replace a texture");
    raster.setTextureResidency(true);
    assert.equal(entry.resident, true);
    const restoreShape = setThreePdfShapeOnly(entry.material, true);
    restoreShape();

    const compositor = new ThreePaintCompositor(backend);
    const host = makeRenderer(backend);
    const state = snapshot(host);
    const roots = [stroke.mesh, raster.group];
    compositor.render(host, scene, roots, 32, 24, () => true);
    assert.deepEqual(snapshot(host), state, "offscreen rendering restores all host state");
    assert.equal(compositor.mesh.visible, true);
    const strokes = host.draws.filter(draw => draw.ids);
    assert.deepEqual(strokes.map(draw => draw.ids), [[0], [0], [1], [1]], "knockout draws individual canonical primitive IDs");
    if (backend === "webgl") assert.deepEqual(strokes.map(draw => draw.shape), [0, 1, 0, 1]);
    assert.equal(stroke.mesh.children.length, 1, "the graph handles Multiply without legacy duplicate passes");
    assert.equal(stroke.mesh.children[0].geometry.instanceCount, 2, "subset draws cannot alter ordinary culling buffers");
    const surfaces = compositor.surfaces.size;
    host.draws.length = 0;
    compositor.render(host, scene, roots, 32, 24, () => true);
    assert.equal(compositor.surfaces.size, surfaces, "unchanged frames reuse render targets");

    // Mask transfer samples may exceed the GPU's maximum single-row texture width.
    const transfer = Float32Array.from({ length: 65536 }, (_, index) => index / 65535);
    const mask = compositor.transferTexture(transfer);
    assert.equal(mask.image.width, 1024);
    assert.equal(mask.image.height, 64);
    assert.equal(mask.image.data[65535], 1);

    host.fail = true;
    assert.throws(() => compositor.render(host, scene, roots, 32, 24, () => true), /synthetic draw failure/);
    assert.deepEqual(snapshot(host), state, "failure restores host state and shape uniforms");
    host.fail = false;
    const warn = console.warn;
    const warnings = [];
    console.warn = message => warnings.push(message);
    try { compositor.render(host, scene, roots, 16384, 16384, () => true); }
    finally { console.warn = warn; }
    assert.ok(compositor.width < 16384 && compositor.height < 16384,
      "large viewports lower transient surface resolution while preserving the PDF graph");
    assert.equal(warnings.length, 1);
    assert.deepEqual(snapshot(host), state);
    assert.deepEqual(scene.rasterLayers[0].data, original);
    compositor.dispose(); stroke.dispose(); raster.dispose();
    assert.throws(() => raster.prepareRasterLayerUpdates(new Map()), /disposed/);
  }
  console.log("Three PDF compositor state, canonical subsets, shape coverage, pooling, and staged raster updates passed");
} finally { hooks.deregister(); }

function makeRenderer(backend = "webgpu") {
  return {
    coordinateSystem: backend === "webgpu" ? THREE.WebGPUCoordinateSystem : THREE.WebGLCoordinateSystem,
    target: new THREE.RenderTarget(7, 9), viewport: new THREE.Vector4(3, 4, 17, 19),
    scissor: new THREE.Vector4(5, 6, 11, 13), scissorTest: true, clearColor: new THREE.Color(0.2, 0.3, 0.4),
    clearAlpha: 0.7, autoClear: true, xr: { enabled: true }, cube: 2, mip: 1, draws: [], fail: false,
    getRenderTarget() { return this.target; },
    setRenderTarget(target, cube = 0, mip = 0) { this.target = target; this.cube = cube; this.mip = mip; },
    getActiveCubeFace() { return this.cube; }, getActiveMipmapLevel() { return this.mip; },
    getViewport(out) { return out.copy(this.viewport); }, setViewport(value) { this.viewport.copy(value); },
    getScissor(out) { return out.copy(this.scissor); }, setScissor(value) { this.scissor.copy(value); },
    getScissorTest() { return this.scissorTest; }, setScissorTest(value) { this.scissorTest = value; },
    getClearColor(out) { return out.copy(this.clearColor); }, getClearAlpha() { return this.clearAlpha; },
    setClearColor(color, alpha) { this.clearColor.copy(color); this.clearAlpha = alpha; }, clear() {},
    render(scene, camera) {
      // Mirrors Renderer._updateCamera: the first render whose coordinate
      // system differs from the camera's rebuilds the projection. The abstract
      // THREE.Camera base class has no updateProjectionMatrix, so a compositor
      // built on it throws on its first composited WebGPU frame.
      assert.ok(camera?.isCamera, "the compositor renders through a camera");
      if (camera.coordinateSystem !== this.coordinateSystem) {
        camera.coordinateSystem = this.coordinateSystem;
        camera.updateProjectionMatrix();
      }
      if (this.fail) throw new Error("synthetic draw failure");
      for (const mesh of scene.children) {
        const ids = mesh.geometry.getAttribute("aSegmentIndex");
        this.draws.push({ ids: ids && Array.from({ length: mesh.geometry.instanceCount }, (_, i) => ids.getX(i)),
          shape: mesh.material.uniforms?.uPdfShapeOnly?.value });
      }
    }
  };
}
function snapshot(renderer) {
  return { target: renderer.target.uuid, viewport: renderer.viewport.toArray(), scissor: renderer.scissor.toArray(),
    scissorTest: renderer.scissorTest, color: renderer.clearColor.toArray(), alpha: renderer.clearAlpha,
    autoClear: renderer.autoClear, xr: renderer.xr.enabled, cube: renderer.cube, mip: renderer.mip };
}
