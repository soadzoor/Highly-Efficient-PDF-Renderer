import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";

import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const libDir = resolve(rootDir, "dist/lib");
const entryPath = resolve(libDir, "index.js");
const packageManifest = JSON.parse(await readFile(resolve(rootDir, "package.json"), "utf8"));
assert.deepEqual(packageManifest.exports?.["./node"], {
  types: "./dist/types/nodePdfSource.d.ts",
  import: "./dist/lib/node.js",
  default: "./dist/lib/node.js"
});
assert.deepEqual(packageManifest.exports?.["./experimental/pdf-worker"], {
  import: "./dist/lib/pdf-worker.js",
  default: "./dist/lib/pdf-worker.js"
});
assert.deepEqual(packageManifest.exports?.["./experimental/dense-pdf-worker"], {
  import: "./dist/lib/dense-pdf-worker.js",
  default: "./dist/lib/dense-pdf-worker.js"
});
await Promise.all([
  access(resolve(libDir, "node.js")),
  access(resolve(libDir, "dense-pdf-worker.js")),
  access(resolve(libDir, "pdf-worker.js")),
  access(resolve(rootDir, "dist/types/nodePdfSource.d.ts"))
]);
for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
  for (const dependency of ["pdf-lib", "pdfjs-dist"]) {
    assert.equal(
      packageManifest[field]?.[dependency],
      undefined,
      `${dependency} must not be present in package.json ${field}`
    );
  }
}
const entrySource = await readFile(entryPath, "utf8");
const listFilesRecursively = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFilesRecursively(path));
    else files.push(path);
  }
  return files;
};
const packagedFiles = [
  ...await listFilesRecursively(libDir),
  ...await listFilesRecursively(resolve(rootDir, "dist/types"))
];
for (const path of packagedFiles) {
  const packagedPath = relative(libDir, path);
  assert.doesNotMatch(
    packagedPath,
    /pdfjs|pdf-lib/i,
    `published artifact name must not reference PDF.js or pdf-lib: ${packagedPath}`
  );
  if (!/\.(?:js|mjs|cjs|d\.ts)$/.test(path)) continue;
  const source = await readFile(path, "utf8");
  assert.doesNotMatch(
    source,
    /pdfjs-dist|(?:@pdf-lib\/|["']pdf-lib(?:\/|["']))|pdfJsRuntime|GlobalWorkerOptions|__w_pdfjs_require__/,
    `published artifact must not contain a PDF.js/pdf-lib runtime reference: ${packagedPath}`
  );
}
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

const workerSource = await readFile(workerPath, "utf8");
const nativeRetainedTextChunkMatch = workerSource.match(
  /import\((['"`])(\.\/nativeDenseRetainedTextCompiler-[^'"`]+\.js)\1\)/
);
assert.ok(
  nativeRetainedTextChunkMatch,
  "dense PDF worker must lazy-load the native retained-text compiler chunk"
);
const nativeRetainedTextChunkPath = fileURLToPath(new URL(
  nativeRetainedTextChunkMatch[2],
  pathToFileURL(workerPath)
));
assert.ok(
  relative(libDir, nativeRetainedTextChunkPath).length > 0 &&
    !relative(libDir, nativeRetainedTextChunkPath).startsWith("..") &&
    !isAbsolute(relative(libDir, nativeRetainedTextChunkPath)),
  `native retained-text compiler chunk must resolve inside dist/lib, received ${nativeRetainedTextChunkPath}`
);
await access(nativeRetainedTextChunkPath);

const rootJavaScriptFiles = (await readdir(libDir))
  .filter((name) => name.endsWith(".js"));
let browserWorkerReference = null;
let nodeDenseWorkerReferenceFound = false;
for (const name of rootJavaScriptFiles) {
  const source = await readFile(resolve(libDir, name), "utf8");
  if (source.includes("./dense-pdf-worker.js")) {
    nodeDenseWorkerReferenceFound = true;
  }
  const match = source.match(
    /new URL\((['"])(assets\/pdfWorkerEntry-[^'"]+\.js)\1,\s*import\.meta\.url\)/
  );
  if (match) {
    browserWorkerReference = match[2];
    break;
  }
}
assert.equal(
  nodeDenseWorkerReferenceFound,
  true,
  "the packaged dense client must resolve its Node worker without a global Worker shim"
);
assert.ok(
  browserWorkerReference,
  "the browser client must reference Vite's package-relative full native PDF worker asset"
);
await access(resolve(libDir, browserWorkerReference));

const { openPdfInNodeWorker } = await import(
  `${pathToFileURL(resolve(libDir, "node.js")).href}?package-worker-test=${Date.now()}`
);
const packageWorkerFixture = writeTinyPdf({
  objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    {
      number: 3,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 10] /Contents 4 0 R >>"
    },
    { number: 4, body: tinyPdfStream("", "1 0 0 rg 1 2 3 4 re f\n") }
  ]
});
const denseCallerSnapshot = packageWorkerFixture.slice();
const denseWorker = new NodeWorker(
  pathToFileURL(resolve(libDir, "dense-pdf-worker.js")),
  { name: "hepr-package-dense-test" }
);
try {
  const denseOwnedBytes = packageWorkerFixture.slice();
  const denseResult = new Promise((resolveResult, rejectResult) => {
    denseWorker.on("message", (message) => {
      if (message?.type === "result") resolveResult(message.result);
    });
    denseWorker.once("error", rejectResult);
    denseWorker.once("exit", (code) => {
      if (code !== 0) rejectResult(new Error(`Dense package worker exited with code ${code}.`));
    });
  });
  denseWorker.postMessage({
    type: "compile",
    pdfBytes: denseOwnedBytes,
    options: {
      enableSegmentMerge: false,
      enableInvisibleCull: false
    }
  }, [denseOwnedBytes.buffer]);
  const result = await denseResult;
  assert.equal(result.kind, "success");
  assert.equal(result.pages[0].compiled.fillPathCount, 1);
  assert.deepEqual(packageWorkerFixture, denseCallerSnapshot);
} finally {
  await denseWorker.terminate();
}
const packageSession = await openPdfInNodeWorker({
  kind: "bytes",
  bytes: packageWorkerFixture
});
try {
  const scene = await packageSession.compileVectorPage(0, {
    optimization: "none",
    enableSegmentMerge: false,
    enableInvisibleCull: true
  });
  assert.equal(scene.pageCount, 1);
  assert.equal(scene.fillPathCount, 1);
} finally {
  await packageSession.close();
}

console.log(
  `dense PDF package worker resolution passed ` +
  `(${workerReference}, ${nativeRetainedTextChunkMatch[2]}, ${browserWorkerReference})`
);
