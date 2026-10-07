import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createOcrPdfFixture as fixture } from "./lib/ocrPdfFixture.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { openPdfInNodeWorker } = await import("../src/pdf/workerClient.ts");
  const { PdfPageDemandLoader } = await import("../src/pdfPageDemand.ts");
  const { loadPdfSceneFromSource } = await import("../src/pdfObjectGenerator.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const visibleText = "BT /F1 10 Tf 0 Tr 20 30 Td <00010002> Tj ET";
  const imageSize = { imageWidth: 256, imageHeight: 128 };
  const view = { width: 200, height: 150, zoom: .25, cameraCenterX: 100, cameraCenterY: 50 };
  const rect = Float32Array.of(0, 0, 200, 100);

  const vector = await openPdf({ kind: "bytes", bytes: fixture({ scan: false, glyphless: false, poisonImage: true, content: visibleText }) });
  try {
    const overview = await vector.compileVectorPage(0, { previewMaxDimension: 96 });
    assert.equal(overview.pdfOverviewKind, "vector");
    assert.equal(overview.textInstanceCount, 2);
    assert.equal(overview.rasterLayers.length, 0, "born-digital text must never become a page bitmap");
    assert.equal(vector.getDiagnostics().some(d => d.code === "page-preview"), false);
    const full = await vector.compileVectorPage(0);
    assert.deepEqual(overview.textGlyphSegmentsA, full.textGlyphSegmentsA, "overview keeps exact source outlines");
  } finally { await vector.close(); }

  for (const options of [{}, { form: true }, { imageMatrix: [150, 0, 0, 80, 25, 10] }]) {
    const ocr = await openPdf({ kind: "bytes", bytes: fixture({ ...options, poisonImage: true }) });
    try {
      const overview = await ocr.compileVectorPage(0, { previewMaxDimension: 96 });
      assert.equal(overview.pdfOverviewKind, "ocr");
      assert.equal(overview.textInstanceCount, 2);
      assert.equal(overview.rasterLayers.length, 0, "OCR overview never decodes the poisoned scan");
      assert(ocr.getDiagnostics().some(d => d.code === "page-ocr-overview"));
      await assert.rejects(ocr.compileVectorPage(0, { previewMaxDimension: 96, limits: { maxCommandsPerPage: 1 } }),
        error => error.code === "resource-limit", "overview inspection still enforces resource limits");
    } finally { await ocr.close(); }
  }

  const worker = await openPdfInNodeWorker({ kind: "bytes", bytes: fixture({ poisonImage: true }), ownership: "copy" });
  try {
    const overview = await worker.compileVectorPage(0, { previewMaxDimension: 96 });
    assert.equal(overview.pdfOverviewKind, "ocr", "worker transfers the overview policy");
    assert.equal(overview.rasterLayers.length, 0);
  } finally { await worker.close(); }

  for (const options of [{ content: "" }, { toUnicode: false }]) {
    const scan = await openPdf({ kind: "bytes", bytes: fixture({ ...imageSize, ...options }) });
    try {
      const overview = await scan.compileVectorPage(0, { previewMaxDimension: 96 });
      assert.equal(overview.pdfOverviewKind, "raster");
      assert.equal(overview.rasterLayers[0].width, 96, "only a scan without usable OCR gets a reduced bitmap");
      assert.equal(overview.rasterLayers[0].height, 48);
      if (options.toUnicode === false) assert(scan.getDiagnostics().some(d => d.code === "page-ocr-overview-unavailable"));
    } finally { await scan.close(); }
  }

  const mixed = await openPdf({ kind: "bytes", bytes: fixture({ ...imageSize, glyphless: false, content: visibleText }) });
  try {
    const overview = await mixed.compileVectorPage(0, { previewMaxDimension: 96 });
    assert.equal(overview.pdfOverviewKind, "vector");
    assert.equal(overview.textInstanceCount, 2, "mixed vector text and artwork retain their original scene");
    assert.equal(overview.rasterLayers[0].width, 256, "an embedded image is not replaced with a whole-page overview");
  } finally { await mixed.close(); }

  const outlinedText = await openPdf({ kind: "bytes", bytes: fixture({ ...imageSize, glyphless: false,
    extGState: "/Transparent << /ca 0 /CA 1 >>", content: "BT /F1 10 Tf /Transparent gs 1 Tr 20 30 Td <00010002> Tj ET" }) });
  try {
    const overview = await outlinedText.compileVectorPage(0, { previewMaxDimension: 96 });
    assert.equal(overview.pdfOverviewKind, "vector", "visible stroked text is not mistaken for zero-alpha OCR");
    assert.equal(overview.rasterLayers[0].width, 256);
  } finally { await outlinedText.close(); }

  const inline = await openPdf({ kind: "bytes", bytes: fixture({ scan: false,
    content: "q 200 0 0 100 0 0 cm BI /W 1 /H 1 /BPC 8 /CS /G ID x EI Q\nBT /F1 10 Tf 3 Tr 20 30 Td <00010002> Tj ET" }) });
  try {
    const overview = await inline.compileVectorPage(0, { previewMaxDimension: 96 });
    assert.equal(overview.pdfOverviewKind, "ocr", "inline scans follow the same image-free policy");
    assert.equal(overview.rasterLayers.length, 0);
  } finally { await inline.close(); }

  // Real zoom transitions swap OCR vectors for original scan pixels and back, without decoding again.
  const scanSession = await openPdf({ kind: "bytes", bytes: fixture(imageSize) });
  const calls = [];
  const proxy = { info: scanSession.info, close: () => scanSession.close(), compileVectorPage(index, options) {
    calls.push(options.previewMaxDimension);
    return scanSession.compileVectorPage(index, options);
  } };
  const demand = new PdfPageDemandLoader(proxy, () => {});
  try {
    demand.update(view, rect); await demand.whenIdle();
    const overview = demand.pageScenes[0];
    assert.equal(overview.pdfOverviewKind, "ocr");
    assert.equal(overview.rasterLayers.length, 0);
    demand.update({ ...view, zoom: 2 }, rect); await demand.whenIdle();
    const detail = demand.pageScenes[0];
    assert.equal(detail.textInstanceCount, 0, "original OCR remains invisible over the close-up scan");
    assert.equal(detail.rasterLayers[0].width, 256);
    demand.update({ ...view, zoom: 1.2 }, rect); await demand.whenIdle();
    assert.equal(demand.pageScenes[0], detail, "hysteresis prevents flicker around the entry threshold");
    demand.update(view, rect); await demand.whenIdle();
    assert.equal(demand.pageScenes[0], overview, "zoom-out restores vector OCR and removes scan layers from the scene");
    demand.update({ ...view, zoom: 2 }, rect); await demand.whenIdle();
    assert.equal(demand.pageScenes[0], detail);
    assert.deepEqual(calls, [96, undefined], "cached zoom cycles do not regenerate a raster preview or decode scans again");
  } finally { await demand.close(); }

  const shortVector = await loadPdfSceneFromSource(fixture({ scan: false, glyphless: false, content: visibleText }), {}, undefined, true);
  assert.equal(shortVector.pageDemand, undefined, "short vector documents retain complete scene availability");
  assert.equal(shortVector.scene.textInstanceCount, 2);
  assert.equal(shortVector.scene.rasterLayers.length, 0);
  const shortScan = await loadPdfSceneFromSource(fixture({ poisonImage: true }), {}, undefined, true);
  try {
    assert(shortScan.pageDemand, "short scanned PDFs also use zoom-dependent loading");
    assert.equal(shortScan.scene.textInstanceCount, 2);
    assert.equal(shortScan.scene.rasterLayers.length, 0);
    assert.equal(shortScan.pageDemand.detailedCount, 0);
  } finally { await shortScan.pageDemand.close(); }
  const fullBook = await loadPdfSceneFromSource(fixture({ pageCount: 20, poisonImage: true }), {}, undefined, true);
  try {
    assert.equal(fullBook.pageDemand.previewCount, 20, "large OCR books prepare every overview by default");
    assert.equal(fullBook.scene.textInstanceCount, 40);
    assert.equal(fullBook.scene.rasterLayers.length, 0, "full parsing still avoids all scan codecs until zoom");
    assert(!fullBook.scene.pendingPagePreviews?.some(Boolean));
    assert.equal(fullBook.pageDemand.detailedCount, 0);
  } finally { await fullBook.pageDemand.close(); }

  // Both Three material backends must replace text and raster content together,
  // including independent and batched page handles, without a browser or GPU.
  const { createThreePdfObject } = await import("../src/threePdfObject.ts");
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 1, height: 1, style: {}, getContext: () => null }) };
  try {
    for (const rendererType of ["webgl", "webgpu"]) {
      const loaded = await loadPdfSceneFromSource(fixture(imageSize), {}, undefined, true);
      const native = new Proxy({ getSceneStats: () => ({}),
        getViewState: () => ({ zoom: 1, cameraCenterX: 100, cameraCenterY: 50 }),
        getPresentedViewState: () => ({ zoom: 1, cameraCenterX: 100, cameraCenterY: 50 })
      }, { get: (target, key) => target[key] ?? (() => {}) });
      let object;
      try {
        object = await createThreePdfObject(loaded, { rendererType, vectorLod: "off", textLod: "off", vectorOnly: true },
          undefined, undefined, () => native);
        const [page] = await object.getPages();
        for (const zoom of [.25, 2, .25, 2]) {
          loaded.pageDemand.update({ ...view, zoom }, object.sceneData.pageRects);
          await loaded.pageDemand.whenIdle();
          if (object.demandUpdateTimer !== null) clearTimeout(object.demandUpdateTimer);
          object.demandUpdateTimer = null;
          if (object.demandUpdateRunning) await object.demandUpdateRunning;
          await object.updateDemandPages();
          for (const target of [object, page, object.pageBatch].filter(Boolean)) {
            assert.equal(target.sceneData.textInstanceCount, zoom < 1 ? 2 : 0, `${rendererType}: OCR appears only in the overview`);
            assert.equal(target.sceneData.rasterLayers.length, zoom < 1 ? 0 : 1, `${rendererType}: scans appear only in detail`);
            assert.equal(target.textMaterialLayer.mesh.geometry.instanceCount, zoom < 1 ? 2 : 0);
            assert.equal(target.rasterMaterialLayer.rasterEntries.length, zoom < 1 ? 0 : 1);
          }
          assert.equal((await object.getPages())[0], page, "OCR/scan transitions retain independent page handles");
        }
      } finally { object?.dispose(); await loaded.pageDemand.close(); }
    }
  } finally { globalThis.document = oldDocument; }

  // Vector pages must not occupy the twelve detail slots and starve a nearby scan.
  const mixedCalls = [];
  const mixedSession = { info: { pages: Array.from({ length: 20 }, () => ({ width: 200, height: 100 })) }, async close() {},
    async compileVectorPage(index, options) {
      mixedCalls.push({ index, preview: options.previewMaxDimension });
      const scene = createEmptyVectorScene();
      scene.pdfOverviewKind = index === 19 ? "ocr" : "vector";
      scene.pageCount = 1; scene.pageRects = rect;
      scene.pageBounds = scene.bounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
      return scene;
    } };
  const mixedDemand = new PdfPageDemandLoader(mixedSession, () => {});
  try {
    mixedDemand.update({ ...view, width: 500, height: 500, zoom: 2 }, Float32Array.from(Array.from({ length: 20 }, () => [...rect]).flat()));
    await mixedDemand.whenIdle();
    assert.equal(mixedDemand.previewCount, 20);
    assert.deepEqual(mixedCalls.filter(call => call.preview === undefined), [{ index: 19, preview: undefined }]);
    assert.equal(mixedDemand.detailedCount, 1);
  } finally { await mixedDemand.close(); }
  console.log("PDF overviews: exact vectors, image-free OCR, scan-only previews, worker policy and cached zoom transitions passed");
} finally { hooks.deregister(); }
