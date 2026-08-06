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
assert.equal(typeof library.buildParsedDataZip, "function");

const pdfBytes = await readFile(fixturePath);
const zipBlob = await library.buildParsedDataZip(pdfBytes, {
  compression: "store",
  encodeRasterImages: false
});
assert.ok(zipBlob instanceof Blob);
assert.equal(zipBlob.type, "application/zip");
const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
assert.deepEqual(Array.from(zipBytes.subarray(0, 2)), [0x50, 0x4b]);

const declarations = await readFile(declarationPath, "utf8");
assert.match(declarations, /export \{ buildParsedDataZip \} from "\.\/parsedDataZipBuilder";/);

console.log("Built-package parsed-data ZIP smoke test passed");
