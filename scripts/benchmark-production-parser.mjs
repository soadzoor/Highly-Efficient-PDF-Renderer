import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";

const CHILD_FLAG = "--hepr-production-parser-child";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1_000;

async function main() {
  if (process.argv[2] === CHILD_FLAG) {
    await runChild(JSON.parse(process.argv[3]));
    return;
  }
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage(process.stderr);
    process.exitCode = 1;
  }
  if (options?.showHelp) printUsage();
  else if (options) await runController(options);
}

async function runController(options) {
  if (!options.inputPath) {
    printUsage(process.stderr);
    process.exitCode = 1;
    return;
  }
  const inputPath = resolve(options.inputPath);
  const packageRoot = resolve(options.packageRoot);
  const entryPath = resolve(packageRoot, options.entry);
  await access(inputPath);
  await access(entryPath);

  console.log("Production-bundle parser benchmark");
  console.log(`Input: ${inputPath}`);
  console.log(`Bundle: ${entryPath}`);
  console.log(`Pages: ${options.pages ?? "all"}`);
  console.log(`Fresh-process runs: ${options.runs}`);
  console.log("Input I/O and package import are reported separately; LOD, upload, and rendering are not run.");

  const reports = [];
  for (let index = 0; index < options.runs; index += 1) {
    const report = await spawnChild({
      inputPath,
      entryPath,
      pages: options.pages,
      timeoutMs: options.timeoutMs
    });
    reports.push(report);
    if (report.outcome === "success") {
      console.log(
        `Run ${index + 1}: parser ${formatMs(report.parserMs)}, ` +
        `public boundary ${formatMs(report.publicBoundaryMs)}, ` +
        `module ${formatMs(report.moduleLoadMs)}, route ${report.route}, ` +
        `RSS +${formatBytes(report.memory.rssDelta)}`
      );
    } else {
      console.log(`Run ${index + 1}: ERROR ${report.errorName}: ${report.errorMessage}`);
    }
  }

  const successful = reports.filter((report) => report.outcome === "success");
  const fallbackRuns = successful.filter((report) => report.pdfJsFallback).length;
  const failed = successful.length !== reports.length ||
    (options.failOnPdfJsFallback && fallbackRuns > 0);
  if (successful.length > 0) {
    console.log("\nMedians");
    console.log(`parser engine boundary     ${formatMs(median(successful.map((r) => r.parserMs)))}`);
    console.log(`public pre-LOD boundary    ${formatMs(median(successful.map((r) => r.publicBoundaryMs)))}`);
    console.log(`package module load        ${formatMs(median(successful.map((r) => r.moduleLoadMs)))}`);
    console.log(`sampled peak RSS delta     ${formatBytes(median(successful.map((r) => r.memory.rssDelta)))}`);
    console.log(`PDF.js fallback runs       ${fallbackRuns}/${successful.length}`);
  }

  if (options.jsonPath) {
    const outputPath = resolve(options.jsonPath);
    await writeFile(outputPath, `${JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      inputPath,
      packageRoot,
      entryPath,
      pages: options.pages ?? null,
      reports
    }, null, 2)}\n`, "utf8");
    console.log(`Wrote ${outputPath}`);
  }
  if (failed) process.exitCode = 2;
}

async function spawnChild({ inputPath, entryPath, pages, timeoutMs }) {
  const directory = await mkdtemp(join(tmpdir(), "hepr-production-parser-"));
  const resultPath = join(directory, "result.json");
  try {
    const payload = JSON.stringify({ inputPath, entryPath, pages, resultPath });
    await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, [
        ...childExecArguments(),
        import.meta.filename,
        CHILD_FLAG,
        payload
      ], { stdio: ["ignore", "ignore", "inherit"] });
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        rejectPromise(new Error(`Benchmark child exceeded ${formatMs(timeoutMs)}.`));
      }, timeoutMs);
      child.once("error", (error) => {
        clearTimeout(timeout);
        rejectPromise(error);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timeout);
        if (code === 0) resolvePromise();
        else rejectPromise(new Error(
          `Benchmark child exited ${signal ? `on ${signal}` : `with code ${code}`}.`
        ));
      });
    });
    return JSON.parse(await readFile(resultPath, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function childExecArguments() {
  // Node worker_threads rejects --expose-gc when it is inherited by a file
  // worker. The parser workers do not need it; peak RSS remains observable.
  return process.execArgv.filter((argument) => argument !== "--expose-gc");
}

async function runChild({ inputPath, entryPath, pages, resultPath }) {
  const inputStartedAt = performance.now();
  const bytes = new Uint8Array(await readFile(inputPath));
  const inputReadMs = performance.now() - inputStartedAt;
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  installBrowserWorkerAdapter();
  let report;
  try {
    const moduleStartedAt = performance.now();
    const module = await import(pathToFileURL(entryPath).href);
    const moduleLoadMs = performance.now() - moduleStartedAt;
    if (typeof module.pdfObjectGenerator !== "function") {
      throw new TypeError(`${entryPath} does not export pdfObjectGenerator().`);
    }
    collectGarbage();
    const memory = createMemorySampler();
    const progressPaths = new Set();
    const progressStages = new Set();
    let parserCompletedAt = null;
    let publicCompletedAt = null;
    const completed = Object.freeze({ benchmark: "parser-complete" });
    const parserStartedAt = performance.now();
    try {
      await module.pdfObjectGenerator(new Uint8Array(bytes), {
        sourceKind: "pdf",
        pages,
        segmentMerge: true,
        invisibleCull: true,
        vectorLod: "off",
        textLod: "off",
        onProgress(event) {
          const now = performance.now();
          memory.sample();
          if (typeof event?.stage === "string") progressStages.add(event.stage);
          if (typeof event?.executionPath === "string") {
            progressPaths.add(event.executionPath);
            parserCompletedAt = now;
          }
          if (event?.stage === "vector-lod") {
            publicCompletedAt = now;
            throw completed;
          }
        }
      });
      throw new Error("pdfObjectGenerator() completed without reporting the pre-LOD boundary.");
    } catch (error) {
      if (error !== completed) throw error;
    }
    memory.sample();
    const memoryResult = memory.stop();
    if (parserCompletedAt === null || publicCompletedAt === null) {
      throw new Error("The production bundle did not report a parser execution path.");
    }
    const executionPaths = [...progressPaths].sort();
    report = {
      outcome: "success",
      inputName: basename(inputPath),
      inputBytes: bytes.byteLength,
      inputReadMs,
      moduleLoadMs,
      parserMs: parserCompletedAt - parserStartedAt,
      publicBoundaryMs: publicCompletedAt - parserStartedAt,
      executionPaths,
      progressStages: [...progressStages].sort(),
      route: classifyRoute(executionPaths),
      pdfJsFallback: executionPaths.includes("main-thread-fallback"),
      browserWorkerAdapterCount: BrowserWorkerAdapter.createdCount,
      memory: memoryResult,
      runtime: {
        node: process.versions.node,
        v8: process.versions.v8,
        platform: process.platform,
        arch: process.arch
      }
    };
  } catch (error) {
    report = {
      outcome: "error",
      inputName: basename(inputPath),
      inputBytes: bytes.byteLength,
      inputReadMs,
      errorName: error instanceof Error ? error.name : "Error",
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  } finally {
    restoreGlobal("Worker", originalWorker);
  }
  await writeFile(resultPath, JSON.stringify(report), "utf8");
}

class BrowserWorkerAdapter {
  static createdCount = 0;
  listeners = { message: new Set(), error: new Set(), messageerror: new Set() };

  constructor(specifier, options = {}) {
    BrowserWorkerAdapter.createdCount += 1;
    const entry = specifier instanceof URL
      ? specifier
      : new URL(String(specifier), pathToFileURL(`${process.cwd()}/`));
    const bootstrap = new URL(`data:text/javascript,${encodeURIComponent(`
      import { parentPort, workerData } from "node:worker_threads";
      Promise.try ??= (callback, ...args) => Promise.resolve().then(() => callback(...args));
      Uint8Array.prototype.toHex ??= function () {
        return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("hex");
      };
      Uint8Array.prototype.toBase64 ??= function () {
        return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("base64");
      };
      Uint8Array.fromHex ??= (value) => new Uint8Array(Buffer.from(value, "hex"));
      Uint8Array.fromBase64 ??= (value) => new Uint8Array(Buffer.from(value, "base64"));
      const listeners = new Set();
      const pending = [];
      parentPort.on("message", (data) => {
        if (listeners.size === 0) pending.push(data);
        else for (const listener of listeners) listener({ data });
      });
      const scope = {
        addEventListener(type, listener) {
          if (type !== "message") return;
          listeners.add(listener);
          while (pending.length > 0) listener({ data: pending.shift() });
        },
        removeEventListener(type, listener) {
          if (type === "message") listeners.delete(listener);
        },
        postMessage(message, transfer) { parentPort.postMessage(message, transfer); }
      };
      Object.defineProperty(globalThis, "self", { configurable: true, value: scope });
      await import(workerData.entry);
    `)}`);
    this.worker = new NodeWorker(bootstrap, {
      name: options.name,
      execArgv: [],
      workerData: { entry: entry.href }
    });
    this.worker.on("message", (data) => this.emit("message", { data }));
    this.worker.on("messageerror", (error) => this.emit("messageerror", { error }));
    this.worker.on("error", (error) => this.emit("error", {
      message: error.message,
      error,
      preventDefault() {}
    }));
  }

  addEventListener(type, listener) { this.listeners[type]?.add(listener); }
  removeEventListener(type, listener) { this.listeners[type]?.delete(listener); }
  postMessage(message, transfer) { this.worker.postMessage(message, transfer); }
  terminate() { void this.worker.terminate(); }
  emit(type, event) {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }
}

function installBrowserWorkerAdapter() {
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: BrowserWorkerAdapter
  });
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
  return {
    sample,
    stop() {
      clearInterval(timer);
      sample();
      return {
        rss: peak.rss,
        rssDelta: Math.max(0, peak.rss - baseline.rss),
        heapUsed: peak.heapUsed,
        arrayBuffers: peak.arrayBuffers
      };
    }
  };
}

function classifyRoute(paths) {
  if (paths.includes("main-thread-fallback")) return "pdfjs-fallback";
  if (paths.includes("worker") && paths.includes("dense-vector-worker")) {
    return "native-full-after-dense";
  }
  if (paths.includes("worker")) return "native-full";
  if (paths.includes("dense-vector-worker")) return "dense";
  return "unknown";
}

function parseArguments(args) {
  const output = {
    inputPath: null,
    packageRoot: ".",
    entry: "dist/lib/index.js",
    pages: undefined,
    runs: 3,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    jsonPath: undefined,
    failOnPdfJsFallback: false,
    showHelp: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") output.showHelp = true;
    else if (argument === "--package-root") output.packageRoot = requireValue(argument, args[++index]);
    else if (argument.startsWith("--package-root=")) output.packageRoot = requireValue("--package-root", argument.slice(15));
    else if (argument === "--entry") output.entry = requireValue(argument, args[++index]);
    else if (argument.startsWith("--entry=")) output.entry = requireValue("--entry", argument.slice(8));
    else if (argument === "--pages") output.pages = requireValue(argument, args[++index]);
    else if (argument.startsWith("--pages=")) output.pages = requireValue("--pages", argument.slice(8));
    else if (argument === "--runs") output.runs = requireInteger(argument, args[++index], 1, 20);
    else if (argument.startsWith("--runs=")) output.runs = requireInteger("--runs", argument.slice(7), 1, 20);
    else if (argument === "--timeout-ms") output.timeoutMs = requireInteger(argument, args[++index], 1_000, 3_600_000);
    else if (argument.startsWith("--timeout-ms=")) output.timeoutMs = requireInteger("--timeout-ms", argument.slice(13), 1_000, 3_600_000);
    else if (argument === "--json") output.jsonPath = requireValue(argument, args[++index]);
    else if (argument.startsWith("--json=")) output.jsonPath = requireValue("--json", argument.slice(7));
    else if (argument === "--fail-on-pdfjs-fallback") output.failOnPdfJsFallback = true;
    else if (argument.startsWith("-")) throw new TypeError(`Unknown option: ${argument}`);
    else if (output.inputPath === null) output.inputPath = argument;
    else throw new TypeError(`Unexpected positional argument: ${argument}`);
  }
  return output;
}

function requireValue(name, value) {
  if (!value) throw new TypeError(`${name} requires a value.`);
  return value;
}

function requireInteger(name, value, minimum, maximum) {
  if (!/^\d+$/.test(value ?? "")) throw new TypeError(`${name} requires an integer.`);
  const number = Number(value);
  if (number < minimum || number > maximum) {
    throw new RangeError(`${name} must be from ${minimum} through ${maximum}.`);
  }
  return number;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function collectGarbage() { if (typeof globalThis.gc === "function") globalThis.gc(); }
function formatMs(value) { return `${value.toFixed(1)} ms`; }
function formatBytes(value) { return `${(value / (1024 * 1024)).toFixed(1)} MiB`; }
function restoreGlobal(name, descriptor) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else delete globalThis[name];
}

function printUsage(stream = process.stdout) {
  stream.write(`Usage: npm run benchmark:production-parser -- <PDF path> [options]

Measures the production-built public parser route in isolated Node processes.
The parser boundary is the final engine progress event; execution aborts at the
public pre-LOD boundary, so vector/text LOD, GPU upload, and rendering never run.

Options:
  --package-root PATH          Build root to test (default: current directory)
  --entry PATH                 Entry below package root (default: dist/lib/index.js)
  --pages RANGE               One-based page selection
  --runs N                    Fresh-process runs, 1-20 (default: 3)
  --timeout-ms N              Per-run timeout (default: ${DEFAULT_TIMEOUT_MS})
  --json PATH                 Write machine-readable results
  --fail-on-pdfjs-fallback    Exit nonzero if main-thread-fallback is observed
  -h, --help                  Show this help
`);
}

await main();
