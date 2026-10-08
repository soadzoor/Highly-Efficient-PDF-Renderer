import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import * as THREE from "three";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const { ThreePaintCompositor } = await import("../src/threePaintCompositor.ts");
  const { enableThreeRawPaintFold, copyThreePaintFold } = await import("../src/threePaintFold.ts");
  const { RenderPerformanceProfiler } = await import("../src/renderPerformance.ts");
  const { withThreeRenderPerformance } = await import("../src/threeRenderPerformance.ts");
  const compositor = new ThreePaintCompositor("webgl");
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.RawShaderMaterial({ uniforms: { uVectorClipIndex: { value: 2 } }, toneMapped: false });
  enableThreeRawPaintFold(material);
  const clip = material.clone();
  clip.uniforms = { ...material.uniforms, uVectorClipIndex: { value: 7 } };
  copyThreePaintFold(material, clip);
  const proxy = makeProxy(material, geometry), clipProxy = makeProxy(clip, geometry);
  const target = new THREE.RenderTarget(16, 16);
  const mask = new THREE.Texture(), sourceA = new THREE.Texture(), sourceB = new THREE.Texture();
  const host = await makeHost();
  compositor.renderer = host;

  function queueDraws() {
    compositor.batch = { target, meshes: [], reads: new Set(), transparent: false, draws: 0 };
    compositor.batches.set(target, compositor.batch);
    compositor.queueProxy(proxy, geometry, false, { opacity: 0.25, mask: null });
    compositor.queueProxy(proxy, geometry, true, null);
    compositor.queueProxy(clipProxy, geometry, false, { opacity: 0.5, mask, content: { subtype: "Alpha", children: [] } });
    compositor.queueProxy(clipProxy, geometry, false, { opacity: 0.75, mask: null });
    compositor.queueProxy(proxy, geometry, false, null);
    for (const [material, texture, rect] of [[compositor.passMaterial, sourceA, [0, 0, 1, 1]],
      [compositor.passMaterial, sourceB, [-1, -1, 0, 0]], [compositor.blendMaterial, sourceA, [-0.5, -0.5, 0.5, 0.5]]]) {
      const entry = compositor.nextPassMesh();
      entry.mesh.material = material;
      entry.state.textures = Array.from({ length: compositor.bindings.length }, () => texture);
      entry.state.params.set(5, 0, 0, 0); entry.state.rect.fromArray(rect);
      compositor.enqueue(entry.mesh, true);
    }
  }
  function verifyDraws(draws) {
    assert.deepEqual(draws.slice(0, 5).map(draw => [draw.uVectorClipIndex, draw.uPdfShapeOnly, draw.uPaintFold[0]]),
      [[2, 0, 0.25], [2, 1, 1], [7, 0, 0.5], [7, 0, 0.75], [2, 0, 1]],
      "every draw uploads its own shape, clip and fold state, including shared inputs on clip clones");
    assert.equal(draws[2].uPaintMask, mask, "the folded mask sampler reaches the GPU");
    assert.deepEqual(draws.slice(5).map(draw => [draw.uSource, draw.uRect]),
      [[sourceA, [0, 0, 1, 1]], [sourceB, [-1, -1, 0, 0]], [sourceA, [-0.5, -0.5, 0.5, 0.5]]],
      "consecutive passes and material switches each upload their own sampler and rectangle");
    assert.equal(material.uniforms.uPdfShapeOnly.value, 0);
    assert.equal(material.uniforms.uPaintFold.value.x, 1, "draw cleanup restores shared source uniforms");
  }

  // A nested host render can follow the same material in the outer scene.
  // Three's camera change still refreshes the first private draw automatically.
  host.program.draw(new THREE.Camera(), new THREE.Scene(), geometry, material, proxy.source);
  const profiler = new RenderPerformanceProfiler(); profiler.start({ gpu: false, maxFrames: 1 }); profiler.beginFrame();
  queueDraws();
  withThreeRenderPerformance(profiler, () => compositor.flush(target));
  profiler.endFrame();
  verifyDraws(host.draws);
  assert.equal(host.uploads, 8, "each compositor draw traverses the uniform list exactly once");
  assert.equal(profiler.getReport().counters["three.glForcedUniformUploads"].total, 3);
  assert.equal(profiler.getReport().counters["three.glAutoUniformUploads"].total, 5);
  host.clearRecords(); queueDraws(); compositor.flush(target); verifyDraws(host.draws);
  assert.equal(host.uploads, 8, "a new host render forgets the preceding render's material");

  // WebGLRenderer's cache reset is skipped when rendering throws. The recovery
  // draw must upload even if its private camera/material are still current.
  host.clearRecords(); queueDraws(); host.failAfterDraw = 1;
  assert.throws(() => compositor.flush(target), /synthetic draw failure/);
  assert.equal(material.uniforms.uPaintFold.value.x, 1, "a failed hook sequence restores the fold");
  host.failAfterDraw = 0; host.clearRecords(); queueDraws();
  compositor.drawStates.get(compositor.batch.meshes[0]).fold.opacity = 0.125;
  compositor.flush(target);
  assert.equal(host.draws[0].uPaintFold[0], 0.125, "recovery uploads the changed first draw rather than stale cached values");
  assert.equal(host.uploads, 12, "one recovery render conservatively forces all uniforms");
  host.clearRecords(); queueDraws(); compositor.flush(target);
  assert.equal(host.uploads, 8, "automatic refresh resumes after the recovery render");

  // An arbitrary host implementing render need not provide Three's refresh
  // behavior; it retains the existing always-force protocol.
  host.isWebGLRenderer = false; host.clearRecords(); queueDraws(); compositor.flush(target);
  verifyDraws(host.draws);
  assert.equal(host.uploads, 13, "unknown hosts retain conservative forced uploads");
  compositor.renderer = null; compositor.dispose(); target.dispose(); geometry.dispose(); material.dispose(); clip.dispose();
  console.log("Three WebGL uniforms: installed setProgram semantics, per-draw shared state, one traversal and failure recovery passed");
} finally { hooks.deregister(); }

function makeProxy(material, geometry) {
  return { source: new THREE.Mesh(geometry, material), meshes: [], partialGeometries: [], frame: 0, uses: 0 };
}

async function makeHost() {
  // Execute the installed renderer's real setProgram implementation offline.
  // GPU resource creation and uniform uploads are the only substituted pieces.
  const source = await readFile(new URL("../node_modules/three/src/renderers/WebGLRenderer.js", import.meta.url), "utf8");
  const start = source.indexOf("function setProgram( camera, scene, geometry, material, object ) {");
  const end = source.indexOf("// If uniforms are marked as clean", start);
  assert.ok(start >= 0 && end > start, "installed renderer exposes the tested uniform-update path");
  assert.match(source, /_currentMaterialId = - 1;\s*_currentCamera = null;/,
    "successful host renders reset the cache assumed by the compositor");
  const program = { program: {}, getUniforms: () => ({ map: {}, setValue() {}, setOptional() {} }) };
  const entries = new WeakMap();
  let gpuUniforms = {}, uploadCount = 0, activeProgram = null;
  const getProperties = material => {
    let entry = entries.get(material);
    if (!entry) entries.set(material, entry = { __version: material.version, currentProgram: program, uniforms: material.uniforms,
      outputColorSpace: THREE.ColorManagement.workingColorSpace, envMap: null, needsLights: false,
      vertexAlphas: false, vertexTangents: false, morphTargets: false, morphNormals: false, morphColors: false,
      toneMapping: THREE.NoToneMapping, morphTargetsCount: 0, instancing: false, batching: false, skinning: false });
    return entry;
  };
  const snapshot = uniforms => Object.fromEntries(Object.entries(uniforms).map(([name, uniform]) =>
    [name, uniform.value?.toArray ? uniform.value.toArray() : uniform.value]));
  const dependencies = {
    _emptyScene: new THREE.Scene(), _gl: {}, _this: { outputColorSpace: THREE.SRGBColorSpace, toneMappingExposure: 1 },
    _currentRenderTarget: { texture: {} }, _clippingEnabled: false, _localClippingEnabled: false, _nodesHandler: null,
    _pixelRatio: 1, _height: 16, _vector3: new THREE.Vector3(),
    ColorManagement: THREE.ColorManagement, NoToneMapping: THREE.NoToneMapping,
    textures: { resetTextureUnits() {} }, environments: { get: () => null }, properties: { get: getProperties },
    currentRenderState: { state: { lights: { state: { version: 0 } }, lightProbeGridArray: [], transmissionRenderTarget: {} } },
    capabilities: { logarithmicDepthBuffer: false }, state: { useProgram(value) {
      const changed = activeProgram !== value; activeProgram = value; return changed;
    }, buffers: { depth: { getReversed: () => false } } },
    getProgram: material => getProperties(material).currentProgram,
    getUniformList: entry => Object.keys(entry.uniforms), materials: { refreshMaterialUniforms() {} },
    WebGLUniforms: { upload(_gl, _list, uniforms) { uploadCount++; gpuUniforms = snapshot(uniforms); } }
  };
  const factory = new Function("deps", `const {${Object.keys(dependencies).join(",")}} = deps;
    let _currentMaterialId = -1, _currentCamera = null;
    ${source.slice(start, end)}
    return { draw: setProgram, reset() { _currentMaterialId = -1; _currentCamera = null; } };`);
  const actualProgram = factory(dependencies);
  return {
    isWebGLRenderer: true, autoClear: false, target: null, draws: [], uploads: 0, failAfterDraw: 0, program: actualProgram,
    setRenderTarget(target) { this.target = target; }, setScissorTest() {},
    clearRecords() { this.draws = []; this.uploads = 0; uploadCount = 0; },
    render(scene, camera) {
      uploadCount = 0;
      for (const mesh of [...scene.children].sort((a, b) => a.renderOrder - b.renderOrder)) {
        mesh.onBeforeRender(this, scene, camera, mesh.geometry, mesh.material, null);
        actualProgram.draw(camera, scene, mesh.geometry, mesh.material, mesh);
        this.draws.push({ ...gpuUniforms }); this.uploads = uploadCount;
        if (this.failAfterDraw === this.draws.length) throw new Error("synthetic draw failure");
        mesh.onAfterRender(this, scene, camera, mesh.geometry, mesh.material, null);
      }
      actualProgram.reset();
    }
  };
}
