import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

import { writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const GEOMETRY_CASES = Object.freeze([
  {
    mediaBox: [10, 20, 210, 120],
    cropBox: [30, 10, 200, 90],
    rotation: 0,
    userUnit: 2
  },
  {
    mediaBox: [10, 20, 210, 120],
    cropBox: [30, 10, 200, 90],
    rotation: 90,
    userUnit: 2
  },
  {
    mediaBox: [10, 20, 210, 120],
    cropBox: [30, 10, 200, 90],
    rotation: 180,
    userUnit: 2
  },
  {
    mediaBox: [10, 20, 210, 120],
    cropBox: [30, 10, 200, 90],
    rotation: 270,
    userUnit: 2
  },
  {
    mediaBox: [-50, 25, 150, 225],
    cropBox: [300, 300, 320, 320],
    rotation: 0,
    userUnit: 1.25
  },
  {
    mediaBox: [-100, -50, 100, 150],
    cropBox: [-75, -20, 25, 80],
    rotation: 450,
    userUnit: 3
  }
]);

// Frozen from PDF.js 6.1.200's public `page.view` and `getViewport()` output.
// Keeping exact matrices/bounds here preserves the differential contract while
// allowing this production-facing test to run with no PDF.js installation.
const PDFJS_GEOMETRY_GOLDENS = Object.freeze([
  { pageMatrix: [2, 0, 0, 2, -60, -40], pageBounds: [0, 0, 340, 140] },
  { pageMatrix: [0, -2, 2, 0, -40, 400], pageBounds: [0, 0, 140, 340] },
  { pageMatrix: [-2, 0, 0, -2, 400, 180], pageBounds: [0, 0, 340, 140] },
  { pageMatrix: [0, 2, -2, 0, 180, -60], pageBounds: [0, 0, 140, 340] },
  { pageMatrix: [1.25, 0, 0, 1.25, 62.5, -31.25], pageBounds: [0, 0, 250, 250] },
  { pageMatrix: [0, -3, 3, 0, 60, 75], pageBounds: [0, 0, 300, 300] }
]);

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "pdf-lib" ||
      specifier === "pdfjs-dist" ||
      specifier.startsWith("pdfjs-dist/")
    ) {
      throw new Error(`Room-overlay matrix test imported forbidden dependency ${specifier}.`);
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
  const { computePageGeometry, openPdf } = await import("../src/pdfSession.ts");
  const fixture = createGeometryFixture();
  const nativeSession = await openPdf({
    kind: "bytes",
    bytes: fixture,
    ownership: "copy",
    label: "room-overlay-page-matrix.pdf"
  });

  try {
    assert.equal(nativeSession.info.pageCount, GEOMETRY_CASES.length);
    assert.equal(PDFJS_GEOMETRY_GOLDENS.length, GEOMETRY_CASES.length);

    for (let pageIndex = 0; pageIndex < GEOMETRY_CASES.length; pageIndex += 1) {
      const nativeGeometry = computePageGeometry(nativeSession.info.pages[pageIndex]);
      const expected = PDFJS_GEOMETRY_GOLDENS[pageIndex];

      assertNumbersClose(
        nativeGeometry.pageMatrix,
        expected.pageMatrix,
        `page ${pageIndex + 1} matrix`
      );
      assertNumbersClose(
        [
          nativeGeometry.pageBounds.minX,
          nativeGeometry.pageBounds.minY,
          nativeGeometry.pageBounds.maxX,
          nativeGeometry.pageBounds.maxY
        ],
        expected.pageBounds,
        `page ${pageIndex + 1} bounds`
      );
    }
  } finally {
    await nativeSession.close();
  }

  const demoSource = await readFile(
    new URL("../src/room-overlay-demo.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(demoSource, /pdfjs-dist/);
  assert.doesNotMatch(demoSource, /\bgetDocument\b|\bGlobalWorkerOptions\b|\bbuildPageMatrix\b/);
  assert.match(
    demoSource,
    /const \{ computePageGeometry, openPdf \} = await import\("\.\/pdfSession"\)/
  );
  assert.match(demoSource, /computePageGeometry\(firstPage\)/);

  console.log("Room-overlay native first-page matrix matches frozen PDF.js goldens.");
} finally {
  hooks.deregister();
}

function createGeometryFixture() {
  const pageObjectNumbers = GEOMETRY_CASES.map((_value, index) => index + 3);
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      {
        number: 2,
        body: `<< /Type /Pages /Count ${pageObjectNumbers.length} /Kids [` +
          `${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] >>`
      },
      ...GEOMETRY_CASES.map((geometry, index) => ({
        number: pageObjectNumbers[index],
        body: [
          "<< /Type /Page /Parent 2 0 R",
          `/MediaBox [${geometry.mediaBox.join(" ")}]`,
          `/CropBox [${geometry.cropBox.join(" ")}]`,
          `/Rotate ${geometry.rotation}`,
          `/UserUnit ${geometry.userUnit}`,
          "/Resources << >> >>"
        ].join(" ")
      }))
    ]
  });
}

function assertNumbersClose(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label} length`);
  for (let index = 0; index < actual.length; index += 1) {
    const tolerance = 1e-8 * Math.max(1, Math.abs(expected[index]));
    assert.ok(
      Math.abs(actual[index] - expected[index]) <= tolerance,
      `${label}[${index}]: expected ${expected[index]}, received ${actual[index]}`
    );
  }
}
