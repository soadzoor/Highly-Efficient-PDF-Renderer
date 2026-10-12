import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { evaluateGlsl, evaluateWgsl } from "./lib/scalarShaderEval.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });

try {
  const { FILL_FRAGMENT_SHADER_SOURCE: glsl, FILL_VERTEX_SHADER_SOURCE: vertex } =
    await import("../src/nativeWebGlCoreShaders.ts");
  const { FILL_COVERAGE_GLSL, FILL_COVERAGE_WGSL } = await import("../src/fillCoverageShaders.ts");
  const { vectorFillBandLoopWgsl } = await import("../src/vectorFillBandShaders.ts");
  const { MIN_VECTOR_INDEXED_PATH_SEGMENTS } = await import("../src/vectorFillBands.ts");
  assert.equal(MIN_VECTOR_INDEXED_PATH_SEGMENTS, 24, "the optimization keeps the existing index-builder threshold");
  const nativeGpu = await readFile(new URL("../src/webGpuFloorplanRenderer.ts", import.meta.url), "utf8");
  const gpuFill = nativeGpu.slice(nativeGpu.indexOf("const FILL_SHADER_SOURCE"), nativeGpu.indexOf("const TEXT_SHADER_SOURCE"));
  // Expand the actual production band-loop template rather than reproducing it.
  const wgsl = functionSource(gpuFill, "heprFillIndexedWinding")
    .replaceAll("${MIN_VECTOR_INDEXED_PATH_SEGMENTS}", String(MIN_VECTOR_INDEXED_PATH_SEGMENTS)).replace(
    /\$\{(vectorFillBandLoopWgsl\([\s\S]*?\n\s*\}\))\}/,
    (_, call) => new Function("vectorFillBandLoopWgsl", `return ${call};`)(vectorFillBandLoopWgsl)
  ).replace(/\bvec([24])f\b/g, "vec$1<f32>");
  assert.doesNotMatch(wgsl, /\$\{/, "the evaluated WGSL has its production loop expanded");
  assert.match(glsl, /flat in int vFillPathIndex;/, "GLSL preserves the path index in an integer varying");
  assert.match(wgsl, /heprFillIndexedWinding\(pathIndex: i32, segmentStart: i32, segmentCount: i32/,
    "WGSL keeps all source addresses integer-valued");

  for (const name of ["GLSL", "WGSL"]) {
    const source = name === "GLSL" ? functionSource(glsl, "heprFillIndexedWinding") : wgsl;
    const rows = functionSource(name === "GLSL" ? FILL_COVERAGE_GLSL : FILL_COVERAGE_WGSL, "heprBandRows");
    const reads = [], cellCalls = [], edgeCalls = [];
    const recordsA = new Map(), recordsB = new Map();
    const textureA = { name: "A", width: 97, records: recordsA };
    const textureB = { name: "B", width: 97, records: recordsB };
    const state = { cellHeaders: 121, bandBase: 500, bandEntries: 700 };
    const origin = { x: 10, y: 20 }, box = { x: 0, y: .5, z: 1, w: 1 }, footprint = { x: 1, y: 1 };
    const fetch = (texture, coord) => {
      const index = coord.y * texture.width + coord.x;
      reads.push([texture.name, index]);
      assert(texture.records.has(index), `${name}: unexpected ${texture.name} texture read at ${index}`);
      return texture.records.get(index);
    };
    // Cell and edge coverage are independently tested. Here their spies make
    // index dispatch, addresses and per-band row ranges observable.
    const extras = {
      uFillSegmentTexA: textureA, uFillSegmentTexB: textureB,
      uFillSegmentTexSize: { x: 97, y: 97 },
      uCamera: {
        get fillCells() { return { x: state.cellHeaders }; },
        get fillBands() { return { x: state.bandBase, y: state.bandEntries }; }
      },
      coordFromIndex: (index, size) => {
        const width = typeof size === "number" ? size : size.x;
        return { x: index % width, y: Math.trunc(index / width) };
      },
      texelFetch: fetch, textureLoad: fetch,
      textureDimensions: texture => ({ x: texture.width }),
      vec4: vector, toFloat: Math.fround,
      FILL_PRIMITIVE_QUADRATIC: 1,
      heprCellWinding: (header, cellOrigin, cellBox, cellFootprint, ...textures) => {
        cellCalls.push({ header, origin: cellOrigin, box: cellBox, footprint: cellFootprint, textures });
        return .375;
      },
      heprSegmentCoverage: (a, control, b, quadratic, edgeBox, low, high) => {
        edgeCalls.push({ a, control, b, quadratic, box: edgeBox, low, high });
        return (b.x - a.x) * (high - low);
      }
    };
    // GLSL uniforms are scalar values; getters passed as a wrapper keep the
    // evaluated production helper attached to the mutable fixture state.
    const uniformWrapper = name === "GLSL" ? `
float heprTestWinding(int pathIndex, int segmentStart, int segmentCount, vec2 origin, vec4 box, vec2 footprint) {
  uFillCellHeaders = state.cellHeaders;
  uFillBandBase = state.bandBase;
  uFillBandEntries = state.bandEntries;
  return heprFillIndexedWinding(pathIndex, segmentStart, segmentCount, origin, box, footprint);
}
` : "";
    const shader = name === "GLSL"
      ? evaluateGlsl(rows + source + uniformWrapper, { ...extras, state,
        uFillCellHeaders: 0, uFillBandBase: -1, uFillBandEntries: 0 })
      : evaluateWgsl(rows + source, extras);
    const winding = (pathIndex = 17, segmentStart = 30, segmentCount = MIN_VECTOR_INDEXED_PATH_SEGMENTS) => name === "GLSL"
      ? shader.heprTestWinding(pathIndex, segmentStart, segmentCount, origin, box, footprint)
      : shader.heprFillIndexedWinding(pathIndex, segmentStart, segmentCount, origin, box, footprint, box.y + .5 * footprint.y);
    const reset = () => { reads.length = 0; cellCalls.length = 0; edgeCalls.length = 0; recordsA.clear(); recordsB.clear(); };
    const segment = (index, delta, quadratic = false) => {
      recordsA.set(index, vector(0, 0, .25, .75));
      recordsB.set(index, vector(delta, 1, quadratic ? 1 : 0, 0));
    };
    const directSegments = (start = 30, count = MIN_VECTOR_INDEXED_PATH_SEGMENTS) => {
      for (let i = 0; i < count; i++) segment(start + i, i === 0 ? .25 : i === 1 ? -.5 : 0, i === 1);
    };
    const assertDirect = (start, count = MIN_VECTOR_INDEXED_PATH_SEGMENTS) => {
      assert.equal(edgeCalls.length, count);
      assert.deepEqual(edgeCalls.map(edge => [edge.low, edge.high, edge.quadratic]),
        Array.from({ length: count }, (_, i) => [0, 1, i === 1]));
      assert(edgeCalls.every(edge => edge.box === box));
      assert.deepEqual(reads.slice(reads.length - count * 2),
        Array.from({ length: count }, (_, i) => [["A", start + i], ["B", start + i]]).flat());
      assert.equal(cellCalls.length, 0);
    };

    recordsA.set(137, vector(900, 2, 1, 1));
    assert.equal(winding(), .375);
    assert.deepEqual(reads, [["A", 137]], `${name}: a cell index avoids the band header and direct segments`);
    assert.equal(cellCalls.length, 1);
    assert.equal(cellCalls[0].origin, origin); assert.equal(cellCalls[0].box, box); assert.equal(cellCalls[0].footprint, footprint);
    assert.deepEqual(cellCalls[0].textures, name === "WGSL" ? [textureA, textureB] : []);
    assert.equal(edgeCalls.length, 0);

    reset(); recordsA.set(137, vector(0)); recordsA.set(517, vector(0)); directSegments();
    assert.equal(winding(), -.25);
    assert.deepEqual(reads.slice(0, 2), [["A", 137], ["A", 517]], `${name}: a missing cell index tries bands next`);
    assertDirect(30);

    reset(); state.cellHeaders = 0; state.bandBase = -1; directSegments();
    assert.equal(winding(), -.25);
    assert.equal(reads.length, MIN_VECTOR_INDEXED_PATH_SEGMENTS * 2, `${name}: disabled stores load only the direct geometry`);
    assertDirect(30);

    reset(); state.cellHeaders = 121; recordsA.set(137, vector(0)); directSegments();
    assert.equal(winding(), -.25);
    assert.deepEqual(reads[0], ["A", 137]);
    assert.equal(reads.length, MIN_VECTOR_INDEXED_PATH_SEGMENTS * 2 + 1, `${name}: disabled bands need no band header`);
    assertDirect(30);

    reset(); state.cellHeaders = 0; state.bandBase = 500;
    recordsA.set(517, vector(600, 2, 0, 1));
    recordsA.set(600, vector(3, 2, 0, 0)); recordsA.set(601, vector(5, 1, 0, 0));
    recordsA.set(700, vector(0, 0, 0, 10)); recordsA.set(701, vector(11, 12, 0, 0));
    segment(10, .25); segment(11, .5, true); segment(12, -.125);
    assert.equal(winding(), .3125);
    assert.deepEqual(reads, [["A", 517], ["A", 600], ["A", 700], ["A", 10], ["B", 10],
      ["A", 701], ["A", 11], ["B", 11], ["A", 601], ["A", 701], ["A", 12], ["B", 12]],
    `${name}: the band path preserves packed entry addressing and reads no cell header`);
    assert.deepEqual(edgeCalls.map(edge => [edge.low, edge.high, edge.quadratic]), [[0, .5, false], [0, .5, true], [.5, 1, false]],
      `${name}: repeated band membership integrates only each band's rows`);
    assert.equal(cellCalls.length, 0);

    for (const count of [0, 1, 2, 23, 24]) {
      reset(); state.cellHeaders = 121; state.bandBase = 500;
      directSegments(30, count);
      // Enabled stores deliberately have unavailable headers below the minimum:
      // any accidental lookup throws before the direct scan can hide it.
      if (count === 24) { recordsA.set(137, vector(0)); recordsA.set(517, vector(0)); }
      assert.equal(winding(17, 30, count), count === 0 ? 0 : count === 1 ? .25 : -.25);
      assertDirect(30, count);
      const headers = reads.slice(0, reads.length - count * 2);
      assert.deepEqual(headers, count === 24 ? [["A", 137], ["A", 517]] : [],
        `${name}: ${count} segments ${count < 24 ? "bypass" : "consult"} the enabled index stores`);
    }

    const largePath = 16777217;
    const largeStart = largePath + 100;
    reset(); state.cellHeaders = 3; state.bandBase = 8;
    recordsA.set(largePath + 2, vector(900, 2, 1, 1));
    assert.equal(winding(largePath), .375);
    assert.deepEqual(reads, [["A", 16777219]], `${name}: odd header addresses above 2^24 stay integers`);
    reset(); recordsA.set(largePath + 2, vector(0)); recordsA.set(largePath + 8, vector(0)); directSegments(largeStart);
    assert.equal(winding(largePath, largeStart), -.25);
    assert.deepEqual(reads.slice(0, 2), [["A", 16777219], ["A", 16777225]]);
    assertDirect(largeStart);
  }

  const glMain = functionSource(glsl, "main"), gpuMain = functionSource(gpuFill, "fsMain");
  assert.doesNotMatch(glMain, /texelFetch\(uFillSegmentTex[AB]/, "GLSL's main defers all segment-store reads to its helper");
  assert.doesNotMatch(gpuMain, /textureLoad\(uFillSegmentTex[AB]/, "WGSL's main defers all segment-store reads to its helper");
  assert.doesNotMatch(functionSource(gpuFill, "vsMain"), /textureLoad\(uFillSegmentTex[AB]/,
    "WGSL fill vertices do not read either index store");
  for (const [name, source, area] of [["GLSL", glMain, "winding = vFillSignedArea * box.z * box.w"],
    ["WGSL", gpuMain, "winding = inData.signedArea * box.z * box.w"]]) {
    assert(source.indexOf(area) >= 0 && source.indexOf(area) < source.indexOf("heprFillIndexedWinding("),
      `${name}: whole-path area is evaluated before any index lookup`);
    assert.match(source, /\}\s*else\s*\{\s*winding = heprFillIndexedWinding\(/,
      `${name}: only the missed whole-area case enters the index helper`);
  }
  assert.doesNotMatch(vertex, /uFillBandBase|uFillCellHeaders/, "fill vertices do not load either index header");

  console.log("Fill index deferral passed: small-path bypass, lazy headers, cell/band/direct fallback, band rows and integer addresses.");
} finally {
  hooks.deregister();
}

function functionSource(source, name) {
  const match = new RegExp(`\\b(?:float|vec2|void|fn)\\s+${name}\\s*\\(`).exec(source);
  assert(match, `${name} exists in the production shader`);
  const open = source.indexOf("{", match.index);
  let depth = 1, end = open + 1;
  for (; depth && end < source.length; end++) {
    if (source[end] === "{") depth++;
    if (source[end] === "}") depth--;
  }
  assert.equal(depth, 0, `${name} has a complete body`);
  return source.slice(match.index, end);
}

function vector(x, y = x, z = x, w = x) {
  return { x, y, z, w, xy: { x, y }, zw: { x: z, y: w }, 0: x, 1: y, 2: z, 3: w };
}
