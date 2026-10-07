import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const previousWarn = console.warn, warnings = [];
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { deviceMemory: .5 } });
console.warn = (...args) => warnings.push(args.join(" "));

try {
  const { PdfPageDemandLoader } = await import("../src/pdfPageDemand.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const baseView = { width: 400, height: 500, cameraCenterX: 300, cameraCenterY: 400, zoom: 1 };
  const fixture = (pageCount, fullBytes = 1024) => {
    const calls = [], completed = [], session = {
      info: { pages: Array.from({ length: pageCount }, (_, index) => ({ index, width: 600, height: 800 })) },
      closed: false, active: 0, maximumActive: 0,
      async compileVectorPage(index, options) {
        calls.push({ index, preview: options.previewMaxDimension, signal: options.signal });
        this.maximumActive = Math.max(this.maximumActive, ++this.active);
        try {
          await this.block?.(index, options);
          options.signal.throwIfAborted();
          const scene = createEmptyVectorScene();
          scene.pageCount = 1;
          scene.bounds = scene.pageBounds = { minX: 0, minY: 0, maxX: 600, maxY: 800 };
          scene.pageRects = Float32Array.of(0, 0, 600, 800);
          scene.rasterLayers = [{ width: 1, height: 1, data: new Uint8Array(options.previewMaxDimension ? 4 : fullBytes),
            matrix: Float32Array.of(600, 0, 0, 800, 0, 0), pageIndex: 0 }];
          completed.push(index);
          return scene;
        } finally { this.active--; }
      },
      async close() { this.closed = true; }
    };
    let changes = 0;
    const loader = new PdfPageDemandLoader(session, () => { changes++; });
    const rectangles = new Float32Array(pageCount * 4);
    for (let index = 0; index < pageCount; index++) rectangles.set([index * 1000, 0, index * 1000 + 600, 800], index * 4);
    return { loader, session, calls, completed, rectangles, get changes() { return changes; } };
  };

  {
    const f = fixture(614);
    assert.equal(f.calls.length, 0, "opening creates page metadata only");
    assert.equal(f.loader.pageScenes.length, 614);
    assert(f.loader.pageScenes.every(page => page.rasterLayers.length === 0));
    const before = composeVectorScenesInGrid(f.loader.pageScenes, 20).pageRects.slice();
    f.loader.update(baseView, f.rectangles);
    await f.loader.whenIdle();
    assert.deepEqual(f.calls.map(call => [call.index, call.preview]), [[0, 96], [0, undefined]],
      "only the visible page is compiled, with a compact preview first");
    assert.equal(f.loader.previewCount, 1);
    assert.equal(f.loader.detailedCount, 1);
    assert.equal(f.session.maximumActive, 1);
    assert.deepEqual(composeVectorScenesInGrid(f.loader.pageScenes, 20).pageRects, before, "page loading preserves the document grid");
    f.loader.update(baseView, f.rectangles); await f.loader.whenIdle();
    assert.equal(f.calls.length, 2, "stationary frames reuse cached pages");
    f.loader.update({ ...baseView, cameraCenterX: 3300 }, f.rectangles); await f.loader.whenIdle();
    assert.deepEqual(f.calls.slice(2).map(call => call.index), [3, 3]);
    f.loader.update(baseView, f.rectangles); await f.loader.whenIdle();
    assert.equal(f.calls.length, 4, "returning to a cached page does not decode it again");
    await f.loader.close();
    assert.equal(f.loader.residentBytes, 0);
    assert(f.session.closed);
  }

  {
    const f = fixture(3);
    const overview = { ...baseView, width: 200, height: 100, cameraCenterX: 800, zoom: .1 };
    f.loader.update(overview, f.rectangles); await f.loader.whenIdle();
    assert.equal(f.loader.previewCount, 2);
    const previews = f.loader.pageScenes;
    f.loader.update(baseView, f.rectangles); await f.loader.whenIdle();
    const firstDetail = f.loader.pageScenes[0];
    assert.notEqual(firstDetail, previews[0]);
    f.loader.update({ ...baseView, cameraCenterX: 1300 }, f.rectangles); await f.loader.whenIdle();
    const secondDetail = f.loader.pageScenes[1];
    assert.notEqual(secondDetail, previews[1]);
    assert.equal(f.loader.pageScenes[0], previews[0], "offscreen cached detail is replaced with its overview preview");
    const calls = f.calls.length, residentBytes = f.loader.residentBytes, changes = f.changes;
    f.loader.update(overview, f.rectangles); await f.loader.whenIdle();
    assert.equal(f.loader.pageScenes[0], previews[0]);
    assert.equal(f.loader.pageScenes[1], previews[1], "visited pages return to the same previews used before zooming in");
    assert.equal(f.changes, changes + 1, "zoom-out notifies the viewer even when no worker compilation is needed");
    assert.equal(f.calls.length, calls);
    assert.equal(f.loader.detailedCount, 2, "display demotion preserves the bounded detailed cache");
    assert.equal(f.loader.residentBytes, residentBytes);
    f.loader.update({ ...overview, zoom: .11 }, f.rectangles); await f.loader.whenIdle();
    assert.equal(f.changes, changes + 1, "unchanged display tiers do not repeatedly upload the scene");
    for (let cycle = 0; cycle < 3; cycle++) {
      f.loader.update(baseView, f.rectangles); await f.loader.whenIdle();
      assert.equal(f.loader.pageScenes[0], firstDetail, "zoom-in reuses the original cached detail immediately");
      assert.equal(f.loader.pageScenes[1], previews[1]);
      f.loader.update(overview, f.rectangles); await f.loader.whenIdle();
      assert.equal(f.loader.pageScenes[0], previews[0]);
      assert.equal(f.loader.pageScenes[1], previews[1]);
    }
    assert.equal(f.calls.length, calls, "repeated zoom cycles do not decode cached pages again");
    assert.equal(f.changes, changes + 7, "both directions of cached zoom transitions notify exactly once");
    await f.loader.close();
  }

  {
    const f = fixture(30, 5 * 1024 * 1024);
    for (let index = 0; index < 20; index++) {
      f.loader.update({ ...baseView, cameraCenterX: index * 1000 + 300 }, f.rectangles);
      await f.loader.whenIdle();
      assert(f.loader.detailedCount <= 3, "CPU payload bytes bound detail before the 12-page ceiling");
      assert(f.loader.residentBytes < 16 * 1024 * 1024);
    }
    f.loader.update(baseView, f.rectangles); await f.loader.whenIdle();
    assert.equal(f.calls.at(-1).index, 0, "evicted detailed pages regenerate on return");
    assert.equal(f.calls.at(-1).preview, undefined, "the compact preview survives detailed-page eviction");
    await f.loader.close();
  }

  {
    const f = fixture(30);
    for (let index = 0; index < 20; index++) {
      f.loader.update({ ...baseView, cameraCenterX: index * 1000 + 300 }, f.rectangles);
      await f.loader.whenIdle();
    }
    assert.equal(f.loader.detailedCount, 12, "the page count also bounds tiny detailed scenes");
    await f.loader.close();
  }

  {
    const f = fixture(3);
    f.loader.update({ ...baseView, width: 100, height: 100, zoom: .1 }, f.rectangles);
    await f.loader.whenIdle();
    assert.deepEqual(f.calls.map(call => call.preview), [96], "overview zoom does not compile full-resolution pages");
    f.loader.requestAllPreviews(); await f.loader.whenIdle();
    assert.equal(f.loader.previewCount, 3, "explicit search loads preview text throughout the document");
    assert.equal(f.loader.detailedCount, 0);
    await f.loader.close();
  }

  {
    const f = fixture(3);
    let entered;
    const entry = new Promise(resolve => { entered = resolve; });
    f.session.block = async (_index, options) => {
      entered();
      await new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
    };
    f.loader.update(baseView, f.rectangles); await entry;
    f.loader.pause(); await f.loader.whenIdle();
    assert(f.calls[0].signal.aborted);
    assert.equal(f.loader.previewCount, 0);
    delete f.session.block;
    f.loader.resume(); await f.loader.whenIdle();
    assert.equal(f.loader.detailedCount, 1, "pausing does not mark the page as failed");
    await f.loader.close();
  }

  {
    const f = fixture(3);
    let enter, release;
    const entered = new Promise(resolve => { enter = resolve; });
    f.session.block = async (_index, options) => {
      if (!options.previewMaxDimension) { enter(); await new Promise(resolve => { release = resolve; }); }
    };
    f.loader.update(baseView, f.rectangles); await entered;
    f.loader.update({ ...baseView, cameraCenterX: 2300 }, f.rectangles);
    delete f.session.block;
    release(); await f.loader.whenIdle();
    assert.equal(f.loader.pageScenes[0].rasterLayers[0].data.length, 4, "obsolete full-page work is discarded after navigation");
    assert.equal(f.loader.detailedCount, 1);
    assert.equal(f.loader.pageScenes[2].rasterLayers[0].data.length, 1024);
    await f.loader.close();
  }
  assert.equal(warnings.length, 0);
  console.log("Demand-driven PDF pages: metadata-only opening, preview/detail priority, zoom demotion and cached promotion, stable layout, sequential work, bounded CPU/page caches, navigation, search, pause and stale-work cancellation passed.");
} finally {
  console.warn = previousWarn;
  if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator); else delete globalThis.navigator;
  hooks.deregister();
}
