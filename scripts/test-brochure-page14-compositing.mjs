import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { compositeScenePaintGraph } = await import("../src/scenePaintCompositor.ts");
  const { PDF_BLEND_MODES, validateScenePaintGraph } = await import("../src/scenePaintGraph.ts");
  const bytes = new Uint8Array(await readFile(new URL(
    "../public/examples/pdfs/20260415+Broschuere_Leo_B2C_RZ+(online+reduz).pdf", import.meta.url)));
  const session = await openPdf({ kind: "bytes", bytes });
  try {
    // Compile this one source page in memory. Its three central ovals must stay
    // vector paints, including the two nested inside translucent outer groups.
    const scene = await session.compileVectorPage(13, { preserveDrawingOrder: true });
    validateScenePaintGraph(scene);
    assert.equal(scene.rasterLayers.length, 1, "only the photograph requires an image layer");
    assert.equal(scene.paintGraph.roots.length, 1);
    const page = scene.paintGraph.roots[0];
    assert.equal(page.kind, "group");
    const ovals = page.children.filter(node => node.kind === "group");
    assert.equal(ovals.length, 6, "retain the three top ovals and three lower overlays");
    assert.equal(ovals[0].alpha, 1);
    assert.equal(ovals[0].softMask.subtype, "Luminosity");
    for (const [index, opacity, blendMode] of [
      [1, 0.699997, "HardLight"], [2, 0.899994, "Normal"],
      [3, 0.699997, "Normal"], [4, 0.699997, "HardLight"], [5, 0.600006, "Normal"]
    ]) {
      const outer = ovals[index];
      assert.equal(outer.alpha, opacity);
      assert.equal(outer.blendMode, blendMode);
      assert.equal(outer.softMask, undefined, "the outer opacity group has no soft mask of its own");
      assert.equal(outer.children.length, 1);
      const inner = outer.children[0];
      assert.equal(inner.kind, "group");
      assert.equal(inner.softMask.subtype, "Luminosity");
      assert.equal(inner.children.length, 1);
      assert.equal(inner.children[0].kind, "draw");
      assert.ok(["fill", "gradient-fill"].includes(scene.drawRuns[inner.children[0].runIndex].kind));
    }

    // The source graph reaches both GPU paths: shader source-over, and a
    // destination that performs source-over blending itself. The shared shader
    // regression in test-pdf-compositing checks that these absent masks sample
    // the opaque 1x1 sentinel at every destination pixel, not just (0, 0).
    for (const blendsPasses of [false, true]) {
      const operations = [];
      const live = new Set();
      const adapter = {
        blendsPasses,
        acquire() { const surface = {}; live.add(surface); return surface; },
        release(surface) { assert(live.delete(surface)); },
        clear() {}, copy() {}, draw() {},
        pass(operation) { operations.push(operation); }
      };
      const result = compositeScenePaintGraph(scene, adapter, {}, () => true, null);
      adapter.release(result);
      assert.equal(live.size, 0);
      assert.equal(operations.filter(op => op.operation === 4).length, 6,
        "all six luminosity masks reach the compositor");
      const outerPasses = operations.filter(op => op.opacity < 1 && !op.mask);
      assert.equal(outerPasses.length, 5, "all translucent outer groups require the opaque fallback mask");
      assert.deepEqual(outerPasses.map(op => [op.opacity, op.blendMode ?? 0]), [
        [0.699997, PDF_BLEND_MODES.indexOf("HardLight")], [0.899994, 0],
        [0.699997, 0], [0.699997, PDF_BLEND_MODES.indexOf("HardLight")], [0.600006, 0]
      ]);
      assert.ok(outerPasses.every(op => op.isolated && (op.operation === 0 || op.operation === 6)));
      assert.ok(outerPasses.every(op => op.bounds.minX > 300 && op.bounds.minY > 100),
        "the oval passes read fallback masks far away from their only stored texel");
    }
    console.log("Brochure page 14: all six oval paints, nested luminosity masks and outer opacity passes retained.");
  } finally {
    await session.close();
  }
} finally {
  hooks.deregister();
}
