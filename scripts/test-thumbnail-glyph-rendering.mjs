import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const surfaces = [];
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const text = "0 g BT /F1 60 Tf 1 0 0 1 10 20 Tm (ABAB) Tj 0 20 Td (ABAB) Tj 0 20 Td (ABAB) Tj ET";
  const page = await compile(text), original = structuredClone(page);
  const reference = await render(page), overview = await render(page, true);
  assert.deepEqual(overview.rgba, reference.rgba, "ordinary and compound filled glyphs keep exact pixels and positions");
  assert(reference.rgba.some((value, index) => index % 4 !== 3 && value < 100), "the fixture renders visible glyph outlines");
  assert.equal(overview.calls.fill, reference.calls.fill, "each glyph retains its individual fill boundary");
  assert(overview.calls.save < reference.calls.save / 2, "compatible glyphs share native clip state");
  assert(overview.calls.fillStyle < reference.calls.fillStyle / 2, "compatible glyphs reuse their resolved solid color");
  assert.deepEqual(page, original, "thumbnail text rendering never rewrites canonical glyph, path or transform stores");
  assert.deepEqual((await render(page)).rgba, reference.rgba, "canonical pixels remain identical after a thumbnail render");

  for (const [label, source, resources, pageOptions] of [
    ["affine placement", "q 1.25 .125 -.25 .75 7 9 cm " + text + " Q", "", {}],
    ["mirrored placement", "q -1 0 0 1 190 0 cm " + text + " Q", "", {}],
    ["crop and rotation", text, "", { pageBoxes: "/CropBox [5 5 195 95] /Rotate 90" }],
    ["curved clip", "5 5 m 5 90 150 90 150 5 c h W n " + text, "", {}],
    ["changing clip", "q 0 0 70 100 re W n " + text + " Q q 90 0 70 100 re W n " + text + " Q", "", {}],
    ["translucent overlap", "/Half gs BT /F1 60 Tf 1 0 0 1 10 20 Tm (A) Tj 1 0 0 1 10 20 Tm (A) Tj ET",
      "/ExtGState << /Half << /ca .5 >> >>", {}],
    ["stroke text", "2 w BT /F1 60 Tf 1 Tr 1 0 0 1 10 20 Tm (ABAB) Tj ET", "", {}],
    ["fill-stroke text", "2 w 1 0 0 rg 0 0 1 RG BT /F1 60 Tf 2 Tr 1 0 0 1 10 20 Tm (ABAB) Tj ET", "", {}],
    ["text clipping", "BT /F1 60 Tf 4 Tr 1 0 0 1 10 20 Tm (ABAB) Tj ET 1 0 0 rg 0 0 200 100 re f", "", {}],
    ["invisible text", "BT /F1 60 Tf 3 Tr 1 0 0 1 10 20 Tm (ABAB) Tj ET", "", {}],
    ["paint ordering", text + " 1 0 0 rg 0 0 200 40 re f 0 0 1 rg BT /F1 60 Tf 1 0 0 1 10 20 Tm (ABAB) Tj ET", "", {}]
  ]) {
    const fixture = await compile(source, resources, pageOptions);
    assert.deepEqual((await render(fixture, true)).rgba, (await render(fixture)).rgba,
      `${label} preserves exact positions, clipping, paint boundaries and fallback pixels`);
  }

  // A glyph source used as an alpha/luminosity mask keeps the reference path,
  // even with nested invocation frames and the optimized output operation.
  const maskPage = await compile("1 g BT /F1 60 Tf 1 0 0 1 10 20 Tm (ABAB) Tj ET 1 0 0 rg 0 0 200 100 re f");
  const root = maskPage.displayProgram.groups[0], [maskGlyphs, contentFill] = root.commands;
  const invoke = groupIndex => ({ kind: "invoke-group", groupIndex, transformIndex: 0,
    clipIndex: -1, optionalContentIndex: -1, markedContentIndex: -1, sourceOffset: -1, sourceLength: -1 });
  for (const subtype of ["Alpha", "Luminosity"]) {
    maskPage.displayProgram.groups = [{ ...root, commands: [invoke(2)] },
      { ...root, commands: [invoke(3)] },
      { ...root, commands: [contentFill], softMaskGroupIndex: 1, softMaskSubtype: subtype },
      { ...root, commands: [maskGlyphs] }];
    assert.deepEqual((await render(maskPage, true)).rgba, (await render(maskPage)).rgba,
      `${subtype} glyph masks retain exact reference coverage through nested groups`);
  }

  const controller = new AbortController(), reason = new Error("text preview replaced");
  let fills = 0, saves = 0, restores = 0;
  await assert.rejects(renderHeprPageToCanvas2d(page, { scale: 1, signal: controller.signal,
    surfaceFactory(width, height) {
      const canvas = createCanvas(width, height), native = canvas.getContext("2d"); surfaces.push(canvas);
      return { canvas, context: new Proxy(native, { get(target, key) {
        const value = Reflect.get(target, key, target);
        if (typeof value !== "function") return value;
        return (...args) => {
          if (key === "save") saves++;
          if (key === "restore") restores++;
          const result = value.apply(target, args);
          if (key === "fill") { fills++; controller.abort(reason); }
          return result;
        };
      }, set(target, key, value) { return Reflect.set(target, key, value, target); } }) };
    } }, { thumbnail: true }), error => error === reason);
  assert.equal(fills, 1, "cancellation stops before painting the next glyph");
  assert.equal(saves, restores, "cancellation releases retained glyph clip state");
  console.log("Thumbnail glyph rendering passed: exact ordinary/compound outlines, transforms/crop/rotation, clip/color reuse, per-glyph alpha/order, stroke/clip/invisible fallbacks, masks, canonical isolation and cancellation.");

  async function compile(content, resources = "", options = {}) {
    const session = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] ${options.pageBoxes ?? ""} /Resources << /Font << /F1 5 0 R >> ${resources} >> /Contents 4 0 R >>` },
      { number: 4, body: tinyPdfStream("", content) },
      { number: 5, body: "<< /Type /Font /Subtype /TrueType /BaseFont /FixtureSans /Encoding /WinAnsiEncoding >>" }
    ] }) }, { missingFontResolver() { return { sfntBytes: buildTinySfnt(), identifier: "thumbnail-glyph-fixture" }; } });
    try { return await session.compilePage(0, { optimization: "none" }); }
    finally { await session.close(); }
  }
  async function render(page, thumbnail = false) {
    const calls = {};
    const result = await renderHeprPageToCanvas2d(page, { scale: 1, background: [1, 1, 1, 1],
      surfaceFactory(width, height) {
        const canvas = createCanvas(width, height), native = canvas.getContext("2d"); surfaces.push(canvas);
        return { canvas, context: new Proxy(native, { get(target, key) {
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? (...args) => { calls[key] = (calls[key] ?? 0) + 1; return value.apply(target, args); } : value;
        }, set(target, key, value) { calls[key] = (calls[key] ?? 0) + 1; return Reflect.set(target, key, value, target); } }) };
      } }, { thumbnail });
    return { calls, rgba: Uint8Array.from(result.surface.context.getImageData(0, 0, result.width, result.height).data) };
  }
} finally {
  for (const canvas of surfaces) canvas.width = canvas.height = 1;
  hooks.deregister();
}
