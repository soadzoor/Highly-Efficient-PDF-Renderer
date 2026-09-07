import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const libDir = fileURLToPath(new URL("../dist/lib/", import.meta.url));
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(manifest.dependencies?.["@napi-rs/canvas"], undefined);
assert.equal(manifest.optionalDependencies?.["@napi-rs/canvas"], undefined,
  "browser consumers must not install native canvas automatically");
assert.ok(manifest.peerDependencies?.["@napi-rs/canvas"]);
assert.equal(manifest.peerDependenciesMeta?.["@napi-rs/canvas"]?.optional, true);

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
      input: `${libDir}index.js`,
      preserveEntrySignatures: "strict",
      external: id => id === "three" || id.startsWith("three/") || id.startsWith("node:"),
      output: { format: "es" }
    }
  }
});
const chunks = result.output.filter(file => file.type === "chunk");
for (const chunk of chunks) {
  assert.ok(Object.keys(chunk.modules).every(id => !id.includes("/@napi-rs/canvas")),
    "browser chunks must not contain native canvas modules");
}
const entry = chunks.find(file => file.isEntry);
assert.ok(entry?.exports.includes("pdfObjectGenerator"));
assert.ok(entry.exports.includes("detectRooms"), "the root package must retain its room detection API");

const chunksByName = new Map(chunks.map(chunk => [chunk.fileName, chunk]));
function collectReachableChunks(includeDynamicImports) {
  const reachable = new Set();
  const pending = [entry.fileName];
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
  /\/roomDetector(?:-[^/]+)?\.js$/.test(id)
));
assert.ok(detectorChunks.length > 0, "the package must emit the room detector as a separate chunk");
const staticChunks = collectReachableChunks(false);
const allReachableChunks = collectReachableChunks(true);
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
for (const name of (await readdir(`${libDir}assets`)).sort()) {
  if (/^(?:densePdfFastWorker|pdfWorkerEntry)-.*\.js$/.test(name)) {
    const source = await readFile(`${libDir}assets/${name}`);
    console.log(`Browser worker entry ${name}: ${size(source)} (lazy helper/CMap chunks excluded).`);
  }
}
