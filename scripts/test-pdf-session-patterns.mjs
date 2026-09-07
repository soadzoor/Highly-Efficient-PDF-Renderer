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
  const [sessionApi, dataApi, validationApi, executorApi] = await Promise.all([
    import("../src/pdfSession.ts"),
    import("../src/heprDocumentData.ts"),
    import("../src/heprDocumentDataValidation.ts"),
    import("../src/heprDisplayExecutor.ts")
  ]);
  const { openPdf } = sessionApi;
  const { HEPR_PAINT_KIND, HEPR_PATTERN_KIND } = dataApi;
  const { validateHeprPageData } = validationApi;
  const { executeHeprDisplayProgram, resolveHeprPatternPaint } = executorApi;

  const session = await openPdf({
    kind: "bytes",
    bytes: patternFixture(),
    label: "native-session-patterns.pdf"
  });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.deepEqual(
      [...page.stores.patterns.kinds],
      [
        HEPR_PATTERN_KIND.ColoredTiling,
        HEPR_PATTERN_KIND.Shading,
        HEPR_PATTERN_KIND.ColoredTiling
      ],
      "only source-referenced page/Form patterns are resolved"
    );
    assert.equal(page.stores.gradients.kinds.length, 1);
    assert.deepEqual([...page.stores.patterns.gradientIndices], [-1, 0, -1]);
    assert.equal(page.stores.patterns.programIndices[1], -1);

    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    assert.deepEqual(
      root.commands.map((command) => command.kind === "draw" ? command.source : command.kind),
      ["fill-paths", "paths", "paths", "invoke-program", "fill-paths"]
    );
    assert.deepEqual(
      root.commands.slice(1, 3).map((command) => patternIndexForCommand(page, command)),
      [0, 1]
    );
    assert.equal(
      resolveHeprPatternPaint(page, root.commands[0].paintIndex),
      null,
      "the resolver leaves ordinary paints alone"
    );
    const resolvedTile = resolveHeprPatternPaint(
      page,
      patternPaintIndexForCommand(root.commands[1])
    );
    assert.equal(resolvedTile.kind, "colored-tiling");
    assert.deepEqual(resolvedTile.useTransform, [2, 0, 0, 2, 5, 5]);
    assert.deepEqual(resolvedTile.resourceTransform, [1, 0, 0, 1, 1, 2]);
    assert.deepEqual(resolvedTile.patternToOwnerTransform, [2, 0, 0, 2, 7, 9]);
    assert.ok(resolvedTile.programIndex >= 0);
    assert.equal(resolvedTile.gradientIndex, -1);
    assert.equal(resolvedTile.basePaintIndex, -1);
    const resolvedShading = resolveHeprPatternPaint(
      page,
      patternPaintIndexForCommand(root.commands[2])
    );
    assert.equal(resolvedShading.kind, "shading");
    assert.deepEqual(resolvedShading.patternToOwnerTransform, [1, 0, 0, 1, 3, 4]);
    assert.equal(resolvedShading.programIndex, -1);
    assert.ok(resolvedShading.gradientIndex >= 0);
    assert.deepEqual(
      readTransform(page, patternTransformForCommand(page, root.commands[1])),
      [2, 0, 0, 2, 5, 5]
    );
    assert.deepEqual(readPathBounds(page, root.commands[1].first), [5, 5, 25, 25]);
    assert.equal(root.commands[1].clipIndex, -1, "the source path is exact; no bbox clip is synthesized");
    assert.equal(root.commands[2].optionalContentIndex, 0);
    assert.equal(root.commands[2].markedContentIndex, 1);
    assert.deepEqual(page.stores.markedContent.tags.slice(0, 2), ["OC", "Span"]);
    assert.deepEqual([...page.stores.markedContent.mcids.slice(0, 2)], [-1, 7]);

    const form = page.displayProgram.programs[root.commands[3].programIndex];
    assert.equal(form.kind, "form");
    assert.deepEqual(
      form.commands.map((command) => command.kind === "draw" ? command.source : command.kind),
      ["paths"]
    );
    assert.equal(
      patternIndexForCommand(page, form.commands[0]),
      2,
      "Form-local /Tile shadows the page pattern"
    );

    const tilingPrograms = page.displayProgram.programs.filter((program) => program.kind === "pattern");
    assert.equal(tilingPrograms.length, 2);
    assert.deepEqual(tilingPrograms.map((program) => drawSource(page, program.commands[0])), [
      "paths",
      "fill-paths"
    ]);
    const pageCellGroup = page.displayProgram.groups[tilingPrograms[0].commands[0].groupIndex];
    assert.equal(pageCellGroup.alpha, 0.6, "tiling-cell ExtGState uses its local resource scope");
    assert.ok(tilingPrograms[0].commands[0].clipIndex >= 0);
    assert.equal(pageCellGroup.commands[0].source, "paths");
    assert.deepEqual(
      readTransform(page, page.stores.patterns.matrixIndices[0]),
      [1, 0, 0, 1, 1, 2]
    );
    assert.notEqual(
      page.stores.patterns.programIndices[0],
      page.stores.patterns.programIndices[2]
    );

    const draws = [];
    await executeHeprDisplayProgram(page, {
      beginCompositeGroup() {},
      drawRun(execution) {
        draws.push([execution.command.source, execution.command.first]);
      },
      endCompositeGroup() {}
    });
    assert.deepEqual(draws, [
      ["fill-paths", 0],
      ["paths", root.commands[1].first],
      ["paths", root.commands[2].first],
      ["paths", form.commands[0].first],
      ["fill-paths", 1]
    ]);

  } finally {
    await session.close();
  }

  const shadingStateSession = await openPdf({
    kind: "bytes",
    bytes: failureFixture("extgstate"),
    label: "shading-pattern-extgstate.pdf"
  });
  try {
    const page = await shadingStateSession.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    assert.equal(root.commands.length, 1);
    assert.equal(root.commands[0].kind, "invoke-group");
    const group = page.displayProgram.groups[root.commands[0].groupIndex];
    assert.equal(group.alpha, 0.5);
    assert.equal(group.blendMode, "Normal");
    assert.equal(group.commands[0].kind, "draw");
    assert.equal(group.commands[0].source, "paths");
    assert.equal(
      page.stores.paints.kinds[group.commands[0].fillPaintIndex],
      HEPR_PAINT_KIND.Pattern
    );
  } finally {
    await shadingStateSession.close();
  }

  for (const name of ["uncolored", "uncolored-stroke", "arbitrary", "stroke"]) {
    const exact = await openPdf({
      kind: "bytes",
      bytes: failureFixture(name),
      label: `${name}.pdf`
    });
    try {
      const page = await exact.compilePage(0, { optimization: "none" });
      validateHeprPageData(page);
      const command = singleRootDraw(page);
      assert.equal(command.source, "paths");
      const paintIndex = patternPaintIndexForCommand(command);
      assert.equal(page.stores.paints.kinds[paintIndex], HEPR_PAINT_KIND.Pattern);
      assert.ok(page.stores.paints.patternTransformIndices[paintIndex] >= 0);
      if (name === "stroke" || name === "uncolored-stroke") {
        assert.equal(command.fillPaintIndex, -1);
        assert.ok(command.strokePaintIndex >= 0);
        assert.ok(command.strokeStyleIndex >= 0);
      } else {
        assert.ok(command.fillPaintIndex >= 0);
        assert.equal(command.strokePaintIndex, -1);
      }
      if (name === "arbitrary") {
        assert.equal(page.stores.paths.flags[command.first] & 1, 1);
        assert.equal(page.stores.paths.pathVerbOffsets[command.first + 1] -
          page.stores.paths.pathVerbOffsets[command.first], 4);
        assert.ok(command.clipIndex >= 0, "an arbitrary pattern path retains its prior exact clip");
        assert.equal(page.stores.clips.fillRules[command.clipIndex], 1);
      }
      if (name === "uncolored" || name === "uncolored-stroke") {
        const patternIndex = page.stores.paints.resourceIndices[paintIndex];
        assert.equal(page.stores.patterns.kinds[patternIndex], HEPR_PATTERN_KIND.UncoloredTiling);
        const basePaintIndex = page.stores.paints.patternBasePaintIndices[paintIndex];
        assert.ok(basePaintIndex >= 0 && basePaintIndex < paintIndex);
        assert.equal(page.stores.paints.kinds[basePaintIndex], HEPR_PAINT_KIND.SolidColor);
        if (name === "uncolored-stroke") {
          const colorIndex = page.stores.paints.resourceIndices[basePaintIndex];
          assert.deepEqual(
            [...page.stores.colors.parameters.slice(
              page.stores.colors.parameterOffsets[colorIndex],
              page.stores.colors.parameterOffsets[colorIndex + 1]
            )],
            [0, 0, 1],
            "an uncolored pattern stroke binds the stroking base color"
          );
        }
        page.stores.paints.patternBasePaintIndices[paintIndex] = -1;
        assert.throws(
          () => validateHeprPageData(page),
          /uncolored tiling pattern requires a preceding opaque solid base-color paint/
        );
        assert.throws(
          () => resolveHeprPatternPaint(page, paintIndex),
          (error) => error?.code === "display.invalid-resource"
        );
        page.stores.paints.patternBasePaintIndices[paintIndex] = basePaintIndex;
        const resolved = resolveHeprPatternPaint(page, paintIndex);
        assert.equal(resolved.kind, "uncolored-tiling");
        assert.equal(resolved.basePaintIndex, basePaintIndex);
        assert.ok(resolved.programIndex >= 0);
        const programIndex = page.stores.patterns.programIndices[patternIndex];
        const program = page.displayProgram.programs[programIndex];
        assert.equal(program.kind, "pattern");
        const cellDraw = drawCommand(page, program.commands[0]);
        assert.equal(cellDraw.paintIndex, -1, "PaintType 2 cell inherits the per-use base color");

      }
    } finally {
      await exact.close();
    }
  }

  const combinedSession = await openPdf({
    kind: "bytes",
    bytes: failureFixture("fill-stroke"),
    label: "pattern-fill-stroke.pdf"
  });
  try {
    const page = await combinedSession.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    assert.equal(root.commands.length, 2, "a combined PDF paint preserves fill-before-stroke order");
    const [fill, stroke] = root.commands.map((command) => drawCommand(page, command));
    assert.equal(fill.source, "paths");
    assert.equal(stroke.source, "paths");
    assert.equal(fill.first, stroke.first, "fill and stroke retain the same exact source path");
    assert.equal(fill.fillRule, 1);
    assert.equal(fill.fillPaintIndex >= 0, true);
    assert.equal(fill.strokePaintIndex, -1);
    assert.equal(stroke.fillPaintIndex, -1);
    assert.equal(stroke.strokePaintIndex >= 0, true);
    assert.equal(stroke.strokeStyleIndex >= 0, true);
    assert.deepEqual(
      [...page.stores.strokes.dashValues.slice(
        page.stores.strokes.dashOffsets[stroke.strokeStyleIndex],
        page.stores.strokes.dashOffsets[stroke.strokeStyleIndex + 1]
      )],
      [2, 1]
    );
  } finally {
    await combinedSession.close();
  }

  const nestedRequests = [];
  const nestedContent = await openPdf(
    { kind: "bytes", bytes: nestedPatternContentFixture(), label: "pattern-nested-content.pdf" },
    {
      missingFontResolver(request) {
        nestedRequests.push(request.baseFont);
        return { sfntBytes: substituteSfnt, identifier: "pattern-nested-content-v1" };
      }
    }
  );
  try {
    const page = await nestedContent.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.equal(page.textIndex.text, "", "repeated pattern-cell paint text is not indexed");
    assert.deepEqual(nestedRequests.sort(), ["Courier", "Times-Roman"]);
    const patternIndex = page.stores.patterns.kinds.findIndex(
      (kind) => kind === HEPR_PATTERN_KIND.UncoloredTiling
    );
    const cell = page.displayProgram.programs[page.stores.patterns.programIndices[patternIndex]];
    assert.equal(cell.kind, "pattern");
    const cellGlyph = cell.commands.find((command) =>
      command.kind === "draw" && command.source === "glyphs"
    );
    const formInvocation = cell.commands.find((command) => command.kind === "invoke-program");
    assert.equal(cellGlyph?.fillPaintIndex, -1, "PaintType 2 text inherits the use-time base paint");
    assert.ok(formInvocation);
    const nestedForm = page.displayProgram.programs[formInvocation.programIndex];
    assert.equal(nestedForm.kind, "form");
    const nestedDraws = flattenProgramCommands(page, nestedForm.commands)
      .filter((command) => command.kind === "draw");
    assert.ok(nestedDraws.some((command) =>
      command.source === "glyphs" && command.fillPaintIndex === -1
    ));
    assert.ok(nestedDraws.some((command) =>
      (command.source === "fill-paths" && command.paintIndex === -1) ||
      (command.source === "paths" && command.fillPaintInherited === true)
    ));
  } finally {
    await nestedContent.close();
  }

  const patternType3 = await openPdf({
    kind: "bytes",
    bytes: patternType3Fixture(),
    label: "pattern-type3.pdf"
  });
  try {
    const page = await patternType3.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.equal(page.textIndex.text, "");
    const patternIndex = page.stores.patterns.kinds.findIndex(
      (kind) => kind === HEPR_PATTERN_KIND.UncoloredTiling
    );
    const cell = page.displayProgram.programs[page.stores.patterns.programIndices[patternIndex]];
    const invocation = cell.commands.find((command) => command.kind === "invoke-program");
    assert.ok(invocation);
    assert.equal(invocation.type3PaintIndex, -1);
    const charProc = page.displayProgram.programs[invocation.programIndex];
    assert.equal(charProc.kind, "type3");
    assert.ok(charProc.commands.some((command) =>
      command.kind === "draw" &&
      ((command.source === "fill-paths" && command.paintIndex === -1) ||
        (command.source === "paths" && command.fillPaintInherited === true))
    ));
  } finally {
    await patternType3.close();
  }

  for (const [name, fixture, message] of [
    ["uncolored-color", () => failureFixture("uncolored-color"), /cannot use color operator/],
    ["cycle", patternCycleFixture, /invocation cycle/],
    ["form-cycle", patternFormCycleFixture, /display-program graph is cyclic/]
  ]) {
    const failing = await openPdf({ kind: "bytes", bytes: fixture(), label: `${name}.pdf` });
    try {
      await assert.rejects(
        failing.compilePage(0, { optimization: "none" }),
        (error) => error?.code === "unsupported-content" && message.test(error.message)
      );
    } finally {
      await failing.close();
    }
  }

  console.log("PDF session ordered pattern-program tests passed");
} finally {
  hooks.deregister();
}

function patternFixture() {
  const content = [
    "0 0 5 5 re f",
    "q 2 0 0 2 5 5 cm /Pattern cs /Tile scn 0 0 10 10 re f Q",
    "/OC /Visible BDC /Span << /MCID 7 >> BDC /Pattern cs /Shade scn 30 10 20 10 re f EMC EMC",
    "/OC /Hidden BDC /Pattern cs /Tile scn 0 0 10 10 re f EMC",
    "0 g",
    "q 1 0 0 1 60 10 cm /PatternForm Do Q",
    "0 0 1 rg 90 0 5 5 re f"
  ].join("\n");
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties 30 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: [
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100]",
          "/Resources << /ColorSpace << /Pattern /Pattern >>",
          "/Properties << /Visible 31 0 R /Hidden 32 0 R >>",
          "/Pattern << /Tile 10 0 R /Shade 11 0 R /Unused 99 0 R >>",
          "/XObject << /PatternForm 20 0 R >> >> /Contents 4 0 R >>"
        ].join(" ")
      },
      { number: 4, body: tinyPdfStream("", content) },
      {
        number: 10,
        body: tinyPdfStream(
          "/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 4 4] /XStep 4 /YStep 4 /Matrix [1 0 0 1 1 2] /Resources << /ExtGState << /CellAlpha 14 0 R >> >>",
          "0 0 4 4 re W n /CellAlpha gs 1 0 0 rg 0 0 m 2 0 l 1 2 l h f"
        )
      },
      {
        number: 11,
        body: "<< /Type /Pattern /PatternType 2 /Matrix [1 0 0 1 3 4] /Shading 12 0 R >>"
      },
      {
        number: 12,
        body: "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 10 0] /Function 13 0 R >>"
      },
      {
        number: 13,
        body: "<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [1 1 1] /N 1 >>"
      },
      { number: 14, body: "<< /Type /ExtGState /ca .6 >>" },
      {
        number: 20,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Resources << /ColorSpace << /Pattern /Pattern >> /Pattern << /Tile 21 0 R >> >>",
          "/Pattern cs /Tile scn 1 2 6 7 re f"
        )
      },
      {
        number: 21,
        body: tinyPdfStream(
          "/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 2 /BBox [0 0 3 3] /XStep 3 /YStep 3 /Resources << >>",
          "0 0 1 rg 0 0 3 3 re f"
        )
      },
      { number: 30, body: "<< /OCGs [31 0 R 32 0 R] /D << /BaseState /ON /OFF [32 0 R] >> >>" },
      { number: 31, body: "<< /Type /OCG /Name (Visible pattern) >>" },
      { number: 32, body: "<< /Type /OCG /Name (Hidden pattern) >>" }
    ]
  });
}

function nestedPatternContentFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /ColorSpace << /PC [/Pattern /DeviceRGB] >> /Pattern << /P 5 0 R >> /Font << /F 99 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "/PC cs 1 0 0 /P scn 0 0 20 20 re f") },
    { number: 5, body: tinyPdfStream("/Type /Pattern /PatternType 1 /PaintType 2 /TilingType 1 /BBox [0 0 5 5] /XStep 5 /YStep 5 /Resources << /Font << /F 10 0 R >> /XObject << /Nested 20 0 R >> >>", "BT /F 2 Tf 1 0 0 1 0 2 Tm <41> Tj ET /Nested Do") },
    { number: 10, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>" },
    { number: 11, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>" },
    { number: 20, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 5 5] /Resources << /Font << /F 11 0 R >> >>", "BT /F 2 Tf 1 0 0 1 2 2 Tm <42> Tj ET 0 0 1 1 re f") },
    { number: 99, body: "not a font" }
  ] });
}

function patternType3Fixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /ColorSpace << /PC [/Pattern /DeviceRGB] >> /Pattern << /P 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "/PC cs 0 0 1 /P scn 0 0 10 10 re f") },
    { number: 5, body: tinyPdfStream("/Type /Pattern /PatternType 1 /PaintType 2 /TilingType 1 /BBox [0 0 2 2] /XStep 2 /YStep 2 /Resources << /Font << /T3 10 0 R >> >>", "BT /T3 2 Tf 1 0 0 1 0 0 Tm <41> Tj ET") },
    { number: 10, body: "<< /Type /Font /Subtype /Type3 /FontMatrix [.001 0 0 .001 0 0] /FontBBox [0 0 500 500] /FirstChar 65 /LastChar 65 /Widths [500] /Encoding << /Differences [65 /Glyph] >> /CharProcs << /Glyph 11 0 R >> /Resources << >> >>" },
    { number: 11, body: tinyPdfStream("", "500 0 d0 0 0 500 500 re f") }
  ] });
}

function failureFixture(kind) {
  const shading = kind === "extgstate";
  const uncolored = kind === "uncolored" || kind === "uncolored-stroke" ||
    kind === "uncolored-color";
  let content = "/Pattern cs /P scn 0 0 8 8 re f";
  if (kind === "uncolored-stroke") {
    content = "/UPat CS 0 0 1 /P SCN 0 0 8 8 re S";
  } else if (kind === "stroke") {
    content = "/Pattern CS /P SCN 0 0 8 8 re S";
  } else if (kind === "fill-stroke") {
    content = "/Pattern cs /P scn /Pattern CS /P SCN 2 w 1 j 2 J 5 M [2 1] .5 d " +
      "1 1 m 9 1 l 9 9 l 1 9 l h 3 3 4 4 re B*";
  } else if (uncolored) {
    content = "/UPat cs 1 0 0 /P scn 0 0 8 8 re f";
  } else if (kind === "arbitrary") {
    content = "q 1 1 6 6 re W* n /Pattern cs /P scn 0 0 m 8 0 l 4 8 l h f Q";
  }
  const pattern = shading
    ? "<< /Type /Pattern /PatternType 2 /Shading 7 0 R /ExtGState << /ca .5 >> >>"
    : tinyPdfStream(
        `/Type /Pattern /PatternType 1 /PaintType ${uncolored ? 2 : 1} /TilingType 1 /BBox [0 0 2 2] /XStep 2 /YStep 2 /Resources << >>`,
        kind === "uncolored-color" ? "1 0 0 rg 0 0 2 2 re f" : "0 0 2 2 re f"
      );
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /ColorSpace << /Pattern /Pattern /UPat [/Pattern /DeviceRGB] >> /Pattern << /P 5 0 R >> >> /Contents 4 0 R >>`
      },
      { number: 4, body: tinyPdfStream("", content) },
      { number: 5, body: pattern },
      {
        number: 7,
        body: "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 1 0] /Function 8 0 R >>"
      },
      {
        number: 8,
        body: "<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [1 1 1] /N 1 >>"
      }
    ]
  });
}

function patternCycleFixture() {
  const pattern = (target) => tinyPdfStream(
    `/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 2 2] /XStep 2 /YStep 2 /Resources << /ColorSpace << /Pattern /Pattern >> /Pattern << /Next ${target} 0 R >> >>`,
    "/Pattern cs /Next scn 0 0 2 2 re f"
  );
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /ColorSpace << /Pattern /Pattern >> /Pattern << /P 5 0 R >> >> /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", "/Pattern cs /P scn 0 0 8 8 re f") },
      { number: 5, body: pattern(6) },
      { number: 6, body: pattern(5) }
    ]
  });
}

function patternFormCycleFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /ColorSpace << /Pattern /Pattern >> /Pattern << /P 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "/Pattern cs /P scn 0 0 8 8 re f") },
    { number: 5, body: tinyPdfStream("/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 2 2] /XStep 2 /YStep 2 /Resources << /XObject << /Nested 6 0 R >> >>", "/Nested Do") },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 2 2] /Resources << /ColorSpace << /Pattern /Pattern >> /Pattern << /P 5 0 R >> >>", "/Pattern cs /P scn 0 0 2 2 re f") }
  ] });
}

function drawSource(page, command) {
  return drawCommand(page, command).source;
}

function flattenProgramCommands(page, commands) {
  return commands.flatMap((command) => command.kind === "invoke-group"
    ? flattenProgramCommands(page, page.displayProgram.groups[command.groupIndex].commands)
    : [command]);
}

function drawCommand(page, command) {
  if (command.kind === "draw") return command;
  assert.equal(command.kind, "invoke-group");
  const group = page.displayProgram.groups[command.groupIndex];
  assert.equal(group.commands.length, 1);
  return drawCommand(page, group.commands[0]);
}

function singleRootDraw(page) {
  const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
  assert.equal(root.commands.length, 1);
  return drawCommand(page, root.commands[0]);
}

function readTransform(page, index) {
  return [...page.stores.transforms.values.slice(index * 6, index * 6 + 6)]
    .map((value) => Object.is(value, -0) ? 0 : value);
}

function patternPaintIndexForCommand(command) {
  assert.equal(command.kind, "draw");
  assert.equal(command.source, "paths");
  const paintIndex = command.fillPaintIndex >= 0
    ? command.fillPaintIndex
    : command.strokePaintIndex;
  assert.ok(paintIndex >= 0);
  return paintIndex;
}

function patternIndexForCommand(page, command) {
  const paintIndex = patternPaintIndexForCommand(command);
  return page.stores.paints.resourceIndices[paintIndex];
}

function patternTransformForCommand(page, command) {
  const paintIndex = patternPaintIndexForCommand(command);
  return page.stores.paints.patternTransformIndices[paintIndex];
}

function readPathBounds(page, pathIndex) {
  return [...page.stores.paths.bounds.slice(pathIndex * 4, pathIndex * 4 + 4)];
}
