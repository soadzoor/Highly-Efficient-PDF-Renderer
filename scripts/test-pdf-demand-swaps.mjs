import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { PdfPageDemandLoader } = await import("../src/pdfPageDemand.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { ScenePaintVisibility } = await import("../src/scenePaintVisibility.ts");
  const { createDefaultOptionalContentSnapshot } = await import("../src/optionalContent.ts");
  const page = kind => Object.assign(createEmptyVectorScene(), { pdfOverviewKind: kind, pageCount: 1,
    pageRects: Float32Array.of(0, 0, 200, 100), pageTextRanges: Uint32Array.of(0, 0),
    pageBounds: { minX: 0, minY: 0, maxX: 200, maxY: 100 }, bounds: { minX: 0, minY: 0, maxX: 200, maxY: 100 } });
  const raster = size => ({ width: size, height: size, data: new Uint8Array(size * size * 4).fill(255),
    matrix: Float32Array.of(200, 0, 0, 100, .1, .3), pageIndex: 0 });
  const overviews = [page("ocr"), page("raster")], details = [page("ocr"), page("raster")];
  overviews[1].rasterLayers = [raster(4)];
  details.forEach(scene => { scene.rasterLayers = [raster(32)]; });
  let compiles = 0;
  const loader = new PdfPageDemandLoader({ info: { pages: [{ width: 200, height: 100 }, { width: 200, height: 100 }] },
    async compileVectorPage(index, options) { compiles++; return options.previewMaxDimension ? overviews[index] : details[index]; },
    async close() {} }, () => {});
  try {
    await loader.loadInitialOverviews(undefined, true);
    const pages = loader.displayPageScenes, scene = composeVectorScenesInGrid(pages, 2);
    loader.bindDisplayScene(scene, pages);
    const view = { width: 1000, height: 1000, cameraCenterX: 200, cameraCenterY: 50, zoom: .25 };
    loader.update(view, scene.pageRects); await loader.whenIdle();
    const low = loader.getDisplayUpdate(scene);
    assert.equal(low.rasterPages.size, 0);
    assert.equal(scene.rasterLayers.filter(layer => layer.pageDemandSlot).length, 2);
    assert.equal(scene.rasterLayers.filter(layer => !layer.pageDemandSlot).length, 1,
      "only the scan without OCR has an actual overview bitmap");
    loader.update({ ...view, zoom: 2 }, scene.pageRects); await loader.whenIdle();
    const high = loader.getDisplayUpdate(scene);
    assert(high); assert.equal(high.rasterPages.size, 2);
    assert(loader.displayPageScenes.every((value, index) => value === pages[index]), "simple scans do not replace geometry on first detail");
    const again = loader.getDisplayUpdate(scene);
    for (const [index, layer] of high.layers) assert.equal(again.layers.get(index), layer,
      "fractional placement retains the same source identity on every query");
    const visibility = new ScenePaintVisibility(scene), snapshot = createDefaultOptionalContentSnapshot(scene);
    visibility.setVisibility({ ...snapshot, rasterPages: high.rasterPages });
    assert(visibility.select(scene.drawRuns).every(run => run.pdfRepresentation?.detail), "detail hides the overview paint");
    loader.update(view, scene.pageRects); await loader.whenIdle();
    assert.equal(loader.isDisplayUpdateCurrent(scene, high), false, "zoom-out invalidates pending scan transactions");
    visibility.setVisibility({ ...snapshot, rasterPages: low.rasterPages });
    assert(visibility.select(scene.drawRuns).every(run => !run.pdfRepresentation?.detail), "zoom-out selects the overview again");
    loader.update({ ...view, zoom: 2 }, scene.pageRects); await loader.whenIdle();
    const warm = loader.getDisplayUpdate(scene);
    for (const [index, layer] of high.layers) assert.equal(warm.layers.get(index), layer);
    assert.equal(compiles, 4, "repeated transitions reuse decoded scans and never compile page overviews again");
    const snapshotPages = loader.displayPageScenes, oldScene = composeVectorScenesInGrid(snapshotPages, 2);
    loader.previews.set(0, { scene: page("ocr"), bytes: 0 });
    loader.bindDisplayScene(oldScene, snapshotPages);
    assert.equal(loader.getDisplayUpdate(oldScene), null, "binding uses the snapshot actually composed, not newer worker results");
  } finally { await loader.close(); }

  // Execute the native viewer's actual orchestration with a deterministic host.
  const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  let timer, idle, current = true, commits = 0, disposals = 0, swaps = 0, resolvePreparation;
  const scanUpdate = { layers: new Map(), rasterPages: new Set([0]) }, nativeScene = {};
  const fakeLoader = { getDisplayUpdate: () => scanUpdate, isDisplayUpdateCurrent: () => current };
  const context = vm.createContext({ performance, console,
    window: { setTimeout(callback) { timer = callback; return 1; } },
    activePdfPageLoader: fakeLoader, activeSceneLoadToken: null, pendingSourceLoadCount: 0,
    activeHepExportController: null, lastParsedScene: nativeScene,
    demandPdfUpdatePending: false, demandPdfUpdateTimer: null, demandPdfUpdateRunning: false,
    backendSwitcher: { runWhenIdle(callback) { return idle = callback(); } },
    renderer: { prepareRasterLayerUpdates() { throw Error("must use async preparation"); },
      prepareRasterLayerUpdatesAsync: () => new Promise(resolve => { resolvePreparation = () => resolve({
        commit() { commits++; }, dispose() { disposals++; }
      }); }), setPageRasterVisibility() { swaps++; }, recordPerformanceTransition() {} },
    composeVectorScenesInGrid() { throw Error("warm swaps must not compose the document"); },
    prepareSceneForHepRendering() { throw Error("warm swaps must not requantize the document"); },
    applyTextSearchScene() { throw Error("warm swaps must preserve search data"); }, setStatus() {}
  });
  vm.runInContext(sourceFunction(source, "scheduleDemandPdfUpdate"), context);
  context.scheduleDemandPdfUpdate(); timer();
  assert.equal(commits, 0, "old representation stays visible while preparation runs");
  resolvePreparation(); await idle; await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(commits, 1); assert.equal(disposals, 1); assert.equal(swaps, 1);
  context.scheduleDemandPdfUpdate(); timer(); current = false; resolvePreparation(); await idle;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(commits, 1, "outdated preparation is discarded without swapping visibility");
  assert.equal(disposals, 2); assert.equal(swaps, 1);
  assert.equal(context.lastParsedScene, nativeScene);
  assert(context.demandPdfUpdatePending, "an obsolete transaction schedules the latest view");
  console.log("PDF demand swaps: stable scan slots, OCR policy, fractional identities, snapshot binding, warm native path and stale zoom cancellation passed.");
} finally { hooks.deregister(); }
