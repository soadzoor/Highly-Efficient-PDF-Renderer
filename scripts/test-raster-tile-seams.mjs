import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { evaluateGlsl } from "./lib/scalarShaderEval.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { buildRasterTileSeams } = await import("../src/rasterTileSeams.ts");
  const { RASTER_TILE_SEAM_GLSL } = await import("../src/rasterTileSeamShaders.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { heprRasterTileSeamCoverage: coverage } = evaluateGlsl(RASTER_TILE_SEAM_GLSL);
  const pixels = new Map();
  const opaque = (width, height) => {
    const key = `${width}:${height}`;
    if (!pixels.has(key)) pixels.set(key, new Uint8Array(width * height * 4).fill(255));
    return pixels.get(key);
  };
  const layer = (matrix, width = 16, height = 16) => ({ matrix: Float32Array.from(matrix), width, height,
    data: opaque(width, height), opacity: 1, pageIndex: 0, paintOrder: 0, interpolate: false });
  const sceneOf = layers => {
    const scene = createEmptyVectorScene();
    scene.rasterLayers = layers;
    scene.drawRuns = layers.map((_, first) => ({ kind: "raster", first, count: 1 }));
    scene.paintGraph = { roots: scene.drawRuns.map((_, runIndex) => ({ kind: "draw", runIndex })) };
    return scene;
  };
  const basic = (gap = .125) => sceneOf([layer([16, 0, 0, -16, 0, 16]), layer([16, 0, 0, -16, 16 + gap, 16])]);
  const gpuBounds = matrix => {
    const points = [0, 1].flatMap(u => [0, 1].map(v => [Math.fround(matrix[0] * u + matrix[2] * v + matrix[4]),
      Math.fround(matrix[1] * u + matrix[3] * v + matrix[5])]));
    return Float32Array.of(Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])),
      Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1])));
  };
  const vec4 = values => ({ x: values[0], y: values[1], z: values[2], w: values[3] });
  const at = (point, footprint, bounds, gaps, maxFootprint = [Infinity, Infinity]) => coverage({ x: point[0], y: point[1] },
    { x: footprint[0], y: footprint[1] }, vec4(bounds), vec4(gaps), { x: maxFootprint[0], y: maxFootprint[1] });
  const close = (actual, expected, message, tolerance = 1e-9) =>
    assert(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);

  const original = basic(), canonical = structuredClone(original), descriptors = buildRasterTileSeams(original);
  assert.equal(descriptors.size, 2);
  assert.deepEqual(descriptors.get(0).gaps, Float32Array.of(0, 0, .125, 0));
  assert.deepEqual(descriptors.get(1).gaps, Float32Array.of(.125, 0, 0, 0));
  assert.equal(descriptors.get(0).bounds[2], descriptors.get(1).bounds[0], "both opaque tiles meet at exactly one stored midpoint");
  assert.equal(descriptors.get(0).maxFootprint[0], 16);
  assert.equal(descriptors.get(1).maxFootprint[0], 16);
  assert.deepEqual(original, canonical, "neighbor preparation preserves canonical pixels, matrices and paint metadata");
  assert.equal(original.rasterLayers[0].data, original.rasterLayers[1].data, "immutable pixel aliases remain intact");
  for (const gap of [0, -.125, 1.25]) assert.equal(buildRasterTileSeams(basic(gap)).size, 0,
    "touching, overlapping and gaps wider than one source pixel keep their original geometry");
  assert.equal(buildRasterTileSeams(basic(1)).size, 2, "a one-source-pixel gap remains eligible for area-preserving filtering");
  const group = (children, overrides = {}) => ({ kind: "group", children, alpha: 1, isolated: true,
    knockout: false, blendMode: "Normal", ...overrides });
  for (const [reason, modify] of [
    ["transparent pixels", scene => { scene.rasterLayers[1].data = scene.rasterLayers[1].data.slice(); scene.rasterLayers[1].data[3] = 254; }],
    ["constant opacity", scene => { scene.rasterLayers[1].opacity = .5; }],
    ["sheared transform", scene => { scene.rasterLayers[1].matrix[1] = .125; }],
    ["nonaxis rotation", scene => { scene.rasterLayers[1].matrix = Float32Array.of(16, 1, -1, -16, 16.125, 16); }],
    ["degenerate transform", scene => { scene.rasterLayers[1].matrix[0] = 0; }],
    ["nonfinite transform", scene => { scene.rasterLayers[1].matrix[4] = Infinity; }],
    ["noncanonical matrix", scene => { scene.rasterLayers[1].matrix = [...scene.rasterLayers[1].matrix]; }],
    ["packed monochrome", scene => { scene.rasterLayers[1].monochrome = { data: new Uint8Array(32), colors: new Uint8Array(8) }; }],
    ["changing demand slot", scene => { scene.rasterLayers[1].pageDemandSlot = true; }],
    ["repeat resource", scene => { scene.rasterLayers[1].repeat = {}; }],
    ["clip scope", scene => { scene.drawRuns[1].clipIndex = 0; }],
    ["blend mode", scene => { scene.drawRuns[1].blendMode = "Multiply"; }],
    ["visibility changes", scene => { scene.drawRuns[0].optionalContent = 0; scene.drawRuns[1].optionalContent = 1; }],
    ["representation changes", scene => { scene.drawRuns[0].pdfRepresentation = { pageIndex: 0, detail: false }; scene.drawRuns[1].pdfRepresentation = { pageIndex: 0, detail: true }; }],
    ["different pages", scene => { scene.rasterLayers[1].pageIndex = 1; }],
    ["vector paint interleave", scene => {
      scene.drawRuns.splice(1, 0, { kind: "fill", first: 0, count: 1 });
      scene.paintGraph.roots = scene.drawRuns.map((_, runIndex) => ({ kind: "draw", runIndex }));
    }],
    ["separate group scopes", scene => { scene.paintGraph.roots = scene.paintGraph.roots.map(node => group([node])); }],
    ["group opacity", scene => { scene.paintGraph.roots = [group(scene.paintGraph.roots, { alpha: .5 })]; }],
    ["group blend mode", scene => { scene.paintGraph.roots = [group(scene.paintGraph.roots, { blendMode: "Multiply" })]; }],
    ["knockout", scene => { scene.paintGraph.roots = [group(scene.paintGraph.roots, { knockout: true })]; }],
    ["soft mask", scene => { scene.paintGraph.roots = [group(scene.paintGraph.roots, { softMask: { subtype: "Alpha", children: [] } })]; }],
    ["graph visibility scope", scene => { scene.paintGraph.roots[1].optionalContent = 1; }],
    ["retained program interleave", scene => { scene.paintGraph.roots.splice(1, 0, { kind: "retained", rasterIndex: 99, retainedPage: 0, firstCommand: 0, count: 1 }); }],
    ["lazy pixel payload", scene => { Object.defineProperty(scene.rasterLayers[1], "data", { get() { throw new Error("must not expand pixels"); } }); }]
  ]) {
    const scene = basic(); modify(scene);
    assert.equal(buildRasterTileSeams(scene).size, 0, `${reason} prevents crossing incompatible paint boundaries`);
  }
  const normalGroup = basic(); normalGroup.paintGraph.roots = [group(normalGroup.paintGraph.roots)];
  assert.equal(buildRasterTileSeams(normalGroup).size, 2, "one ordinary alpha-one group keeps its consecutive opaque image span");
  const multipleRuns = basic(); multipleRuns.drawRuns = [{ kind: "raster", first: 0, count: 2 }];
  multipleRuns.paintGraph.roots = [{ kind: "draw", runIndex: 0 }];
  assert.equal(buildRasterTileSeams(multipleRuns).size, 2, "one raster run can hold adjacent compatible tiles");
  const reflected = sceneOf([layer([-16, 0, 0, 16, 16, 0]), layer([-16, 0, 0, 16, 32.125, 0])]);
  assert.equal(buildRasterTileSeams(reflected).size, 2, "reflections preserve exact rectangular neighbor geometry");
  const permuted = sceneOf([layer([0, 16, -16, 0, 16, 0]), layer([0, 16, -16, 0, 32.125, 0])]);
  assert.equal(buildRasterTileSeams(permuted).size, 2, "90-degree axis permutations remain rectangular");
  const sameCondition = basic(); sameCondition.drawRuns.forEach(run => { run.optionalContent = 0; });
  assert.equal(buildRasterTileSeams(sameCondition).size, 2, "neighbors hidden and shown together keep one compatible span");
  assert.equal(buildRasterTileSeams(basic(), index => index === 0).size, 0,
    "renderer eligibility cannot leave one side of a seam without its matching neighbor");
  const nestedImages = sceneOf([layer([32, 0, 0, -16, 0, 16]), layer([1, 0, 0, -16, 30, 16], 1, 16),
    layer([16, 0, 0, -16, 31.125, 16])]);
  assert.equal(buildRasterTileSeams(nestedImages).size, 0, "a contained predecessor cannot invent a gap through a wider opaque image");

  const interleaved = basic();
  const overlay = layer([16, 0, 0, -16, 100, 116]);
  overlay.data = overlay.data.slice();
  interleaved.rasterLayers.splice(1, 0, overlay);
  interleaved.drawRuns = interleaved.rasterLayers.map((_, first) => ({ kind: "raster", first, count: 1 }));
  interleaved.paintGraph.roots = interleaved.drawRuns.map((_, runIndex) => ({ kind: "draw", runIndex }));
  assert.equal(buildRasterTileSeams(interleaved).size, 2, "an opaque image in another geometric bucket preserves the compatible paint span");
  overlay.data[3] = 254;
  assert.equal(buildRasterTileSeams(interleaved).size, 0,
    "a translucent intervening paint is a barrier even when it is outside the neighbors' perpendicular bucket");
  let pixelReads = 0;
  const unscanned = new Proxy(opaque(16, 16), { get(target, property) {
    if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
      pixelReads++;
      throw new Error("unrelated photographs must not be scanned");
    }
    return Reflect.get(target, property, target);
  } });
  const distant = basic(100);
  distant.rasterLayers.forEach(image => { image.data = unscanned; });
  assert.equal(buildRasterTileSeams(distant).size, 0, "photographs without geometric seam candidates require no alpha scan");
  assert.equal(pixelReads, 0);

  const tiny = sceneOf(Array.from({ length: 5 }, (_, index) => layer([1, 0, 0, -1, index * 2, 1], 1, 1))),
    tinySeams = buildRasterTileSeams(tiny);
  assert.equal(tinySeams.size, 5);
  for (const [owner, x, expected] of [[0, .5, 1], [0, 1.25, 0], [1, 1.75, 0], [1, 2.5, 1]]) {
    const seam = tinySeams.get(owner);
    assert.equal(seam.maxFootprint[0], 1);
    assert.equal(at([x, .5], [4, 4], gpuBounds(tiny.rasterLayers[owner].matrix), seam.gaps, seam.maxFootprint), expected,
      "a deeply minified mosaic retains hard-center geometry when farther gaps are not represented");
  }
  const unequal = sceneOf([layer([8, 0, 0, -4, 0, 4], 8, 4), layer([1, 0, 0, -4, 8.125, 4], 1, 4)]),
    unequalSeams = buildRasterTileSeams(unequal);
  assert.equal(unequalSeams.get(0).maxFootprint[0], 1);
  assert.equal(unequalSeams.get(1).maxFootprint[0], 1, "unequal neighbors share the smaller locality limit");
  for (const [owner, x] of [[0, 8.025], [1, 8.1]]) {
    const seam = unequalSeams.get(owner), bounds = gpuBounds(unequal.rasterLayers[owner].matrix);
    assert.equal(at([x, 2], [2, 2], bounds, seam.gaps, seam.maxFootprint), 0,
      "both halves of an unequal-width seam switch to legacy sampling together");
    close(at([x, 2], [.5, .5], bounds, seam.gaps, seam.maxFootprint), .75,
      "both halves retain area filtering within the shared locality limit");
  }

  // Exact matrices from the reported source/HEP. The ordinary satellite tiles
  // have no clips and retain the same geometry before and after HEP storage.
  const tileWidth = 122.64009094238281, matrix = (x, top) => [tileWidth, 0, 0, -tileWidth, x, top],
    reported = [sceneOf([layer(matrix(4510.31103515625, 2179.2001953125), 511, 511),
      layer(matrix(4632.97265625, 2179.2001953125), 511, 511)]),
    sceneOf([layer(matrix(4878.2265625, 2179.2001953125), 511, 511),
      layer([86.88006591796875, 0, 0, -tileWidth, 5000.88818359375, 2179.2001953125], 362, 511)]),
    sceneOf([layer(matrix(4387.68408203125, 2056.56005859375), 511, 511),
      layer(matrix(4387.68408203125, 1933.9193115234375), 511, 511)])];
  const seamCases = [];
  for (let index = 0; index < reported.length; index++) {
    const scene = reported[index], seams = buildRasterTileSeams(scene), horizontal = index === 2,
      originalBounds = scene.rasterLayers.map(layer => gpuBounds(layer.matrix));
    assert.equal(seams.size, 2, "the reported satellite neighbors receive seam descriptors");
    const firstEdge = horizontal ? 1 : 2, secondEdge = horizontal ? 3 : 0,
      low = horizontal ? originalBounds[1][3] : originalBounds[0][2],
      high = horizontal ? originalBounds[0][1] : originalBounds[1][0], gap = high - low;
    assert.equal(gap, horizontal ? .0006103515625 : .021484375, "gap widths use the actual Float32 GPU corners");
    assert.equal(seams.get(0).gaps[firstEdge], gap); assert.equal(seams.get(1).gaps[secondEdge], gap);
    assert.equal(seams.get(0).bounds[firstEdge], seams.get(1).bounds[secondEdge], "both sides share precisely one midpoint");
    const midpoint = seams.get(0).bounds[firstEdge];
    close(midpoint, (low + high) / 2, "midpoint rounds only within Float32 storage", horizontal ? .00006103515625 : .000244140625);
    seamCases.push({ scene, seams, originalBounds, horizontal, low, high, gap, midpoint });
  }
  assert.notEqual(seamCases[2].midpoint, (seamCases[2].low + seamCases[2].high) / 2,
    "the horizontal fixture covers an odd-ULP midpoint, so symmetric reconstructed gap endpoints would be wrong");
  const columns = [4387.68408203125, 4510.31103515625, 4632.97265625, 4755.599609375, 4878.2265625, 5000.88818359375],
    tops = [2179.2001953125, 2056.56005859375, 1933.9193115234375, 1811.281005859375], mosaic = [];
  for (let column = 0; column < 6; column++) for (let row = 0; row < 4; row++) mosaic.push(layer([
    column < 5 ? tileWidth : 86.88006591796875, 0, 0, row < 3 ? -tileWidth : -39.599857330322266,
    columns[column], tops[row]], column < 5 ? 511 : 362, row < 3 ? 511 : 165));
  const mosaicSeams = buildRasterTileSeams(sceneOf(mosaic));
  assert.equal(mosaicSeams.size, 20, "the full source mosaic recognizes exposed gaps despite overlaps at other edges");
  for (const column of [1, 4]) for (let row = 0; row < 4; row++) {
    const left = mosaicSeams.get(column * 4 + row), right = mosaicSeams.get((column + 1) * 4 + row);
    assert.equal(left.gaps[2], .021484375); assert.equal(right.gaps[0], .021484375);
    assert.equal(left.bounds[2], right.bounds[0]);
  }
  for (let column = 0; column < 6; column++) {
    assert.equal(mosaicSeams.get(column * 4 + 1).gaps[1], .0006103515625);
    assert.equal(mosaicSeams.get(column * 4 + 2).gaps[3], .0006103515625);
  }
  for (const { seams, originalBounds, horizontal, low, high, gap, midpoint } of seamCases) {
    for (const zoom of [.01, .1, .25, .5, 1, 2, 5, 10, 25, 50, 100, 500]) {
      const footprint = 1 / zoom, radius = Math.ceil(gap * zoom / 2) + 3;
      for (const phase of [0, .1, .25, .49, .5, .75, .9, .999]) {
        let filteredGapArea = 0, oldHardGapArea = 0;
        for (let pixel = -radius; pixel <= radius; pixel++) {
          const position = (low + high) / 2 + (pixel + phase) * footprint,
            owner = horizontal ? (position >= midpoint ? 0 : 1) : (position < midpoint ? 0 : 1),
            point = horizontal ? [(originalBounds[owner][0] + originalBounds[owner][2]) / 2, position]
              : [position, (originalBounds[owner][1] + originalBounds[owner][3]) / 2],
            limit = seams.get(owner).maxFootprint[horizontal ? 1 : 0],
            alpha = at(point, [footprint, footprint], originalBounds[owner], seams.get(owner).gaps, seams.get(owner).maxFootprint);
          const axis = horizontal ? 1 : 0, geometry = seams.get(owner).bounds;
          if (footprint > limit && (position < geometry[axis] || position >= geometry[axis + 2])) continue;
          assert(alpha >= 0 && alpha <= 1, "filtered coverage remains bounded");
          filteredGapArea += (1 - alpha) * footprint;
          oldHardGapArea += position >= low && position < high ? footprint : 0;
          if (footprint > limit) assert.equal(alpha, position >= originalBounds[owner][axis] && position < originalBounds[owner][axis + 2] ? 1 : 0,
            "footprints reaching farther tiles retain the original hard-center gap coverage");
          else if (gap * zoom < 1) assert(alpha >= 1 - gap * zoom - 1e-9, "a subpixel gap cannot flicker into a fully white pixel");
        }
        const limit = seams.get(0).maxFootprint[horizontal ? 1 : 0];
        if (footprint <= limit) close(filteredGapArea, gap, `gap area remains constant at zoom ${zoom}, phase ${phase}`, 1e-8);
        else close(filteredGapArea, oldHardGapArea, "unresolved distant gaps preserve legacy sampling", 1e-8);
        if (footprint <= limit && gap * zoom < .5 && phase === 0) assert(oldHardGapArea > gap,
          "the same centred narrow gap previously exposed a full white pixel");
      }
    }
    const center = (low + high) / 2, point = horizontal ? [originalBounds[0][0] + 1, center] : [center, originalBounds[0][1] + 1];
    assert.equal(at(point, [gap / 4, gap / 4], originalBounds[0], seams.get(0).gaps, seams.get(0).maxFootprint), 0,
      "resolved source gaps remain fully empty at high zoom");
  }
  for (const zoom of [.01, 1, 1000]) for (const point of [[0, 0], [16, 8], [16.125, 8], [8, 16]]) {
    assert.equal(at(point, [1 / zoom, 1 / zoom], [0, 0, 16, 16], [0, 0, 0, 0]), 1,
      "ordinary touching edges and tiles without identified gaps keep their existing coverage");
  }
  for (const zoom of [.1, 1, 10, 100]) for (const phase of [0, .25, .75]) {
    const xGap = .125, yGap = .25, footprint = 1 / zoom, radius = Math.ceil(yGap * zoom / 2) + 3,
      extent = (2 * radius + 1) * footprint;
    let missingArea = 0;
    for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) missingArea +=
      (1 - at([16 + xGap / 2 + (x + phase) * footprint, 16 + yGap / 2 + (y + phase) * footprint],
        [footprint, footprint], [0, 0, 16, 16], [0, 0, xGap, yGap])) * footprint * footprint;
    close(missingArea, xGap * extent + yGap * extent - xGap * yGap,
      "crossing horizontal/vertical gaps preserve their union area without double-counting the corner", 1e-8);
  }
  console.log("Raster tile seams: actual satellite gaps, exact shared bounds, area-preserving zoom/phase filtering, resolved gaps, exclusions and source ownership passed.");
} finally { hooks.deregister(); }
