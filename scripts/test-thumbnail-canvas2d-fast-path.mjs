import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const surfaces = [];
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { ThumbnailCanvasPath } = await import("../src/thumbnailCanvasPath.ts");

  const translated = await compile("0 G 2 J .05 w " + Array.from({ length: 12 }, (_, index) =>
    `q 1 0 0 1 0 ${index * 4} cm 10 10 m 90 10 l S Q`).join(" "));
  const original = structuredClone(translated);
  const reference = await render(translated);
  const preview = await render(translated, true);
  assert(reference.calls.stroke >= 12, "fixture reaches the generic per-object renderer");
  assert.equal(preview.calls.stroke, 1, "translated adjacent opaque lines share one native stroke");
  assert(preview.calls.save < reference.calls.save / 2, "clip/graphics state persists across compatible objects");
  assert(preview.events.filter(event => event[0] === "stroke").every(event => event[1] >= 1), "thumbnail pens are at least one output pixel");
  assert(ink(preview) > ink(reference) * 5, "preview-only width policy strengthens thin linework");
  assert.deepEqual(translated, original, "preview geometry and style changes never mutate canonical stores");
  assert.deepEqual((await render(translated)).rgba, reference.rgba, "canonical rendering remains identical after a preview");
  assert(preview.diagnostics.some(diagnostic => diagnostic.code === "thumbnail.vector-approximation"));

  const clipped = await compile("0 G 2 J .05 w q 10 10 20 80 re W n " +
    "0 20 m 100 20 l S 0 30 m 100 30 l S 0 40 m 100 40 l S Q " +
    "q 60 10 20 80 re W n 0 60 m 100 60 l S 0 70 m 100 70 l S Q");
  const clippedReference = await render(clipped), clippedPreview = await render(clipped, true);
  assert(clippedPreview.calls.clip < clippedReference.calls.clip, "equivalent clip scopes are applied once per compatible span");
  assert.equal(clippedPreview.calls.stroke, 2, "changing clips flushes the pending opaque span");
  assert.deepEqual(pixel(clippedPreview, 50, 80), [255, 255, 255, 255]);
  assert(pixel(clippedPreview, 20, 80)[0] < 255);
  assert.deepEqual(pixel(clippedPreview, 20, 40), [255, 255, 255, 255]);
  assert(pixel(clippedPreview, 70, 40)[0] < 255);

  const order = await compile("0 G 2 J .05 w 10 50 m 90 50 l S 1 g 40 40 20 20 re f " +
    "0 G 10 52 m 90 52 l S");
  const ordered = await render(order, true);
  assert.deepEqual(pixel(ordered, 50, 50), [255, 255, 255, 255], "an opaque fill remains in front of the earlier stroke");
  assert(pixel(ordered, 50, 48)[0] < 255, "the later stroke remains in front of the fill");
  assert.equal(ordered.calls.stroke, 2);

  const half = await compile("/Half gs 0 G 2 J .05 w 10 50 m 90 50 l S 10 50 m 90 50 l S",
    "/ExtGState << /Half << /CA .5 >> >>");
  const translucent = await render(half, true, { background: [0, 0, 0, 0] });
  assert.equal(translucent.calls.stroke, 2, "translucent objects retain individual opacity applications");
  assert(Math.abs(pixel(translucent, 50, 50)[3] - 112) <= 3, "overlapping half-alpha strokes composite twice");

  for (const cap of [0, 2]) {
    const maskPage = await compile(`1 G ${cap} J .05 w 10 50 m 90 50 l S 1 0 0 rg 0 0 100 100 re f`);
    const originalRoot = maskPage.displayProgram.groups[maskPage.displayProgram.rootGroupIndex];
    const [maskStroke, contentFill] = originalRoot.commands;
    const invoke = groupIndex => ({ kind: "invoke-group", groupIndex, transformIndex: 0,
      clipIndex: -1, optionalContentIndex: -1, markedContentIndex: -1, sourceOffset: -1, sourceLength: -1 });
    for (const subtype of ["Alpha", "Luminosity"]) {
      maskPage.displayProgram.groups = [
        { ...originalRoot, commands: [invoke(2)] },
        { ...originalRoot, commands: [invoke(3)] },
        { ...originalRoot, commands: [contentFill], softMaskGroupIndex: 1, softMaskSubtype: subtype },
        { ...originalRoot, commands: [maskStroke] }
      ];
      maskPage.displayProgram.rootGroupIndex = 0;
      const exactMask = await render(maskPage, false, { background: [0, 0, 0, 0] });
      const previewMask = await render(maskPage, true, { background: [0, 0, 0, 0] });
      assert.deepEqual(previewMask.rgba, exactMask.rgba,
        `${subtype} mask strokes keep exact coverage inside nested groups (${cap === 0 ? "dense" : "generic"})`);
      assert(previewMask.events.some(event => event[0] === "stroke" && event[1] < 1),
        "preview pen widening never changes a soft-mask stroke");
    }
  }

  const dashed = await compile("0 G 2 J .05 w [3 2] 1 d 10 50 m 90 50 l S");
  const dashedPreview = await render(dashed, true);
  assert(dashedPreview.events.some(event => event[0] === "dash" && event[1].join(",") === "3,2"),
    "dash lengths and phase retain native fallback semantics");
  assert(dashedPreview.events.filter(event => event[0] === "stroke").every(event => event[1] >= 1),
    "dashed fallback strokes share the thumbnail minimum-width policy");
  const dense = await compile("0 G .05 w 10 50 m 90 50 l S");
  const densePreview = await render(dense, true);
  assert(densePreview.events.filter(event => event[0] === "stroke").every(event => event[1] >= 1),
    "ordinary dense line segments also use a one-pixel pen");
  const denseLines = await compile("0 G .05 w " + Array.from({ length: 12 }, (_, index) =>
    `10 ${10 + index * 4} m 90 ${10 + index * 4} l S`).join(" "));
  const denseOriginal = structuredClone(denseLines), denseBatch = await render(denseLines, true);
  assert(denseLines.displayProgram.groups.some(group => group.commands.some(command => command.source === "stroke-segments")),
    "ordinary butt-cap lines reach compact dense storage");
  assert.equal(denseBatch.calls.stroke, 1, "compatible dense line segments share one native stroke");
  assert.deepEqual(denseLines, denseOriginal, "dense preview batching never rewrites canonical stores");
  const denseHalf = await compile("0 G .05 w 10 50 m 90 50 l S 10 50 m 90 50 l S");
  for (let offset = 3; offset < denseHalf.stores.strokes.primitiveMeta.length; offset += 4) {
    const flags = Math.trunc(denseHalf.stores.strokes.primitiveMeta[offset] / 2 + 1e-6);
    denseHalf.stores.strokes.primitiveMeta[offset] = flags * 2 + .5;
  }
  const denseTranslucent = await render(denseHalf, true, { background: [0, 0, 0, 0] });
  assert.equal(denseTranslucent.calls.stroke, 2, "packed primitive alpha retains distinct dense paint boundaries");
  assert(Math.abs(pixel(denseTranslucent, 50, 50)[3] - 112) <= 3,
    "packed dense half-alpha overlaps composite twice");
  const denseCaps = structuredClone(denseHalf);
  denseCaps.stores.strokes.primitiveMeta[3] = 1;
  denseCaps.stores.strokes.primitiveMeta[7] = 2 * 2 + 1;
  const denseCapPreview = await render(denseCaps, true);
  assert.deepEqual(denseCapPreview.events.filter(event => event[0] === "stroke").map(event => event[3]), ["butt", "round"],
    "a dense cap change flushes the span and preserves both caps");
  const denseAffine = structuredClone(denseLines);
  denseAffine.stores.transforms.values[0] = 2;
  denseAffine.stores.transforms.values[2] = .3;
  for (let offset = 0; offset < denseAffine.stores.strokes.styles.length; offset += 4) denseAffine.stores.strokes.styles[offset] = 2;
  assert.deepEqual((await render(denseAffine, true)).rgba, (await render(denseAffine)).rgba,
    "dense thick affine pens keep the reference path");
  const affine = await compile("0 G 2 J 4 w q 2 0 .3 1 0 0 cm 10 20 m 30 60 l S Q");
  assert.deepEqual((await render(affine, true)).rgba, (await render(affine)).rgba,
    "strongly affine thick pens keep the exact fallback");

  const curves = await compile("0 g 10 10 m 10 90 90 90 90 10 c h f");
  const curveOriginal = structuredClone(curves), curvePreview = await render(curves, true);
  assert.equal(curvePreview.calls.bezierCurveTo ?? 0, 0, "overview curves are flattened in output pixels");
  assert(pixel(curvePreview, 50, 60)[0] < 20);
  assert.deepEqual(pixel(curvePreview, 50, 10), [255, 255, 255, 255]);
  assert.deepEqual(curves, curveOriginal);
  assert((await render(curves)).calls.bezierCurveTo > 0, "ordinary rendering retains native cubic paths");

  // A collinear cubic with control points outside its endpoint segment has
  // visible backtracking/extrema and must not collapse to one straight chord.
  const pathCalls = [];
  const pathBuilder = new ThumbnailCanvasPath({ pathVerbOffsets: Uint32Array.of(0, 2),
    verbs: Uint8Array.of(0, 3), verbCoordinateOffsets: Uint32Array.of(0, 2, 8),
    coordinates: Float32Array.of(0, 0, 50, 0, -50, 0, 1, 0) });
  pathBuilder.append({ moveTo: (...args) => pathCalls.push(["move", ...args]),
    lineTo: (...args) => pathCalls.push(["line", ...args]) }, 0, [1, 0, 0, 1, 0, 0]);
  assert(pathCalls.some(call => call[1] > 1) && pathCalls.some(call => call[1] < 0), "coarse curves retain collinear extrema");

  const malformed = structuredClone(translated);
  malformed.stores.paths.coordinates[0] = NaN;
  await assert.rejects(render(malformed, true), error => error.code === "display.invalid-page",
    "thumbnail mode does not implicitly trust caller-provided pages");
  const reason = new Error("preview replaced"), controller = new AbortController();
  const cancelled = instrumentedFactory(() => controller.abort(reason));
  await assert.rejects(renderHeprPageToCanvas2d(translated, { scale: 1, surfaceFactory: cancelled.factory,
    signal: controller.signal }, { thumbnail: true }), error => error === reason);
  assert.equal(cancelled.calls.stroke ?? 0, 0, "cancellation discards an unpainted batch");
  assert.equal(cancelled.calls.save, cancelled.calls.restore, "cancellation releases retained clip state");
  console.log("Thumbnail Canvas2D fast path: opaque batching, width policy, clip/order barriers, alpha, curve tolerance, immutable canonical data, fallback, validation and cancellation passed.");

  async function compile(content, resources = "") {
    const session = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << ${resources} >> /Contents 4 0 R >>` },
      { number: 4, body: tinyPdfStream("", content) }
    ] }) });
    try { return await session.compilePage(0, { optimization: "none" }); }
    finally { await session.close(); }
  }

  async function render(page, thumbnail = false, options = {}) {
    const tracked = instrumentedFactory(), diagnostics = [];
    const result = await renderHeprPageToCanvas2d(page, { scale: 1, background: [1, 1, 1, 1],
      surfaceFactory: tracked.factory, onDiagnostic: diagnostic => diagnostics.push(diagnostic), ...options }, { thumbnail });
    return { ...result, ...tracked, diagnostics,
      rgba: Uint8Array.from(result.surface.context.getImageData(0, 0, result.width, result.height).data) };
  }
} finally {
  for (const canvas of surfaces) canvas.width = canvas.height = 1;
  hooks.deregister();
}

function instrumentedFactory(abort) {
  const calls = {}, events = [];
  return { calls, events, factory(width, height) {
    const canvas = createCanvas(width, height), native = canvas.getContext("2d");
    surfaces.push(canvas);
    const context = new Proxy(native, { get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      return (...args) => {
        calls[key] = (calls[key] ?? 0) + 1;
        if (key === "stroke") events.push(["stroke", target.lineWidth, target.globalAlpha, target.lineCap]);
        if (key === "setLineDash") events.push(["dash", [...args[0]]]);
        const result = value.apply(target, args);
        if (key === "lineTo") abort?.();
        return result;
      };
    }, set(target, key, value) { return Reflect.set(target, key, value, target); } });
    return { canvas, context };
  } };
}

function pixel(result, x, y) { return [...result.rgba.subarray((y * result.width + x) * 4, (y * result.width + x) * 4 + 4)]; }
function ink(result) {
  let sum = 0;
  for (let index = 0; index < result.rgba.length; index += 4) sum += 255 - result.rgba[index];
  return sum;
}
