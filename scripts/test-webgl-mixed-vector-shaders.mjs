import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const { MIXED_VECTOR_VERTEX_SHADER_SOURCE: vertex, MIXED_VECTOR_FRAGMENT_SHADER_SOURCE: fragment,
    MIXED_VECTOR_KIND_ATTRIBUTE, MIXED_VECTOR_VARYING_VECTORS } = await import("../src/nativeWebGlMixedVectorShaders.ts");
  const { pdfShapeCoverageGlsl } = await import("../src/pdfShapeCoverage.ts");
  const { multiplyFragmentGlsl } = await import("../src/vectorMultiply.ts");
  const { paintFoldFragmentGlsl } = await import("../src/nativePaintFold.ts");

  assert.equal(MIXED_VECTOR_KIND_ATTRIBUTE, 5);
  for (const [location, name] of [[0, "aCorner"], [1, "aVectorIndex"], [4, "aVectorClipIndex"], [5, "aVectorKind"]]) {
    assert.match(vertex, new RegExp(`layout\\(location = ${location}\\) in \\w+ ${name};`));
  }
  assert.doesNotMatch(vertex, /aSegmentIndex|aFillPathIndex/);
  const outputs = declarations(vertex, "out"), inputs = declarations(fragment, "in");
  assert.equal(outputs.size, MIXED_VECTOR_VARYING_VECTORS);
  assert.deepEqual(inputs, outputs, "packed varying names, integer types and interpolation agree across stages");
  assert.equal(inputs.get("vMixedSegments"), "flat ivec3", "fill addresses and path IDs retain integer precision above 2^24");

  // Execute the generated pack/unpack entry points, including both kinds and
  // integer fill addresses that cannot be represented by a float varying.
  const fields = {
    vP0: vec(1, 2), vP1: vec(3, 4), vP2: vec(5, 6), vPrimitiveType: -3,
    vIsHairline: 1, vHalfWidth: 0.75, vHasClipBounds: 1, vClipBounds: vec(-4, -5, 8, 9),
    vFillPathIndex: 16777221,
    vFillOrigin: vec(20, 21), vFillBoundsMax: vec(22, 23), vFillSignedArea: -.25,
    vFillRule: 1, vSegmentStart: 16777217, vSegmentCount: 16777219,
    vMixedA: null, vMixedB: null, vMixedC: null, vMixedD: null, vMixedSegments: null,
    vVectorKind: 0, vLocal: vec(2, 3), heprMixedLocalPerPixel: null,
    uMixedVectorEnabled: vec(1, 1), gl_Position: vec(0, 0, 0, 1),
    vColor: vec(1, 1, 1), vAlpha: 1, vVectorClipIndex: -1
  };
  for (const kind of [0, 1]) {
    const packed = runEntry(vertex, { ...fields, aVectorKind: kind });
    const restored = runEntry(fragment, { ...fields, ...packed });
    assert.equal(restored.painted, kind ? "fill" : "stroke");
    for (const name of kind
      ? ["vFillPathIndex", "vFillOrigin", "vFillBoundsMax", "vFillSignedArea", "vFillRule", "vSegmentStart", "vSegmentCount"]
      : ["vP0", "vP1", "vP2", "vPrimitiveType", "vIsHairline", "vHalfWidth", "vHasClipBounds", "vClipBounds"]) {
      assert.deepEqual(restored[name], fields[name], `${name} survives the shared payload`);
    }
  }
  for (const kind of [0, 1]) {
    const disabled = runEntry(vertex, { ...fields, aVectorKind: kind,
      uMixedVectorEnabled: kind ? vec(1, 0) : vec(0, 1) });
    assert.deepEqual(disabled.gl_Position, vec(-2, -2, 0, 1), "disabled vectors leave the viewport before geometry fetches");
    assert.equal(disabled.painted, undefined, "disabled vectors do not call either geometry branch");
  }

  const main = functionBody(fragment, "main");
  assert(main.indexOf("dFdx(vLocal.x)") < main.indexOf("if (vVectorKind"));
  assert.equal((fragment.match(/dFdx\(/g) ?? []).length, 2);
  assert.equal((fragment.match(/dFdy\(/g) ?? []).length, 2,
    "coverage derivatives are evaluated once before branch helpers can discard");
  for (const name of ["heprVectorClip", "heprThreeEncodeOutputColor", "heprThreeLinearCoverageToOutputAlpha"]) {
    assert.equal((fragment.match(new RegExp(`(?:float|vec4) ${name}\\(`, "g")) ?? []).length, 1,
      `${name} has one shared definition`);
  }
  assert.match(fragment, /heprStrokeLodAlpha\(alpha, vPrimitiveType\)/);
  assert.match(fragment, /heprCellWinding\(vFillCells, origin, box, footprint\)/);
  assert.doesNotMatch(vertex, /uniform (?:sampler2D uFillSegmentTexA|int uFillBandBase|int uFillCellHeaders)/,
    "the vertex stage needs no fill spatial-index store");
  assert.match(fragment, /heprSegmentCoverage\(primitiveA.xy, primitiveA.zw, primitiveB.xy,/);
  assert.match(fragment, /vFillRule >= 0.0 && all\(lessThanEqual\(vFillBoundsMax - vFillOrigin, footprint\)\)/);
  assert.match(fragment, /winding = heprHullAreaWinding\(vFillSignedArea, vFillOrigin, vFillBoundsMax, box, footprint\);/);
  assert.doesNotMatch(fragment, /\bpacked\b/, "the mixed shader avoids a reserved GLES identifier");

  const shapedVertex = pdfShapeCoverageGlsl(vertex), shapedFragment = pdfShapeCoverageGlsl(fragment);
  assert.match(shapedVertex, /alpha <= 0.001 && uPdfShapeOnly < 0.5/);
  for (const name of ["heprMixedStrokeFragment", "heprMixedFillFragment"]) {
    assert.match(functionBody(shapedFragment, name), /mix\(vAlpha, 1.0, uPdfShapeOnly\)/,
      "the existing shape-only transform reaches both branches");
  }
  for (const wrapped of [multiplyFragmentGlsl(fragment, true), paintFoldFragmentGlsl(fragment, false)]) {
    assert.equal((wrapped.match(/void main\(/g) ?? []).length, 1, "paint wrappers retain one public entry point");
    assert.match(pdfShapeCoverageGlsl(wrapped), /uniform float uPdfShapeOnly;/);
  }
  console.log("WebGL mixed vector shaders: shared interface, lossless payload, derivatives and paint transforms passed");
} finally {
  hooks.deregister();
}

function declarations(source, direction) {
  return new Map([...source.matchAll(new RegExp(`^(flat )?${direction} (\\w+) (\\w+);$`, "gm"))]
    .map(([, flat, type, name]) => [name, `${flat ?? ""}${type}`]));
}

function functionBody(source, name) {
  const first = source.indexOf(`void ${name}()`), start = source.indexOf("{", first);
  assert(first >= 0 && start >= 0, `${name} exists`);
  let depth = 1, end = start + 1;
  while (depth && end < source.length) {
    if (source[end] === "{") depth++;
    if (source[end] === "}") depth--;
    end++;
  }
  assert.equal(depth, 0);
  return source.slice(start + 1, end - 1);
}

function vec(...values) {
  const entries = values.flatMap(value => typeof value === "number" ? [value] : Object.values(value));
  return Object.fromEntries(entries.map((value, index) => ["xyzw"[index], value]));
}

function runEntry(source, fields) {
  const swizzled = value => {
    if (value && typeof value === "object") {
      Object.defineProperties(value, {
        xy: { get: () => vec(value.x, value.y), configurable: true },
        zw: { get: () => vec(value.z, value.w), configurable: true }
      });
    }
    return value;
  };
  const constructor = (...values) => swizzled(vec(...values));
  const keys = Object.keys(fields).filter(name => name !== "painted");
  return new Function(...keys, "vec2", "vec3", "vec4", "ivec3", "length", `
    let painted;
    function heprMixedStrokeVertex() { painted = "stroke"; }
    function heprMixedFillVertex() { painted = "fill"; }
    function heprMixedStrokeFragment() { painted = "stroke"; }
    function heprMixedFillFragment() { painted = "fill"; }
    function dFdx() { return 0.25; }
    function dFdy() { return 0.5; }
    ${functionBody(source, "main").replace(/\breturn;/g, "return { gl_Position, painted };")}
    return { ${keys.join(", ")}, painted };
  `)(...keys.map(name => swizzled(fields[name])), constructor, constructor, constructor,
    (...values) => constructor(...(values.length === 1 ? [values[0], values[0], values[0]] : values)),
    value => Math.hypot(...Object.values(value)));
}
