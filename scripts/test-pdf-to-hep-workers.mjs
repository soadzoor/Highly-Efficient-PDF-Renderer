import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import {
  formatPdfToHepDiagnosticsSummary,
  formatPdfToHepRasterFallbackSummary,
  formatPdfToHepSummary,
  formatPdfToHepTimingSummary,
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
const workerCount = ({ pending = 100, cpu = 32, memory, workers } = {}) => {
  let memoryProbeCount = 0;
  const count = resolvePdfToHepWorkerCount(pending, { workers }, {
    availableParallelism: () => cpu,
    availableMemory: () => { memoryProbeCount++; return memory; }
  });
  assert.equal(memoryProbeCount, 0, "worker count does not probe available memory");
  return count;
};
assert.equal(workerCount(), 32, "automatic concurrency uses all available CPU threads");
assert.equal(workerCount({ cpu: 2 }), 2, "CPU count bounds automatic concurrency");
assert.equal(workerCount({ pending: 20 }), 20, "never launch more workers than pending PDFs");
assert.equal(workerCount({ pending: 1 }), 1);
assert.equal(workerCount({ pending: 0 }), 0);
for (const memory of [GiB, 16 * GiB, 32 * GiB, 64 * GiB, 0, -1, undefined, NaN, Infinity]) {
  assert.equal(workerCount({ memory }), 32, "available memory does not affect automatic concurrency");
}
assert.equal(resolvePdfToHepWorkerCount(4, {}, {
  availableParallelism: () => 32,
  availableMemory: () => { throw new Error("memory probe unavailable"); }
}), 4, "an unavailable memory probe must not affect concurrency");
assert.equal(resolvePdfToHepWorkerCount(4, { workers: 3 }, {
  availableParallelism: () => { throw new Error("explicit workers bypass CPU probing"); },
  availableMemory: () => { throw new Error("explicit workers bypass memory probing"); }
}), 3, "an explicit worker override remains authoritative");

const stripColor = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");
const tableRows = (text) => stripColor(text).split("\n")
  .filter((line) => line.startsWith("|"))
  .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
const metrics = (text) => Object.fromEntries(tableRows(text));

async function withBatch({ count = 5, options = {}, available = 2, memory = GiB, heapMb = 8192,
  throwOnStart, failCleanup = false, diagnosticFailure = false, reports = {} } = {}, check) {
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
  const diagnostics = [];
  let logClosed = false;
  const diagnosticLog = {
    path: "/synthetic/diagnostics.log",
    fd: 99,
    write(message) {
      assert.equal(logClosed, false, "diagnostics are written before closing the log");
      diagnostics.push(String(message));
    },
    async close() {
      await tick();
      logClosed = true;
    }
  };
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
      heapMb,
      signalTarget,
      availableParallelism: () => available,
      availableMemory: () => { memoryProbeCount++; return memory; },
      now: () => time,
      createDiagnosticLog: async () => {
        if (diagnosticFailure) throw new Error("synthetic log creation failure");
        return diagnosticLog;
      },
      startWorker(item, force, workerHeapMb) {
        assert.equal(force, options.force ?? false);
        assert.equal(workerHeapMb, heapMb);
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
        return startPdfToHepWorker(item, force, workerHeapMb, () => child);
      },
      async cleanupWorkerTemps(outputPath, pid, token) {
        assert.equal(outputPath, items[pid - 40_001].outputPath);
        assert.match(token, /^[0-9a-f-]{36}$/i);
        cleaned.push(pid - 40_000);
        if (failCleanup) throw new Error("synthetic cleanup failure");
      }
    });
    completion.then(() => { settled = true; });
    await tick();
    await check({
      started, cleaned, signals, logs, errors, warnings, diagnostics, signalTarget, completion,
      get logClosed() { return logClosed; },
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
    assert.equal(memoryProbeCount, 0, "batches do not probe available memory");
    assert.equal(logClosed, !diagnosticFailure, "completion waits for an available diagnostic log to flush and close");
  } finally {
    Object.assign(console, originalConsole);
  }
}

await withBatch({}, async (batch) => {
  assert.deepEqual(batch.started, [1, 2], "default uses CPU parallelism regardless of available memory");
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
  const orderedNumbers = tableRows(summary).slice(1).map((row) => Number(row[0].split("/")[0]));
  assert.deepEqual(orderedNumbers, [1, 2, 3, 4, 5], "summary stays in input order despite out-of-order completion");
  const totals = metrics(batch.logs.at(-1));
  assert.equal(totals["Total attempted conversion time (summed)"], "0h 00m 09s");
  assert.equal(totals["Batch wall time (elapsed)"], "0h 00m 05s");
  assert.equal(totals["PDFs attempted"], "5");
  assert.equal(totals.Successful, "3");
  assert.equal(totals.Failed, "1");
  assert.equal(totals.Skipped, "2");
  assert.equal(totals["File sizes available (successful)"], "0/3");
  assert.equal(totals["Original PDFs (successful)"], "unavailable");
  assert.equal(totals["Successful PDFs using raster fallback"], "0");
  assert(batch.diagnostics.some((line) => line.endsWith("Raster fallback by PDF:\n  None in successful conversions.")));
  assert.equal(batch.logs.filter((line) => line === "Diagnostics log: /synthetic/diagnostics.log").length, 2);
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
  const diagnostics = batch.diagnostics.join("\n");
  const totals = metrics(summary);
  assert.match(summary, /Conversion summary:/);
  assert(!summary.includes("Warnings by PDF:"), "detailed warning recaps are kept in the log");
  assert(!summary.includes("synthetic encoding failure"), "detailed errors are kept in the log");
  assert.equal(totals["PDFs attempted"], "4");
  assert.equal(totals.Successful, "2");
  assert.equal(totals.Failed, "1");
  assert.equal(totals.Skipped, "2");
  assert.equal(totals["Original PDFs (successful)"], "9.00 KiB");
  assert.equal(totals["Generated HEPs (successful)"], "6.00 KiB");
  assert.equal(totals["Size change (successful)"], "-3.00 KiB (-33.33%)");
  assert.equal(totals["HEPs larger than original PDFs"], "1");
  assert.equal(totals.Warnings, "4 across 3 PDF(s)");
  assert.match(diagnostics, /worker-3.pdf: synthetic encoding failure/);
  assert.match(diagnostics, /\[HEP\] larger output \(2 times\)/);
  assert.match(diagnostics, /page 2: \[icc-fallback\] approximate colors/);
  assert(diagnostics.indexOf("worker-1.pdf:") < diagnostics.indexOf("worker-2.pdf:"), "warnings stay in input order");
  const timingSummary = batch.logs.find((line) => line.startsWith("Conversion time summary:"));
  assert.deepEqual(tableRows(timingSummary)[1], ["1/4", "worker-1.pdf", "generated", "0h 00m 00s", "1.00 KiB", "2.00 KiB", "+100.00%"]);
  assert(!timingSummary.includes("1.91 MiB"), "failed and skipped candidates are excluded from output sizes");
});

assert.match(formatPdfToHepSummary([
  { status: "generated", sourceBytes: 1024, outputBytes: 2048 }
], 0), /\+1.00 KiB \(\+100.00%\)/);
assert.match(formatPdfToHepSummary([
  { status: "generated", sourceBytes: 0, outputBytes: 0 }
], 0), /Generated HEPs \(successful\)\s*\| 0 B/);
assert(!formatPdfToHepSummary([{ status: "generated", sourceBytes: 0, outputBytes: 0 }], 0).includes("NaN"));

const timingCases = [
  { pdfPath: path.resolve("private/nested/smaller.pdf"), fileNumber: 1, fileCount: 5,
    status: "generated", durationMs: 100, sourceBytes: 1024, outputBytes: 512 },
  { pdfPath: path.resolve("private/nested/larger.pdf"), fileNumber: 2, fileCount: 5,
    status: "generated", durationMs: 600, sourceBytes: 1024, outputBytes: 2048 },
  { pdfPath: path.resolve("private/nested/failed.pdf"), fileNumber: 3, fileCount: 5,
    status: "failed", durationMs: 2500, sourceBytes: 1024, outputBytes: 4096 },
  { pdfPath: path.resolve("private/nested/skipped.pdf"), fileNumber: 4, fileCount: 5,
    status: "skipped", durationMs: 400, sourceBytes: 1024, outputBytes: 4096 },
  { pdfPath: path.resolve("private/nested/empty.pdf"), fileNumber: 5, fileCount: 5,
    status: "generated", durationMs: 900, sourceBytes: 0, outputBytes: 0 }
];
const timingTable = formatPdfToHepTimingSummary(timingCases);
const coloredTimingTable = formatPdfToHepTimingSummary(timingCases, { color: true });
assert(!timingTable.includes(path.resolve("private")), "the per-file table shows basenames only");
assert.equal(stripColor(coloredTimingTable), timingTable, "ANSI colors do not change table padding");
assert.match(coloredTimingTable, /\x1b\[32m-50\.00%\x1b\[0m/);
assert.match(coloredTimingTable, /\x1b\[31m\+100\.00%\x1b\[0m/);
assert(!timingTable.includes("\x1b["), "plain output is suitable for redirected terminals");
const fileRows = tableRows(timingTable).slice(1);
assert.deepEqual(fileRows[2].slice(4), ["1.00 KiB", "--", "--"], "failed output candidates have no comparable HEP size");
assert.deepEqual(fileRows[3].slice(4), ["1.00 KiB", "--", "--"], "skipped output candidates have no comparable HEP size");
assert.deepEqual(fileRows[4].slice(4), ["0 B", "0 B", "--"], "empty sources have no percentage denominator");
assert.equal(new Set(timingTable.split("\n").slice(1).map((line) => line.length)).size, 1,
  "the ASCII borders and rows remain aligned");

const oddTimes = metrics(formatPdfToHepSummary(timingCases.slice(0, 3), 0));
assert.equal(oddTimes["Total attempted conversion time (summed)"], "0h 00m 03s");
assert.equal(oddTimes["Average attempted PDF time"], "0h 00m 01s");
assert.equal(oddTimes["Median attempted PDF time"], "0h 00m 01s");
assert.equal(oddTimes["Fastest attempted PDF time"], "0h 00m 00s");
assert.equal(oddTimes["Slowest attempted PDF time"], "0h 00m 03s");
const evenTimes = metrics(formatPdfToHepSummary([100, 400, 600, 9100].map((durationMs) => ({
  status: "generated", durationMs
})), 0));
assert.equal(evenTimes["Average attempted PDF time"], "0h 00m 03s");
assert.equal(evenTimes["Median attempted PDF time"], "0h 00m 01s", "even medians average the middle durations before rounding");
assert.equal(metrics(formatPdfToHepSummary([
  { status: "generated", durationMs: 600 }, { status: "skipped", durationMs: 600 }
], 1))["Total attempted conversion time (summed)"], "0h 00m 01s", "sum milliseconds before rounding individual display times");
const emptyTimes = metrics(formatPdfToHepSummary([], 2));
assert.equal(emptyTimes["Average attempted PDF time"], "--");
assert.equal(emptyTimes["Median attempted PDF time"], "--");
assert.equal(emptyTimes.Skipped, "2");
assert(!formatPdfToHepSummary([], 0).includes("NaN"));
assert.match(formatPdfToHepDiagnosticsSummary([{ pdfPath: "failed.pdf", status: "failed", errorMessage: "broken" }]),
  /Failed PDFs:\n  failed.pdf: broken/);

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
  const summary = batch.diagnostics.find((line) => line.includes("Raster fallback by PDF:"));
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

await withBatch({ count: 1, diagnosticFailure: true, reports: {
  1: [{ type: "pdf-to-hep-warning", message: "warning retained after log failure" }]
} }, async (batch) => {
  await batch.finish(1);
  assert.equal(await batch.completion, 0, "log creation failure must not prevent a PDF conversion");
  const terminalOutput = [...batch.logs, ...batch.errors, ...batch.warnings].join("\n");
  assert.match(terminalOutput, /synthetic log creation failure/);
  assert.match(terminalOutput, /warning retained after log failure/);
  assert.equal(batch.diagnostics.length, 0);
});

for (const heapMb of [512, 8192, 12_288, 131_072]) {
  await withBatch({ count: 3, available: 32, memory: GiB, heapMb }, async (batch) => {
    assert.deepEqual(batch.started, [1, 2, 3], "low available memory does not limit automatic concurrency");
    for (let number = 1; number <= 3; number++) await batch.finish(number);
    assert.equal(await batch.completion, 0);
    assert.equal(batch.maximumActive, 3, "worker heap ceilings do not affect scheduling");
  });
}

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
  assert.equal(batch.warnings.length, 0, "cleanup warnings are logged without flooding the terminal");
  assert(batch.logs.includes("Finished: 2 generated, 1 skipped, 2 failed."));
  assert.equal(metrics(batch.logs.at(-1)).Warnings, "3 across 3 PDF(s)");
  assert.match(batch.diagnostics.join("\n"), /synthetic synchronous spawn failure/);
  assert.match(batch.diagnostics.join("\n"), /synthetic asynchronous spawn failure/);
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
    const totals = metrics(batch.logs.at(-1));
    assert.equal(totals["PDFs attempted"], "2");
    assert.equal(totals.Successful, "0");
    assert.equal(totals.Failed, "0");
    assert.equal(totals.Skipped, "1");
    assert.equal(totals.Interrupted, "2");
    assert.equal(totals["Not attempted"], "3");
    assert.equal(batch.logClosed, true, "cancellation flushes diagnostics before returning");
  });
  await withBatch({}, async (batch) => {
    await batch.finish(2, exitCode);
    assert.deepEqual(batch.signals, [[1, signal]], "a child interruption cancels its active siblings");
    assert.deepEqual(batch.started, [1, 2], "child interruption also stops dispatch");
    await batch.finish(1, null, signal);
    assert.equal(await batch.completion, exitCode);
  });
}

console.log("PDF-to-HEP worker pool: scheduling, failure isolation, timing tables/statistics, colors, diagnostics logging, cleanup, and cancellation passed.");
