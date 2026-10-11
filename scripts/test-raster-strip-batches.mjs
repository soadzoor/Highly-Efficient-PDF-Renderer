import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { buildRasterStripBatches } = await import("../src/rasterStripBatches.ts");
  const makeScene = widths => Object.assign(createEmptyVectorScene(), {
    rasterLayers: widths.map((width, index) => makeStrip(width, index)),
    drawRuns: [{ kind: "raster", first: 0, count: widths.length }]
  });
  const scene = makeScene([1, 2, 3, 5, 7, 16, 293, 1024]);
  const original = structuredClone(scene);
  const nearest = makeScene(Array(9).fill(5));
  nearest.rasterLayers[4].interpolate = false;
  assert.deepEqual(buildRasterStripBatches(nearest, 4096).map(({ first, count }) => [first, count]), [[0, 4], [5, 4]],
    "nearest images do not enter a shader that blends texels and mip levels");
  for (const mipFilter of ["box", "linear"]) {
    const [batch] = buildRasterStripBatches(scene, 4096, mipFilter);
    assert.equal(batch.count, scene.rasterLayers.length);
    assert.equal(batch.width, 2048);
    assert.deepEqual(scene, original, "batching never changes canonical images or draw runs");
    for (const [row, source] of scene.rasterLayers.entries()) {
      assert.deepEqual([...batch.instances.slice(row * 8, row * 8 + 6)], [...source.matrix]);
      assert.equal(batch.instances[row * 8 + 6], source.width);
      assert.equal(batch.instances[row * 8 + 7], source.opacity);
      const levels = referenceMips(source, mipFilter);
      let offset = row * batch.width * 4;
      for (const level of levels) {
        assert.deepEqual(batch.data.slice(offset, offset + level.length), level, "each image retains independent premultiplied mip pixels");
        offset += level.length;
      }
      // Compare the atlas address calculation with independently sampled textures,
      // including clamp edges, odd widths, fractional LOD and an adjacent row of
      // unrelated colors. This catches cross-row and cross-mip filtering bleed.
      for (const u of [-0.1, 0, 0.01, 0.25, 0.5, 0.999, 1, 1.1]) {
        for (const lod of [0, 0.25, 1, 1.75, 3.25, 20]) {
          const expected = sampleIndependent(levels, u, lod);
          const actual = sampleAtlas(batch, row, source.width, u, lod);
          actual.forEach((value, index) => assert(Math.abs(value - expected[index]) < 1e-8));
        }
      }
    }
  }

  const odd = makeScene([3, 5, 3, 5]);
  odd.rasterLayers.forEach(source => {
    const gray = source.width === 3 ? [0, 255, 0] : [0, 64, 128, 192, 255];
    gray.forEach((value, x) => source.data.set([value, value, value, 255], x * 4));
  });
  const [box] = buildRasterStripBatches(odd, 4096, "box");
  const [linear] = buildRasterStripBatches(odd, 4096, "linear");
  assert.equal(box.data[3 * 4], 128);
  assert.equal(linear.data[3 * 4], 255, "WebGL's 3-to-1 mip samples the center pixel");
  assert.deepEqual([5, 6, 7].map(x => box.data[(box.width + x) * 4]), [32, 160, 96]);
  assert.deepEqual([5, 6, 7].map(x => linear.data[(linear.width + x) * 4]), [48, 208, 128],
    "odd-width WebGL mips retain the final texel's contribution");

  const ordered = makeScene(Array(18).fill(5));
  ordered.drawRuns = [
    { kind: "raster", first: 0, count: 5, clipIndex: 0, optionalContent: 0 },
    { kind: "fill", first: 0, count: 1 },
    { kind: "raster", first: 5, count: 5, clipIndex: 1, optionalContent: 1 },
    { kind: "raster", first: 10, count: 4, blendMode: "Multiply" },
    { kind: "raster", first: 14, count: 4 }
  ];
  assert.deepEqual(buildRasterStripBatches(ordered, 4096).map(({ first, count }) => [first, count]), [[0, 5], [5, 5], [14, 4]],
    "batches cannot cross vectors, clipping, optional-content or multiply boundaries");
  assert.equal(buildRasterStripBatches({ ...ordered, paintGraph: { roots: [] } }, 4096).length, 0);
  assert.equal(buildRasterStripBatches({ ...ordered, retainedPages: [{}] }, 4096).length, 0);
  assert.equal(buildRasterStripBatches({ ...ordered, drawRuns: undefined }, 4096).length, 0);

  const broken = makeScene(Array(16).fill(5));
  broken.rasterLayers[4].height = 2;
  broken.rasterLayers[10].matrix[0] = NaN;
  assert.deepEqual(buildRasterStripBatches(broken, 4096).map(({ first, count }) => [first, count]), [[0, 4], [5, 5], [11, 5]],
    "ordinary images and unsupported inputs keep their standalone draws");
  assert.equal(buildRasterStripBatches(makeScene([1, 1, 1]), 4096).length, 0);
  const bounded = makeScene(Array(1100).fill(16));
  assert.deepEqual(buildRasterStripBatches(bounded, 4096).map(batch => batch.count), [512, 512, 76]);
  const small = buildRasterStripBatches(bounded, 32);
  assert(small.every(batch => batch.width <= 32 && batch.height <= 32));
  assert.equal(buildRasterStripBatches(bounded, 16).length, 0, "device dimensions constrain atlas eligibility");
  assert.equal(buildRasterStripBatches(bounded, NaN).length, 0);
  const expensive = makeScene([]), largeStrip = makeStrip(1024, 0);
  expensive.rasterLayers = Array(3500).fill(largeStrip);
  expensive.drawRuns = [{ kind: "raster", first: 0, count: 3500 }];
  const limited = buildRasterStripBatches(expensive, 4096);
  assert(limited.reduce((bytes, batch) => bytes + batch.data.byteLength + batch.instances.byteLength, 0) <= 16 * 1024 * 1024);
  assert(limited.reduce((count, batch) => count + batch.count, 0) < 3500, "extra GPU allocations remain bounded; excess images use ordinary draws");

  const sizes = [450, 5, 5, 1464, 110, 45, 111, 46, 111, 45, 110, 45, 111, 45, 110, 45, 111, 36,
    110, 45, 110, 59, 111, 59, 110, 52, 111, 66, 449, 206, 111, 45, 111, 67, 187, 111, 59];
  const dense = makeScene(Array.from({ length: 5184 }, (_, index) => [1, 20, 293, 19, 18, 27, 110][index % 7]));
  let first = 0;
  dense.drawRuns = sizes.flatMap(count => {
    const run = { kind: "raster", first, count }; first += count;
    return [run, { kind: "fill", first: 0, count: 1 }];
  });
  const denseBatches = buildRasterStripBatches(dense, 4096);
  assert.equal(denseBatches.length, 39);
  assert.equal(denseBatches.reduce((total, batch) => total + batch.count, 0), 5184);
  console.log("Raster strip batches: independent filtering, paint boundaries, source preservation, resource limits and 5184-to-39 batching passed.");
} finally { hooks.deregister(); }

function makeStrip(width, index) {
  const data = new Uint8Array(width * 4);
  for (let x = 0; x < width; x++) data.set([(x * 31 + index * 47) % 256, (x * 127 + index) % 256, (x + index * 19) % 256,
    [0, 51, 128, 255][(x + index) % 4]], x * 4);
  return { width, height: 1, data, opacity: 0.5,
    matrix: new Float32Array([width * 0.12, 0.2, 0.1, -0.12, index * 0.25, -index]), pageIndex: 0, paintOrder: index };
}

function referenceMips(source, filter = "box") {
  const pixels = Array.from({ length: source.width }, (_, x) => {
    const [r, g, b, a] = source.data.slice(x * 4, x * 4 + 4);
    return [Math.round(r * a / 255), Math.round(g * a / 255), Math.round(b * a / 255), a];
  });
  const levels = [Uint8Array.from(pixels.flat())];
  let current = pixels;
  while (current.length > 1) {
    const width = Math.floor(current.length / 2);
    current = Array.from({ length: width }, (_, x) => filter === "box"
      ? current[x * 2].map((component, channel) => Math.round((component + current[x * 2 + 1][channel]) / 2))
      // Normalize tiny floating-point errors at exact half-byte ties.
      : sampleLine(current.flat(), 0, current.length, (x + 0.5) / width).map(value => Math.round(value + 1e-9)));
    levels.push(Uint8Array.from(current.flat()));
  }
  return levels;
}

function sampleLine(data, offset, width, u) {
  const position = Math.max(0, Math.min(width - 1, u * width - 0.5));
  const left = Math.floor(position), right = Math.min(width - 1, left + 1), fraction = position - left;
  return Array.from({ length: 4 }, (_, c) => data[offset + left * 4 + c] * (1 - fraction) + data[offset + right * 4 + c] * fraction);
}

function sampleIndependent(levels, u, lod) {
  lod = Math.max(0, Math.min(levels.length - 1, lod));
  const low = Math.floor(lod), high = Math.ceil(lod), fraction = lod - low;
  const a = sampleLine(levels[low], 0, levels[low].length / 4, u);
  const b = sampleLine(levels[high], 0, levels[high].length / 4, u);
  return a.map((v, i) => v * (1 - fraction) + b[i] * fraction);
}

function sampleAtlas(batch, row, sourceWidth, u, lod) {
  lod = Math.max(0, Math.min(Math.floor(Math.log2(sourceWidth)), lod));
  const level = index => {
    let offset = row * batch.width * 4, width = sourceWidth;
    for (let i = 0; i < index; i++) { offset += width * 4; width = Math.floor(width / 2); }
    return sampleLine(batch.data, offset, width, u);
  };
  const a = level(Math.floor(lod)), b = level(Math.ceil(lod)), fraction = lod % 1;
  return a.map((v, i) => v * (1 - fraction) + b[i] * fraction);
}
