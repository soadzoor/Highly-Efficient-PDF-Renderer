import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setImmediate as waitForImmediate } from "node:timers/promises";

import {
  assertUniqueHepOutputs,
  discoverPdfFiles,
  formatPdfToHepDuration,
  formatPdfToHepTimingSummary,
  hepOutputPathForPdf,
  loadSourceHepBuilder,
  parsePdfToHepArguments,
  pdfToHepWorkerArguments,
  resolvePdfToHepWorkerHeapMb,
  runPdfToHep,
  runPdfToHepWorkerBatch,
  sanitizeHepSourceName,
  startPdfToHepWorker,
  writeHepBlobAtomically
} from "../PDFtoHEP.js";

assert.deepEqual(parsePdfToHepArguments(["./Level1.pdf"]), {
  force: false,
  help: false,
  inputPath: "./Level1.pdf"
});
assert.deepEqual(parsePdfToHepArguments(["--force", "./pdfs"]), {
  force: true,
  help: false,
  inputPath: "./pdfs"
});
assert.deepEqual(parsePdfToHepArguments(["--", "-pdfs"]), {
  force: false,
  help: false,
  inputPath: "-pdfs"
});
assert.deepEqual(parsePdfToHepArguments(["--help"]), {
  force: false,
  help: true,
  inputPath: undefined
});
assert.throws(() => parsePdfToHepArguments([]), /Pass a PDF file or directory/);
assert.throws(() => parsePdfToHepArguments(["--unknown", "input"]), /Unknown option/);
assert.throws(() => parsePdfToHepArguments(["one", "two"]), /exactly one/);

assert.equal(sanitizeHepSourceName("Level 1.pdf"), "Level_1");
assert.equal(sanitizeHepSourceName("Mürrieta 楼.pdf"), "M_rrieta_");
assert.equal(sanitizeHepSourceName(".pdf"), "floorplan");

assert.equal(formatPdfToHepDuration(0), "0h 00m 00s");
assert.equal(formatPdfToHepDuration(499), "0h 00m 00s");
assert.equal(formatPdfToHepDuration(500), "0h 00m 01s");
assert.equal(formatPdfToHepDuration(59_500), "0h 01m 00s");
assert.equal(formatPdfToHepDuration(3_599_500), "1h 00m 00s");
assert.equal(formatPdfToHepDuration(90_123_000), "25h 02m 03s");
assert.equal(
  formatPdfToHepTimingSummary([]),
  "Conversion time summary: no PDF conversions were attempted."
);

assert.equal(resolvePdfToHepWorkerHeapMb([], {}), 12_288);
assert.equal(
  resolvePdfToHepWorkerHeapMb([], { HEPR_PDF_TO_HEP_HEAP_MB: "8192" }),
  8_192
);
assert.equal(
  resolvePdfToHepWorkerHeapMb(["--max-old-space-size=6144"], {}),
  6_144
);
assert.equal(
  resolvePdfToHepWorkerHeapMb(["--max_old_space_size", "7168"], {}),
  7_168
);
assert.equal(
  resolvePdfToHepWorkerHeapMb([
    "--max-old-space-size=4096",
    "--max_old_space_size",
    "9216"
  ], {}),
  9_216,
  "the final V8 heap flag must win just as it does in Node"
);
assert.throws(
  () => resolvePdfToHepWorkerHeapMb([], { HEPR_PDF_TO_HEP_HEAP_MB: "small" }),
  /must be an integer/
);

let sourceBuilderViteOptions;
let sourceBuilderCloseCount = 0;
const fakeBuildParsedDataZip = () => {};
const sourceBuilder = await loadSourceHepBuilder({
  async createServer(options) {
    sourceBuilderViteOptions = options;
    return {
      async ssrLoadModule(moduleId) {
        assert.equal(moduleId, "/src/parsedDataZipBuilder.ts");
        return { buildParsedDataZip: fakeBuildParsedDataZip };
      },
      async close() {
        sourceBuilderCloseCount += 1;
      }
    };
  }
});
assert.equal(
  sourceBuilderViteOptions.server.watch,
  null,
  "the one-shot builder must not watch generated HEP files under public/"
);
assert.equal(sourceBuilder.buildParsedDataZip, fakeBuildParsedDataZip);
await sourceBuilder.close();
assert.equal(sourceBuilderCloseCount, 1);

const unusualWorkerPdf = path.resolve("-Größe [A] & plan.pdf");
const workerArguments = pdfToHepWorkerArguments(unusualWorkerPdf, true, 8_192);
assert.equal(workerArguments[0], "--max-old-space-size=8192");
assert.ok(path.isAbsolute(workerArguments[1]));
assert.equal(workerArguments.at(-3), "--force");
assert.equal(workerArguments.at(-2), "--");
assert.equal(workerArguments.at(-1), unusualWorkerPdf);

let spawnInvocation;
class FakeChild extends EventEmitter {
  pid = 12345;
  exitCode = null;
  signalCode = null;

  kill() {
    return true;
  }
}
const fakeChild = new FakeChild();
const fakeWorker = startPdfToHepWorker(
  { pdfPath: unusualWorkerPdf, fileNumber: 2, fileCount: 5 },
  true,
  8_192,
  (command, args, options) => {
    spawnInvocation = { command, args, options };
    return fakeChild;
  }
);
assert.equal(spawnInvocation.command, process.execPath);
assert.deepEqual(spawnInvocation.args, workerArguments);
assert.equal(spawnInvocation.options.shell, false);
assert.equal(spawnInvocation.options.stdio, "inherit");
assert.equal(spawnInvocation.options.env.HEPR_PDF_TO_HEP_INTERNAL_WORKER, "1");
assert.equal(spawnInvocation.options.env.HEPR_PDF_TO_HEP_BATCH_INDEX, "2");
assert.equal(spawnInvocation.options.env.HEPR_PDF_TO_HEP_BATCH_TOTAL, "5");
assert.match(
  spawnInvocation.options.env.HEPR_PDF_TO_HEP_WORKER_TOKEN,
  /^[0-9a-f]{8}-[0-9a-f-]{27}$/i
);
fakeChild.emit("close", 0, null);
assert.deepEqual(await fakeWorker.completion, { code: 0, signal: null });

const failingChild = new FakeChild();
const failingWorker = startPdfToHepWorker(
  { pdfPath: unusualWorkerPdf, fileNumber: 1, fileCount: 1 },
  false,
  12_288,
  () => failingChild
);
const syntheticSpawnError = new Error("synthetic spawn failure");
failingChild.emit("error", syntheticSpawnError);
failingChild.emit("close", 1, null);
await assert.rejects(failingWorker.completion, (error) => error === syntheticSpawnError);

const batchItems = [1, 2, 3].map((fileNumber) => ({
  pdfPath: path.resolve(`batch-${fileNumber}.pdf`),
  outputPath: path.resolve(`batch-${fileNumber}-parsed-data.hep`),
  fileNumber,
  fileCount: 3
}));
const batchChildren = [];
const batchCleanupCalls = [];
const batchSignalTarget = new EventEmitter();
const batchLog = [];
const batchError = [];
const originalConsoleLogForBatch = console.log;
const originalConsoleErrorForBatch = console.error;
let batchNow = 0;
let batchResult;
try {
  console.log = (message) => batchLog.push(String(message));
  console.error = (message) => batchError.push(String(message));
  const batchPromise = runPdfToHepWorkerBatch(
    batchItems,
    { force: false },
    2,
    {
      heapMb: 8_192,
      signalTarget: batchSignalTarget,
      now: () => batchNow,
      startWorker(item, force, heapMb) {
        assert.equal(item, batchItems[batchChildren.length]);
        assert.equal(force, false);
        assert.equal(heapMb, 8_192);
        const child = new FakeChild();
        child.pid = 20_000 + batchChildren.length;
        batchChildren.push(child);
        return startPdfToHepWorker(item, force, heapMb, () => child);
      },
      async cleanupWorkerTemps(...args) {
        batchCleanupCalls.push(args);
      }
    }
  );

  await waitForImmediate();
  assert.equal(batchChildren.length, 1, "only one PDF worker may run at a time");
  batchNow = 1_000;
  batchChildren[0].emit("close", 0, null);
  await waitForImmediate();
  assert.equal(batchChildren.length, 2);
  batchNow = 3_500;
  batchChildren[1].emit("close", 1, null);
  await waitForImmediate();
  assert.equal(batchChildren.length, 3, "a failed PDF must not abort the folder batch");
  batchNow = 7_200;
  batchChildren[2].emit("close", 3, null);
  batchResult = await batchPromise;
} finally {
  console.log = originalConsoleLogForBatch;
  console.error = originalConsoleErrorForBatch;
}
assert.equal(batchResult, 1);
assert.equal(batchCleanupCalls.length, 3);
assert.ok(batchCleanupCalls.every(([, pid, token]) =>
  Number.isSafeInteger(pid) && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(token)
));
assert.ok(batchError.some((message) =>
  message.includes("after 0h 00m 03s") && message.includes("Continuing with the next PDF")
));
assert.deepEqual(batchLog, [
  `[1/3] Converted ${batchItems[0].pdfPath} in 0h 00m 01s`,
  `[3/3] Skipped ${batchItems[2].pdfPath} after 0h 00m 04s`,
  "Finished: 1 generated, 3 skipped, 1 failed.",
  [
    "Conversion time summary:",
    `  [1/3] ${batchItems[0].pdfPath}: 0h 00m 01s (generated)`,
    `  [2/3] ${batchItems[1].pdfPath}: 0h 00m 03s (failed)`,
    `  [3/3] ${batchItems[2].pdfPath}: 0h 00m 04s (skipped)`,
    "  Total attempted conversion time: 0h 00m 07s"
  ].join("\n")
]);
assert.equal(batchSignalTarget.listenerCount("SIGINT"), 0);
assert.equal(batchSignalTarget.listenerCount("SIGTERM"), 0);

const interruptSignalTarget = new EventEmitter();
const interruptChildren = [];
const forwardedSignals = [];
const interruptLog = [];
let interruptNow = 0;
let interruptResult;
const originalConsoleErrorForInterrupt = console.error;
const originalConsoleLogForInterrupt = console.log;
try {
  console.error = () => {};
  console.log = (message) => interruptLog.push(String(message));
  const interruptPromise = runPdfToHepWorkerBatch(
    batchItems,
    { force: true },
    0,
    {
      heapMb: 8_192,
      signalTarget: interruptSignalTarget,
      now: () => interruptNow,
      cleanupWorkerTemps: async () => {},
      startWorker(item, force, heapMb) {
        const child = new FakeChild();
        child.pid = 30_000 + interruptChildren.length;
        child.kill = (signal) => {
          forwardedSignals.push(signal);
          return true;
        };
        interruptChildren.push(child);
        return startPdfToHepWorker(item, force, heapMb, () => child);
      }
    }
  );
  await waitForImmediate();
  interruptSignalTarget.emit("SIGINT");
  interruptSignalTarget.emit("SIGINT");
  assert.deepEqual(forwardedSignals, ["SIGINT", "SIGKILL"]);
  interruptNow = 5_000;
  interruptChildren[0].emit("close", null, "SIGKILL");
  interruptResult = await interruptPromise;
} finally {
  console.error = originalConsoleErrorForInterrupt;
  console.log = originalConsoleLogForInterrupt;
}
assert.equal(interruptResult, 130);
assert.deepEqual(interruptLog, [[
  "Conversion time summary:",
  `  [1/3] ${batchItems[0].pdfPath}: 0h 00m 05s (interrupted)`,
  "  Total attempted conversion time: 0h 00m 05s"
].join("\n")]);
assert.equal(interruptChildren.length, 1, "interruption must prevent later workers from starting");
assert.equal(interruptSignalTarget.listenerCount("SIGINT"), 0);
assert.equal(interruptSignalTarget.listenerCount("SIGTERM"), 0);

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hepr-pdf-to-hep-cli-"));
try {
  const emptyDirectory = path.join(temporaryRoot, "empty");
  const nestedDirectory = path.join(temporaryRoot, "nested folder");
  await mkdir(emptyDirectory);
  await mkdir(nestedDirectory);
  const topPdf = path.join(temporaryRoot, "Level 1.pdf");
  const nestedPdf = path.join(nestedDirectory, "Plan.PDF");
  await Promise.all([
    writeFile(topPdf, "%PDF-test-only"),
    writeFile(nestedPdf, "%PDF-test-only"),
    writeFile(path.join(temporaryRoot, "ignore.txt"), "not a PDF")
  ]);

  try {
    await symlink(nestedDirectory, path.join(temporaryRoot, "nested-link"), "dir");
  } catch (error) {
    if (error?.code !== "EPERM" && error?.code !== "EACCES") {
      throw error;
    }
  }

  assert.deepEqual(await discoverPdfFiles(temporaryRoot), [topPdf, nestedPdf]);
  assert.deepEqual(await discoverPdfFiles(topPdf), [topPdf]);
  await assert.rejects(
    discoverPdfFiles(path.join(temporaryRoot, "ignore.txt")),
    /not a PDF/
  );
  await assert.rejects(discoverPdfFiles(emptyDirectory), /No PDF files found/);
  await assert.rejects(
    discoverPdfFiles(path.join(temporaryRoot, "missing")),
    /Input does not exist/
  );
  assert.equal(
    hepOutputPathForPdf(topPdf),
    path.join(temporaryRoot, "Level_1-parsed-data.hep")
  );
  assert.doesNotThrow(() => assertUniqueHepOutputs([topPdf, nestedPdf]));

  const existingHepPath = hepOutputPathForPdf(topPdf);
  await writeFile(existingHepPath, "existing HEP sentinel");
  const originalConsoleLog = console.log;
  const existingSkipLog = [];
  try {
    console.log = (message) => existingSkipLog.push(String(message));
    assert.equal(await runPdfToHep([topPdf]), 0);
  } finally {
    console.log = originalConsoleLog;
  }
  assert.deepEqual(existingSkipLog, [
    `Skipping existing ${existingHepPath}`,
    "No files generated; 1 existing HEP file(s) skipped.",
    "Conversion time summary: no PDF conversions were attempted."
  ]);
  assert.equal(await readFile(existingHepPath, "utf8"), "existing HEP sentinel");

  const previousWorkerFlag = process.env.HEPR_PDF_TO_HEP_INTERNAL_WORKER;
  try {
    process.env.HEPR_PDF_TO_HEP_INTERNAL_WORKER = "1";
    console.log = () => {};
    assert.equal(
      await runPdfToHep([topPdf]),
      3,
      "an internal worker must report a discovery-time skip to its parent"
    );
  } finally {
    console.log = originalConsoleLog;
    if (previousWorkerFlag === undefined) {
      delete process.env.HEPR_PDF_TO_HEP_INTERNAL_WORKER;
    } else {
      process.env.HEPR_PDF_TO_HEP_INTERNAL_WORKER = previousWorkerFlag;
    }
  }

  const collisionA = path.join(temporaryRoot, "A B.pdf");
  const collisionB = path.join(temporaryRoot, "A_B.PDF");
  assert.throws(
    () => assertUniqueHepOutputs([collisionA, collisionB]),
    /PDF output collision/
  );

  const atomicOutput = path.join(temporaryRoot, "atomic.hep");
  await writeHepBlobAtomically(atomicOutput, new Blob(["first"]), false);
  assert.equal(await readFile(atomicOutput, "utf8"), "first");
  await assert.rejects(
    writeHepBlobAtomically(atomicOutput, new Blob(["must-not-replace"]), false),
    /Output already exists/
  );
  assert.equal(await readFile(atomicOutput, "utf8"), "first");

  const brokenBlob = {
    stream() {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("partial"));
          controller.error(new Error("synthetic stream failure"));
        }
      });
    }
  };
  await assert.rejects(
    writeHepBlobAtomically(atomicOutput, brokenBlob, true),
    /synthetic stream failure/
  );
  assert.equal(await readFile(atomicOutput, "utf8"), "first");

  await writeHepBlobAtomically(atomicOutput, new Blob(["replacement"]), true);
  assert.equal(await readFile(atomicOutput, "utf8"), "replacement");

  const abortedOutput = path.join(temporaryRoot, "aborted.hep");
  const aborted = new AbortController();
  aborted.abort(new DOMException("synthetic abort", "AbortError"));
  await assert.rejects(
    writeHepBlobAtomically(abortedOutput, new Blob(["aborted"]), false, aborted.signal),
    (error) => error?.name === "AbortError"
  );
  await assert.rejects(readFile(abortedOutput), (error) => error?.code === "ENOENT");

  const concurrentOutput = path.join(temporaryRoot, "concurrent.hep");
  const concurrentResults = await Promise.allSettled([
    writeHepBlobAtomically(concurrentOutput, new Blob(["left"]), false),
    writeHepBlobAtomically(concurrentOutput, new Blob(["right"]), false)
  ]);
  assert.equal(concurrentResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrentResults.filter((result) => result.status === "rejected").length, 1);
  assert.ok(["left", "right"].includes(await readFile(concurrentOutput, "utf8")));
  assert.deepEqual(
    (await readdir(temporaryRoot)).filter((name) => name.startsWith(".hepr-")),
    [],
    "atomic writes must not leave temporary files behind"
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log(
  "PDF-to-HEP CLI argument, timing, source-loader, filesystem, and atomic-write tests passed."
);
