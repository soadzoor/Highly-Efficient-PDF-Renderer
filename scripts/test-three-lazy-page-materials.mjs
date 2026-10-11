import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { createCanvas } from "@napi-rs/canvas";
import { describeThreeLoadMemory } from "../src/threeLoadMemory.ts";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const previousDocument = globalThis.document;
globalThis.document = { createElement: () => Object.assign(createCanvas(1, 1), { style: {} }) };

try {
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { createThreePdfObject } = await import("../src/threePdfObject.ts");
  const create = async backend => {
    const source = composeVectorScenesInGrid(Array.from({ length: 3 }, () => pageFixture(buildStrokeScene)), 3);
    const canonical = structuredClone(source), native = makeNative();
    const pdf = await createThreePdfObject({ scene: source, sourceKind: "hep", sourceLabel: "lazy pages" },
      { rendererType: backend, vectorLod: "off", textLod: "off", threeColorCompositing: "display" },
      undefined, undefined, () => native, undefined, async () => {});
    const scene = new THREE.Scene(); scene.add(pdf);
    const camera = new THREE.OrthographicCamera(-70, 70, 30, -30, 0.1, 100);
    camera.coordinateSystem = backend === "webgpu" ? THREE.WebGPUCoordinateSystem : THREE.WebGLCoordinateSystem;
    camera.position.z = 30; camera.updateProjectionMatrix();
    const host = makeHost(backend);
    const frame = () => {
      camera.updateMatrixWorld(true); scene.updateMatrixWorld(true);
      scene.onBeforeRender(host, scene, camera, null);
    };
    return { source, canonical, native, pdf, scene, camera, host, frame };
  };

  for (const backend of ["webgl", "webgpu"]) {
    const { source, canonical, native, pdf, camera, host, frame } = await create(backend);
    const atlas = pdf.textMaterialLayer.textRasterAtlasTexture;
    let atlasDisposals = 0; atlas.addEventListener("dispose", () => atlasDisposals++);
    const [pages, samePage] = await Promise.all([pdf.getPages(), pdf.getPage(1)]);
    assert.equal(samePage, pages[1]); assert.equal(await pdf.getPage(1), samePage);
    assert(Object.isFrozen(pages));
    pages.forEach(assertDormant);
    assert.equal(typeof pdf.deferredMaterials, "function", "shared pages release the unused original paint bundle");
    assert.equal(pdf.textMaterialLayer, undefined);
    assert.equal(pdf.pageBatch.textMaterialLayer.textRasterAtlasTexture, atlas,
      "the only additional content bundle shares the document glyph atlas");
    const preparedInventory = describeThreeLoadMemory(pdf, pdf.sceneData);
    const batchInventory = describeThreeLoadMemory(pdf.pageBatch, pdf.pageBatch.sceneData);
    assert.equal(preparedInventory.textureCount, batchInventory.textureCount,
      "page preparation retains one document paint texture bundle");
    assert.equal(preparedInventory.textureBackingBytes, batchInventory.textureBackingBytes,
      "unused original and independent pages retain no duplicate paint texture payloads");
    assert.equal(native.uploads, 0);

    pages[1].position.z = 1;
    await pdf.compileForThreeRenderer(host, camera);
    frame();
    assert.equal(pdf.getPageBatchingStats().mode, "pages-batched");
    pages.forEach(assertDormant);
    assert.equal(host.compiles, 1, "one shared shader preparation covers all transformed pages");
    assert.equal(host.renders, 0, "shared preparation does not submit fallback or compositor draws");
    assert.equal(typeof pdf.deferredMaterials, "function", "shared submission does not reconstruct the original bundle");

    pdf.setTextLodMode("auto"); pdf.setVectorLodMode("auto"); pdf.setStrokeCurveEnabled(false);
    pdf.setPageBackgroundColor(0.9, 0.8, 0.7, 1); pdf.setVectorColorOverride(0.1, 0.2, 0.3, 0.4);
    await pdf.setLayerVisibility("drawing", false);
    frame();
    assert.equal(pdf.getPageBatchingStats().mode, "pages-batched");
    assert.equal(pdf.pageBatch.getTextInstanceStats().rendered, 0);
    pages.forEach(assertDormant);
    assert.equal(typeof pdf.deferredMaterials, "function", "document settings update shared content without restoring unused bundles");
    pdf.setTextLodMode("off"); pdf.setVectorLodMode("off"); pdf.setStrokeCurveEnabled(true);
    pdf.setPageBackgroundColor(1, 1, 1, 1); pdf.setVectorColorOverride(0, 0, 0, 0);
    await pdf.setLayerVisibility("drawing", true);

    pdf.setSearchHighlights(pdf.searchText("page"), { currentIndex: 1 });
    pages[0].setSelection([{ kind: "stroke", index: 0 }]);
    const b = pages[0].sceneData.pageBounds;
    pages[0].setTextSelectionHighlights([{ minX: b.minX + 1, minY: b.minY + 1, maxX: b.minX + 2, maxY: b.minY + 2 }]);
    await pdf.compileForThreeRenderer(host, camera);
    frame();
    assert.equal(pdf.getPageBatchingStats().mode, "pages-batched");
    assert(pages.every(page => page.searchHighlightGroup?.visible));
    assert(pages[0].primitiveHighlightLayer.mesh.visible);
    assert(pages[0].textSelectionHighlightGroup.visible);
    pages.forEach(assertDormant);
    assert.equal(typeof pdf.deferredMaterials, "function", "page overlays leave the unused original content deferred");
    assert.equal(native.uploads, 0, "overlays and shared rendering leave native fallback dormant");

    const page = pages[0];
    page.setStrokeCurveEnabled(false);
    page.setTextLodMode("auto");
    pages[1].setTextLodMode("auto");
    page.setVectorLodMode("auto");
    page.setPageBackgroundColor(0.2, 0.3, 0.4, 0.5);
    page.setVectorColorOverride(0.4, 0.3, 0.2, 0.6);
    pdf.setPrimitiveOverrides([{ kind: "stroke", index: 0 }], { color: "yellow" });
    pdf.setPrimitiveOverrides([{ kind: "text", index: 0 }], { color: "blue" });
    assert.deepEqual(page.primitiveAppearance.getOverrideColor({ kind: "stroke", index: 0 }), [1, 1, 0],
      "document primitive colors still reach lazy page handles");
    assert.equal(page.getPrimitive({ kind: "stroke", index: 0 }).kind, "stroke");
    assert.equal(page.searchText("page").length, 1);
    await page.setLayerVisibility("drawing", false);
    pages.forEach(assertDormant);
    await page.compileForThreeRenderer(host, camera);
    assert.equal(page.deferredMaterials, null, "individual compilation constructs the required bundle synchronously");
    assert(page.textMaterialLayer && page.fillMaterialLayer && page.rasterMaterialLayer);
    assert.equal(page.textMaterialLayer.textRasterAtlasTexture, atlas);
    assert(describeThreeLoadMemory(page, page.sceneData).textureCount > 0);
    assert.equal(page.textMaterialLayer.curveUniform.value, 0);
    assert.deepEqual(page.textMaterialLayer.vectorOverrideUniform.toArray(), [0.4, 0.3, 0.2, 0.6]);
    assert.deepEqual([...page.textMaterialLayer.textInstanceTextureC.image.data.slice(0, 4)], [0, 0, 255, 255],
      "primitive colors queued before construction reach the eventual textures");
    const stroke = page.strokeMaterialLayer ?? page.vectorLodStrokeLayer.layers[0];
    assert.deepEqual([...stroke.segmentStyleTexture.image.data.slice(1, 4)], [1, 1, 0]);
    assert.equal(page.rendererConfig.textLodMode, "auto");
    assert.equal(page.getTextLodStats().mode, "off", "primitive text colors retain exact glyph rendering");
    assert.equal(page.getRenderedStrokeSegmentCount(), 0);
    assert.equal(page.getTextInstanceStats().rendered, 0, "queued layer visibility filters new materials");
    pages.slice(1).forEach(assertDormant);
    frame();
    assert.equal(pdf.getPageBatchingStats().reason, "page-appearance");
    assert(pages.every(value => value.deferredMaterials === null && value.materialPipelineActive));
    assert(pages.every(value => value.textMaterialLayer.textRasterAtlasTexture === atlas));
    assert.equal(pages[1].getTextLodStats().mode, "auto", "queued LOD settings reach independent content without overrides");
    await pdf.setLayerVisibility("drawing", true);
    frame();
    assert.equal(page.getRenderedStrokeSegmentCount(), 1);
    assert(page.getTextInstanceStats().rendered > 0);
    assert.equal(page.pageMesh.material.depthWrite, false, "queued translucent backgrounds retain independent depth behavior");
    assert.deepEqual(source, canonical, "lazy preparation and queued colors leave canonical geometry unchanged");
    pdf.dispose(); pdf.dispose();
    assert.equal(atlasDisposals, 1, "materialized and unmaterialized pages release shared glyph resources once");
    assert.equal(native.disposals, 1);

    for (const fallback of ["overlap", "reparent", "host"]) {
      const state = await create(backend), fallbackPages = await state.pdf.getPages();
      fallbackPages[1].position.z = 1;
      if (fallback === "overlap") fallbackPages[1].position.copy(fallbackPages[0].position);
      else if (fallback === "reparent") state.scene.add(fallbackPages[0]);
      else {
        state.host.isWebGLRenderer = backend !== "webgl";
        state.host.isWebGPURenderer = backend !== "webgpu";
      }
      state.frame();
      assert(fallbackPages.every(value => value.deferredMaterials === null), `${fallback}: active independent pages construct their bundles`);
      if (fallback === "host") {
        assert(state.native.uploads > 0, "an incompatible host uses the shared native context");
        assert(fallbackPages.every(value => value.renderTexture && !value.materialPipelineActive));
      } else {
        assert.equal(state.pdf.getPageBatchingStats().reason, fallback === "overlap" ? "overlapping-page-paints" : "reparented-page");
        assert(fallbackPages.every(value => value.materialPipelineActive));
        assert.equal(state.native.uploads, 0);
      }
      state.pdf.dispose();
      if (fallback === "reparent") fallbackPages[0].dispose();
      assert.equal(state.native.disposals, 1);
    }

    const returning = await create(backend), returningPages = await returning.pdf.getPages();
    returningPages[1].position.z = 1; returning.frame();
    assert.equal(returning.pdf.getPageBatchingStats().mode, "pages-batched");
    assert.equal(typeof returning.pdf.deferredMaterials, "function");
    returningPages[1].position.z = 0;
    await returning.pdf.compileForThreeRenderer(returning.host, returning.camera);
    returning.frame();
    assert.equal(returning.pdf.getPageBatchingStats().mode, "document", "returning to the canonical layout reconstructs original drawing");
    assert.equal(returning.pdf.deferredMaterials, null);
    assert(returning.pdf.textMaterialLayer);
    returningPages.forEach(assertDormant);
    assert.equal(returning.native.uploads, 0);
    returning.pdf.dispose();

    // Building page handles cannot dispose resources borrowed by an in-flight
    // shader compiler, even if its camera still uses the original document.
    const borrowed = await create(backend);
    let finishBorrowed, notifyBorrowed;
    const borrowedStarted = new Promise(resolve => { notifyBorrowed = resolve; });
    borrowed.host.compileAsync = () => {
      const pending = new Promise(resolve => { finishBorrowed = resolve; });
      notifyBorrowed();
      return pending;
    };
    const borrowing = borrowed.pdf.compileForThreeRenderer(borrowed.host, borrowed.camera);
    await waitFor(borrowedStarted);
    const borrowedText = borrowed.pdf.textMaterialLayer;
    const borrowedPages = await borrowed.pdf.getPages();
    assert.equal(borrowed.pdf.textMaterialLayer, borrowedText, "active shader preparation keeps the borrowed original bundle alive");
    assert.equal(borrowed.pdf.deferredMaterials, null);
    borrowedPages.forEach(assertDormant);
    finishBorrowed(); await borrowing;
    assert.equal(borrowed.pdf.shaderPreparations, 0);
    assert.equal(borrowed.host.renders, 0);
    borrowed.pdf.dispose();

    const retry = await create(backend), retryPages = await retry.pdf.getPages(), retryPage = retryPages[0];
    const descriptor = Object.getOwnPropertyDescriptor(retryPage.sceneData, "textInstanceA");
    Object.defineProperty(retryPage.sceneData, "textInstanceA", { configurable: true,
      get() { throw new Error("injected text material construction failure"); } });
    assert.throws(() => retryPage.prepareFrameForThreeRenderer(retry.host, retry.camera), /injected text material construction failure/);
    assertDormant(retryPage);
    Object.defineProperty(retryPage.sceneData, "textInstanceA", descriptor);
    retryPage.prepareFrameForThreeRenderer(retry.host, retry.camera);
    assert.equal(retryPage.deferredMaterials, null, "failed construction can be retried with the same page handle");
    retry.pdf.dispose();

    const cancelled = await create(backend), cancelledPages = await cancelled.pdf.getPages();
    const controller = new AbortController(), reason = new Error("cancel before lazy compilation");
    controller.abort(reason);
    await assert.rejects(cancelledPages[0].compileForThreeRenderer(cancelled.host, cancelled.camera, controller.signal), error => error === reason);
    cancelledPages.forEach(assertDormant);
    let createdAfterDisposal = 0;
    for (const value of cancelledPages) {
      const factory = value.deferredMaterials;
      value.deferredMaterials = (...args) => { createdAfterDisposal++; return factory(...args); };
    }
    cancelled.pdf.dispose();
    for (const value of cancelledPages) {
      value.prepareFrameForThreeRenderer(cancelled.host, cancelled.camera);
      await value.compileForThreeRenderer(cancelled.host, cancelled.camera);
    }
    assert.equal(createdAfterDisposal, 0, "disposal never constructs otherwise unused material resources");
    assert.equal(cancelled.native.disposals, 1);
    console.log(`${backend}: lazy page resources, shared rendering/overlays, state replay, fallbacks, construction retry and cancellation passed.`);
  }
} finally {
  hooks.deregister();
  globalThis.document = previousDocument;
}

function assertDormant(page) {
  assert.equal(typeof page.deferredMaterials, "function", "page handles retain an uncalled material factory");
  assert.equal(page.textMaterialLayer, undefined);
  const report = describeThreeLoadMemory(page, page.sceneData);
  assert.equal(report.textureCount, page.primitiveHighlightLayer ? 1 : 0,
    "dormant page handles own only requested overlay clips, without paint textures or glyph-atlas references");
  assert.equal(report.materialCount, (page.pageMesh.parent === page ? 1 : 0) + (page.searchHighlightGroup?.children.length ?? 0) +
    (page.textSelectionHighlightGroup?.children.length ?? 0) + (page.primitiveHighlightLayer ? 1 : 0),
  "dormant handles retain only their depth rectangle and requested overlay materials");
}

async function waitFor(promise) {
  let timer;
  try {
    await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("lazy material test did not reach compilation")), 5000);
    })]);
  } finally { clearTimeout(timer); }
}

function pageFixture(buildStrokeScene) {
  const scene = buildStrokeScene([{ points: [[2, 2], [18, 2]], width: 0.5, color: "red" }]);
  const f = values => Float32Array.from(values), count = 128;
  const squareA = f([0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1]);
  const squareB = f([1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  const a = new Float32Array(count * 4), b = new Float32Array(count * 4), c = new Float32Array(count * 4);
  for (let index = 0; index < count; index++) {
    a.set([0.5, 0, 0, 0.5], index * 4); b.set([2 + index % 16, 6 + Math.floor(index / 16), 0, 0], index * 4);
    c.set([0, 0, 0, 1], index * 4);
  }
  return Object.assign(scene, {
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 }, pageBounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    pageRects: f([0, 0, 20, 20]), textInstanceCount: count, sourceTextCount: count, textInPageCount: count,
    textGlyphCount: 1, textGlyphSegmentCount: 4, textInstanceA: a, textInstanceB: b, textInstanceC: c,
    textGlyphMetaA: f([0, 4, 0, 0]), textGlyphMetaB: f([1, 1, 0, 0]),
    textGlyphSegmentsA: squareA, textGlyphSegmentsB: squareB, pageTextRanges: Uint32Array.of(0, count),
    textIndex: { version: 2, pages: [{ text: "page", charInstance: Int32Array.of(0, 1, 2, 3), fallbackQuads: new Float32Array(0) }] },
    optionalContent: { groups: [{ id: "drawing", name: "Drawing", defaultVisible: true, locked: false, usedInView: true }],
      conditions: [{ kind: "group", groupId: "drawing" }], order: [], radioGroups: [] },
    drawRuns: [{ kind: "stroke", first: 0, count: 1, optionalContent: 0 }, { kind: "text", first: 0, count, optionalContent: 0 }]
  });
}

function makeNative() {
  let view = { cameraCenterX: 0, cameraCenterY: 0, zoom: 1 };
  const target = {
    uploads: 0, disposals: 0,
    setScene() { this.uploads++; return {}; }, getSceneStats: () => ({}), dispose() { this.disposals++; },
    getViewState: () => ({ ...view }), setViewState(next) { view = { ...next }; },
    getPresentedViewState: () => ({ ...view }), getPresentedFrameSerial: () => 0,
    getRasterLayerUpdates: () => new Map(), getVectorStrokeLodStats: () => null, getTextLodStats: () => null
  };
  return new Proxy(target, { get: (object, key) => object[key] ?? (() => {}) });
}

function makeHost(backend) {
  return {
    isWebGLRenderer: backend === "webgl", isWebGPURenderer: backend === "webgpu", outputColorSpace: THREE.LinearSRGBColorSpace,
    capabilities: { maxTextureSize: 16384 }, backend: { device: { limits: { maxTextureDimension2D: 16384 } } },
    compiles: 0, renders: 0,
    getDrawingBufferSize: target => target.set(640, 480), getPixelRatio: () => 1,
    domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }) },
    async compileAsync() { this.compiles++; }, render() { this.renders++; }
  };
}
