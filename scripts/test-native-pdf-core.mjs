import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { deflateSync } from "node:zlib";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const {
  PdfError,
  createPdfRandomAccessReader,
  decodePdfFilterChain,
  isPdfDictionary,
  openNativePdfDocument
} = await import("../src/pdf/nativePdf.ts");
const { tinyPdfStream, writeTinyPdf } = await import("./lib/tinyPdfWriter.mjs");

const encoder = new TextEncoder();

function bytes(value) {
  return typeof value === "string" ? encoder.encode(value) : value;
}

function join(parts) {
  const normalized = parts.map(bytes);
  const output = new Uint8Array(normalized.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of normalized) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function patchFixedWidthDecimal(target, marker, value, width = 10) {
  const text = new TextDecoder("latin1").decode(target);
  const markerOffset = text.indexOf(marker);
  assert.notEqual(markerOffset, -1, `missing ${marker} placeholder`);
  const digits = String(value).padStart(width, "0");
  assert.equal(digits.length, width, `${marker} value exceeds its placeholder`);
  target.set(bytes(digits), markerOffset + marker.length);
}

function classicFixture({
  encrypted = false,
  brokenStartXref = false,
  incremental = false,
  indirectLength = false
} = {}) {
  const parts = ["%PDF-1.7\n%\x80\x81\x82\x83\n"];
  let length = bytes(parts[0]).length;
  const offsets = new Map();
  const addObject = (number, body) => {
    offsets.set(number, length);
    const value = `${number} 0 obj\n${body}\nendobj\n`;
    parts.push(value);
    length += bytes(value).length;
  };
  addObject(1, "<< /Type /Catalog /Pages 2 0 R /Lang <FEFF00680075002D00480055> >>");
  addObject(2, "<< /Type /Pages /Count 1 /Kids [3 0 R] /MediaBox [-10 -20 310 220] /Resources << >> >>");
  addObject(3, "<< /Type /Page /Parent 2 0 R /CropBox [0 0 300 200] /Rotate 90 /UserUnit 2 /Contents 4 0 R >>");
  const content = indirectLength ? "prefix\nendstream\nsuffix" : "0 0 m 10 10 l S";
  addObject(4, `<< /Length ${indirectLength ? "5 0 R" : content.length} >>\nstream\n${content}\nendstream`);
  if (indirectLength) addObject(5, String(content.length));
  if (encrypted) addObject(9, "<< /Filter /Standard >>");
  const firstXref = length;
  const size = encrypted ? 10 : indirectLength ? 6 : 5;
  parts.push(`xref\n0 ${size}\n`);
  parts.push("0000000000 65535 f \n");
  for (let number = 1; number < size; number += 1) {
    const offset = offsets.get(number) ?? 0;
    parts.push(`${String(offset).padStart(10, "0")} ${offset ? "00000 n" : "65535 f"} \n`);
  }
  parts.push(`trailer\n<< /Size ${size} /Root 1 0 R${encrypted ? " /Encrypt 9 0 R" : ""} >>\n`);
  parts.push(`startxref\n${brokenStartXref ? 1 : firstXref}\n%%EOF\n`);
  length = parts.reduce((sum, part) => sum + bytes(part).length, 0);

  if (incremental) {
    offsets.set(2, length);
    const pages = "2 0 obj\n<< /Type /Pages /Count 2 /Kids [3 0 R 5 0 R] /MediaBox [-10 -20 310 220] /Resources << >> >>\nendobj\n";
    parts.push(pages);
    length += bytes(pages).length;
    offsets.set(5, length);
    const page = "5 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n";
    parts.push(page);
    length += bytes(page).length;
    const secondXref = length;
    parts.push("xref\n2 1\n");
    parts.push(`${String(offsets.get(2)).padStart(10, "0")} 00000 n \n`);
    parts.push("5 1\n");
    parts.push(`${String(offsets.get(5)).padStart(10, "0")} 00000 n \n`);
    parts.push(`trailer\n<< /Size 6 /Root 1 0 R /Prev ${firstXref} >>\nstartxref\n${secondXref}\n%%EOF\n`);
  }
  return join(parts);
}

function xrefAndObjectStreamFixture({
  objectZeroGeneration = 65_535,
  generationWidth = 2
} = {}) {
  assert.ok(generationWidth === 1 || generationWidth === 2);
  const parts = [bytes("%PDF-1.7\n%\x80\x81\x82\x83\n")];
  let length = parts[0].length;
  const offsets = new Map();
  const append = (part) => {
    const value = bytes(part);
    parts.push(value);
    length += value.length;
  };
  const catalog = "<< /Type /Catalog /Pages 3 0 R >>";
  const pages = "<< /Type /Pages /Count 1 /Kids [4 0 R] /MediaBox [0 0 200 100] >>";
  const page = "<< /Type /Page /Parent 3 0 R /Contents 5 0 R >>";
  const bodies = `${catalog} ${pages} ${page}`;
  const catalogOffset = 0;
  const pagesOffset = bytes(`${catalog} `).length;
  const pageOffset = bytes(`${catalog} ${pages} `).length;
  const header = `2 ${catalogOffset} 3 ${pagesOffset} 4 ${pageOffset} `;
  const objectStreamData = bytes(header + bodies);
  offsets.set(1, length);
  append(`1 0 obj\n<< /Type /ObjStm /N 3 /First ${bytes(header).length} /Length ${objectStreamData.length} >>\nstream\n`);
  append(objectStreamData);
  append("\nendstream\nendobj\n");
  const content = bytes("0 0 10 10 re f");
  offsets.set(5, length);
  append(`5 0 obj\n<< /Length ${content.length} >>\nstream\n`);
  append(content);
  append("\nendstream\nendobj\n");
  offsets.set(6, length);
  const entry = (type, field1, field2) => generationWidth === 1
    ? Uint8Array.of(
      type,
      (field1 >>> 24) & 255,
      (field1 >>> 16) & 255,
      (field1 >>> 8) & 255,
      field1 & 255,
      field2 & 255
    )
    : Uint8Array.of(
      type,
      (field1 >>> 24) & 255,
      (field1 >>> 16) & 255,
      (field1 >>> 8) & 255,
      field1 & 255,
      (field2 >>> 8) & 255,
      field2 & 255
    );
  const xrefData = join([
    entry(0, 0, objectZeroGeneration),
    entry(1, offsets.get(1), 0),
    entry(2, 1, 0),
    entry(2, 1, 1),
    entry(2, 1, 2),
    entry(1, offsets.get(5), 0),
    entry(1, offsets.get(6), 0)
  ]);
  append(`6 0 obj\n<< /Type /XRef /Size 7 /Root 2 0 R /W [1 4 ${generationWidth}] /Length ${xrefData.length} >>\nstream\n`);
  append(xrefData);
  append("\nendstream\nendobj\n");
  append(`startxref\n${offsets.get(6)}\n%%EOF\n`);
  return join(parts);
}

function hybridXrefFixture() {
  const parts = [bytes("%PDF-1.7\n%\x80\x81\x82\x83\n")];
  let length = parts[0].length;
  const offsets = new Map();
  const append = (part) => {
    const value = bytes(part);
    parts.push(value);
    length += value.length;
  };
  const addObject = (number, body) => {
    offsets.set(number, length);
    append(`${number} 0 obj\n${body}\nendobj\n`);
  };
  addObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  addObject(2, "<< /Type /Pages /Count 1 /Kids [3 0 R] >>");
  addObject(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>");
  addObject(4, "<< /Marker /Classic >>");
  addObject(5, "<< /Hybrid true >>");
  offsets.set(6, length);
  const hybridEntry = Uint8Array.of(
    1,
    (offsets.get(5) >>> 24) & 255,
    (offsets.get(5) >>> 16) & 255,
    (offsets.get(5) >>> 8) & 255,
    offsets.get(5) & 255,
    0,
    0
  );
  append(`6 0 obj\n<< /Type /XRef /Size 7 /Index [5 1] /W [1 4 2] /Length 7 >>\nstream\n`);
  append(hybridEntry);
  append("\nendstream\nendobj\n");
  const classicOffset = length;
  append("xref\n0 5\n0000000000 65535 f \n");
  for (let number = 1; number <= 4; number += 1) {
    append(`${String(offsets.get(number)).padStart(10, "0")} 00000 n \n`);
  }
  append("6 1\n");
  append(`${String(offsets.get(6)).padStart(10, "0")} 00000 n \n`);
  append(`trailer\n<< /Size 7 /Root 1 0 R /XRefStm ${offsets.get(6)} >>\n`);
  append(`startxref\n${classicOffset}\n%%EOF\n`);
  return join(parts);
}

async function testClassicAndRangeCaching() {
  const fixture = classicFixture();
  let reads = 0;
  const source = {
    kind: "range",
    byteLength: fixture.length,
    async read(offset, length, signal) {
      assert.equal(signal.aborted, false);
      reads += 1;
      return fixture.slice(offset, offset + length);
    }
  };
  const document = await openNativePdfDocument(source);
  assert.equal(document.info.version, "1.7");
  assert.equal(document.info.pageCount, 1);
  assert.equal(document.info.language, "hu-HU");
  assert.deepEqual(document.pages[0].mediaBox, [-10, -20, 310, 220]);
  assert.deepEqual(document.pages[0].cropBox, [0, 0, 300, 200]);
  assert.equal(document.pages[0].rotation, 90);
  assert.equal(document.pages[0].userUnit, 2);
  assert.deepEqual([...await document.getDecodedPageContents(0)], [bytes("0 0 m 10 10 l S")]);
  assert.equal(reads, 1, "a tiny source should share one coalesced 64 KiB read");
  await document.close();
  await document.close();
}

async function testIncrementalAndRepair() {
  const incremental = await openNativePdfDocument({ kind: "bytes", bytes: classicFixture({ incremental: true }) });
  assert.equal(incremental.info.pageCount, 2);
  assert.deepEqual(incremental.pages[1].cropBox, [-10, -20, 310, 220]);
  await incremental.close();

  const repaired = await openNativePdfDocument({ kind: "bytes", bytes: classicFixture({ brokenStartXref: true }) });
  assert.equal(repaired.info.repaired, true);
  assert.equal(repaired.info.pageCount, 1);
  assert(repaired.getDiagnostics().some((item) => item.code === "xref.repaired"));
  await repaired.close();
}

async function testXrefAndObjectStreams() {
  const document = await openNativePdfDocument({ kind: "bytes", bytes: xrefAndObjectStreamFixture() });
  assert.equal(document.info.pageCount, 1);
  assert.deepEqual(document.pages[0].mediaBox, [0, 0, 200, 100]);
  assert.deepEqual([...await document.getDecodedPageContents(0)], [bytes("0 0 10 10 re f")]);
  await document.close();

  const narrowGeneration = xrefAndObjectStreamFixture({
    objectZeroGeneration: 255,
    generationWidth: 1
  });
  await assert.rejects(
    openNativePdfDocument(
      { kind: "bytes", bytes: narrowGeneration },
      { repair: "off" }
    ),
    (error) => {
      assert.equal(error.code, "invalid-xref");
      assert.equal(error.details?.reason, "object-zero-generation");
      assert.equal(error.details?.actualGeneration, 255);
      return true;
    }
  );
  const targetedRepair = await openNativePdfDocument({
    kind: "bytes",
    bytes: narrowGeneration
  });
  assert.equal(targetedRepair.info.repaired, true);
  assert.equal(targetedRepair.info.pageCount, 1);
  assert.deepEqual(
    targetedRepair.getDiagnostics().map(({ code }) => code),
    ["xref.repaired", "xref.repair-complete"]
  );
  assert.equal(
    targetedRepair.getDiagnostics()[0].details?.repairKind,
    "object-zero-generation"
  );
  assert.deepEqual(
    [...await targetedRepair.getDecodedPageContents(0)],
    [bytes("0 0 10 10 re f")]
  );
  await targetedRepair.close();
}

async function testHybridXrefAndLinearizationMetadata() {
  const hybrid = await openNativePdfDocument({ kind: "bytes", bytes: hybridXrefFixture() });
  const hybridObject = await hybrid.resolveObject({ kind: "ref", objectNumber: 5, generation: 0 });
  assert.equal(isPdfDictionary(hybridObject), true);
  assert.equal(hybridObject.get("Hybrid"), true);
  await hybrid.close();

  const linearizedFixture = writeTinyPdf({
    rootObject: 2,
    objects: [
      { number: 1, body: "<< /Linearized 1 /L 0000000000 /H [0 0] /O 4 /E 0000000000 /N 1 /T 1 >>" },
      { number: 2, body: "<< /Type /Catalog /Pages 3 0 R >>" },
      { number: 3, body: "<< /Type /Pages /Count 1 /Kids [4 0 R] >>" },
      { number: 4, body: "<< /Type /Page /Parent 3 0 R /MediaBox [0 0 10 10] >>" }
    ]
  });
  patchFixedWidthDecimal(linearizedFixture, "/L ", linearizedFixture.length);
  patchFixedWidthDecimal(linearizedFixture, "/E ", linearizedFixture.length);
  const linearized = await openNativePdfDocument({ kind: "bytes", bytes: linearizedFixture });
  assert.equal(linearized.info.linearized, true);
  await linearized.close();
}

async function testIndirectStreamLength() {
  const document = await openNativePdfDocument({
    kind: "bytes",
    bytes: classicFixture({ indirectLength: true })
  });
  assert.deepEqual(
    [...await document.getDecodedPageContents(0)],
    [bytes("prefix\nendstream\nsuffix")],
    "an endstream-looking payload must not truncate a stream with indirect /Length"
  );
  await document.close();
}

async function testDocumentMetadataAndFingerprint() {
  const fixture = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>" },
      {
        number: 4,
        body: "<< /Title <FEFF0048004500500052> /Author (HEPR) /Subject <EFBBBFC3A17276C3AD7A> /CreationDate (D:20260826120000+02'00') >>"
      }
    ],
    trailerEntries: "/Info 4 0 R /ID [<001122AABB> <FFEEDDCC>]"
  });
  const document = await openNativePdfDocument({ kind: "bytes", bytes: fixture });
  assert.equal(document.info.fingerprint, "001122aabb");
  assert.deepEqual(document.info.metadata, {
    title: "HEPR",
    author: "HEPR",
    subject: "árvíz",
    creationDate: "D:20260826120000+02'00'"
  });
  await document.close();
}

async function testPageBoxDiagnostics() {
  const outsideFixture = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /CropBox [-10 5 90 120] >>"
      }
    ]
  });
  const outside = await openNativePdfDocument({ kind: "bytes", bytes: outsideFixture });
  assert.deepEqual(outside.pages[0].cropBox, [-10, 5, 90, 120]);
  assert.deepEqual(
    outside.getDiagnostics().find((diagnostic) => diagnostic.code === "page.box-clamped"),
    {
      code: "page.box-clamped",
      severity: "warning",
      message: "The page /CropBox extends outside /MediaBox; the effective view is their intersection.",
      pageIndex: 0,
      details: { noIntersection: false }
    }
  );
  await outside.close();

  const disjointFixture = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /CropBox [200 200 300 300] >>"
      }
    ]
  });
  const disjoint = await openNativePdfDocument({ kind: "bytes", bytes: disjointFixture });
  assert.equal(
    disjoint.getDiagnostics().find((diagnostic) => diagnostic.code === "page.box-clamped")?.details?.noIntersection,
    true
  );
  await disjoint.close();
}

async function testEncryptionAndFilters() {
  await assert.rejects(
    openNativePdfDocument({ kind: "bytes", bytes: classicFixture({ encrypted: true }) }),
    (error) => error instanceof PdfError && error.code === "encrypted"
  );
  await assert.rejects(
    openNativePdfDocument({
      kind: "bytes",
      bytes: classicFixture({ encrypted: true, brokenStartXref: true })
    }, { repair: "safe" }),
    (error) => error instanceof PdfError && error.code === "encrypted",
    "bounded structural repair must never bypass encryption rejection"
  );
  assert.deepEqual(
    await decodePdfFilterChain(bytes("61 62 6>"), ["ASCIIHexDecode"], [null]),
    bytes("ab`")
  );
  assert.deepEqual(
    await decodePdfFilterChain(bytes("z~>"), ["ASCII85Decode"], [null]),
    Uint8Array.of(0, 0, 0, 0)
  );
  assert.deepEqual(
    await decodePdfFilterChain(Uint8Array.of(2, 65, 66, 67, 254, 90, 128), ["RunLengthDecode"], [null]),
    bytes("ABCZZZ")
  );
  assert.deepEqual(
    await decodePdfFilterChain(packNineBitCodes([256, 65, 66, 67, 257]), ["LZWDecode"], [null]),
    bytes("ABC")
  );
  assert.deepEqual(
    await decodePdfFilterChain(bytes("01 01 01>"), ["ASCIIHexDecode"], [new Map([
      ["Predictor", 2], ["Colors", 1], ["BitsPerComponent", 8], ["Columns", 3]
    ])]),
    Uint8Array.of(1, 2, 3)
  );
  assert.deepEqual(
    await decodePdfFilterChain(bytes("01 0A 0A 0A>"), ["ASCIIHexDecode"], [new Map([
      ["Predictor", 12], ["Colors", 1], ["BitsPerComponent", 8], ["Columns", 3]
    ])]),
    Uint8Array.of(10, 20, 30)
  );
  const compressed = await new Response(
    new Blob([bytes("flate works")]).stream().pipeThrough(new CompressionStream("deflate"))
  ).arrayBuffer();
  assert.deepEqual(
    await decodePdfFilterChain(new Uint8Array(compressed), ["FlateDecode"], [null]),
    bytes("flate works")
  );
  await assert.rejects(
    decodePdfFilterChain(new Uint8Array(compressed), ["FlateDecode"], [null], {
      limits: { maxDecodedStreamBytes: 5 }
    }),
    (error) => error instanceof PdfError && error.code === "resource-limit"
  );
}

async function testDocumentStreamingDecode() {
  const decoded = new Uint8Array(384 * 1024 + 19);
  for (let index = 0; index < decoded.length; index += 1) {
    decoded[index] = (index * 17 + (index >>> 5)) & 0xff;
  }
  const compressed = new Uint8Array(deflateSync(decoded));
  const fixture = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      {
        number: 2,
        body: "<< /Type /Pages /Count 1 /Kids [3 0 R] /MediaBox [0 0 100 100] >>"
      },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>" },
      {
        number: 4,
        body: tinyPdfStream("/Filter /FlateDecode /DecodeParms 5 0 R", compressed)
      },
      { number: 5, body: "<< /Predictor 1 >>" }
    ]
  });
  const document = await openNativePdfDocument({ kind: "bytes", bytes: fixture });
  try {
    const [stream] = await document.getPageContentStreams(0);
    const chunks = [];
    let byteLength = 0;
    for await (const chunk of document.decodeStreamChunks(stream, { chunkSize: 2053 })) {
      chunks.push(chunk);
      byteLength += chunk.length;
    }
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 2053));
    const streamed = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      streamed.set(chunk, offset);
      offset += chunk.length;
    }
    assert.deepEqual(streamed, decoded);
    assert.deepEqual(streamed, await document.decodeStream(stream));

    const controller = new AbortController();
    const iterator = document.decodeStreamChunks(stream, {
      chunkSize: 512,
      signal: controller.signal
    })[Symbol.asyncIterator]();
    assert.equal((await iterator.next()).done, false);
    controller.abort(new Error("document streaming fixture abort"));
    await assert.rejects(
      iterator.next(),
      (error) => error instanceof PdfError && error.code === "aborted"
    );
    await iterator.return?.();
  } finally {
    await document.close();
  }
}

function packNineBitCodes(codes) {
  const output = new Uint8Array(Math.ceil(codes.length * 9 / 8));
  let bitOffset = 0;
  for (const code of codes) {
    for (let bit = 8; bit >= 0; bit -= 1) {
      if (code & (1 << bit)) output[bitOffset >>> 3] |= 1 << (7 - (bitOffset & 7));
      bitOffset += 1;
    }
  }
  return output;
}

async function testByteOwnershipAndCancellation() {
  const original = classicFixture();
  const reader = await createPdfRandomAccessReader({ kind: "bytes", bytes: original });
  original.fill(0);
  assert.equal(new TextDecoder().decode(await reader.read(0, 5)), "%PDF-");
  await reader.close();

  const large = Uint8Array.from({ length: 200_000 }, (_, index) => index & 255);
  let rangeReads = 0;
  const coalesced = await createPdfRandomAccessReader({
    kind: "range",
    byteLength: large.length,
    async read(offset, length) {
      rangeReads += 1;
      return large.slice(offset, offset + length);
    }
  });
  assert.deepEqual(await coalesced.read(17, 180_000), large.slice(17, 180_017));
  assert.equal(rangeReads, 1, "adjacent cache blocks should use one coalesced source read");
  await coalesced.close();

  const controller = new AbortController();
  controller.abort("test");
  await assert.rejects(
    createPdfRandomAccessReader({ kind: "bytes", bytes: Uint8Array.of(1) }, { signal: controller.signal }),
    (error) => error instanceof PdfError && error.code === "aborted"
  );
}

async function testHttpSourceDiagnostics() {
  const originalFetch = globalThis.fetch;
  const pdf = classicFixture();
  try {
    const fullDiagnostics = [];
    globalThis.fetch = async () => new Response(pdf.slice(), {
      status: 200,
      headers: { "content-length": String(pdf.length) }
    });
    const full = await createPdfRandomAccessReader(
      { kind: "url", url: "https://fixture.invalid/full.pdf" },
      { onDiagnostic: (diagnostic) => fullDiagnostics.push(diagnostic) }
    );
    assert.equal(fullDiagnostics[0]?.code, "source.range-full-download");
    await full.close();

    const rangeDiagnostics = [];
    globalThis.fetch = async () => new Response(pdf.slice(0, 1), {
      status: 206,
      headers: { "content-range": `bytes 0-0/${pdf.length}` }
    });
    const ranged = await createPdfRandomAccessReader(
      { kind: "url", url: "https://fixture.invalid/range.pdf" },
      { onDiagnostic: (diagnostic) => rangeDiagnostics.push(diagnostic) }
    );
    assert.equal(rangeDiagnostics[0]?.code, "source.validator-unavailable");
    await ranged.close();

    let validatorRequest = 0;
    globalThis.fetch = async () => {
      validatorRequest += 1;
      if (validatorRequest === 1) {
        return new Response(pdf.slice(0, 1), {
          status: 206,
          headers: {
            "content-range": `bytes 0-0/${pdf.length}`,
            etag: '"fixture-v1"'
          }
        });
      }
      return new Response(pdf.slice(), {
        status: 206,
        headers: {
          "content-range": `bytes 0-${pdf.length - 1}/${pdf.length}`,
          etag: '"fixture-v2"'
        }
      });
    };
    const changed = await createPdfRandomAccessReader({
      kind: "url",
      url: "https://fixture.invalid/changed.pdf"
    });
    await assert.rejects(
      changed.read(0, pdf.length),
      (error) => error instanceof PdfError && error.code === "source-changed"
    );
    await changed.close();

    let missingValidatorRequest = 0;
    globalThis.fetch = async () => {
      missingValidatorRequest += 1;
      return missingValidatorRequest === 1
        ? new Response(pdf.slice(0, 1), {
            status: 206,
            headers: {
              "content-range": `bytes 0-0/${pdf.length}`,
              etag: '"fixture-v1"'
            }
          })
        : new Response(pdf.slice(), {
            status: 206,
            headers: {
              "content-range": `bytes 0-${pdf.length - 1}/${pdf.length}`
            }
          });
    };
    const unvalidated = await createPdfRandomAccessReader({
      kind: "url",
      url: "https://fixture.invalid/missing-validator.pdf"
    });
    await assert.rejects(
      unvalidated.read(0, pdf.length),
      (error) => error instanceof PdfError && error.code === "source-changed",
      "a validator must not silently disappear between range responses"
    );
    await unvalidated.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

await testClassicAndRangeCaching();
await testIncrementalAndRepair();
await testXrefAndObjectStreams();
await testHybridXrefAndLinearizationMetadata();
await testIndirectStreamLength();
await testDocumentMetadataAndFingerprint();
await testPageBoxDiagnostics();
await testEncryptionAndFilters();
await testDocumentStreamingDecode();
await testByteOwnershipAndCancellation();
await testHttpSourceDiagnostics();
console.log("native PDF core tests passed");
hooks.deregister();
