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
  const [sessionApi, validationApi, executorApi] = await Promise.all([
    import("../src/pdfSession.ts"),
    import("../src/heprDocumentDataValidation.ts"),
    import("../src/heprDisplayExecutor.ts")
  ]);
  const { openPdf } = sessionApi;
  const { validateHeprPageData } = validationApi;
  const { executeHeprDisplayProgram, collectHeprExecutionScopes } = executorApi;

  await testPatternNamedImage(openPdf, validateHeprPageData);
  await testSoftMaskNamedImage(openPdf, validateHeprPageData);
  await testAnnotationNamedImage(openPdf, validateHeprPageData);
  await testFailureBoundaries(openPdf);
  await testType3NamedMask(openPdf, validateHeprPageData, executeHeprDisplayProgram);

  const session = await openPdf({
    kind: "bytes",
    bytes: formImageFixture(),
    label: "form-images.pdf"
  });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    const outer = page.displayProgram.programs.find((program) => program.resourceName === "Outer");
    const nested = page.displayProgram.programs.find((program) => program.resourceName === "Nested");
    assert.ok(outer && nested);

    const outerImages = flattenProgramCommands(page, outer.commands)
      .filter((command) => command.kind === "draw" && command.source === "images");
    const nestedImages = flattenProgramCommands(page, nested.commands)
      .filter((command) => command.kind === "draw" && command.source === "images");
    assert.equal(outerImages.length, 4, "hidden /OC image is not retained");
    assert.equal(nestedImages.length, 1);
    assert.equal(outerImages[0].first, outerImages[1].first, "same-scope aliases dedupe");
    assert.notEqual(
      outerImages[0].first,
      nestedImages[0].first,
      "one indirect image is specialized for distinct DefaultGray scopes"
    );
    assert.deepEqual(imageBytes(page, outerImages[0].first), [255, 0, 0, 255]);
    assert.deepEqual(imageBytes(page, nestedImages[0].first), [0, 255, 0, 255]);
    assert.ok(page.stores.images.softMaskImageIndices[outerImages[2].first] >= 0);
    assert.equal(page.stores.images.imageMask[outerImages[3].first], 1);
    assert.ok(outerImages[3].paintIndex >= 0, "Form-local stencil binds the live fill paint");

    const firstInvocation = outer.commands[0];
    assert.equal(firstInvocation.kind, "invoke-group");
    assert.equal(firstInvocation.sourceLength, 2, "named image retains the exact Do token span");
    assert.ok(firstInvocation.sourceOffset >= 0);
    const firstGroup = page.displayProgram.groups[firstInvocation.groupIndex];
    assert.equal(firstGroup.alpha, 0.5);
    assert.equal(firstGroup.blendMode, "Multiply");
    assert.ok(firstInvocation.markedContentIndex >= 0);

    const draws = [];
    await executeHeprDisplayProgram(page, {
      beginCompositeGroup() {},
      endCompositeGroup() {},
      drawRun(execution) {
        if (execution.command.source !== "images") return;
        draws.push({
          index: execution.command.first,
          marked: collectHeprExecutionScopes(execution.state.markedContent).length,
          clips: collectHeprExecutionScopes(execution.state.clips).length
        });
      }
    });
    assert.deepEqual(draws.map(({ index }) => index), [
      outerImages[0].first,
      outerImages[1].first,
      outerImages[2].first,
      outerImages[3].first,
      nestedImages[0].first
    ]);
    assert.ok(draws.every(({ clips }) => clips >= 1), "Form BBoxes remain active clips");
    assert.ok(draws.every(({ marked }) => marked >= 1), "caller MCID scope reaches nested Forms");

  } finally {
    await session.close();
  }

  console.log("PDF reusable-program named-image tests passed");
} finally {
  hooks.deregister();
}

async function testType3NamedMask(openPdf, validateHeprPageData, executeHeprDisplayProgram) {
  const session = await openPdf({ kind: "bytes", bytes: type3ImageFixture() });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    const program = page.displayProgram.programs.find(({ kind }) => kind === "type3");
    assert.ok(program);
    const image = flattenProgramCommands(page, program.commands)
      .find((command) => command.kind === "draw" && command.source === "images");
    assert.ok(image);
    assert.equal(page.stores.images.imageMask[image.first], 1);
    assert.equal(image.paintIndex, -1, "uncolored Type3 stencil inherits caller fill paint");
    assert.equal(image.sourceLength, 2);
    let inheritedPaint = -1;
    await executeHeprDisplayProgram(page, {
      beginCompositeGroup() {},
      endCompositeGroup() {},
      drawRun(execution) {
        if (execution.command === image) inheritedPaint = execution.state.type3PaintIndex;
      }
    });
    assert.ok(inheritedPaint >= 0);
  } finally {
    await session.close();
  }
}

async function testPatternNamedImage(openPdf, validateHeprPageData) {
  const session = await openPdf({ kind: "bytes", bytes: patternImageFixture() });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    const program = page.displayProgram.programs.find(({ kind }) => kind === "pattern");
    assert.ok(program);
    const image = flattenProgramCommands(page, program.commands)
      .find((command) => command.kind === "draw" && command.source === "images");
    assert.ok(image);
    assert.equal(image.sourceLength, 2);
  } finally {
    await session.close();
  }
}

async function testSoftMaskNamedImage(openPdf, validateHeprPageData) {
  const session = await openPdf({ kind: "bytes", bytes: softMaskImageFixture() });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.ok(
      page.displayProgram.programs.some((program) =>
        flattenProgramCommands(page, program.commands)
          .some((command) => command.kind === "draw" && command.source === "images")
      ),
      "soft-mask Form retains its named image"
    );
    assert.ok(page.displayProgram.groups.some((group) => group.softMaskGroupIndex >= 0));
  } finally {
    await session.close();
  }
}

async function testAnnotationNamedImage(openPdf, validateHeprPageData) {
  const session = await openPdf({ kind: "bytes", bytes: annotationImageFixture() });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    const appearance = page.displayProgram.programs.find(
      (program) => program.resourceName === "Stamp#0"
    );
    assert.ok(appearance);
    assert.ok(flattenProgramCommands(page, appearance.commands).some(
      (command) => command.kind === "draw" && command.source === "images"
    ));
  } finally {
    await session.close();
  }
}

async function testFailureBoundaries(openPdf) {
  for (const [bytes, code] of [
    [malformedUsedImageFixture(), "unsupported-image"],
    [codecImageFixture(), "unsupported-image"]
  ]) {
    const session = await openPdf({ kind: "bytes", bytes });
    try {
      await assert.rejects(
        session.compilePage(0, { optimization: "none" }),
        (error) => error?.code === code
      );
    } finally {
      await session.close();
    }
  }

  const limited = await openPdf({
    kind: "bytes",
    bytes: oversizedProgramImageFixture()
  }, { limits: { maxImagePixels: 1 } });
  try {
    await assert.rejects(
      limited.compilePage(0, { optimization: "none" }),
      (error) => error?.code === "resource-limit"
    );
  } finally {
    await limited.close();
  }

  const cancelled = await openPdf({ kind: "bytes", bytes: formImageFixture() });
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      cancelled.compilePage(0, { signal: controller.signal }),
      (error) => error?.code === "aborted"
    );
  } finally {
    await cancelled.close();
  }
}

function formImageFixture() {
  const outerContent = [
    "/Span << /MCID 9 >> BDC",
    "q /Half gs 1 0 0 1 0 0 cm /Im Do Q",
    "q 1 0 0 1 1 0 cm /Alias Do Q",
    "q 1 0 0 1 2 0 cm /Masked Do Q",
    "1 0 1 rg q 1 0 0 1 2.5 0 cm /Stencil Do Q",
    "q 1 0 0 1 3 0 cm /Nested Do Q",
    "q 1 0 0 1 4 0 cm /Hidden Do Q",
    "EMC"
  ].join("\n");
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties 30 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    {
      number: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Outer 5 0 R >> >> /Contents 4 0 R >>"
    },
    { number: 4, body: tinyPdfStream("", "0 0 1 rg q 20 0 0 20 5 5 cm /Outer Do Q") },
    {
      number: 5,
      body: tinyPdfStream(
        [
          "/Type /XObject /Subtype /Form /BBox [0 0 5 1]",
          "/Resources << /ColorSpace << /Local [/Indexed /DeviceRGB 0 <ff0000>] >>",
          "/ExtGState << /Half 20 0 R >>",
          "/XObject << /Im 10 0 R /Alias 10 0 R /Masked 11 0 R /Stencil 14 0 R /Nested 6 0 R /Hidden 12 0 R /Unused 99 0 R >> >>"
        ].join(" "),
        outerContent
      )
    },
    {
      number: 6,
      body: tinyPdfStream(
        "/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources << /ColorSpace << /Local [/Indexed /DeviceRGB 0 <00ff00>] >> /XObject << /Im 10 0 R >> >>",
        "/Im Do"
      )
    },
    { number: 10, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /Local", Uint8Array.of(0)) },
    { number: 11, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Mask 13 0 R", Uint8Array.of(0, 0, 255)) },
    // Missing /Width is intentional: hidden default-view payloads stay lazy.
    { number: 12, body: tinyPdfStream("/Type /XObject /Subtype /Image /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /OC 32 0 R", Uint8Array.of(255, 255, 255)) },
    { number: 13, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ImageMask true /BitsPerComponent 1", Uint8Array.of(0)) },
    { number: 14, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ImageMask true /BitsPerComponent 1", Uint8Array.of(0)) },
    { number: 20, body: "<< /Type /ExtGState /ca .5 /BM /Multiply >>" },
    { number: 30, body: "<< /OCGs [32 0 R] /D << /BaseState /ON /OFF [32 0 R] >> >>" },
    { number: 32, body: "<< /Type /OCG /Name (Hidden image) >>" }
  ] });
}

function type3ImageFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 40 40] /Resources << /Font << /T3 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "1 0 0 rg BT /T3 20 Tf 1 0 0 1 5 5 Tm <41> Tj ET") },
    { number: 5, body: "<< /Type /Font /Subtype /Type3 /FontMatrix [.001 0 0 .001 0 0] /FontBBox [0 0 500 500] /FirstChar 65 /LastChar 65 /Widths [500] /Encoding << /Differences [65 /Glyph] >> /CharProcs << /Glyph 6 0 R >> /Resources << /XObject << /Mask 7 0 R >> >> >>" },
    { number: 6, body: tinyPdfStream("", "500 0 0 0 500 500 d1\nq 500 0 0 500 0 0 cm /Mask Do Q") },
    { number: 7, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ImageMask true /BitsPerComponent 1", Uint8Array.of(0)) }
  ] });
}

function patternImageFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /ColorSpace << /Pattern /Pattern >> /Pattern << /P 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "/Pattern cs /P scn 0 0 10 10 re f") },
    { number: 5, body: tinyPdfStream("/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 2 2] /XStep 2 /YStep 2 /Resources << /XObject << /Im 6 0 R /Unused 99 0 R >> >>", "q 2 0 0 2 0 0 cm /Im Do Q") },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB", Uint8Array.of(10, 20, 30)) }
  ] });
}

function softMaskImageFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /ExtGState << /Mask 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "/Mask gs 1 0 0 rg 0 0 10 10 re f") },
    { number: 5, body: "<< /Type /ExtGState /SMask << /S /Alpha /G 6 0 R >> >>" },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Group << /S /Transparency /CS /DeviceGray >> /Resources << /XObject << /Im 7 0 R >> >>", "q 10 0 0 10 0 0 cm /Im Do Q") },
    { number: 7, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray", Uint8Array.of(128)) }
  ] });
}

function annotationImageFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Annots [5 0 R] /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "") },
    { number: 5, body: "<< /Type /Annot /Subtype /Stamp /Rect [2 2 12 12] /AP << /N 6 0 R >> >>" },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources << /XObject << /Im 7 0 R >> >>", "/Im Do") },
    { number: 7, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB", Uint8Array.of(20, 40, 60)) }
  ] });
}

function malformedUsedImageFixture() {
  return simpleFormImagePdf(
    tinyPdfStream("/Type /XObject /Subtype /Image /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB", Uint8Array.of(0, 0, 0))
  );
}

function codecImageFixture() {
  return simpleFormImagePdf(
    tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode", Uint8Array.of(0xff, 0xd8, 0xff, 0xd9))
  );
}

function oversizedProgramImageFixture() {
  return simpleFormImagePdf(
    tinyPdfStream("/Type /XObject /Subtype /Image /Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB", Uint8Array.of(0, 0, 0, 0, 0, 0))
  );
}

function simpleFormImagePdf(image) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /XObject << /Fm 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "/Fm Do") },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << /XObject << /Im 6 0 R >> >>", "/Im Do") },
    { number: 6, body: image }
  ] });
}

function flattenProgramCommands(page, commands, active = new Set()) {
  const result = [];
  for (const command of commands) {
    if (command.kind !== "invoke-group") {
      result.push(command);
      continue;
    }
    if (active.has(command.groupIndex)) continue;
    active.add(command.groupIndex);
    result.push(...flattenProgramCommands(
      page,
      page.displayProgram.groups[command.groupIndex].commands,
      active
    ));
    active.delete(command.groupIndex);
  }
  return result;
}

function imageBytes(page, imageIndex) {
  const start = page.stores.images.dataOffsets[imageIndex];
  const end = page.stores.images.dataOffsets[imageIndex + 1];
  return [...page.stores.images.data.slice(start, end)];
}
