import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  installNativeDenseBenchmarkRuntime,
  loadNativeDenseBenchmarkModules,
  registerNativeDenseBenchmarkHooks,
  runNativeDenseBenchmark,
  summarizeNativeDenseCounts
} from "./lib/nativeDenseBenchmark.mjs";

const DEFAULT_PDF = fileURLToPath(
  new URL("../public/examples/pdfs/Livermore_L1.pdf", import.meta.url)
);
const LIVERMORE_COUNTS = Object.freeze({
  operators: 6_209_850,
  sourceSegments: 6_187_497,
  mergedSegments: 6_187_497,
  visibleSegments: 887_355,
  duplicateRemovals: 5_088_373,
  containedRemovals: 211_769,
  fillPaths: 2_571,
  fillSegments: 10_397,
  sourceText: 23_572,
  textInstances: 23_572,
  glyphs: 168,
  glyphSegments: 2_223
});

let arguments_;
try {
  arguments_ = parseArguments(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  printUsage(process.stderr);
  process.exitCode = 1;
}

if (arguments_?.showHelp) {
  printUsage();
} else if (arguments_) {
  await run(arguments_);
}

async function run({ inputPath, pages }) {
  installNativeDenseBenchmarkRuntime();
  const hooks = registerNativeDenseBenchmarkHooks();
  try {
    const absoluteInputPath = resolve(inputPath ?? DEFAULT_PDF);
    const assertLivermoreCounts = absoluteInputPath === resolve(DEFAULT_PDF) && !pages;
    const moduleStartedAt = performance.now();
    const modules = await loadNativeDenseBenchmarkModules();
    const moduleLoadMs = performance.now() - moduleStartedAt;
    const readStartedAt = performance.now();
    const pdfBytes = new Uint8Array(await readFile(absoluteInputPath));
    const readMs = performance.now() - readStartedAt;

    console.log("Livermore native dense-vector benchmark");
    console.log(`Input: ${absoluteInputPath}`);
    console.log(`Pages: ${pages ?? "all"}`);
    console.log(`File size: ${formatInteger(pdfBytes.length)} bytes`);

    collectGarbage();
    const memory = createMemorySampler();
    const result = await runNativeDenseBenchmark(pdfBytes, modules, {
      ...(pages ? { pages } : {}),
      enableSegmentMerge: true,
      enableInvisibleCull: true,
      onProgress(progress) {
        console.error(
          `  page ${progress.pageIndex + 1}/${progress.pageCount} ${progress.phase}: ` +
          `${formatInteger(progress.operatorCount)} operators, ` +
          `${formatInteger(progress.sourceSegmentCount)} source segments`
        );
      }
    });
    const peak = memory.stop();
    if (result.kind !== "success") {
      throw new Error(
        `Native dense path rejected Livermore (${result.reason}): ${result.message}`
      );
    }

    const counts = summarizeNativeDenseCounts(result);
    const fingerprint = fingerprintNativeOutput(result);

    console.log("\nNative pipeline timings");
    printTiming("module load", moduleLoadMs);
    printTiming("read input", readMs);
    printTiming("native preflight", result.timing.preflightMs);
    printTiming("content decode (pull)", result.timing.decodeMs);
    printTiming("geometry compile", result.timing.compileMs);
    printTiming("decode + compile wall", result.timing.compileWallMs);
    printTiming("direct native text", result.timing.nativeTextMs);
    printTiming("native pipeline total", result.timing.totalMs);
    printMemory("sampled peak", peak);

    console.log("\nNative output counts");
    printCounts(counts);
    console.log(`semantic SHA-256           ${fingerprint}`);
    if (assertLivermoreCounts) {
      assert.deepEqual(counts, LIVERMORE_COUNTS, "Livermore locked counts changed.");
      console.log("Livermore locked counts: PASS");
    } else {
      console.log("Locked-count assertion skipped for a custom input or page selection.");
    }
  } finally {
    hooks.deregister();
  }
}

function fingerprintNativeOutput(result) {
  const hash = createHash("sha256");
  hash.update("hepr-native-dense-benchmark-v1;");
  for (const { structuralPage, geometry, compiled } of result.compiledPages) {
    hashCanonicalValue(hash, {
      sourcePageIndex: structuralPage.sourcePageIndex,
      mediaBox: structuralPage.mediaBox,
      cropBox: structuralPage.cropBox,
      rotation: structuralPage.rotation,
      userUnit: structuralPage.userUnit,
      pageMatrix: geometry.pageMatrix,
      pageBounds: geometry.pageBounds,
      operatorCount: compiled.operatorCount,
      sourceSegmentCount: compiled.sourceSegmentCount,
      mergedSegmentCount: compiled.mergedSegmentCount,
      segmentCount: compiled.segmentCount,
      fillPathCount: compiled.fillPathCount,
      fillSegmentCount: compiled.fillSegmentCount,
      discardedTransparentCount: compiled.discardedTransparentCount,
      discardedDegenerateCount: compiled.discardedDegenerateCount,
      discardedDuplicateCount: compiled.discardedDuplicateCount,
      discardedContainedCount: compiled.discardedContainedCount,
      endpoints: compiled.endpoints,
      primitiveMeta: compiled.primitiveMeta,
      primitiveBounds: compiled.primitiveBounds,
      styles: compiled.styles,
      fillPathMetaA: compiled.fillPathMetaA,
      fillPathMetaB: compiled.fillPathMetaB,
      fillPathMetaC: compiled.fillPathMetaC,
      fillSegmentsA: compiled.fillSegmentsA,
      fillSegmentsB: compiled.fillSegmentsB
    }, new Set());
  }
  for (const scene of result.textScenes) {
    hashCanonicalValue(hash, scene, new Set());
  }
  return hash.digest("hex");
}

function hashCanonicalValue(hash, value, ancestors) {
  if (value === null) {
    hash.update("null;");
    return;
  }
  if (value === undefined) {
    hash.update("undefined;");
    return;
  }
  switch (typeof value) {
    case "boolean":
      hash.update(value ? "bool:1;" : "bool:0;");
      return;
    case "number": {
      const bytes = Buffer.allocUnsafe(8);
      bytes.writeDoubleLE(value);
      hash.update("number:");
      hash.update(bytes);
      return;
    }
    case "string":
      hash.update(`string:${Buffer.byteLength(value)}:`);
      hash.update(value);
      return;
    case "object":
      break;
    default:
      throw new TypeError(`Cannot fingerprint value of type ${typeof value}.`);
  }

  if (ArrayBuffer.isView(value)) {
    hash.update(`view:${value.constructor.name}:${value.byteLength}:`);
    hash.update(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    return;
  }
  if (value instanceof ArrayBuffer) {
    hash.update(`buffer:${value.byteLength}:`);
    hash.update(Buffer.from(value));
    return;
  }
  if (ancestors.has(value)) {
    throw new TypeError("Cannot fingerprint a cyclic native benchmark value.");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      hash.update(`array:${value.length}:`);
      for (const item of value) hashCanonicalValue(hash, item, ancestors);
      return;
    }
    const keys = Object.keys(value).sort();
    hash.update(`object:${keys.length}:`);
    for (const key of keys) {
      hash.update(`key:${Buffer.byteLength(key)}:${key}:`);
      hashCanonicalValue(hash, value[key], ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function createMemorySampler() {
  const baseline = process.memoryUsage();
  const peak = { ...baseline };
  const sample = () => {
    const current = process.memoryUsage();
    for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], current[key]);
  };
  const timer = setInterval(sample, 25);
  timer.unref();
  let result = null;
  return {
    stop() {
      if (result) return result;
      clearInterval(timer);
      sample();
      result = {
        rss: peak.rss,
        heapUsed: peak.heapUsed,
        arrayBuffers: peak.arrayBuffers,
        rssDelta: Math.max(0, peak.rss - baseline.rss)
      };
      return result;
    }
  };
}

function collectGarbage() {
  if (typeof globalThis.gc === "function") globalThis.gc();
}

function printMemory(label, memory) {
  console.log(
    `${label.padEnd(29)} ${formatBytes(memory.rss).padStart(11)} RSS ` +
    `(+${formatBytes(memory.rssDelta)}), ${formatBytes(memory.heapUsed)} heap, ` +
    `${formatBytes(memory.arrayBuffers)} buffers`
  );
}

function printTiming(label, elapsedMs) {
  console.log(`${label.padEnd(29)} ${formatMilliseconds(elapsedMs).padStart(11)}`);
}

function printCounts(counts) {
  for (const [name, value] of Object.entries(counts)) {
    console.log(`${name.padEnd(29)} ${formatInteger(value).padStart(11)}`);
  }
}

function formatInteger(value) {
  return Math.trunc(value).toLocaleString("en-US");
}

function formatMilliseconds(value) {
  return `${value.toFixed(1)} ms`;
}

function formatBytes(value) {
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function parseArguments(args) {
  const output = { inputPath: null, pages: undefined, showHelp: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      output.showHelp = true;
    } else if (argument === "--pages") {
      output.pages = readNonEmptyOption("--pages", args[++index]);
    } else if (argument.startsWith("--pages=")) {
      output.pages = readNonEmptyOption("--pages", argument.slice(8));
    } else if (argument.startsWith("-")) {
      throw new TypeError(`Unknown option: ${argument}`);
    } else if (output.inputPath === null) {
      output.inputPath = argument;
    } else {
      throw new TypeError(`Unexpected positional argument: ${argument}`);
    }
  }
  return output;
}

function readNonEmptyOption(name, value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} requires a value.`);
  }
  return value;
}

function printUsage(stream = process.stdout) {
  stream.write(`Usage: npm run benchmark:livermore-pdf -- [PDF path] [options]

Measures the dependency-free native structure, geometry, and retained-text
pipeline with peak-memory sampling and a deterministic semantic hash. The
default Livermore input also checks its locked output counts. Differential
rendering comparisons belong to the isolated oracle workspace.

Options:
  --pages RANGE       One-based page selection, for example 1-5,8
  -h, --help          Show this help
`);
}
