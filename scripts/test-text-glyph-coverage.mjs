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
    /queryLocal\s*=.*localDx\s*\+\s*0\.37\s*\*\s*localDy/,
    `${relativePath} must reuse derivatives evaluated before divergent shader control flow`
  );
}

console.log("Text glyph overlap coverage tests passed");
