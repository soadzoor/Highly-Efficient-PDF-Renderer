import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { HepArchive } from "../src/hepContainer.ts";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });

try {
  const { getSceneSegmentAccounting, formatSceneSegmentAccounting, describeSceneOperatorCount } =
    await import("../src/sceneStatistics.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");

  const brochure = { sourceSegmentCount: 11257, mergedSegmentCount: 10028, segmentCount: 8834,
    discardedTransparentCount: 0, discardedDegenerateCount: 0, discardedDuplicateCount: 10,
    discardedContainedCount: 24, imageLayerSegmentCount: 1160,
    operatorCount: 33099, operatorCountKind: "native-estimate" };
  assert.deepEqual(getSceneSegmentAccounting(brochure), { mergedAway: 1229, culled: 34, imageLayers: 1160 });
  assert.match(formatSceneSegmentAccounting(brochure), /culled 34;/);
  assert.match(describeSceneOperatorCount(brochure), /native estimate; engine-specific/);
  for (const imageLayerSegmentCount of [undefined, -1, 1.5, NaN, 1194]) {
    const unknown = { ...brochure, imageLayerSegmentCount };
    assert.equal(getSceneSegmentAccounting(unknown).culled, null);
    assert.match(formatSceneSegmentAccounting(unknown), /unavailable/);
  }
  assert.match(describeSceneOperatorCount({ operatorCount: 20647 }), /legacy \/ unspecified/);

  const session = await openPdf({ kind: "bytes", bytes: strokeFixture() });
  try {
    for (const optimization of ["default", "none"]) {
      const scene = await session.compileVectorPage(0, optimization === "none" ? { optimization } : {});
      const counts = getSceneSegmentAccounting(scene);
      assert(counts.culled !== null, "native counts must reconcile");
      assert(counts.imageLayers > 0, "fixture transfers strokes into a late-image span");
      assert.equal(scene.sourceSegmentCount,
        counts.mergedAway + counts.culled + counts.imageLayers + scene.segmentCount);
      if (optimization === "none") {
        assert.equal(counts.culled, 0);
        assert.equal(counts.mergedAway, 0);
      } else {
        assert(counts.mergedAway > 0, "fixture must exercise merging as well as transfers");
        assert(counts.culled > 0, "fixture must exercise genuine culling as well as transfers");
      }
      const grid = composeVectorScenesInGrid([scene, scene], 2);
      assert.deepEqual(getSceneSegmentAccounting(grid), {
        mergedAway: counts.mergedAway * 2, culled: counts.culled * 2, imageLayers: counts.imageLayers * 2
      });
      assert.equal(grid.operatorCountKind, "native-estimate");
      const unknownGrid = composeVectorScenesInGrid([scene, { ...scene,
        imageLayerSegmentCount: undefined, operatorCountKind: undefined }], 2);
      assert.equal(getSceneSegmentAccounting(unknownGrid).culled, null);
      assert.equal(unknownGrid.operatorCountKind, "mixed");

      // Tiny synthetic archive only; no tracked PDF / HEP regeneration.
      const hep = await buildHep(grid, { encodeRasterImages: false, compression: "store" });
      const bytes = await hep.arrayBuffer();
      const restored = await loadSceneFromHep(bytes);
      assert.deepEqual(getSceneSegmentAccounting(restored), getSceneSegmentAccounting(grid));
      assert.equal(restored.operatorCountKind, "native-estimate");
      for (const key of ["discardedTransparentCount", "discardedDegenerateCount",
        "discardedDuplicateCount", "discardedContainedCount"]) assert.equal(restored[key], grid[key]);

      const archive = await HepArchive.loadAsync(bytes);
      const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
      assert.equal(manifest.formatVersion, 6, "additive metadata must not change the HEP format");
      delete manifest.scene.imageLayerSegmentCount;
      delete manifest.scene.operatorCountKind;
      for (const key of ["discardedTransparentCount", "discardedDegenerateCount",
        "discardedDuplicateCount", "discardedContainedCount"]) delete manifest.scene[key];
      archive.file("manifest.json", JSON.stringify(manifest));
      const old = await loadSceneFromHep(await archive.generateAsync({ type: "arraybuffer" }));
      assert.equal(old.segmentCount, grid.segmentCount);
      assert.equal(old.imageLayerSegmentCount, undefined);
      assert.equal(getSceneSegmentAccounting(old).culled, null, "older v6 files cannot fabricate cull counts");
      assert.match(describeSceneOperatorCount(old), /legacy \/ unspecified/);
      // An image-transfer field without all cull metadata is still incomplete.
      manifest.scene.imageLayerSegmentCount = 0;
      archive.file("manifest.json", JSON.stringify(manifest));
      const incomplete = await loadSceneFromHep(await archive.generateAsync({ type: "arraybuffer" }));
      assert.equal(incomplete.imageLayerSegmentCount, undefined);
    }
  } finally {
    await session.close();
  }
  console.log("scene statistics, native transfers, grid aggregation and v6 metadata tests passed");
} finally {
  hooks.deregister();
}

function strokeFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "1 w 10 10 m 15 10 l 20 10 l S " +
      "10 15 m 20 15 l S 10 15 m 20 15 l S q 20 0 0 20 10 10 cm /Im Do Q 50 50 m 70 50 l S") },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8", Uint8Array.of(0, 255, 0)) }
  ] });
}
