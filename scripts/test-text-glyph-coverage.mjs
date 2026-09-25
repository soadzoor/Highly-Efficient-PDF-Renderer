import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import { FILL_COVERAGE_GLSL, FILL_COVERAGE_WGSL } from "../src/fillCoverageShaders.ts";
import { evaluateGlsl, evaluateWgsl } from "./lib/scalarShaderEval.mjs";

// Glyph outlines are filled with the shared box-filter coverage. Evaluate the
// shipped functions on overlapping and thin contours in footprint space.
const rect = (x0, y0, x1, y1) => [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]];
const box = { x: 0, y: 0, z: 1, w: 1 };
for (const [name, shader] of [["GLSL", evaluateGlsl(FILL_COVERAGE_GLSL)], ["WGSL", evaluateWgsl(FILL_COVERAGE_WGSL)]]) {
  const glyph = edges => shader.heprFillCoverage(edges.reduce((sum, [x0, y0, x1, y1]) =>
    sum + shader.heprSegmentCoverage({ x: x0, y: y0 }, { x: x0, y: y0 }, { x: x1, y: y1 }, false, box, 0, 1), 0), false);
  const stem = rect(-3, -3, 0.5, 3);
  // A same-direction contour ending inside another is an overlap-only edge:
  // nonzero fill stays opaque across it.
  assert.equal(glyph([...rect(-3, -3, 3, 3), ...rect(0.5, -3, 3, 3)]), 1, `${name}: 1 -> 2 overlap edges stay opaque`);
  assert.equal(glyph([...rect(-3, -3, 3, 3), ...rect(-3, -3, 0.5, 3)]), 1, `${name}: 2 -> 1 overlap edges stay opaque`);
  // An exterior edge is antialiased once by the area it covers.
  assert(Math.abs(glyph(stem) - 0.5) < 1e-12, `${name}: exterior edges antialias by covered area`);
  assert(Math.abs(glyph(rect(-3, -3, 0.5, 3).map(([x0, y0, x1, y1]) => [x1, y1, x0, y0])) - 0.5) < 1e-12,
    `${name}: exterior edges antialias regardless of contour direction`);
  // Opposite contours on the same outline cancel to an empty glyph.
  assert.equal(glyph([...stem, ...stem.map(([x0, y0, x1, y1]) => [x1, y1, x0, y0])]), 0,
    `${name}: cancelled coincident contours stay empty`);
  // Coincident same-direction exterior edges saturate like other area
  // rasterizers: never lighter than one edge, never above full coverage.
  const doubled = glyph([...stem, ...stem]);
  assert(doubled >= 0.5 && doubled <= 1, `${name}: coincident exterior edges stay antialiased and bounded`);
  // A glyph stem thinner than a pixel keeps its ink rather than snapping.
  for (const width of [0.05, 0.2, 0.6]) {
    for (const offset of [0, 0.3, 0.9]) {
      assert(Math.abs(glyph(rect(offset - 0.5, -3, offset - 0.5 + width, 3)) -
        Math.max(0, Math.min(offset - 0.5 + width, 1) - Math.max(offset - 0.5, 0))) < 1e-12,
        `${name}: a ${width}px stem at ${offset} covers its area`);
    }
  }
}

// Minified glyphs render as their box at mean ink density, like coarse text
// LOD runs: ink area over box area, written into meta B's spare component.
{
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
        !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  } });
  try {
    const { writeTextGlyphInkDensities } = await import("../src/textGreekLod.ts");
    const line = (x0, y0, x1, y1) => [x0, y0, x0, y0, x1, y1, 0, 0];
    const outlines = [
      [line(0, 0, 1, 0), line(1, 0, 1, 1), line(1, 1, 0, 1), line(0, 1, 0, 0)],
      [line(0, 0, 4, 0), line(4, 0, 0, 2), line(0, 2, 0, 0)],
      // A ring: outer square with an opposite-direction square hole.
      [line(0, 0, 4, 0), line(4, 0, 4, 4), line(4, 4, 0, 4), line(0, 4, 0, 0),
        line(1, 1, 1, 3), line(1, 3, 3, 3), line(3, 3, 3, 1), line(3, 1, 1, 1)],
      [line(0, 0, 2, 0), line(2, 0, 0, 0)]
    ];
    const bounds = [[0, 0, 1, 1], [0, 0, 4, 2], [0, 0, 4, 4], [0, 0, 2, 0]];
    const metaA = [], metaB = [], segmentsA = [], segmentsB = [];
    outlines.forEach((segments, glyph) => {
      metaA.push(segmentsA.length / 4, segments.length, bounds[glyph][0], bounds[glyph][1]);
      metaB.push(bounds[glyph][2], bounds[glyph][3], 0, 0);
      for (const segment of segments) { segmentsA.push(...segment.slice(0, 4)); segmentsB.push(...segment.slice(4)); }
    });
    const densities = Float32Array.from(metaB);
    writeTextGlyphInkDensities(outlines.length, Float32Array.from(metaA), densities,
      Float32Array.from(segmentsA), Float32Array.from(segmentsB));
    assert.deepEqual([0, 1, 2, 3].map(glyph => densities[glyph * 4 + 2]), [1, 0.5, 0.75, 0],
      "glyph ink density is outline area over box area, with holes and degenerate boxes");
    assert.deepEqual([0, 1, 2, 3].map(glyph => densities[glyph * 4]), [1, 4, 4, 2], "glyph bounds stay untouched");
  } finally { hooks.deregister(); }
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const read = relativePath => readFile(path.resolve(scriptDir, relativePath), "utf8");
for (const relativePath of ["../src/webGlFloorplanRenderer.ts", "../src/webGpuFloorplanRenderer.ts", "../src/threeWebGpuTextMaterial.ts"]) {
  const source = await read(relativePath);
  const language = relativePath.includes("webGl") ? "GLSL" : "WGSL";
  assert(source.includes(`FILL_COVERAGE_${language}`), `${relativePath} includes the shared glyph filter`);
  assert.match(source, /heprFillCoverage\(winding, false\)/, `${relativePath} fills glyphs with the nonzero rule`);
  assert.match(source, /heprSegmentCoverage\([^;]*(?:uTextCurveEnabled|uCamera\.textCurveEnabled|textCurveEnabled) >= 0\.5/,
    `${relativePath} honours the text curve toggle`);
  assert.match(source, /footprint = max\(vec2(?:f|<f32>)?\(pixelToLocalX, pixelToLocalY\)/,
    `${relativePath} reuses derivatives evaluated before divergent shader control flow`);
  assert.match(source, /heprCoverageMargin\(/, `${relativePath} widens glyph quads to reach subpixel glyphs`);
  assert.match(source, /TEXT_RASTER_ATLAS_PADDING_PX - 0\.5/,
    `${relativePath} lets the widened quad sample the atlas tile's transparent padding`);
  assert.doesNotMatch(source, /nearestSeparatesFill|coincidentEpsilon/, `${relativePath} has no nearest-edge glyph filter left`);
  // Glyphs a few pixels across render as their ink-density box and gain their
  // shape as they grow, so exact text matches coarse LOD runs where they meet.
  assert.match(source, /detail = clamp\(\(glyphPixels - 2\.5\) \/ 2\.5, 0\.0, 1\.0\)/,
    `${relativePath} fades glyph shape in from 2.5 to 5 pixels`);
  assert.match(source, /(?:vInkDensity|inData\.inkDensity|inkDensity), 0\.0, 1\.0\) \* boxOverlap\.x \* boxOverlap\.y/,
    `${relativePath} covers minified glyphs with their box at mean ink density`);
  assert.match(source, /coverage = mix\(coverage, detailCoverage, detail\)/, `${relativePath} blends detail in continuously`);
  // Mips coarser than the tile padding mix in neighbouring glyphs' ink.
  assert.match(source, /mipCap = min\(1\.0, \$\{TEXT_RASTER_ATLAS_PADDING_PX\}\.0 \//,
    `${relativePath} caps atlas mips at the tile padding`);
}
for (const relativePath of ["../src/webGlFloorplanRenderer.ts", "../src/webGpuFloorplanRenderer.ts", "../src/threeMaterialTextLayer.ts"]) {
  assert.match(await read(relativePath), /writeTextGlyphInkDensities\(/, `${relativePath} uploads glyph ink densities`);
}

const threeWebGpuSource = await read("../src/threeWebGpuTextMaterial.ts");
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

const threeMaterialSource = await read("../src/threeMaterialTextLayer.ts");
assert.doesNotMatch(threeMaterialSource, /uTextLodBlend|setTextLodBlend/, "Three WebGL must preserve the public core text shader contract");

const threeRawShaderColorSpaceSource = await read("../src/threeRawShaderColorSpace.ts");
assert.match(
  threeMaterialSource,
  /normalizeThreeTextRawFragmentShaderSource\(CORE_TEXT_FRAGMENT_SHADER_SOURCE\)/,
  "Three WebGL must normalize the shared core text fragment shader"
);
assert.doesNotMatch(
  threeRawShaderColorSpaceSource,
  /useWebGpuTextWinding|HEPR_THREE_TEXT_WINDING_SUBDIVISIONS/,
  "Three WebGL must not replace the shared glyph coverage with a segmented approximation"
);
assert.match(
  threeRawShaderColorSpaceSource,
  /useGammaCorrectTextCoverage\(source\)/,
  "Three WebGL text normalization must preserve the core filter while adapting coverage output"
);

console.log("Text glyph area coverage tests passed");
