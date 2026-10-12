import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { composeVectorScenesInColumn, composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { ScenePageViews } = await import("../src/scenePageViews.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const { getCachedTextLod, prebuildTextLod, reuseTextLodForPageTranslation, storePrebuiltTextLod,
    TextLodRuntime } = await import("../src/textLodCore.ts");
  const { createOrthographicLocalToClip } = await import("../src/planarProjection.ts");
  const page = (width, height, index) => {
    const scene = buildStrokeScene([{ points: [[1, 2], [width - 1, height - 2]], width: 0.2 }]);
    scene.pageRects = Float32Array.of(0, 0, width, height);
    scene.bounds = scene.pageBounds = { minX: 0, minY: 0, maxX: width, maxY: height };
    scene.pdfPages = [{ pageIndex: 0, sourcePageIndex: index, pdfToScene: [1, 0, 0, 1, 0, 0] }];
    scene.annotations = [{ id: `page-${index}`, pageIndex: 0, sourcePageIndex: index, annotationIndex: 0,
      subtype: "Link", bounds: { minX: 1, minY: 2, maxX: 3, maxY: 4 }, pdfGeometry: { rect: [1, 2, 3, 4] },
      flags: 0, visibleInDefaultView: true, hasAppearance: false }];
    return scene;
  };
  const pages = [page(600, 800, 0), page(1000, 400, 1), page(300, 700, 2)];
  const originals = structuredClone(pages);
  const column = composeVectorScenesInColumn(pages);
  assert.deepEqual([...column.pageRects], [-300, -800, 300, 0, -500, -1216, 500, -816, -150, -1932, 150, -1232]);
  assert.equal(column.pagesPerRow, 1);
  assert.equal(column.pageCount, 3);
  assert.deepEqual(column.annotations.map(annotation => annotation.id), ["page-0", "page-1", "page-2"]);
  assert.deepEqual(column.pdfPages.map(page => page.sourcePageIndex), [0, 1, 2]);
  assert.deepEqual(column.pdfPages[1].pdfToScene, [1, 0, 0, 1, -500, -1216]);
  assert.deepEqual(column.annotations[1].bounds, { minX: -499, minY: -1214, maxX: -497, maxY: -1212 });
  assert.deepEqual(pages, originals, "reader composition leaves canonical parser pages untouched");
  assert.equal(composeVectorScenesInColumn([]).pageCount, 0);
  assert.deepEqual([...composeVectorScenesInColumn([pages[0]]).pageRects], [-300, -800, 300, 0]);

  const canonical = composeVectorScenesInGrid(pages, 2);
  const canonicalCopy = structuredClone(canonical);
  const layers = { groups: [{ id: "layer", name: "Layer", defaultVisible: true, locked: false, usedInView: true }],
    conditions: [{ kind: "group", groupId: "layer" }], order: [{ kind: "group", groupId: "layer" }], radioGroups: [] };
  canonical.optionalContent = layers;
  const views = new ScenePageViews(canonical);
  const fromHep = composeVectorScenesInColumn(pages.map((_, index) => views.extract(index).scene));
  assert.equal(fromHep.optionalContent, layers, "HEP page views reuse one document condition table");
  assert.equal(fromHep.optionalContent.conditions.length, 1);
  fromHep.pageRects.forEach((value, index) => assert.ok(Math.abs(value - column.pageRects[index]) < 1e-3,
    "recomposing Float32 HEP coordinates preserves page placement"));
  delete canonical.optionalContent;
  assert.deepEqual(canonical, canonicalCopy, "reader presentation leaves the saved HEP layout unchanged");

  const textPages = [page(600, 800, 0), page(600, 800, 1)];
  for (const scene of textPages) Object.assign(scene, {
    textGlyphCount: 1, textGlyphSegmentCount: 1, textGlyphMetaA: Float32Array.of(0, 1, 0, 0),
    textGlyphMetaB: Float32Array.of(10, 10, 0, 0), textGlyphSegmentsA: Float32Array.of(0, 0, 0, 0),
    textGlyphSegmentsB: Float32Array.of(10, 10, 0, 0), textInstanceCount: 1,
    textInstanceA: Float32Array.of(1, 0, 0, 1), textInstanceB: Float32Array.of(1, 1, 0, 0),
    textInstanceC: Float32Array.of(0, 0, 0, 1), pageTextRanges: Uint32Array.of(0, 1)
  });
  const textCanonical = composeVectorScenesInGrid(textPages, 2), textViews = new ScenePageViews(textCanonical);
  const textColumn = composeVectorScenesInColumn(textPages.map((_, index) => textViews.extract(index).scene));
  assert.equal(textColumn.textGlyphCount, textCanonical.textGlyphCount);
  for (const key of ["textGlyphMetaA", "textGlyphMetaB", "textGlyphSegmentsA", "textGlyphSegmentsB"]) {
    assert.equal(textColumn[key], textCanonical[key], "HEP reader pages retain one immutable document glyph atlas");
  }

  // Synthetic persisted Text LOD follows the same HEP -> page views -> Reader
  // path as the examples, without converting a PDF or starting a renderer.
  const densePages = [0, 1].map(index => {
    const scene = page(600.3 + index * 0.2, 800.7 + index * 0.3, index);
    const count = 25_000;
    Object.assign(scene, {
      textGlyphCount: 1, textGlyphSegmentCount: 4,
      textGlyphMetaA: Float32Array.of(0, 4, 0, 0), textGlyphMetaB: Float32Array.of(1, 1, 0, 0),
      textGlyphSegmentsA: Float32Array.of(0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0),
      textGlyphSegmentsB: Float32Array.of(1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0),
      textInstanceCount: count, pageTextRanges: Uint32Array.of(0, count),
      textInstanceA: new Float32Array(count * 4), textInstanceB: new Float32Array(count * 4),
      textInstanceC: new Float32Array(count * 4),
      drawRuns: [{ kind: "stroke", first: 0, count: scene.segmentCount }, { kind: "text", first: 0, count }]
    });
    for (let i = 0; i < count; i++) {
      scene.textInstanceA.set([1, 0, 0, 1], i * 4);
      scene.textInstanceB.set([0.25 + i % 100 * 1.1, 0.375 + Math.floor(i / 100) * 2.7, 0, 0], i * 4);
      scene.textInstanceC.set([0.1, 0.1, 0.1, 1], i * 4);
    }
    return scene;
  });
  const denseGrid = composeVectorScenesInGrid(densePages, 2);
  const saved = await buildHep(denseGrid, { withVectorLod: false, withTextLod: true });
  const loaded = await loadSceneFromHep(await saved.arrayBuffer());
  const stored = getCachedTextLod(loaded);
  assert(stored?.data, "the synthetic HEP restores an existing Text LOD hierarchy");
  const loadedSnapshot = structuredClone(loaded), storedSnapshot = structuredClone(stored);
  const loadedViews = new ScenePageViews(loaded);
  const reader = composeVectorScenesInColumn(densePages.map((_, index) => loadedViews.extract(index).scene));
  assert.equal(getCachedTextLod(reader), null, "the new layout initially has a separate cache identity");

  const previousWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  let workerStarts = 0, buildProgress = 0;
  Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true,
    value: class { constructor() { workerStarts++; throw new Error("Reader must reuse the stored Text LOD"); } } });
  try {
    assert.equal(reuseTextLodForPageTranslation(loaded, reader), true);
    const reused = getCachedTextLod(reader), data = reused.data;
    assert.equal(await prebuildTextLod(reader, { onProgress() { buildProgress++; } }), reused,
      "the native preparation step adopts the translated hierarchy instead of rebuilding");
    assert.equal(workerStarts, 0, "Reader reuse does not start a LOD worker");
    assert.equal(buildProgress, 0, "Reader reuse does not scan the exact glyphs again");
    assert.equal(reused.buildTimeMs, 0, "translated caches do not report a fresh hierarchy build");
    assert.equal(data.coarseInstanceA, stored.data.coarseInstanceA);
    assert.equal(data.coarseInstanceC, stored.data.coarseInstanceC);
    assert.notEqual(data.coarseInstanceB, stored.data.coarseInstanceB,
      "translated origins have separate storage from the saved layout");
    assert.equal(data.exactInstanceCount, stored.data.exactInstanceCount);
    assert.equal(data.combinedInstanceCount, stored.data.combinedInstanceCount);
    assert.equal(data.runs.length, stored.data.runs.length);
    assert.equal(data.clusters.length, stored.data.clusters.length);
    assert.equal(data.pages.length, stored.data.pages.length);
    assert(Object.isFrozen(data) && Object.isFrozen(data.runs) && Object.isFrozen(data.clusters) && Object.isFrozen(data.pages));
    for (let i = 0; i < data.runs.length; i++) {
      const run = data.runs[i], original = stored.data.runs[i];
      assert.equal(run.exactStart, original.exactStart);
      assert.equal(run.exactCount, original.exactCount);
      assert.equal(run.coarseIndex, original.coarseIndex);
      assert.equal(run.pageIndex, original.pageIndex);
      assert(Object.isFrozen(run) && Object.isFrozen(run.bounds) && Object.isFrozen(run.transform));
      if (run.coarseIndex >= 0) {
        const offset = run.coarseIndex * 4;
        assert.equal(data.coarseInstanceB[offset + 2], stored.data.coarseInstanceB[offset + 2]);
        assert.equal(data.coarseInstanceB[offset + 3], stored.data.coarseInstanceB[offset + 3]);
        assert(Math.abs(data.coarseInstanceB[offset] - run.transform[4]) < 0.001);
        assert(Math.abs(data.coarseInstanceB[offset + 1] - run.transform[5]) < 0.001);
      }
    }
    for (const node of [...data.runs, ...data.clusters, ...data.pages]) {
      assert(Object.isFrozen(node) && Object.isFrozen(node.bounds));
      for (let i = node.exactStart; i < node.exactStart + node.exactCount; i++) {
        const x = reader.textInstanceB[i * 4], y = reader.textInstanceB[i * 4 + 1];
        assert(node.bounds.minX <= x && node.bounds.minY <= y && node.bounds.maxX >= x + 1 && node.bounds.maxY >= y + 1,
          "translated culling nodes conservatively contain the actual Float32 glyph geometry");
      }
    }
    for (const pageNode of data.pages) {
      const centerX = (pageNode.bounds.minX + pageNode.bounds.maxX) / 2;
      const centerY = (pageNode.bounds.minY + pageNode.bounds.maxY) / 2;
      const view = { localToClip: createOrthographicLocalToClip(centerX, centerY, 0.2, 60, 60),
        viewportWidth: 60, viewportHeight: 60 };
      const selection = new TextLodRuntime(reused).update(view);
      assert(selection.stats.coarseClusters > 0, "translated Reader text is visible at overview scale");
      assert(selection.instanceIds.length > 0);
      const pageCoarseIds = new Set(data.runs.filter(run => run.pageIndex === pageNode.pageIndex && run.coarseIndex >= 0)
        .map(run => data.exactInstanceCount + run.coarseIndex));
      assert(selection.instanceIds.every(id => pageCoarseIds.has(id)),
        "a Reader viewport selects the translated page without pulling text from another page");
    }

    assert.equal(reuseTextLodForPageTranslation(reader, loaded), true,
      "switching back to Grid keeps the canonical cache available");
    assert.equal(await prebuildTextLod(loaded), stored, "restoring Grid preserves the original cached hierarchy");
    const readerAgain = composeVectorScenesInColumn(densePages.map((_, index) => loadedViews.extract(index).scene));
    assert.equal(reuseTextLodForPageTranslation(reader, readerAgain), true,
      "repeated Reader changes can reuse the previous presentation's hierarchy");
    assert.equal(await prebuildTextLod(readerAgain), getCachedTextLod(readerAgain));

    const farReader = composeVectorScenesInColumn(densePages.map((_, index) => loadedViews.extract(index).scene));
    for (let i = 1; i < farReader.pageRects.length; i += 2) farReader.pageRects[i] -= 1_000_000;
    for (let i = 1; i < farReader.textInstanceB.length; i += 4) farReader.textInstanceB[i] -= 1_000_000;
    farReader.pdfPages = farReader.pdfPages.map(page => ({ ...page,
      pdfToScene: [...page.pdfToScene.slice(0, 5), page.pdfToScene[5] - 1_000_000] }));
    assert(farReader.pdfPages.some((page, index) => Math.abs(
      farReader.pageRects[index * 4 + 1] - loaded.pageRects[index * 4 + 1] -
      (page.pdfToScene[5] - loaded.pdfPages[index].pdfToScene[5])) > 0.001),
    "long Reader coordinates expose the precision lost by Float32 page rectangles");
    assert.equal(reuseTextLodForPageTranslation(loaded, farReader), true);
    const farData = getCachedTextLod(farReader).data;
    for (let i = 0; i < farData.runs.length; i++) {
      const run = farData.runs[i], original = stored.data.runs[i];
      const dy = farReader.pdfPages[run.pageIndex].pdfToScene[5] - loaded.pdfPages[run.pageIndex].pdfToScene[5];
      assert.equal(run.transform[5], original.transform[5] + dy,
        "coarse transforms retain the precise PDF placement instead of the rounded page rectangle offset");
    }
    for (const node of [...farData.runs, ...farData.clusters, ...farData.pages]) {
      for (let i = node.exactStart; i < node.exactStart + node.exactCount; i++) {
        const x = farReader.textInstanceB[i * 4], y = farReader.textInstanceB[i * 4 + 1];
        assert(node.bounds.minX <= x && node.bounds.minY <= y && node.bounds.maxX >= x + 1 && node.bounds.maxY >= y + 1,
          "far Reader culling bounds contain the rounded exact glyph geometry at every hierarchy level");
      }
    }
    assert.equal(await prebuildTextLod(farReader), getCachedTextLod(farReader));
    assert.equal(workerStarts, 0);
    assert.deepEqual(loaded, loadedSnapshot, "LOD reuse leaves canonical HEP geometry unchanged");
    assert.deepEqual(stored, storedSnapshot, "LOD reuse leaves the saved hierarchy and coarse buffers unchanged");
  } finally {
    if (previousWorker) Object.defineProperty(globalThis, "Worker", previousWorker);
    else delete globalThis.Worker;
  }

  const freshReader = () => composeVectorScenesInColumn(densePages.map((_, index) => loadedViews.extract(index).scene));
  const uncached = freshReader(), missingTarget = freshReader();
  assert.equal(reuseTextLodForPageTranslation(uncached, missingTarget), false);
  assert.equal(getCachedTextLod(missingTarget), null, "missing caches fall through to normal preparation");
  const mismatchedRanges = freshReader();
  mismatchedRanges.pageTextRanges = mismatchedRanges.pageTextRanges.slice();
  mismatchedRanges.pageTextRanges[1]--;
  assert.equal(reuseTextLodForPageTranslation(loaded, mismatchedRanges), false);
  assert.equal(getCachedTextLod(mismatchedRanges), null, "changed source IDs cannot reuse a stale hierarchy");
  const changedCount = freshReader();
  changedCount.textInstanceCount--;
  assert.equal(reuseTextLodForPageTranslation(loaded, changedCount), false,
    "changed exact instance counts need a fresh hierarchy");
  const resizedPage = freshReader();
  resizedPage.pageRects[2] += 10;
  assert.equal(reuseTextLodForPageTranslation(loaded, resizedPage), false,
    "resizing a page is not a translation");
  const differentAtlas = freshReader();
  differentAtlas.textGlyphMetaA = differentAtlas.textGlyphMetaA.slice();
  assert.equal(reuseTextLodForPageTranslation(loaded, differentAtlas), false,
    "reuse requires the same immutable document glyph atlas");
  const scaledPage = freshReader();
  scaledPage.pdfPages = scaledPage.pdfPages.map((page, index) => index === 0
    ? { ...page, pdfToScene: [2, ...page.pdfToScene.slice(1)] } : page);
  assert.equal(reuseTextLodForPageTranslation(loaded, scaledPage), false,
    "page scaling needs a fresh hierarchy rather than translation reuse");
  const noPdfSource = { ...loaded, pdfPages: undefined }, noPdfTarget = freshReader();
  delete noPdfTarget.pdfPages;
  storePrebuiltTextLod(noPdfSource, stored);
  assert.equal(reuseTextLodForPageTranslation(noPdfSource, noPdfTarget), true,
    "scenes without PDF metadata can still reuse a pure page translation");
  for (const node of getCachedTextLod(noPdfTarget).data.pages) {
    for (let i = node.exactStart; i < node.exactStart + node.exactCount; i++) {
      const x = noPdfTarget.textInstanceB[i * 4], y = noPdfTarget.textInstanceB[i * 4 + 1];
      assert(node.bounds.minX <= x && node.bounds.minY <= y && node.bounds.maxX >= x + 1 && node.bounds.maxY >= y + 1,
        "Float32 rectangle fallback preserves conservative glyph culling");
    }
  }
  const alreadyCached = freshReader();
  const existing = { data: null, fallbackReason: "resource-capacity", buildTimeMs: 17 };
  storePrebuiltTextLod(alreadyCached, existing);
  reuseTextLodForPageTranslation(loaded, alreadyCached);
  assert.equal(getCachedTextLod(alreadyCached), existing, "reuse does not overwrite a target's own completed build");
  const pendingTarget = freshReader();
  const pending = prebuildTextLod(pendingTarget, { yieldIntervalMs: 0 });
  assert.equal(reuseTextLodForPageTranslation(loaded, pendingTarget), false,
    "reuse does not replace a target's in-flight build");
  assert.equal(await prebuildTextLod(pendingTarget), await pending);
  console.log("Column page layout: mixed page sizes, canonical preservation, and persisted Text LOD reuse across layouts passed.");
} finally { hooks.deregister(); }
