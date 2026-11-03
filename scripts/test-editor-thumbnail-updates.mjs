import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import vm from "node:vm";
import { editorUiTestContext } from "./lib/editorUiTestContext.mjs";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
try {
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { captureEditorPageChanges, changedEditorPages } = await import("../src/editorPageChanges.ts");
  const source = (await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8")).replace(/^ {2}/gm, "");
  function harness() {
    const scene = buildStrokeScene([]);
    scene.pageCount = 2; scene.pageRects = Float32Array.of(0, 0, 100, 100, 150, 0, 250, 100); scene.pageTextRanges = new Uint32Array(4);
    const session = createEditorSession(scene), preparations = [], applications = [], errors = [];
    const shape = pageIndex => ({ kind: "shape", shape: "rectangle", pageIndex, x: 10, y: 10, width: 20, height: 20 });
    const a = session.addObject(shape(0)), b = session.addObject(shape(1));
    session.getScene = options => {
      const job = deferred(), scene = { revision: session.revision };
      preparations.push({ ...job, scene, options }); return job.promise;
    };
    const context = editorUiTestContext({ session, captureEditorPageChanges, changedEditorPages,
      committedPageChanges: captureEditorPageChanges(session), active: false,
      renderRevision: 0, scenePreparation: null, sceneApplication: null, requestedPreview: null,
      presented: null, latestScene: scene, pendingDrawings: { capture() {}, acknowledge() {} },
      synchronizeDocumentSource: async () => {}, updatePointerCursor() {},
      report(error) { if (error.name !== "AbortError") errors.push(error); },
      host: { applyScene(scene, signal, acknowledge, options) {
        signal.throwIfAborted(); const job = deferred();
        applications.push({ ...job, scene, signal, acknowledge, options }); return job.promise;
      } }
    });
    vm.runInContext(sourceFunction(source, "refreshScene"), context);
    return { session, context, a, b, preparations, applications, errors,
      change(id, color) { session.updateObject(id, { color }); },
      async compile(index) { preparations[index].resolve(preparations[index].scene); await tick(); },
      async draw(index) { applications[index].acknowledge(); applications[index].resolve(); await tick(); },
      pages(index) { const pages = applications[index].options.affectedPages; return pages && Array.from(pages); },
      close() { context.disposed = true; session.dispose(); }
    };
  }
  {
    const h = harness();
    try {
      h.session.select([h.a]); const selection = h.context.refreshScene(); await tick(); await h.compile(0);
      assert.deepEqual(h.pages(0), [], "selection leaves cached thumbnails intact"); await h.draw(0); await selection;
      h.change(h.a, "red"); const superseded = h.context.refreshScene(); await tick();
      h.change(h.b, "blue"); const latest = h.context.refreshScene(); await tick();
      assert(h.preparations[1].options.signal.aborted); await h.compile(1); await superseded;
      assert.equal(h.applications.length, 1, "canceled preparation does not publish or advance the page baseline");
      await h.compile(2); assert.deepEqual(h.pages(1), [0, 1], "the replacement commit includes every unpublished page change");
      await h.draw(1); await latest;
      h.session.select([h.b]); const next = h.context.refreshScene(); await tick(); await h.compile(3);
      assert.deepEqual(h.pages(2), [], "acknowledged changes are not invalidated again"); await h.draw(2); await next;
      assert.deepEqual(h.errors, []);
    } finally { h.close(); }
  }
  {
    const h = harness();
    try {
      h.change(h.a, "red"); const first = h.context.refreshScene(); await tick(); await h.compile(0);
      h.change(h.b, "blue"); const second = h.context.refreshScene(); await tick(); await h.compile(1);
      assert.equal(h.applications.length, 1, "newer publications wait for the prior matching frame");
      assert.deepEqual(h.pages(0), [0]); await h.draw(0); await first;
      assert.deepEqual(h.pages(1), [1], "the next commit compares against the frame acknowledged while it was waiting");
      await h.draw(1); await second;
    } finally { h.close(); }
  }
  {
    const h = harness();
    try {
      h.change(h.a, "red"); const preview = h.context.refreshScene(undefined, true); await tick(); await h.compile(0);
      assert.deepEqual(h.pages(0), [], "temporary scenes do not refresh thumbnails"); await h.draw(0); await preview;
      const committed = h.context.refreshScene(); await tick(); await h.compile(1);
      assert.deepEqual(h.pages(1), [0], "a preview cannot consume the committed page delta"); await h.draw(1); await committed;
      h.change(h.a, "green"); const failed = h.context.refreshScene(); await tick(); await h.compile(2);
      const error = new Error("Synthetic publication failure"); h.applications[2].reject(error); await failed;
      h.change(h.b, "purple"); const retry = h.context.refreshScene(); await tick(); await h.compile(3);
      assert.deepEqual(h.pages(3), [0, 1], "failed publications do not consume changed pages"); await h.draw(3); await retry;
      assert.deepEqual(h.errors, [error]);
    } finally { h.close(); }
  }
  console.log("Editor thumbnails retain committed page deltas across previews, canceled preparation, serialized frames and failed publication.");
} finally { hooks.deregister(); }
