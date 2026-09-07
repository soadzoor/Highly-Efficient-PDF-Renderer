import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const execute = promisify(execFile);
const temporary = await mkdtemp(path.join(tmpdir(), "hepr-room-segments-"));
try {
  const fixture = writeTinyPdf({
    objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      {
        number: 3,
        body: "<< /Type /Page /Parent 2 0 R /MediaBox [10 20 110 70] /Resources << >> /Contents 4 0 R >>"
      },
      {
        number: 4,
        body: tinyPdfStream("", "0 0 0 RG 2 w 10 20 m 30 20 l S 1 0 0 rg 40 25 20 10 re f\n")
      }
    ]
  });
  const pdfPath = path.join(temporary, "micro.pdf");
  const output = path.join(temporary, "out");
  await writeFile(pdfPath, fixture);
  const script = new URL("./extract-segments.mjs", import.meta.url);
  await execute(process.execPath, [
    "--experimental-strip-types",
    script.pathname,
    "--root",
    temporary,
    "--out",
    output
  ]);
  const compressed = await readFile(path.join(output, "micro.segments.json.gz"));
  const dump = JSON.parse(gunzipSync(compressed).toString("utf8"));
  assert.equal(dump.version, 1);
  assert.equal("engine" in dump, false);
  assert.deepEqual(dump.sceneStats.pageBounds, [0, 0, 100, 50]);
  assert.equal(dump.sceneStats.segmentCount > 0, true);
  assert.equal(dump.sceneStats.fillPathCount > 0, true);
  assert.equal(dump.boundsMismatch, false);
  assert.equal(dump.strokes.endpoints.length % 4, 0);
  assert.equal(dump.fills.pathMetaA.length % 4, 0);
  console.log("production VectorScene room segment extractor test passed");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
