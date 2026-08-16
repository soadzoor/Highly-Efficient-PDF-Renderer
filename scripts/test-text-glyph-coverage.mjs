import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function midpointCoverage(winding, sideMultiplicity) {
  const inside = winding !== 0;
  const acrossWinding = winding - sideMultiplicity;
  const nearestSeparatesFill = inside !== (acrossWinding !== 0);
  return nearestSeparatesFill ? 0.5 : (inside ? 1 : 0);
}

function coverageAcrossTransition(winding, acrossWinding) {
  return midpointCoverage(winding, winding - acrossWinding);
}

for (const [winding, acrossWinding] of [[1, 2], [2, 1], [-1, -2], [-2, -1]]) {
  assert.equal(
    coverageAcrossTransition(winding, acrossWinding),
    1,
    `${winding} -> ${acrossWinding} overlap transitions must stay opaque`
  );
}

for (const [winding, acrossWinding] of [
  [0, 1], [1, 0], [0, -1], [-1, 0],
  [0, 2], [2, 0], [0, -2], [-2, 0]
]) {
  assert.equal(
    coverageAcrossTransition(winding, acrossWinding),
    0.5,
    `${winding} -> ${acrossWinding} exterior transitions must be antialiased once`
  );
}

assert.equal(coverageAcrossTransition(0, 0), 0, "cancelled coincident contours must stay empty");

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const shaderFiles = [
  "../src/webGlFloorplanRenderer.ts",
  "../src/webGpuFloorplanRenderer.ts",
  "../src/threeWebGpuTextMaterial.ts"
];

for (const relativePath of shaderFiles) {
  const source = await readFile(path.resolve(scriptDir, relativePath), "utf8");
  assert.match(source, /nearestSideMultiplicity/, `${relativePath} must aggregate coincident edges`);
  assert.match(source, /bothInterior/, `${relativePath} must not group adjacent contour endpoints`);
  assert.match(source, /abs\(normalAlignment\)\s*>=\s*0\.9999/, `${relativePath} must group only collinear edges`);
  assert.match(
    source,
    /else if \(distanceInfo\.x < minDistance\)/,
    `${relativePath} must replace a closer non-coincident near-tie`
  );
  assert.match(
    source,
    /acrossWinding\s*=\s*winding\s*-\s*nearestSideMultiplicity/,
    `${relativePath} must classify nonzero-fill transitions across the nearest edge group`
  );
  assert.match(source, /nearestSeparatesFill/, `${relativePath} must suppress overlap-only edge AA`);
  assert.match(
    source,
    /localPerPixel\s*=\s*length\(vec2(?:f|<f32>)?\(pixelToLocalX,\s*pixelToLocalY\)\)/,
    `${relativePath} must use a conservative Frobenius bound for primitive culling`
  );
  assert.match(
    source,
    /dot\(localDx,\s*nearestNormal\).*dot\(localDy,\s*nearestNormal\)/s,
    `${relativePath} must project final AA derivatives onto the nearest edge normal`
  );
  assert.match(
    source,
    /smoothstep\(-(?:edge|normal)AAWidth,\s*(?:edge|normal)AAWidth,\s*signedDistance\)/,
    `${relativePath} must use the directional width for final edge coverage`
  );
  assert.match(
    source,
    /queryLocal\s*=.*localDx\s*\+\s*0\.37\s*\*\s*localDy/,
    `${relativePath} must reuse derivatives evaluated before divergent shader control flow`
  );
}

const threeWebGpuSource = await readFile(
  path.resolve(scriptDir, "../src/threeWebGpuTextMaterial.ts"),
  "utf8"
);
const threeWebGpuFragment = threeWebGpuSource.slice(
  threeWebGpuSource.indexOf("const textFragmentFn"),
  threeWebGpuSource.indexOf("`, [", threeWebGpuSource.indexOf("const textFragmentFn"))
);
const threeWebGpuRasterBranch = threeWebGpuFragment.indexOf("if (vectorOnly < 0.5");
const threeWebGpuFirstAtlasTap = threeWebGpuFragment.indexOf("textureSampleGrad(");

assert.doesNotMatch(threeWebGpuSource, /lodBlend|coarseFlag/, "Three WebGPU text must not cross-fade representations");
assert.match(
  threeWebGpuFragment,
  /let atlasPixelsDx = dpdx\(atlasPixels\);[\s\S]*?let mipBiasedUvDx = atlasPixelsDx \* texel \* 0\.420448/,
  "Three WebGPU must evaluate derivatives before applying the previous mip bias to explicit gradients"
);
assert.ok(
  threeWebGpuRasterBranch >= 0 && threeWebGpuFirstAtlasTap > threeWebGpuRasterBranch,
  "Three WebGPU glyph-atlas taps must be inside the minified-raster branch"
);
assert.equal(
  threeWebGpuFragment.match(/textureSampleGrad\(/g)?.length,
  5,
  "Three WebGPU must retain the five-tap raster coverage filter"
);
assert.doesNotMatch(
  threeWebGpuSource,
  /sampleRasterAtlasCoverage|rasterCenterTap|textureSampleBias\(/,
  "Three WebGPU must not build unconditional glyph-atlas taps"
);

const threeMaterialSource = await readFile(
  path.resolve(scriptDir, "../src/threeMaterialTextLayer.ts"),
  "utf8"
);
assert.doesNotMatch(threeMaterialSource, /uTextLodBlend|setTextLodBlend/, "Three WebGL must preserve the public core text shader contract");

console.log("Text glyph overlap coverage tests passed");
