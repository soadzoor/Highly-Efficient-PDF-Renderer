import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { TSL, WGSLNodeBuilder } from "three/webgpu";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const previousDocument = globalThis.document;
const signatures = new WeakMap();
globalThis.document = { createElement: () => ({ width: 1, height: 1, style: {}, getContext: () => null }) };

try {
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { createThreePdfObject } = await import("../src/threePdfObject.ts");
  for (const backend of ["webgl", "webgpu"]) {
    const scene = fixture(buildStrokeScene);
    let nativeView = { cameraCenterX: 5, cameraCenterY: 5, zoom: 3 };
    const native = new Proxy({
      getViewState: () => nativeView,
      setViewState: value => { nativeView = value; },
      getPresentedFrameSerial: () => 0,
      getTextLodStats: () => null,
      uploadScene: () => assert.fail("shader preparation must keep the native scene upload deferred"),
      ensureSceneUploaded: () => assert.fail("material compilation must not initialize the native scene"),
      renderExternalFrame: () => assert.fail("material compilation and presentation must not draw a native frame")
    }, { get: (target, key) => target[key] ?? (() => {}) });
    const object = await createThreePdfObject({ scene, sourceLabel: "shader preparation", sourceKind: "scene" },
      { rendererType: backend, vectorLod: "off", textLod: "off", threeColorCompositing: "display" },
      undefined, undefined, () => native, undefined, async () => {});
    const outer = new THREE.Scene(); outer.add(object);
    const camera = new THREE.OrthographicCamera(-6, 6, 5, -5, 0.1, 100);
    camera.coordinateSystem = backend === "webgpu" ? THREE.WebGPUCoordinateSystem : THREE.WebGLCoordinateSystem;
    camera.position.z = 10; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true); outer.updateMatrixWorld(true);
    const host = makeHost(backend);
    const originalTarget = host.target, originalCube = host.cube, originalMip = host.mip;
    const roots = object.listThreeMaterialObjects();
    const sourceMeshes = [];
    for (const root of roots) root.traverse(mesh => { if (mesh.isMesh) sourceMeshes.push(mesh); });
    const callbacks = sourceMeshes.map(mesh => mesh.onBeforeRender);
    sourceMeshes.forEach(mesh => { mesh.onBeforeRender = () => assert.fail("compilation invoked an original paint callback"); });
    let completeComposite, temporaryTarget, temporaryDisposals = 0;
    let startCompilation;
    const compilationStarted = new Promise(resolve => { startCompilation = resolve; });
    const compiled = new Set(), originalMaterials = new Set(sourceMeshes.map(mesh => mesh.material));
    host.compileAsync = function(scene, compileCamera, targetScene) {
      assert.equal(this, host);
      assert.equal(host.renders, 0, "both compilation contexts finish before the first host render");
      const phase = host.compiles.length;
      host.compiles.push({ scene, camera: compileCamera, target: host.target });
      assert(scene.children.length > 0);
      for (const mesh of scene.children) {
        assert(!sourceMeshes.includes(mesh), "the compiler receives inert stand-ins");
        assert.equal(mesh.visible, true); assert.equal(mesh.frustumCulled, false);
        mesh.onBeforeRender(); mesh.onAfterRender();
        compiled.add(shaderSignature(mesh, backend));
      }
      if (phase === 0) {
        temporaryTarget = host.target;
        temporaryTarget.addEventListener("dispose", () => temporaryDisposals++);
        assert.equal(temporaryTarget.width, 1); assert.equal(temporaryTarget.height, 1);
        assert.equal(temporaryTarget.depthBuffer, false); assert.equal(temporaryTarget.stencilBuffer, false);
        assert.equal(temporaryTarget.texture.colorSpace, THREE.NoColorSpace);
        assert.equal(targetScene, object.paintCompositor.internalScene);
        assert.equal(compileCamera, object.paintCompositor.camera);
        assert.equal(host.xr.enabled, false); assert.equal(host.lighting.enabled, false);
        assert(originalMaterials.size > 0);
        for (const material of originalMaterials) {
          assert(scene.children.some(mesh => mesh.material === material), "original paint programs are prepared");
        }
        assert(scene.children.some(mesh => mesh.material === object.paintCompositor.passMaterial));
        assert(scene.children.some(mesh => mesh.material === object.paintCompositor.blendMaterial));
        const compiling = new Promise(resolve => { completeComposite = resolve; });
        startCompilation();
        return compiling;
      }
      assert.equal(phase, 1, "one compilation prepares paints/passes and one prepares outer presentation");
      assert.equal(host.target, originalTarget); assert.equal(compileCamera, camera); assert.equal(targetScene, undefined);
      assert.equal(host.xr.enabled, true); assert.equal(host.lighting.enabled, true);
      assert.deepEqual(new Set(scene.children.map(mesh => mesh.material)),
        new Set([object.pageMesh.material, object.paintCompositor.mesh.material]));
      assert.equal(object.pageMesh.material.colorWrite, false);
      assert.equal(object.pageMesh.material.depthTest, true);
      assert.equal(object.pageMesh.material.depthWrite, true);
      assert.equal(object.paintCompositor.mesh.material.depthTest, false, "document presentation retains its screen-space depth state");
      return Promise.resolve();
    };
    const pending = object.compileForThreeRenderer(host, camera);
    await waitForCompilationStart(compilationStarted, pending);
    assert.equal(host.target, originalTarget, "the target is restored while asynchronous compilation is pending");
    assert.equal(host.cube, originalCube); assert.equal(host.mip, originalMip);
    assert.equal(host.xr.enabled, true); assert.equal(host.lighting.enabled, true);
    assert.equal(temporaryDisposals, 0, "the temporary target lives until the compiler settles");
    assert.equal(object.paintCompositor.surfaces.size, 0, "preparation does not allocate real document surfaces");
    assert(roots.every(root => root.parent === null), "composited paints stay outside the host scene");
    let demandReads = 0, demandCommits = 0, confirmDemandUpdate;
    const demandUpdated = new Promise(resolve => { confirmDemandUpdate = resolve; });
    const borrowedMeshesReleased = () => host.compiles.every(call => call.scene.children.length === 0);
    object.pageDemand = {
      getDisplayUpdate() {
        demandReads++;
        assert.equal(object.shaderPreparations, 0);
        assert(borrowedMeshesReleased(), "streaming updates cannot replace resources borrowed by the compiler");
        return { layers: new Map(), rasterPages: new Set() };
      },
      isDisplayUpdateCurrent: () => true
    };
    const originalPrepareRasters = object.rasterMaterialLayer.prepareRasterLayerUpdatesAsync;
    object.rasterMaterialLayer.prepareRasterLayerUpdatesAsync = async function(layers) {
      const staged = await originalPrepareRasters.call(this, layers);
      return { commit() {
        assert(borrowedMeshesReleased());
        demandCommits++;
        staged.commit();
      }, dispose() { staged.dispose(); } };
    };
    const onDemandUpdated = event => { if (event.reason === "pages-loaded") confirmDemandUpdate(); };
    object.addEventListener("change", onDemandUpdated);
    object.scheduleDemandUpdate();
    assert.equal(object.demandUpdatePending, true);
    assert.equal(object.demandUpdateTimer, null, "streaming transactions wait while shader compilation borrows resources");
    assert.equal(demandReads, 0); assert.equal(demandCommits, 0);
    completeComposite(); await pending;
    assert.equal(object.shaderPreparations, 0);
    assert.notEqual(object.demandUpdateTimer, null, "the deferred streaming update resumes after compilation settles");
    await waitForCompletion(demandUpdated, "deferred streaming update did not commit");
    assert.equal(demandReads, 1); assert.equal(demandCommits, 1);
    object.removeEventListener("change", onDemandUpdated);
    object.pageDemand = undefined;
    object.rasterMaterialLayer.prepareRasterLayerUpdatesAsync = originalPrepareRasters;
    assert.equal(temporaryDisposals, 1); assert.equal(host.compiles.length, 2);
    assert(host.compiles.every(call => call.scene.children.length === 0), "temporary compilation trees are cleared");
    assert.deepEqual(object.strokeMaterialLayer.viewportUniform.toArray(), [64, 48]);
    assert.equal(object.strokeMaterialLayer.useLocalToClipUniform.value, 1);
    assert.equal(object.strokeMaterialLayer.zoomUniform.value, nativeView.zoom);
    assert.equal(object.textMaterialLayer.curveUniform.value, 1);
    assert.equal(object.textMaterialLayer.vectorOnlyUniform.value, 0);
    sourceMeshes.forEach((mesh, index) => { mesh.onBeforeRender = callbacks[index]; });

    host.onMesh = mesh => {
      assert(compiled.has(shaderSignature(mesh, backend)),
        `${backend}: the first submitted geometry/material shader was prepared before rendering`);
    };
    object.prepareFrameForThreeRenderer(host, camera);
    assert(host.renders > 0, "the compiled object still renders its real transparency passes");
    assert.equal(host.target, originalTarget);
    assert.equal(object.paintCompositor.mesh.visible, true);
    assert.equal(object.getRenderedStrokeSegmentCount(), 2);
    assert.equal(object.renderer.hasUploadedScene(), false, "the native fallback remains dormant after presentation");
    assert.equal(object.pageMesh.material.depthWrite, true);

    host.compileAsync = () => assert.fail("unsupported or disposed objects must not compile");
    const aborted = new AbortController(), reason = new Error("cancelled shader preparation");
    aborted.abort(reason);
    await assert.rejects(object.compileForThreeRenderer(host, camera, aborted.signal), error => error === reason);
    const mismatched = { ...host, isWebGLRenderer: backend !== "webgl", isWebGPURenderer: backend !== "webgpu" };
    await object.compileForThreeRenderer(mismatched, camera);
    await object.compileForThreeRenderer({ ...host, compileAsync: undefined }, camera);
    if (backend === "webgpu") await object.compileForThreeRenderer({ ...host, outputColorSpace: THREE.SRGBColorSpace }, camera);
    object.dispose();
    await object.compileForThreeRenderer(host, camera);
    originalTarget.dispose();

    const multiScene = fixture(buildStrokeScene);
    multiScene.pageCount = 2;
    multiScene.pageRects = Float32Array.of(0, 0, 10, 10, 20, 0, 30, 10);
    multiScene.pageTextRanges = Uint32Array.of(0, 1, 1, 0);
    multiScene.bounds = multiScene.pageBounds = { minX: 0, minY: 0, maxX: 30, maxY: 10 };
    const multi = await createThreePdfObject({ scene: multiScene, sourceLabel: "page shader preparation", sourceKind: "scene" },
      { rendererType: backend, vectorLod: "off", textLod: "off", threeColorCompositing: "display" },
      undefined, undefined, () => native, undefined, async () => {});
    const pages = await multi.getPages();
    assert.equal(pages.length, 2);
    pages[1].position.z = 1;
    const pageHost = makeHost(backend), pageTarget = pageHost.target;
    pageHost.compileAsync = async function(scene, compileCamera) {
      assert.equal(this.renders, 0, "independent page preparation never submits page passes");
      this.compiles.push({ camera: compileCamera, target: this.target });
      for (const mesh of scene.children) { mesh.onBeforeRender(); mesh.onAfterRender(); }
    };
    await multi.compileForThreeRenderer(pageHost, camera);
    assert(pageHost.compiles.length >= 3, "moved pages prepare their independent pipelines");
    assert.equal(pageHost.target, pageTarget);
    assert.equal(pages[0].pageMesh.material.depthTest, true);
    assert.equal(pages[0].pageMesh.material.depthWrite, true);
    assert.equal(pages[0].pageMesh.material.polygonOffset, true);
    assert.equal(pages[0].paintCompositor.mesh.material.depthTest, true,
      "independent page presentation compiles with its projected page-plane depth");
    assert.equal(pages[0].paintCompositor.surfaces.size, 0);
    multi.dispose(); pageTarget.dispose();
  }
  console.log("Three PDF shader preparation: inert paint/presentation compilation, restored host state, first-frame shader coverage, deferred native resources and no-op compatibility passed.");
} finally {
  globalThis.document = previousDocument;
  hooks.deregister();
}

function fixture(buildStrokeScene) {
  const scene = buildStrokeScene([
    { points: [[1, 2], [9, 2]], width: 1, color: "red" },
    { points: [[1, 4], [9, 4]], width: 1, color: "blue" }
  ]);
  const f = values => Float32Array.from(values);
  const squareA = f([2, 5, 2, 5, 7, 5, 7, 5, 7, 8, 7, 8, 2, 8, 2, 8]);
  const squareB = f([7, 5, 0, 0, 7, 8, 0, 0, 2, 8, 0, 0, 2, 5, 0, 0]);
  const rectangle = (min, max) => ({ parent: -1, fillRule: 0, edges: f([
    min, min, max, min, max, min, max, max, max, max, min, max, min, max, min, min
  ]) });
  return Object.assign(scene, {
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, pageBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    pageRects: f([0, 0, 10, 10]), pageTextRanges: Uint32Array.of(0, 1),
    fillPathCount: 1, fillSegmentCount: 4, fillPathMetaA: f([0, 4, 2, 5]), fillPathMetaB: f([7, 8, 1, 0]),
    fillPathMetaC: f([0, 1, 0, 1]), fillSegmentsA: squareA, fillSegmentsB: squareB,
    textInstanceCount: 1, textGlyphCount: 1, textGlyphSegmentCount: 4,
    textInstanceA: f([1, 0, 0, 1]), textInstanceB: f([4, 4, 0, 0]), textInstanceC: f([0, 0, 0, 1]),
    textGlyphMetaA: f([0, 4, 2, 5]), textGlyphMetaB: f([7, 8, 0, 0]),
    textGlyphSegmentsA: squareA, textGlyphSegmentsB: squareB,
    clipPaths: [rectangle(0, 10), rectangle(2, 8)],
    rasterLayers: [{ width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 128), matrix: f([10, 0, 0, -10, 0, 10]), opacity: 0.5 }],
    drawRuns: [
      { kind: "stroke", first: 0, count: 1, clipIndex: 0 },
      { kind: "stroke", first: 1, count: 1, clipIndex: 1 },
      { kind: "fill", first: 0, count: 1, clipIndex: 0 },
      { kind: "text", first: 0, count: 1, clipIndex: 1 },
      { kind: "raster", first: 0, count: 1 }
    ],
    paintGraph: { roots: [{ kind: "group", isolated: true, knockout: false, alpha: 0.5, blendMode: "Normal",
      children: Array.from({ length: 5 }, (_, runIndex) => ({ kind: "draw", runIndex })) }] }
  });
}

function makeHost(backend) {
  return {
    isWebGLRenderer: backend === "webgl", isWebGPURenderer: backend === "webgpu", initialized: true,
    outputColorSpace: THREE.LinearSRGBColorSpace, capabilities: { maxTextureSize: 16384 },
    target: new THREE.RenderTarget(64, 48), cube: 2, mip: 3,
    viewport: new THREE.Vector4(0, 0, 64, 48), scissor: new THREE.Vector4(0, 0, 64, 48), scissorTest: false,
    clearColor: new THREE.Color(), clearAlpha: 1, autoClear: true, xr: { enabled: true }, lighting: { enabled: true },
    renders: 0, compiles: [],
    getRenderTarget() { return this.target; },
    setRenderTarget(target, cube = 0, mip = 0) { this.target = target; this.cube = cube; this.mip = mip; },
    getActiveCubeFace() { return this.cube; }, getActiveMipmapLevel() { return this.mip; },
    getViewport(target) { return target.copy(this.viewport); }, setViewport(value) { this.viewport.copy(value); },
    getScissor(target) { return target.copy(this.scissor); }, setScissor(value) { this.scissor.copy(value); },
    getScissorTest() { return this.scissorTest; }, setScissorTest(value) { this.scissorTest = value; },
    getClearColor(target) { return target.copy(this.clearColor); }, getClearAlpha() { return this.clearAlpha; },
    setClearColor(color, alpha) { this.clearColor.copy(color); this.clearAlpha = alpha; }, clear() {},
    getDrawingBufferSize: target => target.set(64, 48), getPixelRatio: () => 1,
    render(scene, camera) {
      this.renders++;
      for (const mesh of [...scene.children].sort((a, b) => a.renderOrder - b.renderOrder)) {
        if (!mesh.visible) continue;
        mesh.onBeforeRender(this, scene, camera, mesh.geometry, mesh.material, null);
        this.onMesh?.(mesh);
        mesh.onAfterRender(this, scene, camera, mesh.geometry, mesh.material, null);
      }
    }
  };
}

function shaderSignature(mesh, backend) {
  let known = signatures.get(mesh.material);
  if (!known) signatures.set(mesh.material, known = new Map());
  const layout = Object.keys(mesh.geometry.attributes).sort().map(name =>
    [name, mesh.geometry.getAttribute(name).itemSize, mesh.geometry.getAttribute(name).normalized]);
  const key = JSON.stringify(layout);
  if (known.has(key)) return known.get(key);
  const material = mesh.material;
  let source;
  if (backend === "webgl") {
    source = [material.type, material.vertexShader, material.fragmentShader, JSON.stringify(material.defines), material.customProgramCacheKey()];
  } else if (material.isNodeMaterial) {
    const renderer = {
      contextNode: TSL.context({}), library: { fromMaterial: value => value }, getRenderTarget: () => null, getMRT: () => null,
      backend: { compatibilityMode: false, utils: { getTextureSampleData: () => ({ primarySamples: 1 }) },
        capabilities: { getUniformBufferLimit: () => 65536 } },
      hasFeature: () => false, hasCompatibility: () => false, coordinateSystem: THREE.WebGPUCoordinateSystem,
      debug: { diagnostics: { keywords: false } }
    };
    const builder = new WGSLNodeBuilder(mesh, renderer);
    builder.scene = new THREE.Scene(); builder.camera = new THREE.PerspectiveCamera(); builder.build();
    source = [builder.vertexShader, builder.fragmentShader];
  } else {
    source = [material.type, material.colorWrite, material.depthTest, material.depthWrite];
  }
  const signature = createHash("sha256").update(JSON.stringify([source, layout])).digest("hex");
  known.set(key, signature);
  return signature;
}

async function waitForCompilationStart(started, pending) {
  await waitForCompletion(Promise.race([
    started,
    pending.then(() => assert.fail("shader preparation finished without reaching compilation"))
  ]), "shader preparation did not reach its compilation call");
}

async function waitForCompletion(promise, message) {
  let timeout;
  try {
    await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), 5000);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
