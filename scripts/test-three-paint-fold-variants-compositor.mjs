import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const { ThreePaintCompositor } = await import("../src/threePaintCompositor.ts");
const webGpu = await import("../src/threeWebGpuBackend.ts");
const { threePaintFoldState, setThreePaintFold, THREE_GRADIENT_MASK_VECTORS } = await import("../src/threePaintFold.ts");
const { registerThreePdfShapeUniform } = await import("../src/threePdfShape.ts");

const geometry = new THREE.PlaneGeometry(1, 1), mask = new THREE.Texture(), lut = new THREE.Texture();
const sourceMaterial = new NodeMaterial(), shape = TSL.uniform(0);
sourceMaterial.vertexNode = TSL.vec4(TSL.positionLocal, 1);
sourceMaterial.fragmentNode = TSL.vec4(shape, 0.2, 0.3, 0.8);
registerThreePdfShapeUniform(sourceMaterial, shape);
webGpu.enableThreeNodePaintFold(sourceMaterial);
const source = new THREE.Mesh(geometry, sourceMaterial);
source.userData.heprDrawRun = { kind: "fill", first: 0, count: 1 };
const compositor = new ThreePaintCompositor("webgpu", webGpu);
const gl = new ThreePaintCompositor("webgl");
const target = new THREE.RenderTarget(8, 8, { depthBuffer: false });
let compilingScene, targetNow = target, complete;
const host = {
  autoClear: false, getRenderTarget: () => targetNow,
  setRenderTarget(value) { targetNow = value; }, setScissorTest() {},
  compileAsync(scene) { compilingScene = scene; return new Promise(resolve => { complete = resolve; }); },
  render(scene, camera) {
    for (const mesh of scene.children) {
      mesh.onBeforeRender(this, scene, camera, mesh.geometry, mesh.material, null);
      this.draws.push({ mesh, material: mesh.material, state: threePaintFoldState(mesh.material), shape: shape.value });
      mesh.onAfterRender(this, scene, camera, mesh.geometry, mesh.material, null);
    }
  }, draws: []
};
try {
  const preparing = compositor.compileForRenderer(host, [source]);
  const variant = compositor.surfacePaintMaterial(sourceMaterial);
  assert.notEqual(variant, sourceMaterial);
  assert(compilingScene.children.some(mesh => mesh.material === sourceMaterial), "cold preparation includes computed-gradient folds");
  assert(compilingScene.children.some(mesh => mesh.material === variant && mesh.geometry === geometry),
    "the ordinary variant compiles with the source's actual vertex layout");
  assert.equal(targetNow, target, "shader preparation restores the host while compilation is pending");
  assert.equal(compilingScene.children.find(mesh => mesh.material === variant).onBeforeRender, THREE.Object3D.prototype.onBeforeRender,
    "shader compilation borrows inert meshes without per-draw uniform mutation");
  complete(); await preparing;
  assert.equal(compilingScene.children.length, 0);
  assert.equal(gl.surfacePaintMaterial(sourceMaterial), sourceMaterial, "WebGL does not create WebGPU variants");

  const ordinaryMaterial = new NodeMaterial();
  ordinaryMaterial.vertexNode = sourceMaterial.vertexNode;
  ordinaryMaterial.fragmentNode = TSL.vec4(0.4, 0.3, 0.2, 1);
  webGpu.enableThreeNodePaintFold(ordinaryMaterial);
  const ordinarySource = new THREE.Mesh(geometry, ordinaryMaterial);
  Object.assign(source.userData, { heprDrawRunIndices: [0] });
  Object.assign(ordinarySource.userData, { heprDrawRun: { kind: "fill", first: 1, count: 1 }, heprDrawRunIndices: [2] });
  const documentScene = {
    drawRuns: [{ kind: "fill", first: 0, count: 1 }, { kind: "gradient-fill", first: 0, count: 1 },
      { kind: "fill", first: 1, count: 1 }],
    paintGraph: { roots: [{ kind: "group", isolated: false, knockout: false, alpha: 0.5, blendMode: "Normal",
      optionalContent: 0, softMask: { subtype: "Luminosity", children: [{ kind: "draw", runIndex: 1, optionalContent: 1 }] },
      children: [{ kind: "draw", runIndex: 0 }] }, { kind: "draw", runIndex: 2 }] }
  };
  let targeted;
  const compileHost = { ...host, compileAsync(scene) { targeted = [...scene.children]; return Promise.resolve(); } };
  sourceMaterial.toneMapped = false;
  await compositor.compileForRenderer(compileHost, [source, ordinarySource], undefined, documentScene);
  assert.equal(variant.toneMapped, false, "explicit preparation refreshes non-versioned render state before the next frame");
  assert(targeted.some(mesh => mesh.material === sourceMaterial), "potential gradient folds prepare the full shader even inside hidden layers");
  assert(targeted.some(mesh => mesh.material === variant));
  assert(targeted.some(mesh => mesh.material === compositor.surfacePaintMaterial(ordinaryMaterial)));
  assert(!targeted.some(mesh => mesh.material === ordinaryMaterial), "ordinary fills do not compile an unused full gradient shader");
  documentScene.paintGraph.roots[0].softMask.children = [{ kind: "draw", runIndex: 2 }];
  await compositor.compileForRenderer(compileHost, [source, ordinarySource], undefined, documentScene);
  assert(!targeted.some(mesh => mesh.material === sourceMaterial), "non-gradient masks need only the ordinary shader");
  delete source.userData.heprDrawRunIndices;
  delete source.userData.heprDrawRun;
  await compositor.compileForRenderer(compileHost, [source], undefined, documentScene);
  assert(targeted.some(mesh => mesh.material === sourceMaterial), "unknown draw provenance prepares both variants conservatively");
  source.userData.heprDrawRun = { kind: "fill", first: 0, count: 1 };
  ordinaryMaterial.dispose();

  compositor.renderer = host;
  const frame = folds => {
    host.draws.length = 0;
    compositor.collect([source]);
    const proxy = compositor.proxies.get(source);
    compositor.prepare(target, [], [source.material]);
    for (const [fold, shapeOnly = false] of folds) compositor.queueProxy(proxy, geometry, shapeOnly, fold);
    compositor.flush(target);
    return [...host.draws];
  };
  const gradient = { lut, linear: true,
    vectors: Float32Array.from({ length: THREE_GRADIENT_MASK_VECTORS * 4 }, (_, index) => index / 4) };
  const alpha = { subtype: "Alpha", children: [] };
  const folds = [[null], [{ opacity: 0.6, mask, content: alpha }, true],
    [{ opacity: 0.4, mask: null, content: alpha, gradient }], [null]];
  const first = frame(folds);
  assert.deepEqual(first.map(draw => draw.material), [variant, variant, sourceMaterial, variant],
    "shader selection occurs before Three captures a draw's material");
  assert.deepEqual(first.map(draw => draw.shape), [0, 1, 0, 0]);
  assert.equal(first[1].state.mask, mask); assert.equal(first[1].state.opacity, 0.6);
  assert.deepEqual(first[2].state.gradient, Array.from(gradient.vectors));
  assert.deepEqual(first[3].state, { opacity: 1, masked: false, mask: null, weights: null });
  assert.equal(shape.value, 0);
  assert.deepEqual(frame(folds).map(draw => draw.mesh), first.map(draw => draw.mesh), "warm frames retain proxy slots and shader variants");
  const restoreEnclosing = setThreePaintFold(sourceMaterial, 0.3, null, alpha, gradient);
  try {
    assert.equal(frame([[null]])[0].material, sourceMaterial, "an enclosing caller's computed fold keeps its gradient shader");
  } finally { restoreEnclosing(); }

  sourceMaterial.depthTest = false; sourceMaterial.depthWrite = false;
  sourceMaterial.transparent = true; sourceMaterial.side = THREE.DoubleSide;
  sourceMaterial.blendColor.setRGB(0.1, 0.2, 0.3);
  sourceMaterial.clippingPlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), -0.5)];
  const fragment = variant.fragmentNode;
  frame([[null]]);
  assert.equal(compositor.surfacePaintMaterial(sourceMaterial), variant, "render-state changes retain the cached material identity");
  assert.equal(variant.fragmentNode, fragment, "state synchronization retains the smaller fragment graph");
  assert.equal(variant.depthTest, false); assert.equal(variant.depthWrite, false);
  assert.equal(variant.transparent, true); assert.equal(variant.side, THREE.DoubleSide);
  assert(variant.blendColor.equals(sourceMaterial.blendColor));
  const version = variant.version;
  frame([[null]]); assert.equal(variant.version, version, "unchanged cloned clipping planes do not invalidate shaders every frame");
  sourceMaterial.clippingPlanes[0].constant = -0.7;
  frame([[null]]); assert.equal(variant.clippingPlanes[0].constant, -0.7, "in-place host clipping changes reach the variant");
  sourceMaterial.visible = false;
  compositor.collect([source]); compositor.surfacePaintMaterial(sourceMaterial);
  assert.equal(variant.visible, false);
  sourceMaterial.visible = true;

  let releases = 0;
  variant.addEventListener("dispose", () => releases++);
  sourceMaterial.needsUpdate = true;
  const replacement = frame([[null]])[0].material;
  assert.notEqual(replacement, variant); assert.equal(releases, 1, "a new source version releases its old derived shader once");
  let replacementReleases = 0;
  replacement.addEventListener("dispose", () => replacementReleases++);
  sourceMaterial.fragmentNode = TSL.vec4(1);
  assert.equal(frame([[null]])[0].material, sourceMaterial, "caller fragment replacements use the original material");
  assert.equal(replacementReleases, 1);

  webGpu.enableThreeNodePaintFold(sourceMaterial);
  const finalVariant = frame([[null]])[0].material;
  let finalReleases = 0, sourceReleases = 0, geometryReleases = 0, textureReleases = 0;
  finalVariant.addEventListener("dispose", () => finalReleases++);
  sourceMaterial.addEventListener("dispose", () => sourceReleases++);
  geometry.addEventListener("dispose", () => geometryReleases++);
  mask.addEventListener("dispose", () => textureReleases++);
  compositor.dispose();
  assert.equal(finalReleases, 1); assert.equal(sourceReleases, 0);
  assert.equal(geometryReleases, 0); assert.equal(textureReleases, 0, "derived shader disposal leaves borrowed resources live");

  const owner = new ThreePaintCompositor("webgpu", webGpu);
  const ownedVariant = owner.surfacePaintMaterial(sourceMaterial);
  let ownedReleases = 0;
  ownedVariant.addEventListener("dispose", () => ownedReleases++);
  sourceMaterial.dispose();
  assert.equal(ownedReleases, 1, "source disposal evicts a cached derived material");
  owner.dispose(); assert.equal(ownedReleases, 1, "owner cleanup cannot dispose an already evicted variant twice");
  console.log("Three fold variant compositor: cold shader coverage, stable draw slots, state changes and resource lifetime passed");
} finally {
  compositor.dispose(); gl.dispose(); sourceMaterial.dispose(); geometry.dispose(); target.dispose(); mask.dispose(); lut.dispose();
  hooks.deregister();
}
