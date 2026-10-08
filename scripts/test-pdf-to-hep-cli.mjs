import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setImmediate as waitForImmediate } from "node:timers/promises";

import {
  assertSupportedNodeVersion,
  assertUniqueHepOutputs,
  discoverPdfFiles,
  formatPdfToHepDuration,
  formatPdfToHepSummary,
  formatPdfToHepTimingSummary,
  hepDiffersOnlyInGeneratedAt,
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
  sourceFile = "plan.pdf",
  compression = "DEFLATE"
} = {}) {
  const archive = new HepArchive();
  archive.file("manifest.json", JSON.stringify({ formatVersion: 9, sourceFile, generatedAt, scene: { pages: [1, 2] } }));
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
  ["other manifest fields", existingTestHep, await encodeTestHep("2026-09-30T11:19:41.033Z", { sourceFile: "plan2.pdf" })],
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
    { force: false, workers: 1 },
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
  "Converting 3 PDF(s) with up to 1 worker(s).",
  `[1/3] Converted ${batchItems[0].pdfPath} in 0h 00m 01s`,
  `[3/3] Skipped ${batchItems[2].pdfPath} after 0h 00m 04s`,
  "Finished: 1 generated, 3 skipped, 1 failed.",
  [
    "Conversion time summary:",
    `  [1/3] ${batchItems[0].pdfPath}: 0h 00m 01s (generated)`,
    `  [2/3] ${batchItems[1].pdfPath}: 0h 00m 03s (failed)`,
    `  [3/3] ${batchItems[2].pdfPath}: 0h 00m 04s (skipped)`,
    "  Total attempted conversion time: 0h 00m 07s"
  ].join("\n"),
  "Batch wall time: 0h 00m 07s",
  formatPdfToHepSummary([
    { ...batchItems[0], status: "generated" },
    { ...batchItems[1], status: "failed", errorMessage: "exit code 1" },
    { ...batchItems[2], status: "skipped" }
  ], 3)
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
    { force: true, workers: 1 },
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
assert.deepEqual(interruptLog, ["Converting 3 PDF(s) with up to 1 worker(s).", [
  "Conversion time summary:",
  `  [1/3] ${batchItems[0].pdfPath}: 0h 00m 05s (interrupted)`,
  "  Total attempted conversion time: 0h 00m 05s"
].join("\n"), "Batch wall time: 0h 00m 05s", formatPdfToHepSummary([
  { ...batchItems[0], status: "interrupted" }
], 0, 2)]);
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
          options.onDiagnostic({ severity: "info", code: "info-only", message: "ignore" });
          options.onDiagnostic({ severity: "warning", code: "icc-fallback", pageIndex: 1, message: "approximate colors" });
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
    assert.equal(console.warn, reportConsoleWarn, "warning capture is restored after success");

    reports.length = 0;
    reportingGeneratedAt = "2026-10-02T11:19:41.033Z";
    assert.equal(await runPdfToHep(["--force", "--keep-unchanged", reportPdf], reportingDependencies), 0);
    assert.deepEqual(await readFile(reportOutput), generatedReportBytes);
    assert.equal(reports.find((event) => event.outputBytes !== undefined).outputBytes, generatedReportBytes.byteLength,
      "kept HEPs report their successful size");

    reports.length = 0;
    assert.equal(await runPdfToHep(["--force", reportPdf], {
      ...reportingDependencies,
      async loadBuilder() {
        return {
          buildHep() { console.warn("failure warning"); throw new Error("synthetic build failure"); },
          async close() {}
        };
      }
    }), 1);
    assert(reports.some((event) => event.type === "pdf-to-hep-error" && event.message === "synthetic build failure"));
    assert(!reports.some((event) => event.outputBytes !== undefined), "failed builds do not report generated sizes");
    assert.equal(console.warn, reportConsoleWarn, "warning capture is restored after a failed build");

    reports.length = 0;
    await assert.rejects(runPdfToHep(["--force", reportPdf], {
      ...reportingDependencies,
      async loadBuilder() { throw new Error("synthetic loader failure"); }
    }), /synthetic loader failure/);
    assert.deepEqual(reports, [{ type: "pdf-to-hep-error", message: "synthetic loader failure" }]);
    assert.equal(console.warn, reportConsoleWarn, "warning capture is restored after a rejected worker");
    assert.equal(canvasChecks, 4);
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
      async buildHep() {
        console.warn("synthetic IPC warning");
        console.warn("synthetic IPC warning");
        return new Blob(["synthetic HEP"]);
      },
      async close() {}
    };
  }
});
`);
  const ipcWorker = startPdfToHepWorker({
    pdfPath: reportPdf,
    outputPath: reportOutput,
    fileNumber: 1,
    fileCount: 1
  }, true, 512, (command, args, options) => spawn(command, args, {
    ...options, stdio: ["ignore", "ignore", "ignore", "ipc"]
  }), ipcWorkerScript);
  assert.deepEqual(await ipcWorker.completion, { code: 0, signal: null });
  assert.deepEqual(ipcWorker.report, {
    warnings: [{ message: "synthetic IPC warning", count: 2 }],
    sourceBytes: 14,
    outputBytes: 13
  });

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
  "PDF-to-HEP CLI argument, timing, worker reporting/IPC, source-loader, unchanged-HEP, filesystem, and atomic-write tests passed."
);
