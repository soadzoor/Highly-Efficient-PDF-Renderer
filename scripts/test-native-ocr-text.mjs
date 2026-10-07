import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { extractPdfPageScenes } = await import("../src/pdfVectorExtractor.ts");
  const { PdfPageDemandLoader } = await import("../src/pdfPageDemand.ts");
  const poisoned = fixture({ poisonImage: true });
  let codecCalls = 0;
  const session = await openPdf({ kind: "bytes", bytes: poisoned }, { imageCodecResolver() { codecCalls++; throw new Error("Scan decoded"); } });
  try {
    const scene = await session.compileVectorPage(0, { ocrTextOnly: true, previewMaxDimension: 96 });
    assert.equal(scene.textIndex.pages[0].text, "AB");
    assert.equal(scene.textInstanceCount, 2, "glyphless hidden text gains visible vector glyphs");
    assert.equal(scene.rasterLayers.length, 0);
    assert.equal(scene.rasterLayerData.length, 0);
    assert.equal(scene.retainedPages, undefined);
    assert.equal(codecCalls, 0, "image codec is never called");
    assert.equal(scene.textInstanceB[4] - scene.textInstanceB[0], 6, "original PDF advance is preserved");
    assert(session.getDiagnostics().some(d => d.code === "view.ocr-text-only"));
    await assert.rejects(session.compileVectorPage(0, { ocrTextOnly: true, limits: { maxGlyphsPerPage: 1 } }),
      error => error.code === "resource-limit");
    const abort = new AbortController(); abort.abort();
    await assert.rejects(session.compileVectorPage(0, { ocrTextOnly: true, signal: abort.signal }));
  } finally { await session.close(); }

  // Real worker/extraction plumbing must honor the option rather than touching the poisoned scan.
  const [workerScene] = await extractPdfPageScenes(poisoned.slice().buffer, { ocrTextOnly: true, extractTextContent: true });
  assert.equal(workerScene.textInstanceCount, 2);
  assert.equal(workerScene.rasterLayers.length, 0);
  assert.equal(workerScene.textContent.map(item => item.text).join(""), "AB");

  const normalSession = await openPdf({ kind: "bytes", bytes: fixture({}) });
  try {
    const normal = await normalSession.compileVectorPage(0);
    assert.equal(normal.textInstanceCount, 0, "normal view keeps OCR invisible");
    assert.equal(normal.rasterLayers.length, 1);
    const text = await normalSession.compileVectorPage(0, { ocrTextOnly: true });
    assert.equal(text.textInstanceCount, 2);
    const restored = await normalSession.compileVectorPage(0);
    assert.equal(restored.textInstanceCount, 0);
    assert.equal(restored.rasterLayers.length, 1, "normal compilation remains available after text mode");
  } finally { await normalSession.close(); }

  const formSession = await openPdf({ kind: "bytes", bytes: fixture({ form: true, poisonImage: true }) });
  try {
    const scene = await formSession.compileVectorPage(0, { ocrTextOnly: true });
    assert.equal(scene.textIndex.pages[0].text, "AB");
    assert.equal(scene.textInstanceCount, 2, "text inside a Form is reconstructed");
    assert.equal(scene.rasterLayers.length, 0);
  } finally { await formSession.close(); }

  const outlined = await openPdf({ kind: "bytes", bytes: fixture({ glyphless: false, poisonImage: true }) });
  try {
    const scene = await outlined.compileVectorPage(0, { ocrTextOnly: true });
    assert.equal(scene.textInstanceCount, 2);
    assert.equal(scene.textGlyphMetaB[0], 100, "usable source outlines keep their original shape instead of substituting a font");
    assert.equal(scene.textInstanceB[4] - scene.textInstanceB[0], 6);
  } finally { await outlined.close(); }

  for (const [content, expected] of [
    ["", ""],
    ["BI /W 1 /H 1 /BPC 8 /CS /G ID x EI\nBT /F1 10 Tf 3 Tr 20 30 Td <00010002> Tj ET", "AB"],
    ["/OC /Hidden BDC BT /F1 10 Tf 20 30 Td <0001> Tj ET EMC\nBT /F1 10 Tf 20 50 Td <0002> Tj ET", "B"],
    ["/OC << /Type /OCMD /P /AllOn /OCGs [] >> BDC BT /F1 10 Tf 20 30 Td <0001> Tj ET EMC", "A"]
  ]) {
    const extra = await openPdf({ kind: "bytes", bytes: fixture({ content, poisonImage: true }) });
    try {
      const scene = await extra.compileVectorPage(0, { ocrTextOnly: true });
      assert.equal(scene.textIndex.pages[0].text, expected);
      assert.equal(scene.rasterLayers.length, 0);
      if (!expected) assert(extra.getDiagnostics().some(d => d.code === "view.ocr-text-only" && /no drawable stored text/.test(d.message)));
    } finally { await extra.close(); }
  }

  const demandSession = await openPdf({ kind: "bytes", bytes: poisoned });
  const demand = new PdfPageDemandLoader(demandSession, () => {}, { ocrTextOnly: true });
  try {
    demand.update({ width: 100, height: 100, zoom: .25, cameraCenterX: 100, cameraCenterY: 50 }, Float32Array.of(0, 0, 200, 100));
    await demand.whenIdle();
    assert.equal(demand.previewCount, 1);
    assert.equal(demand.pageScenes[0].textInstanceCount, 2, "overview retains vector text instead of rasterizing it");
    demand.update({ width: 500, height: 500, zoom: 3, cameraCenterX: 100, cameraCenterY: 50 }, Float32Array.of(0, 0, 200, 100));
    await demand.whenIdle();
    assert.equal(demand.detailedCount, 0, "zooming reuses the full vector overview without a second page cache");
    assert.equal(demand.pageScenes[0].rasterLayers.length, 0);
  } finally { await demand.close(); }

  // The same scene works in Three root, independent-page and batch paths without scan resources.
  const { loadPdfSceneFromSource } = await import("../src/pdfObjectGenerator.ts");
  const { createThreePdfObject } = await import("../src/threePdfObject.ts");
  const { sceneCpuBytes } = await import("../src/pageRasterPreview.ts");
  const bytes = fixture({});
  const loaded = await loadPdfSceneFromSource(bytes, { ocrTextOnly: true, vectorLod: "off", textLod: "off" });
  assert.equal(loaded.sourceOptions.ocrTextOnly, true, "eager sources retain their viewing options");
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 1, height: 1, style: {}, getContext: () => null }) };
  let object;
  try {
    const nativeFactory = () => new Proxy({ getViewState: () => ({ zoom: 1, cameraCenterX: 0, cameraCenterY: 0 }),
      getPresentedViewState: () => ({ zoom: 1, cameraCenterX: 0, cameraCenterY: 0 }),
      setScene: () => ({}), getSceneStats: () => ({}) }, { get: (target, key) => target[key] ?? (() => {}) });
    object = await createThreePdfObject(loaded, { vectorLod: "off", textLod: "off" }, undefined, undefined, nativeFactory);
    assert.equal(object.sourceBytes, loaded.sourceBytes, "eager Three objects retain the source for switching back");
    const pages = await object.getPages();
    assert.equal(pages.length, 1);
    assert.equal(pages[0].sceneData.rasterLayers.length, 0);
    assert.equal(pages[0].sceneData.textInstanceCount, 2);
    const original = await object.loadCompleteScene();
    assert.equal(original.rasterLayers.length, 1, "complete analysis reopens original scan content");
    assert.equal(original.textInstanceCount, 0);
    assert(sceneCpuBytes(object.sceneData) > 0);
  } finally {
    object?.dispose();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
  console.log("native OCR text viewing tests passed");
} finally { hooks.deregister(); }

function fixture({ poisonImage = false, form = false, glyphless = true, content = "BT /F1 10 Tf 3 Tr 20 30 Td <00010002> Tj ET" }) {
  const text = content;
  const fontName = glyphless ? "GlyphLessFont" : "UsefulFont";
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [13 0 R] /D << /OFF [13 0 R] >> >> >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> /XObject << /Scan 6 0 R /Text 12 0 R >> /Properties << /Hidden 13 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", `q 200 0 0 100 0 0 cm /Scan Do Q\n${form ? "/Text Do" : text}`) },
    { number: 5, body: `<< /Type /Font /Subtype /Type0 /BaseFont /${fontName} /Encoding /Identity-H /DescendantFonts [7 0 R] /ToUnicode 8 0 R >>` },
    { number: 6, body: tinyPdfStream(`/Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray${poisonImage ? " /Filter /DefinitelyUnsupported" : ""}`, Uint8Array.of(0)) },
    { number: 7, body: `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${fontName} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 9 0 R /DW 600 /CIDToGIDMap 11 0 R >>` },
    { number: 8, body: tinyPdfStream("", "begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0001> <0041> <0002> <0042> endbfchar endcmap") },
    { number: 9, body: `<< /Type /FontDescriptor /FontName /${fontName} /Flags 4 /FontBBox [0 -200 1000 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 10 0 R >>` },
    { number: 10, body: tinyPdfStream("", buildTinySfnt()) },
    { number: 11, body: tinyPdfStream("", glyphless ? new Uint8Array(6) : Uint8Array.of(0, 0, 0, 1, 0, 2)) },
    { number: 12, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >>", text) },
    { number: 13, body: "<< /Type /OCG /Name (Hidden) >>" }
  ] });
}
