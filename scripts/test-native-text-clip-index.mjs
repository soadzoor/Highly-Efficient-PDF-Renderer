import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });

try {
  const { NativeTextClipTester } = await import("../src/pdf/nativeTextClip.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { createSceneTextSearcher } = await import("../src/textSearch.ts");
  const { buildParsedDataZip } = await import("../src/hepBuilder.ts");
  const { loadSceneFromParsedDataZip } = await import("../src/hep.ts");
  const tester = new NativeTextClipTester();
  const lShape = clip([0, 0, 0, 1, 100, 0, 1, 100, 100, 1, 50, 100, 1, 50, 50, 1, 0, 50, 4]);
  assert(tester.isFullyOutside(box(10, 70, 20, 80), lShape));
  assert(!tester.isFullyOutside(box(60, 70, 70, 80), lShape));
  assert(!tester.isFullyOutside(box(45, 70, 55, 80), lShape), "partial glyphs stay indexed");
  assert(!tester.isFullyOutside(box(40, 70, 50, 80), lShape), "boundary contact is not proof of invisibility");
  const hole = clip([...rect(0, 0, 100, 100), ...rect(10, 70, 20, 20)], 1);
  assert(tester.isFullyOutside(box(15, 75, 25, 85), hole));
  assert(!tester.isFullyOutside(box(5, 65, 35, 95), hole), "a box enclosing a hole also contains painted area");
  const island = clip([...hole.path.data, ...rect(17, 77, 6, 6)], 1);
  assert(!tester.isFullyOutside(box(18, 78, 22, 82), island), "even-odd islands are visible");
  const nonzero = clip(hole.path.data);
  assert(!tester.isFullyOutside(box(15, 75, 25, 85), nonzero), "same-winding nested paths are not holes");
  const reversedHole = clip([...rect(0, 0, 100, 100), ...rect(30, 70, -20, 20)]);
  assert(tester.isFullyOutside(box(15, 75, 25, 85), reversedHole));
  const nested = { ...clip(rect(0, 0, 95, 100)), parent: lShape };
  assert(tester.isFullyOutside(box(10, 70, 20, 80), nested), "all parent clips apply");
  const reflected = clip(lShape.path.data, 0, [-1, 0, 0, 1, 200, 10]);
  assert(tester.isFullyOutside(box(180, 80, 190, 90), reflected));
  // Whole-path curved membership is unknown to this conservative polygon proof.
  const curve = clip([0, 0, 0, 2, 0, 100, 100, 100, 100, 0, 4]);
  assert(!tester.isFullyOutside(box(10, 70, 20, 80), curve));
  assert(tester.isFullyOutside(box(10, 70, 20, 80), { ...curve, parent: lShape }));
  assert.throws(() => tester.isFullyOutside(box(10, 70, 20, 80), lShape, AbortSignal.abort()),
    error => error.code === "aborted");
  // Deterministic property check: every tiny box strictly inside/outside this
  // axis-aligned L shape has the analytic classification (except its edges).
  for (let y = 1; y < 100; y += 3) for (let x = 1; x < 100; x += 3) {
    if (x <= 50 && x + 0.5 >= 50 || y <= 50 && y + 0.5 >= 50) continue;
    assert.equal(tester.isFullyOutside(box(x, y, x + 0.5, y + 0.5), lShape), x < 50 && y > 50);
  }

  for (const rule of ["concave", "hole"]) {
    const session = await openPdf({ kind: "bytes", bytes: fixture(rule) }, {
      missingFontResolver: () => ({ sfntBytes: buildTinySfnt(), identifier: "clip-index-fixture-v1" })
    });
    try {
      const scene = await session.compileVectorPage(0);
      checkIndex(scene);
      // Only a tiny synthetic in-memory archive, never corpus HEP regeneration.
      const hep = await buildParsedDataZip(scene, { encodeRasterImages: false, compression: "store" });
      checkIndex(await loadSceneFromParsedDataZip(await hep.arrayBuffer()));
      assert.deepEqual((await session.compileVectorPage(0)).textIndex, scene.textIndex, "clip data is immutable across compiles");
    } finally {
      await session.close();
    }
  }
  console.log("native polygon clip, hidden-label index, OCR and HEP regressions passed");

  function checkIndex(scene) {
    const searcher = createSceneTextSearcher(scene);
    assert.equal(searcher.search("A").length, 2, "hidden A is gone; inside-clip and Q-restored A survive");
    assert.equal(searcher.search("B").length, 3, "partially clipped B, mode-3 OCR and zero-alpha OCR all survive");
    assert.equal(scene.textInstanceCount, 1, "only Q-restored A is a vector instance");
    const page = scene.textIndex.pages[0];
    assert(searcher.search("B").every(match => page.charInstance[match.startChar] <= -2));
    assert(scene.rasterLayers.length > 0, "visible clipped glyphs still paint in image layers");
  }
} finally {
  hooks.deregister();
}

function box(minX, minY, maxX, maxY) { return { minX, minY, maxX, maxY }; }
function rect(x, y, w, h) { return [0, x, y, 1, x + w, y, 1, x + w, y + h, 1, x, y + h, 4]; }
function clip(data, fillRule = 0, transform = [1, 0, 0, 1, 0, 0]) {
  return { parent: null, path: { data: Float32Array.from(data), transform, bounds: box(0, 0, 100, 100) }, fillRule };
}
function fixture(rule) {
  const shape = rule === "concave"
    ? "0 0 m 100 0 l 100 100 l 50 100 l 50 50 l 0 50 l h W n"
    : "0 0 100 100 re 10 70 20 20 re W* n";
  const hiddenX = rule === "concave" ? 10 : 15;
  const hiddenY = rule === "concave" ? 70 : 75;
  const partialX = rule === "concave" ? 40 : 22;
  const content = `q ${shape} 0 0 95 100 re W n ` +
    `BT /F 100 Tf 1 0 0 1 ${hiddenX} ${hiddenY} Tm (A) Tj ET ` +
    "BT /F 100 Tf 1 0 0 1 70 70 Tm (A) Tj ET " +
    `BT /F 100 Tf 1 0 0 1 ${partialX} 75 Tm (B) Tj ET ` +
    `BT /F 100 Tf 3 Tr 1 0 0 1 ${hiddenX} ${hiddenY} Tm (B) Tj ET ` +
    `q /Invisible gs BT /F 100 Tf 0 Tr 1 0 0 1 ${hiddenX} ${hiddenY} Tm (B) Tj ET Q Q ` +
    "BT /F 100 Tf 1 0 0 1 10 90 Tm (A) Tj ET";
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F 5 0 R >> /ExtGState << /Invisible 6 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", content) },
    { number: 5, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Fixture /Encoding /WinAnsiEncoding >>" },
    { number: 6, body: "<< /Type /ExtGState /ca 0 >>" }
  ] });
}
