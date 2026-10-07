import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { TSL } from "three/webgpu";
import WGSLNodeBuilder from "../node_modules/three/src/renderers/webgpu/nodes/WGSLNodeBuilder.js";

const hooks = registerHooks({ resolve(s, c, next) {
  return next(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
const webGpu = await import("../src/threeWebGpuBackend.ts");

try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { ThreeMaterialRasterLayer } = await import("../src/threeMaterialRasterLayer.ts");
  const { HeprThreePdfObject } = await import("../src/threePdfObject.ts");
  const { HEPR_THREE_LAYER_ORDER_PAGE_BACKGROUND } = await import("../src/threeLayerOrder.ts");
  const { applyThreePdfOverlayPaintOrder } = await import("../src/threePdfPaintOrder.ts");
  const scene = { ...createEmptyVectorScene(), pageCount: 396,
    pendingPagePreviews: Uint8Array.from({ length: 396 }, (_, i) => i === 2 ? 1 : 0),
    pageRects: Float32Array.from({ length: 396 * 4 }, (_, i) =>
      [Math.floor(i / 4) * 20 - 100, -10, Math.floor(i / 4) * 20 - 90, .25][i % 4]) };
  const canonical = structuredClone(scene);
  for (const [backend, colorCompositing] of [["webgl", "display"], ["webgpu", "display"], ["webgpu", "linear"]]) {
    const layer = new ThreeMaterialRasterLayer(scene, { materialBackend: backend, webGpu, colorCompositing, pageBackground: [1,1,1,1] });
    layer.setVisible(true);
    const meshes = [];
    layer.group.traverseVisible(object => { if (object.isMesh) meshes.push(object); });
    assert.equal(meshes.length, 1, `${backend}: 396 pages share one visible background mesh`);
    const [mesh] = meshes, { geometry, material } = mesh;
    assert.equal(mesh.userData.heprPageBackground, true);
    assert.equal(Array.isArray(material), false, "one material avoids per-group draws");
    assert.equal(geometry.groups.length, 0);
    assert.equal(geometry.isInstancedBufferGeometry, true);
    assert.equal(geometry.instanceCount, 396);
    assert.equal(geometry.index.count, 6);
    assert.equal(geometry.getAttribute("position").count, 4);
    assert.equal(mesh.frustumCulled, false, "page coordinates are projected in the shader");
    assert.equal(material.transparent, false, "DoubleSide backgrounds do not need two transparent passes");
    assert.equal(material.blendSrc, THREE.OneFactor);
    assert.equal(material.blendDst, THREE.OneMinusSrcAlphaFactor);
    const corners = geometry.getAttribute("aCorner"), index = geometry.index;
    const rects = geometry.getAttribute("aPageRect");
    const pending = geometry.getAttribute("aPageLoading");
    assert.equal(pending.isInstancedBufferAttribute, true);
    assert.deepEqual(Array.from(pending.array), Array.from(scene.pendingPagePreviews));
    assert.equal(corners.count, 4, "all pages reuse the unit quad");
    assert.equal(rects.isInstancedBufferAttribute, true);
    assert.equal(rects.meshPerAttribute, 1);
    assert.equal(rects.count, 396);
    assert.equal(rects.array.byteLength, 396 * 16, "each page uses four floats, without a full matrix");
    assert.deepEqual(Array.from(index.array), [0,1,2,0,2,3]);
    for (let page = 0; page < 396; page++) {
      const [x0,y0,x1,y1] = scene.pageRects.subarray(page * 4, page * 4 + 4);
      const expected = [[x0,y0], [x1,y0], [x1,y1], [x0,y1]];
      for (let vertex = 0; vertex < 4; vertex++) {
        assert.deepEqual(pageCorner(geometry, page, vertex), expected[vertex],
          `${backend}: each instance preserves its page rectangle and page order`);
      }
    }
    applyThreePdfOverlayPaintOrder(scene, layer.group, []);
    assert.equal(mesh.renderOrder, HEPR_THREE_LAYER_ORDER_PAGE_BACKGROUND);
    const cornerVersion = corners.version, indexVersion = index.version, rectVersion = rects.version;
    for (let i = 0; i < 3; i++) layer.updateFrame({ cameraCenterX: i * 10, cameraCenterY: -20, zoom: .05 + i },
      { width: 1920, height: 945 });
    const projection = new THREE.Matrix4().makeRotationX(.4);
    layer.setLocalToClipTransform(projection);
    const entry = layer.entries[0];
    if (backend === "webgl") {
      assert.equal(material.isRawShaderMaterial, true);
      assert.equal(material.defines.INSTANCED_PAGE_BACKGROUNDS, 1);
      assert.match(material.vertexShader, /aPageRect.xy \+ aPageRect.zw \* localTopDown/);
      assert.match(material.fragmentShader, /heprPagePlaceholder\(color,vUv,vPageLoading,uPagePlaceholderTime\)/);
      assert(material.uniforms.uPagePlaceholderTime.value >= 0);
      assert.equal(material.uniforms.uUseLocalToClip.value, 1);
      assert.deepEqual(material.uniforms.uLocalToClip.value.elements, projection.elements);
      assert.deepEqual(material.uniforms.uRasterMatrixABCD.value.toArray(), [1,0,0,1]);
      assert.deepEqual(material.uniforms.uRasterMatrixEF.value.toArray(), [0,0]);
    } else {
      assert.equal(material.isNodeMaterial, true);
      assert.equal(entry.webGpuState.useLocalToClipUniform.value, 1);
      const shaders = build(material, geometry);
      assert.match(shaders.vertexShader, /heprPageBackgroundPack/);
      assert.match(shaders.vertexShader, /aPageRect/);
      assert.doesNotMatch(shaders.vertexShader, /fn heprRasterPack\s*\(/);
      const attribute = shaders.getAttributesArray().find(attribute => attribute.name === "aPageRect");
      assert.equal(attribute.type, "vec4");
      assert.match(shaders.vertexShader, /heprRasterClipPosition/);
      assert.match(shaders.fragmentShader, /heprRasterFragment/);
      assert.match(shaders.fragmentShader, /fn heprPagePlaceholder\s*\(/);
      assert.match(shaders.fragmentShader, /fn heprPlaceholderBar\s*\(/);
      assert.match(shaders.vertexShader, /aPageLoading/);
      assert(entry.webGpuState.pagePlaceholderTimeUniform.value >= 0);
    }
    layer.setScreenSpaceTransform();
    assert.equal(backend === "webgl" ? material.uniforms.uUseLocalToClip.value : entry.webGpuState.useLocalToClipUniform.value, 0);
    layer.setPageBackgroundColor(.2,.4,.6,.5);
    const texture = layer.pageBackgroundTexture;
    assert.deepEqual(texture.image.data, Uint8Array.of(26,51,77,128), "background texture retains premultiplied alpha");
    const version = texture.version;
    layer.setPageBackgroundColor(.2,.4,.6,.5);
    assert.equal(texture.version, version, "unchanged colors do not upload again");
    assert.equal(corners.version, cornerVersion); assert.equal(index.version, indexVersion);
    assert.equal(rects.version, rectVersion, "camera/color changes never upload page instances");
    assert.equal(mesh.geometry, geometry, "pan, zoom, projection and color reuse the instanced mesh");
    layer.setVisible(false); layer.setVisible(true);
    assert.equal(layer.group.children.length, 1);
    const disposed = [];
    for (const resource of [geometry, material, texture]) resource.addEventListener("dispose", () => disposed.push(resource));
    layer.dispose();
    assert.equal(layer.group.children.length, 0);
    for (const resource of [geometry, material, texture]) assert(disposed.includes(resource), "instanced resources are released");
  }
  // Keep each instance tied to its canonical page slot, including reversed and
  // degenerate bounds. A normal raster alongside it must retain its own matrix.
  for (const backend of ["webgl", "webgpu"]) {
    const edgeScene = { ...createEmptyVectorScene(), pageCount: 3,
      pageRects: Float32Array.of(20, 30, -10, -5, 8, 2, 8, 12, 0, 0, 0, 0),
      rasterLayers: [{ width: 1, height: 1, data: Uint8Array.of(255,0,0,255),
        matrix: Float32Array.of(2,1,-1,3,25,-7), opacity: .5 }] };
    const layer = new ThreeMaterialRasterLayer(edgeScene, { materialBackend: backend, webGpu,
      colorCompositing: "display", pageBackground: [1,1,1,1] });
    const background = layer.entries[0], raster = layer.rasterEntries[0];
    assert.deepEqual(Array.from(background.mesh.geometry.getAttribute("aPageRect").array),
      [-10,-5,30,35, 8,2,0,10, 0,0,0,0]);
    assert.equal(background.mesh.geometry.instanceCount, 3, "page slots are not compacted or reordered");
    assert.equal(raster.mesh.geometry.hasAttribute("aPageRect"), false);
    if (backend === "webgl") {
      assert.equal(raster.material.defines.INSTANCED_PAGE_BACKGROUNDS, undefined);
      assert.deepEqual(raster.material.uniforms.uRasterMatrixABCD.value.toArray(), [2,1,-1,3]);
      assert.deepEqual(raster.material.uniforms.uRasterMatrixEF.value.toArray(), [25,-7]);
    } else {
      const shader = build(raster.material, raster.mesh.geometry).vertexShader;
      assert.match(shader, /fn heprRasterPack\s*\(/);
      assert.doesNotMatch(shader, /heprPageBackgroundPack|aPageRect/);
    }
    verifyObjectTransforms(HeprThreePdfObject, edgeScene, backend, layer);
  }
  assert.deepEqual(scene, canonical);
  console.log("Three WebGL/WebGPU page backgrounds: 396 compact instances in one mesh, page order, shader generation, transform/color reuse and cleanup passed.");
} finally { hooks.deregister(); }

function build(material, geometry) {
  // NodeBuilder generates WGSL without a browser or GPU; driver validation remains manual.
  const renderer = {
    contextNode: TSL.context({}), library: { fromMaterial: value => value },
    getRenderTarget: () => null, getMRT: () => null,
    backend: { compatibilityMode: false, utils: { getTextureSampleData: () => ({ primarySamples: 1 }) },
      capabilities: { getUniformBufferLimit: () => 65536 } },
    hasFeature: () => false, hasCompatibility: () => false,
    coordinateSystem: THREE.WebGPUCoordinateSystem,
    debug: { diagnostics: { keywords: false } }
  };
  const builder = new WGSLNodeBuilder(new THREE.Mesh(geometry, material), renderer);
  builder.scene = new THREE.Scene();
  builder.camera = new THREE.PerspectiveCamera();
  return builder.build();
}

function pageCorner(geometry, page, vertex) {
  const corners = geometry.getAttribute("aCorner"), rects = geometry.getAttribute("aPageRect");
  return [rects.getX(page) + rects.getZ(page) * (corners.getX(vertex) * .5 + .5),
    rects.getY(page) + rects.getW(page) * (.5 - corners.getY(vertex) * .5)];
}

function verifyObjectTransforms(PdfObject, scene, backend, rasterLayer) {
  const noop = () => {};
  const native = new Proxy({ getViewState: () => ({ zoom: 1, cameraCenterX: 0, cameraCenterY: 0 }),
    hasUploadedScene: () => false }, { get: (target, key) => target[key] ?? noop });
  const stub = () => new Proxy({ mesh: new THREE.Mesh(), group: new THREE.Group(),
    matrix: new THREE.Matrix4(), setLocalToClipTransform(matrix) { this.matrix.copy(matrix); } },
    { get: (target, key) => target[key] ?? noop });
  const fill = stub(), gradient = stub(), text = stub();
  const page = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  const uv = new Float32Array(8), viewport = { width: 640, height: 480 };
  const object = new PdfObject({ sourceLabel: "page-transform", sourceKind: "hep", scene }, backend,
    native, viewport, null,
    { vectorLodMode: "off", textLodMode: "off", strokeCurveEnabled: true, textVectorOnly: true,
      threeColorCompositing: "display", pageBackground: [1,1,1,1], vectorOverride: [0,0,0,0] },
    0, rasterLayer, gradient, fill, null, null, null, null, text, null, page, uv, new THREE.BufferAttribute(uv, 2));
  const parent = new THREE.Group();
  parent.add(object);
  const geometry = rasterLayer.entries[0].mesh.geometry, rects = geometry.getAttribute("aPageRect");
  const instanceVersion = rects.version, originalRects = rects.array.slice();
  try {
    for (const camera of [new THREE.OrthographicCamera(-100, 100, 75, -75, .1, 1000),
      new THREE.PerspectiveCamera(50, 640 / 480, .1, 1000)]) {
      camera.position.set(10, 20, 200); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
      for (let frame = 0; frame < 3; frame++) {
        // Move, tilt, scale and reflect the real PDF object under a transformed parent.
        parent.position.set(3 + frame, -7, 11);
        parent.rotation.set(.1, -.2, .3);
        object.position.set(10, 5 + frame, 3 * frame);
        object.rotation.set(.2 * frame, -.1, .3);
        object.scale.set(frame === 2 ? -1.5 : 1.5, .7, 1);
        parent.updateMatrixWorld(true);
        object.updateMaterialLayerTransforms(camera, viewport, true);
        const expected = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
          .multiply(object.matrixWorld).multiply(object.dataToLocalMatrix);
        assert.deepEqual(rasterLayer.localToClipUniform.elements, expected.elements,
          `${backend}: backgrounds and images follow document and ancestor transforms`);
        for (const content of [gradient, fill, text]) assert.deepEqual(content.matrix.elements, expected.elements,
          "backgrounds share the content projection");
        for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
          for (let vertex = 0; vertex < 4; vertex++) {
            const [x, y] = pageCorner(geometry, pageIndex, vertex);
            const shaderPoint = new THREE.Vector3(x, y, 0).applyMatrix4(rasterLayer.localToClipUniform);
            const worldPoint = new THREE.Vector3(x, y, 0).applyMatrix4(object.dataToLocalMatrix);
            const reference = object.localToWorld(worldPoint).project(camera);
            assert(shaderPoint.distanceTo(reference) < 1e-10, "instanced page corners match Three object projection");
          }
        }
      }
    }
    assert.equal(rects.version, instanceVersion, "document transforms do not reupload page instances");
    assert.deepEqual(rects.array, originalRects, "document transforms do not rewrite page rectangles");
  } finally {
    object.removeFromParent(); object.dispose();
  }
}
