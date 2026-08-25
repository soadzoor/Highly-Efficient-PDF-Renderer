import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const { inputPath, fastOnly, showHelp } = parseArguments(process.argv.slice(2));
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

// Node's type stripping does not add extensions to browser-oriented imports.
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

const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");

try {
  const [compilerModule, documentModule, workerModule, extractorModule] = await Promise.all([
    import("../src/densePdfContentCompiler.ts"),
    import("../src/densePdfDocument.ts"),
    import("../src/densePdfFastWorker.ts"),
    import("../src/pdfVectorExtractor.ts")
  ]);
  const { compileDensePdfContent } = compilerModule;
  const { buildDenseTextMiniPdf, preflightDensePdfDocument } = documentModule;
  const { computeDensePdfPageGeometry } = workerModule;
  const { extractPdfPageScenes } = extractorModule;

  const absoluteInputPath = resolve(inputPath ?? DEFAULT_PDF);
  const assertLivermoreCounts = absoluteInputPath === resolve(DEFAULT_PDF);
  const readStartedAt = performance.now();
  const pdfBytes = new Uint8Array(await readFile(absoluteInputPath));
  const readMs = performance.now() - readStartedAt;

  console.log("Livermore dense-vector differential benchmark");
  console.log(`Input: ${absoluteInputPath}`);
  console.log(`File size: ${formatInteger(pdfBytes.length)} bytes`);
  printTiming("read input", readMs);

  collectGarbage();
  const fastMemory = createMemorySampler();
  const fast = await runFastPath({
    pdfBytes,
    compileDensePdfContent,
    buildDenseTextMiniPdf,
    preflightDensePdfDocument,
    computeDensePdfPageGeometry,
    extractPdfPageScenes
  });
  const fastPeak = fastMemory.stop();

  console.log("\nFast-path timings");
  printTiming("preflight", fast.timing.preflightMs);
  printTiming("content decode (pull)", fast.timing.decodeMs);
  printTiming("geometry compile", fast.timing.compileMs);
  printTiming("decode + compile wall", fast.timing.compileWallMs);
  printTiming("text mini-PDF build", fast.timing.textMiniPdfMs);
  printTiming("integrated PDF.js text", fast.timing.integratedTextMs);
  printTiming("fast path total", fast.timing.totalMs);
  printMemory("fast sampled peak", fastPeak);
  console.log("\nFast-path counts");
  printCounts(fast.counts);
  if (assertLivermoreCounts) {
    assert.deepEqual(fast.counts, LIVERMORE_COUNTS, "Livermore locked counts changed.");
    console.log("Livermore locked counts: PASS");
  } else {
    console.log("Locked-count assertion skipped for a non-default input.");
  }

  if (fastOnly) {
    console.log("\nForced PDF.js comparison skipped (--fast-only).");
    process.exitCode = 0;
  } else {
    collectGarbage();
    const forcedMemory = createMemorySampler();
    const forcedStartedAt = performance.now();
    const forcedScenes = await extractPdfPageScenes(toArrayBuffer(pdfBytes), {
      pdfFastPath: "off",
      enableSegmentMerge: true,
      enableInvisibleCull: true,
      extractTextContent: true
    });
    const forcedMs = performance.now() - forcedStartedAt;
    const forcedFingerprints = fingerprintScenes(forcedScenes);
    const forcedCounts = summarizeSceneCounts(forcedScenes);
    const forcedPeak = forcedMemory.stop();

    console.log("\nForced PDF.js");
    printTiming("forced PDF.js total", forcedMs);
    printMemory("PDF.js sampled peak", forcedPeak);
    printCounts(forcedCounts);

    assert.deepEqual(forcedCounts, fast.counts, "Livermore scene counts differ.");
    assertSceneFingerprintsEqual(fast.fingerprints, forcedFingerprints);
    const fieldCount = fast.fingerprints.reduce(
      (total, page) => total + Object.keys(page).length,
      0
    );
    console.log(
      `\nTyped scene parity: PASS (${formatInteger(fieldCount)} fields across ` +
      `${formatInteger(fast.fingerprints.length)} pages)`
    );
    console.log(`Wall-time ratio: ${formatRatio(forcedMs, fast.timing.totalMs)}x`);
  }
} finally {
  if (originalWorker) {
    Object.defineProperty(globalThis, "Worker", originalWorker);
  } else {
    delete globalThis.Worker;
  }
  hooks.deregister();
}

async function runFastPath({
  pdfBytes,
  compileDensePdfContent,
  buildDenseTextMiniPdf,
  preflightDensePdfDocument,
  computeDensePdfPageGeometry,
  extractPdfPageScenes
}) {
  const totalStartedAt = performance.now();
  const preflightStartedAt = performance.now();
  const preflight = await preflightDensePdfDocument(pdfBytes);
  const preflightMs = performance.now() - preflightStartedAt;
  if (!preflight.eligible) {
    throw new Error(
      `Livermore is not dense-path eligible (${preflight.reason}): ${preflight.message}`
    );
  }

  const compiledPages = [];
  let decodeMs = 0;
  let compileWallMs = 0;
  for (let pageIndex = 0; pageIndex < preflight.document.pages.length; pageIndex += 1) {
    const selectedPage = preflight.document.pages[pageIndex];
    const geometry = computeDensePdfPageGeometry(selectedPage);
    const decodeTiming = { elapsedMs: 0, decodedBytes: 0 };
    let lastProgressAt = 0;
    const compileStartedAt = performance.now();
    const compiled = await compileDensePdfContent(
      measureDecodedContent(selectedPage.decodedContentChunks(), decodeTiming),
      {
        ...geometry,
        availableExtGStates: selectedPage.availableExtGStates,
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
            `${formatInteger(progress.sourceSegmentCount)} source segments`
          );
        }
      }
    );
    const pageCompileWallMs = performance.now() - compileStartedAt;
    decodeMs += decodeTiming.elapsedMs;
    compileWallMs += pageCompileWallMs;
    compiledPages.push({ selectedPage, geometry, compiled, decodeTiming });
  }

  const miniStartedAt = performance.now();
  const mini = await buildDenseTextMiniPdf(
    preflight.document,
    compiledPages.map(({ selectedPage, compiled }) => ({
      sourcePageIndex: selectedPage.sourcePageIndex,
      retainedTextContent: compiled.retainedTextContent,
      referencedFonts: new Set(compiled.referencedFonts),
      referencedProperties: new Set(compiled.referencedProperties)
    }))
  );
  const textMiniPdfMs = performance.now() - miniStartedAt;

  for (const { compiled } of compiledPages) {
    compiled.retainedTextContent = new Uint8Array(0);
    compiled.referencedFonts = [];
    compiled.referencedProperties = [];
  }

  let workerResult = {
    kind: "success",
    sourcePageCount: preflight.document.sourcePageCount,
    pages: compiledPages.map(({ selectedPage, geometry, compiled, decodeTiming }) => ({
      sourcePageIndex: selectedPage.sourcePageIndex,
      mediaBox: boxArray(selectedPage.mediaBox),
      cropBox: boxArray(selectedPage.cropBox),
      rotation: selectedPage.rotation,
      userUnit: selectedPage.userUnit,
      pageMatrix: geometry.pageMatrix,
      pageBounds: geometry.pageBounds,
      encodedContentBytes: selectedPage.encodedContentBytes,
      decodedContentBytes: decodeTiming.decodedBytes,
      decodeMs: decodeTiming.elapsedMs,
      compileMs: 0,
      compiled
    })),
    textMiniPdfBytes: mini.bytes,
    timing: {
      preflightMs,
      decodeMs,
      compileMs: Math.max(0, compileWallMs - decodeMs),
      textMiniPdfMs,
      totalMs: performance.now() - totalStartedAt
    }
  };

  class ResultWorker {
    listeners = new Map();

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }

    postMessage() {
      queueMicrotask(() => {
        this.emit("message", { data: { type: "result", result: workerResult } });
      });
    }

    emit(type, event) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(event);
      }
    }

    terminate() {}
  }

  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: ResultWorker
  });
  const integrationStartedAt = performance.now();
  const fastScenes = await extractPdfPageScenes(toArrayBuffer(pdfBytes), {
    pdfFastPath: "auto",
    enableSegmentMerge: true,
    enableInvisibleCull: true,
    extractTextContent: true
  });
  const integratedTextMs = performance.now() - integrationStartedAt;
  const totalMs = performance.now() - totalStartedAt;
  workerResult = null;

  return {
    counts: summarizeSceneCounts(fastScenes),
    fingerprints: fingerprintScenes(fastScenes),
    timing: {
      preflightMs,
      decodeMs,
      compileMs: Math.max(0, compileWallMs - decodeMs),
      compileWallMs,
      textMiniPdfMs,
      integratedTextMs,
      totalMs
    }
  };
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

function summarizeSceneCounts(scenes) {
  return {
    operators: sum(scenes, "operatorCount"),
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

function fingerprintScenes(scenes) {
  return scenes.map((scene) => Object.fromEntries(
    Object.keys(scene).sort().map((key) => [key, fingerprintValue(scene[key])])
  ));
}

function fingerprintValue(value) {
  const hash = createHash("sha256");
  hashCanonicalValue(hash, value, new Set());
  return {
    type: describeValue(value),
    hash: hash.digest("hex")
  };
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
    case "bigint":
      hash.update(`bigint:${value};`);
      return;
    case "object":
      break;
    default:
      throw new TypeError(`Cannot fingerprint scene value of type ${typeof value}.`);
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
    throw new TypeError("Cannot fingerprint a cyclic scene value.");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      hash.update(`array:${value.length}:`);
      for (const item of value) {
        hashCanonicalValue(hash, item, ancestors);
      }
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

function assertSceneFingerprintsEqual(fast, forced) {
  assert.equal(forced.length, fast.length, "Livermore page count differs.");
  for (let pageIndex = 0; pageIndex < fast.length; pageIndex += 1) {
    const fastPage = fast[pageIndex];
    const forcedPage = forced[pageIndex];
    assert.deepEqual(
      Object.keys(forcedPage),
      Object.keys(fastPage),
      `Livermore page ${pageIndex + 1} scene fields differ.`
    );
    for (const key of Object.keys(fastPage)) {
      assert.deepEqual(
        forcedPage[key],
        fastPage[key],
        `Livermore page ${pageIndex + 1} scene field ${key} differs.`
      );
    }
  }
}

function createMemorySampler() {
  const baseline = process.memoryUsage();
  const peak = { ...baseline };
  const sample = () => {
    const current = process.memoryUsage();
    for (const key of Object.keys(peak)) {
      peak[key] = Math.max(peak[key], current[key]);
    }
  };
  const timer = setInterval(sample, 25);
  timer.unref();
  return {
    stop() {
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
  if (typeof globalThis.gc === "function") {
    globalThis.gc();
  }
}

function boxArray(box) {
  return [box.left, box.bottom, box.right, box.top];
}

function describeValue(value) {
  if (ArrayBuffer.isView(value)) {
    return `${value.constructor.name}[${value.length ?? value.byteLength}]`;
  }
  if (value instanceof ArrayBuffer) {
    return `ArrayBuffer[${value.byteLength}]`;
  }
  if (Array.isArray(value)) {
    return `Array[${value.length}]`;
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
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

function formatBytes(value) {
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatRatio(numerator, denominator) {
  return denominator > 0 ? (numerator / denominator).toFixed(2) : "∞";
}

function parseArguments(args) {
  let inputPath = null;
  let fastOnly = false;
  let showHelp = false;
  for (const argument of args) {
    if (argument === "--fast-only") {
      fastOnly = true;
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
  return { inputPath, fastOnly, showHelp };
}

function printUsage() {
  console.log(`Usage: npm run benchmark:livermore-pdf -- [PDF path] [--fast-only]

Defaults to public/examples/pdfs/Livermore_L1.pdf. The default run compares
exact typed scene contents and counts against forced PDF.js. --fast-only checks
dense-path eligibility and reports fast-path timings without the slow baseline.`);
}
