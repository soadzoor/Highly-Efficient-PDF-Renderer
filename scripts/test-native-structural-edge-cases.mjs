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

const { openNativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
const { isPdfDictionary, isPdfName } = await import("../src/pdf/nativeCos.ts");
const { readNativeXref } = await import("../src/pdf/nativeXref.ts");
const {
  DEFAULT_PDF_RESOURCE_LIMITS,
  PdfError,
  throwIfAborted
} = await import("../src/pdf/nativeTypes.ts");

const encoder = new TextEncoder();

class Builder {
  #parts = [];
  length = 0;

  append(value) {
    const part = bytes(value);
    this.#parts.push(part);
    this.length += part.length;
  }

  build() {
    return concatenate(this.#parts);
  }
}

try {
  await testHybridLookupOrder();
  await testHybridEncryptionDeclaration();
  await testRepairedXrefStreamEncryptionDeclaration();
  await testRevisionCycles();
  await testRevisionDirectionAndLimit();
  await testLinearizedForwardRevisionChain();
  await testClassicSubsectionsAndFreeEntries();
  await testFinalStartXrefSyntax();
  await testStartXrefTailWindows();
  await testXrefStreamRangesAndArithmetic();
  await testObjectStreamBoundaries();
  await testObjectStreamCacheBudget();
  await testFreeGenerationUpdate();
  await testDuplicateDictionaryBootstrapRepair();
  await testDuplicateDictionaryTargetedRetryFallsBackToFullRepair();
  await testBootstrapFailureUsesSingleRepair();
  await testRepairSkipsStreamPayloads();
} finally {
  hooks.deregister();
}

console.log("native structural edge-case tests passed");

async function testHybridLookupOrder() {
  const document = await openStrict(hybridLookupFixture());
  try {
    const marker = await document.resolveObject(ref(5));
    assert.equal(isPdfDictionary(marker), true);
    assert.equal(marker.get("Winner")?.value, "Classic");
    assert.equal(
      marker.get("Winner")?.value,
      "Classic",
      "the current classic update must precede its supplemental /XRefStm"
    );
  } finally {
    await document.close();
  }
}

async function testHybridEncryptionDeclaration() {
  await assert.rejects(
    openStrict(hybridLookupFixture({ encryptInStream: true })),
    hasPdfError("encrypted", /empty-password/),
    "an /Encrypt entry in the supplemental hybrid xref dictionary must not bypass rejection"
  );
}

async function testRepairedXrefStreamEncryptionDeclaration() {
  const fixture = xrefStreamFixture({
    size: 10,
    index: [0, 5],
    dictionaryEntries: "/Encrypt 9 0 R",
    buildData(offsets, xrefOffset) {
      return concatenate([
        xrefStreamEntry(0, 0, 65_535),
        xrefStreamEntry(1, offsets.get(1), 0),
        xrefStreamEntry(1, offsets.get(2), 0),
        xrefStreamEntry(1, offsets.get(3), 0),
        xrefStreamEntry(1, xrefOffset, 0)
      ]);
    }
  });
  const broken = fixture.slice();
  const text = new TextDecoder("latin1").decode(broken);
  const numberStart = text.lastIndexOf("startxref\n") + "startxref\n".length;
  const numberEnd = text.indexOf("\n", numberStart);
  broken.set(bytes("1".padStart(numberEnd - numberStart, "0")), numberStart);
  await assert.rejects(
    openNativePdfDocument({ kind: "bytes", bytes: broken }, { repair: "safe" }),
    hasPdfError("encrypted", /empty-password/),
    "repair must treat an xref stream dictionary as a trailer before resolving any encrypted objects"
  );
}

async function testRevisionCycles() {
  await assert.rejects(
    openStrict(simpleClassicFixture({ xrefStmSelf: true })),
    hasPdfError("invalid-xref", /XRefStm graph contains a cycle/)
  );
  await assert.rejects(
    openStrict(simpleClassicFixture({ prevSelf: true })),
    hasPdfError("invalid-xref", /xref chain contains a cycle/)
  );
  await assert.rejects(
    openStrict(simpleClassicFixture({ prevOutside: true })),
    hasPdfError("invalid-xref", /outside the PDF source/)
  );
}

async function testRevisionDirectionAndLimit() {
  const base = writeTinyPdf({ objects: basicPageObjects() });
  const baseXref = findFinalStartXref(base);
  const forwardOffset = base.length;
  const forward = bytes([
    "xref",
    "0 1",
    xrefFree(0, 65_535).trimEnd(),
    `trailer\n<< /Size 4 /Root 1 0 R /Prev ${forwardOffset + 1} >>`,
    `startxref\n${forwardOffset}`,
    "%%EOF",
    ""
  ].join("\n"));
  await assert.rejects(
    openStrict(concatenate([base, forward])),
    hasPdfError("invalid-xref", /earlier structural section/)
  );

  const revisionOne = appendNoopRevision(base, baseXref);
  const revisionTwo = appendNoopRevision(revisionOne, findFinalStartXref(revisionOne));
  await assert.rejects(
    openNativePdfDocument(
      { kind: "bytes", bytes: revisionTwo },
      { repair: "off", limits: { maxIncrementalRevisions: 2 } }
    ),
    hasPdfError("resource-limit", /too many incremental revisions/)
  );
}

async function testLinearizedForwardRevisionChain() {
  const valid = linearizedForwardFixture();
  const document = await openStrict(valid);
  try {
    assert.equal(document.info.pageCount, 1);
    assert.equal(document.info.repaired, false);
  } finally {
    await document.close();
  }

  await assert.rejects(
    openStrict(linearizedForwardFixture({ staleLength: true })),
    hasPdfError("invalid-xref", /earlier structural section/)
  );
  await assert.rejects(
    openStrict(linearizedForwardFixture({ cycle: true })),
    hasPdfError("invalid-xref", /contains a cycle/)
  );
  await assert.rejects(
    openNativePdfDocument(
      { kind: "bytes", bytes: linearizedForwardFixture() },
      { repair: "off", limits: { maxIncrementalRevisions: 1 } }
    ),
    hasPdfError("resource-limit", /too many incremental revisions/)
  );
}

async function testClassicSubsectionsAndFreeEntries() {
  await assert.rejects(
    openStrict(simpleClassicFixture({ overlappingSubsection: true })),
    hasPdfError("invalid-xref", /out of order or overlap/)
  );
  await assert.rejects(
    openStrict(simpleClassicFixture({ objectZeroInUse: true })),
    hasPdfError("invalid-xref", /object 0 must be free/)
  );
  await assert.rejects(
    openStrict(simpleClassicFixture({ freeListOutsideSize: true })),
    hasPdfError("invalid-xref", /outside the free-object list/)
  );
}

async function testFinalStartXrefSyntax() {
  const fixture = writeTinyPdf({
    objects: basicPageObjects()
  });
  const withWhitespace = concatenate([fixture, Uint8Array.of(0, 9, 13, 10, 32)]);
  const valid = await openStrict(withWhitespace);
  assert.equal(valid.info.repaired, false);
  await valid.close();

  await assert.rejects(
    openStrict(fixture.subarray(0, fixture.length - 6)),
    hasPdfError("invalid-xref", /%%EOF/)
  );
  await assert.rejects(
    openStrict(concatenate([fixture, bytes("trailing garbage")])),
    hasPdfError("invalid-xref", /%%EOF/)
  );
}

async function testStartXrefTailWindows() {
  const ordinary = writeTinyPdf({
    objects: [
      ...basicPageObjects(),
      { number: 4, body: `(${"A".repeat(2 * 1024 * 1024)})` }
    ]
  });
  const ordinaryReads = [];
  const ordinaryXref = await readTrackedXref(ordinary, ordinaryReads);
  assert.ok(ordinaryXref.entries.size >= 4);
  assert.deepEqual(
    ordinaryReads[0],
    { offset: ordinary.length - 64 * 1024, length: 64 * 1024 },
    "ordinary startxref discovery must not read the historical 1 MiB tail"
  );

  const base = ordinary;
  const boundary = padFinalStartXrefTail(base, 64 * 1024 + 5);
  const boundaryReads = [];
  await readTrackedXref(boundary, boundaryReads);
  assert.deepEqual(boundaryReads.slice(0, 2), [
    { offset: boundary.length - 64 * 1024, length: 64 * 1024 },
    { offset: boundary.length - 128 * 1024, length: 64 * 1024 }
  ], "a boundary-spanning startxref token must fetch only the missing prefix");

  const longTail = padFinalStartXrefTail(base, 900 * 1024);
  const longTailReads = [];
  await readTrackedXref(longTail, longTailReads);
  const tailReads = contiguousTailReads(longTail.length, longTailReads);
  assert.deepEqual(
    tailReads.map(({ length }) => length),
    [64, 64, 128, 256, 512].map((kibibytes) => kibibytes * 1024)
  );
  assert.equal(
    tailReads.reduce((total, read) => total + read.length, 0),
    1024 * 1024,
    "long valid terminal whitespace must remain bounded by the 1 MiB ceiling"
  );

  const malformedEof = ordinary.slice();
  replaceLastAscii(malformedEof, "%%EOF", "%%EOX");
  const malformedEofReads = [];
  await assert.rejects(
    readTrackedXref(malformedEof, malformedEofReads),
    hasPdfError("invalid-xref", /%%EOF/)
  );
  assert.equal(malformedEofReads[0].length, 64 * 1024);
  assert.equal(malformedEofReads.length, 1, "a definitively malformed EOF must not grow the tail window");

  const malformedStartXref = ordinary.slice();
  const malformedText = new TextDecoder("latin1").decode(malformedStartXref);
  const numberOffset = malformedText.lastIndexOf("startxref\n") + "startxref\n".length;
  assert.ok(numberOffset >= "startxref\n".length);
  malformedStartXref[numberOffset] = 0x58;
  const malformedStartReads = [];
  await assert.rejects(
    readTrackedXref(malformedStartXref, malformedStartReads),
    hasPdfError("invalid-xref", /malformed startxref/)
  );
  assert.equal(
    malformedStartReads.length,
    1,
    "fully present malformed startxref syntax must fail without growing"
  );

  const controller = new AbortController();
  const cancellationReads = [];
  await assert.rejects(
    readTrackedXref(boundary, cancellationReads, controller.signal, () => {
      controller.abort(new Error("tail-window fixture abort"));
    }),
    hasPdfError("aborted", /aborted/)
  );
  assert.equal(cancellationReads.length, 1, "cancellation must stop geometric tail growth");
}

async function testXrefStreamRangesAndArithmetic() {
  await assert.rejects(
    openStrict(overlappingXrefStreamFixture()),
    hasPdfError("invalid-xref", /out of order or overlap/)
  );
  await assert.rejects(
    openStrict(overflowingXrefStreamFixture()),
    hasPdfError("resource-limit")
  );
  await assert.rejects(
    openStrict(wideXrefFieldFixture()),
    hasPdfError("invalid-xref", /safe integer range/)
  );
}

async function testObjectStreamBoundaries() {
  await assert.rejects(
    openStrict(objectStreamPageFixture("first-offset")),
    hasPdfError("invalid-object", /first relative offset must be zero/)
  );
  await assert.rejects(
    openStrict(objectStreamPageFixture("trailing-junk")),
    hasPdfError("invalid-object", /declared boundary/)
  );

  const repairFixture = objectStreamPageFixture("valid").slice();
  const repairText = new TextDecoder("latin1").decode(repairFixture);
  const start = repairText.lastIndexOf("startxref\n") + "startxref\n".length;
  const end = repairText.indexOf("\n", start);
  repairFixture.set(bytes("1".padStart(end - start, "0")), start);
  const repaired = await openNativePdfDocument(
    { kind: "bytes", bytes: repairFixture },
    { repair: "safe" }
  );
  try {
    assert.equal(repaired.info.repaired, true);
    assert.equal(repaired.info.pageCount, 1, "repair must reconstruct strict /ObjStm index entries");
  } finally {
    await repaired.close();
  }

  const referenceDocument = await openStrict(objectStreamReferenceFixture());
  try {
    await assert.rejects(
      referenceDocument.resolveObject(ref(7)),
      hasPdfError("invalid-object", /cannot be only an indirect reference/)
    );
  } finally {
    await referenceDocument.close();
  }
}

async function testObjectStreamCacheBudget() {
  const fixture = objectStreamCacheBudgetFixture();
  const limit = fixture.firstDecodedBytes + fixture.secondDecodedBytes - 1;
  const document = await openNativePdfDocument(
    { kind: "bytes", bytes: fixture.bytes },
    { repair: "off", limits: { maxObjectStreamCacheBytes: limit } }
  );
  try {
    const first = await document.resolveObject(ref(7));
    assert.equal(isPdfDictionary(first), true);
    assert.equal(first.get("Marker")?.value, "First");

    const reused = await document.resolveObject(ref(8));
    assert.equal(isPdfDictionary(reused), true);
    assert.equal(reused.get("Marker")?.value, "Reuse");

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(
        document.resolveObject(ref(9)),
        (error) => {
          assert.equal(error instanceof PdfError, true);
          assert.equal(error.code, "resource-limit");
          assert.equal(error.objectNumber, 5);
          assert.deepEqual(error.details, {
            reason: "object-stream-cache-bytes",
            cachedBytes: fixture.firstDecodedBytes,
            decodedBytes: fixture.secondDecodedBytes,
            limit
          });
          return true;
        },
        "distinct object streams must consume the aggregate budget while cache hits do not"
      );
    }
  } finally {
    await document.close();
  }
}

async function testFreeGenerationUpdate() {
  const base = writeTinyPdf({ objects: basicPageObjects() });
  const text = new TextDecoder("latin1").decode(base);
  const previousXref = text.lastIndexOf("\nxref\n") + 1;
  assert.ok(previousXref > 0);
  const updateOffset = base.length;
  const update = bytes([
    "xref",
    "0 1",
    "0000000005 65535 f ",
    "5 1",
    "0000000000 00001 f ",
    `trailer\n<< /Size 6 /Root 1 0 R /Prev ${previousXref} >>`,
    `startxref\n${updateOffset}`,
    "%%EOF",
    ""
  ].join("\n"));
  const document = await openStrict(concatenate([base, update]));
  try {
    assert.equal(await document.resolveObject(ref(5, 0)), null, "a deleted stale generation is null");
    assert.equal(await document.resolveObject(ref(5, 1)), null, "the current free generation is null");
    assert.equal(await document.resolveObject(ref(99, 0)), null, "an undefined object is null");
    assert.equal(await document.resolveObject(ref(1, 1)), null, "a stale reference never aliases a live generation");
    assert.equal(isPdfDictionary(await document.resolveObject(ref(1, 0))), true);
  } finally {
    await document.close();
  }

  const requiredFreeReference = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 4 0 R >>" },
      { number: 5, body: "null" }
    ]
  });
  await assert.rejects(
    openStrict(requiredFreeReference),
    hasPdfError("invalid-page-tree", /node is not a dictionary/),
    "a required consumer must still reject the null value of a free reference"
  );
}

async function testDuplicateDictionaryBootstrapRepair() {
  const filler = new Uint8Array(512 * 1024).fill(0x58);
  const fixture = writeTinyPdf({
    objects: [
      {
        number: 1,
        body: "<< /Type /Catalog /Pages 2 0 R /PageMode /UseOC /PageMode /UseOutlines >>"
      },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>" },
      // This unreferenced payload occupies the middle of the source. A legacy
      // bootstrap repair scans it; the targeted duplicate retry must not.
      { number: 4, body: tinyPdfStream("", filler) }
    ]
  });
  await assert.rejects(
    openStrict(fixture),
    hasPdfError("invalid-object", /duplicate \/PageMode keys/),
    "strict parsing must continue rejecting duplicate dictionary keys"
  );

  const diagnostics = [];
  const readRanges = [];
  const forbiddenOffset = Math.floor(fixture.length / 2);
  let closeCount = 0;
  const repaired = await openNativePdfDocument(
    {
      kind: "range",
      byteLength: fixture.length,
      async read(offset, length, signal) {
        signal.throwIfAborted();
        readRanges.push([offset, length]);
        if (offset <= forbiddenOffset && offset + length > forbiddenOffset) {
          throw new Error("targeted duplicate repair attempted a source-wide read");
        }
        return fixture.slice(offset, offset + length);
      },
      close() { closeCount += 1; }
    },
    { repair: "safe", onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) }
  );
  try {
    assert.equal(repaired.info.repaired, true);
    assert.equal(isPdfName(repaired.catalog.get("PageMode"), "UseOutlines"), true);
    assert.deepEqual(
      diagnostics.map((diagnostic) => diagnostic.code),
      ["xref.repaired", "xref.repair-complete", "object.duplicate-key-repaired"]
    );
    assert.deepEqual(diagnostics[0].details, {
      strictError: "A dictionary contains duplicate /PageMode keys.",
      repairKind: "duplicate-dictionary-key",
      key: "PageMode"
    });
    assert.deepEqual(diagnostics[1].details, {
      objectCount: 5,
      repairKind: "duplicate-dictionary-key"
    });
    assert.deepEqual(diagnostics[2].details, { key: "PageMode", policy: "keep-last" });
    assert.ok(readRanges.length > 0);
    assert.equal(
      readRanges.some(([offset, length]) => offset <= forbiddenOffset && offset + length > forbiddenOffset),
      false,
      "targeted repair must retain the strict xref without reading the source middle"
    );
  } finally {
    await repaired.close();
  }
  assert.equal(closeCount, 1);
}

async function testDuplicateDictionaryTargetedRetryFallsBackToFullRepair() {
  const fixture = writeTinyPdf({
    objects: [
      {
        number: 1,
        body: "<< /Type /Catalog /Pages 2 0 R /PageMode /UseOC /PageMode /UseOutlines >>"
      },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>" }
    ]
  });
  const broken = fixture.slice();
  const text = new TextDecoder("latin1").decode(broken);
  const objectThreeOffset = text.indexOf("3 0 obj\n");
  const xrefOffset = findFinalStartXref(broken);
  const objectOneEntry = xrefOffset + "xref\n0 4\n".length + xrefFree(0, 65_535).length;
  const objectTwoEntry = objectOneEntry + xrefInUse(0).length;
  broken.set(bytes(String(objectThreeOffset).padStart(10, "0")), objectTwoEntry);

  const repaired = await openNativePdfDocument(
    { kind: "bytes", bytes: broken },
    { repair: "safe" }
  );
  try {
    assert.equal(repaired.info.repaired, true);
    assert.equal(repaired.info.pageCount, 1);
    assert.equal(isPdfName(repaired.catalog.get("PageMode"), "UseOutlines"), true);
    const diagnostics = repaired.getDiagnostics();
    assert.deepEqual(
      diagnostics.map(({ code }) => code),
      ["xref.repaired", "xref.repair-complete", "object.duplicate-key-repaired"],
      "a failed targeted retry must fall back to exactly one ordinary repair scan"
    );
    assert.equal(diagnostics[0].details?.repairKind, undefined);
    assert.match(diagnostics[0].details?.strictError ?? "", /different indirect object/);
  } finally {
    await repaired.close();
  }
}

async function testBootstrapFailureUsesSingleRepair() {
  const fixture = writeTinyPdf({ objects: basicPageObjects() });
  const broken = fixture.slice();
  const text = new TextDecoder("latin1").decode(broken);
  const objectTwoOffset = text.indexOf("2 0 obj\n");
  const xrefOffset = findFinalStartXref(broken);
  const firstEntryOffset = xrefOffset + "xref\n0 4\n".length + xrefFree(0, 65_535).length;
  broken.set(bytes(String(objectTwoOffset).padStart(10, "0")), firstEntryOffset);

  await assert.rejects(openStrict(broken), hasPdfError("invalid-xref", /different indirect object/));
  const repaired = await openNativePdfDocument(
    { kind: "bytes", bytes: broken },
    { repair: "safe" }
  );
  try {
    assert.equal(repaired.info.repaired, true);
    assert.equal(repaired.info.pageCount, 1);
    assert.deepEqual(
      repaired.getDiagnostics().map((diagnostic) => diagnostic.code),
      ["xref.repaired", "xref.repair-complete"],
      "a post-xref bootstrap failure must trigger exactly one clean repair attempt"
    );
  } finally {
    await repaired.close();
  }
}

async function testRepairSkipsStreamPayloads() {
  const payload = [
    "q Q",
    "1 0 obj",
    "<< /Type /Catalog /Pages 99 0 R >>",
    "endobj",
    "trailer",
    "<< /Encrypt 99 0 R /Root 1 0 R >>",
    "q Q"
  ].join("\n");
  const fixture = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 4 0 R >>"
      },
      {
        number: 4,
        body: concatenate([
          bytes("<< /Length 5 0 R >>\nstream\n"),
          bytes(payload),
          bytes("\nendstream")
        ])
      },
      { number: 5, body: String(bytes(payload).length) }
    ]
  });
  const broken = fixture.slice();
  const text = new TextDecoder("latin1").decode(broken);
  const numberStart = text.lastIndexOf("startxref\n") + "startxref\n".length;
  const numberEnd = text.indexOf("\n", numberStart);
  broken.fill(0x39, numberStart, numberEnd);

  const document = await openNativePdfDocument(
    { kind: "bytes", bytes: broken },
    { repair: "safe" }
  );
  try {
    assert.equal(document.info.repaired, true);
    assert.equal(document.info.pageCount, 1);
    assert.deepEqual(await document.getDecodedPageContents(0), [bytes(payload)]);
    assert.ok(document.getDiagnostics().some((diagnostic) => diagnostic.code === "xref.repair-complete"));
  } finally {
    await document.close();
  }
}

function hybridLookupFixture({ encryptInStream = false } = {}) {
  const builder = new Builder();
  builder.append("%PDF-1.7\n%test\n");
  const offsets = new Map();
  addObject(builder, offsets, 1, "<< /Type /Catalog /Pages 2 0 R >>");
  addObject(builder, offsets, 2, "<< /Type /Pages /Count 1 /Kids [3 0 R] >>");
  addObject(builder, offsets, 3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>");
  addObject(builder, offsets, 5, "<< /Winner /Hybrid >>");
  const oldObjectFiveOffset = offsets.get(5);

  const mainXref = builder.length;
  builder.append("xref\n0 6\n");
  builder.append(xrefFree(0, 65_535));
  for (let number = 1; number <= 5; number += 1) {
    const objectOffset = offsets.get(number);
    builder.append(objectOffset === undefined ? xrefFree() : xrefInUse(objectOffset));
  }
  builder.append(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${mainXref}\n%%EOF\n`);

  addObject(builder, offsets, 5, "<< /Winner /Classic >>");
  const currentObjectFiveOffset = offsets.get(5);
  const xrefStreamOffset = builder.length;
  offsets.set(7, xrefStreamOffset);
  const hybridEntry = xrefStreamEntry(1, oldObjectFiveOffset, 0);
  builder.append(
    `7 0 obj\n<< /Type /XRef /Size ${encryptInStream ? 10 : 8} /Index [5 1] ` +
    `/W [1 4 2]${encryptInStream ? " /Encrypt 9 0 R" : ""} /Length ${hybridEntry.length} >>\nstream\n`
  );
  builder.append(hybridEntry);
  builder.append("\nendstream\nendobj\n");

  const updateXref = builder.length;
  builder.append("xref\n5 1\n");
  builder.append(xrefInUse(currentObjectFiveOffset));
  builder.append("7 1\n");
  builder.append(xrefInUse(xrefStreamOffset));
  builder.append([
    `trailer\n<< /Size ${encryptInStream ? 10 : 8} /Root 1 0 R /Prev ${mainXref} /XRefStm ${xrefStreamOffset} >>`,
    `startxref\n${updateXref}`,
    "%%EOF",
    ""
  ].join("\n"));
  return builder.build();
}

function appendNoopRevision(base, previousXref) {
  const xrefOffset = base.length;
  return concatenate([base, bytes([
    "xref",
    "0 1",
    xrefFree(0, 65_535).trimEnd(),
    `trailer\n<< /Size 4 /Root 1 0 R /Prev ${previousXref} >>`,
    `startxref\n${xrefOffset}`,
    "%%EOF",
    ""
  ].join("\n"))]);
}

function findFinalStartXref(value) {
  const text = new TextDecoder("latin1").decode(value);
  const marker = text.lastIndexOf("startxref\n");
  assert.notEqual(marker, -1);
  const offset = Number(text.slice(marker + "startxref\n".length).split(/\s/, 1)[0]);
  assert.equal(Number.isSafeInteger(offset), true);
  return offset;
}

function padFinalStartXrefTail(value, targetDistanceFromEnd) {
  const text = new TextDecoder("latin1").decode(value);
  const marker = text.lastIndexOf("startxref");
  const eof = text.lastIndexOf("%%EOF");
  assert.ok(marker >= 0 && eof > marker);
  const currentDistance = value.length - marker;
  const padding = targetDistanceFromEnd - currentDistance;
  assert.ok(padding >= 0);
  return concatenate([
    value.subarray(0, eof),
    new Uint8Array(padding).fill(0x20),
    value.subarray(eof)
  ]);
}

function replaceLastAscii(target, expected, replacement) {
  assert.equal(expected.length, replacement.length);
  const text = new TextDecoder("latin1").decode(target);
  const offset = text.lastIndexOf(expected);
  assert.ok(offset >= 0);
  target.set(bytes(replacement), offset);
}

function contiguousTailReads(byteLength, reads) {
  const tail = [];
  let expectedEnd = byteLength;
  for (const read of reads) {
    if (read.offset + read.length !== expectedEnd) break;
    tail.push(read);
    expectedEnd = read.offset;
  }
  return tail;
}

async function readTrackedXref(value, reads, signal, afterFirstRead) {
  let readCount = 0;
  const reader = {
    byteLength: value.length,
    async read(offset, length, readSignal) {
      throwIfAborted(readSignal);
      assert.ok(Number.isSafeInteger(offset) && offset >= 0);
      assert.ok(Number.isSafeInteger(length) && length >= 0);
      assert.ok(offset + length <= value.length);
      reads.push({ offset, length });
      readCount += 1;
      if (readCount === 1) afterFirstRead?.();
      return value.subarray(offset, offset + length);
    },
    async close() {}
  };
  return await readNativeXref(
    reader,
    DEFAULT_PDF_RESOURCE_LIMITS,
    "off",
    [],
    signal
  );
}

function simpleClassicFixture({
  xrefStmSelf = false,
  prevSelf = false,
  prevOutside = false,
  overlappingSubsection = false,
  objectZeroInUse = false,
  freeListOutsideSize = false
} = {}) {
  const builder = new Builder();
  builder.append("%PDF-1.7\n%test\n");
  const offsets = new Map();
  for (const object of basicPageObjects()) addObject(builder, offsets, object.number, object.body);
  const xrefOffset = builder.length;
  builder.append("xref\n0 4\n");
  builder.append(objectZeroInUse
    ? xrefInUse(0, 0)
    : xrefFree(freeListOutsideSize ? 9 : 0, 65_535));
  for (let number = 1; number <= 3; number += 1) builder.append(xrefInUse(offsets.get(number)));
  if (overlappingSubsection) {
    builder.append("2 1\n");
    builder.append(xrefInUse(offsets.get(2)));
  }
  const extras = [
    prevSelf ? `/Prev ${xrefOffset}` : prevOutside ? "/Prev 999999999" : "",
    xrefStmSelf ? `/XRefStm ${xrefOffset}` : ""
  ].filter(Boolean).join(" ");
  builder.append(`trailer\n<< /Size 4 /Root 1 0 R${extras ? ` ${extras}` : ""} >>\n`);
  builder.append(`startxref\n${xrefOffset}\n%%EOF\n`);
  return builder.build();
}

function overlappingXrefStreamFixture() {
  return xrefStreamFixture({
    size: 5,
    index: [0, 5, 3, 1],
    buildData(offsets, xrefOffset) {
      return concatenate([
        xrefStreamEntry(0, 0, 65_535),
        xrefStreamEntry(1, offsets.get(1), 0),
        xrefStreamEntry(1, offsets.get(2), 0),
        xrefStreamEntry(1, offsets.get(3), 0),
        xrefStreamEntry(1, xrefOffset, 0),
        xrefStreamEntry(1, offsets.get(3), 0)
      ]);
    }
  });
}

function overflowingXrefStreamFixture() {
  return xrefStreamFixture({
    size: Number.MAX_SAFE_INTEGER,
    index: [0, Number.MAX_SAFE_INTEGER],
    widths: [1, 1, 1],
    buildData() { return new Uint8Array(); }
  });
}

function wideXrefFieldFixture() {
  return xrefStreamFixture({
    size: 1,
    index: [0, 1],
    widths: [8, 8, 8],
    buildData() { return new Uint8Array(24).fill(0xff); }
  });
}

function xrefStreamFixture({
  size,
  index,
  widths = [1, 4, 2],
  dictionaryEntries = "",
  buildData
}) {
  const builder = new Builder();
  builder.append("%PDF-1.7\n%\x80\x81\x82\x83\n");
  const offsets = new Map();
  for (const object of basicPageObjects()) addObject(builder, offsets, object.number, object.body);
  const xrefOffset = builder.length;
  const data = buildData(offsets, xrefOffset);
  builder.append([
    `4 0 obj\n<< /Type /XRef /Size ${size} /Root 1 0 R`,
    `/Index [${index.join(" ")}] /W [${widths.join(" ")}]` +
      `${dictionaryEntries ? ` ${dictionaryEntries}` : ""} /Length ${data.length} >>\nstream\n`
  ].join(" "));
  builder.append(data);
  builder.append(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return builder.build();
}

function objectStreamPageFixture(mode) {
  const builder = new Builder();
  builder.append("%PDF-1.7\n%\x80\x81\x82\x83\n");
  const offsets = new Map();
  const catalog = "<< /Type /Catalog /Pages 3 0 R >>";
  const pages = "<< /Type /Pages /Count 1 /Kids [4 0 R] >>";
  const page = "<< /Type /Page /Parent 3 0 R /MediaBox [0 0 10 10] >>";
  let body;
  let relativeOffsets;
  if (mode === "first-offset") {
    body = `X${catalog} ${pages} ${page}`;
    relativeOffsets = [1, bytes(`X${catalog} `).length, bytes(`X${catalog} ${pages} `).length];
  } else if (mode === "trailing-junk") {
    body = `${catalog} JUNK ${pages} ${page}`;
    relativeOffsets = [0, bytes(`${catalog} JUNK `).length, bytes(`${catalog} JUNK ${pages} `).length];
  } else {
    body = `${catalog} ${pages} ${page}`;
    relativeOffsets = [0, bytes(`${catalog} `).length, bytes(`${catalog} ${pages} `).length];
  }
  const header = `2 ${relativeOffsets[0]} 3 ${relativeOffsets[1]} 4 ${relativeOffsets[2]} `;
  const objectStreamData = bytes(header + body);
  offsets.set(1, builder.length);
  builder.append(`1 0 obj\n<< /Type /ObjStm /N 3 /First ${bytes(header).length} /Length ${objectStreamData.length} >>\nstream\n`);
  builder.append(objectStreamData);
  builder.append("\nendstream\nendobj\n");
  const xrefOffset = builder.length;
  offsets.set(6, xrefOffset);
  const data = concatenate([
    xrefStreamEntry(0, 0, 65_535),
    xrefStreamEntry(1, offsets.get(1), 0),
    xrefStreamEntry(2, 1, 0),
    xrefStreamEntry(2, 1, 1),
    xrefStreamEntry(2, 1, 2),
    xrefStreamEntry(0, 0, 0),
    xrefStreamEntry(1, xrefOffset, 0)
  ]);
  builder.append(`6 0 obj\n<< /Type /XRef /Size 7 /Root 2 0 R /W [1 4 2] /Length ${data.length} >>\nstream\n`);
  builder.append(data);
  builder.append(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return builder.build();
}

function objectStreamReferenceFixture() {
  const builder = new Builder();
  builder.append("%PDF-1.7\n%\x80\x81\x82\x83\n");
  const offsets = new Map();
  for (const object of basicPageObjects()) addObject(builder, offsets, object.number, object.body);
  const header = "7 0 ";
  const objectStreamData = bytes(`${header}1 0 R`);
  offsets.set(4, builder.length);
  builder.append(`4 0 obj\n<< /Type /ObjStm /N 1 /First ${bytes(header).length} /Length ${objectStreamData.length} >>\nstream\n`);
  builder.append(objectStreamData);
  builder.append("\nendstream\nendobj\n");
  const xrefOffset = builder.length;
  offsets.set(5, xrefOffset);
  const data = concatenate([
    xrefStreamEntry(0, 0, 65_535),
    xrefStreamEntry(1, offsets.get(1), 0),
    xrefStreamEntry(1, offsets.get(2), 0),
    xrefStreamEntry(1, offsets.get(3), 0),
    xrefStreamEntry(1, offsets.get(4), 0),
    xrefStreamEntry(1, xrefOffset, 0),
    xrefStreamEntry(0, 0, 0),
    xrefStreamEntry(2, 4, 0)
  ]);
  builder.append(`5 0 obj\n<< /Type /XRef /Size 8 /Root 1 0 R /W [1 4 2] /Length ${data.length} >>\nstream\n`);
  builder.append(data);
  builder.append(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return builder.build();
}

function objectStreamCacheBudgetFixture() {
  const builder = new Builder();
  builder.append("%PDF-1.7\n%\x80\x81\x82\x83\n");
  const offsets = new Map();
  for (const object of basicPageObjects()) addObject(builder, offsets, object.number, object.body);

  const firstObject = "<< /Marker /First >>";
  const reusedObject = "<< /Marker /Reuse >>";
  const firstBody = `${firstObject} ${reusedObject}`;
  const firstHeader = `7 0 8 ${bytes(`${firstObject} `).length} `;
  const firstObjectStream = bytes(firstHeader + firstBody);
  offsets.set(4, builder.length);
  builder.append(`4 0 obj\n<< /Type /ObjStm /N 2 /First ${bytes(firstHeader).length} /Length ${firstObjectStream.length} >>\nstream\n`);
  builder.append(firstObjectStream);
  builder.append("\nendstream\nendobj\n");

  const secondHeader = "9 0 ";
  const secondObjectStream = bytes(`${secondHeader}<< /Marker /Second >>`);
  offsets.set(5, builder.length);
  builder.append(`5 0 obj\n<< /Type /ObjStm /N 1 /First ${bytes(secondHeader).length} /Length ${secondObjectStream.length} >>\nstream\n`);
  builder.append(secondObjectStream);
  builder.append("\nendstream\nendobj\n");

  const xrefOffset = builder.length;
  offsets.set(6, xrefOffset);
  const data = concatenate([
    xrefStreamEntry(0, 0, 65_535),
    xrefStreamEntry(1, offsets.get(1), 0),
    xrefStreamEntry(1, offsets.get(2), 0),
    xrefStreamEntry(1, offsets.get(3), 0),
    xrefStreamEntry(1, offsets.get(4), 0),
    xrefStreamEntry(1, offsets.get(5), 0),
    xrefStreamEntry(1, xrefOffset, 0),
    xrefStreamEntry(2, 4, 0),
    xrefStreamEntry(2, 4, 1),
    xrefStreamEntry(2, 5, 0)
  ]);
  builder.append(`6 0 obj\n<< /Type /XRef /Size 10 /Root 1 0 R /W [1 4 2] /Length ${data.length} >>\nstream\n`);
  builder.append(data);
  builder.append(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return {
    bytes: builder.build(),
    firstDecodedBytes: firstObjectStream.length,
    secondDecodedBytes: secondObjectStream.length
  };
}

function basicPageObjects() {
  return [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>" }
  ];
}

function linearizedForwardFixture({ staleLength = false, cycle = false } = {}) {
  const builder = new Builder();
  const offsets = new Map();
  builder.append("%PDF-1.7\n%test\n");
  offsets.set(4, builder.length);
  builder.append("4 0 obj\n<< /Linearized 1 /L LLLLLLLLLL /O 3 /E EEEEEEEEEE /N 1 /T TTTTTTTTTT >>\nendobj\n");
  const firstXref = builder.length;
  builder.append("xref\n4 1\n");
  builder.append(xrefInUse(offsets.get(4)));
  builder.append("trailer\n<< /Size 5 /Root 1 0 R /Prev PPPPPPPPPP >>\n");
  const firstPageEnd = builder.length;
  addObject(builder, offsets, 1, "<< /Type /Catalog /Pages 2 0 R >>");
  addObject(builder, offsets, 2, "<< /Type /Pages /Count 1 /Kids [3 0 R] >>");
  addObject(builder, offsets, 3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>");
  const mainXref = builder.length;
  builder.append("xref\n0 5\n");
  builder.append(xrefFree());
  builder.append(xrefInUse(offsets.get(1)));
  builder.append(xrefInUse(offsets.get(2)));
  builder.append(xrefInUse(offsets.get(3)));
  builder.append(xrefFree(0, 0));
  builder.append(`trailer\n<< /Size 5${cycle ? ` /Prev ${firstXref}` : ""} >>\n`);
  builder.append(`startxref\n${firstXref}\n%%EOF\n`);

  const raw = new TextDecoder("latin1").decode(builder.build());
  const sourceLength = raw.length;
  const fixed = (value) => String(value).padStart(10, " ");
  return bytes(raw
    .replace("LLLLLLLLLL", fixed(staleLength ? sourceLength + 1 : sourceLength))
    .replace("EEEEEEEEEE", fixed(firstPageEnd))
    .replace("TTTTTTTTTT", fixed(mainXref + "xref\n0 5\n".length))
    .replace("PPPPPPPPPP", fixed(mainXref)));
}

function addObject(builder, offsets, number, body) {
  offsets.set(number, builder.length);
  builder.append(`${number} 0 obj\n`);
  builder.append(body);
  builder.append("\nendobj\n");
}

function xrefInUse(offset, generation = 0) {
  return `${String(offset).padStart(10, "0")} ${String(generation).padStart(5, "0")} n \n`;
}

function xrefFree(next = 0, generation = 65_535) {
  return `${String(next).padStart(10, "0")} ${String(generation).padStart(5, "0")} f \n`;
}

function xrefStreamEntry(type, field1, field2) {
  return Uint8Array.of(
    type,
    (field1 >>> 24) & 255,
    (field1 >>> 16) & 255,
    (field1 >>> 8) & 255,
    field1 & 255,
    (field2 >>> 8) & 255,
    field2 & 255
  );
}

function ref(objectNumber, generation = 0) {
  return { kind: "ref", objectNumber, generation };
}

function bytes(value) {
  return typeof value === "string" ? encoder.encode(value) : value;
}

function concatenate(parts) {
  const normalized = parts.map(bytes);
  const output = new Uint8Array(normalized.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of normalized) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

async function openStrict(bytesValue) {
  return await openNativePdfDocument(
    { kind: "bytes", bytes: bytesValue },
    { repair: "off" }
  );
}

function hasPdfError(code, message) {
  return (error) => error instanceof PdfError && error.code === code &&
    (message === undefined || message.test(error.message));
}
