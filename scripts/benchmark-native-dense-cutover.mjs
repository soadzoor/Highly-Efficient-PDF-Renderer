import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  installNativeDenseBenchmarkRuntime,
  loadNativeDenseBenchmarkModules,
  registerNativeDenseBenchmarkHooks,
  runNativeDenseBenchmark,
  summarizeNativeDenseCounts
} from "./lib/nativeDenseBenchmark.mjs";

const CHILD_FLAG = "--hepr-native-dense-child";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1_000;

if (process.argv[2] === CHILD_FLAG) {
  await runChild(parseChildArguments(process.argv.slice(3)));
} else {
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
    if (arguments_.inputPaths.length === 0) {
      console.error("At least one PDF path is required; no corpus is selected implicitly.\n");
      printUsage(process.stderr);
      process.exitCode = 1;
    } else {
      await runController(arguments_);
    }
  }
}

async function runController({ inputPaths, pages, runs, timeoutMs, jsonPath }) {
  const reports = [];
  let failed = false;

  console.log("Native dense fresh-process benchmark");
  console.log(`Inputs: ${inputPaths.length}`);
  console.log(`Runs per input: ${runs}`);
  console.log(`Pages: ${pages ?? "all"}`);
  console.log("Input reading and semantic hashing are excluded from pipeline timings.");

  for (let inputIndex = 0; inputIndex < inputPaths.length; inputIndex += 1) {
    const inputPath = resolve(inputPaths[inputIndex]);
    console.log(`\n[${inputIndex + 1}/${inputPaths.length}] ${inputPath}`);
    const inputReports = [];
    for (let runIndex = 0; runIndex < runs; runIndex += 1) {
      process.stdout.write(`  run ${String(runIndex + 1).padStart(2)}/${runs} `);
      try {
        const report = await spawnBenchmarkChild({ inputPath, pages, timeoutMs });
        inputReports.push(report);
        console.log(report.outcome);
        printRunReport(report);
        if (report.outcome !== "success") failed = true;
      } catch (error) {
        failed = true;
        console.log("failed");
        console.error(indent(error instanceof Error ? error.message : String(error), 4));
      }
    }

    const summary = summarizeRuns(inputReports);
    reports.push({ inputPath, runs: inputReports, summary });
    if (!summary.ok) failed = true;
    printSummary(summary);
  }

  const output = {
    version: 2,
    generatedAt: new Date().toISOString(),
    pages: pages ?? null,
    runsPerInput: runs,
    reports
  };
  if (jsonPath) {
    await writeFile(resolve(jsonPath), `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(`\nWrote ${resolve(jsonPath)}`);
  }
  console.log(`\nNative benchmark: ${failed ? "FAILED" : "PASSED"}`);
  if (failed) process.exitCode = 2;
}

async function spawnBenchmarkChild({ inputPath, pages, timeoutMs }) {
  const resultDirectory = await mkdtemp(join(tmpdir(), "hepr-native-dense-benchmark-"));
  const resultPath = join(resultDirectory, "result.json");
  try {
    return await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, [
        ...childExecArguments(),
        fileURLToPath(import.meta.url),
        CHILD_FLAG,
        inputPath,
        pages ?? "",
        resultPath
      ], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "ignore", "inherit"]
      });
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        rejectPromise(new Error(
          `Benchmark child exceeded the ${formatMilliseconds(timeoutMs)} timeout.`
        ));
      }, timeoutMs);

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        rejectPromise(error);
      });
      child.on("close", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (code !== 0) {
          rejectPromise(new Error(
            `Benchmark child exited ${signal ? `on ${signal}` : `with code ${code}`}.`
          ));
          return;
        }
        void readFile(resultPath, "utf8")
          .then((json) => JSON.parse(json))
          .then(resolvePromise, (error) => rejectPromise(new Error(
            `Benchmark child did not write a valid result: ${error instanceof Error ? error.message : String(error)}`
          )));
      });
    });
  } finally {
    await rm(resultDirectory, { recursive: true, force: true });
  }
}

function childExecArguments() {
  const output = [...process.execArgv];
  if (!output.includes("--experimental-strip-types")) {
    output.push("--experimental-strip-types");
  }
  if (!output.includes("--expose-gc")) output.push("--expose-gc");
  return output;
}

async function runChild({ inputPath, pages, resultPath }) {
  installNativeDenseBenchmarkRuntime();
  const hooks = registerNativeDenseBenchmarkHooks();
  let memoryResult;
  try {
    const readStartedAt = performance.now();
    const pdfBytes = new Uint8Array(await readFile(inputPath));
    const inputReadMs = performance.now() - readStartedAt;
    collectGarbage();
    const memory = createMemorySampler();
    const moduleStartedAt = performance.now();
    const modules = await loadNativeDenseBenchmarkModules();
    const moduleLoadMs = performance.now() - moduleStartedAt;
    const pipelineStartedAt = performance.now();
    const result = await runNativeDenseBenchmark(pdfBytes, modules, {
      ...(pages ? { pages } : {}),
      enableSegmentMerge: true,
      enableInvisibleCull: true
    });
    const pipelineWallMs = performance.now() - pipelineStartedAt;
    memoryResult = memory.stop();

    const base = {
      inputPath,
      inputName: basename(inputPath),
      inputBytes: pdfBytes.byteLength,
      pages: pages ?? null,
      outcome: result.kind,
      inputReadMs,
      moduleLoadMs,
      pipelineWallMs,
      memory: memoryResult,
      timing: result.timing
    };
    const report = result.kind === "success"
      ? {
          ...base,
          sourcePageCount: result.sourcePageCount,
          selectedPageCount: result.compiledPages.length,
          counts: summarizeNativeDenseCounts(result),
          semanticHash: hashNativeDenseResult(result)
        }
      : {
          ...base,
          reason: result.reason,
          message: result.message
        };
    await writeFile(resultPath, JSON.stringify(report), "utf8");
  } finally {
    hooks.deregister();
  }
}

function hashNativeDenseResult(result) {
  const hash = createHash("sha256");
  hash.update("hepr-native-dense-fresh-process-v2;");
  for (const { structuralPage, geometry, compiled } of result.compiledPages) {
    updateNumbers(hash, [
      structuralPage.sourcePageIndex,
      structuralPage.rotation,
      structuralPage.userUnit,
      ...boxValues(structuralPage.mediaBox),
      ...boxValues(structuralPage.cropBox),
      ...geometry.pageMatrix,
      ...boundsValues(geometry.pageBounds),
      compiled.operatorCount,
      compiled.pathCount,
      compiled.sourceSegmentCount,
      compiled.mergedSegmentCount,
      compiled.segmentCount,
      compiled.fillPathCount,
      compiled.fillSegmentCount,
      compiled.discardedDuplicateCount,
      compiled.discardedContainedCount,
      compiled.textShowOpCount
    ]);
    for (const name of [
      "endpoints",
      "primitiveMeta",
      "primitiveBounds",
      "styles",
      "fillPathMetaA",
      "fillPathMetaB",
      "fillPathMetaC",
      "fillSegmentsA",
      "fillSegmentsB"
    ]) {
      updateView(hash, name, compiled[name]);
    }
  }
  for (const scene of result.textScenes) {
    updateNumbers(hash, [
      scene.pageCount,
      scene.sourceTextCount,
      scene.textInstanceCount,
      scene.textGlyphCount,
      scene.textGlyphSegmentCount,
      scene.textInPageCount,
      scene.textOutOfPageCount
    ]);
    for (const name of [
      "pageRects",
      "pageTextRanges",
      "textInstanceA",
      "textInstanceB",
      "textInstanceC",
      "textGlyphMetaA",
      "textGlyphMetaB",
      "textGlyphSegmentsA",
      "textGlyphSegmentsB"
    ]) {
      const value = scene[name];
      if (ArrayBuffer.isView(value)) updateView(hash, name, value);
    }
    updateString(hash, scene.textIndex?.version ?? 0);
    for (const page of scene.textIndex?.pages ?? []) {
      updateString(hash, page.text);
      updateView(hash, "text-char-instance", page.charInstance);
      updateView(hash, "text-fallback-quads", page.fallbackQuads);
    }
  }
  return hash.digest("hex");
}

function summarizeRuns(reports) {
  const successful = reports.filter((report) => report.outcome === "success");
  const issues = [];
  if (successful.length !== reports.length) {
    issues.push(`${reports.length - successful.length} run(s) did not compile successfully.`);
  }
  if (successful.length > 1) {
    const expectedHash = successful[0].semanticHash;
    for (let index = 1; index < successful.length; index += 1) {
      if (successful[index].semanticHash !== expectedHash) {
        issues.push(`Run ${index + 1} produced a different semantic hash.`);
      }
    }
  }
  return {
    ok: reports.length > 0 && issues.length === 0,
    issues,
    successfulRuns: successful.length,
    medianPipelineWallMs: median(successful.map((report) => report.pipelineWallMs)),
    medianInternalTotalMs: median(successful.map((report) => report.timing.totalMs)),
    medianPeakRss: median(successful.map((report) => report.memory.rss)),
    minPipelineWallMs: minimum(successful.map((report) => report.pipelineWallMs)),
    maxPipelineWallMs: maximum(successful.map((report) => report.pipelineWallMs)),
    semanticHash: successful[0]?.semanticHash ?? null
  };
}

function printRunReport(report) {
  console.log(`    module load       ${formatMilliseconds(report.moduleLoadMs)}`);
  console.log(`    pipeline wall     ${formatMilliseconds(report.pipelineWallMs)}`);
  console.log(`    sampled peak RSS  ${formatBytes(report.memory.rss)}`);
  if (report.outcome !== "success") {
    console.log(`    rejection         ${report.reason}: ${report.message}`);
    return;
  }
  console.log(
    `    phases            preflight ${formatMilliseconds(report.timing.preflightMs)}, ` +
    `decode ${formatMilliseconds(report.timing.decodeMs)}, ` +
    `compile ${formatMilliseconds(report.timing.compileMs)}, ` +
    `text ${formatMilliseconds(report.timing.nativeTextMs)}`
  );
  console.log(
    `    counts            ${formatInteger(report.counts.operators)} operators, ` +
    `${formatInteger(report.counts.visibleSegments)} visible segments, ` +
    `${formatInteger(report.counts.textInstances)} text instances`
  );
  console.log(`    semantic hash     ${report.semanticHash}`);
}

function printSummary(summary) {
  console.log("  summary");
  if (summary.successfulRuns > 0) {
    console.log(`    median wall       ${formatMilliseconds(summary.medianPipelineWallMs)}`);
    console.log(
      `    wall range        ${formatMilliseconds(summary.minPipelineWallMs)} – ` +
      formatMilliseconds(summary.maxPipelineWallMs)
    );
    console.log(`    median internal   ${formatMilliseconds(summary.medianInternalTotalMs)}`);
    console.log(`    median peak RSS   ${formatBytes(summary.medianPeakRss)}`);
    console.log(`    deterministic     ${summary.issues.length === 0 ? "yes" : "no"}`);
  }
  for (const issue of summary.issues) console.log(`    issue             ${issue}`);
  console.log(`    result            ${summary.ok ? "PASS" : "FAIL"}`);
}

function updateString(hash, value) {
  const bytes = Buffer.from(String(value), "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  hash.update(length);
  hash.update(bytes);
}

function updateNumbers(hash, values) {
  const array = Float64Array.from(values, (value) => Object.is(value, -0) ? 0 : value);
  updateView(hash, "numbers", array);
}

function updateView(hash, label, view) {
  updateString(hash, label);
  updateString(hash, view.constructor.name);
  updateString(hash, view.length);
  hash.update(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

function boxValues(box) {
  return [box.left, box.bottom, box.right, box.top];
}

function boundsValues(bounds) {
  return [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY];
}

function createMemorySampler() {
  const baseline = process.memoryUsage();
  const peak = { ...baseline };
  const sample = () => {
    const current = process.memoryUsage();
    for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], current[key]);
  };
  const timer = setInterval(sample, 10);
  timer.unref();
  let result = null;
  return {
    stop() {
      if (result) return result;
      clearInterval(timer);
      sample();
      result = {
        rss: peak.rss,
        rssDelta: Math.max(0, peak.rss - baseline.rss),
        heapUsed: peak.heapUsed,
        heapUsedDelta: Math.max(0, peak.heapUsed - baseline.heapUsed),
        arrayBuffers: peak.arrayBuffers,
        arrayBuffersDelta: Math.max(0, peak.arrayBuffers - baseline.arrayBuffers)
      };
      return result;
    }
  };
}

function collectGarbage() {
  if (typeof globalThis.gc === "function") globalThis.gc();
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function minimum(values) {
  return values.length > 0 ? Math.min(...values) : null;
}

function maximum(values) {
  return values.length > 0 ? Math.max(...values) : null;
}

function parseArguments(args) {
  const output = {
    inputPaths: [],
    pages: undefined,
    runs: 1,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    jsonPath: undefined,
    showHelp: false
  };
  let positionalOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (positionalOnly) {
      output.inputPaths.push(argument);
    } else if (argument === "--") {
      positionalOnly = true;
    } else if (argument === "--help" || argument === "-h") {
      output.showHelp = true;
    } else if (argument === "--pages") {
      output.pages = readNonEmptyOption("--pages", args[++index]);
    } else if (argument.startsWith("--pages=")) {
      output.pages = readNonEmptyOption("--pages", argument.slice(8));
    } else if (argument === "--runs") {
      output.runs = readIntegerOption("--runs", args[++index], 1, 20);
    } else if (argument.startsWith("--runs=")) {
      output.runs = readIntegerOption("--runs", argument.slice(7), 1, 20);
    } else if (argument === "--timeout-ms") {
      output.timeoutMs = readIntegerOption(
        "--timeout-ms",
        args[++index],
        1_000,
        60 * 60 * 1_000
      );
    } else if (argument.startsWith("--timeout-ms=")) {
      output.timeoutMs = readIntegerOption(
        "--timeout-ms",
        argument.slice(13),
        1_000,
        60 * 60 * 1_000
      );
    } else if (argument === "--json") {
      output.jsonPath = readNonEmptyOption("--json", args[++index]);
    } else if (argument.startsWith("--json=")) {
      output.jsonPath = readNonEmptyOption("--json", argument.slice(7));
    } else if (argument.startsWith("-")) {
      throw new TypeError(`Unknown option: ${argument}`);
    } else {
      output.inputPaths.push(argument);
    }
  }
  return output;
}

function parseChildArguments(args) {
  const [inputPath, pages = "", resultPath] = args;
  if (!inputPath || !resultPath) {
    throw new TypeError("Invalid internal native dense benchmark child arguments.");
  }
  return { inputPath, pages: pages || undefined, resultPath };
}

function readNonEmptyOption(name, value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} requires a value.`);
  }
  return value;
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

function indent(value, spaces) {
  const prefix = " ".repeat(spaces);
  return String(value).split(/\r?\n/).map((line) => `${prefix}${line}`).join("\n");
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

function printUsage(stream = process.stdout) {
  stream.write(`Usage: npm run benchmark:native-dense-cutover -- [options] <PDF path> [PDF path ...]

Runs the dependency-free native dense pipeline in isolated fresh Node
processes. Repeated runs report median wall time and peak RSS, while semantic
hashes ensure that timing repetitions produced identical output. The former
legacy-backend cutover comparison is intentionally retired.

Options:
  --pages RANGE       One-based page selection accepted by the dense path
  --runs N            Fresh child runs per input (default: 1, maximum: 20)
  --timeout-ms N      Per-run timeout (default: ${DEFAULT_TIMEOUT_MS})
  --json PATH         Write the machine-readable report to PATH
  --                  Treat all remaining arguments as PDF paths
  -h, --help          Show this help
`);
}
