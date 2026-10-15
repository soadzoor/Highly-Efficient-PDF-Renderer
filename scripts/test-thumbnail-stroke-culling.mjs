import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const surfaces = [];
try {
  const { compileDensePdfContent, DensePdfResourceLimitError } = await import("../src/pdf/nativeContentCompiler.ts");
  const { createHeprPageDataFromDense } = await import("../src/densePdfPageData.ts");
  const { validateHeprPageData } = await import("../src/heprDocumentDataValidation.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const encoder = new TextEncoder();
  const pen = "2 J 0 j .05 w ";
  const dot = (x = 20.2, y = 30.2) => `${x} ${y} m ${x + .1} ${y + .1} l S `;
  const dots = (count = 12, x = 20.2, y = 30.2) => Array.from({ length: count }, (_, index) =>
    dot(x + index * .005, y + index * .005)).join("");
  const basics = [
    ["independent paths", pen + dots()],
    ["complete q scopes", Array.from({ length: 12 }, (_, index) =>
      `q 1 0 0 1 20 30 cm .05 w 0 j 2 J ${.2 + index * .005} .2 m .35 .35 l S Q `).join("")],
    ["polyline", pen + "20.2 30.2 m " + Array.from({ length: 12 }, (_, index) =>
      `${20.25 + index * .005} ${30.25 + index * .005} l `).join("") + "S"],
    ["point strokes", "1 J .05 w " + "20.2 30.2 m 20.2 30.2 l S ".repeat(12)]
  ];
  for (const [label, source] of basics) {
    const { baseline, reduced } = await parity(label, source);
    assert.equal(reduced.segmentCount, 1, `${label}: one same-cell mark remains`);
    assert(baseline.segmentCount >= 12);
    assert.deepEqual([...reduced.endpoints.slice(0, 4)], [...baseline.endpoints.slice(0, 4)],
      "the first source primitive remains unchanged");
    assert.deepEqual([...reduced.primitiveMeta.slice(0, 4)], [...baseline.primitiveMeta.slice(0, 4)]);
  }

  const mixed = await parity("same-cell marks and longer lines", pen + dots() +
    "10 60 m 90 60 l S 10 60 m 90 60 l S " + dots(6, 70.2, 20.2));
  assert.equal(mixed.reduced.segmentCount, 3, "both repeated dots and identical endpoint-cell pairs shrink");

  for (const [label, lines] of [
    ["reversed horizontal pair", "10.2 60.2 m 90.2 60.2 l S 90.2 60.2 m 10.2 60.2 l S"],
    ["reversed diagonal ties", "10.2 20.2 m 12.2 21.2 l S 12.2 21.2 m 10.2 20.2 l S"],
    ["opposite diagonal ties", "10.2 21.2 m 12.2 20.2 l S 12.2 20.2 m 10.2 21.2 l S"],
    ["same cells with different source direction", "10.8 20.2 m 10.2 22.8 l S 10.2 20.8 m 10.8 22.2 l S"]
  ]) {
    const pair = await parity(label, pen + lines);
    assert.equal(pair.reduced.segmentCount, 1, `${label}: binary coverage is independent of source direction`);
  }

  for (const [label, source] of [
    ["intervening fill", pen + dots(4) + "1 g 19 29 3 3 re f " + dots(4)],
    ["paint colors", pen + dots(4) + "1 0 0 RG " + dots(4) + "0 G " + dots(4)],
    ["clip restoration", pen + "q 20.5 0 79.5 100 re W n " + dots(4) + "Q " + dots(4)],
    ["curved clip", "10 10 m 10 90 90 90 90 10 c h W n " + pen + dots(6, 49.2, 30.2)],
    ["nested q with styles", "q 1 0 0 1 2 3 cm " + pen + dots(4) +
      "q 1 0 0 RG " + dots(4) + "Q " + dots(4) + "Q " + pen + dots(4)],
    ["offscreen pen at page edge", pen + dots(6, -.25, 30.2)],
    ["top and bottom edge", pen + dots(4, 20.2, -.25) + dots(4, 30.2, 99.9)],
    ["separate marked-content scopes", pen + "/Span BMC " + dots(4) + "EMC /Span BMC " + dots(4) + "EMC"],
    ["Float32 changes X cell", pen + dot(20.2, 30.2) +
      "20.9999997 30.2 m 20.9999999 30.3 l S 20.9999997 30.2 m 20.9999999 30.3 l S"],
    ["Float32 changes flipped Y cell", pen + dot(50.2, 11.2) +
      "50.2 11.0000001 m 50.3 11.0000002 l S 50.2 11.0000001 m 50.3 11.0000002 l S"]
  ]) {
    const pair = await parity(label, source);
    if (["intervening fill", "clip restoration", "separate marked-content scopes"].includes(label)) {
      assert.equal(pair.reduced.segmentCount, 2, `${label}: each distinct paint/clip/scope span retains its own coverage`);
    }
    if (label === "paint colors") assert.equal(pair.reduced.segmentCount, 3, "each source color span keeps one mark");
  }

  const rounded = await parity("rounded non-square output", pen + dots(12, 20.2, 30.2), {
    pageWidth: 201, pageHeight: 103, pixelSize: { width: 400, height: 205 }
  });
  assert(rounded.reduced.segmentCount < rounded.baseline.segmentCount);
  const roundedWide = await parity("rounded output widens an otherwise one-pixel pen", "1 J .5025 w " + dots(4), {
    pageWidth: 201, pageHeight: 103, pixelSize: { width: 400, height: 205 }, thumbnailScale: 400 / 201
  });
  assert.equal(roundedWide.reduced.segmentCount, roundedWide.baseline.segmentCount,
    "actual rounded output scale excludes pens wider than one pixel from binary culling");
  await parity("rotated source CTM", pen + dots(), { pageMatrix: [0, 1, -1, 0, 100, 0] });

  const layers = { retainOptionalContent: true,
    markedContentProperties: new Map([["First", { resourceName: "First", optionalContentIndex: 0, defaultVisible: true, mcid: -1 }],
      ["Second", { resourceName: "Second", optionalContentIndex: 1, defaultVisible: true, mcid: -1 }]]) };
  const layerPair = await parity("layer boundaries", pen + "/OC /First BDC " + dots(4) +
    "EMC /OC /Second BDC " + dots(4) + "EMC", layers);
  assert.equal(layerPair.reduced.segmentCount, 2, "different layer spans retain their own first point");
  assert.deepEqual([...layerPair.reduced.paintRunOptionalContentIndices], [0, 1]);

  for (const [label, state] of [
    ["translucent", { strokeAlpha: .5 }],
    ["blended", { blendMode: "Multiply" }],
    ["overprint", { strokeOverprint: true, overprintMode: 1 }],
    ["alpha-as-shape", { alphaIsShape: true }]
  ]) {
    const { baseline, reduced } = await parity(label, "/State gs " + pen + dots(3), {
      extGStates: [{ resourceName: "State", ...state }]
    });
    assert.equal(reduced.segmentCount, baseline.segmentCount, `${label} strokes are never removed`);
    assert.deepEqual(reduced.endpoints, baseline.endpoints);
    assert.deepEqual(reduced.primitiveMeta, baseline.primitiveMeta);
  }
  for (const [label, source, options] of [
    ["soft mask", "/Mask gs " + pen + dots(3), { extGStates: [{ resourceName: "Mask", softMaskIndex: 0 }] }],
    ["butt caps", "0 J .05 w " + dots(3), {}],
    ["thick pen", "1 J 3 w " + dots(3), {}],
    ["dashed", "1 J .05 w [1 2] 0 d " + dots(3), {}],
    ["nested program", pen + dots(3), { thumbnailScale: undefined }],
    ["provenance", pen + dots(3), { capturePaintSourceIdentities: true }]
  ]) {
    const baseline = await compile(source, false, options), reduced = await compile(source, true, options);
    assert.deepEqual(reduced, baseline, `${label} retains the full compiled representation`);
  }
  const canonical = await compile(pen + dots(), false, { thumbnail: false, thumbnailScale: undefined });
  assert.deepEqual(await compile(pen + dots(), true, { thumbnail: false, thumbnailScale: undefined }), canonical,
    "supplying a preview grid never changes canonical compilation");

  for (const culling of [false, true]) {
    await assert.rejects(compile(pen + dots(), culling, { maxPathCoordinates: 3 }), DensePdfResourceLimitError,
      "deduplication does not bypass source path limits");
    const controller = new AbortController(), reason = Error("thumbnail replaced");
    await assert.rejects(compile(pen + dots(), culling, { signal: controller.signal,
      onDiagnostic() { controller.abort(reason); } }), error => error === reason,
      "diagnostic cancellation cannot return a partially reduced page");
    const before = new AbortController(); before.abort(reason);
    await assert.rejects(compile(pen + dots(), culling, { signal: before.signal }), error => error === reason);
  }
  console.log("Thumbnail same-cell stroke culling passed: fewer primitives, logical counts, pixel parity, source order, colors, clips, layers, Float32/output rounding, exclusions, limits and cancellation.");

  async function compile(source, culling, options = {}) {
    const { pageWidth = 100, pageHeight = 100, pixelSize = { width: 100, height: 100 }, ...overrides } = options;
    return compileDensePdfContent(encoder.encode(source), { output: "display-program",
      pageMatrix: [1, 0, 0, 1, 0, 0], pageBounds: { minX: 0, minY: 0, maxX: pageWidth, maxY: pageHeight },
      compactRetainedResources: true, thumbnail: true,
      thumbnailScale: Math.min(pixelSize.width / pageWidth, pixelSize.height / pageHeight),
      thumbnailPixelSize: culling ? pixelSize : undefined,
      textOperatorSink: { externalGraphicsState: { save() {}, restore() {} }, applyOperator() { return []; } },
      capturePaintSourceIdentities: false, enableInvisibleCull: false, enableSegmentMerge: false, ...overrides });
  }
  async function parity(label, source, options = {}) {
    const baseline = await compile(source, false, options), reduced = await compile(source, true, options);
    assert.equal(reduced.sourceSegmentCount, baseline.sourceSegmentCount, `${label}: logical source segment count remains accurate`);
    assert.equal(reduced.pathCount, baseline.pathCount, `${label}: logical path count remains accurate`);
    assert.equal(reduced.operatorCount, baseline.operatorCount, `${label}: source operator count remains accurate`);
    assert.deepEqual(await render(reduced, options), await render(baseline, options), `${label}: overview pixels are identical`);
    return { baseline, reduced };
  }
  async function render(compiled, options = {}) {
    const { pageWidth = 100, pageHeight = 100, pixelSize = { width: 100, height: 100 } } = options;
    const pageInfo = { sourcePageIndex: 0, width: pageWidth, height: pageHeight,
      mediaBox: [0, 0, pageWidth, pageHeight], cropBox: [0, 0, pageWidth, pageHeight],
      bleedBox: null, trimBox: null, artBox: null, rotation: 0, userUnit: 1 };
    const page = createHeprPageDataFromDense(pageInfo, compiled, { thumbnail: true,
      retainOptionalContent: options.retainOptionalContent,
      optionalContent: { names: ["First", "Second"], defaultVisible: Uint8Array.of(1, 1) } });
    validateHeprPageData(page);
    const result = await renderHeprPageToCanvas2d(page, {
      scale: Math.min(pixelSize.width / pageWidth, pixelSize.height / pageHeight), background: [0, 0, 0, 0],
      surfaceFactory(width, height) {
        const canvas = createCanvas(width, height); surfaces.push(canvas);
        return { canvas, context: canvas.getContext("2d") };
      }
    }, { thumbnail: true, thumbnailPixelStrokes: true, outputSize: pixelSize });
    return Uint8Array.from(result.surface.context.getImageData(0, 0, result.width, result.height).data);
  }
} finally {
  for (const canvas of surfaces) canvas.width = canvas.height = 1;
  hooks.deregister();
}
