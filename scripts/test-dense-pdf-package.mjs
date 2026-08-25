import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const libDir = resolve(rootDir, "dist/lib");
const entryPath = resolve(libDir, "index.js");
const entrySource = await readFile(entryPath, "utf8");
const workerUrlMatch = entrySource.match(
  /new URL\((['"])([^'"]*densePdfFastWorker-[^'"]+\.js)\1,\s*import\.meta\.url\)/
);

assert.ok(workerUrlMatch, "library entry must reference the dense PDF worker asset");

const workerReference = workerUrlMatch[2];
assert.ok(
  !workerReference.startsWith("/") && !isAbsolute(workerReference),
  `dense PDF worker reference must be package-relative, received ${workerReference}`
);

const workerPath = fileURLToPath(new URL(workerReference, pathToFileURL(entryPath)));
const workerRelativePath = relative(libDir, workerPath);
assert.ok(
  workerRelativePath.length > 0 && !workerRelativePath.startsWith("..") && !isAbsolute(workerRelativePath),
  `dense PDF worker must resolve inside dist/lib, received ${workerPath}`
);
await access(workerPath);

console.log(`dense PDF package worker resolution passed (${workerReference})`);
