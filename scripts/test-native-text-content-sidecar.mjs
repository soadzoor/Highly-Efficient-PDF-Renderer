import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

const forbiddenImports = [];
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "pdf-lib" || specifier.startsWith("pdfjs-dist")) {
      forbiddenImports.push({ specifier, parentURL: context.parentURL });
      throw new Error(`Native textContent extraction imported ${specifier}.`);
    }
    if (
      context.parentURL?.includes("/src/") &&
      /^\.\.?\//.test(specifier) &&
      !/\.[a-z0-9]+(?:[?#]|$)/i.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});
const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
delete globalThis.Worker;

try {
  const { extractPdfPageScenes } = await import("../src/pdfVectorExtractor.ts");
  const bytes = new Uint8Array(await readFile(new URL(
    "../public/examples/pdfs/LK%20Office%20Level%201.pdf",
    import.meta.url
  )));
  const [scene] = await extractPdfPageScenes(toArrayBuffer(bytes), {
    extractTextContent: true
  });
  assert.ok(scene.textContent?.length);
  const words = scene.textContent.map(({ text }) => text);
  for (const expected of ["*SR.min", "*SR.max", "Printed", "February", "2021."]) {
    assert.ok(words.includes(expected), `missing native textContent item ${expected}`);
  }
  for (const item of scene.textContent) {
    assert.ok([item.minX, item.minY, item.maxX, item.maxY].every(Number.isFinite));
    assert.ok(item.maxX > item.minX && item.maxY > item.minY);
    assert.equal(item.pageIndex, 0);
  }
  assert.deepEqual(forbiddenImports, []);
  console.log("native textContent side-channel test passed");
} finally {
  if (originalWorker) Object.defineProperty(globalThis, "Worker", originalWorker);
  else delete globalThis.Worker;
  hooks.deregister();
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
