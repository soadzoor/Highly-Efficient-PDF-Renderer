import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { writeScenePdf } = await import("../src/editorPdfWriter.ts");
  const { saveEditorNativePdf } = await import("../src/editorNativePdf.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { getScenePrimitive } = await import("../src/scenePrimitives.ts");
  const bytes = fixture(), source = await openPdf({ kind: "bytes", bytes });
  let scene;
  try { scene = await source.compileVectorPage(0, { optimization: "none", preserveDrawingOrder: true }); }
  finally { await source.close(); }

  const direct = [], multiPage = composeVectorScenesInGrid([scene, scene], 2);
  await writeScenePdf(multiPage, { onProgress: event => direct.push(event) });
  validate(direct, "scene writer");
  for (const index of [0, 1]) assert(direct.some(event => event.pageIndex === index && event.pageCount === 2), `page ${index} progress`);
  assert(direct.some(event => event.unit === "pages" && event.processed === 2 && event.total === 2));

  const services = await createEditorAppServices({ sourcePdf: bytes, loadFontAsset: async url => new Uint8Array(await readFile(url)) });
  const editor = await openEditorSession(scene, services.sessionOptions);
  try {
    editor.setFieldValue("Text", "B");
    let content;
    for (let index = 0; index < scene.fillPathCount; index++) {
      if (!getScenePrimitive(scene, { kind: "fill", index }).annotationId) { content = { kind: "fill", index }; break; }
    }
    assert(content); editor.selectPrimitives([content]); editor.transformSelection([1, 0, 0, 1, 3, 2]);
    editor.addObject({ kind: "shape", pageIndex: 0, shape: "rectangle", x: 10, y: 10, width: 12, height: 8, color: "blue", fill: "blue" });
    const compiled = await editor.getScene({ preview: false }), native = [];
    await saveEditorNativePdf(compiled, editor, { onProgress: event => native.push(event) },
      { fonts: services.fonts, compileObject: services.sessionOptions.compileObject });
    validate(native, "native writer");
    assert(native.some(event => event.stage === "source" && event.unit === "bytes"));
    assert(native.some(event => event.value > .25 && event.value <= .5 && event.pageIndex === 0), "nested rebuilt page progress");
    assert(native.some(event => event.value >= .5 && event.value <= .75 && event.unit === "sections" && event.total === 1), "annotation progress");
    assert(native.some(event => event.value >= .75 && event.value < 1 && event.unit === "sections" && event.processed === 1), "new object progress");
    const integrated = [];
    await editor.savePdf({ onProgress: event => integrated.push(event) });
    validate(integrated, "session native writer");
    assert(integrated.some(event => event.value > 0 && event.value <= .4), "session compilation progress");

    const hepServices = await createEditorAppServices({ loadFontAsset: async url => new Uint8Array(await readFile(url)) });
    const hepEditor = await openEditorSession(scene, hepServices.sessionOptions);
    try {
      hepEditor.addObject({ kind: "shape", pageIndex: 0, shape: "ellipse", x: 20, y: 20, width: 8, height: 8 });
      const hep = [];
      await hepEditor.savePdf({ onProgress: event => hep.push(event) });
      validate(hep, "source-free nested native writer");
    } finally { hepEditor.dispose(); hepServices.dispose(); }
  } finally { editor.dispose(); services.dispose(); }
  console.log("PDF export progress: scene pages, native fields/annotations/rebuilt pages, session ranges and HEP rebuilding passed.");
} finally { hooks.deregister(); }

function validate(events, label) {
  assert(events.length > 3, `${label}: meaningful progress`);
  assert.equal(events[0].value, 0, `${label}: starts at zero`);
  assert.equal(events.at(-1).value, 1, `${label}: finishes at one`);
  assert.equal(events.at(-1).stage, "complete", `${label}: completion emitted`);
  assert(events.some(event => event.value > 0 && event.value < 1), `${label}: intermediate progress`);
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    assert(event.value >= 0 && event.value <= 1, `${label}: normalized`);
    if (index) assert(event.value >= events[index - 1].value, `${label}: monotonic`);
    if (event.stage === "complete") assert.equal(event.value, 1, `${label}: nested completion never ends operation early`);
  }
}

function fixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm 9 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << /Font << /F 5 0 R >> >> /Annots [10 0 R] >>" },
    { number: 4, body: tinyPdfStream("", "1 0 0 rg 5 5 10 10 re f") },
    { number: 5, body: "<< /Type /Font /Subtype /TrueType /BaseFont /Tiny /FirstChar 65 /LastChar 66 /Widths [600 700] /Encoding /WinAnsiEncoding /FontDescriptor 6 0 R >>" },
    { number: 6, body: "<< /Type /FontDescriptor /FontName /Tiny /Flags 32 /FontBBox [0 -200 1000 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 7 0 R >>" },
    { number: 7, body: tinyPdfStream("", buildTinySfnt()) },
    { number: 8, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 40 20] /Resources << /Font << /F 5 0 R >> >>", "BT /F 10 Tf 2 5 Td (A) Tj ET") },
    { number: 9, body: "<< /Fields [10 0 R] /DR << /Font << /F 5 0 R >> >> /DA (/F 10 Tf 0 g) >>" },
    { number: 10, body: "<< /Type /Annot /Subtype /Widget /FT /Tx /T (Text) /V (A) /Rect [20 40 60 60] /AP << /N 8 0 R >> >>" }
  ] });
}
