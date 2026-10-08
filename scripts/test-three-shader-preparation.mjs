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
  const { compileThreeMaterialRoots } = await import("../src/threeShaderPreparation.ts");
  const { ThreePaintCompositor } = await import("../src/threePaintCompositor.ts");
  const webGpu = await import("../src/threeWebGpuBackend.ts");
  const owner = new THREE.Scene(), root = new THREE.Group();
  owner.add(root); root.visible = false;
  const geometry = makeGeometry(3), equivalent = makeGeometry(9), clipped = makeGeometry(3);
  clipped.setAttribute("aVectorClipIndex", new THREE.InstancedBufferAttribute(new Float32Array(3), 1));
  const interleaved = makeGeometry(3);
  const buffer = new THREE.InterleavedBuffer(new Float32Array(20), 5);
  interleaved.setAttribute("position", new THREE.InterleavedBufferAttribute(buffer, 3, 0));
  interleaved.setAttribute("aCorner", new THREE.InterleavedBufferAttribute(buffer, 2, 3));
  const texture = new THREE.DataTexture(new Float32Array(4), 1, 1);
  texture.needsUpdate = true;
  const uniform = { value: 7 }, material = new THREE.RawShaderMaterial({ uniforms: {
    uValue: uniform, uTexture: { value: texture }
  } });
  const secondMaterial = new THREE.RawShaderMaterial();
  const sources = [
    new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material),
    new THREE.Mesh(equivalent, material), new THREE.Mesh(clipped, material),
    new THREE.Mesh(interleaved, material), new THREE.Mesh(geometry, [material, secondMaterial])
  ];
  for (const mesh of sources) {
    mesh.visible = false;
    mesh.onBeforeRender = () => assert.fail("shader preparation ran a paint callback");
    mesh.onAfterRender = () => assert.fail("shader preparation ran a paint restoration callback");
    root.add(mesh);
  }
  const materialCallback = material.onBeforeRender;
  const sourceCallbacks = sources.map(mesh => mesh.onBeforeRender);
  const parents = sources.map(mesh => mesh.parent);
  let disposals = 0;
  for (const resource of [geometry, equivalent, clipped, interleaved, material, secondMaterial, texture]) {
    resource.addEventListener("dispose", () => disposals++);
  }
  const versions = [geometry.getAttribute("aPaintIndex").version, texture.version];
  const camera = new THREE.PerspectiveCamera(); camera.layers.set(3);
  const targetScene = new THREE.Scene();
  let finishCompile, compilationScene, calls = 0;
  const host = { compileAsync(scene, compileCamera, target) {
    assert.equal(this, host, "compileAsync keeps its renderer receiver");
    calls++; compilationScene = scene;
    assert.equal(compileCamera, camera); assert.equal(target, targetScene);
    assert.equal(scene.isScene, undefined, "the target scene supplies the host's compilation cache context");
    assert.equal(scene.children.length, 4,
      "each material compiles once per vertex layout, including distinct clip and interleaved inputs");
    assert.deepEqual(new Set(scene.children.map(mesh => mesh.geometry)),
      new Set([geometry, clipped, interleaved]), "equivalent buffer contents share one compile layout");
    assert.deepEqual(new Set(scene.children.map(mesh => mesh.material)), new Set([material, secondMaterial]));
    for (const mesh of scene.children) {
      assert(!sources.includes(mesh), "compilation never reparents original paint meshes");
      assert.equal(mesh.visible, true); assert.equal(mesh.frustumCulled, false);
      assert(mesh.layers.test(camera.layers), "hidden paints compile for the supplied camera layer");
      mesh.onBeforeRender(); mesh.onAfterRender();
    }
    return new Promise(resolve => { finishCompile = resolve; });
  }, render() { assert.fail("shader preparation rendered a frame"); },
  initTexture() { assert.fail("shader preparation requested texture upload"); } };
  const pending = compileThreeMaterialRoots(host, camera, [root, sources[0]], { targetScene });
  assert.equal(calls, 1, "all cold programs are issued in one host compilation");
  assert.deepEqual(sources.map(mesh => mesh.parent), parents);
  assert.deepEqual(sources.map(mesh => mesh.onBeforeRender), sourceCallbacks);
  assert.equal(root.parent, owner); assert.equal(root.visible, false);
  assert.equal(material.uniforms.uValue, uniform); assert.equal(uniform.value, 7);
  assert.equal(material.uniforms.uTexture.value, texture); assert.equal(material.onBeforeRender, materialCallback);
  assert.deepEqual([geometry.getAttribute("aPaintIndex").version, texture.version], versions);
  finishCompile(); await pending;
  assert.equal(compilationScene.children.length, 0, "completed preparation releases its temporary scene tree");
  assert.equal(disposals, 0, "borrowed geometry, materials and textures remain alive");
  await compileThreeMaterialRoots({}, camera, [root]);
  await compileThreeMaterialRoots({ compileAsync() { assert.fail("an empty scene needs no compilation"); } }, camera, []);

  const aborted = new AbortController(), abortReason = new Error("cancel shader preparation");
  aborted.abort(abortReason);
  await assert.rejects(compileThreeMaterialRoots({ compileAsync() { assert.fail("cancelled loads do not compile"); } },
    camera, [root], { signal: aborted.signal }), error => error === abortReason);
  const controller = new AbortController();
  let rejectCompile, cancelledScene, cancellationSettled = false;
  const cancelled = compileThreeMaterialRoots({ compileAsync(scene) {
    cancelledScene = scene;
    return new Promise((_resolve, reject) => { rejectCompile = reject; });
  } }, camera, [root], { signal: controller.signal });
  const cancelledResult = assert.rejects(cancelled, error => error === abortReason)
    .then(() => { cancellationSettled = true; });
  controller.abort(abortReason);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancellationSettled, false, "cancellation drains queued GPU work before resources can be disposed");
  assert(cancelledScene.children.length > 0, "queued compiler meshes remain available while cancellation drains");
  rejectCompile(new Error("late compiler failure"));
  await cancelledResult;
  assert.equal(cancelledScene.children.length, 0);
  const compilationError = new Error("compiler failed");
  let failedScene;
  await assert.rejects(compileThreeMaterialRoots({ compileAsync(scene) {
    failedScene = scene; throw compilationError;
  } }, camera, [root]), error => error === compilationError);
  assert.equal(failedScene.children.length, 0, "failed compilation also releases temporary meshes");
  assert.equal(disposals, 0);

  for (const backend of ["webgl", "webgpu"]) {
    const compositor = new ThreePaintCompositor(backend, webGpu);
    const borrowed = compositor.getShaderCompileMeshes();
    assert.equal(borrowed.length, 3);
    assert.deepEqual(borrowed.map(mesh => mesh.material),
      [compositor.passMaterial, compositor.blendMaterial, compositor.mesh.material]);
    assert.equal(borrowed[0].geometry, compositor.quad);
    assert.equal(borrowed[1].geometry, compositor.quad);
    assert.equal(borrowed[2].geometry, compositor.mesh.geometry);
    assert(borrowed.every(mesh => mesh.parent === null));
    assert(borrowed.every(mesh => mesh !== compositor.mesh), "presentation compilation uses an inert stand-in");
    assert.equal(compositor.mesh.visible, false);
    assert.equal(compositor.surfaces.size, 0, "shader preparation does not allocate composite surfaces");
    const originalTarget = new THREE.RenderTarget(8, 8);
    let target = originalTarget, cube = 2, mip = 3, compileTarget, targetDisposals = 0, complete;
    const compileHost = {
      xr: { enabled: true }, lighting: { enabled: true },
      getRenderTarget: () => target, getActiveCubeFace: () => cube, getActiveMipmapLevel: () => mip,
      setRenderTarget(next, face = 0, level = 0) { target = next; cube = face; mip = level; },
      compileAsync(scene, compileCamera, targetScene) {
        assert.equal(this, compileHost);
        compileTarget = target;
        compileTarget.addEventListener("dispose", () => targetDisposals++);
        assert.equal(compileTarget.width, 1); assert.equal(compileTarget.height, 1);
        assert.equal(compileTarget.depthBuffer, false); assert.equal(compileTarget.stencilBuffer, false);
        assert.equal(compileTarget.texture.colorSpace, THREE.NoColorSpace);
        assert.equal(compileTarget.texture.type, THREE.UnsignedByteType);
        assert.equal(compileTarget.texture.minFilter, THREE.LinearFilter);
        assert.equal(compileTarget.texture.magFilter, THREE.LinearFilter);
        assert.equal(compileTarget.texture.generateMipmaps, false);
        assert.equal(compileHost.xr.enabled, false); assert.equal(compileHost.lighting.enabled, false);
        assert.equal(compileCamera, compositor.camera); assert.equal(targetScene, compositor.internalScene);
        assert.equal(compileCamera.coordinateSystem,
          backend === "webgpu" ? THREE.WebGPUCoordinateSystem : THREE.WebGLCoordinateSystem);
        assert.deepEqual(new Set(scene.children.map(mesh => mesh.material)),
          new Set([material, compositor.passMaterial, compositor.blendMaterial]),
          "paint and pass programs share the composite target; presentation uses the caller's target separately");
        return new Promise(resolve => { complete = resolve; });
      }, render() { assert.fail("compositor compilation rendered a pass"); }
    };
    const preparing = compositor.compileForRenderer(compileHost, [sources[0]]);
    assert.equal(target, originalTarget, "the render target is restored while compilation is pending");
    assert.equal(cube, 2); assert.equal(mip, 3);
    assert.equal(compileHost.xr.enabled, true); assert.equal(compileHost.lighting.enabled, true);
    assert.equal(targetDisposals, 0, "the compile target stays alive until host work settles");
    complete(); await preparing;
    assert.equal(targetDisposals, 1);
    assert.equal(compositor.surfaces.size, 0);
    const compositorAbort = new AbortController();
    const pendingAbort = compositor.compileForRenderer(compileHost, [sources[0]], compositorAbort.signal);
    const abortedResult = assert.rejects(pendingAbort, error => error === abortReason);
    compositorAbort.abort(abortReason);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(target, originalTarget);
    assert.equal(targetDisposals, 1, "an aborted compilation also drains before disposing its target");
    complete(); await abortedResult;
    assert.equal(targetDisposals, 2);
    let failedTarget;
    const failedHost = { ...compileHost, compileAsync() {
      failedTarget = target;
      failedTarget.addEventListener("dispose", () => targetDisposals++);
      throw compilationError;
    } };
    const failedPreparation = compositor.compileForRenderer(failedHost, [sources[0]]);
    assert.equal(target, originalTarget);
    assert.equal(failedHost.xr.enabled, true); assert.equal(failedHost.lighting.enabled, true);
    await assert.rejects(failedPreparation, error => error === compilationError);
    assert.equal(targetDisposals, 3, "a compiler error releases its temporary target");
    assert.notEqual(failedTarget, originalTarget);
    originalTarget.dispose();
    compositor.dispose();
  }
  for (const resource of [geometry, equivalent, clipped, interleaved, material, secondMaterial, texture]) resource.dispose();
  console.log("Three shader preparation: batched compilation, hidden layouts, inert borrowed resources, compositor programs and cancellation passed.");
} finally {
  hooks.deregister();
}

function makeGeometry(count) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
  geometry.setAttribute("aCorner", new THREE.BufferAttribute(new Float32Array(8), 2));
  geometry.setAttribute("aPaintIndex", new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  geometry.instanceCount = count;
  return geometry;
}
