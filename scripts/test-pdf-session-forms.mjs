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
  const session = await openPdf(source, { limits: { maxCachedObjects: 1 } });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert(page.displayProgram.programs.length > 1, "an object-cache eviction target does not cap retained Form programs");

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
  await testSynthesizedSquares(openPdf, validateHeprPageData);
  await testSynthesizedSquareUnderlines(openPdf, validateHeprPageData);
  await testSynthesizedNote(openPdf);
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

async function testSynthesizedNote(openPdf) {
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
    const page = await session.compilePage(0);
    assert.equal(page.annotations[0].subtype, "Text");
    assert.equal(page.displayProgram.programs.length, 1);
    assert.equal(page.textIndex.text, "");
    assert(session.getDiagnostics().some(d => d.code === "annotation.appearance-synthesized"));
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

async function testSynthesizedSquares(openPdf, validateHeprPageData) {
  const nonpainting = [
    "<< /Subtype /Square /Rect [938 2102 925 2158] /Border [0 0 0] /F 64 >>",
    "<< /Subtype /Square /Rect [0 0 40 20] /BS << /W 2 /S /U >> /CA 0 /BE << /S /C /I 2 >> >>"
  ];
  const bytes = squareSessionFixture([
    ...nonpainting,
    "<< /Subtype /Square /Rect [50 0 90 20] /Border [0 0 0] /IC [1 0 0] /RD [2 3 4 5] >>",
    // Existing /AP takes precedence even over malformed synthesis settings.
    "<< /Subtype /Square /Rect [100 0 140 20] /AP << /N 90 0 R >> /BS << /W 2 /S /U >> /BE << /S /C /I 3 >> >>"
  ]);
  const session = await openPdf({ kind: "bytes", bytes });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    assert.deepEqual(root.commands.map(({ kind }) => kind), ["invoke-program", "invoke-program"]);
    const insetProgram = page.displayProgram.programs[root.commands[0].programIndex];
    assert.equal(insetProgram.resourceName, "Square#2");
    assert.deepEqual(insetProgram.bounds, [0, 0, 40, 20]);
    assert.deepEqual(readTransform(page, root.commands[0].transformIndex), [1, 0, 0, 1, 50, 0]);
    const fill = insetProgram.commands.find((command) => command.kind === "draw" && command.source === "fill-paths");
    assert.ok(fill);
    const offset = fill.first * 4;
    assert.deepEqual([
      page.stores.paths.fillPathMetaA[offset + 2],
      page.stores.paths.fillPathMetaA[offset + 3],
      page.stores.paths.fillPathMetaB[offset],
      page.stores.paths.fillPathMetaB[offset + 1]
    ], [2, 5, 36, 17], "/RD changes the painted path without changing the appearance placement scale");
    assert.equal(page.displayProgram.programs[root.commands[1].programIndex].resourceName, "Square#3");
    assert.equal(session.getDiagnostics().filter(({ code }) => code === "annotation.appearance-synthesized").length, 1);
  } finally {
    await session.close();
  }

  const emptySession = await openPdf({ kind: "bytes", bytes: squareSessionFixture(nonpainting) });
  try {
    const page = await emptySession.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.equal(page.displayProgram.groups[page.displayProgram.rootGroupIndex].commands.length, 0);
    const scene = await emptySession.compileVectorPage(0, { optimization: "none" });
    assert.equal(scene.fillPathCount, 0);
    assert.equal(scene.segmentCount, 0);
  } finally {
    await emptySession.close();
  }

  for (const [entries, reason] of [
    ["/BS << /W 2 /S /S >> /BE << /S /Unknown >>", "appearance-square-border-effect-unsupported"],
    ["/BS << /W 2 /S /U >> /BE << /S /Unknown >>", "appearance-square-border-effect-unsupported"]
  ]) {
    const failingSession = await openPdf({
      kind: "bytes",
      bytes: squareSessionFixture([`<< /Subtype /Square /Rect [0 0 40 20] ${entries} >>`])
    });
    try {
      for (const method of ["compilePage", "compileVectorPage"]) {
        await assert.rejects(
          failingSession[method](0, { optimization: "none" }),
          (error) => error?.code === "unsupported-content" && error?.details?.reason === reason,
          `${method} must reject unsupported Square border semantics`
        );
      }
    } finally {
      await failingSession.close();
    }
  }
}

async function testSynthesizedSquareUnderlines(openPdf, validateHeprPageData) {
  const session = await openPdf({
    kind: "bytes",
    bytes: squareSessionFixture([
      "<< /Subtype /Square /Rect [50 10 90 30] /BS << /W 4 /S /U >> /C [0 0 1] /IC [1 0 0] /RD [2 3 4 5] >>",
      "<< /Subtype /Square /Rect [100 10 140 30] /BS << /S /U >> >>"
    ])
  });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    assert.deepEqual(root.commands.map(({ kind }) => kind), ["invoke-program", "invoke-program"]);
    const filled = page.displayProgram.programs[root.commands[0].programIndex];
    const unfilled = page.displayProgram.programs[root.commands[1].programIndex];
    assert.deepEqual(filled.commands.map(({ source }) => source), ["fill-paths", "stroke-segments"],
      "the interior is filled before the bottom border is stroked");
    assert.deepEqual(unfilled.commands.map(({ source }) => source), ["stroke-segments"]);
    for (const [invocation, program, endpoints, position, style] of [
      [root.commands[0], filled, [4, 7, 34, 7], [50, 10], [2, 0, 0, 1]],
      [root.commands[1], unfilled, [0.5, 0.5, 39.5, 0.5], [100, 10], [0.5, 0, 0, 0]]
    ]) {
      assert.deepEqual(program.bounds, [0, 0, 40, 20]);
      assert.deepEqual(readTransform(page, invocation.transformIndex), [1, 0, 0, 1, ...position]);
      const stroke = program.commands.at(-1);
      assert.equal(stroke.count, 1, "only the bottom edge is stroked");
      assert.deepEqual([...page.stores.strokes.endpoints.slice(stroke.first * 4, stroke.first * 4 + 4)], endpoints);
      assert.deepEqual([...page.stores.strokes.styles.slice(stroke.first * 4, stroke.first * 4 + 4)], style,
        "the underline retains its half-width and RGB color");
    }
    const offset = filled.commands[0].first * 4;
    assert.deepEqual([
      page.stores.paths.fillPathMetaA[offset + 2], page.stores.paths.fillPathMetaA[offset + 3],
      page.stores.paths.fillPathMetaB[offset], page.stores.paths.fillPathMetaB[offset + 1]
    ], [4, 7, 34, 15], "the rectangular interior retains its /RD and half-border insets");

    const scene = await session.compileVectorPage(0, { optimization: "none", vectorFallback: "error" });
    assert.equal(scene.rasterLayers.length, 0, "synthesized annotations retain vector geometry");
    assert.equal(scene.fillPathCount, 1);
    assert.equal(scene.endpoints.length / 4, 2);
  } finally {
    await session.close();
  }
}

function squareSessionFixture(annotations) {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 2400 2400] /Resources << >> /Contents 4 0 R " +
          `/Annots [${annotations.map((_, index) => `${5 + index} 0 R`).join(" ")}] >>`
      },
      { number: 4, body: tinyPdfStream("", "") },
      ...annotations.map((body, index) => ({ number: 5 + index, body })),
      { number: 90, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 40 20] /Resources << >>", "0 0 40 20 re f") }
    ]
  });
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
