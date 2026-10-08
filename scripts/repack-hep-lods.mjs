#!/usr/bin/env node
// Re-encodes EXISTING LODs only. Never parses a PDF or builds a missing LOD.
import { readFile, readdir, stat, mkdtemp, writeFile, rename, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import path from "node:path";

export async function repackHepLodBytes(bytes, { signal, vectorLodPrecision = "compact", sourcePdfByteLength } = {}) {
  const hooks = registerHooks({ resolve(s, c, n) {
    return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
  } });
  try {
    const { HepArchive } = await import("../src/hepContainer.ts");
    const { loadSceneFromHep } = await import("../src/hep.ts");
    const { getStoredVectorStrokeLod, rebuildStoredVectorStrokeLodIndexes } = await import("../src/vectorStrokeLodCore.ts");
    const { getCachedTextLod } = await import("../src/textLodCore.ts");
    const { prepareVectorLodForStorage } = await import("../src/hepLodEncoding.ts");
    const { writeHepLod, HEP_VECTOR_LOD_VERSION, HEP_TEXT_LOD_VERSION } = await import("../src/hepLod.ts");
    const { validateSourcePdfByteLength, warnIfHepSizeExceedsPdf } = await import("../src/hepSizePolicy.ts");
    const archive = await HepArchive.loadAsync(bytes, { signal });
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    validateSourcePdfByteLength(manifest.sourcePdfByteLength);
    validateSourcePdfByteLength(sourcePdfByteLength);
    sourcePdfByteLength = sourcePdfByteLength === undefined ? manifest.sourcePdfByteLength
      : manifest.sourcePdfByteLength === undefined ? sourcePdfByteLength
      : Math.min(sourcePdfByteLength, manifest.sourcePdfByteLength);
    const withVectorLod = Boolean(manifest.lod?.vector), withTextLod = Boolean(manifest.lod?.text);
    if (!withVectorLod && !withTextLod && sourcePdfByteLength === undefined) return bytes;
    const adaptive = withVectorLod && vectorLodPrecision === "compact" &&
      JSON.parse(await archive.file("lod-vector/index.json").async("string")).positionQuanta;
    if (sourcePdfByteLength === undefined && (!withVectorLod || (manifest.lod.vector.version === HEP_VECTOR_LOD_VERSION &&
        (vectorLodPrecision !== "compact" || (manifest.lod.vector.precision === "compact" && adaptive)))) &&
        (!withTextLod || manifest.lod.text.version === HEP_TEXT_LOD_VERSION)) return bytes;
    const scene = withVectorLod || withTextLod ? await loadSceneFromHep(bytes, { signal }) : undefined;
    const vector = scene && getStoredVectorStrokeLod(scene), text = scene && getCachedTextLod(scene)?.data;
    if ((withVectorLod && !vector) || (withTextLod && !text)) throw new Error("Cannot repack an invalid or missing LOD cache; refusing to rebuild it.");
    const expectedVector = vector && await rebuildStoredVectorStrokeLodIndexes(scene,
      prepareVectorLodForStorage(vector, vectorLodPrecision === "compact"), signal);
    const before = new Map();
    for (const name of Object.keys(archive.files)) {
      if (name.startsWith("lod-vector/") || name.startsWith("lod-text/")) archive.remove(name);
      else if (name !== "manifest.json") before.set(name, await archive.file(name).async("uint8array"));
    }
    manifest.lod = scene && await writeHepLod(archive, scene, { withVectorLod, withTextLod, vectorLodPrecision, signal });
    manifest.sourcePdfByteLength = sourcePdfByteLength;
    archive.file("manifest.json", JSON.stringify(manifest));
    const output = await archive.generateAsync({ type: "uint8array", compression: "DEFLATE", signal });
    warnIfHepSizeExceedsPdf(output.length, sourcePdfByteLength, manifest.sourceFile ?? "HEP");
    const verified = await HepArchive.loadAsync(output, { signal });
    for (const [name, original] of before) {
      signal?.throwIfAborted();
      if (!Buffer.from(await verified.file(name).async("uint8array")).equals(Buffer.from(original))) {
        throw new Error(`Repacking changed canonical section ${name}`);
      }
    }
    const restored = await loadSceneFromHep(output, { signal });
    if ((manifest.lod?.vector && !isDeepStrictEqual(expectedVector, getStoredVectorStrokeLod(restored))) ||
        (manifest.lod?.text && !isDeepStrictEqual(text, getCachedTextLod(restored)?.data))) {
      throw new Error("Repacking changed LOD data");
    }
    return output;
  } finally { hooks.deregister(); }
}

const usage = "Usage: node scripts/repack-hep-lods.mjs [--write] [--source-pdf=<PDF-file>] [--vector-lod-precision=lossless|compact] [--timeout-ms=60000] <HEP-file-or-directory>\n" +
  "Default: compact vector precision, measure only. --write atomically replaces each file only if smaller, after geometry verification.\n" +
  "--source-pdf records a single HEP's original PDF size; larger outputs warn while retaining the existing LOD caches.\n" +
  "Each file runs in an isolated worker with a hard timeout. No PDFs are parsed; no LOD simplification is performed. Spatial indexes are rebuilt.";

async function main(args) {
  let write = false, worker = false, timeoutMs = 60000, input, sourcePdf, vectorLodPrecision = "compact";
  for (const arg of args) {
    if (arg === "--help") { console.log(usage); return; }
    if (arg === "--write") write = true;
    else if (arg === "--worker") worker = true;
    else if (arg.startsWith("--source-pdf=")) {
      const value = arg.slice("--source-pdf=".length);
      if (!value || sourcePdf !== undefined) throw new Error(usage);
      sourcePdf = path.resolve(value);
    }
    else if (arg.startsWith("--vector-lod-precision=")) vectorLodPrecision = arg.slice("--vector-lod-precision=".length);
    else if (arg.startsWith("--timeout-ms=")) timeoutMs = Number(arg.slice(13));
    else if (arg.startsWith("-") || input !== undefined) throw new Error(usage);
    else input = path.resolve(arg);
  }
  if (!input || !["lossless", "compact"].includes(vectorLodPrecision) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error(usage);
  const metadata = await stat(input);
  let sourcePdfByteLength;
  if (sourcePdf !== undefined) {
    if (!metadata.isFile()) throw new Error("--source-pdf requires a single HEP file.");
    const sourceMetadata = await stat(sourcePdf);
    if (!sourceMetadata.isFile() || !sourcePdf.toLowerCase().endsWith(".pdf") || sourceMetadata.size <= 0) {
      throw new Error("--source-pdf requires a nonempty PDF file.");
    }
    sourcePdfByteLength = sourceMetadata.size;
  }
  if (worker) {
    if (!metadata.isFile() || !input.endsWith(".hep")) throw new Error("Worker requires a HEP file.");
    const original = await readFile(input);
    const output = await repackHepLodBytes(original, { signal: AbortSignal.timeout(timeoutMs), vectorLodPrecision, sourcePdfByteLength });
    const smaller = output.length < original.length;
    let temporary;
    try {
      if (write && smaller) {
        temporary = await mkdtemp(path.join(path.dirname(input), ".lod-repack-"));
        const staged = path.join(temporary, "output.hep");
        await writeFile(staged, output, { mode: metadata.mode });
        if (!original.equals(await readFile(input))) throw new Error("Input changed during repacking; refusing to overwrite it.");
        await rename(staged, input);
      }
      console.log(`${path.basename(input)}: ${original.length} -> ${output.length} bytes ` +
        `(${((output.length / original.length - 1) * 100).toFixed(1)}%); ` +
        (write && smaller ? "replaced" : smaller ? "measurement only" : "unchanged"));
    } finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
    return;
  }
  const files = metadata.isDirectory()
    ? (await readdir(input, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith(".hep"))
      .map(entry => path.join(input, entry.name)).sort()
    : [input];
  if (!files.length) throw new Error("No HEP files found.");
  for (const file of files) {
    const child = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(import.meta.url),
      "--worker", `--timeout-ms=${timeoutMs}`, `--vector-lod-precision=${vectorLodPrecision}`,
      ...(sourcePdf ? [`--source-pdf=${sourcePdf}`] : []), ...(write ? ["--write"] : []), file], { stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    try {
      const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
      if (code !== 0) throw new Error(`Repacking failed or exceeded ${timeoutMs} ms: ${file}`);
    } finally { clearTimeout(timer); }
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
