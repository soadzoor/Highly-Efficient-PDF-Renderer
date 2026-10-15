import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { createCanvas } from "@napi-rs/canvas";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const surfaces = [];
try {
  const { compileDensePdfContent } = await import("../src/pdf/nativeContentCompiler.ts");
  const { createHeprPageDataFromDense } = await import("../src/densePdfPageData.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { ThumbnailLineCoverage } = await import("../src/thumbnailLineCoverage.ts");
  const pageInfo = { sourcePageIndex: 0, width: 100, height: 100, mediaBox: [0, 0, 100, 100],
    cropBox: [0, 0, 100, 100], bleedBox: null, trimBox: null, artBox: null, rotation: 0, userUnit: 1 };
  const dense = await compile("2 J .05 w " + Array.from({ length: 12 }, (_, index) =>
    `10 ${10 + index * 4} m 90 ${10 + index * 4} l 90 ${12 + index * 4} l S`).join(" "));
  const original = structuredClone(dense), native = await render(dense, false), overview = await render(dense);
  assert(native.calls.lineTo > 20, "the reference overview submits native segments");
  assert.equal(overview.calls.lineTo ?? 0, 0, "eligible compact lines bypass native per-segment submission");
  assert.equal(overview.calls.stroke ?? 0, 0, "one-pixel coverage uses a single rectangle fill");
  assert.equal(overview.calls.fill, 1);
  for (const y of [10, 14, 18, 22]) assert.deepEqual(pixel(overview, 50, 100 - y), [0, 0, 0, 255]);
  assert(overview.diagnostics.some(diagnostic => diagnostic.code === "thumbnail.pixel-stroke-approximation"));
  assert.deepEqual(dense, original, "pixel coverage never mutates canonical geometry or resource stores");
  assert.deepEqual((await render(dense, false)).rgba, native.rgba, "later native overview rendering is unchanged");
  assert.deepEqual((await render(dense, true, {}, false)).rgba, (await render(dense, false, {}, false)).rgba,
    "the pixel option has no effect without thumbnail mode");
  const tightBudget = await render(dense, true, { maxWorkingPixels: 1 });
  assert.deepEqual(tightBudget.rgba, native.rgba, "an explicit scratch budget can retain native stroke rendering without a coverage buffer");
  assert(tightBudget.calls.lineTo > 20);
  const laterGroup = await compile("2 J .05 w 10 10 m 90 10 l 90 30 l S " +
    "/Half gs 1 0 0 rg 40 40 20 20 re f", { extGStates: [{ resourceName: "Half", fillAlpha: .5 }] });
  assert.deepEqual((await render(laterGroup, true, { maxWorkingPixels: 10_000 })).rgba,
    (await render(laterGroup)).rgba, "completed coverage can be evicted before a required group surface exhausts the caller's budget");

  const clipped = await compile("0 0 40 100 re W n 2 J .05 w 10 20 m 90 20 l 90 80 l 10 80 l S");
  const clipPixels = await render(clipped);
  assert(pixel(clipPixels, 25, 80)[0] === 0);
  assert.deepEqual(pixel(clipPixels, 75, 80), [255, 255, 255, 255], "coverage fills retain exact native clipping");
  const curvedClip = await compile("10 10 m 10 90 90 90 90 10 c h W n " +
    "2 J .05 w 0 40 m 100 40 l 100 60 l 0 60 l S");
  const curvedPixels = await render(curvedClip);
  assert(pixel(curvedPixels, 50, 60)[0] === 0);
  assert.deepEqual(pixel(curvedPixels, 5, 60), [255, 255, 255, 255], "curved clips remain native rather than becoming bounding rectangles");
  const nearEdge = await compile("0 0 50 100 re W n 2 J .05 w -.25 10 m -.25 50 l -.25 90 l S");
  assert(pixel(await render(nearEdge), 0, 70)[0] === 0, "the coarse pen retains visible edge pixels from outside centerlines");

  const ordered = await compile("2 J .05 w 10 50 m 90 50 l 90 80 l S " +
    "1 g 40 40 20 20 re f 0 G 10 52 m 90 52 l 90 80 l S " +
    "1 0 0 RG 10 54 m 90 54 l 90 80 l S");
  const orderedPixels = await render(ordered);
  assert.deepEqual(pixel(orderedPixels, 50, 50), [255, 255, 255, 255], "an intervening fill covers earlier pixel strokes");
  assert.deepEqual(pixel(orderedPixels, 50, 48), [0, 0, 0, 255]);
  assert.deepEqual(pixel(orderedPixels, 50, 46), [255, 0, 0, 255], "paint changes preserve source order and color");

  for (const [label, source, options] of [
    ["translucent", "/Half gs 1 J .05 w 10 50 m 90 50 l 90 70 l S 10 50 m 90 50 l 90 70 l S",
      { extGStates: [{ resourceName: "Half", strokeAlpha: .5 }] }],
    ["translucent compact line", "/Half gs 1 J .05 w 10 50 m 90 50 l S",
      { extGStates: [{ resourceName: "Half", strokeAlpha: .5 }] }],
    ["blended compact line", "/Multiply gs 1 J .05 w 10 50 m 90 50 l S",
      { extGStates: [{ resourceName: "Multiply", blendMode: "Multiply" }] }],
    ["overprint compact line", "/Over gs 1 J .05 w 10 50 m 90 50 l S",
      { extGStates: [{ resourceName: "Over", strokeOverprint: true, overprintMode: 1 }] }],
    ["packed primitive alpha", "1 J .05 w 10 50 m 90 50 l S", { primitiveAlpha: .5 }],
    ["thick", "1 J 3 w 10 50 m 90 50 l S", {}],
    ["butt cap", "0 J .05 w 10 50 m 90 50 l S", {}],
    ["dashed", "2 J .05 w [3 2] .5 d 10 50 m 90 50 l 90 70 l S", {}],
    ["affine thick", "1 J 3 w 10 20 m 30 60 l S", { pageMatrix: [2, 0, .3, 1, 0, 0] }],
    ["curve", "2 J .05 w 10 10 m 20 50 40 50 60 10 c S", {}]
  ]) {
    const page = await compile(source, options);
    if (options.primitiveAlpha !== undefined) {
      const values = page.stores.strokes.primitiveMeta;
      for (let offset = 3; offset < values.length; offset += 4) values[offset] = Math.trunc(values[offset] / 2 + 1e-6) * 2 + options.primitiveAlpha;
    }
    const result = await render(page, true, { background: [0, 0, 0, 0] });
    assert.deepEqual(result.rgba, (await render(page, false, { background: [0, 0, 0, 0] })).rgba,
      `${label} retains identical native overview pixels`);
    assert(!result.diagnostics.some(diagnostic => diagnostic.code === "thumbnail.pixel-stroke-approximation"));
  }

  // A round-cap compact stroke can also be a mask source. Those frames retain
  // their reference coverage even when the output operation enables pixels.
  const masked = await compile("1 G 1 J .05 w 10 50 m 90 50 l S 1 0 0 rg 0 0 100 100 re f", { thumbnail: false });
  const root = masked.displayProgram.groups[0], [maskStroke, contentFill] = root.commands;
  const invoke = groupIndex => ({ kind: "invoke-group", groupIndex, transformIndex: 0,
    clipIndex: -1, optionalContentIndex: -1, markedContentIndex: -1, sourceOffset: -1, sourceLength: -1 });
  for (const subtype of ["Alpha", "Luminosity"]) {
    masked.displayProgram.groups = [{ ...root, commands: [invoke(2)] },
      { ...root, commands: [invoke(3)] },
      { ...root, commands: [contentFill], softMaskGroupIndex: 1, softMaskSubtype: subtype },
      { ...root, commands: [maskStroke] }];
    assert.deepEqual((await render(masked)).rgba, (await render(masked, false)).rgba,
      `${subtype} mask frames bypass pixel coverage, including nested groups`);
  }

  const forward = runs([[0, 0, 19, 10]]), reverse = runs([[19, 10, 0, 0]]);
  assert.deepEqual(forward, reverse, "reversing a line retains the same pixel-grid tie decisions");
  const long = runs([[-1e12, 10, 1e12, 10]]);
  assert.deepEqual(long, [[0, 10, 20, 1]], "very distant endpoints clip to the output before pixel stepping");
  assert.deepEqual(runs([[-2, 0, -2, 19]]), [], "fully offscreen lines have no coverage");
  const once = runs([[2, 3, 15, 3]]), duplicates = runs([[2, 3, 15, 3], [15, 3, 2, 3], [2, 3, 15, 3]]);
  assert.deepEqual(once, duplicates, "duplicate compatible edges share one opaque coverage span");
  const reused = new ThumbnailLineCoverage(20, 20), rectangles = [];
  reused.appendLine(2, 3, 15, 3); reused.clear();
  reused.appendRectangles({ rect: (...args) => rectangles.push(args) });
  assert.deepEqual(rectangles, [], "discarding a pending span removes every covered pixel");
  const digest = createHash("sha256"), goldenCoverage = new ThumbnailLineCoverage(300, 400);
  let seed = 0x13579bdf;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
  for (let index = 0; index < 1200; index++) {
    const x = random() * 500 - 100, y = random() * 600 - 100;
    const x1 = index % 4 === 0 ? x : x + (random() - .5) * (index % 3 === 0 ? 2 : 700);
    const y1 = index % 4 === 1 ? y : y + (random() - .5) * (index % 3 === 0 ? 2 : 900);
    digest.update(Uint32Array.of(index));
    goldenCoverage.appendLine(x, y, x1, y1);
    goldenCoverage.appendRectangles({ rect: (...args) => digest.update(Uint32Array.from(args)) });
  }
  assert.equal(digest.digest("hex"), "c6db4b2a51a9f94efebfa846039eaec1bafc445440fcbfcd94cadf455fefa4ef",
    "coverage loop optimizations preserve the established pixel mask for seeded subpixel, axial, diagonal and clipped edges");

  const controller = new AbortController(), reason = new Error("overview replaced");
  let cancelledFill = 0;
  await assert.rejects(renderHeprPageToCanvas2d(dense, { scale: 1, background: [1, 1, 1, 1], signal: controller.signal,
    surfaceFactory(width, height) {
      const canvas = createCanvas(width, height), context = canvas.getContext("2d"); surfaces.push(canvas);
      return { canvas, context: new Proxy(context, { get(target, key) {
        const value = Reflect.get(target, key, target);
        if (key === "rect") return (...args) => { const result = value.apply(target, args); controller.abort(reason); return result; };
        if (key === "fill") return (...args) => { cancelledFill++; return value.apply(target, args); };
        return typeof value === "function" ? value.bind(target) : value;
      }, set(target, key, value) { return Reflect.set(target, key, value, target); } }) };
    } }, { thumbnail: true, thumbnailPixelStrokes: true }), error => error === reason);
  assert.equal(cancelledFill, 0, "cancellation while emitting coverage discards the pending paint");
  console.log("Thumbnail pixel strokes passed: compact submission, coarse opaque coverage, clip/order/color barriers, exact fallbacks and masks, canonical isolation, bounded screen stepping and cancellation.");

  async function compile(source, options = {}) {
    const compiled = await compileDensePdfContent(new TextEncoder().encode(source), { output: "display-program",
      pageMatrix: [1, 0, 0, 1, 0, 0], pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      compactRetainedResources: true, thumbnail: true, thumbnailScale: 1,
      capturePaintSourceIdentities: false, enableInvisibleCull: false, enableSegmentMerge: false, ...options });
    return createHeprPageDataFromDense(pageInfo, compiled, { thumbnail: true });
  }
  async function render(page, pixelStrokes = true, options = {}, thumbnail = true) {
    const calls = {}, diagnostics = [];
    const result = await renderHeprPageToCanvas2d(page, { scale: 1, background: [1, 1, 1, 1], ...options,
      onDiagnostic: diagnostic => diagnostics.push(diagnostic), surfaceFactory(width, height) {
        const canvas = createCanvas(width, height), native = canvas.getContext("2d"); surfaces.push(canvas);
        return { canvas, context: new Proxy(native, { get(target, key) {
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? (...args) => { calls[key] = (calls[key] ?? 0) + 1; return value.apply(target, args); } : value;
        }, set(target, key, value) { return Reflect.set(target, key, value, target); } }) };
      } }, { thumbnail, thumbnailPixelStrokes: pixelStrokes });
    return { width: result.width, height: result.height, calls, diagnostics,
      rgba: Uint8Array.from(result.surface.context.getImageData(0, 0, result.width, result.height).data) };
  }
  function runs(lines) {
    const coverage = new ThumbnailLineCoverage(20, 20), result = [];
    for (const line of lines) coverage.appendLine(...line);
    coverage.appendRectangles({ rect: (...args) => result.push(args) });
    return result;
  }
} finally {
  for (const canvas of surfaces) canvas.width = canvas.height = 1;
  hooks.deregister();
}

function pixel(result, x, y) { return [...result.rgba.subarray((y * result.width + x) * 4, (y * result.width + x) * 4 + 4)]; }
