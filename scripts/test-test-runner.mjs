import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTests, explicitSuites, fastTests, primarySuite, selectSuite } from "./lib/testSuites.mjs";
import { parseArgs } from "./run-tests.mjs";

const runner = fileURLToPath(new URL("./run-tests.mjs", import.meta.url));
const temp = await mkdtemp(join(tmpdir(), "hepr test runner "));
const env = { ...process.env };
// Nested regression invocations must run as independent test controllers.
delete env.NODE_TEST_CONTEXT;

async function invoke(args) {
  const logPath = join(temp, "output.log");
  const log = await open(logPath, "w");
  let code = 0;
  try {
    // Regular files keep output assertions independent of pipe flushing.
    execFileSync(process.execPath, args, {
      env, stdio: ["ignore", log.fd, log.fd], timeout: 8_000, killSignal: "SIGKILL"
    });
  } catch (error) {
    assert.equal(error.signal, null, "the runner must finish or cancel children within the regression deadline");
    assert.ok(Number.isInteger(error.status), "the runner must exit with a status code");
    code = error.status;
  } finally {
    await log.close();
  }
  return { code, output: await readFile(logPath, "utf8") };
}

async function executeFixture(files, options = {}) {
  const launcher = join(temp, "launch.mjs");
  await writeFile(launcher,
    `import { executeTests } from ${JSON.stringify(new URL("./run-tests.mjs", import.meta.url).href)};\n` +
    `process.exitCode = await executeTests(${JSON.stringify({ files, timeout: 2_000, budget: 5_000, ...options })});\n`
  );
  return await invoke([launcher]);
}

try {
  const available = await discoverTests();
  assert.ok(!available.includes("fast"), "do not recursively discover the compatibility runner");
  const primaryNames = ["unit", "integration", ...Object.keys(explicitSuites)];
  const selected = primaryNames.flatMap(name => selectSuite(name, available));
  assert.equal(new Set(selected).size, available.length, "every test must belong to one primary suite");
  assert.equal(selected.length, available.length, "primary suites must not overlap");
  for (const names of Object.values(explicitSuites)) {
    assert.ok(names.every(name => !fastTests.includes(name)), "opt-in tests must not enter the default CI gate");
  }
  assert.equal(primarySuite("pdf-session-new-feature"), "integration");
  assert.equal(primarySuite("new-algorithm"), "unit");
  assert.throws(() => selectSuite("typo", available), /Unknown test suite/);
  assert.throws(() => selectSuite("fast", []), /Missing tests/);
  assert.throws(() => parseArgs(["file"]), /Provide a test file/);
  assert.throws(() => parseArgs(["unit", "--timeout=0"]), /positive integer/);
  assert.throws(() => parseArgs(["unit", "--budget=NaN"]), /positive integer/);

  const pass = join(temp, "pass.mjs");
  const fail = join(temp, "fail.mjs");
  const hang = join(temp, "hang.mjs");
  const later = join(temp, "later.mjs");
  const marker = join(temp, "executed");
  await writeFile(pass, 'import assert from "node:assert/strict"; assert.equal(globalThis.heprTestSentinel, undefined); globalThis.heprTestSentinel = true;\n');
  await writeFile(fail, 'throw new Error("intentional runner regression failure");\n');
  await writeFile(hang, 'while (true) {}\n');
  await writeFile(later, `import { writeFile } from "node:fs/promises"; await writeFile(${JSON.stringify(marker)}, "ran");\n`);

  const listed = await invoke([runner, "file", "--list", fail]);
  assert.equal(listed.code, 0);
  assert.match(listed.output, /no tests executed/);
  const optInList = await invoke([runner, "conversion", "--list"]);
  assert.equal(optInList.code, 0);
  assert.match(optInList.output, /test-hep-package\.mjs/);
  assert.notEqual((await invoke([runner, "file", join(temp, "missing.mjs")])).code, 0);
  assert.notEqual((await invoke([runner, "unknown-suite"])).code, 0);

  const argsFile = join(temp, "args.mjs");
  await writeFile(argsFile,
    'import assert from "node:assert/strict"; assert.deepEqual(process.argv.slice(2), ["path with spaces.pdf", "--print-reference"]);\n');
  const forwarded = await invoke([runner, "file", argsFile, "--", "path with spaces.pdf", "--print-reference"]);
  assert.equal(forwarded.code, 0, forwarded.output);

  // Repeating a module must still use a fresh process each time.
  const isolated = await executeFixture([pass, pass]);
  assert.equal(isolated.code, 0, isolated.output);
  const failed = await executeFixture([fail, later]);
  assert.equal(failed.code, 1, failed.output);
  assert.match(failed.output, /intentional runner regression failure/);
  assert.equal(await readFile(marker, "utf8"), "ran", "continue after a failed test");
  await rm(marker);

  const timedOut = await executeFixture([hang, later], { timeout: 200 });
  assert.equal(timedOut.code, 1, timedOut.output);
  assert.match(timedOut.output, /timed out/);
  assert.equal(await readFile(marker, "utf8"), "ran", "continue after a per-file timeout");
  await rm(marker);

  const overBudget = await executeFixture([hang, later], { budget: 200 });
  assert.equal(overBudget.code, 1, overBudget.output);
  assert.match(overBudget.output, /total budget/);
  await assert.rejects(readFile(marker), { code: "ENOENT" }, "cancel queued tests when the total budget expires");
  console.log("Test runner selection, opt-in boundaries, arguments, isolation, failures, and deadlines passed.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
