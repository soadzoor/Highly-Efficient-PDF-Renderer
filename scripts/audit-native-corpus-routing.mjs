import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CHILD_FLAG = "--hepr-native-routing-child";
const DEFAULT_TIMEOUT_MS = 35_000;
const DEFAULT_CORPUS_DIRECTORY = fileURLToPath(
  new URL("../public/examples/pdfs/", import.meta.url)
);

if (process.argv[2] === CHILD_FLAG) {
  await runChild(process.argv[3], process.argv[4] || undefined, process.argv[5]);
} else {
  await runController(parseArguments(process.argv.slice(2)));
}

async function runController({ inputPaths, pages, timeoutMs }) {
  const paths = inputPaths.length > 0
    ? inputPaths.map((inputPath) => resolve(inputPath))
    : (await readdir(DEFAULT_CORPUS_DIRECTORY, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"))
      .map((entry) => resolve(DEFAULT_CORPUS_DIRECTORY, entry.name))
      .sort((left, right) => basename(left).localeCompare(basename(right)));

  console.log(`Native routing audit (${paths.length} PDFs, ${timeoutMs}ms timeout each)`);
  console.log(`Pages: ${pages ?? "all"}`);
  let failed = 0;
  for (let index = 0; index < paths.length; index += 1) {
    const inputPath = paths[index];
    const report = await runOne(inputPath, pages, timeoutMs);
    const nativePage = Number.isInteger(report.nativeFailure?.sourcePageIndex)
      ? `source page ${report.nativeFailure.sourcePageIndex + 1}, `
      : "";
    const detail = report.nativeFailure
      ? `${nativePage}${report.nativeFailure.code}: ${report.nativeFailure.message}`
      : report.error
        ? `${report.error.name}: ${report.error.message}`
        : `${report.pageCount ?? "?"} page(s)`;
    console.log(
      `[${index + 1}/${paths.length}] ${basename(inputPath)}\t${report.route}\t` +
      `${formatMilliseconds(report.elapsedMs)}\t${detail}`
    );
    if (report.denseFallback) console.log(`  dense: ${report.denseFallback}`);
    if (report.nativeFailure?.details !== undefined) {
      console.log(`  details: ${JSON.stringify(report.nativeFailure.details)}`);
    }
    if (report.route !== "dense" && report.route !== "native-full") failed += 1;
  }
  console.log(`Native routing audit: ${paths.length - failed}/${paths.length} passed.`);
  if (failed > 0 || paths.length === 0) process.exitCode = 1;
}

async function runOne(inputPath, pages, timeoutMs) {
  const resultDirectory = await mkdtemp(join(tmpdir(), "hepr-native-routing-audit-"));
  const resultPath = join(resultDirectory, "result.json");
  try {
    return await new Promise((resolvePromise) => {
      const startedAt = performance.now();
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
        stdio: ["ignore", "ignore", "pipe"]
      });
      let stderr = "";
      let settled = false;
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => { stderr += chunk; });

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        resolvePromise({
          inputPath,
          route: "timeout",
          elapsedMs: performance.now() - startedAt,
          error: {
            name: "TimeoutError",
            message: `Exceeded the ${timeoutMs}ms per-file limit.`
          }
        });
      }, timeoutMs);

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolvePromise({
          inputPath,
          route: "child-error",
          elapsedMs: performance.now() - startedAt,
          error: serializeError(error)
        });
      });
      child.on("close", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        void readFile(resultPath, "utf8").then(
          (json) => resolvePromise(JSON.parse(json)),
          () => resolvePromise({
            inputPath,
            route: "child-error",
            elapsedMs: performance.now() - startedAt,
            error: {
              name: "ChildOutputError",
              message: stderr.trim() ||
                `The child emitted no routing result (code ${code}, signal ${signal ?? "none"}).`
            }
          })
        );
      });
    });
  } finally {
    await rm(resultDirectory, { recursive: true, force: true });
  }
}

async function runChild(inputPath, pages, resultPath) {
  installNodeRuntimeCompatibility();
  let pdfJsResolveAttempts = 0;
  const logs = [];
  const originalInfo = console.info;
  console.info = (...values) => {
    logs.push(values.map(String).join(" "));
  };
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (/^(?:pdfjs-dist|pdf-lib)(?:\/|$)/.test(specifier)) {
        pdfJsResolveAttempts += 1;
        throw new Error("HEPR routing audit stopped at the PDF.js import boundary.");
      }
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
  const startedAt = performance.now();
  let pageCount;
  let error;
  let lastProgress;
  try {
    const bytes = new Uint8Array(await readFile(inputPath));
    const { extractPdfPageScenes } = await import("../src/pdfVectorExtractor.ts");
    const scenes = await extractPdfPageScenes(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      {
        ...(pages ? { pages } : {}),
        enableSegmentMerge: true,
        enableInvisibleCull: true,
        onProgress(event) {
          lastProgress = event;
        }
      }
    );
    pageCount = scenes.length;
  } catch (cause) {
    error = serializeError(cause);
  } finally {
    hooks.deregister();
    console.info = originalInfo;
  }

  const denseSuccess = logs.find((line) => line.startsWith("[hepr] dense PDF fast path:"));
  const denseFallback = logs.findLast((line) =>
    line.startsWith("[hepr] dense PDF fast path fallback:") ||
    line.startsWith("[hepr] dense PDF fast path unavailable:") ||
    line.startsWith("[hepr] dense PDF fast path text/finalization fallback:")
  );
  const nativeFallback = logs.findLast((line) =>
    line.startsWith("[hepr] native PDF full tier fallback (")
  );
  const nativeFailure = error?.code ? {
    code: error.code,
    message: error.message,
    sourcePageIndex: error.pageIndex ?? lastProgress?.sourcePageIndex,
    details: error.details
  } : parseNativeFailure(nativeFallback, lastProgress);
  const route = pdfJsResolveAttempts > 0
    ? "pdfjs-fallback"
    : pageCount !== undefined
      ? denseSuccess ? "dense" : "native-full"
      : "failed-before-pdfjs";

  await writeFile(resultPath, JSON.stringify({
    inputPath,
    route,
    elapsedMs: performance.now() - startedAt,
    pageCount,
    pdfJsResolveAttempts,
    denseFallback: stripHeprPrefix(denseFallback),
    nativeFailure,
    lastProgress,
    error
  }), "utf8");
}

function parseNativeFailure(line, lastProgress) {
  if (!line) return undefined;
  const match = /^\[hepr\] native PDF full tier fallback \(([^)]+)\): (.*)$/.exec(line);
  if (!match) return { code: "unknown", message: line };
  return {
    code: match[1],
    message: match[2],
    ...(lastProgress?.sourcePageIndex === undefined
      ? {}
      : { sourcePageIndex: lastProgress.sourcePageIndex })
  };
}

function stripHeprPrefix(line) {
  if (!line) return undefined;
  return line.replace(/^\[hepr\] /, "");
}

function serializeError(error) {
  if (!(error instanceof Error)) {
    return { name: typeof error, message: String(error) };
  }
  const candidate = error;
  return {
    name: candidate.name,
    message: candidate.message,
    ...(typeof candidate.code === "string" ? { code: candidate.code } : {}),
    ...(typeof candidate.pageIndex === "number" ? { pageIndex: candidate.pageIndex } : {}),
    ...(candidate.details === undefined ? {} : { details: candidate.details })
  };
}

function childExecArguments() {
  const arguments_ = [...process.execArgv].filter((argument) => !argument.startsWith("--input-type"));
  if (!arguments_.includes("--experimental-strip-types")) {
    arguments_.push("--experimental-strip-types");
  }
  arguments_.push("--import", new URL("./lib/blockPdfDependencies.mjs", import.meta.url).href);
  return arguments_;
}

function installNodeRuntimeCompatibility() {
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

function parseArguments(arguments_) {
  const inputPaths = [];
  let pages;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--pages") {
      pages = requireValue(arguments_, ++index, argument);
    } else if (argument === "--timeout-ms") {
      timeoutMs = Number(requireValue(arguments_, ++index, argument));
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new RangeError("--timeout-ms must be a positive number.");
      }
    } else {
      inputPaths.push(argument);
    }
  }
  return { inputPaths, pages, timeoutMs };
}

function requireValue(arguments_, index, option) {
  const value = arguments_[index];
  if (!value) throw new Error(`${option} requires a value.`);
  return value;
}

function formatMilliseconds(milliseconds) {
  return `${Math.round(milliseconds)}ms`;
}
