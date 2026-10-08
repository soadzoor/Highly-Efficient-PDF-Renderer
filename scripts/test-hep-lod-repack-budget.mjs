// Synthetic existing HEPs only. The PDF fixture is never parsed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { repackHepLodBytes } from "./repack-hep-lods.mjs";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const { HepArchive } = await import("../src/hepContainer.ts");
  const { getStoredVectorStrokeLod } = await import("../src/vectorStrokeLodCore.ts");
  const count = 512;
  const scene = { ...createEmptyVectorScene(), segmentCount: count, maxHalfWidth: .1,
    pageCount: 1, pageRects: Float32Array.of(0, 0, 1000, 1000), pageTextRanges: Uint32Array.of(0, 0),
    bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
    pageBounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
    drawRuns: [{ kind: "stroke", first: 0, count }] };
  for (const key of ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]) scene[key] = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    scene.endpoints.set([i, 0, i + 1, 0], i * 4);
    scene.primitiveMeta.set([i + 1, 0, 0, 1], i * 4);
    scene.primitiveBounds.set([i, 0, i + 1, 0], i * 4);
    scene.styles.set([.1, 0, 0, 0], i * 4);
  }
  const original = new Uint8Array(await (await buildHep(scene, {
    sourceLabel: "synthetic.pdf", withVectorLod: true
  })).arrayBuffer());
  const originalArchive = await HepArchive.loadAsync(original);
  const originalManifest = JSON.parse(await originalArchive.file("manifest.json").async("string"));
  assert(originalManifest.lod?.vector);
  assert.equal(await repackHepLodBytes(original), original, "latest unbudgeted files need no rewrite");

  const roomy = await repackHepLodBytes(original, { sourcePdfByteLength: 1_000_000 });
  const roomyArchive = await HepArchive.loadAsync(roomy);
  const roomyManifest = JSON.parse(await roomyArchive.file("manifest.json").async("string"));
  assert.equal(roomyManifest.sourcePdfByteLength, 1_000_000);
  assert(roomyManifest.lod?.vector, "caches that fit remain available");
  assert(getStoredVectorStrokeLod(await loadSceneFromHep(roomy)));

  const canonicalArchive = await HepArchive.loadAsync(roomy);
  for (const name of Object.keys(canonicalArchive.files)) if (name.startsWith("lod-")) canonicalArchive.remove(name);
  delete roomyManifest.lod;
  canonicalArchive.file("manifest.json", JSON.stringify(roomyManifest));
  const canonical = await canonicalArchive.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  assert(roomy.length > canonical.length + 128, "fixture has a meaningful cache size");
  const budget = Math.floor((roomy.length + canonical.length) / 2);
  const warnings = [], warn = console.warn;
  console.warn = message => warnings.push(message);
  let compact;
  try {
    compact = await repackHepLodBytes(original, { sourcePdfByteLength: budget });
    assert(compact.length < budget, "successful repack is strictly smaller than the PDF");
    const compactArchive = await HepArchive.loadAsync(compact);
    const compactManifest = JSON.parse(await compactArchive.file("manifest.json").async("string"));
    assert.equal(compactManifest.sourcePdfByteLength, budget);
    assert.equal(compactManifest.lod, undefined);
    assert(!Object.keys(compactArchive.files).some(name => name.startsWith("lod-")));
    assert.equal(getStoredVectorStrokeLod(await loadSceneFromHep(compact)), null);
    for (const name of Object.keys(originalArchive.files)) {
      if (name === "manifest.json" || name.startsWith("lod-")) continue;
      assert.deepEqual(await compactArchive.file(name).async("uint8array"),
        await originalArchive.file(name).async("uint8array"), `canonical section ${name} stays byte identical`);
    }
    assert(warnings.some(message => /Omitted stored LOD caches/.test(message)), "cache omission emits a diagnostic");

    // Existing manifests enforce the policy even when no new PDF is provided.
    const recordedArchive = await HepArchive.loadAsync(original);
    recordedArchive.file("manifest.json", JSON.stringify({ ...originalManifest, sourcePdfByteLength: budget }));
    const recorded = await recordedArchive.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const restoredBudget = await repackHepLodBytes(recorded);
    assert(restoredBudget.length < budget);
    assert.equal(JSON.parse(await (await HepArchive.loadAsync(restoredBudget)).file("manifest.json").async("string")).lod, undefined);
    const keptBudget = await repackHepLodBytes(recorded, { sourcePdfByteLength: 1_000_000 });
    assert(keptBudget.length < budget, "a supplied budget cannot loosen the recorded original PDF size");
    assert.equal(JSON.parse(await (await HepArchive.loadAsync(keptBudget)).file("manifest.json").async("string")).sourcePdfByteLength, budget);

    // Equality fails too, including a current archive without LOD caches.
    await assert.rejects(repackHepLodBytes(compact, { sourcePdfByteLength: compact.length }),
      /is not smaller than the original PDF/);
  } finally { console.warn = warn; }
  for (const sourcePdfByteLength of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, "1000"]) {
    await assert.rejects(repackHepLodBytes(original, { sourcePdfByteLength }), /positive safe integer/);
  }
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(repackHepLodBytes(original, { sourcePdfByteLength: budget, signal: cancelled.signal }), { name: "AbortError" });

  const directory = await mkdtemp(path.join(tmpdir(), "hep-repack-budget-"));
  const run = async args => {
    const stdoutPath = path.join(directory, "stdout.log"), stderrPath = path.join(directory, "stderr.log");
    const stdout = await open(stdoutPath, "w"), stderr = await open(stderrPath, "w");
    let code;
    try {
      const child = spawn(process.execPath, args, { stdio: ["ignore", stdout.fd, stderr.fd] });
      const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
      try { code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); }); }
      finally { clearTimeout(timer); }
    } finally { await stdout.close(); await stderr.close(); }
    return { code, stdout: await readFile(stdoutPath, "utf8"), stderr: await readFile(stderrPath, "utf8") };
  };
  try {
    const input = path.join(directory, "input.hep"), pdf = path.join(directory, "source.pdf");
    // An uncompressed existing container also verifies the write-if-smaller guard.
    const source = await originalArchive.generateAsync({ type: "uint8array", compression: "STORE" });
    const pdfBytes = Buffer.alloc(budget, 0x20);
    pdfBytes.set(Buffer.from("%PDF-size-only-synthetic-fixture"));
    await writeFile(input, source); await writeFile(pdf, pdfBytes);
    const args = ["--experimental-strip-types", "scripts/repack-hep-lods.mjs", `--source-pdf=${pdf}`, input];
    const measured = await run(args);
    assert.equal(measured.code, 0, measured.stderr);
    assert.match(measured.stdout, /measurement only/);
    assert.match(measured.stderr, /Omitted stored LOD caches/);
    assert.deepEqual(await readFile(input), Buffer.from(source), "measurement leaves the HEP unchanged");
    const written = await run([...args.slice(0, -1), "--write", input]);
    assert.equal(written.code, 0, written.stderr);
    assert.match(written.stdout, /replaced/);
    const replaced = await readFile(input);
    assert(replaced.length < budget);
    assert.equal(JSON.parse(await (await HepArchive.loadAsync(replaced)).file("manifest.json").async("string")).sourcePdfByteLength, budget);
    assert.deepEqual(await readFile(pdf), pdfBytes, "only the PDF's size is inspected");
    assert.deepEqual((await readdir(directory)).sort(), ["input.hep", "source.pdf", "stderr.log", "stdout.log"], "staging directory is cleaned up");
    const directoryBudget = await run([...args.slice(0, -1), directory]);
    assert.equal(directoryBudget.code, 1);
    assert.match(directoryBudget.stderr, /requires a single HEP file/);
    await writeFile(pdf, "%PDF-tiny");
    const impossibleBudget = await run([...args.slice(0, -1), "--write", input]);
    assert.equal(impossibleBudget.code, 1);
    assert.match(impossibleBudget.stderr, /is not smaller than the original PDF/);
    assert.deepEqual(await readFile(input), replaced, "failed policy verification leaves the HEP unchanged");
  } finally { await rm(directory, { recursive: true, force: true }); }
  console.log("HEP LOD repack budgets: preserved canonical bytes, optional cache omission, strict source size, recorded budgets, cancellation, and atomic writes passed.");
} finally { hooks.deregister(); }
