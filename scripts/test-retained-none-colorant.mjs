import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const [{ openPdf }, { lowerRetainedPageToVectorScene }, { renderHeprPageToCanvas2d },
    { HeprColorEvaluator }, { HEPR_COLOR_SPACE_KIND, HEPR_PAINT_KIND }, { validateScenePaintGraph }] = await Promise.all([
    import("../src/pdfSession.ts"), import("../src/retainedVectorPage.ts"), import("../src/heprCanvas2dRenderer.ts"),
    import("../src/heprColorEvaluator.ts"), import("../src/heprDocumentData.ts"), import("../src/scenePaintGraph.ts")
  ]);
  // Compile ordinary spots first, then mark their retained names /None. This
  // exercises persisted commands independently of the compiler's paint filtering.
  const fixture = content => writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << " +
      "/ColorSpace << /S [/Separation /Dormant /DeviceRGB 8 0 R] " +
      "/DN [/DeviceN [/DormantA /DormantB] /DeviceRGB 9 0 R] " +
      "/Mix [/DeviceN [/DormantA /Active] /DeviceRGB 9 0 R] " +
      "/PS [/Pattern /S] /PC /Pattern >> /Font << /F 5 0 R >> " +
      "/Pattern << /U 10 0 R /C 11 0 R /Sh 15 0 R >> /XObject << /Im 6 0 R /Mask 7 0 R /Fm 12 0 R >> >> >>" },
    { number: 4, body: tinyPdfStream("", content) },
    { number: 5, body: "<< /Type /Font /Subtype /TrueType /BaseFont /NoneFixture /Encoding /WinAnsiEncoding >>" },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8", Uint8Array.of(0, 255, 0)) },
    { number: 7, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ImageMask true /BitsPerComponent 1", Uint8Array.of(0)) },
    { number: 8, body: "<< /FunctionType 2 /Domain [0 1] /C0 [0 0 1] /C1 [0 0 1] /N 1 >>" },
    { number: 9, body: tinyPdfStream("/FunctionType 4 /Domain [0 1 0 1] /Range [0 1 0 1 0 1]", "{ pop dup dup }") },
    { number: 10, body: tinyPdfStream("/Type /Pattern /PatternType 1 /PaintType 2 /TilingType 1 /BBox [0 0 5 5] /XStep 5 /YStep 5 /Resources << >>", "0 0 5 5 re f") },
    { number: 11, body: tinyPdfStream("/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 5 5] /XStep 5 /YStep 5 /Resources << >>", "1 0 0 rg 0 0 5 5 re f") },
    { number: 12, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << >>", "10 70 20 10 re f") },
    { number: 13, body: "<< /ShadingType 2 /ColorSpace /S /Coords [0 0 100 0] /Function 14 0 R /Extend [true true] >>" },
    { number: 14, body: "<< /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 1 >>" },
    { number: 15, body: "<< /Type /Pattern /PatternType 2 /Shading 13 0 R >>" }
  ] });
  const compile = async content => {
    const session = await openPdf({ kind: "bytes", bytes: fixture(content) }, {
      missingFontResolver: () => ({ sfntBytes: buildTinySfnt(), identifier: "none-colorant-fixture" })
    });
    try {
      const page = await session.compilePage(0, { optimization: "none", retainOptionalContent: true });
      page.stores.colors.names = page.stores.colors.names.map(name => name.startsWith("Dormant") ? "None" : name);
      const colors = page.stores.colors;
      const none = Array.from(colors.spaceKinds.keys()).find(index => colors.spaceKinds[index] === HEPR_COLOR_SPACE_KIND.Separation);
      const allNone = Array.from(colors.spaceKinds.keys()).find(index => colors.spaceKinds[index] === HEPR_COLOR_SPACE_KIND.DeviceN);
      // The dense adapter canonicalizes ordinary spot paints to RGB. Retarget
      // those paints to the retained source /None resources for this replay test.
      for (let index = 0; index < page.stores.paints.kinds.length; index++) {
        if (page.stores.paints.kinds[index] !== HEPR_PAINT_KIND.SolidColor) continue;
        const resource = page.stores.paints.resourceIndices[index];
        const rgb = [...colors.parameters.subarray(colors.parameterOffsets[resource], colors.parameterOffsets[resource + 1])];
        if (rgb.join() === "0,0,1") page.stores.paints.resourceIndices[index] = none;
        if (rgb.join() === "1,1,1") page.stores.paints.resourceIndices[index] = allNone;
      }
      return page;
    } finally { await session.close(); }
  };
  const lower = async page => {
    const original = structuredClone(page);
    const scene = await lowerRetainedPageToVectorScene(page, { signal: new AbortController().signal });
    assert.deepEqual(page, original, "no-paint lowering leaves source stores unchanged");
    validateScenePaintGraph(scene);
    return scene;
  };
  const content = [
    ".2 .4 .6 rg 0 0 100 100 re f",
    "/S cs 0 scn 10 10 20 20 re f",
    "1 0 0 RG 2 w 40 10 20 20 re B",
    "/S CS 0 SCN 1 0 0 rg 70 10 20 20 re B",
    "/DN cs 1 0 scn 10 40 20 10 re f",
    "/Mix cs 0 1 scn 40 40 20 10 re f",
    "/PS cs 0 /U scn 70 40 20 10 re f",
    "/S cs 0 scn /PC cs /C scn 10 55 20 10 re f",
    "/S cs 0 scn q 10 0 0 10 40 55 cm /Im Do Q q 10 0 0 10 55 55 cm /Mask Do Q",
    "q /S cs 0 scn 70 55 20 10 re W f 0 1 0 rg 0 0 100 100 re f Q",
    "/S cs 0 scn /Fm Do"
  ].join("\n");
  const page = await compile(content), scene = await lower(page);
  assert.equal(scene.rasterLayers.length, 1, "ordinary image survives while the /None stencil disappears");
  assert.deepEqual([...scene.rasterLayers[0].data], [0, 255, 0, 255]);
  assert.equal(scene.gradientCount ?? 0, 0);
  const colors = new HeprColorEvaluator(page.stores.colors, () => { throw new Error("unexpected tint evaluation"); });
  const noneIndices = Array.from(page.stores.colors.spaceKinds.keys()).filter(index => !colors.paints(index));
  assert(noneIndices.length > 1, "Separation and DeviceN all-/None paints are retained explicitly");
  for (const index of noneIndices) assert.throws(() => colors.convert(index,
    new Array(page.stores.colors.componentCounts[index]).fill(0), "none-test"), /no backdrop-independent sRGB/);
  assert(Array.from(page.stores.colors.spaceKinds.keys()).some(index =>
    page.stores.colors.spaceKinds[index] === HEPR_COLOR_SPACE_KIND.DeviceN && colors.paints(index)),
  "mixed /None and active colorants still paint");
  const rendered = await renderHeprPageToCanvas2d(page, { surfaceFactory(width, height) {
    const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") };
  } });
  const pixel = (x, y) => [...rendered.surface.context.getImageData(x, 99 - y, 1, 1).data];
  const backdrop = [51, 102, 153, 255];
  for (const [x, y] of [[20, 20], [50, 20], [20, 45], [80, 45], [60, 60], [20, 75]]) {
    assert.deepEqual(pixel(x, y), backdrop, `no-paint source leaves backdrop at ${x},${y}`);
  }
  for (const [x, y] of [[40, 20], [80, 20], [20, 60]]) assert.deepEqual(pixel(x, y), [255, 0, 0, 255], "other paint roles survive");
  assert.deepEqual(pixel(50, 45), [0, 0, 0, 255], "mixed DeviceN still applies its tint transform");
  assert.deepEqual(pixel(45, 60), [0, 255, 0, 255], "ordinary images ignore the current fill color");
  assert.deepEqual(pixel(80, 60), [0, 255, 0, 255], "a /None fill still installs its clipping path");
  {
    const textPage = await compile("/S cs 0 scn BT /F 40 Tf 5 75 Td (A) Tj 1 0 0 rg (B) Tj ET");
    const textScene = await lower(textPage);
    assert.equal(textScene.textInstanceCount, 1, "only the visible glyph paints");
    assert.equal(textScene.textIndex.pages[0].text, "AB", "unpainted text remains searchable");
    assert(textScene.textIndex.pages[0].charInstance[0] < -1, "unpainted text keeps a fallback search quad");
    assert(textScene.textIndex.pages[0].charInstance[1] >= 0);
    assert(Math.abs(textScene.textInstanceB[0] - 29) < 1e-6, "unpainted glyph advances the following text");
  }
  for (const content of [
    "/S cs 0 scn 1 0 0 RG 1 w BT /F 40 Tf 2 Tr 10 10 Td (A) Tj ET",
    "/S CS 0 SCN 1 0 0 rg 1 w BT /F 40 Tf 2 Tr 10 10 Td (A) Tj ET"
  ]) {
    const mixedGlyph = await lower(await compile(content));
    assert.equal(mixedGlyph.textInstanceCount, 1, "a glyph's other paint role survives /None");
    assert.deepEqual([...mixedGlyph.textInstanceC], [1, 0, 0, 1]);
  }
  {
    const clippingPage = await compile("/S cs 0 scn BT /F 100 Tf 4 Tr 5 5 Td (A) Tj ET 0 1 0 rg 0 0 100 100 re f");
    const clippingScene = await lower(clippingPage);
    assert.equal(clippingScene.textInstanceCount, 0, "a /None text fill emits no paint");
    assert.equal(clippingScene.fillPathCount, 1);
    assert(clippingScene.drawRuns[0].clipIndex >= 0, "text clipping survives no-paint glyphs");
    assert.equal(clippingScene.textIndex.pages[0].text, "A");
  }
  {
    const shadingPattern = await compile("/PC CS /Sh SCN 5 w 10 85 m 90 85 l S");
    const directGradient = structuredClone(shadingPattern);
    for (let paint = 0; paint < directGradient.stores.paints.kinds.length; paint++) {
      if (directGradient.stores.paints.kinds[paint] !== HEPR_PAINT_KIND.Pattern) continue;
      const pattern = directGradient.stores.paints.resourceIndices[paint];
      directGradient.stores.paints.kinds[paint] = HEPR_PAINT_KIND.Gradient;
      directGradient.stores.paints.resourceIndices[paint] = directGradient.stores.patterns.gradientIndices[pattern];
      directGradient.stores.paints.patternTransformIndices[paint] = -1;
    }
    for (const page of [shadingPattern, directGradient]) {
      const scene = await lower(page);
      assert.equal(scene.drawRuns.length, 0, "own-/None shading strokes produce no paint or knockout shape");
      const rendered = await renderHeprPageToCanvas2d(page, { surfaceFactory(width, height) {
        const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") };
      } });
      assert(rendered.surface.context.getImageData(0, 0, 100, 100).data.every(value => value === 0),
        "Canvas skips gradient and shading-pattern strokes before tint conversion");
    }
  }
  console.log("Retained /None colorants passed: explicit no-paint, mixed roles, pattern bases, clips, images, text and Canvas pixels.");
} finally { hooks.deregister(); }
