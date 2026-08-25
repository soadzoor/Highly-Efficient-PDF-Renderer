import assert from "node:assert/strict";

import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  StandardFonts
} from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import {
  DensePdfBuildError,
  buildDenseTextMiniPdf,
  preflightDensePdfDocument
} from "../src/densePdfDocument.ts";

const encoder = new TextEncoder();

Promise.try ??= (callback, ...args) => Promise.resolve().then(() => callback(...args));
Uint8Array.prototype.toHex ??= function toHex() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("hex");
};
Uint8Array.prototype.toBase64 ??= function toBase64() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("base64");
};
Uint8Array.fromHex ??= (value) => new Uint8Array(Buffer.from(value, "hex"));
Uint8Array.fromBase64 ??= (value) => new Uint8Array(Buffer.from(value, "base64"));

async function makeEligibleFixture() {
  const document = await PDFDocument.create({ updateMetadata: false });
  document.catalog.set(PDFName.of("Lang"), PDFHexString.fromText("hu-HU"));
  const page = document.addPage([320, 240]);
  page.setMediaBox(-10, -20, 330, 260);
  page.setCropBox(5, 10, 300, 210);
  page.setRotation({ type: "degrees", angle: 90 });
  page.node.set(PDFName.of("UserUnit"), document.context.obj(2));

  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Dense hello", { font, x: 20, y: 40, size: 16 });

  const property = document.context.obj({ MCID: 7, ActualText: "Dense hello" });
  const propertyRef = document.context.register(property);
  const properties = document.context.obj({});
  properties.set(PDFName.of("MC0"), propertyRef);
  page.node.Resources().set(PDFName.of("Properties"), properties);

  const extGStates = document.context.obj({});
  extGStates.set(
    PDFName.of("R10"),
    document.context.register(document.context.obj({
      Type: "ExtGState",
      OPM: 1
    }))
  );
  extGStates.set(
    PDFName.of("GSFalse"),
    document.context.register(document.context.obj({
      Type: "ExtGState",
      OPM: 0,
      OP: false,
      op: false
    }))
  );
  page.node.Resources().set(PDFName.ExtGState, extGStates);

  return document.save({ useObjectStreams: false });
}

async function collectChunks(chunks) {
  const parts = [];
  let length = 0;
  for await (const chunk of chunks) {
    parts.push(chunk);
    length += chunk.length;
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function expectFallback(bytes, reason) {
  const result = await preflightDensePdfDocument(bytes);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, reason);
  return result;
}

async function makeExtGStateFixture(entries, resourceName = "GS0") {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage();
  const states = document.context.obj({});
  states.set(
    PDFName.of(resourceName),
    document.context.register(document.context.obj(entries))
  );
  page.node.Resources().set(PDFName.ExtGState, states);
  return document.save({ useObjectStreams: false });
}

async function readTextLanguage(bytes) {
  const loadingTask = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const pdf = await loadingTask.promise;
  try {
    const page = await pdf.getPage(1);
    return (await page.getTextContent()).lang;
  } finally {
    await loadingTask.destroy();
  }
}

async function run() {
  const sourceBytes = await makeEligibleFixture();
  const result = await preflightDensePdfDocument(sourceBytes, {
    pages: "1",
    decodedChunkSize: 4096
  });
  assert.equal(result.eligible, true);
  const source = result.document;
  assert.equal(source.sourcePageCount, 1);
  assert.equal(source.pages.length, 1);

  const page = source.pages[0];
  assert.deepEqual(page.mediaBox, { left: -10, bottom: -20, right: 320, top: 240 });
  assert.deepEqual(page.cropBox, { left: 5, bottom: 10, right: 305, top: 220 });
  assert.equal(page.rotation, 90);
  assert.equal(page.userUnit, 2);
  assert.equal(page.availableFonts.length, 1);
  assert.deepEqual(page.availableProperties, ["MC0"]);
  assert.deepEqual(page.availableExtGStates, ["GSFalse", "R10"]);

  const decodedContent = await collectChunks(page.decodedContentChunks());
  assert.ok(decodedContent.length > 0);
  assert.equal(page.decodeTiming.completed, true);
  assert.equal(page.decodeTiming.decodedBytes, decodedContent.length);

  const mini = await buildDenseTextMiniPdf(source, [{
    sourcePageIndex: 0,
    retainedTextContent: decodedContent,
    referencedFonts: new Set(page.availableFonts),
    referencedProperties: new Set(page.availableProperties)
  }]);
  assert.ok(mini.bytes.length > 0);
  assert.ok(mini.releasedSourceContentObjects >= 1);
  const sourceLanguage = await readTextLanguage(sourceBytes);
  assert.equal(sourceLanguage, "hu-HU");
  assert.equal(await readTextLanguage(mini.bytes), sourceLanguage);

  const miniDocument = await PDFDocument.load(mini.bytes, { updateMetadata: false });
  assert.equal(miniDocument.getPageCount(), 1);
  const miniPage = miniDocument.getPage(0);
  assert.deepEqual(miniPage.getMediaBox(), { x: -10, y: -20, width: 330, height: 260 });
  assert.deepEqual(miniPage.getCropBox(), { x: 5, y: 10, width: 300, height: 210 });
  assert.equal(miniPage.getRotation().angle, 90);
  const miniResources = miniPage.node.Resources();
  const miniFonts = miniResources.lookup(PDFName.Font, PDFDict);
  const miniProperties = miniResources.lookup(PDFName.of("Properties"), PDFDict);
  assert.equal(miniFonts.keys().length, 1);
  assert.deepEqual(miniProperties.keys().map((name) => name.decodeText()), ["MC0"]);

  await assert.rejects(
    async () => collectChunks(page.decodedContentChunks()),
    (error) => error instanceof DensePdfBuildError && error.code === "source-released"
  );
  await assert.rejects(
    buildDenseTextMiniPdf(source, [{
      sourcePageIndex: 0,
      retainedTextContent: encoder.encode("q Q\n"),
      referencedFonts: new Set(),
      referencedProperties: new Set()
    }]),
    (error) => error instanceof DensePdfBuildError && error.code === "source-released"
  );

  await assert.rejects(
    preflightDensePdfDocument(sourceBytes, { pages: "2" }),
    RangeError
  );

  const invalidLanguage = await PDFDocument.create({ updateMetadata: false });
  invalidLanguage.addPage();
  invalidLanguage.catalog.set(
    PDFName.of("Lang"),
    invalidLanguage.context.obj({ Value: "hu-HU" })
  );
  await expectFallback(
    await invalidLanguage.save({ useObjectStreams: false }),
    "invalid-structure"
  );

  const multipleStreams = await PDFDocument.create({ updateMetadata: false });
  const multipleStreamsPage = multipleStreams.addPage();
  const firstStream = multipleStreams.context.register(
    multipleStreams.context.stream(encoder.encode("q"))
  );
  const secondStream = multipleStreams.context.register(
    multipleStreams.context.stream(encoder.encode("Q"))
  );
  multipleStreamsPage.node.set(
    PDFName.Contents,
    multipleStreams.context.obj([firstStream, secondStream])
  );
  const multipleStreamResult = await preflightDensePdfDocument(
    await multipleStreams.save({ useObjectStreams: false })
  );
  assert.equal(multipleStreamResult.eligible, true);
  assert.equal(multipleStreamResult.document.pages[0].contentStreamCount, 2);
  assert.equal(
    new TextDecoder().decode(
      await collectChunks(multipleStreamResult.document.pages[0].decodedContentChunks())
    ),
    "q\nQ"
  );
  await buildDenseTextMiniPdf(multipleStreamResult.document, [{
    sourcePageIndex: 0,
    retainedTextContent: encoder.encode("q Q\n"),
    referencedFonts: new Set(),
    referencedProperties: new Set()
  }]);

  const annotated = await PDFDocument.create({ updateMetadata: false });
  const annotatedPage = annotated.addPage();
  const annotation = annotated.context.register(annotated.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [0, 0, 10, 10]
  }));
  annotatedPage.node.set(PDFName.Annots, annotated.context.obj([annotation]));
  await expectFallback(
    await annotated.save({ useObjectStreams: false }),
    "annotations"
  );

  const optionalContent = await PDFDocument.create({ updateMetadata: false });
  optionalContent.addPage();
  optionalContent.catalog.set(
    PDFName.of("OCProperties"),
    optionalContent.context.obj({ OCGs: [] })
  );
  await expectFallback(
    await optionalContent.save({ useObjectStreams: false }),
    "optional-content"
  );

  const pageOptionalContent = await PDFDocument.create({ updateMetadata: false });
  const optionalPage = pageOptionalContent.addPage();
  optionalPage.node.set(PDFName.of("OC"), pageOptionalContent.context.obj({
    Type: "OCG",
    Name: "Optional page"
  }));
  await expectFallback(
    await pageOptionalContent.save({ useObjectStreams: false }),
    "optional-content"
  );

  const transparencyGroup = await PDFDocument.create({ updateMetadata: false });
  const groupedPage = transparencyGroup.addPage();
  groupedPage.node.set(PDFName.of("Group"), transparencyGroup.context.obj({
    Type: "Group",
    S: "Transparency",
    I: true
  }));
  await expectFallback(
    await transparencyGroup.save({ useObjectStreams: false }),
    "unsupported-resource"
  );

  const unsupportedResource = await PDFDocument.create({ updateMetadata: false });
  const resourcePage = unsupportedResource.addPage();
  const xObject = unsupportedResource.context.register(
    unsupportedResource.context.stream(encoder.encode("not-an-image"), {
      Type: "XObject",
      Subtype: "Image"
    })
  );
  const xObjects = unsupportedResource.context.obj({});
  xObjects.set(PDFName.of("X0"), xObject);
  resourcePage.node.Resources().set(PDFName.XObject, xObjects);
  await expectFallback(
    await unsupportedResource.save({ useObjectStreams: false }),
    "unsupported-resource"
  );

  // `/OPM` only selects the algorithm used if overprint is enabled. CAD PDFs
  // commonly emit it while leaving `/OP` and `/op` at their false defaults.
  const opmOnly = await preflightDensePdfDocument(
    await makeExtGStateFixture({ Type: "ExtGState", OPM: 1 }, "R10")
  );
  assert.equal(opmOnly.eligible, true);
  assert.deepEqual(opmOnly.document.pages[0].availableExtGStates, ["R10"]);

  const explicitOverprintOff = await preflightDensePdfDocument(
    await makeExtGStateFixture({ OPM: 0, OP: false, op: false }, "GSOff")
  );
  assert.equal(explicitOverprintOff.eligible, true);
  assert.deepEqual(
    explicitOverprintOff.document.pages[0].availableExtGStates,
    ["GSOff"]
  );

  for (const [entries, resourceName] of [
    [{ Type: "ExtGState", OP: true }, "StrokeOverprint"],
    [{ Type: "ExtGState", op: true }, "FillOverprint"],
    [{ Type: "ExtGState", OPM: -1 }, "BadModeRange"],
    [{ Type: "ExtGState", OPM: 0.5 }, "BadModeInteger"],
    [{ Type: "ExtGState", OPM: "invalid" }, "BadMode"],
    [{ Type: "NotExtGState", OPM: 1 }, "BadType"],
    [{ Type: "ExtGState", CA: 1 }, "StrokeOpacity"],
    [{ Type: "ExtGState", ca: 1 }, "FillOpacity"],
    [{ Type: "ExtGState", BM: "Normal" }, "BlendMode"],
    [{ Type: "ExtGState", SMask: "None" }, "SoftMask"]
  ]) {
    const fallback = await expectFallback(
      await makeExtGStateFixture(entries, resourceName),
      "unsupported-resource"
    );
    assert.equal(fallback.resourceName, resourceName);
  }

  const malformedExtGStateResources = await PDFDocument.create({
    updateMetadata: false
  });
  const malformedExtGStatePage = malformedExtGStateResources.addPage();
  malformedExtGStatePage.node.Resources().set(
    PDFName.ExtGState,
    malformedExtGStateResources.context.obj([])
  );
  await expectFallback(
    await malformedExtGStateResources.save({ useObjectStreams: false }),
    "invalid-structure"
  );

  const type3Font = await PDFDocument.create({ updateMetadata: false });
  const type3Page = type3Font.addPage();
  const type3FontDictionary = type3Font.context.register(type3Font.context.obj({
    Type: "Font",
    Subtype: "Type3",
    FontBBox: [0, 0, 1, 1],
    FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    CharProcs: {},
    Encoding: { Type: "Encoding", Differences: [] },
    FirstChar: 0,
    LastChar: 0,
    Widths: [0],
    Resources: {}
  }));
  const type3Fonts = type3Font.context.obj({});
  type3Fonts.set(PDFName.of("FType3"), type3FontDictionary);
  type3Page.node.Resources().set(PDFName.Font, type3Fonts);
  await expectFallback(
    await type3Font.save({ useObjectStreams: false }),
    "unsupported-resource"
  );

  const nativeFlate = await PDFDocument.create({ updateMetadata: false });
  const unfilteredPage = nativeFlate.addPage();
  const unfilteredContent = nativeFlate.context.register(
    nativeFlate.context.stream(encoder.encode("q Q\n"))
  );
  unfilteredPage.node.set(PDFName.Contents, unfilteredContent);
  const nativeFlatePage = nativeFlate.addPage();
  const nativeFlateContent = nativeFlate.context.register(
    nativeFlate.context.flateStream(encoder.encode("q Q\n"))
  );
  nativeFlatePage.node.set(PDFName.Contents, nativeFlateContent);
  const nativeFlateBytes = await nativeFlate.save({ useObjectStreams: false });
  const decompressionStreamDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "DecompressionStream"
  );
  try {
    Object.defineProperty(globalThis, "DecompressionStream", {
      configurable: true,
      writable: true,
      value: undefined
    });
    const nativeFlateFallback = await preflightDensePdfDocument(nativeFlateBytes);
    assert.equal(nativeFlateFallback.eligible, false);
    assert.equal(nativeFlateFallback.reason, "unsupported-filter");
    assert.equal(nativeFlateFallback.filterName, "FlateDecode");
    assert.equal("document" in nativeFlateFallback, false);
  } finally {
    if (decompressionStreamDescriptor) {
      Object.defineProperty(
        globalThis,
        "DecompressionStream",
        decompressionStreamDescriptor
      );
    } else {
      delete globalThis.DecompressionStream;
    }
  }

  const unsupportedFilter = await PDFDocument.create({ updateMetadata: false });
  const filterPage = unsupportedFilter.addPage();
  const invalidContent = unsupportedFilter.context.register(
    unsupportedFilter.context.stream(encoder.encode("BT ET\n"), {
      Filter: "DCTDecode"
    })
  );
  filterPage.node.set(PDFName.Contents, invalidContent);
  await expectFallback(
    await unsupportedFilter.save({ useObjectStreams: false }),
    "unsupported-filter"
  );

  console.log("Dense PDF document preflight and mini-PDF tests passed");
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
