import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { evaluateGlsl } from "./lib/scalarShaderEval.mjs";
import { FILL_COVERAGE_GLSL } from "../src/fillCoverageShaders.ts";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const { WebGlFloorplanRenderer: Renderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { packVectorClips, vectorClipChainBounds, UNBOUNDED_VECTOR_CLIP_BOUNDS } = await import("../src/vectorClips.ts");
  const { VECTOR_INSTANCE_CLIP_GLSL } = await import("../src/vectorClipShaders.ts");
  const { RenderPerformanceProfiler } = await import("../src/renderPerformance.ts");
  const source = await readFile(new URL("../src/nativeWebGlCoreShaders.ts", import.meta.url), "utf8");
  const vertex = source.match(/const FILL_VERTEX_SHADER_SOURCE = `([\s\S]*?)`;/)[1];
  const boundsSource = vertex.match(/vec4 heprFillQuadBounds\([\s\S]*?\n}/)[0];
  const lookupSource = vertex.match(/vec4 heprFillInstanceClipBounds\([\s\S]*?\n}/)[0];
  const { heprFillQuadBounds } = evaluateGlsl(boundsSource);
  const coverage = evaluateGlsl(FILL_COVERAGE_GLSL);
  const vec = ([x, y, z, w]) => ({ x, y, z, w });
  const array = v => [v.x, v.y, v.z, v.w];
  const quad = (paint, clip, zoom = 1) => array(heprFillQuadBounds(vec(paint), vec(paint.slice(2)),
    vec([1 / zoom, 1 / zoom]), vec(clip)));
  const rectangle = (minX, minY, maxX, maxY) => polygon([
    [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]
  ]);
  const clips = [
    { parent: -1, fillRule: 0, edges: rectangle(20, 20, 80, 80) },
    { parent: 0, fillRule: 1, edges: polygon([[30, 10], [60, 90], [30, 90]]) },
    { parent: 0, fillRule: 0, edges: rectangle(90, 90, 100, 100) },
    { parent: -1, fillRule: 0, edges: new Float32Array(0) },
    { parent: 0, fillRule: 0, edges: polygon(Array.from({ length: 128 }, (_, i) =>
      [50 + 20 * Math.cos(i * Math.PI / 64), 50 + 20 * Math.sin(i * Math.PI / 64)])) }
  ];
  const original = packVectorClips(clips, undefined, { cells: true });
  assert(original[4 * 4 + 3] >= 4, "fixture includes an indexed polygon clip");
  const mock = mockGl();
  const r = Object.assign(Object.create(Renderer.prototype), {
    gl: mock.gl, vectorClipUniforms: new Map(), paintShapeUniforms: new Map(),
    orderedUniformPrograms: new Set(), orderedPaintUniformStates: new Map(),
    orderedClipStates: new Map(), orderedTextureBindings: [], orderedInstanceVaos: new Set(),
    fillProgram: "fill", fillVao: "vao", allFillPathIdBuffer: "canonical", orderedInstanceBuffer: "ordered",
    uFillClipBoundsEnabled: "uFillClipBoundsEnabled", uFillClipBoundsTex: "uFillClipBoundsTex",
    fillClipBoundsUnit: 26, vectorOverrideColor: [0, 0, 0],
    vectorOverrideOpacity: 0, frameDrawCalls: 0, zoom: 1
  });
  const scene = Object.assign(createEmptyVectorScene(), { clipPaths: clips, fillPathCount: 5,
    fillPathMetaA: new Float32Array(20), fillPathMetaB: new Float32Array(20), fillPathMetaC: new Float32Array(20) });
  const paints = [[0, 0, 100, 100], [0, 0, 100, 100], [0, 0, 100, 100],
    [90, 90, 100, 100], [19.75, 30, 19.9, 70]];
  paints.forEach(([minX, minY, maxX, maxY], id) => {
    scene.fillPathMetaA.set([0, 4, minX, minY], id * 4);
    scene.fillPathMetaB.set([maxX, maxY, 0, 0], id * 4);
    scene.fillPathMetaC[id * 4 + 3] = 1;
  });
  const canonical = structuredClone(scene);
  r.scene = scene; r.fillPathCount = scene.fillPathCount;
  r.uploadVectorClips(scene);
  const [upload, boundsUpload] = mock.uploads;
  assert(r.vectorClipBoundsTexture);
  assert.equal(r.vectorClipStoreTexels, original.length / 4);
  assert.deepEqual(upload.data.slice(0, original.length), original, "all original clip offsets and indexed payloads survive");
  assert.deepEqual(boundsUpload.data.slice(0, clips.length * 4), vectorClipChainBounds(clips));
  assert.deepEqual(r.vectorClipHeaders, original.slice(0, clips.length * 4));
  assert.deepEqual(scene, canonical, "bounding does not alter canonical geometry");

  // Execute the shipped lookup, including the indirect clip root and sampler
  // addressing. Unclipped instances must never read their neighbour's bounds.
  let reads = 0;
  const lookup = (root, instanceRoot, projected = 0, enabled = 1) =>
    array(evaluateGlsl(lookupSource, {
      uVectorClipIndex: root, uUseLocalToClip: projected, uFillClipBoundsEnabled: enabled,
      uFillClipBoundsTex: boundsUpload,
      textureSize: texture => ({ x: texture.width, y: texture.height }),
      coordFromIndex: (index, size) => ({ x: index % size.x, y: Math.floor(index / size.x) }),
      texelFetch: (texture, point) => {
        reads++;
        return vec(texture.data.slice((point.y * texture.width + point.x) * 4,
          (point.y * texture.width + point.x) * 4 + 4));
      }
    }).heprFillInstanceClipBounds(instanceRoot));
  assert.deepEqual(lookup(0, 1), [20, 20, 80, 80], "direct draws use their uniform clip root");
  assert.deepEqual(lookup(-2, 1), [30, 20, 60, 80], "indirect draws use each instance's nested clip");
  assert.equal(reads, 2);
  assert.deepEqual(lookup(-2, -1), UNBOUNDED_VECTOR_CLIP_BOUNDS);
  assert.deepEqual(lookup(-1, 0), UNBOUNDED_VECTOR_CLIP_BOUNDS);
  assert.deepEqual(lookup(-2, 1, 1), UNBOUNDED_VECTOR_CLIP_BOUNDS, "projected views retain their original quad expansion");
  assert.deepEqual(lookup(-2, 1, 0, 0), UNBOUNDED_VECTOR_CLIP_BOUNDS, "full stores retain exact clipping with original quads");
  assert.equal(reads, 2, "disabled bounds do not add vertex texture reads");
  assert.deepEqual(quad(paints[0], lookup(-2, 1)), [29, 19, 61, 81]);
  for (const clip of [lookup(-2, 2), lookup(-2, 3)]) {
    const result = quad(paints[0], clip);
    assert(result.every(Number.isFinite) && result[0] > result[2], "empty chains cull without NaN coordinates");
  }
  assert.deepEqual(quad(paints[0], lookup(-2, -1)), [-1, -1, 101, 101]);
  assert.match(vertex, /vFillOrigin = minBounds;/, "the cell grid keeps its canonical path origin");
  assert.match(vertex, /heprFillInstanceClipBounds\(vVectorClipIndex\)/);
  assert.match(vertex, /vVectorClipIndex = aVectorClipIndex - 1\.0;/);
  assert.match(source, /outColor \*= heprVectorClip\(vLocal\);/, "exact fragment clipping remains active");
  assert.match(VECTOR_INSTANCE_CLIP_GLSL, /uVectorClipIndex < -1\.5 \? vVectorClipIndex : uVectorClipIndex/);
  for (const declaration of ["uniform float uVectorClipIndex;"]) {
    assert(vertex.includes(declaration) && VECTOR_INSTANCE_CLIP_GLSL.includes(declaration), "shared clip uniforms agree across shader stages");
  }
  assert.match(vertex, /uniform highp sampler2D uFillClipBoundsTex;/);

  // Exact shipped area coverage must survive quad shrinking, even when a
  // pixel's footprint reaches a thin fill lying just outside the clip bounds.
  const nearEdge = quad(paints[4], [20, 20, 80, 80]);
  assert(nearEdge[0] < nearEdge[2], "expand before rejecting a paint/clip intersection");
  let nonzero = 0;
  for (const paint of [paints[0], paints[4], [19.95, 19.95, 20.05, 20.05]]) {
    const edges = rectangle(...paint);
    for (const zoom of [0.126, 1, 4]) for (const evenOdd of [false, true]) {
      const bounded = quad(paint, [20, 20, 80, 80], zoom);
      const unbounded = quad(paint, UNBOUNDED_VECTOR_CLIP_BOUNDS, zoom);
      // Sample both clip boundaries at subpixel phases rather than just well
      // inside the fill, where missing AA fringes would go unnoticed.
      for (const edgeX of [20, 80]) for (const edgeY of [20, 40, 80]) {
        for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
          const x = edgeX + (i + 0.125) / zoom, y = edgeY + (j + 0.375) / zoom;
          const box = { x: x - 0.5 / zoom, y: y - 0.5 / zoom, z: zoom, w: zoom };
          let winding = 0;
          for (let e = 0; e < edges.length; e += 4) winding += coverage.heprSegmentCoverage(
            vec(edges.slice(e, e + 2)), vec(edges.slice(e, e + 2)), vec(edges.slice(e + 2, e + 4)), false, box, 0, 1);
          const alpha = coverage.heprFillCoverage(winding, evenOdd) *
            (x >= 20 && x < 80 && y >= 20 && y < 80 ? 1 : 0);
          const before = contains(unbounded, x, y) ? alpha : 0;
          const after = contains(bounded, x, y) ? alpha : 0;
          assert.equal(after, before, "bounding preserves exact fill coverage at clip edges");
          if (before > 0) nonzero++;
        }
      }
    }
  }
  assert(nonzero > 0, "coverage comparison must include visible ink");

  // Real submissions/profile code resolve nonconsecutive canonical IDs and
  // multiple roots from an indirect range with a nonzero starting offset.
  const entries = [[2, -1], [0, 1], [4, 0], [3, 0], [1, 0], [0, 2], [0, 3]];
  const instances = new Uint32Array([99, 99, ...entries.flatMap(([id, clip]) => [id, clip + 1])]);
  r.orderedBatches = { uintInstances: instances }; r.vectorClipIndex = -2;
  const profile = new RenderPerformanceProfiler({ now: () => 0 });
  r.performanceProfiler = profile;
  profile.start({ gpu: false }); profile.beginFrame();
  assert.equal(r.drawFilledPaths(100, 100, 50, 50, 1, 1, entries.length), entries.length);
  profile.endFrame();
  const counts = profile.getReport().frameRecords[0].counters;
  const area = bounds => bounds[0] > bounds[2] || bounds[1] > bounds[3] ? 0 :
    Math.max(0, Math.min(100, Math.ceil(bounds[2])) - Math.max(0, Math.floor(bounds[0]))) *
    Math.max(0, Math.min(100, Math.ceil(bounds[3])) - Math.max(0, Math.floor(bounds[1])));
  const expectedBefore = entries.reduce((sum, [id]) => sum + area(quad(paints[id], UNBOUNDED_VECTOR_CLIP_BOUNDS)), 0);
  const expectedAfter = entries.reduce((sum, [id, clip]) => sum + area(quad(paints[id], lookup(-2, clip))), 0);
  assert.equal(counts.fillUnclippedQuadPixelsEstimate, expectedBefore);
  assert.equal(counts.fillQuadPixelsEstimate, expectedAfter);
  assert(expectedAfter < expectedBefore / 2, "fixture removes substantial fill shading area");
  assert.equal(counts.fillClipBoundedInstances, 6);
  assert.equal(counts.fillClipCulledInstances, 3);
  assert.equal(counts.fillClipBoundsTestedInstances, 6);
  assert.equal(mock.uniforms.get("uFillClipBoundsEnabled"), 1);
  assert.equal(mock.uniforms.get("uFillClipBoundsTex"), 26);
  assert.deepEqual(mock.draws.at(-1), [4, entries.length], "clip bounding retains one ordered instanced draw");
  assert.equal(mock.attributes.get(3).at(-1), 8, "canonical IDs read the selected indirect offset");
  assert.equal(mock.attributes.get(4).at(-1), 12, "clip IDs read the matching indirect offset");

  r.vectorClipIndex = 1; r.resetOrderedState();
  profile.beginFrame(); r.drawFilledPaths(100, 100, 50, 50, 1, 2, 1); profile.endFrame();
  assert.equal(profile.getReport().frameRecords[1].counters.fillQuadPixelsEstimate, 32 * 62);
  r.scene = { ...scene, fillPathMetaC: scene.fillPathMetaC.slice() };
  r.scene.fillPathMetaC[2 * 4 + 3] = 0;
  r.paintShapeOnly = true;
  profile.beginFrame(); r.drawFilledPaths(100, 100, 50, 50, 1, 2, 1); profile.endFrame();
  assert.equal(profile.getReport().frameRecords[2].counters.fillQuadPixelsEstimate, 32 * 62,
    "transparent knockout shape passes still contribute their bounded geometry");
  r.paintShapeOnly = false; r.scene = scene;
  r.localToClipRenderingEnabled = true;
  profile.beginFrame(); r.drawFilledPaths(100, 100, 50, 50, 1, 2, 1); profile.endFrame();
  assert.equal(profile.getReport().frameRecords[3].counters.fillQuadPixelsEstimate, 0,
    "a metric from earlier frames contributes zero when the projected frame omits it");
  r.localToClipRenderingEnabled = false;
  profile.stop();
  const diagnostics = r.profileFillQuadAreas;
  r.profileFillQuadAreas = () => { throw new Error("ordinary rendering must not scan fill instances for diagnostics"); };
  r.drawFilledPaths(100, 100, 50, 50, 1);
  r.profileFillQuadAreas = diagnostics;

  // Reproduce the previous failure: the clip store consumes its entire GPU
  // capacity. Independent bounds must stay available and still shrink fills.
  mock.maxSize = 2;
  const smallClips = [{ ...clips[0], edges: rectangle(10, 10, 90, 90) }, { ...clips[0], parent: 0 }];
  r.uploadVectorClips({ ...scene, clipPaths: smallClips });
  assert(r.vectorClipBoundsTexture);
  assert.equal(r.vectorClipStoreTexels, mock.maxSize ** 2);
  assert.deepEqual(mock.uploads.at(-2).data, packVectorClips(smallClips, undefined, { cells: true }));
  assert.deepEqual(mock.uploads.at(-1).data, vectorClipChainBounds(smallClips));
  r.vectorClipIndex = 1;
  profile.start({ gpu: false }); profile.beginFrame();
  r.drawFilledPaths(100, 100, 50, 50, 1, 2, 1); profile.endFrame();
  const fullStore = profile.getReport().frameRecords[0].counters;
  assert.equal(fullStore.fillQuadPixelsEstimate, 62 * 62);
  assert.equal(fullStore.fillClipBoundedInstances, 1);

  // Allocation failure retains exact clipping and original quads, and emits
  // a diagnostic instead of preventing the document from rendering.
  mock.failTextureAfter = 1;
  const warn = console.warn, warnings = [];
  console.warn = (...args) => warnings.push(args);
  try { r.uploadVectorClips({ ...scene, clipPaths: smallClips }); }
  finally { console.warn = warn; }
  assert.equal(r.vectorClipBoundsTexture, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /drawing original fill quads/);
  profile.start({ gpu: false }); profile.beginFrame();
  r.drawFilledPaths(100, 100, 50, 50, 1, 2, 1); profile.endFrame();
  const fallback = profile.getReport().frameRecords[0].counters;
  assert.equal(fallback.fillQuadPixelsEstimate, fallback.fillUnclippedQuadPixelsEstimate);
  assert.equal(fallback.fillClipBoundedInstances, 0);
  assert.equal(mock.uniforms.get("uFillClipBoundsEnabled"), 0);
  r.uploadVectorClips({ ...scene, clipPaths: [] });
  assert.equal(r.vectorClipBoundsTexture, null);
  assert.equal(r.vectorClipBounds.length, 0);
  assert.equal(mock.deleted.filter(Boolean).length, 5, "scene replacements release both clip stores");
  assert.deepEqual(scene, canonical);
  console.log("Native WebGL fill clip bounds: nested/indirect clips, indexed stores, AA coverage, diagnostics and capacity fallback passed");
} finally { hooks.deregister(); }

function polygon(points) {
  return Float32Array.from(points.flatMap((p, i) => [...p, ...points[(i + 1) % points.length]]));
}
function contains([minX, minY, maxX, maxY], x, y) {
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}
function mockGl() {
  const mock = { maxSize: 1024, failTextureAfter: -1, uploads: [], uniforms: new Map(), attributes: new Map(), draws: [], deleted: [] };
  mock.gl = new Proxy({
    getParameter() { return mock.maxSize; },
    createTexture() { return mock.failTextureAfter >= 0 && mock.failTextureAfter-- === 0 ? null : {}; },
    deleteTexture(texture) { mock.deleted.push(texture); },
    texImage2D(_target, _level, _format, width, height, _border, _type, _dataType, data) {
      mock.uploads.push({ width, height, data: data.slice() });
    },
    getUniformLocation(_program, name) { return name; },
    uniform1i(name, value) { mock.uniforms.set(name, value); },
    vertexAttribPointer(location, ...args) { mock.attributes.set(location, args); },
    drawArraysInstanced(_mode, _first, vertices, count) { mock.draws.push([vertices, count]); }
  }, { get(target, key) { return target[key] ?? (() => {}); } });
  return mock;
}
