import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, open, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = await mkdtemp(resolve(tmpdir(), "hepr-thumbnail-cli-consumer-"));
const consumer = resolve(fixture, "unrelated-consumer"), installed = resolve(consumer, "node_modules/@soadzoor/hepr");
const execute = promisify(execFile);
const environment = { ...process.env, NO_COLOR: "1", HEPR_PDF_TO_HEP_HEAP_MB: "512",
  npm_config_cache: resolve(fixture, ".npm-cache"), npm_config_update_notifier: "false" };
for (const name of Object.keys(environment)) {
  if (name === "NODE_TEST_CONTEXT" || name === "HEPR_PDF_PASSWORD" ||
      /^HEPR_(?:PDF_TO_HEP|THUMBNAIL).*?(?:INTERNAL|WORKER_TOKEN|BATCH_INDEX|BATCH_TOTAL)/.test(name)) delete environment[name];
}

try {
  await execute("npm", ["pack", "--ignore-scripts", "--pack-destination", fixture], {
    cwd: root, env: environment, encoding: "utf8", timeout: 20_000
  });
  const archives = (await readdir(fixture)).filter(name => name.endsWith(".tgz"));
  assert.equal(archives.length, 1);
  await mkdir(installed, { recursive: true });
  await execute("tar", ["-xzf", resolve(fixture, archives[0]), "--strip-components=1", "-C", installed]);
  const manifest = JSON.parse(await readFile(resolve(installed, "package.json"), "utf8"));
  await writeFile(resolve(consumer, "package.json"), JSON.stringify({ name: "hepr-thumbnail-cli-consumer", private: true,
    type: "module", dependencies: { "@soadzoor/hepr": manifest.version } }));
  await symlink(resolve(root, "node_modules/@napi-rs"), resolve(consumer, "node_modules/@napi-rs"), "junction");
  await symlink(resolve(root, "node_modules/three"), resolve(consumer, "node_modules/three"), "junction");
  await mkdir(resolve(consumer, "node_modules/.bin"));
  const launcher = resolve(installed, manifest.bin["pdf-to-hep"]);
  await symlink(launcher, resolve(consumer, "node_modules/.bin/pdf-to-hep"), "file");
  await access(resolve(installed, "bin/thumbnail-cli.mjs"));
  for (const unavailable of ["src", "scripts", "node_modules/vite"]) {
    assert.equal(await exists(resolve(installed, unavailable)), false, `published thumbnail CLI must work without ${unavailable}`);
  }
  const help = await command(process.execPath, [launcher, "--help"]);
  for (const flag of ["--output=", "--thumbnail-page=", "--thumbnail-max-dimension=", "--thumbnail-format=", "--thumbnail-background="]) {
    assert(help.includes(flag), `packaged help documents ${flag}`);
  }

  // Two tiny pages exercise vector/text HEP storage and a fully blank page's
  // thumbnail alpha. No representative/user PDF or long conversion is used.
  await writeFile(resolve(consumer, "drawing.pdf"), writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 2 /Kids [3 0 R 6 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "0.2 0.5 0.8 rg 5 5 60 40 re f 0 0 0 RG 1 w 10 10 m 180 10 l 180 80 l S BT /F1 12 Tf 1 0 0 1 10 55 Tm (AB AB AB) Tj ET") },
    { number: 5, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
    { number: 6, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 80 160] /Resources << >> /Contents 7 0 R >>" },
    { number: 7, body: tinyPdfStream("", "") }
  ] }));
  const { HepArchive } = await import(pathToFileURL(resolve(installed, "dist/lib/pdf-to-hep-runtime.js")));
  const { parsePdfToHepArguments } = await import(pathToFileURL(resolve(installed, "PDFtoHEP.js")));
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  for (const flags of [[], ["--output=hep"], ["--output=both"]]) {
    const options = parsePdfToHepArguments(["drawing.pdf", ...flags]);
    assert.equal(options.withVectorLod, true); assert.equal(options.withTextLod, true,
      "output selection preserves both LOD defaults, including text caches only applicable to larger pages");
  }

  await cli(["drawing.pdf", "--workers=1", "--output-dir=./heps"]);
  const freshHep = await readFile(resolve(consumer, "heps/drawing-parsed-data.hep"));
  const freshArchive = await HepArchive.loadAsync(freshHep);
  const freshManifest = JSON.parse(await freshArchive.file("manifest.json").async("string"));
  assert(freshManifest.lod?.vector, "default HEP mode keeps applicable vector LODs enabled");
  assert.equal(await exists(resolve(consumer, "heps/drawing-thumbnail-p1.webp")), false, "HEP remains the default artifact selection");

  await mkdir(resolve(consumer, "pdfs"));
  await writeFile(resolve(consumer, "pdfs/drawing.pdf"), await readFile(resolve(consumer, "drawing.pdf")));
  await command("npx", ["--offline", "--no", "--", "@soadzoor/hepr", "./pdfs", "--output=thumbnail", "--workers=1", "--output-dir=./thumbs"]);
  await thumbnail("thumbs/drawing-thumbnail-p1.webp", 400, 200, "webp");
  assert.equal(await exists(resolve(consumer, "thumbs/drawing-parsed-data.hep")), false, "offline npx thumbnail mode generates no HEP");

  await cli(["drawing.pdf", "--output=thumbnail", "--thumbnail-page=2", "--thumbnail-max-dimension=48",
    "--thumbnail-format=png", "--thumbnail-background=transparent", "--output-dir=./pngs"]);
  await thumbnail("pngs/drawing-thumbnail-p2.png", 24, 48, "png", [0, 0, 0, 0]);
  await cli(["drawing.pdf", "--output=thumbnail", "--thumbnail-page=2", "--thumbnail-max-dimension=32",
    "--thumbnail-format=png", "--thumbnail-background=#12ab34", "--output-dir=./pngs", "--force"]);
  await thumbnail("pngs/drawing-thumbnail-p2.png", 16, 32, "png", [18, 171, 52, 255]);

  const bothArgs = ["drawing.pdf", "--output=both", "--thumbnail-max-dimension=40", "--output-dir=./both"];
  const bothHepPath = resolve(consumer, "both/drawing-parsed-data.hep"), bothThumbnailPath = resolve(consumer, "both/drawing-thumbnail-p1.webp");
  await cli(bothArgs);
  await canonicalHep(bothHepPath);
  await thumbnail("both/drawing-thumbnail-p1.webp", 40, 20, "webp");

  await writeFile(bothThumbnailPath, "existing thumbnail sentinel");
  await writeFile(bothHepPath, "existing HEP sentinel");
  await cli(bothArgs);
  assert.equal(await readFile(bothThumbnailPath, "utf8"), "existing thumbnail sentinel");
  assert.equal(await readFile(bothHepPath, "utf8"), "existing HEP sentinel", "both existing artifacts skip independently without validating old output bytes");

  await rm(bothHepPath);
  await cli(bothArgs);
  await canonicalHep(bothHepPath);
  assert.equal(await readFile(bothThumbnailPath, "utf8"), "existing thumbnail sentinel", "a missing HEP does not overwrite an existing thumbnail");
  const keptHep = await readFile(bothHepPath);
  await rm(bothThumbnailPath);
  await cli(bothArgs);
  assert.deepEqual(await readFile(bothHepPath), keptHep, "a missing thumbnail does not rebuild an existing HEP");
  await thumbnail("both/drawing-thumbnail-p1.webp", 40, 20, "webp");

  await writeFile(bothThumbnailPath, "thumbnail to replace");
  await writeFile(bothHepPath, "HEP to replace");
  await cli([...bothArgs, "--force"]);
  await canonicalHep(bothHepPath);
  await thumbnail("both/drawing-thumbnail-p1.webp", 40, 20, "webp");

  const invalidPage = await cli(["drawing.pdf", "--output=both", "--thumbnail-page=99", "--output-dir=./invalid-page"], 1);
  assert.match(invalidPage, /page|thumbnail/i);
  await canonicalHep(resolve(consumer, "invalid-page/drawing-parsed-data.hep"));
  assert.equal(await exists(resolve(consumer, "invalid-page/drawing-thumbnail-p99.webp")), false,
    "thumbnail page failure remains independent of successful canonical HEP output");
  for (const flags of [["--output=jpeg"], ["--output=thumbnail", "--thumbnail-page=0"],
    ["--output=thumbnail", "--thumbnail-max-dimension=0"], ["--output=thumbnail", "--thumbnail-format=jpeg"],
    ["--thumbnail-format=png"]]) await cli(["drawing.pdf", ...flags], 1);

  console.log("Packed thumbnail CLI: offline npx, WebP/PNG options, page/alpha/background, default HEP LODs, both canonical parity, independent skips/force and failure isolation passed on one tiny synthetic PDF.");

  async function cli(args, expectedCode = 0) { return command(process.execPath, [launcher, ...args], expectedCode); }
  async function thumbnail(relative, width, height, format, expectedPixel) {
    const bytes = await readFile(resolve(consumer, relative));
    if (format === "webp") assert.equal(bytes.toString("ascii", 12, 16), "VP8L", "default WebP is truly lossless");
    else assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const image = await loadImage(bytes);
    assert.deepEqual([image.width, image.height], [width, height], `actual dimensions for ${relative}`);
    if (expectedPixel) {
      const context = createCanvas(width, height).getContext("2d"); context.drawImage(image, 0, 0);
      assert.deepEqual([...context.getImageData(0, 0, 1, 1).data], expectedPixel);
    }
  }
  async function canonicalHep(path) {
    const actual = await HepArchive.loadAsync(await readFile(path));
    const names = Object.keys(freshArchive.files).filter(name => name !== "manifest.json").sort();
    assert.deepEqual(Object.keys(actual.files).filter(name => name !== "manifest.json").sort(), names);
    for (const name of names) assert.deepEqual(await actual.file(name).async("uint8array"), await freshArchive.file(name).async("uint8array"),
      `thumbnail processing does not alter canonical HEP section ${name}`);
    const metadata = JSON.parse(await actual.file("manifest.json").async("string"));
    assert(metadata.lod?.vector, "both output keeps applicable default vector LODs");
    assert.equal(Boolean(metadata.lod?.text), Boolean(freshManifest.lod?.text), "both output keeps the same text LOD eligibility as default HEP conversion");
  }
} finally { await rm(fixture, { recursive: true, force: true }); }

async function exists(path) { try { await access(path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
async function command(executable, args, expectedCode = 0) {
  const log = resolve(fixture, "command.log"), output = await open(log, "w");
  let code = 0;
  try {
    execFileSync(executable, args, { cwd: consumer, env: environment, stdio: ["ignore", output.fd, output.fd], timeout: 15_000, killSignal: "SIGKILL" });
  } catch (error) {
    if (!Number.isInteger(error.status) || error.signal) throw error;
    code = error.status;
  } finally { await output.close(); }
  const text = await readFile(log, "utf8");
  assert.equal(code, expectedCode, `${executable} ${args.join(" ")}\n${text}`);
  return text;
}
