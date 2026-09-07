import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createCanvas } from "@napi-rs/canvas";

import { hashCanonical } from "./lib/canonical.mjs";
import { comparePngBytes } from "./lib/png-diff.mjs";

assert.equal(hashCanonical({ b: 2, a: 1 }), hashCanonical({ a: 1, b: 2 }));
assert.notEqual(hashCanonical(new Uint8Array([1, 2])), hashCanonical(new Uint8Array([1, 3])));

const expectedCanvas = createCanvas(3, 3);
const expectedContext = expectedCanvas.getContext("2d");
expectedContext.fillStyle = "#ffffff";
expectedContext.fillRect(0, 0, 3, 3);
const actualCanvas = createCanvas(3, 3);
const actualContext = actualCanvas.getContext("2d");
actualContext.fillStyle = "#ffffff";
actualContext.fillRect(0, 0, 3, 3);
actualContext.fillStyle = "#fefefe";
actualContext.fillRect(1, 1, 1, 1);
const visual = await comparePngBytes(
  expectedCanvas.toBuffer("image/png"),
  actualCanvas.toBuffer("image/png")
);
assert.equal(visual.dimensionsMatch, true);
assert.ok(visual.ssim >= 0.995);
assert.equal(visual.nonEdgeWithinToleranceFraction, 1);

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hepr-oracle-harness-test-"));
try {
  const adapterPath = path.join(temporaryRoot, "adapter.mjs");
  const sourcePath = path.join(temporaryRoot, "fixture.bin");
  const artifactRoot = path.join(temporaryRoot, "artifacts");
  const resultPath = path.join(temporaryRoot, "result.json");
  const specificationPath = path.join(temporaryRoot, "specification.json");
  const pngBase64 = expectedCanvas.toBuffer("image/png").toString("base64");
  await writeFile(sourcePath, new Uint8Array([1, 2, 3, 4]));
  await writeFile(
    adapterPath,
    `export async function createEngine() {
      return {
        identity: { id: "fixture", version: "1", build: "test" },
        async openDocument() {
          return {
            pageCount: 1,
            async getDocumentMetadata() { return { title: "fixture" }; },
            async getPage(sourcePageIndex) {
              return {
                async getMetadata() { return { sourcePageIndex }; },
                async getNormalizedText() { return "hello"; },
                async getSemanticSummary() {
                  return { operatorCount: 1, semanticSha256: "fixture" };
                },
                async renderPng() {
                  return {
                    width: 3,
                    height: 3,
                    bytes: Uint8Array.from(Buffer.from("${pngBase64}", "base64"))
                  };
                },
                async close() {}
              };
            },
            async close() {}
          };
        }
      };
    }\n`
  );
  await writeFile(
    specificationPath,
    JSON.stringify({
      schemaVersion: 1,
      adapterUrl: pathToFileURL(adapterPath).href,
      artifactRoot,
      document: {
        id: "fixture",
        name: "fixture.bin",
        relativePath: "fixture.bin",
        absolutePath: sourcePath,
        byteLength: 4
      },
      maxRenderPixels: 100,
      resultPath,
      screenshotPolicy: "representative",
      screenshotScales: [1, 2],
      writeArtifacts: true
    })
  );

  await runChild(specificationPath);
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  assert.equal(result.engine.id, "fixture");
  assert.equal(result.document.pageCount, 1);
  assert.equal(result.document.pages[0].text.sha256.length, 64);
  assert.deepEqual(
    result.document.pages[0].screenshots.map(({ scale }) => scale),
    [1, 2]
  );
  assert.equal(
    await readFile(path.join(artifactRoot, result.document.pages[0].text.file), "utf8"),
    "hello"
  );
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}

console.log("Differential oracle harness tests passed.");

async function runChild(specificationPath) {
  const harnessPath = fileURLToPath(new URL("./differential-baseline.mjs", import.meta.url));
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [harnessPath, "--child", specificationPath], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Harness child exited with ${code}: ${output}`));
    });
  });
}
