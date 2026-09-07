import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const { NativeSfntFont } = await import("../src/pdf/nativeFont.ts");
const { PdfError } = await import("../src/pdf/nativeTypes.ts");
const [hmtxUnderCountFixture, hmtxOverCountFixture] = await Promise.all([
  readFile(new URL("./fixtures/sfnt/hmtx-under-count.ttf", import.meta.url)),
  readFile(new URL("./fixtures/sfnt/hmtx-over-count.ttf", import.meta.url))
]);

function testCheckedSfntAndCmaps() {
  const fixture = buildFixture();
  const bytes = buildSfnt(fixture.tables);
  const font = NativeSfntFont.parse(bytes);

  assert.equal(font.unitsPerEm, 1000);
  assert.equal(font.numGlyphs, 10);
  assert.equal(font.ascender, 800);
  assert.equal(font.descender, -200);
  assert.equal(font.lineGap, 100);
  assert.deepEqual(font.fontBounds, [0, 0, 250, 100]);
  assert.equal(font.outlineFormat, "glyf");

  // OpenType base cmap subtables are exclusive; format 14 supplements the one
  // selected Unicode subtable, while the symbol cmap remains separately usable.
  assert.equal(font.mapCodePoint(0x20), 1, "selected format 12");
  assert.equal(font.mapSymbolCode(0x20), 1, "symbol format 0");
  assert.equal(font.mapSymbolCode(-1), 0);
  assert.equal(font.mapCodePoint(0x41), 1, "selected format 12 BMP mapping");
  assert.equal(font.mapCodePoint(0x42), 2, "selected format 12 BMP range");
  assert.equal(font.mapCodePoint(0x10000), 3, "selected format 12 supplementary mapping");
  assert.equal(font.mapCodePoint(0x1f600), 4, "format 12");
  assert.equal(font.mapCodePoint(0x1f9ea), 2, "format 12 sparse group");
  assert.equal(font.mapCodePoint(0xd800), 0, "surrogates are not Unicode scalar values");

  assert.equal(font.mapCodePoint(0x41, 0xfe0f), 1, "format 14 default UVS");
  assert.equal(font.mapCodePoint(0x42, 0xfe0f), 3, "format 14 non-default UVS");
  assert.equal(font.mapCodePoint(0x43, 0xfe0f), 0, "unsupported variation sequence");
  assert.equal(font.mapCodePoint(0x1f600, 0xe0100), 2, "supplementary variation selector");
  assert.equal(font.mapCodePoint(0x41, 0x1234), 0, "invalid variation selector");
  testStandaloneCmapFormats(fixture);

  const simple = font.getGlyphOutline(1);
  assert.deepEqual(simple.commands.slice(0, 5), [
    { kind: "move", x: 0, y: 0 },
    { kind: "line", x: 100, y: 0 },
    { kind: "line", x: 200, y: 0 },
    { kind: "line", x: 100, y: 100 },
    { kind: "line", x: 0, y: 0 }
  ]);
  assert.deepEqual(simple.bounds, [0, 0, 200, 100]);
  assert.equal(simple.advanceWidth, 600);
  assert.equal(simple.leftSideBearing, 10);
  assert(Object.isFrozen(simple));
  assert(Object.isFrozen(simple.commands));
  assert(simple.commands.every(Object.isFrozen));
  assert.strictEqual(font.getGlyphOutline(1), simple, "outlines are deterministically cached");

  const useMetrics = font.getGlyphOutline(3);
  assert.deepEqual(useMetrics.commands[0], { kind: "move", x: 50, y: 0 });
  assert.equal(useMetrics.advanceWidth, 600, "USE_MY_METRICS selects the component metrics");
  assert.equal(useMetrics.leftSideBearing, 10);

  const matched = font.getGlyphOutline(4);
  assert.deepEqual(
    matched.commands.filter((command) => command.kind === "move"),
    [{ kind: "move", x: 0, y: 0 }, { kind: "move", x: 10, y: 0 }],
    "point matching aligns the second component to a parent point"
  );
  assert.equal(matched.advanceWidth, 700, "the last marked component supplies metrics");
  assert.equal(matched.leftSideBearing, 20);

  const transformed = font.getGlyphOutline(8);
  assert.deepEqual(transformed.bounds, [20, 10, 30, 20]);
  assert.deepEqual(transformed.commands[0], { kind: "move", x: 20, y: 10 });
  assert.deepEqual(font.getHorizontalMetric(8), { advanceWidth: 900, leftSideBearing: 80 });
}

function testTableDirectoryAndMetricValidation() {
  const fixture = buildFixture();
  const good = buildSfnt(fixture.tables);

  const badChecksum = good.slice();
  const hmtxRecord = findSfntRecord(badChecksum, "hmtx");
  badChecksum[hmtxRecord.offset + hmtxRecord.length - 1] ^= 1;
  expectPdf(() => NativeSfntFont.parse(badChecksum), "unsupported-font", /checksum/i);

  const overflowing = good.slice();
  const headRecordOffset = findSfntRecord(good, "head").recordOffset;
  new DataView(overflowing.buffer).setUint32(headRecordOffset + 8, 0xfffffffC, false);
  expectPdf(() => NativeSfntFont.parse(overflowing), "unsupported-font", /out of bounds/i);

  const overlapping = good.slice();
  const glyfRecord = findSfntRecord(overlapping, "glyf");
  const overlappingView = new DataView(overlapping.buffer);
  overlappingView.setUint32(headRecordOffset + 8, glyfRecord.offset, false);
  overlappingView.setUint32(
    headRecordOffset + 4,
    tableChecksum(
      overlapping.subarray(glyfRecord.offset, glyfRecord.offset + findSfntRecord(good, "head").length),
      true
    ),
    false
  );
  expectPdf(() => NativeSfntFont.parse(overlapping), "unsupported-font", /overlap/i);

  const duplicate = good.slice();
  const hheaRecord = findSfntRecord(duplicate, "hhea");
  duplicate.set(new TextEncoder().encode("head"), hheaRecord.recordOffset);
  expectPdf(() => NativeSfntFont.parse(duplicate), "unsupported-font", /duplicated/i);

  const unsortedTables = good.slice();
  const firstRecord = unsortedTables.slice(12, 28);
  unsortedTables.copyWithin(12, 28, 44);
  unsortedTables.set(firstRecord, 28);
  expectPdf(() => NativeSfntFont.parse(unsortedTables), "unsupported-font", /directory is unsorted/i);

  const badSearchFields = good.slice();
  const badSearchView = new DataView(badSearchFields.buffer);
  badSearchView.setUint16(6, 0, false);
  badSearchView.setUint16(8, 0, false);
  badSearchView.setUint16(10, 0, false);
  expectPdf(() => NativeSfntFont.parse(badSearchFields), "unsupported-font", /search fields/i);

  const badUnits = cloneTables(fixture.tables);
  new DataView(badUnits.get("head").buffer).setUint16(18, 15, false);
  expectPdf(() => NativeSfntFont.parse(buildSfnt(badUnits)), "unsupported-font", /unitsPerEm/i);

  const badHeadBounds = cloneTables(fixture.tables);
  const headView = new DataView(badHeadBounds.get("head").buffer);
  headView.setInt16(36, 100, false);
  headView.setInt16(40, 50, false);
  expectPdf(() => NativeSfntFont.parse(buildSfnt(badHeadBounds)), "unsupported-font", /bounding box/i);

  const shortMaxp = cloneTables(fixture.tables);
  shortMaxp.set("maxp", shortMaxp.get("maxp").subarray(0, 31).slice());
  expectPdf(() => NativeSfntFont.parse(buildSfnt(shortMaxp)), "unsupported-font", /maxp.*length/i);

  const badMetrics = cloneTables(fixture.tables);
  badMetrics.set("hmtx", badMetrics.get("hmtx").subarray(0, badMetrics.get("hmtx").length - 2).slice());
  expectPdf(() => NativeSfntFont.parse(buildSfnt(badMetrics)), "unsupported-font", /hhea\/hmtx/i);

  const badLoca = cloneTables(fixture.tables);
  new DataView(badLoca.get("loca").buffer).setUint32(12, 1, false);
  expectPdf(() => NativeSfntFont.parse(buildSfnt(badLoca)), "unsupported-font", /loca offsets/i);

  const badLocaLength = cloneTables(fixture.tables);
  badLocaLength.set("loca", badLocaLength.get("loca").subarray(0, 40).slice());
  expectPdf(() => NativeSfntFont.parse(buildSfnt(badLocaLength)), "unsupported-font", /loca length/i);

  expectPdf(
    () => NativeSfntFont.parse(good, 0, { maxSfntTables: 1 }),
    "resource-limit",
    /table count/i
  );
}

function testPdfEmbeddedSubsetCompatibility() {
  const fixture = buildFixture();
  const tablesWithMetadata = cloneTables(fixture.tables);
  tablesWithMetadata.set("OS/2", Uint8Array.of(
    0, 4, 0, 1, 0, 2, 0, 3,
    0, 4, 0, 5, 0, 6, 0
  ));
  const good = buildSfnt(tablesWithMetadata);

  const staleOptionalChecksum = good.slice();
  const os2 = findSfntRecord(staleOptionalChecksum, "OS/2");
  staleOptionalChecksum[os2.offset + os2.length - 1] ^= 1;
  expectPdf(
    () => NativeSfntFont.parse(staleOptionalChecksum),
    "unsupported-font",
    /OS\/2.*checksum/i
  );
  const staleOptional = NativeSfntFont.parse(
    staleOptionalChecksum,
    0,
    undefined,
    "pdf-embedded"
  );
  assert.equal(staleOptional.getGlyphOutline(1).advanceWidth, 600);

  const danglingOptional = good.slice();
  const danglingOptionalView = new DataView(danglingOptional.buffer);
  danglingOptionalView.setUint32(os2.recordOffset + 8, 0xfffffffC, false);
  expectPdf(
    () => NativeSfntFont.parse(danglingOptional),
    "unsupported-font",
    /OS\/2.*out of bounds/i
  );
  const withoutOptionalMetadata = NativeSfntFont.parse(
    danglingOptional,
    0,
    undefined,
    "pdf-embedded"
  );
  assert.equal(withoutOptionalMetadata.mapCodePoint(0x41), 1);
  assert.equal(withoutOptionalMetadata.getGlyphOutline(1).commands[0].kind, "move");

  const duplicateOptionalTag = good.slice();
  duplicateOptionalTag.set(
    new TextEncoder().encode("OS/2"),
    findSfntRecord(duplicateOptionalTag, "cmap").recordOffset
  );
  expectPdf(
    () => NativeSfntFont.parse(duplicateOptionalTag, 0, undefined, "pdf-embedded"),
    "unsupported-font",
    /duplicated/i
  );

  const overlappingOptional = good.slice();
  const hmtx = findSfntRecord(overlappingOptional, "hmtx");
  new DataView(overlappingOptional.buffer).setUint32(
    findSfntRecord(overlappingOptional, "OS/2").recordOffset + 8,
    hmtx.offset,
    false
  );
  expectPdf(
    () => NativeSfntFont.parse(overlappingOptional),
    "unsupported-font",
    /overlap/i
  );
  assert.equal(
    NativeSfntFont.parse(overlappingOptional, 0, undefined, "pdf-embedded")
      .getHorizontalMetric(1).advanceWidth,
    600
  );

  const staleRequiredChecksum = good.slice();
  const staleHmtx = findSfntRecord(staleRequiredChecksum, "hmtx");
  staleRequiredChecksum[staleHmtx.offset + staleHmtx.length - 1] ^= 1;
  expectPdf(
    () => NativeSfntFont.parse(staleRequiredChecksum),
    "unsupported-font",
    /hmtx.*checksum/i
  );
  // Checksums are integrity hints, not a memory-safety boundary. Every actual
  // required-table read remains guarded by the declared table bounds.
  assert.equal(
    NativeSfntFont.parse(staleRequiredChecksum, 0, undefined, "pdf-embedded")
      .getHorizontalMetric(1).advanceWidth,
    600
  );

  const danglingRequired = good.slice();
  const danglingRequiredView = new DataView(danglingRequired.buffer);
  danglingRequiredView.setUint32(staleHmtx.recordOffset + 8, 0xfffffffC, false);
  expectPdf(
    () => NativeSfntFont.parse(danglingRequired, 0, undefined, "pdf-embedded"),
    "unsupported-font",
    /hmtx.*out of bounds/i
  );

  const badSearchHints = good.slice();
  const badSearchHintsView = new DataView(badSearchHints.buffer);
  badSearchHintsView.setUint16(6, 16, false);
  badSearchHintsView.setUint16(8, 0, false);
  badSearchHintsView.setUint16(10, 0, false);
  expectPdf(
    () => NativeSfntFont.parse(badSearchHints),
    "unsupported-font",
    /search fields/i
  );
  assert.equal(
    NativeSfntFont.parse(badSearchHints, 0, undefined, "pdf-embedded").numGlyphs,
    10
  );

  const unsortedDirectory = good.slice();
  const firstRecord = unsortedDirectory.slice(12, 28);
  unsortedDirectory.copyWithin(12, 28, 44);
  unsortedDirectory.set(firstRecord, 28);
  expectPdf(
    () => NativeSfntFont.parse(unsortedDirectory),
    "unsupported-font",
    /directory is unsorted/i
  );
  assert.equal(
    NativeSfntFont.parse(unsortedDirectory, 0, undefined, "pdf-embedded").unitsPerEm,
    1000
  );

  const packedTables = buildSfnt(tablesWithMetadata, 0x00010000, false);
  expectPdf(
    () => NativeSfntFont.parse(packedTables),
    "unsupported-font",
    /cmap.*out of bounds/i
  );
  const packedEmbedded = NativeSfntFont.parse(
    packedTables,
    0,
    undefined,
    "pdf-embedded"
  );
  assert.equal(packedEmbedded.mapCodePoint(0x41), 1);
  assert.equal(packedEmbedded.getGlyphOutline(1).advanceWidth, 600);

  const paddedHmtxTables = cloneTables(fixture.tables);
  paddedHmtxTables.set(
    "hmtx",
    concatenate([paddedHmtxTables.get("hmtx"), Uint8Array.of(0, 5)])
  );
  const paddedHmtx = buildSfnt(paddedHmtxTables);
  expectPdf(
    () => NativeSfntFont.parse(paddedHmtx),
    "unsupported-font",
    /hhea\/hmtx/i
  );
  assert.equal(
    NativeSfntFont.parse(paddedHmtx, 0, undefined, "pdf-embedded")
      .getHorizontalMetric(9).leftSideBearing,
    90
  );

  const staleBearingHmtxTables = cloneTables(fixture.tables);
  staleBearingHmtxTables.set(
    "hmtx",
    concatenate([staleBearingHmtxTables.get("hmtx"), Uint8Array.of(0, 12, 0, 12)])
  );
  assert.equal(
    NativeSfntFont.parse(
      buildSfnt(staleBearingHmtxTables),
      0,
      undefined,
      "pdf-embedded"
    ).getHorizontalMetric(9).leftSideBearing,
    90,
    "unreachable trailing bearings must not alter count-derived metrics"
  );

  const oversizedHmtxTables = cloneTables(fixture.tables);
  oversizedHmtxTables.set(
    "hmtx",
    concatenate([oversizedHmtxTables.get("hmtx"), Uint8Array.of(0, 0, 0, 0, 0, 0)])
  );
  expectPdf(
    () => NativeSfntFont.parse(
      buildSfnt(oversizedHmtxTables),
      0,
      undefined,
      "pdf-embedded"
    ),
    "unsupported-font",
    /hhea\/hmtx/i
  );

  const staleGlyphBoundsTables = cloneTables(fixture.tables);
  new DataView(staleGlyphBoundsTables.get("glyf").buffer)
    .setInt16(fixture.glyphOffsets[1] + 6, 50, false);
  const staleGlyphBounds = buildSfnt(staleGlyphBoundsTables);
  const strictStaleBoundsFont = NativeSfntFont.parse(staleGlyphBounds);
  expectPdf(
    () => strictStaleBoundsFont.getGlyphOutline(1),
    "unsupported-font",
    /outside.*declared bounds/i
  );
  const embeddedStaleBoundsOutline = NativeSfntFont.parse(
    staleGlyphBounds,
    0,
    undefined,
    "pdf-embedded"
  ).getGlyphOutline(1);
  assert.deepEqual(
    embeddedStaleBoundsOutline.bounds,
    [0, 0, 200, 100],
    "PDF subsets derive safe geometry bounds without clamping stale-header points"
  );
  assert.deepEqual(
    embeddedStaleBoundsOutline.commands.slice(0, 3),
    [
      { kind: "move", x: 0, y: 0 },
      { kind: "line", x: 100, y: 0 },
      { kind: "line", x: 200, y: 0 }
    ]
  );

  const oversizedCompoundCoordinates = cloneTables(fixture.tables);
  new DataView(oversizedCompoundCoordinates.get("glyf").buffer)
    .setInt16(fixture.glyphOffsets[3] + 14, 32_767, false);
  const oversizedCompoundFont = NativeSfntFont.parse(
    buildSfnt(oversizedCompoundCoordinates),
    0,
    undefined,
    "pdf-embedded"
  );
  expectPdf(
    () => oversizedCompoundFont.getGlyphOutline(3),
    "unsupported-font",
    /FWORD coordinate range/i
  );

  expectPdf(
    () => NativeSfntFont.parse(good, 0, { maxSfntTables: tablesWithMetadata.size - 1 }, "pdf-embedded"),
    "resource-limit",
    /table count/i
  );
}

function testBinaryHmtxNormalizationFixtures() {
  expectPdf(
    () => NativeSfntFont.parse(hmtxUnderCountFixture),
    "unsupported-font",
    /hhea\/hmtx/i
  );
  const underCount = NativeSfntFont.parse(
    hmtxUnderCountFixture,
    0,
    undefined,
    "pdf-embedded"
  );
  assert.deepEqual(
    underCount.getHorizontalMetric(2),
    { advanceWidth: 600, leftSideBearing: 50 },
    "an omitted trailing bearing is recovered exactly from glyph xMin"
  );
  assert.deepEqual(
    underCount.getGlyphOutline(2).bounds,
    [50, 0, 150, 100],
    "metric recovery does not alter glyph geometry"
  );
  assert.equal(underCount.diagnostics.length, 1);
  assert.deepEqual(underCount.diagnostics[0], {
    code: "font.sfnt-horizontal-metrics-normalized",
    severity: "warning",
    message: "An embedded sfnt omitted trailing horizontal bearings; exact values were recovered from glyph xMin bounds.",
    details: {
      reason: "hmtx-missing-bearings",
      numGlyphs: 3,
      numberOfHMetrics: 2,
      actualLength: 8,
      expectedLength: 10,
      recoveredBearingCount: 1
    }
  });

  expectPdf(
    () => NativeSfntFont.parse(hmtxOverCountFixture),
    "unsupported-font",
    /hhea\/hmtx/i
  );
  const overCount = NativeSfntFont.parse(
    hmtxOverCountFixture,
    0,
    undefined,
    "pdf-embedded"
  );
  assert.deepEqual(
    overCount.getHorizontalMetric(2),
    { advanceWidth: 600, leftSideBearing: 50 },
    "an unreachable bounded hmtx tail cannot alter count-derived metrics"
  );
  assert.equal(overCount.diagnostics[0]?.details?.reason, "hmtx-trailing-bytes");
  assert.equal(overCount.diagnostics[0]?.details?.ignoredByteCount, 2);

  const missingInvariant = hmtxUnderCountFixture.slice();
  const missingInvariantHead = findSfntRecord(missingInvariant, "head");
  const missingInvariantView = new DataView(missingInvariant.buffer);
  missingInvariantView.setUint16(
    missingInvariantHead.offset + 16,
    missingInvariantView.getUint16(missingInvariantHead.offset + 16, false) & ~0x0002,
    false
  );
  expectPdf(
    () => NativeSfntFont.parse(missingInvariant, 0, undefined, "pdf-embedded"),
    "unsupported-font",
    /hhea\/hmtx/i
  );

  const missingLongMetricTables = cloneTables(buildFixture().tables);
  const missingLongMetricHead = new DataView(missingLongMetricTables.get("head").buffer);
  missingLongMetricHead.setUint16(16, missingLongMetricHead.getUint16(16, false) | 0x0002, false);
  missingLongMetricTables.set(
    "hmtx",
    missingLongMetricTables.get("hmtx").subarray(0, 15).slice()
  );
  expectPdf(
    () => NativeSfntFont.parse(
      buildSfnt(missingLongMetricTables),
      0,
      undefined,
      "pdf-embedded"
    ),
    "unsupported-font",
    /hhea\/hmtx/i
  );
}

function testLazyGlyphValidationAndLimits() {
  const fixture = buildFixture();
  const bytes = buildSfnt(fixture.tables);
  const font = NativeSfntFont.parse(bytes);

  // Glyph 5 is deliberately recursive. Its malformed body remains lazy and
  // cannot prevent unrelated mapped glyphs from compiling.
  assert.equal(font.getGlyphOutline(1).commands[0].kind, "move");
  expectPdf(() => font.getGlyphOutline(5), "unsupported-font", /recursive/i);

  const repeatOverflow = cloneTables(fixture.tables);
  repeatOverflow.get("glyf")[fixture.glyphOffsets[1] + 18] = 0xff;
  const repeatFont = NativeSfntFont.parse(buildSfnt(repeatOverflow));
  expectPdf(() => repeatFont.getGlyphOutline(1), "unsupported-font", /flag repeats/i);

  const reservedSimpleFlag = cloneTables(fixture.tables);
  reservedSimpleFlag.get("glyf")[fixture.glyphOffsets[1] + 16] |= 0x80;
  const reservedSimpleFont = NativeSfntFont.parse(buildSfnt(reservedSimpleFlag));
  expectPdf(() => reservedSimpleFont.getGlyphOutline(1), "unsupported-font", /reserved flag/i);

  const badContours = cloneTables(fixture.tables);
  new DataView(badContours.get("glyf").buffer).setInt16(fixture.glyphOffsets[1], 2, false);
  new DataView(badContours.get("maxp").buffer).setUint16(8, 2, false);
  const badContourFont = NativeSfntFont.parse(buildSfnt(badContours));
  expectPdf(() => badContourFont.getGlyphOutline(1), "unsupported-font", /contour endpoints/i);

  const badBounds = cloneTables(fixture.tables);
  new DataView(badBounds.get("glyf").buffer).setInt16(fixture.glyphOffsets[1] + 6, 50, false);
  const badBoundsFont = NativeSfntFont.parse(buildSfnt(badBounds));
  expectPdf(() => badBoundsFont.getGlyphOutline(1), "unsupported-font", /outside.*bounds/i);

  const truncatedInstructions = cloneTables(fixture.tables);
  new DataView(truncatedInstructions.get("glyf").buffer)
    .setUint16(fixture.glyphOffsets[1] + 12, 16, false);
  new DataView(truncatedInstructions.get("maxp").buffer).setUint16(26, 16, false);
  const truncatedInstructionFont = NativeSfntFont.parse(buildSfnt(truncatedInstructions));
  expectPdf(() => truncatedInstructionFont.getGlyphOutline(1), "unsupported-font", /out of bounds/i);

  const reservedCompoundFlag = cloneTables(fixture.tables);
  const compoundView = new DataView(reservedCompoundFlag.get("glyf").buffer);
  compoundView.setUint16(
    fixture.glyphOffsets[3] + 10,
    compoundView.getUint16(fixture.glyphOffsets[3] + 10, false) | 0x0010,
    false
  );
  const reservedCompoundFont = NativeSfntFont.parse(buildSfnt(reservedCompoundFlag));
  expectPdf(() => reservedCompoundFont.getGlyphOutline(3), "unsupported-font", /reserved component/i);

  const badPointMatch = cloneTables(fixture.tables);
  new DataView(badPointMatch.get("glyf").buffer).setUint16(fixture.glyphOffsets[4] + 22, 99, false);
  const badPointFont = NativeSfntFont.parse(buildSfnt(badPointMatch));
  expectPdf(() => badPointFont.getGlyphOutline(4), "unsupported-font", /point-matching/i);

  const conflictingTransform = cloneTables(fixture.tables);
  const transformView = new DataView(conflictingTransform.get("glyf").buffer);
  transformView.setUint16(
    fixture.glyphOffsets[8] + 10,
    transformView.getUint16(fixture.glyphOffsets[8] + 10, false) | 0x0008,
    false
  );
  const conflictingTransformFont = NativeSfntFont.parse(buildSfnt(conflictingTransform));
  expectPdf(() => conflictingTransformFont.getGlyphOutline(8), "unsupported-font", /conflicting transforms/i);

  const badComponentGid = cloneTables(fixture.tables);
  new DataView(badComponentGid.get("glyf").buffer)
    .setUint16(fixture.glyphOffsets[3] + 12, 99, false);
  const badComponentFont = NativeSfntFont.parse(buildSfnt(badComponentGid));
  expectPdf(() => badComponentFont.getGlyphOutline(3), "unsupported-font", /Glyph ID 99/i);

  const maxpPoints = cloneTables(fixture.tables);
  new DataView(maxpPoints.get("maxp").buffer).setUint16(6, 4, false);
  const maxpPointFont = NativeSfntFont.parse(buildSfnt(maxpPoints));
  expectPdf(() => maxpPointFont.getGlyphOutline(1), "unsupported-font", /maxp point/i);

  const maxpDepth = cloneTables(fixture.tables);
  new DataView(maxpDepth.get("maxp").buffer).setUint16(30, 1, false);
  const maxpDepthFont = NativeSfntFont.parse(buildSfnt(maxpDepth));
  expectPdf(() => maxpDepthFont.getGlyphOutline(7), "unsupported-font", /maxp profile/i);

  const pointLimited = NativeSfntFont.parse(bytes, 0, { maxGlyphPoints: 4 });
  expectPdf(() => pointLimited.getGlyphOutline(1), "resource-limit", /point limit/i);
  const componentLimited = NativeSfntFont.parse(bytes, 0, { maxCompoundGlyphComponents: 1 });
  expectPdf(() => componentLimited.getGlyphOutline(4), "resource-limit", /component limit/i);
  const depthLimited = NativeSfntFont.parse(bytes, 0, { maxCompoundGlyphDepth: 1 });
  expectPdf(() => depthLimited.getGlyphOutline(7), "resource-limit", /nesting limit/i);
  const instructionLimited = NativeSfntFont.parse(bytes, 0, { maxGlyphInstructionBytes: 1 });
  expectPdf(() => instructionLimited.getGlyphOutline(1), "resource-limit", /instruction byte/i);
}

function testCmapValidationAndLimits() {
  const fixture = buildFixture();

  const outOfRange = cloneTables(fixture.tables);
  outOfRange.set("cmap", buildCmap([{ platform: 0, encoding: 2, bytes: cmapFormat6(0x41, [99]) }]));
  const outOfRangeFont = NativeSfntFont.parse(buildSfnt(outOfRange));
  expectPdf(() => outOfRangeFont.mapCodePoint(0x41), "unsupported-font", /out-of-range glyph ID/i);

  const badFormat4 = cmapFormat4([[0x41, 1]]);
  new DataView(badFormat4.buffer).setUint16(22, 0xfffe, false);
  const malformed4 = cloneTables(fixture.tables);
  malformed4.set("cmap", buildCmap([{ platform: 3, encoding: 1, bytes: badFormat4 }]));
  expectPdf(() => NativeSfntFont.parse(buildSfnt(malformed4)), "unsupported-font", /terminal sentinel/i);

  const malformed12 = cloneTables(fixture.tables);
  malformed12.set("cmap", buildCmap([{
    platform: 0,
    encoding: 4,
    bytes: cmapFormat12([[0x100, 0x101, 1], [0x101, 0x102, 3]])
  }]));
  expectPdf(() => NativeSfntFont.parse(buildSfnt(malformed12)), "unsupported-font", /overlap/i);

  const malformed14 = cloneTables(fixture.tables);
  malformed14.set("cmap", buildCmap([
    { platform: 0, encoding: 4, bytes: cmapFormat12([[0x41, 0x41, 1]]) },
    { platform: 0, encoding: 5, bytes: cmapFormat14(0x41) }
  ]));
  expectPdf(() => NativeSfntFont.parse(buildSfnt(malformed14)), "unsupported-font", /duplicated/i);

  const unsupported = cloneTables(fixture.tables);
  const format2 = new Uint8Array(6);
  new DataView(format2.buffer).setUint16(0, 2, false);
  unsupported.set("cmap", buildCmap([{ platform: 3, encoding: 1, bytes: format2 }]));
  expectPdf(() => NativeSfntFont.parse(buildSfnt(unsupported)), "unsupported-font", /no supported base cmap/i);

  const unsortedRecords = cloneTables(fixture.tables);
  unsortedRecords.set("cmap", buildCmap([
    { platform: 3, encoding: 1, bytes: cmapFormat4([[0x41, 1]]) },
    { platform: 0, encoding: 4, bytes: cmapFormat12([[0x41, 0x41, 1]]) }
  ]));
  expectPdf(() => NativeSfntFont.parse(buildSfnt(unsortedRecords)), "unsupported-font", /records are unsorted/i);

  const duplicateRecords = cloneTables(fixture.tables);
  duplicateRecords.set("cmap", buildCmap([
    { platform: 3, encoding: 1, bytes: cmapFormat4([[0x41, 1]]) },
    { platform: 3, encoding: 1, bytes: cmapFormat4([[0x42, 2]]) }
  ]));
  expectPdf(() => NativeSfntFont.parse(buildSfnt(duplicateRecords)), "unsupported-font", /duplicate platform/i);

  expectPdf(
    () => NativeSfntFont.parse(buildSfnt(fixture.tables), 0, { maxSfntCmapRecords: 1 }),
    "resource-limit",
    /record count/i
  );
  expectPdf(
    () => NativeSfntFont.parse(buildSfnt(fixture.tables), 0, { maxSfntCmapGroups: 1 }),
    "resource-limit",
    /group count/i
  );
}

function testStandaloneCmapFormats(fixture) {
  const cases = [
    { label: "format 0", platform: 0, encoding: 0, bytes: cmapFormat0([[0x20, 1]]), code: 0x20, glyph: 1 },
    { label: "format 4", platform: 3, encoding: 1, bytes: cmapFormat4([[0x41, 1]]), code: 0x41, glyph: 1 },
    { label: "format 6", platform: 0, encoding: 3, bytes: cmapFormat6(0x42, [2]), code: 0x42, glyph: 2 },
    { label: "format 10", platform: 0, encoding: 4, bytes: cmapFormat10(0x10000, [3]), code: 0x10000, glyph: 3 },
    { label: "format 12", platform: 0, encoding: 4, bytes: cmapFormat12([[0x1f600, 0x1f600, 4]]), code: 0x1f600, glyph: 4 },
    { label: "format 13", platform: 0, encoding: 6, bytes: cmapFormat13([[0x1f9ea, 0x1f9ea, 2]]), code: 0x1f9ea, glyph: 2 }
  ];
  for (const fixtureCase of cases) {
    const tables = cloneTables(fixture.tables);
    tables.set("cmap", buildCmap([fixtureCase]));
    const font = NativeSfntFont.parse(buildSfnt(tables));
    assert.equal(font.mapCodePoint(fixtureCase.code), fixtureCase.glyph, fixtureCase.label);
  }

  const exclusive = cloneTables(fixture.tables);
  exclusive.set("cmap", buildCmap([
    { platform: 0, encoding: 4, bytes: cmapFormat12([[0x1f600, 0x1f600, 4]]) },
    { platform: 3, encoding: 1, bytes: cmapFormat4([[0x41, 1]]) }
  ]));
  assert.equal(
    NativeSfntFont.parse(buildSfnt(exclusive)).mapCodePoint(0x41),
    0,
    "a lower-priority base cmap must not supplement the selected base cmap"
  );
}

function testCollectionsAndKernelRouting() {
  const fixture = buildFixture();
  const collection = buildTtc([fixture.tables, fixture.tables]);
  assert.equal(NativeSfntFont.parse(collection, 0).mapCodePoint(0x41), 1);
  assert.equal(NativeSfntFont.parse(collection, 1).getGlyphOutline(2).commands[0].kind, "move");
  expectPdf(() => NativeSfntFont.parse(collection, 2), "unsupported-font", /face.*range/i);
  expectPdf(
    () => NativeSfntFont.parse(collection, 0, { maxSfntFaces: 1 }),
    "resource-limit",
    /face count/i
  );

  const duplicateFaces = collection.slice();
  const collectionView = new DataView(duplicateFaces.buffer);
  collectionView.setUint32(16, collectionView.getUint32(12, false), false);
  expectPdf(() => NativeSfntFont.parse(duplicateFaces), "unsupported-font", /face offset/i);

  const tableOverDirectory = collection.slice();
  const tableOverlapView = new DataView(tableOverDirectory.buffer);
  const firstFace = tableOverlapView.getUint32(12, false);
  const secondFace = tableOverlapView.getUint32(16, false);
  const firstHead = findSfntRecord(tableOverDirectory, "head", firstFace);
  tableOverlapView.setUint32(firstHead.recordOffset + 8, secondFace, false);
  expectPdf(
    () => NativeSfntFont.parse(tableOverDirectory),
    "unsupported-font",
    /protected collection data/i
  );

  const collectionV2 = buildTtc([fixture.tables], 0x00020000);
  assert.equal(NativeSfntFont.parse(collectionV2).numGlyphs, 10);
  const badDsig = collectionV2.slice();
  new DataView(badDsig.buffer).setUint32(16, 0x44534947, false);
  expectPdf(() => NativeSfntFont.parse(badDsig), "unsupported-font", /DSIG range/i);

  for (const tag of ["CFF ", "CFF2"]) {
    const tables = cloneTables(fixture.tables);
    tables.delete("glyf");
    tables.delete("loca");
    tables.set(tag, Uint8Array.of(1, 0, 0, 0));
    tables.set("maxp", cffMaxp(10));
    const cff = NativeSfntFont.parse(buildSfnt(tables, "OTTO"));
    assert.equal(cff.outlineFormat, tag === "CFF " ? "cff" : "cff2");
    expectPdf(() => cff.getGlyphOutline(1), "unsupported-font", /CFF\/CFF2.*kernel/i);
  }

  const type1Tables = cloneTables(fixture.tables);
  type1Tables.delete("glyf");
  type1Tables.delete("loca");
  type1Tables.set("TYP1", Uint8Array.of(0, 1, 2, 3));
  const type1 = NativeSfntFont.parse(buildSfnt(type1Tables, "typ1"));
  assert.equal(type1.outlineFormat, "unknown");
  expectPdf(() => type1.getGlyphOutline(1), "unsupported-font", /no supported outline table/i);
}

function buildFixture() {
  const { glyf, offsets } = buildGlyphTable();
  const numGlyphs = offsets.length - 1;
  const head = new Uint8Array(54);
  const headView = new DataView(head.buffer);
  headView.setUint32(0, 0x00010000, false);
  headView.setUint32(4, 0x00010000, false);
  headView.setUint32(12, 0x5f0f3cf5, false);
  headView.setUint16(18, 1000, false);
  headView.setInt16(36, 0, false);
  headView.setInt16(38, 0, false);
  headView.setInt16(40, 250, false);
  headView.setInt16(42, 100, false);
  headView.setInt16(50, 1, false);
  headView.setInt16(52, 0, false);

  const maxp = new Uint8Array(32);
  const maxpView = new DataView(maxp.buffer);
  maxpView.setUint32(0, 0x00010000, false);
  maxpView.setUint16(4, numGlyphs, false);
  maxpView.setUint16(6, 5, false);
  maxpView.setUint16(8, 1, false);
  maxpView.setUint16(10, 10, false);
  maxpView.setUint16(12, 2, false);
  maxpView.setUint16(14, 2, false);
  maxpView.setUint16(26, 2, false);
  maxpView.setUint16(28, 2, false);
  maxpView.setUint16(30, 2, false);

  const hhea = new Uint8Array(36);
  const hheaView = new DataView(hhea.buffer);
  hheaView.setUint32(0, 0x00010000, false);
  hheaView.setInt16(4, 800, false);
  hheaView.setInt16(6, -200, false);
  hheaView.setInt16(8, 100, false);
  hheaView.setUint16(10, 900, false);
  hheaView.setInt16(32, 0, false);
  hheaView.setUint16(34, 4, false);

  const hmtx = new Uint8Array(4 * 4 + (numGlyphs - 4) * 2);
  const hmtxView = new DataView(hmtx.buffer);
  for (const [glyphId, advanceWidth, bearing] of [
    [0, 500, 0], [1, 600, 10], [2, 700, 20], [3, 900, 30]
  ]) {
    hmtxView.setUint16(glyphId * 4, advanceWidth, false);
    hmtxView.setInt16(glyphId * 4 + 2, bearing, false);
  }
  for (let glyphId = 4; glyphId < numGlyphs; glyphId += 1) {
    hmtxView.setInt16(16 + (glyphId - 4) * 2, glyphId * 10, false);
  }

  const locaWriter = new ByteWriter();
  offsets.forEach((offset) => locaWriter.u32(offset));
  const tables = new Map([
    ["cmap", buildFullCmap()],
    ["glyf", glyf],
    ["head", head],
    ["hhea", hhea],
    ["hmtx", hmtx],
    ["loca", locaWriter.finish()],
    ["maxp", maxp]
  ]);
  return { tables, glyphOffsets: offsets };
}

function buildGlyphTable() {
  const glyphs = [
    new Uint8Array(),
    repeatedDeltaGlyph(),
    triangleGlyph(),
    compoundXyMetricsGlyph(),
    pointMatchedGlyph(),
    recursiveGlyph(5),
    pointMatchedGlyph(),
    recursiveGlyph(3, [50, 0, 250, 100]),
    transformedGlyph(),
    new Uint8Array()
  ];
  const offsets = [0];
  let length = 0;
  for (const glyph of glyphs) {
    length += glyph.length;
    offsets.push(length);
  }
  return { glyf: concatenate(glyphs), offsets };
}

function repeatedDeltaGlyph() {
  const writer = glyphHeader(1, [0, 0, 200, 100]);
  writer.u16(4).u16(2).bytes(Uint8Array.of(0xaa, 0xbb));
  // OVERLAP_SIMPLE is legal. The second flag repeats once, then short
  // positive/negative deltas exercise all compact coordinate branches.
  writer.bytes(Uint8Array.of(0x71, 0x3b, 1, 0x27, 0x07));
  writer.bytes(Uint8Array.of(100, 100, 100, 100));
  writer.bytes(Uint8Array.of(100, 100));
  return writer.finish();
}

function triangleGlyph() {
  const writer = glyphHeader(1, [0, 0, 10, 10]);
  writer.u16(2).u16(0).bytes(Uint8Array.of(1, 1, 1));
  writer.i16(0).i16(10).i16(-10);
  writer.i16(0).i16(0).i16(10);
  return writer.finish();
}

function compoundXyMetricsGlyph() {
  const writer = glyphHeader(-1, [50, 0, 250, 100]);
  writer.u16(0x0303).u16(1).i16(50).i16(0);
  writer.u16(1).u8(0xcc);
  return writer.finish();
}

function pointMatchedGlyph() {
  const writer = glyphHeader(-1, [0, 0, 20, 10]);
  writer.u16(0x0323).u16(2).i16(0).i16(0);
  writer.u16(0x0201).u16(2).u16(1).u16(0);
  writer.u16(1).u8(0xdd);
  return writer.finish();
}

function recursiveGlyph(componentGlyphId, bounds = [0, 0, 0, 0]) {
  const writer = glyphHeader(-1, bounds);
  writer.u16(0x0003).u16(componentGlyphId).i16(0).i16(0);
  return writer.finish();
}

function transformedGlyph() {
  const writer = glyphHeader(-1, [20, 10, 30, 20]);
  writer.u16(0x0083).u16(2).i16(20).i16(10);
  writer.i16(0x4000).i16(0).i16(0x2000).i16(0x4000);
  return writer.finish();
}

function glyphHeader(contours, bounds) {
  const writer = new ByteWriter();
  writer.i16(contours);
  bounds.forEach((value) => writer.i16(value));
  return writer;
}

function buildFullCmap() {
  return buildCmap([
    { platform: 0, encoding: 4, bytes: cmapFormat12([
      [0x20, 0x20, 1],
      [0x41, 0x42, 1],
      [0x10000, 0x10000, 3],
      [0x1f600, 0x1f600, 4],
      [0x1f9ea, 0x1f9ea, 2]
    ]) },
    { platform: 0, encoding: 5, bytes: cmapFormat14() },
    { platform: 3, encoding: 0, bytes: cmapFormat0([[0x20, 1]]) }
  ]);
}

function buildCmap(records) {
  const headerLength = 4 + records.length * 8;
  let length = headerLength;
  const layouts = records.map((record) => {
    const layout = { ...record, offset: length };
    length += record.bytes.length;
    return layout;
  });
  const output = new Uint8Array(length);
  const view = new DataView(output.buffer);
  view.setUint16(0, 0, false);
  view.setUint16(2, records.length, false);
  layouts.forEach((record, index) => {
    const directory = 4 + index * 8;
    view.setUint16(directory, record.platform, false);
    view.setUint16(directory + 2, record.encoding, false);
    view.setUint32(directory + 4, record.offset, false);
    output.set(record.bytes, record.offset);
  });
  return output;
}

function cmapFormat0(mappings) {
  const output = new Uint8Array(262);
  const view = new DataView(output.buffer);
  view.setUint16(0, 0, false);
  view.setUint16(2, output.length, false);
  for (const [code, glyph] of mappings) output[6 + code] = glyph;
  return output;
}

function cmapFormat4(mappings) {
  const pairs = [...mappings].sort((left, right) => left[0] - right[0]);
  const segments = [...pairs, [0xffff, 0]];
  const count = segments.length;
  const output = new Uint8Array(16 + count * 8);
  const view = new DataView(output.buffer);
  view.setUint16(0, 4, false);
  view.setUint16(2, output.length, false);
  view.setUint16(6, count * 2, false);
  const power = 2 ** Math.floor(Math.log2(count));
  view.setUint16(8, power * 2, false);
  view.setUint16(10, Math.log2(power), false);
  view.setUint16(12, count * 2 - power * 2, false);
  const endCodes = 14;
  const startCodes = endCodes + count * 2 + 2;
  const deltas = startCodes + count * 2;
  const ranges = deltas + count * 2;
  segments.forEach(([code, glyph], index) => {
    view.setUint16(endCodes + index * 2, code, false);
    view.setUint16(startCodes + index * 2, code, false);
    view.setInt16(deltas + index * 2, ((glyph - code + 0x8000) & 0xffff) - 0x8000, false);
    view.setUint16(ranges + index * 2, 0, false);
  });
  return output;
}

function cmapFormat6(first, glyphs) {
  const writer = new ByteWriter();
  writer.u16(6).u16(10 + glyphs.length * 2).u16(0).u16(first).u16(glyphs.length);
  glyphs.forEach((glyph) => writer.u16(glyph));
  return writer.finish();
}

function cmapFormat10(first, glyphs) {
  const writer = new ByteWriter();
  writer.u16(10).u16(0).u32(20 + glyphs.length * 2).u32(0).u32(first).u32(glyphs.length);
  glyphs.forEach((glyph) => writer.u16(glyph));
  return writer.finish();
}

function cmapFormat12(groups) {
  return cmapGroupedFormat(12, groups);
}

function cmapFormat13(groups) {
  return cmapGroupedFormat(13, groups);
}

function cmapGroupedFormat(format, groups) {
  const writer = new ByteWriter();
  writer.u16(format).u16(0).u32(16 + groups.length * 12).u32(0).u32(groups.length);
  groups.forEach(([start, end, glyph]) => writer.u32(start).u32(end).u32(glyph));
  return writer.finish();
}

function cmapFormat14(nonDefaultCode = 0x42) {
  const writer = new ByteWriter();
  const length = 58;
  writer.u16(14).u32(length).u32(2);
  writer.u24(0xfe0f).u32(32).u32(40);
  writer.u24(0xe0100).u32(0).u32(49);
  writer.u32(1).u24(0x41).u8(0);
  writer.u32(1).u24(nonDefaultCode).u16(3);
  writer.u32(1).u24(0x1f600).u16(2);
  return writer.finish();
}

function buildSfnt(tables, signature = 0x00010000, alignTables = true) {
  const records = [...tables]
    .map(([tag, bytes]) => ({ tag, bytes }))
    .sort(compareTableTags);
  const directoryLength = 12 + records.length * 16;
  let cursor = alignTables ? align4(directoryLength) : directoryLength;
  for (const record of records) {
    record.offset = cursor;
    cursor = alignTables ? align4(cursor + record.bytes.length) : cursor + record.bytes.length;
  }
  const output = new Uint8Array(cursor);
  writeSfntFace(output, 0, records, signature);
  return output;
}

function buildTtc(faces, version = 0x00010000) {
  const headerLength = 12 + faces.length * 4 + (version === 0x00020000 ? 12 : 0);
  let directoryCursor = align4(headerLength);
  const layouts = faces.map((tables) => {
    const records = [...tables]
      .map(([tag, bytes]) => ({ tag, bytes }))
      .sort(compareTableTags);
    const layout = { faceOffset: directoryCursor, records };
    directoryCursor = align4(directoryCursor + 12 + records.length * 16);
    return layout;
  });
  let dataCursor = directoryCursor;
  for (const layout of layouts) {
    for (const record of layout.records) {
      record.offset = dataCursor;
      dataCursor = align4(dataCursor + record.bytes.length);
    }
  }
  const output = new Uint8Array(dataCursor);
  const view = new DataView(output.buffer);
  output.set(new TextEncoder().encode("ttcf"), 0);
  view.setUint32(4, version, false);
  view.setUint32(8, faces.length, false);
  layouts.forEach((layout, index) => {
    view.setUint32(12 + index * 4, layout.faceOffset, false);
    writeSfntFace(output, layout.faceOffset, layout.records, 0x00010000);
  });
  return output;
}

function writeSfntFace(output, faceOffset, records, signature) {
  const view = new DataView(output.buffer);
  if (typeof signature === "string") {
    output.set(new TextEncoder().encode(signature), faceOffset);
  } else {
    view.setUint32(faceOffset, signature, false);
  }
  view.setUint16(faceOffset + 4, records.length, false);
  const power = 2 ** Math.floor(Math.log2(records.length));
  view.setUint16(faceOffset + 6, power * 16, false);
  view.setUint16(faceOffset + 8, Math.log2(power), false);
  view.setUint16(faceOffset + 10, records.length * 16 - power * 16, false);
  records.forEach((record, index) => {
    const directory = faceOffset + 12 + index * 16;
    output.set(new TextEncoder().encode(record.tag), directory);
    view.setUint32(directory + 4, tableChecksum(record.bytes, record.tag === "head"), false);
    view.setUint32(directory + 8, record.offset, false);
    view.setUint32(directory + 12, record.bytes.length, false);
    output.set(record.bytes, record.offset);
  });
}

function tableChecksum(bytes, zeroHeadAdjustment) {
  let checksum = 0;
  for (let offset = 0; offset < bytes.length; offset += 4) {
    let word = 0;
    for (let byte = 0; byte < 4; byte += 1) {
      const position = offset + byte;
      const value = position >= bytes.length ||
        (zeroHeadAdjustment && position >= 8 && position < 12)
        ? 0
        : bytes[position];
      word = (word * 256 + value) >>> 0;
    }
    checksum = (checksum + word) >>> 0;
  }
  return checksum;
}

function findSfntRecord(bytes, tag, faceOffset = 0) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(faceOffset + 4, false);
  for (let index = 0; index < count; index += 1) {
    const recordOffset = faceOffset + 12 + index * 16;
    const candidate = String.fromCharCode(...bytes.subarray(recordOffset, recordOffset + 4));
    if (candidate === tag) {
      return {
        recordOffset,
        offset: view.getUint32(recordOffset + 8, false),
        length: view.getUint32(recordOffset + 12, false)
      };
    }
  }
  throw new Error(`No ${tag} table`);
}

function cffMaxp(numGlyphs) {
  const output = new Uint8Array(6);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x00005000, false);
  view.setUint16(4, numGlyphs, false);
  return output;
}

function cloneTables(tables) {
  return new Map([...tables].map(([tag, bytes]) => [tag, bytes.slice()]));
}

function concatenate(chunks) {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function align4(value) {
  return (value + 3) & ~3;
}

function compareTableTags(left, right) {
  return left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0;
}

function expectPdf(callback, code, messagePattern) {
  assert.throws(
    callback,
    (error) => error instanceof PdfError && error.code === code && messagePattern.test(error.message),
    `expected PdfError(${code}) matching ${messagePattern}`
  );
}

class ByteWriter {
  constructor() {
    this.values = [];
  }

  u8(value) {
    this.values.push(value & 0xff);
    return this;
  }

  u16(value) {
    this.values.push((value >>> 8) & 0xff, value & 0xff);
    return this;
  }

  i16(value) {
    return this.u16(value & 0xffff);
  }

  u24(value) {
    this.values.push((value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
    return this;
  }

  u32(value) {
    this.values.push(
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff
    );
    return this;
  }

  bytes(bytes) {
    this.values.push(...bytes);
    return this;
  }

  finish() {
    return Uint8Array.from(this.values);
  }
}

try {
  testCheckedSfntAndCmaps();
  testTableDirectoryAndMetricValidation();
  testPdfEmbeddedSubsetCompatibility();
  testBinaryHmtxNormalizationFixtures();
  testLazyGlyphValidationAndLimits();
  testCmapValidationAndLimits();
  testCollectionsAndKernelRouting();
} finally {
  hooks.deregister();
}

console.log("native sfnt semantics tests passed");
