import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")
    ? `${specifier}.ts` : specifier, context);
} });
const closeTo = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-5,
  `${message}: ${actual} != ${expected}`);
const topPaintNodes = scene => {
  let nodes = scene.paintGraph.roots;
  while (nodes.length === 1 && nodes[0].kind === "group" && nodes[0].alpha === 1 &&
      !nodes[0].softMask && !nodes[0].knockout) nodes = nodes[0].children;
  return nodes;
};

try {
  const [{ openPdf }, { lowerRetainedPageToVectorScene }, { getScenePrimitive },
    { validateVectorDrawRuns }, { validateScenePaintGraph }, { VectorOrderedBatches }] = await Promise.all([
    import("../src/pdfSession.ts"), import("../src/retainedVectorPage.ts"), import("../src/scenePrimitives.ts"),
    import("../src/vectorDrawOrder.ts"), import("../src/scenePaintGraph.ts"), import("../src/vectorOrderedBatches.ts")
  ]);
  const font = buildTinySfnt();
  const fontResources = {
    resources: "/Font << /F 10 0 R >>",
    objects: [{ number: 10, body: "<< /Type /Font /Subtype /TrueType /BaseFont /ColorBoundaryFixture /Encoding /WinAnsiEncoding >>" }]
  };
  const compile = async (content, { resources = "", objects = [], integrated = false, expectedRasters = 0 } = {}) => {
    const bytes = writeTinyPdf({ objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [8 0 R 9 0 R] /D << /BaseState /ON >> >> >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Properties << /A 8 0 R /B 9 0 R >> /ExtGState << /Alpha << /CA .4 >> /FillAlpha << /ca .4 >> >> ${resources} >> /Contents 4 0 R >>` },
      { number: 4, body: tinyPdfStream("", content) },
      { number: 8, body: "<< /Type /OCG /Name (A) >>" },
      { number: 9, body: "<< /Type /OCG /Name (B) >>" }, ...objects
    ] });
    const session = await openPdf({ kind: "bytes", bytes }, {
      missingFontResolver: () => ({ sfntBytes: font, identifier: "color-boundary-fixture" })
    });
    try {
      const viewer = integrated ? await session.compileVectorPage(0, { optimization: "none", vectorFallback: "error" }) : null;
      const page = await session.compilePage(0, { retainOptionalContent: true, optimization: "none" });
      const original = structuredClone(page);
      const scene = await lowerRetainedPageToVectorScene(page, {
        signal: new AbortController().signal, optionalContent: viewer?.optionalContent
      });
      assert.deepEqual(page, original, "lowering keeps reusable retained stores unchanged");
      for (const actual of [scene, viewer].filter(Boolean)) {
        assert.equal(actual.rasterLayers.length, expectedRasters, "only original source images may be raster layers");
        validateVectorDrawRuns(actual);
        validateScenePaintGraph(actual);
      }
      return { scene, viewer };
    } finally { await session.close(); }
  };
  const style = (scene, index) => getScenePrimitive(scene, { kind: "stroke", index }).getSegmentStyle(0);
  const lines = Array.from({ length: 64 }, (_, index) =>
    `${[.08, .12, .36][index % 3]} w 10 ${index + 1} m 90 ${index + 1} l S`).join("\n");
  {
    const { scene, viewer } = await compile(`/OC /A BDC 1 J 1 j ${lines} EMC`, { integrated: true });
    for (const actual of [scene, viewer]) {
      assert.equal(actual.fillPathCount, 0, "thin round strokes retain centerlines instead of fill outlines");
      assert.equal(actual.segmentCount, 64);
      assert.equal(actual.drawRuns.length, 1, "64 adjacent solid strokes need only one ordered run");
      assert.equal(actual.drawRuns[0].kind, "stroke");
      assert.equal(actual.drawRuns[0].count, 64);
      if (actual === scene) assert.equal(actual.paintGraph.roots.length, 1);
      for (let index = 0; index < 64; index += 1) {
        const segmentStyle = style(actual, index);
        closeTo(segmentStyle.strokeWidth, [.08, .12, .36][index % 3], "thin physical width survives");
        assert.equal(segmentStyle.hairline, false, "positive widths never become device-width hairlines");
        assert.equal(segmentStyle.roundCap, true);
      }
    }
  }
  {
    const { scene } = await compile("1 J 1 j .12 w " +
      "1 0 0 RG 10 10 m 30 10 l S 10 12 m 30 12 l S " +
      "0 0 1 RG 10 14 m 30 14 l S 10 16 m 30 16 l S " +
      "1 0 0 rg 10 30 5 5 re f 20 30 5 5 re f " +
      "0 0 1 rg 30 30 5 5 re f 40 30 5 5 re f " +
      "BT /F 20 Tf 10 60 Td 1 0 0 rg (AA) Tj 0 0 1 rg (AA) Tj ET", fontResources);
    assert.deepEqual(scene.drawRuns.map(({ kind, first, count }) => [kind, first, count]),
      [["stroke", 0, 2], ["stroke", 2, 2], ["fill", 0, 2], ["fill", 2, 2],
        ["text", 0, 2], ["text", 2, 2]],
      "adjacent paints coalesce within their RGB color, preserving boundaries that permit later batching");
    assert.deepEqual(topPaintNodes(scene).map(node => node.runIndex), [0, 1, 2, 3, 4, 5],
      "color boundaries retain canonical paint-graph order");
    for (let index = 0; index < 4; index++) {
      const expected = index < 2 ? [1, 0, 0] : [0, 0, 1];
      assert.deepEqual(style(scene, index).color, expected);
      assert.deepEqual(getScenePrimitive(scene, { kind: "fill", index }).color, expected);
      assert.deepEqual(Array.from(scene.textInstanceC.subarray(index * 4, index * 4 + 3)), expected);
    }
  }
  {
    const { scene } = await compile(".25 .5 .75 rg " +
      "BT /F 20 Tf 10 60 Td (A) Tj ET q /FillAlpha gs BT /F 20 Tf 20 60 Td (A) Tj ET Q " +
      "BT /F 20 Tf 30 60 Td (A) Tj ET", fontResources);
    assert.deepEqual(scene.drawRuns.map(({ kind, count }) => [kind, count]), [["text", 3]],
      "different alpha does not split equal-RGB glyphs in one compositing scope");
    for (let index = 0; index < 3; index++)
      closeTo(scene.textInstanceC[index * 4 + 3], index === 1 ? .4 : 1, "coalesced glyph keeps independent opacity");
  }
  {
    const { scene } = await compile("1 J 1 j .12 w " +
      ".500000001 0 0 RG 10 10 m 30 10 l S .500000002 0 0 RG 10 20 m 30 20 l S " +
      ".50000006 0 0 RG 10 30 m 30 30 l S");
    assert.deepEqual(scene.drawRuns.map(run => run.count), [2, 1],
      "only actual Float32 RGB differences create additional stroke runs");
    assert.equal(scene.styles[1], scene.styles[5]);
    assert.notEqual(scene.styles[5], scene.styles[9]);
  }
  {
    // One mixed black/blue stroke run used to fence each overlapping black
    // fill, although every blue stroke is spatially disjoint from every fill.
    const blocks = Array.from({ length: 32 }, (_, index) => {
      const y = 20 + index / 4;
      return `0 0 0 rg 10 10 30 30 re f 0 0 0 RG 10 ${y} m 30 ${y} l S ` +
        `0 0 1 RG 70 ${y} m 90 ${y} l S`;
    }).join("\n");
    const { scene } = await compile("q 5 5 m 95 5 l 95 95 l 5 95 l h W n 1 J 1 j .12 w " + blocks + " Q");
    const unchanged = structuredClone(scene);
    assert.equal(scene.drawRuns.length, 96, "only the two RGB spans within each stroke pair remain separate");
    const paints = plan => plan.batches.flatMap(batch => Array.from({ length: batch.count }, (_, index) => {
      const offset = (batch.first + index) * 2;
      return { kind: batch.kind, id: plan.uintInstances[offset], clip: plan.uintInstances[offset + 1] };
    }));
    const canonical = scene.drawRuns.flatMap(run => Array.from({ length: run.count }, (_, index) =>
      ({ kind: run.kind, id: run.first + index, clip: (run.clipIndex ?? -1) + 1 })));
    const plan = new VectorOrderedBatches(scene, null);
    plan.update(scene.drawRuns, .25);
    assert.equal(plan.batches.length, 2, "color boundaries unlock one fill draw and one stroke draw");
    assert.equal(plan.culledSegmentCount, 0, "batch reduction preserves every source stroke");
    const scheduled = paints(plan);
    const identity = paint => `${paint.kind}:${paint.id}`;
    assert.deepEqual(scheduled.map(identity).sort(), canonical.map(identity).sort(),
      "batching preserves every canonical primitive identity exactly once");
    for (const kind of ["fill", "stroke"]) assert.deepEqual(scheduled.filter(paint => paint.kind === kind).map(paint => paint.id),
      canonical.filter(paint => paint.kind === kind).map(paint => paint.id), "same-kind paints retain source order");
    // The clip can be elided only if its entire coverage contains that paint;
    // all retained codes must still identify their original canonical clip.
    const expectedClips = new Map(canonical.map(paint => [identity(paint), paint.clip]));
    for (const paint of scheduled) assert(paint.clip === 0 || paint.clip === expectedClips.get(identity(paint)),
      "reordered instances never acquire another paint's clip");
    plan.setColorCommutationEnabled(false);
    plan.update(scene.drawRuns, .25);
    assert.equal(plan.batches.length, 64, "temporary color overrides restore overlapping source dependencies");
    plan.setColorCommutationEnabled(true);
    plan.update(scene.drawRuns, .25);
    assert.equal(plan.batches.length, 2);
    assert.deepEqual(scene, unchanged, "batching changes only submitted instance order, never source geometry or colors");

    // Distinct colors that actually overlap cannot cross a preceding fill,
    // even when adjacent stroke RGB changes have made their bounds tighter.
    const { scene: overlap } = await compile("1 J 1 j .12 w " +
      "0 0 0 rg 10 10 30 30 re f 0 0 0 RG 10 20 m 30 20 l S 0 0 1 RG 10 21 m 30 21 l S " +
      "0 0 0 rg 10 10 30 30 re f 0 0 0 RG 10 22 m 30 22 l S");
    const overlapPlan = new VectorOrderedBatches(overlap, null);
    overlapPlan.update(overlap.drawRuns, .25);
    const overlapOrder = paints(overlapPlan).map(identity);
    assert(overlapOrder.indexOf("fill:0") < overlapOrder.indexOf("stroke:1"));
    assert(overlapOrder.indexOf("stroke:1") < overlapOrder.indexOf("fill:1"),
      "different-RGB stroke/fill overlaps retain their original painter order");
  }
  for (const cap of [0, 1]) {
    const { scene } = await compile(`${cap} J 2 j .08 w 10 20 m 40 20 l S`);
    if (cap === 1) {
      assert.equal(scene.segmentCount, 1, "a single round-capped line needs no join expansion");
      assert.equal(scene.fillPathCount, 0);
      assert.equal(style(scene, 0).roundCap, true);
    } else {
      assert.equal(scene.segmentCount, 0, "positive-width butt caps keep their exact outline");
      assert.equal(scene.fillPathCount, 1, "butt caps cannot use the round-ended packed distance shader");
      const bounds = getScenePrimitive(scene, { kind: "fill", index: 0 }).bounds;
      closeTo(bounds.minX, 10, "butt cap stops at the source start");
      closeTo(bounds.maxX, 40, "butt cap stops at the source end");
    }
  }
  {
    const { scene } = await compile("1 J 1 j .12 w 10 10 m 10 60 70 60 70 10 c S");
    assert.equal(scene.fillPathCount, 0);
    assert(scene.segmentCount > 1);
    assert([...scene.primitiveMeta].filter((_, index) => index % 4 === 2).every(value => value === 1),
      "cubic strokes retain curved quadratic centerlines");
    assert.equal(scene.drawRuns.length, 1);
    closeTo(scene.endpoints[0], 10, "cubic start x");
    closeTo(scene.endpoints[1], 10, "cubic start y");
    closeTo(scene.primitiveMeta.at(-4), 70, "cubic end x");
    closeTo(scene.primitiveMeta.at(-3), 10, "cubic end y");
    // The symmetric cubic's t=.5 point is exactly (40,47.5), independently
    // of the renderer's chosen subdivision depth.
    const vertices = Array.from({ length: scene.segmentCount }, (_, index) =>
      [scene.primitiveMeta[index * 4], scene.primitiveMeta[index * 4 + 1]]);
    assert(vertices.some(([x, y]) => Math.abs(x - 40) < 1e-5 && Math.abs(y - 47.5) < 1e-5));
    for (let index = 0; index < scene.segmentCount; index += 1) closeTo(style(scene, index).strokeWidth, .12, "curve pen width");
  }
  {
    const { scene } = await compile("q 0 3 -3 0 90 5 cm 1 J 1 j .12 w 10 10 m 30 10 l S Q");
    assert.equal(scene.segmentCount, 1);
    assert.equal(scene.fillPathCount, 0);
    const segment = getScenePrimitive(scene, { kind: "stroke", index: 0 }).getSegment(0);
    assert.deepEqual(segment.start, { x: 60, y: 35 });
    assert.deepEqual(segment.end, { x: 60, y: 95 });
    closeTo(style(scene, 0).strokeWidth, .36, "uniform rotation/scale transforms the pen width");
  }
  for (const [name, content] of [
    ["nonuniform pen", "q 2 0 0 1 0 0 cm 1 J 1 j .12 w 10 10 m 30 10 l S Q"],
    ["dashed pen", "1 J 1 j .12 w [2 1] 0 d 10 10 m 40 10 l S"],
    ["square caps", "2 J 1 j .12 w 10 10 m 40 10 l S"],
    ["miter joins", "1 J 0 j .12 w 10 10 m 40 10 l 40 40 l S"]
  ]) {
    const { scene } = await compile(content);
    assert.equal(scene.segmentCount, 0, `${name} keeps the full stroked outline`);
    assert.equal(scene.fillPathCount, 1, `${name} remains vector fill geometry`);
    assert(scene.fillSegmentCount > 0);
  }
  {
    const { scene } = await compile("1 J 1 j .12 w 1 0 0 rg 0 0 1 RG " +
      "10 10 20 20 re B 15 15 20 20 re B");
    assert.deepEqual(scene.drawRuns.map(run => run.kind), ["fill", "stroke", "fill", "stroke"],
      "fill/stroke order remains separate for overlapping painted shapes");
    assert.deepEqual(topPaintNodes(scene).map(node => node.runIndex), [0, 1, 2, 3]);
    assert.deepEqual(getScenePrimitive(scene, { kind: "fill", index: 0 }).color, [1, 0, 0]);
    assert.deepEqual(style(scene, 0).color, [0, 0, 1]);
  }
  {
    const { scene, viewer } = await compile("1 J 1 j .12 w " +
      "/OC /A BDC 10 10 m 40 10 l S EMC " +
      "/OC /B BDC 10 20 m 40 20 l S EMC " +
      "/OC /A BDC 10 30 m 40 30 l S EMC", { integrated: true });
    for (const actual of [scene, viewer]) {
      assert.equal(actual.drawRuns.length, 3, "different layer conditions fence adjacent strokes");
      const conditions = actual.drawRuns.map(run => run.optionalContent);
      assert.notEqual(conditions[0], conditions[1]);
      assert.equal(conditions[0], conditions[2]);
    }
  }
  {
    const { scene } = await compile("1 J 1 j .12 w q 0 0 30 30 re W n " +
      "10 10 m 40 10 l S 10 20 m 40 20 l S Q 10 40 m 40 40 l S");
    assert.equal(scene.drawRuns.length, 2, "coalescing keeps clip boundaries");
    assert.equal(scene.drawRuns[0].count, 2, "adjacent strokes with the same clip still coalesce");
    assert(scene.drawRuns[0].clipIndex >= 0);
    assert.equal(scene.drawRuns[1].clipIndex, undefined);
  }
  {
    const { scene } = await compile("1 J 1 j .12 w /Alpha gs " +
      "10 10 m 40 10 l 40 40 l S 20 20 m 50 20 l 50 50 l S");
    assert.equal(scene.fillPathCount, 0);
    assert.equal(scene.segmentCount, 4);
    assert.equal(scene.drawRuns.length, 2, "separate translucent paths keep separate draws");
    const groups = topPaintNodes(scene);
    assert.equal(groups.length, 2);
    for (const group of groups) {
      assert.equal(group.kind, "group");
      closeTo(group.alpha, .4, "path opacity applies once after its joined stroke coverage");
      assert.equal(group.children.length, 1);
      assert.equal(scene.drawRuns[group.children[0].runIndex].count, 2);
    }
    for (let index = 0; index < scene.segmentCount; index += 1) assert.equal(style(scene, index).opacity, 1);
  }
  {
    const { scene } = await compile("1 J 1 j .12 w 10 10 m 40 10 l S /Form Do 10 30 m 40 30 l S", {
      resources: "/XObject << /Form 10 0 R >>",
      objects: [{ number: 10, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] " +
        "/Group << /S /Transparency /I true >> /Resources << >>", "1 J 1 j .12 w 10 20 m 40 20 l S") }]
    });
    assert.equal(scene.drawRuns.length, 3, "coalescing never crosses a Form transparency group");
    const nodes = topPaintNodes(scene);
    assert.deepEqual(nodes.map(node => node.kind), ["draw", "group", "draw"]);
    assert.equal(nodes[1].children.length, 1);
  }
  {
    const { scene } = await compile("0 0 5 5 re f /S sh /S sh 30 30 5 5 re f", {
      resources: "/Shading << /S 10 0 R >>",
      objects: [
        { number: 10, body: "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Function 11 0 R /Extend [true true] >>" },
        { number: 11, body: "<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >>" }
      ]
    });
    assert.equal(scene.gradientFillPathCount, 2);
    assert.deepEqual(scene.drawRuns.map(run => run.kind), ["fill", "gradient-fill", "gradient-fill", "fill"],
      "adjacent gradients retain individual paint identities");
    for (const index of [0, 1]) {
      const runIndex = index + 1;
      assert.equal(scene.drawRuns[runIndex].count, 1, "gradient runs remain singleton");
      assert.equal(scene.drawRuns[runIndex].first, index);
      assert.equal(scene.gradientFillPaintMeta[index * 4 + 2], runIndex,
        "gradient paint-order metadata points to its actual ordered run");
    }
    assert.deepEqual(topPaintNodes(scene).map(node => node.runIndex), [0, 1, 2, 3]);
  }
  {
    const { scene } = await compile("0 0 5 5 re f " +
      "q 10 0 0 10 10 10 cm /Image Do Q q 10 0 0 10 15 15 cm /Image Do Q 30 30 5 5 re f", {
      resources: "/XObject << /Image 10 0 R >>", expectedRasters: 2,
      objects: [{ number: 10, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 " +
        "/ColorSpace /DeviceRGB /BitsPerComponent 8", Uint8Array.of(255, 0, 0)) }]
    });
    assert.deepEqual(scene.drawRuns.map(run => run.kind), ["fill", "raster", "raster", "fill"],
      "adjacent source images retain individual paint identities");
    for (const index of [0, 1]) {
      assert.equal(scene.drawRuns[index + 1].count, 1, "raster runs remain singleton");
      assert.equal(scene.drawRuns[index + 1].first, index);
      assert.equal(scene.rasterLayers[index].paintOrder, index);
    }
    assert.notDeepEqual(scene.rasterLayers[0].matrix, scene.rasterLayers[1].matrix,
      "reused image pixels retain their independent placements");
    assert.deepEqual(topPaintNodes(scene).map(node => node.runIndex), [0, 1, 2, 3]);
  }
  {
    const { scene } = await compile("/Form Do", {
      resources: "/XObject << /Form 10 0 R >>",
      objects: [{ number: 10, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] " +
        "/Group << /S /Transparency /I true /K true >> /Resources << >>", "1 0 0 rg " +
        "10 10 20 20 re f 15 15 20 20 re f 1 J 1 j .12 w 10 50 m 40 50 l S 10 60 m 40 60 l S") }]
    });
    const groups = [];
    const visit = nodes => { for (const node of nodes) if (node.kind === "group") {
      groups.push(node); visit(node.children);
    } };
    visit(scene.paintGraph.roots);
    const knockout = groups.find(group => group.knockout);
    assert(knockout, "the fixture preserves its knockout compositing scope");
    assert.equal(knockout.children.length, 4, "each ordinary paint remains an independent knockout object");
    assert(knockout.children.every(node => node.kind === "draw"));
    assert.deepEqual(knockout.children.map(node => scene.drawRuns[node.runIndex].kind),
      ["fill", "fill", "stroke", "stroke"], "coalescing must not merge adjacent paints in a knockout scope");
    assert(knockout.children.every(node => scene.drawRuns[node.runIndex].count === 1));
  }
  console.log("Retained packed strokes passed: thin widths, RGB-aware coalescing, bounded color batching, curves, paint order, clips, layers and alpha/knockout scopes.");
} finally { hooks.deregister(); }
