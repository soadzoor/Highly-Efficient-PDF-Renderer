import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { comparePngBytes } from "./lib/png-diff.mjs";
import { createEngine as createHeprEngine } from "./adapters/hepr.mjs";
import { createEngine as createPdfjsEngine } from "./adapters/pdfjs.mjs";
import { tinyPdfStream, writeTinyPdf } from "../../scripts/lib/tinyPdfWriter.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const bytes = oracleFixture();
const source = {
  bytes,
  label: "hepr-oracle-microfixture.pdf",
  sourcePath: null
};

const [pdfjsEngine, heprEngine] = await Promise.all([
  createPdfjsEngine({ repositoryRoot }),
  createHeprEngine({ repositoryRoot })
]);
const pdfjsDocument = await pdfjsEngine.openDocument(source);
const heprDocument = await heprEngine.openDocument(source);

try {
  assert.equal(heprDocument.pageCount, 1);
  assert.equal(heprDocument.pageCount, pdfjsDocument.pageCount);
  assert.deepEqual(
    await heprDocument.getDocumentMetadata(),
    await pdfjsDocument.getDocumentMetadata(),
    "the common document metadata boundary must stay exact"
  );

  const pdfjsPage = await pdfjsDocument.getPage(0);
  const heprPage = await heprDocument.getPage(0);
  try {
    assert.deepEqual(
      await heprPage.getMetadata(),
      await pdfjsPage.getMetadata(),
      "the common zero-based page metadata boundary must stay exact"
    );
    assert.equal(
      await heprPage.getNormalizedText(),
      await pdfjsPage.getNormalizedText(),
      "normalized text remains an exact differential gate"
    );

    const semantic = await heprPage.getSemanticSummary();
    assert.equal(semantic.schema, "hepr-display-program-v7");
    assert.ok(semantic.commandCount >= 2);
    assert.equal(
      Object.values(semantic.histogram).reduce((total, count) => total + count, 0),
      semantic.commandCount
    );
    assert.deepEqual(
      await heprPage.getSemanticSummary(),
      semantic,
      "HEPR semantic summaries must be deterministic"
    );

    for (const scale of [1, 2]) {
      const [expected, actual] = await Promise.all([
        pdfjsPage.renderPng(scale, { maxRenderPixels: 1_000_000 }),
        heprPage.renderPng(scale, { maxRenderPixels: 1_000_000 })
      ]);
      assert.deepEqual(
        [actual.width, actual.height],
        [expected.width, expected.height]
      );
      const visual = await comparePngBytes(expected.bytes, actual.bytes);
      assert.equal(visual.dimensionsMatch, true);
      assert.ok(visual.ssim >= 0.995, `expected ${scale}x SSIM >= 0.995, got ${visual.ssim}`);
      assert.ok(
        visual.nonEdgeWithinToleranceFraction >= 0.995,
        `expected ${scale}x non-edge pass >= 0.995, got ${visual.nonEdgeWithinToleranceFraction}`
      );
    }
  } finally {
    await Promise.all([pdfjsPage.close(), heprPage.close()]);
  }
} finally {
  await Promise.all([pdfjsDocument.close(), heprDocument.close()]);
}

console.log("Dependency-free HEPR differential candidate adapter tests passed.");

function oracleFixture() {
  const firstId = "00112233445566778899aabbccddeeff";
  const content = [
    "0.12 0.35 0.8 rg 8 7 42 24 re f",
    "0.95 0.6 0.1 rg 52 18 20 30 re f",
    "BT /F 9 Tf 3 Tr 1 0 0 1 8 50 Tm (HEPR oracle) Tj ET"
  ].join("\n");
  return writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 80 60] " +
          "/Resources << /Font << /F 5 0 R >> >> /Contents 4 0 R >>"
      },
      { number: 4, body: tinyPdfStream("", `${content}\n`) },
      {
        number: 5,
        body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica " +
          "/Encoding /WinAnsiEncoding >>"
      },
      {
        number: 6,
        body: "<< /Title (HEPR oracle microfixture) /Creator (HEPR tiny writer) >>"
      }
    ],
    trailerEntries: `/ID [<${firstId}> <${firstId}>] /Info 6 0 R`
  });
}
