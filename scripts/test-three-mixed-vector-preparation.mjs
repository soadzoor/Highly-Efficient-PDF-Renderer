import assert from "node:assert/strict";
import * as THREE from "three";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const { compileThreeMixedVectorRoots } = await import("../src/threeMixedVectorPreparation.ts");
  const camera = new THREE.PerspectiveCamera();
  const create = () => {
    const data = new Map(), pipelines = new Map();
    const manager = { getForRender(object) {
      assert.equal(this, manager, "the pipeline manager retains its receiver");
      let pipeline = pipelines.get(object.material);
      if (!pipeline) { pipeline = {}; pipelines.set(object.material, pipeline); data.set(pipeline, { pipeline: {} }); }
      return pipeline;
    } };
    const host = { _pipelines: manager, backend: { get(pipeline) {
      assert.equal(this, host.backend, "the backend retains its receiver");
      return data.get(pipeline);
    } }, async compileAsync(scene) {
      assert.equal(this, host, "the compilation host retains its receiver");
      scene.traverse(object => {
        if (!object.isMesh) return;
        const pipeline = manager.getForRender(object);
        if (host.failure) data.set(pipeline, host.failure);
      });
      if (host.gate) await host.gate;
      if (host.rejection) throw host.rejection;
    } };
    return { host, manager, original: manager.getForRender, data, pipelines };
  };
  const root = () => new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  {
    const { host, manager, original } = create(), mesh = root();
    mesh.visible = false;
    await compileThreeMixedVectorRoots(host, camera, [mesh]);
    assert.equal(manager.getForRender, original, "successful preparation restores the host method");
    await compileThreeMixedVectorRoots(host, camera, [mesh]);
    assert.equal(manager.getForRender, original, "cached pipelines also verify and restore the host");
  }
  {
    const { host, manager, original } = create();
    host._pipelines = undefined;
    let initialized = 0;
    host.init = async function() {
      assert.equal(this, host, "initialization retains the host receiver");
      await Promise.resolve();
      initialized++;
      host._pipelines = manager;
    };
    await compileThreeMixedVectorRoots(host, camera, [root()]);
    assert.equal(initialized, 1, "a fresh WebGPU host initializes before pipeline observation");
    assert.equal(manager.getForRender, original);
    await compileThreeMixedVectorRoots(host, camera, [root()]);
    assert.equal(initialized, 1, "initialized hosts do not repeat initialization");
  }
  {
    const { host, manager, original } = create();
    host._pipelines = undefined;
    let finishInit, compileCount = 0;
    host.init = async () => {
      await new Promise(resolve => { finishInit = resolve; });
      host._pipelines = manager;
    };
    host.compileAsync = async () => { compileCount++; };
    const controller = new AbortController(), reason = new Error("disposed during host initialization");
    const preparing = compileThreeMixedVectorRoots(host, camera, [root()], controller.signal);
    const rejection = assert.rejects(preparing, error => error === reason);
    controller.abort(reason);
    finishInit(); await rejection;
    assert.equal(compileCount, 0, "disposal during host initialization never compiles borrowed resources");
    assert.equal(manager.getForRender, original, "aborted initialization never installs a pipeline observer");
  }
  {
    const { host, manager, original } = create();
    let finishCompile, settled = false;
    host.gate = new Promise(resolve => { finishCompile = resolve; });
    const controller = new AbortController(), reason = new Error("disposed during GPU compilation");
    const preparing = compileThreeMixedVectorRoots(host, camera, [root()], controller.signal);
    const rejection = assert.rejects(preparing, error => error === reason).then(() => { settled = true; });
    controller.abort(reason);
    await Promise.resolve();
    assert.equal(settled, false, "abort drains ongoing GPU compilation before borrowed geometry can be released");
    finishCompile(); await rejection;
    assert.equal(manager.getForRender, original, "aborted GPU preparation releases its pipeline observer after draining");
  }
  for (const failure of [{ error: true, pipeline: {} }, { pipeline: null }, {}]) {
    const { host, manager, original } = create();
    host.failure = failure;
    await assert.rejects(compileThreeMixedVectorRoots(host, camera, [root()]), /did not compile successfully/,
      "resolved Three compilation must not activate a failed or missing GPU pipeline");
    assert.equal(manager.getForRender, original);
  }
  {
    const { host, manager, original } = create();
    host.rejection = new Error("synthetic host rejection");
    await assert.rejects(compileThreeMixedVectorRoots(host, camera, [root()]), /synthetic host rejection/);
    assert.equal(manager.getForRender, original, "rejected host compilation restores its method");
  }
  {
    const { host, manager, original, data } = create();
    let releaseFirst, releaseSecond;
    host.gate = new Promise(resolve => { releaseFirst = resolve; });
    const first = compileThreeMixedVectorRoots(host, camera, [root()]);
    host.gate = new Promise(resolve => { releaseSecond = resolve; });
    const second = compileThreeMixedVectorRoots(host, camera, [root()]);
    const wrapper = manager.getForRender;
    // An unrelated material failing while these preparations overlap must not
    // disable the two optional materials being checked.
    data.set(manager.getForRender({ material: new THREE.MeshBasicMaterial() }), { error: true });
    releaseFirst(); await first;
    assert.equal(manager.getForRender, wrapper, "another preparation retains observation until it settles");
    releaseSecond(); await second;
    assert.equal(manager.getForRender, original, "the last preparation restores the exact original method");
  }
  await assert.rejects(compileThreeMixedVectorRoots({ compileAsync: async () => {} }, camera, [root()]), /cannot verify/);
  {
    const { host, manager, original } = create();
    host.compileAsync = async () => {};
    await assert.rejects(compileThreeMixedVectorRoots(host, camera, [root()]), /did not prepare a verifiable/);
    assert.equal(manager.getForRender, original);
  }
  console.log("Three mixed vector preparation: swallowed GPU failures, cached pipelines, overlapping preparation and host restoration passed.");
} finally { hooks.deregister(); }
