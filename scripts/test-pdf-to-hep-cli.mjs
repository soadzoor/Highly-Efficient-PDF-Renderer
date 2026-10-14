import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { link, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setImmediate as waitForImmediate } from "node:timers/promises";

import {
  assertSupportedNodeVersion,
  assertUniqueHepOutputs,
  createPdfToHepDiagnosticLog,
  discoverPdfFiles,
  formatPdfToHepDuration,
  formatPdfToHepSummary,
  formatPdfToHepTimingSummary,
  hepDiffersOnlyInGeneratedAt,
  hepOutputPathForPdf,
  loadSourceHepBuilder,
  markDuplicatePdfs,
  parsePdfToHepArguments,
  pdfToHepWorkerAllocatorEnvironment,
  pdfToHepWorkerArguments,
  resolvePdfToHepWorkerHeapMb,
  runPdfToHep,
  runPdfToHepWorkerBatch,
  sanitizeHepSourceName,
  startPdfToHepWorker,
  writeHepBlobAtomically
} from "../PDFtoHEP.js";
import { HepArchive } from "./lib/hepContainer.mjs";

for (const version of ["20.19.0", "22.13.0", "22.14.0", "23.0.0", "23.4.0"]) {
  assert.throws(() => assertSupportedNodeVersion(version), /Node.js 22\.15\+/);
}
for (const version of ["22.15.0", "22.20.0", "23.5.0", "24.0.0", "26.0.0"]) {
  assert.doesNotThrow(() => assertSupportedNodeVersion(version));
}

assert.deepEqual(parsePdfToHepArguments(["./Level1.pdf"]), {
  force: false,
  help: false,
  withVectorLod: true,
  withTextLod: true,
  inputPath: "./Level1.pdf"
});
assert.deepEqual(parsePdfToHepArguments(["--force", "./pdfs"]), {
  force: true,
  help: false,
  withVectorLod: true,
  withTextLod: true,
  inputPath: "./pdfs"
});
assert.deepEqual(parsePdfToHepArguments(["--", "-pdfs"]), {
  force: false,
  help: false,
  withVectorLod: true,
  withTextLod: true,
  inputPath: "-pdfs"
});
assert.deepEqual(parsePdfToHepArguments(["--help"]), {
  force: false,
  help: true,
  withVectorLod: true,
  withTextLod: true,
  inputPath: undefined
});
assert.throws(() => parsePdfToHepArguments([]), /Pass a PDF file or directory/);
assert.throws(() => parsePdfToHepArguments(["--unknown", "input"]), /Unknown option/);
assert.throws(() => parsePdfToHepArguments(["one", "two"]), /exactly one/);
assert.equal(parsePdfToHepArguments(["--output=hep", "plan.pdf"]).output, "hep");
for (const output of ["thumbnail", "both"]) {
  assert.deepEqual(parsePdfToHepArguments([`--output=${output}`, "plan.pdf"]), {
    force: false, help: false, inputPath: "plan.pdf", withVectorLod: true, withTextLod: true,
    output, thumbnailPage: 1, thumbnailMaxDimension: 400, thumbnailFormat: "webp", thumbnailBackground: "#ffffff"
  }, "thumbnail modes expose defaults without changing canonical HEP LOD defaults");
}
assert.deepEqual(parsePdfToHepArguments(["plan.pdf", "--thumbnail-background=transparent", "--thumbnail-format=png",
  "--thumbnail-max-dimension=160", "--thumbnail-page=2", "--output=both"]), {
  force: false, help: false, inputPath: "plan.pdf", withVectorLod: true, withTextLod: true,
  output: "both", thumbnailPage: 2, thumbnailMaxDimension: 160, thumbnailFormat: "png", thumbnailBackground: "transparent"
}, "mode flags may follow thumbnail settings and the input path");
for (const value of ["", "HEP", "image", "all"]) {
  assert.throws(() => parsePdfToHepArguments([`--output=${value}`, "plan.pdf"]), /--output=/);
}
assert.throws(() => parsePdfToHepArguments(["--output=hep", "--output=both", "plan.pdf"]), /exactly one/);
for (const flag of ["thumbnail-page", "thumbnail-max-dimension"]) {
  for (const value of ["", "0", "-1", "1.5", "NaN", "Infinity", "2e3", " 2", "9007199254740992"]) {
    assert.throws(() => parsePdfToHepArguments(["--output=thumbnail", `--${flag}=${value}`, "plan.pdf"]), /positive integer/);
  }
  assert.throws(() => parsePdfToHepArguments(["--output=both", `--${flag}=1`, `--${flag}=2`, "plan.pdf"]), /exactly one/);
}
for (const value of ["", "jpeg", "WEBP"]) {
  assert.throws(() => parsePdfToHepArguments(["--output=thumbnail", `--thumbnail-format=${value}`, "plan.pdf"]), /thumbnail-format/);
}
assert.throws(() => parsePdfToHepArguments(["--output=thumbnail", "--thumbnail-format=png", "--thumbnail-format=webp", "plan.pdf"]), /exactly one/);
for (const value of ["", " "]) {
  assert.throws(() => parsePdfToHepArguments(["--output=thumbnail", `--thumbnail-background=${value}`, "plan.pdf"]), /non-empty/);
}
assert.throws(() => parsePdfToHepArguments(["--output=thumbnail", "--thumbnail-background=red", "--thumbnail-background=blue", "plan.pdf"]), /exactly one/);
for (const flag of ["--thumbnail-page=1", "--thumbnail-max-dimension=400", "--thumbnail-format=webp", "--thumbnail-background=#fff"]) {
  for (const output of [[], ["--output=hep"]]) {
    assert.throws(() => parsePdfToHepArguments([...output, flag, "plan.pdf"]), /Thumbnail options require/,
      "HEP-only invocations must not silently ignore thumbnail options");
  }
}
assert.throws(() => parsePdfToHepArguments(["--output=thumbnail", "--force", "--keep-unchanged", "plan.pdf"]), /requires HEP output/);
assert.equal(parsePdfToHepArguments(["--output=both", "--force", "--keep-unchanged", "plan.pdf"]).keepUnchanged, true);
assert.deepEqual(parsePdfToHepArguments(["--output-dir=./heps", "./pdfs"]), {
  force: false,
  help: false,
  withVectorLod: true,
  withTextLod: true,
  inputPath: "./pdfs",
  outputDirectory: path.resolve("./heps")
});
assert.throws(() => parsePdfToHepArguments(["--output-dir=", "input"]), /non-empty/);
assert.throws(
  () => parsePdfToHepArguments(["--output-dir=one", "--output-dir=two", "input"]),
  /exactly one/
);
assert.equal(parsePdfToHepArguments(["--log-file=./logs/conversion.log", "./pdfs"]).logFile,
  path.resolve("./logs/conversion.log"));
assert.throws(() => parsePdfToHepArguments(["--log-file=", "input"]), /non-empty/);
assert.throws(() => parsePdfToHepArguments(["--log-file=one", "--log-file=two", "input"]), /exactly one/);

assert.deepEqual(parsePdfToHepArguments(["--force", "--keep-unchanged", "./pdfs"]), {
  force: true,
  keepUnchanged: true,
  help: false,
  withVectorLod: true,
  withTextLod: true,
  inputPath: "./pdfs"
});
assert.throws(
  () => parsePdfToHepArguments(["--keep-unchanged", "./pdfs"]),
  /only applies together with --force/,
  "without --force existing HEPs are skipped, so the flag would silently do nothing"
);
assert.equal(
  parsePdfToHepArguments(pdfToHepWorkerArguments("plan.pdf", true, 8192, undefined, undefined, undefined, true).slice(2))
    .keepUnchanged,
  true,
  "batch workers receive the parent's --keep-unchanged"
);

for (const [withVectorLod, withTextLod] of [[true, true], [false, true], [true, false], [false, false]]) {
  const flags = [
    ...(withVectorLod ? [] : ["--without-vector-lod"]),
    ...(withTextLod ? [] : ["--without-text-lod"])
  ];
  assert.deepEqual(parsePdfToHepArguments([...flags, "plan.pdf"]), {
    force: false, help: false, inputPath: "plan.pdf", withVectorLod, withTextLod
  }, "every CLI combination keeps both LOD booleans explicit");
}
for (const flag of ["--with-vector-lod", "--with-text-lod"]) {
  assert.throws(() => parsePdfToHepArguments([flag, "plan.pdf"]), /Unknown option/,
    "former opt-in flags are no longer accepted");
}
for (const withVectorLod of [undefined, true, false]) {
  for (const withTextLod of [undefined, true, false]) {
    const args = pdfToHepWorkerArguments("plan.pdf", false, 8192,
      undefined, undefined, undefined, undefined, withVectorLod, withTextLod);
    assert.equal(args.includes("--without-vector-lod"), withVectorLod === false);
    assert.equal(args.includes("--without-text-lod"), withTextLod === false);
    assert.deepEqual(parsePdfToHepArguments(args.slice(2)), {
      force: false, help: false, inputPath: "plan.pdf",
      withVectorLod: withVectorLod !== false, withTextLod: withTextLod !== false
    }, "workers preserve explicit opt-outs and default omitted LOD settings to enabled");
  }
}

for (const policy of ["error", "alternate"]) {
  assert.throws(() => parsePdfToHepArguments([`--icc-fallback=${policy}`, "plan.pdf"]), /Unknown option/);
}

for (const engine of ["qcms", "lcms", "alternate", "none"]) {
  assert.equal(parsePdfToHepArguments([`--icc-engine=${engine}`, "plan.pdf"]).iccEngine, engine);
  const args = pdfToHepWorkerArguments("plan.pdf", false, 8192, undefined, engine);
  const options = parsePdfToHepArguments(args.slice(2));
  assert.equal(options.iccEngine, engine);
}
assert.throws(() => parsePdfToHepArguments(["--icc-engine=typo", "plan.pdf"]), /icc-engine/);
assert.throws(() => parsePdfToHepArguments(["--icc-engine=qcms", "--icc-engine=none", "plan.pdf"]), /exactly one/);

for (const mode of ["render", "forms", "none"]) {
  assert.equal(parsePdfToHepArguments([`--annotation-appearances=${mode}`, "plan.pdf"]).annotationAppearances, mode);
  const args = pdfToHepWorkerArguments("plan.pdf", false, 8192, undefined, "lcms", mode);
  const options = parsePdfToHepArguments(args.slice(2));
  assert.equal(options.annotationAppearances, mode, "batch workers receive the parent's appearance mode");
  assert.equal(options.iccEngine, "lcms");
}
assert.equal(parsePdfToHepArguments(["plan.pdf"]).annotationAppearances, undefined);

assert.equal(parsePdfToHepArguments(["--password=s3cr3t pass", "plan.pdf"]).password, "s3cr3t pass");
assert.equal("password" in parsePdfToHepArguments(["plan.pdf"]), false);
assert.throws(() => parsePdfToHepArguments(["--password=", "plan.pdf"]), /non-empty --password/);
assert.throws(() => parsePdfToHepArguments(["--password=a", "--password=b", "plan.pdf"]), /exactly one/);
assert.throws(() => parsePdfToHepArguments(["--annotation-appearances=hidden", "plan.pdf"]), /annotation-appearances/);
assert.throws(
  () => parsePdfToHepArguments(["--annotation-appearances=none", "--annotation-appearances=forms", "plan.pdf"]),
  /exactly one/
);

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
const fakeBuildHep = () => {};
const fakeHepArchive = { loadAsync() {} };
const sourceBuilder = await loadSourceHepBuilder({
  async createServer(options) {
    sourceBuilderViteOptions = options;
    return {
      async ssrLoadModule(moduleId) {
        if (moduleId === "/src/hepContainer.ts") return { HepArchive: fakeHepArchive };
        assert.equal(moduleId, "/src/hepBuilder.ts");
        return { buildHep: fakeBuildHep };
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
assert.equal(sourceBuilder.buildHep, fakeBuildHep);
assert.equal(sourceBuilder.HepArchive, fakeHepArchive);
await sourceBuilder.close();
assert.equal(sourceBuilderCloseCount, 1);

async function encodeTestHep(generatedAt, {
  sceneByte = 7,
  extraSection = false,
  sourcePdfByteLength = 1234,
  compression = "DEFLATE"
} = {}) {
  const archive = new HepArchive();
  archive.file("manifest.json", JSON.stringify({ formatVersion: 9, sourcePdfByteLength, generatedAt, scene: { pages: [1, 2] } }));
  archive.file("scene/positions.bin", new Uint8Array(20_000).fill(sceneByte));
  archive.file("text/small.json", "{\"glyphs\":[]}");
  archive.file("empty.bin", new Uint8Array(0));
  if (extraSection) archive.file("structure/structure.json", "{}");
  return archive.generateAsync({ type: "uint8array", compression });
}
const existingTestHep = await encodeTestHep("2026-09-29T15:45:20.289Z");
assert.equal(await hepDiffersOnlyInGeneratedAt(existingTestHep, existingTestHep, HepArchive), true,
  "--keep-unchanged retains identical HEP data without applying a source-PDF size limit");
assert.equal(
  await hepDiffersOnlyInGeneratedAt(existingTestHep, await encodeTestHep("2026-09-30T11:19:41.033Z"), HepArchive),
  true,
  "a rebuild that only changes generatedAt must keep the existing HEP"
);
for (const [label, existing, candidate] of [
  ["same-length section content", existingTestHep, await encodeTestHep("2026-09-30T11:19:41.033Z", { sceneByte: 8 })],
  ["an added section", existingTestHep, await encodeTestHep("2026-09-30T11:19:41.033Z", { extraSection: true })],
  ["other manifest fields", existingTestHep, await encodeTestHep("2026-09-30T11:19:41.033Z", { sourcePdfByteLength: 1235 })],
  // An older writer's encoding of the same sections must still be replaced.
  ["container encoding", await encodeTestHep("2026-09-29T15:45:20.289Z", { compression: "STORE" }),
    await encodeTestHep("2026-09-30T11:19:41.033Z")]
]) {
  assert.equal(
    await hepDiffersOnlyInGeneratedAt(existing, candidate, HepArchive),
    false,
    `a rebuild that changes ${label} must replace the existing HEP`
  );
}

const unusualWorkerPdf = path.resolve("-Größe [A] & plan.pdf");
const workerArguments = pdfToHepWorkerArguments(unusualWorkerPdf, true, 8_192);
assert.equal(workerArguments[0], "--max-old-space-size=8192");
assert.ok(path.isAbsolute(workerArguments[1]));
assert.equal(workerArguments.at(-3), "--force");
assert.equal(workerArguments.at(-2), "--");
assert.equal(workerArguments.at(-1), unusualWorkerPdf);
const workerOutputDirectory = path.resolve("heps with spaces");
const redirectedWorkerArguments = pdfToHepWorkerArguments(unusualWorkerPdf, true, 8_192, workerOutputDirectory, "qcms");
assert.equal(
  parsePdfToHepArguments(redirectedWorkerArguments.slice(2)).outputDirectory,
  workerOutputDirectory,
  "worker arguments must preserve the output directory"
);

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
  { pdfPath: unusualWorkerPdf, fileNumber: 2, fileCount: 5, outputDirectory: workerOutputDirectory, iccEngine: "qcms" },
  true,
  8_192,
  (command, args, options) => {
    spawnInvocation = { command, args, options };
    return fakeChild;
  }
);
assert.equal(spawnInvocation.command, process.execPath);
assert.deepEqual(spawnInvocation.args, redirectedWorkerArguments);
assert.equal(spawnInvocation.options.shell, false);
assert.deepEqual(spawnInvocation.options.stdio, ["inherit", "inherit", "inherit", "ipc"]);
assert.equal(spawnInvocation.options.env.HEPR_PDF_TO_HEP_INTERNAL_WORKER, "1");
assert.deepEqual(pdfToHepWorkerAllocatorEnvironment("darwin"), { MallocLargeCache: "0" });
assert.deepEqual(pdfToHepWorkerAllocatorEnvironment("linux"), {}, "other platforms keep their allocator defaults");
assert.equal(spawnInvocation.options.env.MallocLargeCache, process.env.MallocLargeCache ?? (process.platform === "darwin" ? "0" : undefined),
  "macOS workers release freed large encoder buffers unless the caller configured malloc");
assert.equal(spawnInvocation.options.env.HEPR_PDF_TO_HEP_BATCH_INDEX, "2");
assert.equal(spawnInvocation.options.env.HEPR_PDF_TO_HEP_BATCH_TOTAL, "5");
assert.match(
  spawnInvocation.options.env.HEPR_PDF_TO_HEP_WORKER_TOKEN,
  /^[0-9a-f]{8}-[0-9a-f-]{27}$/i
);
assert.equal(spawnInvocation.options.env.HEPR_PDF_PASSWORD, process.env.HEPR_PDF_PASSWORD);
fakeChild.emit("close", 0, null);
assert.deepEqual(await fakeWorker.completion, { code: 0, signal: null });

// A password reaches the worker through its environment, never its argv.
let passwordInvocation;
const passwordChild = new FakeChild();
const passwordWorker = startPdfToHepWorker(
  { pdfPath: unusualWorkerPdf, fileNumber: 1, fileCount: 1, password: "s3cr3t" },
  false,
  8_192,
  (command, args, options) => {
    passwordInvocation = { command, args, options };
    return passwordChild;
  }
);
assert.equal(passwordInvocation.options.env.HEPR_PDF_PASSWORD, "s3cr3t");
assert.equal(passwordInvocation.args.some((argument) => argument.includes("s3cr3t")), false);
passwordChild.emit("close", 0, null);
await passwordWorker.completion;

let thumbnailInvocation;
const thumbnailChild = new FakeChild();
const thumbnailWorker = startPdfToHepWorker({
  pdfPath: unusualWorkerPdf, fileNumber: 1, fileCount: 1,
  output: "both", thumbnailPage: 3, thumbnailMaxDimension: 160,
  thumbnailFormat: "png", thumbnailBackground: " lightblue "
}, false, 8_192, (command, args) => {
  thumbnailInvocation = { command, args };
  return thumbnailChild;
}, path.resolve("bin/pdf-to-hep.js"));
assert.equal(thumbnailInvocation.args[1], path.resolve("bin/pdf-to-hep.js"), "the existing worker entry parameter retains its position");
assert.deepEqual(parsePdfToHepArguments(thumbnailInvocation.args.slice(2)), {
  force: false, help: false, inputPath: unusualWorkerPdf, withVectorLod: true, withTextLod: true,
  output: "both", thumbnailPage: 3, thumbnailMaxDimension: 160, thumbnailFormat: "png", thumbnailBackground: " lightblue "
}, "worker forwarding preserves thumbnail mode, sizing, encoding and color strings");
thumbnailChild.emit("close", 0, null);
await thumbnailWorker.completion;

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
const batchDiagnostics = [];
let batchLogClosed = false;
const batchDiagnosticLog = {
  path: "/synthetic/batch-diagnostics.log", fd: 99,
  write: (message) => batchDiagnostics.push(String(message)),
  async close() { batchLogClosed = true; }
};
const originalConsoleLogForBatch = console.log;
const originalConsoleErrorForBatch = console.error;
let batchNow = 0;
let batchResult;
try {
  console.log = (message) => batchLog.push(String(message));
  console.error = (message) => batchError.push(String(message));
  const batchPromise = runPdfToHepWorkerBatch(
    batchItems,
    { force: false, workers: 1 },
    2,
    {
      heapMb: 8_192,
      signalTarget: batchSignalTarget,
      now: () => batchNow,
      createDiagnosticLog: async () => batchDiagnosticLog,
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
assert.equal(batchLogClosed, true);
assert.match(batchDiagnostics.join("\n"), /batch-2.pdf: exit code 1/);
const expectedBatchTimings = [
  { ...batchItems[0], status: "generated", durationMs: 1000 },
  { ...batchItems[1], status: "failed", durationMs: 2500, errorMessage: "exit code 1" },
  { ...batchItems[2], status: "skipped", durationMs: 3700 }
];
assert.deepEqual(batchLog, [
  "Diagnostics log: /synthetic/batch-diagnostics.log",
  "Converting 3 PDF(s) with up to 1 worker(s).",
  "[1/3] Converted batch-1.pdf in 0h 00m 01s",
  "[3/3] Skipped batch-3.pdf after 0h 00m 04s",
  "Finished: 1 generated, 3 skipped, 1 failed.",
  formatPdfToHepTimingSummary(expectedBatchTimings),
  "Diagnostics log: /synthetic/batch-diagnostics.log",
  formatPdfToHepSummary(expectedBatchTimings, 3, 0, { wallTimeMs: 7200 })
]);
assert.equal(batchSignalTarget.listenerCount("SIGINT"), 0);
assert.equal(batchSignalTarget.listenerCount("SIGTERM"), 0);

const interruptSignalTarget = new EventEmitter();
const interruptChildren = [];
const forwardedSignals = [];
const interruptLog = [];
const interruptDiagnostics = [];
let interruptLogClosed = false;
let interruptNow = 0;
let interruptResult;
const originalConsoleErrorForInterrupt = console.error;
const originalConsoleLogForInterrupt = console.log;
try {
  console.error = () => {};
  console.log = (message) => interruptLog.push(String(message));
  const interruptPromise = runPdfToHepWorkerBatch(
    batchItems,
    { force: true, workers: 1 },
    0,
    {
      heapMb: 8_192,
      signalTarget: interruptSignalTarget,
      now: () => interruptNow,
      createDiagnosticLog: async () => ({
        path: "/synthetic/interrupt-diagnostics.log", fd: 99,
        write: (message) => interruptDiagnostics.push(String(message)),
        async close() { await waitForImmediate(); interruptLogClosed = true; }
      }),
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
const expectedInterruptTimings = [{ ...batchItems[0], status: "interrupted", durationMs: 5000 }];
assert.deepEqual(interruptLog, [
  "Diagnostics log: /synthetic/interrupt-diagnostics.log",
  "Converting 3 PDF(s) with up to 1 worker(s).",
  formatPdfToHepTimingSummary(expectedInterruptTimings),
  "Diagnostics log: /synthetic/interrupt-diagnostics.log",
  formatPdfToHepSummary(expectedInterruptTimings, 0, 2, { wallTimeMs: 5000 })
]);
assert.equal(interruptLogClosed, true, "interruption waits for pending log writes");
assert.match(interruptDiagnostics.join("\n"), /interrupted/);
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
  await assert.rejects(runPdfToHep([`--log-file=${existingHepPath}`, temporaryRoot]), /PDF|HEP|input|output|overwrite/i,
    "the log destination is validated against skipped HEPs before any pending worker starts");
  assert.equal(await readFile(existingHepPath, "utf8"), "existing HEP sentinel");
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
    "Conversion time summary: no PDF conversions were attempted.",
    formatPdfToHepSummary([], 1)
  ]);
  assert.equal(await readFile(existingHepPath, "utf8"), "existing HEP sentinel");

  const outputDirectory = path.join(temporaryRoot, "heps");
  await mkdir(outputDirectory);
  const redirectedHepPath = hepOutputPathForPdf(topPdf, outputDirectory);
  assert.equal(redirectedHepPath, path.join(outputDirectory, "Level_1-parsed-data.hep"));
  await writeFile(redirectedHepPath, "redirected HEP sentinel");
  try {
    console.log = () => {};
    assert.equal(await runPdfToHep([`--output-dir=${outputDirectory}`, topPdf]), 0);
  } finally {
    console.log = originalConsoleLog;
  }
  assert.equal(await readFile(redirectedHepPath, "utf8"), "redirected HEP sentinel");
  assert.throws(
    () => assertUniqueHepOutputs([topPdf, path.join(nestedDirectory, "Level 1.pdf")], outputDirectory),
    /PDF output collision/,
    "flattened output directories must reject collisions across input folders"
  );

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

  // Exercise the worker's reporting without a parser, canvas, or source loader.
  // The builder returns a synthetic archive; no PDF conversion is performed.
  const reportPdf = path.join(temporaryRoot, "report.pdf");
  const reportOutput = hepOutputPathForPdf(reportPdf);
  await writeFile(reportPdf, "%PDF-test-only");
  const reports = [];
  const originalConsoleForReports = { log: console.log, error: console.error, warn: console.warn };
  const liveWarnings = [];
  let canvasChecks = 0;
  let reportingGeneratedAt = "2026-10-01T11:19:41.033Z";
  const defaultReportingDiagnostics = [
    { severity: "info", code: "info-only", message: "ignore" },
    { severity: "warning", code: "icc-fallback", pageIndex: 1, message: "approximate colors" }
  ];
  let reportingDiagnostics = defaultReportingDiagnostics;
  const reportingDependencies = {
    assertCanvasAvailable: async () => { canvasChecks += 1; },
    reportWorkerEvent: (event) => reports.push(event),
    async loadBuilder() {
      console.warn("%s warning", "loader");
      return {
        HepArchive,
        async buildHep(bytes, options) {
          assert.equal(bytes.byteLength, 14);
          console.warn("[HEP] synthetic size warning");
          for (const diagnostic of reportingDiagnostics) options.onDiagnostic(diagnostic);
          return new Blob([await encodeTestHep(reportingGeneratedAt)]);
        },
        async close() { console.warn("cleanup warning"); }
      };
    }
  };
  try {
    process.env.HEPR_PDF_TO_HEP_INTERNAL_WORKER = "1";
    console.log = () => {};
    console.error = () => {};
    console.warn = (...args) => liveWarnings.push(args);
    const reportConsoleWarn = console.warn;
    assert.equal(await runPdfToHep([reportPdf], reportingDependencies), 0);
    const generatedReportBytes = await readFile(reportOutput);
    assert.deepEqual(reports.filter((event) => event.type === "pdf-to-hep-sizes"), [
      { type: "pdf-to-hep-sizes", sourceBytes: 14 },
      { type: "pdf-to-hep-sizes", outputBytes: generatedReportBytes.byteLength }
    ]);
    assert.deepEqual(reports.filter((event) => event.type === "pdf-to-hep-warning").map((event) => event.message), [
      "loader warning",
      "[HEP] synthetic size warning",
      "report.pdf page 2: [icc-fallback] approximate colors",
      "cleanup warning"
    ]);
    assert.equal(liveWarnings.length, 4, "warnings remain visible during conversion");
    assert(!reports.some(event => event.type === "pdf-to-hep-raster-fallback"),
      "ordinary loader, HEP size, and ICC warnings never classify raster fallback");
    assert.equal(console.warn, reportConsoleWarn, "warning capture is restored after success");

    reports.length = 0;
    reportingGeneratedAt = "2026-10-02T11:19:41.033Z";
    assert.equal(await runPdfToHep(["--force", "--keep-unchanged", reportPdf], reportingDependencies), 0);
    assert.deepEqual(await readFile(reportOutput), generatedReportBytes);
    assert.equal(reports.find((event) => event.outputBytes !== undefined).outputBytes, generatedReportBytes.byteLength,
      "kept HEPs report their successful size");

    reports.length = 0;
    const selective = { severity: "warning", code: "selective-raster-fallback", pageIndex: 0,
      message: "Rasterized one span.", details: { reason: "unsupported blend mode" } };
    reportingDiagnostics = [
      selective,
      { ...selective },
      { severity: "warning", code: "page-raster-fallback", pageIndex: 2, message: "Rasterized a page.",
        details: { reasons: "vector-clip-edge-limit; unsupported paint", reason: "less specific reason" } },
      { severity: "warning", code: "retained-raster-fallback", message: "Rasterized one reusable program.",
        details: { reason: "retained program" } },
      ...["retained-vector-fallback", "font.type1-substituted", "native-raster-image", "page-preview"].map(code =>
        ({ severity: "warning", code, message: "Compatibility diagnostic with no raster fallback." })),
      { severity: "info", code: "page-raster-fallback", message: "Informational dry run." },
      { severity: "error", code: "page-raster-fallback", message: "Unconfirmed failed raster attempt." }
    ];
    assert.equal(await runPdfToHep(["--force", reportPdf], reportingDependencies), 0);
    assert.deepEqual(reports.filter(event => event.type === "pdf-to-hep-raster-fallback"), [
      { type: "pdf-to-hep-raster-fallback", code: "selective-raster-fallback", pageIndex: 0,
        message: "Rasterized one span.", reason: "unsupported blend mode" },
      { type: "pdf-to-hep-raster-fallback", code: "selective-raster-fallback", pageIndex: 0,
        message: "Rasterized one span.", reason: "unsupported blend mode" },
      { type: "pdf-to-hep-raster-fallback", code: "page-raster-fallback", pageIndex: 2,
        message: "Rasterized a page.", reason: "vector-clip-edge-limit; unsupported paint" },
      { type: "pdf-to-hep-raster-fallback", code: "retained-raster-fallback",
        message: "Rasterized one reusable program.", reason: "retained program" }
    ], "only definitive warning diagnostics produce structured fallback reports with source page and reason");
    reportingDiagnostics = defaultReportingDiagnostics;

    reports.length = 0;
    assert.equal(await runPdfToHep(["--force", reportPdf], {
      ...reportingDependencies,
      async loadBuilder() {
        return {
          buildHep(_bytes, options) {
            options.onDiagnostic(selective);
            console.warn("failure warning");
            throw new Error("synthetic build failure");
          },
          async close() {}
        };
      }
    }), 1);
    assert(reports.some((event) => event.type === "pdf-to-hep-error" && event.message === "synthetic build failure"));
    assert(reports.some(event => event.type === "pdf-to-hep-raster-fallback"),
      "a fallback observed before failure is reported, allowing the parent to classify it by final status");
    assert(!reports.some((event) => event.outputBytes !== undefined), "failed builds do not report generated sizes");
    assert.equal(console.warn, reportConsoleWarn, "warning capture is restored after a failed build");

    reports.length = 0;
    await assert.rejects(runPdfToHep(["--force", reportPdf], {
      ...reportingDependencies,
      async loadBuilder() { throw new Error("synthetic loader failure"); }
    }), /synthetic loader failure/);
    assert.deepEqual(reports, [{ type: "pdf-to-hep-error", message: "synthetic loader failure" }]);
    assert.equal(console.warn, reportConsoleWarn, "warning capture is restored after a rejected worker");
    assert.equal(canvasChecks, 5);
  } finally {
    Object.assign(console, originalConsoleForReports);
    if (previousWorkerFlag === undefined) delete process.env.HEPR_PDF_TO_HEP_INTERNAL_WORKER;
    else process.env.HEPR_PDF_TO_HEP_INTERNAL_WORKER = previousWorkerFlag;
  }

  // Verify the real IPC path with a short-lived Node child and a stub builder.
  const ipcWorkerScript = path.join(temporaryRoot, "ipc-worker.mjs");
  await writeFile(ipcWorkerScript, `
import { runPdfToHep } from ${JSON.stringify(new URL("../PDFtoHEP.js", import.meta.url).href)};
process.exitCode = await runPdfToHep(process.argv.slice(2), {
  assertCanvasAvailable: async () => {},
  async loadBuilder() {
    return {
      async buildHep(_bytes, options) {
        console.warn("synthetic IPC warning");
        console.warn("synthetic IPC warning");
        process.stdout.write("synthetic raw stdout\\n");
        process.stderr.write("synthetic raw stderr\\n");
        console.error("synthetic console error");
        options.onProgress({ value: 0.5, stage: "synthetic-build" });
        for (let index = 0; index < 2; index++) options.onDiagnostic({
          severity: "warning", code: "page-raster-fallback", pageIndex: 2,
          message: "synthetic IPC raster fallback", details: { reason: "synthetic page reason" }
        });
        return new Blob(["synthetic HEP"]);
      },
      async close() {}
    };
  }
});
`);
  const ipcLogPath = path.join(temporaryRoot, "diagnostics", "ipc-worker.log");
  const ipcLog = await createPdfToHepDiagnosticLog({ logFile: ipcLogPath }, [{ pdfPath: reportPdf, outputPath: reportOutput }]);
  assert.equal(ipcLog.path, ipcLogPath);
  assert(Number.isSafeInteger(ipcLog.fd));
  ipcLog.write("parent log marker before worker");
  let ipcSpawnOptions;
  const ipcProgress = [];
  const originalIpcConsoleError = console.error;
  let ipcWorker;
  try {
    console.error = (message) => ipcProgress.push(String(message));
    ipcWorker = startPdfToHepWorker({
      pdfPath: reportPdf,
      outputPath: reportOutput,
      fileNumber: 1,
      fileCount: 1
    }, true, 512, (command, args, options) => {
      ipcSpawnOptions = options;
      return spawn(command, args, options);
    }, ipcWorkerScript, ipcLog);
    assert.deepEqual(await ipcWorker.completion, { code: 0, signal: null });
  } finally {
    console.error = originalIpcConsoleError;
  }
  assert.deepEqual(ipcProgress, ["[1/1] report.pdf: 50% synthetic-build"], "live progress stays visible through IPC");
  assert.deepEqual(ipcSpawnOptions.stdio, ["inherit", ipcLog.fd, ipcLog.fd, "ipc"]);
  ipcLog.write("parent log marker after worker");
  await ipcLog.close();
  const ipcLogContents = await readFile(ipcLogPath, "utf8");
  assert(!ipcLogContents.includes("50% synthetic-build"), "routine progress does not fill the diagnostics log");
  for (const message of ["synthetic raw stdout", "synthetic raw stderr", "synthetic console error",
    "synthetic IPC warning", "parent log marker before worker", "parent log marker after worker"]) {
    assert(ipcLogContents.includes(message), `diagnostic log preserves ${message}`);
  }
  const appendedLog = await createPdfToHepDiagnosticLog({ logFile: ipcLogPath }, []);
  appendedLog.write("second batch marker");
  await appendedLog.close();
  const appendedContents = await readFile(ipcLogPath, "utf8");
  assert(appendedContents.includes(ipcLogContents), "reusing an explicit log path appends rather than truncates");
  assert(appendedContents.includes("second batch marker"));
  assert.deepEqual(ipcWorker.report, {
    warnings: [
      { message: "synthetic IPC warning", count: 2 },
      { message: "report.pdf page 3: [page-raster-fallback] synthetic IPC raster fallback", count: 2 }
    ],
    sourceBytes: 14,
    outputBytes: 13,
    rasterFallbacks: [{ code: "page-raster-fallback", message: "synthetic IPC raster fallback",
      pageIndex: 2, reason: "synthetic page reason", count: 2 }]
  });

  const logInputs = [{ pdfPath: reportPdf, outputPath: reportOutput }];
  for (const target of [reportPdf, reportOutput]) {
    await assert.rejects(createPdfToHepDiagnosticLog({ logFile: target }, logInputs), /PDF|HEP|input|output|overwrite/i,
      "a diagnostic log must not overwrite a source PDF or generated HEP");
    const linkedLog = `${target}.log-hardlink`;
    await link(target, linkedLog);
    await assert.rejects(createPdfToHepDiagnosticLog({ logFile: linkedLog }, logInputs), /PDF|HEP|input|output|overwrite/i,
      "a hardlink log alias must not mutate a source PDF or generated HEP");
    const symbolicLog = `${target}.log-symlink`;
    try {
      await symlink(target, symbolicLog);
      await assert.rejects(createPdfToHepDiagnosticLog({ logFile: symbolicLog }, logInputs), /PDF|HEP|input|output|overwrite|regular file|symlink/i,
        "a symlink log alias must not mutate a source PDF or generated HEP");
    } catch (error) {
      if (error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
    }
  }
  await assert.rejects(createPdfToHepDiagnosticLog({ logFile: nestedDirectory }, []), /regular file|directory|EISDIR/i,
    "log destinations must be regular files");

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

  // Identical PDFs: a batch converts the first and copies its HEP to the rest.
  const duplicateDirectory = path.join(temporaryRoot, "duplicates");
  await mkdir(duplicateDirectory);
  const duplicateSources = [
    ["a.pdf", "%PDF-same"], ["b.pdf", "%PDF-diff"], ["c.pdf", "%PDF-same"],
    ["d.pdf", "%PDF-unique-size"], ["e.pdf", "%PDF-same"]
  ];
  await Promise.all(duplicateSources.map(([name, content]) => writeFile(path.join(duplicateDirectory, name), content)));
  const duplicateOutput = (name) => hepOutputPathForPdf(path.join(duplicateDirectory, name));
  const duplicateItems = () => duplicateSources.map(([name], index) => ({
    pdfPath: path.join(duplicateDirectory, name),
    outputPath: duplicateOutput(name),
    fileNumber: index + 1,
    fileCount: duplicateSources.length
  }));
  const hashedPdfs = [];
  assert.equal(await markDuplicatePdfs(duplicateItems(), async (pdfPath) => {
    hashedPdfs.push(path.basename(pdfPath));
    return readFile(pdfPath, "utf8");
  }), 2);
  assert.deepEqual(hashedPdfs, ["a.pdf", "b.pdf", "c.pdf", "e.pdf"], "PDFs with a unique size are never hashed");

  const runDuplicateBatch = async (options, failingPdfs = [], reports = {}, fixture = {}) => {
    const items = duplicateItems();
    assert.equal(await markDuplicatePdfs(items), 2, "SHA-256 finds both copies of a.pdf");
    const converted = [];
    const logs = [];
    const diagnostics = [];
    const errors = [];
    const originalConsole = { log: console.log, error: console.error };
    let time = 0;
    let result;
    try {
      console.log = (message) => logs.push(String(message));
      console.error = (message) => errors.push(String(message));
      result = await runPdfToHepWorkerBatch(items, { workers: 2, ...options }, 0, {
        heapMb: 512,
        signalTarget: new EventEmitter(),
        now: () => { const value = time; time += fixture.clockStepMs ?? 0; return value; },
        createDiagnosticLog: async () => ({
          path: "/synthetic/duplicates.log", fd: 99,
          write: (message) => diagnostics.push(String(message)),
          async close() {}
        }),
        cleanupWorkerTemps: async outputPath => {
          if (fixture.cleanupFailure && outputPath === duplicateOutput("a.pdf")) throw new Error("synthetic canonical cleanup failure");
        },
        startWorker(item, force, heapMb) {
          const name = path.basename(item.pdfPath);
          converted.push(name);
          const child = new FakeChild();
          const worker = startPdfToHepWorker(item, force, heapMb, () => child);
          const code = failingPdfs.includes(name) ? 1 : 0;
          (code === 0 ? writeFile(item.outputPath, `HEP converted from ${name}`) : Promise.resolve()).then(() => {
            time += fixture.workerTimeMs ?? 0;
            const sourceBytes = Buffer.byteLength(duplicateSources.find(([sourceName]) => sourceName === name)[1]);
            child.emit("message", { type: "pdf-to-hep-sizes", sourceBytes, outputBytes: 24 });
            for (const report of reports[name] ?? []) child.emit("message", report);
            child.emit("close", code, null);
          });
          return worker;
        }
      });
    } finally {
      Object.assign(console, originalConsole);
    }
    const rows = text => text.split("\n").filter(line => line.startsWith("|"))
      .map(line => line.split("|").slice(1, -1).map(cell => cell.trim()));
    const summary = Object.fromEntries(rows(logs.at(-1)));
    const timingRows = rows(logs.find(line => line.startsWith("Conversion time summary:"))).slice(1);
    return { result, converted, logs, diagnostics, errors, summary, timingRows };
  };

  const canonicalFallback = { type: "pdf-to-hep-raster-fallback", code: "page-raster-fallback", pageIndex: 2,
    message: "Canonical output used raster fallback.", reason: "unsupported paint" };
  const canonicalReports = { "a.pdf": [
    { type: "pdf-to-hep-warning", message: "canonical conversion warning" }, canonicalFallback
  ] };
  const duplicateRun = await runDuplicateBatch({ force: false }, [], canonicalReports);
  assert.equal(duplicateRun.result, 0);
  assert.deepEqual(duplicateRun.converted.sort(), ["a.pdf", "b.pdf", "d.pdf"]);
  for (const name of ["c.pdf", "e.pdf"]) {
    assert.equal(await readFile(duplicateOutput(name), "utf8"), "HEP converted from a.pdf");
  }
  for (const line of [
    "Converting 3 PDF(s) with up to 2 worker(s); 2 duplicate PDF(s) will copy the HEP of an identical PDF.",
    "[3/5] Copied the HEP for c.pdf; same content as a.pdf",
    "[5/5] Copied the HEP for e.pdf; same content as a.pdf",
    "Finished: 3 generated, 2 copied for duplicates, 0 skipped, 0 failed."
  ]) assert(duplicateRun.logs.includes(line), `batch output includes: ${line}`);
  assert.deepEqual(duplicateRun.timingRows[2], ["3/5", "c.pdf", "duplicate", "0h 00m 00s", "9 B", "24 B", "+166.67%"]);
  assert.equal(duplicateRun.summary["PDFs attempted"], "5", "each converted or copied PDF is processed once");
  assert.equal(duplicateRun.summary.Successful, "5", "copied duplicate HEPs are successful outputs");
  assert.equal(duplicateRun.summary["Duplicate PDFs (HEP copied)"], "2");
  assert.equal(duplicateRun.summary["Original PDFs (successful)"], "52 B", "copied PDFs contribute their source bytes");
  assert.equal(duplicateRun.summary["Generated HEPs (successful)"], "120 B", "each copied HEP contributes its output bytes");
  assert.equal(duplicateRun.summary["Size change (successful)"], "+68 B (+130.77%)");
  assert.equal(duplicateRun.summary["HEPs larger than original PDFs"], "5");
  assert.equal(duplicateRun.summary.Warnings, "1 across 1 PDF(s)", "two copies do not emit the canonical warning again");
  assert.equal(duplicateRun.summary["Successful PDFs using raster fallback"], "3",
    "both copied HEPs inherit the canonical output's raster fallback provenance");
  const fallbackRecap = duplicateRun.diagnostics.find(line => line.includes("Raster fallback by PDF:"));
  for (const name of ["c.pdf", "e.pdf"]) assert(fallbackRecap.includes(
    `${path.join(duplicateDirectory, name)}:\n    Same raster fallback as ${path.join(duplicateDirectory, "a.pdf")}`));
  assert.equal((fallbackRecap.match(/Canonical output used raster fallback/g) ?? []).length, 1,
    "duplicate provenance links preserve fallback details without repeating conversion diagnostics");
  assert.equal(duplicateRun.summary["Conversion time saved by duplicates (est.)"], "0h 00m 00s");
  assert.match(duplicateRun.diagnostics.join("\n"),
    new RegExp(`${path.join(duplicateDirectory, "e.pdf").replace(/[\\.]/g, "\\$&")}: same content as .*a\\.pdf`));

  // Advance only the injected clock: ten seconds per canonical conversion,
  // one second per copy, without delaying real filesystem operations.
  const timedCopies = await runDuplicateBatch({ force: true, workers: 1 }, [], {}, { clockStepMs: 1000, workerTimeMs: 9000 });
  assert.deepEqual(timedCopies.timingRows.map(row => row[3]), ["0h 00m 10s", "0h 00m 10s", "0h 00m 01s", "0h 00m 10s", "0h 00m 01s"]);
  assert.equal(timedCopies.summary["Total attempted conversion time (summed)"], "0h 00m 32s");
  assert.equal(timedCopies.summary["Average attempted PDF time"], "0h 00m 06s");
  assert.equal(timedCopies.summary["Median attempted PDF time"], "0h 00m 10s");
  assert.equal(timedCopies.summary["Fastest attempted PDF time"], "0h 00m 01s");
  assert.equal(timedCopies.summary["Conversion time saved by duplicates (est.)"], "0h 00m 20s",
    "avoided conversion estimates remain separate from the two actual one-second copies");
  const cleanupCopies = await runDuplicateBatch({ force: true }, [], {}, { cleanupFailure: true });
  assert.equal(cleanupCopies.result, 0, "a cleanup warning does not turn copied outputs into failures");
  assert.equal(cleanupCopies.summary.Successful, "5");
  assert.equal(cleanupCopies.summary.Warnings, "1 across 1 PDF(s)", "canonical cleanup warnings are not multiplied by duplicate copies");

  // --keep-unchanged leaves a byte-identical duplicate HEP untouched.
  const keptInode = (await stat(duplicateOutput("c.pdf"))).ino;
  const keptRun = await runDuplicateBatch({ force: true, keepUnchanged: true }, [], canonicalReports);
  assert(keptRun.logs.includes("[3/5] Kept the HEP for c.pdf; same content as a.pdf"));
  assert.equal((await stat(duplicateOutput("c.pdf"))).ino, keptInode);
  assert.equal(keptRun.summary["PDFs attempted"], "5"); assert.equal(keptRun.summary.Successful, "5");
  assert.equal(keptRun.summary["Generated HEPs (successful)"], "120 B", "kept identical duplicate outputs count as successful HEPs");
  assert.equal(keptRun.summary["Successful PDFs using raster fallback"], "3");
  assert.equal(keptRun.summary.Warnings, "1 across 1 PDF(s)");

  // Without a HEP to copy, the next duplicate converts and serves the rest.
  const failedRun = await runDuplicateBatch({ force: true }, ["a.pdf"], { ...canonicalReports, "c.pdf": [canonicalFallback] });
  assert.equal(failedRun.result, 1);
  assert.deepEqual(failedRun.converted.sort(), ["a.pdf", "b.pdf", "c.pdf", "d.pdf"]);
  assert(failedRun.logs.includes("[5/5] Copied the HEP for e.pdf; same content as c.pdf"));
  assert.equal(await readFile(duplicateOutput("e.pdf"), "utf8"), "HEP converted from c.pdf");
  assert.equal(failedRun.summary["Duplicate PDFs (HEP copied)"], "1");
  assert.equal(failedRun.summary["PDFs attempted"], "5"); assert.equal(failedRun.summary.Successful, "4");
  assert.equal(failedRun.summary.Failed, "1");
  assert.equal(failedRun.summary["Original PDFs (successful)"], "43 B");
  assert.equal(failedRun.summary["Generated HEPs (successful)"], "96 B");
  assert.equal(failedRun.summary["Successful PDFs using raster fallback"], "2",
    "the promoted successful canonical conversion and its copy count; the failed original does not");

  // A failed copy is an attempted PDF but contributes no successful output
  // bytes. Other duplicate copies continue without launching extra workers.
  await rm(duplicateOutput("c.pdf"));
  await mkdir(duplicateOutput("c.pdf"));
  const copyFailureRun = await runDuplicateBatch({ force: true }, [], canonicalReports);
  assert.equal(copyFailureRun.result, 1);
  assert.deepEqual(copyFailureRun.converted.sort(), ["a.pdf", "b.pdf", "d.pdf"]);
  assert.equal(copyFailureRun.summary["PDFs attempted"], "5"); assert.equal(copyFailureRun.summary.Successful, "4");
  assert.equal(copyFailureRun.summary.Failed, "1"); assert.equal(copyFailureRun.summary.Skipped, "0");
  assert.equal(copyFailureRun.summary["Duplicate PDFs (HEP copied)"], "1");
  assert.equal(copyFailureRun.summary["Original PDFs (successful)"], "43 B");
  assert.equal(copyFailureRun.summary["Generated HEPs (successful)"], "96 B");
  assert.equal(copyFailureRun.summary["Size change (successful)"], "+53 B (+123.26%)");
  assert.equal(copyFailureRun.summary["HEPs larger than original PDFs"], "4");
  assert.equal(copyFailureRun.summary["Successful PDFs using raster fallback"], "2");
  assert.equal(copyFailureRun.summary.Warnings, "1 across 1 PDF(s)");
  assert.deepEqual(copyFailureRun.timingRows[2].slice(2), ["failed", "0h 00m 00s", "9 B", "--", "--"],
    "a failed duplicate copy has no successful HEP size or size change");
  assert(copyFailureRun.errors.some(line => line.includes("Failed c.pdf")));
  assert(copyFailureRun.diagnostics.some(line => line.includes(`${path.join(duplicateDirectory, "c.pdf")}: Could not copy`)));
  assert.equal(await readFile(duplicateOutput("e.pdf"), "utf8"), "HEP converted from a.pdf");
  await rm(duplicateOutput("c.pdf"), { recursive: true });

  // Outputs created after discovery are runtime skips, never successful
  // duplicates. Their candidate sizes and fallback reports stay excluded.
  await writeFile(duplicateOutput("c.pdf"), "existing duplicate output sentinel");
  const skippedCopies = await runDuplicateBatch({ force: false }, [], canonicalReports);
  assert.equal(skippedCopies.result, 0);
  assert.equal(skippedCopies.summary["PDFs attempted"], "5"); assert.equal(skippedCopies.summary.Successful, "3");
  assert.equal(skippedCopies.summary.Skipped, "2"); assert.equal(skippedCopies.summary.Failed, "0");
  assert.equal(skippedCopies.summary["Duplicate PDFs (HEP copied)"], "0");
  assert.equal(skippedCopies.summary["Original PDFs (successful)"], "34 B");
  assert.equal(skippedCopies.summary["Generated HEPs (successful)"], "72 B");
  assert.equal(skippedCopies.summary["HEPs larger than original PDFs"], "3");
  assert.equal(skippedCopies.summary["Successful PDFs using raster fallback"], "1");
  assert.equal(skippedCopies.summary.Warnings, "1 across 1 PDF(s)");
  assert.deepEqual(skippedCopies.timingRows[2].slice(2), ["skipped", "0h 00m 00s", "9 B", "--", "--"]);
  assert.equal(skippedCopies.summary["Conversion time saved by duplicates (est.)"], undefined);
  assert.equal(await readFile(duplicateOutput("c.pdf"), "utf8"), "existing duplicate output sentinel");
  assert.deepEqual((await readdir(duplicateDirectory)).filter((name) => name.startsWith(".hepr-")), [],
    "duplicate copies must not leave temporary files behind");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log(
  "PDF-to-HEP CLI argument, timing, worker reporting/IPC, diagnostics logging, source-loader, unchanged-HEP, filesystem, and atomic-write tests passed."
);
