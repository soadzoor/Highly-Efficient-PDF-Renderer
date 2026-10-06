import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "vite";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
await access(new URL("../dist/bundler/lodWorkerEntry.js", import.meta.url));
const assets = await readdir(new URL("../dist/lib/assets/", import.meta.url));
assert(assets.some(name => /^lodWorkerEntry-.*\.js$/.test(name)), "The library must ship its LOD worker asset");
for (const base of ["./", "/hepr-smoke/"]) {
  const result = await build({
    configFile: false, publicDir: false, logLevel: "error", base,
    worker: { format: "es" },
    build: { write: false, lib: {
      entry: fileURLToPath(new URL("../dist/bundler/lodWorkerClient.js", import.meta.url)), formats: ["es"]
    } }
  });
  const files = [result].flat().flatMap(output => output.output);
  assert(files.some(file => /^assets\/lodWorkerEntry-.*\.js$/.test(file.fileName)),
    "A consuming bundler must emit the module worker from the preserved package graph");
  const entry = files.find(file => file.type === "chunk" && file.isEntry);
  assert(entry && !entry.code.includes("lodWorkerEntry.ts"), "Consumer output must use its emitted worker asset");
}

// Exercise built module URLs and worker imports through actual worker_threads.
// This transports synthetic scene data only; no PDFs, browser or server is used.
const { stdout } = await execFileAsync(process.execPath, [
  "--experimental-strip-types", fileURLToPath(new URL("./test-lod-worker.mjs", import.meta.url)), "--package"
], { cwd: root, encoding: "utf8", timeout: 30_000 });
process.stdout.write(stdout);
console.log("LOD worker package graph and both deployment bases passed.");
