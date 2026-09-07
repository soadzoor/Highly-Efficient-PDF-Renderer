import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { basename, resolve } from "node:path";
import { sceneFingerprint } from "./lib/sceneFingerprint.mjs";

const arguments_ = parseArguments(process.argv.slice(2));
if (arguments_.showHelp) {
  printUsage();
  process.exit(0);
}
if (!arguments_.inputPath) {
  printUsage(process.stderr);
  process.exitCode = 1;
} else {
  await runBenchmark(arguments_);
}

async function runBenchmark({
  inputPath,
  pageIndex,
  iterations,
  warmups,
  optimization,
  jsonPath,
  reusePageResources,
  reuseCompositeSurfaces,
  boundCompositeWork
}) {
  // Node type stripping does not add extensions to browser-oriented imports.
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        context.parentURL?.includes("/src/") &&
        /^\.\.?\//.test(specifier) &&
        !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      return nextResolve(specifier, context);
    }
  });

  try {
    // Module loading is intentionally outside the parser timing.
    const { openPdf } = await import("../src/pdfSession.ts");
    const absoluteInputPath = resolve(inputPath);
    const readStartedAt = performance.now();
    const sourceBytes = new Uint8Array(await readFile(absoluteInputPath));
    const readMs = performance.now() - readStartedAt;

    console.log("Native direct VectorScene benchmark");
    console.log(`Input: ${absoluteInputPath}`);
    console.log(`File size: ${formatInteger(sourceBytes.byteLength)} bytes`);
    console.log(`Source page index: ${pageIndex} (zero-based)`);
    console.log(`Optimization: ${optimization}`);
    console.log(`Operation-scoped resource reuse: ${reusePageResources}`);
    console.log(`Operation-scoped image surface reuse: ${reuseCompositeSurfaces}`);
    console.log(`Bounded composite pixel work: ${boundCompositeWork}`);
    console.log(`Warmups / measured: ${warmups} / ${iterations}`);
    console.log(`Read input (excluded): ${formatMilliseconds(readMs)}`);

    for (let index = 0; index < warmups; index += 1) {
      const result = await runIteration({
        openPdf,
        sourceBytes,
        sourceLabel: basename(absoluteInputPath),
        pageIndex,
        optimization,
        reusePageResources,
        reuseCompositeSurfaces,
        boundCompositeWork
      });
      console.log(
        `Warmup ${index + 1}: ${formatMilliseconds(result.totalMs)} ` +
        `(open ${formatMilliseconds(result.openMs)}, ` +
        `compile ${formatMilliseconds(result.compileMs)})`
      );
    }

    const measured = [];
    for (let index = 0; index < iterations; index += 1) {
      const result = await runIteration({
        openPdf,
        sourceBytes,
        sourceLabel: basename(absoluteInputPath),
        pageIndex,
        optimization,
        reusePageResources,
        reuseCompositeSurfaces,
        boundCompositeWork
      });
      measured.push(result);
      console.log(
        `Run ${index + 1}: ${formatMilliseconds(result.totalMs)} ` +
        `(open ${formatMilliseconds(result.openMs)}, ` +
        `compile ${formatMilliseconds(result.compileMs)}), ` +
        `sampled RSS +${formatBytes(result.memory.rssDelta)}`
      );
    }

    const expectedScene = measured[0].scene;
    for (const result of measured.slice(1)) {
      assert.deepEqual(result.scene, expectedScene, "Native vector-page counts changed between runs.");
      assert.equal(result.sceneHash, measured[0].sceneHash, "Native scene bytes changed between runs.");
    }

    console.log("\nMedian engine timings (input bytes already loaded)");
    printTiming("open PDF", median(measured.map((result) => result.openMs)));
    printTiming("compile VectorScene page", median(measured.map((result) => result.compileMs)));
    printTiming("open + compile", median(measured.map((result) => result.totalMs)));
    const phaseTimings = measured.map((result) => result.phaseTimings);
    if (phaseTimings.every((timings) => timings !== null)) {
      console.log("\nMedian native compile phases");
      printTiming("decode content streams", phaseMedian(phaseTimings, "decodeMs"));
      printTiming("prepare inline images", phaseMedian(phaseTimings, "inlinePreparationMs"));
      printTiming("scan resource references", phaseMedian(phaseTimings, "resourceScanMs"));
      printTiming("load exact resources", phaseMedian(phaseTimings, "resourceLoadMs"));
      printTiming("  root fonts", phaseMedian(phaseTimings, "fontLoadMs"));
      printTiming("  root images/colors", phaseMedian(phaseTimings, "imageLoadMs"));
      printTiming("dense compiler scan", phaseMedian(phaseTimings, "compileScanMs"));
      printTiming("dense compiler finalize", phaseMedian(phaseTimings, "compileFinalizeMs"));
      printTiming("adapt to VectorScene", phaseMedian(phaseTimings, "vectorSceneAdaptationMs"));
      printTiming("  second compilation", phaseMedian(phaseTimings, "selectiveCompileMs"));
      printTiming("  selective compositing", phaseMedian(phaseTimings, "selectiveRasterMs"));
      const composites = phaseTimings.map(timing => timing.selectiveCompositing).filter(Boolean);
      if (composites.length > 0) {
        printTiming("    image surfaces", phaseMedian(composites, "imageSurfaceMs"));
        printTiming("    group soft masks", phaseMedian(composites, "softMaskMs"));
        printTiming("    output readback", phaseMedian(composites, "readbackMs"));
        console.log(`    image surfaces created/hits: ${phaseMedian(composites, "imageSurfaces")} / ${phaseMedian(composites, "imageSurfaceHits")}`);
      }
      printPreparationCounts("first pass", phaseTimings);
      const second = phaseTimings.map(timing => timing.selectiveCompilation).filter(Boolean);
      if (second.length > 0) {
        console.log("\nSecond compilation detail (included above)");
        printTiming("load exact resources", phaseMedian(second, "resourceLoadMs"));
        printTiming("  root fonts", phaseMedian(second, "fontLoadMs"));
        printTiming("  root images/colors", phaseMedian(second, "imageLoadMs"));
        printTiming("dense compiler scan", phaseMedian(second, "compileScanMs"));
        printPreparationCounts("second pass", second);
      }
    }
    printMemory("sampled peak RSS delta", median(measured.map((result) => result.memory.rssDelta)));
    printMemory("sampled peak RSS", median(measured.map((result) => result.memory.rss)));
    printMemory("sampled peak heap", median(measured.map((result) => result.memory.heapUsed)));
    printMemory("sampled peak buffers", median(measured.map((result) => result.memory.arrayBuffers)));

    console.log("\nVectorScene counts");
    for (const [name, value] of Object.entries(expectedScene)) {
      console.log(`${name.padEnd(29)} ${formatInteger(value).padStart(12)}`);
    }
    const diagnosticCodes = [...new Set(measured.flatMap(
      (result) => result.diagnosticCodes
    ))].sort();
    console.log(
      `Diagnostics: ${diagnosticCodes.length === 0 ? "none" : diagnosticCodes.join(", ")}`
    );
    console.log("HEP, LOD generation, GPU upload, rendering, and viewer work were not run.");
    if (jsonPath) {
      await writeFile(resolve(jsonPath), JSON.stringify({ inputPath: absoluteInputPath, pageIndex, reusePageResources, reuseCompositeSurfaces, boundCompositeWork, measured }, null, 2));
      console.log(`Wrote ${resolve(jsonPath)}`);
    }
  } finally {
    hooks.deregister();
  }
}

async function runIteration({
  openPdf,
  sourceBytes,
  sourceLabel,
  pageIndex,
  optimization,
  reusePageResources,
  reuseCompositeSurfaces,
  boundCompositeWork
}) {
  collectGarbage();
  // Prepare an independently owned buffer before timing, then hand it to the
  // session without another full input copy. The retained source stays reusable.
  const iterationBytes = Uint8Array.from(sourceBytes);
  const memory = createMemorySampler();
  let session = null;
  let memoryResult = null;
  try {
    const totalStartedAt = performance.now();
    const openStartedAt = totalStartedAt;
    session = await openPdf({
      kind: "bytes",
      bytes: iterationBytes,
      ownership: "transfer",
      label: sourceLabel
    });
    const openMs = performance.now() - openStartedAt;
    if (pageIndex >= session.info.pageCount) {
      throw new RangeError(
        `Source page index ${pageIndex} is outside this ${session.info.pageCount}-page PDF.`
      );
    }
    if (typeof session.compileVectorPage !== "function") {
      throw new TypeError("The internal native VectorScene compiler is unavailable.");
    }
    const compileStartedAt = performance.now();
    const profile = typeof session.compileVectorPageWithTimings === "function"
      ? await session.compileVectorPageWithTimings(pageIndex, { optimization }, { reusePageResources, reuseCompositeSurfaces, boundCompositeWork })
      : null;
    const scene = profile?.scene ??
      await session.compileVectorPage(pageIndex, { optimization });
    const compileMs = performance.now() - compileStartedAt;
    const totalMs = performance.now() - totalStartedAt;
    memoryResult = memory.stop();
    const diagnosticCodes = session.getDiagnostics().map((diagnostic) => diagnostic.code);
    return {
      openMs,
      compileMs,
      totalMs,
      phaseTimings: profile?.timings ?? null,
      memory: memoryResult,
      diagnosticCodes,
      sceneHash: sceneFingerprint(scene),
      scene: summarizeScene(scene)
    };
  } finally {
    if (!memoryResult) memory.stop();
    await session?.close().catch(() => undefined);
  }
}

function summarizeScene(scene) {
  return Object.freeze({
    pages: scene.pageCount,
    operators: scene.operatorCount,
    paths: scene.pathCount,
    sourceSegments: scene.sourceSegmentCount,
    mergedSegments: scene.mergedSegmentCount,
    visibleSegments: scene.segmentCount,
    fillPaths: scene.fillPathCount,
    fillSegments: scene.fillSegmentCount,
    textInstances: scene.textInstanceCount,
    textGlyphs: scene.textGlyphCount,
    textGlyphSegments: scene.textGlyphSegmentCount,
    rasterLayers: scene.rasterLayers.length,
    discardedTransparent: scene.discardedTransparentCount,
    discardedDegenerate: scene.discardedDegenerateCount,
    discardedDuplicate: scene.discardedDuplicateCount,
    discardedContained: scene.discardedContainedCount
  });
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
  let stopped = false;
  return {
    stop() {
      if (stopped) return {
        rss: peak.rss,
        heapUsed: peak.heapUsed,
        external: peak.external,
        arrayBuffers: peak.arrayBuffers,
        rssDelta: Math.max(0, peak.rss - baseline.rss)
      };
      stopped = true;
      clearInterval(timer);
      sample();
      return {
        rss: peak.rss,
        heapUsed: peak.heapUsed,
        external: peak.external,
        arrayBuffers: peak.arrayBuffers,
        rssDelta: Math.max(0, peak.rss - baseline.rss)
      };
    }
  };
}

function collectGarbage() {
  if (typeof globalThis.gc === "function") globalThis.gc();
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function phaseMedian(timings, name) {
  return median(timings.map((timing) => timing[name]));
}

function printPreparationCounts(label, timings) {
  console.log(`${label}: prepared fonts=${phaseMedian(timings, "preparedFonts")}, ` +
    `decoded images/masks=${phaseMedian(timings, "decodedImages")}, ` +
    `decoded storage=${formatBytes(phaseMedian(timings, "decodedImageBytes"))}`);
}

function printTiming(label, value) {
  console.log(`${label.padEnd(29)} ${formatMilliseconds(value).padStart(12)}`);
}

function printMemory(label, value) {
  console.log(`${label.padEnd(29)} ${formatBytes(value).padStart(12)}`);
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
  const output = {
    inputPath: null,
    pageIndex: 0,
    iterations: 1,
    warmups: 0,
    optimization: "safe",
    jsonPath: null,
    reusePageResources: true,
    reuseCompositeSurfaces: true,
    boundCompositeWork: true,
    showHelp: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      output.showHelp = true;
    } else if (argument === "--page-index") {
      output.pageIndex = readIntegerOption("--page-index", args[++index], 0, 1_000_000);
    } else if (argument.startsWith("--page-index=")) {
      output.pageIndex = readIntegerOption("--page-index", argument.slice(13), 0, 1_000_000);
    } else if (argument === "--iterations") {
      output.iterations = readIntegerOption("--iterations", args[++index], 1, 100);
    } else if (argument.startsWith("--iterations=")) {
      output.iterations = readIntegerOption("--iterations", argument.slice(13), 1, 100);
    } else if (argument === "--warmups") {
      output.warmups = readIntegerOption("--warmups", args[++index], 0, 20);
    } else if (argument.startsWith("--warmups=")) {
      output.warmups = readIntegerOption("--warmups", argument.slice(10), 0, 20);
    } else if (argument === "--optimization") {
      output.optimization = readOptimization(args[++index]);
    } else if (argument.startsWith("--optimization=")) {
      output.optimization = readOptimization(argument.slice(15));
    } else if (argument === "--json") {
      output.jsonPath = args[++index];
      if (!output.jsonPath) throw new TypeError("--json requires an output path.");
    } else if (argument === "--no-resource-reuse") {
      output.reusePageResources = false;
    } else if (argument === "--no-composite-reuse") {
      output.reuseCompositeSurfaces = false;
    } else if (argument === "--no-bounded-composite") {
      output.boundCompositeWork = false;
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

function readIntegerOption(name, value, minimum, maximum) {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new TypeError(`${name} requires an integer from ${minimum} through ${maximum}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`${name} requires an integer from ${minimum} through ${maximum}.`);
  }
  return parsed;
}

function readOptimization(value) {
  if (value !== "none" && value !== "safe") {
    throw new TypeError("--optimization must be 'none' or 'safe'.");
  }
  return value;
}

function printUsage(stream = process.stdout) {
  stream.write(`Usage: npm run benchmark:native-vector-page -- <PDF path> [options]

Measures only the internal dependency-free parser's openPdf() and zero-based
compileVectorPage() path. Input reading/copy preparation, session close, HEP,
LOD, GPU upload, rendering, and viewer work are excluded.

Options:
  --page-index N          Zero-based source page index (default: 0)
  --iterations N          Measured fresh sessions, 1-100 (default: 1)
  --warmups N             Unmeasured fresh sessions, 0-20 (default: 0)
  --optimization MODE     safe or none (default: safe)
  --json PATH             Write timings, resource counts, and an exact scene hash
  --no-resource-reuse      Internal A/B check: independently prepare the second pass
  --no-composite-reuse     Internal A/B check: rebuild images for each composite pass
  --no-bounded-composite   Internal A/B check: use full-page pixel buffers for masks/backdrops
  -h, --help              Show this help without loading a PDF\n`);
}
