import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import {
  formatPdfToHepSummary,
  parsePdfToHepArguments,
  runPdfToHepWorkerBatch,
  startPdfToHepWorker
} from "../PDFtoHEP.js";

// Synthetic children only: no PDFs, source loader, server, or actual conversion.
assert.equal(parsePdfToHepArguments(["--workers=4", "pdfs"]).workers, 4);
assert.equal(parsePdfToHepArguments(["--workers=1", "pdfs"]).workers, 1);
assert.equal(parsePdfToHepArguments(["pdfs"]).workers, undefined);
assert.equal(parsePdfToHepArguments(["--", "--workers=2"]).inputPath, "--workers=2");
for (const value of ["", "0", "-1", "1.5", "NaN", "Infinity", "2e3", " 2", "9007199254740992"]) {
  assert.throws(() => parsePdfToHepArguments([`--workers=${value}`, "pdfs"]), /positive integer/);
}
assert.throws(() => parsePdfToHepArguments(["--workers=2", "--workers=3", "pdfs"]), /exactly one/);

async function withBatch({ count = 5, options = {}, available = 2, throwOnStart, failCleanup = false, reports = {} } = {}, check) {
  const items = Array.from({ length: count }, (_, index) => ({
    pdfPath: path.resolve(`worker-${index + 1}.pdf`),
    outputPath: path.resolve(`worker-${index + 1}-parsed-data.hep`),
    fileNumber: index + 1,
    fileCount: count
  }));
  const signalTarget = new EventEmitter();
  const children = new Map();
  const started = [];
  const cleaned = [];
  const signals = [];
  const logs = [];
  const errors = [];
  const warnings = [];
  let time = 0;
  let active = 0;
  let maximumActive = 0;
  let settled = false;
  const originalConsole = { log: console.log, error: console.error, warn: console.warn };
  try {
    console.log = (message) => logs.push(String(message));
    console.error = (message) => errors.push(String(message));
    console.warn = (message) => warnings.push(String(message));
    const completion = runPdfToHepWorkerBatch(items, { force: false, ...options }, 1, {
      heapMb: 8192,
      signalTarget,
      availableParallelism: () => available,
      now: () => time,
      startWorker(item, force, heapMb) {
        assert.equal(force, options.force ?? false);
        assert.equal(heapMb, 8192);
        assert(!started.includes(item.fileNumber), "each PDF is dispatched exactly once");
        started.push(item.fileNumber);
        if (item.fileNumber === throwOnStart) throw new Error("synthetic synchronous spawn failure");
        const child = new EventEmitter();
        child.pid = 40_000 + item.fileNumber;
        child.exitCode = null;
        child.signalCode = null;
        child.kill = (signal) => { signals.push([item.fileNumber, signal]); return true; };
        children.set(item.fileNumber, child);
        maximumActive = Math.max(maximumActive, ++active);
        return startPdfToHepWorker(item, force, heapMb, () => child);
      },
      async cleanupWorkerTemps(outputPath, pid, token) {
        assert.equal(outputPath, items[pid - 40_001].outputPath);
        assert.match(token, /^[0-9a-f-]{36}$/i);
        cleaned.push(pid - 40_000);
        if (failCleanup) throw new Error("synthetic cleanup failure");
      }
    });
    completion.then(() => { settled = true; });
    await check({
      started, cleaned, signals, logs, errors, warnings, signalTarget, completion,
      get maximumActive() { return maximumActive; },
      get settled() { return settled; },
      async finish(number, code = 0, signal = null, at = time) {
        time = at;
        const child = children.get(number);
        assert(child, `worker ${number} must have started`);
        for (const message of reports[number] ?? []) child.emit("message", message);
        child.exitCode = code;
        child.signalCode = signal;
        active -= 1;
        child.emit("close", code, signal);
        await tick();
      },
      async failSpawn(number) {
        const child = children.get(number);
        child.exitCode = -1;
        active -= 1;
        child.emit("error", new Error("synthetic asynchronous spawn failure"));
        child.emit("close", -1, null);
        await tick();
      }
    });
    assert.equal(signalTarget.listenerCount("SIGINT"), 0);
    assert.equal(signalTarget.listenerCount("SIGTERM"), 0);
  } finally {
    Object.assign(console, originalConsole);
  }
}

await withBatch({}, async (batch) => {
  assert.deepEqual(batch.started, [1, 2], "default uses the available CPU parallelism");
  await batch.finish(2, 0, null, 1000);
  assert.deepEqual(batch.started, [1, 2, 3], "a fast PDF refills its slot while PDF 1 remains active");
  await batch.finish(3, 1, null, 2000);
  assert.deepEqual(batch.started, [1, 2, 3, 4], "a failed PDF also releases its slot");
  await batch.finish(4, 3, null, 3000);
  assert.deepEqual(batch.started, [1, 2, 3, 4, 5], "a skipped PDF also releases its slot");
  await batch.finish(5, 0, null, 4000);
  assert.equal(batch.settled, false, "the batch waits for the remaining slow PDF");
  await batch.finish(1, 0, null, 5000);
  assert.equal(await batch.completion, 1);
  assert.equal(batch.maximumActive, 2, "the pool never exceeds available parallelism");
  assert.deepEqual(batch.cleaned, [2, 3, 4, 5, 1]);
  assert(batch.logs.includes("Finished: 3 generated, 2 skipped, 1 failed."));
  const summary = batch.logs.find(line => line.startsWith("Conversion time summary:"));
  const orderedNumbers = [...summary.matchAll(/\[(\d+)\/5\]/g)].map(match => Number(match[1]));
  assert.deepEqual(orderedNumbers, [1, 2, 3, 4, 5], "summary stays in input order despite out-of-order completion");
  assert(summary.includes("Total attempted conversion time: 0h 00m 09s"));
  assert.equal(batch.logs.at(-2), "Batch wall time: 0h 00m 05s");
  assert.match(batch.logs.at(-1), /PDFs attempted: 5\n  Successful: 3\n  Failed: 1\n  Skipped: 2/);
  assert.match(batch.logs.at(-1), /File sizes available for 0\/3 successful conversions/);
  assert.match(batch.logs.at(-1), /Original PDFs \(successful\): unavailable/);
});

await withBatch({
  count: 4,
  reports: {
    1: [
      { type: "pdf-to-hep-sizes", sourceBytes: 1024 },
      { type: "pdf-to-hep-warning", message: "[HEP] larger output" },
      { type: "pdf-to-hep-warning", message: "[HEP] larger output" },
      { type: "pdf-to-hep-sizes", outputBytes: 2048 }
    ],
    2: [
      { type: "pdf-to-hep-sizes", sourceBytes: 8192, outputBytes: 4096 },
      { type: "pdf-to-hep-sizes", sourceBytes: -1, outputBytes: "invalid" },
      { type: "pdf-to-hep-warning", message: "page 2: [icc-fallback] approximate colors" }
    ],
    3: [
      { type: "pdf-to-hep-sizes", sourceBytes: 1_000_000, outputBytes: 2_000_000 },
      { type: "pdf-to-hep-error", message: "synthetic encoding failure" },
      { type: "pdf-to-hep-warning", message: "repaired malformed content" }
    ],
    4: [{ type: "pdf-to-hep-sizes", sourceBytes: 1_000_000, outputBytes: 2_000_000 }]
  }
}, async (batch) => {
  await batch.finish(2);
  await batch.finish(3, 1);
  await batch.finish(4, 3);
  await batch.finish(1);
  assert.equal(await batch.completion, 1);
  const summary = batch.logs.at(-1);
  assert.match(summary, /Conversion summary:/);
  assert(summary.indexOf("Conversion summary:") > summary.indexOf("Warnings by PDF:"), "compact totals remain last after the warning recap");
  assert.match(summary, /PDFs attempted: 4\n  Successful: 2\n  Failed: 1\n  Skipped: 2/);
  assert.match(summary, /Original PDFs \(successful\): 9.00 KiB/);
  assert.match(summary, /Generated HEPs \(successful\): 6.00 KiB/);
  assert.match(summary, /Size change: -3.00 KiB \(-33.33%\)/);
  assert.match(summary, /HEPs larger than original PDFs: 1/);
  assert.match(summary, /Warnings: 4 across 3 PDF\(s\)/);
  assert.match(summary, /worker-3.pdf: synthetic encoding failure/);
  assert.match(summary, /\[HEP\] larger output \(2 times\)/);
  assert.match(summary, /page 2: \[icc-fallback\] approximate colors/);
  assert(summary.indexOf("worker-1.pdf:") < summary.indexOf("worker-2.pdf:"), "warnings stay in input order");
  const timingSummary = batch.logs.find((line) => line.startsWith("Conversion time summary:"));
  assert.match(timingSummary, /\(generated\); PDF 1.00 KiB -> HEP 2.00 KiB/);
  assert(!timingSummary.includes("HEP 1.91 MiB"), "failed and skipped candidates are excluded from output sizes");
});

assert.match(formatPdfToHepSummary([
  { status: "generated", sourceBytes: 1024, outputBytes: 2048 }
], 0), /Size change: \+1.00 KiB \(\+100.00%\)/);
assert.match(formatPdfToHepSummary([
  { status: "generated", sourceBytes: 0, outputBytes: 0 }
], 0), /Generated HEPs \(successful\): 0 B/);
assert(!formatPdfToHepSummary([{ status: "generated", sourceBytes: 0, outputBytes: 0 }], 0).includes("NaN"));

for (const [count, workers, expected] of [[3, 1, 1], [3, 3, 3], [1, 100, 1]]) {
  await withBatch({ count, options: { workers } }, async (batch) => {
    assert.equal(batch.started.length, expected, "explicit worker count overrides CPU detection and is capped by pending work");
    for (let number = 1; number <= count; number++) await batch.finish(number);
    assert.equal(await batch.completion, 0);
    assert.equal(batch.maximumActive, expected);
  });
}

await withBatch({ count: 4, throwOnStart: 1, failCleanup: true }, async (batch) => {
  assert.deepEqual(batch.started, [1, 2, 3], "a synchronous launch failure must not consume a slot");
  await batch.failSpawn(2);
  assert.deepEqual(batch.started, [1, 2, 3, 4], "an asynchronous launch failure must not stall the queue");
  await batch.finish(3);
  await batch.finish(4);
  assert.equal(await batch.completion, 1);
  assert.deepEqual(batch.cleaned, [2, 3, 4]);
  assert.equal(batch.warnings.length, 3, "cleanup failure is diagnosed without stranding other workers");
  assert(batch.logs.includes("Finished: 2 generated, 1 skipped, 2 failed."));
  assert.match(batch.logs.at(-1), /Warnings: 3 across 3 PDF\(s\)/);
  assert.match(batch.logs.at(-1), /synthetic synchronous spawn failure/);
  assert.match(batch.logs.at(-1), /synthetic asynchronous spawn failure/);
});

for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  await withBatch({}, async (batch) => {
    batch.signalTarget.emit(signal);
    batch.signalTarget.emit(signal);
    assert.deepEqual(batch.signals, [[1, signal], [2, signal], [1, "SIGKILL"], [2, "SIGKILL"]]);
    await batch.finish(2, null, "SIGKILL");
    assert.equal(batch.settled, false, "cancellation waits for every active worker");
    assert.equal(batch.signalTarget.listenerCount(signal), 1, "signal forwarding stays installed while any worker remains");
    await batch.finish(1, null, "SIGKILL");
    assert.equal(await batch.completion, exitCode);
    assert.deepEqual(batch.started, [1, 2], "interruption prevents queued PDFs from starting");
    assert.deepEqual(batch.cleaned, [2, 1]);
    assert.match(batch.logs.at(-1), /PDFs attempted: 2\n  Successful: 0\n  Failed: 0\n  Skipped: 1\n  Interrupted: 2\n  Not attempted: 3/);
  });
  await withBatch({}, async (batch) => {
    await batch.finish(2, exitCode);
    assert.deepEqual(batch.signals, [[1, signal]], "a child interruption cancels its active siblings");
    assert.deepEqual(batch.started, [1, 2], "child interruption also stops dispatch");
    await batch.finish(1, null, signal);
    assert.equal(await batch.completion, exitCode);
  });
}

console.log("PDF-to-HEP worker pool: CPU defaults, limits, scheduling, failure isolation, timing, size/warning summaries, cleanup, and cancellation passed.");
