import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

Promise.try ??= (callback, ...args) => Promise.resolve().then(() => callback(...args));
Uint8Array.prototype.toHex ??= function toHex() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("hex");
};
Uint8Array.prototype.toBase64 ??= function toBase64() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("base64");
};
Uint8Array.fromHex ??= (value) => new Uint8Array(Buffer.from(value, "hex"));
Uint8Array.fromBase64 ??= (value) => new Uint8Array(Buffer.from(value, "base64"));

// Frozen from the pinned PDF.js 6.1.200 differential oracle before removing
// the runtime test dependency. These values intentionally describe PDF.js's
// public page view/viewport semantics and first-page operator/text output.
const PDFJS_GEOMETRY_GOLDENS = Object.freeze([
  { pageMatrix: [2, 0, 0, 2, -60, -40], pageBounds: [0, 0, 340, 140] },
  { pageMatrix: [0, -2, 2, 0, -40, 400], pageBounds: [0, 0, 140, 340] },
  { pageMatrix: [-2, 0, 0, -2, 400, 180], pageBounds: [0, 0, 340, 140] },
  { pageMatrix: [0, 2, -2, 0, 180, -60], pageBounds: [0, 0, 140, 340] },
  { pageMatrix: [1, 0, 0, 1, 0, 0], pageBounds: [0, 0, 200, 100] }
]);

const PDFJS_FIRST_PAGE_GOLDENS = Object.freeze({
  lkOffice: Object.freeze({
    sourceSha256: "c56147fee1b5b51e37edc0326d287006ff7d3413169e6b58c0744ec9d7eb5cd7",
    operatorCount: 1_131,
    setGStateCount: 0,
    textShowCount: 3,
    imagePaintCount: 0,
    textItemCount: 3,
    textItems: Object.freeze([
      "*SR.min",
      "*SR.max",
      "Printed on February 17, 2021."
    ]),
    normalizedTextLength: 45,
    normalizedTextSha256: "25ad59a8fcd1c8b5148cdc39134e6767bd423974392d64c61dd942c29454714b"
  }),
  recursiveUnusedImage: Object.freeze({
    sourceSha256: "e0844f1d9a3b94e9a6adb87e576d1222d18ca140286fa5d9f139d7bba2c5b311",
    operatorCount: 6,
    setGStateCount: 0,
    textShowCount: 0,
    imagePaintCount: 0,
    textItemCount: 0,
    normalizedTextLength: 0,
    normalizedTextSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }),
  chino: Object.freeze({
    sourceSha256: "65793154111994307c7f8a3454d1ae151c9d1f78578a2b43da37d79793f2a2ad",
    operatorCount: 155_096,
    setGStateCount: 0,
    textShowCount: 287,
    imagePaintCount: 0,
    textItemCount: 298,
    normalizedTextLength: 2_264,
    normalizedTextSha256: "66f2cff99420c4e27c76905a78a8499ba32023a5dbc9b30c28d66debe84e9b4c"
  }),
  dublin: Object.freeze({
    sourceSha256: "d27e385b3b627f9ffacb852ab1a9a7ac9283c93809070eed21976163164c9386",
    operatorCount: 494_823,
    setGStateCount: 38,
    textShowCount: 3_304,
    imagePaintCount: 0,
    textItemCount: 3_371,
    normalizedTextLength: 17_759,
    normalizedTextSha256: "c37f8fd93108116a305070a24c3474a76aa4c69bdfbe62f0f589aec24362a962"
  }),
  simi: Object.freeze({
    sourceSha256: "b31a733fe3cdc66b26447fa24a73eeabcd98503af7698e29f117672272e7f646",
    operatorCount: 77_154,
    setGStateCount: 48,
    textShowCount: 399,
    imagePaintCount: 0,
    textItemCount: 403,
    normalizedTextLength: 2_839,
    normalizedTextSha256: "9341b48a70b2689d575fef5d30c952515061d3447bb8d34cbbe677aed7b1f1e3"
  }),
  baldwin: Object.freeze({
    sourceSha256: "5c4fb6ddda7e22c59df5d84bf803d25e27548065802ed3748e10bc40f7f8c1a9",
    operatorCount: 1_396_700,
    setGStateCount: 0,
    textShowCount: 7_687,
    imagePaintCount: 0,
    textItemCount: 1_313,
    normalizedTextLength: 7_006,
    normalizedTextSha256: "4fc531afdba681ea2c100ff9cf583c0e09e5ac22c7d1ae85f3a378b4c2b8ed13"
  })
});

const originalSelfDescriptor = Object.getOwnPropertyDescriptor(globalThis, "self");
const originalWorkerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
const originalProcessDescriptor = Object.getOwnPropertyDescriptor(globalThis, "process");
const moduleHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "pdf-lib" ||
      specifier === "pdfjs-dist" ||
      specifier.startsWith("pdfjs-dist/")
    ) {
      throw new Error(`Dense worker regression test imported forbidden dependency ${specifier}.`);
    }
    if (
      context.parentURL?.includes("/src/") &&
      /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
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
  await testMissingTextResourceFallback(missingResourceWorker);
  console.log("  missing text-resource fallback passed");

  const successWorker = await loadWorkerEntry("success");
  await testWorkerSuccessAndProgress(successWorker);
  console.log("  success/progress protocol passed");

  const textFormWorker = await loadWorkerEntry("text-form", 15_000);
  await testLkOfficeTextForm(textFormWorker);
  console.log("  direct text Form XObject/LK Office regression passed");

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

  const chinoWorker = await loadWorkerEntry("chino", 15_000);
  await testRealDenseFile(chinoWorker, {
    url: "../public/examples/pdfs/Chino%20MOB_FLOOR%201.pdf",
    expectedAlpha: 1,
    sourceGolden: PDFJS_FIRST_PAGE_GOLDENS.chino
  });
  console.log("  nonvisual Link/Chino regression passed");

  const dublinWorker = await loadWorkerEntry("dublin", 15_000);
  await testRealDenseFile(dublinWorker, {
    url: "../public/examples/pdfs/Dublin%201st%20Floor%202018%2006%2001.pdf",
    expectedAlpha: 0.4,
    sourceGolden: PDFJS_FIRST_PAGE_GOLDENS.dublin
  });
  console.log("  native structure/direct-text/OCG/alpha Dublin regression passed");

  const simiWorker = await loadWorkerEntry("simi", 15_000);
  await testRealDenseFile(simiWorker, {
    url: "../public/examples/pdfs/SimiValleyBehavioralHealth_SR_20180403.pdf",
    expectedAlpha: 0.2,
    sourceGolden: PDFJS_FIRST_PAGE_GOLDENS.simi
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

  const baldwinWorker = await loadWorkerEntry("baldwin", 30_000);
  await testBaldwinRecursiveForms(baldwinWorker);
  console.log("  recursive/off-page Form Baldwin regression passed");

  console.log("Dense PDF fast worker/client tests passed.");
} finally {
  restoreGlobal("self", originalSelfDescriptor);
  restoreGlobal("Worker", originalWorkerDescriptor);
  restoreGlobal("process", originalProcessDescriptor);
  moduleHooks.deregister();
}

async function testGeometryParity(computeGeometry) {
  const inputs = [0, 90, 180, 270].map((rotation) => ({
    mediaBox: { left: 10, bottom: 20, right: 210, top: 120 },
    cropBox: { left: 30, bottom: 10, right: 200, top: 90 },
    rotation,
    userUnit: 2
  }));

  // PDF.js falls back to MediaBox when CropBox has no positive-area
  // intersection with it.
  inputs.push({
    mediaBox: { left: 0, bottom: 0, right: 200, top: 100 },
    cropBox: { left: 300, bottom: 300, right: 320, top: 320 },
    rotation: 0,
    userUnit: 1
  });

  assert.equal(inputs.length, PDFJS_GEOMETRY_GOLDENS.length);
  for (let index = 0; index < inputs.length; index += 1) {
    const actual = computeGeometry(inputs[index]);
    const expected = PDFJS_GEOMETRY_GOLDENS[index];
    assertNumbersClose(actual.pageMatrix, expected.pageMatrix, `page ${index + 1} matrix`);
    assertNumbersClose(
      boundsArray(actual.pageBounds),
      expected.pageBounds,
      `page ${index + 1} bounds`
    );
  }
}

async function testWorkerFallback(workerHarness) {
  const sourceBytes = makeSinglePageFixture({
    mediaBox: [0, 0, 100, 100],
    pageEntries: "/Annots [5 0 R]",
    objects: [
      { number: 5, body: "<< /Type /Annot /Subtype /Text /Rect [0 0 10 10] >>" }
    ]
  });

  const resultMessage = await workerHarness.compile(sourceBytes);
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
  const sourceBytes = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", "0 0 m 10 10 l S\n") },
      {
        number: 5,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Annots [6 0 R] >>"
      },
      { number: 6, body: "<< /Type /Annot /Subtype /Text /Rect [0 0 10 10] >>" }
    ]
  });

  const resultMessage = await workerHarness.compile(sourceBytes);
  assert.equal(resultMessage.message.type, "result");
  assert.equal(resultMessage.message.result.kind, "fallback");
  assert.equal(resultMessage.message.result.reason, "annotations");
  assert.equal("pages" in resultMessage.message.result, false);
  assert.deepEqual(resultMessage.transfer, []);
  assertMonotonicProgress(workerHarness.messages);
}

async function testMissingTextResourceFallback(workerHarness) {
  const sourceBytes = makeSinglePageFixture({
    mediaBox: [0, 0, 100, 100],
    content: "BT /MissingFont 12 Tf (fallback) Tj ET\n"
  });

  const resultMessage = await workerHarness.compile(sourceBytes);
  assert.equal(resultMessage.message.type, "result");
  assert.equal(resultMessage.message.result.kind, "fallback");
  assert.equal(resultMessage.message.result.reason, "native-text");
  assert.match(resultMessage.message.result.message, /\/Font resources are missing/);
  assert.equal("pages" in resultMessage.message.result, false);
  assert.deepEqual(resultMessage.transfer, []);
  assertMonotonicProgress(workerHarness.messages);
}

async function testWorkerSuccessAndProgress(workerHarness) {
  const sourceBytes = makeSinglePageFixture({ content: "0 0 m 10 10 l S\n" });

  const resultMessage = await workerHarness.compile(sourceBytes);
  assert.equal(resultMessage.message.type, "result");
  const result = resultMessage.message.result;
  assert.equal(result.kind, "success");
  assert.equal(result.structureBackend, "hepr-native");
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].compiled.segmentCount, 1);
  assert.equal(result.textMiniPdfBytes.length, 0);
  assert.equal(result.nativeTextScenes, undefined);
  assert.ok(result.timing.preflightMs >= 0);
  assert.ok(result.timing.decodeMs >= 0);
  assert.ok(result.timing.compileMs >= 0);
  assert.equal(result.timing.textMiniPdfMs, 0);
  assert.equal(result.timing.nativeTextMs, 0);

  assert.ok(resultMessage.transfer.length > 1);
  assert.ok(resultMessage.transfer.includes(result.pages[0].compiled.endpoints.buffer));
  assert.equal(new Set(resultMessage.transfer).size, resultMessage.transfer.length);

  const progress = assertMonotonicProgress(workerHarness.messages);
  assert.equal(progress.at(-1).value, 1);
  for (const stage of [
    "pdf-fast-check",
    "pdf-fast-decode",
    "pdf-operators",
    "pdf-optimize",
    "compile"
  ]) {
    assert.ok(progress.some((event) => event.stage === stage), `missing ${stage} progress`);
  }
  const optimize = progress.filter((event) => event.stage === "pdf-optimize");
  assert.ok(optimize.length > 0);
  for (const event of optimize) {
    assert.equal(event.unit, "segments");
    assert.ok(Number.isFinite(event.processed) && event.processed >= 0);
    assert.ok(Number.isFinite(event.total) && event.total > 0);
    assert.ok(event.processed <= event.total);
  }
  assert.ok(
    progress.findIndex((event) => event.stage === "pdf-optimize") >
      progress.findIndex((event) => event.stage === "pdf-operators"),
    "optimization progress must follow operator scanning"
  );

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
  const sourceGolden = PDFJS_FIRST_PAGE_GOLDENS.lkOffice;
  assertPdfSourceGolden(sourceBytes, sourceGolden, "LK Office source");

  const resultMessage = await workerHarness.compile(sourceBytes);
  assert.equal(resultMessage.message.type, "result");
  const result = resultMessage.message.result;
  assert.equal(
    result.kind,
    "success",
    result.kind === "success" ? undefined : `${result.reason}: ${result.message}`
  );
  assert.equal(result.structureBackend, "hepr-native");
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].compiled.textShowOpCount, sourceGolden.textShowCount);
  assert.equal(result.pages[0].compiled.operatorCount, sourceGolden.operatorCount);
  assert.equal(result.textMiniPdfBytes.length, 0);
  assert.equal(result.timing.textMiniPdfMs, 0);
  assert.ok(result.timing.nativeTextMs > 0);
  assert.equal(result.nativeTextScenes?.length, 1, "native text scene missing");
  const nativeTextScene = result.nativeTextScenes[0];
  assert.equal(nativeTextScene.textIndex.pages[0].text, sourceGolden.textItems.join(" "));
  assertNormalizedTextGolden(
    nativeTextScene.textIndex.pages[0].text,
    sourceGolden,
    "LK Office text"
  );
  assert.equal(nativeTextScene.textInstanceCount, 39);
  assert.ok(
    resultMessage.transfer.includes(nativeTextScene.textInstanceA.buffer),
    "native text instance data must be transferred"
  );
  const { extractPdfPageScenes } = await import(
    new URL("../src/pdfVectorExtractor.ts?native-text-form-parity", import.meta.url)
  );
  const [oracleTextScene] = await extractPdfPageScenes(
    sourceBytes.buffer.slice(
      sourceBytes.byteOffset,
      sourceBytes.byteOffset + sourceBytes.byteLength
    ),
    { pdfFastPath: "off", enableSegmentMerge: false, enableInvisibleCull: false }
  );
  assertTextWorldGeometryClose(
    nativeTextScene,
    oracleTextScene,
    "LK Office native/Form text"
  );
  assertMonotonicProgress(workerHarness.messages);
}

async function testRecursiveFormWithUnusedImage(workerHarness) {
  const sourceBytes = await makeRecursiveFormImageFixture(false);
  const sourceGolden = PDFJS_FIRST_PAGE_GOLDENS.recursiveUnusedImage;
  assertPdfSourceGolden(sourceBytes, sourceGolden, "recursive unused-image fixture");

  const resultMessage = await workerHarness.compile(sourceBytes);
  assert.equal(resultMessage.message.type, "result");
  const result = resultMessage.message.result;
  assert.equal(
    result.kind,
    "success",
    result.kind === "success" ? undefined : `${result.reason}: ${result.message}`
  );
  assert.equal(result.structureBackend, "hepr-native");
  assert.equal(result.pages[0].compiled.operatorCount, sourceGolden.operatorCount);
  assert.equal(result.pages[0].compiled.textShowOpCount, sourceGolden.textShowCount);
  assert.deepEqual(result.pages[0].compiled.referencedXObjects, ["Outer"]);
  assert.equal(result.textMiniPdfBytes.length, 0);
  assert.equal(result.nativeTextScenes, undefined);
  assert.equal(result.timing.nativeTextMs, 0);
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
  return makeSinglePageFixture({
    content: "/Outer Do\n",
    resources: "<< /XObject << /Outer 5 0 R >> >>",
    objects: [
      {
        number: 5,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 20 20] " +
            "/Resources << /XObject << /Nested 6 0 R /Im0 7 0 R >> >>",
          invokeImage ? "/Im0 Do\n" : "/Nested Do\n"
        )
      },
      {
        number: 6,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << >>",
          "q Q\n"
        )
      },
      {
        number: 7,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 " +
            "/ColorSpace /DeviceGray /BitsPerComponent 8",
          Uint8Array.of(128)
        )
      }
    ]
  });
}

async function testCyclicFormFallback(workerHarness) {
  const sourceBytes = makeSinglePageFixture({
    content: "/Outer Do\n",
    resources: "<< /XObject << /Outer 5 0 R >> >>",
    objects: [
      {
        number: 5,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 20 20] " +
            "/Resources << /XObject << /Self 5 0 R >> >>",
          "/Self Do\n"
        )
      }
    ]
  });
  const resultMessage = await workerHarness.compile(sourceBytes);
  assert.equal(resultMessage.message.result.kind, "fallback");
  assert.equal(resultMessage.message.result.reason, "unsupported-content");
  assert.equal(resultMessage.message.result.operator, "Do");
  assert.match(resultMessage.message.result.message, /resource cycle/);
  assertMonotonicProgress(workerHarness.messages);
}

async function testFormDepthBudgetFallback(workerHarness) {
  const firstFormObject = 5;
  const formCount = 19;
  const formObjects = Array.from({ length: formCount }, (_, index) => {
    const number = firstFormObject + index;
    const childNumber = index + 1 < formCount ? number + 1 : null;
    return {
      number,
      body: tinyPdfStream(
        "/Type /XObject /Subtype /Form /BBox [0 0 20 20] " +
          (childNumber
            ? `/Resources << /XObject << /Child ${childNumber} 0 R >> >>`
            : "/Resources << >>"),
        childNumber ? "/Child Do\n" : "q Q\n"
      )
    };
  });
  const sourceBytes = makeSinglePageFixture({
    content: "/Outer Do\n",
    resources: `<< /XObject << /Outer ${firstFormObject} 0 R >> >>`,
    objects: formObjects
  });
  const resultMessage = await workerHarness.compile(sourceBytes);
  assert.equal(resultMessage.message.result.kind, "fallback");
  assert.equal(resultMessage.message.result.reason, "unsupported-content");
  assert.equal(resultMessage.message.result.operator, "Do");
  assert.match(resultMessage.message.result.message, /depth limit of 16/);
  assertMonotonicProgress(workerHarness.messages);
}

async function testOptionalContentFormFallback(workerHarness) {
  const sourceBytes = makeSinglePageFixture({
    catalogEntries: "/OCProperties << /OCGs [5 0 R] /D << /Order [5 0 R] /OFF [] >> >>",
    content: "/LayerForm Do\n",
    resources: "<< /XObject << /LayerForm 6 0 R >> >>",
    objects: [
      {
        number: 5,
        body: "<< /Type /OCG /Name <FEFF00560069007300690062006C00650020006C0061007900650072> >>"
      },
      {
        number: 6,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 20 20] " +
            "/Resources << /Properties << /Layer 5 0 R >> >>",
          "/OC /Layer BDC EMC\n"
        )
      }
    ]
  });
  const resultMessage = await workerHarness.compile(sourceBytes);
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
  const sourceGolden = PDFJS_FIRST_PAGE_GOLDENS.baldwin;
  assertPdfSourceGolden(sourceBytes, sourceGolden, "Baldwin source");

  const resultMessage = await workerHarness.compile(sourceBytes);
  assert.equal(resultMessage.message.type, "result");
  const result = resultMessage.message.result;
  assert.equal(
    result.kind,
    "success",
    result.kind === "success" ? undefined : `${result.reason}: ${result.message}`
  );
  const compiled = result.pages[0].compiled;
  assert.equal(result.structureBackend, "hepr-native");
  assert.equal(compiled.operatorCount, sourceGolden.operatorCount);
  assert.equal(compiled.dependencyOpCount, 48);
  assert.equal(compiled.textShowOpCount, sourceGolden.textShowCount);
  assert.ok(
    compiled.referencedXObjects.length > 0,
    "off-page Forms with text must be retained for source-font parity"
  );

  assert.equal(result.textMiniPdfBytes.length, 0);
  assert.equal(result.nativeTextScenes?.length, 1, "Baldwin native text scene missing");
  assert.ok(result.nativeTextScenes[0].textInstanceCount > 0);
  assertNormalizedTextGolden(
    result.nativeTextScenes[0].textIndex.pages[0].text,
    sourceGolden,
    "Baldwin text"
  );
  assert.ok(result.timing.nativeTextMs > 0);
  assertMonotonicProgress(workerHarness.messages);
}

async function testRealDenseFile(
  workerHarness,
  { url, expectedAlpha, sourceGolden }
) {
  const sourceBytes = new Uint8Array(await readFile(new URL(url, import.meta.url)));
  assertPdfSourceGolden(sourceBytes, sourceGolden, `${url} source`);

  const resultMessage = await workerHarness.compile(sourceBytes);
  assert.equal(resultMessage.message.type, "result");
  const result = resultMessage.message.result;
  assert.equal(
    result.kind,
    "success",
    result.kind === "success" ? undefined : `${result.reason}: ${result.message}`
  );
  assert.equal(result.pages.length, 1);
  assert.equal(result.structureBackend, "hepr-native");
  assert.equal(result.pages[0].compiled.operatorCount, sourceGolden.operatorCount);
  assert.equal(result.pages[0].compiled.textShowOpCount, sourceGolden.textShowCount);
  assert.ok(compiledPageHasAlpha(result.pages[0].compiled, expectedAlpha));
  assert.equal(result.textMiniPdfBytes.length, 0);
  assert.equal(result.timing.textMiniPdfMs, 0);
  if (sourceGolden.normalizedTextLength > 0) {
    assert.equal(
      result.nativeTextScenes?.length,
      1,
      "native text scene missing"
    );
    assert.ok(result.nativeTextScenes[0].textInstanceCount > 0);
    assertNormalizedTextGolden(
      result.nativeTextScenes[0].textIndex.pages[0].text,
      sourceGolden,
      `${url} text`
    );
    assert.ok(result.timing.nativeTextMs > 0);
    assert.ok(resultMessage.transfer.includes(
      result.nativeTextScenes[0].textInstanceA.buffer
    ));
  } else {
    assert.equal(result.nativeTextScenes, undefined);
    assert.equal(result.timing.nativeTextMs, 0);
  }
  assertMonotonicProgress(workerHarness.messages);
}

function normalizeText(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertPdfSourceGolden(sourceBytes, golden, label) {
  assert.equal(
    sha256(sourceBytes),
    golden.sourceSha256,
    `${label} changed; regenerate its pinned-oracle facts intentionally`
  );
}

function assertNormalizedTextGolden(actualValue, golden, label) {
  const actual = normalizeText(actualValue);
  assert.equal(actual.length, golden.normalizedTextLength, `${label} length`);
  assert.equal(sha256(actual), golden.normalizedTextSha256, `${label} SHA-256`);
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
  const sourceBytes = makeSinglePageFixture({
    content: "/Painted Do\n",
    resources: "<< /XObject << /Painted 5 0 R >> >>",
    objects: [
      {
        number: 5,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Resources << >>",
          "0 0 m 10 10 l S\n"
        )
      }
    ]
  });

  const resultMessage = await workerHarness.compile(sourceBytes);
  assert.equal(resultMessage.message.type, "result");
  assert.equal(resultMessage.message.result.kind, "fallback");
  assert.equal(resultMessage.message.result.reason, "unsupported-content");
  assert.equal(resultMessage.message.result.operator, "Do");
  assert.equal("pages" in resultMessage.message.result, false);
  assert.deepEqual(resultMessage.transfer, []);
  assertMonotonicProgress(workerHarness.messages);
}

function makeSinglePageFixture({
  mediaBox = [0, 0, 100, 80],
  resources = "<< >>",
  content,
  pageEntries = "",
  catalogEntries = "",
  objects = []
} = {}) {
  const pageBody = [
    "<< /Type /Page /Parent 2 0 R",
    `/MediaBox [${pdfBox(mediaBox)}]`,
    `/Resources ${resources}`,
    content === undefined ? "" : "/Contents 4 0 R",
    pageEntries,
    ">>"
  ].filter(Boolean).join(" ");
  return writeTinyPdf({
    objects: [
      {
        number: 1,
        body: `<< /Type /Catalog /Pages 2 0 R${catalogEntries ? ` ${catalogEntries}` : ""} >>`
      },
      { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      { number: 3, body: pageBody },
      ...(content === undefined
        ? []
        : [{ number: 4, body: tinyPdfStream("", content) }]),
      ...objects
    ]
  });
}

function pdfBox(box) {
  if (Array.isArray(box)) return box.join(" ");
  return [box.left, box.bottom, box.right, box.top].join(" ");
}

async function testClient(compileDensePdfInWorker) {
  restoreGlobal("Worker", undefined);
  const directNode = await compileDensePdfInWorker(new Uint8Array([1]));
  assert.equal(directNode.kind, "fallback");
  assert.equal(directNode.reason, "invalid-structure");

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
              structureBackend: "hepr-native",
              sourcePageCount: 1,
              pages: [],
              textMiniPdfBytes: new Uint8Array(0),
              timing: {
                preflightMs: 1,
                decodeMs: 2,
                compileMs: 3,
                textMiniPdfMs: 0,
                nativeTextMs: 0,
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
  // Exercise the unchanged browser Worker branch after proving that Node no
  // longer needs this global constructor.
  setGlobal("process", undefined);

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
  assert.deepEqual(successWorker.request.options, {
    pages: "1",
    enableSegmentMerge: true,
    enableInvisibleCull: true
  });
  assert.equal(success.structureBackend, "hepr-native");
  assert.equal(success.textMiniPdfBytes.length, 0);
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
  restoreGlobal("process", originalProcessDescriptor);
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
    async compile(pdfBytes, options = {}) {
      messageListener({
        data: {
          type: "compile",
          pdfBytes: new Uint8Array(pdfBytes),
          options: {
            enableSegmentMerge: true,
            enableInvisibleCull: true,
            ...options
          }
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

function assertTextWorldGeometryClose(actual, expected, label) {
  assert.equal(actual.textInstanceCount, expected.textInstanceCount, `${label} instance count`);
  assert.equal(actual.textGlyphSegmentCount, expected.textGlyphSegmentCount, `${label} segment count`);
  assert.equal(actual.textIndex.pages.length, expected.textIndex.pages.length, `${label} index pages`);
  assert.equal(actual.textIndex.pages[0].text, expected.textIndex.pages[0].text, `${label} text`);
  assert.deepEqual(
    actual.textIndex.pages[0].charInstance,
    expected.textIndex.pages[0].charInstance,
    `${label} text mapping`
  );

  for (let instance = 0; instance < actual.textInstanceCount; instance += 1) {
    const actualMatrix = textInstanceMatrix(actual, instance);
    const expectedMatrix = textInstanceMatrix(expected, instance);
    const actualGlyph = textGlyphRecord(actual, instance);
    const expectedGlyph = textGlyphRecord(expected, instance);
    const actualWorldBounds = transformedBounds(actualGlyph.bounds, actualMatrix);
    const expectedWorldBounds = transformedBounds(expectedGlyph.bounds, expectedMatrix);
    assertNumbersWithin(
      actualWorldBounds,
      expectedWorldBounds,
      1e-4,
      `${label} instance ${instance} world bounds`
    );
    assert.equal(
      actualGlyph.count,
      expectedGlyph.count,
      `${label} instance ${instance} primitive count`
    );

    // PDF.js normalizes TrueType outlines to em units and may pack their path
    // coordinates as Float16. The native path retains integer font units. A
    // PDF.js path point may therefore differ by at most half a native font
    // unit after applying the instance transform.
    const pathPointTolerance = 1e-4 + 0.5001 * Math.max(
      Math.abs(actualMatrix[0]) + Math.abs(actualMatrix[2]),
      Math.abs(actualMatrix[1]) + Math.abs(actualMatrix[3])
    );
    for (let primitive = 0; primitive < actualGlyph.count; primitive += 1) {
      const actualOffset = (actualGlyph.start + primitive) * 4;
      const expectedOffset = (expectedGlyph.start + primitive) * 4;
      const actualType = actual.textGlyphSegmentsB[actualOffset + 2];
      const expectedType = expected.textGlyphSegmentsB[expectedOffset + 2];
      assert.equal(
        actualType,
        expectedType,
        `${label} instance ${instance} primitive ${primitive} type`
      );
      assertNumbersWithin(
        transformPoint(
          actualMatrix,
          actual.textGlyphSegmentsA[actualOffset],
          actual.textGlyphSegmentsA[actualOffset + 1]
        ),
        transformPoint(
          expectedMatrix,
          expected.textGlyphSegmentsA[expectedOffset],
          expected.textGlyphSegmentsA[expectedOffset + 1]
        ),
        pathPointTolerance,
        `${label} instance ${instance} primitive ${primitive} start`
      );
      assertNumbersWithin(
        transformPoint(
          actualMatrix,
          actual.textGlyphSegmentsA[actualOffset + 2],
          actual.textGlyphSegmentsA[actualOffset + 3]
        ),
        transformPoint(
          expectedMatrix,
          expected.textGlyphSegmentsA[expectedOffset + 2],
          expected.textGlyphSegmentsA[expectedOffset + 3]
        ),
        pathPointTolerance,
        `${label} instance ${instance} primitive ${primitive} control/end`
      );
      assertNumbersWithin(
        transformPoint(
          actualMatrix,
          actual.textGlyphSegmentsB[actualOffset],
          actual.textGlyphSegmentsB[actualOffset + 1]
        ),
        transformPoint(
          expectedMatrix,
          expected.textGlyphSegmentsB[expectedOffset],
          expected.textGlyphSegmentsB[expectedOffset + 1]
        ),
        pathPointTolerance,
        `${label} instance ${instance} primitive ${primitive} end`
      );
    }
  }
}

function textInstanceMatrix(scene, instance) {
  const offset = instance * 4;
  return [
    scene.textInstanceA[offset],
    scene.textInstanceA[offset + 1],
    scene.textInstanceA[offset + 2],
    scene.textInstanceA[offset + 3],
    scene.textInstanceB[offset],
    scene.textInstanceB[offset + 1]
  ];
}

function textGlyphRecord(scene, instance) {
  const glyph = Math.trunc(scene.textInstanceB[instance * 4 + 2]);
  const offset = glyph * 4;
  return {
    start: Math.trunc(scene.textGlyphMetaA[offset]),
    count: Math.trunc(scene.textGlyphMetaA[offset + 1]),
    bounds: [
      scene.textGlyphMetaA[offset + 2],
      scene.textGlyphMetaA[offset + 3],
      scene.textGlyphMetaB[offset],
      scene.textGlyphMetaB[offset + 1]
    ]
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

function assertNumbersWithin(actual, expected, tolerance, label) {
  assert.equal(actual.length, expected.length, `${label} length`);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= tolerance,
      `${label}[${index}]: expected ${expected[index]}, received ${actual[index]}, ` +
        `tolerance ${tolerance}`
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
