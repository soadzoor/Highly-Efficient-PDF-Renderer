import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const { openNativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
const { isPdfRef } = await import("../src/pdf/nativeCos.ts");
const { PdfError } = await import("../src/pdf/nativeTypes.ts");

const encoder = new TextEncoder();

try {
  await testCatalogAndVersionSemantics();
  await testPageTreeInheritanceOrderAndLaziness();
  await testPageTreeStructureFailures();
  await testPageTreeLimitsAndCancellation();
  await testIndirectObjectDepthLimit();
  await testMissingStreamEndEolRepair();
  await testMetadataStringsDatesAndIdentifiers();
  await testIncrementalTrailerInheritance();
  await testLinearizationValidation();
} finally {
  hooks.deregister();
}

console.log("native document semantic tests passed");

async function testCatalogAndVersionSemantics() {
  const upgraded = await openStrict(simpleFixture({
    version: "1.4",
    catalog: "<< /Type /Catalog /Version /1.7 /Pages 2 0 R >>"
  }));
  assert.equal(upgraded.info.version, "1.7");
  await upgraded.close();

  const pdfTwo = await openStrict(simpleFixture({
    version: "2.0",
    catalog: "<< /Type /Catalog /Version /1.7 /Pages 2 0 R >>"
  }));
  assert.equal(pdfTwo.info.version, "2.0", "catalog /Version must never downgrade the header");
  await pdfTwo.close();

  await assert.rejects(
    openStrict(simpleFixture({ version: "1.8" })),
    hasPdfError("invalid-header", /Unsupported PDF header version/)
  );
  await assert.rejects(
    openStrict(simpleFixture({ catalog: "<< /Type /Catalog /Version /1.8 /Pages 2 0 R >>" })),
    hasPdfError("invalid-header", /Unsupported catalog PDF version/)
  );
  await assert.rejects(
    openStrict(simpleFixture({ catalog: "<< /Type /Catalog /Version (1.7) /Pages 2 0 R >>" })),
    hasPdfError("invalid-header", /non-name/)
  );
  await assert.rejects(
    openStrict(simpleFixture({ catalog: "<< /Type /NotCatalog /Pages 2 0 R >>" })),
    hasPdfError("invalid-object", /\/Catalog/)
  );
  await assert.rejects(
    openStrict(simpleFixture({ catalog: "<< /Pages 2 0 R >>" })),
    hasPdfError("invalid-object", /\/Catalog/)
  );
  await assert.rejects(
    openStrict(simpleFixture({ catalog: "<< /Type /Catalog /Pages null >>" })),
    hasPdfError("invalid-page-tree", /no \/Pages tree/)
  );
  await assert.rejects(
    openStrict(simpleFixture({ pages: "<< /Type /Page /MediaBox [0 0 10 10] >>" })),
    hasReason("invalid-page-tree", "page-tree-root-type")
  );
  await assert.rejects(
    openStrict(simpleFixture({ pages: "<< /Count 1 /Kids [3 0 R] >>" })),
    hasReason("invalid-page-tree", "page-tree-root-type")
  );
}

async function testPageTreeInheritanceOrderAndLaziness() {
  const fixture = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /Outlines 99 0 R >>" },
      {
        number: 2,
        body: [
          "<< /Type /Pages /Count 98 /Kids [3 0 R 4 0 R]",
          "/MediaBox [100 100 0 0] /CropBox [-10 10 90 110]",
          "/Rotate 450 /UserUnit 2 /Resources 10 0 R >>"
        ].join(" ")
      },
      {
        number: 3,
        body: [
          "<< /Type /Page /Parent 2 0 R /MediaBox null /CropBox null",
          "/Rotate null /UserUnit null /Resources null /BleedBox null",
          "/Kids 13 0 R /Contents 14 0 R /Annots 15 0 R >>"
        ].join(" ")
      },
      {
        number: 4,
        body: [
          "<< /Type /Pages /Parent 2 0 R /Count 99 /Kids [5 0 R 6 0 R]",
          "/MediaBox 11 0 R /CropBox null /Rotate 12 0 R",
          "/UserUnit null /Resources null >>"
        ].join(" ")
      },
      {
        number: 5,
        body: "<< /Type /Page /Parent 4 0 R /MediaBox [50 20 10 0] /CropBox null /UserUnit 3 /Resources null >>"
      },
      {
        number: 6,
        body: "<< /Type /Page /Parent 4 0 R /CropBox [80 80 120 120] >>"
      },
      { number: 10, body: "not-a-cos-value" },
      { number: 11, body: "null" },
      { number: 12, body: "null" },
      { number: 13, body: "not-a-cos-value" },
      { number: 14, body: "not-a-cos-value" },
      { number: 15, body: "not-a-cos-value" }
    ]
  });
  const callbackDiagnostics = [];
  const document = await openNativePdfDocument(
    { kind: "bytes", bytes: fixture },
    { repair: "off", onDiagnostic: (diagnostic) => callbackDiagnostics.push(diagnostic) }
  );
  try {
    assert.equal(document.info.pageCount, 3);
    assert.deepEqual(document.pages.map((page) => page.sourcePageIndex), [0, 1, 2]);
    assert.deepEqual(document.pages.map((page) => page.ref?.objectNumber), [3, 5, 6]);
    assert.deepEqual(document.pages[0].mediaBox, [0, 0, 100, 100]);
    assert.deepEqual(document.pages[0].cropBox, [-10, 10, 90, 110]);
    assert.equal(document.pages[0].rotation, 90);
    assert.deepEqual(
      document.pages.map((page) => page.userUnit),
      [1, 3, 1],
      "/UserUnit is page-local and must not be inherited from a /Pages ancestor"
    );
    assert.deepEqual(document.pages[1].mediaBox, [10, 0, 50, 20]);
    assert.deepEqual(document.pages[1].cropBox, [-10, 10, 90, 110]);
    assert.deepEqual(document.pages[2].mediaBox, [0, 0, 100, 100]);
    assert.deepEqual(document.pages[2].cropBox, [80, 80, 120, 120]);
    assert.equal(document.pages[0].bleedBox, undefined);
    for (const page of document.pages) {
      assert.equal(isPdfRef(page.resources), true);
      assert.equal(page.resources.objectNumber, 10, "direct null resources must inherit lazily");
    }

    const diagnostics = document.getDiagnostics();
    assert.deepEqual(callbackDiagnostics, diagnostics);
    assert.equal(Object.isFrozen(diagnostics), true);
    assert.equal(Object.isFrozen(diagnostics[0]), true);
    assert.equal(Object.isFrozen(diagnostics[0].details), true);
    assert.deepEqual(
      diagnostics.filter((diagnostic) => diagnostic.code === "page.count-mismatch").map((diagnostic) => ({
        objectNumber: diagnostic.objectNumber,
        details: diagnostic.details
      })),
      [
        { objectNumber: 4, details: { declaredCount: 99, actualCount: 2, depth: 1 } },
        { objectNumber: 2, details: { declaredCount: 98, actualCount: 3, depth: 0 } }
      ],
      "mismatch diagnostics must be deterministic post-order records for every /Pages node"
    );
    assert.deepEqual(
      diagnostics.filter((diagnostic) => diagnostic.code === "page.box-clamped").map((diagnostic) => (
        diagnostic.details?.noIntersection
      )),
      [false, false, false],
      "normalized crop/media intersection must be checked on every page"
    );

    await assert.rejects(
      document.resolveValue(document.pages[0].resources),
      hasPdfError("invalid-object")
    );
    await assert.rejects(
      document.resolveValue(document.pages[0].contents),
      hasPdfError("invalid-object")
    );
  } finally {
    await document.close();
  }

  const second = await openStrict(fixture);
  assert.deepEqual(second.getDiagnostics(), callbackDiagnostics, "diagnostics must be repeatable");
  await second.close();
}

async function testPageTreeStructureFailures() {
  await assert.rejects(
    openStrict(simpleFixture({ page: "<< /Type /Page /MediaBox [0 0 10 10] >>" })),
    hasReason("invalid-page-tree", "page-tree-parent-missing")
  );
  await assert.rejects(
    openStrict(simpleFixture({ page: "<< /Type /Page /Parent 1 0 R /MediaBox [0 0 10 10] >>" })),
    hasReason("invalid-page-tree", "page-tree-parent-mismatch")
  );
  await assert.rejects(
    openStrict(simpleFixture({ pages: "<< /Type /Pages /Parent 3 0 R /Count 1 /Kids [3 0 R] >>" })),
    hasReason("invalid-page-tree", "page-tree-root-parent")
  );
  await assert.rejects(
    openStrict(simpleFixture({ pages: "<< /Type /Pages /Count 2 /Kids [3 0 R 3 0 R] >>" })),
    hasPdfError("invalid-page-tree", /cycle or duplicate node/)
  );

  const cycle = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Pages /Parent 2 0 R /Count 1 /Kids [2 0 R] >>" }
    ]
  });
  await assert.rejects(openStrict(cycle), hasPdfError("invalid-page-tree", /cycle or duplicate node/));

  await assert.rejects(
    openStrict(simpleFixture({ page: "<< /Type /NotPage /Parent 2 0 R /MediaBox [0 0 10 10] >>" })),
    hasReason("invalid-page-tree", "page-tree-node-type")
  );
  await assert.rejects(
    openStrict(simpleFixture({ pages: "<< /Type /Pages /Kids [3 0 R] >>" })),
    hasReason("invalid-page-tree", "page-tree-count")
  );
  await assert.rejects(
    openStrict(simpleFixture({ pages: "<< /Type /Pages /Count -1 /Kids [3 0 R] >>" })),
    hasReason("invalid-page-tree", "page-tree-count")
  );
  await assert.rejects(
    openStrict(simpleFixture({ page: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Rotate /Bad >>" })),
    hasReason("invalid-page-tree", "page-rotation")
  );
  await assert.rejects(
    openStrict(simpleFixture({ page: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /UserUnit /Bad >>" })),
    hasPdfError("invalid-page-tree", /UserUnit/)
  );
  await assert.rejects(
    openStrict(simpleFixture({ page: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 0 10] >>" })),
    hasPdfError("invalid-page-tree", /zero area/)
  );
  const huge = `1${"0".repeat(308)}`;
  await assert.rejects(
    openStrict(simpleFixture({ page: `<< /Type /Page /Parent 2 0 R /MediaBox [-${huge}.0 0 ${huge}.0 1] >>` })),
    hasPdfError("invalid-page-tree", /non-finite dimensions/)
  );
}

async function testPageTreeLimitsAndCancellation() {
  const deep = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Pages /Parent 2 0 R /Count 1 /Kids [4 0 R] >>" },
      { number: 4, body: "<< /Type /Pages /Parent 3 0 R /Count 1 /Kids [5 0 R] >>" },
      { number: 5, body: "<< /Type /Page /Parent 4 0 R /MediaBox [0 0 10 10] >>" }
    ]
  });
  await assert.rejects(
    openNativePdfDocument({ kind: "bytes", bytes: deep }, {
      repair: "off",
      limits: { maxRecursionDepth: 2 }
    }),
    hasReason("resource-limit", "page-tree-depth")
  );

  const directPages = Array.from({ length: 5 }, () => (
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1 1] >>"
  )).join(" ");
  const wide = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: `<< /Type /Pages /Count 5 /Kids [${directPages}] >>` }
    ]
  });
  await assert.rejects(
    openNativePdfDocument({ kind: "bytes", bytes: wide }, {
      repair: "off",
      limits: { maxRepairCandidates: 4 }
    }),
    hasReason("resource-limit", "page-tree-kids-count")
  );

  const fourDirectPages = Array.from({ length: 4 }, () => (
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1 1] >>"
  )).join(" ");
  const nodeLimited = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: `<< /Type /Pages /Count 4 /Kids [${fourDirectPages}] >>` }
    ]
  });
  await assert.rejects(
    openNativePdfDocument({ kind: "bytes", bytes: nodeLimited }, {
      repair: "off",
      limits: { maxRepairCandidates: 4 }
    }),
    hasReason("resource-limit", "page-tree-node-count")
  );

  const controller = new AbortController();
  controller.abort(new Error("cancel document metadata"));
  await assert.rejects(
    openNativePdfDocument(
      { kind: "bytes", bytes: simpleFixture() },
      { repair: "off", signal: controller.signal }
    ),
    hasPdfError("aborted")
  );
}

async function testIndirectObjectDepthLimit() {
  const content = bytes("q Q");
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
          content,
          bytes("\nendstream")
        ])
      },
      {
        number: 5,
        body: concatenate([
          bytes("<< /Length 6 0 R >>\nstream\n"),
          bytes("x"),
          bytes("\nendstream")
        ])
      },
      { number: 6, body: "1" }
    ]
  });
  const document = await openNativePdfDocument(
    { kind: "bytes", bytes: fixture },
    { repair: "off", limits: { maxRecursionDepth: 2 } }
  );
  try {
    await assert.rejects(
      document.getPageContentStreams(0),
      hasReason("resource-limit", "indirect-object-depth")
    );
  } finally {
    await document.close();
  }
}

async function testMissingStreamEndEolRepair() {
  const content = bytes("q Q");
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
          bytes(`<< /Length ${content.length} >>\nstream\n`),
          content,
          bytes("endstream")
        ])
      }
    ]
  });

  const strict = await openNativePdfDocument(
    { kind: "bytes", bytes: fixture },
    { repair: "off" }
  );
  try {
    await assert.rejects(
      strict.getDecodedPageContents(0),
      hasReason("invalid-object", "missing-stream-end-eol")
    );
  } finally {
    await strict.close();
  }

  const repaired = await openNativePdfDocument(
    { kind: "bytes", bytes: fixture },
    { repair: "safe" }
  );
  try {
    assert.deepEqual(await repaired.getDecodedPageContents(0), [content]);
    const diagnostics = repaired.getDiagnostics();
    assert.deepEqual(
      diagnostics.map(({ code }) => code),
      ["object.stream-end-eol-repaired"]
    );
    assert.equal(diagnostics[0].objectNumber, 4);
    assert.equal(diagnostics[0].details?.reason, "missing-stream-end-eol");
  } finally {
    await repaired.close();
  }
}

async function testMetadataStringsDatesAndIdentifiers() {
  const fixture = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /Lang (en-US) >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>" },
      {
        number: 4,
        body: [
          "<< /Title <FEFFD83DDE00> /Author <EFBBBF48C3A95052>",
          "/Subject (plain) /CreationDate (D:20240229112233Z)",
          "/ModDate (202612) /Trapped 99 0 R >>"
        ].join(" ")
      }
    ],
    trailerEntries: "/Info 4 0 R /ID [(A) <00FF>]"
  });
  const document = await openStrict(fixture);
  assert.equal(document.info.language, "en-US");
  assert.equal(document.info.fingerprint, "41");
  assert.deepEqual(document.info.metadata, {
    title: "😀",
    author: "HéPR",
    subject: "plain",
    creationDate: "D:20240229112233Z",
    modificationDate: "202612"
  });
  assert.deepEqual(document.getDiagnostics(), []);
  await document.close();

  const malformed = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /Lang /en-US >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>" },
      {
        number: 4,
        body: "<< /Title /NotAString /Author 99 0 R /CreationDate (D:20230229) /ModDate <FEFF00> >>"
      }
    ],
    trailerEntries: "/Info 4 0 R /ID [<01>]"
  });
  const invalid = await openStrict(malformed);
  assert.deepEqual(invalid.info.metadata, {});
  assert.equal(invalid.info.language, undefined);
  assert.equal(invalid.info.fingerprint, undefined);
  assert.deepEqual(
    invalid.getDiagnostics().map((diagnostic) => ({ code: diagnostic.code, reason: diagnostic.details?.reason })),
    [
      { code: "metadata.invalid-language", reason: undefined },
      { code: "metadata.invalid-field", reason: "text-string" },
      { code: "metadata.invalid-field", reason: "date-syntax" },
      { code: "metadata.invalid-field", reason: "text-string" },
      { code: "metadata.invalid-id", reason: undefined }
    ]
  );
  await invalid.close();

  const missingInfo = await openStrict(writeTinyPdf({
    objects: basicPageObjects(),
    trailerEntries: "/Info 99 0 R /ID [99 0 R <02>]"
  }));
  assert.deepEqual(missingInfo.info.metadata, {});
  assert.equal(missingInfo.info.fingerprint, undefined);
  assert.deepEqual(
    missingInfo.getDiagnostics().map((diagnostic) => diagnostic.code),
    ["metadata.invalid-info", "metadata.invalid-id"]
  );
  await missingInfo.close();
}

async function testIncrementalTrailerInheritance() {
  const base = writeTinyPdf({
    version: "1.7",
    objects: [
      { number: 1, body: "<< /Type /Catalog /Version /2.0 /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] /MediaBox [0 0 20 10] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R >>" },
      { number: 4, body: "<< /Title (Inherited revision metadata) >>" }
    ],
    trailerEntries: "/Info 4 0 R /ID [<AABB> <CCDD>]"
  });
  const fixture = appendPageTreeRevision(base);
  const document = await openStrict(fixture);
  try {
    assert.equal(document.info.version, "2.0");
    assert.equal(document.info.pageCount, 2);
    assert.equal(document.info.fingerprint, "aabb");
    assert.equal(document.info.metadata.title, "Inherited revision metadata");
    assert.deepEqual(document.pages.map((page) => page.sourcePageIndex), [0, 1]);
    assert.deepEqual(document.pages.map((page) => page.ref?.objectNumber), [3, 5]);
    assert.deepEqual(document.pages[1].mediaBox, [0, 0, 20, 10]);
  } finally {
    await document.close();
  }
}

async function testLinearizationValidation() {
  const validFixture = linearizationFixture();
  const valid = await openStrict(validFixture);
  assert.equal(valid.info.linearized, true);
  assert.deepEqual(valid.getDiagnostics(), []);
  await valid.close();

  const staleLength = linearizationFixture({ patchLength: false });
  const stale = await openStrict(staleLength);
  assert.equal(stale.info.linearized, false);
  assert.equal(
    stale.getDiagnostics().find((diagnostic) => diagnostic.code === "linearization.invalid")?.details?.reason,
    "linearization-file-length"
  );
  assert.equal(stale.info.pageCount, 1, "ordinary xref/page-tree loading must survive stale hints");
  await stale.close();

  const wrongPage = await openStrict(linearizationFixture({ firstPageObject: 3 }));
  assert.equal(wrongPage.info.linearized, false);
  assert.equal(
    wrongPage.getDiagnostics().find((diagnostic) => diagnostic.code === "linearization.invalid")?.details?.reason,
    "linearization-first-page-object"
  );
  await wrongPage.close();

  const markerNotFirst = await openStrict(writeTinyPdf({
    rootObject: 3,
    objects: [
      { number: 1, body: "<< /Ordinary true >>" },
      { number: 2, body: "<< /Linearized 1 /L 1 /H [0 0] /O 5 /E 1 /N 1 /T 1 >>" },
      { number: 3, body: "<< /Type /Catalog /Pages 4 0 R >>" },
      { number: 4, body: "<< /Type /Pages /Count 1 /Kids [5 0 R] >>" },
      { number: 5, body: "<< /Type /Page /Parent 4 0 R /MediaBox [0 0 10 10] >>" }
    ]
  }));
  assert.equal(markerNotFirst.info.linearized, false);
  assert.deepEqual(markerNotFirst.getDiagnostics(), []);
  await markerNotFirst.close();
}

function simpleFixture({
  version = "1.7",
  catalog = "<< /Type /Catalog /Pages 2 0 R >>",
  pages = "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
  page = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>"
} = {}) {
  return writeTinyPdf({
    version,
    objects: [
      { number: 1, body: catalog },
      { number: 2, body: pages },
      { number: 3, body: page }
    ]
  });
}

function basicPageObjects() {
  return [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>" }
  ];
}

function appendPageTreeRevision(base) {
  const text = new TextDecoder("latin1").decode(base);
  const marker = text.lastIndexOf("startxref\n");
  assert.notEqual(marker, -1);
  const previousXref = Number(text.slice(marker + "startxref\n".length).split(/\s/, 1)[0]);
  assert.equal(Number.isSafeInteger(previousXref), true);
  const chunks = [base];
  let length = base.length;
  const secondPagesOffset = length;
  const secondPages = bytes(
    "2 0 obj\n<< /Type /Pages /Count 2 /Kids [3 0 R 5 0 R] /MediaBox [0 0 20 10] >>\nendobj\n"
  );
  chunks.push(secondPages);
  length += secondPages.length;
  const secondPageOffset = length;
  const secondPage = bytes("5 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n");
  chunks.push(secondPage);
  length += secondPage.length;
  const xrefOffset = length;
  const update = bytes([
    "xref",
    "2 1",
    `${String(secondPagesOffset).padStart(10, "0")} 00000 n `,
    "5 1",
    `${String(secondPageOffset).padStart(10, "0")} 00000 n `,
    `trailer\n<< /Size 6 /Prev ${previousXref} /Root null /Info null /ID null >>`,
    `startxref\n${xrefOffset}`,
    "%%EOF",
    ""
  ].join("\n"));
  chunks.push(update);
  return concatenate(chunks);
}

function linearizationFixture({ firstPageObject = 4, patchLength = true } = {}) {
  const fixture = writeTinyPdf({
    rootObject: 2,
    objects: [
      {
        number: 1,
        body: `<< /Linearized 1 /L 0000000000 /H [0 0] /O ${firstPageObject} /E 0000000000 /N 1 /T 1 >>`
      },
      { number: 2, body: "<< /Type /Catalog /Pages 3 0 R >>" },
      { number: 3, body: "<< /Type /Pages /Count 1 /Kids [4 0 R] >>" },
      { number: 4, body: "<< /Type /Page /Parent 3 0 R /MediaBox [0 0 10 10] >>" }
    ]
  });
  if (patchLength) patchFixedWidthDecimal(fixture, "/L ", fixture.length);
  patchFixedWidthDecimal(fixture, "/E ", fixture.length);
  return fixture;
}

function patchFixedWidthDecimal(target, marker, value, width = 10) {
  const text = new TextDecoder("latin1").decode(target);
  const markerOffset = text.indexOf(marker);
  assert.notEqual(markerOffset, -1, `missing ${marker} placeholder`);
  const digits = String(value).padStart(width, "0");
  assert.equal(digits.length, width, `${marker} value exceeds its placeholder`);
  target.set(bytes(digits), markerOffset + marker.length);
}

function bytes(value) {
  return typeof value === "string" ? encoder.encode(value) : value;
}

function concatenate(parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

async function openStrict(value) {
  return await openNativePdfDocument({ kind: "bytes", bytes: value }, { repair: "off" });
}

function hasPdfError(code, message) {
  return (error) => error instanceof PdfError && error.code === code &&
    (message === undefined || message.test(error.message));
}

function hasReason(code, reason) {
  return (error) => error instanceof PdfError && error.code === code && error.details?.reason === reason;
}
