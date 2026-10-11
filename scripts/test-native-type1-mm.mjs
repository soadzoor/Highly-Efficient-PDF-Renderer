import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { buildType1Fixture, type1CharString as cs } from "./lib/type1Fixture.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const { NativeType1Font, evaluateNativeType1CharString: evaluate } = await import("../src/pdf/nativeType1.ts");
  const { PdfError } = await import("../src/pdf/nativeTypes.ts");
  const blend = (index, values, outputs) => [...values, values.length, index, "callothersubr", ...Array(outputs).fill("pop")];
  const font = (program, weights = "[.25 .75]", extra = "", limits = {}) => NativeType1Font.parse(buildType1Fixture({
    glyphs: [[".notdef", cs(0, 500, "hsbw", "endchar")], ["A", program]],
    clearExtra: `/WeightVector ${weights} def\n${extra}`
  }).bytes, limits);
  const reject = operation => assert.throws(operation, error => error instanceof PdfError && error.code === "unsupported-font");
  const at = (actual, expected) => assert(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

  // Adobe 5015 section 3.12 lays out base values first, then each result's
  // deltas against the first master. These expected points are hand computed.
  const program = cs(0, ...blend(14, [500, 200], 1), "hsbw", 0, 0, "rmoveto",
    ...blend(15, [10, 20, 100, 200], 2), "rlineto", "endchar");
  const original = font(program);
  assert.deepEqual(original.blendWeights, [.25, .75]);
  const a = original.getGlyphOutline(1);
  assert.equal(a.advanceWidth, 650);
  assert.deepEqual(a.commands, [{ kind: "move", x: 0, y: 0 }, { kind: "line", x: 85, y: 170 }, { kind: "close" }]);
  assert.deepEqual(original.diagnostics, [], "standard MM blends preserve the original design without approximation warnings");

  const four = evaluate(cs(0, 500, "hsbw", 0, 0, "rmoveto",
    ...blend(15, [10, 20, 1, 2, 3, -4, -5, -6], 2), "rlineto", "endchar"), { blendWeights: [.1, .2, .3, .4] });
  at(four.commands[1].x, 12);
  at(four.commands[1].y, 15.3);

  const threeOutputs = evaluate(cs(0, 500, "hsbw", 0, 0, "rmoveto",
    ...blend(16, [10, 20, 30, 100, 200, 300], 3),
    ...blend(16, [40, 50, 60, 400, 500, 600], 3), "rrcurveto", "endchar"), { blendWeights: [.25, .75] });
  assert.deepEqual(threeOutputs.commands[1], {
    kind: "cubic", control1X: 85, control1Y: 170,
    control2X: 340, control2Y: 510, x: 765, y: 1020
  });
  const fourOutputs = evaluate(cs(0, 500, "hsbw", 0, 0, "rmoveto",
    ...blend(17, [10, 20, 30, 40, 100, 200, 300, 400], 4), "hvcurveto", "endchar"), { blendWeights: [.25, .75] });
  assert.deepEqual(fourOutputs.commands[1], {
    kind: "cubic", control1X: 85, control1Y: 0,
    control2X: 255, control2Y: 255, x: 255, y: 595
  });
  const sixOutputs = evaluate(cs(0, 500, "hsbw", 0, 0, "rmoveto",
    ...blend(18, [10, 20, 30, 40, 50, 60, 100, 200, 300, 400, 500, 600], 6), "rrcurveto", "endchar"), { blendWeights: [.25, .75] });
  assert.deepEqual(sixOutputs.commands, threeOutputs.commands);

  const sixteen = evaluate(cs(0, ...blend(14, [10, ...Array.from({ length: 15 }, (_, i) => i + 1)], 1), "hsbw", "endchar"), {
    blendWeights: Array(16).fill(1 / 16)
  });
  assert.equal(sixteen.advanceWidth, 17.5, "16 master designs fit the Type1 operand wire format");
  const rounded = font(cs(0, ...blend(14, [500, 200], 1), "hsbw", "endchar"), "[.3 .7005]").getGlyphOutline(1);
  assert.equal(rounded.advanceWidth, 640.1, "rounded weights are not renormalized");
  assert.equal(font(cs(0, ...blend(14, [500, 200], 1), "hsbw", "endchar"), "[-.5 1.5]").getGlyphOutline(1).advanceWidth, 800,
    "finite extrapolation weights preserve the defined default design");

  const metadata = "/FontInfo 3 dict dup begin /BlendAxisTypes [/Weight /Width] def " +
    "/BlendDesignPositions [[0 0] [0 1] [1 0] [1 1]] def " +
    "/BlendDesignMap [[[100 0] [400 .5] [900 1]] [[50 0] [200 1]]] def end def";
  const mapped = font(cs(0, ...blend(14, [500, 10, 20, 30], 1), "hsbw", "endchar"), "[.1 .2 .3 .4]", metadata);
  assert.equal(mapped.getGlyphOutline(1).advanceWidth, 520, "default WeightVector wins over any interactive axis interpretation");
  const computed = font(program, "[1 4 div 3 4 div]");
  assert.deepEqual(computed.getGlyphOutline(1), a, "restricted PostScript computes the default WeightVector before blending");
  const mutated = font(program, "[.25 .75] dup 1 .5 put dup 0 .5 put");
  assert.equal(mutated.getGlyphOutline(1).advanceWidth, 600, "mutations before def are evaluated before selecting the default design");
  const laterMutation = font(program, "[.25 .75]", "WeightVector 0 .5 put WeightVector 1 .5 put");
  assert.equal(laterMutation.getGlyphOutline(1).advanceWidth, 600, "later dictionary-array mutations cannot be ignored by the fast reader");
  reject(() => font(program, "2 array dup 0 1 index put dup 1 1 put"));
  const sharedMetadata = font(program, "[.25 .75]", "/p [0] def /BlendDesignPositions [p p] def");
  assert.equal(sharedMetadata.getGlyphOutline(1).advanceWidth, 650, "shared acyclic metadata arrays remain valid");
  const custom = NativeType1Font.parse(buildType1Fixture({
    glyphs: [[".notdef", cs(0, 500, "hsbw", "endchar")], ["A", cs(0, 500, "hsbw", 0, 0, "rmoveto",
      11, 1, 4, "callothersubr", "pop", 0, "rlineto", "endchar")]],
    privateExtra: "/OtherSubrs [{} {} {} {} {2 mul}] def"
  }).bytes);
  assert.equal(custom.getGlyphOutline(1).commands[1].x, 22, "font-local custom OtherSubrs execute their declared arithmetic");
  assert.deepEqual(custom.diagnostics, []);
  const customOrder = NativeType1Font.parse(buildType1Fixture({
    glyphs: [[".notdef", cs(0, 500, "hsbw", "endchar")], ["A", cs(0, 500, "hsbw", 0, 0, "rmoveto",
      10, 30, 2, 4, "callothersubr", "pop", 0, "rlineto", "endchar")]],
    privateExtra: "/OtherSubrs [{} {} {} {} {sub}] def"
  }).bytes);
  assert.equal(customOrder.getGlyphOutline(1).commands[1].x, 20, "OtherSubr arguments enter the PostScript stack in reverse order");
  const stateful = NativeType1Font.parse(buildType1Fixture({
    glyphs: [[".notdef", cs(0, 500, "hsbw", "endchar")],
      ["A", cs(0, 500, "hsbw", 0, 0, "rmoveto", 10, 1, 4, "callothersubr",
        0, 5, "callothersubr", "pop", 0, "rlineto", "endchar")],
      ["B", cs(0, 500, "hsbw", 0, 0, "rmoveto", 0, 5, "callothersubr", "pop", 0, "rlineto", "endchar")]],
    privateExtra: "/state [0] def /OtherSubrs [{} {} {} {} {state 0 3 -1 roll put} {state 0 get}] def"
  }).bytes);
  assert.equal(stateful.getGlyphOutline(stateful.glyphIdForName("A")).commands[1].x, 10,
    "custom procedures share their Private dictionary state within one glyph");
  assert.equal(stateful.getGlyphOutline(stateful.glyphIdForName("B")).commands[1].x, 0,
    "per-glyph PostScript state keeps output independent of glyph cache order");
  const customUnsupported = NativeType1Font.parse(buildType1Fixture({
    glyphs: [[".notdef", cs(0, 500, "hsbw", "endchar")], ["A", cs(0, 500, "hsbw", 0, 0, "rmoveto",
      11, 1, 4, "callothersubr", "pop", 0, "rlineto", "endchar")]],
    privateExtra: "/OtherSubrs [{} {} {} {} {unsupported_device_operator}] def"
  }).bytes);
  assert.equal(customUnsupported.getGlyphOutline(1).commands[1].x, 11, "unsupported extensions retain the standard compatibility shape");
  assert.equal(customUnsupported.diagnostics.length, 1);
  const computedStroke = NativeType1Font.parse(buildType1Fixture({
    paintType: 2, clearExtra: "/StrokeWidth 50 2 mul def"
  }).bytes);
  assert.equal(computedStroke.strokeWidth, 100, "computed scalar dictionary records use the same restricted interpreter");
  const anonymousMutation = NativeType1Font.parse(buildType1Fixture({ clearExtra:
    "currentdict { dup type /arraytype eq { dup length 6 eq " +
    "{ pop [.002 0 0 .001 0 0] def } { pop pop } ifelse } { pop pop } ifelse } forall"
  }).bytes);
  assert.equal(anonymousMutation.getGlyphOutline(anonymousMutation.glyphIdForName("A")).commands[0].x, 100,
    "anonymous dictionary iteration computes a replacement FontMatrix without naming that record");
  assert.deepEqual(anonymousMutation.diagnostics, []);
  const opaqueLoader = NativeType1Font.parse(buildType1Fixture({ clearExtra:
    "true { unsupported_loader_operator } if"
  }).bytes);
  assert.equal(opaqueLoader.getGlyphOutline(opaqueLoader.glyphIdForName("A")).commands[0].x, 50);
  assert.deepEqual(opaqueLoader.diagnostics.map(diagnostic => diagnostic.code), ["font.type1-postscript-approximated"],
    "unsupported loading behavior retains usable declarative geometry with an explicit fidelity warning");
  assert.throws(() => NativeType1Font.parse(buildType1Fixture({ clearExtra: "true {} if" }).bytes,
    { maxType1PostScriptOperations: 2 }), error => error instanceof PdfError && error.code === "resource-limit");
  const subrFont = NativeType1Font.parse(buildType1Fixture({
    glyphs: [[".notdef", cs(0, 500, "hsbw", "endchar")], ["A", cs(0, 500, 200, 0, "callsubr", "hsbw", "endchar")]],
    subrs: [cs(2, 14, "callothersubr", "pop", "return")], clearExtra: "/WeightVector [.25 .75] def"
  }).bytes);
  assert.equal(subrFont.getGlyphOutline(1).advanceWidth, 650, "standard MM subroutine wrappers keep the operand stack intact");

  for (const weights of ["[]", "[1]", "[.25 .25]", "[0 1 2]", "[/A /B]"]) reject(() => font(program, weights));
  reject(() => NativeType1Font.parse(buildType1Fixture({ clearExtra: "/BlendAxisTypes [/Weight] def" }).bytes));
  reject(() => font(program, "[.25 .75]", "/BlendDesignPositions [[0] [1] [0.5]] def"));
  reject(() => font(program, "[.25 .75]", "/BlendDesignMap [[[0 .1] [100 1]]] def"));
  reject(() => evaluate(cs(0, 500, "hsbw", 10, 1, 14, "callothersubr", "pop", 0, "rmoveto", "endchar"), {
    blendWeights: [.25, .75]
  }));
  assert.throws(() => original.getGlyphOutline(99), error => error instanceof PdfError);
  const budgeted = font(program, "[.25 .75]", "", { maxType1Operators: 2 });
  assert.throws(() => budgeted.getGlyphOutline(1), error => error instanceof PdfError && error.code === "resource-limit");
  assert.throws(() => font(program, "[1 4 div 3 4 div]", "", { maxType1PostScriptOperations: 2 }),
    error => error instanceof PdfError && error.code === "resource-limit");
  const controller = new AbortController(); controller.abort();
  assert.throws(() => evaluate(program, { signal: controller.signal, blendWeights: [.25, .75] }),
    error => error instanceof PdfError && error.code === "aborted");
  console.log("Native Type1 Multiple Master semantic checks passed.");
} finally {
  hooks.deregister();
}
