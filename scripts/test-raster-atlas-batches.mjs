import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { buildRasterAtlasBatches } = await import("../src/rasterAtlasBatches.ts");
  const makeScene = sizes => Object.assign(createEmptyVectorScene(), {
    rasterLayers: sizes.map(([w, h], i) => image(w, h, i)),
    drawRuns: sizes.map((_, first) => ({ kind: "raster", first, count: 1 })),
    paintGraph: { roots: [] }
  });
  const scene = makeScene([[1, 1], [3, 5], [5, 3], [16, 4], [1, 1024], [1024, 1], [7, 9], [2, 2]]);
  const original = structuredClone(scene);
  const batches = buildRasterAtlasBatches(scene, 4096);
  assert.equal(batches.reduce((n, batch) => n + batch.count, 0), scene.rasterLayers.length);
  for (const batch of batches) {
    assert(batch.width <= 2048 && batch.height <= 2048);
    for (let i = 0; i < batch.count; i++) {
      const source = scene.rasterLayers[batch.first + i], meta = batch.instances.slice(i * 12, i * 12 + 12);
      assert.deepEqual(meta.slice(0, 6), source.matrix);
      assert.equal(meta[6], source.opacity);
      assert.deepEqual([...meta.slice(10)], [source.width, source.height]);
      const levels = referenceMips(source);
      let offset = meta[8];
      for (const level of levels) {
        for (let y = 0; y < level.height; y++) {
          const start = ((meta[9] + y) * batch.width + offset) * 4;
          assert.deepEqual([...batch.data.slice(start, start + level.width * 4)], level.pixels.slice(y * level.width * 4, (y + 1) * level.width * 4));
        }
        offset += level.width;
      }
      for (const u of [-0.1, 0, 0.1, 0.5, 0.999, 1, 1.1]) {
        for (const v of [-0.1, 0, 0.3, 0.999, 1, 1.1]) {
          for (const requested of [0, 0.25, 1, 1.75, 5.5, 20]) {
            const lod = Math.min(levels.length - 1, requested), low = Math.floor(lod), high = Math.ceil(lod);
            const a = sample(levels[low], u, v), b = sample(levels[high], u, v);
            const expected = a.map((value, c) => value * (1 - lod + low) + b[c] * (lod - low));
            const actual = sampleAtlas(batch, meta, u, v, lod);
            actual.forEach((value, c) => assert(Math.abs(value - expected[c]) < 1e-8,
              "independent bilinear/trilinear filtering cannot bleed between images or mip rectangles"));
          }
        }
      }
    }
  }
  assert.deepEqual(scene, original, "atlas packing preserves canonical images and paint order");
  const broken = makeScene(Array(16).fill([5, 3]));
  broken.rasterLayers[4].width = 1025;
  broken.rasterLayers[10].matrix[0] = NaN;
  assert.deepEqual(buildRasterAtlasBatches(broken, 4096).map(b => [b.first, b.count]), [[0, 4], [5, 5], [11, 5]]);
  const excluded = new Set([4, 10]);
  assert.deepEqual(buildRasterAtlasBatches(makeScene(Array(16).fill([5, 3])), 4096, excluded).map(b => [b.first, b.count]),
    [[0, 4], [5, 5], [11, 5]], "existing strip resources and gaps are never included");
  assert.equal(buildRasterAtlasBatches({ ...scene, retainedPages: [{}] }, 4096).length, 0);
  assert.equal(buildRasterAtlasBatches({ ...scene, drawRuns: undefined }, 4096).length, 0);
  assert.equal(buildRasterAtlasBatches(scene, NaN).length, 0);
  assert.equal(buildRasterAtlasBatches(makeScene(Array(3).fill([2, 2])), 4096).length, 0);
  const small = buildRasterAtlasBatches(makeScene(Array(40).fill([2, 2])), 16);
  assert(small.length && small.every(b => b.width <= 16 && b.height <= 16));
  const dense = makeScene(Array(3204).fill([20, 2]));
  assert.deepEqual(buildRasterAtlasBatches(dense, 4096).map(b => b.count), [512, 512, 512, 512, 512, 512, 132]);
  const expensive = makeScene([]);
  expensive.rasterLayers = Array(100).fill(image(512, 512, 0));
  const limited = buildRasterAtlasBatches(expensive, 4096);
  assert(limited.length && limited.reduce((n, b) => n + b.count, 0) < 100);
  assert(limited.reduce((n, b) => n + b.data.byteLength + b.instances.byteLength, 0) <= 16 * 1024 * 1024);
  const many = makeScene([]);
  many.rasterLayers = Array(20_000).fill(image(1, 1, 0));
  assert.equal(buildRasterAtlasBatches(many, 4096).reduce((n, b) => n + b.count, 0), 16_384,
    "tiny images also have a bounded instance/lookup count");
  console.log("Raster image atlases: independent 2D filtering, odd sizes, alpha, source preservation, exclusions and resource limits passed.");
} finally { hooks.deregister(); }

function image(width, height, index) {
  return { width, height, data: Uint8Array.from({ length: width * height * 4 }, (_, c) =>
    c % 4 === 3 ? [0, 51, 128, 255][(Math.floor(c / 4) + index) % 4] : (c * 17 + index * 83) % 256),
  matrix: Float32Array.of(width, 0.2, 0.1, -height, index, 20), opacity: 0.5, pageIndex: 0, paintOrder: index };
}

function referenceMips(source) {
  const levels = [{ width: source.width, height: source.height, pixels: [...source.data].map((v, i) =>
    i % 4 === 3 ? v : Math.round(v * source.data[i - i % 4 + 3] / 255)) }];
  while (levels.at(-1).width > 1 || levels.at(-1).height > 1) {
    const previous = levels.at(-1), width = Math.max(1, Math.floor(previous.width / 2)), height = Math.max(1, Math.floor(previous.height / 2));
    const pixels = Array.from({ length: width * height }, (_, i) =>
      sample(previous, (i % width + 0.5) / width, (Math.floor(i / width) + 0.5) / height).map(v => Math.round(v + 1e-9))).flat();
    levels.push({ width, height, pixels });
  }
  return levels;
}

function sample({ pixels, width, height }, u, v) {
  const x = Math.max(0, Math.min(width - 1, u * width - 0.5)), y = Math.max(0, Math.min(height - 1, v * height - 0.5));
  const x0 = Math.floor(x), x1 = Math.min(x0 + 1, width - 1), y0 = Math.floor(y), y1 = Math.min(y0 + 1, height - 1);
  return Array.from({ length: 4 }, (_, c) => {
    const a = pixels[(y0 * width + x0) * 4 + c] * (1 - x + x0) + pixels[(y0 * width + x1) * 4 + c] * (x - x0);
    const b = pixels[(y1 * width + x0) * 4 + c] * (1 - x + x0) + pixels[(y1 * width + x1) * 4 + c] * (x - x0);
    return a * (1 - y + y0) + b * (y - y0);
  });
}

function sampleAtlas(batch, meta, u, v, lod) {
  const level = index => {
    let width = meta[10], height = meta[11], offset = meta[8];
    for (let step = 0; step < index; step++) { offset += width; width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2)); }
    const pixels = Array.from({ length: height }, (_, y) => [...batch.data.slice(((meta[9] + y) * batch.width + offset) * 4,
      ((meta[9] + y) * batch.width + offset + width) * 4)]).flat();
    return sample({ pixels, width, height }, u, v);
  };
  const a = level(Math.floor(lod)), b = level(Math.ceil(lod)), f = lod % 1;
  return a.map((value, c) => value * (1 - f) + b[c] * f);
}
