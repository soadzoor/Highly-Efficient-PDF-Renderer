import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";

const hooks = registerHooks({ resolve(s, c, next) {
  return next(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { HeprThreePdfObject } = await import("../src/threePdfObject.ts");
  const { ThreeTextLodLayer } = await import("../src/textLodLayer.ts");
  const { ThreeMaterialTextLayer } = await import("../src/threeMaterialTextLayer.ts");
  const { ThreeMaterialStrokeLayer } = await import("../src/threeMaterialStrokeLayer.ts");
  const { ThreeMaterialFillLayer } = await import("../src/threeMaterialFillLayer.ts");
  const { ThreeMaterialRasterLayer } = await import("../src/threeMaterialRasterLayer.ts");
  const { ThreeMaterialGradientLayer } = await import("../src/threeMaterialGradientLayer.ts");
  const { ThreeVectorDrawPlan } = await import("../src/threeVectorDrawPlan.ts");
  const { sceneStrokeRecords } = await import("../src/strokeRecords.ts");
  const { RenderPerformanceProfiler } = await import("../src/renderPerformance.ts");
  const { withThreeRenderPerformance } = await import("../src/threeRenderPerformance.ts");
  const { sceneRequiresPaintCompositing } = await import("../src/scenePaintVisibility.ts");
  const count = 60_000, viewport = { width: 1000, height: 600 };
  const rectangle = (x0, y0, x1, y1) => ({ parent: -1, fillRule: 0,
    edges: Float32Array.of(x0,y0,x1,y0, x1,y0,x1,y1, x1,y1,x0,y1, x0,y1,x0,y0) });
  const scene = { ...createEmptyVectorScene(), textInstanceCount: count, textGlyphCount: 1, textGlyphSegmentCount: 4,
    textInstanceA: new Float32Array(count * 4), textInstanceB: new Float32Array(count * 4), textInstanceC: new Float32Array(count * 4),
    textGlyphMetaA: Float32Array.of(0,4,0,0), textGlyphMetaB: Float32Array.of(.7,1,0,0),
    textGlyphSegmentsA: Float32Array.of(0,0,0,0, .7,0,.7,0, .7,1,.7,1, 0,1,0,1),
    textGlyphSegmentsB: Float32Array.of(.7,0,0,0, .7,1,0,0, 0,1,0,0, 0,0,0,0),
    pageCount: 1, pageRects: Float32Array.of(-1,-1,501,241), pageTextRanges: Uint32Array.of(0,count),
    bounds: { minX: -1,minY: -1,maxX: 501,maxY: 241 },
    fillPathCount: 1, fillPathMetaA: Float32Array.of(0,0,5,0), fillPathMetaB: Float32Array.of(6,1,0,1), fillPathMetaC: Float32Array.of(1,0,0,1),
    clipPaths: [rectangle(-1,-1,9,241), rectangle(0,-1,501,241)],
    optionalContent: { groups: ["a", "b"].map(id => ({ id,name: id,defaultVisible: true,locked: false,usedInView: true })),
      conditions: ["a", "b"].map(groupId => ({ kind: "group",groupId })),order: [],radioGroups: [] },
    drawRuns: [{ kind: "text",first: 0,count: 17,clipIndex: 0,optionalContent: 0 },
      { kind: "fill",first: 0,count: 1 },
      { kind: "text",first: 17,count: 483,clipIndex: 0,optionalContent: 0 },
      { kind: "text",first: 500,count: count - 500,clipIndex: 1,optionalContent: 1 }] };
  scene.pageBounds = scene.bounds;
  for (let i = 0; i < count; i++) {
    scene.textInstanceA.set([1,0,0,1], i * 4);
    scene.textInstanceB.set([i % 500,Math.floor(i / 500) * 2,0,0], i * 4);
    scene.textInstanceC.set([0,0,0,1], i * 4);
  }
  const canonical = structuredClone(scene);
  function create(backend, mode, data = scene) {
    const plan = new ThreeVectorDrawPlan(data);
    const options = { drawPlan: plan,materialBackend: backend,colorCompositing: "display",strokeCurveEnabled: true,
      textVectorOnly: true,vectorOverride: [0,0,0,0],pageBackground: [1,1,1,1],rasterAtlasGlyphCount: data.textGlyphCount };
    const lod = ThreeTextLodLayer.create(data, sceneRequiresPaintCompositing(data) ? "off" : mode);
    const text = new ThreeMaterialTextLayer(lod.getRenderScene(), options);
    lod.releaseRenderSceneReference();
    let viewState = { zoom: .02,cameraCenterX: 250,cameraCenterY: 120 };
    const native = new Proxy({ getViewState: () => viewState,getPresentedViewState: () => viewState,hasUploadedScene: () => false,
      setViewState: value => { viewState = value; },getPresentedFrameSerial: () => 0,
      renderExternalFrame: () => assert.fail("the test must use Three material rendering") },
    { get: (target, key) => target[key] ?? (() => {}) });
    const uv = new Float32Array(8);
    const object = new HeprThreePdfObject({ sourceLabel: "ordered-text",sourceKind: "hep",scene: data }, backend,
      native,{ ...viewport },null,
      { vectorLodMode: "off",textLodMode: mode,strokeCurveEnabled: true,textVectorOnly: true,
        threeColorCompositing: "display",pageBackground: [1,1,1,1],vectorOverride: [0,0,0,0] },
      0,new ThreeMaterialRasterLayer(data,options),new ThreeMaterialGradientLayer(data,options),
      new ThreeMaterialFillLayer(data,options),new ThreeMaterialStrokeLayer(data,options),null,null,null,text,lod,
      new THREE.Mesh(new THREE.PlaneGeometry(502,242),new THREE.MeshBasicMaterial()),uv,new THREE.BufferAttribute(uv,2),plan);
    const host = { isWebGLRenderer: backend === "webgl",isWebGPURenderer: backend === "webgpu",
      backend: { device: { limits: { maxTextureDimension2D: 16384 } } },
      outputColorSpace: THREE.LinearSRGBColorSpace,capabilities: { maxTextureSize: 16384 },
      getDrawingBufferSize: target => target.set(viewport.width,viewport.height),getPixelRatio: () => 1 };
    const camera = new THREE.PerspectiveCamera(45,viewport.width / viewport.height,.1,1_000_000);
    const distance = viewport.height / (2 * .02 * Math.tan(Math.PI / 8));
    camera.position.set(0,0,distance); camera.lookAt(0,0,0);
    const controls = new MapControls(camera,null); controls.enableDamping = false;
    const frame = profile => {
      controls.update(); camera.updateMatrixWorld(true); object.updateMatrixWorld(true);
      withThreeRenderPerformance(profile ?? null, () => object.prepareFrameForThreeRenderer(host,camera));
    };
    return { object,plan,lod,host,camera,controls,distance,frame };
  }
  const textMeshes = object => object.textMaterialLayer.mesh.children.filter(mesh => mesh.visible && mesh.geometry.instanceCount > 0)
    .sort((a,b) => a.renderOrder - b.renderOrder);
  const drawn = object => textMeshes(object).flatMap(mesh => {
    const ids = mesh.geometry.getAttribute("aTextInstanceIndex"), clips = mesh.geometry.getAttribute("aVectorClipIndex");
    const constantClip = (mesh.userData.heprDrawRun.clipIndex ?? -1) + 1;
    return Array.from({ length: mesh.geometry.instanceCount }, (_,i) => [ids.getX(i),clips?.getX(i) ?? constantClip]);
  });
  const profileFrame = (profile, frame) => { profile.beginFrame(); frame(profile); profile.endFrame(); };
  const schedule = new ThreeVectorDrawPlan(scene);
  schedule.update(.01);
  assert.notDeepEqual(schedule.order,[0,1,2,3],"the fixture permits exact-geometry paint reordering");
  schedule.setTextLodEnabled(true);
  assert.deepEqual(schedule.order,[0,1,2,3],"enabling LOD restores canonical order before any layer updates");
  schedule.setStrokeSource(sceneStrokeRecords(scene),new Uint32Array());
  assert.deepEqual(schedule.order,[0,1,2,3],"replacing the stroke hierarchy keeps the text ordering constraint");
  schedule.setTextLodEnabled(false);
  assert.notDeepEqual(schedule.order,[0,1,2,3],"exact text restores the ordinary shared scheduler");
  let reference;
  for (const backend of ["webgl", "webgpu"]) for (const mode of ["auto", "off"]) {
    const { object,plan,lod,host,camera,controls,distance,frame } = create(backend,mode);
    const profile = new RenderPerformanceProfiler();
    try {
      frame();
      if (mode === "off") {
        assert.equal(object.getTextInstanceStats().rendered,count);
        assert.equal(lod.hasCombinedPayload(),false);
        const previous = object.textMaterialLayer;
        object.setTextLodMode("auto"); frame();
        assert.notEqual(object.textMaterialLayer,previous,"Off-to-Auto installs the combined material lazily");
      }
      const selected = object.getTextInstanceStats().rendered;
      assert(selected > 0 && selected < count / 10, `${backend}/${mode}: ordered text uses LOD`);
      assert.equal(selected,lod.getStats().selectedInstances);
      assert.equal(object.textMaterialLayer.mesh.geometry.instanceCount,0,"the parent does not also draw all glyphs");
      assert.deepEqual(plan.order,[0,1,2,3],"coarse text preserves canonical paint order across layers");
      const paints = [...textMeshes(object),...object.fillMaterialLayer.mesh.children.filter(m => m.visible)]
        .sort((a,b) => a.renderOrder - b.renderOrder);
      assert.deepEqual(paints.map(m => m.userData.heprDrawRun.kind),["text","fill","text"]);
      const ids = drawn(object);
      assert(ids.some(([id]) => id >= count),"coarse IDs reach actual draw attributes");
      assert(ids.some(([,clip]) => clip === 1) && ids.some(([,clip]) => clip === 2));
      assert(textMeshes(object).some(mesh => mesh.geometry.hasAttribute("aVectorClipIndex")),"a batch carries multiple source clips");
      if (reference) assert.deepEqual(ids,reference,"both backends and lazy setup select identical IDs and clips"); else reference = ids;
      const versions = textMeshes(object).map(mesh => mesh.geometry.getAttribute("aTextInstanceIndex").version);
      profile.start({ gpu: false,maxFrames: 65 });
      for (let i = 0; i < 60; i++) {
        camera.position.x += .1; controls.target.x += .1;
        camera.near = 1 + i; camera.far = 900_000 + i; camera.updateProjectionMatrix();
        profileFrame(profile,frame);
      }
      const capture = profile.stop();
      assert.equal(capture.frames,60);
      assert.equal(capture.counters["three.instanceUploadBytes"]?.total ?? 0,0,"60 MapControls pans do not upload instance buffers");
      assert.equal(capture.counters["three.batchCandidateInstances"]?.total ?? 0,0,"unchanged selections do not scan source glyphs");
      assert.deepEqual(textMeshes(object).map(mesh => mesh.geometry.getAttribute("aTextInstanceIndex").version),versions);
      await object.setLayerVisibility("b",false); frame();
      assert(drawn(object).every(([,clip]) => clip === 1),"hidden layers remove their selected coarse text");
      await object.setLayerVisibility("b",true); frame();
      assert.deepEqual(drawn(object),ids,"layer restoration keeps the chosen representation");
      object.setTextLodMode("off"); frame();
      assert.equal(object.getTextInstanceStats().rendered,count);
      assert(drawn(object).every(([id]) => id < count),"Off restores exact glyphs");
      object.setTextLodMode("auto"); frame();
      assert.equal(object.getTextInstanceStats().rendered,selected);
      object.setPrimitiveOverrides([{ kind: "text",index: 0 }],{ color: [1,0,0] }); frame();
      assert.equal(lod.getStats().renderedRuns,0,"primitive text colors force exact glyphs");
      object.clearPrimitiveOverrides(); frame();
      assert.equal(object.getTextInstanceStats().rendered,selected);
      // The same adapter must update a tilted perspective projection without
      // falling back to original IDs or drawing stale offscreen text.
      profile.start({ gpu: false,maxFrames: 1 });
      camera.position.set(0,distance * .7,distance);
      controls.target.set(0,0,0); profileFrame(profile,frame);
      assert(object.getTextInstanceStats().rendered > 0 && object.getTextInstanceStats().rendered < count / 10);
      const tilted = profile.stop();
      assert((tilted.counters["three.batchCandidateInstances"]?.total ?? 0) <= lod.getStats().selectedInstances,
        "selection updates visit selected instances only");
      camera.position.set(0,-200,20); controls.target.set(0,0,0); frame();
      assert(lod.getStats().coarseClusters > 0 && lod.getStats().renderedGlyphs > 0,
        `${backend}: a grazing camera keeps nearby readable glyphs and simplifies distant compressed text`);
      assert(object.getTextInstanceStats().rendered < count,
        `${backend}: foreshortening reaches the material instance buffers`);
      camera.position.set(0,0,300); frame();
      assert.equal(lod.getStats().renderedRuns,0,"close zoom restores readable exact glyphs");
      camera.position.set(1_000_000,0,distance); controls.target.set(1_000_000,0,0); frame();
      assert.equal(object.getTextInstanceStats().rendered,0,"offscreen selection clears all batches");
      camera.position.set(0,0,distance); controls.target.set(0,0,0);
      profile.start({ gpu: false,maxFrames: 1 }); profileFrame(profile,frame);
      const restored = profile.stop();
      assert.equal(object.getTextInstanceStats().rendered,selected,"text returns after an empty selection");
      assert.equal(restored.counters["three.batchCandidateInstances"].total,selected + scene.fillPathCount,
        "a changed coarse selection visits its selected IDs, never the complete glyph store");
      // Resource support is checked before a material reaches the host GPU.
      host.capabilities.maxTextureSize = host.backend.device.limits.maxTextureDimension2D = Math.ceil(Math.sqrt(count)); frame();
      assert.equal(lod.hasCombinedPayload(),false);
      assert.equal(lod.getStats().fallbackReason,"resource-capacity");
      assert.equal(object.getTextInstanceStats().rendered,count,"resource fallback draws exact source text");
      console.log(`Three ${backend}/${mode}: ${count}→${selected} text instances; pan reuse, tilt, clips, layers, exact zoom and fallback passed.`);
    } finally { profile.dispose(); object.dispose(); }
  }
  for (const backend of ["webgl", "webgpu"]) {
    const { object,lod,host,camera,frame } = create(backend,"auto");
    try {
      camera.position.z = viewport.height / (2 * .4 * Math.tan(Math.PI / 8));
      frame();
      const reference = drawn(object);
      assert(reference.length < count / 10);
      host.getDrawingBufferSize = target => target.set(viewport.width * 3,viewport.height * 3);
      host.getPixelRatio = () => 3;
      frame();
      assert.deepEqual(drawn(object),reference, `${backend}: host DPR preserves the selected glyphs and clips`);
      const uploads = lod.getStats().selectionUploads;
      frame();
      assert.equal(lod.getStats().selectionUploads,uploads);
      host.getRenderTarget = () => ({ viewport: new THREE.Vector4(0,0,viewport.width * 3,viewport.height * 3) });
      frame();
      assert.equal(lod.getStats().coarseClusters,0, `${backend}: offscreen targets select detail in their own pixels`);
      host.getRenderTarget = () => null;
      frame();
      assert.deepEqual(drawn(object),reference, `${backend}: returning to the canvas restores presentation scale`);
      camera.position.z /= 3;
      frame();
      assert.equal(lod.getStats().coarseClusters,0, `${backend}: readable Retina text returns to exact glyphs`);
    } finally { object.dispose(); }
  }
  for (const backend of ["webgl", "webgpu"]) {
    const multiply = { ...scene,drawRuns: scene.drawRuns.map((run,i) => i === 0 ? { ...run,blendMode: "Multiply" } : run) };
    const { object,frame } = create(backend,"auto",multiply);
    try {
      frame();
      const firstPaint = textMeshes(object).filter(mesh => mesh.userData.heprDrawRunIndices[0] === 0);
      assert.equal(firstPaint.length,34);
      assert.deepEqual(firstPaint.map(mesh => mesh.geometry.getAttribute("aTextInstanceIndex").getX(0)),
        Array.from({ length: 34 }, (_,i) => Math.floor(i / 2)),"Multiply keeps both exact per-glyph passes");
    } finally { object.dispose(); }
  }
  const effects = { ...scene,paintGraph: { roots: [{ kind: "group",isolated: true,knockout: false,alpha: .5,
    blendMode: "Normal",children: scene.drawRuns.map((_,runIndex) => ({ kind: "draw",runIndex })) }] } };
  const effectObject = create("webgl","auto",effects);
  try {
    effectObject.object.setTextLodMode("auto");
    assert.equal(effectObject.lod.hasCombinedPayload(),false,"effect scenes retain exact text");
  } finally { effectObject.object.dispose(); }
  const source = await readFile(new URL("../src/threePdfObject.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/ThreeTextLodLayer.create\([^\n]*drawRuns \? "off"|nextMode[^\n]*sceneData.drawRuns/,
    "public construction and mode changes must allow ordered text LOD");
  assert.deepEqual(scene,canonical,"LOD never modifies canonical PDF metadata or geometry");
} finally { hooks.deregister(); }
