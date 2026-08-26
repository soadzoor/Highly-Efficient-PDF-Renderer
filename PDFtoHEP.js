#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import {
  link,
  lstat,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker as NodeThreadWorker } from "node:worker_threads";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
const densePdfNodeWorkerBootstrapUrl = new URL(
  "./scripts/pdf-to-hep-dense-worker.mjs",
  import.meta.url
);
const PDF_TO_HEP_WORKER_ENV = "HEPR_PDF_TO_HEP_INTERNAL_WORKER";
const PDF_TO_HEP_BATCH_INDEX_ENV = "HEPR_PDF_TO_HEP_BATCH_INDEX";
const PDF_TO_HEP_BATCH_TOTAL_ENV = "HEPR_PDF_TO_HEP_BATCH_TOTAL";
const PDF_TO_HEP_HEAP_ENV = "HEPR_PDF_TO_HEP_HEAP_MB";
const PDF_TO_HEP_WORKER_TOKEN_ENV = "HEPR_PDF_TO_HEP_WORKER_TOKEN";
const DEFAULT_PDF_TO_HEP_WORKER_HEAP_MB = 12_288;
const PDF_TO_HEP_WORKER_SKIPPED_EXIT_CODE = 3;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PDF_TO_HEP_USAGE = `Usage:
  node PDFtoHEP.js [--force] <pdf-or-directory>

Options:
  -f, --force  Replace existing regular HEP files after conversion succeeds.
  -h, --help   Show this help text.

Examples:
  node PDFtoHEP.js ./Level1.pdf
  node PDFtoHEP.js ./pdfs
  node PDFtoHEP.js --force ./pdfs

When given a directory, the script scans it recursively and processes regular
.pdf files in isolated child processes, one at a time. Outputs use the client
export convention <name>-parsed-data.hep and are written beside their PDFs.

Existing HEP files are skipped unless --force is supplied.`;

class ExistingOutputError extends Error {
  constructor(outputPath) {
    super(`Output already exists: ${outputPath}`);
    this.name = "ExistingOutputError";
    this.outputPath = outputPath;
  }
}

export function parsePdfToHepArguments(args) {
  let force = false;
  let help = false;
  let positionalOnly = false;
  let inputPath;

  for (const argument of args) {
    if (!positionalOnly && argument === "--") {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && (argument === "--help" || argument === "-h")) {
      help = true;
      continue;
    }
    if (!positionalOnly && (argument === "--force" || argument === "-f")) {
      force = true;
      continue;
    }
    if (!positionalOnly && argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (inputPath !== undefined) {
      throw new Error("Pass exactly one PDF file or directory.");
    }
    inputPath = argument;
  }

  if (!help && inputPath === undefined) {
    throw new Error("Pass a PDF file or directory.");
  }

  return { force, help, inputPath };
}

export async function discoverPdfFiles(inputPath) {
  const absoluteInputPath = path.resolve(inputPath);
  let inputStats;
  try {
    inputStats = await stat(absoluteInputPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Input does not exist: ${absoluteInputPath}`);
    }
    throw error;
  }

  if (inputStats.isFile()) {
    if (path.extname(absoluteInputPath).toLowerCase() !== ".pdf") {
      throw new Error(`Input file is not a PDF: ${absoluteInputPath}`);
    }
    return [absoluteInputPath];
  }
  if (!inputStats.isDirectory()) {
    throw new Error(`Input is neither a regular file nor a directory: ${absoluteInputPath}`);
  }

  const pdfPaths = [];
  await walkPdfDirectory(absoluteInputPath, pdfPaths);
  pdfPaths.sort(compareStrings);
  if (pdfPaths.length === 0) {
    throw new Error(`No PDF files found under: ${absoluteInputPath}`);
  }
  return pdfPaths;
}

async function walkPdfDirectory(directoryPath, pdfPaths) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  entries.sort((left, right) => compareStrings(left.name, right.name));

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      await walkPdfDirectory(entryPath, pdfPaths);
      continue;
    }
    if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".pdf") {
      pdfPaths.push(entryPath);
    }
    // Directory symlinks are deliberately not followed, avoiding cycles and
    // keeping a directory conversion within the tree the user supplied.
  }
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sanitizeHepSourceName(sourceLabel) {
  const withoutFormatLabel = sourceLabel.replace(/\s*\((?:hep|parsed zip)\)\s*$/i, "");
  const isParsedDataFile = /\.(?:hep|zip)$/i.test(withoutFormatLabel);
  const withoutExtension = withoutFormatLabel.replace(/\.(?:pdf|hep|zip)$/i, "");
  const withoutParsedDataSuffix = isParsedDataFile
    ? withoutExtension.replace(/[._-]?parsed[._-]?data$/i, "")
    : withoutExtension;
  const normalized = withoutParsedDataSuffix.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  return normalized.length > 0 ? normalized : "floorplan";
}

export function hepOutputPathForPdf(pdfPath) {
  const outputName = `${sanitizeHepSourceName(path.basename(pdfPath))}-parsed-data.hep`;
  return path.join(path.dirname(pdfPath), outputName);
}

export function assertUniqueHepOutputs(pdfPaths) {
  const sourceByOutput = new Map();
  for (const pdfPath of pdfPaths) {
    const outputPath = hepOutputPathForPdf(pdfPath);
    // Treat case-only differences as collisions even on a case-sensitive host;
    // the same batch should remain safe when moved to Windows or macOS.
    const key = path.resolve(outputPath).toLocaleLowerCase("en-US");
    const previousSource = sourceByOutput.get(key);
    if (previousSource) {
      throw new Error(
        `PDF output collision: ${previousSource} and ${pdfPath} both map to ${outputPath}`
      );
    }
    sourceByOutput.set(key, pdfPath);
  }
}

function assertSupportedNodeVersion() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (!Number.isInteger(major) || major < 22 || (major === 22 && minor < 13)) {
    throw new Error(
      `Node.js 22.13 or newer is required (current version: ${process.versions.node}).`
    );
  }
}

export function resolvePdfToHepWorkerHeapMb(
  execArguments = process.execArgv,
  environment = process.env
) {
  const configuredHeap = environment[PDF_TO_HEP_HEAP_ENV];
  if (configuredHeap !== undefined && configuredHeap.trim() !== "") {
    return parseWorkerHeapMb(configuredHeap, PDF_TO_HEP_HEAP_ENV);
  }

  let resolvedHeapMb;
  for (let index = 0; index < execArguments.length; index += 1) {
    const argument = execArguments[index];
    const inlineMatch = /^--max[-_]old[-_]space[-_]size=(\d+)$/i.exec(argument);
    if (inlineMatch) {
      resolvedHeapMb = parseWorkerHeapMb(inlineMatch[1], "--max-old-space-size");
      continue;
    }
    if (/^--max[-_]old[-_]space[-_]size$/i.test(argument)) {
      resolvedHeapMb = parseWorkerHeapMb(execArguments[index + 1], "--max-old-space-size");
      index += 1;
    }
  }

  return resolvedHeapMb ?? DEFAULT_PDF_TO_HEP_WORKER_HEAP_MB;
}

function parseWorkerHeapMb(value, label) {
  const heapMb = Number(value);
  if (!Number.isSafeInteger(heapMb) || heapMb < 512 || heapMb > 131_072) {
    throw new Error(`${label} must be an integer between 512 and 131072 MiB.`);
  }
  return heapMb;
}

function createNodeDensePdfWorkerConstructor(
  heapMb,
  WorkerImplementation = NodeThreadWorker,
  bootstrapUrl = densePdfNodeWorkerBootstrapUrl
) {
  const maxOldGenerationSizeMb = parseWorkerHeapMb(heapMb, "Dense PDF worker heap");

  return class NodeDensePdfWorker {
    #worker;

    #listeners = {
      message: new Set(),
      error: new Set(),
      messageerror: new Set()
    };

    #terminationRequested = false;

    #resultReceived = false;

    constructor(moduleUrl, options = {}) {
      const resolvedModuleUrl = moduleUrl instanceof URL
        ? moduleUrl
        : new URL(String(moduleUrl));
      if (resolvedModuleUrl.protocol !== "file:") {
        throw new TypeError(
          `The Node dense PDF worker requires a file URL, received ${resolvedModuleUrl.href}`
        );
      }

      this.#worker = new WorkerImplementation(bootstrapUrl, {
        workerData: { moduleUrl: resolvedModuleUrl.href },
        // Node 22 needs this flag to execute the repository's TypeScript source.
        // V8 heap flags cannot be passed in Worker execArgv; resourceLimits is
        // the Worker API equivalent, while the CLI process-wide flag also wins.
        execArgv: ["--experimental-strip-types"],
        resourceLimits: { maxOldGenerationSizeMb },
        name: typeof options.name === "string" ? options.name : "hepr-dense-pdf"
      });

      // Keep permanent EventEmitter listeners installed. In particular, a Node
      // Worker "error" event with no listener would terminate the parent process
      // after the browser-style client removes its temporary listeners.
      this.#worker.on("message", (data) => {
        if (data?.type === "result" && data.result) {
          this.#resultReceived = true;
        }
        this.#dispatch("message", { data });
      });
      this.#worker.on("messageerror", (error) => {
        this.#dispatch("messageerror", { data: error });
      });
      this.#worker.on("error", (error) => {
        this.#dispatchError(error);
      });
      this.#worker.on("exit", (code) => {
        if (!this.#terminationRequested && !this.#resultReceived) {
          this.#dispatchError(
            new Error(`The Node dense PDF worker exited before returning a result (code ${code}).`)
          );
        }
      });
    }

    addEventListener(type, listener) {
      this.#listeners[type]?.add(listener);
    }

    removeEventListener(type, listener) {
      this.#listeners[type]?.delete(listener);
    }

    postMessage(value, transfer = []) {
      this.#worker.postMessage(value, transfer);
    }

    terminate() {
      if (this.#terminationRequested) {
        return;
      }
      this.#terminationRequested = true;
      void Promise.resolve(this.#worker.terminate()).catch(() => {
        // The worker may already have stopped after posting its final result.
      });
    }

    #dispatch(type, event) {
      for (const listener of [...(this.#listeners[type] ?? [])]) {
        if (typeof listener === "function") {
          listener.call(this, event);
        } else {
          listener?.handleEvent?.(event);
        }
      }
    }

    #dispatchError(error) {
      this.#dispatch("error", {
        message: error instanceof Error ? error.message : String(error),
        error,
        preventDefault() {}
      });
    }
  };
}

export function installNodeDensePdfWorkerSupport(
  heapMb = resolvePdfToHepWorkerHeapMb(),
  dependencies = {}
) {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const WorkerConstructor = createNodeDensePdfWorkerConstructor(
    heapMb,
    dependencies.WorkerImplementation ?? NodeThreadWorker,
    dependencies.bootstrapUrl ?? densePdfNodeWorkerBootstrapUrl
  );
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: WorkerConstructor
  });

  let restored = false;
  return () => {
    if (restored) {
      return;
    }
    restored = true;
    if (previousDescriptor) {
      Object.defineProperty(globalThis, "Worker", previousDescriptor);
    } else {
      delete globalThis.Worker;
    }
  };
}

export function pdfToHepWorkerArguments(pdfPath, force, heapMb) {
  return [
    `--max-old-space-size=${heapMb}`,
    scriptPath,
    ...(force ? ["--force"] : []),
    "--",
    pdfPath
  ];
}

function isPdfToHepWorkerProcess() {
  return process.env[PDF_TO_HEP_WORKER_ENV] === "1";
}

function readWorkerBatchPosition(fallbackIndex, fallbackTotal) {
  const configuredIndex = Number(process.env[PDF_TO_HEP_BATCH_INDEX_ENV]);
  const configuredTotal = Number(process.env[PDF_TO_HEP_BATCH_TOTAL_ENV]);
  return {
    index: Number.isSafeInteger(configuredIndex) && configuredIndex > 0
      ? configuredIndex
      : fallbackIndex,
    total: Number.isSafeInteger(configuredTotal) && configuredTotal >= configuredIndex
      ? configuredTotal
      : fallbackTotal
  };
}

function installPdfJsCompatibilityShims() {
  Promise.try ??= (callback, ...args) => Promise.resolve().then(() => callback(...args));
  Uint8Array.prototype.toHex ??= function toHex() {
    return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("hex");
  };
  Uint8Array.prototype.toBase64 ??= function toBase64() {
    return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("base64");
  };
  Uint8Array.fromHex ??= (value) => new Uint8Array(Buffer.from(value, "hex"));
  Uint8Array.fromBase64 ??= (value) => new Uint8Array(Buffer.from(value, "base64"));
}

async function assertNodeCanvasAvailable() {
  let canvasModule;
  try {
    canvasModule = await import("@napi-rs/canvas");
  } catch (error) {
    throw new Error(
      "@napi-rs/canvas could not be loaded. Run npm install before converting PDFs; " +
      "the canvas implementation is required to preserve raster PDF content server-side.",
      { cause: error }
    );
  }

  if (
    typeof canvasModule.createCanvas !== "function" ||
    typeof canvasModule.ImageData !== "function"
  ) {
    throw new Error("@napi-rs/canvas is installed but does not expose the required canvas API.");
  }

  const canvas = canvasModule.createCanvas(1, 1);
  try {
    if (!canvas.getContext("2d")) {
      throw new Error("@napi-rs/canvas could not create a 2D rendering context.");
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function loadSourceHepBuilder(dependencies = {}) {
  const createServer = dependencies.createServer ?? (await import("vite")).createServer;
  // Middleware mode only transforms the TypeScript source graph. It never
  // binds a port or starts the HEPR development server.
  const viteServer = await createServer({
    configFile: false,
    root: scriptDirectory,
    logLevel: "error",
    server: {
      middlewareMode: true,
      hmr: false,
      ws: false,
      // This is a one-shot source loader, so filesystem invalidation cannot
      // provide any value. In particular, generated HEP files can live under
      // public/, where a queued Vite "add" event otherwise races close() and
      // reports ERR_CLOSED_SERVER after an otherwise successful conversion.
      watch: null
    },
    optimizeDeps: { noDiscovery: true },
    appType: "custom"
  });

  try {
    const builderModule = await viteServer.ssrLoadModule("/src/parsedDataZipBuilder.ts");
    if (typeof builderModule.buildParsedDataZip !== "function") {
      throw new Error("The HEPR source builder did not export buildParsedDataZip().");
    }
    return {
      buildParsedDataZip: builderModule.buildParsedDataZip,
      close: () => viteServer.close()
    };
  } catch (error) {
    await viteServer.close();
    throw error;
  }
}

async function regularOutputExists(filePath) {
  try {
    const outputStats = await lstat(filePath);
    if (!outputStats.isFile()) {
      throw new Error(`Output path exists but is not a regular file: ${filePath}`);
    }
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function writeHepBlobAtomically(outputPath, blob, overwrite, signal) {
  const workerToken = process.env[PDF_TO_HEP_WORKER_TOKEN_ENV];
  const workerTokenPrefix = workerToken && UUID_PATTERN.test(workerToken)
    ? `${workerToken}-`
    : "";
  const temporaryPath = path.join(
    path.dirname(outputPath),
    `.hepr-${process.pid}-${workerTokenPrefix}${randomUUID()}.tmp`
  );
  let temporaryExists = false;

  try {
    const temporaryFile = await open(temporaryPath, "wx");
    temporaryExists = true;
    try {
      await temporaryFile.writeFile(blob.stream(), { signal });
    } finally {
      await temporaryFile.close();
    }
    signal?.throwIfAborted();
    if (overwrite) {
      await rename(temporaryPath, outputPath);
    } else {
      try {
        await link(temporaryPath, outputPath);
      } catch (error) {
        if (error?.code === "EEXIST") {
          throw new ExistingOutputError(outputPath);
        }
        throw error;
      }
      try {
        await unlink(temporaryPath);
      } catch (error) {
        console.warn(
          `Wrote ${outputPath}, but could not remove temporary link ${temporaryPath}: ` +
          formatError(error)
        );
      }
    }
    temporaryExists = false;
  } finally {
    if (temporaryExists) {
      await unlink(temporaryPath).catch((error) => {
        if (error?.code !== "ENOENT") {
          console.warn(`Could not remove temporary file ${temporaryPath}: ${formatError(error)}`);
        }
      });
    }
  }
}

function createProgressLogger(sourceLabel, fileNumber, fileCount) {
  let lastStage = "";
  let lastFivePercentBucket = -1;

  return (progress) => {
    const percentage = Math.round(Math.max(0, Math.min(1, Number(progress.value) || 0)) * 100);
    const bucket = Math.floor(percentage / 5);
    const stage = typeof progress.stage === "string" ? progress.stage : "working";
    if (stage === lastStage && bucket <= lastFivePercentBucket) {
      return;
    }
    lastStage = stage;
    lastFivePercentBucket = Math.max(lastFivePercentBucket, bucket);
    console.error(`[${fileNumber}/${fileCount}] ${sourceLabel}: ${percentage}% ${stage}`);
  };
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(byteLength) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = Math.max(0, Number(byteLength) || 0);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${unitIndex === 0 ? Math.round(value) : value.toFixed(2)} ${units[unitIndex]}`;
}

function durationSeconds(durationMs) {
  const numericDuration = Number(durationMs);
  if (!Number.isFinite(numericDuration) || numericDuration <= 0) {
    return 0;
  }
  return Math.round(numericDuration / 1_000);
}

function formatDurationSeconds(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

export function formatPdfToHepDuration(durationMs) {
  return formatDurationSeconds(durationSeconds(durationMs));
}

export function formatPdfToHepTimingSummary(timings) {
  if (timings.length === 0) {
    return "Conversion time summary: no PDF conversions were attempted.";
  }

  const lines = ["Conversion time summary:"];
  let totalDurationMs = 0;
  for (const timing of timings) {
    const elapsedSeconds = durationSeconds(timing.durationMs);
    totalDurationMs += timing.durationMs;
    lines.push(
      `  [${timing.fileNumber}/${timing.fileCount}] ${timing.pdfPath}: ` +
      `${formatDurationSeconds(elapsedSeconds)} (${timing.status})`
    );
  }
  lines.push(`  Total attempted conversion time: ${formatPdfToHepDuration(totalDurationMs)}`);
  return lines.join("\n");
}

function appendPdfToHepTiming(timings, item, status, durationMs) {
  const timing = {
    pdfPath: item.pdfPath,
    fileNumber: item.fileNumber,
    fileCount: item.fileCount,
    status,
    durationMs: Math.max(0, Number(durationMs) || 0)
  };
  timings.push(timing);
  return timing;
}

export function startPdfToHepWorker(
  item,
  force,
  heapMb,
  spawnImplementation = spawn
) {
  const workerToken = randomUUID();
  const child = spawnImplementation(
    process.execPath,
    pdfToHepWorkerArguments(item.pdfPath, force, heapMb),
    {
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        [PDF_TO_HEP_WORKER_ENV]: "1",
        [PDF_TO_HEP_BATCH_INDEX_ENV]: String(item.fileNumber),
        [PDF_TO_HEP_BATCH_TOTAL_ENV]: String(item.fileCount),
        [PDF_TO_HEP_WORKER_TOKEN_ENV]: workerToken
      }
    }
  );

  const completion = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      callback();
    };
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code, signal) => {
      finish(() => resolve({ code, signal }));
    });
  });

  return { child, completion, workerToken };
}

async function cleanupPdfToHepWorkerTemps(outputPath, workerPid, workerToken) {
  if (
    !Number.isSafeInteger(workerPid) ||
    workerPid <= 0 ||
    typeof workerToken !== "string" ||
    !UUID_PATTERN.test(workerToken)
  ) {
    return;
  }
  const directoryPath = path.dirname(outputPath);
  const temporaryPrefix = `.hepr-${workerPid}-${workerToken}-`;
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    console.warn(`Could not inspect worker temporary files in ${directoryPath}: ${formatError(error)}`);
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(temporaryPrefix) || !entry.name.endsWith(".tmp")) {
      continue;
    }
    const temporaryPath = path.join(directoryPath, entry.name);
    await unlink(temporaryPath).catch((error) => {
      if (error?.code !== "ENOENT") {
        console.warn(`Could not remove worker temporary file ${temporaryPath}: ${formatError(error)}`);
      }
    });
  }
}

export async function runPdfToHepWorkerBatch(
  pending,
  options,
  skippedCount,
  dependencies = {}
) {
  const heapMb = dependencies.heapMb ?? resolvePdfToHepWorkerHeapMb();
  const startWorker = dependencies.startWorker ?? startPdfToHepWorker;
  const cleanupWorkerTemps = dependencies.cleanupWorkerTemps ?? cleanupPdfToHepWorkerTemps;
  const signalTarget = dependencies.signalTarget ?? process;
  const now = dependencies.now ?? (() => performance.now());
  let activeChild = null;
  let interruptedExitCode = 0;
  let generatedCount = 0;
  const failures = [];
  const timings = [];

  const interrupt = (signalName) => {
    const repeatedSignal = interruptedExitCode !== 0;
    if (!repeatedSignal) {
      interruptedExitCode = signalName === "SIGINT" ? 130 : 143;
      console.error(`Received ${signalName}; stopping the PDF-to-HEP batch...`);
    }
    if (activeChild && activeChild.exitCode === null && activeChild.signalCode === null) {
      try {
        if (repeatedSignal) {
          console.error(`Received ${signalName} again; force-stopping the active worker...`);
          activeChild.kill("SIGKILL");
        } else {
          activeChild.kill(signalName);
        }
      } catch (error) {
        console.warn(`Could not forward ${signalName} to the active worker: ${formatError(error)}`);
      }
    }
  };
  const onSigInt = () => interrupt("SIGINT");
  const onSigTerm = () => interrupt("SIGTERM");
  signalTarget.on("SIGINT", onSigInt);
  signalTarget.on("SIGTERM", onSigTerm);

  try {
    for (const item of pending) {
      if (interruptedExitCode) {
        break;
      }

      const startedAt = now();
      let worker;
      try {
        worker = startWorker(item, options.force, heapMb);
      } catch (error) {
        const status = interruptedExitCode ? "interrupted" : "failed";
        const timing = appendPdfToHepTiming(timings, item, status, now() - startedAt);
        if (interruptedExitCode) {
          console.error(
            `[${item.fileNumber}/${item.fileCount}] Interrupted ${item.pdfPath} after ` +
            formatPdfToHepDuration(timing.durationMs)
          );
          continue;
        }
        failures.push({ pdfPath: item.pdfPath, message: formatError(error) });
        console.error(
          `[${item.fileNumber}/${item.fileCount}] Could not start worker for ` +
          `${item.pdfPath} after ${formatPdfToHepDuration(timing.durationMs)}: ${formatError(error)}`
        );
        continue;
      }

      activeChild = worker.child;
      const workerPid = worker.child.pid;
      let outcome;
      let workerFinishedAt;
      try {
        outcome = await worker.completion;
        workerFinishedAt = now();
      } catch (error) {
        workerFinishedAt = now();
        const status = interruptedExitCode ? "interrupted" : "failed";
        const timing = appendPdfToHepTiming(
          timings,
          item,
          status,
          workerFinishedAt - startedAt
        );
        if (interruptedExitCode) {
          console.error(
            `[${item.fileNumber}/${item.fileCount}] Interrupted ${item.pdfPath} after ` +
            formatPdfToHepDuration(timing.durationMs)
          );
          continue;
        }
        failures.push({ pdfPath: item.pdfPath, message: formatError(error) });
        console.error(
          `[${item.fileNumber}/${item.fileCount}] Worker launch failed for ` +
          `${item.pdfPath} after ${formatPdfToHepDuration(timing.durationMs)}: ` +
          formatError(error)
        );
        continue;
      } finally {
        activeChild = null;
        await cleanupWorkerTemps(item.outputPath, workerPid, worker.workerToken);
      }

      const durationMs = workerFinishedAt - startedAt;
      if (interruptedExitCode) {
        const timing = appendPdfToHepTiming(timings, item, "interrupted", durationMs);
        console.error(
          `[${item.fileNumber}/${item.fileCount}] Interrupted ${item.pdfPath} after ` +
          formatPdfToHepDuration(timing.durationMs)
        );
        break;
      }
      if (outcome.code === 0) {
        const timing = appendPdfToHepTiming(timings, item, "generated", durationMs);
        generatedCount += 1;
        console.log(
          `[${item.fileNumber}/${item.fileCount}] Converted ${item.pdfPath} in ` +
          formatPdfToHepDuration(timing.durationMs)
        );
        continue;
      }
      if (outcome.code === PDF_TO_HEP_WORKER_SKIPPED_EXIT_CODE) {
        const timing = appendPdfToHepTiming(timings, item, "skipped", durationMs);
        skippedCount += 1;
        console.log(
          `[${item.fileNumber}/${item.fileCount}] Skipped ${item.pdfPath} after ` +
          formatPdfToHepDuration(timing.durationMs)
        );
        continue;
      }
      if (outcome.code === 130 || outcome.signal === "SIGINT") {
        const timing = appendPdfToHepTiming(timings, item, "interrupted", durationMs);
        interruptedExitCode = 130;
        console.error(
          `[${item.fileNumber}/${item.fileCount}] Interrupted ${item.pdfPath} after ` +
          formatPdfToHepDuration(timing.durationMs)
        );
        break;
      }
      if (outcome.code === 143 || outcome.signal === "SIGTERM") {
        const timing = appendPdfToHepTiming(timings, item, "interrupted", durationMs);
        interruptedExitCode = 143;
        console.error(
          `[${item.fileNumber}/${item.fileCount}] Interrupted ${item.pdfPath} after ` +
          formatPdfToHepDuration(timing.durationMs)
        );
        break;
      }

      const timing = appendPdfToHepTiming(timings, item, "failed", durationMs);
      const detail = outcome.signal
        ? `signal ${outcome.signal}`
        : `exit code ${outcome.code ?? "unknown"}`;
      failures.push({ pdfPath: item.pdfPath, message: detail });
      console.error(
        `[${item.fileNumber}/${item.fileCount}] Conversion worker failed for ` +
        `${item.pdfPath} after ${formatPdfToHepDuration(timing.durationMs)} ` +
        `(${detail}). Continuing with the next PDF.`
      );
    }
  } finally {
    signalTarget.off("SIGINT", onSigInt);
    signalTarget.off("SIGTERM", onSigTerm);
  }

  if (interruptedExitCode) {
    console.log(formatPdfToHepTimingSummary(timings));
    return interruptedExitCode;
  }
  console.log(
    `Finished: ${generatedCount} generated, ${skippedCount} skipped, ${failures.length} failed.`
  );
  console.log(formatPdfToHepTimingSummary(timings));
  return failures.length === 0 ? 0 : 1;
}

export async function runPdfToHep(args = process.argv.slice(2)) {
  const options = parsePdfToHepArguments(args);
  if (options.help) {
    console.log(PDF_TO_HEP_USAGE);
    return 0;
  }

  assertSupportedNodeVersion();
  const workerProcess = isPdfToHepWorkerProcess();
  const pdfPaths = await discoverPdfFiles(options.inputPath);
  assertUniqueHepOutputs(pdfPaths);

  const pending = [];
  let skippedCount = 0;
  for (let index = 0; index < pdfPaths.length; index += 1) {
    const pdfPath = pdfPaths[index];
    const outputPath = hepOutputPathForPdf(pdfPath);
    const outputExists = await regularOutputExists(outputPath);
    if (!options.force && outputExists) {
      console.log(`Skipping existing ${outputPath}`);
      skippedCount += 1;
    } else {
      pending.push({
        pdfPath,
        outputPath,
        fileNumber: index + 1,
        fileCount: pdfPaths.length
      });
    }
  }

  if (pending.length === 0) {
    if (workerProcess) {
      return PDF_TO_HEP_WORKER_SKIPPED_EXIT_CODE;
    }
    console.log(`No files generated; ${skippedCount} existing HEP file(s) skipped.`);
    console.log(formatPdfToHepTimingSummary([]));
    return 0;
  }

  if (!workerProcess) {
    return runPdfToHepWorkerBatch(pending, options, skippedCount);
  }
  if (pending.length !== 1) {
    throw new Error("An internal PDF-to-HEP worker must receive exactly one PDF.");
  }

  installPdfJsCompatibilityShims();
  await assertNodeCanvasAvailable();

  const abortController = new AbortController();
  let interruptedExitCode = 0;
  const interrupt = (signalName) => {
    if (abortController.signal.aborted) {
      return;
    }
    interruptedExitCode = signalName === "SIGINT" ? 130 : 143;
    console.error(`Received ${signalName}; cancelling after the current asynchronous boundary...`);
    abortController.abort(new DOMException("PDF-to-HEP conversion was interrupted.", "AbortError"));
  };
  const onSigInt = () => interrupt("SIGINT");
  const onSigTerm = () => interrupt("SIGTERM");
  // Keep these handlers installed until cleanup finishes. The parent and child
  // can both receive the terminal signal on POSIX, and the parent also forwards
  // it for platforms where process-group delivery is unavailable.
  process.on("SIGINT", onSigInt);
  process.on("SIGTERM", onSigTerm);

  const failures = [];
  let generatedCount = 0;
  let builder;
  let restoreNodeDensePdfWorker = () => {};
  try {
    builder = await loadSourceHepBuilder();
    // PDF.js has already initialized in its Node mode at this point. Install
    // the adapter only for HEPR's dense compiler so its existing browser Worker
    // client can use a real worker_threads isolate without affecting PDF.js.
    restoreNodeDensePdfWorker = installNodeDensePdfWorkerSupport();
    for (let index = 0; index < pending.length; index += 1) {
      abortController.signal.throwIfAborted();
      const { pdfPath, outputPath } = pending[index];
      const sourceLabel = path.basename(pdfPath);
      const batchPosition = readWorkerBatchPosition(index + 1, pending.length);
      const itemNumber = batchPosition.index;
      const itemCount = batchPosition.total;
      console.log(`[${itemNumber}/${itemCount}] Reading ${pdfPath}`);

      try {
        const pdfBytes = await readFile(pdfPath, { signal: abortController.signal });
        abortController.signal.throwIfAborted();
        const hepBlob = await builder.buildParsedDataZip(pdfBytes, {
          sourceLabel,
          signal: abortController.signal,
          onProgress: createProgressLogger(sourceLabel, itemNumber, itemCount)
        });
        abortController.signal.throwIfAborted();
        await writeHepBlobAtomically(
          outputPath,
          hepBlob,
          options.force,
          abortController.signal
        );
        generatedCount += 1;
        console.log(
          `[${itemNumber}/${itemCount}] Wrote ${outputPath} (${formatBytes(hepBlob.size)})`
        );
      } catch (error) {
        if (abortController.signal.aborted) {
          throw error;
        }
        if (error instanceof ExistingOutputError) {
          console.log(`Skipping existing ${outputPath}`);
          skippedCount += 1;
          continue;
        }
        failures.push({ pdfPath, error });
        console.error(`[${itemNumber}/${itemCount}] Failed ${pdfPath}: ${formatError(error)}`);
      }
    }
  } catch (error) {
    if (!abortController.signal.aborted) {
      throw error;
    }
  } finally {
    process.off("SIGINT", onSigInt);
    process.off("SIGTERM", onSigTerm);
    try {
      await builder?.close();
    } finally {
      restoreNodeDensePdfWorker();
    }
  }

  if (abortController.signal.aborted) {
    return interruptedExitCode || 1;
  }

  if (failures.length > 0) {
    return 1;
  }
  return generatedCount === 0 && skippedCount > 0
    ? PDF_TO_HEP_WORKER_SKIPPED_EXIT_CODE
    : 0;
}

function isMainModule() {
  return Boolean(
    process.argv[1] &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  );
}

if (isMainModule()) {
  runPdfToHep().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error) => {
      console.error(`PDF-to-HEP conversion failed: ${formatError(error)}`);
      console.error(`Run node PDFtoHEP.js --help for usage.`);
      process.exitCode = 1;
    }
  );
}
