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
  const { compositeBinaryStencilPlates, MAX_STENCIL_COMPOSITE_PIXELS } = await import("../src/retainedStencilRaster.ts");

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

  // Sample the actual atlas's mip rectangles, including bilinear/trilinear
  // filtering at tile boundaries. Every zoom keeps the same opaque gray.
  const tiled = { ...reduced, rasterLayers: Array.from({ length: 4 }, (_, i) =>
    ({ ...tile, paintOrder: i, matrix: Float32Array.of(20, 0, 0, 10, 10 + i * 19.6, 10) })) };
  const [atlas] = buildRasterAtlasBatches(tiled, 1024);
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

  assert.throws(() => compositeBinaryStencilPlates([], MAX_STENCIL_COMPOSITE_PIXELS + 1, 1, 1,
    new AbortController().signal), /tile budget/);
  const cancelled = new AbortController(); cancelled.abort();
  assert.throws(() => compositeBinaryStencilPlates([{ coverage: Uint8Array.of(255), color: [1, 0, 0, 1] }],
    1, 1, 1, cancelled.signal), { name: "AbortError" });
  console.log("Stencil seams: source composition before reduction/mips, zoom sweep, true holes, paint boundaries and bounded cancellation passed.");
} finally { hooks.deregister(); }
