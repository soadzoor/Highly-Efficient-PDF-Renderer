import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { buildTinySfnt } from "./lib/tinySfnt.mjs";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const sfntBytes = buildTinySfnt();
const substitute = () => ({ sfntBytes, identifier: "text-clip-fixture-v1" });

try {
  const [sessionApi, validationApi, executorApi, modelApi] = await Promise.all([
    import("../src/pdfSession.ts"),
    import("../src/heprDocumentDataValidation.ts"),
    import("../src/heprDisplayExecutor.ts"),
    import("../src/heprDocumentData.ts")
  ]);
  const { openPdf } = sessionApi;
  const { validateHeprPageData } = validationApi;
  const { executeHeprDisplayProgram, collectHeprExecutionScopes } = executorApi;
  const { HEPR_GLYPH_FLAG } = modelApi;

  const session = await openPdf(
    { kind: "bytes", bytes: textClipFixture(), label: "text-clips.pdf" },
    { missingFontResolver: substitute }
  );
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.equal(page.textIndex.text, "ABAB A A");
    assert.equal(page.textIndex.fallbackQuads.length / 4, 3);

    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    const rootCommands = flattenCommands(page, root.commands);
    const rootGlyphs = rootCommands.filter(
      (command) => command.kind === "draw" && command.source === "glyphs"
    );
    assert.deepEqual(rootGlyphs.map(({ renderingMode }) => renderingMode), [4, 5, 6, 7]);
    assert.deepEqual(
      rootGlyphs.map(({ fillPaintIndex, strokePaintIndex, strokeStyleIndex }) => [
        fillPaintIndex >= 0,
        strokePaintIndex >= 0,
        strokeStyleIndex >= 0
      ]),
      [
        [true, false, false],
        [false, true, true],
        [true, true, true],
        [false, false, false]
      ]
    );
    assert.ok(rootGlyphs.every(({ clipIndex }) => clipIndex === -1));
    const rootTextClipIndex = rootCommands.find(
      (command) => command.kind === "draw" && command.source === "fill-paths" &&
        command.clipIndex >= 0
    )?.clipIndex;
    assert.ok(Number.isInteger(rootTextClipIndex) && rootTextClipIndex >= 0);
    assert.equal(page.stores.clips.firstGlyphs[rootTextClipIndex], 0);
    assert.equal(page.stores.clips.glyphCounts[rootTextClipIndex], 4);
    assert.equal(page.stores.clips.pathCounts[rootTextClipIndex], 0);
    assert.equal(page.stores.clips.parentIndices[rootTextClipIndex], -1);
    assert.ok(
      rootCommands.some(
        (command) => command.kind === "draw" && command.source === "fill-paths" &&
          command.clipIndex === -1
      ),
      "Q restores the pre-text clipping path"
    );

    const clippingFlags = [...page.stores.glyphs.flags].map(
      (flags) => (flags & HEPR_GLYPH_FLAG.ClipOnly) !== 0
    );
    assert.deepEqual(clippingFlags, [true, true, true, true, true]);
    assert.equal(
      page.stores.clips.glyphCounts.reduce((sum, count) => sum + count, 0),
      clippingFlags.filter(Boolean).length
    );

    const innerExecutions = [];
    const compositeModes = [];
    await executeHeprDisplayProgram(page, {
      beginCompositeGroup(execution) {
        compositeModes.push(execution.group.blendMode);
      },
      endCompositeGroup() {},
      drawRun(execution) {
        if (execution.command.source !== "fill-paths") return;
        const programs = invocationFrames(execution.state.invocation)
          .filter((frame) => frame.kind === "program");
        if (programs.length < 2) return;
        const clips = clipFrames(page, execution.state.clips);
        const marked = collectHeprExecutionScopes(execution.state.markedContent);
        const optional = collectHeprExecutionScopes(execution.state.optionalContent);
        innerExecutions.push({
          transform: [...execution.state.transform],
          clips,
          marked: marked.map(({ index }) => index),
          optional: optional.map(({ index }) => index)
        });
      }
    });
    assert.equal(innerExecutions.length, 2);
    assert.ok(compositeModes.includes("Multiply"));
    assert.ok(innerExecutions.every(({ clips }) => clips.length >= 2));
    assert.ok(innerExecutions.every(({ marked }) => marked.length > 0));
    assert.ok(innerExecutions.every(({ optional }) => optional.length > 0));
    assert.ok(
      innerExecutions[1].transform[4] - innerExecutions[0].transform[4] >= 45,
      "repeated Form text clips retain caller-specific transforms"
    );
    const localGlyphClips = innerExecutions.map(({ clips }) =>
      clips.find(({ glyphCount }) => glyphCount > 0)
    );
    assert.ok(localGlyphClips.every(Boolean));
    assert.notEqual(
      localGlyphClips[0].outerTransform[4],
      localGlyphClips[1].outerTransform[4]
    );

    const malformedSpan = structuredClone(page);
    malformedSpan.stores.clips.firstGlyphs[rootTextClipIndex] = 0xffff_ffff;
    assert.throws(() => validateHeprPageData(malformedSpan));
    const malformedPaint = structuredClone(page);
    const modeSeven = malformedPaint.displayProgram.groups
      .flatMap(({ commands }) => commands)
      .find((command) =>
        command.kind === "draw" && command.source === "glyphs" &&
        command.renderingMode === 7
      );
    assert.ok(modeSeven);
    modeSeven.fillPaintIndex = 0;
    assert.throws(() => validateHeprPageData(malformedPaint));

  } finally {
    await session.close();
  }

  await testAnnotationClip(openPdf, validateHeprPageData, executeHeprDisplayProgram);
  await testVerticalClip(openPdf, validateHeprPageData, HEPR_GLYPH_FLAG);
  await testEmptyOutlineClip(openPdf, validateHeprPageData);
  await testTypedFailures(openPdf);
  console.log("PDF text rendering mode 4-7 clipping tests passed");
} finally {
  hooks.deregister();
}

async function testAnnotationClip(openPdf, validateHeprPageData, executeHeprDisplayProgram) {
  const session = await openPdf(
    { kind: "bytes", bytes: annotationClipFixture() },
    { missingFontResolver: substitute }
  );
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.equal(page.textIndex.text, "A");
    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    const invocation = root.commands.find((command) => command.kind === "invoke-program");
    assert.ok(invocation);
    const program = page.displayProgram.programs[invocation.programIndex];
    const commands = flattenCommands(page, program.commands);
    const glyph = commands.find((command) =>
      command.kind === "draw" && command.source === "glyphs"
    );
    const paint = commands.find((command) =>
      command.kind === "draw" && command.source === "fill-paths"
    );
    assert.equal(glyph?.renderingMode, 7);
    assert.equal(glyph?.clipIndex, -1);
    assert.ok(paint && paint.clipIndex >= 0);
    assert.equal(page.stores.clips.glyphCounts[paint.clipIndex], 1);

    let execution = null;
    await executeHeprDisplayProgram(page, {
      beginCompositeGroup() {},
      endCompositeGroup() {},
      drawRun(current) {
        if (current.command === paint) execution = current;
      }
    });
    assert.ok(execution);
    assert.ok(clipFrames(page, execution.state.clips).some(({ glyphCount }) => glyphCount === 1));
    assert.ok(invocationFrames(execution.state.invocation).some((frame) =>
      frame.kind === "program" && frame.index === invocation.programIndex
    ));
    assert.ok(execution.state.transform[4] >= 5, "annotation placement composes the local clip");
  } finally {
    await session.close();
  }
}

async function testVerticalClip(openPdf, validateHeprPageData, flags) {
  const session = await openPdf(
    { kind: "bytes", bytes: verticalClipFixture() },
    { missingFontResolver: substitute }
  );
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.equal(page.textIndex.text, "V");
    assert.equal(page.stores.clips.glyphCounts[0], 1);
    assert.ok((page.stores.glyphs.flags[0] & flags.Vertical) !== 0);
    assert.ok((page.stores.glyphs.flags[0] & flags.ClipOnly) !== 0);
  } finally {
    await session.close();
  }
}

async function testEmptyOutlineClip(openPdf, validateHeprPageData) {
  const session = await openPdf(
    { kind: "bytes", bytes: emptyOutlineClipFixture() },
    { missingFontResolver: substitute }
  );
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.equal(page.stores.clips.glyphCounts[0], 1);
    const fontGlyph = page.stores.fonts.glyphIds.indexOf(page.stores.glyphs.glyphIds[0]);
    assert.ok(fontGlyph >= 0);
    assert.equal(page.stores.fonts.outlinePathCounts[fontGlyph], 0);
  } finally {
    await session.close();
  }
}

async function testTypedFailures(openPdf) {
  const illegal = await openPdf(
    { kind: "bytes", bytes: illegalClipTransitionFixture() },
    { missingFontResolver: substitute }
  );
  try {
    await assert.rejects(
      illegal.compilePage(0, { optimization: "none" }),
      (error) => error?.code === "unsupported-content"
    );
  } finally {
    await illegal.close();
  }

  const missingOutline = await openPdf({ kind: "bytes", bytes: emptyOutlineClipFixture() });
  try {
    await assert.rejects(
      missingOutline.compilePage(0, { optimization: "none" }),
      (error) => error?.code === "unsupported-font"
    );
  } finally {
    await missingOutline.close();
  }

  const type3 = await openPdf({ kind: "bytes", bytes: type3ClipFixture() });
  try {
    await assert.rejects(
      type3.compilePage(0, { optimization: "none" }),
      (error) => error?.code === "unsupported-content" &&
        error?.details?.reason === "type3-text-clip"
    );
  } finally {
    await type3.close();
  }

  const limited = await openPdf(
    { kind: "bytes", bytes: textClipFixture() },
    { missingFontResolver: substitute }
  );
  try {
    await assert.rejects(
      limited.compilePage(0, {
        optimization: "none",
        limits: { maxClipsPerPage: 3 }
      }),
      (error) => error?.code === "resource-limit" && error?.details?.reason === "clips"
    );
  } finally {
    await limited.close();
  }
}

function textClipFixture() {
  const pageContent = [
    ".8 g 0 0 120 120 re f",
    "/OC /Hidden BDC BT /F 12 Tf 7 Tr 1 0 0 1 2 110 Tm <41> Tj ET EMC",
    "q",
    "BT /F 12 Tf 80 Tz 2 Ts 1 0 0 1 10 90 Tm",
    "4 Tr <41> Tj",
    "5 Tr 1 0 0 1 28 90 Tm <42> Tj",
    "6 Tr 1 0 0 1 46 90 Tm <41> Tj",
    "7 Tr 1 0 0 1 64 90 Tm <42> Tj",
    "ET",
    "0 1 0 rg 0 0 120 120 re f",
    "Q",
    "1 0 0 rg 0 0 5 5 re f",
    "q 5 5 110 110 re W n 1 0 0 1 10 10 cm /Outer Do Q",
    "q 5 5 110 110 re W n 1 0 0 1 60 10 cm /Outer Do Q"
  ].join("\n");
  const outerContent = [
    "/OC /Layer BDC",
    "/Span << /MCID 7 >> BDC",
    "BT /F 10 Tf 7 Tr 1 .2 -.1 1 2 15 Tm <41> Tj ET",
    "/GS gs /Inner Do",
    "EMC EMC"
  ].join("\n");
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties 20 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 120] /Resources << /Font << /F 10 0 R >> /XObject << /Outer 5 0 R >> /Properties << /Hidden 23 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", pageContent) },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 30 30] /Matrix [1 0 0 1 2 3] /Resources << /Font << /F 10 0 R >> /XObject << /Inner 6 0 R >> /ExtGState << /GS 21 0 R >> /Properties << /Layer 22 0 R >> >>", outerContent) },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 20 20]", "0 0 1 rg 0 0 20 20 re f") },
    { number: 10, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode 11 0 R >>" },
    { number: 11, body: tinyPdfStream("", toUnicode8([["41", "0041"], ["42", "0042"]])) },
    { number: 20, body: "<< /OCGs [22 0 R 23 0 R] /D << /BaseState /ON /OFF [23 0 R] >> >>" },
    { number: 21, body: "<< /Type /ExtGState /ca .5 /BM /Multiply >>" },
    { number: 22, body: "<< /Type /OCG /Name (Visible clip layer) >>" },
    { number: 23, body: "<< /Type /OCG /Name (Hidden clip layer) >>" }
  ] });
}

function verticalClipFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 40 40] /Resources << /Font << /F 10 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "BT /F 12 Tf 7 Tr 1 0 0 1 20 30 Tm <0001> Tj ET 0 0 40 40 re f") },
    { number: 10, body: "<< /Type /Font /Subtype /Type0 /BaseFont /FixtureCID /Encoding /Identity-V /DescendantFonts [11 0 R] /ToUnicode 12 0 R >>" },
    { number: 11, body: "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /FixtureCID /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 /W [1 [600]] /DW2 [880 -1000] /W2 [1 [-900 300 750]] /CIDToGIDMap /Identity >>" },
    { number: 12, body: tinyPdfStream("", "1 begincodespacerange <0000> <ffff> endcodespacerange\n1 beginbfchar <0001> <0056> endbfchar") }
  ] });
}

function emptyOutlineClipFixture() {
  return simpleClipFixture("BT /F 10 Tf 7 Tr <43> Tj ET 0 0 20 20 re f");
}

function illegalClipTransitionFixture() {
  return simpleClipFixture("BT /F 10 Tf 4 Tr <41> Tj 0 Tr <42> Tj ET");
}

function type3ClipFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /Font << /T 10 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "BT /T 10 Tf 7 Tr (A) Tj ET 0 0 20 20 re f") },
    { number: 10, body: "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 600 700] /FontMatrix [.001 0 0 .001 0 0] /CharProcs << /A 12 0 R >> /Encoding << /Type /Encoding /Differences [65 /A] >> /FirstChar 65 /LastChar 65 /Widths [600] /Resources << >> >>" },
    { number: 12, body: tinyPdfStream("", "600 0 d0 0 0 m 500 0 l 250 700 l h f") }
  ] });
}

function annotationClipFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 30 30] /Contents 4 0 R /Annots [5 0 R] >>" },
    { number: 4, body: tinyPdfStream("", "") },
    { number: 5, body: "<< /Type /Annot /Subtype /Widget /Rect [5 5 25 25] /AP << /N 6 0 R >> >>" },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Resources << /Font << /F 10 0 R >> >>", "BT /F 10 Tf 7 Tr 1 0 0 1 2 2 Tm <41> Tj ET 0 0 20 20 re f") },
    { number: 10, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode 11 0 R >>" },
    { number: 11, body: tinyPdfStream("", toUnicode8([["41", "0041"]])) }
  ] });
}

function simpleClipFixture(content) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /Font << /F 10 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", content) },
    { number: 10, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode 11 0 R >>" },
    { number: 11, body: tinyPdfStream("", toUnicode8([["41", "0041"], ["42", "0042"], ["43", "0043"]])) }
  ] });
}

function toUnicode8(entries) {
  return [
    "1 begincodespacerange <00> <ff> endcodespacerange",
    `${entries.length} beginbfchar`,
    ...entries.map(([source, target]) => `<${source}> <${target}>`),
    "endbfchar"
  ].join("\n");
}

function flattenCommands(page, commands, active = new Set()) {
  const result = [];
  for (const command of commands) {
    if (command.kind !== "invoke-group") {
      result.push(command);
      continue;
    }
    if (active.has(command.groupIndex)) continue;
    active.add(command.groupIndex);
    result.push(...flattenCommands(page, page.displayProgram.groups[command.groupIndex].commands, active));
    active.delete(command.groupIndex);
  }
  return result;
}

function invocationFrames(frame) {
  const result = [];
  for (let current = frame; current; current = current.parent) result.push(current);
  result.reverse();
  return result;
}

function clipFrames(page, frame) {
  const result = [];
  for (let current = frame; current; current = current.parent) {
    if (current.kind === "resource") {
      result.push({
        clipIndex: current.clipIndex,
        glyphCount: page.stores.clips.glyphCounts[current.clipIndex],
        outerTransform: [...current.outerTransform]
      });
    }
  }
  result.reverse();
  return result;
}
