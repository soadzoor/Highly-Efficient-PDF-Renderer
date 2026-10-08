// Manifest generation uses synthetic filenames and bytes only, never PDF conversion.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
const exec = promisify(execFile);
const root = await mkdtemp(path.join(tmpdir(), "hepr-lod-examples-"));
try {
  const scriptDir = path.join(root, "scripts"), examples = path.join(root, "public/examples");
  await mkdir(scriptDir, { recursive: true });
  for (const dir of ["pdfs", "heps", "heps-lod"]) await mkdir(path.join(examples, dir), { recursive: true });
  for (const file of ["generate-manifest.ts", "example-asset-path.ts"]) await cp(new URL(file, import.meta.url), path.join(scriptDir, file));
  for (const name of ["Level 1", "Book"]) {
    await writeFile(path.join(examples, "pdfs", `${name}.pdf`), "synthetic PDF filename");
    await writeFile(path.join(examples, "heps", `${name.replaceAll(" ", "_")}-parsed-data.hep`), "compact sentinel");
  }
  const generate = () => exec(process.execPath, ["--experimental-strip-types", path.join(scriptDir, "generate-manifest.ts")]);
  const manifestPath = path.join(examples, "manifest.json");
  await generate();
  const original = JSON.parse(await readFile(manifestPath, "utf8"));
  assert(original.examples.every(entry => entry.hepLod === undefined));
  await writeFile(path.join(examples, "heps-lod/Level_1-parsed-data.hep"), "LOD sentinel");
  await generate();
  const serialized = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(serialized);
  const floor = manifest.examples.find(entry => entry.name === "Level 1.pdf");
  assert.equal(floor.hepLod.path, "examples/heps-lod/Level_1-parsed-data.hep");
  assert.equal(floor.hepLod.sizeBytes, 12);
  assert.equal(floor.hep.path, "examples/heps/Level_1-parsed-data.hep");
  assert.equal(manifest.examples.find(entry => entry.name === "Book.pdf").hepLod, undefined);
  await generate();
  assert.equal(await readFile(manifestPath, "utf8"), serialized, "unchanged manifests retain timestamps");
  assert.equal(await readFile(path.join(examples, "heps/Level_1-parsed-data.hep"), "utf8"), "compact sentinel");
  let source = await readFile(new URL("../src/exampleManifest.ts", import.meta.url), "utf8");
  source = source.replace("import.meta.env.BASE_URL", '"/demo/"');
  const previousWindow = globalThis.window;
  globalThis.window = { location: { href: "https://example.test/demo/" } };
  try {
    const module = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
    const normalized = module.normalizeExampleManifestEntries(manifest);
    assert.equal(normalized.find(entry => entry.name === "Level 1.pdf").hepLodPath,
      "https://example.test/demo/examples/heps-lod/Level_1-parsed-data.hep");
    assert.equal(normalized.find(entry => entry.name === "Book.pdf").hepLodPath, undefined);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts["regenerate:heps"], /--without-vector-lod --without-text-lod --output-dir=public\/examples\/heps /);
  assert.match(pkg.scripts["regenerate:heps:lod"], /--output-dir=public\/examples\/heps-lod/);
  assert.doesNotMatch(pkg.scripts["regenerate:heps:lod"], /--(?:with|without)-(?:vector|text)-lod/,
    "the LOD example script uses the CLI's enabled defaults");
  assert.match(pkg.scripts["regenerate:heps:all"], /--without-vector-lod --without-text-lod --output-dir=public\/examples\/heps /);
  assert.match(pkg.scripts["regenerate:heps:all"], /&& node PDFtoHEP\.js --force --keep-unchanged --output-dir=public\/examples\/heps-lod /);
  assert.doesNotMatch(pkg.scripts["regenerate:heps:all"], /--with-(?:vector|text)-lod/);
  console.log("HEP+LOD manifest matching, optional actions, sizes, base URLs and separate outputs passed.");
} finally { await rm(root, { recursive: true, force: true }); }
