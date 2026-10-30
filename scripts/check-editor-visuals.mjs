import { registerHooks } from "node:module";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createCanvas, DOMMatrix, Path2D, ImageData } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

// This optional, offline comparison uses a separately installed pdf.js reference.
// npm install --prefix /tmp/hepr-editor-reference --no-audit --no-fund --ignore-scripts pdfjs-dist@6.4.299
// node scripts/check-editor-visuals.mjs [/tmp/hepr-editor-validation]
const output = resolve(process.argv[2] ?? "/tmp/hepr-editor-validation");
const referenceModule = process.env.HEPR_PDFJS_MODULE ?? "/tmp/hepr-editor-reference/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
Object.assign(globalThis, { DOMMatrix, Path2D, ImageData });
await mkdir(output, { recursive: true });
try {
  const pdfjs = await import(pathToFileURL(referenceModule).href);
  const { openPdf } = await import("../src/pdfSession.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { NativeSfntFont } = await import("../src/pdf/nativeFont.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const { writeScenePdf } = await import("../src/editorPdfWriter.ts");
  const { addEditorTextMarkup, addEditorComment } = await import("../src/editorReview.ts");
  const { getScenePrimitive } = await import("../src/scenePrimitives.ts");
  const loadFontAsset = async url => new Uint8Array(await readFile(url));
  const initialServices = await createEditorAppServices({ loadFontAsset });
  const regular = await initialServices.fonts.loadBundled("Liberation Sans"), font = NativeSfntFont.parse(regular.bytes);
  const widths = Array.from({ length: 95 }, (_, i) => font.getHorizontalMetric(font.mapCodePoint(i + 32)).advanceWidth * 1000 / font.unitsPerEm);
  const source = fixture(regular.bytes, widths), sourceParser = await openPdf({ kind: "bytes", bytes: source });
  const scene = await sourceParser.compileVectorPage(0, { optimization: "none", preserveDrawingOrder: true }); await sourceParser.close(); initialServices.dispose();
  const services = await createEditorAppServices({ sourcePdf: source, loadFontAsset });
  const custom = await services.fonts.loadBundled("Liberation Serif", { fontStyle: "italic" });
  const editor = await openEditorSession(scene, services.sessionOptions);
  const warnings = [];
  try {
    editor.setFieldValue("Name", "Alice Example");
    editor.addObject({ kind: "text", pageIndex: 0, opacity: .85, x: 193, y: 205, width: 155, height: 72, fontSize: 16, text: "Review Ω\napproved",
      runs: [{ text: "Review Ω", fontId: custom.id, fontStyle: "italic", color: "#9b2c2c", underline: true },
        { text: "\napproved", fontFamily: "Liberation Sans", fontWeight: "bold", fontSize: 13, color: "#12633d" }] });
    editor.addObject({ kind: "shape", pageIndex: 0, opacity: .6, shape: "ellipse", x: 236, y: 129, width: 78, height: 38, color: "#ce6d09", fill: "#fff0bd", strokeWidth: 2 });
    editor.addObject({ kind: "shape", pageIndex: 0, shape: "arrow", x: 188, y: 115, width: 45, height: 27, color: "#ce6d09", strokeWidth: 2 });
    editor.addObject({ kind: "signature", pageIndex: 0, opacity: .75, color: "#174ca3", strokeWidth: 2.2,
      paths: [[[195, 72], [207, 99], [215, 68], [224, 92], [231, 74], [241, 84], [252, 70], [263, 79], [272, 72], [300, 77]],
        [[203, 63], [300, 65]]] });
    editor.addObject({ kind: "image", pageIndex: 0, opacity: .8, x: 284, y: 18, width: 42, height: 36, imageWidth: 2, imageHeight: 2,
      data: Uint8Array.of(30, 110, 170, 255, 40, 160, 180, 255, 130, 200, 160, 255, 245, 200, 100, 255) });
    const editable = new Uint8Array(await (await editor.savePdf({ onWarning: value => warnings.push(value) })).arrayBuffer());
    await writeFile(resolve(output, "before.pdf"), source); await writeFile(resolve(output, "after-editable.pdf"), editable);
    const target = Array.from({ length: scene.fillPathCount }, (_, index) => ({ kind: "fill", index }))
      .find(ref => { const b = getScenePrimitive(scene, ref).bounds; return b.maxX - b.minX > 50 && b.maxX - b.minX < 180; });
    if (target) { editor.selectPrimitives([target]); editor.transformSelection([1, 0, 0, 1, 6, -5]); }
    const transformed = new Uint8Array(await (await editor.savePdf({ onWarning: value => warnings.push(value) })).arrayBuffer());
    await writeFile(resolve(output, "after-existing-transform.pdf"), transformed);
    const hep = await editor.saveHep({ withVectorLod: false, withTextLod: false, encodeRasterImages: false });
    await writeFile(resolve(output, "after-baked.hep"), new Uint8Array(await hep.arrayBuffer()));
    const baked = await loadSceneFromHep(await hep.arrayBuffer());
    const rebuilt = new Uint8Array(await (await writeScenePdf(baked, { onWarning: value => warnings.push(value) })).arrayBuffer());
    await writeFile(resolve(output, "after-hep-rebuilt.pdf"), rebuilt);
    const rows = [], results = [];
    for (const [name, bytes] of [["before", source], ["after", editable], ["transformed", transformed], ["hep-rebuilt", rebuilt]]) {
      const reference = await renderReference(bytes), rendered = await renderHepr(bytes);
      await writeFile(resolve(output, `${name}-pdfjs.png`), reference.toBuffer("image/png"));
      await writeFile(resolve(output, `${name}-hepr.png`), rendered.toBuffer("image/png"));
      const comparison = createCanvas(reference.width * 2, reference.height + 32), context = comparison.getContext("2d");
      context.fillStyle = "#eef2f6"; context.fillRect(0, 0, comparison.width, comparison.height); context.fillStyle = "#19293d"; context.font = "16px sans-serif";
      context.fillText(`${name}: pdf.js ${pdfjs.version}`, 12, 22); context.fillText(`${name}: HEPR Canvas2D`, reference.width + 12, 22);
      context.drawImage(reference, 0, 32); context.drawImage(rendered, reference.width, 32);
      await writeFile(resolve(output, `${name}-side-by-side.png`), comparison.toBuffer("image/png")); rows.push(comparison);
      const a = reference.getContext("2d").getImageData(0, 0, reference.width, reference.height).data;
      const b = rendered.getContext("2d").getImageData(0, 0, rendered.width, rendered.height).data;
      let opacitySample;
      if (name !== "before") {
        const offset = (Math.floor((300 - 148) * 2) * reference.width + 275 * 2) * 4;
        opacitySample = { expected: [255, 246, 215], pdfjs: Array.from(a.subarray(offset, offset + 3)), hepr: Array.from(b.subarray(offset, offset + 3)) };
        for (const pixels of [opacitySample.pdfjs, opacitySample.hepr]) assert(pixels.every((value, i) => Math.abs(value - opacitySample.expected[i]) <= 2), `${name}: object opacity is applied once`);
      }
      let error = 0, changed = 0;
      for (let i = 0; i < a.length; i += 4) { const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])); error += d; if (d > 20) changed++; }
      results.push({ name, width: reference.width, height: reference.height, meanMaxChannelDifference: error / (a.length / 4), pixelsDifferentByMoreThan20: changed / (a.length / 4), opacitySample });
    }
    const overview = createCanvas(rows[0].width, rows.reduce((n, row) => n + row.height, 0)), context = overview.getContext("2d"); let y = 0;
    for (const row of rows) { context.drawImage(row, 0, y); y += row.height; } await writeFile(resolve(output, "overview.png"), overview.toBuffer("image/png"));
    const report = { description: "Offline, synthetic PDF editing comparison. HEPR Canvas2D versus independent pdf.js; no browser/GPU performance or visual validation.",
      pdfjsVersion: pdfjs.version, sourceBytes: source.length, editableBytes: editable.length, transformedBytes: transformed.length, hepBytes: hep.size, rebuiltBytes: rebuilt.length,
      bakedScene: { strokes: baked.segmentCount, fills: baked.fillPathCount, glyphs: baked.textInstanceCount, rasters: baked.rasterLayers.length }, warnings, results };
    await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ output, ...report }, null, 2));
  } finally { editor.dispose(); services.dispose(); }

  // Additional synthetic workloads keep the original technical artifact names
  // and overview stable. Each fixture gets its own PDF/HEP/PNG/report set.
  const extraFonts = await createEditorAppServices({ loadFontAsset });
  let serif;
  try { serif = await extraFonts.fonts.loadBundled("Liberation Serif"); }
  finally { extraFonts.dispose(); }
  const serifFont = NativeSfntFont.parse(serif.bytes);
  const serifWidths = Array.from({ length: 95 }, (_, i) => serifFont.getHorizontalMetric(serifFont.mapCodePoint(i + 32)).advanceWidth * 1000 / serifFont.unitsPerEm);
  const book = await compareSynthetic("book", bookFixture(serif.bytes, serifWidths), async (editor, services) => {
    const text = editor.sourceScene.textIndex.pages[0].text;
    for (const [type, word] of [["highlight", "Workshop"], ["underline", "Synthetic"], ["strikeout", "vector"]]) {
      const start = text.indexOf(word); assert(start >= 0);
      addEditorTextMarkup(editor, editor.sourceScene, [{ pageIndex: 0, start, length: word.length }], type, { contents: `${type} review`, author: "Reviewer" });
    }
    addEditorComment(editor, 0, 386, 480, "Review annotation with an explicit appearance", "Reviewer");
    const italic = await services.fonts.loadBundled("Liberation Serif", { fontStyle: "italic" });
    editor.addObject({ kind: "shape", pageIndex: 0, shape: "rectangle", x: 43, y: 389, width: 285, height: 15, fill: "#ffdf66", strokeWidth: 0, opacity: .25 });
    editor.addObject({ kind: "ink", pageIndex: 0, paths: [[[34, 406], [31, 395], [34, 382], [32, 370]]], color: "#2b58a1", strokeWidth: 1.3 });
    editor.addObject({ kind: "text", pageIndex: 0, x: 45, y: 69, width: 330, height: 38, fontSize: 11,
      text: "Reviewer note: preserve searchable text and typography. Ω",
      runs: [{ text: "Reviewer note: ", fontFamily: "Liberation Sans", fontWeight: "bold", color: "#24557c" },
        { text: "preserve searchable text and typography. Ω", fontId: italic.id, fontStyle: "italic", underline: true, color: "#24557c" }] });
  }, { description: "Synthetic book page with serif paragraphs, standard highlight/underline/strikeout/comment annotations and a mixed-font Unicode review note.", requiredText: "Workshop" });
  const image = await compareSynthetic("image", imageFixture(regular.bytes, widths), async editor => {
    const size = 128, data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4, distance = Math.hypot(x - 63.5, y - 63.5);
      data.set([225, 64 + Math.round(x / size * 70), 52, Math.round(255 * Math.max(0, Math.min(1, (59 - distance) / 6)))], index);
    }
    editor.addObject({ kind: "image", pageIndex: 0, x: 278, y: 92, width: 86, height: 86, imageWidth: size, imageHeight: size, data, opacity: .8 });
    editor.addObject({ kind: "shape", pageIndex: 0, shape: "rectangle", x: 88, y: 108, width: 125, height: 72, fill: null, color: "#ffffff", strokeWidth: 2.5, opacity: .9 });
    editor.addObject({ kind: "shape", pageIndex: 0, shape: "arrow", x: 220, y: 166, width: 77, height: 40, points: [[220, 206], [297, 166]], color: "#3c4a60", strokeWidth: 2 });
    editor.addObject({ kind: "text", pageIndex: 0, x: 31, y: 280, width: 360, height: 28, fontSize: 12,
      text: "Image review: alpha stays transparent", color: "#24557c", fontFamily: "Liberation Sans", fontWeight: "bold" });
  }, { description: "Synthetic image-heavy page: 1024 x 768 RGBA source, soft alpha over a vector checkerboard, an additional transparent RGBA image, opacity and vector markup.",
    requiredText: "RGBA", sourceImage: { width: 1024, height: 768, channels: 4 }, transparentSample: { x: 34, y: 64, expected: [255, 255, 255] },
    preservedSamples: [{ x: 73, y: 235 }, { x: 73, y: 100 }, { x: 245, y: 240 }] });
  await writeFile(resolve(output, "corpus-report.json"), JSON.stringify({ description: "Synthetic offline fixtures only; no browser/GPU validation.", pdfjsVersion: pdfjs.version,
    technicalReport: "report.json", additionalFixtures: [book, image] }, null, 2));
  for (const report of [book, image]) for (const [check, passed] of Object.entries(report.checks)) assert(passed, `${report.name}: ${check}`);

  async function compareSynthetic(name, bytes, modify, details) {
    const parser = await openPdf({ kind: "bytes", bytes });
    let scene;
    try { scene = await parser.compileVectorPage(0, { optimization: "none", preserveDrawingOrder: true }); }
    finally { await parser.close(); }
    const services = await createEditorAppServices({ sourcePdf: bytes, loadFontAsset }), editor = await openEditorSession(scene, services.sessionOptions), warnings = [];
    try {
      await modify(editor, services);
      const after = new Uint8Array(await (await editor.savePdf({ onWarning: value => warnings.push(value) })).arrayBuffer());
      const hep = await editor.saveHep({ withVectorLod: false, withTextLod: false, encodeRasterImages: false });
      const baked = await loadSceneFromHep(await hep.arrayBuffer());
      const rebuilt = new Uint8Array(await (await writeScenePdf(baked, { onWarning: value => warnings.push(value) })).arrayBuffer());
      const reopened = await openPdf({ kind: "bytes", bytes: rebuilt });
      let rebuiltScene;
      try { rebuiltScene = await reopened.compileVectorPage(0, { optimization: "none" }); }
      finally { await reopened.close(); }
      const searchableText = rebuiltScene.textIndex?.pages[0]?.text ?? "";
      await writeFile(resolve(output, `${name}-search-text.json`), JSON.stringify({ before: scene.textIndex?.pages[0]?.text ?? "", rebuilt: searchableText }, null, 2));
      const checks = { sourceTextSearchableAfterHepPdf: searchableText.includes(details.requiredText),
        fullSourceRasterDimensions: !details.sourceImage || baked.rasterLayers.some(layer => layer.width === details.sourceImage.width && layer.height === details.sourceImage.height) };
      await writeFile(resolve(output, `${name}-before.pdf`), bytes); await writeFile(resolve(output, `${name}-after-editable.pdf`), after);
      await writeFile(resolve(output, `${name}-after-baked.hep`), new Uint8Array(await hep.arrayBuffer())); await writeFile(resolve(output, `${name}-after-hep-rebuilt.pdf`), rebuilt);
      const rows = [], results = [], baselineSamples = [];
      for (const [stage, data] of [["before", bytes], ["after", after], ["hep-rebuilt", rebuilt]]) {
        const reference = await renderReference(data), rendered = await renderHepr(data);
        assert.equal(rendered.width, reference.width); assert.equal(rendered.height, reference.height);
        await writeFile(resolve(output, `${name}-${stage}-pdfjs.png`), reference.toBuffer("image/png"));
        await writeFile(resolve(output, `${name}-${stage}-hepr.png`), rendered.toBuffer("image/png"));
        const comparison = createCanvas(reference.width * 2, reference.height + 32), context = comparison.getContext("2d");
        context.fillStyle = "#eef2f6"; context.fillRect(0, 0, comparison.width, comparison.height); context.fillStyle = "#19293d"; context.font = "16px sans-serif";
        context.fillText(`Synthetic ${name}, ${stage}: pdf.js ${pdfjs.version}`, 12, 22); context.fillText(`Synthetic ${name}, ${stage}: HEPR Canvas2D`, reference.width + 12, 22);
        context.drawImage(reference, 0, 32); context.drawImage(rendered, reference.width, 32);
        await writeFile(resolve(output, `${name}-${stage}-side-by-side.png`), comparison.toBuffer("image/png")); rows.push(comparison);
        const a = reference.getContext("2d").getImageData(0, 0, reference.width, reference.height).data, b = rendered.getContext("2d").getImageData(0, 0, rendered.width, rendered.height).data;
        let error = 0, changed = 0;
        for (let i = 0; i < a.length; i += 4) { const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])); error += d; if (d > 20) changed++; }
        let transparentSample;
        if (details.transparentSample) {
          const sample = details.transparentSample, offset = (Math.floor(reference.height - sample.y * 2) * reference.width + Math.floor(sample.x * 2)) * 4;
          transparentSample = { expected: sample.expected, pdfjs: Array.from(a.subarray(offset, offset + 3)), hepr: Array.from(b.subarray(offset, offset + 3)) };
        }
        const preservedSamples = details.preservedSamples?.map((sample, index) => {
          const offset = (Math.floor(reference.height - sample.y * 2) * reference.width + Math.floor(sample.x * 2)) * 4;
          const pdfjsPixels = Array.from(a.subarray(offset, offset + 3)), heprPixels = Array.from(b.subarray(offset, offset + 3));
          if (stage === "before") baselineSamples[index] = pdfjsPixels;
          return { ...sample, expected: baselineSamples[index], pdfjs: pdfjsPixels, hepr: heprPixels };
        });
        results.push({ stage, width: reference.width, height: reference.height, meanMaxChannelDifference: error / (a.length / 4), pixelsDifferentByMoreThan20: changed / (a.length / 4), transparentSample, preservedSamples });
      }
      const overview = createCanvas(rows[0].width, rows.reduce((sum, row) => sum + row.height, 0)), context = overview.getContext("2d"); let y = 0;
      for (const row of rows) { context.drawImage(row, 0, y); y += row.height; }
      await writeFile(resolve(output, `${name}-overview.png`), overview.toBuffer("image/png"));
      const report = { name, synthetic: true, ...details, pdfjsVersion: pdfjs.version, sourceBytes: bytes.length, editedBytes: after.length, hepBytes: hep.size, rebuiltBytes: rebuilt.length,
        bakedScene: { strokes: baked.segmentCount, fills: baked.fillPathCount, glyphs: baked.textInstanceCount, rasters: baked.rasterLayers.map(layer => ({ width: layer.width, height: layer.height })) },
        rebuiltSearchableCharacters: searchableText.length, checks: { ...checks, transparentPixelsRevealBackground: results.every(result => !result.transparentSample ||
          [result.transparentSample.pdfjs, result.transparentSample.hepr].every(value => value.every((channel, i) => Math.abs(channel - result.transparentSample.expected[i]) <= 2))),
          sourceAppearanceOutsideEdits: results.every(result => !result.preservedSamples || result.preservedSamples.every(sample =>
            [sample.pdfjs, sample.hepr].every(value => value.every((channel, i) => Math.abs(channel - sample.expected[i]) <= 3)))) }, warnings, results };
      await writeFile(resolve(output, `${name}-report.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ output, ...report }, null, 2)); return report;
    } finally { editor.dispose(); services.dispose(); }
  }

  async function renderHepr(bytes) {
    const parser = await openPdf({ kind: "bytes", bytes });
    try {
      const page = await parser.compilePage(0, { optimization: "none" });
      const result = await renderHeprPageToCanvas2d(page, { scale: 2, background: [1, 1, 1, 1], surfaceFactory(width, height) { const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") }; } });
      return result.surface.canvas;
    } finally { await parser.close(); }
  }
  async function renderReference(bytes) {
    class CanvasFactory {
      create(width, height) { const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") }; }
      reset(target, width, height) { target.canvas.width = width; target.canvas.height = height; }
      destroy(target) { target.canvas.width = target.canvas.height = 0; target.canvas = target.context = null; }
    }
    const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false, isEvalSupported: false, CanvasFactory });
    const pdf = await task.promise;
    try { const page = await pdf.getPage(1), viewport = page.getViewport({ scale: 2 }), canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise; return canvas;
    } finally { await task.destroy(); }
  }
} finally { hooks.deregister(); }

function fixture(font, widths) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm 8 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 300] /Contents 4 0 R /Resources << /Font << /F 5 0 R >> >> /Annots [10 0 R] >>" },
    { number: 4, body: tinyPdfStream("", "q .15 .2 .27 RG 1.5 w 20 80 155 160 re S .92 .95 .98 rg 24 84 69 75 re f .87 .93 .98 rg 98 164 73 72 re f 95 80 m 95 240 l S 20 160 m 175 160 l S .5 w .3 .4 .5 RG 27 88 m 85 151 l S 27 151 m 85 88 l S 106 175 54 45 re S Q BT /F 17 Tf 20 268 Td (Existing vector plan) Tj ET BT /F 10 Tf 31 211 Td (Office A) Tj 72 -98 Td (Office B) Tj ET BT /F 10 Tf 20 57 Td (Name:) Tj ET") },
    { number: 5, body: `<< /Type /Font /Subtype /TrueType /BaseFont /LiberationSans /FirstChar 32 /LastChar 126 /Widths [${widths.join(" ")}] /Encoding /WinAnsiEncoding /FontDescriptor 6 0 R >>` },
    { number: 6, body: "<< /Type /FontDescriptor /FontName /LiberationSans /Flags 32 /FontBBox [-500 -500 2000 2000] /ItalicAngle 0 /Ascent 900 /Descent -250 /CapHeight 700 /StemV 80 /FontFile2 7 0 R >>" },
    { number: 7, body: tinyPdfStream(`/Length1 ${font.length}`, font) },
    { number: 8, body: "<< /Fields [10 0 R] /NeedAppearances false /DR << /Font << /F 5 0 R >> >> /DA (/F 11 Tf 0 g) >>" },
    { number: 9, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 150 25] /Resources << /Font << /F 5 0 R >> >>", ".96 .97 .99 rg 0 0 150 25 re f .4 .5 .6 RG .5 w 0 0 150 25 re S BT /F 11 Tf 0 g 4 8 Td (Unfilled) Tj ET") },
    { number: 10, body: "<< /Type /Annot /Subtype /Widget /FT /Tx /T (Name) /V (Unfilled) /Rect [20 20 170 45] /AP << /N 9 0 R >> /F 4 >>" }
  ] });
}

function pageFixture(font, widths, width, height, content, extraResources = "", extraObjects = [], fontName = "LiberationSans") {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" }, { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /Font << /F 5 0 R >> ${extraResources} >> >>` },
    { number: 4, body: tinyPdfStream("", content) },
    { number: 5, body: `<< /Type /Font /Subtype /TrueType /BaseFont /${fontName} /FirstChar 32 /LastChar 126 /Widths [${widths.join(" ")}] /Encoding /WinAnsiEncoding /FontDescriptor 6 0 R >>` },
    { number: 6, body: `<< /Type /FontDescriptor /FontName /${fontName} /Flags 32 /FontBBox [-500 -500 2000 2000] /ItalicAngle 0 /Ascent 900 /Descent -250 /CapHeight 700 /StemV 80 /FontFile2 7 0 R >>` },
    { number: 7, body: tinyPdfStream(`/Length1 ${font.length}`, font) }, ...extraObjects
  ] });
}

function bookFixture(font, widths) {
  const paragraphs = [
    "The quiet workshop opened before sunrise. Along the wall, books and folded drawings recorded a century of careful decisions. A reader could follow the ink from an early sketch to a finished machine.",
    "Every page held a different kind of precision. Thin rules divided the tables, generous margins framed the paragraphs, and small numerals connected each illustration to its explanation. Nothing needed to become a photograph merely to remain visible.",
    "When the reader added a note, the original words stayed where they belonged. The new text had its own font, color, and purpose. It could be selected, moved, and revised without changing the surrounding passage.",
    "A useful document keeps both its appearance and its meaning. Letters should remain searchable. Curves should remain smooth when enlarged. Transparent images should reveal the paper and the marks beneath them.",
    "The afternoon light moved across the desk while the review continued. One careful underline and a short comment were enough to explain the next change. The document would travel onward with those additions intact."
  ];
  const escape = text => text.replace(/[\\()]/g, value => `\\${value}`);
  const commands = ["BT /F 21 Tf 44 548 Td (A Reader in the Workshop) Tj ET", "BT /F 10 Tf 44 525 Td (Synthetic book page - vector serif text) Tj ET", "0.7 G .4 w 44 513 m 376 513 l S"];
  let y = 490;
  for (const paragraph of paragraphs) {
    const lines = []; let line = "";
    for (const word of paragraph.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      const extent = [...next].reduce((sum, char) => sum + (widths[char.charCodeAt(0) - 32] ?? 500) * 11 / 1000, 0);
      if (line && extent > 332) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    for (const text of lines) { commands.push(`BT /F 11 Tf 44 ${y} Td (${escape(text)}) Tj ET`); y -= 15; }
    y -= 12;
  }
  commands.push("0.7 G .4 w 44 48 m 376 48 l S", "BT /F 9 Tf 207 32 Td (1) Tj ET");
  return pageFixture(font, widths, 420, 594, commands.join("\n"), "", [], "LiberationSerif");
}

function imageFixture(font, widths) {
  const width = 1024, height = 768, rgb = new Uint8Array(width * height * 3), alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const nx = x / (width - 1), ny = y / (height - 1), index = y * width + x;
    const grid = x % 96 < 2 || y % 96 < 2 ? 25 : 0;
    rgb.set([Math.max(0, Math.round(35 + nx * 175) - grid), Math.max(0, Math.round(70 + (1 - ny) * 150) - grid), Math.max(0, Math.round(80 + Math.sin((nx + ny) * Math.PI / 2) * 130) - grid)], index * 3);
    const distance = Math.hypot((nx - .5) / .65, (ny - .5) / .65);
    alpha[index] = Math.round(255 * Math.max(0, Math.min(1, (1 - distance) * 3)));
  }
  const commands = ["BT /F 18 Tf 30 315 Td (RGBA image study) Tj ET"];
  for (let y = 0; y < 11; y++) for (let x = 0; x < 18; x++) commands.push(`${(x + y) % 2 ? ".84 .87 .91" : "1 1 1"} rg ${30 + x * 20} ${60 + y * 20} 20 20 re f`);
  commands.push("q 360 0 0 220 30 60 cm /Photo Do Q", "0 g BT /F 10 Tf 30 35 Td (1024 x 768 RGBA pixels, soft alpha over vector checkerboard) Tj ET");
  return pageFixture(font, widths, 420, 340, commands.join("\n"), "/XObject << /Photo 8 0 R >>", [
    { number: 8, body: tinyPdfStream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 9 0 R`, rgb) },
    { number: 9, body: tinyPdfStream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8`, alpha) }
  ]);
}
