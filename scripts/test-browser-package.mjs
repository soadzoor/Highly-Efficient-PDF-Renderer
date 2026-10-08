import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const libDir = fileURLToPath(new URL("../dist/lib/", import.meta.url));
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.deepEqual(Object.keys(manifest.dependencies ?? {}), [],
  "HEPR must have no regular runtime dependencies");
assert.equal(manifest.dependencies?.["@napi-rs/canvas"], undefined);
assert.ok(manifest.optionalDependencies?.["@napi-rs/canvas"],
  "the CLI canvas backend must be optional so browser consumers can omit its installation");
assert.equal(manifest.peerDependencies?.["@napi-rs/canvas"], undefined,
  "omitting optional dependencies must not install canvas as a required peer");

// Rebundle the emitted package, where minification has already folded constants.
// Remove Vite's hints to check that native isolation survives other bundlers.
const result = await build({
  root,
  configFile: false,
  publicDir: false,
  logLevel: "silent",
  base: "./",
  plugins: [{
    name: "hepr-browser-canvas-boundary",
    enforce: "pre",
    resolveId(id) {
      if (/^@napi-rs\/canvas(?:$|[-/])/.test(id)) {
        throw new Error(`Browser package attempted to resolve optional native dependency: ${id}`);
      }
    },
    transform(code, id) {
      if (id.startsWith(libDir) && id.endsWith(".js")) {
        return { code: code.replaceAll("@vite-ignore", ""), map: null };
      }
    }
  }],
  build: {
    write: false,
    minify: true,
    target: "es2022",
    assetsInlineLimit: 0,
    reportCompressedSize: false,
    rollupOptions: {
      input: { index: `${libDir}index.js`, pdfWorker: `${libDir}pdf-worker.js` },
      preserveEntrySignatures: "strict",
      external: id => id === "three" || id.startsWith("three/") || id.startsWith("node:"),
      output: { format: "es" }
    }
  }
});
const chunks = result.output.filter(file => file.type === "chunk");
for (const chunk of chunks) {
  assert.ok(Object.keys(chunk.modules).every(id => !/\/node_modules\/(?:jszip|pako)\//.test(id)),
    "browser chunks must not contain JSZip or its compression dependency");
  assert.ok(Object.keys(chunk.modules).every(id => !id.includes("/@napi-rs/canvas")),
    "browser chunks must not contain native canvas modules");
}
const entry = chunks.find(file => file.isEntry && file.facadeModuleId === `${libDir}index.js`);
const pdfWorkerEntry = chunks.find(file => file.isEntry && file.facadeModuleId === `${libDir}pdf-worker.js`);
assert(pdfWorkerEntry, "the parser worker must participate in browser packaging checks");
assert.ok(entry?.exports.includes("pdfObjectGenerator"));
assert.ok(entry.exports.includes("buildStrokeScene"));
assert.ok(entry.exports.includes("createThreePdfObject"));
assert.ok(entry.exports.includes("detectRooms"), "the root package must retain its room detection API");

const chunksByName = new Map(chunks.map(chunk => [chunk.fileName, chunk]));
function collectReachableChunks(includeDynamicImports, rootChunk = entry) {
  const reachable = new Set();
  const pending = [rootChunk.fileName];
  while (pending.length) {
    const fileName = pending.pop();
    if (reachable.has(fileName)) continue;
    const chunk = chunksByName.get(fileName);
    if (!chunk) continue; // External dependencies are not emitted chunks.
    reachable.add(fileName);
    pending.push(...chunk.imports);
    if (includeDynamicImports) pending.push(...chunk.dynamicImports);
  }
  return reachable;
}

const detectorChunks = chunks.filter(chunk => Object.keys(chunk.modules).some(id =>
  /\/roomDetector(?:Client)?(?:-[^/]+)?\.js$/.test(id)
));
assert.ok(detectorChunks.length > 0, "the package must emit the room detector as a separate chunk");
const staticChunks = collectReachableChunks(false);
const allReachableChunks = collectReachableChunks(true);
const workerStaticChunks = collectReachableChunks(false, pdfWorkerEntry);
const workerReachableChunks = collectReachableChunks(true, pdfWorkerEntry);
for (const engine of ["Lcms", "Qcms"]) {
  const engineChunks = chunks.filter(chunk => Object.keys(chunk.modules).some(id =>
    new RegExp(`/nativeIcc${engine}(?:-[^/]+)?\\.js$`).test(id)
  ));
  assert(engineChunks.length > 0, `${engine} must ship as a separate lazy adapter`);
  for (const chunk of engineChunks) {
    assert(!staticChunks.has(chunk.fileName), `${engine} must stay out of the initial module graph`);
    assert(!workerStaticChunks.has(chunk.fileName), `${engine} must stay out of the initial parser worker graph`);
    assert(workerReachableChunks.has(chunk.fileName), `${engine} must remain reachable on demand in the parser worker`);
    assert(!chunk.code.includes("data:application/wasm"), "ICC WASM must not be inlined in JavaScript");
    const other = engine === "Lcms" ? "Qcms" : "Lcms";
    assert(!Object.keys(chunk.modules).some(id => id.includes(`nativeIcc${other}`)),
      "selecting one engine must not include the other engine's adapter");
  }
}
for (const codec of ["Jpx", "Jbig2"]) {
  const codecChunks = chunks.filter(chunk => Object.keys(chunk.modules).some(id =>
    new RegExp(`/native${codec}Codec(?:-[^/]+)?\\.js$`).test(id)));
  assert(codecChunks.length > 0, `${codec} must ship as a separate lazy decoder`);
  for (const chunk of codecChunks) {
    assert(!staticChunks.has(chunk.fileName), `${codec} must stay out of the initial module graph`);
    assert(!workerStaticChunks.has(chunk.fileName), `${codec} must stay out of the initial parser worker graph`);
    assert(workerReachableChunks.has(chunk.fileName), `${codec} must remain reachable on demand`);
    assert(!chunk.code.includes("data:application/wasm"), "codec WASM must remain a separate asset");
  }
}
for (const chunk of detectorChunks) {
  assert.ok(!staticChunks.has(chunk.fileName),
    "importing the root package must not eagerly load the room detector");
  assert.ok(allReachableChunks.has(chunk.fileName),
    "the room detector must remain available through a dynamic import");
}

const size = code => `${(Buffer.byteLength(code) / 1000).toFixed(1)} kB / ${(gzipSync(code).length / 1000).toFixed(1)} kB gzip`;
console.log(`Browser package boundary passed; no native canvas modules (Three.js external).`);
console.log("Room detector remains lazy when all public exports are retained.");
console.log(`All-exports entry: ${size(entry.code)}`);
console.log(`All ${chunks.length} JavaScript chunks: ${(chunks.reduce((sum, file) => sum + Buffer.byteLength(file.code), 0) / 1000).toFixed(1)} kB / ${(chunks.reduce((sum, file) => sum + gzipSync(file.code).length, 0) / 1000).toFixed(1)} kB gzip (sum per chunk).`);
console.log("Worker files and fonts are separate assets, excluded from these JavaScript totals.");
const assets = (await readdir(`${libDir}assets`)).sort();
for (const engine of ["libjpeg-turbo", "lcms", "qcms", "openjpeg", "jbig2"]) {
  assert(assets.some(name => new RegExp(`^${engine}-.*\\.wasm$`).test(name)),
    `${engine} must ship as a package-relative WASM asset`);
}
assert.ok(assets.some(name => /^roomDetectorWorker-.*\.js$/.test(name)),
  "the package must ship the browser room detector worker");
for (const name of assets) {
  if (/^(?:pdfWorkerEntry|roomDetectorWorker)-.*\.js$/.test(name)) {
    const source = await readFile(`${libDir}assets/${name}`);
    console.log(`Browser worker entry ${name}: ${size(source)} (lazy helper/CMap chunks excluded).`);
  }
}
