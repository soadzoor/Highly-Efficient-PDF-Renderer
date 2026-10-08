import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "vite";

// Exercise the installed npm manifest rather than overriding moduleSideEffects.
// Include static dependencies in the budget: a tiny entry importing a large
// shared chunk must not accidentally pass the size check.
export async function checkBundlerSizes(fixture, consumerConfig) {
  const rows = [];
  for (const [symbol, maximumGzip] of [
    ["buildStrokeScene", 12_000],
    ["createSceneTextSearcher", 15_000],
    // Shared page rendering, raster compression and compositor batching bring
    // both object factories to about 282 kB gzip; retain a bounded margin.
    ["createThreePdfObject", 300_000],
    ["pdfObjectGenerator", 300_000],
    ["buildHep", 12_000]
  ]) {
    const entryPath = resolve(fixture, `size-${symbol}.js`);
    await writeFile(entryPath, `import { ${symbol} } from "@soadzoor/hepr/bundler";\nglobalThis.hepr = ${symbol};\n`);
    const result = await build({
      ...consumerConfig,
      build: {
        write: false,
        minify: true,
        target: "es2022",
        assetsInlineLimit: 0,
        reportCompressedSize: false,
        rollupOptions: {
          input: entryPath,
          external: id => id === "three" || id.startsWith("three/")
        }
      }
    });
    const chunks = result.output.filter(file => file.type === "chunk");
    const initial = collectStaticChunks(chunks);
    const modules = initial.flatMap(chunk => Object.keys(chunk.modules));
    const gzip = initial.reduce((sum, chunk) => sum + gzipSync(chunk.code).length, 0);
    assert(gzip < maximumGzip,
      `${symbol} initial bundle is ${gzip} gzip bytes; budget is ${maximumGzip} (Three.js external)`);
    if (["createThreePdfObject", "pdfObjectGenerator"].includes(symbol)) {
      for (const module of modules) {
        // These synchronous host adapters support shared render hooks without
        // importing WebGPU materials or Three's node graph.
        const hostAdapter = /\/threeWebGpu(?:SubmissionBatch|UniformUpdates)\.js$/.test(module);
        assert(hostAdapter || !/\/(?:webGlFloorplanRenderer|webGpuFloorplanRenderer|threeWebGpu[^/]*|hepWriter|hepBuilderRuntime|hepContainerWriter|pdfSession)\.js$/.test(module),
          `${symbol} eagerly includes an optional implementation: ${module}`);
      }
      assert(!initial.some(chunk => chunk.imports.some(id => id === "three/webgpu" || id === "three/tsl")),
        `${symbol} must not eagerly import the WebGPU node graph`);
    }
    if (["buildStrokeScene", "createSceneTextSearcher", "buildHep"].includes(symbol)) {
      assert(!initial.some(chunk => chunk.imports.some(id => id === "three" || id.startsWith("three/"))),
        `${symbol} must not import Three.js`);
    }
    rows.push(`${symbol}: ${(gzip / 1000).toFixed(1)} kB gzip`);
  }

  // This import-only entry must still initialize the parser worker after
  // tree shaking. Its registration is the reason for the sideEffects allowlist.
  const workerEntry = resolve(fixture, "node_modules/@soadzoor/hepr/dist/bundler/pdf-worker.js");
  const worker = await build({
    ...consumerConfig,
    build: {
      write: false,
      assetsInlineLimit: 0,
      reportCompressedSize: false,
      rollupOptions: { input: workerEntry, preserveEntrySignatures: "strict" }
    }
  });
  const workerChunks = collectStaticChunks(worker.output.filter(file => file.type === "chunk"));
  assert(workerChunks.some(chunk => Object.keys(chunk.modules).some(id => id.endsWith("/pdf/pdfWorkerEntry.js"))),
    "tree shaking must preserve the import-only parser worker bootstrap");
  console.log(`Packed consumer size checks passed (Three.js external): ${rows.join(", ")}.`);
}

function collectStaticChunks(chunks) {
  const byName = new Map(chunks.map(chunk => [chunk.fileName, chunk]));
  const entry = chunks.find(chunk => chunk.isEntry);
  assert(entry, "consumer must emit an entry chunk");
  const result = [];
  const seen = new Set();
  const visit = chunk => {
    if (!chunk || seen.has(chunk.fileName)) return;
    seen.add(chunk.fileName);
    result.push(chunk);
    chunk.imports.forEach(name => visit(byName.get(name)));
  };
  visit(entry);
  return result;
}
