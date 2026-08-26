import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const { inputPath, comparePdfJs, showHelp } = parseArguments(process.argv.slice(2));
if (showHelp) {
  printUsage();
  process.exit(0);
}

Promise.try ??= (callback, ...args) => Promise.resolve().then(() => callback(...args));
Uint8Array.prototype.toHex ??= function toHex() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("hex");
};
Uint8Array.prototype.toBase64 ??= function toBase64() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("base64");
};
Uint8Array.fromHex ??= (value) => new Uint8Array(Buffer.from(value, "hex"));
Uint8Array.fromBase64 ??= (value) => new Uint8Array(Buffer.from(value, "base64"));

// Node's type stripping does not add extensions to the browser-oriented source
// imports, so resolve those local specifiers the same way the TypeScript bundler does.
registerHooks({
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

const [compilerModule, documentModule, workerModule, extractorModule] = await Promise.all([
  import("../src/densePdfContentCompiler.ts"),
  import("../src/densePdfDocument.ts"),
  import("../src/densePdfFastWorker.ts"),
  import("../src/pdfVectorExtractor.ts")
]);
const { compileDensePdfContent } = compilerModule;
const { buildDenseTextMiniPdf, preflightDensePdfDocument } = documentModule;
const {
  classifyDensePdfTextFormXObjects,
  computeDensePdfPageGeometry
} = workerModule;
const { extractPdfPageScenes } = extractorModule;

const absoluteInputPath = resolve(inputPath ?? DEFAULT_PDF);
const assertLowerLevelCounts = absoluteInputPath === DEFAULT_PDF;
const benchmarkStartedAt = performance.now();
const readStartedAt = performance.now();
const pdfBytes = new Uint8Array(await readFile(absoluteInputPath));
const readMs = performance.now() - readStartedAt;
const fastPathStartedAt = performance.now();

console.log("Dense-vector PDF benchmark");
console.log(`Input: ${absoluteInputPath}`);
console.log(`File size: ${formatInteger(pdfBytes.length)} bytes`);

const preflightStartedAt = performance.now();
const preflight = await preflightDensePdfDocument(pdfBytes);
const preflightWallMs = performance.now() - preflightStartedAt;
if (!preflight.eligible) {
  throw new Error(
    `Dense path rejected the benchmark input (${preflight.reason}): ${preflight.message}`
  );
}

const compiledPages = [];
const pageTimings = [];
for (let pageIndex = 0; pageIndex < preflight.document.pages.length; pageIndex += 1) {
  const page = preflight.document.pages[pageIndex];
  const geometry = computeDensePdfPageGeometry(page);
  const availableTextFormXObjects = await classifyDensePdfTextFormXObjects(page);
  const decodeTiming = { elapsedMs: 0, decodedBytes: 0, chunkCount: 0 };
  const measuredContent = measureDecodedContent(page.decodedContentChunks(), decodeTiming);
  let lastProgressAt = 0;
  const compileStartedAt = performance.now();
  const compiled = await compileDensePdfContent(measuredContent, {
    ...geometry,
    fontDependencyKeys: new Map(page.fontDependencies.map(
      ({ resourceName, dependencyKey }) => [resourceName, dependencyKey]
    )),
    availableExtGStates: page.availableExtGStates,
    extGStates: page.extGStates,
    alwaysVisibleOptionalContentProperties:
      page.alwaysVisibleOptionalContentProperties,
    availableTextFormXObjects,
    enableSegmentMerge: true,
    enableInvisibleCull: true,
    yieldIntervalMs: 50,
    onProgress(progress) {
      const now = performance.now();
      if (now - lastProgressAt < 2_000) {
        return;
      }
      lastProgressAt = now;
      console.error(
        `  page ${pageIndex + 1}/${preflight.document.pages.length} ${progress.phase}: ` +
        `${formatInteger(progress.operatorCount)} operators, ` +
        `${formatInteger(progress.sourceSegmentCount)} source segments, ` +
        `${formatInteger(progress.processedBytes)} decoded bytes`
      );
    }
  });
  const compileWallMs = performance.now() - compileStartedAt;
  compiledPages.push({
    sourcePageIndex: page.sourcePageIndex,
    retainedTextContent: compiled.retainedTextContent,
    referencedFonts: new Set(compiled.referencedFonts),
    referencedProperties: new Set(compiled.referencedProperties),
    referencedExtGStates: new Set(compiled.referencedExtGStates),
    referencedXObjects: new Set(compiled.referencedXObjects),
    compiled
  });
  pageTimings.push({
    pageNumber: page.sourcePageNumber,
    decodedBytes: decodeTiming.decodedBytes,
    decodedChunks: decodeTiming.chunkCount,
    decodeMs: decodeTiming.elapsedMs,
    compileMs: Math.max(0, compileWallMs - decodeTiming.elapsedMs),
    compileWallMs
  });
}

const miniPdfStartedAt = performance.now();
const miniPdf = await buildDenseTextMiniPdf(
  preflight.document,
  compiledPages.map((page) => ({
    sourcePageIndex: page.sourcePageIndex,
    retainedTextContent: page.retainedTextContent,
    referencedFonts: page.referencedFonts,
    referencedProperties: page.referencedProperties,
    referencedExtGStates: page.referencedExtGStates,
    referencedXObjects: page.referencedXObjects
  }))
);
const miniPdfWallMs = performance.now() - miniPdfStartedAt;

const textStartedAt = performance.now();
const textScenes = await extractPdfPageScenes(toArrayBuffer(miniPdf.bytes), {
  pdfFastPath: "off",
  enableSegmentMerge: false,
  enableInvisibleCull: false
});
const pdfJsTextMs = performance.now() - textStartedAt;

assert.equal(
  textScenes.length,
  compiledPages.length,
  "The text mini-PDF must produce one PDF.js scene per compiled page."
);
for (let pageIndex = 0; pageIndex < textScenes.length; pageIndex += 1) {
  const scene = textScenes[pageIndex];
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
    `Text mini-PDF page ${pageIndex + 1} unexpectedly retained visible paint.`
  );
}

const fastCounts = summarizeFastCounts(compiledPages, textScenes);
const totalDecodeMs = sum(pageTimings, "decodeMs");
const totalCompileMs = sum(pageTimings, "compileMs");
const totalCompileWallMs = sum(pageTimings, "compileWallMs");
const fastPathMs = performance.now() - fastPathStartedAt;
const fastTotalMs = performance.now() - benchmarkStartedAt;

console.log("\nPhase timings");
printTiming("read input", readMs);
printTiming("preflight", preflightWallMs);
printTiming("  pdf-lib load", preflight.timing.loadMs);
printTiming("  resource inspection", preflight.timing.inspectMs);
printTiming("content decode (pull time)", totalDecodeMs);
printTiming("geometry compile", totalCompileMs);
printTiming("decode + geometry wall", totalCompileWallMs);
printTiming("text mini-PDF build", miniPdfWallMs);
printTiming("  resource copy", miniPdf.timing.resourceCopyMs);
printTiming("  content build", miniPdf.timing.contentBuildMs);
printTiming("  source release", miniPdf.timing.sourceReleaseMs);
printTiming("  save", miniPdf.timing.saveMs);
printTiming("PDF.js text-mini processing", pdfJsTextMs);
printTiming("fast path (bytes loaded)", fastPathMs);
printTiming("fast benchmark incl. read", fastTotalMs);

console.log("\nFast-path counts");
printCounts(fastCounts);
console.log(
  `Decoded: ${formatInteger(sum(pageTimings, "decodedBytes"))} bytes in ` +
  `${formatInteger(sum(pageTimings, "decodedChunks"))} chunks`
);
console.log(`Text mini-PDF: ${formatInteger(miniPdf.bytes.length)} bytes`);
if (assertLowerLevelCounts) {
  if (matchesKnownNodeLegacyCullVariance(fastCounts)) {
    console.log(
      "Lower Level locked counts: PASS with known Node/V8 legacy-cull variance " +
      `(${formatInteger(fastCounts.visibleSegments)} visible, ` +
      `${formatInteger(fastCounts.containedRemovals)} contained)`
    );
  } else {
    assert.deepEqual(
      fastCounts,
      LOWER_LEVEL_COUNTS,
      "Dense-path Lower Level counts changed."
    );
    console.log("Lower Level locked counts: PASS");
  }
} else {
  console.log("Locked-count assertion skipped for a non-default input.");
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

if (comparePdfJs) {
  console.log("\nForced PDF.js comparison (this can take 70–80 seconds for Lower Level)");
  compiledPages.length = 0;
  textScenes.length = 0;
  const pdfJsStartedAt = performance.now();
  const pdfJsScenes = await extractPdfPageScenes(toArrayBuffer(pdfBytes), {
    pdfFastPath: "off",
    enableSegmentMerge: true,
    enableInvisibleCull: true
  });
  const pdfJsMs = performance.now() - pdfJsStartedAt;
  const pdfJsCounts = summarizeSceneCounts(pdfJsScenes);
  printTiming("original PDF.js total", pdfJsMs);
  printCounts(pdfJsCounts);
  assert.deepEqual(
    fastCounts,
    pdfJsCounts,
    "Dense and forced-PDF.js benchmark counts differ."
  );
  console.log(`Count parity: PASS (${formatRatio(pdfJsMs, fastPathMs)}x wall-time ratio)`);
}

function measureDecodedContent(source, timing) {
  return {
    async *[Symbol.asyncIterator]() {
      const iterator = source[Symbol.asyncIterator]();
      let completed = false;
      try {
        while (true) {
          const startedAt = performance.now();
          const next = await iterator.next();
          timing.elapsedMs += performance.now() - startedAt;
          if (next.done) {
            completed = true;
            return;
          }
          timing.decodedBytes += next.value.length;
          timing.chunkCount += 1;
          yield next.value;
        }
      } finally {
        if (!completed && typeof iterator.return === "function") {
          await iterator.return();
        }
      }
    }
  };
}

function summarizeFastCounts(pages, textPageScenes) {
  return {
    sourceSegments: pages.reduce((total, page) => total + page.compiled.sourceSegmentCount, 0),
    mergedSegments: pages.reduce((total, page) => total + page.compiled.mergedSegmentCount, 0),
    visibleSegments: pages.reduce((total, page) => total + page.compiled.segmentCount, 0),
    duplicateRemovals: pages.reduce(
      (total, page) => total + page.compiled.discardedDuplicateCount,
      0
    ),
    containedRemovals: pages.reduce(
      (total, page) => total + page.compiled.discardedContainedCount,
      0
    ),
    fillPaths: pages.reduce((total, page) => total + page.compiled.fillPathCount, 0),
    fillSegments: pages.reduce((total, page) => total + page.compiled.fillSegmentCount, 0),
    sourceText: textPageScenes.reduce((total, scene) => total + scene.sourceTextCount, 0),
    textInstances: textPageScenes.reduce((total, scene) => total + scene.textInstanceCount, 0),
    glyphs: textPageScenes.reduce((total, scene) => total + scene.textGlyphCount, 0),
    glyphSegments: textPageScenes.reduce(
      (total, scene) => total + scene.textGlyphSegmentCount,
      0
    )
  };
}

function summarizeSceneCounts(scenes) {
  return {
    sourceSegments: sum(scenes, "sourceSegmentCount"),
    mergedSegments: sum(scenes, "mergedSegmentCount"),
    visibleSegments: sum(scenes, "segmentCount"),
    duplicateRemovals: sum(scenes, "discardedDuplicateCount"),
    containedRemovals: sum(scenes, "discardedContainedCount"),
    fillPaths: sum(scenes, "fillPathCount"),
    fillSegments: sum(scenes, "fillSegmentCount"),
    sourceText: sum(scenes, "sourceTextCount"),
    textInstances: sum(scenes, "textInstanceCount"),
    glyphs: sum(scenes, "textGlyphCount"),
    glyphSegments: sum(scenes, "textGlyphSegmentCount")
  };
}

function printTiming(label, elapsedMs) {
  console.log(`${label.padEnd(29)} ${formatMilliseconds(elapsedMs).padStart(11)}`);
}

function printCounts(counts) {
  for (const [name, value] of Object.entries(counts)) {
    console.log(`${name.padEnd(29)} ${formatInteger(value).padStart(11)}`);
  }
}

function sum(values, property) {
  return values.reduce((total, value) => total + value[property], 0);
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function formatInteger(value) {
  return Math.trunc(value).toLocaleString("en-US");
}

function formatMilliseconds(value) {
  return `${value.toFixed(1)} ms`;
}

function formatRatio(numerator, denominator) {
  return denominator > 0 ? (numerator / denominator).toFixed(2) : "∞";
}

function parseArguments(args) {
  let inputPath = null;
  let comparePdfJs = false;
  let showHelp = false;
  for (const argument of args) {
    if (argument === "--compare-pdfjs") {
      comparePdfJs = true;
    } else if (argument === "--help" || argument === "-h") {
      showHelp = true;
    } else if (argument.startsWith("-")) {
      throw new TypeError(`Unknown option: ${argument}`);
    } else if (inputPath === null) {
      inputPath = argument;
    } else {
      throw new TypeError(`Unexpected positional argument: ${argument}`);
    }
  }
  return { inputPath, comparePdfJs, showHelp };
}

function printUsage() {
  console.log(`Usage: npm run benchmark:dense-pdf -- [PDF path] [--compare-pdfjs]

Defaults to public/examples/pdfs/Lower Level.pdf and asserts its locked counts.
Custom inputs are timed without the Lower Level assertion. --compare-pdfjs also
runs the original forced PDF.js path, which is intentionally skipped by default.`);
}
