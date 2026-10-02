import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const { fitRasterSourceToTexture } = await import("../src/rasterTextureFit.ts");

function rgba(width, height, pixel) {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) data.set(pixel(index % width, Math.floor(index / width)), index * 4);
  return data;
}

function testFittingSourceIsUntouched() {
  const source = { width: 4, height: 2, data: rgba(4, 2, () => [1, 2, 3, 255]), matrix: new Float32Array(6) };
  assert.equal(fitRasterSourceToTexture(source, 4), source);
}

function testWideStripIsDownscaledToTheLimit() {
  // A barcode-like 9000x1 strip of alternating black and white bars.
  const source = {
    width: 9000,
    height: 1,
    data: rgba(9000, 1, (x) => (x % 2 === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255])),
    matrix: Float32Array.of(90, 0, 0, 10, 5, 7),
    opacity: 0.5
  };
  const fitted = fitRasterSourceToTexture(source, 8192);
  assert.equal(fitted.width, 8192);
  assert.equal(fitted.height, 1);
  assert.equal(fitted.data.length, 8192 * 4);
  assert.equal(fitted.matrix, source.matrix, "the unit-square placement is kept");
  assert.equal(fitted.opacity, 0.5);
  assert.ok(fitted.data.every((value, index) => index % 4 !== 3 || value === 255), "opaque stays opaque");
}

function testAreaAverageWeightsAlpha() {
  // 4x2 -> 2x1 at limit 2: each target texel averages a 2x2 block.
  const source = {
    width: 4,
    height: 2,
    data: rgba(4, 2, (x) => (x < 2 ? [200, 0, 0, 255] : x === 2 ? [0, 0, 200, 255] : [0, 255, 0, 0]))
  };
  const fitted = fitRasterSourceToTexture(source, 2);
  assert.equal(fitted.width, 2);
  assert.equal(fitted.height, 1);
  assert.deepEqual(Array.from(fitted.data.subarray(0, 4)), [200, 0, 0, 255]);
  // Half the block is transparent green: it must not tint the colour, only lower alpha.
  assert.deepEqual(Array.from(fitted.data.subarray(4, 8)), [0, 0, 200, 128]);
}

try {
  testFittingSourceIsUntouched();
  testWideStripIsDownscaledToTheLimit();
  testAreaAverageWeightsAlpha();
} finally {
  hooks.deregister();
}

console.log("raster texture fit tests passed");
