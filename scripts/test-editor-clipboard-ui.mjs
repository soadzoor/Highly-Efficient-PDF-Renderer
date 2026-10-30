import { editorUiTestContext } from "./lib/editorUiTestContext.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const source = (await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8")).replace(/^ {2}/gm, "");
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const calls = [], buttons = new Map(), selection = ["shape"], statuses = [], errors = [];
  let available = false;
  const context = editorUiTestContext({ AbortController, AbortSignal, DOMException,
    active: true, disposed: false, running: false, clipboardRunning: false, structuralRunning: false,
    cameraPan: { isPanning: () => false, cancel() {} },
    activeText: null, pointer: null, pendingPick: null, polygon: null, tool: "select", textRequest: 0,
    layerDialog: {}, operation: null, lifetime: new AbortController(),
    query(selector) { if (!buttons.has(selector)) buttons.set(selector, {}); return buttons.get(selector); },
    document: { getSelection: () => ({ isCollapsed: true }) },
    inputTarget: target => Boolean(target?.input), isSceneSettling: () => false,
    contextMenu: { close: () => calls.push("close") }, updatePointerCursor() {},
    host: { onBusyChange: busy => calls.push(["busy", busy]) },
    cancelPointerGesture: restore => calls.push(["cancel", restore]),
    setTool(tool) { context.tool = tool; calls.push(["tool", tool]); },
    commit(change) { change(); calls.push("commit"); },
    refreshScene: async (...args) => calls.push(["refresh", ...args]),
    setStatus: text => statuses.push(text), report: error => errors.push(error),
    save: async () => calls.push("save"), canOpenContextMenu: () => false,
    session: {
      getSelection: () => selection,
      getLayers: () => [{ id: "destination", name: "Destination" }], getActiveLayer: () => "destination", isObjectVisible: () => true,
      canPaste: () => available,
      async copySelection(options) { options.signal.throwIfAborted(); calls.push("copy"); available = true; return 1; },
      async cutSelection(options) { options.signal.throwIfAborted(); calls.push("cut"); available = true; selection.length = 0; return 1; },
      async duplicateSelection(options) { options.signal.throwIfAborted(); calls.push("duplicate"); selection.splice(0, selection.length, "duplicated"); return selection; },
      pasteSelection(options) { calls.push(["paste", options && Array.from(options.offset)]); selection.splice(0, selection.length, "pasted"); return selection; }
    }
  });
  for (const name of ["updateClipboardButtons", "canUseClipboard", "runClipboard", "keydown"])
    vm.runInContext(sourceFunction(source, name), context);
  function key(key, options = {}) {
    const event = { key, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false,
      target: { closest: () => null }, prevented: false, preventDefault() { this.prevented = true; }, ...options };
    context.keydown(event); return event;
  }
  return { context, calls, buttons, selection, statuses, errors, key, setAvailable: value => { available = value; } };
}

{
  const h = harness(); h.context.updateClipboardButtons();
  assert.equal(h.buttons.get('[data-action="copy"]').disabled, false);
  assert.equal(h.buttons.get('[data-action="paste"]').disabled, true);
  assert(h.key("c").prevented); await flush();
  assert(h.calls.includes("copy")); assert(!h.calls.some(call => Array.isArray(call) && call[0] === "refresh"), "copy does not replace the scene");
  assert.equal(h.context.running, false); assert.equal(h.buttons.get('[data-action="paste"]').disabled, false);
  assert.match(h.statuses.at(-1), /Select a layer and paste/);
  const selectionBefore = [...h.selection]; h.key("v", { ctrlKey: false, metaKey: true }); await flush();
  assert.deepEqual(h.calls.find(call => Array.isArray(call) && call[0] === "paste"), ["paste", undefined]);
  assert.deepEqual(selectionBefore, ["shape"]);
  h.key("V", { shiftKey: true }); await flush();
  assert.deepEqual(h.calls.filter(call => Array.isArray(call) && call[0] === "paste").at(-1), ["paste", [0, 0]], "Shift+paste preserves the copied position");
  assert.deepEqual(h.errors, []);
}
{
  const h = harness(); h.key("x"); await flush();
  assert(h.calls.includes("cut")); assert.equal(h.selection.length, 0);
  const refresh = h.calls.find(call => Array.isArray(call) && call[0] === "refresh");
  assert(refresh); assert.deepEqual(refresh.slice(2), [false, true], "cut waits for its committed replacement frame");
  assert.equal(h.context.running, false);
}
{
  const h = harness(); assert(h.key("d").prevented); await flush();
  assert(h.calls.includes("duplicate")); assert(!h.calls.includes("copy"));
  assert.equal(h.context.session.canPaste(), false, "duplicate never overwrites the user's clipboard");
  assert.match(h.statuses.at(-1), /Duplicated 1 object/);
  assert(h.calls.some(call => Array.isArray(call) && call[0] === "refresh"));
}
for (const patch of [{ active: false }, { disposed: true }, { activeText: {} }, { pointer: {} }, { pendingPick: {} },
  { polygon: {} }, { running: true }, { structuralRunning: true }, { isSceneSettling: () => true }]) {
  const h = harness(); Object.assign(h.context, patch);
  await h.context.runClipboard("copy"); assert(!h.calls.includes("copy"));
}
for (const options of [{ defaultPrevented: true }, { isComposing: true }, { keyCode: 229 }, { altKey: true },
  { target: { input: true, closest: () => null } }, { target: { closest: () => ({}) } }]) {
  const h = harness(); const event = h.key("c", options); await flush();
  assert(!event.prevented); assert(!h.calls.includes("copy"), "typing, IME, dialogs and Alt retain native clipboard behavior");
}
{
  const h = harness(); h.context.document.getSelection = () => ({ isCollapsed: false });
  assert(!h.key("c").prevented); await flush(); assert(!h.calls.includes("copy"), "selected DOM text retains normal copying");
}
{
  const h = harness(); h.setAvailable(true);
  const event = h.key("v", { target: { closest: () => h.context.layerDialog } }); await flush();
  assert(event.prevented); assert(h.calls.some(call => Array.isArray(call) && call[0] === "paste"), "a selected layer row can paste in the custom host's layer dialog");
}
{
  const h = harness(); h.setAvailable(true); h.context.tool = "rectangle";
  await h.context.runClipboard("paste"); assert.equal(h.context.tool, "select");
  assert(h.calls.indexOf("commit") > h.calls.findIndex(call => Array.isArray(call) && call[0] === "tool"));
}
{
  const h = harness(); h.setAvailable(true); h.context.session.isObjectVisible = () => false;
  await h.context.runClipboard("paste");
  assert.match(h.statuses.at(-1), /Destination.*hidden by their layer/);
}
{
  const h = harness(), pending = deferred();
  h.context.session.copySelection = ({ signal }) => { signal.addEventListener("abort", () => pending.reject(new DOMException("Cancelled", "AbortError")), { once: true }); return pending.promise; };
  const operation = h.context.runClipboard("copy");
  assert(h.context.running && h.context.clipboardRunning);
  assert(h.key("s").prevented); assert(!h.calls.includes("save"), "busy clipboard preparation cannot start a save or mutation");
  h.key("Escape"); await operation;
  assert.equal(h.context.running, false); assert.equal(h.context.clipboardRunning, false);
  assert.equal(h.context.operation, null); assert.match(h.statuses.at(-1), /cancelled/);
}
{
  const h = harness(); h.context.session.copySelection = async () => { throw new Error("Capture failed"); };
  await h.context.runClipboard("copy");
  assert.equal(h.errors[0].message, "Capture failed"); assert.equal(h.context.running, false);
  assert.equal(h.buttons.get('[data-action="cancel-operation"]').hidden, true);
}
console.log("Editor clipboard UI: shortcuts, target-layer focus, IME/text guards, busy capture, cancellation, frame handoff and paste-in-place passed.");
