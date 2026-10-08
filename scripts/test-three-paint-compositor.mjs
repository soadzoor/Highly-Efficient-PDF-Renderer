import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";
import { RenderPerformanceProfiler } from "../src/renderPerformance.ts";
import { withThreeRenderPerformance } from "../src/threeRenderPerformance.ts";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
    return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
} });

const webGpu = await import("../src/threeWebGpuBackend.ts");

try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { ThreePaintCompositor, projectThreePdfCompositeBounds } = await import("../src/threePaintCompositor.ts");
  for (const backend of ["webgl", "webgpu"]) {
    const compositor = new ThreePaintCompositor(backend, webGpu);
    for (const camera of [new THREE.PerspectiveCamera(50, 1.5, .1, 1000), new THREE.OrthographicCamera(-50,50,50,-50,.1,1000)]) {
      camera.coordinateSystem = backend === "webgpu" ? THREE.WebGPUCoordinateSystem : THREE.WebGLCoordinateSystem;
      camera.position.set(20,30,100); camera.lookAt(0,0,0); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      const object = new THREE.Object3D(); object.position.set(5,-3,12); object.rotation.set(.3,.2,.5); object.scale.set(-1.5,.7,1); object.updateMatrix();
      const projection = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).multiply(object.matrix);
      compositor.setPageDepth(projection);
      for (const [x,y] of [[-10,-10],[8,-6],[5,12]]) {
        const clip = new THREE.Vector3(x,y,0).applyMatrix4(projection), d=compositor.pageDepth;
        assert(Math.abs(d.x*clip.x+d.y*clip.y+d.z-clip.z)<1e-10, `${backend}: composited fragments keep the transformed page plane depth`);
      }
      assert.equal(compositor.mesh.material.depthTest,true);
    }
    compositor.dispose();
  }
  const { ThreeMaterialStrokeLayer } = await import("../src/threeMaterialStrokeLayer.ts");
  const { ThreeMaterialRasterLayer } = await import("../src/threeMaterialRasterLayer.ts");
  const { setThreePdfShapeOnly } = await import("../src/threePdfShape.ts");
  const f = values => Float32Array.from(values);
  const scene = Object.assign(createEmptyVectorScene(), {
    pageRects: f([0, 0, 10, 10]), pageBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, segmentCount: 2, maxHalfWidth: 1,
    endpoints: f([1, 2, 0, 0, 1, 4, 0, 0]), primitiveMeta: f([9, 2, 0, 0.5, 9, 4, 0, 0]),
    styles: f([1, 1, 0, 0, 1, 0, 0, 1]), primitiveBounds: f([0, 0, 10, 3, 0, 3, 10, 5]),
    rasterLayers: [{ width: 1, height: 1, data: Uint8Array.of(255, 0, 0, 128), matrix: f([10, 0, 0, -10, 0, 10]), opacity: 0.5 }],
    drawRuns: [{ kind: "stroke", first: 0, count: 2, blendMode: "Multiply" }, { kind: "raster", first: 0, count: 1 }],
    paintGraph: { roots: [{ kind: "group", isolated: true, knockout: true, alpha: 0.5, blendMode: "Normal",
      children: [{ kind: "draw", runIndex: 0 }, { kind: "draw", runIndex: 1 }] }] }
  });
  const original = scene.rasterLayers[0].data.slice();
  for (const backend of ["webgl", "webgpu"]) {
    const stroke = new ThreeMaterialStrokeLayer(scene, { materialBackend: backend, webGpu,
      strokeCurveEnabled: true, vectorOverride: [0, 0, 0, 0] });
    const raster = new ThreeMaterialRasterLayer(scene, { materialBackend: backend, webGpu, pageBackground: [1, 1, 1, 1] });
    const entry = raster.rasterEntries[0];
    const oldTexture = entry.texture;
    let oldDisposed = 0; oldTexture.addEventListener("dispose", () => oldDisposed++);
    const replacement = { width: 2, height: 1, data: Uint8Array.of(0, 255, 0, 255, 0, 0, 255, 128),
      matrix: f([8, 0, 0, -10, 2, 10]), opacity: 0.25 };
    const staged = raster.prepareRasterLayerUpdates(new Map([[0, replacement]]));
    assert.equal(entry.texture, oldTexture, "preparing must leave the presented texture intact");
    staged.commit(); staged.dispose(); staged.commit();
    assert.equal(oldDisposed, 1);
    assert.notEqual(entry.texture, oldTexture);
    assert.equal(entry.resident, false, "staging cannot wake a dormant renderer");
    assert.equal(entry.mesh.visible, false);
    assert.deepEqual([...entry.texture.image.data], [0, 255, 0, 255, 0, 0, 128, 128]);
    if (backend === "webgl") {
      assert.equal(entry.material.uniforms.uRasterTex.value, entry.texture);
      assert.equal(entry.material.uniforms.uRasterOpacity.value, 0.25);
      assert.deepEqual(entry.material.uniforms.uRasterMatrixEF.value.toArray(), [2, 10]);
    }
    const current = entry.texture;
    const cancelled = raster.prepareRasterLayerUpdates(new Map([[0, scene.rasterLayers[0]]]));
    cancelled.dispose(); cancelled.commit();
    assert.equal(entry.texture, current);
    assert.throws(() => raster.prepareRasterLayerUpdates(new Map([[0, scene.rasterLayers[0]], [3, replacement]])), /Invalid staged/);
    assert.equal(entry.texture, current, "an invalid batch cannot partly replace a texture");
    raster.setTextureResidency(true);
    assert.equal(entry.resident, true);
    const restoreShape = setThreePdfShapeOnly(entry.material, true);
    restoreShape();

    const compositor = new ThreePaintCompositor(backend, webGpu);
    const host = makeRenderer(backend);
    const state = snapshot(host);
    const roots = [stroke.mesh, raster.group];
    compositor.render(host, scene, roots, 32, 24, () => true);
    assert.deepEqual(snapshot(host), state, "offscreen rendering restores all host state");
    assert.equal(compositor.mesh.visible, true);
    const strokes = host.draws.filter(draw => draw.ids);
    assert.deepEqual(strokes.map(draw => draw.ids), [[0], [0], [1], [1]], "knockout draws individual canonical primitive IDs");
    if (backend === "webgl") assert.deepEqual(strokes.map(draw => draw.shape), [0, 1, 0, 1]);
    assert.equal(stroke.mesh.children.length, 1, "the graph handles Multiply without legacy duplicate passes");
    assert.equal(stroke.mesh.children[0].geometry.instanceCount, 2, "subset draws cannot alter ordinary culling buffers");
    host.draws.length = 0;
    compositor.render(host, scene, roots, 32, 24, () => true);
    // The presented surface is withheld from the pool for one frame so it is
    // never a render attachment while the presentation material still samples
    // it. That costs one extra surface once, and then pooling is steady.
    const surfaces = compositor.surfaces.size;
    const profiler = new RenderPerformanceProfiler();
    profiler.start({ gpu: false, maxFrames: 1 });
    profiler.beginFrame();
    withThreeRenderPerformance(profiler, () => compositor.render(host, scene, roots, 32, 24, () => true));
    profiler.endFrame();
    const measured = profiler.getReport();
    assert.equal(measured.counters["three.compositorFrames"].total, 1);
    assert.equal(measured.counters["three.surfaceBytes"].total, surfaces * 32 * 24 * 4);
    assert.ok(measured.counters["three.strokeDraws"].total > 0);
    assert.ok(measured.counters["three.compositePasses"].total > 0);
    assert.ok(measured.cpuSections["three.compositorCollect"]);
    assert.ok(measured.cpuSections["three.compositorSelection"]);
    assert.ok(measured.cpuSections["three.batchLookup"]);
    assert.ok(measured.cpuSections["three.batchGeometry"]);
    assert.ok(measured.cpuSections["three.hostDraw"]);
    assert.ok(measured.cpuSections["three.hostPass"]);
    assert.equal(measured.discardedMetricNames, 0);
    profiler.dispose();
    assert.equal(compositor.surfaces.size, surfaces, "unchanged frames reuse render targets");
    assert.equal(compositor.mesh.visible, true, "the presentation mesh is shown again after compositing");

    // Three rebuilds a bind group only when the newly bound texture reports a
    // different generation, and that generation is the texture's version.
    // Render-target textures never raise it, so equal versions leave the
    // previous texture bound and a pass can sample the surface it is writing.
    const versions = [...compositor.surfaces].map(target => target.texture.version);
    assert.ok(versions.length > 1, "the frame pooled several surfaces");
    if (backend === "webgpu") {
      assert.equal(new Set(versions).size, versions.length,
        "every WebGPU compositor surface carries its own texture version");
      assert.ok(versions.every(version => version > 0), "and one Three treats as initialized");
    } else {
      assert.equal(new Set(versions).size, 1,
        "WebGL rebinds samplers per draw, so its surfaces keep Three's default version");
    }

    // The presentation material samples the previous frame's output for as long
    // as that mesh is in the host scene. Handing the same surface straight back
    // to the pool made it a render attachment while it was still bound, which
    // WebGPU rejects as a read/write overlap inside one frame.
    const presented = compositor.output;
    assert.ok(presented, "a composited frame presents a surface");
    host.targets.length = 0;
    compositor.render(host, scene, roots, 32, 24, () => true);
    assert.ok(!host.targets.includes(presented),
      "the surface the presentation material still samples is never a render attachment");
    assert.notEqual(compositor.output, presented, "the next frame presents a different surface");

    // Mask transfer samples may exceed the GPU's maximum single-row texture width.
    const transfer = Float32Array.from({ length: 65536 }, (_, index) => index / 65535);
    const mask = compositor.transferTexture(transfer);
    assert.equal(mask.image.width, 1024);
    assert.equal(mask.image.height, 64);
    assert.equal(mask.image.data[65535], 1);

    host.fail = true;
    assert.throws(() => compositor.render(host, scene, roots, 32, 24, () => true), /synthetic draw failure/);
    assert.deepEqual(snapshot(host), state, "failure restores host state and shape uniforms");
    host.fail = false;
    const warn = console.warn;
    const warnings = [];
    console.warn = message => warnings.push(message);
    try { compositor.render(host, scene, roots, 16384, 16384, () => true); }
    finally { console.warn = warn; }
    assert.ok(compositor.width < 16384 && compositor.height < 16384,
      "large viewports lower transient surface resolution while preserving the PDF graph");
    assert.equal(warnings.length, 1);
    assert.deepEqual(snapshot(host), state);
    assert.deepEqual(scene.rasterLayers[0].data, original);
    // An uninterrupted Normal-blend span is one composite, so its paints reach
    // the host as a single render in source order. Group alpha keeps the scene
    // on the compositing path; without it the runs would flatten instead.
    const spanScene = Object.assign(createEmptyVectorScene(), {
      pageRects: f([0, 0, 10, 10]), pageBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, segmentCount: 2, maxHalfWidth: 1,
      endpoints: f([1, 2, 0, 0, 1, 4, 0, 0]), primitiveMeta: f([9, 2, 0, 0.5, 9, 4, 0, 0.5]),
      styles: f([1, 1, 0, 0, 1, 0, 0, 1]), primitiveBounds: f([0, 0, 10, 3, 0, 3, 10, 5]),
      drawRuns: [{ kind: "stroke", first: 0, count: 1 }, { kind: "stroke", first: 1, count: 1 }],
      paintGraph: { roots: [{ kind: "group", isolated: false, knockout: false, alpha: 0.5, blendMode: "Normal",
        children: [{ kind: "draw", runIndex: 0 }, { kind: "draw", runIndex: 1 }] }] }
    });
    const spanStroke = new ThreeMaterialStrokeLayer(spanScene, { materialBackend: backend, webGpu,
      strokeCurveEnabled: true, vectorOverride: [0, 0, 0, 0] });
    const spanCompositor = new ThreePaintCompositor(backend, webGpu);
    const spanHost = makeRenderer(backend);
    spanCompositor.render(spanHost, spanScene, [spanStroke.mesh], 32, 24, () => true);
    const spanDraws = spanHost.draws.filter(draw => draw.ids);
    // Side-by-side paints sharing a program and clip become one mesh, exactly
    // as they do when the scene needs no compositing at all.
    assert.deepEqual(spanDraws.map(draw => draw.ids), [[0, 1]],
      "the span's paints are batched into one submission, in source order");
    assert.equal(new Set(spanDraws.map(draw => draw.call)).size, 1,
      "the span costs one host render, and without a knockout it renders no shape at all");
    // Normal groups blend directly, and their effects touch only their projected
    // rectangle. The root reuses its private backdrop without a copy.
    spanHost.draws.length = 0;
    const boundedProject = bounds => ({ x: bounds.minX + 100, y: bounds.minY + 80,
      width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY });
    // A pass covers its rectangle with geometry placed by a clip-space uniform,
    // which it sets as it draws.
    spanHost.rectOf = mesh => mesh.geometry.getAttribute("aSegmentIndex") ? undefined : spanCompositor.passRect.toArray();
    spanCompositor.render(spanHost, spanScene, [spanStroke.mesh], 320, 240, () => true, boundedProject);
    const boundedClears = spanHost.clears.filter(clear => clear.scissorTest);
    if (backend === "webgl") {
      assert.ok(boundedClears.length > 0, "WebGL clears use the effect bounds too");
      assert.ok(boundedClears.every(clear => clear.scissor[2] < 30 && clear.scissor[3] < 30),
        "small effects do not clear the full framebuffer");
    } else assert.equal(boundedClears.length, 0, "WebGPU keeps its whole-attachment fast clear");
    const effects = spanHost.draws.filter(draw => !draw.ids);
    assert.equal(effects.length, 1, "only the direct source-over pass remains");
    const blended = effects.find(draw => draw.blending === THREE.CustomBlending);
    assert.ok(blended, "group opacity uses the hardware blending pass");
    assert.equal(blended.blendSrc, THREE.OneFactor, "effect output is premultiplied on both backends");
    assert.equal(blended.blendDst, THREE.OneMinusSrcAlphaFactor);
    // Three sets a scissor per render call, so a scissored pass could never
    // share a render with the draws around it.
    assert.ok(effects.every(draw => !draw.scissorTest), "passes restrict themselves with geometry, not a scissor");
    const [minX, minY, maxX, maxY] = blended.rect;
    assert.ok(maxX - minX < 30 / 160 && maxY - minY < 30 / 120, "a small effect does not shade the full target");
    assert.ok(minY < 0 && maxY < 0, "clip space counts the shared bottom-left rectangle upwards on both backends");
    assert.deepEqual(snapshot(spanHost), state, "bounded effects restore the host scissor and target");
    assert.ok(effects.every(draw => draw.rect.join() !== "-1,-1,1,1"), "no full-target root copy remains");
    spanHost.draws.length = 0;
    spanHost.clears.length = 0;
    spanCompositor.render(spanHost, spanScene, [spanStroke.mesh], 320, 240, () => true,
      bounds => ({ ...boundedProject(bounds), x: 10000 }));
    assert.equal(spanHost.draws.filter(draw => !draw.ids).length, 0, "offscreen effects skip their composite pass");
    assert.equal(spanHost.clears.length, 1, "offscreen effects skip clears, keeping only the backdrop clear");
    assert.equal(spanHost.clears[0].scissorTest, false, "a pooled scissor cannot restrict the backdrop clear");

    // A scheduled mesh can own disjoint canonical ranges, and LOD IDs can be
    // unrelated to those ranges. Every instanced attribute follows the selected
    // rows, including clip roots; filtering only IDs would clip the wrong paint.
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute("aSegmentIndex", new THREE.InstancedBufferAttribute(f([10, 5, 12]), 1));
    geometry.setAttribute("aVectorClipIndex", new THREE.InstancedBufferAttribute(f([1, 2, 3]), 1));
    geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute([0, 0], 2));
    geometry.setIndex([0]);
    geometry.instanceCount = 2;
    const proxySource = new THREE.Mesh(geometry, new THREE.RawShaderMaterial());
    const origins = new Uint32Array(13); origins[10] = 3; origins[5] = 7; origins[12] = 9;
    Object.assign(proxySource.userData, { heprDrawRun: { kind: "stroke", first: 3, count: 3 },
      heprDrawRanges: [{ first: 3, count: 1 }, { first: 7, count: 1 }, { first: 9, count: 1 }],
      heprCanonicalOrigins: origins, heprInstanceAttribute: "aSegmentIndex" });
    spanCompositor.collect([proxySource]);
    spanCompositor.renderer = spanHost;
    spanHost.draws.length = 0;
    const partialTarget = spanCompositor.acquire();
    // Draws queue into a batch that renders when something needs its result.
    spanCompositor.draw([{ kind: "stroke", first: 7, count: 1 }], partialTarget, false);
    spanCompositor.flush();
    assert.deepEqual(spanHost.draws.map(draw => draw.ids), [[5]], "subset membership uses canonical origins");
    assert.deepEqual(spanHost.draws.map(draw => draw.clips), [[2]], "clip roots are gathered with instance IDs");
    const proxy = spanCompositor.proxies.get(proxySource);
    const originalPartial = proxy.partialGeometries[0];
    const originalIds = originalPartial.getAttribute("aSegmentIndex");
    const originalClips = originalPartial.getAttribute("aVectorClipIndex");
    const borrowedCorner = geometry.getAttribute("aCorner"), borrowedIndex = geometry.index;
    let partialDisposals = 0;
    originalPartial.addEventListener("dispose", () => {
      partialDisposals++;
      assert.equal(originalPartial.getAttribute("aSegmentIndex"), originalIds,
        "old owned buffers remain attached while Three releases them");
      assert.equal(originalPartial.getAttribute("aVectorClipIndex"), originalClips);
      assert.equal(originalPartial.getAttribute("aCorner"), undefined, "borrowed attributes cannot be disposed");
      assert.equal(originalPartial.index, null, "borrowed indices cannot be disposed");
    });
    geometry.instanceCount = 3;
    spanCompositor.collect([proxySource]);
    spanCompositor.draw([{ kind: "stroke", first: 9, count: 1 }], partialTarget, false);
    spanCompositor.flush();
    assert.equal(proxy.partialGeometries[0], originalPartial,
      "revealing more instances reuses the source-sized partial allocation");
    assert.equal(partialDisposals, 0);
    geometry.setAttribute("aSegmentIndex", new THREE.InstancedBufferAttribute(f([10, 5, 12, 5]), 1));
    geometry.setAttribute("aVectorClipIndex", new THREE.InstancedBufferAttribute(f([1, 2, 3, 4]), 1));
    geometry.instanceCount = 4;
    spanHost.draws.length = 0;
    // A frame starts by collecting its meshes, before anything is queued.
    spanCompositor.collect([proxySource]);
    assert.equal(partialDisposals, 1, "growing source capacity retires the previous owned GPU buffers");
    spanCompositor.draw([{ kind: "stroke", first: 7, count: 1 }], partialTarget, false);
    spanCompositor.flush();
    assert.notEqual(proxy.partialGeometries[0], originalPartial);
    assert.deepEqual(spanHost.draws.map(draw => draw.ids), [[5, 5]]);
    assert.deepEqual(spanHost.draws.map(draw => draw.clips), [[2, 4]]);
    assert.equal(geometry.getAttribute("aCorner"), borrowedCorner);
    assert.equal(geometry.index, borrowedIndex);
    const originalGeometryForRuns = spanCompositor.geometryForRuns;
    let inputCount = 0;
    spanCompositor.geometryForRuns = function(entry, runs, use) {
      inputCount = runs.length;
      return originalGeometryForRuns.call(this, entry, runs, use);
    };
    spanCompositor.draw([{ kind: "stroke", first: 3, count: 7 }], partialTarget, false);
    spanCompositor.flush();
    assert.equal(inputCount, 1, "a merged run reaching three ranges on one proxy is collected only once");
    spanCompositor.geometryForRuns = originalGeometryForRuns;
    assert.equal(spanCompositor.geometryForRuns({ ...proxy, ranges: [{ first: 3, count: 7 }] }, [
      { kind: "stroke", first: 7, count: 3 }, { kind: "stroke", first: 3, count: 4 }
    ], 0), geometry, "adjacent inputs jointly cover a range without copying or uploading instances");
    const overlap = spanCompositor.geometryForRuns(proxy, [
      { kind: "stroke", first: 3, count: 7 }, { kind: "stroke", first: 7, count: 1 }
    ], 0);
    assert.equal(overlap, geometry, "a shorter overlapping input cannot hide the enclosing range's tail");
    let rangeReads = 0;
    const manyRanges = Array.from({ length: 4096 }, (_, index) => ({
      get first() { rangeReads++; return index * 2; }, count: 1
    }));
    const manyRuns = manyRanges.map(range => ({ kind: "stroke", first: range.first, count: 1 }));
    rangeReads = 0;
    assert.equal(spanCompositor.geometryForRuns({ ...proxy, ranges: manyRanges }, manyRuns, 0), geometry);
    assert.ok(rangeReads < manyRanges.length * 4,
      "large scheduled meshes must not rescan the entire input span for each canonical range");
    let replacementDisposals = 0;
    proxy.partialGeometries[0].addEventListener("dispose", () => replacementDisposals++);
    spanCompositor.release(partialTarget); spanCompositor.renderer = null;
    spanCompositor.dispose(); spanStroke.dispose();
    assert.equal(partialDisposals, 1, "retired partial geometry is disposed only once");
    assert.equal(replacementDisposals, 1, "the replacement allocation is released with the compositor");

    // The graph may paint adjacent runs back to front. A mesh renders its
    // instances in id order, so merging those two would silently swap them:
    // batching must follow the graph's own sequence, not the run indices.
    const splitScene = Object.assign(createEmptyVectorScene(), {
      pageRects: f([0, 0, 10, 10]), pageBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, segmentCount: 2, maxHalfWidth: 1,
      endpoints: f([1, 2, 0, 0, 1, 4, 0, 0]), primitiveMeta: f([9, 2, 0, 0.5, 9, 4, 0, 0.5]),
      styles: f([1, 1, 0, 0, 1, 0, 0, 1]), primitiveBounds: f([0, 0, 10, 3, 0, 3, 10, 5]),
      drawRuns: [{ kind: "stroke", first: 0, count: 1 }, { kind: "stroke", first: 1, count: 1 }],
      // One list, contiguous and otherwise mergeable, but painted back to front.
      paintGraph: { roots: [{ kind: "group", isolated: false, knockout: false, alpha: 0.5, blendMode: "Normal",
        children: [{ kind: "draw", runIndex: 1 }, { kind: "draw", runIndex: 0 }] }] }
    });
    const splitStroke = new ThreeMaterialStrokeLayer(splitScene, { materialBackend: backend, webGpu,
      strokeCurveEnabled: true, vectorOverride: [0, 0, 0, 0] });
    const splitCompositor = new ThreePaintCompositor(backend, webGpu);
    const splitHost = makeRenderer(backend);
    splitCompositor.render(splitHost, splitScene, [splitStroke.mesh], 32, 24, () => true);
    assert.deepEqual(splitHost.draws.filter(draw => draw.ids).map(draw => draw.ids), [[1], [0]],
      "paints the graph reverses stay separate meshes, in the graph's order");
    const splitPasses = splitHost.draws.length;
    // Once the layer's own culling empties a mesh, its group has nothing left
    // to composite, so the whole group drops out with its surfaces and passes.
    for (const mesh of splitStroke.mesh.children) mesh.geometry.instanceCount = 0;
    splitHost.draws.length = 0;
    splitCompositor.render(splitHost, splitScene, [splitStroke.mesh], 32, 24, () => true);
    assert.deepEqual(splitHost.draws.filter(draw => draw.ids).map(draw => draw.ids), [],
      "culled paints submit nothing");
    // Dropping the only group leaves just the root's own machinery: 4 host
    // renders here against 13, where merely skipping its empty draw costs 11.
    assert.ok(splitHost.draws.length * 2 < splitPasses,
      `an emptied group drops its surfaces and passes too (${splitHost.draws.length} vs ${splitPasses})`);
    splitCompositor.dispose(); splitStroke.dispose();

    // Raster and gradient slots have no layer instance culling. Their projected
    // bounds must drop the complete offscreen group, not only its final pass.
    const slotScene = Object.assign(createEmptyVectorScene(), {
      rasterLayers: [scene.rasterLayers[0]],
      clipPaths: [{ parent: -1, fillRule: 0, edges: f([0, 0, 10, 0, 10, 0, 10, 10,
        10, 10, 0, 10, 0, 10, 0, 0]) }],
      drawRuns: [{ kind: "raster", first: 0, count: 1 },
        { kind: "gradient-fill", first: 0, count: 1, clipIndex: 0 }],
      paintGraph: { roots: [{ kind: "group", isolated: true, knockout: false, alpha: 0.5,
        blendMode: "Normal", children: [{ kind: "draw", runIndex: 0 }, { kind: "draw", runIndex: 1 }] }] }
    });
    const slotMeshes = slotScene.drawRuns.map((run, index) => {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.RawShaderMaterial({
        uniforms: { uTestTag: { value: index } }
      }));
      mesh.userData.heprDrawRun = run;
      return mesh;
    });
    const slotCompositor = new ThreePaintCompositor(backend, webGpu), slotHost = makeRenderer(backend);
    const slotDraws = () => slotHost.draws.filter(draw => draw.tag !== undefined).map(draw => draw.tag);
    const drawSlots = project => {
      slotHost.draws.length = 0;
      slotCompositor.render(slotHost, slotScene, slotMeshes, 320, 240, () => true, project);
      return slotDraws();
    };
    assert.deepEqual(drawSlots(boundedProject), [0, 1], "visible slots retain source order");
    const visiblePassCount = slotHost.draws.length;
    assert.deepEqual(drawSlots(bounds => ({ ...boundedProject(bounds), x: 10000 })), []);
    assert.ok(slotHost.draws.length < visiblePassCount, "offscreen slots also drop their group's passes");
    assert.deepEqual(drawSlots(boundedProject), [0, 1], "panning back restores every slot");
    assert.deepEqual(drawSlots(() => null), [0, 1], "uncertain perspective projections keep paints");
    assert.deepEqual(drawSlots(null), [0, 1], "hosts without a projector keep paints");
    assert.deepEqual(drawSlots(() => ({ x: 321, y: 10, width: 1, height: 10 })), [0, 1],
      "the two-pixel AA guard keeps paints just outside the viewport");
    const unboundedScene = { ...slotScene, drawRuns: [slotScene.drawRuns[0],
      { kind: "gradient-fill", first: 0, count: 1 }] };
    slotHost.draws.length = 0;
    slotCompositor.render(slotHost, unboundedScene, slotMeshes, 320, 240, () => true,
      bounds => ({ ...boundedProject(bounds), x: 10000 }));
    assert.deepEqual(slotDraws(), [1], "an unbounded gradient cannot be discarded by projection");
    slotCompositor.dispose();
    for (const mesh of slotMeshes) { mesh.geometry.dispose(); mesh.material.dispose(); }

    testProxyReplacement(ThreePaintCompositor, backend);
    await testFolding(ThreePaintCompositor, backend);
    await testGradientMaskFolding(ThreePaintCompositor, backend);
    await testCompositorOnlyLayers(scene, backend);

    compositor.dispose(); stroke.dispose(); raster.dispose();
    assert.throws(() => raster.prepareRasterLayerUpdates(new Map()), /disposed/);
  }
  const matrix = new THREE.Matrix4();
  assert.deepEqual(projectThreePdfCompositeBounds({ minX: -0.5, minY: -0.25, maxX: 0.5, maxY: 0.25 }, matrix, 200, 100),
    { x: 50, y: 37.5, width: 100, height: 25 }, "projection uses physical viewport pixels");
  matrix.elements[14] = -0.5;
  assert.ok(projectThreePdfCompositeBounds({ minX: -0.5, minY: -0.25, maxX: 0.5, maxY: 0.25 }, matrix, 200, 100),
    "WebGL keeps bounded passes in the negative half of its valid NDC depth range");
  assert.equal(projectThreePdfCompositeBounds({ minX: -0.5, minY: -0.25, maxX: 0.5, maxY: 0.25 }, matrix, 200, 100, "webgpu"), null,
    "WebGPU retains a full pass for the same rectangle crossing its nearer depth plane");
  matrix.elements[14] = 0;
  matrix.elements[3] = 4;
  assert.equal(projectThreePdfCompositeBounds({ minX: -1, minY: -1, maxX: 1, maxY: 1 }, matrix, 200, 100), null,
    "a rectangle crossing the perspective near plane conservatively keeps a full pass");
  console.log("Three PDF compositor state, canonical subsets, shape coverage, folding, pooling, and staged raster updates passed");
} finally { hooks.deregister(); }

async function testCompositorOnlyLayers(source, backend) {
  const { HeprThreePdfObject } = await import("../src/threePdfObject.ts");
  const { ThreeMaterialStrokeLayer } = await import("../src/threeMaterialStrokeLayer.ts");
  const { ThreeMaterialRasterLayer } = await import("../src/threeMaterialRasterLayer.ts");
  const { ThreeMaterialGradientLayer } = await import("../src/threeMaterialGradientLayer.ts");
  const { ThreeMaterialFillLayer } = await import("../src/threeMaterialFillLayer.ts");
  const { ThreeMaterialTextLayer } = await import("../src/threeMaterialTextLayer.ts");
  const { ThreeVectorDrawPlan } = await import("../src/threeVectorDrawPlan.ts");
  const viewport = { width: 320, height: 240 }, drawPlan = new ThreeVectorDrawPlan(source);
  const options = { materialBackend: backend, webGpu, colorCompositing: "display", drawPlan,
    strokeCurveEnabled: true, textVectorOnly: true, vectorOverride: [0, 0, 0, 0], pageBackground: [1, 1, 1, 1] };
  const stroke = new ThreeMaterialStrokeLayer(source, options);
  let viewState = { cameraCenterX: 5, cameraCenterY: 5, zoom: 20 };
  const native = new Proxy({ getViewState: () => viewState, hasUploadedScene: () => false,
    setViewState: value => { viewState = value; }, getPresentedFrameSerial: () => 0,
    renderExternalFrame: () => assert.fail("composited materials must not also render through native") },
  { get: (target, key) => target[key] ?? (() => {}) });
  const uv = new Float32Array(8);
  const object = new HeprThreePdfObject({ sourceLabel: "composited-stats", sourceKind: "hep", scene: source }, backend,
    native, { ...viewport }, null,
    { vectorLodMode: "off", textLodMode: "off", strokeCurveEnabled: true, textVectorOnly: true,
      threeColorCompositing: "display", pageBackground: [1, 1, 1, 1], vectorOverride: [0, 0, 0, 0] },
    0, new ThreeMaterialRasterLayer(source, options), new ThreeMaterialGradientLayer(source, options),
    new ThreeMaterialFillLayer(source, options), stroke, null, null, null, new ThreeMaterialTextLayer(source, options),
    null, new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial()),
    uv, new THREE.BufferAttribute(uv, 2), drawPlan, undefined, webGpu);
  const outer = new THREE.Scene(); outer.add(object);
  const host = Object.assign(makeRenderer(backend), {
    isWebGLRenderer: backend === "webgl", isWebGPURenderer: backend === "webgpu",
    outputColorSpace: THREE.LinearSRGBColorSpace, capabilities: { maxTextureSize: 16384 },
    getDrawingBufferSize: target => target.set(viewport.width, viewport.height), getPixelRatio: () => 1
  });
  const camera = new THREE.PerspectiveCamera(45, viewport.width / viewport.height, .1, 1000);
  camera.position.z = 16;
  const frame = () => {
    camera.updateMatrixWorld(true); outer.updateMatrixWorld(true);
    host.draws.length = 0;
    // Match Three: prepare via the scene hook before gathering visible objects,
    // then invoke the page callback, which must not prepare the PDF a second time.
    outer.onBeforeRender(host, outer, camera, host.target);
    object.handleBeforeRender(host, camera);
  };
  const previousDisable = globalThis.HEPR_DEBUG_DISABLE_COMPOSITOR;
  try {
    globalThis.HEPR_DEBUG_DISABLE_COMPOSITOR = false;
    frame();
    const roots = object.listThreeMaterialObjects();
    assert(roots.every(root => root.parent === null), "compositor source layers stay outside the host scene");
    assert.equal(object.getRenderedStrokeSegmentCount(), 2, "post-render HUD reports composited strokes");
    assert.equal(object.getTextInstanceStats().rendered, 0, "composited text statistics remain available");
    assert.equal(object.paintCompositor.mesh.visible, true);
    // This knockout fixture needs a colour and a shape draw for each stroke.
    // The source IDs must occur only in those required compositor submissions.
    assert.deepEqual(host.draws.filter(draw => draw.ids).map(draw => draw.ids), [[0], [0], [1], [1]]);
    const outerPaints = [];
    outer.traverseVisible(mesh => { if (mesh.userData.heprDrawRun) outerPaints.push(mesh); });
    assert.deepEqual(outerPaints, [], "outer presentation cannot submit the source paints again");
    for (const proxy of object.paintCompositor.proxies.values()) {
      for (const mesh of proxy.meshes) {
        assert.equal(mesh.material, proxy.source.material, "compositor proxies reuse source materials");
      }
    }
    let updates = 0;
    const originalUpdates = roots.map(root => root.updateMatrixWorld);
    roots.forEach(root => { root.updateMatrixWorld = () => { updates++; }; });
    try { outer.updateMatrixWorld(true); }
    finally { roots.forEach((root, i) => { root.updateMatrixWorld = originalUpdates[i]; }); }
    assert.equal(updates, 0, "outer matrix updates never visit compositor-only layers");

    camera.position.x = 100; frame();
    assert.equal(object.getRenderedStrokeSegmentCount(), 0, "offscreen composited strokes report zero");
    camera.position.x = 0; frame();
    assert.equal(object.getRenderedStrokeSegmentCount(), 2, "panning back restores the count");

    globalThis.HEPR_DEBUG_DISABLE_COMPOSITOR = true; frame();
    assert(roots.every(root => root.parent === object), "direct rendering reattaches its sources");
    assert.equal(object.paintCompositor.mesh.visible, false, "direct rendering hides the old composite");
    assert.equal(object.getRenderedStrokeSegmentCount(), 2);
    globalThis.HEPR_DEBUG_DISABLE_COMPOSITOR = false; frame();
    assert(roots.every(root => root.parent === null), "switching back detaches sources again");
    assert.equal(object.getRenderedStrokeSegmentCount(), 2);
  } finally {
    if (previousDisable === undefined) delete globalThis.HEPR_DEBUG_DISABLE_COMPOSITOR;
    else globalThis.HEPR_DEBUG_DISABLE_COMPOSITOR = previousDisable;
    outer.remove(object); object.dispose(); host.target.dispose();
  }
}

function makeRenderer(backend = "webgpu") {
  return {
    coordinateSystem: backend === "webgpu" ? THREE.WebGPUCoordinateSystem : THREE.WebGLCoordinateSystem,
    target: new THREE.RenderTarget(7, 9), viewport: new THREE.Vector4(3, 4, 17, 19),
    scissor: new THREE.Vector4(5, 6, 11, 13), scissorTest: true, clearColor: new THREE.Color(0.2, 0.3, 0.4),
    clearAlpha: 0.7, autoClear: true, xr: { enabled: true }, cube: 2, mip: 1, draws: [], clears: [], targets: [], fail: false,
    // WebGPURenderer's lighting manager; WebGLRenderer has none.
    ...(backend === "webgpu" ? { lighting: { enabled: true } } : {}), litRenders: 0,
    getRenderTarget() { return this.target; },
    setRenderTarget(target, cube = 0, mip = 0) { this.target = target; this.cube = cube; this.mip = mip; this.targets.push(target); },
    getActiveCubeFace() { return this.cube; }, getActiveMipmapLevel() { return this.mip; },
    getViewport(out) { return out.copy(this.viewport); }, setViewport(value) { this.viewport.copy(value); },
    getScissor(out) { return out.copy(this.scissor); }, setScissor(value) { this.scissor.copy(value); },
    getScissorTest() { return this.scissorTest; }, setScissorTest(value) { this.scissorTest = value; },
    getClearColor(out) { return out.copy(this.clearColor); }, getClearAlpha() { return this.clearAlpha; },
    setClearColor(color, alpha) { this.clearColor.copy(color); this.clearAlpha = alpha; },
    clear() { this.clears.push({ scissorTest: this.target.scissorTest, scissor: this.target.scissor.toArray() }); },
    render(scene, camera) {
      this.call = (this.call ?? 0) + 1;
      // Mirrors Renderer._updateCamera: the first render whose coordinate
      // system differs from the camera's rebuilds the projection. The abstract
      // THREE.Camera base class has no updateProjectionMatrix, so a compositor
      // built on it throws on its first composited WebGPU frame.
      assert.ok(camera?.isCamera, "the compositor renders through a camera");
      if (camera.coordinateSystem !== this.coordinateSystem) {
        camera.coordinateSystem = this.coordinateSystem;
        camera.updateProjectionMatrix();
      }
      if (this.lighting?.enabled) this.litRenders++;
      if (this.fail) throw new Error("synthetic draw failure");
      assert.equal(this.scissorTest, this.target.scissorTest, "WebGPU also needs the renderer scissor-test flag");
      // Like Three: meshes draw in render order, each between its own hooks,
      // which is where the compositor applies a batched mesh's state.
      for (const mesh of [...scene.children].sort((a, b) => a.renderOrder - b.renderOrder)) {
        mesh.onBeforeRender(this, scene, camera, mesh.geometry, mesh.material, null);
        this.onMesh?.(mesh);
        const ids = mesh.geometry.getAttribute("aSegmentIndex");
        this.draws.push({ call: this.call,
          tag: mesh.material.uniforms?.uTestTag?.value,
          ids: ids && Array.from({ length: mesh.geometry.instanceCount }, (_, i) => ids.getX(i)),
          shape: mesh.material.uniforms?.uPdfShapeOnly?.value,
          clips: mesh.geometry.getAttribute("aVectorClipIndex") && Array.from({ length: mesh.geometry.instanceCount },
            (_, i) => mesh.geometry.getAttribute("aVectorClipIndex").getX(i)),
          blending: mesh.material.blending, blendSrc: mesh.material.blendSrc, blendDst: mesh.material.blendDst,
          scissor: this.target.scissor.toArray(), scissorTest: this.target.scissorTest, rect: this.rectOf?.(mesh) });
        mesh.onAfterRender(this, scene, camera, mesh.geometry, mesh.material, null);
      }
    }
  };
}
// A Normal group holding one fill, with an opacity and a soft mask, folds onto
// that fill: it draws straight onto the parent surface with the chain's
// factors, and needs no surface, clear or composite pass of its own.
async function testFolding(ThreePaintCompositor, backend) {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { ThreeMaterialFillLayer } = await import("../src/threeMaterialFillLayer.ts");
  const { threePaintFoldState } = await import("../src/threePaintFold.ts");
  const square = (x, y, size) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
  const paths = [square(1, 1, 4), square(2, 2, 6)];
  const a = [], b = [], metaA = [], metaB = [], metaC = [];
  for (const points of paths) {
    const start = a.length / 4;
    points.forEach(([x0, y0], index) => { const [x1, y1] = points[(index + 1) % points.length];
      a.push(x0, y0, x0, y0); b.push(x1, y1, 0, 0); });
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    metaA.push(start, points.length, Math.min(...xs), Math.min(...ys));
    metaB.push(Math.max(...xs), Math.max(...ys), 1, 0);
    metaC.push(0, 0, 0, 1);
  }
  const f = values => Float32Array.from(values);
  const group = { kind: "group", isolated: false, knockout: false, alpha: 0.5, blendMode: "Normal",
    softMask: { subtype: "Alpha", children: [{ kind: "draw", runIndex: 1 }] }, children: [{ kind: "draw", runIndex: 0 }] };
  const scene = Object.assign(createEmptyVectorScene(), {
    pageRects: f([0, 0, 10, 10]), pageBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    fillPathCount: 2, fillSegmentCount: a.length / 4, fillPathMetaA: f(metaA), fillPathMetaB: f(metaB),
    fillPathMetaC: f(metaC), fillSegmentsA: f(a), fillSegmentsB: f(b),
    drawRuns: [{ kind: "fill", first: 0, count: 1 }, { kind: "fill", first: 1, count: 1 }],
    paintGraph: { roots: [group] }
  });
  const fill = new ThreeMaterialFillLayer(scene, { materialBackend: backend, webGpu, vectorOverride: [0, 0, 0, 0] });
  const compositor = new ThreePaintCompositor(backend, webGpu);
  const host = makeRenderer(backend);
  const folds = [], clearingRenders = [];
  const render = host.render.bind(host);
  host.render = (renderScene, camera) => {
    if (host.autoClear) clearingRenders.push(host.target);
    render(renderScene, camera);
  };
  host.onMesh = mesh => {
    const ids = mesh.geometry.getAttribute("aFillPathIndex");
    if (ids) folds.push({ ids: Array.from({ length: mesh.geometry.instanceCount }, (_, i) => ids.getX(i)),
      fold: threePaintFoldState(mesh.material) });
  };
  const profiler = new RenderPerformanceProfiler();
  profiler.start({ gpu: false, maxFrames: 1 });
  profiler.beginFrame();
  withThreeRenderPerformance(profiler, () => compositor.render(host, scene, [fill.mesh], 32, 24, () => true));
  profiler.endFrame();
  const counters = profiler.getReport().counters;
  profiler.dispose();
  assert.equal(counters["three.foldedPaints"]?.total, 1, `${backend}: the masked group folds onto its fill`);
  const masked = folds.find(draw => draw.fold?.masked);
  assert.ok(masked, `${backend}: the folded fill draws with its mask`);
  assert.deepEqual(masked.ids, [0], "only the folded paint draws, from its own one-instance geometry");
  assert.equal(masked.fold.opacity, 0.5, "the fold carries the group's opacity");
  assert.ok([...compositor.surfaces].some(target => target.texture === masked.fold.mask), "the mask is a compositor surface");
  // The mask surface holds the mask's rendered content; the fold reads its alpha.
  assert.deepEqual(masked.fold.weights, [0, 0, 0, 1, 0], "the folded fill converts the alpha mask's content itself");
  const neutral = { opacity: 1, masked: false, mask: null, weights: null };
  assert.deepEqual(folds.filter(draw => draw !== masked).map(draw => draw.fold),
    folds.filter(draw => draw !== masked).map(() => neutral), "every other draw keeps the neutral fold");
  assert.deepEqual(threePaintFoldState(fill.mesh.material), neutral, "the fold is restored after drawing");
  // Folding saves the group's surface, its clear and its composite, and the
  // folded draw converts the mask's content, which saves the mask's pass. What
  // is left is the mask content's own surface; the backdrop is painted in place.
  assert.equal(counters["three.compositePasses"]?.total ?? 0, 0, `${backend}: neither root nor mask needs a copy pass`);
  assert.equal(counters["three.clears"]?.total, 2, `${backend}: only the backdrop and the mask content are cleared`);
  // A WebGPU clear is a render pass and submission of its own, so it rides on
  // the next render into its target. Both backdrop and mask now clear as
  // their paints load, with no standalone clear submission.
  if (backend === "webgpu") {
    assert.equal(host.clears.length, 0, "webgpu: no standalone clear remains");
    assert.equal(counters["three.clearPasses"]?.total ?? 0, 0);
    assert.equal(clearingRenders.length, 2, "webgpu: both surfaces clear as their draws load");
  } else {
    assert.equal(host.clears.length, 2, "webgl: scissored clears stay separate calls");
    assert.equal(clearingRenders.length, 0);
  }
  assert.equal(host.autoClear, true, "the host's own clear setting is restored");
  if (backend === "webgpu") {
    // No compositor material is lit, and a lit render rehashes the lights node.
    assert.equal(host.litRenders, 0, "webgpu: compositor renders run with lighting off");
    assert.equal(host.lighting.enabled, true, "webgpu: the host's lighting is restored");
  }
  compositor.dispose(); fill.dispose();
}

// Broschuere's fades: a luminosity mask made of one gradient fill over the
// page. Given the projection, the folded fill computes that mask itself, so the
// gradient never renders, no mask surface is taken, and the backdrop and the
// folded draw share one host render.
async function testGradientMaskFolding(ThreePaintCompositor, backend) {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { ThreeMaterialFillLayer } = await import("../src/threeMaterialFillLayer.ts");
  const { ThreeMaterialGradientLayer } = await import("../src/threeMaterialGradientLayer.ts");
  const { threePaintFoldState } = await import("../src/threePaintFold.ts");
  const f = values => Float32Array.from(values);
  const square = [[1, 1], [5, 1], [5, 5], [1, 5]];
  const lut = new Uint8Array(1024 * 4);
  for (let x = 0; x < 1024; x++) lut.set([x >> 2, 255 - (x >> 2), 128, 255], x * 4);
  const scene = Object.assign(createEmptyVectorScene(), {
    pageRects: f([0, 0, 10, 10]), pageBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    fillPathCount: 1, fillSegmentCount: 4, fillPathMetaA: f([0, 4, 1, 1]), fillPathMetaB: f([5, 5, 1, 0]),
    fillPathMetaC: f([0, 0, 0, 1]),
    fillSegmentsA: f(square.flatMap(([x, y]) => [x, y, x, y])),
    fillSegmentsB: f(square.flatMap((_, index) => [...square[(index + 1) % 4], 0, 0])),
    gradientCount: 1, gradientMetaA: f([0, 0, 0, 0]), gradientMetaB: f([1, 0, 0, 1]), gradientMetaC: f([0, 0, 0, 0]),
    gradientMetaD: f([10, 0, 0, 0]), gradientMetaE: f([0, 0, 0, 0]), gradientLut: lut,
    gradientFillPathCount: 1, gradientFillSegmentCount: 4, gradientFillPathMetaA: f([0, 4, 0, 0]),
    gradientFillPathMetaB: f([10, 10, 0, 0]), gradientFillPathMetaC: f([0, 0, 0, 1]), gradientFillPaintMeta: f([0, -1, 0, 0]),
    gradientFillSegmentsA: f([0, 0, 0, 0, 10, 0, 10, 0, 10, 10, 10, 10, 0, 10, 0, 10]),
    gradientFillSegmentsB: f([10, 0, 0, 0, 10, 10, 0, 0, 0, 10, 0, 0, 0, 0, 0, 0]),
    drawRuns: [{ kind: "fill", first: 0, count: 1 }, { kind: "gradient-fill", first: 0, count: 1 }],
    paintGraph: { roots: [{ kind: "group", isolated: false, knockout: false, alpha: 0.5, blendMode: "Normal",
      softMask: { subtype: "Luminosity", children: [{ kind: "draw", runIndex: 1 }] }, children: [{ kind: "draw", runIndex: 0 }] }] }
  });
  const fill = new ThreeMaterialFillLayer(scene, { materialBackend: backend, webGpu, vectorOverride: [0, 0, 0, 0] });
  const gradient = new ThreeMaterialGradientLayer(scene, { materialBackend: backend, webGpu, strokeCurveEnabled: true,
    vectorOverride: [0, 0, 0, 0] });
  const gradientMaterials = new Set(gradient.getOrderedPaintMeshes().map(entry => entry.material));
  const clipFromData = new THREE.Matrix4().makeScale(0.2, 0.2, 1).premultiply(new THREE.Matrix4().makeTranslation(-1, -1, 0));
  const compositor = new ThreePaintCompositor(backend, webGpu);
  const host = makeRenderer(backend);
  const folds = [];
  let gradientDraws = 0;
  host.onMesh = mesh => {
    if ([...compositor.proxies.values()].some(proxy => gradientMaterials.has(proxy.source.material) && proxy.meshes.includes(mesh))) gradientDraws++;
    const state = threePaintFoldState(mesh.material);
    if (state?.masked) folds.push(state);
  };
  const frame = matrix => {
    folds.length = 0; gradientDraws = 0; host.call = 0;
    const profiler = new RenderPerformanceProfiler();
    profiler.start({ gpu: false, maxFrames: 1 });
    profiler.beginFrame();
    withThreeRenderPerformance(profiler, () => compositor.render(host, scene, [fill.mesh, gradient.group], 32, 24,
      () => true, null, matrix));
    profiler.endFrame();
    const counters = profiler.getReport().counters;
    profiler.dispose();
    return counters;
  };
  let counters = frame(clipFromData);
  assert.equal(counters["three.computedMasks"]?.total, 1, `${backend}: the fold computes its gradient mask`);
  assert.equal(gradientDraws, 0, `${backend}: the mask's gradient never renders`);
  assert.equal(folds.length, 1);
  assert.equal(folds[0].opacity, 0.5);
  assert.ok(folds[0].mask?.image?.width === 1024 && folds[0].mask.image.data[4] === lut[4],
    "the fold reads the gradient's colour table in place of a mask surface");
  assert.ok(folds[0].gradient?.length === 60, "the fold carries the gradient mask's description");
  assert.equal(host.call, 1, `${backend}: the folded draw needs only one host render`);
  assert.equal(counters["three.hostRenders"]?.total, 1);
  assert.equal(threePaintFoldState(fill.mesh.material).masked, false, "the fold is restored after drawing");
  // Without the projection, the mask renders into a surface as before.
  counters = frame(null);
  assert.equal(counters["three.computedMasks"]?.total ?? 0, 0);
  assert.equal(gradientDraws, 1, `${backend}: without a projection the gradient renders the mask`);
  assert.ok(folds.length === 1 && !folds[0].gradient, "and the fold reads that surface");
  compositor.dispose(); fill.dispose(); gradient.dispose();
}

function snapshot(renderer) {
  return { target: renderer.target.uuid, viewport: renderer.viewport.toArray(), scissor: renderer.scissor.toArray(),
    scissorTest: renderer.scissorTest, color: renderer.clearColor.toArray(), alpha: renderer.clearAlpha,
    autoClear: renderer.autoClear, xr: renderer.xr.enabled, lighting: renderer.lighting?.enabled,
    cube: renderer.cube, mip: renderer.mip };
}

// A zoom replan replaces the scheduled meshes but retains canonical paint IDs.
// HEP scenes can have thousands of ranges behind only a few dozen meshes.
function testProxyReplacement(ThreePaintCompositor, backend) {
  const compositor = new ThreePaintCompositor(backend, webGpu);
  const batchCount = 16, rangesPerBatch = 256, rangeCount = batchCount * rangesPerBatch;
  const material = new THREE.MeshBasicMaterial();
  const geometries = [];
  let sourceDisposals = 0, partialDisposals = 0;
  const makeMesh = batch => {
    const geometry = new THREE.InstancedBufferGeometry();
    const ids = Float32Array.from({ length: rangesPerBatch }, (_, index) => index * batchCount + batch);
    geometry.setAttribute("aSegmentIndex", new THREE.InstancedBufferAttribute(ids, 1));
    geometry.instanceCount = ids.length;
    geometry.addEventListener("dispose", () => sourceDisposals++);
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.heprDrawRun = { kind: "stroke", first: batch, count: 1 };
    mesh.userData.heprDrawRanges = Array.from(ids, first => ({ first, count: 1 }));
    mesh.userData.heprInstanceAttribute = "aSegmentIndex";
    return mesh;
  };
  const meshes = Array.from({ length: batchCount }, (_, index) => makeMesh(index));
  const retained = new THREE.Mesh(new THREE.BufferGeometry(), material);
  retained.userData.heprDrawRun = { kind: "raster", first: 0, count: 1 };
  const background = new THREE.Mesh(new THREE.BufferGeometry(), material);
  background.userData.heprPageBackground = true;
  compositor.collect([...meshes, retained, background, meshes[0]]);
  assert.equal(compositor.proxies.size, batchCount + 2, "repeated roots do not duplicate proxies");
  const retainedProxy = compositor.proxies.get(retained);
  const survivor = meshes[0], survivorProxy = compositor.proxies.get(survivor);
  for (const mesh of meshes) {
    const proxy = compositor.proxies.get(mesh);
    const partial = compositor.geometryForRuns(proxy, [mesh.userData.heprDrawRun], 0);
    assert.notEqual(partial, mesh.geometry);
    partial.addEventListener("dispose", () => partialDisposals++);
  }
  // Count array work instead of imposing a machine-dependent time threshold.
  // Repeated per-range splice calls move a quadratic number of indexed slots.
  let indexOperations = 0;
  const countIndex = key => {
    if (typeof key === "string" && /^\d+$/.test(key)) {
      assert.ok(++indexOperations <= rangeCount * 16,
        "replacing batched proxies must not repeatedly scan or shift the range index");
    }
  };
  for (const [kind, ranges] of compositor.runsByKind) {
    compositor.runsByKind.set(kind, new Proxy(ranges, {
      get(target, key, receiver) { countIndex(key); return Reflect.get(target, key, receiver); },
      set(target, key, value, receiver) { countIndex(key); return Reflect.set(target, key, value, receiver); }
    }));
  }
  const replacements = meshes.map((mesh, index) => index === 0 ? mesh : makeMesh(index));
  // Reverse root traversal so sorting is necessary; the retained proxy and its
  // subset buffer must survive even while neighbouring meshes are replaced.
  const roots = [...replacements].reverse().concat(retained, background);
  compositor.collect(roots);
  assert.equal(compositor.proxies.size, batchCount + 2);
  assert.equal(compositor.proxies.get(retained), retainedProxy);
  assert.equal(compositor.proxies.get(survivor), survivorProxy);
  assert.ok(survivorProxy.partialGeometries[0]);
  assert.equal(partialDisposals, batchCount - 1, "only removed proxies release their subset buffers");
  assert.equal(sourceDisposals, 0, "compositor cleanup never disposes borrowed layer geometry");
  for (const mesh of meshes.slice(1)) assert.equal(compositor.proxies.has(mesh), false);
  const ranges = compositor.runsByKind.get("stroke");
  assert.equal(ranges.length, rangeCount, "every canonical range is indexed exactly once");
  for (let index = 0; index < rangeCount; index++) {
    assert.equal(ranges[index].first, index, "canonical lookup order survives mesh replacement");
    assert.equal(ranges[index].count, 1);
    assert.equal(ranges[index].proxy.source, replacements[index % batchCount]);
  }
  assert.equal(compositor.runsByKind.get("raster")[0].proxy, retainedProxy);
  compositor.collect(roots);
  assert.equal(compositor.runsByKind.get("stroke"), ranges, "unchanged frames retain the range index");
  assert.equal(partialDisposals, batchCount - 1);
  compositor.collect([retained, background]);
  assert.equal(compositor.runsByKind.get("stroke")?.length ?? 0, 0, "removal-only updates retire stale ranges");
  assert.equal(partialDisposals, batchCount);
  assert.equal(compositor.runsByKind.get("raster")[0].proxy, retainedProxy);
  compositor.collect([]);
  assert.equal(compositor.proxies.size, 0);
  assert.ok([...compositor.runsByKind.values()].every(runs => runs.length === 0));
  compositor.dispose();
  assert.equal(sourceDisposals, 0);
  for (const geometry of geometries) geometry.dispose();
  retained.geometry.dispose(); background.geometry.dispose(); material.dispose();
}
