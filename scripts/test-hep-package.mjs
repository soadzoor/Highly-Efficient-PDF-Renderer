// Smoke-test the built npm artifact rather than the TypeScript source graph.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(scriptDir, "..");
const declarationPath = path.join(repoRootDir, "dist/types/index.d.ts");
const fixturePath = path.join(repoRootDir, "public/examples/pdfs/LK Office Level 1.pdf");

const library = await import("@soadzoor/hepr");
assert.equal(typeof library.buildHep, "function");

const pdfBytes = await readFile(fixturePath);
const zipBlob = await library.buildHep(pdfBytes, {
  compression: "store",
  encodeRasterImages: false
});
assert.ok(zipBlob instanceof Blob);
assert.equal(zipBlob.type, "application/x-hep");
const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
assert.deepEqual(Array.from(zipBytes.subarray(0, 4)), [0x48, 0x45, 0x50, 0]);

const declarations = await readFile(declarationPath, "utf8");
assert.match(declarations, /export \{ buildHep \} from "\.\/hepBuilder";/);

console.log("Built-package HEP smoke test passed");
