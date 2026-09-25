import assert from "node:assert/strict";
import { RenderPerformanceProfiler } from "../src/renderPerformance.ts";

let time = 0, clockCalls = 0;
const now = () => { clockCalls++; return time; };
const unavailable = fakeGl({ extension: false });
const profiler = new RenderPerformanceProfiler({ gl: unavailable.gl, now });
for (let index = 0; index < 10; index++) {
  profiler.beginFrame(); profiler.beginSection("draw"); profiler.add("draws");
  profiler.setFrameContext({ get zoom() { throw Error("disabled context must not be read"); } });
  profiler.endSection("draw"); profiler.endFrame();
}
assert.equal(clockCalls, 0, "disabled profiling never reads a clock");
assert.deepEqual(unavailable.calls, [], "disabled profiling never probes GL or allocates queries");
assert.equal(profiler.enabled, false);
assert.equal(profiler.getReport().gpu.status, "disabled");
assert.equal(clockCalls, 0);

profiler.start({ maxFrames: 3, gpu: false });
assert.deepEqual(unavailable.calls, [], "CPU-only profiling leaves GL untouched");
profiler.beginFrame(100);
profiler.beginSection("draw"); time = 2; profiler.endSection("draw");
profiler.add("draws", 4); profiler.add("draws");
time = 4; profiler.beginSection("draw"); time = 5; profiler.endSection("draw");
time = 8; profiler.endFrame();
time = 16; profiler.beginFrame(116);
time = 18; profiler.beginSection("prepare"); time = 21; profiler.endSection("prepare");
profiler.add("draws", 1); profiler.add("uploads", 8);
time = 24; profiler.endFrame();
time = 1024; profiler.beginFrame(1124);
profiler.beginSection("draw"); time = 1028; profiler.endFrame();
assert.equal(profiler.enabled, false, "a bounded capture stops automatically");
const report = profiler.getReport();
assert.equal(report.frames, 3);
assert.equal(report.elapsedMs, 1028);
assert.equal(report.ignoredFrameGaps, 1, "long idle gaps are omitted instead of interpreted as slow rendering");
assert.deepEqual(report.frameIntervalMs, { samples: 1, total: 16, average: 16, p50: 16, p95: 16, min: 16, max: 16 });
assert.deepEqual(report.frameCpuMs, { samples: 3, total: 20, average: 20 / 3, p50: 8, p95: 8, min: 4, max: 8 });
assert.equal(report.cpuSections.draw.total, 7, "repeated sections aggregate and open sections close at frame end");
assert.equal(report.cpuSections.prepare.samples, 3);
assert.equal(report.cpuSections.prepare.average, 1, "late sections backfill prior frames with zeroes");
assert.deepEqual(report.counters.draws, { samples: 3, total: 6, average: 2, p50: 1, p95: 4.6, min: 0, max: 5 });
assert.equal(report.counters.uploads.average, 8 / 3);
assert.equal(report.frameRecordLimit, 120);
assert.deepEqual(report.frameRecords.map(record => [record.frame, record.startMs, record.intervalMs, record.cpuMs]),
  [[1, 0, null, 8], [2, 16, 16, 8], [3, 1024, null, 4]]);
assert.deepEqual(report.frameRecords.map(record => record.cpuSectionsMs.draw), [3, 0, 4]);
assert.deepEqual(report.frameRecords.map(record => record.counters.uploads), [0, 8, 0]);
assert(report.frameRecords.every(record => record.gpuMs === null && record.gpuStatus === "not-sampled"));
report.counters.draws.total = -100;
assert.equal(profiler.getReport().counters.draws.total, 6, "reports cannot mutate captured statistics");
assert.doesNotThrow(() => JSON.stringify(profiler.getReport()));
assert(report.notes.some(note => note.includes("excluding asynchronous GPU execution")));
assert(report.notes.some(note => note.includes("not a continuous FPS benchmark")));
const callsBefore = clockCalls;
profiler.beginFrame(); profiler.beginSection("draw"); profiler.add("draws"); profiler.endSection("draw"); profiler.endFrame();
assert.equal(clockCalls, callsBefore, "automatic stop restores the disabled fast path");

profiler.start({ maxFrames: 4 });
assert.equal(profiler.getReport().gpu.status, "unavailable");
assert.match(profiler.getReport().gpu.reason, /extension|EXT_disjoint/);
assert.equal(profiler.getReport().frames, 0, "starting a capture resets earlier data");
assert.throws(() => profiler.start({ maxFrames: 0 }), /maxFrames/);
assert.throws(() => profiler.start({ maxFrames: 10001 }), /maxFrames/);
assert.throws(() => profiler.start({ maxFrames: 2.5 }), /maxFrames/);
assert.throws(() => profiler.start({ gpu: "true" }), /gpu/);
assert.throws(() => profiler.start({ maxFrameRecords: -1 }), /maxFrameRecords/);
assert.throws(() => profiler.start({ maxFrameRecords: 1001 }), /maxFrameRecords/);
assert.throws(() => profiler.start({ maxFrameRecords: 3.5 }), /maxFrameRecords/);
assert.equal(profiler.enabled, true, "invalid options do not interrupt a valid capture");
profiler.beginFrame(); profiler.beginSection("partial"); profiler.add("partial");
profiler.stop();
assert.equal(profiler.getReport().frames, 0, "stopping during a frame does not record an incomplete CPU duration");
profiler.reset();
assert.equal(profiler.getReport().elapsedMs, 0);
assert.equal(profiler.getReport().gpu.status, "disabled");
profiler.start({ gpu: false });
profiler.beginFrame();
for (let index = 0; index < 100; index++) { profiler.add(`counter-${index}`); profiler.beginSection(`section-${index}`); }
profiler.endFrame();
assert.equal(Object.keys(profiler.getReport().counters).length, 64);
assert.equal(Object.keys(profiler.getReport().cpuSections).length, 64);
assert.equal(profiler.getReport().discardedMetricNames, 72, "dynamic metric names cannot grow capture memory without bounds");
profiler.dispose();
assert.throws(() => profiler.start(), /disposed/);

const timing = fakeGl();
const gpu = new RenderPerformanceProfiler({ gl: timing.gl, now });
gpu.start({ maxFrames: 12 });
for (let frame = 0; frame < 12; frame++) {
  time = frame * 16; gpu.beginFrame(); time += 2; gpu.endFrame();
  for (const query of timing.queries) query.available = true;
}
const gpuReport = gpu.getReport();
assert.equal(gpuReport.active, false);
assert.equal(gpuReport.gpu.status, "available");
assert.equal(timing.calls.filter(call => call === "createQuery").length, 3, "GPU timers sample every fourth frame");
assert.equal(gpuReport.gpu.frameMs.samples, 3);
assert.equal(gpuReport.gpu.frameMs.average, 2.5, "nanoseconds become milliseconds");
assert.deepEqual(gpuReport.frameRecords.filter(record => record.gpuMs !== null).map(record => record.frame), [1, 5, 9],
  "asynchronous timer results belong to their submitted frame, not the frame polling the result");
assert.equal(gpuReport.gpu.pendingSamples, 0);
assert(timing.queries.every(query => query.deleted), "completed GPU queries are released");
assert.equal(timing.calls.filter(call => call === "finish" || call === "flush").length, 0);
assert.equal(timing.calls.filter(call => call === "getExtension").length, 1);

const pending = fakeGl();
const bounded = new RenderPerformanceProfiler({ gl: pending.gl, now });
bounded.start({ maxFrames: 40 });
for (let frame = 0; frame < 40; frame++) { time = frame * 16; bounded.beginFrame(); time++; bounded.endFrame(); }
assert.equal(pending.queries.length, 8, "slow query readback cannot allocate an unbounded GPU queue");
assert.equal(bounded.getReport().gpu.droppedSamples, 10, "two skipped and eight unresolved samples are reported");
assert.equal(bounded.getReport().gpu.frameMs.samples, 0);
assert.equal(bounded.getReport().gpu.frameMs.average, null, "unavailable results are never fabricated as zero milliseconds");
assert(bounded.getReport().frameRecords.filter(record => (record.frame - 1) % 4 === 0)
  .every(record => record.gpuMs === null && record.gpuStatus === "discarded"));
assert(pending.queries.every(query => query.deleted), "auto stop releases unresolved queries");

const disjoint = fakeGl();
const invalid = new RenderPerformanceProfiler({ gl: disjoint.gl, now });
invalid.start();
for (let frame = 0; frame < 6; frame++) {
  time = frame * 16; invalid.beginFrame(); time++; invalid.endFrame();
  if (frame === 0) disjoint.queries[0].available = true;
}
assert.equal(invalid.getReport().gpu.frameMs.samples, 1);
disjoint.disjoint = true;
time += 16; invalid.beginFrame(); time++; invalid.endFrame();
const invalidReport = invalid.getReport();
assert.equal(invalidReport.gpu.status, "disjoint");
assert.equal(invalidReport.gpu.frameMs.samples, 0, "a disjoint clock invalidates the capture's GPU measurements");
assert.equal(invalidReport.gpu.pendingSamples, 0);
assert.equal(invalidReport.gpu.droppedSamples, 2);
assert(invalidReport.frameRecords.every(record => record.gpuMs === null), "disjoint also invalidates correlated GPU values");
assert.equal(invalidReport.frameRecords[0].gpuStatus, "discarded");
assert(invalid.enabled, "a GPU clock problem does not interrupt CPU profiling or rendering");
assert(disjoint.queries.every(query => query.deleted));
invalid.dispose();

const disposing = fakeGl();
const cleanup = new RenderPerformanceProfiler({ gl: disposing.gl, now });
cleanup.start(); cleanup.beginFrame();
assert.equal(cleanup.getReport().gpu.pendingSamples, 1);
cleanup.dispose();
assert.equal(disposing.calls.filter(call => call === "beginQuery").length, 1);
assert.equal(disposing.calls.filter(call => call === "endQuery").length, 1);
assert(disposing.queries.every(query => query.deleted), "disposal ends and releases an active query");
assert.equal(cleanup.getReport().gpu.pendingSamples, 0);
const occupied = fakeGl(); occupied.current = {};
const host = new RenderPerformanceProfiler({ gl: occupied.gl, now });
host.start({ maxFrames: 1 }); host.beginFrame(); host.endFrame();
assert.equal(occupied.queries.length, 0, "profiling does not replace a host application's active GPU query");
assert.equal(host.getReport().gpu.droppedSamples, 1);
assert(occupied.current, "the host query remains active");

// Operation timing: every draw, clear and blit of one frame in eight gets its
// own query, never in a frame holding the frame-span query, and the context's
// methods are restored when the capture ends.
{
  const operations = operationGl();
  const fill = { name: "fill" }, other = { name: "other" }, surface = {};
  const described = new RenderPerformanceProfiler({ gl: operations.gl, now,
    describeProgram: program => program === fill ? "fill" : null });
  assert.throws(() => described.start({ gpuOperations: "yes" }), /gpuOperations/);
  assert.throws(() => described.start({ gpuOperations: true, gpu: false }), /requires gpu/);
  described.start({ maxFrames: 20 });
  assert(!Object.hasOwn(operations.gl, "drawArrays"), "operation timing is opt-in");
  described.stop();
  described.start({ maxFrames: 20, gpuOperations: true });
  assert(Object.hasOwn(operations.gl, "drawArrays"));
  const gl = operations.gl;
  for (let frame = 0; frame < 20; frame++) {
    time = frame * 16; described.beginFrame();
    gl.useProgram(fill); gl.bindFramebuffer(gl.FRAMEBUFFER, surface); gl.viewport(0, 0, 100, 50);
    gl.drawArraysInstanced(4, 0, 4, 10);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(1, 2, 3, 4); gl.clear(16384); gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(other); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.drawArrays(4, 0, 3);
    gl.blitFramebuffer(0, 0, 10, 10, 0, 0, 20, 30, 16384, 9728);
    time++; described.endFrame();
    operations.complete();
  }
  const timed = operations.queries.filter(query => query.call !== "frame");
  assert.deepEqual([...new Set(timed.map(query => query.frame))], [2, 10, 18], "one frame in eight, offset from span frames");
  assert.equal(timed.length, 12, "four operations in each of three frames");
  assert.equal(operations.draws, 80, "every operation is still issued exactly once");
  const report = described.getReport().gpu.operations;
  assert.equal(report.status, "available");
  assert.equal(report.frameMs.samples, 3);
  assert.equal(report.frameMs.average, 3 + 1 + 0.5 + 0.25);
  assert.equal(report.operationsPerFrame.average, 4);
  assert.deepEqual(report.byLabel.map(entry => [entry.label, entry.operationsPerFrame, entry.msPerFrame]),
    [["fill → offscreen", 1, 3], ["clear → offscreen", 1, 1], ["program#1 → screen", 1, 0.5], ["blit → screen", 1, 0.25]],
    "undescribed programs get a stable ordinal and targets follow framebuffer bindings");
  const [slowest] = report.slowest;
  assert.deepEqual({ ...slowest }, { label: "fill → offscreen", ms: 3, order: 0, call: "drawArraysInstanced",
    vertices: 4, instances: 10, pixels: null, target: "offscreen", viewport: [100, 50], scissor: null });
  assert.deepEqual(report.slowest.find(detail => detail.call === "clear").scissor, [1, 2, 3, 4]);
  assert.equal(report.slowest.find(detail => detail.call === "blitFramebuffer").pixels, 600);
  assert.equal(report.slowest.length, 12);
  assert(!Object.hasOwn(operations.gl, "drawArrays") && !Object.hasOwn(operations.gl, "useProgram"),
    "a finished capture restores the context's own methods");
  assert(operations.queries.every(query => query.deleted), "every operation query is released");
  assert.doesNotThrow(() => JSON.stringify(described.getReport()));
}

const missing = new RenderPerformanceProfiler({ now });
missing.start();
assert.equal(missing.getReport().gpu.status, "unavailable");
assert.match(missing.getReport().gpu.reason, /No WebGL2 context/);
missing.dispose();

// Correlate CPU/GPU spikes with the exact camera and submitted geometry. Timer
// readback is deliberately delayed past several completed frames.
const correlationGl = fakeGl();
const correlated = new RenderPerformanceProfiler({ gl: correlationGl.gl, now });
const selectRecords = correlated.getFrameRecords.bind(correlated);
let recordSelections = 0;
correlated.getFrameRecords = () => { recordSelections++; return selectRecords(); };
time = 2000;
correlated.start({ maxFrames: 32, maxFrameRecords: 8 });
const sourceContext = { cameraCenterX: 0, cameraCenterY: 2, zoom: 1,
  viewportWidth: 1920, viewportHeight: 945, unitsPerPixel: null, schedulePadding: 16 };
for (let frame = 0; frame < 32; frame++) {
  time = 2000 + frame * 32;
  correlated.beginFrame();
  sourceContext.cameraCenterX = frame * 10; sourceContext.zoom = 1 + frame / 10;
  correlated.setFrameContext(sourceContext);
  sourceContext.cameraCenterX = -1;
  correlated.beginSection("drawSubmission");
  time += frame === 6 ? 20 : 1;
  correlated.endSection("drawSubmission");
  correlated.add("drawBatches", frame === 11 ? 900 : 10);
  correlated.add("strokeInstances", 1000 + frame);
  correlated.endFrame();
  assert.equal(recordSelections, frame <= 4 ? 0 : 1,
    "record selection and sorting only run for an explicit report, not on each captured frame");
  if (frame === 4) {
    const pendingRecord = correlated.getReport().frameRecords.find(record => record.frame === 1);
    assert.equal(pendingRecord.gpuStatus, "pending");
    assert.equal(pendingRecord.gpuMs, null);
  }
  for (let query = 0; query < correlationGl.queries.length; query++) {
    correlationGl.queries[query].nanoseconds = query === 3 ? 30_000_000 : 1_000_000;
    if (frame > query * 4 + 4) correlationGl.queries[query].available = true;
  }
}
const correlations = correlated.getReport();
assert.equal(correlations.frames, 32, "record limits do not shorten aggregate capture");
assert.equal(correlations.frameRecords.length, 8, "correlated output remains bounded");
assert.deepEqual(correlations.frameRecords.map(record => record.frame),
  correlations.frameRecords.map(record => record.frame).sort((a, b) => a - b), "records remain chronological");
for (const [frame, reason] of [[7, "slow-cpu"], [12, "high-batches"], [13, "slow-gpu"]]) {
  const record = correlations.frameRecords.find(record => record.frame === frame);
  assert(record, `recorded ${reason} spike`); assert(record.reasons.includes(reason));
  assert.equal(record.context.cameraCenterX, (frame - 1) * 10, "camera state is detached from the caller");
  assert.equal(record.context.zoom, 1 + (frame - 1) / 10);
  assert.equal(record.context.unitsPerPixel, null, "unknown scales remain explicitly unknown");
  assert.equal(record.context.schedulePadding, 16);
  assert.equal(record.counters.strokeInstances, 1000 + frame - 1);
}
assert.equal(correlations.frameRecords.find(record => record.frame === 13).gpuMs, 30);
assert.equal(correlations.frameRecords.find(record => record.frame === 13).cpuMs, 1,
  "late GPU spikes are not assigned to whichever CPU frame polls them");
assert(correlations.frameRecords.some(record => record.frame === 32 && record.reasons.includes("timeline")),
  "baseline sampling reaches the end of the capture instead of filling only its beginning");
correlations.frameRecords[0].context.cameraCenterX = -100;
correlations.frameRecords[0].counters.strokeInstances = -100;
correlations.frameRecords[0].cpuSectionsMs.drawSubmission = -100;
correlations.frameRecords[0].reasons.push("edited");
const freshRecord = correlated.getReport().frameRecords[0];
assert(freshRecord.context.cameraCenterX >= 0);
assert(freshRecord.counters.strokeInstances >= 1000);
assert(freshRecord.cpuSectionsMs.drawSubmission > 0);
assert(!freshRecord.reasons.includes("edited"));
correlated.start({ maxFrames: 1, gpu: false, maxFrameRecords: 0 });
correlated.beginFrame();
correlated.setFrameContext({ get zoom() { throw Error("disabled records must not read camera data"); } });
correlated.add("drawBatches", 7); time++; correlated.endFrame();
const withoutRecords = correlated.getReport();
assert.deepEqual(withoutRecords.frameRecords, []);
assert.equal(withoutRecords.counters.drawBatches.total, 7);
assert.equal(correlated.frameContexts.length, 0, "recording can be disabled without storing per-frame context objects");
assert.equal(correlated.frameGpuTimes.length, 0, "restart discards prior GPU-to-frame associations");
correlated.dispose();
console.log("Render profiling passed: opt-in CPU metrics, bounded captures, asynchronous GPU sampling, disjoint clocks and cleanup.");

function fakeGl(options = {}) {
  const state = { calls: [], queries: [], disjoint: false, current: null };
  state.gl = {
    CURRENT_QUERY: 10, QUERY_RESULT_AVAILABLE: 11, QUERY_RESULT: 12,
    getExtension() { state.calls.push("getExtension"); return options.extension === false ? null : { TIME_ELAPSED_EXT: 20, GPU_DISJOINT_EXT: 21 }; },
    getParameter(value) { state.calls.push("getParameter"); assert.equal(value, 21); return state.disjoint; },
    getQuery(target, parameter) { state.calls.push("getQuery"); assert.equal(target, 20); assert.equal(parameter, 10); return state.current; },
    createQuery() { state.calls.push("createQuery"); const query = { available: false, deleted: false }; state.queries.push(query); return query; },
    beginQuery(target, query) { state.calls.push("beginQuery"); assert.equal(target, 20); assert.equal(state.current, null); state.current = query; },
    endQuery(target) { state.calls.push("endQuery"); assert.equal(target, 20); assert(state.current); state.current = null; },
    getQueryParameter(query, parameter) {
      state.calls.push("getQueryParameter"); assert.equal(query.deleted, false);
      if (parameter === 11) return query.available;
      assert.equal(parameter, 12); assert(query.available, "query results are never requested before availability");
      return query.nanoseconds ?? 2_500_000;
    },
    deleteQuery(query) { state.calls.push("deleteQuery"); assert.equal(query.deleted, false); query.deleted = true; },
    finish() { state.calls.push("finish"); throw Error("GPU waits are forbidden"); },
    flush() { state.calls.push("flush"); throw Error("Forced submission is forbidden"); }
  };
  return state;
}

function operationGl() {
  // A query around exactly one call timed that operation; frame-span queries
  // contain the whole frame.
  const state = { queries: [], current: null, draws: 0, frame: 0 };
  const durations = { drawArraysInstanced: 3, clear: 1, drawArrays: 0.5, blitFramebuffer: 0.25, frame: 5 };
  class FakeGl {
    get CURRENT_QUERY() { return 10; } get QUERY_RESULT_AVAILABLE() { return 11; } get QUERY_RESULT() { return 12; }
    get FRAMEBUFFER() { return 30; } get DRAW_FRAMEBUFFER() { return 31; } get SCISSOR_TEST() { return 32; }
    get CURRENT_PROGRAM() { return 33; } get DRAW_FRAMEBUFFER_BINDING() { return 34; } get VIEWPORT() { return 35; }
    get SCISSOR_BOX() { return 36; }
    getExtension() { return { TIME_ELAPSED_EXT: 20, GPU_DISJOINT_EXT: 21 }; }
    getParameter(value) {
      if (value === 21) return false;
      if (value === 35 || value === 36) return [0, 0, 0, 0];
      return null;
    }
    isEnabled() { return false; }
    getQuery() { return state.current; }
    createQuery() { const query = { available: false, deleted: false, frame: state.frame, calls: [] }; state.queries.push(query); return query; }
    beginQuery(_target, query) { assert.equal(state.current, null, "timer queries never nest"); state.current = query; }
    endQuery() {
      const query = state.current; assert(query); state.current = null;
      query.call = query.calls.length === 1 ? query.calls[0] : "frame";
    }
    getQueryParameter(query, parameter) {
      assert.equal(query.deleted, false);
      return parameter === 11 ? query.available : durations[query.call] * 1_000_000;
    }
    deleteQuery(query) { assert.equal(query.deleted, false); query.deleted = true; }
    useProgram() {} bindFramebuffer() {} viewport() {} scissor() {} enable() {} disable() {}
    drawArrays() { this.count("drawArrays"); } drawArraysInstanced() { this.count("drawArraysInstanced"); }
    clear() { this.count("clear"); } blitFramebuffer() { this.count("blitFramebuffer"); }
    count(call) { state.draws++; state.current?.calls.push(call); }
  }
  state.gl = new FakeGl();
  state.complete = () => { for (const query of state.queries) query.available = true; state.frame++; };
  return state;
}
