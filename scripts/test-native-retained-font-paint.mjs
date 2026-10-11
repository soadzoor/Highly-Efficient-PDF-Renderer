import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
} });
const matrix = [0.8, 0.15, 0.3, 0.9, 8, 3];
const square = [{ kind: "move", x: 20, y: 20 }, { kind: "line", x: 80, y: 20 },
  { kind: "line", x: 80, y: 80 }, { kind: "line", x: 20, y: 80 }, { kind: "close" }];
const surfaceFactory = (width, height) => {
  const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") };
};

try {
  const { paintNativeGlyphCommands } = await import("../src/pdf/nativeGlyphPaint.ts");
  const { NativeTextCompiler } = await import("../src/pdf/nativeText.ts");
  const { compileDensePdfContent } = await import("../src/pdf/nativeContentCompiler.ts");
  const { buildNativePageTextResources } = await import("../src/pdf/nativePageText.ts");
  const { createHeprPageDataFromDense } = await import("../src/densePdfPageData.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  async function compile(source, width, options = {}) {
    const font = {
      subtype: "Type1", baseFont: "OriginalStrokedFixture", writingMode: 0, unitsPerEm: 1000,
      descriptor: { ascent: 100, descent: 0, fontBBox: [0, 0, 100, 100] },
      decode(bytes, offset) { return { code: bytes[offset], cid: bytes[offset], glyphId: 1,
        codeByteLength: 1, width: 100, unicode: "A" }; },
      getGlyphOutline(glyphId) {
        const painted = paintNativeGlyphCommands(square, 2, width, { transform: matrix });
        return { glyphId, commands: painted.commands, bounds: painted.bounds ?? [30, 24, 96, 87],
          advanceWidth: 100, leftSideBearing: 0,
          intrinsicStroke: { width, transform: matrix, commands: square } };
      }
    };
    const resources = [{ font, fontIndex: 0 }], runs = [];
    const text = new NativeTextCompiler({ fonts: new Map([["F1", resources[0]]]), onRun: run => runs.push(run) });
    const compiled = await compileDensePdfContent(new TextEncoder().encode(source), {
      output: "display-program", pageMatrix: [1, 0, 0, 1, 0, 0],
      pageBounds: { minX: 0, minY: 0, maxX: 300, maxY: 300 }, ...options,
      textOperatorSink: { applyOperator(operator, operands) {
        runs.length = 0; text.applyOperator(operator, operands); return runs.slice();
      } }
    });
    const textResources = buildNativePageTextResources(text.build(), resources, { maxPaths: 0xffffffff });
    const page = createHeprPageDataFromDense({ sourcePageIndex: 0, width: 300, height: 300, mediaBox: [0, 0, 300, 300], cropBox: [0, 0, 300, 300],
      bleedBox: null, trimBox: null, artBox: null, rotation: 0, userUnit: 1 }, compiled, { text: textResources });
    return { page, compiled, textResources, rendered: await renderHeprPageToCanvas2d(page, { scale: 4, surfaceFactory }) };
  }
  const { page, compiled, textResources, rendered } = await compile([
    "0.2 0.4 0.6 rg 0.7 0.1 0.2 RG 6 w BT /F1 1000 Tf",
    "0 Tr 1 0 0 1 0 0 Tm (A) Tj",
    "1 J 1 j [7 4] 2 d 1 0 0 1 110 0 Tm (A) Tj",
    "0 J 0 j [] 0 d 1 Tr 1 0 0 1 0 110 Tm (A) Tj",
    "2 Tr 1 0 0 1 110 110 Tm (A) Tj ET"
  ].join("\n"), 4);
  assert.deepEqual([...textResources.outlinePaths.bounds], [30, 24, 96, 87], "retained font bounds enclose raw contours, not the intrinsic stroke band");
  assert.equal(page.displayProgram.groups[0].commands.filter(command => command.source === "paths").length, 2,
    "different live font styles are represented by their own path commands");
  assert.equal(page.displayProgram.groups[0].commands.filter(command => command.source === "glyphs").length, 2,
    "explicit PDF Tr1/2 continue to use the ordinary raw glyph path");
  const expected = paintExpected(context => {
    context.fillStyle = context.strokeStyle = "rgb(51,102,153)";
    for (const [x, y, dashed] of [[0, 0, false], [110, 0, true]]) {
      context.save(); context.translate(x, y); context.transform(...matrix); trace(context, square);
      context.lineWidth = 4; context.lineCap = dashed ? "round" : "butt";
      context.lineJoin = dashed ? "round" : "miter";
      context.setLineDash(dashed ? [7, 4] : []); context.lineDashOffset = dashed ? 2 : 0;
      context.stroke(); context.restore();
    }
    for (const [x, y, fill] of [[0, 110, false], [110, 110, true]]) {
      context.save(); context.translate(x, y); trace(context, transform(square));
      if (fill) context.fill();
      context.strokeStyle = "rgb(179,26,51)"; context.lineWidth = 6; context.stroke(); context.restore();
    }
  });
  assertImageNear(rendered.surface.context.getImageData(0, 0, 1200, 1200).data, expected, 0.025, "retained live font styles and Tr0/1/2");
  const abort = new AbortController(); abort.abort();
  assert.throws(() => createHeprPageDataFromDense(page.pageInfo, compiled,
    { text: textResources, signal: abort.signal }), error => error.code === "aborted");
  assert.throws(() => createHeprPageDataFromDense(page.pageInfo, compiled, { text: textResources,
    limits: { maxPathResources: 1, maxPathVerbs: 1000, maxPathCoordinates: 4000, maxClipPaths: 10 } }),
    /path|limit/i, "intrinsic appearances honor caller path-resource ceilings");

  for (const dashed of [false, true]) {
    const { page, rendered } = await compile(`0.2 0.4 0.6 rg ${dashed ? "1 J 1 j [7 4] 2 d" : ""} BT /F1 1000 Tf (A) Tj ET`, 0);
    const command = page.displayProgram.groups[0].commands.find(command => command.source === "paths");
    assert.equal(command.fillPaintIndex, -1, "intrinsic device hairlines must never fill the glyph interior");
    assert(command.strokePaintIndex >= 0);
    const expected = paintExpected(context => {
      context.strokeStyle = "rgb(51,102,153)"; context.setTransform(1, 0, 0, 1, 0, 0);
      const point = (x, y) => [4 * (matrix[0] * x + matrix[2] * y + matrix[4]),
        1200 - 4 * (matrix[1] * x + matrix[3] * y + matrix[5])];
      const projected = { beginPath: () => context.beginPath(), closePath: () => context.closePath(),
        moveTo: (x, y) => context.moveTo(...point(x, y)), lineTo: (x, y) => context.lineTo(...point(x, y)) };
      if (dashed) traceDashedSquare(projected); else trace(projected, square);
      context.lineWidth = 1;
      context.lineCap = dashed ? "round" : "butt"; context.lineJoin = dashed ? "round" : "miter";
      context.setLineDash([]); context.stroke();
    });
    assertImageNear(rendered.surface.context.getImageData(0, 0, 1200, 1200).data, expected, 0.035, `intrinsic hairline, dashed=${dashed}`);
  }
  const translucent = await compile("/Half gs 0.2 0.4 0.6 rg BT /F1 1000 Tf (A) Tj ET", 0,
    { extGStates: [{ resourceName: "Half", fillAlpha: 0.5 }] });
  const translucentPixels = translucent.rendered.surface.context.getImageData(0, 0, 1200, 1200).data;
  for (let offset = 3; offset < translucentPixels.length; offset += 4) {
    assert(translucentPixels[offset] <= 128, "overlapping hairline contours receive nonstroking opacity once");
  }
  // The paint appearance of Tr4 is intrinsic; the clipping path for Tr4/5/6/7
  // is the raw character outline. A subsequent green rectangle must therefore
  // fill its interior, rather than only the stroke band or its expanded bounds.
  for (const mode of [4, 5, 6, 7]) {
    const { page, rendered } = await compile(`0.2 0.4 0.6 rg 0.7 0.1 0.2 RG 6 w BT /F1 1000 Tf ${mode} Tr (A) Tj ET 0 1 0 rg 0 0 300 300 re f`, 4);
    assert(page.stores.clips.firstGlyphs.some(index => index >= 0), `Tr${mode} preserves persistent glyph clipping`);
    const expected = paintExpected(context => {
      if (mode === 4) {
        context.save(); context.transform(...matrix); trace(context, square);
        context.strokeStyle = "rgb(51,102,153)"; context.lineWidth = 4; context.stroke(); context.restore();
      } else if (mode !== 7) {
        trace(context, transform(square)); context.fillStyle = "rgb(51,102,153)";
        if (mode === 6) context.fill();
        context.strokeStyle = "rgb(179,26,51)"; context.lineWidth = 6; context.stroke();
      }
      trace(context, transform(square)); context.clip(); context.fillStyle = "rgb(0,255,0)"; context.fillRect(0, 0, 300, 300);
    });
    assertImageNear(rendered.surface.context.getImageData(0, 0, 1200, 1200).data, expected, 0.025, `intrinsic Tr${mode} and raw text clipping`);
  }
  console.log("Native retained font paint checks passed: live styles, Tr0/1/2/4/5/6/7, transformed hairlines and raw text clips.");
} finally { hooks.deregister(); }

function transform(commands) {
  return commands.map(command => command.kind === "close" ? command : { kind: command.kind,
    x: matrix[0] * command.x + matrix[2] * command.y + matrix[4],
    y: matrix[1] * command.x + matrix[3] * command.y + matrix[5] });
}
function trace(context, commands) {
  context.beginPath();
  for (const command of commands) {
    if (command.kind === "move") context.moveTo(command.x, command.y);
    else if (command.kind === "line") context.lineTo(command.x, command.y);
    else context.closePath();
  }
}
function paintExpected(paint) {
  const canvas = createCanvas(1200, 1200), context = canvas.getContext("2d");
  context.setTransform(4, 0, 0, -4, 0, 1200); paint(context);
  return context.getImageData(0, 0, 1200, 1200).data;
}
function assertImageNear(actual, expected, tolerance, label) {
  let difference = 0, ink = 0;
  for (let index = 0; index < actual.length; index += 4) {
    for (let channel = 0; channel < 4; channel++) difference += Math.abs(actual[index + channel] - expected[index + channel]);
    ink += expected[index + 3] * 4;
  }
  assert(difference / ink < tolerance, `${label}: independent Canvas mismatch ${difference / ink}`);
}

function traceDashedSquare(context) {
  context.beginPath();
  const points = [[20,20],[80,20],[80,80],[20,80],[20,20]], dash = [7,4];
  let dashIndex = 0, remaining = 5;
  for (let segment = 0; segment < 4; segment++) {
    const a = points[segment], b = points[segment + 1];
    let distance = 0;
    while (distance < 60) {
      const span = Math.min(remaining, 60 - distance);
      if (dashIndex === 0) {
        context.moveTo(a[0] + (b[0] - a[0]) * distance / 60, a[1] + (b[1] - a[1]) * distance / 60);
        context.lineTo(a[0] + (b[0] - a[0]) * (distance + span) / 60, a[1] + (b[1] - a[1]) * (distance + span) / 60);
      }
      distance += span; remaining -= span;
      if (remaining === 0) { dashIndex = 1 - dashIndex; remaining = dash[dashIndex]; }
    }
  }
}
