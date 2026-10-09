import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { evaluateWgsl } from "./lib/scalarShaderEval.mjs";
import { VECTOR_FILL_BAND_INFO_WGSL } from "../src/vectorFillBandShaders.ts";
import { VECTOR_FILL_CELL_INFO_WGSL } from "../src/vectorCellShaders.ts";

/**
 * A uniform declared in both stages of a program must resolve to the same
 * precision, or linking fails outright - and GLSL ES makes that easy to get
 * wrong, because `int` defaults to highp in a vertex shader and mediump in a
 * fragment one. Nothing else here can catch it: the shaders only link on a
 * GPU, so a mismatch reaches the browser as a blank canvas.
 *
 * Texel indices into the geometry stores also outrun mediump's guaranteed
 * 16-bit range, so highp is a correctness requirement for them, not a
 * preference.
 */
const root = fileURLToPath(new URL("../src/", import.meta.url));
const shaders = new Map();
for (const file of ["nativeWebGlCoreShaders.ts", "nativeGradientWebGlShaders.ts",
  "rasterStripWebGlShaders.ts", "rasterAtlasWebGlShaders.ts", "rasterTextureBatchWebGlShaders.ts", "primitiveHighlightShaders.ts"]) {
  const text = readFileSync(root + file, "utf8");
  for (const [, name, body] of text.matchAll(/(?:export )?const (\w+) = `(#version 300 es[\s\S]*?)`;/g)) {
    shaders.set(name, body);
  }
}

const family = (type) =>
  /^(float|vec[234]|mat[234])$/.test(type) ? "float"
  : /^(int|ivec[234]|uint|uvec[234])$/.test(type) ? "int"
  : /sampler/.test(type) ? "sampler" : null;

/** Language defaults, then whatever the shader declares over them. */
const defaultPrecision = (source, stage) => {
  const precision = stage === "vertex"
    ? { float: "highp", int: "highp", sampler: "lowp" }
    : { float: "none", int: "mediump", sampler: "lowp" };
  for (const [, declared, type] of source.matchAll(/precision\s+(lowp|mediump|highp)\s+(\w+)\s*;/g)) {
    const group = family(type);
    if (group) precision[group] = declared;
  }
  return precision;
};

const uniformsOf = (source, stage) => {
  const precision = defaultPrecision(source, stage);
  const found = new Map();
  const pattern = /uniform\s+(?:(lowp|mediump|highp)\s+)?([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*;/g;
  for (const [, explicit, type, name] of source.matchAll(pattern)) {
    const group = family(type);
    if (group) found.set(name, `${explicit ?? precision[group]} ${type}`);
  }
  return found;
};

// Every program the WebGL renderer links, by the sources it is built from.
const programs = [
  ["VERTEX_SHADER_SOURCE", "FRAGMENT_SHADER_SOURCE"],
  ["FILL_VERTEX_SHADER_SOURCE", "FILL_FRAGMENT_SHADER_SOURCE"],
  ["TEXT_VERTEX_SHADER_SOURCE", "TEXT_FRAGMENT_SHADER_SOURCE"],
  ["BLIT_VERTEX_SHADER_SOURCE", "VECTOR_COMPOSITE_FRAGMENT_SHADER_SOURCE"],
  ["RASTER_VERTEX_SHADER_SOURCE", "RASTER_FRAGMENT_SHADER_SOURCE"],
  ["HIGHLIGHT_VERTEX_SHADER_SOURCE", "HIGHLIGHT_FRAGMENT_SHADER_SOURCE"],
  ["GRADIENT_FILL_VERTEX_SHADER_SOURCE", "GRADIENT_FILL_FRAGMENT_SHADER_SOURCE"],
  ["GRADIENT_STROKE_VERTEX_SHADER_SOURCE", "GRADIENT_STROKE_FRAGMENT_SHADER_SOURCE"],
  ["RASTER_STRIP_VERTEX_GLSL", "RASTER_STRIP_FRAGMENT_GLSL"],
  ["RASTER_ATLAS_VERTEX_GLSL", "RASTER_ATLAS_FRAGMENT_GLSL"],
  ["RASTER_TEXTURE_BATCH_VERTEX_GLSL", "RASTER_TEXTURE_BATCH_FRAGMENT_GLSL"],
  ["PRIMITIVE_HIGHLIGHT_VERTEX_GLSL", "PRIMITIVE_HIGHLIGHT_FRAGMENT_GLSL"]
];

let shared = 0;
for (const [vertexName, fragmentName] of programs) {
  // A rename must break this rather than quietly drop a program's coverage.
  assert(shaders.has(vertexName), `${vertexName} is no longer a recognisable shader source`);
  assert(shaders.has(fragmentName), `${fragmentName} is no longer a recognisable shader source`);
  const vertex = uniformsOf(shaders.get(vertexName), "vertex");
  const fragment = uniformsOf(shaders.get(fragmentName), "fragment");
  for (const [name, declared] of vertex) {
    if (!fragment.has(name)) continue;
    shared++;
    assert.equal(fragment.get(name), declared,
      `${vertexName}/${fragmentName}: uniform ${name} is "${declared}" in the vertex stage ` +
      `and "${fragment.get(name)}" in the fragment stage, which cannot link`);
  }
}
assert(shared > 0, "the scan found no shared uniforms at all, so it is checking nothing");

// The band index addresses texels well past mediump's guaranteed range.
for (const [name, stage] of [["FILL_VERTEX_SHADER_SOURCE", "vertex"], ["FILL_FRAGMENT_SHADER_SOURCE", "fragment"],
  ["GRADIENT_FILL_VERTEX_SHADER_SOURCE", "vertex"], ["GRADIENT_FILL_FRAGMENT_SHADER_SOURCE", "fragment"]]) {
  assert.equal(defaultPrecision(shaders.get(name), stage).int, "highp",
    `${name} must resolve int to highp: it indexes segment-store texels`);
}

// Exact Float32 integers need no rounding bias. Above 2^23, adding 0.5
// rounds an odd address to the next integer before the shader converts it.
const helpers = evaluateWgsl(VECTOR_FILL_BAND_INFO_WGSL + VECTOR_FILL_CELL_INFO_WGSL, {
  toInt: value => Math.trunc(Math.fround(value)),
  textureDimensions: texture => ({ x: texture.width }),
  textureLoad: (texture, coordinate) => coordinate.y * texture.width + coordinate.x
});
const texture = { width: 4096 };
for (const address of [2 ** 23 - 1, 2 ** 23 + 1, 2 ** 24 - 1]) {
  assert.equal(helpers.heprFillBandInfo(1, address - 1, texture), address,
    "band records preserve high odd texture addresses");
  assert.equal(helpers.heprFillCellInfo(0, address + 1, texture), address,
    "cell records preserve high odd texture addresses");
}
for (const file of ["nativeWebGlCoreShaders.ts", "nativeGradientWebGlShaders.ts", "nativeGradientWebGpuShaders.ts",
  "webGpuFloorplanRenderer.ts", "threeWebGpuFillMaterial.ts", "threeWebGpuTextMaterial.ts",
  "threeWebGpuGradientMaterial.ts", "threeWebGpuStrokeMaterial.ts", "threeTriangleStrokeLayer.ts",
  "threeMaterialGradientLayer.ts"]) {
  assert.doesNotMatch(readFileSync(root + file, "utf8"), /\b(?:int|i32)\([A-Za-z_]\w*(?:\.[xyzw])? \+ 0\.5\)/,
    `${file}: exact stored integer indices must not be biased during decoding`);
}

console.log(`WebGL shader precision: ${programs.length} programs, ${shared} shared uniforms agree across stages`);
