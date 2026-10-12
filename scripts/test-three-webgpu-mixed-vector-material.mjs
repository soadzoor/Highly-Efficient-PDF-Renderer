import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { TSL, WGSLNodeBuilder } from "three/webgpu";
import { evaluateWgsl } from "./lib/scalarShaderEval.mjs";

const hooks = registerHooks({ resolve(s, c, next) {
  return next(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const { createThreeWebGpuMixedVectorMaterial } = await import("../src/threeWebGpuBackend.ts");
  const { createThreeWebGpuStrokeMaterial } = await import("../src/threeWebGpuStrokeMaterial.ts");
  const { createThreeWebGpuFillMaterial } = await import("../src/threeWebGpuFillMaterial.ts");
  const { MIN_VECTOR_INDEXED_PATH_SEGMENTS } = await import("../src/vectorFillBands.ts");
  const { initializeThreeVectorClip, createThreeInstanceVectorClipMaterial } = await import("../src/threeVectorClips.ts");
  const { setThreePdfShapeOnly } = await import("../src/threePdfShape.ts");
  const textures = [];
  const texture = () => {
    const value = new THREE.DataTexture(new Float32Array(64), 4, 4, THREE.RGBAFormat, THREE.FloatType);
    value.needsUpdate = true; textures.push(value); return value;
  };
  const options = {
    viewport: new THREE.Vector2(800, 600), cameraCenter: new THREE.Vector2(10, 20),
    localToClip: new THREE.Matrix4(), vectorOverride: new THREE.Vector4(.1, .2, .3, .4), strokeCurveEnabled: true,
    segmentTextureA: texture(), segmentTextureB: texture(), segmentStyleTexture: texture(), segmentBoundsTexture: texture(),
    segmentTextureWidth: 4, fillPathMetaTextureA: texture(), fillPathMetaTextureB: texture(), fillPathMetaTextureC: texture(),
    fillSegmentTextureA: texture(), fillSegmentTextureB: texture(), fillPathTextureWidth: 4, fillSegmentTextureWidth: 4,
    fillBandBase: 8, fillBandEntries: 12, fillCellBase: 20
  };
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute([-1, -1, 1, -1, -1, 1, 1, 1], 2));
  geometry.setAttribute("aVectorIndex", new THREE.InstancedBufferAttribute(Float32Array.of(0, 1, 2, 0), 1));
  geometry.setAttribute("aVectorKind", new THREE.InstancedBufferAttribute(Float32Array.of(0, 1, 0, 1), 1));
  geometry.setAttribute("aVectorClipIndex", new THREE.InstancedBufferAttribute(Float32Array.of(0, 1, 2, 0), 1));
  geometry.setAttribute("aPageIndex", new THREE.InstancedBufferAttribute(Float32Array.of(0, 0, 1, 1), 1));
  geometry.setAttribute("aSegmentIndex", geometry.getAttribute("aVectorIndex"));
  geometry.setAttribute("aFillPathIndex", geometry.getAttribute("aVectorIndex"));
  geometry.setIndex([0, 1, 2, 2, 1, 3]); geometry.instanceCount = 4;
  const pageBinding = { table: { matrices: texture(), parameters: texture() } };
  const tail = { textureA: texture(), textureB: texture(), styleTexture: texture(), boundsTexture: texture(), width: 3, split: 12 };

  for (const colorCompositing of ["display", "linear"]) for (const withPagesAndTail of [false, true]) {
    const input = { ...options, colorCompositing,
      ...(withPagesAndTail ? { segmentTail: tail, pageBinding } : {}) };
    const state = createThreeWebGpuMixedVectorMaterial(input);
    assert.equal(state.material.blending, THREE.CustomBlending);
    assert.equal(state.material.blendSrc, THREE.SrcAlphaFactor);
    assert.equal(state.material.blendDst, THREE.OneMinusSrcAlphaFactor);
    assert.equal(state.material.depthTest, false); assert.equal(state.material.depthWrite, false);
    state.zoomUniform.value = 2.5; state.useLocalToClipUniform.value = 1;
    state.localUnitsPerPixelUniform.value = .4; state.curveUniform.value = 0;
    assert.equal(state.fillRenderingUniform.value, 1); assert.equal(state.strokeRenderingUniform.value, 1);
    state.fillRenderingUniform.value = 0; state.strokeRenderingUniform.value = 1;
    const shaders = build(state.material, geometry), vertex = shaders.vertexShader, fragment = shaders.fragmentShader;
    assert.match(vertex, /aVectorIndex/); assert.match(vertex, /aVectorKind/);
    assert.match(vertex, /fn heprMixedTextureField\s*\(/);
    assert.match(vertex, /if \(kind >= 0\.5\)/, "vertex reads only the selected primitive store");
    assert.match(vertex, /index >= split/, "stroke fields preserve split LOD addressing");
    const reads = [], headTexture = { name: "head", width: 4 }, tailTexture = { name: "tail", width: 3 };
    const fillTexture = { name: "fill", width: 4 };
    const fetch = evaluateWgsl(fnSource(vertex, "heprMixedTextureField"), {
      textureLoad: (source, coordinate) => { reads.push(source.name); return source.name + ":" + (coordinate.y * source.width + coordinate.x); },
      vec4: value => ({ x: value, y: value, z: value, w: value })
    });
    const field = (kind, index, offset = 0) => fetch.heprMixedTextureField(kind, index,
      headTexture, tailTexture, fillTexture, 4, 3, 12, 4, offset);
    assert.equal(field(0, 11), "head:11"); assert.equal(field(0, 12), "tail:0");
    assert.equal(field(0, 17), "tail:5"); assert.equal(field(1, 3, 8), "fill:11");
    assert.deepEqual(reads, ["head", "tail", "tail", "fill"], "each instance reads only its selected head, tail or fill store");
    reads.length = 0;
    assert.deepEqual(field(1, 3, -1), { x: 0, y: 0, z: 0, w: 0 });
    assert.deepEqual(reads, [], "a fill does not need the stroke-only bounds record");
    assert.doesNotMatch(vertex, /hepr(?:MixedCellField|FillBandInfo|FillCellInfo)/,
      "the vertex shader leaves all fill index reads to fragment fallback");
    assert.match(vertex, /heprStrokeWorldPack\(/); assert.match(vertex, /heprFillVertexPack\(/);
    assert.match(vertex, /return vec4<f32>\(pack.xy, 0.0, pack.z\)/, "fill validity becomes the shared W sentinel");
    assert.match(vertex, /select\(fillEnabled, strokeEnabled, kind < 0.5\) < 0.5/,
      "disabled paint kinds reject their vertices without replacing mixed geometry");
    assert.match(vertex, /metaC.x >= 0.0 && useLocalToClip < 0.5/,
      "tighter fill padding requires a closed contour and the ordinary screen transform");
    assert.match(vertex, /0.5 \* fillAAScreenPx/, "wide box filters retain their full half-footprint support");
    assert.match(fragment, /heprCellWinding\(cells, origin, box, footprint/);
    const fillBody = fnBody(fragment, "heprMixedFillFragment");
    assert.match(fillBody, /metaC.x >= 0.0 && all\(metaB.xy - metaA.zw <= footprint\)/,
      "signed-area coverage requires a decoded control hull no larger than the footprint");
    assert(fillBody.indexOf("winding = heprHullAreaWinding(metaC.y, metaA.zw, metaB.xy, box, footprint)") >= 0 &&
      fillBody.indexOf("winding = heprHullAreaWinding(") < fillBody.indexOf("heprFillIndexedWinding("),
      "small-hull integration avoids both index headers and segment textures");
    const indexedBody = fnBody(fragment, "heprFillIndexedWinding");
    assert(indexedBody.indexOf("heprFillCellInfo(") < indexedBody.indexOf("heprCellWinding("));
    assert(indexedBody.indexOf("return heprCellWinding(") < indexedBody.indexOf("heprFillBandInfo("),
      "cell-indexed paths never fetch the band header");
    verifyLazyHeaderReads(fragment, MIN_VECTOR_INDEXED_PATH_SEGMENTS);
    assert.match(fillBody, /select\(metaC.x, -metaC.x - 1.0, metaC.x < 0.0\)/,
      "ineligible open contours retain their original nonzero or even-odd fill rule");
    assert.match(fragment, /heprStrokeLodAlpha\(alpha, primitiveType\)/);
    const mixed = fnBody(fragment, "heprMixedVectorFragment");
    assert(mixed.indexOf("dpdx(local.x)") < mixed.indexOf("if (kind"), "derivatives precede kind selection");
    assert.equal((fragment.match(/dpdx\(/g) ?? []).length, 2);
    assert.equal((fragment.match(/dpdy\(/g) ?? []).length, 2);
    for (const [create, baselineName, mixedName] of [
      [createThreeWebGpuStrokeMaterial, "heprStrokeFragment", "heprMixedStrokeFragment"],
      [createThreeWebGpuFillMaterial, "heprFillFragment", "heprMixedFillFragment"]
    ]) {
      const original = create(input), baseline = build(original.material, geometry).fragmentShader;
      const expected = fnBody(baseline, baselineName)
        .replaceAll("length(vec2<f32>(dpdx(local.x), dpdy(local.x)))", "pixelFootprint.x")
        .replaceAll("length(vec2<f32>(dpdx(local.y), dpdy(local.y)))", "pixelFootprint.y");
      assert.equal(fnBody(fragment, mixedName), expected, "mixed fragments retain exact existing paint and coverage math");
      original.material.dispose();
    }
    assert.equal((fragment.match(/fn heprThreeOutputColor\s*\(/g) ?? []).length, 1);
    assert.equal(fnBody(fragment, "heprThreeOutputColor").includes("pow("), colorCompositing === "linear");
    const varyingStruct = vertex.match(/struct VaryingsStruct \{[\s\S]*?\n\};/)[0];
    const slots = varyingStruct.split("\n").filter(line => line.includes("@location("));
    assert.equal(slots.filter(line => line.includes("@interpolate( flat )")).length, 6,
      "four union records, the primitive kind and integer path address remain flat");
    assert.equal(slots.filter(line => /: i32,/.test(line)).length, 1, "the path address is an integer varying");
    assert.equal(slots.length, 7, "only the shared world pack interpolates");
    if (withPagesAndTail) {
      assert.match(vertex, /heprPageProjection\(/); assert.match(vertex, /heprPageClip\(/);
      assert.match(vertex, /aPageIndex/); assert.doesNotMatch(vertex, /heprPrimitivePage\(/);
      assert.equal((vertex.match(/var \w+ : texture_2d<f32>/g) ?? []).length, 13,
        "split stores, per-page matrices and fill fields stay within the sixteen-texture vertex limit");
    } else {
      assert.equal((vertex.match(/var \w+ : texture_2d<f32>/g) ?? []).length, 7,
        "without split stores only four stroke and three fill metadata textures reach vertices");
    }
    const clipTexture = texture(); initializeThreeVectorClip(state.material, clipTexture);
    const clipped = createThreeInstanceVectorClipMaterial(state.material);
    const clippedShaders = build(clipped, geometry);
    assert.match(clippedShaders.fragmentShader, /heprVectorClip\(/);
    assert.match(clippedShaders.vertexShader, /aVectorClipIndex/, "per-instance clipping follows each mixed paint");
    assert.equal((clippedShaders.fragmentShader.match(/dpdx\(/g) ?? []).length, 2,
      "clip cloning retains the common derivative evaluation");
    const restore = setThreePdfShapeOnly(clipped, true); restore();
    clipped.dispose(); state.material.dispose();
  }
  geometry.dispose(); textures.forEach(value => value.dispose());
  console.log("Three WebGPU mixed vectors: real NodeBuilder shader generation, exact coverage, derivatives, page transforms, split LOD, clips and colors passed.");
} finally { hooks.deregister(); }

function fnBody(source, name) {
  const sourceFunction = fnSource(source, name);
  return sourceFunction.slice(sourceFunction.indexOf("{") + 1, -1);
}
function fnSource(source, name) {
  const match = source.match(new RegExp(`fn ${name}\\s*\\([^]*?\\n}`));
  assert(match, `generated shader includes ${name}`);
  return match[0];
}
function verifyLazyHeaderReads(source, minimumIndexedSegments) {
  // Execute the helpers emitted by the real material. Coverage is stubbed here
  // because this regression checks dispatch/addressing and unnecessary reads;
  // the independent scalar coverage tests check the edge integration itself.
  const reads = [], cells = [], edges = [], poisoned = new Set();
  const vec4 = (x = 0, y = x, z = x, w = x) => ({ x, y, z, w,
    xy: { x, y }, zw: { x: z, y: w } });
  const a = { name: "A", width: 4, records: new Map() }, b = { name: "B", width: 4, records: new Map() };
  const segmentStart = 100;
  for (let offset = 0; offset < minimumIndexedSegments; offset++) {
    const id = segmentStart + offset;
    a.records.set(id, vec4(id, 0, id + 1, 1)); b.records.set(id, vec4(id + .5, .5, 1, 0));
  }
  const helper = evaluateWgsl(["heprFillBandInfo", "heprFillCellInfo", "heprFillIndexedWinding"]
    .map(name => fnSource(source, name)).join("\n"), {
    vec4,
    textureDimensions: texture => ({ x: texture.width }),
    textureLoad: (texture, coordinate) => {
      const id = coordinate.y * texture.width + coordinate.x;
      reads.push(`${texture.name}:${id}`);
      assert(!poisoned.has(`${texture.name}:${id}`), `poisoned index header fetched ${texture.name}:${id}`);
      assert(texture.records.has(id), `unexpected texture read ${texture.name}:${id}`);
      return texture.records.get(id);
    },
    heprCellWinding: (...args) => { cells.push(args); return .375; },
    heprBandRows: (_header, band) => ({ x: .5 * band, y: .5 * (band + 1) }),
    heprSegmentCoverage: (...args) => { edges.push(args); return .125; }
  }).heprFillIndexedWinding;
  const origin = { x: 10, y: 20 }, box = vec4(0, 0, 1, 1), footprint = { x: 1, y: 1 };
  const run = (bandBase = 8, cellHeaders = 21, segmentCount = minimumIndexedSegments) => {
    reads.length = 0; cells.length = 0; edges.length = 0;
    return helper(3, segmentStart, segmentCount, origin, .75, box, footprint, a, b, 4, bandBase, 12, cellHeaders);
  };
  const directReads = count => Array.from({ length: count }, (_, offset) =>
    [`A:${segmentStart + offset}`, `B:${segmentStart + offset}`]).flat();
  a.records.set(23, vec4(40, 2, 1, 1));
  assert.equal(run(), .375);
  assert.deepEqual(reads, ["A:23"], `the ${minimumIndexedSegments}-segment boundary retains cell indexing and skips the band header`);
  assert.equal(cells[0][0], a.records.get(23)); assert.equal(cells[0][1], origin);
  assert.equal(edges.length, 0, "cell dispatch skips linear segment reads");

  a.records.set(23, vec4(0)); a.records.set(11, vec4(0));
  assert.equal(run(), .125 * minimumIndexedSegments);
  assert.deepEqual(reads, ["A:23", "A:11", ...directReads(minimumIndexedSegments)],
    "a missing cell index loads the band header before the original segment range");
  assert.equal(cells.length, 0); assert.equal(edges.length, minimumIndexedSegments);

  assert.equal(run(-1, 0), .125 * minimumIndexedSegments);
  assert.deepEqual(reads, directReads(minimumIndexedSegments), "absent global indexes fetch neither header");

  a.records.set(11, vec4(30, 2, 0, 1));
  a.records.set(30, vec4(0, 1, 0, 0)); a.records.set(31, vec4(1, 1, 0, 0));
  a.records.set(12, [segmentStart, segmentStart + 1, 0, 0]);
  assert.equal(run(), .25);
  assert.deepEqual(reads, ["A:23", "A:11", "A:30", "A:12", `A:${segmentStart}`, `B:${segmentStart}`,
    "A:31", "A:12", `A:${segmentStart + 1}`, `B:${segmentStart + 1}`],
    "band dispatch preserves packed segment addresses and visits each contributing row");
  assert.deepEqual(edges.map(args => args.slice(-2)), [[0, .5], [.5, 1]]);

  poisoned.add("A:23"); poisoned.add("A:11");
  assert.equal(run(8, 21, minimumIndexedSegments - 1), .125 * (minimumIndexedSegments - 1));
  assert.deepEqual(reads, directReads(minimumIndexedSegments - 1),
    `a ${minimumIndexedSegments - 1}-segment path skips poisoned index headers and keeps its original segment range`);
  assert.equal(cells.length, 0); assert.equal(edges.length, minimumIndexedSegments - 1);
}
function build(material, geometry) {
  const renderer = {
    contextNode: TSL.context({}), library: { fromMaterial: value => value }, getRenderTarget: () => null, getMRT: () => null,
    backend: { compatibilityMode: false, utils: { getTextureSampleData: () => ({ primarySamples: 1 }) },
      capabilities: { getUniformBufferLimit: () => 65536 } },
    hasFeature: () => false, hasCompatibility: () => false, coordinateSystem: THREE.WebGPUCoordinateSystem,
    debug: { diagnostics: { keywords: false } }
  };
  const builder = new WGSLNodeBuilder(new THREE.Mesh(geometry, material), renderer);
  builder.scene = new THREE.Scene(); builder.camera = new THREE.PerspectiveCamera(); return builder.build();
}
