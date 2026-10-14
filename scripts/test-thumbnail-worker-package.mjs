import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { build } from "vite";

const bundlerDir = resolve(process.argv[2] ?? "dist/bundler"), libDir = resolve(process.argv[3] ?? "dist/lib");
await access(resolve(bundlerDir, "thumbnailEncodeWorker.js"));
const assets = await readdir(resolve(libDir, "assets"));
assert(assets.some(name => /^thumbnailEncodeWorker-.*\.js$/.test(name)), "library ships the thumbnail encoder worker");
assert(assets.some(name => /^libwebp-3757b8a-simd-.*\.wasm$/.test(name)), "library ships the lazy, pinned thumbnail WebP codec");

const scratch = await mkdtemp(resolve(tmpdir(), "hepr-thumbnail-package-"));
let worker;
try {
  let relativeFiles;
  for (const base of ["./", "/hepr-smoke/"]) {
    const result = await build({ configFile: false, publicDir: false, logLevel: "error", base,
      worker: { format: "es" }, build: { write: false,
        lib: { entry: resolve(bundlerDir, "thumbnailEncoder.js"), formats: ["es"] } } });
    const files = [result].flat().flatMap(output => output.output);
    assert(files.some(file => /^assets\/thumbnailEncodeWorker-.*\.js$/.test(file.fileName)),
      "consumer emits the encoder worker at either deployment base");
    assert(files.some(file => /^assets\/libwebp-3757b8a-simd-.*\.wasm$/.test(file.fileName)),
      "consumer emits the local encoder WASM asset at either deployment base");
    assert(files.filter(file => /\.js$/.test(file.fileName)).every(file =>
      !(file.type === "chunk" ? file.code : Buffer.from(file.source).toString("utf8")).includes("thumbnailEncodeWorker.ts")),
      "consumer uses emitted worker URLs rather than source TypeScript paths");
    if (base === "./") relativeFiles = files;
  }
  await writeFile(resolve(scratch, "package.json"), '{"type":"module"}\n');
  for (const file of relativeFiles) {
    const target = resolve(scratch, file.fileName);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.type === "chunk" ? file.code : file.source);
  }
  const workerFile = relativeFiles.find(file => /^assets\/thumbnailEncodeWorker-.*\.js$/.test(file.fileName));
  const adapter = resolve(scratch, "adapter.mjs");
  await writeFile(adapter, `import { parentPort, workerData } from "node:worker_threads";
globalThis.postMessage = message => parentPort.postMessage(message);
await import(workerData.entry);
parentPort.on("message", data => globalThis.onmessage({ data }));
`);
  worker = new Worker(pathToFileURL(adapter), { workerData: { entry: pathToFileURL(resolve(scratch, workerFile.fileName)).href } });
  const rgba = Uint8Array.of(20, 100, 200, 0, 70, 30, 210, 1, 250, 255, 190, 128, 25, 150, 40, 255);
  for (const format of ["webp", "png"]) {
    const response = await new Promise((accept, reject) => {
      const timeout = setTimeout(() => reject(Error("packaged thumbnail worker timed out")), 10_000);
      const onError = error => { clearTimeout(timeout); reject(error); };
      worker.once("error", onError);
      worker.once("message", message => { clearTimeout(timeout); worker.removeListener("error", onError); accept(message); });
      const copy = rgba.slice();
      worker.postMessage({ id: 1, pixels: { width: 2, height: 2, rgba: copy }, format }, [copy.buffer]);
    });
    assert.equal(response.error, undefined);
    assert.equal(response.blob.type, `image/${format}`, "the actual emitted worker loads the emitted WASM without falling back");
    assert.deepEqual(response.diagnostics, []);
    const bytes = new Uint8Array(await response.blob.arrayBuffer());
    if (format === "webp") assert.equal(new TextDecoder().decode(bytes.subarray(12, 16)), "VP8L");
  }
  console.log("Thumbnail worker package: worker/codec emission at both deployment bases and actual emitted lossless WebP/PNG encoding passed.");
} finally { await worker?.terminate(); await rm(scratch, { recursive: true, force: true }); }
