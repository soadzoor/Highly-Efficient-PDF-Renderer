import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });

try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { ThreeMaterialRasterLayer } = await import("../src/threeMaterialRasterLayer.ts");
  const { applyThreePdfOverlayPaintOrder } = await import("../src/threePdfPaintOrder.ts");
  const makeScene = count => {
    const scene = createEmptyVectorScene();
    scene.pageCount = 2;
    scene.pageRects = new Float32Array([0, 0, 100, 100, 0, 110, 100, 210]);
    scene.rasterLayers = Array.from({ length: count }, (_, index) => image(index));
    scene.drawRuns = [{ kind: "raster", first: 0, count }];
    return scene;
  };
  const createLayer = (scene, materialBackend, colorCompositing = "display") =>
    new ThreeMaterialRasterLayer(scene, { materialBackend, colorCompositing, pageBackground: [1, 1, 1, 1] });

  for (const [backend, colorCompositing] of [["webgl", "display"], ["webgpu", "display"], ["webgpu", "linear"]]) {
    const scene = makeScene(13);
    scene.gradientFillPathCount = 1;
    scene.clipPaths = [rectangle(0, 0, 100, 100), rectangle(10, 20, 80, 90)];
    scene.optionalContent = { groups: [], conditions: [{ kind: "constant", value: true },
      { kind: "constant", value: true }], order: [], radioGroups: [] };
    scene.drawRuns = [
      { kind: "raster", first: 0, count: 5, clipIndex: 0, optionalContent: 0 },
      { kind: "gradient-fill", first: 0, count: 1 },
      { kind: "raster", first: 5, count: 4, clipIndex: 1, optionalContent: 1 },
      { kind: "raster", first: 9, count: 4, blendMode: "Multiply" }
    ];
    const sourcePixels = scene.rasterLayers.map(source => source.data.slice());
    const sourceMatrices = scene.rasterLayers.map(source => source.matrix.slice());
    const sourceRuns = structuredClone(scene.drawRuns);
    const layer = createLayer(scene, backend, colorCompositing);
    const originals = [...layer.rasterEntries];
    const strips = [...layer.stripEntries];
    assert.equal(strips.length, 2, "clip, optional-content, vector and blend boundaries remain separate");
    assert.deepEqual(strips.map(entry => entry.mesh.userData.heprDrawRun), [
      { kind: "raster", first: 0, count: 5 }, { kind: "raster", first: 5, count: 4 }
    ]);
    assert.equal(layer.group.children.filter(mesh => mesh.userData.heprPageBackground).length, 1,
      "merged page background does not shift canonical raster indices");
    assert.equal(layer.group.visible, false);
    const gradient = new THREE.Mesh();
    applyThreePdfOverlayPaintOrder(scene, layer.group, [{ mesh: gradient, pageIndex: 0, paintOrder: 0 }]);
    assert(strips[0].mesh.renderOrder < gradient.renderOrder);
    assert(gradient.renderOrder < strips[1].mesh.renderOrder);
    assert(strips[1].mesh.renderOrder < originals[9].mesh.renderOrder);
    assert.equal(strips[0].mesh.renderOrder, originals[0].mesh.renderOrder);
    assert.equal(strips[1].mesh.renderOrder, originals[5].mesh.renderOrder);
    assert(originals[9].mesh.children[0].renderOrder > originals[9].mesh.renderOrder);
    const originalOrders = originals.map(entry => entry.mesh.renderOrder);
    const initialVersions = originals.map(entry => entry.texture.version);
    const releases = strips.map(entry => ({ texture: countDisposals(entry.texture),
      geometry: countDisposals(entry.mesh.geometry), material: countDisposals(entry.material) }));
    for (const entry of strips) {
      assert.equal(entry.mesh.frustumCulled, false, "page-space shader quads bypass object-space frustum bounds");
      assert.equal(entry.mesh.geometry.isInstancedBufferGeometry, true);
      assert.equal(entry.mesh.geometry.instanceCount, entry.mesh.userData.heprDrawRun.count);
      assert.deepEqual([...entry.mesh.geometry.index.array], [0, 1, 2, 2, 1, 3],
        "indexed triangles preserve the shared native shader's vertex IDs");
      const first = entry.mesh.userData.heprDrawRun.first;
      const matrixA = entry.mesh.geometry.getAttribute("aRasterMatrixABCD");
      const matrixB = entry.mesh.geometry.getAttribute("aRasterMatrixEFWidthOpacity");
      for (let row = 0; row < entry.mesh.geometry.instanceCount; row++) {
        const source = scene.rasterLayers[first + row];
        assert.deepEqual([matrixA.getX(row), matrixA.getY(row), matrixA.getZ(row), matrixA.getW(row)],
          [...source.matrix.slice(0, 4)], "reflection and shear remain per-image instance data");
        assert.deepEqual([matrixB.getX(row), matrixB.getY(row), matrixB.getZ(row), matrixB.getW(row)],
          [source.matrix[4], source.matrix[5], source.width, source.opacity]);
      }
      assert.equal(entry.texture.generateMipmaps, false, "atlas rows never mix through hardware mip generation");
      assert.equal(entry.texture.minFilter, THREE.LinearFilter);
      assert.equal(entry.texture.flipY, false);
      assert.equal(entry.material.blendSrc, THREE.OneFactor);
      assert.equal(entry.material.blendDst, THREE.OneMinusSrcAlphaFactor);
      assert.equal(entry.material.depthTest, false);
      if (backend === "webgl") assert.equal(entry.material.uniforms.uVectorClipIndex.value, first === 0 ? 0 : 1);
    }
    // For an odd-width ramp, normalized linear reduction retains the center
    // texel. Three's WebGL and WebGPU mip generators both use this sampling.
    assert.deepEqual([...strips[0].texture.image.data.slice(3 * 4, 4 * 4)], [60, 30, 15, 128]);
    assert.equal(layer.getMaxRasterTextureDimension(), 54, "host caps account for packed atlas width");

    layer.setVisible(true);
    layer.setTextureResidency(true);
    assert.equal(layer.group.children.length, 7, "hidden canonical images leave the frame traversal");
    assert.equal(visibleRasters(layer).length, 6, "two instanced batches and four Multiply images remain");
    for (let index = 0; index < 9; index++) {
      assert.equal(originals[index].mesh.parent, null);
      assert.equal(originals[index].resident, false);
      assert.equal(originals[index].texture.version, initialVersions[index], "covered originals do not request GPU upload");
    }
    layer.setOptionalContentVisibility({ revision: 1, layers: [], conditions: new Uint8Array([0, 1]) });
    assert.equal(strips[0].mesh.visible, false);
    assert.equal(strips[1].mesh.visible, true);
    layer.setOptionalContentVisibility({ revision: 2, layers: [], conditions: new Uint8Array([1, 0]) });
    assert.equal(strips[0].mesh.visible, true);
    assert.equal(strips[1].mesh.visible, false);
    layer.setOptionalContentVisibility({ revision: 3, layers: [], conditions: new Uint8Array([1, 1]) });

    const stripTextureVersions = strips.map(entry => entry.texture.version);
    const stripInstanceVersions = strips.map(entry => entry.mesh.geometry.getAttribute("aRasterMatrixABCD").data.version);
    const transform = new THREE.Matrix4().set(1, 0.2, 0, 3, -0.1, 2, 0, 4, 0, 0, 1, 0, 0.01, 0, 0, 1);
    layer.updateFrame({ cameraCenterX: 17, cameraCenterY: 21, zoom: 3 }, { width: 640, height: 480 });
    layer.setLocalToClipTransform(transform);
    for (const entry of strips) {
      if (backend === "webgl") {
        assert.deepEqual(entry.material.uniforms.uViewport.value.toArray(), [640, 480]);
        assert.deepEqual(entry.material.uniforms.uCameraCenter.value.toArray(), [17, 21]);
        assert.equal(entry.material.uniforms.uZoom.value, 3);
        assert.equal(entry.material.uniforms.uUseLocalToClip.value, 1);
        assert.deepEqual(entry.material.uniforms.uLocalToClip.value.elements, transform.elements);
      } else {
        assert.equal(entry.webGpuState.zoomUniform.value, 3);
        assert.equal(entry.webGpuState.useLocalToClipUniform.value, 1);
      }
    }
    assert.deepEqual(strips.map(entry => entry.texture.version), stripTextureVersions,
      "camera changes do not request atlas uploads");
    assert.deepEqual(strips.map(entry => entry.mesh.geometry.getAttribute("aRasterMatrixABCD").data.version), stripInstanceVersions,
      "camera changes do not request instance-buffer uploads");
    layer.setTextureResidency(false);
    layer.setTextureResidency(false);
    for (const count of releases) assert.equal(count.texture(), 1, "dormancy releases each resident atlas once");
    assert.equal(visibleRasters(layer).length, 0);
    const dormantVersions = strips.map(entry => entry.texture.version);
    layer.setTextureResidency(true);
    for (let index = 0; index < strips.length; index++) assert(strips[index].texture.version > dormantVersions[index]);
    assert.equal(visibleRasters(layer).length, 6);

    const identical = originals.map(entry => entry.texture);
    layer.prepareRasterLayerUpdates(new Map(scene.rasterLayers.map((value, index) => [index, value]))).commit();
    assert.deepEqual(originals.map(entry => entry.texture), identical, "canonical raster identities do not allocate replacement textures");
    assert.equal(layer.stripEntries.length, 2, "unchanged updates retain strip batches");
    const cancelled = layer.prepareRasterLayerUpdates(new Map([[0, image(20)]]));
    cancelled.dispose();
    layer.prepareRasterLayerUpdates(new Map()).commit();
    assert.equal(layer.stripEntries.length, 2, "cancelled and empty updates retain valid batches");
    assert.throws(() => layer.prepareRasterLayerUpdates(new Map([[99, image(20)]])), /Invalid staged raster layer update/);
    const replacedTextureReleases = countDisposals(originals[0].texture);
    const replacement = image(25);
    const update = layer.prepareRasterLayerUpdates(new Map([[0, replacement]]));
    update.commit(); update.dispose();
    assert.equal(layer.stripEntries.length, 0, "committed replacements cannot leave stale atlas pixels");
    assert.equal(layer.group.children.length, 14);
    assert.equal(visibleRasters(layer).length, 13);
    assert.equal(replacedTextureReleases(), 1);
    const currentTexture = originals[0].texture;
    layer.prepareRasterLayerUpdates(new Map([[0, replacement]])).commit();
    assert.equal(originals[0].texture, currentTexture, "cached replay identities retain an already replaced texture");
    for (let index = 0; index < originals.length; index++) {
      assert.equal(originals[index].mesh.parent, layer.group);
      assert.equal(originals[index].mesh.renderOrder, originalOrders[index], "fallback preserves PDF paint order");
      assert.equal(originals[index].resident, true);
      if (backend === "webgpu") {
        assert.equal(originals[index].webGpuState.zoomUniform.value, 3, "fallback restores current frame uniforms");
        assert.equal(originals[index].webGpuState.useLocalToClipUniform.value, 1);
      }
    }
    layer.setScreenSpaceTransform();
    if (backend === "webgpu") assert(originals.every(entry => entry.webGpuState.useLocalToClipUniform.value === 0));
    for (const count of releases) {
      assert.equal(count.texture(), 2, "replacement releases the atlas reuploaded after dormancy");
      assert.equal(count.geometry(), 1);
      assert.equal(count.material(), 1);
    }
    layer.dispose();
    assert.equal(layer.group.children.length, 0);
    for (const count of releases) assert.equal(count.texture(), 2, "retired atlases are not disposed again with the layer");
    assert.deepEqual(scene.drawRuns, sourceRuns);
    assert.deepEqual(scene.rasterLayers.map(source => source.data), sourcePixels, "canonical PDF pixels remain untouched");
    assert.deepEqual(scene.rasterLayers.map(source => source.matrix), sourceMatrices);
  }

  for (const backend of ["webgl", "webgpu"]) {
    const dense = createLayer(makeScene(520), backend);
    assert.deepEqual(dense.stripEntries.map(entry => entry.mesh.geometry.instanceCount), [512, 8]);
    assert.equal(dense.getMaxRasterTextureDimension(), 512, "atlas row count participates in texture caps");
    dense.setTextureResidency(true);
    assert.equal(dense.group.children.length, 3);
    assert.equal(visibleRasters(dense).length, 2);
    const retired = dense.stripEntries.map(entry => countDisposals(entry.texture));
    dense.setTextureResidency(false);
    dense.prepareRasterLayerUpdates(new Map([[2, image(24)]])).commit();
    assert.equal(visibleRasters(dense).length, 0, "updates during dormancy do not expose original images");
    dense.setTextureResidency(true);
    assert.equal(visibleRasters(dense).length, 520);
    dense.dispose();
    for (const count of retired) assert.equal(count(), 2, "evicted atlas metadata is released when batching is invalidated");

    const addStripBatch = ThreeMaterialRasterLayer.prototype.addStripBatch;
    const warn = console.warn;
    const warnings = [];
    let attempts = 0, partialReleases, recovered;
    try {
      console.warn = (...args) => warnings.push(args);
      ThreeMaterialRasterLayer.prototype.addStripBatch = function (batch) {
        if (++attempts === 2) throw new Error("synthetic optional atlas allocation failure");
        addStripBatch.call(this, batch);
        const entry = this.stripEntries[0];
        partialReleases = [entry.texture, entry.material, entry.mesh.geometry].map(countDisposals);
      };
      recovered = createLayer(makeScene(520), backend);
    } finally {
      ThreeMaterialRasterLayer.prototype.addStripBatch = addStripBatch;
      console.warn = warn;
    }
    assert.equal(attempts, 2);
    assert.equal(warnings.length, 1, "optional batch failure emits a compatibility diagnostic");
    assert.match(warnings[0][0], /drawing original image layers/);
    assert.equal(recovered.stripEntries.length, 0);
    assert(recovered.rasterEntries.every(entry => !entry.batched));
    assert.deepEqual(partialReleases.map(count => count()), [1, 1, 1], "partial batch allocation releases all owned resources");
    recovered.setTextureResidency(true);
    assert.equal(visibleRasters(recovered).length, 520, "atlas allocation failure preserves every visible image");
    recovered.dispose();
    assert.deepEqual(partialReleases.map(count => count()), [1, 1, 1], "discarded partial batches are not released twice");

    for (const excluded of ["paintGraph", "retainedPages", "blend", "filteredSource"]) {
      const scene = makeScene(8);
      if (excluded === "paintGraph") scene.paintGraph = { roots: [{ kind: "draw", runIndex: 0 }] };
      else if (excluded === "retainedPages") scene.retainedPages = [{}];
      else if (excluded === "blend") scene.drawRuns[0].blendMode = "Multiply";
      else scene.rasterLayers[0] = { ...scene.rasterLayers[0], data: new Uint8Array(0) };
      const layer = createLayer(scene, backend);
      assert.equal(layer.stripEntries.length, 0, `${excluded} retains canonical rendering`);
      layer.setTextureResidency(true);
      assert.equal(visibleRasters(layer).length, excluded === "filteredSource" ? 7 : 8);
      layer.dispose();
    }
  }
  console.log("Three raster strip batches passed: both backends, paint order, clips, visibility, transforms, residency, replacements and ownership.");
} finally { hooks.deregister(); }

function image(index) {
  const width = [3, 19, 27, 2, 1][index % 5];
  const data = new Uint8Array(width * 4);
  for (let x = 0; x < width; x++) data.set([100 + x * 20, 50 + x * 10, 25 + x * 5, 128], x * 4);
  return { width, height: 1, data, opacity: index % 2 ? 0.5 : 1,
    matrix: new Float32Array([index % 2 ? -10 : 10, 2, 3, 5, index * 10, index * 4]) };
}

function rectangle(x0, y0, x1, y1) {
  return { parent: -1, fillRule: 0, edges: new Float32Array([
    x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0
  ]) };
}

function visibleRasters(layer) {
  return layer.group.children.filter(mesh => mesh.visible && mesh.userData.heprDrawRun?.kind === "raster");
}

function countDisposals(resource) {
  let count = 0;
  resource.addEventListener("dispose", () => count++);
  return () => count;
}
