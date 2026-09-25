import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? `${s}.ts` : s, c);
} });
try {
  const { WebGlFloorplanRenderer } = await import("../src/webGlFloorplanRenderer.ts");
  const { RenderPerformanceProfiler } = await import("../src/renderPerformance.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  let now = 0, rebuild = true, uploads = 0;
  const profile = new RenderPerformanceProfiler({ now: () => now });
  const scene = Object.assign(createEmptyVectorScene(), { segmentCount: 3, fillPathCount: 2, textInstanceCount: 7,
    drawRuns: [{ kind: "stroke", first: 0, count: 3 }, { kind: "fill", first: 0, count: 2 },
      { kind: "text", first: 0, count: 7 }] });
  const batches = scene.drawRuns.map(run => ({ ...run, clipIndex: -2 }));
  const instance = Object.assign(Object.create(WebGlFloorplanRenderer.prototype), {
    scene, performanceProfiler: profile, canvas: { width: 100, height: 100 },
    cameraCenterX: 50, cameraCenterY: 50, zoom: 1, segmentCount: 3,
    strokeRenderingEnabled: true, fillRenderingEnabled: true, textRenderingEnabled: true,
    rasterRenderingEnabled: false, needsVisibleSetUpdate: true, vectorLodLevels: [],
    orderedUniformPrograms: new Set(), orderedTextureBindings: [], orderedPaintUniformStates: new Map(),
    orderedInstanceVaos: new Set(),
    orderedBatches: { batches, instanceCount: 12, floatInstances: new Float32Array(24), culledSegmentCount: 0,
      update() { now += 1; return rebuild; } },
    gl: { bindFramebuffer() {}, viewport() {}, clearColor() {}, clear() {}, bindBuffer() {},
      bufferData() { uploads++; now += 0.25; } },
    updateCameraWithDamping() { now += 0.5; return false; }, updatePanReleaseVelocitySample() {},
    ensureRenderState() { now += 0.5; }, shouldUsePanCache() { return false; },
    shouldUseVectorMinifyPath() { return false; }, updateVisibleSet() { now += 2; },
    drawVisibleSegments(_w, _h, _x, _y, _z, range) { now += 3; return range.count; },
    drawFilledPaths() { now += 2; }, drawTextInstances() { now += 1; },
    drawSearchHighlights() { now += 0.25; }, frameListener() { now += 4; }
  });
  profile.start({ gpu: false, maxFrames: 2 });
  instance.render(0);
  rebuild = false;
  instance.cameraCenterX = 55;
  instance.zoom = 2;
  instance.render(16);
  const report = profile.getReport();
  assert.equal(report.frames, 2);
  assert.equal(report.active, false);
  assert.equal(report.cpuSections.cameraAndState.average, 1);
  assert.equal(report.cpuSections.visibleSelection.average, 1, "unchanged selection contributes zero on the next frame");
  assert.equal(report.cpuSections.batchPreparation.average, 1);
  assert.equal(report.cpuSections.drawSubmission.average, 6);
  assert.equal(report.cpuSections.viewerCallback.average, 4, "viewer work is measured separately from drawing");
  assert.equal(report.cpuSections.overlays.average, 0.25);
  assert.equal(report.counters.strokeInstances.average, 3);
  assert.equal(report.counters.glyphInstances.average, 7);
  assert.equal(report.counters.instanceUploadBytes.total, 96);
  assert.equal(report.counters.batchRebuilds.total, 1);
  assert.equal(uploads, 1, "profiling does not force rebuilding or uploading cached batches");
  assert.equal(report.counters.strokeBatches.average, 1);
  assert.equal(report.counters.fillBatches.average, 1);
  assert.equal(report.counters.textBatches.average, 1);
  assert.equal(report.counters.drawBatches.average, 3);
  assert.equal(report.frameRecords.length, 2);
  assert.deepEqual(report.frameRecords.map(frame => frame.context), [
    { cameraCenterX: 50, cameraCenterY: 50, zoom: 1, viewportWidth: 100, viewportHeight: 100, unitsPerPixel: 1, frameGapMs: null },
    { cameraCenterX: 55, cameraCenterY: 50, zoom: 2, viewportWidth: 100, viewportHeight: 100, unitsPerPixel: 0.5, frameGapMs: 16 }
  ], "correlated frame details use the current camera rather than the capture's starting view");
  assert.deepEqual(report.frameRecords.map(frame => frame.counters.batchRebuilds), [1, 0]);
  assert.deepEqual(report.frameRecords.map(frame => frame.counters.drawBatches), [3, 3]);
  assert.equal(report.frameRecords[0].cpuSectionsMs.visibleSelection, 2);
  assert.equal(report.frameRecords[1].cpuSectionsMs.visibleSelection, 0);
  assert.equal(report.gpu.status, "disabled");
  instance.render(32);
  assert.equal(profile.getReport().frames, 2, "ordinary rendering continues after the bounded capture finishes");

  profile.start({ gpu: false });
  instance.drawSearchHighlights = () => { throw new Error("overlay failure"); };
  assert.throws(() => instance.render(48), /overlay failure/);
  assert.equal(profile.getReport().frames, 1, "frame cleanup runs even when rendering throws");
  profile.stop();
  assert.equal(profile.enabled, false);
  console.log("Native WebGL capture phases, counters, cache reuse, limits, and exception cleanup passed");
} finally { hooks.deregister(); }
