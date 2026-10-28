import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
try {
  const { waitForEditorScenePresentation } = await import("../src/editorPresentation.ts");
  const { waitForLoad } = await import("../src/loadCancellation.ts");
  const [nativeSource, threeSource] = await Promise.all([readFile(new URL("../src/main.ts", import.meta.url), "utf8"), readFile(new URL("../src/three-example.ts", import.meta.url), "utf8")]);
  const hostMethod = source => {
    const start = source.indexOf("        async applyScene("), end = source.indexOf("\n        },", start);
    assert(start >= 0 && end > start, "the stock host exposes its presentation method");
    return stripTypeScriptTypes(source.slice(start, end + "\n        }".length).replace("async applyScene(", "async function applyScene("));
  };
  const nativeMethod = hostMethod(nativeSource), threeMethod = hostMethod(threeSource);
  const functionBefore = (source, name, next) => stripTypeScriptTypes(source.slice(source.indexOf(`function ${name}(`), source.indexOf(next, source.indexOf(`function ${name}(`))));
  const nativeDisabled = functionBefore(nativeSource, "updateBackendSelectDisabledState", "\nfunction updateParsingLoaderProgress");
  const busyStart = nativeSource.indexOf("  isOperationActive: () =>"), busyEnd = nativeSource.indexOf(",\n  getSceneSnapshot", busyStart);
  const nativeBusy = `function nativeBackendIsBusy() { return (${nativeSource.slice(busyStart + "  isOperationActive: () =>".length, busyEnd)}); }`;
  const threeDisabled = functionBefore(threeSource, "updateThreeBackendSelectDisabledState", "\nfunction setLoadControlsEnabled");
  const threeBackendChange = functionBefore(threeSource, "changeThreeRendererBackend", '\nbackendSelectElement.addEventListener("change"');
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

  function nativeHost() {
    const events = [], targetScene = { id: "new scene" };
    let listener, listenerChanges = 0;
    const parent = () => events.push("stats"); listener = parent;
    const renderer = { getViewState: () => ({}), setViewState() {}, setScene() { events.push("upload"); },
      setFrameListener(value) { listener = value; listenerChanges++; } };
    const context = vm.createContext({ waitForEditorScenePresentation, waitForLoad, DOMException, viewerPrintAction: null, renderer, onRendererFrame: parent,
      editorSceneApplicationActive: false, pendingSourceLoadCount: 0, activeSceneLoadToken: null, activeHepExportController: null,
      layoutChangeRunning: false, pdfEditor: {}, lastLoadedSource: null, ocrTextCheckbox: {}, compressScansCheckbox: {},
      pageStreamingCheckbox: {}, backendSelectElement: {}, backendSwitcher: { runWhenIdle: async action => action() },
      ScenePageViews: class { pageCount = 1; extract() { return { scene: targetScene }; } }, sourcePlacementMatches: () => true,
      pendingEditorSource: null, nativeLayout: "grid", canonicalPagesPerRow: 1, lastParsedScene: null, documentPageScenes: null,
      lastCanonicalScene: null, activePdfPageLoader: null, parsedPdfPageCache: null, readerViewport: { invalidateThumbnails() {} }, applyTextSearchScene() {} });
    vm.runInContext(`${nativeDisabled}\n${nativeBusy}\n${nativeMethod}`, context);
    return { context, events, scene: targetScene, parent, get listener() { return listener; }, get listenerChanges() { return listenerChanges; }, emit() { listener({}); } };
  }
  {
    const host = nativeHost(), controller = new AbortController();
    const pending = host.context.applyScene(host.scene, controller.signal, () => host.events.push("presented"));
    pending.then(() => host.events.push("resolved"));
    assert.equal(host.context.editorSceneApplicationActive, true); assert.equal(host.context.backendSelectElement.disabled, true);
    assert.equal(host.context.nativeBackendIsBusy(), true, "native backend guard prevents disposing a renderer with a pending presentation");
    await tick();
    assert.deepEqual(host.events, ["upload"], "native uploads alone cannot acknowledge selection chrome");
    assert.notEqual(host.listener, host.parent);
    host.emit(); assert.deepEqual(host.events, ["upload", "stats", "presented"], "native acknowledgement is synchronous after the matching submitted draw");
    await pending; assert.deepEqual(host.events, ["upload", "stats", "presented", "resolved"]);
    assert.equal(host.listener, host.parent, "native statistics listener is restored immediately");
    assert.equal(host.context.editorSceneApplicationActive, false); assert.equal(host.context.backendSelectElement.disabled, false);
    assert.equal(host.context.nativeBackendIsBusy(), false, "idle Edit mode allows backend changes");
    host.emit(); assert.equal(host.events.filter(event => event === "presented").length, 1, "acknowledgement is one-shot");
  }
  {
    const host = nativeHost(), failure = new Error("overlay observer failed");
    const observer = () => { throw failure; }; host.context.onRendererFrame = observer;
    const pending = host.context.applyScene(host.scene, new AbortController().signal, () => host.events.push("presented"));
    await tick(); assert.throws(() => host.emit(), error => error === failure, "native frame observers retain their existing error behavior");
    await pending; assert.equal(host.events.at(-1), "presented", "a submitted native frame still acknowledges presentation when an observer throws");
    assert.equal(host.listener, observer); assert.equal(host.context.editorSceneApplicationActive, false);
    assert.equal(host.context.backendSelectElement.disabled, false);
  }
  for (const reason of ["abort", "renderer", "scene"]) {
    const host = nativeHost(), controller = new AbortController(); let presented = 0;
    const pending = host.context.applyScene(host.scene, controller.signal, () => presented++); await tick();
    if (reason === "abort") controller.abort();
    else { if (reason === "renderer") host.context.renderer = {}; else host.context.lastParsedScene = {}; host.emit(); }
    await assert.rejects(pending, { name: "AbortError" }); assert.equal(presented, 0); assert.equal(host.listener, host.parent);
    assert.equal(host.context.editorSceneApplicationActive, false); assert.equal(host.context.backendSelectElement.disabled, false);
  }
  {
    const host = nativeHost(); await host.context.applyScene(host.scene, new AbortController().signal);
    assert.equal(host.listenerChanges, 0, "native hosts retain their original non-acknowledged apply behavior");
  }

  function threeHost() {
    const events = [], waiters = [], previous = { position: {}, quaternion: {}, scale: {}, sourceKind: "hep", sourceLabel: "document" };
    const next = { position: { copy() {} }, quaternion: { copy() {} }, scale: { copy() {} }, dispose() { events.push("dispose"); } };
    const context = vm.createContext({ waitForEditorScenePresentation, waitForLoad, DOMException, viewerPrintAction: null, renderer: {}, currentPdfObject: previous, editedSource: null,
      editorSceneApplicationActive: false, backendChangeActive: false, backendChangeCompletion: Promise.resolve(),
      sourceLoadController: null, activeHepExportController: null, backendSelectElement: {}, activeThreeRendererBackend: "webgl",
      lastLoadedSource: {}, setStatus: message => events.push(message), formatBackendLabel: value => value,
      reloadSourceWithBackend: async () => events.push("switch"), ensureThreeRendererBackend: async () => events.push("switch"),
      captureCameraSnapshot: () => ({}), createThreePdfObject: async () => next, readThreeObjectOptions: () => ({}),
      preparePageLayoutReplacement: async () => null, activePageLayout: "grid", restoreCameraSnapshot() {}, updateSceneMetrics() {},
      reader: { invalidateThumbnails() {} }, requestRender: () => events.push("request"), pendingRenderedFrameResolvers: waiters,
      replacePdfObject(object) { context.currentPdfObject = object; events.push("install"); } });
    vm.runInContext(`${threeDisabled}\n${threeBackendChange}\n${threeMethod}`, context);
    return { context, events, next, waiters, render() { events.push("draw"); for (const notify of waiters.splice(0)) notify(); } };
  }
  {
    const host = threeHost(), pending = host.context.applyScene({}, new AbortController().signal, () => host.events.push("presented"));
    pending.then(() => host.events.push("resolved")); await new Promise(resolve => setImmediate(resolve));
    assert.equal(host.context.editorSceneApplicationActive, true); assert.equal(host.context.backendSelectElement.disabled, true);
    host.context.changeThreeRendererBackend("webgpu");
    assert.match(host.events.pop(), /Wait for the current document operation/);
    assert.deepEqual(host.events, ["install", "request"], "Three object installation does not acknowledge a frame");
    assert.equal(host.waiters.length, 1); host.render();
    assert.deepEqual(host.events, ["install", "request", "draw", "presented"]);
    await pending; assert.equal(host.events.at(-1), "resolved"); assert.equal(host.waiters.length, 0);
    assert.equal(host.context.editorSceneApplicationActive, false); assert.equal(host.context.backendSelectElement.disabled, false);
    host.context.changeThreeRendererBackend("webgpu"); await host.context.backendChangeCompletion;
    assert.equal(host.events.at(-1), "switch", "idle Edit mode permits Three backend changes");
  }
  for (const reason of ["abort", "object", "renderer"]) {
    const host = threeHost(), controller = new AbortController(); let presented = 0;
    const pending = host.context.applyScene({}, controller.signal, () => presented++); await new Promise(resolve => setImmediate(resolve));
    if (reason === "abort") controller.abort(); else { if (reason === "object") host.context.currentPdfObject = {}; else host.context.renderer = {}; host.render(); }
    await assert.rejects(pending, { name: "AbortError" }); assert.equal(presented, 0); assert.equal(host.waiters.length, 0);
    assert.equal(host.context.editorSceneApplicationActive, false); assert.equal(host.context.backendSelectElement.disabled, false);
  }
  {
    const host = threeHost(); await host.context.applyScene({}, new AbortController().signal);
    assert.equal(host.waiters.length, 0, "Three retains its existing non-acknowledged apply behavior");
  }
  for (const kind of ["native", "three"]) {
    const host = kind === "native" ? nativeHost() : threeHost(), switching = deferred(), controller = new AbortController();
    if (kind === "native") host.context.backendSwitcher.runWhenIdle = async action => { await switching.promise; return action(); };
    else host.context.backendChangeCompletion = switching.promise;
    const pending = host.context.applyScene(host.scene ?? {}, controller.signal, () => host.events.push("presented"));
    await tick(); assert.deepEqual(host.events, [], `${kind} waits for an existing backend replacement before preparing the editor scene`);
    assert.equal(host.context.backendSelectElement.disabled, true);
    switching.resolve(); await tick();
    if (kind === "native") host.emit(); else host.render();
    await pending; assert.equal(host.context.backendSelectElement.disabled, false);
  }
  for (const kind of ["native", "three"]) {
    const host = kind === "native" ? nativeHost() : threeHost(), switching = deferred(), controller = new AbortController();
    if (kind === "native") host.context.backendSwitcher.runWhenIdle = async action => { await switching.promise; return action(); };
    else host.context.backendChangeCompletion = switching.promise;
    const pending = host.context.applyScene(host.scene ?? {}, controller.signal, () => {});
    controller.abort(); await assert.rejects(pending, { name: "AbortError" });
    assert.equal(host.context.editorSceneApplicationActive, false, `${kind} cancellation releases its publication lock while a backend switch is pending`);
    switching.resolve(); await tick(); assert.deepEqual(host.events, [], "cancelled publications cannot install later");
    const failing = kind === "native" ? nativeHost() : threeHost();
    if (kind === "native") failing.context.renderer.setScene = () => { throw new Error("upload failed"); };
    else failing.context.createThreePdfObject = async () => { throw new Error("upload failed"); };
    await assert.rejects(failing.context.applyScene(failing.scene ?? {}, new AbortController().signal, () => {}), /upload failed/);
    assert.equal(failing.context.editorSceneApplicationActive, false); assert.equal(failing.context.backendSelectElement.disabled, false);
  }
  {
    const host = threeHost(), building = deferred(), controller = new AbortController();
    host.context.createThreePdfObject = async () => { await building.promise; return host.next; };
    const pending = host.context.applyScene({}, controller.signal, () => {}); await tick();
    host.context.changeThreeRendererBackend("webgpu"); assert.match(host.events.pop(), /Wait for the current document operation/);
    assert(!host.events.includes("switch"), "Three cannot replace the backend while an editor object is being prepared");
    building.resolve(); await tick(); host.render(); await pending;
    host.context.sourceLoadController = new AbortController();
    await host.context.applyScene({}, controller.signal);
    assert.equal(host.context.backendSelectElement.disabled, true, "publication cleanup preserves an unrelated load's disabled state");
  }
  {
    const controller = new AbortController(); controller.abort(); let subscribed = 0;
    await assert.rejects(waitForEditorScenePresentation({ signal: controller.signal, subscribe() { subscribed++; return () => {}; },
      isCurrent: () => true, onPresented() {} }), { name: "AbortError" }); assert.equal(subscribed, 0);
    let releases = 0;
    await waitForEditorScenePresentation({ signal: new AbortController().signal, isCurrent: () => true, onPresented() {},
      subscribe(notify) { notify(); return () => releases++; } });
    assert.equal(releases, 1, "synchronous frame subscriptions also release exactly once");
  }
  console.log("Editor presentation: native/Three draw acknowledgement, callback ordering, host identity guards, backend-change coordination, cancellation and transient listener cleanup passed.");
} finally { hooks.deregister(); }
