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
  const { openPdf } = await import("../src/pdfSession.ts");
  const { convertDeviceCmykToSrgb } = await import("../src/pdf/deviceCmyk.ts");
  const cmykBlack = [...convertDeviceCmykToSrgb(0, 0, 0, 1)].map(Math.fround);
  const options = {
    missingFontResolver: () => ({ sfntBytes: buildTinySfnt(), identifier: "solid-pattern-text" })
  };

  for (const [label, settings, expectedColor] of [
    ["full black tile with overprint", {}, cmykBlack],
    ["full red tile", { cell: "1 0 0 rg 0 0 10 12 re f" }, [1, 0, 0]],
    ["colored tile after caller None", {
      callerNone: true, cell: "1 0 0 rg 0 0 10 12 re f"
    }, [1, 0, 0]],
    ["direct colored Pattern after caller None", {
      callerNone: true, directPattern: true, cell: "1 0 0 rg 0 0 10 12 re f"
    }, [1, 0, 0]],
    ["transformed pattern lattice", { matrix: "0.5 1 -2 0.25 37 -11" }, cmykBlack],
    ["caller transparency", { outerAlpha: 0.5 }, cmykBlack],
    ["direct Pattern color space", { directPattern: true }, cmykBlack],
    ["negative lattice steps", { xStep: -10, yStep: -12 }, cmykBlack],
    ["cell graphics-state restoration", {
      cell: "1 0 0 rg q 0 0 1 rg Q 0 0 10 12 re f"
    }, [1, 0, 0]]
  ]) {
    const session = await openPdf({ kind: "bytes", bytes: fixture(settings), label }, options);
    try {
      const scene = await session.compileVectorPage(0, {
        optimization: "none", preserveDrawingOrder: true, vectorFallback: "error"
      });
      assert.equal(scene.rasterLayers.length, 0, `${label}: a constant pattern stays vector`);
      assert.equal(scene.textInstanceCount, 3);
      assert.equal(scene.textIndex.pages[0].text.replaceAll(/\s/g, ""), "AAB",
        "pattern text retains search geometry and repeated scn selections work");
      for (let glyph = 0; glyph < 2; glyph += 1) {
        assert.deepEqual([...scene.textInstanceC.slice(glyph * 4, glyph * 4 + 4)],
          [...expectedColor, settings.outerAlpha ?? 1],
          "the tile's own paint replaces the preceding blue, preserving caller alpha");
      }
      assert.deepEqual([...scene.textInstanceC.slice(8, 12)], [0, 0, 1, 1],
        "Q restores the caller's original non-pattern color");
      assert.equal(scene.fillPathCount, 1, "the same constant pattern fills paths as vectors");
      assert.deepEqual([
        scene.fillPathMetaB[2], scene.fillPathMetaB[3],
        scene.fillPathMetaC[2], scene.fillPathMetaC[3]
      ], [...expectedColor, settings.outerAlpha ?? 1]);
      assert.equal(scene.segmentCount, 1, "the same constant pattern strokes paths as vectors");
      if (settings.callerNone) {
        const retained = await session.compilePage(0, { optimization: "none" });
        const { encodeHeprPageData, decodeHeprPageData } = await import("../src/heprPageEncoding.ts");
        const { lowerRetainedPageToVectorScene } = await import("../src/retainedVectorPage.ts");
        const lowered = await lowerRetainedPageToVectorScene(decodeHeprPageData(encodeHeprPageData(retained)), {
          signal: new AbortController().signal
        });
        assert.equal(lowered.rasterLayers.length, 0, "retained colored pattern stays vector after caller /None");
        assert.equal(lowered.textInstanceCount, 3, "retained text must not inherit caller /None provenance");
        assert.deepEqual([...lowered.textInstanceC.slice(0, 4)], [...expectedColor, 1]);
        assert.ok(lowered.fillPathCount > 0, "retained path pattern must paint its own tile color");
      }
      assert(!session.getDiagnostics().some(d =>
        d.code.endsWith("raster-fallback") || d.code === "text-pattern-approximation"),
      "a proven uniform pattern requires neither a raster nor a color approximation");
    } finally { await session.close(); }
  }

  let type3Reference;
  for (const callerNone of [false, true]) {
    const session = await openPdf({ kind: "bytes", bytes: fixture({
      callerNone, type3Font: true, cell: "1 0 0 rg 0 0 10 12 re f"
    }) });
    try {
      const direct = await session.compileVectorPage(0, {
        optimization: "none", preserveDrawingOrder: true, vectorFallback: "error"
      });
      const retained = await session.compilePage(0, { optimization: "none" });
      const { encodeHeprPageData, decodeHeprPageData } = await import("../src/heprPageEncoding.ts");
      const { lowerRetainedPageToVectorScene } = await import("../src/retainedVectorPage.ts");
      const lowered = await lowerRetainedPageToVectorScene(decodeHeprPageData(encodeHeprPageData(retained)), {
        signal: new AbortController().signal
      });
      const appearances = [direct, lowered].map(scene => ({
        fills: scene.fillPathCount,
        strokes: scene.segmentCount,
        fillColors: [...scene.fillPathMetaB.filter((_, index) => index % 4 >= 2),
          ...scene.fillPathMetaC.filter((_, index) => index % 4 >= 2)],
        textColors: [...scene.textInstanceC]
      }));
      assert.ok([direct, lowered].every(scene => scene.rasterLayers.length === 0),
        "Type3 glyphs using a solid pattern retain vector paint");
      if (callerNone) assert.deepEqual(appearances, type3Reference,
        "Type3 glyph programs inherit the selected pattern paint independently of a preceding /None color space");
      else type3Reference = appearances;
    } finally { await session.close(); }
  }

  for (const [label, settings] of [
    ["gapped lattice", { xStep: 11 }],
    ["partial tile", { cell: "0 g 0 0 9 12 re f" }],
    ["nonrectangular tile paint", { cell: "0 g 0 0 m 10 0 l 0 12 l h f" }],
    ["multiple tile colors", { cell: "0 g 0 0 10 12 re f 1 0 0 rg 0 0 5 12 re f" }],
    ["transparent tile paint", { state: "/ca 0.5" }],
    ["blended tile paint", { state: "/BM /Multiply" }],
    ["clipped tile paint", { cell: "0 g 0 0 5 12 re W n 0 0 10 12 re f" }],
    ["inherited cell color", { cell: "0 0 10 12 re f" }],
    ["uncolored pattern cell", { paintType: 2, cell: "0 0 10 12 re f" }]
  ]) {
    // A nonuniform pattern stays vector: its fills and strokes expand into
    // pattern cells, while pattern-colored text keeps its glyphs in a solid
    // fallback color and says so.
    const session = await openPdf({ kind: "bytes", bytes: fixture(settings), label }, options);
    try {
      const scene = await session.compileVectorPage(0, { preserveDrawingOrder: true, vectorFallback: "error" });
      assert.equal(scene.rasterLayers.length, 0, `${label}: no raster fallback`);
      assert.equal(scene.textInstanceCount, 3, `${label}: pattern-colored text keeps its glyphs`);
      assert.equal(scene.textIndex.pages[0].text.replaceAll(/\s/g, ""), "AAB");
      assert.deepEqual([...scene.textInstanceC.slice(8, 12)], [0, 0, 1, 1],
        `${label}: text outside the pattern keeps its own color`);
      assert(scene.fillPathCount > 1, `${label}: the pattern fill expands into vector cells`);
      assert(session.getDiagnostics().some(({ code }) => code === "text-pattern-approximation"),
        `${label}: nonuniform patterns must not silently become a flat color`);
    } finally { await session.close(); }
  }

  const singular = await openPdf({ kind: "bytes", bytes: fixture({ matrix: "1 0 2 0 0 0" }) }, options);
  try {
    await assert.rejects(
      singular.compileVectorPage(0, { preserveDrawingOrder: true, vectorFallback: "error" }),
      error => error.code === "unsupported-content" && /singular pattern/.test(error.message),
      "a singular pattern matrix is reported instead of guessed"
    );
  } finally { await singular.close(); }

  const constrained = await openPdf({ kind: "bytes", bytes: fixture() }, options);
  try {
    await assert.rejects(constrained.compileVectorPage(0, { signal: AbortSignal.abort() }));
    await assert.rejects(constrained.compileVectorPage(0, { limits: { maxGlyphsPerPage: 1 } }),
      error => error.code === "resource-limit", "solid patterns do not bypass page glyph limits");
  } finally { await constrained.close(); }

  const oversized = await openPdf({ kind: "bytes", bytes: fixture({
    cell: `%${"padding".repeat(200)}\n0 g 0 0 10 12 re f`
  }) }, { ...options, limits: { maxDecodedStreamBytes: 1024 } });
  try {
    await assert.rejects(oversized.compileVectorPage(0, { vectorFallback: "error" }),
      error => error.code === "resource-limit", "pattern inspection preserves decoded stream limits");
  } finally { await oversized.close(); }
  console.log("solid tiling patterns preserve vector text, fills, strokes and caller state");
} finally { hooks.deregister(); }

function fixture({
  cell = "0 0 0 1 k 1 i /TileState gs 10 0 -10 12 re f",
  state = "/BM /Normal /CA 1 /ca 1 /OP true /op true /OPM 1 /SMask /None /AIS false /SA true",
  xStep = 10,
  yStep = 12,
  matrix = "1 0 0 1 262.029 357.443",
  outerAlpha = 1,
  directPattern = false,
  callerNone = false,
  type3Font = false,
  paintType = 1
} = {}) {
  const patternSpace = directPattern ? "/Pattern" : "/CS1";
  const patternSelection = paintType === 2 ? "0 0 0 /P0" : "/P0";
  const content = [
    "0 0 1 rg",
    `q /Outer gs ${callerNone ? "/Invisible cs .5 scn " : ""}${patternSpace} cs ${patternSelection} scn`,
    "BT /F1 10 Tf 5 75 Td (A) Tj ET",
    `${patternSelection} scn BT /F1 10 Tf 15 75 Td (A) Tj ET`,
    "5 55 10 10 re f Q",
    "BT /F1 10 Tf 25 75 Td (B) Tj ET",
    `q /Outer gs ${callerNone ? "/Invisible CS .5 SCN " : ""}${patternSpace} CS ${patternSelection} SCN 2 w 5 30 m 20 30 l S Q`
  ].join("\n");
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: [
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R",
      `/Resources << /ColorSpace << /CS1 [/Pattern${paintType === 2 ? " /DeviceRGB" : ""}]`,
      "/Invisible [/Separation /None /DeviceRGB << /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [1 1 1] /N 1 >>] >> /Pattern << /P0 6 0 R >>",
      `/ExtGState << /Outer << /ca ${outerAlpha} /CA ${outerAlpha} >> >>`,
      "/Font << /F1 5 0 R >> >> >>"
    ].join(" ") },
    { number: 4, body: tinyPdfStream("", content) },
    { number: 5, body: type3Font
      ? "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 500 700] /FontMatrix [.001 0 0 .001 0 0] /FirstChar 65 /LastChar 66 /Widths [500 500] /Encoding << /Type /Encoding /Differences [65 /A /B] >> /CharProcs << /A 8 0 R /B 9 0 R >> /Resources << >> >>"
      : "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
    { number: 6, body: tinyPdfStream([
      `/Type /Pattern /PatternType 1 /PaintType ${paintType} /TilingType 3`,
      `/BBox [0 0 10 12] /XStep ${xStep} /YStep ${yStep} /Matrix [${matrix}]`,
      "/Resources << /ExtGState << /TileState 7 0 R >> >>"
    ].join(" "), cell) },
    { number: 7, body: `<< ${state} >>` },
    ...(type3Font ? [
      { number: 8, body: tinyPdfStream("", "500 0 d0 0 0 500 700 re f") },
      { number: 9, body: tinyPdfStream("", "500 0 d0 0 0 500 700 re f") }
    ] : [])
  ] });
}
