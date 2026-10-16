import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "vite";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = await mkdtemp(resolve(tmpdir(), "hepr-node-thumbnail-package-"));
const installed = resolve(scratch, "node_modules/@soadzoor/hepr");
const execute = promisify(execFile);
const globals = new Map(["Worker", "document", "OffscreenCanvas"].map(name => [name, globalThis[name]]));
try {
  await execute("npm", ["pack", "--ignore-scripts", "--pack-destination", scratch], {
    cwd: root, encoding: "utf8", timeout: 20_000,
    env: { ...process.env, npm_config_cache: resolve(scratch, ".npm-cache"), npm_config_update_notifier: "false" }
  });
  const archives = (await readdir(scratch)).filter(name => name.endsWith(".tgz"));
  assert.equal(archives.length, 1);
  await mkdir(installed, { recursive: true });
  await execute("tar", ["-xzf", resolve(scratch, archives[0]), "--strip-components=1", "-C", installed]);
  await writeFile(resolve(scratch, "package.json"), '{"name":"hepr-node-thumbnail-consumer","private":true,"type":"module"}\n');
  await symlink(resolve(root, "node_modules/@napi-rs"), resolve(scratch, "node_modules/@napi-rs"), "junction");
  const manifest = JSON.parse(await readFile(resolve(installed, "package.json"), "utf8"));
  assert.equal(manifest.exports["./node"].import, "./dist/lib/node.js");
  const encoderWorker = manifest.exports["./experimental/thumbnail-encoder-worker"];
  assert.equal(encoderWorker.import, "./dist/lib/thumbnail-encoder-worker.js");
  await access(resolve(installed, encoderWorker.import));
  await access(resolve(installed, manifest.exports["./experimental/pdf-worker"].import));
  const declarations = await readFile(resolve(installed, manifest.exports["./node"].types), "utf8");
  assert.match(declarations, /renderPdfThumbnail/);
  assert.match(declarations, /openDocumentSession/);
  assert.match(declarations, /HepBuildResult/);
  await assert.rejects(access(resolve(installed, "src")), error => error.code === "ENOENT", "published Node APIs require no TypeScript sources");
  const pdfPath = resolve(scratch, "drawing with spaces.pdf");
  await writeFile(pdfPath, writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 80 40] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "0.2 0.5 0.8 rg 0 0 80 40 re f 0 0 0 rg BT /F1 18 Tf 1 0 0 1 5 12 Tm (AB) Tj ET") },
    { number: 5, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" }
  ] }));

  const library = await import(pathToFileURL(resolve(installed, "dist/lib/node.js")));
  await exercise(library, pdfPath);

  // Actually relocate an SSR bundle outside the installed package. Worker
  // default fallbacks beside the bundle deliberately do not exist: successful
  // calls must resolve the published package's worker subpaths.
  const entry = resolve(scratch, "entry.js");
  await writeFile(entry, 'export { renderPdfThumbnail, openDocumentSession } from "@soadzoor/hepr/node";\n');
  const result = await build({ root: scratch, configFile: false, publicDir: false, logLevel: "error",
    ssr: { noExternal: ["@soadzoor/hepr"] },
    build: { ssr: entry, write: false, minify: true, target: "node22", reportCompressedSize: false,
      rollupOptions: { external: id => id.startsWith("node:") || id === "three" || id.startsWith("three/"),
        output: { format: "es", entryFileNames: "entry.mjs", chunkFileNames: "chunks/[name]-[hash].mjs" } } } });
  const outputs = [result].flat().flatMap(output => output.output), bundleRoot = resolve(scratch, "ssr");
  for (const file of outputs) {
    const target = resolve(bundleRoot, file.fileName); await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.type === "chunk" ? file.code : file.source);
  }
  const chunks = outputs.filter(file => file.type === "chunk");
  assert(chunks.some(file => Object.keys(file.modules).some(id => id.startsWith(installed) && id.endsWith("/node.js"))),
    "the SSR build must include the Node entry rather than externalizing the API under test");
  assert(chunks.some(file => file.code.includes("@soadzoor/hepr/experimental/pdf-worker")), "SSR output preserves the package parser worker self-reference");
  assert(chunks.some(file => file.code.includes("@soadzoor/hepr/experimental/thumbnail-encoder-worker")), "SSR output preserves the package encoder worker self-reference");
  await assert.rejects(access(resolve(bundleRoot, "pdf-worker.js")), error => error.code === "ENOENT");
  await assert.rejects(access(resolve(bundleRoot, "thumbnail-encoder-worker.js")), error => error.code === "ENOENT");
  const bundled = await import(pathToFileURL(resolve(bundleRoot, "entry.mjs")));
  await exercise(bundled, pdfPath);
  for (const [name, value] of globals) assert.equal(globalThis[name], value, `Node package must not install a global ${name} shim`);
  console.log("Packed Node thumbnails: real published entry, default parser/encoder workers, native canvas, lossless WebP/PNG, standard fonts, reuse and relocated SSR bundle passed.");
} finally { await rm(scratch, { recursive: true, force: true }); }

async function exercise(library, pdfPath) {
  const diagnostics = [];
  const output = await library.renderPdfThumbnail(pdfPath, { maxDimension: 40, onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  assert.deepEqual([output.width, output.height, output.blob.type], [40, 20, "image/webp"]);
  assert.equal(new TextDecoder().decode(new Uint8Array(await output.blob.arrayBuffer()).subarray(12, 16)), "VP8L");
  assert(!diagnostics.some(diagnostic => /worker-unavailable|webp-png-fallback/.test(diagnostic.code)), "published defaults must render through the actual workers and lossless encoder");
  const session = await library.openDocumentSession(pathToFileURL(pdfPath));
  let withScene;
  try {
    // Large preview text forces the package's lazy standard-font loader;
    // tiny preview ink marks alone would miss an SSR asset-resolution bug.
    const png = await session.renderThumbnail({ maxDimension: 160, format: "png" });
    assert.equal(png.blob.type, "image/png");
    assert.deepEqual([png.width, png.height], [160, 80]);
    const hep = await session.buildHep({ withVectorLod: false, withTextLod: false, encodeRasterImages: false, compression: "store" });
    assert.equal(hep.type, "application/x-hep");
    assert.deepEqual([...new Uint8Array(await hep.arrayBuffer()).subarray(0, 4)], [72,69,80,0]);
    withScene = await session.buildHepWithScene({ compression: "store" });
    assert.equal(withScene.blob.type, "application/x-hep");
    assert.equal(withScene.scene.pageCount, 1);
  } finally { await session.close(); await session.close(); }
  assert(withScene.scene.textInstanceCount > 0, "packed and SSR sessions retain full-quality text after close");
}
