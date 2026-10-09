// Manifest generation uses synthetic filenames and bytes only, never PDF conversion.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, open, readFile, writeFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";

const root = await mkdtemp(path.join(tmpdir(), "hepr-lod-examples-"));
try {
  const scriptDir = path.join(root, "scripts");
  const examples = path.join(root, "public/examples");
  await mkdir(scriptDir, { recursive: true });
  await mkdir(path.join(examples, "pdfs"), { recursive: true });
  for (const file of ["generate-manifest.ts", "example-asset-path.ts"]) {
    await cp(new URL(file, import.meta.url), path.join(scriptDir, file));
  }
  const pdfBytes = "synthetic PDF filename";
  for (const name of ["Level 1", "Book", "Café 100%"]) {
    await writeFile(path.join(examples, "pdfs", `${name}.pdf`), pdfBytes);
  }
  const generate = async (expectedCode = 0) => {
    const stdoutPath = path.join(root, "generate.stdout.log");
    const stderrPath = path.join(root, "generate.stderr.log");
    const stdoutFile = await open(stdoutPath, "w");
    const stderrFile = await open(stderrPath, "w");
    let code = 0;
    try {
      // File-backed output also works when nested Node commands cannot flush pipes.
      execFileSync(process.execPath, ["--experimental-strip-types", path.join(scriptDir, "generate-manifest.ts")], {
        stdio: ["ignore", stdoutFile.fd, stderrFile.fd], timeout: 10_000, killSignal: "SIGKILL"
      });
    } catch (error) {
      if (!Number.isInteger(error.status) || error.signal) throw error;
      code = error.status;
    } finally {
      await stdoutFile.close();
      await stderrFile.close();
    }
    const stdout = await readFile(stdoutPath, "utf8");
    const stderr = await readFile(stderrPath, "utf8");
    assert.equal(code, expectedCode, `manifest generator output:\n${stdout}${stderr}`);
    return { stdout, stderr };
  };
  assert.match((await generate(1)).stderr, /No HEP files found in .*heps/,
    "missing LOD files give an actionable error");
  await mkdir(path.join(examples, "heps"));
  assert.match((await generate(1)).stderr, /No HEP files found in .*heps/,
    "an empty LOD directory cannot produce usable examples");
  for (const [name, bytes] of [
    ["Level_1-parsed-data.hep", "LOD sentinel"],
    ["Level_1.parsed-data.hep", "alternate LOD sentinel"],
    ["cafe_100%-parsed-data.hep", "unicode LOD sentinel"],
    ["Unused-parsed-data.hep", "unmatched LOD sentinel"]
  ]) {
    await writeFile(path.join(examples, "heps", name), bytes);
  }
  const generated = await generate();
  assert.match(generated.stdout, /matched 2 PDF\/HEP pair\(s\)/);
  assert.match(generated.stderr, /PDFs without matching HEP \(1\): Book\.pdf/);
  assert.match(generated.stderr, /HEP files without matching PDF \(2\): Level_1\.parsed-data\.hep, Unused-parsed-data\.hep/);

  const manifestPath = path.join(examples, "manifest.json");
  const serialized = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(serialized);
  assert.deepEqual(manifest.examples.map(entry => entry.name), ["Café 100%.pdf", "Level 1.pdf"]);
  for (const entry of manifest.examples) {
    assert.deepEqual(Object.keys(entry).sort(), ["hep", "id", "name", "pdf"], "each PDF has one canonical HEP asset");
    assert.equal(entry.pdf.sizeBytes, Buffer.byteLength(pdfBytes));
  }
  const floor = manifest.examples.find(entry => entry.name === "Level 1.pdf");
  assert.deepEqual(floor.hep, { path: "examples/heps/Level_1-parsed-data.hep", sizeBytes: 12 });
  assert.equal(floor.pdf.path, "examples/pdfs/Level%201.pdf");
  const cafe = manifest.examples.find(entry => entry.name === "Café 100%.pdf");
  assert.deepEqual(cafe.hep, { path: "examples/heps/cafe_100%25-parsed-data.hep", sizeBytes: 20 });
  assert.equal(cafe.pdf.path, "examples/pdfs/Caf%C3%A9%20100%25.pdf");
  const unchanged = await generate();
  assert.match(unchanged.stdout, /manifest unchanged/);
  assert.equal(await readFile(manifestPath, "utf8"), serialized, "unchanged manifests retain timestamps");

  await writeFile(path.join(examples, "heps/book_parsed_data.hep"), "book LOD");
  const completed = await generate();
  assert.match(completed.stdout, /matched 3 PDF\/HEP pair\(s\)/);
  assert.doesNotMatch(completed.stderr, /PDFs without matching HEP/);
  const completeManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(completeManifest.examples.map(entry => entry.name), ["Book.pdf", "Café 100%.pdf", "Level 1.pdf"]);
  assert.deepEqual(completeManifest.examples[0].hep, { path: "examples/heps/book_parsed_data.hep", sizeBytes: 8 });

  let source = await readFile(new URL("../src/exampleManifest.ts", import.meta.url), "utf8");
  source = source.replace("import.meta.env.BASE_URL", '"/demo/"');
  const previousWindow = globalThis.window;
  globalThis.window = { location: { href: "https://example.test/demo/" } };
  try {
    const module = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
    const normalized = module.normalizeExampleManifestEntries(completeManifest);
    const normalizedFloor = normalized.find(entry => entry.name === "Level 1.pdf");
    assert.deepEqual(normalizedFloor, {
      id: "level_1",
      name: "Level 1.pdf",
      pdfPath: "https://example.test/demo/examples/pdfs/Level%201.pdf",
      pdfSizeBytes: Buffer.byteLength(pdfBytes),
      hepPath: "https://example.test/demo/examples/heps/Level_1-parsed-data.hep",
      hepSizeBytes: 12
    });
    assert.equal(normalized.find(entry => entry.name === "Café 100%.pdf").hepPath,
      "https://example.test/demo/examples/heps/cafe_100%25-parsed-data.hep");
    assert.deepEqual(module.normalizeExampleManifestEntries({ examples: [{
      name: "legacy.pdf", pdf: floor.pdf, hepLod: floor.hep
    }] }), [], "examples must supply the canonical hep field");
    assert.deepEqual(module.normalizeExampleManifestEntries({ examples: [{
      ...floor, hepLod: { path: "examples/deprecated.hep", sizeBytes: 999 }
    }] }), [normalizedFloor], "the removed alternate HEP field does not affect normalization");
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }

  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts["regenerate:heps"], /--output-dir=public\/examples\/heps public\/examples\/pdfs && npm run generate-manifest$/);
  assert.doesNotMatch(pkg.scripts["regenerate:heps"], /--(?:with|without)-(?:vector|text)-lod/,
    "the sole HEP example script uses the CLI's enabled LOD defaults");
  assert.equal(pkg.scripts["regenerate:heps:lod"], undefined);
  assert.equal(pkg.scripts["regenerate:heps:all"], undefined);
  console.log("Canonical HEP manifest matching, diagnostics, sizes, encoded paths, base URLs and regeneration script passed.");
} finally {
  await rm(root, { recursive: true, force: true });
}
