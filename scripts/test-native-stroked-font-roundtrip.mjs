import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { buildType1Fixture, type1CharString as cs } from "./lib/type1Fixture.mjs";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
const width = 480, height = 360, scale = 2;
const surfaceFactory = (w, h) => { const canvas = createCanvas(w, h); return { canvas, context: canvas.getContext("2d") }; };
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const { HepArchive } = await import("../src/hepContainer.ts");
  const pdf = fixturePdf(), session = await openPdf({ kind: "bytes", bytes: pdf, label: "intrinsic-font-paint.pdf" },
    { embeddedFontPaint: "font" });
  let page;
  try { page = await session.compilePage(0, { optimization: "none" }); }
  finally { await session.close(); }
  assert.equal(page.stores.glyphs.glyphIds.length, 12);
  const rendered = await renderHeprPageToCanvas2d(page, { scale, background: [1, 1, 1, 1], surfaceFactory });
  const diagnostics = [];
  const hep = await buildHep(pdf, { compression: "deflate", withVectorLod: true, withTextLod: true,
    encodeRasterImages: false, embeddedFontPaint: "font", onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  const bytes = new Uint8Array(await hep.arrayBuffer()), scene = await loadSceneFromHep(bytes);
  const archive = await HepArchive.loadAsync(bytes);
  for (const entry of Object.values(archive.files)) await entry.async("uint8array");
  assert.equal(scene.pageCount, 1);
  assert.equal(scene.textInstanceCount, 14, "intrinsic Tr0 and explicit Tr1/2 preserve their separate fill/stroke appearances");
  assert(scene.segmentCount > 0, "intrinsic hairlines survive export as real zero-width packed strokes");
  assert.equal(scene.rasterLayers?.length ?? 0, 0, "stroked font output remains vector through HEP serialization");
  assert(!diagnostics.some(diagnostic => /substitut|fallback|unavailable|unsupported/.test(diagnostic.code)),
    `font fallback is unnecessary: ${JSON.stringify(diagnostics)}`);
  assert.equal(diagnostics.filter(diagnostic => diagnostic.code === "font.intrinsic-paint-compatibility").length, 1,
    "repeated glyphs and identical named-font warnings produce one compatibility diagnostic");
  const reloaded = renderFixtureScene(scene);
  // HEP uses packed one-pixel strokes, whose joins can differ within one
  // device pixel. The geometry and colored interiors must agree independently
  // of those antialiasing differences after a real archive write/read.
  const actual = reloaded.getContext("2d").getImageData(0, 0, width * scale, height * scale).data;
  const expected = rendered.surface.context.getImageData(0, 0, width * scale, height * scale).data;
  const difference = inkDifference(actual, expected);
  assert(difference < 0.05, `retained display versus HEP reload ink mismatch ${difference}`);
  const defaultSession = await openPdf({ kind: "bytes", bytes: pdf, label: "pdf-spec-font-paint.pdf" });
  let defaultPage;
  try { defaultPage = await defaultSession.compilePage(0, { optimization: "none" }); }
  finally { await defaultSession.close(); }
  const defaultRendered = await renderHeprPageToCanvas2d(defaultPage, { scale, background: [1, 1, 1, 1], surfaceFactory });
  for (const y of [300, 140]) {
    assert.deepEqual([...defaultRendered.surface.context.getImageData(165, height * scale - y * scale, 1, 1).data], [255, 0, 0, 255],
      "PDF-spec default fills the raw character interior regardless of embedded PaintType/StrokeWidth");
    assert.deepEqual([...rendered.surface.context.getImageData(165, height * scale - y * scale, 1, 1).data], [255, 255, 255, 255],
      "explicit font-paint compatibility preserves hollow stroked glyphs");
  }
  const defaultDiagnostics = [];
  const defaultHep = await buildHep(pdf, { compression: "deflate", withVectorLod: true, withTextLod: true,
    encodeRasterImages: false, onDiagnostic: diagnostic => defaultDiagnostics.push(diagnostic) });
  const defaultScene = await loadSceneFromHep(await defaultHep.arrayBuffer());
  assert.equal(defaultScene.textInstanceCount, 16, "default Tr0 contains filled character paths for both embedded font stroke widths");
  assert.equal(defaultScene.segmentCount, 0, "ignored font PaintType produces no intrinsic device hairline strokes by default");
  assert.equal(defaultScene.rasterLayers?.length ?? 0, 0);
  assert(!defaultDiagnostics.some(diagnostic => diagnostic.code === "font.intrinsic-paint-compatibility" ||
    diagnostic.code === "font.type1-stroke-approximation" || diagnostic.code === "font.cff-stroke-approximation"),
    "default rendering does not evaluate or diagnose ignored intrinsic stroke silhouettes");
  const defaultReloaded = renderFixtureScene(defaultScene);
  assert.deepEqual([...defaultReloaded.getContext("2d").getImageData(165, 120, 1, 1).data], [255, 0, 0, 255],
    "the raw-fill PDF default survives a real HEP write/read");
  const artifactFlag = process.argv.indexOf("--artifacts");
  if (artifactFlag >= 0) {
    const directory = resolve(process.argv[artifactFlag + 1]); await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "original.pdf"), pdf);
    await writeFile(resolve(directory, "converted.hep"), bytes);
    await writeFile(resolve(directory, "converted-default.hep"), new Uint8Array(await defaultHep.arrayBuffer()));
    await writeFile(resolve(directory, "retained.png"), rendered.surface.canvas.toBuffer("image/png"));
    await writeFile(resolve(directory, "hep-reloaded.png"), reloaded.toBuffer("image/png"));
    await writeFile(resolve(directory, "pdf-spec-default.png"), defaultRendered.surface.canvas.toBuffer("image/png"));
    await writeFile(resolve(directory, "pdf-spec-default-hep.png"), defaultReloaded.toBuffer("image/png"));
    await writeFile(resolve(directory, "evidence.json"), JSON.stringify({ hepBytes: bytes.length,
      embeddedFontPaint: "font", defaultHepBytes: defaultHep.size, defaultTextInstances: defaultScene.textInstanceCount,
      defaultSegments: defaultScene.segmentCount, defaultDiagnostics,
      archiveSectionsVerified: Object.keys(archive.files).length, glyphs: 12, textInstances: scene.textInstanceCount,
      segments: scene.segmentCount, rasterLayers: scene.rasterLayers?.length ?? 0,
      retainedVsHepInkDifference: difference, diagnostics }, null, 2));
  }
  console.log(`Stroked Type1 PDF/display/HEP roundtrip passed: ${bytes.length} bytes, ${Object.keys(archive.files).length} CRC-verified sections; ${(difference * 100).toFixed(3)}% retained/HEP ink difference.`);
} finally { hooks.deregister(); }

function fixturePdf() {
  const fonts = [40, 0].map(strokeWidth => buildType1Fixture({ paintType: 2, fontMatrix: [.001, .00015, .00025, .0009, 0, 0],
    clearExtra: `/StrokeWidth ${strokeWidth} def`, glyphs: [[".notdef", cs(0, 600, "hsbw", "endchar")],
      ["A", cs(50, 600, "hsbw", 0, 0, "rmoveto", 200, 0, "rlineto", 0, 200, "rlineto", "endchar")]] }));
  const content = ["1 0 0 rg 0 0 1 RG 3 w"];
  for (const [font, y, dashed] of [["F1", 285, false], ["F1", 205, true], ["F2", 125, false], ["F2", 45, true]]) {
    for (let mode = 0; mode < 3; mode++) {
      // Exercise font-space dashes for intrinsic Tr0 separately from explicit
      // PDF strokes. Reference rasterizers differ on dashing Tr1/2 text.
      content.push(dashed ? `1 J 1 j ${mode === 0 ? "[100 100] 5 d" : "[] 0 d"}` : "0 J 0 j [] 0 d");
      content.push(`BT /${font} 200 Tf ${mode} Tr 1 0 0 1 ${40 + mode * 150} ${y} Tm (A) Tj ET`);
    }
  }
  const objects = [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 5 0 R /F2 8 0 R >> >> /Contents 4 0 R >>` },
    { number: 4, body: tinyPdfStream("", content.join("\n")) }
  ];
  fonts.forEach((font, index) => {
    const id = 5 + index * 3;
    objects.push({ number: id, body: `<< /Type /Font /Subtype /Type1 /BaseFont /FixtureType1 /FirstChar 65 /LastChar 65 /Widths [600] /Encoding << /Differences [65 /A] >> /FontDescriptor ${id + 1} 0 R >>` },
      { number: id + 1, body: `<< /Type /FontDescriptor /FontName /FixtureType1 /Flags 4 /FontBBox [-100 -100 1000 1000] /ItalicAngle 0 /Ascent 1000 /Descent -100 /CapHeight 1000 /StemV 100 /FontFile ${id + 2} 0 R >>` },
      { number: id + 2, body: tinyPdfStream(`/Length1 ${font.length1} /Length2 ${font.length2} /Length3 ${font.length3}`, font.bytes) });
  });
  return writeTinyPdf({ objects });
}

// Headless inspection of the actual reloaded glyph/stroke buffers. No font
// lookup or text API participates in drawing the exported HEP geometry.
function renderFixtureScene(scene) {
  const canvas = createCanvas(width * scale, height * scale), context = canvas.getContext("2d");
  context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.setTransform(scale, 0, 0, -scale, 0, height * scale);
  for (const run of scene.drawRuns) {
    if (run.kind === "text") {
      for (let instance = run.first; instance < run.first + run.count; instance++) {
        const offset = instance * 4, a = scene.textInstanceA, b = scene.textInstanceB, c = scene.textInstanceC;
        context.save(); context.transform(a[offset], a[offset + 1], a[offset + 2], a[offset + 3], b[offset], b[offset + 1]);
        context.fillStyle = `rgba(${c[offset] * 255},${c[offset + 1] * 255},${c[offset + 2] * 255},${c[offset + 3]})`;
        const glyph = b[offset + 2] * 4, first = scene.textGlyphMetaA[glyph], end = first + scene.textGlyphMetaA[glyph + 1];
        context.beginPath(); let previousX = NaN, previousY = NaN;
        for (let segment = first; segment < end; segment++) {
          const index = segment * 4, a = scene.textGlyphSegmentsA, b = scene.textGlyphSegmentsB;
          if (a[index] !== previousX || a[index + 1] !== previousY) context.moveTo(a[index], a[index + 1]);
          if (b[index + 2] >= .5) context.quadraticCurveTo(a[index + 2], a[index + 3], b[index], b[index + 1]);
          else context.lineTo(b[index], b[index + 1]);
          previousX = b[index]; previousY = b[index + 1];
        }
        context.fill("nonzero"); context.restore();
      }
    } else if (run.kind === "stroke") {
      for (let segment = run.first; segment < run.first + run.count; segment++) {
        const i = segment * 4, packed = scene.primitiveMeta[i + 3], flags = Math.trunc(packed / 2);
        context.strokeStyle = `rgba(${scene.styles[i + 1] * 255},${scene.styles[i + 2] * 255},${scene.styles[i + 3] * 255},${packed - flags * 2})`;
        context.lineWidth = scene.styles[i] === 0 ? 1 / scale : scene.styles[i] * 2;
        context.lineCap = flags & 2 ? "round" : "butt"; context.setLineDash([]);
        context.beginPath(); context.moveTo(scene.endpoints[i], scene.endpoints[i + 1]);
        if (scene.primitiveMeta[i + 2] >= .5) context.quadraticCurveTo(scene.endpoints[i + 2], scene.endpoints[i + 3], scene.primitiveMeta[i], scene.primitiveMeta[i + 1]);
        else context.lineTo(scene.primitiveMeta[i], scene.primitiveMeta[i + 1]);
        context.stroke();
      }
    } else throw new Error(`Unexpected fixture HEP draw kind ${run.kind}`);
  }
  return canvas;
}
function inkDifference(actual, expected) {
  let difference = 0, ink = 0;
  for (let i = 0; i < actual.length; i += 4) for (let c = 0; c < 3; c++) {
    difference += Math.abs(actual[i + c] - expected[i + c]); ink += 255 - expected[i + c];
  }
  return difference / ink;
}
