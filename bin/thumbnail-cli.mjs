import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { format } from "node:util";
import {
  PDF_PASSWORD_ENV, ExistingOutputError, discoverPdfFiles, sanitizeHepSourceName, hepOutputPathForPdf,
  regularOutputExists, assertSeparatePdfToHepDiagnosticLog, createPdfToHepDiagnosticLog,
  resolvePdfToHepWorkerCount, resolvePdfToHepWorkerHeapMb, startPdfToHepWorker,
  cleanupPdfToHepWorkerTemps, markDuplicatePdfs, copyDuplicateHep, copyHepFileAtomically,
  readWorkerBatchPosition,
  formatBytes, formatPdfToHepDuration, formatPdfToHepTable
} from "../PDFtoHEP.js";

export function thumbnailOutputPathForPdf(pdfPath, options, format = options.thumbnailFormat ?? "webp") {
  const name = `${sanitizeHepSourceName(path.basename(pdfPath))}-thumbnail-p${options.thumbnailPage ?? 1}.${format}`;
  return path.join(options.outputDirectory ?? path.dirname(pdfPath), name);
}

/** Reserve the PNG fallback too, so naming/log checks cover every possible write. */
export function requestedPdfArtifacts(pdfPath, options) {
  const format = options.thumbnailFormat ?? "webp";
  const outputPath = thumbnailOutputPathForPdf(pdfPath, options, format);
  const artifacts = [{ kind: "thumbnail", outputPath, format,
    candidatePaths: format === "webp" ? [outputPath, thumbnailOutputPathForPdf(pdfPath, options, "png")] : [outputPath] }];
  if (options.output === "both") {
    const outputPath = hepOutputPathForPdf(pdfPath, options.outputDirectory);
    artifacts.push({ kind: "hep", outputPath, candidatePaths: [outputPath] });
  }
  return artifacts;
}

export function assertUniquePdfArtifacts(pdfPaths, options) {
  const sources = new Map();
  for (const pdfPath of pdfPaths) {
    for (const artifact of requestedPdfArtifacts(pdfPath, options)) {
      for (const outputPath of artifact.candidatePaths) {
        const key = path.resolve(outputPath).toLocaleLowerCase("en-US");
        if (sources.has(key)) throw new Error(`PDF output collision: ${sources.get(key)} and ${pdfPath} both map to ${outputPath}`);
        sources.set(key, pdfPath);
      }
    }
  }
}

export async function selectPendingPdfArtifacts(pdfPath, options) {
  const pending = [], skipped = [];
  for (const artifact of requestedPdfArtifacts(pdfPath, options)) {
    let existing;
    for (const candidate of artifact.candidatePaths) {
      if (await regularOutputExists(candidate)) existing ??= candidate;
    }
    if (existing && !options.force) {
      skipped.push({ ...artifact, outputPath: existing, status: "skipped", durationMs: 0,
        outputBytes: (await stat(existing)).size,
        ...(artifact.kind === "thumbnail" ? { format: path.extname(existing).slice(1) } : {}) });
    } else pending.push(artifact);
  }
  return { pending, skipped };
}

export function formatPdfOutputSummary(rows, wallTimeMs = 0) {
  const table = formatPdfToHepTable(["PDF", "Output", "Status", "Time", "Size", "Dimensions"], rows.map(row => [
    path.basename(row.pdfPath), path.basename(row.outputPath), row.status,
    formatPdfOutputDuration(row.durationMs), row.outputBytes === undefined ? "--" : formatBytes(row.outputBytes),
    row.width && row.height ? `${row.width}x${row.height}` : "--"
  ]), [3, 4, 5]);
  const count = status => rows.filter(row => row.status === status).length;
  const total = kind => rows.filter(row => row.kind === kind && ["generated", "duplicate"].includes(row.status))
    .reduce((sum, row) => sum + (row.outputBytes ?? 0), 0);
  return `Output summary:\n${table}\nFinished: ${count("generated")} generated, ${count("duplicate")} copied for duplicates, ` +
    `${count("skipped")} skipped, ${count("failed")} failed, ${count("interrupted")} interrupted.\n` +
    `Thumbnail output: ${formatBytes(total("thumbnail"))}; HEP output: ${formatBytes(total("hep"))}.\n` +
    `Batch wall time (elapsed): ${formatPdfOutputDuration(wallTimeMs)}`;
}

export function formatPdfOutputDuration(value) {
  const duration = Number.isFinite(value) ? Math.max(0, value) : 0;
  return duration < 1000 ? `${duration.toFixed(1)} ms` : duration < 60000
    ? `${(duration / 1000).toFixed(3)} s` : formatPdfToHepDuration(duration);
}

export async function runPdfThumbnailCli(options, dependencies = {}) {
  const log = dependencies.log ?? console.log;
  const password = options.password ?? (process.env[PDF_PASSWORD_ENV] || undefined);
  const pdfPaths = await discoverPdfFiles(options.inputPath);
  assertUniquePdfArtifacts(pdfPaths, options);
  const logItems = pdfPaths.flatMap(pdfPath => requestedPdfArtifacts(pdfPath, options)
    .flatMap(artifact => artifact.candidatePaths.map(outputPath => ({ pdfPath, outputPath }))));
  if (options.logFile !== undefined) await assertSeparatePdfToHepDiagnosticLog(options.logFile, logItems);
  const workerProcess = dependencies.workerProcess ?? process.env.HEPR_PDF_TO_HEP_INTERNAL_WORKER === "1";
  const pending = [], rows = [];
  for (const [index, pdfPath] of pdfPaths.entries()) {
    const selected = await selectPendingPdfArtifacts(pdfPath, options);
    const batch = workerProcess ? readWorkerBatchPosition(index + 1, pdfPaths.length)
      : { index: index + 1, total: pdfPaths.length };
    const position = { pdfPath, fileNumber: batch.index, fileCount: batch.total };
    rows.push(...selected.skipped.map(artifact => ({ ...position, ...artifact })));
    if (selected.pending.length) pending.push({ ...options, ...position, password,
      artifacts: selected.pending, outputPath: selected.pending[0].outputPath });
  }
  const report = dependencies.reportWorkerEvent ?? (event => {
    if (process.connected && typeof process.send === "function") {
      try { process.send(event, () => {}); } catch { /* The batch can disconnect while cancelling. */ }
    }
  });
  if (workerProcess) for (const row of rows) report({ type: "pdf-output-artifact", ...row });
  if (!pending.length) {
    if (workerProcess) return 3;
    log(formatPdfOutputSummary(rows));
    return 0;
  }
  if (options.outputDirectory !== undefined) await mkdir(options.outputDirectory, { recursive: true });
  if (workerProcess) {
    if (pending.length !== 1) throw new Error("An internal PDF output worker must receive exactly one PDF.");
    const { convertPdfOutputs } = await import("./thumbnail-cli-worker.mjs");
    const originalWarn = console.warn;
    console.warn = (...args) => {
      originalWarn(...args);
      report({ type: "pdf-to-hep-warning", message: format(...args) });
    };
    try { return await convertPdfOutputs(pending[0], { ...options, password }, dependencies, report); }
    finally { console.warn = originalWarn; }
  }
  // Copy only artifacts newly generated in this batch. PDFs with different
  // missing-output sets remain separate, preserving independent skip behavior.
  const groups = new Map();
  for (const item of pending) {
    const key = item.artifacts.map(artifact => artifact.kind).join(",");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  for (const group of groups.values()) if (group.length > 1) await markDuplicatePdfs(group);
  let diagnosticLog;
  const warn = dependencies.warn ?? console.warn;
  try {
    diagnosticLog = await (dependencies.createDiagnosticLog ?? createPdfToHepDiagnosticLog)(options, logItems);
  } catch (error) {
    warn(`Could not open the diagnostics log: ${message(error)}. Worker output will appear in the terminal.`);
  }
  try {
    return await runPdfOutputBatch(pending, rows, options, dependencies, diagnosticLog);
  } finally {
    await diagnosticLog?.close().catch(error => warn(`Could not finish writing diagnostics log: ${message(error)}`));
  }
}

export async function runPdfOutputBatch(pending, rows, options, dependencies = {}, diagnosticLog) {
  const log = dependencies.log ?? console.log, errorLog = dependencies.error ?? console.error;
  const warn = text => diagnosticLog ? diagnosticLog.write(text) : (dependencies.warn ?? console.warn)(text);
  const now = dependencies.now ?? (() => performance.now());
  const started = now(), heapMb = dependencies.heapMb ?? resolvePdfToHepWorkerHeapMb();
  const queue = pending.filter(item => !item.duplicateOf);
  const workerCount = resolvePdfToHepWorkerCount(queue.length, options, dependencies);
  const startWorker = dependencies.startWorker ?? ((item, force, heapMb) =>
    startPdfToHepWorker(item, force, heapMb, spawn, dependencies.workerScriptPath, diagnosticLog));
  const cleanup = dependencies.cleanupWorkerTemps ?? cleanupPdfToHepWorkerTemps;
  const signalTarget = dependencies.signalTarget ?? process, active = new Set(), attempted = new Set();
  let next = 0, interrupted = 0, workerFailures = 0;
  const interrupt = signal => {
    const repeated = interrupted !== 0;
    interrupted ||= signal === "SIGINT" ? 130 : 143;
    errorLog(`Received ${signal}; ${repeated ? "force-stopping" : "stopping"} the PDF output batch...`);
    for (const child of active) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      try { child.kill(repeated ? "SIGKILL" : signal); }
      catch (error) { warn(`Could not stop an output worker: ${message(error)}`); }
    }
  };
  const onSigInt = () => interrupt("SIGINT"), onSigTerm = () => interrupt("SIGTERM");
  const requeue = item => {
    const [first, ...rest] = item.duplicates ?? [];
    if (first) { first.duplicates = rest; queue.push(first); }
  };
  const append = (item, artifact, result) => {
    const row = { ...result, pdfPath: item.pdfPath, fileNumber: item.fileNumber, fileCount: item.fileCount,
      kind: artifact.kind };
    rows.push(row);
    if (row.errorMessage) warn(`${item.pdfPath} (${row.kind}): ${row.errorMessage}`);
    return row;
  };
  const copyDuplicates = async (item, results) => {
    for (const duplicate of item.duplicates ?? []) {
      if (interrupted) return;
      attempted.add(duplicate.pdfPath);
      for (const artifact of duplicate.artifacts) {
        if (interrupted) return;
        const source = results.find(result => result.kind === artifact.kind);
        const outputPath = artifact.kind === "thumbnail"
          ? thumbnailOutputPathForPdf(duplicate.pdfPath, options, source.format) : artifact.outputPath;
        const copyStarted = now();
        try {
          const selected = await selectPendingPdfArtifacts(duplicate.pdfPath, options);
          if (interrupted) return;
          const skipped = selected.skipped.find(result => result.kind === artifact.kind);
          if (skipped) { append(duplicate, artifact, skipped); continue; }
          let copied = true;
          if (artifact.kind === "hep") copied = await copyDuplicateHep(source.outputPath, outputPath, options);
          else {
            await copyHepFileAtomically(source.outputPath, outputPath, options.force);
            const { cleanupThumbnailAlternate } = await import("./thumbnail-cli-worker.mjs");
            await cleanupThumbnailAlternate(options, outputPath, warn);
          }
          append(duplicate, artifact, { ...source, outputPath, status: copied ? "duplicate" : "skipped", durationMs: now() - copyStarted });
        } catch (error) {
          append(duplicate, artifact, { outputPath, status: error instanceof ExistingOutputError ? "skipped" : "failed",
            durationMs: now() - copyStarted, errorMessage: message(error) });
        }
      }
    }
  };
  const runNext = async () => {
    while (!interrupted && next < queue.length) {
      const item = queue[next++], itemStarted = now();
      attempted.add(item.pdfPath);
      let worker, outcome, failure;
      try {
        worker = startWorker(item, options.force, heapMb);
        active.add(worker.child);
        outcome = await worker.completion;
        if (!interrupted) {
          if (outcome.code === 130 || outcome.signal === "SIGINT") interrupt("SIGINT");
          else if (outcome.code === 143 || outcome.signal === "SIGTERM") interrupt("SIGTERM");
        }
        if (outcome.code !== 0 && outcome.code !== 3) failure = worker.report?.errorMessage ??
          (outcome.signal ? `signal ${outcome.signal}` : `exit code ${outcome.code}`);
      } catch (error) { failure = message(error); }
      finally {
        if (worker) {
          active.delete(worker.child);
          // All artifacts of one PDF share a destination directory, including
          // fallback PNGs. Tokens protect unrelated workers' temporary files.
          await cleanup(item.outputPath, worker.child.pid, worker.workerToken, warn)
            .catch(error => warn(`Could not clean up worker temporary files: ${message(error)}`));
        }
      }
      const report = worker?.report ?? {};
      for (const warning of report.warnings ?? []) warn(`${item.pdfPath}: ${warning.message} (${warning.count ?? 1})`);
      for (const diagnostic of report.rasterFallbacks ?? []) warn(`${item.pdfPath}: ${JSON.stringify(diagnostic)}`);
      if (failure && !interrupted) { workerFailures++; errorLog(`Failed ${path.basename(item.pdfPath)}: ${failure}`); }
      const results = item.artifacts.map(artifact => {
        const result = report.artifacts?.findLast(result => result.kind === artifact.kind &&
          artifact.candidatePaths.includes(result.outputPath));
        return append(item, artifact, result ?? { outputPath: artifact.outputPath,
          status: interrupted ? "interrupted" : outcome?.code === 3 ? "skipped" : "failed",
          durationMs: now() - itemStarted,
          ...(interrupted || outcome?.code === 3 ? {} : { errorMessage: failure ?? "Worker did not report the requested output." }) });
      });
      log(`[${item.fileNumber}/${item.fileCount}] ${path.basename(item.pdfPath)}: ${results.map(result =>
        `${result.kind} ${result.status}`).join(", ")} (${formatPdfOutputDuration(now() - itemStarted)})`);
      if (interrupted) break;
      if (!failure && results.every(result => result.status === "generated")) await copyDuplicates(item, results);
      else requeue(item);
    }
  };
  signalTarget.on("SIGINT", onSigInt); signalTarget.on("SIGTERM", onSigTerm);
  log(`Converting ${pending.length} PDF(s) to ${options.output} with up to ${workerCount} worker(s).`);
  if (diagnosticLog) log(`Diagnostics log: ${diagnosticLog.path}`);
  try {
    const completed = await Promise.allSettled(Array.from({ length: workerCount }, () => runNext()));
    const rejection = completed.find(result => result.status === "rejected");
    if (rejection) throw rejection.reason;
  } finally {
    signalTarget.off("SIGINT", onSigInt); signalTarget.off("SIGTERM", onSigTerm);
  }
  rows.sort((left, right) => left.fileNumber - right.fileNumber || left.kind.localeCompare(right.kind));
  const summary = formatPdfOutputSummary(rows, now() - started);
  log(summary); diagnosticLog?.write(summary);
  if (interrupted) log(`${pending.length - attempted.size} PDF(s) not attempted.`);
  return interrupted || (workerFailures > 0 || rows.some(row => row.status === "failed") ? 1 : 0);
}

function message(error) { return error instanceof Error ? error.message : String(error); }
