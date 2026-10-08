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

try {
  const { ThreePaintCompositor } = await import("../src/threePaintCompositor.ts");
  const webGpu = await import("../src/threeWebGpuBackend.ts");
  for (const backend of ["webgl", "webgpu"]) {
    const compositor = new ThreePaintCompositor(backend, webGpu);
    const material = new THREE.RawShaderMaterial();
    const geometry = makeGeometry([10, 5, 12], [1, 2, 3]);
    const source = new THREE.Mesh(geometry, material);
    const origins = new Uint32Array(13);
    origins[10] = 3; origins[5] = 7; origins[12] = 9;
    Object.assign(source.userData, {
      heprDrawRun: { kind: "stroke", first: 3, count: 7 },
      heprDrawRanges: [{ first: 3, count: 1 }, { first: 7, count: 1 }, { first: 9, count: 1 }],
      heprCanonicalOrigins: origins, heprInstanceAttribute: "aSegmentIndex"
    });
    const targetA = new THREE.RenderTarget(8, 8), targetB = new THREE.RenderTarget(8, 8);
    const host = { autoClear: false, draws: [],
      setRenderTarget() {}, setScissorTest() {},
      render(scene, camera) {
        for (const mesh of [...scene.children].sort((a, b) => a.renderOrder - b.renderOrder)) {
          mesh.onBeforeRender(this, scene, camera, mesh.geometry, mesh.material, null);
          this.draws.push({ mesh, geometry: mesh.geometry, ids: values(mesh.geometry, "aSegmentIndex"),
            clips: values(mesh.geometry, "aVectorClipIndex") });
          mesh.onAfterRender(this, scene, camera, mesh.geometry, mesh.material, null);
        }
      }
    };
    compositor.renderer = host;
    const frame = () => {
      host.draws.length = 0;
      compositor.collect([source]);
      compositor.draw([{ kind: "stroke", first: 3, count: 1 }], targetA, false);
      compositor.flush(targetA);
      compositor.draw([{ kind: "stroke", first: 9, count: 1 }], targetB, false);
      compositor.flush(targetB);
      return [...host.draws];
    };
    const initial = frame();
    assert.deepEqual(initial.map(draw => draw.ids), [[10], [12]]);
    assert.deepEqual(initial.map(draw => draw.clips), [[1], [3]]);
    assert.notEqual(initial[0].mesh, initial[1].mesh,
      "the same source paint in different host batches has separate frame slots");
    assert.notEqual(initial[0].geometry, initial[1].geometry);
    const versions = initial.map(draw => draw.geometry.getAttribute("aSegmentIndex").version);
    const profiler = new RenderPerformanceProfiler();
    profiler.start({ gpu: false, maxFrames: 1 });
    profiler.beginFrame();
    const repeated = withThreeRenderPerformance(profiler, frame);
    profiler.endFrame();
    const report = profiler.getReport();
    profiler.dispose();
    assert.equal(report.counters["three.cachedSubsets"].total, 2);
    assert.equal(report.counters["three.instanceUploadBytes"]?.total ?? 0, 0,
      "unchanged frames do not upload subset instance data");
    for (let index = 0; index < initial.length; index++) {
      assert.equal(repeated[index].mesh, initial[index].mesh);
      assert.equal(repeated[index].geometry, initial[index].geometry);
      assert.equal(repeated[index].geometry.getAttribute("aSegmentIndex").version, versions[index],
        "unchanged frame slots retain Three's uploaded attribute version");
    }

    const clips = geometry.getAttribute("aVectorClipIndex");
    clips.setX(2, 8); clips.needsUpdate = true;
    assert.deepEqual(frame().map(draw => draw.clips), [[1], [8]],
      "a changed companion attribute invalidates the cached subset");
    const ids = geometry.getAttribute("aSegmentIndex");
    ids.setX(0, 12); ids.setX(2, 10); ids.needsUpdate = true;
    assert.deepEqual(frame().map(draw => draw.clips), [[8], [1]],
      "repacking source IDs at the same count invalidates each paint's selected rows");
    ids.setX(0, 10); ids.setX(2, 12); ids.needsUpdate = true;
    geometry.instanceCount = 2;
    assert.deepEqual(frame().map(draw => draw.ids), [[10]],
      "culling invalidates a subset even when attribute versions did not change");
    geometry.instanceCount = 3;
    assert.deepEqual(frame().map(draw => draw.ids), [[10], [12]], "revealed instances return to their own slots");

    const proxy = compositor.proxies.get(source);
    // A scheduled mesh's LOD origins are immutable, but replacing the mapping
    // must still invalidate selected rows and their companion attributes.
    const replacementOrigins = origins.slice(); replacementOrigins[5] = 3;
    proxy.origins = replacementOrigins;
    assert.deepEqual(frame().map(draw => draw.ids), [[10, 5], [12]]);
    assert.deepEqual(frame().map(draw => draw.clips), [[1, 2], [8]]);
    proxy.origins = origins;

    const mutableRun = [{ kind: "stroke", first: 3, count: 1 }];
    compositor.geometryForRuns(proxy, mutableRun, 0);
    mutableRun[0].first = 7;
    assert.deepEqual(values(compositor.geometryForRuns(proxy, mutableRun, 0), "aSegmentIndex"), [5],
      "editing the same requested run object cannot reuse its previous selection");
    geometry.setAttribute("aVectorClipIndex", new THREE.InstancedBufferAttribute(Float32Array.of(4, 5, 6), 1));
    assert.deepEqual(frame().map(draw => draw.clips), [[4], [6]],
      "replacing an attribute at the same capacity invalidates its snapshot");

    const changedIndex = new THREE.Uint16BufferAttribute([0, 0], 1);
    geometry.setIndex(changedIndex);
    assert.ok(frame().every(draw => draw.geometry.index === changedIndex),
      "replacing a borrowed index updates each subset geometry");

    const previousPartial = proxy.partialGeometries[0];
    const previousIds = previousPartial.getAttribute("aSegmentIndex");
    let disposals = 0;
    previousPartial.addEventListener("dispose", () => {
      disposals++;
      assert.equal(previousPartial.getAttribute("aSegmentIndex"), previousIds);
      assert.equal(previousPartial.getAttribute("position"), undefined,
        "retiring a subset detaches borrowed vertex buffers first");
      assert.equal(previousPartial.index, null);
    });
    const replacement = makeGeometry([5, 12, 10], [9, 10, 11]);
    source.geometry = replacement;
    assert.deepEqual(frame().map(draw => draw.ids), [[10], [12]]);
    assert.deepEqual(frame().map(draw => draw.clips), [[11], [10]]);
    assert.equal(disposals, 1, "replacing source geometry retires the subset's owned GPU buffers");
    assert.notEqual(proxy.partialGeometries[0], previousPartial);
    compositor.dispose();
    assert.equal(proxy.partialSelections, undefined);
    assert.equal(disposals, 1);
    geometry.dispose(); replacement.dispose(); material.dispose(); targetA.dispose(); targetB.dispose();
  }
  console.log("Three compositor frame slots, subset reuse, and cache invalidation passed");
} finally { hooks.deregister(); }

function makeGeometry(ids, clips) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
  geometry.setIndex([0]);
  geometry.setAttribute("aSegmentIndex", new THREE.InstancedBufferAttribute(Float32Array.from(ids), 1));
  geometry.setAttribute("aVectorClipIndex", new THREE.InstancedBufferAttribute(Float32Array.from(clips), 1));
  geometry.instanceCount = ids.length;
  return geometry;
}

function values(geometry, name) {
  const attribute = geometry.getAttribute(name);
  return Array.from({ length: geometry.instanceCount }, (_, index) => attribute.getX(index));
}
