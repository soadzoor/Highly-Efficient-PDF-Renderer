import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const { ThreePaintCompositor } = await import("../src/threePaintCompositor.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const webGpu = await import("../src/threeWebGpuBackend.ts");
  for (const backend of ["webgl", "webgpu"]) {
    for (const transparent of [false, true]) {
      const { scene, mesh, expected } = fixture(createEmptyVectorScene, 4, transparent);
      const compositor = new ThreePaintCompositor(backend, webGpu);
      const host = makeHost(compositor);
      compositor.render(host, scene, [mesh], 64, 64, () => true);
      assert.deepEqual(host.contents.get(compositor.output.texture), expected,
        `${backend}: deferred groups preserve the destination's paint order, transparent=${transparent}`);
      if (!transparent) assert.equal(host.renders, 5,
        "four independent group renders and one destination render replace nine host renders");
      const firstMeshes = new Set(host.meshes);
      host.meshes = []; host.renders = 0;
      compositor.render(host, scene, [mesh], 64, 64, () => true);
      assert.deepEqual(host.contents.get(compositor.output.texture), expected);
      assert.ok(host.meshes.every(mesh => firstMeshes.has(mesh)), "unchanged frames retain per-draw Three objects");
      const surfaces = compositor.surfaces.size;
      compositor.render(host, scene, [mesh], 64, 64, () => true);
      assert.equal(compositor.surfaces.size, surfaces, "surface retention settles after withholding the presented output");
      host.fail = true;
      assert.throws(() => compositor.render(host, scene, [mesh], 64, 64, () => true), /synthetic draw failure/);
      assert.equal(compositor.batches.size, 0, "a failed frame abandons every surface batch");
      assert.equal(host.target, null, "a failed frame restores the host target");
      host.fail = false;
      compositor.render(host, scene, [mesh], 64, 64, () => true);
      assert.deepEqual(host.contents.get(compositor.output.texture), expected, "the next frame recovers after a failed render");
      assert.equal(new Set(compositor.pool).size, compositor.pool.length, "failure does not recycle the same surface twice");
      compositor.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
    }

    // More independent inputs than the retention allowance must flush early,
    // preserving every queued pass's inputs before its surface is recycled.
    const { scene, mesh, expected } = fixture(createEmptyVectorScene, 24, false);
    const compositor = new ThreePaintCompositor(backend, webGpu), host = makeHost(compositor);
    compositor.render(host, scene, [mesh], 1024, 1024, () => true);
    assert.deepEqual(host.contents.get(compositor.output.texture), expected, "memory pressure preserves released inputs");
    assert.ok(host.renders > 25 && host.renders < 49, "memory pressure trades some batching for bounded storage");
    assert.ok(compositor.surfaces.size <= 11, "retention adds at most eight 4 MiB surfaces plus active/presented surfaces");

    // Mutating an input explicitly must finish every reader before the write.
    host.renders = 0;
    compositor.collect([mesh]); compositor.renderer = host;
    const source = compositor.acquire(), a = compositor.acquire(), b = compositor.acquire();
    compositor.clear(source); compositor.clear(a); compositor.clear(b);
    compositor.draw([{ kind: "fill", first: 0, count: 1 }], source, false);
    compositor.copy(source, a); compositor.copy(source, b);
    assert.equal(host.renders, 1, "both copies remain queued after rendering their common input");
    compositor.clear(source);
    assert.equal(host.renders, 3, "writing the common input first finishes both readers");
    assert.deepEqual(host.contents.get(a.texture), [0]);
    assert.deepEqual(host.contents.get(b.texture), [0]);
    compositor.release(source); compositor.release(a); compositor.release(b);
    compositor.renderer = null;
    compositor.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
  }
  console.log("Three surface batching: paint order, stable draw objects, bounded retention and read/write dependencies passed");
} finally { hooks.deregister(); }

function fixture(createEmptyVectorScene, groups, transparent) {
  const roots = [], runs = [], expected = [];
  const draw = () => {
    const index = runs.length;
    runs.push({ kind: "fill", first: index, count: 1 }); expected.push(index);
    return { kind: "draw", runIndex: index };
  };
  for (let index = 0; index < groups; index++) {
    roots.push(draw(), { kind: "group", isolated: true, knockout: false, alpha: 0.5,
      blendMode: "Normal", children: [draw(), draw()] });
  }
  roots.push(draw());
  const scene = Object.assign(createEmptyVectorScene(), { drawRuns: runs, paintGraph: { roots },
    fillPathCount: runs.length, fillPathMetaA: new Float32Array(runs.length * 4),
    fillPathMetaB: new Float32Array(runs.length * 4), fillPathMetaC: new Float32Array(runs.length * 4) });
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("aPaint", new THREE.InstancedBufferAttribute(Float32Array.from(expected), 1));
  geometry.instanceCount = expected.length;
  const mesh = new THREE.Mesh(geometry, new THREE.RawShaderMaterial({ transparent }));
  Object.assign(mesh.userData, { heprDrawRun: { kind: "fill", first: 0, count: expected.length },
    heprInstanceAttribute: "aPaint" });
  return { scene, mesh, expected };
}

// Track symbolic paint histories rather than pixel values: a copy snapshots
// its input, and an isolated source-over pass appends its group's paints.
function makeHost(compositor) {
  return {
    target: null, autoClear: true, xr: { enabled: true }, lighting: { enabled: true },
    viewport: new THREE.Vector4(), scissor: new THREE.Vector4(), scissorTest: false,
    color: new THREE.Color(), alpha: 0, contents: new Map(), renders: 0, meshes: [],
    getRenderTarget() { return this.target; }, setRenderTarget(target) { this.target = target; },
    getViewport(value) { return value.copy(this.viewport); }, setViewport(value) { this.viewport.copy(value); },
    getScissor(value) { return value.copy(this.scissor); }, setScissor(value) { this.scissor.copy(value); },
    getScissorTest() { return this.scissorTest; }, setScissorTest(value) { this.scissorTest = value; },
    getClearColor(value) { return value.copy(this.color); }, getClearAlpha() { return this.alpha; },
    setClearColor(value, alpha) { this.color.copy(value); this.alpha = alpha; },
    clear() { this.contents.set(this.target.texture, []); },
    render(scene, camera) {
      if (this.fail) throw new Error("synthetic draw failure");
      this.renders++;
      if (this.autoClear) this.clear();
      const meshes = [...scene.children].sort((a, b) =>
        Number(a.material.transparent) - Number(b.material.transparent) || a.renderOrder - b.renderOrder);
      for (const mesh of meshes) {
        this.meshes.push(mesh);
        mesh.onBeforeRender(this, scene, camera, mesh.geometry, mesh.material, null);
        const ids = mesh.geometry.getAttribute("aPaint");
        if (ids) {
          const history = this.contents.get(this.target.texture) ?? [];
          this.contents.set(this.target.texture, history.concat(Array.from(ids.array.subarray(0, mesh.geometry.instanceCount))));
        } else {
          const source = compositor.bindings[0].value;
          assert.notEqual(source, this.target.texture, "a pass never samples its own render attachment");
          const history = this.contents.get(source);
          assert.ok(history, "a pass reads a surface whose paints/clear have already rendered");
          const operation = compositor.params.x;
          assert.ok(operation === 5 || operation === 6, "the fixture uses copy and isolated source-over passes");
          this.contents.set(this.target.texture, operation === 5 ? [...history]
            : (this.contents.get(this.target.texture) ?? []).concat(history));
        }
        mesh.onAfterRender(this, scene, camera, mesh.geometry, mesh.material, null);
      }
    }
  };
}
