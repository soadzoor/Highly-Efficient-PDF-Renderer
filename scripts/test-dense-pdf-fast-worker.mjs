import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

import {
  PDFDocument,
  PDFHexString,
  PDFName,
  degrees
} from "pdf-lib";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

Promise.try ??= (callback, ...args) => Promise.resolve().then(() => callback(...args));
Uint8Array.prototype.toHex ??= function toHex() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("hex");
};
Uint8Array.prototype.toBase64 ??= function toBase64() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("base64");
};
Uint8Array.fromHex ??= (value) => new Uint8Array(Buffer.from(value, "hex"));
Uint8Array.fromBase64 ??= (value) => new Uint8Array(Buffer.from(value, "base64"));

const IMAGE_PAINT_OPS = new Set([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintInlineImageXObjectGroup,
  OPS.paintImageXObjectRepeat,
  OPS.paintImageMaskXObject,
  OPS.paintImageMaskXObjectGroup,
  OPS.paintImageMaskXObjectRepeat
]);

const originalSelfDescriptor = Object.getOwnPropertyDescriptor(globalThis, "self");
const originalWorkerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "./densePdfContentCompiler" ||
      specifier === "./densePdfDocument"
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const geometryWorker = await loadWorkerEntry("geometry");
  await testGeometryParity(geometryWorker.module.computeDensePdfPageGeometry);
  console.log("  geometry parity passed");

  const fallbackWorker = await loadWorkerEntry("fallback");
  await testWorkerFallback(fallbackWorker);
  console.log("  fallback protocol passed");

  const mixedFallbackWorker = await loadWorkerEntry("mixed-fallback");
  await testMixedPageAtomicFallback(mixedFallbackWorker);
  console.log("  mixed-page atomic fallback passed");

  const missingResourceWorker = await loadWorkerEntry("missing-resource");
  await testTextMiniResourceFallback(missingResourceWorker);
  console.log("  text-mini resource fallback passed");

  const successWorker = await loadWorkerEntry("success");
  await testWorkerSuccessAndProgress(successWorker);
  console.log("  success/progress protocol passed");

  const textFormWorker = await loadWorkerEntry("text-form");
  await testLkOfficeTextForm(textFormWorker);
  console.log("  text Form XObject/LK Office regression passed");

  const recursiveFormWorker = await loadWorkerEntry("recursive-form");
  await testRecursiveFormWithUnusedImage(recursiveFormWorker);
  console.log("  recursive Form/unused image regression passed");

  const invokedImageWorker = await loadWorkerEntry("invoked-form-image");
  await testInvokedNestedImageFallback(invokedImageWorker);
  console.log("  invoked nested image fallback passed");

  const cyclicFormWorker = await loadWorkerEntry("cyclic-form");
  await testCyclicFormFallback(cyclicFormWorker);
  console.log("  cyclic Form fallback passed");

  const deepFormWorker = await loadWorkerEntry("deep-form");
  await testFormDepthBudgetFallback(deepFormWorker);
  console.log("  Form recursion-depth budget passed");

  const optionalContentFormWorker = await loadWorkerEntry("oc-form");
  await testOptionalContentFormFallback(optionalContentFormWorker);
  console.log("  optional-content Form fallback passed");

  const baldwinWorker = await loadWorkerEntry("baldwin", 15_000);
  await testBaldwinRecursiveForms(baldwinWorker);
  console.log("  recursive/off-page Form Baldwin regression passed");

  const chinoWorker = await loadWorkerEntry("chino", 15_000);
  await testRealDenseFile(chinoWorker, {
    url: "../public/examples/pdfs/Chino%20MOB_FLOOR%201.pdf",
    expectedAlpha: 1,
    expectedGStateCount: 0
  });
  console.log("  nonvisual Link/Chino regression passed");

  const dublinWorker = await loadWorkerEntry("dublin", 15_000);
  await testRealDenseFile(dublinWorker, {
    url: "../public/examples/pdfs/Dublin%201st%20Floor%202018%2006%2001.pdf",
    expectedAlpha: 0.4,
    expectedGStateCount: 38
  });
  console.log("  all-on OCG/alpha/Dublin regression passed");

  const simiWorker = await loadWorkerEntry("simi", 15_000);
  await testRealDenseFile(simiWorker, {
    url: "../public/examples/pdfs/SimiValleyBehavioralHealth_SR_20180403.pdf",
    expectedAlpha: 0.2,
    expectedGStateCount: 48
  });
  console.log("  nonvisual Square/OCG/alpha/Simi regression passed");

  const paintedFormWorker = await loadWorkerEntry("painted-form");
  await testPaintedFormFallback(paintedFormWorker);
  console.log("  painted Form XObject fallback passed");

  restoreGlobal("self", originalSelfDescriptor);
  const client = await import(
    new URL("../src/densePdfFastWorkerClient.ts?worker-client-test", import.meta.url)
  );
  await testClient(client.compileDensePdfInWorker);
  console.log("  client fallback/transfer/abort passed");

  console.log("Dense PDF fast worker/client tests passed.");
} finally {
  restoreGlobal("self", originalSelfDescriptor);
  restoreGlobal("Worker", originalWorkerDescriptor);
  moduleHooks.deregister();
}

async function testGeometryParity(computeGeometry) {
  const sourceDocument = await PDFDocument.create({ updateMetadata: false });
  const inputs = [];

  for (const rotation of [0, 90, 180, 270]) {
    const page = sourceDocument.addPage([200, 100]);
    page.setMediaBox(10, 20, 200, 100);
    page.setCropBox(30, 10, 170, 80);
    page.setRotation(degrees(rotation));
    page.node.set(PDFName.of("UserUnit"), sourceDocument.context.obj(2));
    inputs.push({
      mediaBox: { left: 10, bottom: 20, right: 210, top: 120 },
      cropBox: { left: 30, bottom: 10, right: 200, top: 90 },
      rotation,
      userUnit: 2
    });
  }

  // PDF.js falls back to MediaBox when CropBox has no positive-area
  // intersection with it.
  const disjointPage = sourceDocument.addPage([200, 100]);
  disjointPage.setMediaBox(0, 0, 200, 100);
  disjointPage.setCropBox(300, 300, 20, 20);
  inputs.push({
    mediaBox: { left: 0, bottom: 0, right: 200, top: 100 },
    cropBox: { left: 300, bottom: 300, right: 320, top: 320 },
    rotation: 0,
    userUnit: 1
  });

  const bytes = await sourceDocument.save({ useObjectStreams: false });
  const loadingTask = getDocument({ data: new Uint8Array(bytes) });
  const pdf = await loadingTask.promise;
  try {
    assert.equal(pdf.numPages, inputs.length);
    for (let index = 0; index < inputs.length; index += 1) {
      const page = await pdf.getPage(index + 1);
      const viewport = page.getViewport({
        scale: 1,
        rotation: page.rotate,
        dontFlip: false
      });
      const [a, b, c, d, e, f] = viewport.transform;
      const expectedMatrix = [a, -b, c, -d, e, viewport.height - f];
      const actual = computeGeometry(inputs[index]);

      assertNumbersClose(actual.pageMatrix, expectedMatrix, `page ${index + 1} matrix`);
      assertNumbersClose(
        boundsArray(actual.pageBounds),
        transformedBounds(page.view, expectedMatrix),
        `page ${index + 1} bounds`
      );
    }
  } finally {
    await loadingTask.destroy();
  }
}

async function testWorkerFallback(workerHarness) {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([100, 100]);
  const annotation = document.context.register(document.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [0, 0, 10, 10]
  }));
  page.node.set(PDFName.Annots, document.context.obj([annotation]));

  const resultMessage = await workerHarness.compile(
    await document.save({ useObjectStreams: false })
  );
  assert.equal(resultMessage.message.type, "result");
  assert.equal(resultMessage.message.result.kind, "fallback");
  assert.equal(resultMessage.message.result.reason, "annotations");
  assert.deepEqual(resultMessage.transfer, []);
  assertMonotonicProgress(workerHarness.messages);
  assert.equal(
    workerHarness.messages.some(({ message }) => message.type === "result" && "pages" in message),
    false,
    "fallback must not expose partially compiled pages"
  );
}

async function testMixedPageAtomicFallback(workerHarness) {
  const document = await PDFDocument.create({ updateMetadata: false });
  const eligiblePage = document.addPage([100, 100]);
  const eligibleContent = document.context.register(
    document.context.stream(new TextEncoder().encode("0 0 m 10 10 l S\n"))
  );
  eligiblePage.node.set(PDFName.Contents, eligibleContent);

  const unsupportedPage = document.addPage([100, 100]);
  const annotation = document.context.register(document.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [0, 0, 10, 10]
  }));
  unsupportedPage.node.set(PDFName.Annots, document.context.obj([annotation]));

  const resultMessage = await workerHarness.compile(
    await document.save({ useObjectStreams: false })
  );
  assert.equal(resultMessage.message.type, "result");
  assert.equal(resultMessage.message.result.kind, "fallback");
  assert.equal(resultMessage.message.result.reason, "annotations");
  assert.equal("pages" in resultMessage.message.result, false);
  assert.deepEqual(resultMessage.transfer, []);
  assertMonotonicProgress(workerHarness.messages);
}

async function testTextMiniResourceFallback(workerHarness) {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([100, 100]);
  const content = document.context.register(document.context.stream(
    new TextEncoder().encode("BT /MissingFont 12 Tf (fallback) Tj ET\n")
  ));
  page.node.set(PDFName.Contents, content);

  const resultMessage = await workerHarness.compile(
    await document.save({ useObjectStreams: false })
  );
  assert.equal(resultMessage.message.type, "result");
  assert.equal(resultMessage.message.result.kind, "fallback");
  assert.equal(resultMessage.message.result.reason, "unsupported-resource");
  assert.match(resultMessage.message.result.message, /MissingFont/);
  assert.equal("pages" in resultMessage.message.result, false);
  assert.deepEqual(resultMessage.transfer, []);
  assertMonotonicProgress(workerHarness.messages);
}

async function testWorkerSuccessAndProgress(workerHarness) {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([100, 80]);
  const content = document.context.register(
    document.context.stream(new TextEncoder().encode("0 0 m 10 10 l S\n"))
  );
  page.node.set(PDFName.Contents, content);

  const resultMessage = await workerHarness.compile(
    await document.save({ useObjectStreams: false })
  );
  assert.equal(resultMessage.message.type, "result");
  const result = resultMessage.message.result;
  assert.equal(result.kind, "success");
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].compiled.segmentCount, 1);
  assert.ok(result.textMiniPdfBytes.length > 0);
  assert.ok(result.timing.preflightMs >= 0);
  assert.ok(result.timing.decodeMs >= 0);
  assert.ok(result.timing.compileMs >= 0);
  assert.ok(result.timing.textMiniPdfMs >= 0);

  assert.ok(resultMessage.transfer.length > 1);
  assert.ok(resultMessage.transfer.includes(result.textMiniPdfBytes.buffer));
  assert.ok(resultMessage.transfer.includes(result.pages[0].compiled.endpoints.buffer));
  assert.equal(new Set(resultMessage.transfer).size, resultMessage.transfer.length);

  const progress = assertMonotonicProgress(workerHarness.messages);
  assert.equal(progress.at(-1).value, 1);
  for (const stage of ["pdf-fast-check", "pdf-fast-decode", "pdf-operators", "compile"]) {
    assert.ok(progress.some((event) => event.stage === stage), `missing ${stage} progress`);
  }

  const firstPayload = workerHarness.messages.findIndex(({ message }) => message.type === "result");
  assert.equal(firstPayload, workerHarness.messages.length - 1);
  assert.ok(
    workerHarness.messages.slice(0, firstPayload).every(({ message }) => message.type === "progress"),
    "compiled pages must be posted atomically in the final result"
  );
}

async function testLkOfficeTextForm(workerHarness) {
  const sourceBytes = new Uint8Array(await readFile(new URL(
    "../public/examples/pdfs/LK%20Office%20Level%201.pdf",
    import.meta.url
  )));
  const sourceFacts = await readFirstPageFacts(sourceBytes);
  assert.deepEqual(sourceFacts.text, [
    "*SR.min",
    "*SR.max",
    "Printed on February 17, 2021."
  ]);

  const resultMessage = await workerHarness.compile(sourceBytes);
  assert.equal(resultMessage.message.type, "result");
  const result = resultMessage.message.result;
  assert.equal(
    result.kind,
    "success",
    result.kind === "success" ? undefined : `${result.reason}: ${result.message}`
  );
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].compiled.textShowOpCount, 3);
  assert.equal(result.pages[0].compiled.operatorCount, sourceFacts.operatorCount);
  assert.deepEqual(
    (await readFirstPageFacts(result.textMiniPdfBytes)).text,
    sourceFacts.text
  );
  assertMonotonicProgress(workerHarness.messages);
}

async function testRecursiveFormWithUnusedImage(workerHarness) {
  const sourceBytes = await makeRecursiveFormImageFixture(false);
  const sourceFacts = await readFirstPageFacts(sourceBytes);
  assert.equal(sourceFacts.imagePaintCount, 0);

  const resultMessage = await workerHarness.compile(sourceBytes);
  assert.equal(resultMessage.message.type, "result");
  const result = resultMessage.message.result;
  assert.equal(
    result.kind,
    "success",
    result.kind === "success" ? undefined : `${result.reason}: ${result.message}`
  );
  assert.equal(result.pages[0].compiled.operatorCount, sourceFacts.operatorCount);
  assert.deepEqual(result.pages[0].compiled.referencedXObjects, ["Outer"]);
  const miniFacts = await readFirstPageFacts(result.textMiniPdfBytes);
  assert.equal(miniFacts.imagePaintCount, 0);
  assert.deepEqual(miniFacts.text, sourceFacts.text);
  assertMonotonicProgress(workerHarness.messages);
}

async function testInvokedNestedImageFallback(workerHarness) {
  const resultMessage = await workerHarness.compile(
    await makeRecursiveFormImageFixture(true)
  );
  assert.equal(resultMessage.message.type, "result");
  assert.equal(resultMessage.message.result.kind, "fallback");
  assert.equal(resultMessage.message.result.reason, "unsupported-content");
  assert.equal(resultMessage.message.result.operator, "Do");
  assert.match(resultMessage.message.result.message, /non-Form XObject \/Im0/);
  assertMonotonicProgress(workerHarness.messages);
}

async function makeRecursiveFormImageFixture(invokeImage) {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([100, 80]);
  const nested = document.context.stream(new TextEncoder().encode("q Q\n"), {
    Type: "XObject",
    Subtype: "Form",
    BBox: [0, 0, 10, 10],
    Resources: {}
  });
  const nestedRef = document.context.register(nested);
  const image = document.context.stream(new Uint8Array([128]), {
    Type: "XObject",
    Subtype: "Image",
    Width: 1,
    Height: 1,
    ColorSpace: "DeviceGray",
    BitsPerComponent: 8
  });
  const imageRef = document.context.register(image);
  const outerResources = document.context.obj({
    XObject: { Nested: nestedRef, Im0: imageRef }
  });
  const outer = document.context.stream(
    new TextEncoder().encode(invokeImage ? "/Im0 Do\n" : "/Nested Do\n"),
    {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, 20, 20]
    }
  );
  outer.dict.set(PDFName.Resources, outerResources);
  const outerRef = document.context.register(outer);
  page.node.Resources().set(
    PDFName.XObject,
    document.context.obj({ Outer: outerRef })
  );
  page.node.set(
    PDFName.Contents,
    document.context.register(
      document.context.stream(new TextEncoder().encode("/Outer Do\n"))
    )
  );
  return document.save({ useObjectStreams: false });
}

async function testCyclicFormFallback(workerHarness) {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([100, 80]);
  const resources = document.context.obj({});
  const form = document.context.stream(new TextEncoder().encode("/Self Do\n"), {
    Type: "XObject",
    Subtype: "Form",
    BBox: [0, 0, 20, 20]
  });
  form.dict.set(PDFName.Resources, resources);
  const formRef = document.context.register(form);
  resources.set(PDFName.XObject, document.context.obj({ Self: formRef }));
  page.node.Resources().set(
    PDFName.XObject,
    document.context.obj({ Outer: formRef })
  );
  page.node.set(
    PDFName.Contents,
    document.context.register(
      document.context.stream(new TextEncoder().encode("/Outer Do\n"))
    )
  );
  const resultMessage = await workerHarness.compile(
    await document.save({ useObjectStreams: false })
  );
  assert.equal(resultMessage.message.result.kind, "fallback");
  assert.equal(resultMessage.message.result.reason, "unsupported-content");
  assert.equal(resultMessage.message.result.operator, "Do");
  assert.match(resultMessage.message.result.message, /resource cycle/);
  assertMonotonicProgress(workerHarness.messages);
}

async function testFormDepthBudgetFallback(workerHarness) {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([100, 80]);
  let childRef = null;
  for (let depth = 18; depth >= 0; depth -= 1) {
    const resources = childRef
      ? { XObject: { Child: childRef } }
      : {};
    const form = document.context.stream(
      new TextEncoder().encode(childRef ? "/Child Do\n" : "q Q\n"),
      {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 20, 20],
        Resources: resources
      }
    );
    childRef = document.context.register(form);
  }
  page.node.Resources().set(
    PDFName.XObject,
    document.context.obj({ Outer: childRef })
  );
  page.node.set(
    PDFName.Contents,
    document.context.register(
      document.context.stream(new TextEncoder().encode("/Outer Do\n"))
    )
  );
  const resultMessage = await workerHarness.compile(
    await document.save({ useObjectStreams: false })
  );
  assert.equal(resultMessage.message.result.kind, "fallback");
  assert.equal(resultMessage.message.result.reason, "unsupported-content");
  assert.equal(resultMessage.message.result.operator, "Do");
  assert.match(resultMessage.message.result.message, /depth limit of 16/);
  assertMonotonicProgress(workerHarness.messages);
}

async function testOptionalContentFormFallback(workerHarness) {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([100, 80]);
  const group = document.context.register(document.context.obj({
    Type: "OCG",
    Name: PDFHexString.fromText("Visible layer")
  }));
  document.catalog.set(PDFName.of("OCProperties"), document.context.obj({
    OCGs: [group],
    D: { Order: [group], OFF: [] }
  }));
  const form = document.context.stream(
    new TextEncoder().encode("/OC /Layer BDC EMC\n"),
    {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, 20, 20],
      Resources: { Properties: { Layer: group } }
    }
  );
  const formRef = document.context.register(form);
  page.node.Resources().set(
    PDFName.XObject,
    document.context.obj({ LayerForm: formRef })
  );
  page.node.set(
    PDFName.Contents,
    document.context.register(
      document.context.stream(new TextEncoder().encode("/LayerForm Do\n"))
    )
  );
  const resultMessage = await workerHarness.compile(
    await document.save({ useObjectStreams: false })
  );
  assert.equal(resultMessage.message.result.kind, "fallback");
  assert.equal(resultMessage.message.result.reason, "unsupported-content");
  assert.equal(resultMessage.message.result.operator, "BDC");
  assertMonotonicProgress(workerHarness.messages);
}

async function testBaldwinRecursiveForms(workerHarness) {
  const sourceBytes = new Uint8Array(await readFile(new URL(
    "../public/examples/pdfs/Baldwin%20Park%20ED%20Remodel_Floor%201.pdf",
    import.meta.url
  )));
  const sourceFacts = await readFirstPageFacts(sourceBytes);
  assert.equal(sourceFacts.operatorCount, 1_396_700);
  assert.equal(sourceFacts.textShowCount, 7_687);
  assert.equal(sourceFacts.imagePaintCount, 0);

  const resultMessage = await workerHarness.compile(sourceBytes);
  assert.equal(resultMessage.message.type, "result");
  const result = resultMessage.message.result;
  assert.equal(
    result.kind,
    "success",
    result.kind === "success" ? undefined : `${result.reason}: ${result.message}`
  );
  const compiled = result.pages[0].compiled;
  assert.equal(compiled.operatorCount, 1_396_700);
  assert.equal(compiled.dependencyOpCount, 48);
  assert.equal(compiled.textShowOpCount, 7_687);
  assert.ok(
    compiled.referencedXObjects.length > 0,
    "off-page Forms with text must be retained for source-font parity"
  );

  const miniFacts = await readFirstPageFacts(result.textMiniPdfBytes);
  assert.equal(miniFacts.imagePaintCount, 0);
  assert.deepEqual(miniFacts.text, sourceFacts.text);
  assertMonotonicProgress(workerHarness.messages);
}

async function testRealDenseFile(
  workerHarness,
  { url, expectedAlpha, expectedGStateCount }
) {
  const sourceBytes = new Uint8Array(await readFile(new URL(url, import.meta.url)));
  const sourceFacts = await readFirstPageFacts(sourceBytes);
  assert.equal(sourceFacts.setGStateCount, expectedGStateCount);

  const resultMessage = await workerHarness.compile(sourceBytes);
  assert.equal(resultMessage.message.type, "result");
  const result = resultMessage.message.result;
  assert.equal(
    result.kind,
    "success",
    result.kind === "success" ? undefined : `${result.reason}: ${result.message}`
  );
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].compiled.operatorCount, sourceFacts.operatorCount);
  assert.ok(compiledPageHasAlpha(result.pages[0].compiled, expectedAlpha));

  const miniFacts = await readFirstPageFacts(result.textMiniPdfBytes);
  assert.deepEqual(miniFacts.text, sourceFacts.text);
  assert.equal(miniFacts.setGStateCount, expectedGStateCount);
  assertMonotonicProgress(workerHarness.messages);
}

function compiledPageHasAlpha(compiled, expectedAlpha) {
  for (let offset = 3; offset < compiled.primitiveMeta.length; offset += 4) {
    const encoded = compiled.primitiveMeta[offset];
    const flags = Math.max(0, Math.trunc(encoded / 2 + 1e-6));
    if (Math.abs(encoded - flags * 2 - expectedAlpha) < 1e-5) return true;
  }
  for (let offset = 3; offset < compiled.fillPathMetaC.length; offset += 4) {
    if (Math.abs(compiled.fillPathMetaC[offset] - expectedAlpha) < 1e-5) return true;
  }
  return false;
}

async function testPaintedFormFallback(workerHarness) {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([100, 80]);
  const form = document.context.stream(
    new TextEncoder().encode("0 0 m 10 10 l S\n")
  );
  form.dict.set(PDFName.Type, PDFName.XObject);
  form.dict.set(PDFName.of("Subtype"), PDFName.of("Form"));
  form.dict.set(PDFName.of("BBox"), document.context.obj([0, 0, 20, 20]));
  form.dict.set(PDFName.Resources, document.context.obj({}));
  const formRef = document.context.register(form);
  page.node.Resources().set(
    PDFName.XObject,
    document.context.obj({ Painted: formRef })
  );
  page.node.set(
    PDFName.Contents,
    document.context.register(
      document.context.stream(new TextEncoder().encode("/Painted Do\n"))
    )
  );

  const resultMessage = await workerHarness.compile(
    await document.save({ useObjectStreams: false })
  );
  assert.equal(resultMessage.message.type, "result");
  assert.equal(resultMessage.message.result.kind, "fallback");
  assert.equal(resultMessage.message.result.reason, "unsupported-content");
  assert.equal(resultMessage.message.result.operator, "Do");
  assert.equal("pages" in resultMessage.message.result, false);
  assert.deepEqual(resultMessage.transfer, []);
  assertMonotonicProgress(workerHarness.messages);
}

async function readFirstPageFacts(bytes) {
  const loadingTask = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const pdf = await loadingTask.promise;
  try {
    const page = await pdf.getPage(1);
    const [operatorList, textContent] = await Promise.all([
      page.getOperatorList(),
      page.getTextContent()
    ]);
    return {
      operatorCount: operatorList.fnArray.length,
      setGStateCount: operatorList.fnArray.filter((fn) => fn === OPS.setGState).length,
      textShowCount: operatorList.fnArray.filter((fn) => fn === OPS.showText).length,
      imagePaintCount: operatorList.fnArray.filter((fn) => IMAGE_PAINT_OPS.has(fn)).length,
      text: textContent.items
        .map((item) => typeof item.str === "string" ? item.str : "")
        .filter(Boolean)
    };
  } finally {
    await loadingTask.destroy();
  }
}

async function testClient(compileDensePdfInWorker) {
  restoreGlobal("Worker", undefined);
  const unavailable = await compileDensePdfInWorker(new Uint8Array([1]));
  assert.equal(unavailable.kind, "fallback");
  assert.equal(unavailable.reason, "worker-unavailable");

  const workerInstances = [];
  let behavior = "success";
  class MockWorker {
    listeners = new Map();
    terminated = false;
    request = null;
    transfer = null;

    constructor() {
      workerInstances.push(this);
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }

    postMessage(request, transfer) {
      this.request = request;
      this.transfer = transfer;
      if (behavior === "hold") {
        return;
      }
      queueMicrotask(() => {
        if (behavior === "fallback") {
          this.emit("message", {
            data: {
              type: "result",
              result: { kind: "fallback", reason: "unsupported-content", message: "nope" }
            }
          });
          return;
        }
        this.emit("message", {
          data: {
            type: "progress",
            progress: {
              value: 0.4,
              stage: "pdf-operators",
              executionPath: "dense-vector-worker",
              sourceType: "pdf"
            }
          }
        });
        this.emit("message", {
          data: {
            type: "result",
            result: {
              kind: "success",
              sourcePageCount: 1,
              pages: [],
              textMiniPdfBytes: new Uint8Array([9]),
              timing: {
                preflightMs: 1,
                decodeMs: 2,
                compileMs: 3,
                textMiniPdfMs: 4,
                totalMs: 10
              }
            }
          }
        });
      });
    }

    emit(type, event) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(event);
      }
    }

    terminate() {
      this.terminated = true;
    }
  }
  setGlobal("Worker", MockWorker);

  const backing = new Uint8Array([99, 1, 2, 3, 99]);
  const source = backing.subarray(1, 4);
  const progress = [];
  const success = await compileDensePdfInWorker(source, {
    pages: "1",
    onProgress: (event) => progress.push(event)
  });
  assert.equal(success.kind, "success");
  assert.deepEqual([...source], [1, 2, 3], "caller bytes must remain attached and unchanged");
  const successWorker = workerInstances.at(-1);
  assert.notEqual(successWorker.request.pdfBytes, source);
  assert.deepEqual([...successWorker.request.pdfBytes], [1, 2, 3]);
  assert.deepEqual(successWorker.transfer, [successWorker.request.pdfBytes.buffer]);
  assert.equal(successWorker.request.options.pages, "1");
  assert.equal(successWorker.terminated, true);
  assert.deepEqual(progress.map(({ value }) => value), [0.4]);

  behavior = "fallback";
  const fallback = await compileDensePdfInWorker(new Uint8Array([4, 5]));
  assert.equal(fallback.kind, "fallback");
  assert.equal(fallback.reason, "unsupported-content");
  assert.equal(workerInstances.at(-1).terminated, true);

  behavior = "hold";
  const controller = new AbortController();
  const abortReason = new DOMException("cancel test", "AbortError");
  const pending = compileDensePdfInWorker(new Uint8Array([6]), {
    signal: controller.signal
  });
  const abortWorker = workerInstances.at(-1);
  controller.abort(abortReason);
  await assert.rejects(pending, (error) => error === abortReason);
  assert.equal(abortWorker.terminated, true);
}

async function loadWorkerEntry(testName, timeoutMs = 5_000) {
  let messageListener = null;
  const messages = [];
  let resolveResult;
  const resultPromise = new Promise((resolve) => {
    resolveResult = resolve;
  });
  const scope = {
    addEventListener(type, listener) {
      if (type === "message") {
        messageListener = listener;
      }
    },
    postMessage(message, transfer = []) {
      const entry = { message, transfer };
      messages.push(entry);
      if (message.type === "result") {
        resolveResult(entry);
      }
    }
  };
  setGlobal("self", scope);
  const module = await import(
    new URL(`../src/densePdfFastWorker.ts?worker-test=${testName}`, import.meta.url)
  );
  restoreGlobal("self", originalSelfDescriptor);
  assert.equal(typeof messageListener, "function");

  return {
    module,
    messages,
    async compile(pdfBytes) {
      messageListener({
        data: {
          type: "compile",
          pdfBytes: new Uint8Array(pdfBytes),
          options: { enableSegmentMerge: true, enableInvisibleCull: true }
        }
      });
      let timeoutId;
      try {
        return await Promise.race([
          resultPromise,
          new Promise((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error(`${testName} worker timed out`)),
              timeoutMs
            );
          })
        ]);
      } finally {
        clearTimeout(timeoutId);
      }
    }
  };
}

function assertMonotonicProgress(messages) {
  const events = messages
    .filter(({ message }) => message.type === "progress")
    .map(({ message }) => message.progress);
  assert.ok(events.length >= 2);
  for (let index = 0; index < events.length; index += 1) {
    assert.ok(events[index].value >= 0 && events[index].value <= 1);
    assert.equal(events[index].executionPath, "dense-vector-worker");
    assert.equal(events[index].sourceType, "pdf");
    if (index > 0) {
      assert.ok(events[index].value >= events[index - 1].value, "progress must be monotonic");
    }
  }
  return events;
}

function transformedBounds(box, matrix) {
  const points = [
    transformPoint(matrix, box[0], box[1]),
    transformPoint(matrix, box[0], box[3]),
    transformPoint(matrix, box[2], box[1]),
    transformPoint(matrix, box[2], box[3])
  ];
  return [
    Math.min(...points.map(([x]) => x)),
    Math.min(...points.map(([, y]) => y)),
    Math.max(...points.map(([x]) => x)),
    Math.max(...points.map(([, y]) => y))
  ];
}

function transformPoint(matrix, x, y) {
  return [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5]
  ];
}

function boundsArray(bounds) {
  return [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY];
}

function assertNumbersClose(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label} length`);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= 1e-8,
      `${label}[${index}]: expected ${expected[index]}, received ${actual[index]}`
    );
  }
}

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value
  });
}

function restoreGlobal(name, descriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    delete globalThis[name];
  }
}
