import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas, DOMMatrix, Path2D, ImageData } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

// Optional offline synthetic evidence; no server, browser, GPU or client PDF.
// Uses the same separate pdf.js install as check-editor-visuals.mjs.
const output = resolve(process.argv[2] ?? "/tmp/hepr-editor-source-validation");
const reference = process.env.HEPR_PDFJS_MODULE ?? "/tmp/hepr-editor-reference/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
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
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { NativeSfntFont } = await import("../src/pdf/nativeFont.ts");
  const { writeScenePdf } = await import("../src/editorPdfWriter.ts");
  const { getScenePrimitive } = await import("../src/scenePrimitives.ts");
  const assets = await createEditorAppServices({ loadFontAsset: readFile });
  let face; try { face = await assets.fonts.loadBundled("Liberation Sans"); } finally { assets.dispose(); }
  const font = NativeSfntFont.parse(face.bytes), widths = Array.from({ length: 95 }, (_, index) => font.getHorizontalMetric(font.mapCodePoint(index + 32)).advanceWidth * 1000 / font.unitsPerEm);
  const source = fixture(face.bytes, widths), parser = await openPdf({ kind: "bytes", bytes: source });
  let scene; try { scene = await parser.compileVectorPage(0, { optimization: "none", preserveDrawingOrder: true, retainOptionalContent: true }); } finally { await parser.close(); }
  const services = await createEditorAppServices({ sourcePdf: source, loadFontAsset: readFile }), editor = await openEditorSession(scene, services.sessionOptions), diagnostics = [], warnings = [];
  let edited, canonical;
  try {
    editor.selectPrimitives([{ kind: "text", index: 0 }]); editor.transformSelection([1, .12, 0, 1, 3, -5]);
    const sharedText = Array.from({ length: scene.textInstanceCount }, (_, index) => ({ kind: "text", index })).find(ref => {
      const bounds = getScenePrimitive(scene, ref).bounds; return bounds.minX > 30 && bounds.maxX < 100 && bounds.minY > 110 && bounds.maxY < 140;
    });
    assert(sharedText); editor.selectPrimitives([sharedText]); editor.transformSelection([1, 0, 0, 1, 95, 3]);
    editor.selectPrimitives([{ kind: "raster", index: 0 }]); editor.transformSelection([1, .15, -.1, 1, 8, -10]);
    const red = Array.from({ length: scene.fillPathCount }, (_, index) => ({ kind: "fill", index })).find(ref => {
      const primitive = getScenePrimitive(scene, ref); return primitive.color?.[0] === 1 && primitive.color[1] === 0 && primitive.bounds.minY < 70;
    });
    assert(red); editor.selectPrimitives([red]); editor.reorderSelection("bring-to-front");
    const clipped = Array.from({ length: scene.fillPathCount }, (_, index) => ({ kind: "fill", index })).find(ref => {
      const primitive = getScenePrimitive(scene, ref); return Math.abs((primitive.color?.[0] ?? -1) - .25) < .001 && Math.abs(primitive.color[1] - .65) < .001;
    });
    assert(clipped); editor.selectPrimitives([clipped]); editor.transformSelection([1, 0, 0, 1, -8, 4]);
    edited = new Uint8Array(await (await editor.savePdf({ onDiagnostic: value => diagnostics.push(value), onWarning: value => warnings.push(value) })).arrayBuffer());
    canonical = new Uint8Array(await (await writeScenePdf(await editor.getScene())).arrayBuffer());
  } finally { editor.dispose(); services.dispose(); }
  assert(!diagnostics.some(value => value.code === "editor.pdf-source-operation-fallback"), JSON.stringify(diagnostics));
  const images = new Map(), reports = [];
  for (const [name, bytes] of [["source", source], ["edited", edited], ["canonical", canonical]]) {
    await writeFile(resolve(output, `${name}.pdf`), bytes);
    const reference = await renderReference(bytes), hepr = await renderHepr(bytes); images.set(name, reference);
    await writeFile(resolve(output, `${name}-pdfjs.png`), reference.toBuffer("image/png"));
    await writeFile(resolve(output, `${name}-hepr.png`), hepr.toBuffer("image/png"));
    const comparison = createCanvas(reference.width * 2, reference.height + 28), context = comparison.getContext("2d");
    context.fillStyle = "#eef2f6"; context.fillRect(0, 0, comparison.width, comparison.height); context.fillStyle = "#19293d"; context.font = "14px sans-serif";
    context.fillText(`${name}: pdf.js ${pdfjs.version}`, 10, 20); context.fillText(`${name}: HEPR Canvas2D`, reference.width + 10, 20);
    context.drawImage(reference, 0, 28); context.drawImage(hepr, reference.width, 28);
    await writeFile(resolve(output, `${name}-side-by-side.png`), comparison.toBuffer("image/png"));
    reports.push({ name, bytes: bytes.length, ...difference(reference, hepr) });
  }
  const fidelity = difference(images.get("edited"), images.get("canonical"));
  // Different font programs (native TrueType vs canonical outline Type3) can
  // differ in antialiasing. Large misplaced source artwork cannot pass this.
  assert(fidelity.meanMaxChannelDifference < 2, JSON.stringify(fidelity));
  const report = { pdfjsVersion: pdfjs.version, description: "Synthetic native-code glyph edits, isolated shared Form invocation, image affine transform, object-owned clip transform and native layer paint stacking. Offline CPU evidence only.",
    canonicalComparison: fidelity, readerComparisons: reports, diagnostics, warnings };
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, ...report }, null, 2));

  async function renderReference(bytes) {
    const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false, isEvalSupported: false, CanvasFactory });
    try { const document = await task.promise, page = await document.getPage(1), viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height)); await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise; return canvas;
    } finally { await task.destroy(); }
  }
  async function renderHepr(bytes) {
    const parser = await openPdf({ kind: "bytes", bytes });
    try { const source = await parser.compilePage(0, { optimization: "none" }), page = { ...source, displayProgram: { ...source.displayProgram,
      groups: source.displayProgram.groups.map(group => ({ ...group, blendingColorSpaceIndex: -1 })) } };
      return (await renderHeprPageToCanvas2d(page, { scale: 2, background: [1, 1, 1, 1], surfaceFactory(width, height) { return new CanvasFactory().create(width, height); } })).surface.canvas;
    } finally { await parser.close(); }
  }
} finally { hooks.deregister(); }

function difference(first, second) {
  assert.equal(first.width, second.width); assert.equal(first.height, second.height);
  const a = first.getContext("2d").getImageData(0, 0, first.width, first.height).data, b = second.getContext("2d").getImageData(0, 0, second.width, second.height).data;
  let error = 0, changed = 0;
  for (let index = 0; index < a.length; index += 4) { const amount = Math.max(...[0, 1, 2].map(channel => Math.abs(a[index + channel] - b[index + channel]))); error += amount; if (amount > 20) changed++; }
  return { meanMaxChannelDifference: error / (a.length / 4), pixelsDifferentByMoreThan20: changed / (a.length / 4) };
}
function fixture(font, widths) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [12 0 R] /D << /Order [12 0 R] /ON [12 0 R] >> >> >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 220] /Resources << /Font << /F 5 0 R >> /XObject << /Shared 8 0 R /Image 9 0 R >> /Properties << /Paint 12 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "BT /F 18 Tf 20 190 Td (SOURCE OPERATIONS) Tj ET\nq 1 0 0 1 20 100 cm /Shared Do Q q 1 0 0 1 120 100 cm /Shared Do Q\nq 40 0 0 30 220 145 cm /Image Do Q\nq 220 90 60 35 re W n .25 .65 .85 rg 200 70 100 75 re f .7 .2 .8 rg 260 75 30 50 re f Q\n/OC /Paint BDC q 1 0 0 rg 25 25 55 45 re f Q q 0 0 1 rg 50 35 55 45 re f Q q 0 1 0 rg 75 45 55 45 re f Q EMC\n% unchanged technical baseline\n.2 .3 .4 RG .5 w 20 16 m 280 16 l S") },
    { number: 5, body: `<< /Type /Font /Subtype /TrueType /BaseFont /LiberationSans /FirstChar 32 /LastChar 126 /Widths [${widths.join(" ")}] /Encoding /WinAnsiEncoding /FontDescriptor 6 0 R >>` },
    { number: 6, body: "<< /Type /FontDescriptor /FontName /LiberationSans /Flags 32 /FontBBox [-500 -500 2000 2000] /ItalicAngle 0 /Ascent 900 /Descent -250 /CapHeight 700 /StemV 80 /FontFile2 7 0 R >>" },
    { number: 7, body: tinyPdfStream(`/Length1 ${font.length}`, font) },
    { number: 8, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 90 50] /Resources << /Font << /F 5 0 R >> >>", ".9 .93 .96 rg 0 0 90 50 re f .25 .35 .45 RG 1 w 0 0 90 50 re S BT /F 11 Tf 0 g 10 22 Td (Shared Form) Tj ET") },
    { number: 9, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8", Uint8Array.of(255, 120, 20, 40, 160, 220, 30, 160, 90, 240, 200, 60)) },
    { number: 12, body: "<< /Type /OCG /Name (Paint objects) >>" }
  ] });
}
