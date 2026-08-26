import assert from "node:assert/strict";

import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
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
  extGStates.set(
    PDFName.of("Alpha"),
    document.context.register(document.context.obj({
      Type: "ExtGState",
      BM: "Normal",
      CA: 0.4,
      ca: 0.2
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

async function makeAnnotationFixture(subtype, entries = {}) {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([100, 80]);
  const { useBorderStyleOnly = false, ...annotationEntries } = entries;
  const annotation = document.context.register(document.context.obj({
    Type: "Annot",
    Subtype: subtype,
    Rect: [0, 0, 10, 10],
    ...(useBorderStyleOnly ? {} : { Border: [0, 0, 0] }),
    ...annotationEntries
  }));
  page.node.set(PDFName.Annots, document.context.obj([annotation]));
  return document.save({ useObjectStreams: false });
}

async function makeOptionalContentFixture({
  hidden = false,
  defaultConfigEntries = {},
  groupEntries = {},
  membership = false
} = {}) {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([100, 80]);
  const group = document.context.register(document.context.obj({
    Type: "OCG",
    Name: PDFHexString.fromText("Visible layer"),
    ...groupEntries
  }));
  document.catalog.set(PDFName.of("OCProperties"), document.context.obj({
    OCGs: [group],
    D: {
      Order: [group],
      OFF: hidden ? [group] : [],
      ...defaultConfigEntries
    }
  }));
  const properties = document.context.obj({});
  properties.set(
    PDFName.of("Layer"),
    membership
      ? document.context.register(document.context.obj({ Type: "OCMD", OCGs: [group] }))
      : group
  );
  page.node.Resources().set(PDFName.of("Properties"), properties);
  page.node.set(
    PDFName.Contents,
    document.context.register(
      document.context.stream(encoder.encode("/OC /Layer BDC 0 0 m 10 0 l S EMC\n"))
    )
  );
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
  assert.deepEqual(page.availableExtGStates, ["Alpha", "GSFalse", "R10"]);
  assert.deepEqual(page.extGStates, [
    {
      resourceName: "Alpha",
      strokeAlpha: 0.4,
      fillAlpha: 0.2,
      emitsPdfJsOperator: true
    },
    { resourceName: "GSFalse", emitsPdfJsOperator: false },
    { resourceName: "R10", emitsPdfJsOperator: false }
  ]);

  const decodedContent = await collectChunks(page.decodedContentChunks());
  assert.ok(decodedContent.length > 0);
  assert.equal(page.decodeTiming.completed, true);
  assert.equal(page.decodeTiming.decodedBytes, decodedContent.length);

  const mini = await buildDenseTextMiniPdf(source, [{
    sourcePageIndex: 0,
    retainedTextContent: decodedContent,
    referencedFonts: new Set(page.availableFonts),
    referencedProperties: new Set(page.availableProperties),
    referencedExtGStates: new Set(["Alpha"]),
    referencedXObjects: new Set()
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
  const miniExtGStates = miniResources.lookup(PDFName.ExtGState, PDFDict);
  assert.equal(miniFonts.keys().length, 1);
  assert.deepEqual(miniProperties.keys().map((name) => name.decodeText()), ["MC0"]);
  assert.deepEqual(miniExtGStates.keys().map((name) => name.decodeText()), ["Alpha"]);

  await assert.rejects(
    async () => collectChunks(page.decodedContentChunks()),
    (error) => error instanceof DensePdfBuildError && error.code === "source-released"
  );
  await assert.rejects(
    buildDenseTextMiniPdf(source, [{
      sourcePageIndex: 0,
      retainedTextContent: encoder.encode("q Q\n"),
      referencedFonts: new Set(),
      referencedProperties: new Set(),
      referencedXObjects: new Set()
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
    referencedProperties: new Set(),
    referencedXObjects: new Set()
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

  const nonVisualLink = await preflightDensePdfDocument(
    await makeAnnotationFixture("Link", { Dest: [null, "Fit"] })
  );
  assert.equal(nonVisualLink.eligible, true);
  const nonVisualSquare = await preflightDensePdfDocument(
    await makeAnnotationFixture("Square", {
      Contents: "Review note",
      F: 4,
      NM: "square-1",
      T: "Reviewer"
    })
  );
  assert.equal(nonVisualSquare.eligible, true);
  const nonVisualBorderStyleLink = await preflightDensePdfDocument(
    await makeAnnotationFixture("Link", {
      useBorderStyleOnly: true,
      BS: { W: 0 },
      A: { S: "URI", URI: "https://example.invalid/" },
      StructParent: 1,
      F: 4
    })
  );
  assert.equal(nonVisualBorderStyleLink.eligible, true);
  await expectFallback(
    await makeAnnotationFixture("Link", { Border: [0, 0, 1] }),
    "annotations"
  );
  await expectFallback(
    await makeAnnotationFixture("Link", { AP: {} }),
    "annotations"
  );
  await expectFallback(
    await makeAnnotationFixture("Link", {
      useBorderStyleOnly: true,
      BS: { W: 1 }
    }),
    "annotations"
  );
  await expectFallback(
    await makeAnnotationFixture("Square", { IC: [1, 0, 0] }),
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

  const allVisibleOptionalContent = await preflightDensePdfDocument(
    await makeOptionalContentFixture()
  );
  assert.equal(allVisibleOptionalContent.eligible, true);
  assert.deepEqual(
    allVisibleOptionalContent.document.pages[0].alwaysVisibleOptionalContentProperties,
    ["Layer"]
  );
  await expectFallback(
    await makeOptionalContentFixture({ hidden: true }),
    "optional-content"
  );
  await expectFallback(
    await makeOptionalContentFixture({ defaultConfigEntries: { AS: [] } }),
    "optional-content"
  );
  await expectFallback(
    await makeOptionalContentFixture({ groupEntries: { Usage: {} } }),
    "optional-content"
  );
  await expectFallback(
    await makeOptionalContentFixture({ membership: true }),
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

  const inertTransparencyGroup = await PDFDocument.create({ updateMetadata: false });
  const inertGroupedPage = inertTransparencyGroup.addPage();
  inertGroupedPage.node.set(
    PDFName.of("Group"),
    inertTransparencyGroup.context.obj({
      Type: "Group",
      S: "Transparency",
      CS: "DeviceRGB",
      I: false,
      K: false
    })
  );
  assert.equal(
    (await preflightDensePdfDocument(
      await inertTransparencyGroup.save({ useObjectStreams: false })
    )).eligible,
    true
  );

  for (const groupEntries of [
    { Type: "Group", S: "Transparency", CS: "DeviceRGB", K: true },
    { Type: "Group", S: "Transparency", CS: "DeviceCMYK" },
    { Type: "Group", S: "Transparency", CS: "DeviceRGB", Extra: 1 }
  ]) {
    const unsupportedGroupDocument = await PDFDocument.create({
      updateMetadata: false
    });
    unsupportedGroupDocument.addPage().node.set(
      PDFName.of("Group"),
      unsupportedGroupDocument.context.obj(groupEntries)
    );
    await expectFallback(
      await unsupportedGroupDocument.save({ useObjectStreams: false }),
      "unsupported-resource"
    );
  }

  const translucentPageGroup = await PDFDocument.create({ updateMetadata: false });
  const translucentGroupedPage = translucentPageGroup.addPage();
  translucentGroupedPage.node.set(
    PDFName.of("Group"),
    translucentPageGroup.context.obj({
      Type: "Group",
      S: "Transparency",
      CS: "DeviceRGB"
    })
  );
  translucentGroupedPage.node.Resources().set(
    PDFName.ExtGState,
    translucentPageGroup.context.obj({
      Alpha: translucentPageGroup.context.register(
        translucentPageGroup.context.obj({
          Type: "ExtGState",
          BM: "Normal",
          CA: 0.5,
          ca: 0.5
        })
      )
    })
  );
  await expectFallback(
    await translucentPageGroup.save({ useObjectStreams: false }),
    "unsupported-resource"
  );

  const formDocument = await PDFDocument.create({ updateMetadata: false });
  const formPage = formDocument.addPage([200, 100]);
  const formFont = await formDocument.embedFont(StandardFonts.HelveticaBold);
  const formFonts = formDocument.context.obj({});
  formFonts.set(PDFName.of("FLocal"), formFont.ref);
  const formResources = formDocument.context.obj({});
  formResources.set(PDFName.Font, formFonts);
  formResources.set(PDFName.ExtGState, formDocument.context.obj({
    Alpha: formDocument.context.register(formDocument.context.obj({
      Type: "ExtGState",
      BM: "Normal",
      CA: 0.5,
      ca: 0.5
    }))
  }));
  const formStream = formDocument.context.flateStream(
    encoder.encode("/Alpha gs BT /FLocal 12 Tf (Form text) Tj ET\n")
  );
  formStream.dict.set(PDFName.Type, PDFName.XObject);
  formStream.dict.set(PDFName.of("Subtype"), PDFName.of("Form"));
  formStream.dict.set(PDFName.of("FormType"), formDocument.context.obj(1));
  formStream.dict.set(PDFName.of("BBox"), formDocument.context.obj([0, 0, 80, 20]));
  formStream.dict.set(
    PDFName.of("Matrix"),
    formDocument.context.obj([1, 0, 0, 1, 10, 15])
  );
  formStream.dict.set(
    PDFName.Resources,
    formDocument.context.register(formResources)
  );
  const formRef = formDocument.context.register(formStream);
  const unusedFormStream = formDocument.context.stream(encoder.encode("q Q\n"), {
    Type: "XObject",
    Subtype: "Form",
    BBox: [0, 0, 1, 1],
    Resources: {}
  });
  const unusedFormRef = formDocument.context.register(unusedFormStream);
  const formResourcesByName = formDocument.context.obj({});
  formResourcesByName.set(PDFName.of("Fm0"), formRef);
  formResourcesByName.set(PDFName.of("FmAlias"), formRef);
  formResourcesByName.set(PDFName.of("FmUnused"), unusedFormRef);
  formPage.node.Resources().set(PDFName.XObject, formResourcesByName);
  const invokeForm = formDocument.context.register(
    formDocument.context.stream(encoder.encode("/Fm0 Do\n"))
  );
  formPage.node.set(PDFName.Contents, invokeForm);

  const formBytes = await formDocument.save({ useObjectStreams: false });
  const formResult = await preflightDensePdfDocument(formBytes);
  assert.equal(formResult.eligible, true);
  const selectedFormPage = formResult.document.pages[0];
  assert.equal(selectedFormPage.formXObjects.length, 3);
  const selectedForm = selectedFormPage.formXObjects.find(
    (form) => form.resourceName === "Fm0"
  );
  const selectedFormAlias = selectedFormPage.formXObjects.find(
    (form) => form.resourceName === "FmAlias"
  );
  assert.ok(selectedForm);
  assert.ok(selectedFormAlias);
  assert.equal(selectedForm.resourceName, "Fm0");
  assert.deepEqual(selectedForm.bbox, {
    left: 0,
    bottom: 0,
    right: 80,
    top: 20
  });
  assert.deepEqual(selectedForm.matrix, [1, 0, 0, 1, 10, 15]);
  assert.equal(selectedForm.encodedContentBytes, formStream.contents.byteLength);
  assert.deepEqual(selectedForm.availableExtGStates, ["Alpha"]);
  assert.deepEqual(selectedForm.extGStates, [{
    resourceName: "Alpha",
    strokeAlpha: 0.5,
    fillAlpha: 0.5,
    emitsPdfJsOperator: true
  }]);
  assert.equal(
    new TextDecoder().decode(await collectChunks(selectedForm.decodedContentChunks())),
    "/Alpha gs BT /FLocal 12 Tf (Form text) Tj ET\n"
  );

  const formMini = await buildDenseTextMiniPdf(formResult.document, [{
    sourcePageIndex: 0,
    retainedTextContent: encoder.encode("/Fm0 Do\n"),
    referencedFonts: new Set(),
    referencedProperties: new Set(),
    referencedXObjects: new Set(["Fm0"])
  }]);
  const formMiniDocument = await PDFDocument.load(formMini.bytes, {
    updateMetadata: false
  });
  const copiedXObjects = formMiniDocument
    .getPage(0)
    .node.Resources()
    .lookup(PDFName.XObject, PDFDict);
  assert.deepEqual(
    copiedXObjects.keys().map((name) => name.decodeText()),
    ["Fm0"]
  );
  const copiedForm = formMiniDocument.context.lookup(
    copiedXObjects.get(PDFName.of("Fm0"))
  );
  assert.ok(copiedForm instanceof PDFRawStream);
  const copiedFormResources = copiedForm.dict.lookup(PDFName.Resources, PDFDict);
  assert.equal(copiedFormResources.lookup(PDFName.Font, PDFDict).keys().length, 1);
  assert.equal(copiedFormResources.lookup(PDFName.ExtGState, PDFDict).keys().length, 1);
  await assert.rejects(
    async () => collectChunks(selectedForm.decodedContentChunks()),
    (error) => error instanceof DensePdfBuildError && error.code === "source-released"
  );
  await assert.rejects(
    async () => collectChunks(selectedFormAlias.decodedContentChunks()),
    (error) => error instanceof DensePdfBuildError && error.code === "source-released"
  );

  const optionalFormDocument = await PDFDocument.create({ updateMetadata: false });
  const optionalFormPage = optionalFormDocument.addPage();
  const optionalForm = optionalFormDocument.context.stream(encoder.encode("q Q\n"), {
    Type: "XObject",
    Subtype: "Form",
    BBox: [0, 0, 10, 10],
    Resources: {},
    OC: { Type: "OCG", Name: PDFHexString.fromText("Optional form") }
  });
  optionalFormPage.node.Resources().set(
    PDFName.XObject,
    optionalFormDocument.context.obj({
      FmOptional: optionalFormDocument.context.register(optionalForm)
    })
  );
  await expectFallback(
    await optionalFormDocument.save({ useObjectStreams: false }),
    "optional-content"
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
  const unusedImageResult = await preflightDensePdfDocument(
    await unsupportedResource.save({ useObjectStreams: false })
  );
  assert.equal(unusedImageResult.eligible, true);
  assert.deepEqual(unusedImageResult.document.pages[0].formXObjects, []);

  const nestedXObjectDocument = await PDFDocument.create({ updateMetadata: false });
  const nestedXObjectPage = nestedXObjectDocument.addPage();
  const nestedImage = nestedXObjectDocument.context.register(
    nestedXObjectDocument.context.stream(new Uint8Array([0]), {
      Type: "XObject",
      Subtype: "Image"
    })
  );
  const nestedObjects = nestedXObjectDocument.context.obj({});
  nestedObjects.set(PDFName.of("Im0"), nestedImage);
  const nestedFormResources = nestedXObjectDocument.context.obj({});
  nestedFormResources.set(PDFName.XObject, nestedObjects);
  const nestedForm = nestedXObjectDocument.context.stream(encoder.encode("/Im0 Do\n"), {
    Type: "XObject",
    Subtype: "Form",
    BBox: [0, 0, 10, 10]
  });
  nestedForm.dict.set(PDFName.Resources, nestedFormResources);
  const nestedFormRef = nestedXObjectDocument.context.register(nestedForm);
  const outerObjects = nestedXObjectDocument.context.obj({});
  outerObjects.set(PDFName.of("Fm0"), nestedFormRef);
  nestedXObjectPage.node.Resources().set(PDFName.XObject, outerObjects);
  const nestedImageResult = await preflightDensePdfDocument(
    await nestedXObjectDocument.save({ useObjectStreams: false })
  );
  assert.equal(nestedImageResult.eligible, true);
  const nestedImageForm = nestedImageResult.document.pages[0].formXObjects[0];
  assert.equal(nestedImageForm.resourceName, "Fm0");
  assert.equal(nestedImageForm.resolveFormXObject("Im0"), null);

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

  const inertStrokeSettings = await preflightDensePdfDocument(
    await makeExtGStateFixture({ SA: false, SM: 0.5 }, "GSStrokeDefaults")
  );
  assert.equal(inertStrokeSettings.eligible, true);
  assert.deepEqual(
    inertStrokeSettings.document.pages[0].availableExtGStates,
    ["GSStrokeDefaults"]
  );

  const normalAlpha = await preflightDensePdfDocument(
    await makeExtGStateFixture(
      { Type: "ExtGState", BM: "Normal", CA: 0.4, ca: 0.2 },
      "Alpha"
    )
  );
  assert.equal(normalAlpha.eligible, true);
  assert.deepEqual(normalAlpha.document.pages[0].extGStates, [{
    resourceName: "Alpha",
    strokeAlpha: 0.4,
    fillAlpha: 0.2,
    emitsPdfJsOperator: true
  }]);

  for (const [entries, resourceName] of [
    [{ Type: "ExtGState", OP: true }, "StrokeOverprint"],
    [{ Type: "ExtGState", op: true }, "FillOverprint"],
    [{ Type: "ExtGState", OPM: -1 }, "BadModeRange"],
    [{ Type: "ExtGState", OPM: 0.5 }, "BadModeInteger"],
    [{ Type: "ExtGState", OPM: "invalid" }, "BadMode"],
    [{ Type: "NotExtGState", OPM: 1 }, "BadType"],
    [{ Type: "ExtGState", CA: -0.1 }, "BadStrokeOpacityLow"],
    [{ Type: "ExtGState", CA: 1.1 }, "BadStrokeOpacityHigh"],
    [{ Type: "ExtGState", ca: "invalid" }, "BadFillOpacity"],
    [{ Type: "ExtGState", BM: "Multiply" }, "BlendMode"],
    [{ Type: "ExtGState", SMask: "None" }, "SoftMask"],
    [{ Type: "ExtGState", SA: true }, "StrokeAdjustment"],
    [{ Type: "ExtGState", SA: 0 }, "BadStrokeAdjustment"],
    [{ Type: "ExtGState", SM: -0.1 }, "BadSmoothnessLow"],
    [{ Type: "ExtGState", SM: 1.1 }, "BadSmoothnessHigh"],
    [{ Type: "ExtGState", SM: "invalid" }, "BadSmoothnessType"]
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
