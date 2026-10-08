import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });

try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { acquireThreeVectorClipTexture, createThreeVectorClipTexture } = await import("../src/threeVectorClips.ts");
  const { ThreeMaterialRasterLayer } = await import("../src/threeMaterialRasterLayer.ts");
  const { ThreeMaterialGradientLayer } = await import("../src/threeMaterialGradientLayer.ts");
  const { ThreeMaterialFillLayer } = await import("../src/threeMaterialFillLayer.ts");
  const { ThreeMaterialStrokeLayer } = await import("../src/threeMaterialStrokeLayer.ts");
  const { ThreeMaterialTextLayer } = await import("../src/threeMaterialTextLayer.ts");
  const { ThreeVectorDrawRuns } = await import("../src/threeVectorDrawRuns.ts");
  const webGpu = await import("../src/threeWebGpuBackend.ts");
  const f = values => Float32Array.from(values);
  const scene = Object.assign(createEmptyVectorScene(), {
    pageCount: 1, pageRects: f([0, 0, 10, 10]), pageTextRanges: Uint32Array.of(0, 1),
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, pageBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    segmentCount: 1, maxHalfWidth: 0.1,
    endpoints: f([1, 5, 0, 0]), primitiveMeta: f([9, 5, 0, 0.5]),
    primitiveBounds: f([0, 0, 10, 10]), styles: f([0.1, 0.2, 0.3, 1]),
    fillPathCount: 1, fillSegmentCount: 1,
    fillPathMetaA: f([0, 1, 0, 0]), fillPathMetaB: f([10, 10, 0.2, 0.3]), fillPathMetaC: f([0, 0, 0.4, 1]),
    fillSegmentsA: f([1, 5, 1, 5]), fillSegmentsB: f([9, 5, 0, 0]),
    textInstanceCount: 1, textGlyphCount: 1, textGlyphSegmentCount: 1,
    textInstanceA: f([1, 0, 0, 1]), textInstanceB: f([0, 0, 0, 0]), textInstanceC: f([0.2, 0.3, 0.4, 1]),
    textGlyphMetaA: f([0, 1, 1, 5]), textGlyphMetaB: f([9, 5, 0, 0]),
    textGlyphSegmentsA: f([1, 5, 1, 5]), textGlyphSegmentsB: f([9, 5, 0, 0]),
    gradientCount: 1, gradientMetaA: f([0, 0, 0, 0]), gradientMetaB: f([1, 0, 0, 1]),
    gradientMetaC: f([0, 0, 0, 0]), gradientMetaD: f([10, 0, 0, 0]),
    gradientMetaE: f([0, 0, 0, 0]), gradientLut: new Uint8Array(4096).fill(128),
    gradientFillPathCount: 1, gradientFillSegmentCount: 1,
    gradientFillPathMetaA: f([0, 1, 0, 0]), gradientFillPathMetaB: f([10, 10, 0.2, 0.3]),
    gradientFillPathMetaC: f([0, 0, 0.4, 1]), gradientFillPaintMeta: f([0, -1, 1, 0]),
    gradientFillSegmentsA: f([1, 5, 1, 5]), gradientFillSegmentsB: f([9, 5, 0, 0]),
    rasterLayers: [{ width: 1, height: 1, data: Uint8Array.of(128, 128, 128, 255), matrix: f([1, 0, 0, 1, 0, 0]) }],
    clipPaths: [{ parent: -1, fillRule: 0, edges: f([0, 0, 10, 0, 10, 0, 5, 10, 5, 10, 0, 0]) }],
    drawRuns: ["fill", "stroke", "text", "raster", "gradient-fill"].map(kind => ({ kind, first: 0, count: 1, clipIndex: 0 }))
  });

  const independent = [createThreeVectorClipTexture(scene), createThreeVectorClipTexture(scene)];
  assert.notEqual(...independent, "direct callers keep independently owned textures");
  const first = acquireThreeVectorClipTexture(scene);
  const second = acquireThreeVectorClipTexture({ ...scene });
  assert.equal(first.texture, second.texture, "derived scenes share their unchanged clip array");
  assert.deepEqual(first.texture.image.data, independent[0].image.data, "sharing preserves the exact packed clip layout");
  independent.forEach(texture => texture.dispose());
  let disposed = 0;
  first.texture.addEventListener("dispose", () => disposed++);
  first.release(); first.release();
  assert.equal(disposed, 0, "releasing one owner twice cannot dispose a surviving owner's texture");
  second.release();
  assert.equal(disposed, 1);
  const recreated = acquireThreeVectorClipTexture(scene);
  assert.notEqual(recreated.texture, first.texture, "the last release removes the disposed texture from the cache");
  const detached = acquireThreeVectorClipTexture({ ...scene, clipPaths: [...scene.clipPaths] });
  assert.notEqual(detached.texture, recreated.texture, "a new clip array has independent ownership");
  detached.release(); recreated.release();

  for (const backend of ["webgl", "webgpu"]) {
    const options = { materialBackend: backend, webGpu, strokeCurveEnabled: true,
      textVectorOnly: true, vectorOverride: [0, 0, 0, 0], pageBackground: [1, 1, 1, 1] };
    const layers = [ThreeMaterialRasterLayer, ThreeMaterialGradientLayer, ThreeMaterialFillLayer,
      ThreeMaterialStrokeLayer, ThreeMaterialTextLayer].map(Layer => new Layer(scene, options));
    const texture = layers[0].vectorClipTexture;
    let releases = 0;
    texture.addEventListener("dispose", () => releases++);
    for (const layer of layers) assert.equal(layer.vectorClipTexture, texture, `${backend}: all material layers share clip storage`);
    for (const layer of layers.slice(0, -1)) layer.dispose();
    assert.equal(releases, 0, `${backend}: disposing raster or gradient cannot invalidate text clipping`);
    layers.at(-1).dispose();
    assert.equal(releases, 1, `${backend}: the last layer releases GPU clip resources once`);
    const fresh = acquireThreeVectorClipTexture(scene);
    assert.notEqual(fresh.texture, texture);
    fresh.release();
  }

  // Construction failures must drop their lease without dropping an existing layer's.
  const options = { materialBackend: "webgl", strokeCurveEnabled: true,
    textVectorOnly: true, vectorOverride: [0, 0, 0, 0], pageBackground: [1, 1, 1, 1] };
  const holder = acquireThreeVectorClipTexture(scene);
  let failureReleases = 0;
  holder.texture.addEventListener("dispose", () => failureReleases++);
  const createRuns = ThreeVectorDrawRuns.create;
  ThreeVectorDrawRuns.create = () => { throw new Error("injected batch construction failure"); };
  try {
    for (const Layer of [ThreeMaterialFillLayer, ThreeMaterialStrokeLayer, ThreeMaterialTextLayer]) {
      assert.throws(() => new Layer(scene, options), /injected batch construction failure/);
    }
  } finally { ThreeVectorDrawRuns.create = createRuns; }
  for (const Layer of [ThreeMaterialRasterLayer, ThreeMaterialGradientLayer]) {
    assert.throws(() => new Layer(scene, { ...options, materialBackend: "webgpu" }), /WebGPU/);
  }
  assert.equal(failureReleases, 0);
  holder.release();
  assert.equal(failureReleases, 1, "failed constructors cannot keep the shared texture alive");
  console.log("Three vector clip resource sharing regression tests passed");
} finally { hooks.deregister(); }
