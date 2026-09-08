#!/usr/bin/env node
// Bounded, development-only migration. This never opens or parses PDF content.
import { createHash } from "node:crypto";
import { existsSync, renameSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readLegacyHepZip } from "./lib/legacyHepZip.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const usage = "Usage: node scripts/repack-heps.mjs [--dry-run | --check] [--timeout-ms=60000] <file-or-directory>...";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function verifyHep(bytes, { HepArchive, expected, signal }) {
  const archive = await HepArchive.loadAsync(bytes, { signal });
  const names = Object.keys(archive.files);
  if (expected && (names.length !== expected.size || names.some((name) => !expected.has(name)))) {
    throw new Error("Repacked HEP section names differ from the legacy archive");
  }
  for (const name of names) {
    signal.throwIfAborted();
    const decoded = await archive.files[name].async("uint8array");
    if (expected && !Buffer.from(decoded).equals(Buffer.from(expected.get(name)))) {
      throw new Error(`Repacked HEP changed section bytes: ${name}`);
    }
    if (name === "manifest.json") {
      const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
      if (manifest?.formatVersion !== 6) throw new Error("Only HEP scene schema 6 can be repacked");
    }
  }
  if (!archive.files["manifest.json"]) throw new Error("HEP manifest.json is missing");
}

/** Exported for temporary-directory migration tests; never selects inputs implicitly. */
export async function repackHeps(args, { log = console.log } = {}) {
  let dryRun = false;
  let check = false;
  let timeoutMs = 60_000;
  const inputPaths = [];
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") { log(usage); return []; }
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--check") check = true;
    else if (arg.startsWith("--timeout-ms=")) {
      timeoutMs = Number(arg.slice("--timeout-ms=".length));
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
        throw new Error("--timeout-ms must be an integer from 1 to 60000; run larger migrations in smaller batches");
      }
    } else if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}\n${usage}`);
    else inputPaths.push(path.resolve(arg));
  }
  if (inputPaths.length === 0 || (dryRun && check)) throw new Error(usage);
  const signal = AbortSignal.timeout(timeoutMs);
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
          !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      return nextResolve(specifier, context);
    }
  });
  const temporaryDirectories = [];
  const staged = [];
  const reports = [];
  try {
    const { HepArchive, crc32 } = await import("../src/hepContainer.ts");
    const files = new Set();
    for (const input of inputPaths) {
      signal.throwIfAborted();
      const metadata = await stat(input);
      if (metadata.isDirectory()) {
        for (const entry of await readdir(input, { withFileTypes: true })) {
          if (entry.isFile() && /\.hep$/i.test(entry.name)) files.add(path.join(input, entry.name));
        }
      } else if (metadata.isFile()) files.add(input);
      else throw new Error(`Input must be a regular file or directory: ${input}`);
    }
    if (files.size === 0) throw new Error("No .hep files found in the supplied inputs");
    const stage = async (target, bytes, original, mode) => {
      signal.throwIfAborted();
      const directory = await mkdtemp(path.join(path.dirname(target), ".hep-repack-"));
      temporaryDirectories.push(directory);
      const temporary = path.join(directory, path.basename(target));
      await writeFile(temporary, bytes, { signal, mode });
      staged.push({ target, temporary, originalDigest: digest(original) });
      return temporary;
    };
    for (const file of [...files].sort()) {
      signal.throwIfAborted();
      const metadata = await stat(file);
      if (metadata.size > 0xffffffff) throw new Error(`HEP file exceeds 4 GiB: ${file}`);
      const bytes = await readFile(file, { signal });
      const start = performance.now();
      if (bytes.subarray(0, 4).equals(Buffer.from([0x48, 0x45, 0x50, 0]))) {
        await verifyHep(bytes, { HepArchive, signal });
        reports.push({ file, previousBytes: bytes.length, sizeBytes: bytes.length, migrated: false });
        log(`${path.basename(file)}: existing HEP verified (${bytes.length} bytes)`);
        continue;
      }
      if (check) throw new Error(`Legacy ZIP requires migration: ${file}`);
      const expected = await readLegacyHepZip(bytes, { crc32, signal });
      const decodedMs = performance.now() - start;
      if (dryRun) {
        reports.push({ file, previousBytes: bytes.length, sizeBytes: bytes.length, migrated: false });
        log(`${path.basename(file)}: legacy ZIP verified (${expected.size} sections, ${decodedMs.toFixed(1)} ms)`);
        continue;
      }
      const archive = new HepArchive();
      for (const [name, value] of expected) archive.file(name, value);
      const encodeStart = performance.now();
      const output = await archive.generateAsync({ type: "uint8array", compression: "DEFLATE", signal });
      const encodedMs = performance.now() - encodeStart;
      const verifyStart = performance.now();
      const temporary = await stage(file, output, bytes, metadata.mode);
      await verifyHep(await readFile(temporary, { signal }), { HepArchive, expected, signal });
      const verifiedMs = performance.now() - verifyStart;
      reports.push({ file, previousBytes: bytes.length, sizeBytes: output.length, migrated: true,
        decodedMs, encodedMs, verifiedMs });
      const change = ((output.length / bytes.length - 1) * 100).toFixed(2);
      log(`${path.basename(file)}: staged ${bytes.length} -> ${output.length} bytes (${change}%), ` +
        `decode ${decodedMs.toFixed(1)} ms, write ${encodedMs.toFixed(1)} ms, verify ${verifiedMs.toFixed(1)} ms`);
    }

    // Only bundled examples have a known manifest. Preserve its generatedAt;
    // this changes storage sizes, not the examples' PDF content or metadata.
    const manifestPath = path.join(repoRoot, "public/examples/manifest.json");
    const bundledSizes = new Map(reports.filter((report) => report.migrated)
      .map((report) => [report.file, report.sizeBytes]));
    if (bundledSizes.size > 0 && existsSync(manifestPath)) {
      const original = await readFile(manifestPath, { signal });
      const manifest = JSON.parse(original.toString("utf8"));
      let changed = false;
      for (const example of manifest.examples ?? []) {
        if (typeof example.hep?.path !== "string") continue;
        const assetPath = path.resolve(repoRoot, "public", decodeURIComponent(example.hep.path));
        const sizeBytes = bundledSizes.get(assetPath);
        if (sizeBytes !== undefined && example.hep.sizeBytes !== sizeBytes) {
          example.hep.sizeBytes = sizeBytes;
          changed = true;
        }
      }
      if (changed) await stage(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, original,
        (await stat(manifestPath)).mode);
    }
    // Finish all validations, including concurrent-edit detection, before any
    // replacement. Each rename is atomic; a filesystem failure can still leave
    // a partially migrated batch, which can safely be rerun.
    for (const entry of staged) {
      if (digest(await readFile(entry.target, { signal })) !== entry.originalDigest) {
        throw new Error(`Input changed during migration; no replacements made: ${entry.target}`);
      }
    }
    signal.throwIfAborted();
    for (const entry of staged) renameSync(entry.temporary, entry.target);
    const migrated = reports.filter((report) => report.migrated);
    if (migrated.length > 0) {
      const before = migrated.reduce((sum, report) => sum + report.previousBytes, 0);
      const after = migrated.reduce((sum, report) => sum + report.sizeBytes, 0);
      log(`Repacked and verified ${migrated.length} files: ${before} -> ${after} bytes; no PDFs parsed.`);
    } else log(`Validated ${reports.length} files; no files changed.`);
    return reports;
  } finally {
    hooks.deregister();
    await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await repackHeps(process.argv.slice(2)); }
  catch (error) {
    console.error(`HEP repack failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
