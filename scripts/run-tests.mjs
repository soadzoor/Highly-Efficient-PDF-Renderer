import { access, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { run } from "node:test";
import { spec } from "node:test/reporters";
import { pathToFileURL } from "node:url";
import { discoverTests, repoRoot, selectSuite, suiteBudgetMs, testTimeoutMs } from "./lib/testSuites.mjs";

const usage = `Usage:
  node scripts/run-tests.mjs <suite> [--list] [--timeout=ms] [--budget=ms]
  node scripts/run-tests.mjs file [--list] [--timeout=ms] <path> [-- <test arguments>]

Suites: fast, unit, integration, package, browser, conversion, corpus.
Tests run sequentially in isolated Node processes. --list never executes tests.
The package suite requires npm run build:lib; conversion/browser/corpus suites
are opt-in and can require Vite middleware, fixtures, or generated artifacts.`;

export function parseArgs(args) {
  const [suite, ...rest] = args;
  if (!suite || suite === "--help" || suite === "-h") return { help: true };
  const options = { suite, list: false, timeout: testTimeoutMs, budget: suiteBudgetMs, files: [], argv: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--list") options.list = true;
    else if (arg.startsWith("--timeout=") || arg.startsWith("--budget=")) {
      const separator = arg.indexOf("=");
      const key = arg.slice(2, separator);
      const value = arg.slice(separator + 1);
      const milliseconds = Number(value);
      if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0 || milliseconds > 2_147_483_647) {
        throw new Error(`${key} must be a positive integer number of milliseconds (at most 2147483647).`);
      }
      options[key] = milliseconds;
    } else if (suite === "file" && !arg.startsWith("-")) {
      options.files = [resolve(repoRoot, arg)];
      options.argv = rest.slice(index + 1);
      if (options.argv[0] === "--") options.argv.shift();
      break;
    } else {
      throw new Error(`Unexpected argument "${arg}".\n${usage}`);
    }
  }
  if (suite === "file" && options.files.length === 0) throw new Error(`Provide a test file path.\n${usage}`);
  return options;
}

export async function executeTests({ files, argv = [], timeout = testTimeoutMs, budget = suiteBudgetMs }) {
  if (!files.length) throw new Error("Refusing to run without an explicit test selection.");
  const controller = new AbortController();
  let failed = false;
  let completed = 0;
  const timer = setTimeout(() => {
    failed = true;
    console.error(`Test suite exceeded its ${budget}ms total budget.`);
    controller.abort();
  }, budget);
  timer.unref();
  const interrupt = () => {
    failed = true;
    controller.abort();
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    for (const file of files) {
      if (controller.signal.aborted) break;
      // Enforce the deadline in the parent too: a legacy test's synchronous
      // loop can prevent Node's in-test timeout from firing in the child.
      const fileController = new AbortController();
      const fileTimer = setTimeout(() => {
        failed = true;
        fileController.abort(new Error(`Test file timed out after ${timeout}ms: ${file}`));
      }, timeout);
      fileTimer.unref();
      try {
        const stream = run({
          files: [file],
          cwd: repoRoot,
          argv,
          concurrency: 1,
          isolation: "process",
          execArgv: ["--experimental-strip-types"],
          timeout,
          signal: AbortSignal.any([controller.signal, fileController.signal])
        });
        stream.on("test:fail", () => { failed = true; });
        for await (const chunk of stream.compose(spec)) process.stdout.write(chunk);
        completed += 1;
      } finally {
        clearTimeout(fileTimer);
      }
    }
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
  console.log(`${completed}/${files.length} test files completed${failed ? " with failures" : " successfully"}.`);
  return failed ? 1 : 0;
}

export async function main(args = process.argv.slice(2)) {
  try {
    const options = parseArgs(args);
    if (options.help) {
      console.log(usage);
      return;
    }
    if (options.suite !== "file") {
      options.files = selectSuite(options.suite, await discoverTests()).map(file => resolve(repoRoot, file));
    }
    for (const file of options.files) {
      if (!(await stat(file)).isFile()) throw new Error(`Test path is not a file: ${file}`);
    }
    if (options.list) {
      for (const file of options.files) console.log(file);
      console.log(`${options.files.length} test file(s); no tests executed.`);
      return;
    }
    if (options.suite === "package" || options.files.includes(resolve(repoRoot, "scripts/test-hep-package.mjs"))) {
      try {
        await access(resolve(repoRoot, "dist/lib/index.js"));
        await access(resolve(repoRoot, "dist/types/index.d.ts"));
      } catch {
        throw new Error("Built package artifacts are missing. Run npm run build:lib first.");
      }
    }
    process.exitCode = await executeTests(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
