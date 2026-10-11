import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createEmptyVectorScene } from "../src/emptyVectorScene.ts";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
    !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
const originalGlobals = Object.fromEntries(["window", "document", "navigator"]
  .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const settle = () => new Promise(resolve => setImmediate(resolve));

class Control {
  listeners = new Map();
  checked = false;
  value = "";
  hidden = true;
  textContent = "";
  focused = false;
  selected = false;
  selection = null;
  addEventListener(type, listener, options = {}) {
    if (options.signal?.aborted) return;
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    options.signal?.addEventListener("abort", () => this.listeners.get(type)?.delete(listener), { once: true });
  }
  dispatch(type, fields = {}) { for (const listener of this.listeners.get(type) ?? []) listener({ type, ...fields }); }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  setSelectionRange(start, end) { this.selection = [start, end]; }
}

function fixture({ saved = new Map(), search = "", storageDenied = false } = {}) {
  let writes = 0;
  const controls = Object.fromEntries(["load-diagnostics-enabled", "show-load-report", "copy-load-report",
    "load-diagnostics-report", "load-diagnostics-status"].map(id => [id, new Control()]));
  const storage = { getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => { writes++; saved.set(key, value); } };
  const window = Object.assign(new Control(), { location: { search }, devicePixelRatio: 3 });
  Object.defineProperty(window, "sessionStorage", { get() {
    if (storageDenied) throw new Error("Storage disabled");
    return storage;
  } });
  const document = { querySelector: selector => controls[selector.slice(1)] };
  const navigator = { userAgent: "fake iPhone browser", hardwareConcurrency: 6 };
  for (const [key, value] of Object.entries({ window, document, navigator })) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  return { controls, storage, saved, window, navigator, get writes() { return writes; } };
}

try {
  const { createThreeExampleLoadDiagnostics } = await import("../src/threeExampleLoadDiagnostics.ts");
  const signal = new AbortController();
  const ui = fixture();
  let viewerState = { documentLoaded: false };
  const diagnostics = createThreeExampleLoadDiagnostics(signal.signal, () => viewerState);
  assert.deepEqual(diagnostics.report().capture, {
    uiVersion: 2, enabled: false, requestedByUrl: false, beginCalls: 0, lastBeginEnabled: null,
    activeLoadToken: null, loadInProgress: false, recording: false, disposed: false
  });
  ui.controls["show-load-report"].dispatch("click");
  assert.match(ui.controls["load-diagnostics-status"].textContent, /No load checkpoints/);
  let emptyCopied;
  ui.navigator.clipboard = { writeText: text => { emptyCopied = text; return Promise.resolve(); } };
  ui.controls["copy-load-report"].dispatch("click");
  await settle();
  assert.match(ui.controls["load-diagnostics-status"].textContent, /Recorder state copied/);
  assert.equal(JSON.parse(emptyCopied).capture.beginCalls, 0);
  delete ui.navigator.clipboard;
  let sceneReads = 0, traversals = 0, rendererReads = 0;
  const scene = createEmptyVectorScene();
  const object = {
    get sceneData() { sceneReads++; return scene; },
    get children() { traversals++; return []; }
  };
  const renderer = { get info() { rendererReads++; return { memory: { geometries: 4, textures: 2 }, programs: [1] }; } };
  diagnostics.begin(10, { backend: "three-webgl" });
  diagnostics.checkpoint(10, "compile", object, renderer);
  diagnostics.progress(10, { stage: "upload", value: 1 });
  diagnostics.finish(10, "complete");
  ui.window.dispatch("error", { message: "unrelated error" });
  assert.equal(sceneReads, 0, "disabled diagnostics never inspect the document");
  assert.equal(traversals, 0, "disabled diagnostics never traverse Three objects");
  assert.equal(rendererReads, 0, "disabled diagnostics never inspect renderer statistics");
  assert.equal(ui.writes, 0, "disabled diagnostics never persist checkpoints");
  assert.equal(diagnostics.report().current, null);
  assert.equal(diagnostics.report().capture.beginCalls, 1);
  assert.equal(diagnostics.report().capture.lastBeginEnabled, false);
  assert.equal(diagnostics.report().capture.loadInProgress, false);

  ui.controls["load-diagnostics-enabled"].checked = true;
  ui.controls["load-diagnostics-enabled"].dispatch("change");
  assert.equal(ui.writes, 0, "arming diagnostics waits until the next document load");
  diagnostics.begin(11, { backend: "three-webgl", document: "WarAndPeace.hep" });
  assert.equal(diagnostics.report().capture.recording, true);
  assert.equal(diagnostics.report().capture.lastBeginEnabled, true);
  assert.equal(JSON.parse(diagnostics.json()).capture.beginCalls, 2, "console JSON includes the same recorder state as the copy button");
  viewerState = { documentLoaded: true };
  assert.equal(diagnostics.report().viewer.documentLoaded, true, "viewer state is sampled when reporting instead of retained at setup");
  assert.equal(diagnostics.report().current.context.browser, "fake iPhone browser");
  assert.equal(diagnostics.report().current.context.dpr, 3);
  diagnostics.checkpoint(11, "shader-compile", object, renderer);
  let report = diagnostics.report();
  assert.equal(traversals, 1);
  assert(sceneReads > 0 && rendererReads > 0);
  assert.equal(report.current.events.at(-2).phase, "shader-compile",
    "the phase is recorded before collecting its resource snapshot");
  assert.equal(report.current.events.at(-1).details.scene.pages, 0);
  assert.equal(report.current.events.at(-1).details.resources.objectNodes, 1);
  assert.deepEqual(report.current.events.at(-1).details.three, { geometries: 4, textures: 2, programs: 1 });
  assert.equal(report.current.events.at(-1).details.jsHeap, null, "missing Safari heap telemetry is reported as unavailable");
  const readsBeforeStale = [sceneReads, traversals, rendererReads, ui.writes];
  diagnostics.checkpoint(10, "old-source", object, renderer);
  diagnostics.progress(10, { stage: "complete", value: 1 });
  diagnostics.finish(10, "failed", "old source failed");
  assert.deepEqual([sceneReads, traversals, rendererReads, ui.writes], readsBeforeStale,
    "stale tokens cannot scan resources, write checkpoints, or finish a newer load");

  const canvas = new Control();
  diagnostics.monitorRenderer(renderer, canvas);
  canvas.dispatch("webglcontextlost", { statusMessage: "GPU reset" });
  assert.equal(diagnostics.report().current.events.at(-1).phase, "webgl-context-lost");
  assert.equal(diagnostics.report().current.events.at(-1).details.message, "GPU reset");
  canvas.dispatch("webglcontextrestored");
  assert.equal(diagnostics.report().current.events.at(-1).phase, "webgl-context-restored");
  let loseDevice;
  diagnostics.monitorRenderer({ info: { memory: { geometries: 0, textures: 0 } },
    backend: { device: { lost: new Promise(resolve => { loseDevice = resolve; }) } } }, new Control());
  loseDevice({ reason: "unknown", message: "device lost" });
  await settle();
  assert.equal(diagnostics.report().current.events.at(-1).phase, "webgpu-device-lost");
  const beforeDestroyed = ui.writes;
  diagnostics.monitorRenderer({ info: { memory: { geometries: 0, textures: 0 } },
    backend: { device: { lost: Promise.resolve({ reason: "destroyed", message: "renderer disposed" }) } } }, new Control());
  await settle();
  assert.equal(ui.writes, beforeDestroyed, "normal WebGPU renderer disposal is not reported as device failure");
  ui.window.dispatch("unhandledrejection", { reason: new Error("shader rejected") });
  assert.equal(diagnostics.report().current.events.at(-1).details.message, "shader rejected");

  diagnostics.checkpoint(11, "snapshot-failure", { get sceneData() { throw new Error("snapshot unavailable"); } });
  report = diagnostics.report();
  assert.equal(report.current.events.at(-2).phase, "snapshot-failure");
  assert.equal(report.current.events.at(-1).phase, "snapshot-failure:snapshot-error");
  assert.match(report.current.events.at(-1).details.message, /snapshot unavailable/);

  ui.controls["copy-load-report"].dispatch("click");
  const output = ui.controls["load-diagnostics-report"];
  assert.equal(output.hidden, false);
  assert.equal(output.focused, true);
  assert.equal(output.selected, true);
  assert.deepEqual(output.selection, [0, output.value.length], "a missing clipboard API selects the full report for manual copying");
  assert.equal(JSON.parse(output.value).current.context.document, "WarAndPeace.hep");
  output.focused = output.selected = false;
  ui.navigator.clipboard = { writeText: () => Promise.reject(new Error("clipboard denied")) };
  ui.controls["copy-load-report"].dispatch("click");
  await settle();
  assert.equal(output.selected, true, "clipboard denial also offers manual copy");
  output.selected = false;
  ui.navigator.clipboard = { writeText() { throw new Error("clipboard unavailable"); } };
  assert.doesNotThrow(() => ui.controls["copy-load-report"].dispatch("click"));
  assert.equal(output.selected, true, "synchronous clipboard errors also offer manual copy");
  let copied;
  ui.navigator.clipboard = { writeText: text => { copied = text; return Promise.resolve(); } };
  ui.controls["copy-load-report"].dispatch("click");
  assert.equal(copied, output.value, "the clipboard call occurs synchronously inside the tap handler");
  await settle();
  assert.match(ui.controls["load-diagnostics-status"].textContent, /copied/);

  const recoveredUi = fixture({ saved: ui.saved });
  const recoveredSignal = new AbortController();
  const recovered = createThreeExampleLoadDiagnostics(recoveredSignal.signal);
  assert.equal(recoveredUi.controls["load-diagnostics-enabled"].checked, false);
  assert.equal(recoveredUi.writes, 0);
  assert.equal(recovered.report().current, null);
  assert.equal(recovered.report().previous.interrupted, true);
  assert.match(recoveredUi.controls["load-diagnostics-status"].textContent, /recovered/);
  recoveredUi.controls["show-load-report"].dispatch("click");
  assert.equal(JSON.parse(recoveredUi.controls["load-diagnostics-report"].value).previous.context.document, "WarAndPeace.hep",
    "a recovered failed-to-finish attempt can be shown before recording another document");
  recoveredUi.controls["load-diagnostics-enabled"].checked = true;
  recoveredUi.controls["load-diagnostics-enabled"].dispatch("change");
  recovered.begin(12, { backend: "three-webgpu" });
  assert.equal(recovered.report().previous.interrupted, true, "retrying preserves the recovered attempt");
  recoveredUi.controls["load-diagnostics-enabled"].checked = false;
  recoveredUi.controls["load-diagnostics-enabled"].dispatch("change");
  assert.equal(recovered.report().current.status, "cancelled");
  const beforeDisable = [sceneReads, traversals, rendererReads, recoveredUi.writes];
  recovered.checkpoint(12, "disabled-mid-load", object, renderer);
  recoveredUi.window.dispatch("error", { message: "after disable" });
  assert.deepEqual([sceneReads, traversals, rendererReads, recoveredUi.writes], beforeDisable,
    "disabling mid-load stops snapshot work and error capture");

  const deniedUi = fixture({ storageDenied: true, search: "?loadDiagnostics=1" });
  const deniedSignal = new AbortController();
  const denied = createThreeExampleLoadDiagnostics(deniedSignal.signal);
  assert.equal(deniedUi.controls["load-diagnostics-enabled"].checked, true, "the URL flag arms capture before loading");
  assert.equal(denied.report().capture.enabled, true);
  assert.equal(denied.report().capture.requestedByUrl, true);
  assert.equal(denied.report().capture.beginCalls, 0, "an enabled recorder without a load-hook call is distinguishable from disabled recording");
  assert.equal(denied.report().current, null);
  denied.begin(13, { backend: "three-webgl" });
  denied.finish(13, "complete");
  assert.equal(denied.report().capture.recording, false);
  assert.equal(denied.report().capture.loadInProgress, false);
  assert.equal(denied.report().current.status, "complete");
  assert.equal(denied.report().storage.available, false);
  assert.match(deniedUi.controls["load-diagnostics-status"].textContent, /recovery is unavailable/);
  deniedUi.window.dispatch("error", { message: "late driver failure" });
  assert.equal(denied.report().current.status, "complete");
  assert.equal(denied.report().current.events.at(-1).phase, "window-error",
    "a driver error after the first submit remains available without changing load status");

  const beforeAbort = [sceneReads, traversals, rendererReads, deniedUi.writes];
  deniedSignal.abort();
  denied.begin(14, { backend: "three-webgpu" });
  denied.checkpoint(13, "after-teardown", object, renderer);
  deniedUi.window.dispatch("error", { message: "after teardown" });
  assert.deepEqual([sceneReads, traversals, rendererReads, deniedUi.writes], beforeAbort,
    "teardown prevents late load callbacks from scanning or writing diagnostics");

  signal.abort(); recoveredSignal.abort(); deniedSignal.abort();
  console.log("Three load diagnostics UI: opt-in resource scans, next-load arming, stale tokens, context/device loss, clipboard fallback, reload recovery and unavailable storage passed.");
} finally {
  hooks.deregister();
  for (const [key, descriptor] of Object.entries(originalGlobals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
