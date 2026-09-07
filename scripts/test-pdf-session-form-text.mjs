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
  const { executeHeprDisplayProgram, collectHeprExecutionScopes } = executorApi;
  const { HEPR_GLYPH_FLAG } = dataApi;

  const fontRequests = [];
  const session = await openPdf(
    { kind: "bytes", bytes: reusableTextFixture(), label: "form-text.pdf" },
    {
      missingFontResolver(request) {
        fontRequests.push(request.baseFont);
        return { sfntBytes: substituteSfnt, identifier: "form-text-fixture-v1" };
      }
    }
  );
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.equal(page.textIndex.text, "A A B AAA A B AAA");
    assert.deepEqual([...new Set(fontRequests)].sort(), ["Courier", "Helvetica", "Times-Roman"]);
    assert.equal(page.stores.fonts.names.length, 3, "page/Form aliases share one global font record");

    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    const outerInvocations = root.commands.filter((command) =>
      command.kind === "invoke-program" &&
      page.displayProgram.programs[command.programIndex].resourceName === "Outer"
    );
    assert.equal(outerInvocations.length, 2);
    assert.equal(outerInvocations[0].programIndex, outerInvocations[1].programIndex);
    const outer = page.displayProgram.programs[outerInvocations[0].programIndex];
    const nested = page.displayProgram.programs.find((program) => program.resourceName === "Nested");
    const mask = page.displayProgram.programs.find((program) => program.resourceName === "SMaskRoot");
    assert.ok(outer && nested && mask);

    const outerGlyphCommands = flattenProgramCommands(page, outer.commands)
      .filter((command) => command.kind === "draw" && command.source === "glyphs");
    assert.deepEqual(outerGlyphCommands.map(({ renderingMode }) => renderingMode), [0, 1, 2, 3]);
    assert.ok(outerGlyphCommands[1].strokePaintIndex >= 0);
    assert.ok(outerGlyphCommands[1].strokeStyleIndex >= 0);
    assert.equal(outerGlyphCommands[1].fillPaintIndex, -1);
    assert.ok(outerGlyphCommands[2].fillPaintIndex >= 0);
    assert.ok(outerGlyphCommands[2].strokePaintIndex >= 0);
    assert.equal(outerGlyphCommands[3].fillPaintIndex, -1);
    assert.equal(outerGlyphCommands[3].strokePaintIndex, -1);

    const maskCommands = flattenProgramCommands(page, mask.commands);
    const maskClipGlyph = maskCommands.find((command) =>
      command.kind === "draw" && command.source === "glyphs"
    );
    const maskClippedPaint = maskCommands.find((command) =>
      command.kind === "draw" && command.source === "fill-paths"
    );
    assert.equal(maskClipGlyph?.renderingMode, 7);
    assert.equal(maskClipGlyph?.clipIndex, -1, "the glyph is evaluated before its ET clip");
    assert.ok(maskClippedPaint && maskClippedPaint.clipIndex >= 0);
    assert.equal(page.stores.clips.glyphCounts[maskClippedPaint.clipIndex], 1);

    const references = [...page.textIndex.charGlyphIndices];
    assert.ok(references[0] >= 0, "root text keeps its unambiguous glyph reference");
    assert.ok(references.slice(2).every((reference) => reference <= -2 || reference === -1));
    assert.equal(page.textIndex.fallbackQuads.length / 4, 10);
    const occurrenceXs = [];
    for (let offset = 0; offset < page.textIndex.fallbackQuads.length; offset += 4) {
      occurrenceXs.push(page.textIndex.fallbackQuads[offset]);
    }
    assert.ok(Math.max(...occurrenceXs) - Math.min(...occurrenceXs) >= 35);

    const glyphExecutions = [];
    let softMaskGlyphs = 0;
    await executeHeprDisplayProgram(page, {
      beginCompositeGroup() {},
      endCompositeGroup() {},
      drawRun(execution) {
        if (execution.command.source !== "glyphs") return;
        const scopes = collectHeprExecutionScopes(execution.state.markedContent);
        const invocations = collectInvocationFrames(execution.state.invocation);
        if (invocations.some((frame) => frame.kind === "group" && frame.role === "soft-mask")) {
          softMaskGlyphs += execution.command.count;
          return;
        }
        glyphExecutions.push({
          mode: execution.command.renderingMode,
          transform: [...execution.state.transform],
          marked: scopes.map(({ index }) => index)
        });
      }
    });
    assert.equal(softMaskGlyphs, 1, "text inside the soft-mask Form renders but is not indexed");
    assert.equal(glyphExecutions.length, 11);
    assert.ok(glyphExecutions.filter(({ marked }) => marked.length > 0).length >= 10);
    const firstOuterX = glyphExecutions[1].transform[4];
    const secondOuterX = glyphExecutions[6].transform[4];
    assert.ok(secondOuterX - firstOuterX >= 35, "repeated program invocations compose distinct transforms");

    const invisibleGlyph = page.stores.glyphs.flags.findIndex(
      (flags) => (flags & HEPR_GLYPH_FLAG.Invisible) !== 0
    );
    assert.ok(invisibleGlyph >= 0);

  } finally {
    await session.close();
  }

  await testSynthesizedWidgetText(openPdf, validateHeprPageData);
  await testVerticalCidFormText(openPdf, validateHeprPageData, HEPR_GLYPH_FLAG);
  await testUsedAndUnusedFonts(openPdf);
  console.log("PDF reusable-program native text tests passed");
} finally {
  hooks.deregister();
}

async function testSynthesizedWidgetText(openPdf, validateHeprPageData) {
  const session = await openPdf(
    { kind: "bytes", bytes: synthesizedWidgetFixture() },
    {
      missingFontResolver() {
        return { sfntBytes: substituteSfnt, identifier: "form-text-fixture-v1" };
      }
    }
  );
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    // Static default-view annotation appearance text is deliberately included
    // after page content in annotation-array order.
    assert.equal(page.textIndex.text, "A BBA BA");
    assert.equal(page.textIndex.fallbackQuads.length / 4, 6);
    const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
    assert.equal(root.commands.length, 2);
    assert.ok(root.commands.every((command) => command.kind === "invoke-program"));
    assert.ok(root.commands.every((command) =>
      flattenProgramCommands(
        page,
        page.displayProgram.programs[command.programIndex].commands
      ).some((nested) => nested.kind === "draw" && nested.source === "glyphs")
    ));
    assert.equal(
      session.getDiagnostics().filter(({ code }) => code === "annotation.appearance-synthesized").length,
      2
    );
  } finally {
    await session.close();
  }
}

async function testUsedAndUnusedFonts(openPdf) {
  const unused = await openPdf({ kind: "bytes", bytes: unusedMalformedFormFontFixture() });
  try {
    await unused.compilePage(0, { optimization: "none" });
  } finally {
    await unused.close();
  }
  const used = await openPdf({ kind: "bytes", bytes: usedMalformedFormFontFixture() });
  try {
    await assert.rejects(
      used.compilePage(0, { optimization: "none" }),
      (error) => error?.code === "unsupported-font" || error?.code === "invalid-object"
    );
  } finally {
    await used.close();
  }
}

async function testVerticalCidFormText(openPdf, validateHeprPageData, glyphFlags) {
  const requests = [];
  const session = await openPdf(
    { kind: "bytes", bytes: verticalCidFormFixture() },
    {
      missingFontResolver(request) {
        requests.push(request);
        return { sfntBytes: substituteSfnt, identifier: "form-text-fixture-v1" };
      }
    }
  );
  try {
    const page = await session.compilePage(0, { optimization: "none" });
    validateHeprPageData(page);
    assert.equal(page.textIndex.text, "V");
    assert.equal(page.textIndex.fallbackQuads.length / 4, 1);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].writingMode, 1);
    assert.equal(requests[0].descendantSubtype, "CIDFontType2");
    assert.ok((page.stores.glyphs.flags[0] & glyphFlags.Vertical) !== 0);
    assert.equal(page.textIndex.charGlyphIndices[0], -2);
  } finally {
    await session.close();
  }
}

function reusableTextFixture() {
  const outerContent = [
    "/Span << /MCID 4 >> BDC",
    "q /Half gs BT /F 10 Tf 1 0 0 1 0 0 Tm <41> Tj ET Q",
    "q 1 0 0 1 8 0 cm /Nested Do Q",
    "BT /F 10 Tf 1 0 0 1 16 0 Tm 1 Tr <41> Tj 2 Tr <41> Tj 3 Tr <41> Tj ET",
    "/OC /Hidden BDC BT /F 10 Tf 1 0 0 1 24 0 Tm <41> Tj ET EMC",
    "EMC"
  ].join("\n");
  const pageContent = [
    "BT /P 8 Tf 1 0 0 1 2 90 Tm <41> Tj ET",
    "q 1 0 0 1 10 20 cm /Outer Do Q",
    "q 1 0 0 1 50 20 cm /Outer Do Q",
    "/Mask gs 0 0 5 5 re f"
  ].join("\n");
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties 30 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /P 10 0 R >> /XObject << /Outer 5 0 R >> /ExtGState << /Mask 40 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", pageContent) },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 32 14] /Matrix [1 0 0 1 1 2] /Resources << /Font << /F 10 0 R /Unused 99 0 R >> /XObject << /Nested 6 0 R >> /ExtGState << /Half 20 0 R >> /Properties << /Hidden 32 0 R >> >>", outerContent) },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 8 12] /Resources << /Font << /F 11 0 R >> >>", "BT /F 10 Tf 1 0 0 1 0 0 Tm <41> Tj ET") },
    { number: 10, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode 13 0 R >>" },
    { number: 11, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding /ToUnicode 14 0 R >>" },
    { number: 12, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding /ToUnicode 15 0 R >>" },
    { number: 13, body: tinyPdfStream("", toUnicode([["41", "0041"], ["52", "0052"]])) },
    { number: 14, body: tinyPdfStream("", toUnicode([["41", "0042"]])) },
    { number: 15, body: tinyPdfStream("", toUnicode([["4d", "004d"]])) },
    { number: 20, body: "<< /Type /ExtGState /ca .5 /CA .25 /BM /Multiply >>" },
    { number: 30, body: "<< /OCGs [32 0 R] /D << /BaseState /ON /OFF [32 0 R] >> >>" },
    { number: 32, body: "<< /Type /OCG /Name (Hidden Form text) >>" },
    { number: 40, body: "<< /Type /ExtGState /SMask << /S /Alpha /G 41 0 R >> >>" },
    { number: 41, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Group << /S /Transparency /CS /DeviceGray >> /Resources << /Font << /M 12 0 R >> >>", "BT /M 8 Tf 7 Tr 1 0 0 1 1 1 Tm <41> Tj ET 0 0 10 10 re f") }
  ] });
}

function synthesizedWidgetFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm 7 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 40] /Contents 4 0 R /Annots [5 0 R 8 0 R] >>" },
    { number: 4, body: tinyPdfStream("", "") },
    { number: 5, body: "<< /Type /Annot /Subtype /Widget /Parent 6 0 R /Rect [5 5 65 25] >>" },
    { number: 6, body: "<< /FT /Tx /T (Name) /V (ABBA) /DA (/Helv 10 Tf 0 g) /Kids [5 0 R] >>" },
    { number: 7, body: "<< /Fields [6 0 R 9 0 R] /DR << /Font << /Helv 10 0 R >> >> /DA (/Helv 10 Tf 0 g) >>" },
    { number: 8, body: "<< /Type /Annot /Subtype /Widget /Parent 9 0 R /Rect [75 5 115 25] /MK << /CA (BA) >> >>" },
    { number: 9, body: "<< /FT /Btn /T (Submit) /Ff 65536 /DA (/Helv 10 Tf 0 g) /Kids [8 0 R] >>" },
    { number: 10, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>" }
  ] });
}

function verticalCidFormFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Vertical 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "q 1 0 0 1 20 20 cm /Vertical Do Q") },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 20 30] /Resources << /Font << /F0 10 0 R >> >>", "BT /F0 12 Tf 1 0 0 1 0 20 Tm <0001> Tj ET") },
    { number: 10, body: "<< /Type /Font /Subtype /Type0 /BaseFont /FixtureCID /Encoding /Identity-V /DescendantFonts [11 0 R] /ToUnicode 12 0 R >>" },
    { number: 11, body: "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /FixtureCID /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 /W [1 [600]] /DW2 [880 -1000] /W2 [1 [-900 300 750]] /CIDToGIDMap /Identity >>" },
    { number: 12, body: tinyPdfStream("", [
      "1 begincodespacerange <0000> <ffff> endcodespacerange",
      "1 beginbfchar <0001> <0056> endbfchar"
    ].join("\n")) }
  ] });
}

function unusedMalformedFormFontFixture() {
  return simpleFormFontFixture("0 0 1 rg 0 0 5 5 re f");
}

function usedMalformedFormFontFixture() {
  return simpleFormFontFixture("BT /Bad 10 Tf (x) Tj ET");
}

function simpleFormFontFixture(content) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << /XObject << /Fm 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "/Fm Do") },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << /Font << /Bad 6 0 R /Unused 99 0 R >> >>", content) },
    { number: 6, body: "<< /Type /Font >>" }
  ] });
}

function toUnicode(entries) {
  return [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin begincmap",
    "1 begincodespacerange <00> <ff> endcodespacerange",
    `${entries.length} beginbfchar`,
    ...entries.map(([source, target]) => `<${source}> <${target}>`),
    "endbfchar endcmap end end"
  ].join("\n");
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

function collectInvocationFrames(frame) {
  const frames = [];
  for (let current = frame; current; current = current.parent) frames.push(current);
  frames.reverse();
  return frames;
}
