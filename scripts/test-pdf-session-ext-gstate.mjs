import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

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
  const { HEPR_PAINT_KIND, HEPR_STROKE_FLAG } = dataApi;

  const session = await openPdf({
    kind: "bytes",
    bytes: compositingFixture(),
    label: "native-session-ext-gstate.pdf"
  });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    assert.deepEqual(
      root.commands.map((command) => command.kind),
      ["draw", "invoke-group", "draw", "invoke-group", "invoke-group", "draw"],
      "q/Q restoration and /SMask /None retain exact source positions"
    );

    const alphaGroup = page.displayProgram.groups[root.commands[1].groupIndex];
    assert.equal(alphaGroup.alpha, 0.5);
    assert.equal(alphaGroup.alphaIsShape, true);
    assert.equal(alphaGroup.blendMode, "Normal");
    assert.equal(alphaGroup.softMaskGroupIndex, -1);
    const alphaPaint = alphaGroup.commands[0].paintIndex;
    assert.equal(page.stores.paints.alphas[alphaPaint], 1, "alpha is applied by the group once");
    assert.equal(page.stores.paints.overprint[alphaPaint], 1);
    assert.equal(page.stores.paints.overprintModes[alphaPaint], 1);
    assert.equal(alphaGroup.commands[0].optionalContentIndex, -1);
    assert.equal(alphaGroup.commands[0].markedContentIndex, -1);
    assert.equal(root.commands[1].optionalContentIndex, 0, "scope remains on the wrapped paint invocation");
    assert.equal(root.commands[1].markedContentIndex, 1);
    assert.equal(page.stores.paints.overprint[root.commands[2].paintIndex], 0);

    const multiplyGroup = page.displayProgram.groups[root.commands[3].groupIndex];
    assert.equal(multiplyGroup.alpha, 1);
    assert.equal(multiplyGroup.alphaIsShape, false, "q/Q restores the alpha-source flag");
    assert.equal(multiplyGroup.blendMode, "Multiply", "BM arrays select the first supported fallback");

    const maskedGroup = page.displayProgram.groups[root.commands[4].groupIndex];
    assert.equal(maskedGroup.softMaskSubtype, "Luminosity");
    assert.ok(maskedGroup.softMaskTransferFunctionIndex >= 0);
    const maskGroup = page.displayProgram.groups[maskedGroup.softMaskGroupIndex];
    assert.equal(maskGroup.isolated, true);
    assert.equal(maskGroup.knockout, true);
    assert.ok(maskGroup.blendingColorSpaceIndex >= 0);
    assert.ok(maskGroup.backdropPaintIndex >= 0);
    assert.deepEqual(
      Array.from(page.stores.colors.parameters.slice(
        page.stores.colors.parameterOffsets[
          page.stores.paints.resourceIndices[maskGroup.backdropPaintIndex]
        ],
        page.stores.colors.parameterOffsets[
          page.stores.paints.resourceIndices[maskGroup.backdropPaintIndex] + 1
        ]
      ), (value) => Number(value.toFixed(5))),
      [0.2, 0.3, 0.4]
    );
    assert.equal(maskGroup.commands.length, 1);
    assert.equal(maskGroup.commands[0].kind, "invoke-program");
    const maskProgram = page.displayProgram.programs[maskGroup.commands[0].programIndex];
    assert.equal(maskProgram.kind, "form");
    assert.equal(maskProgram.commands.length, 1);
    assert.equal(maskProgram.commands[0].kind, "invoke-program");
    const nestedMaskProgram = page.displayProgram.programs[maskProgram.commands[0].programIndex];
    assert.equal(nestedMaskProgram.kind, "form");
    assert.equal(nestedMaskProgram.commands[0].kind, "invoke-group");
    assert.ok(nestedMaskProgram.commands[0].clipIndex >= 0);
    assert.equal(
      page.stores.clips.parentIndices[nestedMaskProgram.commands[0].clipIndex],
      -1,
      "pattern geometry no longer adds a synthetic bounding-box clip"
    );
    const nestedPaintGroup = page.displayProgram.groups[nestedMaskProgram.commands[0].groupIndex];
    assert.equal(
      nestedPaintGroup.alpha,
      0.75,
      "soft-mask Form resources use the normal scoped ExtGState compiler"
    );
    assert.equal(nestedPaintGroup.commands[0].kind, "draw");
    assert.equal(nestedPaintGroup.commands[0].source, "paths");
    const nestedPatternPaint = nestedPaintGroup.commands[0].fillPaintIndex;
    assert.equal(page.stores.paints.kinds[nestedPatternPaint], HEPR_PAINT_KIND.Pattern);
    assert.ok(
      page.stores.patterns.gradientIndices[
        page.stores.paints.resourceIndices[nestedPatternPaint]
      ] >= 0
    );

    const events = [];
    await executeHeprDisplayProgram(page, {
      beginCompositeGroup(execution) {
        events.push(`begin:${execution.role}:${execution.blendMode}:${execution.alpha}`);
      },
      drawRun(execution) {
        events.push(`draw:${execution.command.source}:${execution.sequence}`);
      },
      endCompositeGroup(execution) {
        events.push(`end:${execution.role}:${execution.blendMode}:${execution.alpha}`);
      }
    });
    assert.equal(events.filter((event) => event.startsWith("draw:")).length, 7);
    assert.ok(events.some((event) => event.startsWith("begin:soft-mask:Normal:1")));

  } finally {
    await session.close();
  }

  const alphaMaskSession = await openPdf({
    kind: "bytes",
    bytes: compositingFixture("Alpha"),
    label: "native-session-alpha-soft-mask.pdf"
  });
  try {
    const page = await alphaMaskSession.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.ok(page.displayProgram.groups.some((group) => group.softMaskSubtype === "Alpha"));
  } finally {
    await alphaMaskSession.close();
  }

  const strokeAdjustSession = await openPdf({
    kind: "bytes",
    bytes: unsupportedStateFixture("/SA true", "0 0 m 5 0 l S"),
    label: "stroke-adjust.pdf"
  });
  try {
    const page = await strokeAdjustSession.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.equal(page.stores.strokes.lineWidths.length, 1);
    assert.ok((page.stores.strokes.flags[0] & HEPR_STROKE_FLAG.StrokeAdjust) !== 0);
  } finally {
    await strokeAdjustSession.close();
  }

  for (const [name, bytes, expected] of [
    ["missing-used", missingUsedFixture(), /Unknown ExtGState resource \/Missing/],
    ["soft-mask-cycle", softMaskCycleFixture(), /soft-mask graph is cyclic/]
  ]) {
    const failing = await openPdf({ kind: "bytes", bytes, label: `${name}.pdf` });
    try {
      await assert.rejects(
        failing.compilePage(0, { optimization: "none" }),
        (error) => error?.code === "unsupported-content" && expected.test(error.message)
      );
    } finally {
      await failing.close();
    }
  }

  console.log("PDF session ExtGState/transparency integration tests passed");
} finally {
  hooks.deregister();
}

function compositingFixture(maskSubtype = "Luminosity") {
  const content = [
    "0 g 0 0 5 5 re f",
    "q /Alpha gs /OC /Visible BDC /Span << /MCID 3 >> BDC 1 0 0 rg 10 0 5 5 re f EMC EMC Q",
    "0 1 0 rg 20 0 5 5 re f",
    "q /Blend gs 0 0 1 rg 30 0 5 5 re f Q",
    "q /Mask gs .5 g 40 0 5 5 re f /Clear gs 50 0 5 5 re f Q"
  ].join("\n");
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties 20 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /ExtGState << /Alpha 5 0 R /Blend 6 0 R /Mask 7 0 R /Clear 8 0 R /Unused 99 0 R >> /Properties << /Visible 21 0 R >> >> /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", content) },
      { number: 5, body: "<< /Type /ExtGState /ca .5 /AIS true /op true /OPM 1 /RI /Perceptual /FL 2 /SM .5 >>" },
      { number: 6, body: "<< /Type /ExtGState /BM [/UnknownBlend /Multiply] >>" },
      { number: 7, body: `<< /Type /ExtGState /SMask << /Type /Mask /S /${maskSubtype} /G 10 0 R /BC [.2 .3 .4] /TR 12 0 R >> >>` },
      { number: 8, body: "<< /Type /ExtGState /SMask /None >>" },
      {
        number: 10,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 5 5] /Group << /Type /Group /S /Transparency /CS /DeviceRGB /I true /K true >> /Resources << /XObject << /Nested 13 0 R >> >>",
          "/Nested Do"
        )
      },
      { number: 11, body: "<< /Type /ExtGState /ca .75 >>" },
      { number: 12, body: "<< /FunctionType 2 /Domain [0 1] /Range [0 1] /C0 [0] /C1 [1] /N 1 >>" },
      {
        number: 13,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 5 5] /Resources << /ExtGState << /Inner 11 0 R >> /ColorSpace << /Pattern /Pattern >> /Pattern << /MaskPattern 14 0 R >> >>",
          "0 0 m 5 0 l 2.5 5 l h W n /Inner gs /Pattern cs /MaskPattern scn 0 0 5 5 re f"
        )
      },
      { number: 14, body: "<< /Type /Pattern /PatternType 2 /Shading 15 0 R >>" },
      { number: 15, body: "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 5 0] /Function 16 0 R >>" },
      { number: 16, body: "<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [1 1 1] /N 1 >>" },
      { number: 20, body: "<< /OCGs [21 0 R] /D << /BaseState /ON >> >>" },
      { number: 21, body: "<< /Type /OCG /Name (Visible compositing) >>" }
    ]
  });
}

function missingUsedFixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /ExtGState << >> >> /Contents 4 0 R >>" },
      { number: 4, body: tinyPdfStream("", "/Missing gs 0 0 5 5 re f") }
    ]
  });
}

function unsupportedStateFixture(entries, paint = "0 0 5 5 re f") {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /ExtGState << /State 5 0 R >> >> /Contents 4 0 R >>" },
      { number: 4, body: tinyPdfStream("", `/State gs ${paint}`) },
      { number: 5, body: `<< /Type /ExtGState ${entries} >>` }
    ]
  });
}

function softMaskCycleFixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /ExtGState << /Mask 5 0 R >> >> /Contents 4 0 R >>" },
      { number: 4, body: tinyPdfStream("", "/Mask gs 0 0 5 5 re f") },
      { number: 5, body: "<< /Type /ExtGState /SMask << /S /Alpha /G 6 0 R >> >>" },
      {
        number: 6,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 5 5] /Group << /S /Transparency >>",
          "/Mask gs 0 0 5 5 re f"
        )
      }
    ]
  });
}
