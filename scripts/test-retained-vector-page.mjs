import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts") ? `${specifier}.ts` : specifier, context);
} });
try {
  const [{ openPdf }, { lowerRetainedPageToVectorScene }, { getScenePrimitive }, { validateVectorDrawRuns }] = await Promise.all([
    import("../src/pdfSession.ts"), import("../src/retainedVectorPage.ts"), import("../src/scenePrimitives.ts"), import("../src/vectorDrawOrder.ts")
  ]);
  const fixture = (content, resources, extra = []) => writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << ${resources} >> /Contents 4 0 R >>` },
    { number: 4, body: tinyPdfStream("", content) }, ...extra
  ] });
  const compile = async bytes => {
    const session = await openPdf({ kind: "bytes", bytes });
    try {
      const page = await session.compilePage(0, { retainOptionalContent: true });
      const original = structuredClone(page);
      const scene = await lowerRetainedPageToVectorScene(page, { signal: new AbortController().signal });
      assert.deepEqual(page, original, "retained lowering leaves all source stores unchanged");
      validateVectorDrawRuns(scene);
      const { validateScenePaintGraph } = await import("../src/scenePaintGraph.ts");
      validateScenePaintGraph(scene);
      const integrated = await session.compileVectorPage(0, { vectorFallback: "error" });
      assert.equal(integrated.rasterLayers.length, 0, "the viewer compiler uses vector lowering before raster fallback");
      validateVectorDrawRuns(integrated);
      return { page, scene };
    } finally { await session.close(); }
  };
  {
    const { scene } = await compile(fixture("q 2 0 0 2 3 4 cm 0 0 1 rg 0 0 10 10 re f 1 0 0 RG 0 20 m 10 20 l S Q", ""));
    assert.equal(scene.fillPathCount, 1); assert.equal(scene.segmentCount, 1);
    assert.deepEqual(getScenePrimitive(scene, { kind: "fill", index: 0 }).color, [0, 0, 1]);
    assert.deepEqual(getScenePrimitive(scene, { kind: "fill", index: 0 }).bounds, { minX: 3, minY: 4, maxX: 23, maxY: 24 });
    assert.equal(scene.rasterLayers.length, 0);
  }
  {
    const { scene } = await compile(fixture("/Pattern cs /P scn 0 0 20 20 re f", "/Pattern << /P 5 0 R >>", [
      { number: 5, body: tinyPdfStream("/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 5 5] /XStep 10 /YStep 10 /Resources << >>", "0 0 1 rg 0 0 5 5 re f") }
    ]));
    assert.ok(scene.fillPathCount >= 4); assert.equal(scene.rasterLayers.length, 0);
    assert.ok(scene.clipPaths.length > 0, "cell paint is clipped to the original path");
    assert.deepEqual(getScenePrimitive(scene, { kind: "fill", index: 0 }).color, [0, 0, 1]);
  }
  {
    const { scene } = await compile(fixture("/PCS cs 1 0 0 /P scn 0 0 20 20 re f", "/ColorSpace << /PCS [/Pattern /DeviceRGB] >> /Pattern << /P 5 0 R >>", [
      { number: 5, body: tinyPdfStream("/Type /Pattern /PatternType 1 /PaintType 2 /TilingType 1 /BBox [0 0 5 5] /XStep 10 /YStep 10 /Resources << >>", "0 0 5 5 re f") }
    ]));
    assert.ok(scene.fillPathCount >= 4); assert.deepEqual(getScenePrimitive(scene, { kind: "fill", index: 0 }).color, [1, 0, 0]);
  }
  {
    const { scene } = await compile(fixture("BT /F 20 Tf 1 0 0 1 10 20 Tm (A) Tj ET", "/Font << /F 5 0 R >>", [
      { number: 5, body: "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 500 500] /FontMatrix [.001 0 0 .001 0 0] /CharProcs << /A 6 0 R >> /Encoding << /Type /Encoding /Differences [65 /A] >> /FirstChar 65 /LastChar 65 /Widths [500] /Resources << >> >>" },
      { number: 6, body: tinyPdfStream("", "500 0 d0 0 1 0 rg 0 0 500 500 re f") }
    ]));
    assert.equal(scene.fillPathCount, 1, "Type3 program remains vector paint");
    assert.equal(scene.rasterLayers.length, 0);
    assert.match(scene.textIndex.pages[0].text, /A/);
    const bounds = getScenePrimitive(scene, { kind: "fill", index: 0 }).bounds;
    assert.ok(Math.abs(bounds.minX - 10) < 1e-4 && Math.abs(bounds.maxX - 20) < 1e-4);
  }
  {
    const { scene } = await compile(fixture("/S sh", "/Shading << /S 5 0 R >>", [
      { number: 5, body: "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function 6 0 R /Extend [false true] >>" },
      { number: 6, body: "<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>" }
    ]));
    assert.equal(scene.gradientFillPathCount, 1); assert.equal(scene.gradientCount, 1);
    assert.equal(scene.drawRuns[0].kind, "gradient-fill");
  }
  {
    const { scene } = await compile(fixture("/Pattern cs /P scn 10 10 20 20 re f", "/Pattern << /P 5 0 R >>", [
      { number: 5, body: "<< /Type /Pattern /PatternType 2 /Shading 6 0 R >>" },
      { number: 6, body: "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function 7 0 R /Extend [true true] >>" },
      { number: 7, body: "<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>" }
    ]));
    assert.equal(scene.gradientFillPathCount, 1);
    assert.deepEqual(getScenePrimitive(scene, { kind: "gradient-fill", index: 0 }).bounds,
      { minX: 10, minY: 10, maxX: 30, maxY: 30 });
  }
  {
    const { scene } = await compile(fixture("/GS gs /Fm Do", "/ExtGState << /GS << /ca .5 >> >> /XObject << /Fm 5 0 R >>", [
      { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Group << /S /Transparency /I true >> /Resources << >>", "1 0 0 rg 0 0 20 20 re f 10 10 20 20 re f") }
    ]));
    assert.equal(scene.fillPathCount, 2);
    const groups = [];
    const visit = nodes => { for (const node of nodes) if (node.kind === "group") { groups.push(node); visit(node.children); } };
    visit(scene.paintGraph.roots);
    assert.ok(groups.some(group => group.alpha === 0.5), "group alpha stays on the compositing boundary");
  }
  {
    const { scene, page } = await compile(fixture("/GS gs 1 0 0 rg 0 0 20 20 re f 30 0 20 20 re f", "/ExtGState << /GS 5 0 R >>", [
      { number: 5, body: "<< /SMask << /S /Alpha /G 6 0 R /TR 7 0 R >> >>" },
      { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Group << /S /Transparency /I true /CS /DeviceRGB >> /Resources << >>", "1 1 1 rg 0 0 10 10 re f") },
      { number: 7, body: "<< /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 2 >>" }
    ]));
    const masks = [];
    const visit = nodes => { for (const node of nodes) if (node.kind === "group") { if (node.softMask) masks.push(node.softMask); visit(node.children); } };
    visit(scene.paintGraph.roots);
    assert.equal(masks.length, 2, "each invocation owns graph nodes while source mask definitions remain reusable");
    assert.notEqual(masks[0].children[0], masks[1].children[0]);
    assert.equal(masks[0].transfer.length, 1024);
    assert.ok(Math.abs(masks[0].transfer[512] - (512 / 1023) ** 2) < 1e-6);
    await assert.rejects(lowerRetainedPageToVectorScene(page, { signal: AbortSignal.abort() }));
    await assert.rejects(lowerRetainedPageToVectorScene(page, { signal: new AbortController().signal, maxPrimitives: 0 }), error => error.code === "resource-limit");
  }
  {
    const { scene } = await compile(fixture("/GS gs 1 0 0 rg 0 0 20 20 re f", "/ExtGState << /GS << /SMask << /S /Alpha /G 5 0 R >> >> >>", [
      { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Group << /S /Transparency /I true /CS /DeviceRGB >> /Resources << /Pattern << /P 6 0 R >> >>", "/Pattern cs /P scn 0 0 20 20 re f") },
      { number: 6, body: tinyPdfStream("/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 5 5] /XStep 10 /YStep 10 /Resources << /ExtGState << /Inner << /SMask << /S /Alpha /G 7 0 R >> >> >> >>", "/Inner gs 1 1 1 rg 0 0 5 5 re f") },
      { number: 7, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 5 5] /Group << /S /Transparency /I true /CS /DeviceRGB >> /Resources << >>", "1 1 1 rg 0 0 2.5 5 re f") }
    ]));
    const { ScenePrimitivePicker } = await import("../src/scenePrimitives.ts");
    const picker = new ScenePrimitivePicker(scene);
    const pick = (x, y) => picker.pick({ point: { x, y }, clientPoint: { x, y }, project: p => p, unproject: p => p, tolerancePx: 0 });
    assert.ok(await pick(1, 1), "pattern-cell mask executions do not overwrite the enclosing mask graph");
    assert.equal(await pick(4, 1), null, "nested pattern masks retain their individual geometry");
    picker.dispose();
  }
  {
    const { scene } = await compile(fixture("/F Do", "/XObject << /F 5 0 R >>", [
      { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Group << /S /Transparency /I true /K true >> /Resources << /ExtGState << /GS << /CA .5 >> >> >>", "/GS gs 10 w 0 10 m 20 10 l 10 0 m 10 20 l S") }
    ]));
    const groups = [];
    const visit = nodes => { for (const node of nodes) if (node.kind === "group") { groups.push(node); visit(node.children); } };
    visit(scene.paintGraph.roots);
    const knockout = groups.find(group => group.knockout);
    assert.equal(knockout.children.length, 1, "one PDF stroke remains one knockout object");
    assert.equal(knockout.children[0].alpha, .5);
    assert.equal(scene.fillPathCount, 1, "crossing translucent stroke subpaths share one union outline");
    assert.equal(scene.fillPathMetaC[3], 1, "paint alpha applies once to the completed outline");
  }
  {
    const patternCell = tinyPdfStream("/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 5 5] /XStep 10 /YStep 10 /Resources << >>", "0 0 1 rg 0 0 5 5 re f");
    const session = await openPdf({ kind: "bytes", bytes: fixture("/Pattern cs /P scn 0 0 20 20 re f", "/Pattern << /P 5 0 R >>", [
      { number: 5, body: patternCell }
    ]) });
    try {
      const scene = await session.compileVectorPage(0, { retainedVectorMaxPatternCells: 1 });
      assert.equal(scene.rasterLayers.length, 1);
      // A retained program only ever replays from an optional-content change, so a
      // document without toggleable layers must not carry one into the scene or a HEP.
      assert.equal(scene.retainedPages, undefined, "an unreachable replay program is not retained");
      assert.equal(scene.paintGraph, undefined, "the baked raster slot needs no retained paint graph");
      assert.ok(session.getDiagnostics().some(diagnostic =>
        diagnostic.code === "retained-raster-fallback" && diagnostic.details.replayable === false));
      await assert.rejects(session.compileVectorPage(0, { retainedVectorMaxPatternCells: 1, vectorFallback: "error" }), error => error.details?.reason === "vector-expansion-limit");
      await assert.rejects(session.compileVectorPage(0, { limits: { maxPathCoordinatesPerPage: 1 } }), error => error.code === "resource-limit" && error.details?.reason !== "vector-expansion-limit");
    } finally { await session.close(); }
    const layered = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties 10 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Pattern << /P 5 0 R >> /Properties << /A 11 0 R >> >> /Contents 4 0 R >>" },
      { number: 4, body: tinyPdfStream("", "/OC /A BDC /Pattern cs /P scn 0 0 20 20 re f EMC") },
      { number: 5, body: patternCell },
      { number: 10, body: "<< /OCGs [11 0 R] /D << >> >>" },
      { number: 11, body: "<< /Type /OCG /Name (Fill) >>" }
    ] }) });
    try {
      const scene = await layered.compileVectorPage(0, { retainedVectorMaxPatternCells: 1 });
      assert.equal(scene.rasterLayers.length, 1); assert.equal(scene.retainedPages.length, 1);
      assert.equal(scene.paintGraph.roots[0].kind, "retained");
      assert.ok(layered.getDiagnostics().some(diagnostic =>
        diagnostic.code === "retained-raster-fallback" && diagnostic.details.replayable === true));
    } finally { await layered.close(); }
  }
  {
    const { HEPR_IMAGE_FORMAT } = await import("../src/heprDocumentData.ts");
    const size = 32;
    const gray = Uint8Array.from({ length: size * size }, (_, index) => (index * 7 + 13) & 255);
    const rgb = Uint8Array.from({ length: size * size * 3 }, (_, index) => (index * 37) & 255);
    const image = (extra, bytes) => tinyPdfStream(
      `/Type /XObject /Subtype /Image /Width ${size} /Height ${size} /BitsPerComponent 8 ${extra}`, bytes);
    const session = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /XObject << /G 5 0 R /C 6 0 R >> >> /Contents 4 0 R >>" },
      { number: 4, body: tinyPdfStream("", "q 90 0 0 90 5 5 cm /G Do Q\nq 90 0 0 90 100 5 cm /C Do Q") },
      { number: 5, body: image("/ColorSpace /DeviceGray", gray) },
      { number: 6, body: image("/ColorSpace /DeviceRGB", rgb) }
    ] }) });
    try {
      const page = await session.compilePage(0, {});
      const images = page.stores.images;
      // A DeviceGray source keeps one byte per pixel in the store a retained
      // page serializes; only the scene's raster layer is straight RGBA8.
      assert.deepEqual([...images.formats], [HEPR_IMAGE_FORMAT.Gray8, HEPR_IMAGE_FORMAT.Rgba8]);
      assert.equal(images.dataOffsets[1] - images.dataOffsets[0], size * size);
      const scene = await lowerRetainedPageToVectorScene(page, { signal: new AbortController().signal });
      assert.equal(scene.rasterLayers.length, 2);
      for (const layer of scene.rasterLayers) assert.equal(layer.data.length, size * size * 4);
      const widened = scene.rasterLayers[0].data;
      assert.deepEqual([...widened], [...gray].flatMap(value => [value, value, value, 255]),
        "a Gray8 store widens to the straight RGBA8 a renderer uploads");
    } finally { await session.close(); }
  }
  {
    const { buildTinySfnt } = await import("./lib/tinySfnt.mjs");
    const session = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Resources << /Font << /F 5 0 R >> >> /Contents 4 0 R >>" },
      // Two distinct glyphs, twelve placements, plus one run at a second size.
      { number: 4, body: tinyPdfStream("", [
          "BT /F 12 Tf 1 0 0 1 10 60 Tm (ABABABABAB) Tj ET",
          "BT /F 24 Tf 1 0 0 1 10 20 Tm (AB) Tj ET"
        ].join("\n")) },
      { number: 5, body: "<< /Type /Font /Subtype /TrueType /BaseFont /Fixture /FirstChar 65 /LastChar 66 /Widths [500 600] /Encoding /WinAnsiEncoding >>" }
    ] }) }, { missingFontResolver: () => ({ sfntBytes: buildTinySfnt(), identifier: "retained-glyph-atlas-v1" }) });
    try {
      const page = await session.compilePage(0, {});
      const scene = await lowerRetainedPageToVectorScene(page, { signal: new AbortController().signal });
      assert.equal(scene.textInstanceCount, 12, "every drawn glyph keeps its own instance");
      // Outlines are shared per (font, glyph, 2x2), so two letters at two sizes
      // need four atlas entries, not one per placement.
      assert.equal(scene.textGlyphCount, 4, "repeated glyphs reuse one atlas outline");
      const glyphOf = i => Math.trunc(scene.textInstanceB[i * 4 + 2]);
      assert.equal(glyphOf(0), glyphOf(2), "the same letter at the same size shares an entry");
      assert.notEqual(glyphOf(0), glyphOf(1), "different letters keep separate entries");
      assert.notEqual(glyphOf(0), glyphOf(10), "a second size does not reuse the smaller outline");
      // Placement must live on the instance, not be baked into the outline.
      assert.notEqual(scene.textInstanceB[0], scene.textInstanceB[2 * 4],
        "repeated glyphs advance through the instance origin");
      for (let i = 0; i < scene.textInstanceCount; i += 1) {
        assert.deepEqual([...scene.textInstanceA.subarray(i * 4, i * 4 + 4)], [1, 0, 0, 1],
          "the 2x2 is resolved into the shared outline");
      }
    } finally { await session.close(); }
  }
  {
    const { buildTinySfnt } = await import("./lib/tinySfnt.mjs");
    // One glyph, three characters: the "ffi" ligature case. Each character must
    // own a fallback quad, because the exported char map addresses quads by
    // position and a reader drops the whole index when the counts disagree.
    const toUnicode = tinyPdfStream("", [
      "/CIDInit /ProcSet findresource begin 12 dict begin begincmap",
      "1 begincodespacerange <00> <FF> endcodespacerange",
      "1 beginbfchar <41> <006600660069> endbfchar",
      "endcmap end end"
    ].join("\n"));
    const session = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F 5 0 R >> >> /Contents 4 0 R >>" },
      { number: 4, body: tinyPdfStream("", "BT /F 24 Tf 1 0 0 1 10 40 Tm (AB) Tj ET") },
      { number: 5, body: "<< /Type /Font /Subtype /TrueType /BaseFont /Fixture /FirstChar 65 /LastChar 66 /Widths [500 600] /Encoding /WinAnsiEncoding /ToUnicode 6 0 R >>" },
      { number: 6, body: toUnicode }
    ] }) }, { missingFontResolver: () => ({ sfntBytes: buildTinySfnt(), identifier: "retained-ligature-v1" }) });
    try {
      const page = await session.compilePage(0, {});
      const shared = page.textIndex.charGlyphIndices;
      assert.equal(page.textIndex.text, "ffiB", "the ToUnicode ligature expands to three characters");
      assert.equal(shared[0], shared[1], "a ligature's characters share one glyph");
      assert.equal(shared[1], shared[2], "a ligature's characters share one glyph");
      const scene = await lowerRetainedPageToVectorScene(page, { signal: new AbortController().signal });
      const index = scene.textIndex.pages[0];
      const fallbacks = [...index.charInstance].filter(value => value <= -2);
      assert.equal(fallbacks.length, index.fallbackQuads.length / 4,
        "every fallback character owns exactly one quad");
      const quadOf = i => [...index.fallbackQuads.subarray((-index.charInstance[i] - 2) * 4, (-index.charInstance[i] - 2) * 4 + 4)];
      assert.notEqual(index.charInstance[0], index.charInstance[1], "each character gets its own slot");
      assert.deepEqual(quadOf(0), quadOf(1), "the ligature's characters keep the same rectangle");
      assert.deepEqual(quadOf(1), quadOf(2), "the ligature's characters keep the same rectangle");
      assert.notDeepEqual(quadOf(0), quadOf(3), "a different glyph keeps its own rectangle");
    } finally { await session.close(); }
  }
  console.log("Retained vector page tests passed.");
} finally { hooks.deregister(); }
