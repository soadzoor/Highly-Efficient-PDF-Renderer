import assert from "node:assert/strict";
import { ViewerLoadDiagnostics, VIEWER_LOAD_DIAGNOSTICS_STORAGE_KEY } from "../src/viewerLoadDiagnostics.ts";

let clock = 100;
const saved = new Map();
let writes = 0;
const storage = {
  getItem: key => saved.get(key) ?? null,
  setItem: (key, value) => { writes++; saved.set(key, value); }
};
const options = { storage, now: () => clock, timestamp: () => "2026-10-11T10:00:00.000Z" };
const diagnostics = new ViewerLoadDiagnostics(options);
assert.equal(diagnostics.report().current, null, "construction does not start a capture");
assert.equal(writes, 0, "disabled load diagnostics do not write storage");

const context = { viewer: "three", backend: "webgl", canvas: { width: 1290, height: 2796 } };
const id = diagnostics.start(context);
context.canvas.width = -1;
assert.equal(diagnostics.report().current.context.canvas.width, 1290, "context does not retain caller-owned metadata");
assert.equal(diagnostics.report().current.startedAt, "2026-10-11T10:00:00.000Z");
clock = 135;
const details = { geometryBytes: 456, textures: { count: 3 } };
diagnostics.checkpoint(id, "shader-compile", details);
details.textures.count = -1;
let report = diagnostics.report();
assert.equal(report.current.events[1].elapsedMs, 35);
assert.equal(report.current.events[1].stepElapsedMs, 35);
assert.equal(report.current.events[1].details.textures.count, 3);
assert.equal(JSON.parse(saved.get(VIEWER_LOAD_DIAGNOSTICS_STORAGE_KEY)).current.events[1].phase, "shader-compile",
  "a checkpoint persists synchronously before the caller proceeds");
clock = 155;
report = diagnostics.report();
assert.equal(report.current.elapsedMs, 55, "an ongoing report includes time since its last checkpoint");
clock = 150;
assert.equal(diagnostics.report().current.elapsedMs, 55, "even consecutive reports keep elapsed time monotonic");
clock = 155;
report.current.events[1].details.geometryBytes = -1;
assert.equal(diagnostics.report().current.events[1].details.geometryBytes, 456, "reports are detached");

const beforeStale = writes;
diagnostics.checkpoint(id + 1, "stale");
diagnostics.progress(id + 1, { stage: "upload", value: 1 });
diagnostics.finish(id + 1, "failed");
assert.equal(writes, beforeStale, "stale load callbacks cannot change or persist the active capture");

diagnostics.progress(id, { stage: "upload", value: 0.9, processed: 9, total: 10, unit: "sections" });
const firstProgress = writes;
clock += 999;
diagnostics.progress(id, { stage: "upload", value: 0.95 });
assert.equal(writes, firstProgress, "repeated same-stage progress is throttled");
clock++;
diagnostics.progress(id, { stage: "upload", value: 1 });
assert.equal(writes, firstProgress + 1);
diagnostics.progress(id, { stage: "first-render", value: 1 });
assert.equal(writes, firstProgress + 2, "stage changes persist immediately even at the same clock time");
clock -= 50;
diagnostics.checkpoint(id, "clock-went-backward");
report = diagnostics.report();
assert.equal(report.current.events.at(-1).stepElapsedMs, 0, "elapsed and step times remain monotonic");

const restored = new ViewerLoadDiagnostics(options);
assert.equal(restored.report().storage.recovered, true);
assert.equal(restored.report().current, null);
assert.equal(restored.report().previous.id, id);
assert.equal(restored.report().previous.interrupted, true);
assert.equal(restored.report().previous.status, "loading", "an incomplete record does not claim a confirmed crash");
const retryId = restored.start({ viewer: "three", backend: "webgpu" });
assert.notEqual(retryId, id);
assert.equal(restored.report().previous.id, id, "starting a retry preserves the recovered attempt");
const restoredAgain = new ViewerLoadDiagnostics(options);
assert.equal(restoredAgain.report().previous.id, retryId, "another reload recovers the latest active attempt");
clock += 200;
restored.finish(retryId, "complete");
const finalElapsed = restored.report().current.elapsedMs;
clock += 50;
assert.equal(restored.report().current.elapsedMs, finalElapsed, "a finished run has stable elapsed time");
const beforeFinished = writes;
restored.checkpoint(retryId, "late");
restored.progress(retryId, { stage: "complete", value: 1 });
restored.finish(retryId, "failed", "late error");
assert.equal(writes, beforeFinished, "late callbacks cannot rewrite a completed capture");
restored.note(retryId - 1, "old-device-lost");
assert.equal(writes, beforeFinished, "late device notes also reject stale IDs");
restored.note(retryId, "webgpu-device-lost", { reason: "unknown" });
assert.equal(restored.report().current.status, "complete", "a late GPU error preserves the load status");
assert.equal(restored.report().current.elapsedMs, finalElapsed, "late notes preserve the completed load duration");
assert.equal(restored.report().current.events.at(-1).phase, "webgpu-device-lost");
assert.equal(restored.report().current.events.at(-1).elapsedMs, finalElapsed + 50,
  "late notes identify how long after load submission the driver failed");
clock += 30;
restored.note(retryId, "webgl-context-restored");
assert.equal(restored.report().current.events.at(-1).stepElapsedMs, 30, "successive late notes retain step timings");
assert.equal(new ViewerLoadDiagnostics(options).report().previous.interrupted, false,
  "completed records restored after reload are not marked interrupted");

const failedId = restored.start({ viewer: "three" });
assert.equal(restored.report().previous.id, retryId);
restored.finish(failedId, "failed", "shader compilation failed");
assert.equal(restored.report().current.message, "shader compilation failed");
const supersededId = restored.start({ viewer: "three" });
clock += 10;
const newestId = restored.start({ viewer: "native" });
assert.equal(restored.report().previous.id, supersededId);
assert.equal(restored.report().previous.status, "cancelled", "starting another run finalizes the prior active load");
const beforeSuperseded = writes;
restored.finish(supersededId, "failed", "old asynchronous error");
assert.equal(writes, beforeSuperseded);
assert.equal(restored.report().current.id, newestId);
for (let index = 0; index < 200; index++) {
  clock++;
  restored.checkpoint(newestId, `phase-${index}`, { bytes: index });
}
report = restored.report();
assert.equal(report.current.events.length, 120, "diagnostic history is bounded independently of document resources");
assert.equal(report.current.droppedEvents, 81);
assert.equal(report.current.events.at(-1).phase, "phase-199");
assert.equal(JSON.parse(saved.get(VIEWER_LOAD_DIAGNOSTICS_STORAGE_KEY)).current.events.length, 120);

const broken = new ViewerLoadDiagnostics({ ...options, storage: {
  getItem() { throw new Error("storage access denied"); },
  setItem() { throw new Error("storage quota exceeded"); }
} });
assert.equal(broken.report().storage.available, false);
assert.match(broken.report().storage.error, /access denied/);
const brokenId = broken.start({ backend: "webgl" });
broken.checkpoint(brokenId, "upload");
broken.finish(brokenId, "failed", "GPU lost");
assert.equal(broken.report().current.status, "failed", "storage failures never prevent in-memory diagnostics or loading");
assert.equal(broken.report().storage.available, false);
assert.match(broken.report().storage.error, /quota exceeded/);
assert.doesNotThrow(() => broken.json());

for (const corrupt of ["{broken", "null", '{"diagnosticsVersion":1,"current":{},"previous":null}',
  '{"diagnosticsVersion":2,"current":null,"previous":null}']) {
  const corruptDiagnostics = new ViewerLoadDiagnostics({ ...options, storage: {
    getItem: () => corrupt, setItem() {}
  } });
  assert.equal(corruptDiagnostics.report().previous, null);
  assert.equal(corruptDiagnostics.report().storage.available, true, "invalid stored data does not mean storage is inaccessible");
  assert.equal(typeof corruptDiagnostics.report().storage.error, "string");
  assert.doesNotThrow(() => corruptDiagnostics.start({ viewer: "three" }));
}
const noStorage = new ViewerLoadDiagnostics({ now: () => clock });
const unusual = { bytes: 123n, unavailable: NaN };
unusual.self = unusual;
noStorage.start(unusual);
assert.equal(noStorage.report().storage.available, false);
assert.equal(noStorage.report().current.context.bytes, "123");
assert.equal(noStorage.report().current.context.unavailable, null);
assert.doesNotThrow(() => JSON.parse(noStorage.json()));

console.log("Viewer load diagnostics: opt-in snapshots, synchronous reload recovery, retry preservation, stale callback protection, throttling, bounded history and storage failures passed.");
