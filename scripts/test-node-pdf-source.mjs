import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !specifier.endsWith(".ts")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

try {
  const { createNodeFilePdfSource } = await import("../src/nodePdfSource.ts");
  const url = new URL("../public/examples/pdfs/LK Office Level 1.pdf", import.meta.url);
  const source = await createNodeFilePdfSource(url);
  assert.equal(source.kind, "range");
  assert.equal(source.label, "LK Office Level 1.pdf");
  assert.ok(source.byteLength > 8);

  const signal = new AbortController().signal;
  const header = await source.read(0, 8, signal);
  assert.equal(new TextDecoder("latin1").decode(header).startsWith("%PDF-"), true);
  const tail = await source.read(source.byteLength - 6, 6, signal);
  assert.match(new TextDecoder("latin1").decode(tail), /%%EOF/);

  await source.close();
  await source.close();
  await assert.rejects(source.read(0, 1, signal), (error) => error?.code === "closed");
  console.log("Node random-access PDF source tests passed.");
} finally {
  hooks.deregister();
}
