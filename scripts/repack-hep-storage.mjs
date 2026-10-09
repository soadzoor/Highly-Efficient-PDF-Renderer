#!/usr/bin/env node
// Changes physical storage only: no PDF parsing, scene loading or LOD rebuilding.
import { createHash } from "node:crypto";
import { readFile, readdir, stat, mkdtemp, writeFile, rename, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const align4 = value => Math.ceil(value / 4) * 4;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const usage = "Usage: node --experimental-strip-types scripts/repack-hep-storage.mjs [--write] [--timeout-ms=N] <HEP-file-or-directory>...\n" +
  "Default: measure only. --write atomically replaces each file only if smaller, after verifying section bytes.\n" +
  "Preserves all scene and LOD data, indexes and precision. No PDFs are parsed and no LOD levels are recalculated.\n" +
  "Compacted files require a reader supporting HEP container version 3.";

/** Preserve original chunks unless a lossless integer representation is smaller. */
export async function repackHepStorageBytes(input, { signal } = {}) {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
      ? `${specifier}.ts` : specifier, context);
  } });
  try {
    const { HepArchive, crc32 } = await import("../src/hepContainer.ts");
    const { chooseHepIntegerEncoding } = await import("../src/hepContainerIntegers.ts");
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const archive = await HepArchive.loadAsync(bytes, { signal });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const entryCount = view.getUint32(8, true), chunkCount = view.getUint32(12, true);
    const indexEnd = 32 + view.getUint32(16, true);
    const chunks = Array.from({ length: chunkCount }, (_value, index) => {
      const at = 32 + index * 20;
      return { offset: view.getUint32(at, true), length: view.getUint32(at + 4, true),
        codec: view.getUint8(at + 16), names: [] };
    });
    let cursor = 32 + chunkCount * 20;
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    for (let index = 0; index < entryCount; index++) {
      const length = view.getUint16(cursor, true), chunkId = view.getUint32(cursor + 4, true);
      const name = decoder.decode(bytes.subarray(cursor + 16, cursor + 16 + length));
      if (chunkId !== 0xffffffff) chunks[chunkId].names.push(name);
      cursor += align4(16 + length);
    }
    const replacements = new Map(), expected = new Map();
    for (let index = 0; index < chunks.length; index++) {
      signal?.throwIfAborted();
      const chunk = chunks[index];
      if (chunk.names.length !== 1 || !/^lod-vector\/[^/]+\.bin$/.test(chunk.names[0])) continue;
      const name = chunk.names[0], decoded = await archive.file(name).async("uint8array");
      const candidate = await chooseHepIntegerEncoding(decoded, chunk.length, signal);
      if (candidate) {
        replacements.set(index, candidate);
        expected.set(name, digest(decoded));
      }
    }
    if (!replacements.size) return { bytes, changedChunks: 0 };
    const header = new Uint8Array(bytes.subarray(0, indexEnd)), outputView = new DataView(header.buffer);
    outputView.setUint16(4, 3, true);
    let size = indexEnd;
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index], candidate = replacements.get(index), at = 32 + index * 20;
      outputView.setUint32(at, size, true);
      outputView.setUint32(at + 4, candidate?.length ?? chunk.length, true);
      outputView.setUint8(at + 16, candidate ? 3 : chunk.codec);
      size = align4(size + (candidate?.length ?? chunk.length));
    }
    outputView.setUint32(20, crc32(header.subarray(32)), true);
    const output = new Uint8Array(size);
    output.set(header);
    cursor = indexEnd;
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      const payload = replacements.get(index) ?? bytes.subarray(chunk.offset, chunk.offset + chunk.length);
      output.set(payload, cursor);
      cursor = align4(cursor + payload.length);
    }
    if (output.length >= bytes.length) throw new Error("Storage repacking did not reduce the complete file size.");
    const restored = await HepArchive.loadAsync(output, { signal });
    for (const [name, hash] of expected) {
      signal?.throwIfAborted();
      if (digest(await restored.file(name).async("uint8array")) !== hash) {
        throw new Error(`Storage repacking changed section bytes: ${name}`);
      }
    }
    // All other chunk payloads and section records are copied byte-for-byte.
    return { bytes: output, changedChunks: replacements.size };
  } finally { hooks.deregister(); }
}

/** Exported for temporary-directory CLI tests; supplied paths are never inferred. */
export async function repackHepStorage(args, { log = console.log } = {}) {
  let write = false, timeoutMs;
  const inputs = [];
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") { log(usage); return []; }
    if (arg === "--write") write = true;
    else if (arg.startsWith("--timeout-ms=")) {
      timeoutMs = Number(arg.slice("--timeout-ms=".length));
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("--timeout-ms must be a positive integer.");
    } else if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}\n${usage}`);
    else inputs.push(path.resolve(arg));
  }
  if (!inputs.length) throw new Error(usage);
  const files = new Set();
  for (const input of inputs) {
    const metadata = await stat(input);
    if (metadata.isDirectory()) {
      for (const entry of await readdir(input, { withFileTypes: true })) {
        if (entry.isFile() && /\.hep$/i.test(entry.name)) files.add(path.join(input, entry.name));
      }
    } else if (metadata.isFile() && /\.hep$/i.test(input)) files.add(input);
    else throw new Error(`Input must be a HEP file or directory: ${input}`);
  }
  if (!files.size) throw new Error("No HEP files found.");
  const controller = new AbortController();
  const interrupt = () => controller.abort(new DOMException("Storage repacking cancelled.", "AbortError"));
  process.once("SIGINT", interrupt);
  const reports = [];
  try {
    for (const file of [...files].sort()) {
      const signal = timeoutMs === undefined ? controller.signal
        : AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
      signal.throwIfAborted();
      const metadata = await stat(file), original = await readFile(file, { signal });
      const result = await repackHepStorageBytes(original, { signal });
      const smaller = result.bytes.length < original.length;
      let temporary;
      try {
        if (write && smaller) {
          temporary = await mkdtemp(path.join(path.dirname(file), ".hep-storage-"));
          const staged = path.join(temporary, "output.hep");
          await writeFile(staged, result.bytes, { mode: metadata.mode, signal });
          if (!original.equals(await readFile(file, { signal }))) {
            throw new Error(`Input changed during repacking; refusing to overwrite ${file}`);
          }
          signal.throwIfAborted();
          await rename(staged, file);
        }
        const report = { file, previousBytes: original.length, sizeBytes: result.bytes.length,
          changedChunks: result.changedChunks, written: write && smaller };
        reports.push(report);
        log(`${path.basename(file)}: ${report.previousBytes} -> ${report.sizeBytes} bytes ` +
          `(${((report.sizeBytes / report.previousBytes - 1) * 100).toFixed(1)}%); ` +
          `${report.changedChunks} chunks; ${report.written ? "replaced" : smaller ? "measurement only" : "unchanged"}`);
      } finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
    }
    const before = reports.reduce((sum, report) => sum + report.previousBytes, 0);
    const after = reports.reduce((sum, report) => sum + report.sizeBytes, 0);
    log(`${reports.length} HEP files: ${before} -> ${after} bytes; ` +
      (write ? "smaller files replaced" : "measurement only; no files changed") + ". LOD data preserved.");
    return reports;
  } finally { process.removeListener("SIGINT", interrupt); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  repackHepStorage(process.argv.slice(2)).catch(error => {
    console.error(`HEP storage repack failed: ${error.message}`);
    process.exitCode = 1;
  });
}
