import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
} });
const identity = [1, 0, 0, 1, 0, 0];
const move = (x, y) => ({ kind: "move", x, y });
const line = (x, y) => ({ kind: "line", x, y });
const close = { kind: "close" };
const square = [move(20, 20), line(80, 20), line(80, 80), line(20, 80), close];

try {
  const { paintNativeGlyphCommands } = await import("../src/pdf/nativeGlyphPaint.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");
  const fill = paintNativeGlyphCommands(square, 0, 100);
  assert.deepEqual(fill.commands, square);
  assert.equal(fill.hairline, false);
  const painted = paintNativeGlyphCommands(square, 2, 4);
  assert.deepEqual(painted.bounds, [18, 18, 82, 82]);
  assert.equal(painted.hairline, false);
  assert.deepEqual(paintNativeGlyphCommands(square, 2, -4), painted,
    "negative PostScript StrokeWidth uses its absolute magnitude");
  assert.ok(Object.isFrozen(painted.commands));
  assert.ok(painted.commands.every(Object.isFrozen));
  const hairline = paintNativeGlyphCommands([move(20, 20), line(80, 80)], 2, 0);
  assert.equal(hairline.hairline, true, "device hairlines must never be silently converted into filled contours");
  assert.deepEqual(hairline.commands, [move(20, 20), line(80, 80)]);

  const curve = [move(20, 60), { kind: "cubic", control1X: 15, control1Y: 10,
    control2X: 70, control2Y: 15, x: 80, y: 60 }, line(70, 80), close];
  const examples = [
    ["closed hollow rectangle", square, 4, {}],
    ["round joins", square, 8, { lineJoin: 1 }],
    ["open butt caps", [move(20, 20), line(80, 20), line(80, 80)], 8, {}],
    ["open round caps", [move(20, 20), line(80, 20), line(80, 80)], 8, { lineCap: 1, lineJoin: 1 }],
    ["dashed glyph", square, 4, { dashArray: [7, 4], dashPhase: 2, lineCap: 1 }],
    ["curve", curve, 4, {}],
    ["FontMatrix transformed pen", curve, 4, { transform: [0.8, 0.15, 0.3, 0.9, 8, 3] }],
    ["reflected anisotropic pen", square, 4, { transform: [-0.7, 0.2, 0.25, 0.8, 82, 2] }]
  ];
  for (const [name, commands, width, options] of examples) {
    const result = paintNativeGlyphCommands(commands, 2, width, options);
    const expected = render(context => {
      context.transform(...(options.transform ?? identity));
      path(context, commands);
      context.lineWidth = width;
      context.lineCap = ["butt", "round", "square"][options.lineCap ?? 0];
      context.lineJoin = ["miter", "round", "bevel"][options.lineJoin ?? 0];
      context.miterLimit = options.miterLimit ?? 10;
      context.setLineDash(options.dashArray ?? []);
      context.lineDashOffset = options.dashPhase ?? 0;
      context.stroke();
    });
    const actual = render(context => { path(context, result.commands); context.fill("nonzero"); });
    let error = 0, ink = 0;
    for (let offset = 3; offset < actual.length; offset += 4) {
      error += Math.abs(actual[offset] - expected[offset]);
      ink += expected[offset];
      assert.ok(actual[offset] <= 128, `${name}: overlapping stroke pieces paint alpha once`);
    }
    assert.ok(error / ink < 0.025, `${name}: independent canvas stroke mismatch ${error / ink}`);
  }
  for (const operation of [
    () => paintNativeGlyphCommands(square, 1, 4),
    () => paintNativeGlyphCommands(square, 2, NaN),
    () => paintNativeGlyphCommands(square, 2, 4, { transform: [1, 0, 0, 0, 0, 0] })
  ]) assert.throws(operation, error => error instanceof PdfError && error.code === "unsupported-font",
    "unsupported font paint remains eligible for the diagnosed font substitute");
  assert.throws(() => paintNativeGlyphCommands(square, 2, 4, { maxPathCommands: 2 }),
    error => error instanceof PdfError && error.code === "resource-limit");
  const abort = new AbortController(); abort.abort();
  assert.throws(() => paintNativeGlyphCommands(square, 2, 4, { signal: abort.signal }),
    error => error instanceof PdfError && error.code === "aborted");
  await testVectorFontPaint(paintNativeGlyphCommands);
  console.log("Native glyph paint tests passed: original contours, stroked silhouettes, transforms, dashes, hairlines and limits.");
} finally { hooks.deregister(); }

function path(context, commands) {
  context.beginPath();
  for (const command of commands) {
    if (command.kind === "move") context.moveTo(command.x, command.y);
    else if (command.kind === "line") context.lineTo(command.x, command.y);
    else if (command.kind === "cubic") context.bezierCurveTo(command.control1X, command.control1Y,
      command.control2X, command.control2Y, command.x, command.y);
    else context.closePath();
  }
}

function render(paint) {
  const canvas = createCanvas(600, 600), context = canvas.getContext("2d");
  context.scale(6, 6);
  context.fillStyle = context.strokeStyle = "rgba(0,0,0,0.5)";
  paint(context);
  return context.getImageData(0, 0, 600, 600).data;
}

async function testVectorFontPaint(paintNativeGlyphCommands) {
  const { NativeTextCompiler } = await import("../src/pdf/nativeText.ts");
  const { compileVectorFormContent } = await import("../src/pdf/nativeContentCompiler.ts");
  const { buildNativeVectorPage } = await import("../src/pdf/nativeVectorPage.ts");
  const matrix = [0.8, 0.15, 0.3, 0.9, 8, 3];
  const makeFont = width => ({
    subtype: "Type1", baseFont: "OriginalStrokedFixture", writingMode: 0, unitsPerEm: 1000,
    descriptor: { ascent: 100, descent: 0, fontBBox: [0, 0, 100, 100] },
    decode(bytes, offset) { return { code: bytes[offset], cid: bytes[offset], glyphId: 1,
      codeByteLength: 1, width: 100, unicode: "A" }; },
    getGlyphOutline(glyphId) {
      const paint = paintNativeGlyphCommands(square, 2, width, { transform: matrix });
      return { glyphId, commands: paint.commands, bounds: paint.bounds ?? [30, 24, 96, 87],
        advanceWidth: 100, leftSideBearing: 0,
        intrinsicStroke: { width, transform: matrix, commands: square } };
    }
  });
  const bounds = { minX: 0, minY: 0, maxX: 300, maxY: 300 };
  async function compile(source, width, options = {}) {
    const font = makeFont(width), resources = [{ font, fontIndex: 0 }];
    const runs = [];
    const text = new NativeTextCompiler({ fonts: new Map([["F1", resources[0]]]), onRun: run => runs.push(run) });
    const compiled = await compileVectorFormContent(new TextEncoder().encode(source), {
      pageMatrix: identity, pageBounds: bounds, ...options,
      textOperatorSink: { applyOperator(operator, operands) {
        runs.length = 0;
        text.applyOperator(operator, operands);
        return runs.slice();
      } }
    });
    const diagnostics = [];
    return { compiled, diagnostics, scene: buildNativeVectorPage({ compiled, textCompilation: text.build(),
      fontResources: resources, imageRegistry: { size: 0 }, pageBounds: bounds,
      pageInfo: { sourcePageIndex: 0, width: 300, height: 300 }, maxPaths: Number.MAX_SAFE_INTEGER,
      maxPathCoordinates: options.maxPathCoordinates,
      onDiagnostic: diagnostic => diagnostics.push(diagnostic) }) };
  }
  const { compiled, scene, diagnostics } = await compile([
    "0.2 0.4 0.6 rg 0.7 0.1 0.2 RG 6 w BT /F1 1000 Tf",
    "0 Tr 1 0 0 1 0 0 Tm (A) Tj",
    "1 J 1 j [7 4] 2 d 1 0 0 1 110 0 Tm (A) Tj",
    "0 J 0 j [] 0 d 1 Tr 1 0 0 1 0 110 Tm (A) Tj",
    "2 Tr 1 0 0 1 110 110 Tm (A) Tj ET"
  ].join("\n"), 4);
  assert.deepEqual(compiled.vectorSceneData.glyphFontPaints.map(paint => paint?.lineJoin ?? null), [0, 1, null, null]);
  assert.deepEqual(compiled.vectorSceneData.glyphFontPaints[1].dashArray, [7, 4]);
  assert.equal(scene.textInstanceCount, 5, "Tr0 has one font stroke; Tr1 one PDF stroke; Tr2 one fill and one PDF stroke");
  assert.equal(scene.rasterLayers.length, 0, "stroked font appearances remain vectors");
  assert.equal(diagnostics.filter(diagnostic => diagnostic.code === "glyph-stroke-curve-approximation").length, 1,
    "live round joins report their vector approximation even when the default font silhouette was exact");
  assert.notEqual(scene.textInstanceB[2], scene.textInstanceB[6], "different live joins and dashes cannot share a baked glyph silhouette");
  const expected = renderPage(context => {
    context.fillStyle = "rgb(51,102,153)";
    context.strokeStyle = "rgb(51,102,153)";
    for (const [x, y, dashed] of [[0, 0, false], [110, 0, true]]) {
      context.save(); context.translate(x, y); context.transform(...matrix);
      context.lineWidth = 4;
      context.lineCap = dashed ? "round" : "butt";
      context.lineJoin = dashed ? "round" : "miter";
      context.setLineDash(dashed ? [7, 4] : []); context.lineDashOffset = dashed ? 2 : 0;
      path(context, square); context.stroke(); context.restore();
    }
    for (const [x, y, fills] of [[0, 110, false], [110, 110, true]]) {
      context.save(); context.translate(x, y);
      context.beginPath();
      for (const command of square) {
        if (command.kind === "close") context.closePath();
        else context[command.kind === "move" ? "moveTo" : "lineTo"](
          matrix[0] * command.x + matrix[2] * command.y + matrix[4],
          matrix[1] * command.x + matrix[3] * command.y + matrix[5]);
      }
      if (fills) context.fill();
      context.strokeStyle = "rgb(179,26,51)"; context.lineWidth = 6; context.stroke(); context.restore();
    }
  });
  const actual = renderPage(context => paintVectorText(context, scene));
  let error = 0, ink = 0;
  for (let offset = 0; offset < actual.length; offset += 4) {
    for (let component = 0; component < 4; component++) error += Math.abs(actual[offset + component] - expected[offset + component]);
    ink += expected[offset + 3] * 4;
  }
  assert.ok(error / ink < 0.025, `live font paint and Tr0/1/2 independent canvas mismatch ${error / ink}`);

  const hairline = await compile("0.2 0.4 0.6 rg BT /F1 1000 Tf 0 Tr (A) Tj ET", 0);
  assert.equal(hairline.scene.textInstanceCount, 0, "intrinsic width-zero contours must never be filled");
  assert.equal(hairline.scene.segmentCount, 4, "intrinsic hairlines retain all four device-width vector edges");
  assert.equal(hairline.scene.styles[0], 0, "hairline width stays zero through the packed ABI");
  assert.ok(hairline.scene.drawRuns.some(run => run.kind === "stroke"));
  assert.deepEqual([...hairline.scene.endpoints.subarray(0, 2)], [30, 24], "FontMatrix applies before hairline packing");

  const translucent = await compile("/Half gs 0.2 0.4 0.6 rg BT /F1 1000 Tf (A) Tj ET", 0,
    { extGStates: [{ resourceName: "Half", fillAlpha: 0.5 }] });
  assert.ok(translucent.scene.paintGraph, "overlapping translucent hairline edges use one isolated glyph paint");
  await assert.rejects(compile("BT /F1 1000 Tf (A) Tj ET", 4, { maxPathCoordinates: 1 }),
    error => error.code === "resource-limit", "configured page budgets include intrinsic stroked glyph outlines");
}

function renderPage(paint) {
  const canvas = createCanvas(1200, 1200), context = canvas.getContext("2d");
  context.scale(4, 4); paint(context);
  return context.getImageData(0, 0, 1200, 1200).data;
}

function paintVectorText(context, scene) {
  for (let instance = 0; instance < scene.textInstanceCount; instance++) {
    const offset = instance * 4, a = scene.textInstanceA, b = scene.textInstanceB, c = scene.textInstanceC;
    const glyph = b[offset + 2] * 4;
    context.save(); context.transform(a[offset], a[offset + 1], a[offset + 2], a[offset + 3], b[offset], b[offset + 1]);
    context.fillStyle = `rgba(${Math.round(c[offset] * 255)},${Math.round(c[offset + 1] * 255)},${Math.round(c[offset + 2] * 255)},${c[offset + 3]})`;
    context.beginPath();
    const first = scene.textGlyphMetaA[glyph], end = first + scene.textGlyphMetaA[glyph + 1];
    let previous = null;
    for (let segment = first; segment < end; segment++) {
      const index = segment * 4, x = scene.textGlyphSegmentsA[index], y = scene.textGlyphSegmentsA[index + 1];
      if (!previous || previous[0] !== x || previous[1] !== y) context.moveTo(x, y);
      const endX = scene.textGlyphSegmentsB[index], endY = scene.textGlyphSegmentsB[index + 1];
      if (scene.textGlyphSegmentsB[index + 2]) context.quadraticCurveTo(scene.textGlyphSegmentsA[index + 2],
        scene.textGlyphSegmentsA[index + 3], endX, endY);
      else context.lineTo(endX, endY);
      previous = [endX, endY];
    }
    context.fill("nonzero"); context.restore();
  }
}
