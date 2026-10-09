import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });

try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { selectivePathPaintReason } = await import("../src/pdf/nativeContentCompiler.ts");
  const { ScenePrimitivePicker } = await import("../src/scenePrimitives.ts");

  // A bounded raster layer costs a paint its resolution independence, so the
  // warning names the feature responsible rather than only reporting a count.
  assert.equal(selectivePathPaintReason(false, true, false, "shading", undefined), "shading-pattern-fill");
  assert.equal(selectivePathPaintReason(false, true, false, "colored-tiling", undefined), "tiling-pattern-fill");
  assert.equal(selectivePathPaintReason(false, false, true, undefined, "shading"), "shading-pattern-stroke");
  assert.equal(selectivePathPaintReason(false, false, true, undefined, "uncolored-tiling"), "tiling-pattern-stroke");
  assert.equal(selectivePathPaintReason(true, false, false, undefined, undefined), "large-disconnected-fill");
  assert.equal(selectivePathPaintReason(false, false, false, undefined, undefined), "clipped-path");
  // A paint is fill-first when both apply: the fill is what covers the area.
  assert.equal(selectivePathPaintReason(true, true, true, "shading", "shading"), "shading-pattern-fill");

  const fixture = (paint) => writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: [
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R",
      "/Resources << /ColorSpace << /CS1 [/Pattern] >>",
      "/Pattern << /PS 5 0 R /PT 7 0 R >> >> >>"
    ].join(" ") },
    { number: 4, body: tinyPdfStream("", paint) },
    { number: 5, body: "<< /Type /Pattern /PatternType 2 /Shading 6 0 R >>" },
    { number: 6, body: [
      "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [10 10 90 90]",
      "/Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>",
      "/Extend [true true] >>"
    ].join(" ") },
    { number: 7, body: tinyPdfStream(
      "/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 4 4] /XStep 4 /YStep 4",
      "1 0 0 rg 0 0 2 2 re f") }
  ] });

  const compile = async (paint, options = {}) => {
    const diagnostics = [];
    const session = await openPdf({ kind: "bytes", bytes: fixture(paint), label: "selective" },
      { onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
    try {
      const scene = await session.compileVectorPage(0, options);
      return { scene, fallback: diagnostics.find(d => d.code === "selective-raster-fallback") };
    } finally { await session.close(); }
  };

  // Pattern paints keep their vectors: a shading pattern lowers to a gradient
  // paint, and a tiling pattern to the cells it repeats. Nothing here should
  // reach a raster layer, whichever of fill or stroke applies it.
  for (const [label, paint, expect] of [
    ["shading stroke", "/CS1 CS /PS SCN 3 w 20 20 m 80 80 l S", "gradient"],
    ["dashed shading stroke", "/CS1 CS /PS SCN 3 w [4 3] 0 d 20 20 m 80 80 l S", "gradient"],
    ["shading fill", "/CS1 cs /PS scn 20 20 60 60 re f", "gradient"],
    ["tiling fill", "/CS1 cs /PT scn 20 20 60 60 re f", "fills"],
    ["tiling stroke", "/CS1 CS /PT SCN 3 w 20 20 m 80 80 l S", "fills"],
    ["plain fill", "1 0 0 rg 20 20 60 60 re f", "fills"]
  ]) {
    const { scene, fallback } = await compile(paint);
    assert.equal(fallback, undefined, `${label} must not fall back to a raster layer`);
    assert.equal(scene.rasterLayers.length, 0, `${label} produces no raster layer`);
    const produced = expect === "gradient" ? scene.gradientFillPathCount : scene.fillPathCount;
    assert(produced > 0, `${label} produces vector ${expect}`);
  }

  // The input path exceeds the former geometry cutoff, with an even-odd
  // hole and a dashed companion stroke inside an independently live clip.
  // Repeated points keep this regression small to rasterize while still
  // requiring the complete original path to reach the display program.
  const largePath = `10 10 m\n${"10 10 l\n".repeat(22_000)}` +
    "90 10 l 90 90 l 10 90 l h 30 30 40 40 re";
  const largePaint = `0 0 5 5 re f q 20 20 60 60 re W n [4 4] 0 d 4 w ${largePath} B* Q 95 95 5 5 re f`;
  const { scene: retainedLargeScene, fallback: retainedLargeFallback } = await compile(largePaint);
  assert.equal(retainedLargeScene.rasterLayers.length, 0,
    "source-ordered retained lowering keeps a representable oversized path vector");
  assert.equal(retainedLargeFallback, undefined);
  const { scene: largeScene, fallback: largeFallback } = await compile(
    largePaint,
    { preserveDrawingOrder: false, retainOptionalContent: false }
  );
  assert.equal(largeScene.fillPathCount, 3, "all compound and surrounding fills remain vector");
  assert.equal(largeScene.rasterLayers.length, 0, "legacy ordering also attempts the complete vector geometry");
  assert.equal(largeFallback, undefined);
  const picker = new ScenePrimitivePicker(largeScene);
  const visibleAt = async (x, y) => Boolean(await picker.pick({
    point: { x, y }, clientPoint: { x, y }, project: p => p, unproject: p => p, tolerancePx: 0
  }));
  assert(await visibleAt(25, 25), "the visible outer fill survives vector lowering");
  assert.equal(await visibleAt(50, 50), false, "even-odd winding preserves the inner hole");
  assert.equal(await visibleAt(15, 25), false, "the source clip excludes paint outside its bounds");
  assert(await visibleAt(32, 31), "an on-dash stroke remains visible inside the hole");
  assert.equal(await visibleAt(36, 31), false, "the off-dash stroke gap stays transparent");

  console.log("Selective raster reasons: patterns and large compound paths preserve vector winding, clips, and dashes.");
} finally { hooks.deregister(); }
