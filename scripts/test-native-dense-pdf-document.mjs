import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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

try {
  const {
    closeNativeDensePdfDocument,
    getNativeDenseSourceDocument,
    preflightNativeDensePdfDocument
  } = await import("../src/nativeDensePdfDocument.ts");
  const { classifyDensePdfTextFormXObjects } = await import("../src/densePdfFastWorker.ts");

  const content = new TextEncoder().encode("BT /F1 12 Tf 10 20 Td (Native dense) Tj ET\n");
  const bytes = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [-10 -20 310 220] " +
          "/CropBox [0 0 300 200] /Rotate 90 /UserUnit 2 /Contents 4 0 R " +
          "/Resources << /Font << /F1 5 0 R >> /ProcSet [/PDF /Text] " +
          "/Properties << /Meta 6 0 R >> /ExtGState << /GS0 7 0 R >> >> >>"
      },
      { number: 4, body: tinyPdfStream("", content) },
      { number: 5, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
      { number: 6, body: "<< /MCID 7 /ActualText (Native dense) >>" },
      {
        number: 7,
        body: "<< /Type /ExtGState /BM /Normal /CA 0.4 /ca 0.2 /AIS true /SA true " +
          "/SMask /None >>"
      }
    ]
  });

  const native = await preflightNativeDensePdfDocument(bytes, {
    pages: "1",
    decodedChunkSize: 4096
  });
  assert.equal(native.eligible, true);
  assert.ok(getNativeDenseSourceDocument(native.document));

  const nativePage = native.document.pages[0];
  assert.deepEqual(pageSummary(nativePage), {
    sourcePageIndex: 0,
    sourcePageNumber: 1,
    mediaBox: { left: -10, bottom: -20, right: 310, top: 220 },
    cropBox: { left: 0, bottom: 0, right: 300, top: 200 },
    bleedBox: undefined,
    trimBox: undefined,
    artBox: undefined,
    rotation: 90,
    userUnit: 2,
    contentStreamCount: 1,
    encodedContentBytes: content.byteLength,
    availableFonts: ["F1"],
    availableProperties: ["Meta"],
    availableExtGStates: ["GS0"],
    alwaysVisibleOptionalContentProperties: [],
    formCount: 0
  });
  assert.deepEqual(nativePage.extGStates, [{
    resourceName: "GS0",
    strokeAlpha: 0.4,
    fillAlpha: 0.2,
    alphaIsShape: true,
    softMaskIndex: null,
    emitsPdfJsOperator: true
  }]);
  assert.equal(nativePage.fontDependencies.length, 1);
  assert.equal(nativePage.fontDependencies[0].resourceName, "F1");

  const nativeDecoded = await collect(nativePage.decodedContentChunks());
  assert.deepEqual(nativeDecoded, content);
  assert.equal(nativePage.decodeTiming.completed, true);
  assert.equal(nativePage.decodeTiming.decodedBytes, content.length);

  const firstDecode = nativePage.decodedContentChunks()[Symbol.asyncIterator]();
  await firstDecode.next();
  await assert.rejects(
    async () => collect(nativePage.decodedContentChunks()),
    /already being decoded/
  );
  await firstDecode.return();
  assert.equal(nativePage.decodeTiming.completed, false);

  await closeNativeDensePdfDocument(native.document);
  await closeNativeDensePdfDocument(native.document);
  assert.equal(getNativeDenseSourceDocument(native.document), null);
  await assert.rejects(
    async () => collect(nativePage.decodedContentChunks()),
    (error) => error?.code === "closed"
  );

  await assert.rejects(
    preflightNativeDensePdfDocument(bytes, { pages: "2" }),
    RangeError
  );

  const malformedStrokeAdjustment = await preflightNativeDensePdfDocument(writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] " +
          "/Resources << /ExtGState << /Bad 5 0 R >> >> /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", "/Bad gs 0 0 m 10 0 l S") },
      { number: 5, body: "<< /Type /ExtGState /SA 1 >>" }
    ]
  }));
  assert.equal(malformedStrokeAdjustment.eligible, false);
  assert.equal(malformedStrokeAdjustment.reason, "unsupported-resource");
  assert.match(malformedStrokeAdjustment.message, /invalid \/SA value/);

  const activeSoftMask = await preflightNativeDensePdfDocument(writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] " +
          "/Resources << /ExtGState << /Mask 5 0 R >> >> /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", "/Mask gs 0 0 10 10 re f") },
      { number: 5, body: "<< /Type /ExtGState /SMask 6 0 R >>" },
      { number: 6, body: "<< /S /Alpha >>" }
    ]
  }));
  assert.equal(activeSoftMask.eligible, false);
  assert.equal(activeSoftMask.reason, "unsupported-resource");
  assert.match(activeSoftMask.message, /unsupported non-\/None \/SMask/);

  await testMultipleAndNestedForms({
    classifyDensePdfTextFormXObjects,
    closeNativeDensePdfDocument,
    preflightNativeDensePdfDocument
  });
  await testNestedFormDepthLimit({
    classifyDensePdfTextFormXObjects,
    closeNativeDensePdfDocument,
    preflightNativeDensePdfDocument
  });
  await testTrackedFormCounts({
    classifyDensePdfTextFormXObjects,
    closeNativeDensePdfDocument,
    preflightNativeDensePdfDocument
  });

  console.log("Native dense-document adapter tests passed.");
} finally {
  hooks.deregister();
}

async function testMultipleAndNestedForms({
  classifyDensePdfTextFormXObjects,
  closeNativeDensePdfDocument,
  preflightNativeDensePdfDocument
}) {
  const bytes = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 80] " +
          "/Contents 4 0 R /Resources << /XObject << /Outer 5 0 R " +
          "/Second 6 0 R /PageImage 7 0 R >> >> >>"
      },
      { number: 4, body: tinyPdfStream("", "/Outer Do\n/Second Do\n") },
      {
        number: 5,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 20 20] " +
            "/Resources << /XObject << /Nested 8 0 R /Image 7 0 R " +
            "/UnusedBad 9 0 R /Self 5 0 R >> >>",
          "/Nested Do\n"
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
          Uint8Array.of(0x80)
        )
      },
      {
        number: 8,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 5 5] /Resources << >>",
          "q Q\n"
        )
      },
      {
        number: 9,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /Resources << >>",
          "unused malformed Form"
        )
      }
    ]
  });
  const native = await preflightNativeDensePdfDocument(bytes);
  assert.equal(native.eligible, true, native.eligible ? undefined : native.message);
  try {
    const forms = native.document.pages[0].formXObjects;
    assert.deepEqual(forms.map(({ resourceName }) => resourceName), ["Outer", "Second"]);
    assert.equal(forms.length, 2);
    const outer = forms[0];
    const nested = outer.resolveFormXObject("Nested");
    assert(nested);
    assert.equal(nested.resourceName, "Nested");
    assert.deepEqual(await collect(nested.decodedContentChunks()), new TextEncoder().encode("q Q\n"));
    assert.equal(outer.resolveFormXObject("Image"), null);
    assert.equal(outer.resolveFormXObject("/Image"), null);
    assert.equal(outer.resolveFormXObject("Self")?.dependencyKey, outer.dependencyKey);
    assert.throws(
      () => outer.resolveFormXObject("UnusedBad"),
      /does not have a valid BBox/
    );
    const summaries = await classifyDensePdfTextFormXObjects(native.document.pages[0]);
    assert.deepEqual([...summaries.keys()], ["Outer", "Second"]);
    assert.equal(summaries.get("Outer").hasNonTextPaint, false);
  } finally {
    await closeNativeDensePdfDocument(native.document);
  }
}

async function testNestedFormDepthLimit({
  classifyDensePdfTextFormXObjects,
  closeNativeDensePdfDocument,
  preflightNativeDensePdfDocument
}) {
  const objects = [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    {
      number: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] " +
        "/Contents 4 0 R /Resources << /XObject << /Root 10 0 R >> >> >>"
    },
    { number: 4, body: tinyPdfStream("", "/Root Do\n") }
  ];
  for (let depth = 0; depth <= 17; depth += 1) {
    const objectNumber = 10 + depth;
    const hasChild = depth < 17;
    objects.push({
      number: objectNumber,
      body: tinyPdfStream(
        "/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources <<" +
          (hasChild ? ` /XObject << /Child ${objectNumber + 1} 0 R >>` : "") +
          " >>",
        hasChild ? "/Child Do\n" : "q Q\n"
      )
    });
  }
  const result = await preflightNativeDensePdfDocument(writeTinyPdf({ objects }));
  assert.equal(result.eligible, true, result.eligible ? undefined : result.message);
  try {
    let form = result.document.pages[0].formXObjects[0];
    for (let depth = 1; depth <= 16; depth += 1) {
      form = form.resolveFormXObject("Child");
      assert(form, `Form at depth ${depth} must resolve`);
    }
    assert.throws(
      () => form.resolveFormXObject("Child"),
      /depth limit of 16/
    );
    await assert.rejects(
      classifyDensePdfTextFormXObjects(result.document.pages[0]),
      /depth limit of 16/
    );
  } finally {
    await closeNativeDensePdfDocument(result.document);
  }
}

async function testTrackedFormCounts({
  classifyDensePdfTextFormXObjects,
  closeNativeDensePdfDocument,
  preflightNativeDensePdfDocument
}) {
  const fixtures = [
    ["Baldwin%20Park%20ED%20Remodel_Floor%201.pdf", 6],
    ["thesis.pdf", 0],
    ["LK%20Office%20Level%201.pdf", 1]
  ];
  for (const [fileName, expectedFormCount] of fixtures) {
    const bytes = new Uint8Array(await readFile(new URL(
      `../public/examples/pdfs/${fileName}`,
      import.meta.url
    )));
    const result = await preflightNativeDensePdfDocument(bytes);
    assert.equal(result.eligible, true, result.eligible ? undefined : result.message);
    try {
      assert.equal(result.document.pages[0].formXObjects.length, expectedFormCount);
      assert.equal(
        (await classifyDensePdfTextFormXObjects(result.document.pages[0])).size,
        expectedFormCount
      );
    } finally {
      await closeNativeDensePdfDocument(result.document);
    }
  }
}

function pageSummary(page) {
  return {
    sourcePageIndex: page.sourcePageIndex,
    sourcePageNumber: page.sourcePageNumber,
    mediaBox: page.mediaBox,
    cropBox: page.cropBox,
    bleedBox: page.bleedBox,
    trimBox: page.trimBox,
    artBox: page.artBox,
    rotation: page.rotation,
    userUnit: page.userUnit,
    contentStreamCount: page.contentStreamCount,
    encodedContentBytes: page.encodedContentBytes,
    availableFonts: page.availableFonts,
    availableProperties: page.availableProperties,
    availableExtGStates: page.availableExtGStates,
    alwaysVisibleOptionalContentProperties: page.alwaysVisibleOptionalContentProperties,
    formCount: page.formXObjects.length
  };
}

async function collect(chunks) {
  const parts = [];
  let length = 0;
  const hash = createHash("sha256");
  for await (const chunk of chunks) {
    parts.push(chunk);
    length += chunk.length;
    hash.update(chunk);
  }
  assert.equal(hash.digest("hex").length, 64);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
