#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { availableParallelism } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format } from "node:util";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
const PDF_TO_HEP_WORKER_ENV = "HEPR_PDF_TO_HEP_INTERNAL_WORKER";
const PDF_TO_HEP_BATCH_INDEX_ENV = "HEPR_PDF_TO_HEP_BATCH_INDEX";
const PDF_TO_HEP_BATCH_TOTAL_ENV = "HEPR_PDF_TO_HEP_BATCH_TOTAL";
const PDF_TO_HEP_HEAP_ENV = "HEPR_PDF_TO_HEP_HEAP_MB";
const PDF_TO_HEP_WORKER_TOKEN_ENV = "HEPR_PDF_TO_HEP_WORKER_TOKEN";
// Passwords reach worker processes through their environment, never argv.
export const PDF_PASSWORD_ENV = "HEPR_PDF_PASSWORD";
const DEFAULT_PDF_TO_HEP_WORKER_HEAP_MB = 12_288;
const PDF_TO_HEP_WORKER_SKIPPED_EXIT_CODE = 3;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RASTER_FALLBACK_DIAGNOSTIC_CODES = new Set([
  "selective-raster-fallback",
  "retained-raster-fallback",
  "page-raster-fallback"
]);

export const PDF_TO_HEP_USAGE = `Usage:
  node PDFtoHEP.js [--force] [--workers=<count>] [--output-dir=<directory>] <pdf-or-directory>

Options:
  -f, --force  Replace existing regular HEP files after conversion succeeds.
  --keep-unchanged  With --force, leave an existing HEP file untouched when the
      new conversion would only change its generatedAt timestamp.
  -h, --help   Show this help text.
  --output-dir=<directory>  Write all HEP files into this directory.
  --log-file=<path>  Append detailed warnings, errors and worker output to this
      file (default: a timestamped pdf-to-hep-*.log in the current directory).
  --workers=<count>  Maximum simultaneous conversions (default: limited by available
      CPU threads and pending PDFs). Overrides the automatic CPU-based limit.
      Use --workers=1 for serial conversion or a lower count to reduce memory use.
  --without-vector-lod  Omit vector LOD geometry (included by default).
  --without-text-lod  Omit text LOD clusters (included by default when applicable).
  --vector-lod-precision=lossless|compact  Stored vector LOD precision (default: compact).
      compact rounds derived positions according to LOD tolerance; exact geometry stays unchanged.
  --icc-engine=qcms|lcms|alternate|none  ICC conversion (default: qcms).
      qcms/lcms: load the preferred engine only when needed; if unavailable or
                 unsupported, try the other engine, then alternate colors.
      alternate: skip engines and use approximate colors, with a warning.
      none:      disable built-in conversion and approximation; reject ICC content.
      Fallback warnings identify affected pages and the engine used.
  --annotation-appearances=render|forms|none  Annotation appearances compiled
      into page content (default: render). forms keeps only form-field widgets;
      none draws no annotation. Annotation metadata is kept in every mode.
  --password=<password>  User or owner password for PDFs that require one.
      The same password is tried for every PDF. A command-line password can
      show up in process lists and shell history; set the HEPR_PDF_PASSWORD
      environment variable instead to keep it out of both. HEP files store
      the decrypted content and have no password.

Examples:
  node PDFtoHEP.js ./Level1.pdf
  node PDFtoHEP.js ./pdfs
  node PDFtoHEP.js --force ./pdfs
  node PDFtoHEP.js --force --keep-unchanged ./pdfs
  node PDFtoHEP.js --workers=4 ./pdfs

When given a directory, the script scans it recursively and processes regular
.pdf files in isolated child processes. Automatic concurrency is limited by
available CPU threads and the number of pending PDFs. Each freed slot
immediately takes the next PDF; finished processes release their memory.
Outputs use the client export convention <name>-parsed-data.hep and are written
beside their PDFs, unless --output-dir is supplied. Output name collisions are
rejected.
HEP files larger than their source PDFs are written with a warning; selected
LOD caches are retained.
Each run ends with a filename, status, time and size table, including percentage
changes (green for smaller HEPs, red for larger HEPs in color terminals).
A final summary table shows conversion counts, size totals, average and median
attempt times, summed conversion time and elapsed batch wall time.
Detailed warnings, failures and raster-fallback pages/reasons are saved in the
diagnostics log; ordinary embedded PDF images are not counted as fallback.

Existing HEP files are skipped unless --force is supplied. Each child has its
own heap limit (default: 12288 MiB, not preallocated); HEPR_PDF_TO_HEP_HEAP_MB
overrides it. Available RAM and heap limits do not affect the worker count.
Use --workers to control concurrency. The heap limit is not a hard process
memory limit: typed arrays and canvas allocations are outside it.`;

class ExistingOutputError extends Error {
  constructor(outputPath) {
    super(`Output already exists: ${outputPath}`);
    this.name = "ExistingOutputError";
    this.outputPath = outputPath;
  }
}

export function parsePdfToHepArguments(args) {
  let force = false;
  let keepUnchanged = false;
  let help = false;
  let positionalOnly = false;
  let inputPath;
  let outputDirectory;
  let logFile;
  let iccEngine;
  let annotationAppearances;
  let password;
  let withVectorLod = true;
  let withTextLod = true;
  let vectorLodPrecision;
  let workers;

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
    if (!positionalOnly && argument === "--keep-unchanged") {
      keepUnchanged = true;
      continue;
    }
    if (!positionalOnly && argument.startsWith("--workers=")) {
      const value = argument.slice("--workers=".length);
      if (
        workers !== undefined || !/^\d+$/.test(value) ||
        !Number.isSafeInteger(Number(value)) || Number(value) < 1
      ) {
        throw new Error("Pass exactly one --workers=<positive integer>.");
      }
      workers = Number(value);
      continue;
    }
    if (!positionalOnly && argument === "--without-vector-lod") { withVectorLod = false; continue; }
    if (!positionalOnly && argument === "--without-text-lod") { withTextLod = false; continue; }
    if (!positionalOnly && argument.startsWith("--vector-lod-precision=")) {
      const value = argument.slice("--vector-lod-precision=".length);
      if (vectorLodPrecision !== undefined || !["lossless", "compact"].includes(value)) {
        throw new Error("Pass exactly one --vector-lod-precision=lossless or --vector-lod-precision=compact.");
      }
      vectorLodPrecision = value;
      continue;
    }
    if (!positionalOnly && argument.startsWith("--output-dir=")) {
      const value = argument.slice("--output-dir=".length);
      if (!value || outputDirectory !== undefined) {
        throw new Error("Pass exactly one non-empty --output-dir=<directory>.");
      }
      outputDirectory = path.resolve(value);
      continue;
    }
    if (!positionalOnly && argument.startsWith("--log-file=")) {
      const value = argument.slice("--log-file=".length);
      if (!value || logFile !== undefined) {
        throw new Error("Pass exactly one non-empty --log-file=<path>.");
      }
      logFile = path.resolve(value);
      continue;
    }
    if (!positionalOnly && argument.startsWith("--icc-engine=")) {
      const value = argument.slice("--icc-engine=".length);
      if (iccEngine !== undefined || !["qcms", "lcms", "alternate", "none"].includes(value)) {
        throw new Error("Pass exactly one --icc-engine=qcms, --icc-engine=lcms, --icc-engine=alternate, or --icc-engine=none.");
      }
      iccEngine = value;
      continue;
    }
    if (!positionalOnly && argument.startsWith("--annotation-appearances=")) {
      const value = argument.slice("--annotation-appearances=".length);
      if (annotationAppearances !== undefined || !["render", "forms", "none"].includes(value)) {
        throw new Error("Pass exactly one --annotation-appearances=render, --annotation-appearances=forms, or --annotation-appearances=none.");
      }
      annotationAppearances = value;
      continue;
    }
    if (!positionalOnly && argument.startsWith("--password=")) {
      const value = argument.slice("--password=".length);
      if (!value || password !== undefined) {
        throw new Error("Pass exactly one non-empty --password=<password>.");
      }
      password = value;
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
  if (keepUnchanged && !force) {
    // Without --force, existing HEP files are skipped before conversion.
    throw new Error("--keep-unchanged only applies together with --force.");
  }

  return {
    force, help, inputPath, withVectorLod, withTextLod,
    ...(workers === undefined ? {} : { workers }),
    ...(vectorLodPrecision === undefined ? {} : { vectorLodPrecision }),
    ...(keepUnchanged ? { keepUnchanged } : {}),
    ...(outputDirectory === undefined ? {} : { outputDirectory }),
    ...(logFile === undefined ? {} : { logFile }),
    ...(iccEngine === undefined ? {} : { iccEngine }),
    ...(annotationAppearances === undefined ? {} : { annotationAppearances }),
    ...(password === undefined ? {} : { password })
  };
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

export function hepOutputPathForPdf(pdfPath, outputDirectory) {
  const outputName = `${sanitizeHepSourceName(path.basename(pdfPath))}-parsed-data.hep`;
  return path.join(outputDirectory ?? path.dirname(pdfPath), outputName);
}

export function assertUniqueHepOutputs(pdfPaths, outputDirectory) {
  const sourceByOutput = new Map();
  for (const pdfPath of pdfPaths) {
    const outputPath = hepOutputPathForPdf(pdfPath, outputDirectory);
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

export function assertSupportedNodeVersion(version = process.versions.node) {
  const [major, minor] = version.split(".").map(Number);
  // Source workers use node:module.registerHooks(), added in 22.15 and 23.5.
  if (
    !Number.isInteger(major) || !Number.isInteger(minor) || major < 22 ||
    (major === 22 && minor < 15) || (major === 23 && minor < 5)
  ) {
    throw new Error(
      `Node.js 22.15+, 23.5+, or 24+ is required (current version: ${version}).`
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

export function resolvePdfToHepWorkerCount(pendingCount, options, dependencies = {}) {
  if (options.workers !== undefined) return Math.min(pendingCount, options.workers);
  const cpuCount = (dependencies.availableParallelism ?? availableParallelism)();
  return Math.min(pendingCount, cpuCount);
}

export function pdfToHepWorkerArguments(
  pdfPath, force, heapMb, outputDirectory, iccEngine, annotationAppearances, keepUnchanged, withVectorLod, withTextLod, vectorLodPrecision,
  workerScriptPath = scriptPath
) {
  return [
    `--max-old-space-size=${heapMb}`,
    workerScriptPath,
    ...(force ? ["--force"] : []),
    ...(keepUnchanged ? ["--keep-unchanged"] : []),
    ...(withVectorLod === false ? ["--without-vector-lod"] : []),
    ...(withTextLod === false ? ["--without-text-lod"] : []),
    ...(vectorLodPrecision === undefined ? [] : [`--vector-lod-precision=${vectorLodPrecision}`]),
    ...(outputDirectory === undefined ? [] : [`--output-dir=${outputDirectory}`]),
    ...(iccEngine === undefined ? [] : [`--icc-engine=${iccEngine}`]),
    ...(annotationAppearances === undefined ? [] : [`--annotation-appearances=${annotationAppearances}`]),
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

async function assertNodeCanvasAvailable() {
  let canvasModule;
  try {
    canvasModule = await import("@napi-rs/canvas");
  } catch (error) {
    throw new Error(
      "@napi-rs/canvas could not be loaded. Run npm install @soadzoor/hepr @napi-rs/canvas, " +
      "then retry with npx pdf-to-hep (repository users can run npm install); " +
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
    const builderModule = await viteServer.ssrLoadModule("/src/hepBuilder.ts");
    if (typeof builderModule.buildHep !== "function") {
      throw new Error("The HEPR source builder did not export buildHep().");
    }
    const containerModule = await viteServer.ssrLoadModule("/src/hepContainer.ts");
    if (typeof containerModule.HepArchive?.loadAsync !== "function") {
      throw new Error("The HEPR source container did not export HepArchive.");
    }
    return {
      buildHep: builderModule.buildHep,
      HepArchive: containerModule.HepArchive,
      close: () => viteServer.close()
    };
  } catch (error) {
    await viteServer.close();
    throw error;
  }
}

function isPasswordError(error) {
  return error?.code === "encrypted" &&
    (error.details?.reason === "password-required" || error.details?.reason === "password-incorrect");
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

async function readHepManifest(archive) {
  const text = await archive.file("manifest.json")?.async("string");
  const manifest = text === undefined ? undefined : JSON.parse(text);
  return manifest && typeof manifest === "object" && typeof manifest.generatedAt === "string"
    ? manifest
    : undefined;
}

/**
 * True when the candidate HEP would only change the existing file's
 * generatedAt timestamp. The candidate is stamped with the existing timestamp
 * and re-encoded; the container writer is deterministic, so it must reproduce
 * the existing bytes exactly. Encoding-only changes therefore still count.
 * The candidate must come from the default DEFLATE writer, as this CLI's
 * buildHep() calls do, or the re-encoding would not match its encoding.
 */
export async function hepDiffersOnlyInGeneratedAt(existingBytes, candidateBytes, HepArchive, signal) {
  const existing = await HepArchive.loadAsync(existingBytes, { signal });
  const candidate = await HepArchive.loadAsync(candidateBytes, { signal });
  const existingSections = Object.values(existing.files);
  const candidateSections = Object.values(candidate.files);
  // Differing section names, order or lengths are visible in the index, so
  // most real changes are found without decompressing or re-encoding.
  if (
    existingSections.length !== candidateSections.length ||
    existingSections.some((section, index) =>
      section.name !== candidateSections[index].name ||
      section.uncompressedSize !== candidateSections[index].uncompressedSize)
  ) {
    return false;
  }
  const existingManifest = await readHepManifest(existing);
  const candidateManifest = await readHepManifest(candidate);
  if (!existingManifest || !candidateManifest) {
    return false;
  }
  candidateManifest.generatedAt = existingManifest.generatedAt;
  candidate.file("manifest.json", JSON.stringify(candidateManifest));
  const restamped = await candidate.generateAsync({ type: "uint8array", signal });
  return Buffer.compare(restamped, existingBytes) === 0;
}

async function existingHepDiffersOnlyInGeneratedAt(outputPath, hepBlob, HepArchive, signal) {
  try {
    const existingBytes = await readFile(outputPath, { signal });
    const candidateBytes = new Uint8Array(await hepBlob.arrayBuffer());
    return await hepDiffersOnlyInGeneratedAt(existingBytes, candidateBytes, HepArchive, signal);
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    // A missing, unreadable or legacy existing file is simply replaced.
    return false;
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

export function createProgressLogger(sourceLabel, fileNumber, fileCount, {
  now = () => performance.now(),
  write = (message) => console.error(message)
} = {}) {
  let lastStage = "";
  let lastFivePercentBucket = -1;
  let lastLoggedAt = -Infinity;

  return (progress) => {
    const percentage = Math.round(Math.max(0, Math.min(1, Number(progress.value) || 0)) * 100);
    const bucket = Math.floor(percentage / 5);
    const stage = typeof progress.stage === "string" ? progress.stage : "working";
    if (stage === lastStage && bucket <= lastFivePercentBucket) {
      return;
    }
    const timestamp = now();
    // Each page can cycle through several stages at the same percentage.
    // Thousands of synchronous terminal writes can dominate book conversion.
    // Keep percentage milestones and completion immediate, and cap the rest.
    if (bucket <= lastFivePercentBucket && timestamp - lastLoggedAt < 250 &&
        !(stage === "complete" && percentage === 100)) return;
    lastStage = stage;
    lastFivePercentBucket = Math.max(lastFivePercentBucket, bucket);
    lastLoggedAt = timestamp;
    write(`[${fileNumber}/${fileCount}] ${sourceLabel}: ${percentage}% ${stage}`);
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

function formatPdfToHepTable(headers, rows, rightAlignedColumns = []) {
  const cells = [headers, ...rows].map((row) => row.map((value) =>
    String(value).replace(/[\r\n\t]/g, " ")
  ));
  const width = (value) => [...value.replace(/\u001b\[[\d;]*m/g, "")].length;
  const widths = headers.map((_, column) =>
    cells.reduce((maximum, row) => Math.max(maximum, width(row[column])), 0)
  );
  const border = `+${widths.map((length) => "-".repeat(length + 2)).join("+")}+`;
  const line = (row) => `| ${row.map((value, column) => {
    const padding = " ".repeat(widths[column] - width(value));
    return rightAlignedColumns.includes(column) ? padding + value : value + padding;
  }).join(" | ")} |`;
  return [border, line(cells[0]), border, ...cells.slice(1).map(line), border].join("\n");
}

function formatPdfToHepSizeChange(sourceBytes, outputBytes, color, includeBytes = false) {
  if (sourceBytes === undefined || outputBytes === undefined) return "--";
  const change = outputBytes - sourceBytes;
  const sign = change > 0 ? "+" : change < 0 ? "-" : "";
  const percentage = sourceBytes > 0
    ? `${sign}${(Math.abs(change) / sourceBytes * 100).toFixed(2)}%`
    : "--";
  const value = includeBytes
    ? `${sign}${formatBytes(Math.abs(change))} (${percentage})`
    : percentage;
  if (!color || change === 0 || value === "--") return value;
  return `\u001b[${change < 0 ? 32 : 31}m${value}\u001b[0m`;
}

export function formatPdfToHepTimingSummary(timings, { color = false } = {}) {
  if (timings.length === 0) {
    return "Conversion time summary: no PDF conversions were attempted.";
  }
  const rows = timings.map((timing) => {
    const outputBytes = timing.status === "generated" ? timing.outputBytes : undefined;
    return [
      `${timing.fileNumber}/${timing.fileCount}`,
      path.basename(timing.pdfPath).replace(/[\u0000-\u001f\u007f]/g, " "),
      timing.status,
      formatPdfToHepDuration(timing.durationMs),
      timing.sourceBytes === undefined ? "--" : formatBytes(timing.sourceBytes),
      outputBytes === undefined ? "--" : formatBytes(outputBytes),
      formatPdfToHepSizeChange(timing.sourceBytes, outputBytes, color)
    ];
  });
  return "Conversion time summary:\n" + formatPdfToHepTable(
    ["#", "Filename", "Status", "Time", "PDF", "HEP", "Change"], rows, [0, 3, 4, 5, 6]
  );
}

export function formatPdfToHepRasterFallbackSummary(timings) {
  const affected = timings.filter((timing) =>
    timing.status === "generated" && timing.rasterFallbacks?.length > 0
  );
  const lines = ["Raster fallback by PDF:"];
  if (affected.length === 0) {
    lines.push("  None in successful conversions.");
    return lines.join("\n");
  }
  lines.push(`  Successful PDFs using raster fallback: ${affected.length}`);
  for (const timing of affected) {
    lines.push(`  ${timing.pdfPath}:`);
    for (const fallback of timing.rasterFallbacks) {
      const page = fallback.pageIndex === undefined ? "" : `Page ${fallback.pageIndex + 1} `;
      const repeated = fallback.count > 1 ? ` (${fallback.count} times)` : "";
      lines.push(`    ${page}[${fallback.code}]: ${fallback.message}${repeated}`);
      if (fallback.reason && !fallback.message.includes(fallback.reason)) {
        lines.push(`      Reason: ${fallback.reason}`);
      }
    }
  }
  return lines.join("\n");
}

export function formatPdfToHepSummary(
  timings,
  skippedCount,
  notAttemptedCount = 0,
  { wallTimeMs, color = false } = {}
) {
  const successful = timings.filter((timing) => timing.status === "generated");
  const failed = timings.filter((timing) => timing.status === "failed");
  const interrupted = timings.filter((timing) => timing.status === "interrupted");
  // Compare the same documents; failed and skipped PDFs have no new HEP.
  const sized = successful.filter((timing) =>
    timing.sourceBytes !== undefined && timing.outputBytes !== undefined
  );
  const sourceBytes = sized.reduce((total, timing) => total + timing.sourceBytes, 0);
  const outputBytes = sized.reduce((total, timing) => total + timing.outputBytes, 0);
  const withWarnings = timings.filter((timing) => timing.warnings?.length > 0);
  const warningCount = withWarnings.reduce((total, timing) =>
    total + timing.warnings.reduce((count, warning) => count + warning.count, 0), 0
  );
  const rows = [
    ["PDFs attempted", timings.length],
    ["Successful", successful.length],
    ["Failed", failed.length],
    ["Skipped", skippedCount]
  ];
  if (interrupted.length > 0) rows.push(["Interrupted", interrupted.length]);
  if (notAttemptedCount > 0) rows.push(["Not attempted", notAttemptedCount]);
  if (sized.length < successful.length) {
    rows.push(["File sizes available (successful)", `${sized.length}/${successful.length}`]);
  }
  const sizesUnavailable = successful.length > 0 && sized.length === 0;
  rows.push(
    ["Original PDFs (successful)", sizesUnavailable ? "unavailable" : formatBytes(sourceBytes)],
    ["Generated HEPs (successful)", sizesUnavailable ? "unavailable" : formatBytes(outputBytes)],
    ["Size change (successful)", sizesUnavailable ? "--" : formatPdfToHepSizeChange(sourceBytes, outputBytes, color, true)],
    ["HEPs larger than original PDFs", sized.filter((timing) => timing.outputBytes > timing.sourceBytes).length],
    ["Warnings", `${warningCount} across ${withWarnings.length} PDF(s)`],
    ["Successful PDFs using raster fallback", successful.filter((timing) => timing.rasterFallbacks?.length > 0).length]
  );
  const durations = timings.map((timing) => Number(timing.durationMs))
    .map((duration) => Number.isFinite(duration) && duration > 0 ? duration : 0)
    .sort((left, right) => left - right);
  const totalDurationMs = durations.reduce((total, duration) => total + duration, 0);
  const middle = Math.floor(durations.length / 2);
  const medianDurationMs = durations.length === 0 ? 0 : durations.length % 2
    ? durations[middle]
    : (durations[middle - 1] + durations[middle]) / 2;
  const durationValue = (duration) => durations.length === 0 ? "--" : formatPdfToHepDuration(duration);
  rows.push(
    ["Total attempted conversion time (summed)", formatPdfToHepDuration(totalDurationMs)],
    ["Average attempted PDF time", durationValue(totalDurationMs / durations.length)],
    ["Median attempted PDF time", durationValue(medianDurationMs)],
    ["Fastest attempted PDF time", durationValue(durations[0])],
    ["Slowest attempted PDF time", durationValue(durations.at(-1))]
  );
  if (wallTimeMs !== undefined) rows.push(["Batch wall time (elapsed)", formatPdfToHepDuration(wallTimeMs)]);
  return "Conversion summary:\n" + formatPdfToHepTable(["Metric", "Value"], rows);
}

export function formatPdfToHepDiagnosticsSummary(timings) {
  const failed = timings.filter((timing) => timing.status === "failed");
  const withWarnings = timings.filter((timing) => timing.warnings?.length > 0);
  const details = [];
  if (failed.length > 0) {
    details.push("Failed PDFs:");
    for (const timing of failed) {
      details.push(`  ${timing.pdfPath}: ${timing.errorMessage ?? "conversion failed"}`);
    }
  }
  if (withWarnings.length > 0) {
    details.push("Warnings by PDF:");
    for (const timing of withWarnings) {
      details.push(`  ${timing.pdfPath}:`);
      for (const warning of timing.warnings) {
        details.push(`    ${warning.message}${warning.count > 1 ? ` (${warning.count} times)` : ""}`);
      }
    }
  }
  return [...details, formatPdfToHepRasterFallbackSummary(timings)].join("\n");
}

function normalizeRasterFallbackDiagnostic(diagnostic) {
  if (
    !RASTER_FALLBACK_DIAGNOSTIC_CODES.has(diagnostic.code) ||
    typeof diagnostic.message !== "string" || diagnostic.message.trim().length === 0 ||
    (diagnostic.pageIndex !== undefined &&
      (!Number.isSafeInteger(diagnostic.pageIndex) || diagnostic.pageIndex < 0)) ||
    (diagnostic.reason !== undefined &&
      (typeof diagnostic.reason !== "string" || diagnostic.reason.trim().length === 0))
  ) return null;
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.pageIndex === undefined ? {} : { pageIndex: diagnostic.pageIndex }),
    ...(diagnostic.reason === undefined ? {} : { reason: diagnostic.reason })
  };
}

function appendPdfToHepTiming(timings, item, status, durationMs, report) {
  const timing = {
    pdfPath: item.pdfPath,
    fileNumber: item.fileNumber,
    fileCount: item.fileCount,
    status,
    durationMs: Math.max(0, Number(durationMs) || 0),
    ...report,
    // A candidate that was never written must not count as generated output.
    ...(status === "generated" ? {} : { outputBytes: undefined })
  };
  timings.push(timing);
  return timing;
}

async function assertSeparatePdfToHepDiagnosticLog(logPath, items) {
  const logStats = await lstat(logPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  if (logStats && !logStats.isFile()) {
    throw new Error("The diagnostics log must be a regular file, not a symlink or special file.");
  }
  const directories = new Map();
  const canonicalDirectory = (directory) => {
    if (!directories.has(directory)) {
      directories.set(directory, realpath(directory).catch(async (error) => {
        const parent = path.dirname(directory);
        if (error?.code !== "ENOENT" || parent === directory) throw error;
        return path.join(await canonicalDirectory(parent), path.basename(directory));
      }));
    }
    return directories.get(directory);
  };
  const canonicalPath = async (filePath) => path.join(
    await canonicalDirectory(path.dirname(filePath)), path.basename(filePath)
  );
  const canonicalLogPath = await canonicalPath(logPath);
  for (const item of items) {
    for (const filePath of [item.pdfPath, item.outputPath]) {
      if (canonicalLogPath === await canonicalPath(filePath)) {
        throw new Error("The diagnostics log must be separate from the PDF and HEP files.");
      }
      if (logStats) {
        const fileStats = await stat(filePath).catch((error) => {
          if (error?.code !== "ENOENT") throw error;
        });
        if (fileStats && fileStats.dev === logStats.dev && fileStats.ino === logStats.ino) {
          throw new Error("The diagnostics log must be separate from the PDF and HEP files.");
        }
      }
    }
  }
}

export async function createPdfToHepDiagnosticLog(options, pending) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = path.resolve(options.logFile ?? `pdf-to-hep-${timestamp}-${randomUUID()}.log`);
  // Check custom append destinations before writing anything to an input or
  // output archive, including aliases through links.
  if (options.logFile !== undefined) await assertSeparatePdfToHepDiagnosticLog(logPath, pending);
  await mkdir(path.dirname(logPath), { recursive: true });
  const file = await open(logPath, "a");
  let writes = Promise.resolve();
  const log = {
    path: logPath,
    fd: file.fd,
    write(message) {
      writes = writes.then(() => file.writeFile(`${message}\n`));
      // A failed append is surfaced by close(), without an unhandled rejection
      // while other workers are still converting.
      writes.catch(() => {});
    },
    async close() {
      try {
        await writes;
      } finally {
        await file.close();
      }
    }
  };
  log.write(`\nPDF-to-HEP run started at ${new Date().toISOString()}\n` +
    `Input: ${path.resolve(options.inputPath ?? (pending[0] ? path.dirname(pending[0].pdfPath) : process.cwd()))}`);
  try {
    await writes;
  } catch (error) {
    await file.close();
    throw error;
  }
  return log;
}

export function startPdfToHepWorker(
  item,
  force,
  heapMb,
  spawnImplementation = spawn,
  workerScriptPath = scriptPath,
  diagnosticLog
) {
  const workerToken = randomUUID();
  const report = { warnings: [] };
  const warningsByMessage = new Map();
  const rasterFallbacksByDiagnostic = new Map();
  const child = spawnImplementation(
    process.execPath,
    pdfToHepWorkerArguments(
      item.pdfPath, force, heapMb, item.outputDirectory, item.iccEngine, item.annotationAppearances, item.keepUnchanged,
      item.withVectorLod, item.withTextLod, item.vectorLodPrecision, workerScriptPath
    ),
    {
      // Raw output includes native crashes and third-party diagnostics that
      // never reach IPC. Writing directly to the shared append-only file also
      // avoids buffering large worker logs in the parent process.
      stdio: ["inherit", diagnosticLog?.fd ?? "inherit", diagnosticLog?.fd ?? "inherit", "ipc"],
      shell: false,
      env: {
        ...process.env,
        ...(item.password ? { [PDF_PASSWORD_ENV]: item.password } : {}),
        [PDF_TO_HEP_WORKER_ENV]: "1",
        [PDF_TO_HEP_BATCH_INDEX_ENV]: String(item.fileNumber),
        [PDF_TO_HEP_BATCH_TOTAL_ENV]: String(item.fileCount),
        [PDF_TO_HEP_WORKER_TOKEN_ENV]: workerToken
      }
    }
  );

  child.on("message", (message) => {
    if (message?.type === "pdf-to-hep-warning" && typeof message.message === "string") {
      const previous = warningsByMessage.get(message.message);
      if (previous) previous.count += 1;
      else {
        const warning = { message: message.message, count: 1 };
        warningsByMessage.set(message.message, warning);
        report.warnings.push(warning);
      }
    } else if (message?.type === "pdf-to-hep-progress" && typeof message.message === "string") {
      console.error(message.message);
    } else if (message?.type === "pdf-to-hep-raster-fallback") {
      const diagnostic = normalizeRasterFallbackDiagnostic(message);
      if (!diagnostic) return;
      const key = JSON.stringify(diagnostic);
      const previous = rasterFallbacksByDiagnostic.get(key);
      if (previous) previous.count += 1;
      else {
        const fallback = { ...diagnostic, count: 1 };
        rasterFallbacksByDiagnostic.set(key, fallback);
        (report.rasterFallbacks ??= []).push(fallback);
      }
    } else if (message?.type === "pdf-to-hep-error" && typeof message.message === "string") {
      report.errorMessage = message.message;
    } else if (message?.type === "pdf-to-hep-sizes") {
      for (const key of ["sourceBytes", "outputBytes"]) {
        if (Number.isSafeInteger(message[key]) && message[key] >= 0) report[key] = message[key];
      }
    }
  });

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

  return { child, completion, workerToken, report };
}

async function cleanupPdfToHepWorkerTemps(outputPath, workerPid, workerToken, onWarning = console.warn) {
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
    onWarning(`Could not inspect worker temporary files in ${directoryPath}: ${formatError(error)}`);
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(temporaryPrefix) || !entry.name.endsWith(".tmp")) {
      continue;
    }
    const temporaryPath = path.join(directoryPath, entry.name);
    await unlink(temporaryPath).catch((error) => {
      if (error?.code !== "ENOENT") {
        onWarning(`Could not remove worker temporary file ${temporaryPath}: ${formatError(error)}`);
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
  let diagnosticLog;
  try {
    diagnosticLog = await (dependencies.createDiagnosticLog ?? createPdfToHepDiagnosticLog)(options, pending);
  } catch (error) {
    console.warn(`Could not open the diagnostics log: ${formatError(error)}. Worker output will appear in the terminal.`);
  }
  try {
    return await runPdfToHepWorkerBatchWithLog(pending, options, skippedCount, dependencies, diagnosticLog);
  } finally {
    await diagnosticLog?.close().catch((error) => {
      console.warn(`Could not finish writing diagnostics log ${diagnosticLog.path}: ${formatError(error)}`);
    });
  }
}

async function runPdfToHepWorkerBatchWithLog(pending, options, skippedCount, dependencies, diagnosticLog) {
  const heapMb = dependencies.heapMb ?? resolvePdfToHepWorkerHeapMb();
  const startWorker = dependencies.startWorker ?? ((item, force, heapMb) =>
    startPdfToHepWorker(item, force, heapMb, spawn, dependencies.workerScriptPath, diagnosticLog)
  );
  const cleanupWorkerTemps = dependencies.cleanupWorkerTemps ?? cleanupPdfToHepWorkerTemps;
  const signalTarget = dependencies.signalTarget ?? process;
  const now = dependencies.now ?? (() => performance.now());
  const workerCount = resolvePdfToHepWorkerCount(pending.length, options, dependencies);
  const batchStartedAt = now();
  const activeChildren = new Set();
  let nextIndex = 0;
  let interruptedExitCode = 0;
  let generatedCount = 0;
  const failures = [];
  const timings = [];
  const color = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined &&
    process.env.TERM !== "dumb" && process.env.FORCE_COLOR !== "0";
  const warn = (message) => diagnosticLog ? diagnosticLog.write(message) : console.warn(message);
  const failureDetail = (message) => diagnosticLog ? "See diagnostics log." : message;

  const interrupt = (signalName) => {
    const repeatedSignal = interruptedExitCode !== 0;
    if (!repeatedSignal) {
      interruptedExitCode = signalName === "SIGINT" ? 130 : 143;
      console.error(`Received ${signalName}; stopping the PDF-to-HEP batch...`);
    }
    if (repeatedSignal) {
      console.error(`Received ${signalName} again; force-stopping the active workers...`);
    }
    for (const activeChild of activeChildren) {
      if (activeChild.exitCode !== null || activeChild.signalCode !== null) {
        continue;
      }
      try {
        if (repeatedSignal) {
          activeChild.kill("SIGKILL");
        } else {
          activeChild.kill(signalName);
        }
      } catch (error) {
        warn(`Could not forward ${signalName} to the active worker: ${formatError(error)}`);
      }
    }
  };
  const onSigInt = () => interrupt("SIGINT");
  const onSigTerm = () => interrupt("SIGTERM");
  signalTarget.on("SIGINT", onSigInt);
  signalTarget.on("SIGTERM", onSigTerm);

  // Each consumer claims the next PDF synchronously, before awaiting its child.
  // Fast PDFs refill their own slots without waiting for slower conversions.
  const runNext = async () => {
    while (!interruptedExitCode && nextIndex < pending.length) {
      const item = pending[nextIndex++];
      const startedAt = now();
      let worker;
      try {
        worker = startWorker(item, options.force, heapMb);
      } catch (error) {
        const status = interruptedExitCode ? "interrupted" : "failed";
        const timing = appendPdfToHepTiming(timings, item, status, now() - startedAt, {
          errorMessage: formatError(error)
        });
        if (interruptedExitCode) {
          console.error(
            `[${item.fileNumber}/${item.fileCount}] Interrupted ${path.basename(item.pdfPath)} after ` +
            formatPdfToHepDuration(timing.durationMs)
          );
          continue;
        }
        failures.push({ pdfPath: item.pdfPath, message: formatError(error) });
        diagnosticLog?.write(`Could not start worker for ${item.pdfPath}: ${formatError(error)}`);
        console.error(
          `[${item.fileNumber}/${item.fileCount}] Could not start worker for ` +
          `${path.basename(item.pdfPath)} after ${formatPdfToHepDuration(timing.durationMs)}. ` +
          failureDetail(formatError(error))
        );
        continue;
      }

      activeChildren.add(worker.child);
      const report = worker.report ?? { warnings: [] };
      const workerWarning = (message) => {
        warn(`${item.pdfPath}: ${message}`);
        report.warnings.push({ message, count: 1 });
      };
      const workerPid = worker.child.pid;
      let outcome;
      let workerFinishedAt;
      try {
        outcome = await worker.completion;
        workerFinishedAt = now();
        // A child may receive a terminal signal before the parent does. Stop
        // dispatch immediately and cancel siblings before asynchronous cleanup.
        if (!interruptedExitCode) {
          if (outcome.code === 130 || outcome.signal === "SIGINT") interrupt("SIGINT");
          else if (outcome.code === 143 || outcome.signal === "SIGTERM") interrupt("SIGTERM");
        }
      } catch (error) {
        workerFinishedAt = now();
        const status = interruptedExitCode ? "interrupted" : "failed";
        const timing = appendPdfToHepTiming(
          timings,
          item,
          status,
          workerFinishedAt - startedAt,
          { ...report, errorMessage: report.errorMessage ?? formatError(error) }
        );
        if (interruptedExitCode) {
          console.error(
            `[${item.fileNumber}/${item.fileCount}] Interrupted ${path.basename(item.pdfPath)} after ` +
            formatPdfToHepDuration(timing.durationMs)
          );
          continue;
        }
        failures.push({ pdfPath: item.pdfPath, message: formatError(error) });
        diagnosticLog?.write(`Worker launch failed for ${item.pdfPath}: ${formatError(error)}`);
        console.error(
          `[${item.fileNumber}/${item.fileCount}] Worker launch failed for ` +
          `${path.basename(item.pdfPath)} after ${formatPdfToHepDuration(timing.durationMs)}. ` +
          failureDetail(formatError(error))
        );
        continue;
      } finally {
        activeChildren.delete(worker.child);
        await cleanupWorkerTemps(item.outputPath, workerPid, worker.workerToken, workerWarning).catch((error) => {
          workerWarning(`Could not clean up worker temporary files: ${formatError(error)}`);
        });
      }

      const durationMs = workerFinishedAt - startedAt;
      if (interruptedExitCode) {
        const timing = appendPdfToHepTiming(timings, item, "interrupted", durationMs, report);
        console.error(
          `[${item.fileNumber}/${item.fileCount}] Interrupted ${path.basename(item.pdfPath)} after ` +
          formatPdfToHepDuration(timing.durationMs)
        );
        break;
      }
      if (outcome.code === 0) {
        const timing = appendPdfToHepTiming(timings, item, "generated", durationMs, report);
        generatedCount += 1;
        console.log(
          `[${item.fileNumber}/${item.fileCount}] Converted ${path.basename(item.pdfPath)} in ` +
          formatPdfToHepDuration(timing.durationMs)
        );
        continue;
      }
      if (outcome.code === PDF_TO_HEP_WORKER_SKIPPED_EXIT_CODE) {
        const timing = appendPdfToHepTiming(timings, item, "skipped", durationMs, report);
        skippedCount += 1;
        console.log(
          `[${item.fileNumber}/${item.fileCount}] Skipped ${path.basename(item.pdfPath)} after ` +
          formatPdfToHepDuration(timing.durationMs)
        );
        continue;
      }
      const detail = outcome.signal
        ? `signal ${outcome.signal}`
        : `exit code ${outcome.code ?? "unknown"}`;
      const timing = appendPdfToHepTiming(timings, item, "failed", durationMs, {
        ...report,
        errorMessage: report.errorMessage ?? detail
      });
      failures.push({ pdfPath: item.pdfPath, message: detail });
      diagnosticLog?.write(`Conversion worker failed for ${item.pdfPath}: ${timing.errorMessage} (${detail})`);
      console.error(
        `[${item.fileNumber}/${item.fileCount}] Conversion worker failed for ` +
        `${path.basename(item.pdfPath)} after ${formatPdfToHepDuration(timing.durationMs)} ` +
        `(${detail}). Continuing with the next PDF. ` + failureDetail("")
      );
    }
  };

  if (diagnosticLog) console.log(`Diagnostics log: ${diagnosticLog.path}`);
  console.log(`Converting ${pending.length} PDF(s) with up to ${workerCount} worker(s).`);
  try {
    // Keep signal forwarding installed until all active children have finished.
    const results = await Promise.allSettled(Array.from({ length: workerCount }, () => runNext()));
    const rejection = results.find((result) => result.status === "rejected");
    if (rejection) throw rejection.reason;
  } finally {
    signalTarget.off("SIGINT", onSigInt);
    signalTarget.off("SIGTERM", onSigTerm);
  }

  timings.sort((left, right) => left.fileNumber - right.fileNumber);
  const wallTimeMs = now() - batchStartedAt;
  const notAttemptedCount = interruptedExitCode ? pending.length - timings.length : 0;
  const diagnostics = formatPdfToHepDiagnosticsSummary(timings);
  if (diagnosticLog) {
    diagnosticLog.write(diagnostics);
    diagnosticLog.write(formatPdfToHepTimingSummary(timings));
    diagnosticLog.write(formatPdfToHepSummary(timings, skippedCount, notAttemptedCount, { wallTimeMs }));
  } else {
    console.log(diagnostics);
  }
  if (!interruptedExitCode) {
    console.log(`Finished: ${generatedCount} generated, ${skippedCount} skipped, ${failures.length} failed.`);
  }
  console.log(formatPdfToHepTimingSummary(timings, { color }));
  if (diagnosticLog) console.log(`Diagnostics log: ${diagnosticLog.path}`);
  console.log(formatPdfToHepSummary(timings, skippedCount, notAttemptedCount, { wallTimeMs, color }));
  return interruptedExitCode || (failures.length === 0 ? 0 : 1);
}

export async function runPdfToHep(args = process.argv.slice(2), dependencies = {}) {
  const options = parsePdfToHepArguments(args);
  if (options.help) {
    const usageCommand = dependencies.usageCommand ?? "node PDFtoHEP.js";
    console.log(PDF_TO_HEP_USAGE.replaceAll("node PDFtoHEP.js", usageCommand));
    return 0;
  }

  assertSupportedNodeVersion();
  const workerProcess = isPdfToHepWorkerProcess();
  const password = options.password ?? (process.env[PDF_PASSWORD_ENV] || undefined);
  const pdfPaths = await discoverPdfFiles(options.inputPath);
  assertUniqueHepOutputs(pdfPaths, options.outputDirectory);
  if (options.logFile !== undefined) {
    // Include skipped files: a log must never append into an existing HEP just
    // because its PDF did not need another conversion.
    await assertSeparatePdfToHepDiagnosticLog(options.logFile, pdfPaths.map((pdfPath) => ({
      pdfPath,
      outputPath: hepOutputPathForPdf(pdfPath, options.outputDirectory)
    })));
  }

  const pending = [];
  let skippedCount = 0;
  for (let index = 0; index < pdfPaths.length; index += 1) {
    const pdfPath = pdfPaths[index];
    const outputPath = hepOutputPathForPdf(pdfPath, options.outputDirectory);
    const outputExists = await regularOutputExists(outputPath);
    if (!options.force && outputExists) {
      console.log(`Skipping existing ${outputPath}`);
      skippedCount += 1;
    } else {
      pending.push({
        pdfPath,
        outputPath,
        outputDirectory: options.outputDirectory,
        iccEngine: options.iccEngine,
        annotationAppearances: options.annotationAppearances,
        keepUnchanged: options.keepUnchanged,
        withVectorLod: options.withVectorLod,
        withTextLod: options.withTextLod,
        vectorLodPrecision: options.vectorLodPrecision,
        ...(password === undefined ? {} : { password }),
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
    console.log(formatPdfToHepSummary([], skippedCount));
    return 0;
  }

  if (options.outputDirectory !== undefined) {
    await mkdir(options.outputDirectory, { recursive: true });
  }
  if (!workerProcess) {
    return runPdfToHepWorkerBatch(pending, options, skippedCount, dependencies);
  }
  if (pending.length !== 1) {
    throw new Error("An internal PDF-to-HEP worker must receive exactly one PDF.");
  }

  const report = dependencies.reportWorkerEvent ?? reportPdfToHepWorkerEvent;
  const originalWarn = console.warn;
  // Workers handle a single PDF, so all warnings (including direct builder
  // console.warn calls) can be attributed to it without parsing console output.
  console.warn = (...args) => {
    originalWarn(...args);
    report({ type: "pdf-to-hep-warning", message: format(...args) });
  };
  try {
    return await convertPdfToHep(pending, options, password, skippedCount, dependencies, report);
  } catch (error) {
    report({ type: "pdf-to-hep-error", message: formatError(error) });
    throw error;
  } finally {
    console.warn = originalWarn;
  }
}

function reportPdfToHepWorkerEvent(event) {
  if (!process.connected || typeof process.send !== "function") return;
  // Reporting must not turn a usable conversion into a failure if the parent
  // disconnects during cancellation. The callback also handles async errors.
  try {
    process.send(event, () => {});
  } catch {
    // The parent may have disconnected between checking and sending.
  }
}

async function convertPdfToHep(pending, options, password, skippedCount, dependencies, report) {
  await (dependencies.assertCanvasAvailable ?? assertNodeCanvasAvailable)();

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
  try {
    builder = await (dependencies.loadBuilder ?? loadSourceHepBuilder)();
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
        report({ type: "pdf-to-hep-sizes", sourceBytes: pdfBytes.byteLength });
        abortController.signal.throwIfAborted();
        const hepBlob = await builder.buildHep(pdfBytes, {
          sourceLabel,
          withVectorLod: options.withVectorLod,
          withTextLod: options.withTextLod,
          vectorLodPrecision: options.vectorLodPrecision,
          signal: abortController.signal,
          password,
          iccEngine: options.iccEngine,
          annotationAppearances: options.annotationAppearances,
          onDiagnostic: (diagnostic) => {
            if (diagnostic.severity !== "warning") return;
            const reason = diagnostic.details?.reasons ?? diagnostic.details?.reason;
            const fallback = normalizeRasterFallbackDiagnostic({
              code: diagnostic.code,
              message: diagnostic.message,
              ...(diagnostic.pageIndex === undefined ? {} : { pageIndex: diagnostic.pageIndex }),
              ...(typeof reason === "string" && reason.trim().length > 0 ? { reason } : {})
            });
            if (fallback) report({ type: "pdf-to-hep-raster-fallback", ...fallback });
            const page = diagnostic.pageIndex === undefined ? "" : ` page ${diagnostic.pageIndex + 1}`;
            console.warn(`${sourceLabel}${page}: [${diagnostic.code}] ${diagnostic.message}`);
          },
          onProgress: createProgressLogger(sourceLabel, itemNumber, itemCount,
            process.connected ? { write: (message) => report({ type: "pdf-to-hep-progress", message }) } : {})
        });
        abortController.signal.throwIfAborted();
        if (options.keepUnchanged && await existingHepDiffersOnlyInGeneratedAt(
          outputPath,
          hepBlob,
          builder.HepArchive,
          abortController.signal
        )) {
          console.log(
            `[${itemNumber}/${itemCount}] Kept ${outputPath}; only its generatedAt timestamp would change`
          );
        } else {
          await writeHepBlobAtomically(
            outputPath,
            hepBlob,
            options.force,
            abortController.signal
          );
          console.log(
            `[${itemNumber}/${itemCount}] Wrote ${outputPath} (${formatBytes(hepBlob.size)})`
          );
        }
        report({ type: "pdf-to-hep-sizes", outputBytes: hepBlob.size });
        generatedCount += 1;
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
        report({ type: "pdf-to-hep-error", message: formatError(error) });
        console.error(`[${itemNumber}/${itemCount}] Failed ${pdfPath}: ${formatError(error)}`);
        if (isPasswordError(error)) {
          console.error(`Pass --password=<password> or set ${PDF_PASSWORD_ENV} to convert password-protected PDFs.`);
        }
      }
    }
  } catch (error) {
    if (!abortController.signal.aborted) {
      throw error;
    }
  } finally {
    process.off("SIGINT", onSigInt);
    process.off("SIGTERM", onSigTerm);
    await builder?.close();
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
