import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, open, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = await mkdtemp(resolve(tmpdir(), "hepr-cli-consumer-"));
const consumer = resolve(fixture, "consumer");
const installed = resolve(consumer, "node_modules/@soadzoor/hepr");
const environment = {
  ...process.env,
  HEPR_PDF_TO_HEP_HEAP_MB: "512",
  npm_config_cache: resolve(fixture, ".npm-cache"),
  npm_config_update_notifier: "false"
};
// Host worker settings must not turn ordinary consumer commands into workers.
for (const name of [
  "NODE_TEST_CONTEXT",
  "HEPR_PDF_TO_HEP_INTERNAL_WORKER", "HEPR_PDF_TO_HEP_BATCH_INDEX",
  "HEPR_PDF_TO_HEP_BATCH_TOTAL", "HEPR_PDF_TO_HEP_WORKER_TOKEN", "HEPR_PDF_PASSWORD"
]) delete environment[name];

async function command(executable, args, expectedCode = 0) {
  const outputPath = resolve(fixture, "command.log");
  const outputFile = await open(outputPath, "w");
  let code = 0;
  try {
    // File-backed output also keeps nested Node commands independent of pipe
    // flushing and the parent test runner's stdout protocol.
    execFileSync(executable, args, {
      cwd: consumer, env: environment, stdio: ["ignore", outputFile.fd, outputFile.fd],
      timeout: 10_000, killSignal: "SIGKILL"
    });
  } catch (error) {
    if (!Number.isInteger(error.status) || error.signal) throw error;
    code = error.status;
  } finally {
    await outputFile.close();
  }
  const output = await readFile(outputPath, "utf8");
  assert.equal(code, expectedCode, `${executable} ${args.join(" ")}\n${output}`);
  return output;
}

try {
  await execFileAsync("npm", [
    "pack", "--ignore-scripts", "--pack-destination", fixture
  ], { cwd: root, env: environment, encoding: "utf8", timeout: 20_000 });
  const archives = (await readdir(fixture)).filter(name => name.endsWith(".tgz"));
  assert.equal(archives.length, 1, "npm pack must create exactly one package archive");
  await mkdir(installed, { recursive: true });
  await execFileAsync("tar", ["-xzf", resolve(fixture, archives[0]), "--strip-components=1", "-C", installed]);
  const manifest = JSON.parse(await readFile(resolve(installed, "package.json"), "utf8"));
  assert.equal(resolve(installed, manifest.bin["pdf-to-hep"]), resolve(installed, "bin/pdf-to-hep.js"));
  assert.ok(manifest.optionalDependencies?.["@napi-rs/canvas"],
    "npx must request native canvas without making a failed native install fatal");
  const launcher = resolve(installed, manifest.bin["pdf-to-hep"]);
  await access(launcher);
  await access(resolve(installed, "PDFtoHEP.js"));
  await access(resolve(installed, "bin/runtime.mjs"));
  await access(resolve(installed, "dist/lib/pdf-to-hep-runtime.js"));
  for (const unavailable of ["src", "scripts", "node_modules/vite"]) {
    await assert.rejects(access(resolve(installed, unavailable)), error => error.code === "ENOENT",
      `published CLI must work without ${unavailable}`);
  }
  await writeFile(resolve(consumer, "package.json"), JSON.stringify({
    name: "hepr-cli-consumer", private: true, type: "module",
    dependencies: { "@soadzoor/hepr": manifest.version }
  }));
  await mkdir(resolve(consumer, "node_modules/.bin"));
  const binLink = resolve(consumer, "node_modules/.bin/pdf-to-hep");
  await symlink(launcher, binLink, "file");

  const help = await command(process.execPath, [binLink, "--help"]);
  assert.match(help, /pdf-to-hep .*<pdf-or-directory>/);
  assert.match(help, /--workers=<count>/);
  assert.match(help, /--output-dir=<directory>/);
  assert.match(await command("npm", ["exec", "--offline", "--no", "--", "pdf-to-hep", "--help"]),
    /pdf-to-hep .*<pdf-or-directory>/, "npm exec must resolve the installed bin without network access");
  assert.match(await command("npx", ["--offline", "--no", "--", "@soadzoor/hepr", "--help"]),
    /pdf-to-hep .*<pdf-or-directory>/, "npx must infer the package's executable without network access");
  assert.match(await command(process.execPath, [binLink], 1), /Pass a PDF file or directory/);
  assert.match(await command(process.execPath, [binLink, "--unknown", "input.pdf"], 1), /Unknown option/);
  assert.match(await command(process.execPath, [binLink, "missing.pdf"], 1), /Input does not exist/);
  await mkdir(resolve(consumer, "empty"));
  assert.match(await command(process.execPath, [binLink, "empty"], 1), /No PDF files found/);

  // Dummy PDFs are never parsed. The skip path proves relative input/output
  // handling without generating a HEP archive from a PDF.
  await mkdir(resolve(consumer, "pdfs"));
  await mkdir(resolve(consumer, "heps"));
  await writeFile(resolve(consumer, "pdfs/Level 1.pdf"), "PDF fixture must not be parsed");
  const existingHep = resolve(consumer, "heps/Level_1-parsed-data.hep");
  await writeFile(existingHep, "existing HEP sentinel");
  const skip = await command(process.execPath, [binLink, "--output-dir=./heps", "./pdfs"]);
  assert.match(skip, /Skipping existing/);
  assert.match(skip, /1 existing HEP file\(s\) skipped/);
  const npxSkip = await command("npx", ["--offline", "--no", "@soadzoor/hepr", "./pdfs", "--output-dir=./heps"]);
  assert.match(npxSkip, /1 existing HEP file\(s\) skipped/,
    "the documented npx command must forward conversion options after the package name");
  assert.equal(await readFile(existingHep, "utf8"), "existing HEP sentinel");

  // Deliberately omit native canvas in this unpacked consumer. A real batch
  // child must launch the packaged bin and stop before PDF parsing begins.
  await writeFile(resolve(consumer, "unconverted.pdf"), "PDF fixture must not be parsed");
  const missingCanvas = await command(process.execPath,
    [binLink, "--workers=1", "unconverted.pdf"], 1);
  assert.match(missingCanvas, /@napi-rs\/canvas could not be loaded/);
  assert.match(missingCanvas, /npm install @soadzoor\/hepr @napi-rs\/canvas/);
  assert.match(missingCanvas, /0 generated, 0 skipped, 1 failed/);
  await assert.rejects(access(resolve(consumer, "unconverted-parsed-data.hep")), error => error.code === "ENOENT");

  // Only Three is linked from the checkout. Builder loading must use plain
  // compiled JavaScript, with no TypeScript loader or Vite installed here.
  await symlink(resolve(root, "node_modules/three"), resolve(consumer, "node_modules/three"), "junction");
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      assert.notEqual(specifier, "vite", "published builder must not import Vite");
      const result = nextResolve(specifier, context);
      assert.ok(!/\/src\/|\.ts(?:[?#]|$)/.test(result.url),
        `published builder must not load source files: ${result.url}`);
      return result;
    }
  });
  try {
    const { loadPublishedHepBuilder } = await import(pathToFileURL(resolve(installed, "bin/runtime.mjs")));
    const builder = await loadPublishedHepBuilder();
    assert.equal(typeof builder.buildHep, "function");
    assert.equal(typeof builder.HepArchive.loadAsync, "function");
    await builder.close();
  } finally {
    hooks.deregister();
  }

  // A recognizable PDF header with a malformed trailer reaches the packaged
  // parser worker, while rejecting before any HEP is generated.
  await symlink(resolve(root, "node_modules/@napi-rs"), resolve(consumer, "node_modules/@napi-rs"), "junction");
  await writeFile(resolve(consumer, "invalid.pdf"), "%PDF-1.7\nstartxref\ninvalid\n%%EOF\n");
  const invalidPdf = await command(process.execPath, [binLink, "--workers=1", "invalid.pdf"], 1);
  assert.match(invalidPdf, /PDF repair found no indirect objects/);
  assert.match(invalidPdf, /0 generated, 0 skipped, 1 failed/);
  await assert.rejects(access(resolve(consumer, "invalid-parsed-data.hep")), error => error.code === "ENOENT");

  const { parsePdfToHepArguments, startPdfToHepWorker } = await import(pathToFileURL(resolve(installed, "PDFtoHEP.js")));
  const child = new EventEmitter();
  let invocation;
  const worker = startPdfToHepWorker({
    pdfPath: resolve(consumer, "pdfs/Level 1.pdf"), outputDirectory: resolve(consumer, "heps"),
    fileNumber: 2, fileCount: 3, password: "fixture password", iccEngine: "lcms",
    annotationAppearances: "forms", keepUnchanged: true,
    withVectorLod: true, withTextLod: true, vectorLodPrecision: "lossless"
  }, true, 512, (executable, args, options) => {
    invocation = { executable, args, options };
    return child;
  }, launcher);
  assert.equal(invocation.executable, process.execPath);
  assert.equal(invocation.args[0], "--max-old-space-size=512");
  assert.equal(invocation.args[1], launcher, "workers must launch the packaged entry rather than the source CLI");
  assert.deepEqual(parsePdfToHepArguments(invocation.args.slice(2)), {
    force: true, help: false, inputPath: resolve(consumer, "pdfs/Level 1.pdf"),
    outputDirectory: resolve(consumer, "heps"), iccEngine: "lcms", annotationAppearances: "forms",
    keepUnchanged: true, withVectorLod: true, withTextLod: true, vectorLodPrecision: "lossless"
  });
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.env.HEPR_PDF_PASSWORD, "fixture password");
  assert.ok(invocation.args.every(argument => !argument.includes("fixture password")));
  child.emit("close", 0, null);
  assert.deepEqual(await worker.completion, { code: 0, signal: null });
  console.log("Packed PDF-to-HEP CLI: npm executable, help/errors, relative skips, worker launch and compiled builder passed; no PDFs converted.");
} finally {
  await rm(fixture, { recursive: true, force: true });
}
