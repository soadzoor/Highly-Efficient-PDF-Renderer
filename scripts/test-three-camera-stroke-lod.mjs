import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { HeprThreePdfObject } = await import("../src/threePdfObject.ts");
  const { ThreeVectorLodStrokeLayer, shouldUseVectorStrokeLod } = await import("../src/vectorStrokeLod.ts");
  const { ThreeVectorDrawPlan } = await import("../src/threeVectorDrawPlan.ts");
  const { ThreeMaterialRasterLayer } = await import("../src/threeMaterialRasterLayer.ts");
  const { ThreeMaterialGradientLayer } = await import("../src/threeMaterialGradientLayer.ts");
  const { ThreeMaterialFillLayer } = await import("../src/threeMaterialFillLayer.ts");
  const { ThreeMaterialTextLayer } = await import("../src/threeMaterialTextLayer.ts");
  const count = 153_600, viewport = { width: 1920, height: 945 };
  for (const overviewFixture of [false, true]) {
    const data = { ...createEmptyVectorScene(), segmentCount: count, maxHalfWidth: .12, pageCount: 1,
      bounds: { minX: 1000, minY: -500, maxX: 2000, maxY: 500 },
      pageRects: Float32Array.of(1000, -500, 2000, 500) };
    for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) data[key] = new Float32Array(count * 4);
    for (let index = 0; index < count; index++) {
      const x = overviewFixture ? 1000 + index % 400 * 2.5 : 1500;
      const y = overviewFixture ? -475 + Math.floor(index / 400) * 2.5 : 0;
      const length = overviewFixture ? (index % 10 === 0 ? 5 : .1) : 0;
      data.endpoints.set([x, y, x + length, y], index * 4);
      data.primitiveMeta.set([x + length, y, 0, 5], index * 4);
      data.primitiveBounds.set([x, y, x + length, y], index * 4);
      data.styles.set([.12, 0, 0, 0], index * 4);
    }
    const noop = () => {};
    for (const ordered of [false, true]) for (const backend of ["webgl", "webgpu"]) {
      const source = ordered ? { ...data, drawRuns: [{ kind: "stroke", first: 0, count }] } : data;
      assert(shouldUseVectorStrokeLod("auto", backend, source.segmentCount));
      const drawPlan = ordered ? new ThreeVectorDrawPlan(source) : undefined;
      const options = { materialBackend: backend, colorCompositing: "display", drawPlan,
        strokeCurveEnabled: true, textVectorOnly: true, vectorOverride: [0, 0, 0, 0], pageBackground: [1, 1, 1, 1] };
      const lod = new ThreeVectorLodStrokeLayer(source, options);
      let viewState = { zoom: 1, cameraCenterX: 1500, cameraCenterY: 0 };
      const native = new Proxy({ getViewState: () => viewState, hasUploadedScene: () => false,
        setViewState: value => { viewState = value; }, getPresentedFrameSerial: () => 0,
        renderExternalFrame: () => assert.fail("the camera-driven Three path must remain vector rendered") },
      { get: (target, key) => target[key] ?? noop });
      const page = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshBasicMaterial());
      const uv = new Float32Array(8);
      const object = new HeprThreePdfObject({ sourceLabel: "camera-lod", sourceKind: "hep", scene: source }, backend,
        native, { ...viewport }, null,
        { vectorLodMode: "auto", textLodMode: "off", strokeCurveEnabled: true, textVectorOnly: true,
          threeColorCompositing: "display", pageBackground: [1, 1, 1, 1], vectorOverride: [0, 0, 0, 0] },
        0, new ThreeMaterialRasterLayer(source, options), new ThreeMaterialGradientLayer(source, options),
        new ThreeMaterialFillLayer(source, options), null, null, lod, null, new ThreeMaterialTextLayer(source, options),
        null, page, uv, new THREE.BufferAttribute(uv, 2), drawPlan);
      const host = { isWebGLRenderer: backend === "webgl", isWebGPURenderer: backend === "webgpu",
        outputColorSpace: THREE.LinearSRGBColorSpace, capabilities: { maxTextureSize: 16384 },
        getDrawingBufferSize: target => target.set(viewport.width, viewport.height), getPixelRatio: () => 1 };
      const camera = new THREE.PerspectiveCamera(45, viewport.width / viewport.height, .1, 10000);
      camera.position.set(0, 0, 3000); camera.lookAt(0, 0, 0);
      // Real controls reproduce the ~6e-17 clip-W slope that an idealized matrix misses.
      const controls = new MapControls(camera, null);
      controls.enableDamping = false; controls.screenSpacePanning = true;
      const frame = () => {
        controls.update(); camera.updateMatrixWorld(true); object.updateMatrixWorld(true);
        object.prepareFrameForThreeRenderer(host, camera);
      };
      try {
        frame();
        const matrix = lod.runtime.localToClip;
        assert(matrix[7] !== 0 && Math.abs(matrix[7]) < 1e-14, "fixture exercises actual controls roundoff");
        assert(object.getVectorStrokeLodStats().baselineLevelIndex > 0, `${backend}/${ordered}: Auto LOD survives MapControls roundoff`);
        const initialCount = object.getRenderedStrokeSegmentCount();
        assert(initialCount > 0 && initialCount < count);
        if (overviewFixture) {
          assert(object.getVectorStrokeLodStats().activeLevels.some(level => level.overview),
            "the real Three object selects the new overview levels");
          assert(initialCount <= 82_500, "Three overview follows the shared 50k soft budget");
        }
        let selections = 0;
        const runtimeUpdate = lod.runtime.update.bind(lod.runtime);
        lod.runtime.update = (...args) => { const changed = runtimeUpdate(...args); if (changed) selections++; return changed; };
        const updates = lod.layers.map(layer => layer.updateFrameWithVisibleSegmentIds);
        for (const layer of lod.layers) layer.updateFrameWithVisibleSegmentIds = () =>
          assert.fail("panning through the real Three object must not repack selected IDs");
        for (let index = 0; index < 60; index++) {
          camera.position.x += .2; controls.target.x += .2;
          camera.position.y += .1; controls.target.y += .1;
          // The example updates near/far as the target moves relative to the page.
          camera.near = 1 + index * .1; camera.far = 5000 + index * 5; camera.updateProjectionMatrix();
          frame();
          assert.equal(object.getRenderedStrokeSegmentCount(), initialCount);
        }
        assert.equal(selections, 0, "60 real pan frames reuse the initial vector selection");
        lod.layers.forEach((layer, index) => { layer.updateFrameWithVisibleSegmentIds = updates[index]; });
        // A real tilt still excludes density/overview LOD; returning to front-facing enables it.
        camera.position.set(0, 800, 3000); controls.target.set(0, 0, 0); frame();
        assert.equal(object.getVectorStrokeLodStats().baselineLevelIndex, 0);
        camera.position.set(0, 0, 3000); frame();
        assert(object.getVectorStrokeLodStats().baselineLevelIndex > 0);
        camera.position.set(0, 0, 10); frame();
        assert.equal(object.getVectorStrokeLodStats().baselineLevelIndex, 0, "close zoom restores exact geometry");
        if (overviewFixture) {
          assert(lod.runtime.getRenderedSegmentCount() > 0, "zoomed-in visible exact geometry remains rendered");
          assert(object.getVectorStrokeLodStats().activeLevels.every(level => level.index === 0));
        } else assert.equal(lod.runtime.getRenderedSegmentCount(), count);
        console.log(`${overviewFixture ? "overview" : "density"}/${backend}/${ordered ? "ordered" : "legacy"}: Auto LOD ${count}→${initialCount}; 60 MapControls pans, zero reselections; tilt/zoom exact`);
      } finally { object.dispose(); }
    }
  }
} finally { hooks.deregister(); }
