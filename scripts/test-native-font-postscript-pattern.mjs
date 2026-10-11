import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { buildType1Fixture, type1CharString as cs } from "./lib/type1Fixture.mjs";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const encoder = new TextEncoder(), identity = [1, 0, 0, 1, 0, 0];
const prototype = paintType => `<< /PatternType 1 /PaintType ${paintType} /TilingType 1
  /BBox [0 0 100 100] /XStep 100 /YStep 100 /PaintProc {pop ${paintType === 1 ? "1 0 0 setrgbcolor" : ""}
    0 0 50 100 rectfill ${paintType === 1 ? "0 0 1 setrgbcolor 25 25 50 50 rectfill" : ""}} >>`;
const shading = `/S << /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 900 1800 900]
    /BBox [0 900 1800 970] /Function << /FunctionType 2 /Domain [0 1] /C0 [0 0 1] /C1 [1 0 0] /N 1 >> /Extend [true true] >> def
  /SP << /PatternType 2 /Shading S >> matrix makepattern def`;
const definitions = `/P ${prototype(1)} matrix makepattern def /U ${prototype(2)} matrix makepattern def ${shading}`;
const marks = `gsave P setpattern 0 0 600 500 rectfill grestore
  gsave /DeviceRGB setcolorspace .2 .6 .9 U setpattern 650 0 600 500 rectfill grestore
  gsave P setpattern 40 setlinewidth newpath 1300 25 moveto 1800 475 lineto stroke grestore
  gsave SP setpattern 0 900 1800 70 rectfill grestore`;
try {
  const { executeNativeFontPostScript: execute } = await import("../src/pdf/nativeFontPostScript.ts");
  const { NativeFontPostScriptGlyphContext: Context } = await import("../src/pdf/nativeFontPostScriptGraphics.ts");
  const run = (code, options = {}) => {
    const context = new Context();
    const result = execute(encoder.encode(code), undefined, { initialDictionary: new Map([["FontType", 1]]),
      glyphContext: context, initialMatrix: identity, ...options });
    return { context, result };
  };
  const code = `${definitions}
    /local P gcheck not def /readOnly P wcheck not def /shared P /BBox get def
    [/Pattern /DeviceRGB] setcolorspace /initial [currentcolor] def
    P setcolor /colored [currentcolor] def /same colored 0 get P eq def
    .2 .3 .4 U setcolor /uncolored [currentcolor] def
    gsave P setcolor grestore /restored [currentcolor] def
    /sameRestored restored 3 get U eq def
    0 0 moveto 30 40 lineto /before [currentpoint] def
    2 3 scale P setcolor /after [currentpoint] def stroke
  `;
  const { context, result } = run(code);
  for (const key of ["local", "readOnly", "same", "sameRestored"]) assert.equal(result.dictionary.get(key), true, key);
  assert.deepEqual(result.dictionary.get("initial"), [null]);
  assert.deepEqual(result.dictionary.get("uncolored").slice(0, 3), [.2, .3, .4]);
  assert.equal(result.dictionary.get("after")[0], 15);
  assert(Math.abs(result.dictionary.get("after")[1] - 40 / 3) < 1e-12);
  assert.equal(context.paintRecords.length, 1);
  assert.deepEqual(context.paintRecords[0].pattern.matrix, identity, "later CTM changes cannot move the pattern grid");
  assert.equal(context.paintRecords[0].pattern.paints.length, 2, "one reusable vector cell, independent of painted area");
  assert.equal(context.paintRecords[0].kind, "stroke");
  const shade = run(`${shading} .5 setgray 10 20 moveto S shfill /point [currentpoint] def /gray currentgray def`);
  assert.deepEqual(shade.result.dictionary.get("point"), [10, 20], "shfill preserves the current path");
  assert.equal(shade.result.dictionary.get("gray"), .5, "shfill preserves the current color");
  assert("shading" in shade.context.paintRecords[0].pattern);
  const sampled = run(`<< /ShadingType 2 /ColorSpace /DeviceGray /Coords [0 0 100 0] /BBox [0 0 100 100]
    /Function << /FunctionType 0 /Domain [0 1] /Range [0 1] /Size [2] /BitsPerSample 8
      /DataSource <00FF> >> >> shfill`).context.paintRecords[0].pattern.shading;
  assert.equal(sampled.get("Function").kind, "stream");
  assert.deepEqual([...sampled.get("Function").bytes], [0, 255], "sampled functions retain their original samples");
  const stitched = run(`<< /ShadingType 2 /ColorSpace /DeviceGray /Coords [0 0 100 0] /BBox [0 0 100 100]
    /Function << /FunctionType 3 /Domain [0 1] /Bounds [] /Encode [0 1]
      /Functions [<< /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 2 >>] >> >> shfill`)
    .context.paintRecords[0].pattern.shading;
  assert.equal(stitched.get("Function").get("Functions")[0].get("N"), 2);
  const mesh = run(`<< /ShadingType 4 /ColorSpace /DeviceRGB /BitsPerCoordinate 8 /BitsPerComponent 8 /BitsPerFlag 8
    /Decode [0 100 0 100 0 1 0 1 0 1] /BBox [0 0 100 100] /DataSource <000000FF0000 00FF0000FF00 0000FF0000FF> >> shfill`)
    .context.paintRecords[0].pattern.shading;
  assert.equal(mesh.kind, "stream", "encoded meshes retain their data and standard shading dictionary");
  assert.equal(mesh.bytes.length, 18);
  for (const [code, error] of [
    [`${prototype(2).replace("pop", "pop 1 setgray")} matrix makepattern pop`, "undefined"],
    [`${definitions} /Pattern setcolorspace 1 U setcolor`, "rangecheck"],
    [`${definitions} P 1 dict copy matrix makepattern pop`, "rangecheck"],
    [`${prototype(1).replace("/XStep 100", "/XStep 0")} matrix makepattern pop`, "rangecheck"],
    [`${shading} S /Function {dup} put S shfill`, "typecheck"],
    [`${prototype(1)} [0 0 0 0 0 0] makepattern pop`, "undefinedresult"]
  ]) {
    const { result } = run(`{ ${code} } stopped pop /caught $error /errorname get def clear`);
    assert.equal(result.dictionary.get("caught")?.value, error, code);
  }
  assert.throws(() => run(`${prototype(1).replace("pop", "pop {} loop")} matrix makepattern pop`, { maxOperations: 500 }),
    error => error.code === "resource-limit", "PaintProc respects the owning VM's configured budget");
  const oracle = spawnSync("gs", ["--version"], { encoding: "utf8" });
  if (oracle.status === 0) {
    const expected = spawnSync("gs", ["-q", "-dNODISPLAY", "-dBATCH", "-dNOPAUSE", "-c", `${code}
      local == readOnly == same == sameRestored == initial == uncolored 0 3 getinterval == after ==`], { encoding: "utf8" });
    assert.equal(expected.status, 0, expected.stdout + expected.stderr);
    assert.match(expected.stdout, /true\ntrue\ntrue\ntrue\n\[null\]\n\[0.2 0.3 0.4\]\n\[15.0 13\.3333[3]*\]/);
  }

  // Patterns instantiated during font loading survive the per-glyph VM clone.
  const font = buildType1Fixture({ privateExtra: `${definitions} /OtherSubrs [{} {} {} {} {${marks} P setpattern}] def`,
    glyphs: [[".notdef", cs(0, 2000, "hsbw", "endchar")], ["A", cs(0, 2000, "hsbw", 0, 600, "rmoveto",
      1800, 0, "rlineto", 0, 250, "rlineto", -1800, 0, "rlineto", "closepath", 0, 4, "callothersubr", "endchar")]] });
  const pdf = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 220 120] /Resources << /Font << /F 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "BT /F 100 Tf 20 20 Td (A) Tj ET") },
    { number: 5, body: "<< /Type /Font /Subtype /Type1 /BaseFont /FixtureType1 /FirstChar 65 /LastChar 65 /Widths [2000] /Encoding << /Differences [65 /A] >> /FontDescriptor 6 0 R >>" },
    { number: 6, body: "<< /Type /FontDescriptor /FontName /FixtureType1 /Flags 4 /FontBBox [0 0 2000 1000] /ItalicAngle 0 /Ascent 1000 /Descent 0 /CapHeight 1000 /StemV 10 /FontFile 7 0 R >>" },
    { number: 7, body: tinyPdfStream(`/Length1 ${font.length1} /Length2 ${font.length2}`, font.bytes) }
  ] });
  const { openPdf } = await import("../src/pdfSession.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const { lowerRetainedPageToVectorScene } = await import("../src/retainedVectorPage.ts");
  const session = await openPdf({ kind: "bytes", bytes: pdf });
  let page;
  try {
    page = await session.compilePage(0, { optimization: "none" });
    assert(!session.getDiagnostics().some(d => /font.*(?:substitut|unsupported|approximat)/.test(d.code)), JSON.stringify(session.getDiagnostics()));
  } finally { await session.close(); }
  assert(page.stores.patterns.kinds.length >= 2, "colored and uncolored cells enter the retained pattern store");
  const rendered = await renderHeprPageToCanvas2d(page, { scale: 3, background: [1, 1, 1, 1],
    surfaceFactory: (w, h) => { const canvas = createCanvas(w, h); return { canvas, context: canvas.getContext("2d") }; } });
  const pixel = (x, y) => [...rendered.surface.context.getImageData(x * 3, (120 - y) * 3, 1, 1).data];
  assert.deepEqual(pixel(21, 21), [255, 0, 0, 255]);
  assert.deepEqual(pixel(26, 21), [255, 255, 255, 255], "gaps between cells remain transparent");
  assert.deepEqual(pixel(24, 24), [0, 0, 255, 255], "cell-internal paint order is preserved");
  assert(pixel(91, 21).every((value, index) => Math.abs(value - [51, 153, 230, 255][index]) <= 1),
    "uncolored patterns use their invocation tint on the locked grid");
  assert.deepEqual(pixel(21, 81), [255, 0, 0, 255], "the implicit charstring fill also retains the selected pattern");
  const gradient = pixel(110, 113);
  assert(Math.abs(gradient[0] - 128) < 3 && gradient[1] === 0 && Math.abs(gradient[2] - 128) < 3,
    "function-backed shading patterns retain the gradient");
  const lowered = await lowerRetainedPageToVectorScene(page, { signal: new AbortController().signal });
  const blob = await buildHep(pdf, { compression: "deflate", withVectorLod: true, withTextLod: true });
  const hep = new Uint8Array(await blob.arrayBuffer()), loaded = await loadSceneFromHep(hep);
  assert.equal(loaded.rasterLayers.length, 0, "vector patterns do not become bitmap glyphs");
  assert.equal(loaded.fillPathCount, lowered.fillPathCount);
  assert(loaded.fillPathCount > 100, "all required pattern repetitions survive HEP lowering");
  if (oracle.status === 0) {
    const directory = await mkdtemp(join(tmpdir(), "hep-font-pattern-")), filename = join(directory, "reference.png");
    await writeFile(join(directory, "font.pdf"), pdf); await writeFile(join(directory, "font.hep"), hep);
    await writeFile(join(directory, "native.png"), rendered.surface.canvas.toBuffer("image/png"));
    const source = `<< /PageSize [220 120] >> setpagedevice 20 20 translate .1 .1 scale ${definitions} ${marks}
      P setpattern 0 600 1800 250 rectfill showpage`;
    const gs = spawnSync("gs", ["-q", "-dBATCH", "-dNOPAUSE", "-sDEVICE=png16m", "-r216", `-sOutputFile=${filename}`, "-c", source], { encoding: "utf8" });
    assert.equal(gs.status, 0, gs.stdout + gs.stderr);
    const canvas = createCanvas(660, 360), ctx = canvas.getContext("2d"); ctx.drawImage(await loadImage(await readFile(filename)), 0, 0);
    const a = rendered.surface.context.getImageData(0, 0, 660, 360).data, b = ctx.getImageData(0, 0, 660, 360).data;
    let difference = 0;
    for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) difference += Math.abs(a[i + c] - b[i + c]);
    assert(difference / (660 * 360 * 3 * 255) < .02, "native vector tiling agrees with independently executed PostScript");
    console.log(`Pattern visual evidence: ${directory}`);
  }
  console.log(`PostScript patterns passed: reusable colored/uncolored cells, locked transforms, stroke/final paint, VM cloning, GS contracts and vector HEP (${hep.length} bytes).`);
} finally { hooks.deregister(); }
