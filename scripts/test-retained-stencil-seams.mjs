import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });

try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { lowerRetainedPageToVectorScene } = await import("../src/retainedVectorPage.ts");
  const { validateScenePaintGraph } = await import("../src/scenePaintGraph.ts");
  const { buildRasterAtlasBatches } = await import("../src/rasterAtlasBatches.ts");
  const { compositeBinaryStencilPlates } = await import("../src/retainedStencilRaster.ts");
  const { rasterRepeatMatrix } = await import("../src/rasterRepeat.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { ScenePageViews } = await import("../src/scenePageViews.ts");
  const { placeDemandRaster } = await import("../src/pdfDemandScene.ts");
  const { buildRasterScenePreview } = await import("../src/pageRasterPreview.ts");
  const { ScenePrimitivePicker, getScenePrimitive } = await import("../src/scenePrimitives.ts");

  const first = "q 20 0 0 10 10 10 cm .643137255 .682352941 .674509804 rg /A Do Q";
  const second = "q 20 0 0 10 10 10 cm .549019608 .588235294 .580392157 rg /B Do Q";
  const fixture = (content = `${first} ${second}`, mask = [0xa0, 0x50]) => writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R " +
      "/Resources << /XObject << /A 5 0 R /B 6 0 R >> /ExtGState << /Half << /ca .5 >> >> >> >>" },
    { number: 4, body: tinyPdfStream("", content) },
    ...[[5, [0x50, 0xa0]], [6, mask]].map(([number, samples]) => ({ number,
      body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 4 /Height 2 /ImageMask true /BitsPerComponent 1",
        Uint8Array.from(samples)) }))
  ] });
  const compile = async (content, mask) => {
    const session = await openPdf({ kind: "bytes", bytes: fixture(content, mask) });
    try { return await session.compilePage(0); } finally { await session.close(); }
  };
  const lower = async (page, options = {}) => {
    const original = structuredClone(page);
    const scene = await lowerRetainedPageToVectorScene(page, { signal: new AbortController().signal, ...options });
    assert.deepEqual(page, original, "combining plates leaves reusable image bytes and commands intact");
    validateScenePaintGraph(scene);
    return scene;
  };
  const page = await compile();
  const full = await lower(page);
  assert.equal(full.rasterLayers.length, 1, "matching plates become one image before GPU filtering");
  assert.equal(full.rasterLayers[0].interpolate, false, "binary plates preserve the source's nearest sampling");
  const expected = Array.from({ length: 8 }, (_, i) => (i % 4 + Math.floor(i / 4)) % 2 === 0
    ? [164, 174, 172, 255] : [140, 150, 148, 255]).flat();
  assert.deepEqual([...full.rasterLayers[0].data], expected, "original binary samples retain their paint colors");

  const diagnostics = [];
  const reduced = await lower(page, { maxStencilPixels: 4, onDiagnostic: d => diagnostics.push(d) });
  const tile = reduced.rasterLayers[0];
  assert.deepEqual([tile.width, tile.height, ...tile.data], [2, 1, 152, 162, 160, 255, 152, 162, 160, 255],
    "complementary coverage stays opaque when the shared stencil budget reduces resolution");
  assert(diagnostics.some(d => d.code === "image.stencil-resolution-reduced"));
  const oldAlpha = 128 / 255 + (128 / 255) * (1 - 128 / 255);
  assert(oldAlpha < .76, "separately reduced checkerboard plates reproduce the old translucent background");

  // Nearest layers bypass smooth atlases. Explicit smooth derivatives still
  // retain opaque coverage through bilinear/trilinear filtering at boundaries.
  const tiled = { ...reduced, rasterLayers: Array.from({ length: 4 }, (_, i) =>
    ({ ...tile, paintOrder: i, matrix: Float32Array.of(20, 0, 0, 10, 10 + i * 19.6, 10) })) };
  assert.deepEqual(buildRasterAtlasBatches(tiled, 1024), [], "nearest stencil plates retain their individual samplers");
  const [atlas] = buildRasterAtlasBatches({ ...tiled,
    rasterLayers: tiled.rasterLayers.map(layer => ({ ...layer, interpolate: true })) }, 1024);
  assert.equal(atlas.count, 4);
  const sampleLevel = (image, requested, u) => {
    const meta = atlas.instances.subarray(image * 12, image * 12 + 12);
    let width = meta[10], height = meta[11], x = meta[8];
    for (let level = 0; level < requested; level++) {
      x += width; width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2));
    }
    const pixel = Math.max(0, Math.min(width - 1, u * width - .5));
    const left = Math.floor(pixel), right = Math.min(left + 1, width - 1), weight = pixel - left;
    return Array.from({ length: 4 }, (_, c) => atlas.data[(meta[9] * atlas.width + x + left) * 4 + c] * (1 - weight) +
      atlas.data[(meta[9] * atlas.width + x + right) * 4 + c] * weight);
  };
  for (const zoom of [.01, .025, .05, .075, .1, .25, .5, 1, 2, 8]) {
    const lod = Math.min(1, Math.max(0, Math.log2(tile.width / (20 * zoom))));
    for (let image = 0; image < 4; image++) for (const u of [0, .01, .25, .5, .99, 1]) {
      const a = sampleLevel(image, Math.floor(lod), u), b = sampleLevel(image, Math.ceil(lod), u);
      assert.deepEqual(a.map((v, c) => v + (b[c] - v) * (lod % 1)), [152, 162, 160, 255],
        `opaque background at zoom ${zoom}, tile ${image}, u=${u}`);
    }
  }

  const overlapping = await lower(await compile(undefined, [0, 0]));
  assert(overlapping.rasterLayers[0].data.every((v, i) => v === [140, 150, 148, 255][i % 4]),
    "later plates overwrite earlier samples in source order");
  const holes = await lower(await compile(undefined, [0x50, 0xa0]), { maxStencilPixels: 4 });
  assert.deepEqual([...holes.rasterLayers[0].data], [140, 150, 148, 128, 140, 150, 148, 128],
    "unpainted samples retain their true transparency when reduced");

  for (const [reason, content] of [
    ["vector paint", `${first} 1 0 0 rg 15 15 5 5 re f ${second}`],
    ["transform", `${first} ${second.replace("10 10 cm", "11 10 cm")}`],
    ["clip", `q 10 10 10 10 re W n ${first} Q ${second}`],
    ["opacity group", `${first} q /Half gs ${second} Q`],
    ["content item", `/P << /MCID 0 >> BDC ${first} EMC /P << /MCID 1 >> BDC ${second} EMC`]
  ]) {
    const input = await compile(content);
    const scene = await lower(input, { pageMarkedContentCount: input.stores.markedContent.mcids.length });
    assert.equal(scene.rasterLayers.length, 2, `${reason} prevents crossing a paint boundary`);
    assert.equal(scene.drawRuns.filter(r => r.kind === "raster").length, 2);
    if (reason === "vector paint") assert.deepEqual(scene.drawRuns.map(r => r.kind), ["raster", "fill", "raster"]);
    if (reason === "content item") assert.equal(scene.markedContent.items.length, 2);
  }
  const knockout = structuredClone(page);
  knockout.displayProgram.groups[knockout.displayProgram.rootGroupIndex].knockout = true;
  assert.equal((await lower(knockout)).rasterLayers.length, 2, "knockout siblings keep their separate shapes");
  const grayCoverage = structuredClone(page);
  grayCoverage.stores.images.data[grayCoverage.stores.images.dataOffsets[0]] = 128;
  assert.equal((await lower(grayCoverage)).rasterLayers.length, 2, "fractional source coverage keeps its original compositing");

  async function patternScene({ generic = false, matrix = "1 0 0 1 0 0", mask = [0, 0],
    clip = "0 0 3.75 3.5 re W n", xStep = 4, yStep = 4, interpolate = false,
    content = "/PCS cs .2 .4 .6 /P scn 10 10 16 16 re f", lowerOptions = {} } = {}) {
    const cell = `${clip} 4 0 0 4 0 0 cm /B Do`;
    const bytes = writeTinyPdf({ objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << " +
        "/ColorSpace << /PCS [/Pattern /DeviceRGB] >> /Pattern << /P 5 0 R >> /ExtGState << /Half << /ca .5 >> >> >> >>" },
      { number: 4, body: tinyPdfStream("", content) },
      { number: 5, body: tinyPdfStream(`/Type /Pattern /PatternType 1 /PaintType 2 /TilingType 1 /BBox [0 0 4 4] /XStep ${xStep} /YStep ${yStep} /Matrix [${matrix}] /Resources << /XObject << /B 6 0 R >> >>`,
        generic ? `/Artifact BMC ${cell} EMC` : cell) },
      { number: 6, body: tinyPdfStream(`/Type /XObject /Subtype /Image /Width 4 /Height 2 /ImageMask true /BitsPerComponent 1 /Interpolate ${interpolate}`, Uint8Array.from(mask)) }
    ] });
    const session = await openPdf({ kind: "bytes", bytes });
    try {
      const page = await session.compilePage(0);
      return await lower(page, { pageMarkedContentCount: page.stores.markedContent.mcids.length, ...lowerOptions });
    } finally { await session.close(); }
  }
  function rasterPaints(scene) {
    const paints = [];
    const visit = (nodes, alpha) => {
      for (const node of nodes) {
        if (node.kind === "group") {
          assert.equal(node.blendMode, "Normal"); assert(!node.softMask && !node.knockout);
          visit(node.children, alpha * node.alpha);
        } else {
          const run = scene.drawRuns[node.runIndex]; assert.equal(run.kind, "raster");
          for (let index = run.first; index < run.first + run.count; index++) {
            const layer = scene.rasterLayers[index], repeat = layer.repeat;
            if (repeat) for (let y = repeat.yFirst; y <= repeat.yLast; y++) for (let x = repeat.xFirst; x <= repeat.xLast; x++) {
              paints.push({ layer: { ...layer, matrix: rasterRepeatMatrix(repeat, x, y) }, clipIndex: run.clipIndex ?? -1, alpha });
            } else paints.push({ layer, clipIndex: run.clipIndex ?? -1, alpha });
          }
        }
      }
    };
    visit(scene.paintGraph.roots, 1); return paints;
  }
  function sampleRasterPaints(scene, paints, x, y) {
    const result = [0, 0, 0, 0];
    for (const { layer, clipIndex, alpha } of paints) {
      const [a, b, c, d, e, f] = layer.matrix, determinant = a * d - b * c;
      const u = (d * (x - e) - c * (y - f)) / determinant, v = (-b * (x - e) + a * (y - f)) / determinant;
      if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) continue;
      let clipped = false;
      for (let index = clipIndex; index >= 0; index = scene.clipPaths[index].parent) {
        const clip = scene.clipPaths[index]; let winding = 0;
        for (let edge = 0; edge < clip.edges.length; edge += 4) {
          const [x0, y0, x1, y1] = clip.edges.subarray(edge, edge + 4);
          if ((y0 > y) !== (y1 > y) && x0 + (y - y0) / (y1 - y0) * (x1 - x0) > x) winding += y1 > y0 ? 1 : -1;
        }
        if (clip.fillRule ? winding % 2 === 0 : winding === 0) { clipped = true; break; }
      }
      if (clipped) continue;
      const offset = (Math.min(layer.height - 1, Math.floor(v * layer.height)) * layer.width +
        Math.min(layer.width - 1, Math.floor(u * layer.width))) * 4;
      const sourceAlpha = layer.data[offset + 3] / 255 * alpha;
      for (let channel = 0; channel < 3; channel++) result[channel] = layer.data[offset + channel] / 255 * sourceAlpha + result[channel] * (1 - sourceAlpha);
      result[3] = sourceAlpha + result[3] * (1 - sourceAlpha);
    }
    return result;
  }
  for (const settings of [
    { matrix: "1 0 0 1 0 0" }, { matrix: "-1 0 0 1 40 0" }, { matrix: "0 1 -1 0 40 0" },
    { matrix: "2 0 0 3 .25 -.5" }, { matrix: "1 0 0 1 0 0", xStep: -4, yStep: -4 },
    { matrix: "0 1 -1 0 40 0", xStep: -4, interpolate: true, clip: ".25 .5 3.5 3 re W n" }
  ]) {
    const { matrix } = settings, optimized = await patternScene(settings), generic = await patternScene({ ...settings, generic: true });
    const fastPaints = rasterPaints(optimized), originalPaints = rasterPaints(generic);
    assert.equal(fastPaints.length, originalPaints.length, "every original cell retains its logical raster instance");
    assert.equal(optimized.imagePaintOpCount, generic.imagePaintOpCount, "paint counts include every cell in the compact grid");
    assert.equal(optimized.rasterLayers.length, 1, "one reusable stencil grid replaces per-cell resource objects");
    assert(optimized.rasterLayers[0].repeat, "the source pattern remains explicit in canonical scene data");
    assert.equal(optimized.rasterLayers[0].interpolate, settings.interpolate ?? false, "explicit source sampling remains unchanged");
    assert.equal(optimized.drawRuns.length, 1, "a proven simple cell batches its source-ordered placements");
    assert(generic.drawRuns.length > 1, "metadata in the cell keeps the conservative executor path");
    assert(optimized.clipPaths.length < generic.clipPaths.length, "cell clips are encoded in cropped placements");
    for (let index = 0; index < fastPaints.length; index++) assert.deepEqual(fastPaints[index].layer.data,
      originalPaints[index].layer.data, "cropping keeps identical RGBA samples and source order");
    assert(optimized.rasterLayers.every(layer => layer.data === optimized.rasterLayers[0].data), "all cells reuse owned tinted pixels");
    const xs = fastPaints.flatMap(paint => [paint.layer.matrix[4], paint.layer.matrix[4] + paint.layer.matrix[0] + paint.layer.matrix[2]]),
      ys = fastPaints.flatMap(paint => [paint.layer.matrix[5], paint.layer.matrix[5] + paint.layer.matrix[1] + paint.layer.matrix[3]]);
    let visibleSamples = 0;
    for (let y = Math.min(...ys) + .125; y < Math.max(...ys); y += .5) for (let x = Math.min(...xs) + .125; x < Math.max(...xs); x += .5) {
      const sampled = sampleRasterPaints(optimized, fastPaints, x, y);
      visibleSamples += sampled[3] > 0 ? 1 : 0;
      assert.deepEqual(
      sampled, sampleRasterPaints(generic, originalPaints, x, y),
      `cropped and clipped raster coverage agrees at ${matrix}: ${x},${y}`);
    }
    assert(visibleSamples > 0, "the comparison includes visible painted cells");
    // Sample both sides of each represented crop boundary, including Float32
    // placement rounding. Do not widen clips or erase subpixel source gaps.
    for (const paint of fastPaints.slice(0, 8)) {
      const [a, b, c, d, e, f] = paint.layer.matrix;
      for (const u of [-.0001, .0001, .9999, 1.0001]) {
        const x = a * u + c * .5 + e, y = b * u + d * .5 + f;
        assert.deepEqual(sampleRasterPaints(optimized, fastPaints, x, y), sampleRasterPaints(generic, originalPaints, x, y));
      }
    }
  }
  const variedContent = "/P << /MCID 0 >> BDC /PCS cs 1 0 0 /P scn 10 10 8 8 re f EMC " +
    "/P << /MCID 1 >> BDC /Half gs /PCS cs 0 0 1 /P scn 12 12 8 8 re f EMC";
  const varied = await patternScene({ content: variedContent }), variedOriginal = await patternScene({ content: variedContent, generic: true });
  assert.equal(varied.drawRuns.length, 2, "color, opacity and structure boundaries remain separate");
  assert.deepEqual(varied.markedContent.items.map(item => item.mcid), [0, 1]);
  const variedPaints = rasterPaints(varied), variedOriginalPaints = rasterPaints(variedOriginal);
  for (let y = 9.125; y < 21; y += .5) for (let x = 9.125; x < 21; x += .5) assert.deepEqual(
    sampleRasterPaints(varied, variedPaints, x, y), sampleRasterPaints(variedOriginal, variedOriginalPaints, x, y),
    "bound colors, opacity groups and overlapping source paints stay equivalent");
  const compact = await patternScene(), canonicalCompact = structuredClone(compact),
    composed = composeVectorScenesInGrid([compact, compact], 2), nested = composeVectorScenesInGrid([composed, composed], 2);
  for (const document of [composed, nested]) {
    for (let pageIndex = 0; pageIndex < document.pageCount; pageIndex++) {
      const layer = document.rasterLayers[pageIndex], repeat = layer.repeat;
      assert(repeat, "composition preserves one grid resource per source pattern use");
      assert.equal(repeat.translations.length, document === composed ? 2 : 4, "each composition keeps its Float32 placement store");
      const view = new ScenePageViews(document).extract(pageIndex).scene;
      assert.equal(view.rasterLayers[0].repeat, repeat, "page views keep immutable document-space repeat geometry");
      assert.equal(view.imagePaintOpCount, compact.imagePaintOpCount, "page counts retain logical repeated paint operations");
      assert.deepEqual(getScenePrimitive(view, { kind: "raster", index: 0 }).bounds,
        getScenePrimitive(document, { kind: "raster", index: pageIndex }).bounds, "selection and page bounds use the exact grid extent");
      for (let y = repeat.yFirst; y <= repeat.yLast; y++) for (let x = repeat.xFirst; x <= repeat.xLast; x++) {
        const expected = rasterRepeatMatrix(compact.rasterLayers[0].repeat, x, y);
        for (let index = 0; index < repeat.translations.length; index += 2) {
          expected[4] += repeat.translations[index]; expected[5] += repeat.translations[index + 1];
        }
        assert.deepEqual(rasterRepeatMatrix(repeat, x, y), expected, "nested placement matches independent old per-cell Float32 stores");
      }
    }
  }
  assert.deepEqual(compact, canonicalCompact, "composition keeps cached compact pages reusable");
  const preview = buildRasterScenePreview(compact, 2);
  assert.equal(preview.rasterLayers[0].repeat, compact.rasterLayers[0].repeat, "preview reduction retains exact repeat geometry");
  assert.equal(preview.rasterLayers[0].width, 2);
  const placed = placeDemandRaster(compact.rasterLayers[0], composed, compact, 1);
  assert.deepEqual(placed.repeat.translations, composed.rasterLayers[1].repeat.translations, "demand placement uses the same repeat translation as composition");
  const picker = new ScenePrimitivePicker(compact), identity = point => ({ ...point }),
    pick = (x, y) => picker.pick({ point: { x, y }, clientPoint: { x, y }, project: identity, unproject: identity, tolerancePx: 0 });
  assert.deepEqual((await pick(13, 13))?.primitive, { kind: "raster", index: 0 }, "visible repeated cells are selectable");
  assert.equal(await pick(11.875, 13), null, "horizontal cell gaps remain transparent to picking");
  assert.equal(await pick(13, 11.75), null, "vertical cell gaps remain transparent to picking");
  assert.equal(await pick(9, 13), null, "the source pattern paint clip still limits selection");
  picker.dispose();
  const overlappingCells = await patternScene({ xStep: 3, yStep: 3 });
  assert(overlappingCells.rasterLayers.length > 1 && overlappingCells.rasterLayers.every(layer => !layer.repeat),
    "overlapping stencil cells retain their individual source-over paint placements");
  for (const options of [
    { matrix: "1 .2 .1 1 0 0" }, { mask: [0xa0, 0x50] },
    { clip: "0 0 4 4 re 1 1 1 1 re W* n" },
    { clip: "0 0 m 4 4 l 0 4 l 4 0 l h W* n" }
  ]) {
    const scene = await patternScene(options);
    assert(scene.drawRuns.length > 1, "sheared placements, nonuniform masks, holes and crossing clips use the exact executor");
  }
  for (const lowerOptions of [{ maxPatternCells: 1 }, { maxCoordinates: 1 }, { maxCoordinates: 6 }, { maxPrimitives: 0 }, { maxPrimitives: 1 }]) {
    await assert.rejects(patternScene({ lowerOptions }), error => error.code === "resource-limit",
      "the cached cell template preserves caller cell and geometry limits");
  }
  await assert.rejects(patternScene({ lowerOptions: { signal: AbortSignal.abort() } }), { name: "AbortError" });

  const largeComposite = compositeBinaryStencilPlates([], 4_000_001, 1, 1, new AbortController().signal);
  assert.equal(largeComposite.data.length, 4_000_001 * 4, "stencil allocations beyond the former allowance are attempted");
  assert.throws(() => compositeBinaryStencilPlates([], Number.MAX_SAFE_INTEGER, 2, 1,
    new AbortController().signal), /dimensions/);
  const cancelled = new AbortController(); cancelled.abort();
  assert.throws(() => compositeBinaryStencilPlates([{ coverage: Uint8Array.of(255), color: [1, 0, 0, 1] }],
    1, 1, 1, cancelled.signal), { name: "AbortError" });
  console.log("Stencil seams: source composition before reduction/mips, zoom sweep, true holes, paint boundaries and bounded cancellation passed.");
} finally { hooks.deregister(); }
