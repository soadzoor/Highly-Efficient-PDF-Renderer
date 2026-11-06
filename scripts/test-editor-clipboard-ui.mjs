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
    pasteTarget: client => ({ pageIndex: 1, center: client ? [client.x, client.y] : [50, 100] }),
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
      pasteSelection(options) { calls.push(["paste", options?.target ? { pageIndex: options.target.pageIndex, center: Array.from(options.target.center) }
        : options && Array.from(options.offset)]); selection.splice(0, selection.length, "pasted"); return selection; }
    }
  });
  for (const name of ["sharedClipboardChanged", "updateClipboardButtons", "canUseClipboard", "runClipboard", "clearObjectClipboardForText", "keydown"])
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
  assert.deepEqual(h.calls.find(call => Array.isArray(call) && call[0] === "paste"), ["paste", { pageIndex: 1, center: [50, 100] }]);
  assert.deepEqual(selectionBefore, ["shape"]);
  h.key("V", { shiftKey: true }); await flush();
  assert.deepEqual(h.calls.filter(call => Array.isArray(call) && call[0] === "paste").at(-1), ["paste", [0, 0]], "Shift+paste preserves the copied position");
  assert.deepEqual(h.errors, []);
}
{
  const h = harness(); h.setAvailable(true); h.context.pasteCursor = { x: 32, y: 76 };
  h.key("v"); await flush();
  assert.deepEqual(h.calls.find(call => Array.isArray(call) && call[0] === "paste"), ["paste", { pageIndex: 1, center: [32, 76] }]);
  await h.context.runClipboard("paste", false, null);
  assert.deepEqual(h.calls.filter(call => Array.isArray(call) && call[0] === "paste").at(-1), ["paste", { pageIndex: 1, center: [50, 100] }], "toolbar paste explicitly ignores the former canvas cursor");
  await h.context.runClipboard("paste", false, { x: 91, y: 37 });
  assert.deepEqual(h.calls.filter(call => Array.isArray(call) && call[0] === "paste").at(-1), ["paste", { pageIndex: 1, center: [91, 37] }], "context paste uses its original anchor");
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
  const h = harness();
  h.context.review.getTextSelection = () => ({ text: "Recognized scan text" });
  assert.equal(h.selection.length, 1, "a prior object selection can remain while selecting text");
  assert(!h.key("c").prevented, "selected canvas text must reach the browser's native copy command");
  await flush();
  assert(!h.calls.includes("copy"), "scene text copy must not overwrite the object clipboard");
  h.context.review.getTextSelection = () => null;
  assert(h.key("c").prevented, "object copy still applies after text selection is cleared");
  await flush();
  assert(h.calls.includes("copy"));
}
{
  const h = harness(); h.setAvailable(true);
  const event = h.key("v", { target: { closest: selector => selector === "dialog" ? h.context.layerDialog : null } }); await flush();
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
{
  const h = harness(), publications = [];
  h.context.session.exportClipboard = async ({ signal }) => { signal.throwIfAborted(); return Uint8Array.of(3, 4); };
  h.context.tabClipboard.publish = (bytes, startedAt) => { publications.push({ bytes: [...bytes], startedAt }); return "local-copy"; };
  await h.context.runClipboard("copy");
  assert.deepEqual(publications[0].bytes, [3, 4]); assert(Number.isSafeInteger(publications[0].startedAt));
  assert.equal(h.context.clipboardTransferId, "local-copy");
  await h.context.runClipboard("duplicate"); assert.equal(publications.length, 1, "Duplicate preserves the shared object clipboard");
}
{
  const h = harness(); h.context.session.exportClipboard = async () => { throw new Error("Cannot transfer font assets"); };
  await h.context.runClipboard("cut");
  assert.equal(h.selection.length, 0); assert.equal(h.context.session.canPaste(), true);
  assert(h.calls.some(call => Array.isArray(call) && call[0] === "refresh"), "a completed cut is presented even when cross-tab export fails");
  assert.equal(h.errors[0].message, "Cannot transfer font assets"); assert.equal(h.context.running, false);
}
{
  const h = harness(), imported = [], pending = deferred();
  const shared = { id: "other-pdf", bytes: Uint8Array.of(6, 7) };
  h.context.tabClipboard = { hasValue: () => true, getId: () => shared.id, get: () => shared };
  h.context.session.importClipboard = async (bytes, { signal }) => { imported.push([...bytes]); await pending.promise; signal.throwIfAborted(); h.setAvailable(true); return 1; };
  h.context.pasteCursor = { x: 32, y: 76 };
  h.context.sharedClipboardChanged(); assert.equal(h.buttons.get('[data-action="paste"]').disabled, false, "another PDF enables Paste in a fresh editor");
  assert.equal(h.context.session.canPaste(), false);
  const operation = h.context.runClipboard("paste");
  assert.equal(h.context.running, true); assert.equal(h.context.clipboardRunning, true);
  assert(!h.calls.some(call => Array.isArray(call) && call[0] === "paste"), "font/resource preparation finishes before inserting objects");
  h.context.pasteCursor = { x: 90, y: 90 }; pending.resolve(); await operation;
  assert.deepEqual(imported, [[6, 7]]);
  assert.deepEqual(h.calls.find(call => Array.isArray(call) && call[0] === "paste"), ["paste", { pageIndex: 1, center: [32, 76] }], "asynchronous import preserves the invoked cursor target");
  assert.equal(h.context.clipboardTransferId, "other-pdf"); assert.equal(h.context.running, false);
  await h.context.runClipboard("paste"); assert.equal(imported.length, 1, "repeat Paste retains destination-owned clipboard and offset history");
  assert.deepEqual(h.errors, []);
}
{
  const h = harness(), pending = deferred();
  h.context.tabClipboard = { hasValue: () => true, getId: () => "cancel-import", get: () => ({ id: "cancel-import", bytes: Uint8Array.of(1) }) };
  h.context.session.importClipboard = (_bytes, { signal }) => { signal.addEventListener("abort", () => pending.reject(new DOMException("Cancelled", "AbortError")), { once: true }); return pending.promise; };
  const operation = h.context.runClipboard("paste"); h.key("Escape"); await operation;
  assert(!h.calls.some(call => Array.isArray(call) && call[0] === "paste"));
  assert.equal(h.context.running, false); assert.equal(h.context.clipboardTransferId, null);
  assert.match(h.statuses.at(-1), /cancelled/);
}
{
  const h = harness(); h.setAvailable(true); h.context.clipboardTransferId = "old";
  let shared = true;
  h.context.session.clearClipboard = () => { h.setAvailable(false); h.calls.push("clear-local"); };
  h.context.tabClipboard = { hasValue: () => shared, get: () => null, clear() { shared = false; h.context.sharedClipboardChanged(); } };
  h.context.clearObjectClipboardForText({ target: { input: true } });
  assert.equal(h.context.session.canPaste(), false); assert.equal(h.context.clipboardTransferId, null);
  assert.equal(h.buttons.get('[data-action="paste"]').disabled, true, "native text copy clears stale local and shared objects");
  h.setAvailable(true); shared = true;
  h.context.clearObjectClipboardForText({ clipboardData: { types: ["text/plain"] } });
  assert.equal(h.context.session.canPaste(), false, "viewer page-text copy also invalidates old object copies");
}
console.log("Editor clipboard UI: shortcuts, target-layer focus, IME/text guards, busy capture, cancellation, frame handoff and paste-in-place passed.");
