import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import * as THREE from "three";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) {
    return next(`${specifier}.ts`, context);
  }
  return next(specifier, context);
} });

try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { ThreePaintCompositor, projectThreePdfCompositeBounds } = await import("../src/threePaintCompositor.ts");
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
    const stroke = new ThreeMaterialStrokeLayer(scene, { materialBackend: backend,
      strokeCurveEnabled: true, vectorOverride: [0, 0, 0, 0] });
    const raster = new ThreeMaterialRasterLayer(scene, { materialBackend: backend, pageBackground: [1, 1, 1, 1] });
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

    const compositor = new ThreePaintCompositor(backend);
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
    compositor.render(host, scene, roots, 32, 24, () => true);
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
    const spanStroke = new ThreeMaterialStrokeLayer(spanScene, { materialBackend: backend,
      strokeCurveEnabled: true, vectorOverride: [0, 0, 0, 0] });
    const spanCompositor = new ThreePaintCompositor(backend);
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
    // rectangle. A root copy is still needed, but there is no per-group copy.
    spanHost.draws.length = 0;
    const boundedProject = bounds => ({ x: bounds.minX + 100, y: bounds.minY + 80,
      width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY });
    spanCompositor.render(spanHost, spanScene, [spanStroke.mesh], 320, 240, () => true, boundedProject);
    const boundedClears = spanHost.clears.filter(clear => clear.scissorTest);
    if (backend === "webgl") {
      assert.ok(boundedClears.length > 0, "WebGL clears use the effect bounds too");
      assert.ok(boundedClears.every(clear => clear.scissor[2] < 30 && clear.scissor[3] < 30),
        "small effects do not clear the full framebuffer");
    } else assert.equal(boundedClears.length, 0, "WebGPU keeps its whole-attachment fast clear");
    const effects = spanHost.draws.filter(draw => !draw.ids);
    assert.equal(effects.length, 2, "one root copy and one direct source-over pass");
    const blended = effects.find(draw => draw.blending === THREE.CustomBlending);
    assert.ok(blended, "group opacity uses the hardware blending pass");
    assert.equal(blended.blendSrc, THREE.OneFactor, "effect output is premultiplied on both backends");
    assert.equal(blended.blendDst, THREE.OneMinusSrcAlphaFactor);
    assert.equal(blended.scissorTest, true);
    assert.ok(backend === "webgpu" ? blended.scissor[1] > 140 : blended.scissor[1] < 100,
      "WebGPU target scissors convert the shared bottom-left rectangle to top-left");
    assert.ok(blended.scissor[2] < 30 && blended.scissor[3] < 30,
      "a small effect does not shade the full target");
    assert.deepEqual(snapshot(spanHost), state, "bounded effects restore the host scissor and target");
    assert.ok(effects.some(draw => !draw.scissorTest), "pooled target scissors reset for the full root copy");
    spanHost.draws.length = 0;
    spanHost.clears.length = 0;
    spanCompositor.render(spanHost, spanScene, [spanStroke.mesh], 320, 240, () => true,
      bounds => ({ ...boundedProject(bounds), x: 10000 }));
    assert.equal(spanHost.draws.filter(draw => !draw.ids).length, 1, "offscreen effects skip their composite pass");
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
    spanCompositor.draw([{ kind: "stroke", first: 7, count: 1 }], partialTarget, false);
    assert.deepEqual(spanHost.draws.map(draw => draw.ids), [[5]], "subset membership uses canonical origins");
    assert.deepEqual(spanHost.draws.map(draw => draw.clips), [[2]], "clip roots are gathered with instance IDs");
    const proxy = spanCompositor.proxies.get(proxySource);
    const originalPartial = proxy.partialGeometry;
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
    spanCompositor.draw([{ kind: "stroke", first: 9, count: 1 }], partialTarget, false);
    assert.equal(proxy.partialGeometry, originalPartial,
      "revealing more instances reuses the source-sized partial allocation");
    assert.equal(partialDisposals, 0);
    geometry.setAttribute("aSegmentIndex", new THREE.InstancedBufferAttribute(f([10, 5, 12, 5]), 1));
    geometry.setAttribute("aVectorClipIndex", new THREE.InstancedBufferAttribute(f([1, 2, 3, 4]), 1));
    geometry.instanceCount = 4;
    spanHost.draws.length = 0;
    spanCompositor.draw([{ kind: "stroke", first: 7, count: 1 }], partialTarget, false);
    assert.equal(partialDisposals, 1, "growing source capacity retires the previous owned GPU buffers");
    assert.notEqual(proxy.partialGeometry, originalPartial);
    assert.deepEqual(spanHost.draws.map(draw => draw.ids), [[5, 5]]);
    assert.deepEqual(spanHost.draws.map(draw => draw.clips), [[2, 4]]);
    assert.equal(geometry.getAttribute("aCorner"), borrowedCorner);
    assert.equal(geometry.index, borrowedIndex);
    const originalGeometryForRuns = spanCompositor.geometryForRuns;
    let inputCount = 0;
    spanCompositor.geometryForRuns = function(entry, runs) {
      inputCount = runs.length;
      return originalGeometryForRuns.call(this, entry, runs);
    };
    spanCompositor.draw([{ kind: "stroke", first: 3, count: 7 }], partialTarget, false);
    assert.equal(inputCount, 1, "a merged run reaching three ranges on one proxy is collected only once");
    spanCompositor.geometryForRuns = originalGeometryForRuns;
    assert.equal(spanCompositor.geometryForRuns({ ...proxy, ranges: [{ first: 3, count: 7 }] }, [
      { kind: "stroke", first: 7, count: 3 }, { kind: "stroke", first: 3, count: 4 }
    ]), geometry, "adjacent inputs jointly cover a range without copying or uploading instances");
    const overlap = spanCompositor.geometryForRuns(proxy, [
      { kind: "stroke", first: 3, count: 7 }, { kind: "stroke", first: 7, count: 1 }
    ]);
    assert.equal(overlap, geometry, "a shorter overlapping input cannot hide the enclosing range's tail");
    let rangeReads = 0;
    const manyRanges = Array.from({ length: 4096 }, (_, index) => ({
      get first() { rangeReads++; return index * 2; }, count: 1
    }));
    const manyRuns = manyRanges.map(range => ({ kind: "stroke", first: range.first, count: 1 }));
    rangeReads = 0;
    assert.equal(spanCompositor.geometryForRuns({ ...proxy, ranges: manyRanges }, manyRuns), geometry);
    assert.ok(rangeReads < manyRanges.length * 4,
      "large scheduled meshes must not rescan the entire input span for each canonical range");
    let replacementDisposals = 0;
    proxy.partialGeometry.addEventListener("dispose", () => replacementDisposals++);
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
    const splitStroke = new ThreeMaterialStrokeLayer(splitScene, { materialBackend: backend,
      strokeCurveEnabled: true, vectorOverride: [0, 0, 0, 0] });
    const splitCompositor = new ThreePaintCompositor(backend);
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
    const slotCompositor = new ThreePaintCompositor(backend), slotHost = makeRenderer(backend);
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
  console.log("Three PDF compositor state, canonical subsets, shape coverage, pooling, and staged raster updates passed");
} finally { hooks.deregister(); }

function makeRenderer(backend = "webgpu") {
  return {
    coordinateSystem: backend === "webgpu" ? THREE.WebGPUCoordinateSystem : THREE.WebGLCoordinateSystem,
    target: new THREE.RenderTarget(7, 9), viewport: new THREE.Vector4(3, 4, 17, 19),
    scissor: new THREE.Vector4(5, 6, 11, 13), scissorTest: true, clearColor: new THREE.Color(0.2, 0.3, 0.4),
    clearAlpha: 0.7, autoClear: true, xr: { enabled: true }, cube: 2, mip: 1, draws: [], clears: [], targets: [], fail: false,
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
      if (this.fail) throw new Error("synthetic draw failure");
      assert.equal(this.scissorTest, this.target.scissorTest, "WebGPU also needs the renderer scissor-test flag");
      for (const mesh of scene.children) {
        const ids = mesh.geometry.getAttribute("aSegmentIndex");
        this.draws.push({ call: this.call,
          tag: mesh.material.uniforms?.uTestTag?.value,
          ids: ids && Array.from({ length: mesh.geometry.instanceCount }, (_, i) => ids.getX(i)),
          shape: mesh.material.uniforms?.uPdfShapeOnly?.value,
          clips: mesh.geometry.getAttribute("aVectorClipIndex") && Array.from({ length: mesh.geometry.instanceCount },
            (_, i) => mesh.geometry.getAttribute("aVectorClipIndex").getX(i)),
          blending: mesh.material.blending, blendSrc: mesh.material.blendSrc, blendDst: mesh.material.blendDst,
          scissor: this.target.scissor.toArray(), scissorTest: this.target.scissorTest });
      }
    }
  };
}
function snapshot(renderer) {
  return { target: renderer.target.uuid, viewport: renderer.viewport.toArray(), scissor: renderer.scissor.toArray(),
    scissorTest: renderer.scissorTest, color: renderer.clearColor.toArray(), alpha: renderer.clearAlpha,
    autoClear: renderer.autoClear, xr: renderer.xr.enabled, cube: renderer.cube, mip: renderer.mip };
}
