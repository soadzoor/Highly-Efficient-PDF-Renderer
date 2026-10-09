import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import {
  formatPdfToHepRasterFallbackSummary,
  formatPdfToHepSummary,
  parsePdfToHepArguments,
  resolvePdfToHepWorkerCount,
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

const GiB = 1024 ** 3;
const workerCount = (memory, { pending = 100, cpu = 32, heapMb = 12_288, workers } = {}) =>
  resolvePdfToHepWorkerCount(pending, { workers }, heapMb, {
    availableParallelism: () => cpu,
    availableMemory: () => memory
  });
assert.equal(workerCount(16 * GiB), 1, "a 16 GiB WSL VM must not launch one 12 GiB worker per CPU thread");
assert.equal(workerCount(32 * GiB), 1, "reserve native memory and leave 25% of available RAM as headroom");
assert.equal(workerCount(64 * GiB), 3);
const twoWorkerBoundary = 2 * 13 * GiB / 0.75;
assert.equal(workerCount(twoWorkerBoundary - 1), 1, "round worker capacity down");
assert.equal(workerCount(twoWorkerBoundary), 2, "admit the next worker at the budget boundary");
assert.equal(workerCount(64 * GiB, { cpu: 2 }), 2, "CPU count still bounds automatic concurrency");
assert.equal(workerCount(64 * GiB, { pending: 1 }), 1, "never launch more workers than pending PDFs");
assert.equal(workerCount(64 * GiB, { pending: 0 }), 0);
assert.equal(workerCount(64 * GiB, { heapMb: 131_072 }), 1, "one PDF remains usable even when its ceiling exceeds free RAM");
assert.equal(workerCount(16 * GiB, { heapMb: 8192 }), 1, "configured heap ceilings affect scheduling");
assert.equal(workerCount(32 * GiB, { heapMb: 8192 }), 2);
for (const memory of [0, -1, undefined, NaN, Infinity]) {
  assert.equal(workerCount(memory), 1, "unknown or exhausted available memory uses serial conversion");
}
assert.equal(resolvePdfToHepWorkerCount(4, {}, 12_288, {
  availableParallelism: () => 32,
  availableMemory: () => { throw new Error("memory probe unavailable"); }
}), 1, "an unavailable memory probe must not prevent conversion");
assert.equal(resolvePdfToHepWorkerCount(4, { workers: 3 }, 12_288, {
  availableParallelism: () => { throw new Error("explicit workers bypass CPU probing"); },
  availableMemory: () => { throw new Error("explicit workers bypass memory probing"); }
}), 3, "an explicit worker override remains authoritative");

async function withBatch({ count = 5, options = {}, available = 2, memory = 64 * GiB,
  throwOnStart, failCleanup = false, reports = {} } = {}, check) {
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
  let memoryProbeCount = 0;
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
      availableMemory: () => { memoryProbeCount++; return memory; },
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
    assert.equal(memoryProbeCount, options.workers === undefined ? 1 : 0,
      "automatic memory is sampled once per batch; explicit worker counts skip the probe");
  } finally {
    Object.assign(console, originalConsole);
  }
}

await withBatch({}, async (batch) => {
  assert.deepEqual(batch.started, [1, 2], "default uses CPU parallelism when enough memory is available");
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
  assert(batch.logs.at(-1).endsWith("Raster fallback by PDF:\n  None in successful conversions."));
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
  assert(summary.indexOf("Conversion summary:") > summary.indexOf("Warnings by PDF:"), "compact totals follow the warning recap");
  assert(summary.indexOf("Raster fallback by PDF:") > summary.indexOf("Conversion summary:"), "the raster fallback recap follows the totals");
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

const selectiveFallback = { type: "pdf-to-hep-raster-fallback", code: "selective-raster-fallback",
  pageIndex: 0, message: "One display span used raster fallback.", reason: "unsupported blend mode" };
const pageFallback = { type: "pdf-to-hep-raster-fallback", code: "page-raster-fallback",
  pageIndex: 2, message: "A full page used raster fallback after vector-clip-edge-limit.", reason: "vector-clip-edge-limit" };
const retainedFallback = { type: "pdf-to-hep-raster-fallback", code: "retained-raster-fallback",
  message: "A retained program used raster fallback." };
const diagnosticChild = new EventEmitter();
const diagnosticWorker = startPdfToHepWorker({ pdfPath: path.resolve("dedup.pdf"), fileNumber: 1, fileCount: 1 },
  false, 8192, () => diagnosticChild);
const differentDiagnostics = [
  selectiveFallback,
  { ...selectiveFallback, pageIndex: 1 },
  { ...selectiveFallback, code: "page-raster-fallback" },
  { ...selectiveFallback, message: "A different span used raster fallback." },
  { ...selectiveFallback, reason: "unsupported pattern" }
];
for (const event of [selectiveFallback, ...differentDiagnostics]) diagnosticChild.emit("message", event);
assert.deepEqual(diagnosticWorker.report.rasterFallbacks, differentDiagnostics.map(({ type, ...diagnostic }, index) =>
  ({ ...diagnostic, count: index === 0 ? 2 : 1 })),
  "deduplication preserves differences in page, code, message, and reason");
diagnosticChild.emit("close", 0, null);
await diagnosticWorker.completion;
await withBatch({
  count: 5,
  reports: {
    1: [selectiveFallback, { ...selectiveFallback, count: 999 }, pageFallback, retainedFallback],
    2: [
      // Warning text alone and non-raster compatibility diagnostics must never
      // classify a PDF as using raster fallback.
      { type: "pdf-to-hep-warning", message: "[page-raster-fallback] unstructured warning text" },
      ...["retained-vector-fallback", "font.type1-substituted", "icc-fallback", "native-raster-image", "page-preview"].map(code =>
        ({ ...selectiveFallback, code })),
      { ...selectiveFallback, message: 1 },
      { ...selectiveFallback, message: "" },
      { ...selectiveFallback, pageIndex: -1 },
      { ...selectiveFallback, pageIndex: 0.5 },
      { ...selectiveFallback, pageIndex: Number.MAX_SAFE_INTEGER + 1 },
      { ...selectiveFallback, reason: "" },
      { ...selectiveFallback, reason: 42 }
    ],
    3: [{ ...selectiveFallback, message: "Raster attempt before conversion failed." }],
    4: [{ ...retainedFallback, pageIndex: 4 }],
    5: [{ ...selectiveFallback, message: "Raster attempt before output was skipped." }]
  }
}, async batch => {
  await batch.finish(2);
  await batch.finish(3, 1);
  await batch.finish(4);
  await batch.finish(5, 3);
  await batch.finish(1);
  assert.equal(await batch.completion, 1);
  const summary = batch.logs.at(-1);
  const fallbackSummary = summary.slice(summary.indexOf("Raster fallback by PDF:"));
  assert.equal(fallbackSummary, [
    "Raster fallback by PDF:",
    "  Successful PDFs using raster fallback: 2",
    `  ${path.resolve("worker-1.pdf")}:`,
    "    Page 1 [selective-raster-fallback]: One display span used raster fallback. (2 times)",
    "      Reason: unsupported blend mode",
    "    Page 3 [page-raster-fallback]: A full page used raster fallback after vector-clip-edge-limit.",
    "    [retained-raster-fallback]: A retained program used raster fallback.",
    `  ${path.resolve("worker-4.pdf")}:`,
    "    Page 5 [retained-raster-fallback]: A retained program used raster fallback."
  ].join("\n"));
  assert.equal((fallbackSummary.match(/vector-clip-edge-limit/g) ?? []).length, 1,
    "a reason already present in the message is not repeated");
  for (const name of ["worker-2.pdf", "worker-3.pdf", "worker-5.pdf"]) assert(!fallbackSummary.includes(name));
});

const interruptedFallback = [{ pdfPath: "interrupted.pdf", status: "interrupted", rasterFallbacks: [
  { code: "page-raster-fallback", message: "Temporary raster attempt.", count: 1 }
] }];
assert.equal(formatPdfToHepRasterFallbackSummary(interruptedFallback),
  "Raster fallback by PDF:\n  None in successful conversions.",
  "interrupted attempts are excluded from the successful output recap");
assert.equal(formatPdfToHepRasterFallbackSummary([]), "Raster fallback by PDF:\n  None in successful conversions.");

await withBatch({ count: 3, available: 32, memory: 16 * GiB }, async (batch) => {
  assert.deepEqual(batch.started, [1], "the real batch applies its automatic memory limit");
  await batch.finish(1);
  assert.deepEqual(batch.started, [1, 2], "a finished process releases the slot for the next PDF");
  await batch.finish(2);
  await batch.finish(3);
  assert.equal(await batch.completion, 0);
  assert.equal(batch.maximumActive, 1, "large CPU counts cannot overrun a small memory budget");
});

for (const [count, workers, expected] of [[3, 1, 1], [3, 3, 3], [1, 100, 1]]) {
  await withBatch({ count, memory: GiB, options: { workers } }, async (batch) => {
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

console.log("PDF-to-HEP worker pool: memory/CPU defaults, overrides, scheduling, failure isolation, timing, size/warning summaries, cleanup, and cancellation passed.");
