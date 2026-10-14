import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { access, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { markDuplicatePdfs, runPdfToHep, startPdfToHepWorker } from "../PDFtoHEP.js";
import {
  assertUniquePdfArtifacts, requestedPdfArtifacts, runPdfOutputBatch, runPdfThumbnailCli,
  selectPendingPdfArtifacts, thumbnailOutputPathForPdf
} from "../bin/thumbnail-cli.mjs";

// Real filesystem planning and atomic duplicate copies; PDF rendering is always
// replaced by synthetic child processes. These bytes are deliberately not PDFs.
const scratch = await mkdtemp(path.join(os.tmpdir(), "hepr-thumbnail-cli-"));
const defaults = { output: "both", thumbnailPage: 1, thumbnailMaxDimension: 400,
  thumbnailFormat: "webp", thumbnailBackground: "#ffffff", force: false, workers: 1 };
try {
  const planning = await directory("planning");
  const pdf = await fakePdf(planning, "Level 1.pdf");
  assert.equal(thumbnailOutputPathForPdf(pdf, { ...defaults, thumbnailPage: 3 }),
    path.join(planning, "Level_1-thumbnail-p3.webp"));
  const requested = requestedPdfArtifacts(pdf, defaults);
  assert.deepEqual(requested.map(artifact => artifact.kind), ["thumbnail", "hep"]);
  assert.deepEqual(requested[0].candidatePaths, [
    path.join(planning, "Level_1-thumbnail-p1.webp"), path.join(planning, "Level_1-thumbnail-p1.png")
  ], "WebP reserves its actual PNG fallback filename before any work starts");
  assert.equal(requestedPdfArtifacts(pdf, { ...defaults, output: "thumbnail", thumbnailFormat: "png" }).length, 1);
  assert.throws(() => assertUniquePdfArtifacts([pdf, path.join(planning, "nested", "LEVEL 1.pdf")],
    { ...defaults, outputDirectory: planning }), /collision/,
  "case-only output collisions are rejected independently of the host filesystem");

  assert.deepEqual((await selectPendingPdfArtifacts(pdf, defaults)).pending.map(artifact => artifact.kind), ["thumbnail", "hep"]);
  await writeFile(requested[1].outputPath, "existing hep");
  let selected = await selectPendingPdfArtifacts(pdf, defaults);
  assert.deepEqual(selected.pending.map(artifact => artifact.kind), ["thumbnail"]);
  assert.deepEqual(selected.skipped.map(artifact => artifact.kind), ["hep"]);
  await rm(requested[1].outputPath);
  await writeFile(requested[0].candidatePaths[1], "existing fallback png");
  selected = await selectPendingPdfArtifacts(pdf, defaults);
  assert.deepEqual(selected.pending.map(artifact => artifact.kind), ["hep"]);
  assert.deepEqual([selected.skipped[0].outputPath, selected.skipped[0].format, selected.skipped[0].outputBytes],
    [requested[0].candidatePaths[1], "png", 21], "a fallback PNG is recognized as the existing thumbnail");
  selected = await selectPendingPdfArtifacts(pdf, { ...defaults, force: true });
  assert.deepEqual(selected.pending.map(artifact => artifact.kind), ["thumbnail", "hep"]);
  assert.equal(selected.skipped.length, 0);
  await rm(requested[0].candidatePaths[1]);
  const outside = path.join(planning, "unrelated.png");
  await writeFile(outside, "do not replace");
  await symlink(outside, requested[0].candidatePaths[1]);
  await assert.rejects(selectPendingPdfArtifacts(pdf, { ...defaults, force: true }), /not a regular file/);
  assert.equal(await readFile(outside, "utf8"), "do not replace", "--force never follows an output symlink");
  await rm(requested[0].candidatePaths[1]);

  // Protect all requested paths before skip planning, including fallback names
  // and hard links to an already skipped HEP output.
  await writeFile(requested[1].outputPath, "existing hep");
  const aliasLog = path.join(planning, "hardlinked.log");
  await link(requested[1].outputPath, aliasLog);
  for (const logFile of [pdf, requested[0].outputPath, requested[0].candidatePaths[1], requested[1].outputPath, aliasLog]) {
    await assert.rejects(runPdfThumbnailCli({ ...defaults, inputPath: pdf, logFile }, {
      startWorker() { throw new Error("protected output must be rejected before dispatch"); }
    }), /diagnostics log must be separate/);
  }
  const symlinkLog = path.join(planning, "symlinked.log");
  await symlink(outside, symlinkLog);
  await assert.rejects(runPdfThumbnailCli({ ...defaults, inputPath: pdf, logFile: symlinkLog }), /regular file/);
  assert.equal(await readFile(requested[1].outputPath, "utf8"), "existing hep");
  await assert.rejects(access(requested[0].outputPath), error => error.code === "ENOENT");
  await assert.rejects(access(requested[0].candidatePaths[1]), error => error.code === "ENOENT");

  // Exercise the existing public CLI route. Its skipped HEP must be untouched,
  // and the thumbnail route must never load the old conversion runtime.
  const route = await directory("route");
  const routePdf = await fakePdf(route, "route.pdf");
  const routeHep = requestedPdfArtifacts(routePdf, defaults)[1].outputPath;
  await writeFile(routeHep, "keep existing hep");
  const routePool = fakePool({ automatic: item => generatedArtifacts(item) });
  assert.equal(await runPdfToHep(["--output=both", "--workers=1", routePdf], {
    ...routePool.dependencies, loadBuilder() { throw new Error("thumbnail route must not load the old builder"); }
  }), 0);
  assert.deepEqual(routePool.started.map(item => item.artifacts.map(artifact => artifact.kind)), [["thumbnail"]]);
  assert.equal(await readFile(routeHep, "utf8"), "keep existing hep");
  assert.equal(routePool.logClosed, 1);
  assert(routePool.logItems.some(item => item.outputPath === routeHep), "log protection includes the skipped HEP");
  assert(routePool.logItems.some(item => item.outputPath.endsWith(".png")), "log protection includes a reserved fallback PNG");
  routePool.assertReleased();
  const skippedLogs = [];
  assert.equal(await runPdfToHep(["--output=both", routePdf], {
    log: text => skippedLogs.push(String(text)),
    startWorker() { throw new Error("complete outputs must not start a worker"); },
    createDiagnosticLog() { throw new Error("a fully skipped batch needs no worker diagnostic log"); }
  }), 0);
  assert(skippedLogs.some(text => /0 generated, 0 copied for duplicates, 2 skipped/.test(text)));

  // A child rediscovers its single input, but its terminal labels retain the
  // parent batch position supplied through the existing worker environment.
  const childDirectory = await directory("child-position");
  const childPdf = await fakePdf(childDirectory, "child.pdf");
  const childSignals = new EventEmitter(), childLogs = [], childReports = [];
  let childSessionClosed = 0;
  const batchEnvironment = ["HEPR_PDF_TO_HEP_BATCH_INDEX", "HEPR_PDF_TO_HEP_BATCH_TOTAL"];
  const originalBatchEnvironment = batchEnvironment.map(name => process.env[name]);
  try {
    process.env.HEPR_PDF_TO_HEP_BATCH_INDEX = "3";
    process.env.HEPR_PDF_TO_HEP_BATCH_TOTAL = "5";
    assert.equal(await runPdfToHep(["--output=thumbnail", childPdf], {
      workerProcess: true, signalTarget: childSignals,
      assertCanvasAvailable: async () => {}, log: text => childLogs.push(String(text)),
      reportWorkerEvent: report => childReports.push(report),
      loadDocumentSession: async () => ({ openDocumentSession: async source => {
        assert.equal(source, childPdf);
        return { renderThumbnail: async () => ({ blob: new Blob(["synthetic child thumbnail"], { type: "image/png" }),
          width: 20, height: 10 }), close: async () => { childSessionClosed++; } };
      } })
    }), 0);
  } finally {
    batchEnvironment.forEach((name, index) => {
      if (originalBatchEnvironment[index] === undefined) delete process.env[name];
      else process.env[name] = originalBatchEnvironment[index];
    });
  }
  assert(childLogs.some(text => text.startsWith("[3/5] Opening ")), "child labels keep the parent batch position");
  assert(childReports.some(report => report.type === "pdf-output-artifact" && report.format === "png"));
  assert.equal(childSessionClosed, 1);
  assert.equal(childSignals.listenerCount("SIGINT"), 0);
  assert.equal(childSignals.listenerCount("SIGTERM"), 0);

  // Identical input bytes share one worker when both missing-output sets match.
  const duplicate = await directory("duplicates");
  const duplicatePdfs = await Promise.all(["a.pdf", "b.pdf", "c.pdf"].map(name => fakePdf(duplicate, name, "identical bytes")));
  const duplicateOptions = { ...defaults, inputPath: duplicate };
  const duplicatePool = fakePool({ automatic: item => generatedArtifacts(item, "png") });
  assert.equal(await runPdfThumbnailCli(duplicateOptions, duplicatePool.dependencies), 0);
  assert.equal(duplicatePool.started.length, 1, "identical PDFs are rendered once, then artifacts are copied atomically");
  for (const duplicatePdf of duplicatePdfs) {
    assert.equal(await readFile(thumbnailOutputPathForPdf(duplicatePdf, defaults, "png"), "utf8"), "synthetic thumbnail");
    assert.equal(await readFile(requestedPdfArtifacts(duplicatePdf, defaults)[1].outputPath, "utf8"), "synthetic hep");
    await assert.rejects(access(thumbnailOutputPathForPdf(duplicatePdf, defaults)), error => error.code === "ENOENT");
  }
  assert(duplicatePool.logs.some(text => /2 generated, 4 copied for duplicates/.test(text)));
  assert(duplicatePool.logs.some(text => /b-thumbnail-p1\.png.*duplicate.*160x80/.test(text)),
    "copied PNG fallbacks report their actual filename, status and dimensions");
  duplicatePool.assertReleased();

  // The copy path preserves actual format metadata, not the requested WebP.
  const metadata = await directory("duplicate-metadata");
  const metadataItems = await itemsFor(metadata, 2, defaults, "same metadata source");
  await markDuplicatePdfs(metadataItems);
  const metadataRows = [], metadataPool = fakePool({ automatic: item => generatedArtifacts(item, "png") });
  assert.equal(await runPdfOutputBatch(metadataItems, metadataRows, defaults, metadataPool.dependencies), 0);
  const copiedThumbnail = metadataRows.find(row => row.fileNumber === 2 && row.kind === "thumbnail");
  assert(copiedThumbnail, JSON.stringify(metadataRows));
  assert.deepEqual([copiedThumbnail.status, copiedThumbnail.format, copiedThumbnail.width, copiedThumbnail.height],
    ["duplicate", "png", 160, 80]);
  assert.equal(copiedThumbnail.outputBytes, Buffer.byteLength("synthetic thumbnail"));
  metadataPool.assertReleased();

  // Matching bytes alone are insufficient when one PDF is missing a HEP and
  // another is missing a thumbnail; preserve each existing output separately.
  const differing = await directory("different-missing-outputs");
  const differingA = await fakePdf(differing, "a.pdf", "same input");
  const differingB = await fakePdf(differing, "b.pdf", "same input");
  await writeFile(requestedPdfArtifacts(differingA, defaults)[1].outputPath, "old a hep");
  await writeFile(thumbnailOutputPathForPdf(differingB, defaults), "old b thumbnail");
  const differingPool = fakePool({ automatic: item => generatedArtifacts(item) });
  assert.equal(await runPdfThumbnailCli({ ...defaults, inputPath: differing }, differingPool.dependencies), 0);
  assert.deepEqual(differingPool.started.map(item => item.artifacts.map(artifact => artifact.kind)), [["thumbnail"], ["hep"]]);
  assert.equal(await readFile(requestedPdfArtifacts(differingA, defaults)[1].outputPath, "utf8"), "old a hep");
  assert.equal(await readFile(thumbnailOutputPathForPdf(differingB, defaults), "utf8"), "old b thumbnail");
  differingPool.assertReleased();

  const partial = await directory("partial-failure");
  const partialItems = await itemsFor(partial, 2, defaults);
  const partialRows = [], partialPool = fakePool({ automatic: async item => {
    if (item.fileNumber === 2) return generatedArtifacts(item);
    const thumbnail = await generatedArtifacts({ ...item, artifacts: item.artifacts.filter(artifact => artifact.kind === "thumbnail") });
    return { code: 1, artifacts: [...thumbnail.artifacts, { kind: "hep", status: "failed",
      outputPath: item.artifacts.find(artifact => artifact.kind === "hep").outputPath,
      durationMs: 7, errorMessage: "synthetic HEP failure" }] };
  } });
  assert.equal(await runPdfOutputBatch(partialItems, partialRows, defaults, partialPool.dependencies), 1);
  assert.deepEqual(partialRows.map(row => [row.fileNumber, row.kind, row.status]), [
    [1, "hep", "failed"], [1, "thumbnail", "generated"], [2, "hep", "generated"], [2, "thumbnail", "generated"]
  ]);
  assert.equal(await readFile(partialItems[0].artifacts[0].outputPath, "utf8"), "synthetic thumbnail",
    "a failed HEP leaves its completed thumbnail committed");
  assert.equal(partialPool.cleaned.length, 2);
  partialPool.assertReleased();

  const spawnFailure = await directory("spawn-failure");
  const spawnItems = await itemsFor(spawnFailure, 2, { ...defaults, output: "thumbnail" });
  const spawnRows = [], spawnPool = fakePool({ throwOnStart: 1, automatic: item => generatedArtifacts(item) });
  assert.equal(await runPdfOutputBatch(spawnItems, spawnRows, { ...defaults, output: "thumbnail" }, spawnPool.dependencies), 1);
  assert.deepEqual(spawnRows.map(row => row.status), ["failed", "generated"]);
  assert.equal(spawnPool.cleaned.length, 1, "only a successfully spawned child has temporary resources to clean");
  spawnPool.assertReleased();

  for (const [signal, expectedCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    const cancelled = await directory(signal);
    const cancelItems = await itemsFor(cancelled, 3, defaults);
    const cancelRows = [], cancelPool = fakePool();
    const completion = runPdfOutputBatch(cancelItems, cancelRows, defaults, cancelPool.dependencies);
    await waitFor(() => cancelPool.started.length === 1);
    const committed = await generatedArtifacts({ ...cancelItems[0], artifacts: [cancelItems[0].artifacts[0]] });
    cancelPool.publish(1, committed.artifacts);
    cancelPool.signalTarget.emit(signal);
    cancelPool.signalTarget.emit(signal);
    assert.deepEqual(cancelPool.signals, [[1, signal], [1, "SIGKILL"]]);
    cancelPool.finish(1, { code: null, signal: "SIGKILL" });
    assert.equal(await completion, expectedCode);
    assert.equal(cancelPool.started.length, 1, "signals stop queued PDFs from starting");
    assert.deepEqual(cancelRows.map(row => [row.kind, row.status]), [["hep", "interrupted"], ["thumbnail", "generated"]]);
    assert.equal(await readFile(cancelItems[0].artifacts[0].outputPath, "utf8"), "synthetic thumbnail");
    assert(cancelPool.logs.includes("2 PDF(s) not attempted."));
    assert.equal(cancelPool.cleaned.length, 1);
    cancelPool.assertReleased();
  }

  const cleanup = await directory("cleanup-failure");
  await fakePdf(cleanup, "cleanup.pdf");
  const cleanupPool = fakePool({ automatic: item => generatedArtifacts(item), failCleanup: true, failLogClose: true });
  assert.equal(await runPdfThumbnailCli({ ...defaults, output: "thumbnail", inputPath: cleanup }, cleanupPool.dependencies), 0);
  assert(cleanupPool.diagnostics.some(text => /Could not clean up worker temporary files/.test(text)));
  assert(cleanupPool.warnings.some(text => /Could not finish writing diagnostics log/.test(text)));
  cleanupPool.assertReleased();
  console.log("Thumbnail CLI planning/coordinator: paths, skips, protected logs, published route, duplicate copies, partial failures, cancellation and cleanup passed.");
} finally { await rm(scratch, { recursive: true, force: true }); }

async function directory(name) {
  const result = path.join(scratch, name);
  await mkdir(result, { recursive: true });
  return result;
}

async function fakePdf(directory, name, content = `not a PDF: ${name}`) {
  const file = path.join(directory, name);
  await writeFile(file, content);
  return file;
}

async function itemsFor(directory, count, options, identicalContent) {
  const result = [];
  for (let index = 0; index < count; index++) {
    const pdfPath = await fakePdf(directory, `pdf-${index + 1}.pdf`, identicalContent);
    const artifacts = requestedPdfArtifacts(pdfPath, options);
    result.push({ ...options, pdfPath, fileNumber: index + 1, fileCount: count,
      artifacts, outputPath: artifacts[0].outputPath });
  }
  return result;
}

async function generatedArtifacts(item, format = "webp") {
  const artifacts = [];
  for (const artifact of item.artifacts) {
    const outputPath = artifact.kind === "thumbnail" ? artifact.outputPath.replace(/\.(webp|png)$/, `.${format}`) : artifact.outputPath;
    const bytes = Buffer.from(`synthetic ${artifact.kind}`);
    await writeFile(outputPath, bytes);
    artifacts.push({ kind: artifact.kind, status: "generated", outputPath, outputBytes: bytes.length, durationMs: 12.5,
      ...(artifact.kind === "thumbnail" ? { width: 160, height: 80, format } : {}) });
  }
  return { code: 0, artifacts };
}

function fakePool({ automatic, throwOnStart, failCleanup = false, failLogClose = false } = {}) {
  const signalTarget = new EventEmitter(), started = [], workers = new Map();
  const logs = [], errors = [], warnings = [], diagnostics = [], signals = [], cleaned = [];
  let logClosed = 0, logItems = [];
  const pool = {
    signalTarget, started, logs, errors, warnings, diagnostics, signals, cleaned,
    get logClosed() { return logClosed; }, get logItems() { return logItems; },
    publish(number, artifacts) {
      for (const artifact of artifacts) workers.get(number).child.emit("message", { type: "pdf-output-artifact", ...artifact });
    },
    finish(number, { code = 0, signal = null, artifacts = [] } = {}) {
      pool.publish(number, artifacts);
      const child = workers.get(number).child;
      child.exitCode = code; child.signalCode = signal;
      child.emit("close", code, signal);
    },
    assertReleased() {
      assert.equal(signalTarget.listenerCount("SIGINT"), 0);
      assert.equal(signalTarget.listenerCount("SIGTERM"), 0);
      for (const { child } of workers.values()) assert(child.exitCode !== null || child.signalCode !== null);
    }
  };
  pool.dependencies = {
    workerProcess: false, signalTarget, heapMb: 8192,
    log: text => logs.push(String(text)), error: text => errors.push(String(text)), warn: text => warnings.push(String(text)),
    async createDiagnosticLog(_options, items) {
      logItems = items;
      return { path: path.join(scratch, `${randomUUID()}.log`), write: text => diagnostics.push(String(text)),
        async close() { logClosed++; if (failLogClose) throw new Error("synthetic log close failure"); } };
    },
    startWorker(item, force, heapMb) {
      started.push(item);
      assert.equal(force, item.force ?? false);
      assert.equal(heapMb, 8192);
      if (item.fileNumber === throwOnStart) throw new Error("synthetic spawn failure");
      const child = new EventEmitter();
      child.pid = 41000 + item.fileNumber; child.exitCode = null; child.signalCode = null;
      child.kill = signal => { signals.push([item.fileNumber, signal]); return true; };
      const worker = startPdfToHepWorker(item, force, heapMb, () => child);
      workers.set(item.fileNumber, worker);
      if (automatic) void Promise.resolve().then(() => automatic(item)).then(
        result => pool.finish(item.fileNumber, result), error => child.emit("error", error));
      return worker;
    },
    async cleanupWorkerTemps(outputPath, pid, token) {
      assert.match(token, /^[0-9a-f-]{36}$/i);
      assert.equal(outputPath, started.find(item => item.fileNumber === pid - 41000).outputPath,
        "cleanup stays in the completed child's own output directory, including PNG fallbacks");
      cleaned.push({ outputPath, pid });
      if (failCleanup) throw new Error("synthetic temp cleanup failure");
    }
  };
  return pool;
}

async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert(Date.now() < deadline, "synthetic output worker did not start");
    await delay(1);
  }
}
