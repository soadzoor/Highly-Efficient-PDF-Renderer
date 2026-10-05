import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { validateVectorDrawRuns } = await import("../src/vectorDrawOrder.ts");
  const { NativeVectorClipBuilder } = await import("../src/pdf/nativeVectorClips.ts");
  const { lowerRetainedPageToVectorScene } = await import("../src/retainedVectorPage.ts");
  const { packVectorClips, MAX_VECTOR_CLIP_DEPTH, MAX_VECTOR_CLIP_EDGES } = await import("../src/vectorClips.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { createThreeVectorClipTexture, initializeThreeVectorClip, createThreeVectorClipMaterial,
    registerThreeNodeClipPosition } = await import("../src/threeVectorClips.ts");
  const fixtures = [
    // Same winding, different fill rule: the second rectangle is a hole only with W*.
    fixture("q 5 5 50 50 re 20 20 20 20 re W* n /Fm Do Q 0 0 2 2 re f"),
    fixture("q 5 5 50 50 re 20 20 20 20 re W n /Fm Do Q 0 0 2 2 re f"),
    // Rotated/sheared Form BBox intersects both caller and Form-local clips.
    fixture("q 0 0 m 64 0 l 0 64 l h W n /Fm Do Q 0 0 2 2 re f", {
      matrix: "1 .5 -.25 1 10 0", form: "0 0 35 35 re W n -20 -20 100 100 re f" }),
    // Reusing a Form with equal clip bounds but different clip interiors must not reuse the wrong clip.
    fixture("q 0 0 m 40 0 l 0 40 l h W n /Fm Do Q q 40 40 m 0 40 l 40 0 l h W n /Fm Do Q"),
    // A clip is frozen in page space when W executes, before subsequent changes to the CTM.
    fixture("q 1 0 0 1 10 5 cm 0 0 m 30 0 l 0 30 l h W n 1 0 0 1 -10 -5 cm /Fm Do Q"),
    fixture("q 5 5 m 5 55 55 55 55 5 c h W n /Fm Do Q"),
    // Five stacked circles outgrow the edge budget at the usual curve tolerance.
    fixture(`q ${"62 32 m 62 48.569 48.569 62 32 62 c 2 48.569 15.431 62 2 32 c 2 15.431 15.431 2 32 2 c 48.569 2 62 15.431 62 32 c h ".repeat(5)}W n /Fm Do Q`)
  ];
  let sample;
  for (const [fixtureIndex, bytes] of fixtures.entries()) {
    const session = await openPdf({ kind: "bytes", bytes });
    try {
      const scene = await session.compileVectorPage(0, { vectorFallback: "error", preserveDrawingOrder: true });
      validateVectorDrawRuns(scene);
      comparePackedClips(scene.clipPaths, packVectorClips(scene.clipPaths));
      assert.equal(scene.rasterLayers.length, 0, `fixture ${fixtureIndex} retains vector Forms`);
      assert(scene.fillPathCount > 0 && scene.clipPaths.length > 0);
      assert(!session.getDiagnostics().some(d => d.code.endsWith("raster-fallback")));
      if (fixtureIndex === 5) assert(session.getDiagnostics().some(d => d.code === "clip-curve-approximation"));
      if (fixtureIndex === 5) assert(!session.getDiagnostics().some(d => d.code === "clip-curve-coarsened"));
      if (fixtureIndex === 6) {
        assert(scene.clipPaths.every(clip => clip.edges.length / 4 <= MAX_VECTOR_CLIP_EDGES));
        assert.equal(session.getDiagnostics().find(d => d.code === "clip-curve-coarsened")?.details.clipCount, 1,
          "an oversized curved clip is flattened more coarsely, not refused");
      }
      if (fixtureIndex === 0) {
        sample = scene;
        const restoredClip = scene.drawRuns.at(-1).clipIndex;
        assert(contains(scene, restoredClip, 1, 1), "Q restores the caller outside the former source clip");
        assert(!contains(scene, restoredClip, -0.1, 1), "the boundary fill retains its page guard after Q");
        assert.equal(contains(scene, scene.drawRuns[0].clipIndex, 25, 25), false, "even-odd hole");
      }
      if (fixtureIndex === 1) assert.equal(contains(scene, scene.drawRuns[0].clipIndex, 25, 25), true, "nonzero overlap");
      if (fixtureIndex === 3) assert.notEqual(scene.drawRuns[0].clipIndex, scene.drawRuns[1].clipIndex);
      const page = await session.compilePage(0);
      if (fixtureIndex === 6) {
        const diagnostics = [];
        const retained = await lowerRetainedPageToVectorScene(page, { signal: new AbortController().signal,
          onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
        assert.equal(retained.rasterLayers.length, 0);
        assert(retained.clipPaths.length > 0 && retained.clipPaths.every(clip => clip.edges.length / 4 <= MAX_VECTOR_CLIP_EDGES));
        assert(diagnostics.some(d => d.code === "clip-curve-coarsened"), "retained lowering coarsens the same clip");
      }
      for (const scale of [2, 8, 24]) {
        const reference = await renderHeprPageToCanvas2d(page, { scale, surfaceFactory });
        const retained = renderRetainedFills(scene, scale);
        compareInteriors(retained.getImageData(0, 0, 64 * scale, 64 * scale).data,
          reference.surface.context.getImageData(0, 0, 64 * scale, 64 * scale).data, `fixture ${fixtureIndex}, scale ${scale}`);
      }
    } finally { await session.close(); }
  }

  const image = await openPdf({ kind: "bytes", bytes: fixture("q 0 0 m 40 0 l 0 40 l h W n /Fm Do Q", {
    matrix: "1 .25 -.5 1 20 5", form: "40 0 0 40 0 0 cm /Im Do" }) });
  try {
    const scene = await image.compileVectorPage(0, { vectorFallback: "error", preserveDrawingOrder: true });
    assert.equal(scene.rasterLayers.length, 1);
    assert.deepEqual([scene.rasterLayers[0].width, scene.rasterLayers[0].height], [2, 1]);
    assert.deepEqual([...scene.rasterLayers[0].data], [255, 0, 0, 255, 0, 0, 255, 255]);
    assert.deepEqual([...scene.rasterLayers[0].matrix], [40, 10, 20, -40, 0, 45], "image rows retain their top-to-bottom orientation");
    assert(scene.drawRuns[0].clipIndex >= 0);
    assert(!image.getDiagnostics().some(d => d.code.endsWith("raster-fallback")));
  } finally { await image.close(); }

  // Content past the crop box is cut at the page edge. A transparency-group
  // Form sends the page through the retained lowering; a lone image does not.
  const cropped = (content) => writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /CropBox [20 20 80 80] /Contents 4 0 R /Resources << /XObject << /Fm 5 0 R /Im 6 0 R >> >> >>" },
    { number: 4, body: tinyPdfStream("", content) },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Group << /S /Transparency /I true >>", "0 0 1 rg 30 30 20 20 re f") },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8", Uint8Array.of(255, 0, 0, 0, 0, 255)) }
  ] });
  for (const [label, content, kind, retained] of [
    ["retained fill", "1 0 0 rg 0 0 100 100 re f /Fm Do", "fill", true],
    ["retained image", "q 100 0 0 100 0 0 cm /Im Do Q /Fm Do", "raster", true],
    ["direct image", "q 100 0 0 100 0 0 cm /Im Do Q", "raster", false]
  ]) {
    const session = await openPdf({ kind: "bytes", bytes: cropped(content) });
    try {
      const scene = await session.compileVectorPage(0, { vectorFallback: "error" });
      assert.deepEqual(scene.pageBounds, { minX: 0, minY: 0, maxX: 60, maxY: 60 });
      const run = scene.drawRuns?.find(entry => entry.kind === kind);
      assert(run?.clipIndex !== undefined, `${label} past the crop box is clipped`);
      assert(contains(scene, run.clipIndex, 30, 30) && contains(scene, run.clipIndex, 1, 59), `${label} keeps the page`);
      for (const [x, y] of [[-10, 30], [30, -10], [70, 30], [30, 70]]) {
        assert(!contains(scene, run.clipIndex, x, y), `${label} is cut at the page edge (${x}, ${y})`);
      }
      const inside = scene.drawRuns.filter(entry => entry.kind === "fill" && entry !== run);
      assert.equal(inside.length, retained ? 1 : 0);
      // The Form's own fill lies inside the page: it keeps just its BBox clip.
      if (retained) assert.equal(scene.clipPaths[inside[0].clipIndex].parent, -1);
    } finally { await session.close(); }
  }

  // A clip is often an image's visible outline, so image paint antialiases it:
  // the pixel footprint is taken before any discard, and the premultiplied
  // color scales whole with the clip coverage.
  const { CORE_RASTER_FRAGMENT_SHADER_SOURCE } = await import("../src/coreShaders.ts");
  const { RASTER_STRIP_FRAGMENT_GLSL } = await import("../src/rasterStripWebGlShaders.ts");
  for (const source of [CORE_RASTER_FRAGMENT_SHADER_SOURCE, RASTER_STRIP_FRAGMENT_GLSL]) {
    const main = source.slice(source.indexOf("void main()")).replace(/\/\/.*$/gm, "");
    assert(main.indexOf("float clipAAWidth") >= 0 && main.indexOf("float clipAAWidth") < main.indexOf("discard;"));
    assert.match(main, /(outColor \*=|color \*) heprVectorClipAA\(vWorld, clipAAWidth\)/);
    assert(!/heprVectorClip\(/.test(main), "image clips are not a per-pixel point test");
  }

  const grid = composeVectorScenesInGrid([sample, sample], 2);
  validateVectorDrawRuns(grid);
  const base = sample.clipPaths.length;
  const original = sample.clipPaths[0].edges, translated = grid.clipPaths[base].edges;
  const dx = translated[0] - original[0], dy = translated[1] - original[1];
  assert(dx !== 0 || dy !== 0);
  for (let i = 0; i < translated.length; i++) assert.equal(translated[i] - original[i], i % 2 ? dy : dx);
  assert.equal(grid.clipPaths[base + 1].parent, base);
  const invalidRun = { ...sample.drawRuns[0], clipIndex: base };
  assert.throws(() => validateVectorDrawRuns({ ...sample, drawRuns: [invalidRun, ...sample.drawRuns.slice(1)] }), /clip reference/);
  assert.throws(() => validateVectorDrawRuns({ ...sample, drawRuns: undefined }), /requires ordered/);
  assert.throws(() => validateVectorDrawRuns({ ...sample, clipPaths: [{ ...sample.clipPaths[0], parent: 0 }] }), /clip path/);
  assert.throws(() => validateVectorDrawRuns({ ...sample, clipPaths: [{ parent: -1, fillRule: 0, edges: new Float32Array([0, NaN, 1, 1]) }] }), /clip path/);
  assert.throws(() => validateVectorDrawRuns({ ...sample, clipPaths: [{ parent: -1, fillRule: 0, edges: new Float32Array((MAX_VECTOR_CLIP_EDGES + 1) * 4) }] }), /clip path/);
  const deep = Array.from({ length: MAX_VECTOR_CLIP_DEPTH + 1 }, (_, i) => ({ ...sample.clipPaths[0], parent: i - 1 }));
  assert.throws(() => validateVectorDrawRuns({ ...sample, clipPaths: deep }), /nesting/);
  const packed = packVectorClips(sample.clipPaths);
  assert.equal(packed[1], sample.clipPaths.length, "the clip texture contains coordinates, not a sampled mask");
  testClipPacking(packVectorClips);

  // Degenerate paths must clip everything; open paths are implicitly closed.
  const builder = new NativeVectorClipBuilder();
  const clip = { parent: null, fillRule: 0, path: { data: new Float32Array([0, 0, 0, 1, 10, 0, 1, 0, 10]),
    transform: [1, 0, 0, 1, 0, 0], bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } } };
  assert.equal(builder.add(clip), 0);
  assert.equal(builder.paths[0].edges.length, 12);
  assert.equal(builder.add(structuredClone(clip)), 0, "identical clip geometry is shared");
  assert.throws(() => builder.add(clip, AbortSignal.abort()));
  const emptyIndex = builder.add({ ...clip, path: { ...clip.path, data: new Float32Array([0, 1, 1]) } });
  assert.equal(contains({ clipPaths: builder.paths }, emptyIndex, 1, 1), false);
  assert.equal(builder.coarseningDiagnostic(0), undefined, "clips within budget keep the usual tolerance");

  // Curves give up precision before a clip is refused; straight edges have none to give.
  const k = 300 * 0.5523;
  const circle = [0, 300, 0, 2, 300, k, k, 300, 0, 300, 2, -k, 300, -300, k, -300, 0,
    2, -300, -k, -k, -300, 0, -300, 2, k, -300, 300, -k, 300, 0, 4];
  const curved = (data) => ({ parent: null, fillRule: 0, path: { data: Float32Array.from(data),
    transform: [1, 0, 0, 1, 400, 400], bounds: { minX: -300, minY: -300, maxX: 300, maxY: 300 } } });
  const coarse = new NativeVectorClipBuilder();
  const coarseIndex = coarse.add(curved([...circle, ...circle, ...circle]));
  const coarseEdges = coarse.paths[coarseIndex].edges.length / 4;
  assert(coarseEdges <= MAX_VECTOR_CLIP_EDGES && coarseEdges > MAX_VECTOR_CLIP_EDGES / 4);
  assert(contains({ clipPaths: coarse.paths }, coarseIndex, 400, 699.9) && !contains({ clipPaths: coarse.paths }, coarseIndex, 400, 700.1));
  assert.equal(coarse.coarsenedClipCount, 1);
  const coarsened = coarse.coarseningDiagnostic(3);
  assert.equal(coarsened.code, "clip-curve-coarsened");
  assert.equal(coarsened.pageIndex, 3);
  assert.equal(coarsened.details.tolerance, coarse.coarsestCurveTolerance);
  assert(coarse.coarsestCurveTolerance > 0.0001 && coarse.coarsestCurveTolerance < 0.01);
  const fine = new NativeVectorClipBuilder();
  assert(fine.paths[fine.add(curved(circle))].edges.length / 4 > coarseEdges / 3, "one circle keeps the usual tolerance");
  assert.equal(fine.coarsenedClipCount, 0);
  const sawtooth = [0, 0, 0, ...Array.from({ length: MAX_VECTOR_CLIP_EDGES + 8 }, (_, i) => [1, i + 1, i % 2]).flat()];
  assert.throws(() => new NativeVectorClipBuilder().add(curved(sawtooth)),
    error => error.details?.reason === "vector-clip-edge-limit");

  // Per-run material clones share live camera uniforms but keep independent clip roots.
  const texture = createThreeVectorClipTexture(sample);
  const raw = new THREE.RawShaderMaterial({ uniforms: { camera: { value: new THREE.Vector2() } } });
  initializeThreeVectorClip(raw, texture);
  const rawA = createThreeVectorClipMaterial(raw, 0), rawB = createThreeVectorClipMaterial(raw, 1);
  assert.equal(rawA.uniforms.camera, raw.uniforms.camera);
  assert.equal(rawB.uniforms.uVectorClipTex.value, texture);
  assert.equal(rawA.uniforms.uVectorClipIndex.value, 0);
  assert.equal(rawB.uniforms.uVectorClipIndex.value, 1);
  const node = new NodeMaterial(); node.fragmentNode = TSL.vec4(1);
  registerThreeNodeClipPosition(node, TSL.vec2(0)); initializeThreeVectorClip(node, texture);
  const nodeA = createThreeVectorClipMaterial(node, 0), nodeB = createThreeVectorClipMaterial(node, 1);
  assert.notEqual(nodeA.fragmentNode, node.fragmentNode);
  assert.notEqual(nodeA.fragmentNode, nodeB.fragmentNode);
  for (const material of [raw, rawA, rawB, node, nodeA, nodeB]) material.dispose();
  texture.dispose();
  console.log("Vector clips preserve winding, nested Forms, images, transforms and exact rectangle intersections");
} finally { hooks.deregister(); }

function testClipPacking(pack) {
  const polygon = (points, parent = -1, fillRule = 0) => ({ parent, fillRule,
    edges: new Float32Array(points.flatMap((point, i) => [...point, ...points[(i + 1) % points.length]])) });
  const rectangle = (x0, y0, x1, y1, parent = -1) => polygon([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], parent);
  const orientations = [];
  for (const fillRule of [0, 1]) for (const reverse of [false, true]) for (let start = 0; start < 4; start++) {
    const points = [[-10, -20], [50, -20], [50, 60], [-10, 60]];
    if (reverse) points.reverse();
    orientations.push(polygon([...points.slice(start), ...points.slice(0, start)], -1, fillRule));
  }
  const compact = pack(orientations);
  assert.equal(compact.length, (orientations.length + 1) * 4,
    "rectangle orientations and fill rules keep separate headers sharing one bounds texel");
  for (let i = 0; i < orientations.length; i++) {
    assert.equal(compact[i * 4 + 2], -1);
    const offset = compact[i * 4 + 1] * 4;
    assert.deepEqual([...compact.subarray(offset, offset + 4)], [-10, -20, 50, 60]);
  }
  comparePackedClips(orientations, compact);

  const clips = [
    rectangle(-10, -20, 50, 60),
    rectangle(40, 70, 0, -30, 0),
    rectangle(5, 2, 35, 50, 1),
    polygon([[0, 0], [30, 0], [0, 30]], 2),
    rectangle(0, 0, 12, 12, 3),
    rectangle(6, 4, 50, 50, 4),
    rectangle(70, 70, 80, 80, 2), // Disjoint intersection.
    rectangle(35, 2, 40, 50, 2), // Touching intersection has no interior.
    rectangle(5, 2, 5, 50), // Degenerate edges must not become a rectangle.
    polygon([], 0),
    polygon([[0, 0], [10, 0], [10 + 2 ** -18, 10], [2 ** -18, 10]]), // Small shear.
    { parent: -1, fillRule: 0, edges: new Float32Array([0, 0, 10, 0, 10, 1, 10, 10, 10, 10, 0, 10, 0, 10, 0, 0]) },
    { parent: -1, fillRule: 1, edges: new Float32Array([...rectangle(0, 0, 40, 40).edges, ...rectangle(10, 10, 30, 30).edges]) },
    { parent: -1, fillRule: 0, edges: new Float32Array([...rectangle(0, 0, 40, 40).edges, ...rectangle(10, 10, 30, 30).edges]) }
  ];
  const original = structuredClone(clips), data = pack(clips);
  assert.deepEqual(clips, original, "upload optimization does not mutate retained clip geometry");
  assert.equal(data[2 * 4], -1, "three nested rectangles collapse into one intersection");
  assert.equal(data[5 * 4], 3, "rectangle intersections retain the nearest polygon ancestor");
  for (const [index, bounds] of [[2, [5, 2, 35, 50]], [5, [6, 4, 12, 12]]]) {
    const offset = data[index * 4 + 1] * 4;
    assert.deepEqual([...data.subarray(offset, offset + 4)], bounds);
  }
  for (const index of [3, 8, 9, 10, 11, 12, 13]) {
    const clip = clips[index], offset = data[index * 4 + 1] * 4;
    assert.deepEqual([...data.subarray(index * 4, index * 4 + 4)],
      [clip.parent, offset / 4, clip.edges.length / 4, clip.fillRule], `polygon ${index} retains its header`);
    assert.deepEqual(data.subarray(offset, offset + clip.edges.length), clip.edges);
  }
  comparePackedClips(clips, data);
  assert.deepEqual(pack(), new Float32Array(4), "empty scenes retain a valid texture");
}

// Compare the uploaded representation against the original shader's directed-edge
// winding rule, including exact boundaries where Canvas uses different semantics.
function comparePackedClips(clips, packed) {
  const xs = new Set([0]), ys = new Set([0]);
  for (const clip of clips) for (let i = 0; i < clip.edges.length; i += 2) {
    for (const delta of [-0.125, 0, 0.125]) {
      xs.add(Math.fround(clip.edges[i] + delta)); ys.add(Math.fround(clip.edges[i + 1] + delta));
    }
  }
  // Keep dense curve fixtures bounded while checking every corner of small polygons.
  const sample = values => [...values].sort((a, b) => a - b).filter((_, i) => i % Math.ceil(values.size / 65) === 0);
  for (let root = 0; root < clips.length; root++) for (const x of sample(xs)) for (const y of sample(ys)) {
    let expected = true;
    for (let index = root; index >= 0; index = clips[index].parent) {
      if (!windingContains(clips[index].edges, clips[index].fillRule, x, y)) { expected = false; break; }
    }
    let actual = true;
    for (let index = root; index >= 0; index = packed[index * 4]) {
      const header = index * 4;
      let offset = packed[header + 1] * 4, count = packed[header + 2];
      if (count >= 0 && packed[header + 3] >= 2) {
        const band = Math.max(0, Math.min(packed[offset + 3] - 1,
          Math.floor(Math.fround(Math.fround(y - packed[offset + 1]) / packed[offset + 2]))));
        const table = (packed[offset] + band) * 4;
        offset = packed[table] * 4; count = packed[table + 1];
      }
      const inside = count < 0
        ? x >= packed[offset] && y >= packed[offset + 1] && x < packed[offset + 2] && y < packed[offset + 3]
        : windingContains(packed.subarray(offset, offset + count * 4), packed[header + 3] & 1, x, y);
      if (!inside) { actual = false; break; }
    }
    assert.equal(actual, expected, `packed clip ${root} at (${x}, ${y})`);
  }
}
function windingContains(edges, fillRule, x, y) {
  let winding = 0;
  for (let i = 0; i < edges.length; i += 4) {
    const x0 = edges[i], y0 = edges[i + 1], x1 = edges[i + 2], y1 = edges[i + 3];
    if ((y0 > y) !== (y1 > y) && x0 + (y - y0) / (y1 - y0) * (x1 - x0) > x) winding += y1 > y0 ? 1 : -1;
  }
  return fillRule ? Math.abs(winding) % 2 !== 0 : winding !== 0;
}

function surfaceFactory(width, height) {
  const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") };
}
function edgePath(edges) {
  const path = new Path2D();
  for (let i = 0; i < edges.length; i += 4) {
    if (i === 0 || edges[i] !== edges[i - 2] || edges[i + 1] !== edges[i - 1]) path.moveTo(edges[i], edges[i + 1]);
    path.lineTo(edges[i + 2], edges[i + 3]);
  }
  return path;
}
function contains(scene, index, x, y) {
  const context = createCanvas(1, 1).getContext("2d");
  while (index !== undefined && index >= 0) {
    const clip = scene.clipPaths[index];
    if (!context.isPointInPath(edgePath(clip.edges), x, y, clip.fillRule ? "evenodd" : "nonzero")) return false;
    index = clip.parent;
  }
  return true;
}
function renderRetainedFills(scene, scale) {
  const context = createCanvas(64 * scale, 64 * scale).getContext("2d");
  context.translate(0, 64 * scale); context.scale(scale, -scale);
  for (const run of scene.drawRuns) {
    assert.equal(run.kind, "fill"); context.save();
    for (let index = run.clipIndex; index !== undefined && index >= 0; index = scene.clipPaths[index].parent) {
      const clip = scene.clipPaths[index]; context.clip(edgePath(clip.edges), clip.fillRule ? "evenodd" : "nonzero");
    }
    for (let index = run.first; index < run.first + run.count; index++) {
      const meta = index * 4, first = scene.fillPathMetaA[meta], count = scene.fillPathMetaA[meta + 1];
      const edges = scene.fillSegmentsA.subarray(first * 4, (first + count) * 4);
      const bounds = [scene.fillPathMetaA[meta + 2], scene.fillPathMetaA[meta + 3], scene.fillPathMetaB[meta], scene.fillPathMetaB[meta + 1]];
      context.save(); context.beginPath(); context.rect(bounds[0], bounds[1], bounds[2] - bounds[0], bounds[3] - bounds[1]); context.clip();
      context.fill(edgePath(edges), scene.fillPathMetaC[meta] ? "evenodd" : "nonzero"); context.restore();
    }
    context.restore();
  }
  return context;
}
function compareInteriors(actual, expected, message) {
  let mismatches = 0, compared = 0;
  for (let i = 3; i < actual.length; i += 4) {
    // The GPU and Canvas antialias clip edges differently; compare fully covered/empty pixels.
    if ((actual[i] !== 0 && actual[i] !== 255) || (expected[i] !== 0 && expected[i] !== 255)) continue;
    compared++; if (actual[i] !== expected[i]) mismatches++;
  }
  assert(compared > actual.length / 8);
  assert.equal(mismatches, 0, message);
}
function fixture(content, { matrix = "1 0 0 1 0 0", form = "-20 -20 100 100 re f" } = {}) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 64 64] /Resources << /XObject << /Fm 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", content) },
    { number: 5, body: tinyPdfStream(`/Type /XObject /Subtype /Form /BBox [0 0 40 40] /Matrix [${matrix}] /Resources << /XObject << /Im 6 0 R >> >>`, form) },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8", Uint8Array.of(255, 0, 0, 0, 0, 255)) }
  ] });
}
