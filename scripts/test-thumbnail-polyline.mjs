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
  const { compileDensePdfContent } = await import("../src/pdf/nativeContentCompiler.ts");
  const { createHeprPageDataFromDense } = await import("../src/densePdfPageData.ts");
  const { densePdfPagePathCount, densePdfGenericPathPaintCount, getDensePdfPagePath,
    getDensePdfGenericPathPaint } = await import("../src/pdf/nativeRetainedResources.ts");
  const { validateHeprPageData } = await import("../src/heprDocumentDataValidation.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const pageInfo = { sourcePageIndex: 0, width: 100, height: 100,
    mediaBox: [0, 0, 100, 100], cropBox: [0, 0, 100, 100], bleedBox: null,
    trimBox: null, artBox: null, rotation: 0, userUnit: 1 };
  const defaults = { output: "display-program", pageMatrix: [1, 0, 0, 1, 0, 0],
    pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, compactRetainedResources: true,
    enableSegmentMerge: false, enableInvisibleCull: false, capturePaintSourceIdentities: false };
  const diagnostics = [];
  const nestedSource = "2 J 2 j .05 w q 1 0 0 1 4 6 cm q 0 1 -1 0 100 0 cm " +
    "10 10 m 30 10 l 30 30 l h S Q Q 40 40 m 60 40 l 60 60 l S";
  const canonicalCompiled = await compile(nestedSource, {}, false);
  const canonicalPage = createHeprPageDataFromDense(pageInfo, canonicalCompiled);
  const canonicalPixels = await render(canonicalPage);
  const compact = await compile(nestedSource, { onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  assert.equal(compact.segmentCount, 5, "nested q/Q, rotated and closed thin polylines retain five centerline segments");
  assert.equal(densePdfPagePathCount(compact), 0, "overview polylines avoid retained generic paths");
  assert.equal(densePdfGenericPathPaintCount(compact), 0, "overview polylines avoid generic paint/style records");
  assert.equal(compact.packedRetainedResources.matrices.length, 0, "overview centerlines do not capture per-path CTMs");
  const original = structuredClone(compact), page = createHeprPageDataFromDense(pageInfo, compact, { thumbnail: true });
  validateHeprPageData(page);
  const pixels = await render(page, true);
  for (const [x, y] of [[94, 74], [84, 64], [84, 74], [50, 60], [60, 50]]) {
    assert(pixel(pixels, x, y)[0] < 240, `overview retains the transformed polyline at ${x},${y}`);
  }
  assert.deepEqual(pixel(pixels, 67, 72), [255, 255, 255, 255], "separate contours never acquire a connecting edge");
  assert(ink(pixels) > ink(canonicalPixels) * 5, "one-pixel preview pens strengthen thin overview linework");
  assert.deepEqual(compact, original, "rendering and adaptation never change the compact capture");
  assert.deepEqual(await compile(nestedSource, {}, false), canonicalCompiled, "later full-quality compilation remains exact");
  assert.deepEqual(await render(canonicalPage), canonicalPixels, "canonical output remains identical after an overview");
  assert.equal(diagnostics.filter(diagnostic => diagnostic.code === "thumbnail.stroke-approximation").length, 1,
    "polyline approximation emits one diagnostic per compilation");

  for (const cap of [0, 1, 2]) for (const join of [0, 1, 2]) {
    const result = await compile(`${cap} J ${join} j .05 w 20 20 m 60 20 l 60 60 l S`);
    assert.equal(result.segmentCount, 2);
    assert.equal(densePdfPagePathCount(result), 0);
    for (let offset = 3; offset < result.primitiveMeta.length; offset += 4) {
      assert((Math.trunc(result.primitiveMeta[offset] / 2 + 1e-6) & 2) !== 0,
        "the coarse cap/join policy is represented by explicit round-cap primitives");
    }
    const overview = await render(createHeprPageDataFromDense(pageInfo, result, { thumbnail: true }), true);
    assert(pixel(overview, 60, 80)[0] < 240, "a joint remains covered for every source cap/join style");
  }

  const clipped = await compile("0 0 50 100 re W n 2 J .05 w 10 20 m 90 20 l 90 80 l 10 80 l S");
  assert.equal(clipped.segmentCount, 2, "offscreen polyline edges can be discarded conservatively");
  assert.equal(clipped.clipPaths.length, 1);
  assert([...clipped.paintRunClipIndices].every(index => index === 0), "every compact edge retains its exact clip scope");
  const clippedPixels = await render(createHeprPageDataFromDense(pageInfo, clipped, { thumbnail: true }), true);
  assert(pixel(clippedPixels, 25, 80)[0] < 240);
  assert.deepEqual(pixel(clippedPixels, 75, 80), [255, 255, 255, 255]);
  assert.deepEqual(pixel(clippedPixels, 90, 50), [255, 255, 255, 255]);
  const edge = await compile("0 0 50 100 re W n .05 w -.25 10 m -.25 50 l -.25 90 l S");
  assert.equal(edge.segmentCount, 2, "the cull bounds include the widened pen when a centerline lies outside the clip");
  const edgePixels = await render(createHeprPageDataFromDense(pageInfo, edge, { thumbnail: true }), true);
  assert(pixel(edgePixels, 0, 70)[0] < 255, "widened edge coverage survives conservative culling and exact clipping");
  const ordered = await compile("2 J .05 w 10 50 m 90 50 l 90 80 l S " +
    "1 g 40 40 20 20 re f 0 G 10 52 m 90 52 l 90 80 l S");
  const orderedPage = createHeprPageDataFromDense(pageInfo, ordered, { thumbnail: true });
  assert.deepEqual(orderedPage.displayProgram.groups[0].commands.map(command => command.source),
    ["stroke-segments", "fill-paths", "stroke-segments"], "intervening fills remain a compact stroke ordering barrier");
  const orderedPixels = await render(orderedPage, true);
  assert.deepEqual(pixel(orderedPixels, 50, 50), [255, 255, 255, 255], "the middle fill covers the earlier polyline");
  assert(pixel(orderedPixels, 50, 48)[0] < 240, "the later polyline remains in front of the fill");

  const sourcePath = ".05 w 2 J 10 10 m 60 10 l 60 60 l S";
  for (const [label, source, options] of [
    ["alpha", "/State gs " + sourcePath, { extGStates: [{ resourceName: "State", strokeAlpha: .5 }] }],
    ["soft mask", "/State gs " + sourcePath, { extGStates: [{ resourceName: "State", softMaskIndex: 0 }] }],
    ["overprint", "/State gs " + sourcePath, { extGStates: [{ resourceName: "State", strokeOverprint: true, overprintMode: 1 }] }],
    ["alpha-as-shape", "/State gs " + sourcePath, { extGStates: [{ resourceName: "State", alphaIsShape: true }] }],
    ["blend", "/State gs " + sourcePath, { extGStates: [{ resourceName: "State", blendMode: "Multiply" }] }],
    ["anisotropic", sourcePath, { pageMatrix: [2, 0, 0, 1, 0, 0] }],
    ["sheared", sourcePath, { pageMatrix: [1, .2, 0, 1, 0, 0] }],
    ["dashed", "[3 2] .5 d " + sourcePath, {}],
    ["thick", "2 J 3 w 10 10 m 60 10 l 60 60 l S", {}],
    ["curve", ".05 w 2 J 10 10 m 20 50 40 50 60 10 c 60 60 l S", {}],
    ["nested program", sourcePath, { thumbnailScale: undefined }]
  ]) {
    const reduced = await compile(source, options), exact = await compile(source, options, false);
    assert.equal(reduced.segmentCount, 0, `${label} polylines retain the exact path`);
    assert.equal(densePdfPagePathCount(reduced), 1);
    assert.deepEqual(materialize(reduced), materialize(exact), `${label} fallback preserves complete geometry, style, paint and scopes`);
    if (["anisotropic", "sheared", "dashed", "thick", "curve", "nested program"].includes(label)) {
      assert.deepEqual(await render(createHeprPageDataFromDense(pageInfo, reduced)),
        await render(createHeprPageDataFromDense(pageInfo, exact)), `${label} fallback pixels remain exact`);
    }
  }
  const half = await compile("/Half gs " + sourcePath + " " + sourcePath, {
    extGStates: [{ resourceName: "Half", strokeAlpha: .5 }] });
  const halfPixels = await render(createHeprPageDataFromDense(pageInfo, half, { thumbnail: true }), true,
    { background: [0, 0, 0, 0] });
  assert(Math.abs(pixel(halfPixels, 40, 90)[3] - 112) <= 3,
    "overlapping translucent polylines preserve independent opacity applications in the preview renderer");

  const nestedForm = await sessionPage(".05 w 10 10 m 30 10 l 30 30 l S /Form Do", "/XObject << /Form 5 0 R >>", [
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << >>",
      ".05 w 2 J 50 50 m 70 50 l 70 70 l S") }
  ]);
  assert(nestedForm.displayProgram.groups[0].commands.some(command => command.source === "stroke-segments"),
    "the session enables root-page polyline preparation");
  assert(nestedForm.displayProgram.programs.some(program => program.commands.some(command => command.source === "paths")),
    "nested Forms do not inherit the root thumbnail scale");
  const maskContent = "/Masked gs 2 J .05 w 10 10 m 90 10 l 90 90 l S";
  const maskResources = "/ExtGState << /Masked << /SMask << /S /Alpha /G 5 0 R >> >> >>";
  const maskObjects = [
      { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Group << /S /Transparency /I true >> /Resources << >>",
        "1 G .05 w 2 J 10 10 m 90 10 l 90 90 l S") }
    ];
  const nestedMask = await sessionPage(maskContent, maskResources, maskObjects);
  assert(nestedMask.displayProgram.programs.some(program => program.commands.some(command => command.source === "paths")),
    "soft-mask source geometry remains an exact retained program");
  assert(nestedMask.stores.strokes.endpoints.length === 0, "neither the mask nor its masked consumer uses the overview polyline representation");
  assert.deepEqual(await render(nestedMask), await render(await sessionPage(maskContent, maskResources, maskObjects, false)),
    "the excluded masked PDF retains exact source and consumer pixels through the real session adapter");

  const controller = new AbortController(), reason = new Error("thumbnail replaced");
  await assert.rejects(compile(sourcePath + " " + sourcePath, { signal: controller.signal,
    onDiagnostic() { controller.abort(reason); } }), error => error === reason,
    "cancellation during first polyline preparation cannot return a partial page");
  const alreadyAborted = new AbortController(); alreadyAborted.abort(reason);
  await assert.rejects(compile(sourcePath, { signal: alreadyAborted.signal }), error => error === reason);

  for (const cap of [0, 2]) {
    const emptyContour = `${cap} J .05 w 50 50 m h S`;
    const emptyOverview = await render(createHeprPageDataFromDense(pageInfo, await compile(emptyContour), { thumbnail: true }), true);
    assert.equal(ink(emptyOverview), 0, "a move-and-close contour with no drawable edge never becomes a preview dot");
  }
  console.log("Thumbnail polylines passed: compact stores, transformed/closed contours, one-pixel caps/joins, clips, canonical reuse, exact fallbacks, nested Forms/masks, diagnostics and cancellation.");

  async function compile(source, options = {}, thumbnail = true) {
    return compileDensePdfContent(new TextEncoder().encode(source), { ...defaults,
      thumbnail, thumbnailScale: thumbnail ? 1 : undefined, ...options });
  }
  async function render(page, thumbnail = false, options = {}) {
    const result = await renderHeprPageToCanvas2d(page, { scale: 1, background: [1, 1, 1, 1],
      surfaceFactory(width, height) {
        const canvas = createCanvas(width, height); surfaces.push(canvas);
        return { canvas, context: canvas.getContext("2d") };
      }, ...options }, { thumbnail });
    return { width: result.width, height: result.height,
      rgba: Uint8Array.from(result.surface.context.getImageData(0, 0, result.width, result.height).data) };
  }
  async function sessionPage(content, resources, extraObjects, thumbnail = true) {
    const session = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << ${resources} >> /Contents 4 0 R >>` },
      { number: 4, body: tinyPdfStream("", content) }, ...extraObjects
    ] }) });
    try { return await session.compilePage(0, { optimization: "none",
      ...(thumbnail ? { thumbnailScale: 1, thumbnailOmitMetadata: true } : {}) }); }
    finally { await session.close(); }
  }
  function materialize(compiled) {
    const result = { ...compiled,
      pagePaths: Array.from({ length: densePdfPagePathCount(compiled) }, (_, index) => getDensePdfPagePath(compiled, index)),
      genericPathPaints: Array.from({ length: densePdfGenericPathPaintCount(compiled) }, (_, index) => getDensePdfGenericPathPaint(compiled, index)) };
    delete result.packedRetainedResources;
    return result;
  }
} finally {
  for (const canvas of surfaces) canvas.width = canvas.height = 1;
  hooks.deregister();
}

function pixel(result, x, y) { return [...result.rgba.subarray((y * result.width + x) * 4, (y * result.width + x) * 4 + 4)]; }
function ink(result) {
  let sum = 0;
  for (let index = 0; index < result.rgba.length; index += 4) sum += 255 - result.rgba[index];
  return sum;
}
