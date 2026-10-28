import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas, DOMMatrix, Path2D, ImageData } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

// Optional offline evidence; synthetic fixtures are generated here.
// npm install --prefix /tmp/hepr-editor-reference --no-audit --no-fund --ignore-scripts pdfjs-dist@6.4.299
// node scripts/check-editor-pages-visuals.mjs [/tmp/hepr-editor-pages-validation]
const output = resolve(process.argv[2] ?? "/tmp/hepr-editor-pages-validation");
const reference = process.env.HEPR_PDFJS_MODULE ?? "/tmp/hepr-editor-reference/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
Object.assign(globalThis, { DOMMatrix, Path2D, ImageData });
class CanvasFactory {
  create(width, height) { const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") }; }
  reset(target, width, height) { target.canvas.width = width; target.canvas.height = height; }
  destroy(target) { target.canvas.width = target.canvas.height = 0; target.canvas = target.context = null; }
}
await mkdir(output, { recursive: true });
try {
  const pdfjs = await import(pathToFileURL(reference).href);
  const { openPdf } = await import("../src/pdfSession.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { NativeSfntFont } = await import("../src/pdf/nativeFont.ts");
  const { manipulatePdfPages } = await import("../src/editorPdfPages.ts");
  const assets = await createEditorAppServices({ loadFontAsset: async url => new Uint8Array(await readFile(url)) });
  let face;
  try { face = await assets.fonts.loadBundled("Liberation Sans"); }
  finally { assets.dispose(); }
  const font = NativeSfntFont.parse(face.bytes), widths = Array.from({ length: 95 }, (_, index) =>
    font.getHorizontalMetric(font.mapCodePoint(index + 32)).advanceWidth * 1000 / font.unitsPerEm);
  const primary = fixture(face.bytes, widths, false), foreign = fixture(face.bytes, widths, true);
  const parser = await openPdf({ kind: "bytes", bytes: primary });
  let scene;
  try {
    const pages = [];
    for (let index = 0; index < parser.info.pageCount; index++) pages.push(await parser.compileVectorPage(index, { optimization: "none", preserveDrawingOrder: true }));
    scene = composeVectorScenesInGrid(pages, 1);
  } finally { await parser.close(); }
  const services = await createEditorAppServices({ sourcePdf: primary, loadFontAsset: async url => new Uint8Array(await readFile(url)) });
  const editor = await openEditorSession(scene, services.sessionOptions), diagnostics = [];
  let authored;
  try {
    editor.setFieldValue("Name", "Alice Example");
    editor.addObject({ kind: "text", pageIndex: 0, x: 18, y: 12, width: 140, height: 24,
      text: "Editor note", fontSize: 12, fontFamily: "Liberation Sans", color: "#7e248b", underline: true });
    editor.addObject({ kind: "shape", pageIndex: 1, shape: "rectangle", x: 36, y: 25, width: 64, height: 38,
      fill: "#f4a334", color: "#8b4c0f", strokeWidth: 2, opacity: .7 });
    authored = new Uint8Array(await (await editor.savePdf()).arrayBuffer());
  } finally { editor.dispose(); services.dispose(); }
  const stages = [["primary", primary], ["foreign", foreign], ["authored", authored]];
  let bytes = authored;
  for (const [name, operation] of [
    ["rotate-90", { kind: "rotate", pages: [0], degrees: 90 }],
    ["rotate-180", { kind: "rotate", pages: [1], degrees: 180 }],
    ["remove", { kind: "remove", pages: [2] }],
    ["merged", { kind: "insert", at: 1, bytes: foreign, pages: [1, 0] }]
  ]) {
    bytes = new Uint8Array(await (await manipulatePdfPages(bytes, operation, { onDiagnostic: value => diagnostics.push(value) })).arrayBuffer());
    stages.push([name, bytes]);
  }
  const documents = new Map(), stageInfo = [];
  for (const [name, data] of stages) {
    await writeFile(resolve(output, `${name}.pdf`), data);
    const task = pdfjs.getDocument({ data: data.slice(), disableFontFace: true, useSystemFonts: false, isEvalSupported: false, CanvasFactory });
    const document = await task.promise; documents.set(name, { document, task });
    const pages = [];
    for (let index = 0; index < document.numPages; index++) {
      const page = await document.getPage(index + 1), viewport = page.getViewport({ scale: 1 });
      const text = (await page.getTextContent()).items.filter(item => "str" in item).map(item => item.str).join(" ");
      const annotations = (await page.getAnnotations()).map(value => ({ subtype: value.subtype, fieldName: value.fieldName,
        fieldValue: value.fieldValue, contents: value.contentsObj?.str, rect: value.rect }));
      pages.push({ width: viewport.width, height: viewport.height, rotation: page.rotate, cropBox: page.view, text, annotations });
    }
    stageInfo.push({ name, bytes: data.length, pages });
  }
  try {
    const expected = [
      { source: "authored", page: 0, rotation: 90, width: 200, height: 280, crop: [20, 10, 300, 210], text: "PRIMARY A" },
      { source: "foreign", page: 1, rotation: 0, width: 180, height: 260, crop: [0, 0, 180, 260], text: "INSERT D" },
      { source: "foreign", page: 0, rotation: 180, width: 270, height: 180, crop: [15, 10, 285, 190], text: "INSERT C" },
      { source: "authored", page: 1, rotation: 270, width: 280, height: 220, crop: [10, 20, 230, 300], text: "PRIMARY B" }
    ];
    const finalInfo = stageInfo.at(-1); assert.equal(finalInfo.pages.length, expected.length);
    for (let index = 0; index < expected.length; index++) {
      const actual = finalInfo.pages[index], item = expected[index];
      assert.deepEqual([actual.width, actual.height, actual.rotation, actual.cropBox], [item.width, item.height, item.rotation, item.crop]);
      assert(actual.text.includes(item.text), `final page ${index + 1}: order and searchable text`);
      assert(!actual.text.includes("REMOVE ME"));
    }
    assert(finalInfo.pages[0].annotations.some(value => value.fieldName === "Name" && value.fieldValue === "Alice Example"), "filled field survives page operations");
    assert(finalInfo.pages[0].annotations.some(value => value.subtype === "FreeText" && value.contents === "Editor note"), "editor text remains an editable annotation");
    assert(finalInfo.pages[3].annotations.some(value => value.subtype === "Square"), "editor shape remains an editable annotation");
    const captures = [], overviewRows = [], exactPreservation = [];
    for (const name of ["primary", "foreign", "authored", "merged"]) {
      const data = stages.find(value => value[0] === name)[1], info = stageInfo.find(value => value.name === name);
      for (let index = 0; index < info.pages.length; index++) {
        const pdfjsCanvas = await renderReference(documents.get(name).document, index), heprCanvas = await renderHepr(data, index);
        assert.equal(heprCanvas.width, pdfjsCanvas.width); assert.equal(heprCanvas.height, pdfjsCanvas.height);
        const namePage = `${name}-page-${index + 1}`, difference = comparePixels(pdfjsCanvas, heprCanvas);
        captures.push({ name, page: index + 1, ...difference });
        await writeFile(resolve(output, `${namePage}-pdfjs.png`), pdfjsCanvas.toBuffer("image/png"));
        await writeFile(resolve(output, `${namePage}-hepr.png`), heprCanvas.toBuffer("image/png"));
        const comparison = sideBySide(pdfjsCanvas, heprCanvas, `${name}, page ${index + 1}: pdf.js ${pdfjs.version}`, "HEPR Canvas2D");
        await writeFile(resolve(output, `${namePage}-side-by-side.png`), comparison.toBuffer("image/png"));
        if (name === "merged") {
          overviewRows.push(comparison);
          const item = expected[index], expectedCanvas = await renderReference(documents.get(item.source).document, item.page, item.rotation);
          const preservation = comparePixels(expectedCanvas, pdfjsCanvas);
          exactPreservation.push({ page: index + 1, original: `${item.source} page ${item.page + 1}`, expectedRotation: item.rotation, ...preservation });
          assert.equal(preservation.changedPixels, 0, `final page ${index + 1}: pdf.js pixels match its original page at the intended rotation`);
          assert(difference.meanMaxChannelDifference < 3 && difference.fractionDifferentByMoreThan20 < .04, `final page ${index + 1}: offline renderer agreement`);
        }
      }
    }
    const overview = createCanvas(Math.max(...overviewRows.map(row => row.width)), overviewRows.reduce((height, row) => height + row.height, 0));
    const context = overview.getContext("2d"); context.fillStyle = "#eef2f6"; context.fillRect(0, 0, overview.width, overview.height); let y = 0;
    for (const row of overviewRows) { context.drawImage(row, 0, y); y += row.height; }
    await writeFile(resolve(output, "overview.png"), overview.toBuffer("image/png"));
    const report = { description: "Synthetic offline page-operation validation using independent pdf.js and HEPR Canvas2D. No browser, native/Three GPU, or performance proof.",
      invocation: "node scripts/check-editor-pages-visuals.mjs", pdfjsVersion: pdfjs.version, scale: 2,
      referenceNote: "pdf.js can emit Node XFA rich-text parser warnings; standard annotation appearances are rendered and compared.",
      operations: ["Author text, shape and field value", "Rotate page A clockwise 90 degrees", "Rotate page B 180 degrees from its initial 90 degrees", "Remove third page", "Insert foreign pages in reversed order at position 2"],
      checks: { orderDimensionsCropRotation: true, removedPageAbsent: true, searchableSourceText: true, filledFieldPreserved: true,
        editorTextAndShapeRemainEditable: true, independentReaderPixelsUnchangedAtExpectedRotation: true }, stageInfo, captures, exactPreservation, diagnostics };
    await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, checks: report.checks, exactPreservation, captures: captures.filter(value => value.name === "merged") }, null, 2));
  } finally { for (const value of documents.values()) await value.task.destroy(); }

  async function renderReference(document, index, rotation) {
    const page = await document.getPage(index + 1), viewport = page.getViewport({ scale: 2, ...(rotation === undefined ? {} : { rotation }) });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise; return canvas;
  }
  async function renderHepr(data, index) {
    const parser = await openPdf({ kind: "bytes", bytes: data });
    try {
      const page = await parser.compilePage(index, { optimization: "none" });
      const result = await renderHeprPageToCanvas2d(page, { scale: 2, background: [1, 1, 1, 1], surfaceFactory(width, height) {
        const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") };
      } });
      return result.surface.canvas;
    } finally { await parser.close(); }
  }
} finally { hooks.deregister(); }

function comparePixels(left, right) {
  assert.equal(left.width, right.width); assert.equal(left.height, right.height);
  const a = left.getContext("2d").getImageData(0, 0, left.width, left.height).data, b = right.getContext("2d").getImageData(0, 0, right.width, right.height).data;
  let error = 0, changed = 0, large = 0;
  for (let index = 0; index < a.length; index += 4) {
    const delta = Math.max(Math.abs(a[index] - b[index]), Math.abs(a[index + 1] - b[index + 1]), Math.abs(a[index + 2] - b[index + 2]));
    error += delta; if (delta) changed++; if (delta > 20) large++;
  }
  return { width: left.width, height: left.height, meanMaxChannelDifference: error / (a.length / 4), changedPixels: changed, fractionDifferentByMoreThan20: large / (a.length / 4) };
}
function sideBySide(left, right, leftLabel, rightLabel) {
  const canvas = createCanvas(left.width + right.width, left.height + 30), context = canvas.getContext("2d");
  context.fillStyle = "#eef2f6"; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = "#19293d"; context.font = "13px sans-serif";
  context.fillText(leftLabel, 8, 20); context.fillText(rightLabel, left.width + 8, 20); context.drawImage(left, 0, 30); context.drawImage(right, left.width, 30); return canvas;
}
function fixture(font, widths, foreign) {
  const specs = foreign ? [
    { media: [0, 0, 300, 200], crop: [15, 10, 285, 190], rotate: 180, content: "BT /F 15 Tf 30 164 Td (INSERT C: image study) Tj ET q 150 0 0 108 65 34 cm /Im Do Q .2 .4 .7 RG 2 w 65 34 150 108 re S" },
    { media: [0, 0, 180, 260], crop: [0, 0, 180, 260], rotate: 0, content: "BT /F 14 Tf 12 232 Td (INSERT D: appendix) Tj ET .18 .62 .32 rg 20 42 125 115 re f 1 1 1 rg 29 55 20 78 re f" }
  ] : [
    { media: [0, 0, 320, 220], crop: [20, 10, 300, 210], rotate: 0, content: "BT /F 16 Tf 36 185 Td (PRIMARY A: technical) Tj ET .15 .38 .72 rg 40 58 75 53 re f .15 .25 .35 RG 1 w 39 57 77 55 re S 40 57 m 115 112 l S 40 112 m 115 57 l S BT /F 10 Tf 158 94 Td (Name:) Tj ET" },
    { media: [0, 0, 240, 320], crop: [10, 20, 230, 300], rotate: 90, content: "BT /F 16 Tf 24 270 Td (PRIMARY B: book) Tj ET BT /F 10 Tf 24 246 Td (The workshop keeps its careful notes.) Tj 0 -18 Td (Searchable words follow each page.) Tj 0 -18 Td (Rotation preserves the original ink.) Tj ET .45 .28 .1 RG 2 w 25 173 m 207 173 l S" },
    { media: [0, 0, 300, 220], crop: [0, 0, 300, 220], rotate: 0, content: "BT /F 25 Tf 48 162 Td (REMOVE ME) Tj ET .8 .15 .12 rg 40 40 215 80 re f" }
  ];
  const objects = [{ number: 1, body: `<< /Type /Catalog /Pages 2 0 R ${foreign ? "" : "/AcroForm 13 0 R"} >>` },
    { number: 2, body: `<< /Type /Pages /Kids [${specs.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${specs.length} >>` }];
  specs.forEach((spec, index) => {
    const corners = `${spec.crop[0] + 5} ${spec.crop[1] + 5} 9 9 re f`;
    objects.push({ number: 3 + index * 2, body: `<< /Type /Page /Parent 2 0 R /MediaBox [${spec.media.join(" ")}] /CropBox [${spec.crop.join(" ")}] /Rotate ${spec.rotate} /Resources << /Font << /F 9 0 R >> ${foreign ? "/XObject << /Im 16 0 R >>" : ""} >> /Contents ${4 + index * 2} 0 R ${!foreign && index === 0 ? "/Annots [15 0 R]" : ""} >>` },
      { number: 4 + index * 2, body: tinyPdfStream("", `${spec.content} .85 .18 .12 rg ${corners} .12 .65 .35 rg ${spec.crop[2] - 14} ${spec.crop[3] - 14} 9 9 re f`) });
  });
  objects.push({ number: 9, body: `<< /Type /Font /Subtype /TrueType /BaseFont /LiberationSans /FirstChar 32 /LastChar 126 /Widths [${widths.join(" ")}] /Encoding /WinAnsiEncoding /FontDescriptor 10 0 R >>` },
    { number: 10, body: "<< /Type /FontDescriptor /FontName /LiberationSans /Flags 32 /FontBBox [-500 -500 2000 2000] /ItalicAngle 0 /Ascent 900 /Descent -250 /CapHeight 700 /StemV 80 /FontFile2 11 0 R >>" },
    { number: 11, body: tinyPdfStream(`/Length1 ${font.length}`, font) });
  if (!foreign) objects.push({ number: 13, body: "<< /Fields [15 0 R] /NeedAppearances false /DR << /Font << /F 9 0 R >> >> /DA (/F 11 Tf 0 g) >>" },
    { number: 14, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 110 24] /Resources << /Font << /F 9 0 R >> >>", ".96 .97 .99 rg 0 0 110 24 re f .4 .5 .6 RG 1 w 0 0 110 24 re S BT /F 11 Tf 0 g 4 8 Td (Pending) Tj ET") },
    { number: 15, body: "<< /Type /Annot /Subtype /Widget /FT /Tx /T (Name) /V (Pending) /Rect [158 57 268 81] /AP << /N 14 0 R >> /F 4 >>" });
  else {
    const width = 24, height = 18, rgb = new Uint8Array(width * height * 3), alpha = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = y * width + x; rgb.set([30 + x * 8, 40 + y * 10, 210 - y * 8], index * 3); alpha[index] = x < 3 || y < 2 ? 65 : 255;
    }
    objects.push({ number: 16, body: tinyPdfStream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 17 0 R`, rgb) },
      { number: 17, body: tinyPdfStream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8`, alpha) });
  }
  return writeTinyPdf({ objects });
}
