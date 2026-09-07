import assert from "node:assert/strict";
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
  new URL("../public/examples/pdfs/Lower Level.pdf", import.meta.url)
);
const LOWER_LEVEL_COUNTS = Object.freeze({
  sourceSegments: 9_204_524,
  mergedSegments: 8_488_785,
  visibleSegments: 2_253_319,
  duplicateRemovals: 5_341_556,
  containedRemovals: 893_910,
  fillPaths: 1_181,
  fillSegments: 15_513,
  sourceText: 15_669,
  textInstances: 15_669,
  glyphs: 153,
  glyphSegments: 2_556
});
const LOWER_LEVEL_NODE_LEGACY_CULL_VARIANCE = Object.freeze({
  visibleSegments: 2_253_277,
  containedRemovals: 893_952
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
    const moduleStartedAt = performance.now();
    const modules = await loadNativeDenseBenchmarkModules();
    const moduleLoadMs = performance.now() - moduleStartedAt;
    const absoluteInputPath = resolve(inputPath ?? DEFAULT_PDF);
    const assertLowerLevelCounts = absoluteInputPath === resolve(DEFAULT_PDF) && !pages;
    const benchmarkStartedAt = performance.now();
    const readStartedAt = performance.now();
    const pdfBytes = new Uint8Array(await readFile(absoluteInputPath));
    const readMs = performance.now() - readStartedAt;

    console.log("Native dense-vector PDF benchmark");
    console.log(`Input: ${absoluteInputPath}`);
    console.log(`Pages: ${pages ?? "all"}`);
    console.log(`File size: ${formatInteger(pdfBytes.length)} bytes`);

    const result = await runNativeDenseBenchmark(pdfBytes, modules, {
      ...(pages ? { pages } : {}),
      enableSegmentMerge: true,
      enableInvisibleCull: true,
      onProgress(progress) {
        console.error(
          `  page ${progress.pageIndex + 1}/${progress.pageCount} ${progress.phase}: ` +
          `${formatInteger(progress.operatorCount)} operators, ` +
          `${formatInteger(progress.sourceSegmentCount)} source segments, ` +
          `${formatInteger(progress.processedBytes)} decoded bytes`
        );
      }
    });
    const totalIncludingReadMs = performance.now() - benchmarkStartedAt;
    if (result.kind !== "success") {
      throw new Error(
        `Native dense path rejected the benchmark input (${result.reason}): ${result.message}`
      );
    }

    for (let pageIndex = 0; pageIndex < result.textScenes.length; pageIndex += 1) {
      assertTextOnlyScene(result.textScenes[pageIndex], pageIndex);
    }
    const counts = summarizeNativeDenseCounts(result);

    console.log("\nPhase timings");
    printTiming("module load", moduleLoadMs);
    printTiming("read input", readMs);
    printTiming("native preflight", result.timing.preflightMs);
    printTiming("  xref/object load", result.preflight.timing.loadMs);
    printTiming("  resource inspection", result.preflight.timing.inspectMs);
    printTiming("content decode (pull)", result.timing.decodeMs);
    printTiming("geometry compile", result.timing.compileMs);
    printTiming("decode + geometry wall", result.timing.compileWallMs);
    printTiming("direct native text", result.timing.nativeTextMs);
    printTiming("native pipeline", result.timing.totalMs);
    printTiming("benchmark incl. read", totalIncludingReadMs);

    console.log("\nNative dense counts");
    printCounts(counts);
    console.log(
      `Decoded: ${formatInteger(sumDecoded(result, "decodedBytes"))} bytes in ` +
      `${formatInteger(sumDecoded(result, "chunkCount"))} chunks`
    );

    if (assertLowerLevelCounts) {
      const lockedCounts = selectLockedCounts(counts);
      if (matchesKnownNodeLegacyCullVariance(lockedCounts)) {
        console.log(
          "Lower Level locked counts: PASS with known Node/V8 legacy-cull variance " +
          `(${formatInteger(counts.visibleSegments)} visible, ` +
          `${formatInteger(counts.containedRemovals)} contained)`
        );
      } else {
        assert.deepEqual(
          lockedCounts,
          LOWER_LEVEL_COUNTS,
          "Native dense-path Lower Level counts changed."
        );
        console.log("Lower Level locked counts: PASS");
      }
    } else {
      console.log("Locked-count assertion skipped for a custom input or page selection.");
    }
  } finally {
    hooks.deregister();
  }
}

function assertTextOnlyScene(scene, pageIndex) {
  const unexpectedPaintCount =
    scene.segmentCount +
    scene.fillPathCount +
    scene.fillSegmentCount +
    scene.gradientCount +
    scene.gradientFillPathCount +
    scene.gradientFillSegmentCount +
    scene.gradientStrokeRunCount +
    scene.gradientStrokeSegmentCount +
    scene.imagePaintOpCount +
    scene.pathCount +
    scene.rasterLayers.length +
    scene.rasterLayerData.length;
  assert.equal(
    unexpectedPaintCount,
    0,
    `Direct native text page ${pageIndex + 1} unexpectedly retained visible non-text paint.`
  );
}

function selectLockedCounts(counts) {
  return Object.fromEntries(
    Object.keys(LOWER_LEVEL_COUNTS).map((key) => [key, counts[key]])
  );
}

function matchesKnownNodeLegacyCullVariance(counts) {
  if (
    counts.visibleSegments !== LOWER_LEVEL_NODE_LEGACY_CULL_VARIANCE.visibleSegments ||
    counts.containedRemovals !== LOWER_LEVEL_NODE_LEGACY_CULL_VARIANCE.containedRemovals
  ) {
    return false;
  }
  return Object.entries(LOWER_LEVEL_COUNTS).every(([key, value]) =>
    key === "visibleSegments" || key === "containedRemovals" || counts[key] === value
  );
}

function sumDecoded(result, property) {
  return result.compiledPages.reduce(
    (total, page) => total + page.decodeTiming[property],
    0
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
  stream.write(`Usage: npm run benchmark:dense-pdf -- [PDF path] [options]

Measures the dependency-free native structure parser, dense geometry compiler,
and direct native retained-text compiler. It never invokes a legacy parser or
mini-PDF round trip. The default Lower Level input also checks locked output
counts; custom inputs and page selections are timed without that assertion.

Options:
  --pages RANGE       One-based page selection, for example 1-5,8
  -h, --help          Show this help
`);
}
