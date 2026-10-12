import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { RenderPerformanceProfiler } from "../src/renderPerformance.ts";
import { describeThreePerformanceCamera, describeThreePerformanceScene, getThreeRenderPerformance, instrumentThreeWebGlCalls,
  withThreeRenderPerformance } from "../src/threeRenderPerformance.ts";
import { createEmptyVectorScene } from "../src/emptyVectorScene.ts";

let clock = 0, clockReads = 0;
const now = () => { clockReads++; return clock; };
const profile = new RenderPerformanceProfiler({ now });
const calls = [];
const prototype = {
  drawElements(...args) { calls.push(["draw", this, args]); clock += 2; return 123; },
  bufferSubData(...args) { calls.push(["upload", this, args]); clock += 20; throw Error("upload failure"); }
};
const gl = Object.create(prototype);
Object.defineProperty(gl, "getProgramInfoLog", {
  configurable: true, enumerable: true, writable: true,
  value(...args) { calls.push(["shader", this, args]); clock += 2500; return "shader log"; }
});
const originalDescriptor = Object.getOwnPropertyDescriptor(gl, "getProgramInfoLog");
const capture = instrumentThreeWebGlCalls(gl, profile, now);
assert.deepEqual(capture.installedMethods.sort(), ["bufferSubData", "drawElements", "getProgramInfoLog"]);
assert.ok(capture.unavailableMethods.includes("compileShader"));
assert.equal(calls.length, 0, "installing instrumentation makes no GL queries");
const reads = clockReads;
gl.drawElements(1, 2, 3, 4);
assert.equal(clockReads, reads, "disabled capture adds no timing reads");
assert.equal(getThreeRenderPerformance(), null);
profile.start({ maxFrames: 2, gpu: false });
profile.beginFrame();
assert.equal(withThreeRenderPerformance(profile, () => {
  assert.equal(getThreeRenderPerformance(), profile);
  assert.equal(gl.getProgramInfoLog("program"), "shader log");
  withThreeRenderPerformance(null, () => {
    assert.equal(getThreeRenderPerformance(), null);
    gl.drawElements(4, 3, 2, 1);
  });
  assert.equal(getThreeRenderPerformance(), profile, "nested capture scope is restored");
  return gl.drawElements(5, 6, 7, 8);
}), 123);
assert.equal(getThreeRenderPerformance(), null);
profile.endFrame();
profile.beginFrame();
assert.throws(() => withThreeRenderPerformance(profile, () => gl.bufferSubData("buffer")), /upload failure/);
assert.equal(getThreeRenderPerformance(), null, "throwing renders restore the scope");
profile.endFrame();
const report = profile.getReport();
assert.equal(report.cpuSections["gl.shaderQueries"].total, 2500);
assert.equal(report.cpuSections["gl.draw"].total, 2);
assert.equal(report.cpuSections["gl.bufferUpload"].total, 20);
assert.equal(report.counters["gl.drawCalls"].total, 1, "unscoped and explicitly disabled calls are excluded");
assert.deepEqual(report.frameRecords[0].events, [{ name: "gl.getProgramInfoLog", durationMs: 2500 }]);
assert.deepEqual(report.frameRecords[1].events, [{ name: "gl.bufferSubData", durationMs: 20 }]);
assert.equal(report.frameRecords[1].context.frameGapMs, 2504, "the long gap survives the idle filter");
assert.equal(report.frameRecords[1].intervalMs, null);
assert.deepEqual(calls.map(call => call[0]), ["draw", "shader", "draw", "draw", "upload"]);
assert.ok(calls.every(call => call[1] === gl), "GL methods keep the original receiver");
assert.deepEqual(calls[3][2], [5, 6, 7, 8], "GL arguments and return values are preserved");
const stoppedReads = clockReads;
withThreeRenderPerformance(profile, () => gl.drawElements());
assert.equal(clockReads, stoppedReads, "automatic stop takes the untimed path even before disposal");
capture.dispose(); capture.dispose();
assert.equal(Object.hasOwn(gl, "drawElements"), false, "prototype methods are unshadowed");
assert.deepEqual(Object.getOwnPropertyDescriptor(gl, "getProgramInfoLog"), originalDescriptor);
const replaced = instrumentThreeWebGlCalls(gl, profile, now);
const inspector = () => 7;
gl.drawElements = inspector;
replaced.dispose();
assert.equal(gl.drawElements, inspector, "cleanup cannot overwrite a later inspector");
assert.equal(instrumentThreeWebGlCalls(Object.preventExtensions(Object.create(prototype)), profile, now)
  .installedMethods.length, 0, "non-extensible contexts retain working original methods");

profile.start({ gpu: false, maxFrames: 40, maxFrameRecords: 12 });
for (let frame = 0; frame < 40; frame++) {
  profile.beginFrame();
  if (frame === 17) {
    for (let index = 0; index < 20; index++) profile.recordEvent("x".repeat(200), index);
    profile.recordEvent("ignored", NaN);
    profile.addSectionTime("external", 12);
    profile.addSectionTime("external", -1);
    clock += 2000;
  } else clock++;
  profile.endFrame();
}
const bounded = profile.getReport();
const stall = bounded.frameRecords.find(frame => frame.frame === 18);
assert.deepEqual(stall.events.map(event => event.durationMs), [19, 18, 17, 16, 15, 14, 13, 12]);
assert.ok(stall.events.every(event => event.name.length === 96));
assert.equal(stall.cpuSectionsMs.external, 12);
assert.ok(bounded.frameRecords.some(frame => frame.frame === 17 && frame.reasons.includes("stall-neighbour")));
assert.ok(bounded.frameRecords.some(frame => frame.frame === 19 && frame.reasons.includes("stall-neighbour")));
stall.events[0].name = "mutated";
assert.notEqual(profile.getReport().frameRecords.find(frame => frame.frame === 18).events[0].name, "mutated");
profile.start({ gpu: false, maxFrames: 1, maxFrameRecords: 0 });
profile.beginFrame(); profile.recordEvent("disabled", 999); profile.endFrame();
assert.equal(profile.frameEvents.length, 0, "aggregate-only capture retains no event data");

// Camera snapshots must survive JSON export per frame, without mutating the
// camera or retaining references as the user orbits/pans during a capture.
const camera = new THREE.PerspectiveCamera(55, 16 / 9, .2, 5000);
const target = new THREE.Vector3(3, 4, 5);
camera.position.copy(target).add(new THREE.Vector3(0, 0, 10));
camera.zoom = 2; camera.lookAt(target);
const topDown = describeThreePerformanceCamera(camera, target);
assert.equal(topDown.cameraTiltDegrees, 0);
assert.equal(topDown.cameraDistanceToTarget, 10);
assert.equal(topDown.cameraPositionZ, 15);
assert.equal(topDown.cameraTargetY, 4);
assert.equal(topDown.cameraFovYDegrees, 55);
assert.equal(topDown.cameraAspect, 16 / 9);
assert.equal(topDown.cameraNear, .2);
assert.equal(topDown.cameraFar, 5000);
assert.equal(topDown.cameraZoom, 2);
assert.equal(topDown.cameraUpY, 1);
profile.start({ gpu: false, maxFrames: 2 });
profile.beginFrame();
profile.setFrameContext({ ...topDown, controlsChanged: 0 });
profile.endFrame();
camera.position.copy(target).add(new THREE.Vector3(0, -Math.sqrt(3) * 5, 5));
camera.lookAt(target);
const tiltedCamera = describeThreePerformanceCamera(camera, target);
assert(Math.abs(tiltedCamera.cameraTiltDegrees - 60) < 1e-10);
assert(Math.abs(tiltedCamera.cameraDistanceToTarget - 10) < 1e-10);
assert.equal(tiltedCamera.cameraQuaternionX, camera.quaternion.x);
assert.equal(tiltedCamera.cameraQuaternionW, camera.quaternion.w);
profile.beginFrame();
profile.setFrameContext({ ...tiltedCamera, controlsChanged: 1 });
profile.setFrameContext({ cameraTiltDegrees: NaN, cameraPositionX: Infinity });
profile.endFrame();
camera.position.z = 999; target.y = 999;
const cameraFrames = JSON.parse(JSON.stringify(profile.getReport())).frameRecords;
assert.deepEqual(cameraFrames[0].context, { frameGapMs: null, ...topDown, controlsChanged: 0 });
assert.deepEqual(cameraFrames[1].context, { frameGapMs: null, ...tiltedCamera, controlsChanged: 1 });
assert.equal(cameraFrames[0].context.cameraPositionZ, 15, "later camera changes do not rewrite captured frames");
assert.equal(cameraFrames[1].context.cameraTargetY, 4, "control targets are also detached");

const scene = createEmptyVectorScene();
scene.drawRuns = [{ kind: "fill", first: 0, count: 1 }, { kind: "text", first: 0, count: 1 }];
scene.clipPaths = [{ edges: new Float32Array(12) }];
scene.rasterLayers = [{ width: 2, height: 3, data: Uint8Array.of(1, 2, 3) }];
scene.paintGraph = { roots: [{ kind: "group", knockout: true, blendMode: "Multiply",
  children: [{ kind: "draw", runIndex: 0 }],
  softMask: { children: [{ kind: "draw", runIndex: 1 }] } }] };
const description = describeThreePerformanceScene(scene);
assert.deepEqual(description.drawKinds, { fill: 1, text: 1 });
assert.equal(description.clipEdges, 3);
assert.equal(description.rasterPixels, 6);
assert.equal(description.groups, 1);
assert.equal(description.knockoutGroups, 1);
assert.equal(description.masks, 1);
assert.equal(description.maxGroupDepth, 1);
assert.deepEqual(description.blends, { Multiply: 1 });
description.bounds.minX = 9876;
assert.notEqual(scene.bounds.minX, 9876);
assert.equal(JSON.stringify(description).includes('"data"'), false, "scene diagnostics omit document payloads");

// The example owns the instrumentation lifetime, including automatic stop and
// backend/disposal transitions; all three explicitly detach GL wrappers.
const source = await readFile(new URL("../src/three-example.ts", import.meta.url), "utf8");
assert.match(source, /diagnosticsVersion: 3/);
assert.match(source, /initialCamera: describeThreePerformanceCamera\(camera, controls.target\)/);
assert.match(source, /withThreeRenderPerformance\(profile/);
assert.match(source, /profile && !profile.enabled\) \{ captureGlCalls\?\.dispose/);
assert.equal((source.match(/captureGlCalls\?\.dispose\(\); captureGlCalls = null;/g) ?? []).length, 7,
  "comparison switches also detach GL wrappers when ending the current capture");
assert.match(source, /vectors\(mode:[\s\S]*?captureProfiler\?\.stop\(\);\s*captureGlCalls\?\.dispose\(\); captureGlCalls = null;/);
assert.match(source, /fillRendering: currentPdfObject\?\.getFillRenderingEnabled\(\) \?\? null/);
assert.match(source, /strokeRendering: currentPdfObject\?\.getStrokeRenderingEnabled\(\) \?\? null/);
profile.dispose();
console.log("Three capture: scoped GL timing, no added queries, exception/stop cleanup, bounded stall events, camera snapshots and scene comparison passed.");
