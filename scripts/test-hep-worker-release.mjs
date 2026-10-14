import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const workerModule = `export async function openPdfInNodeWorker() { return globalThis.hepWorkerReleaseSession; }
export const openPdfInBrowserWorker = openPdfInNodeWorker;`;
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/pdfVectorExtractor.ts") && specifier === "./pdf/workerClient") {
    return { url: `data:text/javascript,${encodeURIComponent(workerModule)}`, shortCircuit: true };
  }
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { extractPdfPageScenes } = await import("../src/pdfVectorExtractor.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const bytes = new TextEncoder().encode("%PDF-1.7\n");
  const extract = (prepare, signal) => extractPdfPageScenes(bytes.slice().buffer, {}, signal, "copy", prepare);
  const setup = (count, options = {}) => {
    const events = [], pages = Array.from({ length: count }, (_, index) => ({ ...createEmptyVectorScene(),
      rasterLayers: [{ width: 1, height: 1, data: Uint8Array.of(index, 2, 3, 255),
        matrix: Float32Array.of(1, 0, 0, 1, 0, 0), pageIndex: 0, paintOrder: 0 }] }));
    let closed = false, closeCount = 0;
    globalThis.hepWorkerReleaseSession = {
      info: { pageCount: count },
      async compileVectorPage(index, compileOptions) {
        assert.equal(closed, false, "the worker stays alive while another selected page needs decoding");
        compileOptions.signal?.throwIfAborted();
        events.push(`compile:${index}`);
        if (options.compileError) throw options.compileError;
        return pages[index];
      },
      async close() { closeCount++; closed = true; events.push("close"); options.onClose?.(); }
    };
    return { pages, events, get closed() { return closed; }, get closeCount() { return closeCount; } };
  };

  const single = setup(1);
  const parsed = await extract(async scene => {
    assert.equal(single.closed, true, "the worker's codec/cache memory is released before final encoding starts");
    single.events.push("prepare:0");
    assert.deepEqual(scene.rasterLayers[0].data, Uint8Array.of(0, 2, 3, 255),
      "transferred image pixels remain usable after worker termination");
  });
  assert.equal(parsed[0], single.pages[0]);
  assert.deepEqual(single.events, ["compile:0", "close", "prepare:0"]);
  assert.equal(single.closeCount, 1);

  let releasePrevious;
  const multiple = setup(2, { onClose: () => releasePrevious() });
  await extract(async scene => {
    const index = scene.rasterLayers[0].data[0];
    multiple.events.push(`prepare:${index}`);
    if (index === 0) {
      assert.equal(multiple.closed, false, "earlier pages encode while the worker parses the next one");
      await new Promise(resolve => { releasePrevious = resolve; });
    } else assert.equal(multiple.closed, true);
  });
  assert.deepEqual(multiple.events, ["compile:0", "prepare:0", "compile:1", "close", "prepare:1"],
    "final worker release also precedes waiting for the previous page's encoder");
  assert.equal(multiple.closeCount, 1);

  const cancelled = new AbortController(), reason = new Error("cancelled during worker close");
  const interrupted = setup(1, { onClose: () => cancelled.abort(reason) });
  await assert.rejects(extract(async () => assert.fail("encoding must not start after cancellation"), cancelled.signal),
    error => error === reason);
  assert.equal(interrupted.closeCount, 1);

  const encodeError = new Error("image encoding failed"), failedEncoding = setup(1);
  await assert.rejects(extract(async () => { throw encodeError; }), error => error === encodeError);
  assert.equal(failedEncoding.closeCount, 1, "preparation failure does not close an already released worker again");
  const compileError = new Error("PDF compilation failed"), failedCompilation = setup(1, { compileError });
  await assert.rejects(extract(async () => assert.fail("compilation failed")), error => error === compileError);
  assert.equal(failedCompilation.closeCount, 1, "compilation failure still releases the worker");
  console.log("HEP worker release: final-page ownership, overlapping preparation, cancellation and error cleanup passed.");
} finally {
  delete globalThis.hepWorkerReleaseSession;
  hooks.deregister();
}
