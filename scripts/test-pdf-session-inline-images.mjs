import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { deflateSync } from "node:zlib";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const encoder = new TextEncoder();
const inlineJpeg = new Uint8Array(await readFile(
  new URL("./fixtures/jpeg/rgb-8x8.jpg", import.meta.url)
));

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
  const { HEPR_IMAGE_FORMAT } = dataApi;

  await assertNoInlinePreparationBypass(openPdf);

  const session = await openPdf({
    kind: "bytes",
    bytes: pageInlineFixture(),
    label: "inline-images.pdf"
  });
  try {
    const progress = [];
    const page = await session.compilePage(0, {
      optimization: "none",
      onProgress(event) {
        progress.push(event);
      }
    });
    validateHeprPageData(page);
    assert.equal(page.stores.images.widths.length, 8, "hidden inline images are parsed but do not draw");
    assert.ok(progress.some((event) =>
      event.stage === "image" && event.completed === 8 && event.total === 8
    ));
    const jpegIndexes = Array.from(page.stores.images.widths, (width, index) =>
      width === 8 && page.stores.images.heights[index] === 8 ? index : -1
    ).filter((index) => index >= 0);
    assert.deepEqual(jpegIndexes.length, 1);
    const jpegIndex = jpegIndexes[0];
    assert.equal(page.stores.images.formats[jpegIndex], HEPR_IMAGE_FORMAT.Rgba8);
    assert.deepEqual(
      [...page.stores.images.data.subarray(
        page.stores.images.dataOffsets[jpegIndex],
        page.stores.images.dataOffsets[jpegIndex] + 4
      )],
      [16, 85, 204, 255]
    );
    assert.ok(page.stores.colors.spaceKinds.length >= 4, "managed Separation color is retained");

    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    const imageCommands = collectCommands(page, root.commands)
      .filter((command) => command.kind === "draw" && command.source === "images");
    assert.equal(imageCommands.length, 7);
    assert.equal(imageCommands.filter((command) => command.clipIndex >= 0).length, 6);
    assert.ok(root.commands.some((command) =>
      command.kind === "invoke-group" && command.clipIndex >= 0
    ));
    assert.ok(imageCommands.every((command) => command.sourceOffset >= 0 && command.sourceLength > 0));
    assert.deepEqual(
      imageCommands.map((command) => command.sourceOffset),
      [...imageCommands.map((command) => command.sourceOffset)].sort((left, right) => left - right)
    );
    const maskCommand = imageCommands.find((command) => page.stores.images.imageMask[command.first] !== 0);
    assert.ok(maskCommand?.paintIndex >= 0, "stencil inline image binds the live fill paint");
    assert.ok(
      imageCommands.filter((command) => page.stores.images.imageMask[command.first] === 0)
        .every((command) => command.paintIndex === -1)
    );

    const drawOrder = [];
    let halfAlphaGroups = 0;
    let scopedImageCount = 0;
    await executeHeprDisplayProgram(page, {
      beginCompositeGroup(execution) {
        if (execution.group.alpha === 0.5) halfAlphaGroups += 1;
      },
      endCompositeGroup() {},
      drawRun(execution) {
        drawOrder.push(execution.command.source);
        if (execution.command.source === "images") {
          assert.ok(execution.state.optionalContent);
          assert.ok(execution.state.markedContent);
          assert.ok(execution.state.clips);
          scopedImageCount += 1;
        }
      }
    });
    assert.deepEqual(drawOrder, [
      "fill-paths",
      "images", "images", "images", "images", "images", "images", "images",
      "fill-paths"
    ]);
    assert.equal(halfAlphaGroups, 1);
    assert.equal(scopedImageCount, 7);
    const finalFill = collectCommands(page, root.commands)
      .filter((command) => command.kind === "draw" && command.source === "fill-paths")
      .at(-1);
    assert.ok(finalFill);
    assert.equal(page.stores.paths.fillPathMetaA[finalFill.first * 4 + 2], 24);
    assert.equal(page.stores.paths.fillPathMetaB[finalFill.first * 4], 28);

  } finally {
    await session.close();
  }

  await assertNestedInlineImage(openPdf, validateHeprPageData, formInlineFixture(), "form");
  await assertNestedInlineImage(openPdf, validateHeprPageData, patternInlineFixture(), "pattern");
  await assertType3InlineImage(openPdf, validateHeprPageData, executeHeprDisplayProgram);
  await assertSoftMaskInlineImage(openPdf, validateHeprPageData);

  for (const [label, bytes, code, reason, compileOptions] of [
    ["cross-stream", crossStreamFixture(), "unsupported-image", undefined, undefined],
    ["ambiguous", ambiguousFixture(), "unsupported-image", "inline-image-ambiguous-boundary", undefined],
    ["limit", twoInlineFixture(), "resource-limit", "inline-image-count", { limits: { maxCommandsPerPage: 1 } }]
  ]) {
    const failing = await openPdf({ kind: "bytes", bytes, label: `${label}.pdf` });
    try {
      await assert.rejects(
        failing.compilePage(0, compileOptions),
        (error) => error?.code === code &&
          (reason === undefined || error?.details?.reason === reason)
      );
    } finally {
      await failing.close();
    }
  }

  const cancelled = await openPdf({ kind: "bytes", bytes: pageInlineFixture() });
  try {
    const controller = new AbortController();
    controller.abort("inline-image cancellation fixture");
    await assert.rejects(
      cancelled.compilePage(0, { signal: controller.signal }),
      (error) => error?.code === "aborted"
    );
  } finally {
    await cancelled.close();
  }

  console.log("PDF session inline-image integration tests passed");
} finally {
  hooks.deregister();
}

async function assertNoInlinePreparationBypass(openPdf) {
  const content = [
    "% BI ID EI inside a comment are not inline-image operators",
    "/BI MP",
    "0 0 10 10 re f"
  ].join("\n");
  const session = await openPdf({
    kind: "bytes",
    bytes: onePagePdf(content),
    label: "no-inline-images.pdf"
  });
  try {
    assert.equal(typeof session.compileVectorPageWithTimings, "function");
    const profile = await session.compileVectorPageWithTimings(0, {
      optimization: "none"
    });
    assert.equal(profile.scene.fillPathCount, 1);
    assert.equal(
      profile.timings.inlinePreparationSkipped,
      true,
      "a complete lexical resource scan must reuse content-only segments"
    );
  } finally {
    await session.close();
  }

  const inlineSession = await openPdf({
    kind: "bytes",
    bytes: onePagePdf(rawInline(
      "/W 1 /H 1 /BPC 8 /CS /RGB /I true",
      Uint8Array.of(12, 34, 56)
    )),
    label: "one-inline-image.pdf"
  });
  try {
    const profile = await inlineSession.compileVectorPageWithTimings(0, {
      optimization: "none"
    });
    assert.equal(profile.scene.rasterLayers.length, 1);
    assert.equal(
      profile.timings.inlinePreparationSkipped,
      false,
      "a raw BI operator must retain exact inline-image preparation"
    );
  } finally {
    await inlineSession.close();
  }
}

async function assertNestedInlineImage(openPdf, validate, bytes, expectedKind) {
  const session = await openPdf({ kind: "bytes", bytes });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validate(page);
    const program = page.displayProgram.programs.find((candidate) => candidate.kind === expectedKind);
    assert.ok(program, `${expectedKind} program exists`);
    const image = collectCommands(page, program.commands)
      .find((command) => command.kind === "draw" && command.source === "images");
    assert.ok(image, `${expectedKind} program retains its inline image`);
    assert.ok(image.sourceOffset >= 0 && image.sourceLength > 0);
    if (expectedKind === "form") {
      assert.equal(page.stores.images.widths.length, 2);
      assert.notEqual(
        page.stores.images.colorSpaceIndices[0],
        page.stores.images.colorSpaceIndices[1],
        "same-named page/Form color spaces retain distinct resource scopes"
      );
    }
  } finally {
    await session.close();
  }
}

async function assertType3InlineImage(openPdf, validate, execute) {
  const session = await openPdf({ kind: "bytes", bytes: type3InlineFixture() });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validate(page);
    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    const invocation = root.commands.find((command) => command.kind === "invoke-program");
    assert.ok(invocation?.type3PaintIndex >= 0);
    const program = page.displayProgram.programs[invocation.programIndex];
    assert.equal(program.kind, "type3");
    const image = collectCommands(page, program.commands)
      .find((command) => command.kind === "draw" && command.source === "images");
    assert.ok(image);
    assert.equal(image.paintIndex, -1, "d0 stencil inherits invocation paint");
    let executedPaintIndex = -1;
    await execute(page, {
      beginCompositeGroup() {},
      endCompositeGroup() {},
      drawRun(execution) {
        if (execution.command.source === "images") {
          executedPaintIndex = execution.state.type3PaintIndex;
        }
      }
    });
    assert.equal(executedPaintIndex, invocation.type3PaintIndex);
  } finally {
    await session.close();
  }
}

async function assertSoftMaskInlineImage(openPdf, validate) {
  const session = await openPdf({ kind: "bytes", bytes: softMaskInlineFixture() });
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validate(page);
    assert.ok(page.displayProgram.groups.some((group) => group.softMaskSubtype === "Alpha"));
    assert.ok(
      page.displayProgram.programs.some((program) =>
        collectCommands(page, program.commands)
          .some((command) => command.kind === "draw" && command.source === "images")
      )
    );
  } finally {
    await session.close();
  }
}

function collectCommands(page, commands, seen = new Set()) {
  const output = [];
  for (const command of commands) {
    if (command.kind !== "invoke-group") {
      output.push(command);
      continue;
    }
    if (seen.has(command.groupIndex)) continue;
    seen.add(command.groupIndex);
    output.push(...collectCommands(page, page.displayProgram.groups[command.groupIndex].commands, seen));
    seen.delete(command.groupIndex);
  }
  return output;
}

function pageInlineFixture() {
  const flate = new Uint8Array(deflateSync(Uint8Array.of(64)));
  const content = concat(
    "/OC /Hidden BDC 2 0 0 2 0 0 cm ",
    rawInline("/W 1 /H 1 /BPC 8 /CS /G", Uint8Array.of(0)),
    " EMC\n",
    "/OC /Visible BDC /Span << /MCID 9 >> BDC\n",
    "0 0 5 5 re f\n",
    "q 0 0 m 30 0 l 15 20 l h W n\n",
    "q 2 0 0 1 5 0 cm ", rawInline("/W 2 /H 1 /BPC 8 /CS /RGB", Uint8Array.of(0x20, 0x45, 0x49, 0x20, 0x00, 0xff)), " Q\n",
    "q 1 0 0 1 10 0 cm ", asciiInline("/W 1 /H 1 /BPC 8 /CS /G /F /AHx", "7f>"), " Q\n",
    "q 4 0 0 1 12 0 cm ", asciiInline("/W 4 /H 1 /BPC 8 /CS /G /F /A85", "z~>"), " Q\n",
    "q 1 0 0 1 17 0 cm ", asciiInline("/W 1 /H 1 /BPC 8 /CS /Spot /F /AHx", "ff>"), " Q\n",
    "1 0 1 rg q 1 0 0 1 19 0 cm ", rawInline("/W 1 /H 1 /IM true /D [1 0]", Uint8Array.of(0x80)), " Q\n",
    "q 1 0 0 1 21 0 cm ", rawInline("/W 8 /H 8 /BPC 8 /CS /RGB /F /DCT", inlineJpeg), " Q\n",
    "q /Half gs 1 0 0 1 23 0 cm ", rawInline("/W 1 /H 1 /BPC 8 /CS /G /F /Fl /DP << /Predictor 2 /Colors 1 /BitsPerComponent 8 /Columns 1 >>", flate), " Q\n",
    "Q\n12 0 2 2 re f\nEMC EMC"
  );
  return onePagePdf(content, {
    resources: "/ExtGState << /Half 6 0 R >> /Properties << /Visible 7 0 R /Hidden 11 0 R >> /ColorSpace << /Spot 8 0 R >>",
    catalog: "/OCProperties 9 0 R",
    extra: [
      { number: 6, body: "<< /Type /ExtGState /ca .5 >>" },
      { number: 7, body: "<< /Type /OCG /Name (Visible inline images) >>" },
      { number: 8, body: "[/Separation /Ink /DeviceRGB 10 0 R]" },
      { number: 9, body: "<< /OCGs [7 0 R 11 0 R] /D << /BaseState /ON /OFF [11 0 R] >> >>" },
      { number: 10, body: "<< /FunctionType 2 /Domain [0 1] /C0 [1 1 1] /C1 [0 0 1] /N 1 >>" },
      { number: 11, body: "<< /Type /OCG /Name (Hidden inline image) >>" }
    ]
  });
}

function formInlineFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /ColorSpace << /Local /DeviceGray >> /XObject << /Fm 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", concat(rawInline("/W 1 /H 1 /BPC 8 /CS /Local", Uint8Array.of(128)), " /Fm Do")) },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << /ColorSpace << /Local /DeviceRGB >> >>", concat("0 0 2 2 re f ", rawInline("/W 1 /H 1 /BPC 8 /CS /Local", Uint8Array.of(255, 0, 0)))) }
  ] });
}

function patternInlineFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /ColorSpace << /Pattern /Pattern >> /Pattern << /P 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "/Pattern cs /P scn 0 0 20 20 re f") },
    { number: 5, body: tinyPdfStream("/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 5 5] /XStep 5 /YStep 5 /Resources << >>", rawInline("/W 1 /H 1 /BPC 8 /CS /RGB", Uint8Array.of(0, 255, 0))) }
  ] });
}

function type3InlineFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /Font << /T3 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "1 0 0 rg BT /T3 10 Tf 1 0 0 1 2 2 Tm <41> Tj ET") },
    { number: 5, body: "<< /Type /Font /Subtype /Type3 /FontMatrix [.001 0 0 .001 0 0] /FontBBox [0 0 500 500] /FirstChar 65 /LastChar 65 /Widths [500] /Encoding << /Differences [65 /Mask] >> /CharProcs << /Mask 6 0 R >> /Resources << >> >>" },
    { number: 6, body: tinyPdfStream("", concat("500 0 d0\n", rawInline("/W 1 /H 1 /IM true", Uint8Array.of(0x80)))) }
  ] });
}

function softMaskInlineFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /ExtGState << /GS 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "/GS gs 0 0 10 10 re f") },
    { number: 5, body: "<< /Type /ExtGState /SMask << /S /Alpha /G 6 0 R >> >>" },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << >> /Group << /S /Transparency /I true /CS /DeviceGray >>", rawInline("/W 1 /H 1 /BPC 8 /CS /G", Uint8Array.of(128))) }
  ] });
}

function crossStreamFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents [4 0 R 5 0 R] >>" },
    { number: 4, body: tinyPdfStream("", concat("BI /W 1 /H 1 /BPC 8 /CS /G ID ", Uint8Array.of(0))) },
    { number: 5, body: tinyPdfStream("", " EI") }
  ] });
}

function ambiguousFixture() {
  const first = rawInline("/W 1 /H 1 /BPC 8 /CS /G /F /RL", Uint8Array.of(128));
  const second = rawInline("/W 1 /H 1 /BPC 8 /CS /G /F /RL", Uint8Array.of(128));
  return onePagePdf(concat(first, " ", second, " Q"));
}

function twoInlineFixture() {
  return onePagePdf(concat(
    rawInline("/W 1 /H 1 /BPC 8 /CS /G", Uint8Array.of(0)),
    " ",
    rawInline("/W 1 /H 1 /BPC 8 /CS /G", Uint8Array.of(255))
  ));
}

function onePagePdf(content, { resources = "", catalog = "", extra = [] } = {}) {
  return writeTinyPdf({ objects: [
    { number: 1, body: `<< /Type /Catalog /Pages 2 0 R ${catalog} >>` },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 40 20] /Resources << ${resources} >> /Contents 4 0 R >>` },
    { number: 4, body: tinyPdfStream("", content) },
    ...extra
  ] });
}

function rawInline(dictionary, payload) {
  return concat(`BI ${dictionary} ID `, payload, " EI");
}

function asciiInline(dictionary, payload) {
  return rawInline(dictionary, encoder.encode(payload));
}

function concat(...parts) {
  const values = parts.map((part) => typeof part === "string" ? encoder.encode(part) : part);
  const output = new Uint8Array(values.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}
