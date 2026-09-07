import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { deflateSync } from "node:zlib";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
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
  const {
    closeNativeDensePdfDocument,
    getNativeDenseSourceDocument,
    preflightNativeDensePdfDocument
  } = await import("../src/nativeDensePdfDocument.ts");

  await testEligibleDocumentContract({
    closeNativeDensePdfDocument,
    getNativeDenseSourceDocument,
    preflightNativeDensePdfDocument
  });
  await testMultipleContentStreams({
    closeNativeDensePdfDocument,
    preflightNativeDensePdfDocument
  });
  await testMetadataDoesNotGateRendering({
    closeNativeDensePdfDocument,
    getNativeDenseSourceDocument,
    preflightNativeDensePdfDocument
  });
  await testAnnotationEligibility({
    closeNativeDensePdfDocument,
    preflightNativeDensePdfDocument
  });
  await testOptionalContentEligibility({
    closeNativeDensePdfDocument,
    preflightNativeDensePdfDocument
  });
  await testPageTransparencyGroups({
    closeNativeDensePdfDocument,
    preflightNativeDensePdfDocument
  });
  await testFormResources({
    closeNativeDensePdfDocument,
    preflightNativeDensePdfDocument
  });
  await testExtGStateEligibility({
    closeNativeDensePdfDocument,
    preflightNativeDensePdfDocument
  });
  await testFontAndResourceEligibility({
    preflightNativeDensePdfDocument
  });
  await testContentFilters({
    closeNativeDensePdfDocument,
    preflightNativeDensePdfDocument
  });

  console.log("Dependency-free dense PDF document tests passed.");
} finally {
  hooks.deregister();
}

async function testEligibleDocumentContract({
  closeNativeDensePdfDocument,
  getNativeDenseSourceDocument,
  preflightNativeDensePdfDocument
}) {
  const content = encoder.encode("BT /F1 16 Tf 20 40 Td (Dense hello) Tj ET\n");
  const bytes = writeTinyPdf({
    objects: [
      {
        number: 1,
        body: "<< /Type /Catalog /Pages 2 0 R /Lang <FEFF00680075002D00480055> >>"
      },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R " +
          "/MediaBox [-10 -20 320 240] /CropBox [5 10 305 220] " +
          "/Rotate 90 /UserUnit 2 /Contents 4 0 R /Resources << " +
          "/Font << /F1 5 0 R >> /Properties << /MC0 6 0 R >> " +
          "/ExtGState << /R10 7 0 R /GSFalse 8 0 R /Alpha 9 0 R >> >> >>"
      },
      { number: 4, body: tinyPdfStream("", content) },
      { number: 5, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
      { number: 6, body: "<< /MCID 7 /ActualText (Dense hello) >>" },
      { number: 7, body: "<< /Type /ExtGState /OPM 1 >>" },
      { number: 8, body: "<< /Type /ExtGState /OPM 0 /OP false /op false >>" },
      { number: 9, body: "<< /Type /ExtGState /BM /Normal /CA 0.4 /ca 0.2 >>" }
    ]
  });
  const result = await preflightNativeDensePdfDocument(bytes, {
    pages: "1",
    decodedChunkSize: 4096
  });
  assert.equal(result.eligible, true, result.eligible ? undefined : result.message);
  const source = result.document;
  assert.equal(source.sourcePageCount, 1);
  assert.equal(source.pages.length, 1);

  const nativeSource = getNativeDenseSourceDocument(source);
  assert.ok(nativeSource, "successful native preflight retains its parsed source");
  assert.equal(nativeSource.info.language, "hu-HU");

  const page = source.pages[0];
  assert.deepEqual(page.mediaBox, { left: -10, bottom: -20, right: 320, top: 240 });
  assert.deepEqual(page.cropBox, { left: 5, bottom: 10, right: 305, top: 220 });
  assert.equal(page.rotation, 90);
  assert.equal(page.userUnit, 2);
  assert.deepEqual(page.availableFonts, ["F1"]);
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
  assert.deepEqual(page.fontDependencies, [{
    resourceName: "F1",
    dependencyKey: "5 0 R"
  }]);

  assert.deepEqual(await collectChunks(page.decodedContentChunks()), content);
  assert.equal(page.decodeTiming.completed, true);
  assert.equal(page.decodeTiming.decodedBytes, content.length);

  const active = page.decodedContentChunks()[Symbol.asyncIterator]();
  assert.equal((await active.next()).done, false);
  await assert.rejects(
    async () => collectChunks(page.decodedContentChunks()),
    /already being decoded/
  );
  await active.return();
  assert.equal(page.decodeTiming.completed, false);

  await closeNativeDensePdfDocument(source);
  await closeNativeDensePdfDocument(source);
  assert.equal(getNativeDenseSourceDocument(source), null);
  await assert.rejects(
    async () => collectChunks(page.decodedContentChunks()),
    (error) => error?.code === "closed"
  );
  await assert.rejects(
    preflightNativeDensePdfDocument(bytes, { pages: "2" }),
    RangeError
  );
}

async function testMultipleContentStreams({
  closeNativeDensePdfDocument,
  preflightNativeDensePdfDocument
}) {
  const bytes = singlePagePdf({
    pageEntries: "/Contents [4 0 R 5 0 R]",
    objects: [
      { number: 4, body: tinyPdfStream("", "q") },
      { number: 5, body: tinyPdfStream("", "Q") }
    ]
  });
  const document = await expectEligible(preflightNativeDensePdfDocument, bytes);
  try {
    const page = document.pages[0];
    assert.equal(page.contentStreamCount, 2);
    assert.equal(decoder.decode(await collectChunks(page.decodedContentChunks())), "q\nQ");
  } finally {
    await closeNativeDensePdfDocument(document);
  }
}

async function testMetadataDoesNotGateRendering({
  closeNativeDensePdfDocument,
  getNativeDenseSourceDocument,
  preflightNativeDensePdfDocument
}) {
  const bytes = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /Lang << /Value (hu-HU) >> >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>" }
    ]
  });
  const document = await expectEligible(preflightNativeDensePdfDocument, bytes);
  try {
    const nativeSource = getNativeDenseSourceDocument(document);
    assert.ok(nativeSource);
    assert.equal(nativeSource.info.language, undefined);
    assert.ok(
      nativeSource.getDiagnostics().some(({ code }) => code === "metadata.invalid-language"),
      "malformed optional metadata is diagnosed without rejecting static page imaging"
    );
  } finally {
    await closeNativeDensePdfDocument(document);
  }
}

async function testAnnotationEligibility({
  closeNativeDensePdfDocument,
  preflightNativeDensePdfDocument
}) {
  for (const annotation of [
    "<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /Border [0 0 0] /Dest [null /Fit] >>",
    "<< /Type /Annot /Subtype /Square /Rect [0 0 10 10] /Border [0 0 0] " +
      "/Contents (Review note) /F 4 /NM (square-1) /T (Reviewer) >>",
    "<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /BS << /W 0 >> " +
      "/A << /S /URI /URI (https://example.invalid/) >> /StructParent 1 /F 4 >>"
  ]) {
    const document = await expectEligible(
      preflightNativeDensePdfDocument,
      annotationPdf(annotation)
    );
    await closeNativeDensePdfDocument(document);
  }

  for (const annotation of [
    "<< /Type /Annot /Subtype /Text /Rect [0 0 10 10] >>",
    "<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /Border [0 0 1] >>",
    "<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /Border [0 0 0] /AP << >> >>",
    "<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /BS << /W 1 >> >>",
    "<< /Type /Annot /Subtype /Square /Rect [0 0 10 10] /Border [0 0 0] /IC [1 0 0] >>"
  ]) {
    await expectFallback(preflightNativeDensePdfDocument, annotationPdf(annotation), "annotations");
  }
}

async function testOptionalContentEligibility({
  closeNativeDensePdfDocument,
  preflightNativeDensePdfDocument
}) {
  const visible = await expectEligible(
    preflightNativeDensePdfDocument,
    optionalContentPdf()
  );
  try {
    assert.deepEqual(
      visible.pages[0].alwaysVisibleOptionalContentProperties,
      ["Layer"]
    );
  } finally {
    await closeNativeDensePdfDocument(visible);
  }

  await expectFallback(
    preflightNativeDensePdfDocument,
    optionalContentPdf({ hidden: true }),
    "optional-content"
  );
  await expectFallback(
    preflightNativeDensePdfDocument,
    optionalContentPdf({ defaultConfigEntries: "/AS []" }),
    "optional-content"
  );
  await expectFallback(
    preflightNativeDensePdfDocument,
    optionalContentPdf({ groupEntries: "/Usage << >>" }),
    "optional-content"
  );
  await expectFallback(
    preflightNativeDensePdfDocument,
    optionalContentPdf({ membership: true }),
    "optional-content"
  );

  const malformedCatalog = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [] >> >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>" }
    ]
  });
  await expectFallback(preflightNativeDensePdfDocument, malformedCatalog, "optional-content");

  await expectFallback(
    preflightNativeDensePdfDocument,
    singlePagePdf({ pageEntries: "/OC << /Type /OCG /Name (Optional page) >>" }),
    "optional-content"
  );

  const optionalForm = singlePagePdf({
    pageEntries: "/Resources << /XObject << /FmOptional 4 0 R >> >>",
    objects: [{
      number: 4,
      body: tinyPdfStream(
        "/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << >> " +
          "/OC << /Type /OCG /Name (Optional form) >>",
        "q Q\n"
      )
    }]
  });
  await expectFallback(preflightNativeDensePdfDocument, optionalForm, "optional-content");
}

async function testPageTransparencyGroups({
  closeNativeDensePdfDocument,
  preflightNativeDensePdfDocument
}) {
  await expectFallback(
    preflightNativeDensePdfDocument,
    pageGroupPdf("/Type /Group /S /Transparency /I true /CS /DeviceRGB"),
    "unsupported-resource"
  );

  const inert = await expectEligible(
    preflightNativeDensePdfDocument,
    pageGroupPdf("/Type /Group /S /Transparency /CS /DeviceRGB /I false /K false")
  );
  await closeNativeDensePdfDocument(inert);

  for (const entries of [
    "/Type /Group /S /Transparency /CS /DeviceRGB /K true",
    "/Type /Group /S /Transparency /CS /DeviceCMYK",
    "/Type /Group /S /Transparency /CS /DeviceRGB /Extra 1"
  ]) {
    await expectFallback(
      preflightNativeDensePdfDocument,
      pageGroupPdf(entries),
      "unsupported-resource"
    );
  }

  const translucent = pageGroupPdf(
    "/Type /Group /S /Transparency /CS /DeviceRGB",
    "/Resources << /ExtGState << /Alpha 4 0 R >> >>",
    [{ number: 4, body: "<< /Type /ExtGState /BM /Normal /CA 0.5 /ca 0.5 >>" }]
  );
  await expectFallback(
    preflightNativeDensePdfDocument,
    translucent,
    "unsupported-resource"
  );
}

async function testFormResources({
  closeNativeDensePdfDocument,
  preflightNativeDensePdfDocument
}) {
  const formContent = encoder.encode("/Alpha gs BT /FLocal 12 Tf (Form text) Tj ET\n");
  const compressedFormContent = new Uint8Array(deflateSync(formContent));
  const bytes = singlePagePdf({
    width: 200,
    height: 100,
    pageEntries: "/Contents 4 0 R /Resources << /XObject << " +
      "/Fm0 5 0 R /FmAlias 5 0 R /FmUnused 6 0 R /PageImage 10 0 R >> >>",
    objects: [
      { number: 4, body: tinyPdfStream("", "/Fm0 Do\n") },
      {
        number: 5,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /FormType 1 /BBox [0 0 80 20] " +
            "/Matrix [1 0 0 1 10 15] /Filter /FlateDecode /Resources << " +
            "/Font << /FLocal 8 0 R >> /ExtGState << /Alpha 9 0 R >> " +
            "/XObject << /Im0 10 0 R >> >>",
          compressedFormContent
        )
      },
      {
        number: 6,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Form /BBox [0 0 1 1] /Resources << >>",
          "q Q\n"
        )
      },
      { number: 8, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>" },
      { number: 9, body: "<< /Type /ExtGState /BM /Normal /CA 0.5 /ca 0.5 >>" },
      {
        number: 10,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 " +
            "/ColorSpace /DeviceGray /BitsPerComponent 8",
          Uint8Array.of(0x80)
        )
      }
    ]
  });
  const document = await expectEligible(preflightNativeDensePdfDocument, bytes);
  const page = document.pages[0];
  assert.equal(page.formXObjects.length, 3);
  assert.deepEqual(page.formXObjects.map(({ resourceName }) => resourceName), [
    "Fm0",
    "FmAlias",
    "FmUnused"
  ]);
  const selected = page.formXObjects[0];
  const alias = page.formXObjects[1];
  assert.equal(selected.dependencyKey, alias.dependencyKey);
  assert.deepEqual(selected.bbox, { left: 0, bottom: 0, right: 80, top: 20 });
  assert.deepEqual(selected.matrix, [1, 0, 0, 1, 10, 15]);
  assert.equal(selected.encodedContentBytes, compressedFormContent.length);
  assert.deepEqual(selected.availableExtGStates, ["Alpha"]);
  assert.deepEqual(selected.extGStates, [{
    resourceName: "Alpha",
    strokeAlpha: 0.5,
    fillAlpha: 0.5,
    emitsPdfJsOperator: true
  }]);
  assert.deepEqual(selected.fontDependencies, [{
    resourceName: "FLocal",
    dependencyKey: "8 0 R"
  }]);
  assert.equal(selected.resolveFormXObject("Im0"), null);
  assert.equal(selected.resolveFormXObject("/Im0"), null);
  assert.deepEqual(await collectChunks(selected.decodedContentChunks()), formContent);

  await closeNativeDensePdfDocument(document);
  await assert.rejects(
    async () => collectChunks(selected.decodedContentChunks()),
    (error) => error?.code === "closed"
  );
  await assert.rejects(
    async () => collectChunks(alias.decodedContentChunks()),
    (error) => error?.code === "closed"
  );

  const imageOnly = await expectEligible(
    preflightNativeDensePdfDocument,
    singlePagePdf({
      pageEntries: "/Resources << /XObject << /X0 4 0 R >> >>",
      objects: [{
        number: 4,
        body: tinyPdfStream(
          "/Type /XObject /Subtype /Image /Width 1 /Height 1 " +
            "/ColorSpace /DeviceGray /BitsPerComponent 8",
          Uint8Array.of(0)
        )
      }]
    })
  );
  try {
    assert.deepEqual(imageOnly.pages[0].formXObjects, []);
  } finally {
    await closeNativeDensePdfDocument(imageOnly);
  }
}

async function testExtGStateEligibility({
  closeNativeDensePdfDocument,
  preflightNativeDensePdfDocument
}) {
  for (const [entries, resourceName, expected] of [
    ["/Type /ExtGState /OPM 1", "R10", { resourceName: "R10", emitsPdfJsOperator: false }],
    ["/OPM 0 /OP false /op false", "GSOff", { resourceName: "GSOff", emitsPdfJsOperator: false }],
    ["/SA false /SM 0.5", "GSStrokeDefaults", {
      resourceName: "GSStrokeDefaults",
      emitsPdfJsOperator: false
    }],
    ["/Type /ExtGState /SA true", "StrokeAdjustment", {
      resourceName: "StrokeAdjustment",
      emitsPdfJsOperator: false
    }],
    ["/Type /ExtGState /SMask /None", "NoSoftMask", {
      resourceName: "NoSoftMask",
      softMaskIndex: null,
      emitsPdfJsOperator: true
    }],
    ["/Type /ExtGState /BM /Normal /CA 0.4 /ca 0.2", "Alpha", {
      resourceName: "Alpha",
      strokeAlpha: 0.4,
      fillAlpha: 0.2,
      emitsPdfJsOperator: true
    }]
  ]) {
    const document = await expectEligible(
      preflightNativeDensePdfDocument,
      extGStatePdf(entries, resourceName)
    );
    try {
      assert.deepEqual(document.pages[0].availableExtGStates, [resourceName]);
      assert.deepEqual(document.pages[0].extGStates, [expected]);
    } finally {
      await closeNativeDensePdfDocument(document);
    }
  }

  for (const [entries, resourceName] of [
    ["/Type /ExtGState /OP true", "StrokeOverprint"],
    ["/Type /ExtGState /op true", "FillOverprint"],
    ["/Type /ExtGState /OPM -1", "BadModeRange"],
    ["/Type /ExtGState /OPM 0.5", "BadModeInteger"],
    ["/Type /ExtGState /OPM /invalid", "BadMode"],
    ["/Type /NotExtGState /OPM 1", "BadType"],
    ["/Type /ExtGState /CA -0.1", "BadStrokeOpacityLow"],
    ["/Type /ExtGState /CA 1.1", "BadStrokeOpacityHigh"],
    ["/Type /ExtGState /ca /invalid", "BadFillOpacity"],
    ["/Type /ExtGState /BM /Multiply", "BlendMode"],
    ["/Type /ExtGState /SMask << /S /Alpha >>", "SoftMask"],
    ["/Type /ExtGState /SA 0", "BadStrokeAdjustment"],
    ["/Type /ExtGState /SM -0.1", "BadSmoothnessLow"],
    ["/Type /ExtGState /SM 1.1", "BadSmoothnessHigh"],
    ["/Type /ExtGState /SM /invalid", "BadSmoothnessType"]
  ]) {
    const fallback = await expectFallback(
      preflightNativeDensePdfDocument,
      extGStatePdf(entries, resourceName),
      "unsupported-resource"
    );
    assert.equal(fallback.resourceName, resourceName);
  }

  await expectFallback(
    preflightNativeDensePdfDocument,
    singlePagePdf({ pageEntries: "/Resources << /ExtGState [] >>" }),
    "invalid-structure"
  );
}

async function testFontAndResourceEligibility({ preflightNativeDensePdfDocument }) {
  const type3 = singlePagePdf({
    pageEntries: "/Resources << /Font << /FType3 4 0 R >> >>",
    objects: [{
      number: 4,
      body: "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1 1] " +
        "/FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << >> " +
        "/Encoding << /Type /Encoding /Differences [] >> /FirstChar 0 /LastChar 0 " +
        "/Widths [0] /Resources << >> >>"
    }]
  });
  await expectFallback(preflightNativeDensePdfDocument, type3, "unsupported-resource");

  await expectFallback(
    preflightNativeDensePdfDocument,
    singlePagePdf({ pageEntries: "/Resources << /ColorSpace << /CS /DeviceRGB >> >>" }),
    "unsupported-resource"
  );
}

async function testContentFilters({
  closeNativeDensePdfDocument,
  preflightNativeDensePdfDocument
}) {
  const content = encoder.encode("q Q\n");
  const compressed = new Uint8Array(deflateSync(content));
  const bytes = singlePagePdf({
    pageEntries: "/Contents 4 0 R",
    objects: [{ number: 4, body: tinyPdfStream("/Filter /FlateDecode", compressed) }]
  });
  const decoded = await expectEligible(preflightNativeDensePdfDocument, bytes);
  try {
    assert.deepEqual(await collectChunks(decoded.pages[0].decodedContentChunks()), content);
  } finally {
    await closeNativeDensePdfDocument(decoded);
  }

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
    const document = await expectEligible(preflightNativeDensePdfDocument, bytes);
    try {
      await assert.rejects(
        async () => collectChunks(document.pages[0].decodedContentChunks()),
        (error) => error?.code === "unsupported-filter" && /DecompressionStream/.test(error.message)
      );
    } finally {
      await closeNativeDensePdfDocument(document);
    }
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

  const unsupported = singlePagePdf({
    pageEntries: "/Contents 4 0 R",
    objects: [{
      number: 4,
      body: tinyPdfStream("/Filter /DCTDecode", encoder.encode("BT ET\n"))
    }]
  });
  const fallback = await expectFallback(
    preflightNativeDensePdfDocument,
    unsupported,
    "unsupported-filter"
  );
  assert.equal(fallback.filterName, "DCTDecode");
}

function singlePagePdf({
  width = 100,
  height = 80,
  pageEntries = "",
  objects = []
} = {}) {
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ${pageEntries} >>`
      },
      ...objects
    ]
  });
}

function annotationPdf(annotationBody) {
  return singlePagePdf({
    pageEntries: "/Annots [4 0 R]",
    objects: [{ number: 4, body: annotationBody }]
  });
}

function optionalContentPdf({
  hidden = false,
  defaultConfigEntries = "",
  groupEntries = "",
  membership = false
} = {}) {
  return writeTinyPdf({
    objects: [
      {
        number: 1,
        body: "<< /Type /Catalog /Pages 2 0 R /OCProperties << " +
          `/OCGs [5 0 R] /D << /Order [5 0 R] /OFF ${hidden ? "[5 0 R]" : "[]"} ` +
          `${defaultConfigEntries} >> >> >>`
      },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 80] " +
          "/Contents 4 0 R /Resources << /Properties << " +
          `/Layer ${membership ? "6 0 R" : "5 0 R"} >> >> >>`
      },
      { number: 4, body: tinyPdfStream("", "/OC /Layer BDC 0 0 m 10 0 l S EMC\n") },
      { number: 5, body: `<< /Type /OCG /Name (Visible layer) ${groupEntries} >>` },
      { number: 6, body: "<< /Type /OCMD /OCGs [5 0 R] >>" }
    ]
  });
}

function pageGroupPdf(groupEntries, pageEntries = "", objects = []) {
  return singlePagePdf({
    pageEntries: `/Group << ${groupEntries} >> ${pageEntries}`,
    objects
  });
}

function extGStatePdf(entries, resourceName) {
  return singlePagePdf({
    pageEntries: `/Resources << /ExtGState << /${resourceName} 4 0 R >> >>`,
    objects: [{ number: 4, body: `<< ${entries} >>` }]
  });
}

async function expectEligible(preflightNativeDensePdfDocument, bytes, options) {
  const result = await preflightNativeDensePdfDocument(bytes, options);
  assert.equal(result.eligible, true, result.eligible ? undefined : result.message);
  return result.document;
}

async function expectFallback(preflightNativeDensePdfDocument, bytes, reason) {
  const result = await preflightNativeDensePdfDocument(bytes);
  assert.equal(result.eligible, false);
  assert.equal(result.reason, reason);
  assert.equal("document" in result, false);
  return result;
}

async function collectChunks(chunks) {
  const parts = [];
  let length = 0;
  for await (const chunk of chunks) {
    parts.push(chunk);
    length += chunk.length;
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
