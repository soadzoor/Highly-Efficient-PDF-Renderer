import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });

try {
  const { writeScenePdf } = await import("../src/editorPdfWriter.ts");
  const { PdfByteWriter, pdfNumber, pdfName, pdfUtf16Hex } = await import("../src/editorPdfBytes.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");

  assert.equal(pdfNumber(1e-12), "0.000000000001");
  assert.equal(pdfNumber(-1.25e22), "-12500000000000000000000");
  assert.equal(pdfNumber(-0), "0");
  assert.throws(() => pdfNumber(Infinity), /finite/);
  assert.equal(pdfName("A /#é"), "/A#20#2f#23#c3#a9");
  assert.equal(pdfUtf16Hex("A𝄞"), "<feff0041d834dd1e>");
  const unassigned = new PdfByteWriter(), missing = unassigned.reserve();
  assert.throws(() => unassigned.build(missing), /without a body/);

  const surfaceFactory = (width, height) => {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  };
  async function prepare(bytes) {
    const session = await openPdf({ kind: "bytes", bytes });
    try {
      return { scene: await session.compileVectorPage(0, { optimization: "none", vectorFallback: "error", preserveDrawingOrder: true }),
        page: await session.compilePage(0, { optimization: "none" }) };
    } finally { await session.close(); }
  }
  async function read(bytes) {
    const session = await openPdf({ kind: "bytes", bytes });
    try {
      const pages = [];
      for (let index = 0; index < session.info.pageCount; index++) pages.push(await session.compilePage(index, { optimization: "none" }));
      return pages;
    } finally { await session.close(); }
  }
  async function pixels(page) {
    // The Canvas2D reference operates in sRGB and rejects explicit group
    // blending spaces, even DeviceRGB. These fixtures use only DeviceRGB.
    const rgbPage = { ...page, displayProgram: { ...page.displayProgram,
      groups: page.displayProgram.groups.map(group => ({ ...group, blendingColorSpaceIndex: -1 })) } };
    const result = await renderHeprPageToCanvas2d(rgbPage, { surfaceFactory, scale: 2, background: [1, 1, 1, 1] });
    return { width: result.width, height: result.height,
      data: result.surface.context.getImageData(0, 0, result.width, result.height).data };
  }
  const pixel = (rendered, x, y) => {
    const offset = ((rendered.height - 1 - Math.floor(y * 2)) * rendered.width + Math.floor(x * 2)) * 4;
    return Array.from(rendered.data.subarray(offset, offset + 4));
  };
  function near(actual, expected, tolerance, label) {
    assert(actual.every((value, channel) => Math.abs(value - expected[channel]) <= tolerance),
      `${label}: expected ${expected}, got ${actual}`);
  }
  async function roundTrip(source, samples, label) {
    const original = await prepare(source), blob = await writeScenePdf(original.scene);
    assert.equal(blob.type, "application/pdf");
    const [page] = await read(new Uint8Array(await blob.arrayBuffer()));
    const before = await pixels(original.page), after = await pixels(page);
    assert.deepEqual([after.width, after.height], [before.width, before.height], label);
    for (const [x, y] of samples) near(pixel(after, x, y), pixel(before, x, y), 5, `${label} at ${x},${y}`);
    return { ...original, page, blob, before, after };
  }

  const ordered = await roundTrip(fixture(
    "1 0 0 rg 0 0 100 100 re f q /Half gs 0 0 1 rg 20 20 60 60 re f Q " +
    "q 10 10 70 70 re 25 25 30 30 re W* n 0 1 0 rg 0 0 100 100 re f Q " +
    "q 20 0 0 20 70 5 cm /Im Do Q q 5 5 90 90 re W n 4 w 1 J 1 1 0 RG 0 8 m 100 8 l S Q",
    "/ExtGState << /Half << /ca .5 >> >> /XObject << /Im 5 0 R >>",
    [{ number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 6 0 R", Uint8Array.of(0, 0, 255)) },
      { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8", Uint8Array.of(128)) }]),
    [[2, 2], [15, 15], [40, 40], [75, 12], [50, 8], [4, 8]], "ordered vectors, alpha, image mask, clips and stroke");
  near(pixel(ordered.after, 40, 40), [128, 0, 128, 255], 3, "hole exposes the earlier translucent fill");
  await roundTrip(fixture("q 80 0 0 80 10 10 cm /Im Do Q", "/XObject << /Im 5 0 R >>", [
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 6 0 R /Interpolate false",
      Uint8Array.of(255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0)) },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Interpolate false", Uint8Array.of(255, 128, 255, 0)) }
  ]), [[25, 75], [75, 75], [25, 25], [75, 25]], "asymmetric image row order and alpha mask");

  const group = await roundTrip(fixture("0 0 1 rg 0 0 100 100 re f /G Do 0 1 0 rg 75 75 10 10 re f",
    "/XObject << /G 5 0 R >>", [{ number: 5, body: tinyPdfStream(
      "/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Group << /S /Transparency /I true /K false >> /Resources << /ExtGState << /Half << /ca .5 >> >> >>",
      "q /Half gs 1 0 0 rg 10 10 50 50 re f 1 1 0 rg 35 35 50 50 re f Q") }]),
    [[20, 20], [40, 40], [70, 70], [80, 80]], "transparency groups and paint order");
  assert(group.scene.paintGraph, "fixture retains compositing boundaries");
  const knockout = structuredClone(group.scene);
  const knockoutGroup = knockout.paintGraph.roots.find(node => node.kind === "group");
  assert(knockoutGroup); knockoutGroup.knockout = true;
  const [knockoutPage] = await read(new Uint8Array(await (await writeScenePdf(knockout)).arrayBuffer()));
  assert(knockoutPage.displayProgram.groups.some(group => group.knockout), "PDF preserves knockout groups natively");
  const mask = await roundTrip(fixture("0 0 1 rg 0 0 100 100 re f q /M gs 1 0 0 rg 0 0 100 100 re f Q",
    "/ExtGState << /M << /SMask << /S /Luminosity /G 5 0 R >> >> >>", [
      { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Group << /S /Transparency /CS /DeviceGray /I true >> /Resources << >>",
        ".5 g 10 10 60 60 re f") },
      { number: 6, body: "<< /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 2 >>" }
    ]), [[20, 20], [80, 80]], "luminosity soft mask");
  assert(mask.scene.paintGraph, "soft mask retains a paint graph");
  const transferScene = structuredClone(mask.scene), groups = [...transferScene.paintGraph.roots];
  let transferGroup;
  while (groups.length) { const node = groups.pop(); if (node.kind === "group") {
    if (node.softMask) { transferGroup = node; break; } groups.push(...node.children);
  } }
  assert(transferGroup); transferGroup.softMask.transfer = Float32Array.of(0, .25, 1);
  const [transferPage] = await read(new Uint8Array(await (await writeScenePdf(transferScene)).arrayBuffer()));
  assert(transferPage.displayProgram.groups.some(group => group.softMaskTransferFunctionIndex >= 0), "mask transfer is retained as a PDF function");

  const text = await roundTrip(type3Fixture(), [[15, 15], [22, 30], [35, 15], [42, 30]], "Type3 outline fonts and Unicode");
  assert.equal(text.page.textIndex.text.replaceAll(" ", ""), "fi𝄞", JSON.stringify(text.scene.textIndex.pages[0]));
  assert.equal(text.scene.fillPathCount, 2, "source Type3 paint programs remain vector outlines");
  assert.equal(text.scene.rasterLayers.length, 0, "outline text remains vector");
  const outlineText = { ...createEmptyVectorScene(), pageCount: 1, pagesPerRow: 1,
    pageRects: Float32Array.of(0, 0, 100, 100), pageTextRanges: Uint32Array.of(0, 2),
    textInstanceCount: 2, textGlyphCount: 1, textGlyphSegmentCount: 3,
    textInstanceA: Float32Array.of(20, 0, 0, 20, 20, 0, 0, 20),
    textInstanceB: Float32Array.of(10, 10, 0, 0, 35, 10, 0, 0),
    textInstanceC: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1),
    textGlyphMetaA: Float32Array.of(0, 3, 0, 0), textGlyphMetaB: Float32Array.of(1, 1, 0, 0),
    textGlyphSegmentsA: Float32Array.of(0, 0, .5, 1, .5, 1, 1, 0, 1, 0, 0, 0),
    textGlyphSegmentsB: Float32Array.of(.5, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0),
    textIndex: { version: 2, pages: [{ text: "fi𝄞", charInstance: Int32Array.of(0, 0, 1, 1), fallbackQuads: new Float32Array(0) }] } };
  const [outlinePage] = await read(new Uint8Array(await (await writeScenePdf(outlineText)).arrayBuffer()));
  assert.equal(outlinePage.textIndex.text.replaceAll(" ", ""), "fi𝄞", "outline CharProcs retain ligatures and supplementary Unicode");
  const outlinePixels = await pixels(outlinePage);
  near(pixel(outlinePixels, 20, 15), [0, 0, 0, 255], 1, "generated outline CharProc paints");
  const unindexed = { ...outlineText, textIndex: null };
  const [unindexedPage] = await read(new Uint8Array(await (await writeScenePdf(unindexed)).arrayBuffer()));
  assert.equal(unindexedPage.textIndex.text, "", "unindexed glyphs never invent Unicode replacement characters");
  near(pixel(await pixels(unindexedPage), 20, 15), [0, 0, 0, 255], 1, "unindexed glyphs remain visible vectors");

  const shading = await roundTrip(gradientFixture(), [[5, 20], [25, 20], [45, 20], [75, 20], [70, 70], [90, 90]],
    "analytic and mesh gradients");
  const composed = composeVectorScenesInGrid([shading.scene, shading.scene], 2);
  const composedPages = await read(new Uint8Array(await (await writeScenePdf(composed)).arrayBuffer()));
  assert.equal(composedPages.length, 2);
  for (const page of composedPages) {
    const rendered = await pixels(page);
    for (const [x, y] of [[5, 20], [25, 20], [45, 20], [75, 20]]) near(pixel(rendered, x, y), pixel(shading.before, x, y), 5, "composed page gradient origin");
  }

  const hep = await buildHep(text.scene, { withVectorLod: false, withTextLod: false });
  const loaded = await loadSceneFromHep(await hep.arrayBuffer());
  const [hepPdf] = await read(new Uint8Array(await (await writeScenePdf(loaded)).arrayBuffer()));
  assert.equal(hepPdf.textIndex.text.replaceAll(" ", ""), "fi𝄞", "HEP-only export needs no original font or PDF");
  const ordinary = await prepare(ordinaryTextFixture());
  assert.equal(ordinary.scene.textIndex.pages[0].text, "ABBA AB AB BA");
  const ordinaryHep = await buildHep(ordinary.scene, { withVectorLod: false, withTextLod: false });
  const ordinaryScene = await loadSceneFromHep(await ordinaryHep.arrayBuffer());
  const ordinaryBytes = new Uint8Array(await (await writeScenePdf(ordinaryScene)).arrayBuffer()), [ordinaryPage] = await read(ordinaryBytes);
  assert.equal(ordinaryPage.textIndex.text, ordinary.scene.textIndex.pages[0].text, "ordinary font words and spaces survive HEP-only Type3 rebuilding");
  const ordinaryReopened = await prepare(ordinaryBytes);
  assert.equal(ordinaryReopened.scene.textIndex.pages[0].text, ordinary.scene.textIndex.pages[0].text, "vector text index retains source word boundaries");

  const packedLayer = { width: 8, height: 1, matrix: Float32Array.of(80, 0, 0, -10, 10, 20), paintOrder: 0, pageIndex: 0,
    interpolate: false, monochrome: { data: Uint8Array.of(0xaa), colors: Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 128) } };
  Object.defineProperty(packedLayer, "data", { enumerable: true, get() { throw new Error("Packed images must not materialize RGBA for PDF export."); } });
  const packedScene = { ...createEmptyVectorScene(), pageCount: 1, pagesPerRow: 1,
    pageRects: Float32Array.of(0, 0, 100, 100), pageTextRanges: Uint32Array.of(0, 0), rasterLayers: [packedLayer] };
  const [packedPage] = await read(new Uint8Array(await (await writeScenePdf(packedScene)).arrayBuffer()));
  const packedPixels = await pixels(packedPage);
  near(pixel(packedPixels, 15, 15), [127, 127, 255, 255], 3, "packed palette alpha");
  near(pixel(packedPixels, 25, 15), [255, 0, 0, 255], 1, "packed palette color");
  const repeatLayer = Object.defineProperties({}, Object.getOwnPropertyDescriptors(packedLayer));
  repeatLayer.repeat = { transform: Float64Array.of(1, 0, 0, 1, 0, 0), bounds: Float64Array.of(0, 0, 10, 10),
    xStep: 20, yStep: 20, xFirst: 1, xLast: 3, yFirst: 1, yLast: 2 };
  const [repeatPage] = await read(new Uint8Array(await (await writeScenePdf({ ...packedScene, rasterLayers: [repeatLayer] })).arrayBuffer()));
  const repeatPixels = await pixels(repeatPage);
  near(pixel(repeatPixels, 20.5, 25), [127, 127, 255, 255], 3, "repeated image cell");
  near(pixel(repeatPixels, 32, 25), [255, 255, 255, 255], 1, "repeated image gap");
  near(pixel(repeatPixels, 40.5, 45), [127, 127, 255, 255], 3, "repeated image preserves grid placement");
  const repeatedRows = { width: 2, height: 2, data: Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 255, 255, 0, 0),
    interpolate: false, matrix: Float32Array.of(20, 0, 0, -20, 0, 20), paintOrder: 0, pageIndex: 0,
    repeat: { transform: Float64Array.of(1, 0, 0, 1, 0, 0), bounds: Float64Array.of(0, 0, 20, 20), xStep: 30, yStep: 30, xFirst: 0, xLast: 1, yFirst: 0, yLast: 1 } };
  const [repeatedRowsPage] = await read(new Uint8Array(await (await writeScenePdf({ ...packedScene, rasterLayers: [repeatedRows] })).arrayBuffer()));
  const repeatedRowPixels = await pixels(repeatedRowsPage);
  for (const offset of [0, 30]) {
    near(pixel(repeatedRowPixels, offset + 5, 15), [255, 0, 0, 255], 1, "repeated image top row");
    near(pixel(repeatedRowPixels, offset + 5, 5), [0, 0, 255, 255], 1, "repeated image bottom row");
    near(pixel(repeatedRowPixels, offset + 15, 15), [127, 255, 127, 255], 2, "repeated image alpha row");
  }
  const dotScene = { ...createEmptyVectorScene(), pageCount: 1, pagesPerRow: 1,
    pageRects: Float32Array.of(0, 0, 100, 100), pageTextRanges: Uint32Array.of(0, 0),
    segmentCount: 1, endpoints: Float32Array.of(50, 50, 50, 50), primitiveMeta: Float32Array.of(50, 50, 0, 1),
    primitiveBounds: Float32Array.of(46, 46, 54, 54), styles: Float32Array.of(4, 0, 0, 0) };
  const [dotPage] = await read(new Uint8Array(await (await writeScenePdf(dotScene)).arrayBuffer()));
  near(pixel(await pixels(dotPage), 50, 50), [0, 0, 0, 255], 1, "degenerate round strokes retain their dot");

  // A retained fallback resource may hold other page commands. Only its
  // canonical current raster slot belongs at this paint position.
  const fallback = structuredClone(ordered.scene), raster = fallback.rasterLayers.length - 1;
  const runIndex = fallback.drawRuns.findIndex(run => run.kind === "raster" && run.first === raster);
  if (runIndex >= 0 && fallback.drawRuns[runIndex].count === 1) {
    fallback.retainedPages = [{ page: ordered.page, matrix: Float32Array.of(1, 0, 0, 1, 0, 0), optionalContentConditions: new Int32Array(0) }];
    fallback.paintGraph = { roots: fallback.drawRuns.map((_, index) => index === runIndex
      ? { kind: "retained", retainedPage: 0, firstCommand: 0, count: 1, rasterIndex: raster } : { kind: "draw", runIndex: index }) };
    const [page] = await read(new Uint8Array(await (await writeScenePdf(fallback)).arrayBuffer()));
    const rendered = await pixels(page);
    near(pixel(rendered, 40, 40), pixel(ordered.after, 40, 40), 3, "retained leaf never duplicates the original page");
  }

  await assert.rejects(writeScenePdf(text.scene, { signal: AbortSignal.abort() }), { name: "AbortError" });
  console.log("Scene PDF writer: binary output, ordered vectors, Type3 Unicode, images, clips, gradients, groups, HEP-only reopen and cancellation passed.");
} finally { hooks.deregister(); }

function fixture(content, resources = "", extras = []) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << ${resources} >> /Contents 4 0 R >>` },
    { number: 4, body: tinyPdfStream("", content) }, ...extras
  ] });
}
function type3Fixture() {
  return fixture("0 0 0 rg BT /F 20 Tf 1 0 0 1 10 10 Tm <01> Tj 1 0 0 1 35 10 Tm <02> Tj ET",
    "/Font << /F 5 0 R >>", [
      { number: 5, body: "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1 1] /FontMatrix [1 0 0 1 0 0] /CharProcs << /A 6 0 R /B 6 0 R >> /Encoding << /Type /Encoding /Differences [1 /A /B] >> /FirstChar 1 /LastChar 2 /Widths [1 1] /Resources << >> /ToUnicode 7 0 R >>" },
      { number: 6, body: tinyPdfStream("", "1 0 0 0 1 1 d1 0 0 m .5 1 l 1 0 l h f") },
      { number: 7, body: tinyPdfStream("", "begincmap 1 begincodespacerange <00> <ff> endcodespacerange 2 beginbfchar <01> <00660069> <02> <d834dd1e> endbfchar endcmap") }
    ]);
}
function ordinaryTextFixture() {
  return fixture("BT /F 10 Tf 10 60 Td (ABBA AB) Tj 0 -15 Td (AB BA) Tj ET", "/Font << /F 5 0 R >>", [
    { number: 5, body: `<< /Type /Font /Subtype /TrueType /BaseFont /Tiny /FirstChar 32 /LastChar 66 /Widths [${Array.from({ length: 35 }, (_, index) => index === 0 ? 250 : index === 33 ? 600 : index === 34 ? 700 : 500).join(" ")}] /Encoding /WinAnsiEncoding /FontDescriptor 6 0 R >>` },
    { number: 6, body: "<< /Type /FontDescriptor /FontName /Tiny /Flags 32 /FontBBox [0 -200 1000 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 7 0 R >>" },
    { number: 7, body: tinyPdfStream("", buildTinySfnt()) }
  ]);
}
function gradientFixture() {
  const vertex = (x, y, red, green, blue) => [0, x, y, red, green, blue];
  return fixture("q 0 0 50 50 re W n /A sh Q q 50 0 50 50 re W n /R sh Q q 0 50 100 50 re W n /M sh Q",
    "/Shading << /A 5 0 R /R 7 0 R /M 8 0 R >>", [
      { number: 5, body: "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 50 0] /Function 6 0 R /Extend [true true] >>" },
      { number: 6, body: "<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>" },
      { number: 7, body: "<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [75 25 0 75 25 25] /Function 6 0 R /Extend [true true] >>" },
      { number: 8, body: tinyPdfStream("/ShadingType 4 /ColorSpace /DeviceRGB /BitsPerCoordinate 8 /BitsPerComponent 8 /BitsPerFlag 8 /Decode [0 100 50 100 0 1 0 1 0 1]",
        Uint8Array.from([...vertex(0, 0, 255, 0, 0), ...vertex(255, 0, 0, 255, 0), ...vertex(255, 255, 0, 0, 255)])) }
    ]);
}
