import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
const webGpu = await import("../src/threeWebGpuBackend.ts");

try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { buildHeprVectorGradient } = await import("../src/retainedVectorGradient.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { sampleSceneGradientChannel } = await import("../src/gradientSampling.ts");
  const { getScenePrimitive, ScenePrimitivePicker } = await import("../src/scenePrimitives.ts");
  const { buildGradientMeshRenderData } = await import("../src/gradientMesh.ts");
  const { buildGradientMeshBoundary, MAX_MESH_TRACE_TRIANGLES } = await import("../src/gradientMeshBoundary.ts");
  const { buildPrimitiveHighlights, PrimitiveAppearanceState } = await import("../src/primitiveAppearance.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { ThreeMaterialGradientLayer } = await import("../src/threeMaterialGradientLayer.ts");
  const { GRADIENT_MESH_VERTEX_GLSL, GRADIENT_MESH_FRAGMENT_GLSL, GRADIENT_MESH_WGSL } = await import("../src/gradientMeshShaders.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const bounds = { minX: 0, minY: 0, maxX: 20, maxY: 20 };
  const close = (actual, expected, tolerance = .006) => assert(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);
  let persisted;
  for (const kind of [1, 4, 5, 6, 7]) {
    const session = await openPdf({ kind: "bytes", bytes: fixture(kind) });
    try {
      const retained = await session.compilePage(0);
      const compiled = await session.compileVectorPage(0, { vectorFallback: "error", optimization: "none" });
      assert.equal(compiled.rasterLayers.length, 0, `type ${kind} stays vector through the public compiler`);
      assert.equal(compiled.gradientMetaA[0], 2);
      const gradients = await buildHeprVectorGradient(retained, 0, [1, 0, 0, 1, 0, 0], bounds, .5);
      const scene = Object.assign(createEmptyVectorScene(), gradients, { pageCount: 1, pagesPerRow: 1,
        bounds, pageBounds: bounds, pageRects: Float32Array.of(0, 0, 20, 20), pageTextRanges: Uint32Array.of(0, 0),
        drawRuns: [{ kind: "gradient-fill", first: 0, count: 1 }] });
      assert.equal(scene.gradientMetaA[0], 2);
      assert(scene.gradientMeshIndices.length > 0);
      const info = getScenePrimitive(scene, { kind: "gradient-fill", index: 0 });
      assert.equal(info.shadingKind, "mesh");
      assert.equal(info.triangleCount, scene.gradientMeshIndices.length / 3);
      const triangle = info.getTriangle(0), originalX = triangle.points[0].x;
      triangle.points[0].x = 999;
      assert.equal(info.getTriangle(0).points[0].x, originalX, "triangle inspection returns detached points");
      assert.throws(() => info.getTriangle(info.triangleCount), RangeError);
      const picker = new ScenePrimitivePicker(scene);
      const point = { x: 5, y: 5 };
      assert.equal((await picker.pick({ point, clientPoint: point, project: p => p, unproject: p => p, tolerancePx: 0 }))?.primitive.kind,
        "gradient-fill");
      const near = { x: 10.25, y: 5 };
      const edgeHit = await picker.pick({ point: near, clientPoint: near, project: p => p, unproject: p => p, tolerancePx: .5 });
      assert.equal(edgeHit?.primitive.kind, "gradient-fill", "tolerance reaches the actual mesh boundary inside the paint frame");
      close(edgeHit.distancePx, .25);
      assert(Number.isSafeInteger(edgeHit.triangleIndex));
      picker.dispose();
      close(sampleSceneGradientChannel(scene, 0, 5, 5, 0), kind === 1 ? .25 : .5);
      close(sampleSceneGradientChannel(scene, 0, 5, 5, 1), .5);
      close(sampleSceneGradientChannel(scene, 0, 5, 5, 3), 1);
      assert.equal(sampleSceneGradientChannel(scene, 0, 15, 15, 3), 0, "uncovered paint bounds stay transparent");
      const mesh = buildGradientMeshRenderData(scene);
      assert.equal(mesh.vertices.length, scene.gradientMeshIndices.length * 6);
      assert.equal(mesh.ranges[1], scene.gradientMeshIndices.length);
      for (const backend of ["webgl", "webgpu"]) {
        const layer = new ThreeMaterialGradientLayer(scene, { materialBackend: backend, webGpu, strokeCurveEnabled: true, vectorOverride: [0, 0, 0, 0] });
        assert.equal(layer.entries[0].geometry.getAttribute("aMeshPosition").count, scene.gradientMeshIndices.length);
        if (backend === "webgl") {
          assert.match(layer.entries[0].material.vertexShader, /vec2 world = aMeshPosition;/);
          assert.match(layer.entries[0].material.fragmentShader, /sourcePaint = vMeshColor/);
        }
        layer.setPrimitiveColorUpdates([{ ref: { kind: "gradient-fill", index: 0 }, color: [1, 0, 0] }]);
        assert.equal(layer.entries[0].primitiveColor.w, 1);
        layer.dispose();
      }
      const composed = composeVectorScenesInGrid([scene, scene], 2);
      assert.equal(composed.gradientMeshIndices.length, scene.gradientMeshIndices.length * 2);
      assert.equal(composed.gradientMeshRanges[2], scene.gradientMeshIndices.length);
      assert.equal(getScenePrimitive(composed, { kind: "gradient-fill", index: 1 }).triangleCount, info.triangleCount);
      const aborted = new AbortController(); aborted.abort();
      await assert.rejects(() => buildHeprVectorGradient(retained, 0, [1, 0, 0, 1, 0, 0], bounds, 1, { signal: aborted.signal }), { name: "AbortError" });
      if (kind === 1) await assert.rejects(() => buildHeprVectorGradient(retained, 0, [1, 0, 0, 1, 0, 0], bounds, 1, { maxTriangles: 2 }), error => error.code === "resource-limit");
      if (kind === 5) persisted = scene;
    } finally { await session.close(); }
  }
  // Boundary extraction uses positions, not vertex/color identity or triangle winding.
  const makeMesh = (positions, indices) => ({ ...persisted,
    gradientMeshPositions: Float32Array.from(positions), gradientMeshIndices: Uint32Array.from(indices),
    gradientMeshColors: new Float32Array(positions.length * 2).fill(1),
    gradientMeshRanges: Uint32Array.of(0, indices.length) });
  const ref = { kind: "gradient-fill", index: 0 };
  const square = makeMesh([0,0, 2,0, 0,2, 0,2, 2,0, 2,2], [0,1,2, 3,5,4]);
  const originalSquare = structuredClone(square);
  const packetEdges = packet => Array.from({ length: packet.count }, (_, i) =>
    [packet.segments[i * 8], packet.segments[i * 8 + 1], packet.segments[i * 8 + 4], packet.segments[i * 8 + 5]]);
  const edgeKey = edge => [edge.slice(0, 2).join(","), edge.slice(2).join(",")].sort().join(";");
  const squarePacket = buildPrimitiveHighlights(square, [ref], null);
  assert.equal(squarePacket.count, 4, "two joined triangles trace a square, without the shared diagonal");
  assert.deepEqual(new Set(packetEdges(squarePacket).map(edgeKey)),
    new Set([[0,0,2,0], [2,0,2,2], [2,2,0,2], [0,2,0,0]].map(edgeKey)));
  assert(squarePacket.segments.every((value, i) => i % 8 >= 6 || value <= 2), "paint-frame rectangle is not the mesh outline");
  const disjoint = makeMesh([0,0, 2,0, 0,2, 2,2, 6,0, 8,0, 6,2], [0,1,2, 1,3,2, 4,5,6]);
  assert.equal(buildPrimitiveHighlights(disjoint, [ref], null).count, 7, "a disconnected triangle keeps its three boundary edges");
  const subdivided = makeMesh([0,0, 2,0, 0,2, 2,2, 1,1], [0,1,2, 1,3,4, 4,3,2]);
  assert.equal(buildPrimitiveHighlights(subdivided, [ref], null).count, 4, "shared edges cancel across collinear T-junction subdivisions");
  for (const duplicate of [[0,1,2], [0,2,1]]) {
    const overlapping = makeMesh([0,0, 2,0, 0,2], [0,1,2, ...duplicate]);
    assert.equal(buildPrimitiveHighlights(overlapping, [ref], null).count, 3,
      "coincident duplicate triangles retain one visible boundary with either winding");
  }
  const ringPositions = [], ringIndices = [];
  for (let y = 0; y <= 3; y++) for (let x = 0; x <= 3; x++) ringPositions.push(x, y);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if (x !== 1 || y !== 1) {
    const a = y * 4 + x; ringIndices.push(a, a + 1, a + 4, a + 1, a + 5, a + 4);
  }
  const ring = buildPrimitiveHighlights(makeMesh(ringPositions, ringIndices), [ref], null);
  assert.equal(ring.count, 8, "mesh hole and outer contour each retain four edges");
  assert.deepEqual(new Set(packetEdges(ring).map(edgeKey)), new Set([
    [0,0,3,0], [3,0,3,3], [3,3,0,3], [0,3,0,0], [1,1,2,1], [2,1,2,2], [2,2,1,2], [1,2,1,1]
  ].map(edgeKey)));
  const clipped = { ...square, gradientMetaA: square.gradientMetaA.slice(), gradientMetaB: square.gradientMetaB.slice(),
    gradientMetaC: square.gradientMetaC.slice(), gradientMetaE: square.gradientMetaE.slice(),
    clipPaths: [{ parent: -1, fillRule: 1, edges: Float32Array.of(0,0,20,0, 20,0,20,20, 20,20,0,20, 0,20,0,0) }],
    drawRuns: [{ kind: "gradient-fill", first: 0, count: 1, clipIndex: 0 }] };
  clipped.gradientMetaA[1] = 1;
  clipped.gradientMetaB.set([.5, 0, 0, .25]); // inverse of a nonuniform scale plus translation
  clipped.gradientMetaC.set([-1, -1.25]);
  clipped.gradientMetaE.set([0, 0, 1, 2]);
  const clippedPacket = buildPrimitiveHighlights(clipped, [ref], ref);
  assert.equal(clippedPacket.count, 8);
  assert.equal(clippedPacket.selectionCount, 4);
  assert.equal(clippedPacket.clipPaths.length, 3, "original chain, paint contour and shading BBox are retained and reused");
  assert.deepEqual(clippedPacket.clipPaths.map(clip => clip.parent), [-1, 0, 1]);
  assert.equal(clippedPacket.clipPaths[0].fillRule, 1);
  assert.deepEqual([...clippedPacket.clipPaths[2].edges], [2,5,4,5, 4,5,4,13, 4,13,2,13, 2,13,2,5]);
  assert(clippedPacket.segments.every((value, i) => i % 8 !== 7 || value === 2), "every traced edge uses the full geometric clip chain");
  const curvedClip = { ...square, gradientFillSegmentsA: square.gradientFillSegmentsA.slice(),
    gradientFillSegmentsB: square.gradientFillSegmentsB.slice(), gradientFillPathMetaC: square.gradientFillPathMetaC.slice() };
  curvedClip.gradientFillSegmentsA.set([10, -5], 2);
  curvedClip.gradientFillSegmentsB[2] = 1;
  curvedClip.gradientFillPathMetaC[0] = 1;
  const curvePacket = buildPrimitiveHighlights(curvedClip, [ref], null);
  assert.equal(curvePacket.clipPaths[0].fillRule, 1, "mesh paint clipping keeps the original winding rule");
  assert(curvePacket.clipPaths[0].edges.length > 16, "quadratic paint clips are subdivided instead of replaced with a bounding rectangle");
  assert(curvePacket.clipPaths[0].edges.some((value, i) => i % 2 === 1 && value < -2), "curved clip retains its curved extent");
  assert.equal(curvedClip.gradientFillSegmentsB[2], 1, "clip approximation does not alter canonical quadratic segments");
  const meshState = new PrimitiveAppearanceState(square);
  meshState.setSelection([ref, ref]); meshState.setHover(ref);
  const reused = meshState.getHighlights();
  assert.equal(reused.count, 8, "duplicate selection is collapsed while independent hover stays above it");
  meshState.setHover({ ...ref });
  assert.equal(meshState.getHighlights(), reused);
  meshState.clear(); assert.equal(meshState.getHighlights(), null); meshState.dispose();
  assert.deepEqual(square, originalSquare, "mesh tracing leaves all canonical geometry and colors untouched");
  const tooLarge = { ...square, gradientMeshRanges: Uint32Array.of(0, (MAX_MESH_TRACE_TRIANGLES + 1) * 3) };
  assert.throws(() => buildGradientMeshBoundary(tooLarge, 0), /triangle budget/);
  const oversizedState = new PrimitiveAppearanceState(tooLarge);
  assert.throws(() => oversizedState.setSelection([ref]), /triangle budget/);
  assert.deepEqual(oversizedState.getSelection(), [], "budget rejection is atomic");
  assert.equal(oversizedState.getHighlights(), null);
  oversizedState.dispose();
  const archive = await buildHep(persisted, { compression: "store", encodeRasterImages: false });
  const restored = await loadSceneFromHep(await archive.arrayBuffer());
  assert.deepEqual(restored.gradientMeshIndices, persisted.gradientMeshIndices);
  assert.deepEqual(restored.gradientMeshPositions, persisted.gradientMeshPositions);
  assert.equal(getScenePrimitive(restored, { kind: "gradient-fill", index: 0 }).triangleCount, persisted.gradientMeshIndices.length / 3);
  assert.match(GRADIENT_MESH_VERTEX_GLSL, /vec2 world = aMeshPosition;/);
  assert.match(GRADIENT_MESH_FRAGMENT_GLSL, /vec4 source = vMeshColor;/);
  assert.match(GRADIENT_MESH_WGSL, /let pathIndex = i32\(paintIndex\);/);
  assert.match(GRADIENT_MESH_WGSL, /let source = inData.meshColor;/);
  // The mesh color joins the fill's varyings; a shared location fails pipeline creation.
  const meshVaryings = [...GRADIENT_MESH_WGSL.match(/struct FillOut \{[\s\S]*?\};/)[0].matchAll(/@location\((\d+)\)/g)]
    .map(match => match[1]);
  assert.equal(new Set(meshVaryings).size, meshVaryings.length, `mesh varyings use distinct locations: ${meshVaryings}`);
  console.log("vector shading mesh: function/free-form/lattice/Coons/tensor, bounded subdivision, geometry, picking, Three, composition and HEP passed");
} finally { hooks.deregister(); }

function fixture(kind) {
  const coords = [0, 0, 0, 85, 0, 170, 0, 255, 85, 255, 170, 255, 255, 255, 255, 170, 255, 85, 255, 0, 170, 0, 85, 0];
  const shading = kind === 1
    ? "<< /ShadingType 1 /ColorSpace /DeviceRGB /Domain [0 1 0 1] /Matrix [10 0 0 10 0 0] /Function 6 0 R >>"
    : kind === 4 ? tinyPdfStream("/ShadingType 4 /ColorSpace /DeviceRGB /BitsPerFlag 8 /BitsPerCoordinate 8 /BitsPerComponent 8 /Decode [0 10 0 10 0 1 0 1 0 1]",
      new Uint8Array([0,0,0,0,0,0, 0,255,0,255,0,0, 0,0,255,0,255,0, 1,255,255,255,255,0]))
    : kind === 5 ? tinyPdfStream("/ShadingType 5 /ColorSpace /DeviceRGB /VerticesPerRow 2 /BitsPerCoordinate 8 /BitsPerComponent 8 /Decode [0 10 0 10 0 1 0 1 0 1]",
      new Uint8Array([0,0,0,0,0, 255,0,255,0,0, 0,255,0,255,0, 255,255,255,255,0]))
    : tinyPdfStream(`/ShadingType ${kind} /ColorSpace /DeviceRGB /BitsPerFlag 8 /BitsPerCoordinate 8 /BitsPerComponent 8 /Decode [0 10 0 10 0 1 0 1 0 1]`,
      new Uint8Array([0, ...coords, ...(kind === 7 ? [85,85, 85,170, 170,170, 170,85] : []), 0,0,0, 0,255,0, 255,255,0, 255,0,0]));
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /Shading << /S 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "/S sh") },
    { number: 5, body: shading },
    { number: 6, body: tinyPdfStream("/FunctionType 4 /Domain [0 1 0 1] /Range [0 1 0 1 0 1]", "{ exch dup mul exch 0.25 }") }
  ] });
}
