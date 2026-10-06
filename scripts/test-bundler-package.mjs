import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build, parseAst } from "vite";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { imagePdf, tinyJbig2, tinyJbig2Globals } from "./lib/imageCodecFixtures.mjs";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = await mkdtemp(resolve(tmpdir(), "hepr-bundler-consumer-"));
const keepFixture = process.argv.includes("--keep-fixture");
try {
  await cp(new URL("./fixtures/bundler-consumer/", import.meta.url), fixture, { recursive: true });
  // npm's publish file list is part of the contract. Never resolve HEPR from
  // the source checkout or a linked package, which Vite treats differently.
  await execFileAsync("npm", [
    "pack", "--ignore-scripts", "--pack-destination", fixture
  ], {
    cwd: root, encoding: "utf8", timeout: 20_000,
    env: { ...process.env, npm_config_cache: resolve(fixture, ".npm-cache"), npm_config_update_notifier: "false" }
  });
  const archives = (await readdir(fixture)).filter(name => name.endsWith(".tgz"));
  assert.equal(archives.length, 1, "npm pack must create exactly one package archive");
  const installed = resolve(fixture, "node_modules/@soadzoor/hepr");
  await mkdir(installed, { recursive: true });
  await execFileAsync("tar", ["-xzf", resolve(fixture, archives[0]), "--strip-components=1", "-C", installed]);
  for (const dependency of ["three", "vite"]) {
    await symlink(resolve(root, "node_modules", dependency), resolve(fixture, "node_modules", dependency), "junction");
  }
  await mkdir(resolve(fixture, "node_modules/.bin"));
  await symlink(resolve(root, "node_modules/vite/bin/vite.js"), resolve(fixture, "node_modules/.bin/vite"));
  const manifest = JSON.parse(await readFile(resolve(installed, "package.json"), "utf8"));
  assert.equal(manifest.exports["./bundler"].import, "./dist/bundler/index.js");
  await access(resolve(installed, manifest.exports["./bundler"].types));

  const consumerConfig = {
    root: fixture,
    configFile: resolve(fixture, "vite.config.mjs"),
    logLevel: "silent"
  };
  let files;
  // Absolute deployment prefixes and relative deployment URLs take different
  // Vite paths. The relative output can also execute through file: URLs below.
  for (const base of ["/hepr-smoke/", "./"]) {
    const result = await build({ ...consumerConfig, base });
    files = new Map(result.output.map(file => [file.fileName, file]));
    for (const prefix of ["libjpeg-turbo-", "openjpeg-", "jbig2-", "lcms-", "qcms-"]) {
      assert([...files.keys()].some(name => name.startsWith(`assets/${prefix}`) && name.endsWith(".wasm")),
        `${prefix} WASM must be emitted by the consumer`);
    }
    assert([...files.keys()].some(name => /LiberationSans-Regular-.*\.ttf$/.test(name)),
      "standard fonts must be emitted by the consumer");
    for (const worker of ["pdfWorkerEntry", "roomDetectorWorker", "lodWorkerEntry"]) {
      assert([...files.keys()].some(name => new RegExp(`/${worker}-.*\\.js$`).test(name)),
        `${worker} must be built by the consumer`);
    }
    for (const file of result.output) {
      if (!file.fileName.endsWith(".js")) continue;
      const code = file.type === "chunk" ? file.code : Buffer.from(file.source).toString("utf8");
      if (file.type === "chunk") {
        for (const id of Object.keys(file.modules)) {
          if (id.startsWith(installed)) assert(id.startsWith(`${installed}/dist/bundler/`),
            `consumer must use only the new package graph: ${id}`);
        }
      }
      walk(parseAst(code), node => {
        const reference = node.type === "ImportExpression" ? node.source
          : ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type)
            ? node.source : undefined;
        if (typeof reference?.value === "string") assertEmitted(reference.value, file.fileName);
        if (node.type === "NewExpression" && node.callee.name === "URL" &&
            typeof node.arguments[0]?.value === "string") {
          const urlBase = node.arguments[1];
          if (urlBase && code.slice(urlBase.start, urlBase.end) === "import.meta.url") {
            assertEmitted(node.arguments[0].value, file.fileName);
          }
        }
      });
    }
    function assertEmitted(reference, from) {
      if (reference.startsWith("data:")) return;
      const url = new URL(reference, `https://example.test/hepr-smoke/${from}`);
      assert.equal(url.origin, "https://example.test", `unexpected external asset: ${reference}`);
      assert(url.pathname.startsWith("/hepr-smoke/"), `asset escapes the deployment base: ${reference}`);
      const name = decodeURIComponent(url.pathname.slice("/hepr-smoke/".length));
      assert(files.has(name), `missing consumer dependency ${reference} from ${from}`);
    }
  }

  // Run Vite's emitted parser worker under worker_threads. This checks real
  // open/compile/close state and lazy WASM loading without a browser or server.
  // Browser fetching and rendering remain a separate manual check.
  const { openPdfInNodeWorker } = await import(pathToFileURL(resolve(installed, "dist/bundler/pdf/workerClient.js")));
  const workerName = [...files.keys()].find(name => /\/pdfWorkerEntry-.*\.js$/.test(name));
  const workerUrl = pathToFileURL(resolve(fixture, "dist", workerName));
  const profile = await readFile(new URL("./fixtures/icc/linear-rgb.icc", import.meta.url));
  const pdf = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] /Resources << /ColorSpace << /ICC [/ICCBased 5 0 R] >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "/ICC cs 0.5 0.5 0.5 sc 0 0 20 20 re f") },
    { number: 5, body: tinyPdfStream("/N 3 /Alternate /DeviceRGB", profile) }
  ] });
  for (const iccEngine of ["qcms", "lcms"]) {
    const session = await openPdfInNodeWorker({ kind: "bytes", bytes: pdf }, { workerUrl, iccEngine });
    try {
      assert.equal(session.info.pageCount, 1);
      for (let iteration = 0; iteration < 2; iteration += 1) {
        const scene = await session.compileVectorPage(0, { optimization: "none" });
        assert.equal(scene.fillPathCount, 1, "the session must survive subsequent worker operations");
      }
      const page = await session.compilePage(0, { optimization: "none" });
      const command = page.displayProgram.groups[page.displayProgram.rootGroupIndex].commands[0];
      const colorIndex = page.stores.paints.resourceIndices[command.paintIndex];
      const colors = page.stores.colors;
      const rgb = colors.parameters.subarray(colors.parameterOffsets[colorIndex], colors.parameterOffsets[colorIndex + 1]);
      assert(rgb.every(value => Math.abs(value * 255 - 188) < 2), `${iccEngine} must load its emitted WASM`);
      assert(!session.getDiagnostics().some(diagnostic => diagnostic.code === "icc-alternate-used"));
    } finally { await session.close(); }
  }
  const jpx = new Uint8Array(await readFile(new URL("./fixtures/codecs/rgb-8x8.jp2", import.meta.url)));
  for (const [bytes, expected] of [
    [imagePdf(jpx), [16, 85, 204, 255]],
    [imagePdf(tinyJbig2(), { filter: "JBIG2Decode", width: 8, height: 2,
      colorSpace: "/DeviceGray", bitsPerComponent: 1, globals: tinyJbig2Globals() }), [255, 255, 255, 255]]
  ]) {
    const session = await openPdfInNodeWorker({ kind: "bytes", bytes }, { workerUrl });
    try {
      const page = await session.compilePage(0, { optimization: "none" });
      assert.deepEqual([...page.stores.images.data.subarray(0, 4)], expected,
        "lazy image codecs must work from the consumer's emitted parser worker");
    } finally { await session.close(); }
  }
  console.log(`Packed bundler entry passed: ${files.size} consumer files, assets resolved, worker sessions and both ICC engines exercised.`);
} finally {
  if (keepFixture) console.log(`Manual browser fixture retained at ${fixture}`);
  else await rm(fixture, { recursive: true, force: true });
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === "object") walk(value, visit);
  }
}
