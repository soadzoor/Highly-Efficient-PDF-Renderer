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
  console.log("Column page layout: mixed page sizes, source identities, shared layers and canonical preservation passed.");
} finally { hooks.deregister(); }
