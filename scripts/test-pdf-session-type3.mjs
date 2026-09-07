import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const substituteSfnt = buildTinySfnt();

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const [sessionApi, validationApi, executorApi, dataApi] = await Promise.all([
    import("../src/pdfSession.ts"),
    import("../src/heprDocumentDataValidation.ts"),
    import("../src/heprDisplayExecutor.ts"),
    import("../src/heprDocumentData.ts")
  ]);
  const { openPdf } = sessionApi;
  const { validateHeprPageData } = validationApi;
  const { executeHeprDisplayProgram } = executorApi;
  const { HEPR_PAINT_KIND } = dataApi;

  const session = await openPdf({
    kind: "bytes",
    bytes: type3Fixture(),
    label: "native-session-type3.pdf"
  });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.equal(page.textIndex.text, "ΩβΩσπιββignored");
    assert.equal(page.stores.glyphs.glyphIds.length, 9);
    assert.equal(page.displayProgram.programs.filter((program) => program.kind === "type3").length, 6);

    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    const invocations = root.commands.filter((command) => command.kind === "invoke-program");
    assert.equal(invocations.length, 8, "the invisible OCR glyph has no paint invocation");
    assert.deepEqual(
      invocations.map((command) => page.displayProgram.programs[command.programIndex].kind),
      ["type3", "type3", "type3", "type3", "type3", "type3", "type3", "type3"]
    );
    assert.equal(invocations[0].programIndex, invocations[2].programIndex, "CharProc aliases dedupe");
    assert.equal(invocations[0].type3PaintIndex, -1, "colored d0 ignores caller paint");
    assert.ok(invocations[1].type3PaintIndex >= 0, "uncolored d1 inherits caller text paint");
    assert.ok(
      invocations[5].type3PaintIndex >= 0,
      "a colored d0 procedure inherits paint until it executes a color operator"
    );
    assert.equal(
      invocations[6].programIndex,
      invocations[1].programIndex,
      "an uncolored glyph program is reused across caller colors"
    );
    assert.notEqual(invocations[6].type3PaintIndex, invocations[1].type3PaintIndex);
    assert.notEqual(
      invocations[7].programIndex,
      invocations[1].programIndex,
      "caller alpha creates an exact state specialization"
    );
    assert.notEqual(invocations[0].transformIndex, invocations[1].transformIndex);
    assert.equal(invocations[0].optionalContentIndex, 0);
    assert.equal(invocations[0].markedContentIndex, 0);

    const colored = page.displayProgram.programs[invocations[0].programIndex];
    assert.equal(colored.kind, "type3");
    assert.deepEqual(
      Array.from(page.stores.transforms.values.slice(colored.matrixIndex * 6, colored.matrixIndex * 6 + 6)),
      [1, 0, 0, 1, 0, 0],
      "FontMatrix is normalized against the text engine's units-per-em scale"
    );
    assert.equal(colored.commands.length, 2);
    assert.ok(colored.commands.every((command) => command.kind === "invoke-group"));
    const coloredGroups = colored.commands.map((command) => page.displayProgram.groups[command.groupIndex]);
    assert.ok(coloredGroups.every((group) => group.alpha === 0.5));
    assert.deepEqual(
      colored.commands.map((command) => command.markedContentIndex),
      [2, 2]
    );
    assert.ok(colored.commands.every((command) => command.optionalContentIndex === 0));
    assert.ok(coloredGroups.every((group) => group.commands[0].optionalContentIndex === -1));

    const uncolored = page.displayProgram.programs[invocations[1].programIndex];
    assert.equal(uncolored.commands.length, 1);
    assert.equal(uncolored.commands[0].kind, "draw");
    assert.equal(uncolored.commands[0].paintIndex, -1);
    assert.deepEqual(uncolored.bounds, [0, 0, 500, 500]);

    const shadingProgram = page.displayProgram.programs[invocations[3].programIndex];
    assert.equal(shadingProgram.commands[0].source, "gradients");
    const patternProgram = page.displayProgram.programs[invocations[4].programIndex];
    assert.equal(patternProgram.commands[0].source, "paths");
    const patternPaintIndex = patternProgram.commands[0].fillPaintIndex;
    assert.equal(page.stores.paints.kinds[patternPaintIndex], HEPR_PAINT_KIND.Pattern);
    const patternIndex = page.stores.paints.resourceIndices[patternPaintIndex];
    assert.ok(page.stores.patterns.programIndices[patternIndex] >= 0);
    assert.equal(
      page.displayProgram.programs[page.stores.patterns.programIndices[patternIndex]].kind,
      "pattern"
    );

    const fontGlyphStart = page.stores.fonts.glyphOffsets[0];
    const fontGlyphEnd = page.stores.fonts.glyphOffsets[1];
    const ids = Array.from(page.stores.fonts.glyphIds.slice(fontGlyphStart, fontGlyphEnd));
    const programIndexes = Array.from(
      page.stores.fonts.type3ProgramIndices.slice(fontGlyphStart, fontGlyphEnd)
    );
    assert.equal(programIndexes[ids.indexOf(65)], programIndexes[ids.indexOf(67)]);
    assert.equal(
      programIndexes[ids.indexOf(66)],
      invocations[1].programIndex,
      "the font store keeps the first canonical state specialization"
    );
    assert.equal(programIndexes[ids.indexOf(68)], -1, "invisible-only malformed CharProc stays lazy");

    const events = [];
    await executeHeprDisplayProgram(page, {
      beginCompositeGroup() {},
      endCompositeGroup() {},
      beginProgram(execution) {
        if (execution.program.kind === "type3") {
          events.push(`program:${execution.program.resourceName}:${execution.state.type3PaintIndex}`);
        }
      },
      drawRun(execution) {
        if (execution.state.invocation?.kind === "program") {
          events.push(`draw:${execution.command.source}:${execution.state.type3PaintIndex}`);
        }
      }
    });
    assert.equal(events.filter((event) => event.startsWith("program:")).length, 8);
    assert.ok(events.some((event) => /^draw:fill-paths:\d+$/.test(event)));

  } finally {
    await session.close();
  }

  const inheritedStroke = await openPdf({
    kind: "bytes",
    bytes: inheritedStrokeFixture(),
    label: "inherited-stroke.pdf"
  });
  try {
    const page = await inheritedStroke.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    const invocation = root.commands.find((command) => command.kind === "invoke-program");
    assert.ok(invocation?.type3PaintIndex >= 0, "a colored d0 stroke inherits caller stroke paint");
    const program = page.displayProgram.programs[invocation.programIndex];
    assert.equal(program.commands[0].source, "paths");
    assert.equal(program.commands[0].strokePaintIndex, -1);
    assert.equal(program.commands[0].strokePaintInherited, true);
    assert.equal(page.stores.strokes.lineCaps[program.commands[0].strokeStyleIndex], 2);
  } finally {
    await inheritedStroke.close();
  }

  for (const [name, bytes, code, reason] of [
    ["visible-malformed", visibleMalformedFixture(), "unsupported-font", "type3-charproc-leading-metrics"],
    ["uncolored-color", uncoloredColorFixture(), "unsupported-content", undefined],
    ["resource-leak", scopedResourceLeakFixture(), "unsupported-color", "scoped-color-space-missing"],
    ["used-local-default", usedLocalDefaultFixture(), "unsupported-color", undefined],
    ["metrics-outside", metricsOutsideFixture(), "unsupported-content", undefined]
  ]) {
    const failing = await openPdf({ kind: "bytes", bytes, label: `${name}.pdf` });
    try {
      await assert.rejects(
        failing.compilePage(0, { optimization: "none" }),
        (error) => error?.code === code &&
          (reason === undefined || error?.details?.reason === reason || error?.cause?.details?.reason === reason)
      );
    } finally {
      await failing.close();
    }
  }

  const nestedForm = await openPdf({
    kind: "bytes",
    bytes: type3XObjectFixture(),
    label: "type3-nested-form.pdf"
  });
  try {
    const page = await nestedForm.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    const type3 = page.displayProgram.programs.find((program) => program.kind === "type3");
    assert.ok(type3);
    const invocation = type3.commands.find((command) => command.kind === "invoke-program");
    assert.ok(invocation);
    const form = page.displayProgram.programs[invocation.programIndex];
    assert.equal(form.kind, "form");
    const formDraw = form.commands.find((command) => command.kind === "draw");
    assert.ok(
      (formDraw?.source === "fill-paths" && formDraw.paintIndex === -1) ||
      (formDraw?.source === "paths" && formDraw.fillPaintInherited === true),
      "a nested Form forwards the Type3 caller paint"
    );
  } finally {
    await nestedForm.close();
  }

  const nestedTextRequests = [];
  const nestedText = await openPdf(
    { kind: "bytes", bytes: type3NestedTextFixture(), label: "type3-nested-text.pdf" },
    {
      missingFontResolver(request) {
        nestedTextRequests.push(request.baseFont);
        return { sfntBytes: substituteSfnt, identifier: "type3-nested-text-v1" };
      }
    }
  );
  try {
    const page = await nestedText.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.equal(page.textIndex.text, "A", "CharProc paint text does not duplicate outer Unicode");
    assert.deepEqual(nestedTextRequests, ["Courier"], "the Type3-local font shadows page resources");
    assert.equal(page.stores.glyphs.glyphIds.length, 2);
    const type3 = page.displayProgram.programs.find((program) => program.kind === "type3");
    assert.ok(type3?.commands.some((command) => command.kind === "draw" && command.source === "glyphs"));
  } finally {
    await nestedText.close();
  }

  const cyclic = await openPdf(
    { kind: "bytes", bytes: type3FormCycleFixture(), label: "type3-form-cycle.pdf" },
    {
      missingFontResolver() {
        return { sfntBytes: substituteSfnt, identifier: "type3-cycle-v1" };
      }
    }
  );
  try {
    await assert.rejects(
      cyclic.compilePage(0, { optimization: "none" }),
      (error) => error?.code === "unsupported-content" &&
        error?.details?.reason === "reusable-program-cycle"
    );
  } finally {
    await cyclic.close();
  }

  const nestedType3 = await openPdf({
    kind: "bytes",
    bytes: nestedType3Fixture(),
    label: "nested-type3.pdf"
  });
  try {
    const page = await nestedType3.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.equal(page.textIndex.text, "A");
    assert.equal(page.displayProgram.programs.filter(({ kind }) => kind === "type3").length, 2);
    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    const outerInvocation = root.commands.find((command) => command.kind === "invoke-program");
    const outer = page.displayProgram.programs[outerInvocation.programIndex];
    const innerInvocation = outer.commands.find((command) => command.kind === "invoke-program");
    assert.ok(innerInvocation);
    assert.equal(page.displayProgram.programs[innerInvocation.programIndex].kind, "type3");
    assert.equal(innerInvocation.type3PaintIndex, -1, "nested Type3 text forwards caller paint");
    const executedPrograms = [];
    await executeHeprDisplayProgram(page, {
      beginCompositeGroup() {},
      endCompositeGroup() {},
      beginProgram(execution) {
        executedPrograms.push(execution.program.kind);
      },
      drawRun() {}
    });
    assert.deepEqual(executedPrograms, ["type3", "type3"]);
  } finally {
    await nestedType3.close();
  }

  const softMaskType3 = await openPdf({
    kind: "bytes",
    bytes: softMaskType3Fixture(),
    label: "soft-mask-type3.pdf"
  });
  try {
    const page = await softMaskType3.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.equal(page.textIndex.text, "", "soft-mask paint text is not searchable page text");
    const kinds = [];
    await executeHeprDisplayProgram(page, {
      beginCompositeGroup() {},
      endCompositeGroup() {},
      beginProgram(execution) {
        kinds.push(execution.program.kind);
      },
      drawRun() {}
    });
    assert.ok(kinds.includes("form"));
    assert.ok(kinds.includes("type3"));
  } finally {
    await softMaskType3.close();
  }

  // Reusable-program expansion must inspect the accumulator's live glyph
  // columns. Materializing the complete page text for every glyph makes this
  // ordinary repeated-glyph case quadratic in both copying and allocations.
  const repeatedGlyphCount = 1_024;
  const originalUint32ArrayFrom = Uint32Array.from;
  let uint32ArrayFromCalls = 0;
  Uint32Array.from = function (...args) {
    uint32ArrayFromCalls += 1;
    return Reflect.apply(originalUint32ArrayFrom, this, args);
  };
  let repeatedType3;
  try {
    repeatedType3 = await openPdf({
      kind: "bytes",
      bytes: simpleType3Fixture(
        `<${"41".repeat(repeatedGlyphCount)}>`,
        "500 0 d0 0 0 500 500 re f"
      ),
      label: "repeated-type3.pdf"
    });
    const page = await repeatedType3.compilePage(0, { optimization: "none" });
    assert.equal(page.stores.glyphs.glyphIds.length, repeatedGlyphCount);
  } finally {
    await repeatedType3?.close();
    Uint32Array.from = originalUint32ArrayFrom;
  }
  assert.ok(
    uint32ArrayFromCalls < 64,
    `typed-array snapshots must stay bounded; observed ${uint32ArrayFromCalls} Uint32Array.from calls`
  );

  const tooDeep = await openPdf({
    kind: "bytes",
    bytes: deepType3Fixture(65),
    label: "deep-type3.pdf"
  });
  try {
    await assert.rejects(
      tooDeep.compilePage(0, { optimization: "none" }),
      (error) => error?.code === "resource-limit" &&
        error?.details?.reason === "reusable-program-depth"
    );
  } finally {
    await tooDeep.close();
  }

  console.log("PDF session Type3/CharProc integration tests passed");
} finally {
  hooks.deregister();
}

function type3Fixture() {
  const content = [
    "0 0 0 rg",
    "/OC /Visible BDC",
    "BT /T3 20 Tf 1 0 0 1 10 10 Tm <414243454647> Tj ET",
    "EMC",
    "0 1 0 rg BT /T3 12 Tf 1 0 0 1 10 65 Tm <42> Tj ET",
    "/Quarter gs BT /T3 12 Tf 1 0 0 1 10 82 Tm <42> Tj ET",
    "BT /T3 12 Tf 3 Tr 1 0 0 1 10 100 Tm <44> Tj ET"
  ].join("\n");
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties 30 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 160 120] /Resources << /Font << /T3 5 0 R /Unused 99 0 R >> /ExtGState << /Quarter 24 0 R >> /Properties << /Visible 31 0 R >> >> /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", content) },
      {
        number: 5,
        body: [
          "<< /Type /Font /Subtype /Type3 /FontMatrix [.001 0 0 .001 0 0]",
          "/FontBBox [0 0 500 500] /FirstChar 65 /LastChar 71",
          "/Widths [500 500 500 500 500 500 500]",
          "/Encoding << /Differences [65 /Colored /Uncolored /Alias /Broken /Shade /PatternGlyph /Inherited] >>",
          "/CharProcs << /Colored 10 0 R /Uncolored 11 0 R /Alias 10 0 R /Broken 12 0 R /Shade 13 0 R /PatternGlyph 14 0 R /Inherited 15 0 R >>",
          "/Resources 6 0 R /ToUnicode 7 0 R >>"
        ].join(" ")
      },
      {
        number: 6,
        body: "<< /ExtGState << /Half 20 0 R >> /Shading << /S 21 0 R >> /ColorSpace << /Pattern /Pattern >> /Pattern << /P 23 0 R >> /Properties << /Visible 31 0 R >> >>"
      },
      {
        number: 7,
        body: tinyPdfStream("", [
          "1 begincodespacerange <00> <ff> endcodespacerange",
          "7 beginbfchar <41> <03a9> <42> <03b2> <43> <03a9> <44> <00690067006e006f007200650064> <45> <03c3> <46> <03c0> <47> <03b9> endbfchar"
        ].join("\n"))
      },
      {
        number: 10,
        body: tinyPdfStream("", "500 0 d0\n/OC /Visible BDC /Span << /MCID 7 >> BDC /Half gs 1 0 0 rg 0 0 250 500 re f 0 0 1 rg 250 0 250 500 re f EMC EMC")
      },
      { number: 11, body: tinyPdfStream("", "500 0 0 0 500 500 d1\n0 0 500 500 re f") },
      { number: 12, body: tinyPdfStream("", "this malformed unused CharProc must stay lazy") },
      { number: 13, body: tinyPdfStream("", "500 0 d0\n/S sh") },
      { number: 14, body: tinyPdfStream("", "500 0 d0\n/Pattern cs /P scn 0 0 500 500 re f") },
      { number: 15, body: tinyPdfStream("", "500 0 d0\n0 0 500 500 re f") },
      { number: 20, body: "<< /Type /ExtGState /ca .5 >>" },
      { number: 21, body: "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 500 0] /Function 22 0 R >>" },
      { number: 22, body: "<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [1 1 0] /N 1 >>" },
      {
        number: 23,
        body: tinyPdfStream("/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 10 10] /XStep 10 /YStep 10", "0 1 0 rg 0 0 10 10 re f")
      },
      { number: 24, body: "<< /Type /ExtGState /ca .25 >>" },
      { number: 30, body: "<< /OCGs [31 0 R] /D << /BaseState /ON >> >>" },
      { number: 31, body: "<< /Type /OCG /Name (Visible Type3) >>" },
      // Deliberately malformed and unreachable resource entries prove exact laziness.
      { number: 99, body: "not a valid PDF object payload" }
    ]
  });
}

function visibleMalformedFixture() {
  return simpleType3Fixture("<41>", "broken CharProc");
}

function uncoloredColorFixture() {
  return simpleType3Fixture("<41>", "500 0 0 0 500 500 d1 1 0 0 rg 0 0 5 5 re f");
}

function inheritedStrokeFixture() {
  return simpleType3Fixture("<41>", "500 0 d0 2 J 0 0 m 5 5 l S");
}

function scopedResourceLeakFixture() {
  return simpleType3Fixture(
    "<41>",
    "500 0 d0 /Leaked cs 0 0 0 sc 0 0 5 5 re f",
    "",
    [],
    "/ColorSpace << /Leaked /DeviceRGB >>"
  );
}

function usedLocalDefaultFixture() {
  return simpleType3Fixture(
    "<41>",
    "500 0 d0 1 0 0 rg 0 0 5 5 re f",
    "/ColorSpace << /DefaultRGB 9 0 R >>",
    [{ number: 9, body: "<< /NotAColorSpace true >>" }]
  );
}

function metricsOutsideFixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 4 0 R >>" },
      { number: 4, body: tinyPdfStream("", "500 0 d0") }
    ]
  });
}

function type3XObjectFixture() {
  return simpleType3Fixture("<41>", "500 0 d0 /Nested Do", "/XObject << /Nested 9 0 R >>", [
    { number: 9, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 5 5]", "0 0 5 5 re f") }
  ]);
}

function type3NestedTextFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /Font << /T3 5 0 R /Inner 99 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "BT /T3 10 Tf 1 0 0 1 1 1 Tm <41> Tj ET") },
    { number: 5, body: "<< /Type /Font /Subtype /Type3 /FontMatrix [.001 0 0 .001 0 0] /FontBBox [0 0 500 500] /FirstChar 65 /LastChar 65 /Widths [500] /Encoding << /Differences [65 /Glyph] >> /CharProcs << /Glyph 6 0 R >> /Resources << /Font << /Inner 10 0 R >> >> /ToUnicode 7 0 R >>" },
    { number: 6, body: tinyPdfStream("", "500 0 d0 BT /Inner 100 Tf 1 0 0 1 0 0 Tm <42> Tj ET") },
    { number: 7, body: tinyPdfStream("", "1 begincodespacerange <00> <ff> endcodespacerange 1 beginbfchar <41> <0041> endbfchar") },
    { number: 10, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>" },
    { number: 99, body: "not a font" }
  ] });
}

function type3FormCycleFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /Font << /T3 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "BT /T3 10 Tf 1 0 0 1 1 1 Tm <41> Tj ET") },
    { number: 5, body: "<< /Type /Font /Subtype /Type3 /FontMatrix [.001 0 0 .001 0 0] /FontBBox [0 0 500 500] /FirstChar 65 /LastChar 65 /Widths [500] /Encoding << /Differences [65 /Glyph] >> /CharProcs << /Glyph 6 0 R >> /Resources << /XObject << /Nested 9 0 R >> >> >>" },
    { number: 6, body: tinyPdfStream("", "500 0 d0 /Nested Do") },
    { number: 9, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 5 5] /Resources << /Font << /T3 5 0 R >> >>", "BT /T3 2 Tf 1 0 0 1 0 0 Tm <41> Tj ET") }
  ] });
}

function nestedType3Fixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /Font << /Outer 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "BT /Outer 10 Tf 1 0 0 1 1 1 Tm <41> Tj ET") },
    { number: 5, body: "<< /Type /Font /Subtype /Type3 /FontMatrix [.001 0 0 .001 0 0] /FontBBox [0 0 500 500] /FirstChar 65 /LastChar 65 /Widths [500] /Encoding << /Differences [65 /OuterGlyph] >> /CharProcs << /OuterGlyph 6 0 R >> /Resources << /Font << /Inner 8 0 R >> >> /ToUnicode 7 0 R >>" },
    { number: 6, body: tinyPdfStream("", "500 0 d0 BT /Inner 500 Tf 1 0 0 1 0 0 Tm <42> Tj ET") },
    { number: 7, body: tinyPdfStream("", "1 begincodespacerange <00> <ff> endcodespacerange 1 beginbfchar <41> <0041> endbfchar") },
    { number: 8, body: "<< /Type /Font /Subtype /Type3 /FontMatrix [.001 0 0 .001 0 0] /FontBBox [0 0 500 500] /FirstChar 66 /LastChar 66 /Widths [500] /Encoding << /Differences [66 /InnerGlyph] >> /CharProcs << /InnerGlyph 9 0 R >> /Resources << >> >>" },
    { number: 9, body: tinyPdfStream("", "500 0 d0 0 0 500 500 re f") }
  ] });
}

function softMaskType3Fixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /ExtGState << /Mask 20 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "/Mask gs 0 0 10 10 re f") },
    { number: 5, body: "<< /Type /Font /Subtype /Type3 /FontMatrix [.001 0 0 .001 0 0] /FontBBox [0 0 500 500] /FirstChar 65 /LastChar 65 /Widths [500] /Encoding << /Differences [65 /Glyph] >> /CharProcs << /Glyph 6 0 R >> /Resources << >> >>" },
    { number: 6, body: tinyPdfStream("", "500 0 d0 0 0 500 500 re f") },
    { number: 20, body: "<< /Type /ExtGState /SMask << /S /Alpha /G 21 0 R >> >>" },
    { number: 21, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Group << /S /Transparency /CS /DeviceGray >> /Resources << /Font << /T3 5 0 R >> >>", "BT /T3 8 Tf 1 0 0 1 1 1 Tm <41> Tj ET") }
  ] });
}

function deepType3Fixture(depth) {
  const objects = [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /Font << /Root 10 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "BT /Root 8 Tf 1 0 0 1 1 1 Tm <41> Tj ET") }
  ];
  for (let index = 0; index < depth; index += 1) {
    const fontNumber = 10 + index * 2;
    const charProcNumber = fontNumber + 1;
    const nextFontNumber = fontNumber + 2;
    const resources = index + 1 < depth
      ? `/Resources << /Font << /Next ${nextFontNumber} 0 R >> >>`
      : "/Resources << >>";
    const content = index + 1 < depth
      ? "500 0 d0 BT /Next 500 Tf 1 0 0 1 0 0 Tm <41> Tj ET"
      : "500 0 d0 0 0 500 500 re f";
    objects.push({
      number: fontNumber,
      body: `<< /Type /Font /Subtype /Type3 /FontMatrix [.001 0 0 .001 0 0] /FontBBox [0 0 500 500] /FirstChar 65 /LastChar 65 /Widths [500] /Encoding << /Differences [65 /Glyph] >> /CharProcs << /Glyph ${charProcNumber} 0 R >> ${resources} >>`
    });
    objects.push({ number: charProcNumber, body: tinyPdfStream("", content) });
  }
  return writeTinyPdf({ objects });
}

function simpleType3Fixture(text, charProc, resources = "", extraObjects = [], pageResources = "") {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /Font << /T3 5 0 R >> ${pageResources} >> /Contents 4 0 R >>` },
      { number: 4, body: tinyPdfStream("", `BT /T3 10 Tf 1 0 0 1 1 1 Tm ${text} Tj ET`) },
      {
        number: 5,
        body: `<< /Type /Font /Subtype /Type3 /FontMatrix [.001 0 0 .001 0 0] /FontBBox [0 0 500 500] /FirstChar 65 /LastChar 65 /Widths [500] /Encoding << /Differences [65 /Glyph] >> /CharProcs << /Glyph 6 0 R >> /Resources << ${resources} >> >>`
      },
      { number: 6, body: tinyPdfStream("", charProc) },
      ...extraObjects
    ]
  });
}
