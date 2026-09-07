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
  const [
    { openPdf },
    { validateHeprPageData },
    { executeHeprDisplayProgram },
    { HEPR_VIEW_TRANSFORM_FLAG }
  ] =
    await Promise.all([
      import("../src/pdfSession.ts"),
      import("../src/heprDocumentDataValidation.ts"),
      import("../src/heprDisplayExecutor.ts"),
      import("../src/heprDocumentData.ts")
    ]);

  const source = { kind: "bytes", bytes: formFixture(), label: "native-forms.pdf" };
  const session = await openPdf(source);
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);

    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    assert.deepEqual(
      root.commands.map((command) => command.kind),
      [
        "draw",
        "invoke-program",
        "invoke-program",
        "invoke-program",
        "invoke-program",
        "invoke-program"
      ],
      "page content must retain source order and append the visible annotation appearance"
    );
    assert.equal(root.commands[1].programIndex, root.commands[2].programIndex,
      "aliases invoked under the same inherited graphics state must reuse a program");
    assert.notEqual(root.commands[3].programIndex, root.commands[4].programIndex,
      "the same Form under distinct inherited colors must be specialized rather than mispainted");

    const outerProgram = page.displayProgram.programs[root.commands[1].programIndex];
    assert.equal(outerProgram.resourceName, "Outer");
    assert.deepEqual(outerProgram.matrixIndex >= 0, true);
    assert.deepEqual(outerProgram.bounds, [0, 0, 20, 10]);
    assert.equal(outerProgram.clipToBounds, true);
    assert.deepEqual(outerProgram.commands.map((command) => command.kind), ["invoke-group"]);

    const outerGroup = page.displayProgram.groups[outerProgram.commands[0].groupIndex];
    assert.equal(outerGroup.isolated, true);
    assert.equal(outerGroup.knockout, false);
    assert.equal(outerGroup.blendMode, "Normal");
    assert.equal(outerGroup.alpha, 0.5,
      "the caller's nonstroking alpha must apply to the completed transparency group");
    assert.deepEqual(
      outerGroup.commands.map((command) => command.kind),
      ["draw", "invoke-program"]
    );
    assert.equal(page.stores.paints.alphas[outerGroup.commands[0].paintIndex], 1,
      "alpha constants inside a transparency group must start at one");
    const innerProgram = page.displayProgram.programs[outerGroup.commands[1].programIndex];
    assert.equal(innerProgram.resourceName, "Inner");
    assert.deepEqual(innerProgram.bounds, [0, 0, 5, 5]);

    const annotationCommand = root.commands.at(-1);
    const annotationProgram = page.displayProgram.programs[annotationCommand.programIndex];
    assert.equal(annotationProgram.resourceName, "Widget#0");
    assert.deepEqual(annotationProgram.bounds, [0, 0, 10, 10]);
    assert.deepEqual(readTransform(page, annotationCommand.transformIndex), [2, 0, 0, 2, 50, 10]);
    const annotationViewFlags = HEPR_VIEW_TRANSFORM_FLAG.NoZoom |
      HEPR_VIEW_TRANSFORM_FLAG.NoRotate;
    assert.equal(annotationCommand.viewTransformFlags, annotationViewFlags);
    annotationCommand.viewTransformFlags = 4;
    assert.throws(() => validateHeprPageData(page), /unknown view-transform flag/);
    annotationCommand.viewTransformFlags = annotationViewFlags;

    const draws = [];
    const annotationPrograms = [];
    await executeHeprDisplayProgram(page, {
      beginCompositeGroup() {},
      beginProgram(context) {
        if (context.program.resourceName === "Widget#0") {
          annotationPrograms.push([
            context.viewTransformFlags,
            context.state.viewTransformFlags
          ]);
        }
      },
      drawRun(context) {
        draws.push({
          first: context.command.first,
          source: context.command.source,
          transform: [...context.state.transform],
          viewTransformFlags: context.state.viewTransformFlags
        });
      },
      endCompositeGroup() {}
    });
    assert.equal(draws.length, 8);
    assert.deepEqual(draws.map(({ source: kind }) => kind), Array(8).fill("fill-paths"));
    assert.deepEqual(draws[1].transform, [2, 0, 0, 2, 20, 10]);
    assert.deepEqual(draws[2].transform, [2, 0, 0, 2, 30, 10]);
    assert.deepEqual(draws.at(-1).transform, [2, 0, 0, 2, 50, 10]);
    assert.ok(draws.slice(0, -1).every(({ viewTransformFlags }) => viewTransformFlags === 0));
    assert.equal(draws.at(-1).viewTransformFlags, annotationViewFlags);
    assert.deepEqual(annotationPrograms, [[annotationViewFlags, annotationViewFlags]]);

  } finally {
    await session.close();
  }

  await testSynthesizedCheckbox(openPdf, validateHeprPageData);
  await testSynthesizedLinks(openPdf, validateHeprPageData);
  await testFailClosed(openPdf);
  console.log("PDF session Form/annotation display-program tests passed");
} finally {
  hooks.deregister();
}

function formFixture() {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm 9 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: [
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100]",
          "/Resources << /XObject << /Outer 5 0 R /Alias 5 0 R /Tint 16 0 R >> /ExtGState << /Half 17 0 R >> >>",
          "/Contents 4 0 R /Annots [7 0 R 8 0 R] >>"
        ].join(" ")
      },
      {
        number: 4,
        body: tinyPdfStream("", [
          "0.9 g 0 0 100 100 re f",
          "q /Half gs 1 0 0 1 20 10 cm /Outer Do Q",
          "q /Half gs 1 0 0 1 60 10 cm /Alias Do Q",
          "1 0 0 rg q 1 0 0 1 0 40 cm /Tint Do Q",
          "0 0 1 rg q 1 0 0 1 20 40 cm /Tint Do Q"
        ].join("\n"))
      },
      {
        number: 5,
        body: tinyPdfStream(
          [
            "/Type /XObject /Subtype /Form /BBox [0 0 20 10] /Matrix [2 0 0 2 0 0]",
            "/Resources << /XObject << /Inner 6 0 R >> >>",
            "/Group << /S /Transparency /I true /K false /CS /DeviceRGB >>"
          ].join(" "),
          "0 1 0 rg 0 0 5 5 re f q 1 0 0 1 5 0 cm /Inner Do Q"
        )
      },
      {
        number: 6,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 5 5]",
          "0 0 1 rg 0 0 5 5 re f"
        )
      },
      {
        number: 7,
        body: "<< /Type /Annot /Subtype /Widget /Parent 10 0 R /Rect [50 10 70 30] /F 24 /AP << /N 12 0 R >> >>"
      },
      {
        number: 8,
        body: "<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /F 2 >>"
      },
      {
        number: 9,
        body: "<< /Fields [10 0 R] /DR << >> /DA (/Helv 10 Tf) >>"
      },
      {
        number: 10,
        body: "<< /FT /Btn /T (Button) /Kids [7 0 R] >>"
      },
      {
        number: 12,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << >>",
          "1 0 0 rg 0 0 10 10 re f"
        )
      },
      {
        number: 16,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 5 5] /Resources << >>",
          "0 0 5 5 re f"
        )
      },
      {
        number: 17,
        body: "<< /Type /ExtGState /ca 0.5 >>"
      }
    ]
  });
}

async function testFailClosed(openPdf) {
  const bytes = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << >> /Contents 4 0 R /Annots [5 0 R] >>"
      },
      { number: 4, body: tinyPdfStream("", "") },
      { number: 5, body: "<< /Type /Annot /Subtype /Text /Rect [0 0 5 5] >>" }
    ]
  });
  const session = await openPdf({ kind: "bytes", bytes });
  try {
    await assert.rejects(
      session.compilePage(0),
      (error) => error?.code === "unsupported-content" &&
        error?.details?.reason === "appearance-synthesis-not-implemented"
    );
  } finally {
    await session.close();
  }
}

async function testSynthesizedLinks(openPdf, validateHeprPageData) {
  const bytes = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: [
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 80 40] /Resources << >>",
          "/Contents 4 0 R /Annots [5 0 R 6 0 R 7 0 R] >>"
        ].join(" ")
      },
      { number: 4, body: tinyPdfStream("", "") },
      { number: 5, body: "<< /Type /Annot /Subtype /Link /Rect [0 0 20 20] /Border [0 0 0] >>" },
      { number: 6, body: "<< /Type /Annot /Subtype /Link /Rect [25 0 45 20] /Border [0 0 1] /C [] >>" },
      { number: 7, body: "<< /Type /Annot /Subtype /Link /Rect [50 0 70 20] /BS << /W 2 /S /D /D [2 1] >> /C [0 0 1] >>" }
    ]
  });
  const session = await openPdf({ kind: "bytes", bytes });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    assert.deepEqual(
      root.commands.map(({ kind }) => kind),
      ["invoke-program"],
      "only the painting Link border contributes to the ordered display program"
    );
    const program = page.displayProgram.programs[root.commands[0].programIndex];
    assert.equal(program.resourceName, "Link#2");
    assert.deepEqual(readTransform(page, root.commands[0].transformIndex), [1, 0, 0, 1, 50, 0]);
    assert.equal(
      session.getDiagnostics().filter((diagnostic) =>
        diagnostic.code === "annotation.appearance-synthesized" &&
        diagnostic.details?.subtype === "Link"
      ).length,
      1
    );
  } finally {
    await session.close();
  }
}

async function testSynthesizedCheckbox(openPdf, validateHeprPageData) {
  const bytes = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm 7 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 40 40] /Resources << >> /Contents 4 0 R /Annots [5 0 R] >>"
      },
      { number: 4, body: tinyPdfStream("", "") },
      {
        number: 5,
        body: "<< /Type /Annot /Subtype /Widget /Parent 6 0 R /Rect [10 10 30 30] /AS /Yes /MK << /BG [1] /BC [0] >> /BS << /W 1 /S /S >> >>"
      },
      { number: 6, body: "<< /FT /Btn /T (Accepted) /V /Yes /Kids [5 0 R] >>" },
      { number: 7, body: "<< /Fields [6 0 R] >>" }
    ]
  });
  const session = await openPdf({ kind: "bytes", bytes });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    assert.deepEqual(root.commands.map(({ kind }) => kind), ["invoke-program"]);
    assert.equal(page.displayProgram.programs[root.commands[0].programIndex].resourceName, "Widget#0");
    assert.ok(
      session.getDiagnostics().some(({ code }) => code === "annotation.appearance-synthesized"),
      "a synthesized appearance must be visible in stable session diagnostics"
    );
  } finally {
    await session.close();
  }
}

function readTransform(page, index) {
  return [...page.stores.transforms.values.slice(index * 6, index * 6 + 6)];
}
