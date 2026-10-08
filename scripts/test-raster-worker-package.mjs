import assert from "node:assert/strict";
import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { build } from "vite";

// Optional paths permit validating isolated builds without overwriting repository artifacts.
const bundlerDir = resolve(process.argv[2] ?? "dist/bundler"), libDir = resolve(process.argv[3] ?? "dist/lib");
await access(resolve(bundlerDir, "rasterPreparationWorker.js"));
const assets = await readdir(resolve(libDir, "assets"));
assert(assets.some(name => /^rasterPreparationWorker-.*\.js$/.test(name)), "library ships its preparation worker");
for (const base of ["./", "/hepr-smoke/"]) {
  const result = await build({ configFile: false, publicDir: false, logLevel: "error", base,
    worker: { format: "es" }, build: { write: false, lib: { entry: resolve(bundlerDir, "rasterPreparation.js"), formats: ["es"] } } });
  const files = [result].flat().flatMap(output => output.output);
  assert(files.some(file => /^assets\/rasterPreparationWorker-.*\.js$/.test(file.fileName)),
    "consuming bundler emits the preparation worker at either deployment base");
  const entry = files.find(file => file.type === "chunk" && file.isEntry);
  assert(entry && !entry.code.includes("rasterPreparationWorker.ts"));
}

// Execute the shipped worker through a browser-global adapter in worker_threads.
// This uses synthetic packed pixels only; it starts no browser or development server.
const scratch = await mkdtemp(resolve(tmpdir(), "hepr-raster-worker-"));
let worker;
try {
  const adapter = resolve(scratch, "adapter.mjs");
  await writeFile(adapter, `import { parentPort, workerData } from "node:worker_threads";
globalThis.postMessage = (message, transfers) => parentPort.postMessage(message, transfers);
await import(workerData.entry);
parentPort.on("message", data => globalThis.onmessage({ data }));
`);
  worker = new Worker(pathToFileURL(adapter), { workerData: { entry: pathToFileURL(resolve(bundlerDir, "rasterPreparationWorker.js")).href } });
  const width = 257, height = 259, bits = new Uint8Array(Math.ceil(width / 8) * height).fill(0xaa);
  const before = bits.slice();
  const { planRasterTiles } = await import(pathToFileURL(resolve(bundlerDir, "rasterTiles.js")));
  const { buildPreparedRasterPixels } = await import(pathToFileURL(resolve(bundlerDir, "rasterPreparationCore.js")));
  const source = { width, height, data: new Uint8Array(), monochrome: { data: bits,
    colors: Uint8Array.of(0, 0, 0, 255, 255, 255, 255, 255),
    symbols: { symbols: [{ width: 1, height: 1, data: Uint8Array.of(128) }], placements: Int32Array.of(1,1,0,33,34,0) } } };
  for (const scale of [1, .25]) {
    const plan = planRasterTiles(width, height, 64, scale);
    const response = await new Promise((accept, reject) => {
      const timeout = setTimeout(() => reject(Error("packaged preparation worker timed out")), 10_000);
      worker.once("error", error => { clearTimeout(timeout); reject(error); });
      worker.once("message", message => { clearTimeout(timeout); accept(message); });
      worker.postMessage({ source, plan });
    });
    assert.equal(response.error, undefined);
    assert.deepEqual(response.result, buildPreparedRasterPixels(source, plan), "built worker returns exact packed/coverage tiles and mips");
  }
  assert.deepEqual(bits, before, "canonical packed input remains owned by the caller");
  console.log("Raster worker package: emitted assets, consumer deployment bases, actual packed/coverage transport and source ownership passed.");
} finally { await worker?.terminate(); await rm(scratch, { recursive: true, force: true }); }
