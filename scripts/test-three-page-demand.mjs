import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(s, c, next) {
  return next(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
const oldDocument = globalThis.document;
const deadline = setTimeout(() => assert.fail("Three page demand did not complete within 15 seconds."), 15000);
globalThis.document = { createElement: () => ({ width: 1, height: 1, style: {} }) };

try {
  const { PdfPageDemandLoader } = await import("../src/pdfPageDemand.ts");
  const { createThreePdfObject } = await import("../src/threePdfObject.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { buildRasterScenePreview } = await import("../src/pageRasterPreview.ts");
  const { createMonochromeRasterLayer } = await import("../src/monochromeRaster.ts");
  const calls = [];
  const session = {
    info: { pages: Array.from({ length: 24 }, (_, index) => ({ index, width: 600, height: 800 })) },
    closed: false,
    async compileVectorPage(index, options) {
      options.signal.throwIfAborted(); calls.push({ index, preview: options.previewMaxDimension });
      const scene = createEmptyVectorScene();
      Object.assign(scene, { pageCount: 1, pageRects: Float32Array.of(0, 0, 600, 800), pageTextRanges: Uint32Array.of(0, 0),
        bounds: { minX: 0, minY: 0, maxX: 600, maxY: 800 }, pageBounds: { minX: 0, minY: 0, maxX: 600, maxY: 800 } });
      scene.rasterLayers = [createMonochromeRasterLayer({ width: 1024, height: 1024,
        matrix: Float32Array.of(600,0,0,800,0,0), pageIndex: 0 },
        { data: new Uint8Array(128 * 1024).fill(0xaa), colors: Uint8Array.of(255,255,255,255,0,0,0,255) })];
      return options.previewMaxDimension ? buildRasterScenePreview(scene, options.previewMaxDimension) : scene;
    },
    async close() { this.closed = true; }
  };
  const loader = new PdfPageDemandLoader(session, () => {});
  const scene = composeVectorScenesInGrid(loader.pageScenes, 5);
  let disposed = 0, uploaded = 0, nativeScene = null;
  const native = new Proxy({
    getViewState: () => ({ zoom: 1, cameraCenterX: 0, cameraCenterY: 0 }),
    getPresentedViewState: () => ({ zoom: 1, cameraCenterX: 0, cameraCenterY: 0 }),
    setScene: scene => { nativeScene = scene; uploaded++; return {}; },
    getSceneStats: () => ({}), dispose: () => disposed++
  }, { get: (target, key) => target[key] ?? (() => {}) });
  const object = await createThreePdfObject({ scene, sourceKind: "pdf", sourceLabel: "paged test",
    sourceBytes: Uint8Array.of(1), pageDemand: loader }, { vectorLod: "off", textLod: "off" },
  undefined, undefined, () => native);
  const pages = await object.getPages();
  assert.equal(object.isPageDemandLoaded, true);
  assert.equal(pages.length, 24);
  assert.equal(calls.length, 0, "metadata and page handles do not scan operators");
  assert.equal(uploaded, 0, "native fallback remains deferred");
  pages.slice(1).forEach(page => { page.visible = false; });
  const page = pages[0], position = page.position.clone();
  page.rotation.z = .15;
  const camera = new THREE.OrthographicCamera(-320,320,400,-400,.1,100);
  camera.position.set(position.x, position.y, 10);
  camera.updateMatrixWorld(); camera.updateProjectionMatrix(); object.updateMatrixWorld(true);
  const host = { domElement: { width: 640, height: 800 }, getDrawingBufferSize: target => target.set(640,800) };
  const changes = [];
  object.addEventListener("change", event => changes.push(event.reason));
  const flush = async () => {
    await loader.whenIdle();
    if (object.demandUpdateTimer !== null) clearTimeout(object.demandUpdateTimer);
    object.demandUpdateTimer = null;
    if (object.demandUpdateRunning) await object.demandUpdateRunning;
    await object.updateDemandPages();
  };
  object.updatePageDemand(host, camera);
  assert.equal(object.needsLoadingAnimation, true, "visible metadata-only pages animate while their overview is pending");
  assert(changes.includes("page-loading-animation"), "on-demand Three hosts receive another-frame notifications");
  await flush();
  object.updatePageDemand(host, camera);
  assert.equal(object.needsLoadingAnimation, false, "loaded or hidden pages stop the placeholder animation");
  assert.deepEqual(calls.map(call => [call.index, call.preview]), [[0,96],[0,undefined]], "only the projected page loads");
  assert.equal(object.sceneData.rasterLayers[0].width, 1024);
  assert.equal((await object.getPages())[0], page, "page handles survive content updates");
  assert.deepEqual(page.position.toArray(), position.toArray());
  assert.equal(page.rotation.z, .15);
  assert.equal(page.visible, true);
  assert.equal(pages[1].visible, false, "hidden pages remain hidden");
  assert.equal(object.pageBatch.pageTransforms.partition.scene, object.sceneData);
  assert.equal(disposed, 0, "page updates preserve the shared native context");
  assert.equal(uploaded, 0);

  page.renderer.ensureSceneUploaded();
  assert.equal(nativeScene, page.sceneData, "a page can acquire the shared native fallback");

  camera.zoom = .05; camera.updateProjectionMatrix();
  object.updatePageDemand(host, camera);
  await flush();
  assert.equal(object.sceneData.rasterLayers[0].width, 96, "zoom-out selects the cached overview");
  assert.equal(loader.detailedCount, 1, "cached detail need not remain displayed");
  assert.equal(calls.length, 2);
  assert.equal(object.renderer.hasUploadedScene(), false, "page cleanup leaves the document upload deferred");
  object.renderer.ensureSceneUploaded();
  assert.equal(nativeScene, object.sceneData, "the document fallback retains its complete current window after page cleanup");
  camera.zoom = 1; camera.updateProjectionMatrix(); object.updatePageDemand(host, camera); await flush();
  assert.equal(object.sceneData.rasterLayers[0].width, 1024);
  assert.equal(calls.length, 2, "cached detail returns without another parse");
  assert(changes.filter(reason => reason === "pages-loaded").length >= 3);

  page.position.x += 100000; object.updateMatrixWorld(true); object.updatePageDemand(host, camera); await flush();
  assert.equal(object.sceneData.rasterLayers[0].width, 96, "moved offscreen pages return to previews");
  assert.equal((await object.getPages())[0], page);
  object.dispose(); await loader.whenIdle();
  assert.equal(session.closed, true);
  assert.equal(disposed, 1);

  const { loadPdfSceneFromSource } = await import("../src/pdfObjectGenerator.ts");
  const bytes = writeTinyPdf({ objects: [
    { number:1,body:"<< /Type /Catalog /Pages 2 0 R >>" },
    { number:2,body:`<< /Type /Pages /Count 24 /Kids [${Array.from({ length:24 },(_,i)=>`${i+4} 0 R`).join(" ")}] >>` },
    { number:3,body:tinyPdfStream("","0 0 m 600 800 l S") },
    ...Array.from({ length:24 },(_,i)=>({ number:i+4,body:"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 3 0 R >>" }))
  ] });
  const loaded = await loadPdfSceneFromSource(bytes,{ pages:"5-24",sourceLabel:"retained PDF" },undefined,true);
  try {
    assert.equal(loaded.sourceLabel,"retained PDF");
    assert.equal(loaded.scene.pageCount,20);
    assert.equal(loaded.scene.segmentCount,0,"automatic Three loading does not compile page operators before returning");
    assert.equal(loaded.pageDemand.previewCount,0);
    loaded.pageDemand.update({ width:400,height:500,cameraCenterX:300,cameraCenterY:400,zoom:1 },
      Float32Array.from(Array.from({ length:20 },(_,i)=>[i*2000,0,i*2000+600,800]).flat()));
    await loaded.pageDemand.whenIdle();
    assert.equal(loaded.pageDemand.previewCount,1);
    assert.equal(loaded.pageDemand.detailedCount,1,"the real worker only compiles demanded detail");
    assert.equal(loaded.pageDemand.pageScenes[0].segmentCount,1);
  } finally { await loaded.pageDemand.close(); }
  const eager = await loadPdfSceneFromSource(bytes,{ pages:"5-24",pageLoading:"eager" },undefined,true);
  assert.equal(eager.pageDemand,undefined);
  assert.equal(eager.scene.segmentCount,20,"complete extraction remains available explicitly");
  const cancelled = new AbortController(), reason = new Error("cancelled metadata load");
  await assert.rejects(loadPdfSceneFromSource(bytes,{ onProgress:event=>{
    if (event.stage === "complete") cancelled.abort(reason);
  } },cancelled.signal,true),error=>error===reason);
  console.log("Three page demand: metadata-only construction, camera projections, stable page handles, zoom-out previews, cached promotion and worker/context cleanup passed.");
} finally { clearTimeout(deadline); globalThis.document = oldDocument; hooks.deregister(); }
