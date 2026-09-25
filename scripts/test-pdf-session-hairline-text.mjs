import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { buildTinySfnt } from "./lib/tinySfnt.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
const triangle = (x, y) => `${x} ${y} m ${x + 8} ${y} l ${x} ${y + 8} l h`;
const signal = () => new AbortController().signal;

try {
  const [{ openPdf }, { lowerRetainedPageToVectorScene }, { computeCharQuad },
    { getScenePrimitive, ScenePrimitivePicker, isScenePrimitiveVisible },
    { defaultVectorDrawRuns, validateVectorDrawRuns }, { validateScenePaintGraph },
    { OptionalContentController }, { encodeHeprPageData, decodeHeprPageData }] = await Promise.all([
    import("../src/pdfSession.ts"), import("../src/retainedVectorPage.ts"),
    import("../src/sceneTextGeometry.ts"), import("../src/scenePrimitives.ts"),
    import("../src/vectorDrawOrder.ts"), import("../src/scenePaintGraph.ts"),
    import("../src/optionalContent.ts"), import("../src/heprPageEncoding.ts")
  ]);
  const font = buildTinySfnt();
  const options = { missingFontResolver: () => ({ sfntBytes: font, identifier: "hairline-text-fixture" }) };
  const cases = [
    {
      name: "stroke-only searchable hairline", text: "A", fills: 0,
      content: "0 0 1 RG 0 w BT /F 80 Tf 1 Tr 10 10 Td (A) Tj ET",
      reference: `0 0 1 RG 0 w ${triangle(10, 10)} S`,
      async check(scene) {
        const picker = new ScenePrimitivePicker(scene);
        try {
          // Screen-space coverage remains half a device pixel at every zoom;
          // a fixed world-space outline would grow wider as scale increases.
          for (const scale of [1, 8, 64]) {
            const pick = distance => {
              const point = { x: 14, y: 10 + distance / scale };
              return picker.pick({ point, clientPoint: { x: point.x * scale, y: point.y * scale },
                project: p => ({ x: p.x * scale, y: p.y * scale }),
                unproject: p => ({ x: p.x / scale, y: p.y / scale }), tolerancePx: 0, kinds: ["stroke"] });
            };
            assert(await pick(.49), `hairline remains selectable within half a pixel at ${scale}x`);
            assert.equal(await pick(.6), null, `hairline does not widen at ${scale}x`);
          }
        } finally { picker.dispose(); }
      }
    },
    {
      name: "overlapping filled glyphs preserve individual paint order", text: "AA", fills: 2,
      content: "/Alpha gs 1 0 0 rg 0 0 1 RG 0 w BT /F 80 Tf 2 Tr -44 Tc 10 10 Td (AA) Tj ET",
      reference: `/Alpha gs 1 0 0 rg 0 0 1 RG 0 w ${triangle(10, 10)} B ${triangle(14, 10)} B`,
      check(scene) {
        const paints = (scene.drawRuns ?? defaultVectorDrawRuns(scene)).flatMap(run =>
          Array.from({ length: run.count }, (_, i) => `${run.kind}:${run.first + i}`));
        assert.deepEqual(paints, ["text:0", "stroke:0", "stroke:1", "stroke:2",
          "text:1", "stroke:3", "stroke:4", "stroke:5"], "each glyph fills before its own stroke");
        assert(Math.abs(scene.textInstanceC[3] - .45) < 1e-6, "fill alpha remains independent of stroke alpha");
        const groups = [];
        const visit = nodes => { for (const node of nodes) if (node.kind === "group") {
          if (Math.abs(node.alpha - .65) < 1e-6) groups.push(node);
          visit(node.children);
        } };
        visit(scene.paintGraph.roots);
        assert.equal(groups.length, 2, "each glyph applies stroke alpha once across all its joined segments");
        assert(groups.every(group => group.isolated && group.children.every(child =>
          child.kind === "draw" && scene.drawRuns[child.runIndex].kind === "stroke")),
          "glyph opacity groups only composite their own hairline strokes");
      }
    },
    {
      name: "CTM, text matrix and horizontal scale transform the centerline", text: "A", fills: 1,
      content: "q 1.6 .2 .35 .7 6 12 cm /Alpha gs 1 0 0 rg 0 0 1 RG 0 w 1 J " +
        "BT /F 60 Tf 65 Tz 2 Tr .8 .25 -.1 1.2 7 8 Tm (A) Tj ET Q",
      reference: "q 1.6 .2 .35 .7 6 12 cm /Alpha gs 1 0 0 rg 0 0 1 RG 0 w 1 J " +
        "7 8 m 10.12 8.975 l 6.4 15.2 l h B Q"
    },
    {
      name: "dash lengths follow graphics-state space under a nonuniform CTM", text: "A", fills: 0,
      content: "q 1.6 .2 .35 .7 6 12 cm 0 0 1 RG 0 w 1 J [2 1] 0 d " +
        "BT /F 80 Tf 75 Tz 1 Tr 10 10 Td (A) Tj ET Q",
      // The 6-8-10 triangle has a perimeter of 24. These are its explicit
      // two-unit dash spans with one-unit gaps, before the graphics transform.
      reference: "q 1.6 .2 .35 .7 6 12 cm 0 0 1 RG 0 w 1 J " +
        "10 10 m 12 10 l 13 10 m 15 10 l " +
        "16 10 m 14.8 11.6 l 14.2 12.4 m 13 14 l " +
        "12.4 14.8 m 11.2 16.4 l 10.6 17.2 m 10 18 l " +
        "10 18 m 10 17 l 10 16 m 10 14 l 10 13 m 10 11 l S Q"
    },
    {
      name: "transformed Form retains arbitrary caller and BBox clips", text: "A", fills: 1, form: true,
      content: "/Alpha gs 1 0 0 rg 0 0 1 RG 0 w BT /F 80 Tf 2 Tr 8 8 Td (A) Tj ET",
      reference: `/Alpha gs 1 0 0 rg 0 0 1 RG 0 w ${triangle(8, 8)} B`,
      check(scene) {
        assert(scene.clipPaths.length >= 2);
        assert((scene.drawRuns ?? []).every(run => run.clipIndex !== undefined), "fill and hairline share the exact clips");
      }
    },
    {
      name: "transparent fill leaves a searchable visible hairline", text: "A", fills: 0,
      state: "/ca 0 /CA .65",
      content: "/Alpha gs 1 0 0 rg 0 0 1 RG 0 w BT /F 80 Tf 2 Tr 10 10 Td (A) Tj ET",
      reference: `/Alpha gs 1 0 0 rg 0 0 1 RG 0 w ${triangle(10, 10)} B`
    },
    {
      name: "optional layer retains hairline vectors", text: "A", fills: 1, layer: true,
      content: "1 0 0 rg 0 0 1 RG 0 w BT /F 80 Tf 2 Tr 10 10 Td (A) Tj ET",
      reference: `1 0 0 rg 0 0 1 RG 0 w ${triangle(10, 10)} B`,
      async check(scene) {
        const controller = new OptionalContentController(scene);
        try {
          const id = scene.optionalContent.groups.find(group => group.name === "Details").id;
          const visible = condition => controller.isVisible(condition);
          for (const ref of [{ kind: "stroke", index: 0 }, { kind: "text", index: 0 }]) {
            assert(getScenePrimitive(scene, ref).optionalContent.layerIds.includes(id));
            assert.equal(isScenePrimitiveVisible(scene, ref, visible), false, "default-off paint stays hidden");
          }
          await controller.setLayerVisibility(id, true);
          assert.equal(isScenePrimitiveVisible(scene, { kind: "stroke", index: 0 }, visible), true);
          assert.equal(isScenePrimitiveVisible(scene, { kind: "text", index: 0 }, visible), true);
          assert.equal(scene.rasterLayers.length, 0, "layer toggles need no page raster");
        } finally { controller.dispose(); }
      }
    }
  ];

  for (const entry of cases) {
    const session = await openPdf({ kind: "bytes", bytes: fixture(entry) }, options);
    const reference = await openPdf({ kind: "bytes", bytes: fixture({ ...entry, content: entry.reference }) });
    try {
      const scene = await session.compileVectorPage(0, { vectorFallback: "error", optimization: "none" });
      const expected = await reference.compileVectorPage(0, { vectorFallback: "error", optimization: "none" });
      const page = await session.compilePage(0, { retainOptionalContent: true, optimization: "none" });
      const original = structuredClone(page);
      const retained = await lowerRetainedPageToVectorScene(page, { signal: signal(), optionalContent: scene.optionalContent });
      assert.deepEqual(page, original, "lowering preserves reusable source stores");
      if (entry.name.startsWith("dash lengths")) {
        const command = page.displayProgram.groups.flatMap(group => group.commands)
          .find(command => command.kind === "draw" && command.source === "glyphs");
        assert(command?.strokeTransformIndex >= 0, "glyph command retains its graphics-state pen transform");
        assertClose(page.stores.transforms.values.subarray(command.strokeTransformIndex * 6,
          command.strokeTransformIndex * 6 + 6), [1.6, .2, .35, .7, 6, 12], "retained glyph pen CTM");
        const decoded = decodeHeprPageData(encodeHeprPageData(page));
        assert.deepEqual(decoded, page, "retained glyph pen transforms survive binary serialization");
        const restored = await lowerRetainedPageToVectorScene(decoded, {
          signal: signal(), optionalContent: scene.optionalContent
        });
        assert.deepEqual(restored.endpoints, retained.endpoints);
        assert.deepEqual(restored.primitiveMeta, retained.primitiveMeta);
        assert.deepEqual(restored.drawRuns, retained.drawRuns);
        assert.deepEqual(restored.textIndex, retained.textIndex);
      }
      if (entry === cases[0]) {
        await assert.rejects(lowerRetainedPageToVectorScene(page, { signal: signal(), maxPrimitives: 2 }),
          error => error.code === "resource-limit", "hairline centerlines count toward the primitive budget");
        await assert.rejects(session.compileVectorPage(0, { signal: AbortSignal.abort() }),
          error => error.code === "aborted", "hairline compilation preserves cancellation");
      }
      for (const [route, actual] of [["viewer", scene], ["retained", retained]]) {
        const label = `${entry.name}, ${route}`;
        assert.equal(actual.rasterLayers.length, 0, label);
        assert.equal([...actual.textInstanceC].filter((value, index) => index % 4 === 3 && value > 1e-3).length,
          entry.fills, `${label}: visible glyph fills`);
        assert(actual.segmentCount > 0, `${label}: hairlines have vector centerlines`);
        validateVectorDrawRuns(actual);
        validateScenePaintGraph(actual);
        const actualSegments = strokeSegments(actual, getScenePrimitive);
        const expectedSegments = strokeSegments(expected, getScenePrimitive);
        assert.equal(actualSegments.length, expectedSegments.length, label);
        actualSegments.forEach((segment, index) => {
          assertClose(segment.geometry, expectedSegments[index].geometry, label);
          assert.equal(segment.style.strokeWidth, 0, `${label}: no fixed world-space width`);
          assert.equal(segment.style.hairline, true, `${label}: GPU device-width flag survives`);
          assert.equal(segment.style.roundCap, true, `${label}: adjacent device-width segments cover their joins`);
          assert.deepEqual(segment.style.color, [0, 0, 1], label);
          assert(Math.abs(segment.style.opacity - expectedSegments[index].style.opacity) < 1e-6, label);
          assert.equal(segment.rawOpacity, 1, `${label}: alpha applies once to the completed glyph stroke`);
        });
        assertSearch(actual, entry.text, computeCharQuad, label);
        await entry.check?.(actual);
      }
      assert(!session.getDiagnostics().some(d => d.code.endsWith("raster-fallback")), entry.name);
      assert(session.getDiagnostics().some(d => d.code === "glyph-hairline-style-approximation"),
        `${entry.name}: device-width join approximation is diagnosed`);
    } finally { await reference.close(); await session.close(); }
  }

  for (const mode of [5, 6]) {
    const session = await openPdf({ kind: "bytes", bytes: fixture({
      content: `0 0 1 RG 0 w BT /F 80 Tf ${mode} Tr 10 10 Td (A) Tj ET 1 0 0 rg 0 0 80 80 re f`
    }) }, options);
    try {
      const page = await session.compilePage(0);
      const scenes = [
        await session.compileVectorPage(0, { vectorFallback: "error", optimization: "none" }),
        await lowerRetainedPageToVectorScene(page, { signal: signal() })
      ];
      for (const scene of scenes) {
        assert.equal(scene.rasterLayers.length, 0, `Tr ${mode} preserves vectors`);
        assert.equal(scene.segmentCount, 3, "stroke uses all three triangle centerlines");
        assert.equal(scene.textInstanceCount, mode === 6 ? 1 : 0);
        const runs = scene.drawRuns ?? defaultVectorDrawRuns(scene);
        assert(runs.filter(run => run.kind === "stroke").every(run => run.clipIndex === undefined),
          "text clip takes effect after its own hairline stroke");
        const fill = runs.find(run => run.kind === "fill");
        assert(fill?.clipIndex >= 0, "subsequent paint uses the glyph interior as its clip");
        assertClose(scene.clipPaths[fill.clipIndex].edges, [10, 10, 18, 10, 18, 10, 10, 18, 10, 18, 10, 10],
          "clip follows the glyph interior, not a widened hairline");
        assertSearch(scene, "A", computeCharQuad, `Tr ${mode}`);
        validateVectorDrawRuns(scene);
        validateScenePaintGraph(scene);
      }
    } finally { await session.close(); }
  }
  // Generic retained paths use the same stroke adapter. A curved path and
  // nondefault join force that route; layer retention used to rasterize it.
  for (const layer of [false, true]) {
    const session = await openPdf({ kind: "bytes", bytes: fixture({ layer,
      content: "/Alpha gs 0 0 m 70 0 l 0 70 l h W n 0 0 1 RG 0 w 1 j 2 J " +
        "q 1 .2 .3 1 4 5 cm 10 10 m 10 30 30 30 30 10 c 40 10 l S Q"
    }) });
    try {
      const integrated = await session.compileVectorPage(0, { vectorFallback: "error", optimization: "none" });
      const page = await session.compilePage(0, { retainOptionalContent: true });
      assert(page.displayProgram.groups.some(group => group.commands.some(command =>
        command.kind === "draw" && command.source === "paths" && command.strokeStyleIndex >= 0)),
        "fixture exercises the generic retained path adapter");
      const scene = await lowerRetainedPageToVectorScene(page, { signal: signal(), optionalContent: integrated.optionalContent });
      for (const actual of [integrated, scene]) {
        assert.equal(actual.rasterLayers.length, 0, "generic hairline path remains vector");
        assert(actual.segmentCount > 0);
        assert([...actual.primitiveMeta].some((value, index) => index % 4 === 2 && value === 1),
          "cubic centerline remains curved vector geometry");
        assert((actual.drawRuns ?? []).every(run => run.clipIndex !== undefined), "arbitrary path clip survives");
        for (let index = 0; index < actual.segmentCount; index++) {
          const style = getScenePrimitive(actual, { kind: "stroke", index }).getSegmentStyle(0);
          assert.equal(style.strokeWidth, 0);
          assert.equal(style.hairline, true);
        }
        for (const segment of strokeSegments(actual, getScenePrimitive)) {
          if (actual === scene) assert.equal(segment.rawOpacity, 1, "retained path joins composite at full coverage");
          assert(Math.abs(segment.style.opacity - .65) < 1e-6, "path alpha applies once after joining its segments");
        }
        validateVectorDrawRuns(actual);
        validateScenePaintGraph(actual);
        if (layer) {
          const controller = new OptionalContentController(actual);
          try {
            const visible = condition => controller.isVisible(condition);
            const id = actual.optionalContent.groups.find(group => group.name === "Details").id;
            assert.equal(isScenePrimitiveVisible(actual, { kind: "stroke", index: 0 }, visible), false);
            await controller.setLayerVisibility(id, true);
            assert.equal(isScenePrimitiveVisible(actual, { kind: "stroke", index: 0 }, visible), true);
          } finally { controller.dispose(); }
        }
      }
    } finally { await session.close(); }
  }
  console.log(`Hairline text passed: ${cases.length * 2 + 8} vector compilations, independent path geometry, zoom, search, clips and layers.`);
} finally { hooks.deregister(); }

function strokeSegments(scene, getScenePrimitive) {
  const opacity = new Float64Array(scene.segmentCount).fill(1);
  const visit = (nodes, alpha) => { for (const node of nodes) {
    if (node.kind === "group") visit(node.children, alpha * node.alpha);
    else if (node.kind === "draw") {
      const run = scene.drawRuns[node.runIndex];
      if (run.kind === "stroke") opacity.fill(alpha, run.first, run.first + run.count);
    }
  } };
  if (scene.paintGraph) visit(scene.paintGraph.roots, 1);
  return Array.from({ length: scene.segmentCount }, (_, index) => {
    const primitive = getScenePrimitive(scene, { kind: "stroke", index });
    const segment = primitive.getSegment(0);
    const style = primitive.getSegmentStyle(0);
    return { geometry: [segment.start.x, segment.start.y, segment.end.x, segment.end.y],
      rawOpacity: style.opacity, style: { ...style, opacity: style.opacity * opacity[index] } };
  });
}
function assertClose(actual, expected, label) {
  assert.equal(actual.length, expected.length, label);
  for (let i = 0; i < actual.length; i++) {
    assert(Math.abs(actual[i] - expected[i]) < 1e-4, `${label}: coordinate ${i}: ${actual[i]} != ${expected[i]}`);
  }
}
function assertSearch(scene, text, computeCharQuad, label) {
  const index = scene.textIndex.pages[0];
  assert.equal(index.text.replaceAll(/\s/g, ""), text, label);
  for (let char = 0; char < index.text.length; char++) {
    if (/\s/.test(index.text[char])) continue;
    const bounds = new Float32Array(4);
    assert(computeCharQuad(scene, index, char, bounds, 0), `${label}: searchable character ${char}`);
    assert(bounds.every(Number.isFinite) && bounds[2] > bounds[0] && bounds[3] > bounds[1], label);
  }
}
function fixture({ content, form = false, layer = false, state = "/ca .45 /CA .65" }) {
  const resources = "/Font << /F 5 0 R >> /ExtGState << /Alpha 6 0 R >> /Properties << /Details 8 0 R >>";
  const paint = form ? "q 5 0 m 25 0 l 5 35 l h W n /Form Do Q" : content;
  return writeTinyPdf({ objects: [
    { number: 1, body: `<< /Type /Catalog /Pages 2 0 R ${layer ? "/OCProperties << /OCGs [8 0 R] /D << /BaseState /OFF >> >>" : ""} >>` },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 80 80] /Resources << ${resources} /XObject << /Form 7 0 R >> >> /Contents 4 0 R >>` },
    { number: 4, body: tinyPdfStream("", layer ? `/OC /Details BDC ${paint} EMC` : paint) },
    { number: 5, body: "<< /Type /Font /Subtype /TrueType /BaseFont /HairlineFixture /Encoding /WinAnsiEncoding >>" },
    { number: 6, body: `<< ${state} >>` },
    { number: 7, body: tinyPdfStream(`/Type /XObject /Subtype /Form /BBox [0 0 50 50] /Matrix [1 .2 .15 1 5 7] /Resources << ${resources} >>`, content) },
    { number: 8, body: "<< /Type /OCG /Name (Details) >>" }
  ] });
}
