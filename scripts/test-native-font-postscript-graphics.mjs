import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { buildType1Fixture, type1CharString, concatType1Bytes } from "./lib/type1Fixture.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { NativeFontPostScriptGlyphContext: Graphics, transformNativeGlyphPostScriptPaints,
    transformNativeGlyphPostScriptFinalState, nativeGlyphPostScriptPaintBounds,
    nativeGlyphPostScriptCommandCount } = await import("../src/pdf/nativeFontPostScriptGraphics.ts");
  const { NativeType1Font, evaluateNativeType1CharString } = await import("../src/pdf/nativeType1.ts");
  const { executeNativeFontPostScript } = await import("../src/pdf/nativeFontPostScript.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");
  const identity = [1, 0, 0, 1, 0, 0];
  const bytes = value => new TextEncoder().encode(value);
  const near = (actual, expected, tolerance = 1e-9) => {
    assert.equal(actual.length, expected.length);
    for (let i = 0; i < expected.length; i++) assert(Math.abs(actual[i] - expected[i]) <= tolerance,
      `component ${i}: expected ${expected[i]}, got ${actual[i]}`);
  };
  const unsupported = run => assert.throws(run, error => error instanceof PdfError && error.code === "unsupported-font");

  // These CTM/currentpoint and arcto values were checked independently with
  // Ghostscript 10.02.1; path construction retains the CTM at each operation.
  const graphics = new Graphics();
  const ctm = [2, 1, 0, 3, 10, 20];
  graphics.moveTo(5, 7, ctm); graphics.lineTo(4, -2, ctm, true);
  near(graphics.rawCurrentPoint, [28, 44]); near(graphics.currentPoint(ctm), [9, 5]);
  graphics.curveTo(1, 2, 3, 4, 5, 6, ctm, true);
  const curve = graphics.pathCommands.at(-1);
  near([curve.control1X, curve.control1Y, curve.control2X, curve.control2Y, curve.x, curve.y], [30, 51, 34, 59, 38, 67]);
  near(graphics.pathBBox(identity), [20, 44, 38, 67]);
  graphics.closePath(); near(graphics.rawCurrentPoint, [20, 46]);
  graphics.lineTo(100, 200, identity);
  assert.equal(graphics.pathCommands.at(-2).kind, "move", "a line after close starts a subpath at the closed point");
  unsupported(() => new Graphics().currentPoint(identity));
  unsupported(() => new Graphics().lineTo(0, 0, identity));

  const painted = new Graphics();
  painted.moveTo(0, 0, identity); painted.lineTo(100, 0, identity); painted.lineTo(100, 100, identity); painted.closePath();
  painted.clip(1); const before = painted.pathCommands;
  painted.save(); painted.setColorRGB(1, 0.25, 0); painted.paint("eofill", identity);
  assert.equal(painted.pathCommands.length, 0); painted.restore();
  assert.deepEqual(painted.pathCommands, before, "gsave/grestore retains the current path");
  painted.setLineWidth(0); painted.setLineCap(2); painted.setLineJoin(1); painted.setDash([2, 3], -1);
  painted.paint("stroke", ctm);
  assert.equal(painted.paintRecords.length, 2, "grestore does not erase visible marks");
  const [fill, stroke] = painted.paintRecords;
  assert.equal(fill.fillRule, 1); assert.equal(fill.clips[0].fillRule, 1);
  assert.deepEqual(fill.color, [1, 0.25, 0, 1]); assert.equal(stroke.color, null);
  assert.equal(stroke.stroke.width, 0, "hairlines remain device-dependent stroke records");
  assert.deepEqual(stroke.stroke.transform, ctm); assert.equal(stroke.stroke.lineCap, 2);
  assert.deepEqual(stroke.stroke.dashArray, [2, 3]);
  const normalized = transformNativeGlyphPostScriptPaints(painted.paintRecords, [2, 0, 0, 3, 5, 7]);
  assert.deepEqual(normalized[0].commands[0], { kind: "move", x: 5, y: 7 });
  assert.deepEqual(normalized[1].stroke.transform, [4, 3, 0, 9, 25, 67]);
  near(nativeGlyphPostScriptPaintBounds(normalized), [5, 7, 205, 307]);
  painted.setMetrics(600, 20, [-10, -20, 300, 400]);
  assert.deepEqual(painted.metrics, { width: [600, 20], bbox: [-10, -20, 300, 400] });

  const colors = new Graphics(); unsupported(() => colors.currentRGB);
  colors.setColorCMYK(0.2, 0.3, 0.4, 0.1);
  assert.deepEqual(colors.currentCMYK, [0.2, 0.3, 0.4, 0.1]); near(colors.currentRGB, [0.7, 0.6, 0.5]);
  colors.save(); colors.setColorHSB(0.75, 0.5, 0.8);
  assert.deepEqual(colors.currentHSB, [0.75, 0.5, 0.8]); near(colors.currentRGB, [0.6, 0.4, 0.8]);
  colors.restore(); assert.equal(colors.sourceColorSpace, "DeviceCMYK");
  assert.deepEqual(colors.currentCMYK, [0.2, 0.3, 0.4, 0.1]);
  colors.setColorGray(0.4); assert.equal(colors.currentGray, 0.4); near(colors.currentRGB, [0.4, 0.4, 0.4]);
  const snapshots = new Graphics(); snapshots.setColorGray(0.1); snapshots.save(); snapshots.setColorGray(0.2);
  const vmSnapshot = snapshots.captureState(); snapshots.save(); snapshots.setColorGray(0.3);
  snapshots.restoreState(vmSnapshot); assert.equal(snapshots.currentGray, 0.2);
  snapshots.restore(); assert.equal(snapshots.currentGray, 0.1, "VM restore also discards graphics saves created after its snapshot");
  const finalStyle = new Graphics(); assert.equal(finalStyle.finalState, undefined);
  finalStyle.save(); finalStyle.setLineWidth(0); finalStyle.setColorGray(0.8); finalStyle.restore();
  assert.equal(finalStyle.finalState, undefined, "restored setters must not override the final glyph paint");
  finalStyle.setLineCap(2); finalStyle.setDash([3, 7], 1); finalStyle.setCurrentMatrix(ctm);
  assert.deepEqual(finalStyle.finalState.changedStrokeFields, ["lineCap", "dashArray", "dashPhase"]);
  assert.deepEqual(finalStyle.finalState.stroke.transform, ctm);
  assert(!finalStyle.finalState.changedStrokeFields.includes("width"), "default PS width must not override the declared intrinsic font width");
  const normalizedFinal = transformNativeGlyphPostScriptFinalState(finalStyle.finalState, [2, 0, 0, 3, 5, 7]);
  assert.deepEqual(normalizedFinal.stroke.transform, [4, 3, 0, 9, 25, 67]);
  const finalClip = new Graphics(); finalClip.moveTo(0, 0, identity); finalClip.lineTo(10, 0, identity);
  finalClip.lineTo(10, 10, identity); finalClip.closePath(); finalClip.clip(0); finalClip.newPath();
  assert.equal(nativeGlyphPostScriptCommandCount([], finalClip.finalState), 4,
    "final clipping paths count against the configured retained command allowance");
  finalClip.setCurrentMatrix([2, 0, 0, 2, 0, 0]);
  assert.deepEqual(finalClip.finalState.changedStrokeFields, [], "a final CTM change can exist without a stroke setter");

  // PLRM 4.10: ImageMatrix maps user coordinates TO sample coordinates, rows
  // are byte padded, and imagemask true paints one bits ([1 0] Decode).
  const mask = new Graphics(); mask.moveTo(7, 9, identity); const maskPath = mask.pathCommands;
  mask.image({ width: 3, height: 2, bitsPerComponent: 1, components: 1,
    data: Uint8Array.of(0xa0, 0xa0), imageMatrix: identity, ctm: identity, mask: true, polarity: true });
  assert.deepEqual(mask.pathCommands, maskPath, "imagemask preserves the current path");
  assert.equal(mask.paintRecords.length, 1); assert.equal(mask.paintRecords[0].commands.length, 10,
    "identical neighboring scanline runs coalesce into two vertical rectangles");
  assert.equal(mask.paintRecords[0].color, null, "stencils inherit the PDF glyph paint");
  near(nativeGlyphPostScriptPaintBounds(mask.paintRecords), [0, 0, 3, 2]);
  const inverseMask = new Graphics(); inverseMask.setColorRGB(0, 1, 0);
  inverseMask.image({ width: 3, height: 2, bitsPerComponent: 1, components: 1,
    data: Uint8Array.of(0xa0, 0xa0), imageMatrix: identity, ctm: identity, mask: true, polarity: false });
  assert.equal(inverseMask.paintRecords[0].commands.length, 5);
  near(nativeGlyphPostScriptPaintBounds(inverseMask.paintRecords), [1, 0, 2, 2]);
  assert.deepEqual(inverseMask.paintRecords[0].color, [0, 1, 0, 1]);

  const image = new Graphics();
  image.image({ width: 2, height: 2, bitsPerComponent: 8, components: 3,
    data: Uint8Array.of(255, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 255),
    imageMatrix: [2, 0, 0, -2, 0, 2], ctm: [100, 0, 0, 200, 10, 20] });
  assert.equal(image.paintRecords.length, 2); assert(image.paintRecords.every(record => record.commands.length === 5));
  assert.deepEqual(image.paintRecords.map(record => record.color), [[1, 0, 0, 1], [0, 0, 1, 1]]);
  assert.deepEqual(image.paintRecords[0].commands[0], { kind: "move", x: 10, y: 220 });
  near(nativeGlyphPostScriptPaintBounds(image.paintRecords), [10, 20, 110, 220]);
  assert.deepEqual(image.diagnostics.map(diagnostic => diagnostic.code), ["font.postscript-image-vectorized"]);
  const packedImage = new Graphics();
  packedImage.image({ width: 3, height: 1, bitsPerComponent: 2, components: 1,
    data: Uint8Array.of(0x1c), imageMatrix: identity, ctm: identity });
  near(packedImage.paintRecords.map(record => record.color[0]), [0, 1 / 3, 1]);
  const twelveBit = new Graphics();
  twelveBit.image({ width: 1, height: 1, bitsPerComponent: 12, components: 1,
    data: Uint8Array.of(0x80, 0x00), decode: [1, 0], imageMatrix: identity, ctm: identity });
  near([twelveBit.paintRecords[0].color[0]], [1 - 2048 / 4095]);
  const cmykImage = new Graphics();
  cmykImage.image({ width: 1, height: 1, bitsPerComponent: 8, components: 4,
    data: Uint8Array.of(255, 0, 0, 0), imageMatrix: identity, ctm: identity });
  assert.deepEqual(cmykImage.paintRecords[0].color, [0, 1, 1, 1]);
  const partialImage = new Graphics();
  partialImage.image({ width: 1000000, height: 1000000, bitsPerComponent: 8, components: 1,
    data: Uint8Array.of(127), imageMatrix: identity, ctm: identity, interpolate: true });
  assert.equal(partialImage.paintRecords[0].commands.length, 5, "early source termination does not traverse undeclared billions of missing samples");
  assert.deepEqual(partialImage.diagnostics.map(diagnostic => diagnostic.code),
    ["font.postscript-image-vectorized", "font.postscript-image-truncated", "font.postscript-image-interpolation-approximated"]);
  assert.throws(() => new Graphics({ maxPathCommands: 4 }).image({ width: 1, height: 1,
    bitsPerComponent: 8, components: 1, data: Uint8Array.of(0), imageMatrix: identity, ctm: identity }),
    error => error instanceof PdfError && error.code === "resource-limit");

  const arc = new Graphics(); arc.moveTo(0, 0, identity);
  near(arc.arcTo(100, 0, 100, 100, 25, identity), [75, 0, 100, 25]);
  near(arc.currentPoint(identity), [100, 25]);
  assert(arc.pathCommands.some(command => command.kind === "cubic"));
  assert.equal(arc.diagnostics[0].code, "font.postscript-arc-approximation");
  arc.arc(0, 0, 10, 0, 1e200, identity); // Angle wrapping must not loop once per turn.
  assert(arc.pathCommands.length > 0);
  unsupported(() => arc.arc(0, 0, -1, 0, 90, identity));

  const reverse = new Graphics(); reverse.moveTo(0, 0, identity); reverse.lineTo(100, 0, identity);
  reverse.lineTo(100, 100, identity); reverse.closePath(); reverse.reversePath();
  near(reverse.currentPoint(identity), [100, 100]);
  assert.deepEqual(reverse.pathCommands.map(command => command.kind), ["move", "line", "line", "close"]);
  const flattened = new Graphics(); flattened.moveTo(0, 0, identity);
  flattened.curveTo(0, 100, 100, 100, 100, 0, identity); flattened.flattenPath();
  assert(flattened.pathCommands.every(command => command.kind === "move" || command.kind === "line"));
  near(flattened.currentPoint(identity), [100, 0]);
  assert.equal(flattened.diagnostics[0].code, "font.postscript-flattenpath-approximation");

  const limited = new Graphics({ maxPathCommands: 1 }); limited.moveTo(0, 0, identity);
  assert.throws(() => limited.lineTo(1, 2, identity), error => error instanceof PdfError && error.code === "resource-limit");
  const controller = new AbortController(); controller.abort();
  assert.throws(() => new Graphics({ signal: controller.signal }).moveTo(0, 0, identity),
    error => error instanceof PdfError && error.code === "aborted");

  // The VM uses the actual glyph context. Images/device queries that have no
  // glyph implementation must keep diagnosed fallback rather than no-op.
  const context = new Graphics();
  executeNativeFontPostScript(bytes(`
    5 7 moveto 4 -2 rlineto currentpoint /py exch def /px exch def
    gsave newpath 10 20 translate 0 0 moveto 10 0 lineto 10 10 lineto closepath
      clip 1 0 0 setrgbcolor fill
    grestore 2 setlinewidth stroke
  `), undefined, { initialDictionary: new Map([["FontType", 1]]), glyphContext: context });
  assert.equal(context.paintRecords.length, 2);
  assert.deepEqual(context.paintRecords[0].color, [1, 0, 0, 1]);
  assert.deepEqual(context.paintRecords[0].commands[0], { kind: "move", x: 10, y: 20 });
  assert.equal(context.paintRecords[1].stroke.width, 2);
  unsupported(() => executeNativeFontPostScript(bytes("0 0 moveto"), undefined,
    { initialDictionary: new Map([["FontType", 1]]) }));

  const vmImage = source => {
    const context = new Graphics();
    const result = executeNativeFontPostScript(typeof source === "string" ? bytes(source) : source, undefined,
      { initialDictionary: new Map([["FontType", 1]]), glyphContext: context });
    return { context, dictionary: result.dictionary };
  };
  const vmMask = vmImage("3 2 true [1 0 0 1 0 0] <a0> imagemask");
  assert.equal(vmMask.context.paintRecords[0].commands.length, 10, "string image sources repeat until all rows are supplied");
  assert.equal(vmMask.context.paintRecords[0].color, null);
  const vmGray = vmImage("2 1 8 [1 0 0 1 0 0] <00ff> image");
  assert.deepEqual(vmGray.context.paintRecords.map(record => record.color), [[0, 0, 0, 1], [1, 1, 1, 1]]);
  const vmRGB = vmImage(`1 0 0 setrgbcolor
    << /ImageType 1 /Width 2 /Height 1 /BitsPerComponent 8 /ImageMatrix [1 0 0 1 0 0]
      /Decode [0 1 0 1 0 1] /DataSource <ff00000000ff> >> image`);
  assert.deepEqual(vmRGB.context.paintRecords.map(record => record.color), [[1, 0, 0, 1], [0, 0, 1, 1]]);
  const vmPlanar = vmImage("2 1 8 [1 0 0 1 0 0] <ff00> <0000> <00ff> true 3 colorimage");
  assert.deepEqual(vmPlanar.context.paintRecords.map(record => record.color), [[1, 0, 0, 1], [0, 0, 1, 1]]);
  const vmProcedures = vmImage(`/calls 0 def
    2 1 8 [1 0 0 1 0 0] { /calls calls 1 add def calls 1 eq { <00> } { <ff> } ifelse } image`);
  assert.equal(vmProcedures.dictionary.get("calls"), 2);
  assert.deepEqual(vmProcedures.context.paintRecords.map(record => record.color), [[0, 0, 0, 1], [1, 1, 1, 1]]);
  const vmEarlyEOF = vmImage(`/calls 0 def
    3 1 8 [1 0 0 1 0 0] { /calls calls 1 add def calls 1 eq { <40> } { () } ifelse } image`);
  assert.equal(vmEarlyEOF.context.paintRecords[0].commands.length, 5);
  assert(vmEarlyEOF.context.diagnostics.some(diagnostic => diagnostic.code === "font.postscript-image-truncated"));
  const vmFile = vmImage(`/source <00ffee> /ReusableStreamDecode filter def
    2 1 8 [1 0 0 1 0 0] source image
    source read /hasTail exch def /tailByte exch def`);
  assert.equal(vmFile.dictionary.get("hasTail"), true); assert.equal(vmFile.dictionary.get("tailByte"), 238,
    "image reads precisely its samples without draining trailing file bytes");
  const vmInline = vmImage(concatType1Bytes("2 1 8 [1 0 0 1 0 0] currentfile image ",
    Uint8Array.of(0, 255), "\n/afterImage 123 def\n"));
  assert.equal(vmInline.dictionary.get("afterImage"), 123, "inline image bytes resume at the next PostScript token");
  assert.deepEqual(vmInline.context.paintRecords.map(record => record.color), [[0, 0, 0, 1], [1, 1, 1, 1]]);

  // Direct evaluator callbacks receive a live path, while the Type1 BuildChar
  // register is explicitly changed only by setcurrentpoint (Type1 §6.4).
  const raw = evaluateNativeType1CharString(type1CharString(50, 600, "hsbw", 0, 0, "rmoveto",
    100, 0, "rlineto", 0, 4, "callothersubr", 0, 100, "rlineto", "endchar"), {
    executeOtherSubr(index, args, context) {
      assert.equal(index, 4); assert.deepEqual(args, []); near(context.currentPoint(identity), [150, 0]);
      context.save(); context.newPath(); context.moveTo(0, 0, identity); context.lineTo(20, 0, identity);
      context.lineTo(20, 20, identity); context.closePath(); context.paint("fill", identity); context.restore();
      return [];
    }
  });
  assert.equal(raw.postScriptPaints.length, 1); assert.equal(raw.advanceWidth, 600);
  assert.deepEqual(raw.commands.at(-2), { kind: "line", x: 150, y: 100 });

  const fixture = buildType1Fixture({ fontMatrix: [0.002, 0, 0, 0.003, 0.01, 0.02],
    privateExtra: `/OtherSubrs [{} {} {} {} {
      gsave newpath 0 0 moveto 20 0 lineto 20 20 lineto closepath
        1 0 0 setrgbcolor fill grestore
    }] def`,
    glyphs: [[".notdef", type1CharString(0, 500, "hsbw", "endchar")],
      ["A", type1CharString(50, 600, "hsbw", 0, 0, "rmoveto", 100, 0, "rlineto",
        0, 4, "callothersubr", 0, 100, "rlineto", -100, 0, "rlineto", "closepath", "endchar")]] });
  const font = NativeType1Font.parse(fixture.bytes);
  const outline = font.getGlyphOutline(font.glyphIdForName("A"), false);
  assert.equal(outline.postScriptPaints.length, 1, "PDF PaintType policy must retain explicit OtherSubr paints");
  assert.deepEqual(outline.postScriptPaints[0].commands[0], { kind: "move", x: 10, y: 20 });
  assert.deepEqual(outline.postScriptPaints[0].color, [1, 0, 0, 1]);
  assert.equal(font.diagnostics.length, 0, "supported custom graphics require no compatibility fallback");
  assert.equal(outline.postScriptFinalState, undefined, "gsave/grestore around explicit paints restores the implicit glyph state");
  assert(outline.bounds[0] <= 10 && outline.bounds[2] >= 310, "visible custom paints participate in bounds");

  const imageFixture = buildType1Fixture({ privateExtra: `/OtherSubrs [{} {} {} {} {
      gsave 1 0 0 setrgbcolor
        2 1 true [1 0 0 1 0 0] <80> imagemask
        2 1 8 [1 0 0 1 0 0] <00ff> image
      grestore
    }] def`, glyphs: [[".notdef", type1CharString(0, 500, "hsbw", "endchar")],
      ["A", type1CharString(50, 600, "hsbw", 0, 0, "rmoveto", 100, 0, "rlineto",
        0, 4, "callothersubr", 0, 100, "rlineto", "endchar")]] });
  const imageFont = NativeType1Font.parse(imageFixture.bytes);
  const imageOutline = imageFont.getGlyphOutline(imageFont.glyphIdForName("A"), false);
  assert.deepEqual(imageOutline.postScriptPaints.map(record => record.color), [[1, 0, 0, 1], [0, 0, 0, 1], [1, 1, 1, 1]]);
  assert.deepEqual(imageFont.diagnostics.map(diagnostic => diagnostic.code), ["font.postscript-image-vectorized"]);

  const finalFixture = buildType1Fixture({ fontMatrix: [0.002, 0, 0, 0.003, 0.01, 0.02],
    privateExtra: `/OtherSubrs [{} {} {} {} {
      gsave newpath 0 0 moveto 80 0 lineto 80 90 lineto closepath clip
        currentpoint pop pop
      grestore
      1 0 0 setrgbcolor 2 setlinecap 2 3 scale
    }] def`, glyphs: [[".notdef", type1CharString(0, 500, "hsbw", "endchar")],
      ["A", type1CharString(50, 600, "hsbw", 0, 0, "rmoveto", 100, 0, "rlineto",
        0, 4, "callothersubr", 0, 100, "rlineto", "endchar")]] });
  const finalFont = NativeType1Font.parse(finalFixture.bytes);
  const finalOutline = finalFont.getGlyphOutline(finalFont.glyphIdForName("A"), false);
  assert.equal(finalOutline.postScriptPaints, undefined, "state-only OtherSubrs need no explicit paints");
  assert.deepEqual(finalOutline.postScriptFinalState.color, [1, 0, 0, 1]);
  assert.deepEqual(finalOutline.postScriptFinalState.changedStrokeFields, ["lineCap"]);
  assert.deepEqual(finalOutline.postScriptFinalState.stroke.transform, [4, 0, 0, 9, 10, 20]);
  assert.equal(finalOutline.postScriptFinalState.clips.length, 0, "restored clip must not constrain the final outline");
  assert(finalOutline.commands.length > 0, "state-aware fill must keep the raw outline for PDF stroke and clip modes");
  assert(finalFont.diagnostics.some(diagnostic => diagnostic.code === "font.postscript-charstring-ctm-approximated"),
    "lasting PS transforms before later charstring operators must disclose the retained glyph-coordinate approximation");

  const clippedFixture = buildType1Fixture({ privateExtra: `/OtherSubrs [{} {} {} {} { clip 0 1 0 setrgbcolor }] def`,
    glyphs: [[".notdef", type1CharString(0, 500, "hsbw", "endchar")],
      ["A", type1CharString(0, 600, "hsbw", 0, 0, "rmoveto", 100, 0, "rlineto", 0, 100, "rlineto",
        "closepath", 0, 4, "callothersubr", "endchar")]] });
  const clippedFont = NativeType1Font.parse(clippedFixture.bytes);
  const clippedOutline = clippedFont.getGlyphOutline(clippedFont.glyphIdForName("A"), false);
  assert.equal(clippedOutline.postScriptFinalState.clips.length, 1);
  assert.deepEqual(clippedOutline.postScriptFinalState.color, [0, 1, 0, 1]);
  assert.deepEqual(clippedOutline.postScriptFinalState.clips[0].commands, clippedOutline.commands);

  const compositeFixture = buildType1Fixture({ paintType: 2,
    privateExtra: `/OtherSubrs [{} {} {} {} { 1 0 0 setrgbcolor } { 0 1 0 setrgbcolor } {
      gsave newpath 0 0 moveto 10 0 lineto 10 10 lineto closepath 0 0 1 setrgbcolor fill grestore
      0.5 setgray
    }] def`, glyphs: [[".notdef", type1CharString(0, 500, "hsbw", "endchar")],
      ["A", type1CharString(50, 600, "hsbw", 0, 0, "rmoveto", 100, 0, "rlineto", 0, 100, "rlineto", -100, 0, "rlineto",
        "closepath", 0, 4, "callothersubr", "endchar")],
      ["acute", type1CharString(20, 0, "hsbw", 0, 0, "rmoveto", 40, 80, "rlineto", -20, 0, "rlineto",
        "closepath", 0, 5, "callothersubr", "endchar")],
      ["Aacute", type1CharString(50, 600, "hsbw", 0, 6, "callothersubr", 20, 80, 350, 65, 194, "seac")]] });
  const compositeFont = NativeType1Font.parse(compositeFixture.bytes);
  const compositeId = compositeFont.glyphIdForName("Aacute");
  const pdfComposite = compositeFont.getGlyphOutline(compositeId, false);
  const fontComposite = compositeFont.getGlyphOutline(compositeId, true);
  assert.deepEqual(pdfComposite.postScriptPaints.map(record => record.kind), ["fill", "fill", "fill"]);
  assert.deepEqual(fontComposite.postScriptPaints.map(record => record.kind), ["fill", "stroke", "stroke"],
    "seac component implicit paints follow the selected PDF/font policy without poisoning the other cache");
  assert.deepEqual(pdfComposite.postScriptPaints.map(record => record.color), [[0, 0, 1, 1], [1, 0, 0, 1], [0, 1, 0, 1]],
    "parent marks precede independently colored base and accent final paints");
  assert.deepEqual(pdfComposite.postScriptPaints[2].commands[0], { kind: "move", x: 130, y: 350 });
  assert.deepEqual(pdfComposite.postScriptFinalState, { clips: [], color: null, omitFinalPaint: true });
  assert.equal(compositeFont.diagnostics.filter(diagnostic => diagnostic.code === "font.type1-seac-state-approximated").length, 1,
    "parent/component PostScript state conflicts must diagnose the approximation once across both policy caches");
  assert.equal(pdfComposite.commands.length, 9, "composite raw contours remain available for PDF stroke/clip");
  assert(fontComposite.postScriptPaints.slice(1).every(record => record.stroke.width === 0 && record.changedStrokeFields.includes("width")),
    "component hairlines retain device-dependent width zero and inherit remaining invoking stroke style");
  assert.throws(() => NativeType1Font.parse(compositeFixture.bytes, { maxType1PathCommands: 21 }).getGlyphOutline(compositeId, false),
    error => error instanceof PdfError && error.code === "resource-limit");

  const wideFixture = buildType1Fixture({ paintType: 2, clearExtra: "/StrokeWidth 1 def",
    privateExtra: "/OtherSubrs [{} {} {} {} { 100 setlinewidth 2 setmiterlimit }] def",
    glyphs: [[".notdef", type1CharString(0, 500, "hsbw", "endchar")], ["A", type1CharString(0, 600, "hsbw",
      0, 0, "rmoveto", 100, 0, "rlineto", 0, 4, "callothersubr", "endchar")]] });
  const wideFont = NativeType1Font.parse(wideFixture.bytes), wide = wideFont.getGlyphOutline(1, true);
  assert(wide.bounds[0] <= -50 && wide.bounds[2] >= 150 && wide.bounds[1] <= -50 && wide.bounds[3] >= 50,
    "the final custom pen participates in conservative ink bounds");

  const partialFixture = buildType1Fixture({ privateExtra: `/OtherSubrs [{} {} {} {} {
      gsave newpath 0 0 moveto 20 0 lineto 20 20 lineto closepath 1 0 0 setrgbcolor fill grestore
      unsupportedGlyphDeviceQuery
    }] def`, glyphs: [[".notdef", type1CharString(0, 500, "hsbw", "endchar")],
      ["A", type1CharString(0, 600, "hsbw", 0, 0, "rmoveto", 100, 0, "rlineto", 0, 4, "callothersubr", "endchar")]] });
  const partialFont = NativeType1Font.parse(partialFixture.bytes), partial = partialFont.getGlyphOutline(1, false);
  assert.equal(partial.postScriptPaints.length, 1, "marks emitted before a diagnosed OtherSubr fallback stay visible");
  assert(partialFont.diagnostics.length > 0, "partial OtherSubr execution cannot conceal the unsupported tail");
  console.log("Font PostScript graphics passed: paths/CTM, gstate, ordered color/clip/stroke records, curves, metrics, limits and Type1 OtherSubr integration.");
} finally { hooks.deregister(); }
