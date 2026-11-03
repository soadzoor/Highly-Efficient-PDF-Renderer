import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { editorUiTestContext } from "./lib/editorUiTestContext.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { createEditorInteractionController } = await import("../src/editorInteraction.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { resolveAnnotationView } = await import("../src/viewerLinkNavigation.ts");
  const source = await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8"), nested = source.replace(/^ {2}/gm, "");
  const modeStart = source.indexOf("    async setEditing(value, externalSignal) {"), modeEnd = source.indexOf("\n    },\n    isEditing:", modeStart);
  assert(modeStart >= 0 && modeEnd > modeStart, "exercise the production editing-mode lifecycle");
  const setEditing = stripTypeScriptTypes(`${source.slice(modeStart, modeEnd).trim().replace("async setEditing", "async function setEditing")}\n}`);
  const scene = buildStrokeScene([{ points: [[10, 10], [30, 20]], width: 1 }, { points: [[60, 60], [80, 70]], width: 1 },
    { points: [[40, 80], [50, 90]], width: 1 }]);
  scene.pageRects = Float32Array.of(0, 0, 100, 100);
  const session = createEditorSession(scene), interaction = createEditorInteractionController(session), modes = [], errors = [], draws = [];
  const classes = new Set(), noop = () => {};
  const context = editorUiTestContext({
    session, interaction, active: false, clipboardRunning: false, activeText: null, pointer: null, pendingPick: null, picking: null, polygon: null,
    currentState: session.getState(), currentSourceScene: scene, latestScene: scene, presented: null,
    renderRevision: 0, scenePreparation: null, sceneApplication: null, requestedPreview: null,
    previewGeneration: 0, previewQueued: false, previewPending: false, toolRequest: 0, textRequest: 0,
    pendingFieldFocus: null, pendingDrawings: { capture: () => null, acknowledge: noop },
    toolbar: { hidden: true }, overlay: { hidden: true, dataset: {}, style: {} },
    host: {
      setEditing(value) { modes.push(value); },
      async applyScene(compiled, signal, onPresented) {
        signal.throwIfAborted(); draws.push(compiled); onPresented();
      }
    },
    document: { body: { classList: {
      toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }, remove: name => classes.delete(name)
    } } },
    window: { cancelAnimationFrame: noop }, frame: 0, releaseFrameListener: null,
    layerControls: { setActive: noop }, layerDialog: null,
    contextMenu: { close: noop }, fieldDrafts: new Map(), flushEditorFieldDrafts: noop,
    recoveryReady: Promise.resolve(), recoveryOffered: false,
    updateGeometry: noop, tick: noop, report(error) { if (!(error instanceof DOMException && error.name === "AbortError")) errors.push(error); }
  });
  const unsubscribe = session.subscribe(state => { context.currentState = state; });
  for (const name of ["isSceneSettling", "updatePointerCursor", "clearPreview", "cancelPointerGesture", "synchronizeDocumentSource", "refreshScene", "commit"])
    vm.runInContext(sourceFunction(nested, name), context);
  vm.runInContext(setEditing, context);
  const owner = "source:stroke:0", target = "source:stroke:1";
  try {
    await context.setEditing(true);
    assert(context.active); assert(!context.toolbar.hidden); assert(classes.has("hepr-editing"));
    session.select([owner]);
    const previousDraws = draws.length;
    context.commit(() => session.setObjectLink(owner, { type: "object", objectId: target }));
    await tick();
    assert.deepEqual(errors, [], "compiling a link on original page artwork must not fail silently");
    assert.equal(draws.length, previousDraws + 1, "the newly linked scene reaches the ordinary renderer");

    for (let cycle = 0; cycle < 3; cycle++) {
      await context.setEditing(false);
      assert.equal(context.active, false); assert(context.toolbar.hidden && context.overlay.hidden); assert(!classes.has("hepr-editing"));
      const compiled = draws.at(-1), links = compiled.annotations?.filter(annotation => annotation.subtype === "Link") ?? [];
      assert.equal(links.length, 1, "mode switches preserve exactly one current hotspot");
      assert(resolveAnnotationView(compiled, links[0], { centerX: 50, centerY: 50, zoom: 1 }, { width: 800, height: 600 }),
        "the scene used by Read mode resolves the same-page object destination");
      assert.deepEqual(session.getObjectLink(owner), { type: "object", objectId: target });
      const modeCount = modes.length;
      await context.setEditing(true);
      assert(context.active); assert(!context.toolbar.hidden && !context.overlay.hidden); assert(classes.has("hepr-editing"));
      assert.deepEqual(modes.slice(modeCount), [true], "re-entry cannot flash Edit and roll back to Read");
    }

    // An immediate switch to Read must wait for metadata-only link changes too,
    // through both compilation and the host's acknowledgement of the new draw.
    const compile = session.getScene, applyScene = context.host.applyScene, compilations = [];
    let application;
    session.getScene = options => {
      const job = { ...deferred(), signal: options.signal }; compilations.push(job);
      return job.promise.then(() => compile(options));
    };
    context.host.applyScene = async (compiled, signal, onPresented) => {
      const done = deferred();
      application = { scene: compiled, acknowledge() { signal.throwIfAborted(); draws.push(compiled); onPresented(); done.resolve(); } };
      await done.promise;
    };
    const firstModes = modes.length, previousScene = context.latestScene;
    context.commit(() => session.setObjectLink(owner, { type: "object", objectId: "source:stroke:2" }));
    await tick(); assert.equal(compilations.length, 1);
    const leaving = context.setEditing(false);
    await tick();
    assert.equal(context.active, true, "Read mode cannot activate with the previous link metadata still displayed");
    assert.deepEqual(modes.slice(firstModes), []); assert.equal(compilations.length, 2);
    assert(compilations[0].signal.aborted, "the exit handoff supersedes the older unpresented preparation");
    compilations[0].resolve(); await tick();
    compilations[1].resolve(); await tick();
    assert(application, "the final committed scene is installed before Read becomes active");
    assert.equal(context.latestScene, previousScene, "installation alone cannot acknowledge a draw");
    assert.deepEqual(modes.slice(firstModes), []);
    application.acknowledge(); await leaving;
    assert.equal(context.active, false); assert.deepEqual(modes.slice(firstModes), [false]);
    assert.equal(context.latestScene, application.scene);
    const destination = context.latestScene.annotations.find(annotation => annotation.subtype === "Link").destination;
    assert(destination.name.endsWith(encodeURIComponent("source:stroke:2")), "Read receives the new object destination");
    session.getScene = compile; context.host.applyScene = applyScene;
    await context.setEditing(true); assert(context.active);
    assert.deepEqual(errors, []);
    console.log("Original-artwork links: committed scene publication, working Read destinations and repeated Edit re-entry passed.");
  } finally { unsubscribe(); interaction.dispose(); session.dispose(); }
} finally { hooks.deregister(); }
