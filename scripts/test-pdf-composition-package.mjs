import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

// Exercise the published JavaScript and declarations, without a browser/server.
const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = await realpath(await mkdtemp(resolve(tmpdir(), "hepr-composition-package-")));
const installed = resolve(scratch, "node_modules/@soadzoor/hepr"), execute = promisify(execFile);
try {
  await execute("npm", ["pack", "--ignore-scripts", "--pack-destination", scratch], {
    cwd: root, encoding: "utf8", timeout: 20_000,
    env: { ...process.env, npm_config_cache: resolve(scratch, ".npm-cache"), npm_config_update_notifier: "false" }
  });
  const archives = (await readdir(scratch)).filter(name => name.endsWith(".tgz")); assert.equal(archives.length, 1);
  await mkdir(installed, { recursive: true });
  await execute("tar", ["-xzf", resolve(scratch, archives[0]), "--strip-components=1", "-C", installed]);
  await writeFile(resolve(scratch, "package.json"), '{"private":true,"type":"module"}\n');
  const manifest = JSON.parse(await readFile(resolve(installed, "package.json"), "utf8"));
  for (const dependency of ["three", ...Object.keys(manifest.dependencies ?? {})]) {
    await symlink(resolve(root, "node_modules", dependency), resolve(scratch, "node_modules", dependency), "junction");
  }
  const sourceBytes = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 80] /Resources << >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", ".2 .5 .8 rg 10 10 40 30 re f") }
  ] });
  for (const subpath of [".", "./node", "./bundler"]) {
    const entry = manifest.exports[subpath], library = await import(pathToFileURL(resolve(installed, entry.import)));
    assert.equal(typeof library.createPdfDocument, "function", `${subpath}: factory is publicly exported`);
    const declarations = await readFile(resolve(installed, entry.types), "utf8");
    assert.match(declarations, /createPdfDocument/, `${subpath}: factory declaration`);
    assert.match(declarations, /pdfCompositionTypes|PdfDocumentComposer/, `${subpath}: composition type exports`);
    const document = await library.createPdfDocument({ loadFontAsset: async url => new Uint8Array(await readFile(url)),
      metadata: { title: "Packed composition smoke", author: "Synthetic author" } });
    let blob;
    try {
      const source = await document.importPdf(sourceBytes), page = document.addSourcePage(source, 0);
      const font = await document.fonts.loadBundled("Liberation Sans");
      const measured = await document.measureText("Résumé Ω", { fontId: font.id, fontSize: 10 });
      assert(measured.width > 0 && measured.height > 0, `${subpath}: packaged font shaping`);
      page.drawText("Résumé Ω", { x: 10, y: 55, fontSize: 10, fontId: font.id, underline: true });
      page.drawPath([["M", 10, 10], ["Q", 40, 50, 80, 10]], { stroke: "#204060", strokeWidth: 1.5, dashArray: [3, 2] });
      const image = await document.registerImage({ width: 1, height: 1, data: Uint8Array.of(210, 30, 60, 128) });
      page.drawImage(image, { x: 85, y: 15, width: 20, height: 20 });
      page.addLink({ x: 10, y: 50, width: measured.width, height: 12 }, { type: "url", url: "https://example.com/" });
      const hidden = document.addSourcePage(source, 0, { background: false });
      hidden.drawRectangle({ x: 15, y: 10, width: 50, height: 40, fill: "#72bc98", fillOpacity: .4 });
      hidden.setViewport({ x: -5, y: -5, width: 100, height: 70 });
      blob = await document.save();
    } finally { await document.dispose(); }
    assert.equal(blob.type, "application/pdf");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), "%PDF-");
    const reopened = await library.openDocumentSession(bytes);
    try { assert.equal(reopened.info.pageCount, 2, `${subpath}: composed output reopens`); }
    finally { await reopened.close(); }
  }
  console.log("Packed PDF composition: main/Node/bundler exports, declarations, source pages, fonts, drawing, image, link and viewport output passed.");
} finally { await rm(scratch, { recursive: true, force: true }); }
