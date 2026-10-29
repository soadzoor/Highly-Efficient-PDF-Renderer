import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const source = (await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8")).replace(/^ {2}/gm, "");
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const identity = [1, 0, 0, 1, 0, 0], translation = x => [1, 0, 0, 1, x, 0];
const frame = x => ({ bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 }, transform: translation(x), pageIndex: 0 });

function harness() {
  const preparations = [], applications = [], draws = [], errors = [], raf = new Map();
  let state = { revision: 0, dirty: false, selection: ["object"], previewing: false }, canonicalFrame = frame(0), rafId = 0;
  let activeApplications = 0, maximumApplications = 0, displayedScene = null, picks = 0;
  const initialSource = { name: "source" };
  const context = vm.createContext({ AbortController, AbortSignal, Set, active: true, disposed: false, running: false, structuralRunning: false,
    pendingDrawings: { capture() {}, acknowledge() {} },
    currentState: state, presented: null, requestedPreview: null, scenePreparation: null, sceneApplication: null,
    renderRevision: 0, latestScene: initialSource, lifetime: new AbortController(), pointer: null, pendingPick: null, picking: null,
    polygon: null, activeText: null, textRequest: 0, tool: "select", previewGeneration: 0, previewQueued: false, previewRunning: false, previewPending: false,
    queueMicrotask,
    overlay: { dataset: {}, style: {}, setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false },
    window: { requestAnimationFrame(callback) { const id = ++rafId; raf.set(id, callback); return id; }, cancelAnimationFrame: id => raf.delete(id) },
    synchronizeDocumentSource: async () => {}, report: error => { if (error.name !== "AbortError") errors.push(error); },
    session: { sourceScene: initialSource, getState: () => ({ ...state, selection: [...state.selection] }),
      getSelectionFrame: () => canonicalFrame, getSelectionBounds: () => canonicalFrame.bounds,
      getObject: id => ({ id, kind: "text" }),
      getScene(options) {
        const result = deferred(), delta = options.preview && state.previewing ? context.requestedPreview : null;
        const scene = { id: preparations.length, revision: state.revision, sourceScene: context.session.sourceScene,
          frame: canonicalFrame, delta, preview: options.preview };
        preparations.push({ ...result, options, scene }); return result.promise;
      } },
    host: { clientToScenePoint: (x, y) => ({ x, y }), applyScene(scene, signal, onPresented, options) {
      signal.throwIfAborted(); const result = deferred(); activeApplications++; maximumApplications = Math.max(maximumApplications, activeApplications);
      let finished = false;
      applications.push({ scene, signal, onPresented, options,
        acknowledge() { displayedScene = scene; onPresented(); },
        finish() { assert(!finished); finished = true; activeApplications--; displayedScene = scene; result.resolve(); },
        fail(error) { assert(!finished); finished = true; activeApplications--; result.reject(error); } });
      return result.promise;
    } },
    updateGeometry() { draws.push({ displayed: displayedScene, selection: context.displayedSelection(), presented: context.presented }); },
    interaction: { cancelTransform() { state = { ...state, previewing: false }; context.currentState = state; } },
    pick: async () => { picks++; return "object"; }, startText: async () => {}
  });
  for (const name of ["displayedSelection", "isSceneSettling", "updatePointerCursor", "refreshScene", "runPreview", "queuePreview", "clearPreview", "cancelPointerGesture", "updateShapeGesture", "pointerDown", "doubleClick"])
    vm.runInContext(sourceFunction(source, name), context);
  return { context, preparations, applications, draws, errors, raf,
    preview(x) { state = { ...state, previewing: true }; context.currentState = state; context.requestedPreview = translation(x); },
    canonical(x, revision = state.revision) { canonicalFrame = frame(x); state = { ...state, revision, previewing: false }; context.currentState = state; context.requestedPreview = null; },
    select(ids, x) { canonicalFrame = frame(x); state = { ...state, selection: ids }; context.currentState = state; },
    runRaf() { const entry = raf.entries().next().value; assert(entry, "one requested animation frame"); raf.delete(entry[0]); entry[1](); },
    resolve(index) { const job = preparations[index]; job.resolve(job.scene); },
    assertDrawMatchesScene() {
      for (const draw of draws) if (draw.presented) {
        assert.equal(draw.presented.frame, draw.displayed.frame); assert.equal(draw.presented.delta, draw.displayed.delta);
        assert.equal(draw.presented.sourceScene, draw.displayed.sourceScene); assert.equal(draw.presented.revision, draw.displayed.revision);
      }
    },
    get maximumApplications() { return maximumApplications; }, get picks() { return picks; }
  };
}

// Slow compilation and publication never let the frame race ahead to pointer
// poses that have not been submitted. Pending moves coalesce to the latest.
{
  const h = harness(), c = h.context;
  c.pointer = { id: 1, action: "move", frame: c.session.getSelectionFrame() };
  h.preview(10); c.queuePreview(); await tick();
  assert.equal(h.preparations.length, 1); assert.equal(h.preparations[0].scene.delta[4], 10);
  h.preview(20); c.queuePreview(); h.preview(30); c.queuePreview();
  assert.equal(h.raf.size, 0); assert.equal(c.displayedSelection().delta, undefined, "raw moves do not advance the displayed frame during compilation");
  h.resolve(0); await tick(); assert.equal(h.applications.length, 1);
  assert.equal(c.presented, null, "host installation does not count as an acknowledged draw");
  h.applications[0].acknowledge(); assert.equal(c.presented.delta[4], 10); assert.equal(c.latestScene, h.preparations[0].scene);
  assert.equal(c.displayedSelection().delta[4], 10); h.applications[0].finish(); await tick();
  assert.equal(h.raf.size, 0, "the latest pending preview starts without another animation-frame delay");
  assert.equal(h.preparations.length, 2); assert.equal(h.preparations[1].scene.delta[4], 30);
  h.resolve(1); await tick(); h.applications[1].acknowledge(); h.applications[1].finish(); await tick();
  assert.equal(c.presented.delta[4], 30); assert.equal(h.raf.size, 0); assert.equal(c.previewRunning, false);
  assert.equal(h.maximumApplications, 1); h.assertDrawMatchesScene();
}

// A superseded preparation is never submitted, even if its worker ignores
// cancellation and resolves after the newer request.
{
  const h = harness(), c = h.context;
  h.preview(10); const old = c.refreshScene(undefined, true); await tick();
  h.preview(20); const newer = c.refreshScene(undefined, true); await tick();
  assert.equal(h.preparations[0].options.signal.aborted, true);
  h.resolve(0); await old; assert.equal(h.applications.length, 0);
  h.resolve(1); await tick(); h.applications[0].acknowledge(); h.applications[0].finish(); await newer;
  assert.equal(c.presented.delta[4], 20); assert.equal(h.applications.length, 1); h.assertDrawMatchesScene();
}

// Started applications finish serially. Releasing the gesture keeps the last
// real pose until the committed replacement is drawn, with no anchor jumping.
{
  const h = harness(), c = h.context;
  c.pointer = { id: 1, action: "move" }; h.preview(10);
  const preview = c.refreshScene(undefined, true); await tick(); h.resolve(0); await tick();
  c.pointer = null; h.canonical(30, 1); const committed = c.refreshScene(); await tick(); h.resolve(1); await tick();
  assert.equal(h.applications.length, 1); assert.equal(h.applications[0].signal.aborted, false, "release does not abort an already-started application");
  const event = { button: 0, pointerId: 2, clientX: 50, clientY: 25, target: { closest: () => null,
    getAttribute: name => name === "data-selection-move" ? "true" : null }, preventDefault() {}, stopPropagation() {} };
  assert.equal(c.isSceneSettling(), true); await c.pointerDown(event); await c.doubleClick(event);
  assert.equal(c.pointer, null); assert.equal(h.picks, 0, "new gestures wait for the canonical pose to be shown");
  h.applications[0].acknowledge(); assert.equal(c.displayedSelection().delta[4], 10, "release holds the acknowledged preview instead of jumping to committed bounds");
  h.applications[0].finish(); await preview; await tick(); assert.equal(h.applications.length, 2);
  assert.equal(h.applications[1].options.preview, false, "committed publications are distinguished from transient transforms");
  assert.equal(c.presented.delta[4], 10); h.applications[1].acknowledge();
  assert.equal(c.presented.delta, null); assert.equal(c.presented.frame.transform[4], 30); assert.equal(c.isSceneSettling(), true, "the host application still owns its publication gate");
  h.applications[1].finish(); await committed; assert.equal(c.isSceneSettling(), false);
  const latest = c.latestScene; h.applications[0].onPresented(); assert.equal(c.latestScene, latest, "an older repeated acknowledgement cannot publish after a newer application");
  await c.pointerDown(event); assert.equal(c.pointer.action, "move", "a new gesture is accepted after canonical acknowledgement");
  assert.equal(h.maximumApplications, 1); h.assertDrawMatchesScene();
}

// Cancellation holds the displayed preview until restoration is acknowledged;
// snapshot selection/source identities keep unrelated frames from flashing.
{
  const h = harness(), c = h.context;
  c.pointer = { id: 1, action: "move" }; h.preview(12);
  const first = c.refreshScene(undefined, true); await tick(); h.resolve(0); await tick();
  h.applications[0].acknowledge(); h.applications[0].finish(); await first;
  c.cancelPointerGesture(); await tick(); assert.equal(c.requestedPreview, null); assert.equal(c.displayedSelection().delta[4], 12);
  assert.equal(h.preparations[1].options.preview, false); assert.equal(c.isSceneSettling(), true);
  h.resolve(1); await tick(); h.applications[1].acknowledge(); h.applications[1].finish(); await tick();
  assert.equal(c.presented.delta, null); assert.equal(c.isSceneSettling(), false);
  h.select(["other"], 50); assert.equal(c.displayedSelection().frame.transform[4], 50, "selection-only changes on current canonical content stay immediate");
  h.preview(8); const pendingSelection = c.refreshScene(undefined, true); await tick(); h.resolve(2); await tick();
  h.applications[2].acknowledge(); h.applications[2].finish(); await pendingSelection;
  h.select(["third"], 60); assert.equal(c.displayedSelection().frame, null, "an old preview cannot supply another selection's frame");
  c.session.sourceScene = { name: "replacement source" }; h.canonical(80, 2);
  assert.equal(c.displayedSelection().frame, null, "old source coordinates are hidden until the new source is published");
  const replacement = c.refreshScene(); await tick(); h.resolve(3); await tick(); h.applications[3].acknowledge(); h.applications[3].finish(); await replacement;
  assert.equal(c.displayedSelection().frame.transform[4], 80);
}

// Preparation/application failures retain the last published pose. A legacy
// host may acknowledge by resolving; disposal prevents later UI publication.
{
  const h = harness(), c = h.context;
  const baseline = c.refreshScene(); await tick(); h.resolve(0); await tick(); h.applications[0].finish(); await baseline;
  const savedPresentation = c.presented, savedScene = c.latestScene;
  const failedPrepare = c.refreshScene(); await tick(); const compileError = new Error("Synthetic compile failure"); h.preparations[1].reject(compileError); await failedPrepare;
  assert.equal(c.presented, savedPresentation); assert.equal(c.latestScene, savedScene);
  const failedApply = c.refreshScene(); await tick(); h.resolve(2); await tick(); const applyError = new Error("Synthetic application failure"); h.applications[1].fail(applyError); await failedApply;
  assert.equal(c.presented, savedPresentation); assert.equal(c.sceneApplication, null); assert.deepEqual(h.errors, [compileError, applyError]);
  const abandoned = c.refreshScene(); await tick(); h.resolve(3); await tick(); const drawCount = h.draws.length;
  c.disposed = true; c.active = false; c.lifetime.abort(); h.applications[2].acknowledge(); h.applications[2].finish(); await abandoned;
  assert.equal(c.presented, savedPresentation); assert.equal(c.latestScene, savedScene); assert.equal(h.draws.length, drawCount);
  assert.equal(c.sceneApplication, null, "disposed applications still release the serialization gate");
}
// A zero-cost host can draw the first coalesced pose on the upcoming frame.
// The editor must not spend that frame merely scheduling another renderer RAF.
{
  const h = harness(), c = h.context, poses = [], options = [];
  let displayed, applications = 0, maximum = 0, compilations = 0;
  c.pointer = { id: 1, action: "move" };
  c.session.getScene = async input => { compilations++; return { delta: [...c.requestedPreview], preview: input.preview }; };
  c.updateGeometry = () => { if (c.presented) assert.equal(c.presented.delta[4], displayed.delta[4], "chrome follows the acknowledged pose"); };
  c.host.applyScene = (scene, signal, publish, input) => {
    options.push(input); applications++; maximum = Math.max(maximum, applications);
    return new Promise(resolve => c.window.requestAnimationFrame(() => {
      signal.throwIfAborted(); displayed = scene; poses.push(scene.delta[4]); publish(); applications--; resolve();
    }));
  };
  const drawFrame = async () => {
    const callbacks = [...h.raf.keys()];
    for (const id of callbacks) {
      const callback = h.raf.get(id); if (!callback) continue;
      h.raf.delete(id); callback(); await tick();
    }
  };
  h.preview(10); c.queuePreview(); h.preview(20); c.queuePreview();
  assert.equal(h.raf.size, 0, "input does not request a separate editor RAF"); await tick();
  assert.equal(compilations, 1, "synchronous input bursts coalesce before preparation"); assert.equal(h.raf.size, 1);
  await drawFrame(); assert.deepEqual(poses, [20], "the upcoming renderer frame presents the latest input");
  for (const pose of [30, 40, 50]) {
    h.preview(pose); c.queuePreview(); await tick(); await drawFrame();
  }
  assert.deepEqual(poses, [20, 30, 40, 50]); assert.equal(maximum, 1);
  assert(options.every(input => input.preview === true), "hosts can distinguish transient transform publications");
  assert.equal(c.previewRunning, false); assert.equal(c.previewQueued, false);
}

// Generation guards prevent cancelled microtasks from starting work, including
// an old callback that runs after a new gesture has already queued its kickoff.
for (const boundary of ["cancel", "view", "dispose"]) {
  const h = harness(), c = h.context; c.pointer = { id: 1, action: "move" };
  h.preview(10); c.queuePreview(); c.cancelPointerGesture(false);
  if (boundary === "view") c.active = false;
  if (boundary === "dispose") { c.disposed = true; c.lifetime.abort(); }
  await tick(); assert.equal(h.preparations.length, 0, `${boundary}: stale kickoff cannot compile or publish`);
  assert.equal(c.previewQueued, false); assert.equal(h.raf.size, 0);
}
{
  const h = harness(), c = h.context; c.pointer = { id: 1, action: "move" };
  h.preview(10); c.queuePreview(); c.cancelPointerGesture(false);
  c.pointer = { id: 2, action: "move" }; h.preview(20); c.queuePreview(); await tick();
  assert.equal(h.preparations.length, 1); assert.equal(h.preparations[0].scene.delta[4], 20);
  c.cancelPointerGesture(false); h.resolve(0); await tick();
}

// Modifier changes still schedule a new snapped/free rotation pose while the
// pointer remains stationary; they use the same coalescing and ACK boundary.
{
  const h = harness(), c = h.context;
  c.pointer = { id: 1, action: "rotate", bounds: frame(0).bounds, last: { x: 10, y: 20 } };
  c.dragMatrix = gesture => translation(gesture.freeRotation ? 13 : 45);
  c.interaction.previewTransform = matrix => h.preview(matrix[4]);
  vm.runInContext(sourceFunction(source, "transformModifiers"), c);
  c.transformModifiers({ key: "Alt", altKey: true, shiftKey: false, isComposing: false }); await tick();
  assert.equal(h.preparations[0].scene.delta[4], 13);
  c.transformModifiers({ key: "Alt", altKey: false, shiftKey: false, isComposing: false });
  h.resolve(0); await tick(); h.applications[0].acknowledge(); h.applications[0].finish(); await tick();
  assert.equal(h.preparations[1].scene.delta[4], 45, "releasing Alt updates the queued pose without pointer movement");
  h.resolve(1); await tick(); h.applications[1].acknowledge(); h.applications[1].finish(); await tick();
  assert.equal(c.presented.delta[4], 45);
}

// Preview notifications do not change committed dimensions or toolbar state.
// Cancellation and actual state/source/selection changes still refresh them.
{
  const initial = { revision: 2, dirty: true, canUndo: true, canRedo: false, selection: ["object"], previewing: false };
  const scene = {}, nodes = new Map(), counts = { bounds: 0, frames: 0, queries: 0, opacity: 0, mode: 0, reconcile: 0, cursors: 0 }, statuses = [];
  const c = vm.createContext({ currentState: initial, currentSourceScene: scene, active: true, running: false, document: { activeElement: null },
    contextMenu: { close() {} }, pendingDrawings: { reconcile() { counts.reconcile++; } },
    updatePointerCursor() { counts.cursors++; }, setStatus: value => statuses.push(value), hasUnsavedChanges: () => true,
    query(selector) { counts.queries++; if (!nodes.has(selector)) nodes.set(selector, {}); return nodes.get(selector); },
    editorFrameSize: () => ({ width: 100, height: 50 }), updateRotationValue() {}, updateOpacityControls() { counts.opacity++; },
    session: { sourceScene: scene, getSelectionBounds() { counts.bounds++; return frame(0).bounds; }, getSelectionFrame() { counts.frames++; return frame(0); } },
    host: { onModeChange() { counts.mode++; } }
  });
  vm.runInContext(sourceFunction(source, "updateState"), c);
  const first = { ...initial, selection: [...initial.selection], previewing: true }; c.updateState(first);
  assert.equal(c.currentState, first, "the first preview preserves current state identities for captured publications");
  for (let index = 0; index < 100; index++) c.updateState({ ...first, selection: [...first.selection] });
  assert.deepEqual(counts, { bounds: 0, frames: 0, queries: 0, opacity: 0, mode: 0, reconcile: 0, cursors: 101 });
  assert.deepEqual(statuses, ["Transform preview"]);
  c.updateState({ ...initial }); assert.equal(counts.bounds, 1); assert.equal(counts.frames, 1);
  assert.equal(counts.opacity, 1); assert.equal(counts.mode, 1, "cancellation restores committed controls");
  assert(counts.queries > 0);
  for (const change of [{ revision: 3 }, { selection: ["other"] }, { canRedo: true }, { dirty: false }]) {
    const before = counts.bounds; c.currentState = first; c.updateState({ ...first, ...change });
    assert.equal(counts.bounds, before + 1, "meaningful changes cannot take the preview-only shortcut");
  }
  c.currentState = first; c.session.sourceScene = {}; const before = counts.bounds;
  c.updateState({ ...first }); assert.equal(counts.bounds, before + 1, "source replacement refreshes controls even at the same revision");
}
console.log("Editor preview synchronization: frame-phase kickoff, lightweight state notifications, acknowledged frames, coalescing, cancellation, modifiers and serialized publication passed.");
