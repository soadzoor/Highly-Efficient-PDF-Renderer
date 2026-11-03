import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { editorUiTestContext } from "./lib/editorUiTestContext.mjs";
const hooks = registerHooks({ resolve(s, c, n) { return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c); } });
class Element extends EventTarget {
  childNodes = []; textContent = ""; disabled = false; attributes = new Map();
  constructor(tag, document) { super(); this.tagName = tag; this.ownerDocument = document; }
  append(...children) { for (const child of children) { this.childNodes.push(child); child.parent = this; } }
  replaceChildren(...children) { this.childNodes = []; this.append(...children); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  querySelectorAll(tag) { return this.childNodes.flatMap(child => [...(child.tagName === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
  showModal() { this.open = true; } close() { this.open = false; }
  remove() { if (this.parent) this.parent.childNodes = this.parent.childNodes.filter(child => child !== this); }
  focus() { this.ownerDocument.activeElement = this; }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
try {
  const { showEditorRecoveryDialog } = await import("../src/editorRecoveryUi.ts");
  function harness(patch = {}) {
    const document = { createElement: tag => new Element(tag, document) }; document.body = new Element("body", document);
    const current = { key: "a", label: "<img src=x onerror=bad>", updatedAt: 10, protected: true, revision: 3 };
    let records = [current, { ...current, key: "b", label: "Other document", protected: false }];
    const calls = [], errors = [], busy = [], controller = {
      list: async () => records,
      async restore() { calls.push("restore"); },
      async discard(key) { calls.push(["discard", key]); records = records.filter(record => record.key !== key); }, ...patch
    };
    const widget = showEditorRecoveryDialog(document, { controller, currentKey: "a", offered: current, onRestored: async () => calls.push("shown"),
      onClose: () => calls.push("closed"), onError: error => errors.push(error), onBusyChange: value => busy.push(value) });
    return { document, widget, calls, errors, busy, dialog: document.body.childNodes[0] };
  }
  const buttons = h => h.dialog.querySelectorAll("button"), click = button => button.dispatchEvent(new Event("click"));
  {
    const h = harness(); await flush(); assert(h.dialog.open);
    assert.equal(buttons(h).filter(button => button.textContent === "Restore").length, 1, "only the matching source can restore");
    const label = h.dialog.querySelectorAll("span")[0]; assert(label.textContent.includes("<img src=x onerror=bad>"));
    assert.equal(h.dialog.querySelectorAll("img").length, 0, "stored labels are inert text");
    click(buttons(h).find(button => button.textContent === "Later")); assert.deepEqual(h.calls, ["closed"]); assert.equal(h.document.body.childNodes.length, 0);
  }
  {
    const h = harness(); await flush(); click(buttons(h).find(button => button.title?.includes("Other document"))); await flush();
    assert.deepEqual(h.calls[0], ["discard", "b"]);
    click(buttons(h).find(button => button.textContent === "Restore")); await flush();
    assert.deepEqual(h.calls.slice(1), ["restore", "shown", "closed"]); assert.deepEqual(h.errors, []); assert.deepEqual(h.busy, [true, false, true, false]);
  }
  {
    const h = harness({ async restore() { throw new Error("Password required"); } }); await flush();
    click(buttons(h).find(button => button.textContent === "Restore")); await flush();
    assert(h.dialog.open); assert.equal(h.errors[0].message, "Password required"); assert(buttons(h).every(button => !button.disabled)); h.widget.close();
  }
  {
    let finish; const gate = new Promise(resolve => { finish = resolve; });
    const h = harness({ restore: () => gate }); await flush(); click(buttons(h).find(button => button.textContent === "Restore"));
    const escape = new Event("cancel", { cancelable: true }); h.dialog.dispatchEvent(escape); assert(escape.defaultPrevented && h.dialog.open);
    h.widget.close(); finish(); await flush(); assert.deepEqual(h.calls, ["closed"], "closed recovery UI never publishes stale source/draft callbacks"); assert.deepEqual(h.busy, [true, false]);
  }

  // Exercise the real app integration without a browser or a renderer host.
  const source = (await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8")).replace(/^ {2}/gm, "");
  const noop = () => {};
  {
    let configuration, refreshed = false, textStarted = false;
    const oldControl = { dataset: { fieldId: "old" }, tagName: "INPUT", value: "old" }, currentControl = { dataset: { fieldId: "field" }, tagName: "INPUT", value: "baseline" };
    const fieldDrafts = new Map([[oldControl, "old"]]), events = [];
    const context = editorUiTestContext({ AbortController, source: { label: "Source", bytes: Uint8Array.of(1), pdf: Uint8Array.of(2) }, lifetime: new AbortController(),
      disposed: false, active: true, sourceScene: {}, currentSourceScene: {}, recoveryKey: "", pointer: null, pendingPick: null, structuralRunning: false, running: false,
      editorRecoveryDocumentKey: async ({ bytes }) => { assert.equal(bytes[0], 1); return "source-key"; },
      editorServices: { isSourceProtected: async () => true }, session: { getState: () => ({}) },
      createEditorRecovery: value => { configuration = value; return { probe: async () => undefined }; },
      query: () => ({}), fieldDrafts, editorFieldDraftSignature: control => control.value, activeText: null,
      readTextDraft: async () => null, report: error => { throw error; }, cancelPointerGesture: noop, cancelText: noop,
      refreshScene: async () => { await flush(); refreshed = true; fieldDrafts.clear(); }, updateFonts: () => events.push("fonts"),
      setTool: tool => events.push(tool), renderFields() { assert(refreshed, "recovery publishes the new source before rebuilding form controls"); fieldDrafts.set(currentControl, "baseline"); },
      updateFieldPaint: control => events.push(control.value),
      async startText(point, object) { assert(refreshed); textStarted = true; context.activeText = { baseline: {} }; }, updateState: noop,
      review: { getDraft: () => ({ contents: "draft" }), isSelecting: () => false, restoreDraft: value => events.push(value.contents) }
    });
    vm.runInContext(sourceFunction(source, "initializeRecovery"), context); await context.initializeRecovery();
    assert.equal(configuration.key, "source-key"); assert.equal(configuration.protected, true);
    await configuration.applyDraft({ fields: [{ id: "field", signature: "recovered value" }], text: { object: { kind: "text" }, objectId: "author:1", autoSize: { width: 72, height: 15 } }, comment: { contents: "Comment draft" } });
    assert.equal(currentControl.value, "recovered value"); assert.equal(oldControl.value, "old"); assert(textStarted);
    assert.equal(context.activeText.objectId, "author:1"); assert.equal(context.activeText.baseline.html, "");
    assert.deepEqual(JSON.parse(JSON.stringify(context.activeText.autoSize)), { width: 72, height: 15 }, "restoring a click-created draft retains automatic growth");
    const savedDraft = await configuration.getDraft();
    assert.deepEqual(JSON.parse(JSON.stringify(savedDraft.text.autoSize)), { width: 72, height: 15 }, "recovery checkpoints include the original minimum size");
    assert(events.indexOf("fonts") < events.indexOf("form")); assert(events.includes("Comment draft"));
    for (const autoSize of [undefined, { width: Infinity, height: 15 }, { width: 72, height: -1 }]) {
      await configuration.applyDraft({ text: { object: { kind: "text" }, autoSize } });
      assert.equal(context.activeText.autoSize, undefined, "older or invalid sizing metadata keeps the recovered box fixed");
    }
  }
  {
    let resolveProbe, shown = 0, modalOptions; const gate = new Promise(resolve => { resolveProbe = resolve; });
    const context = editorUiTestContext({ disposed: false, active: true, running: false, structuralRunning: false, recoveryKey: "source-key",
      recoveryOffered: true, recovery: { probe: () => gate, hasPendingDecision: () => true },
      showEditorRecoveryDialog(document, options) { shown++; modalOptions = options; return { close: () => options.onClose() }; },
      document: {}, toolbar: {}, overlay: {}, host: { onBusyChange: noop }, query: () => ({}), recoveryNotice: "", setStatus: noop, report: noop });
    vm.runInContext(sourceFunction(source, "openRecovery"), context);
    const first = context.openRecovery(), second = context.openRecovery(); await flush(); resolveProbe({ key: "source-key" }); await Promise.all([first, second]);
    assert.equal(shown, 1, "concurrent recovery requests cannot create duplicate modals");
    modalOptions.onBusyChange(true); assert(context.recoveryRunning && context.toolbar.inert && context.overlay.inert);
    modalOptions.onBusyChange(false); assert(!context.recoveryRunning && !context.toolbar.inert);
  }
  {
    const events = []; let configuration;
    const context = editorUiTestContext({ source: { label: "New PDF", bytes: Uint8Array.of(7), createdDocument: true, initialUnsaved: true, recoveryKey: "original-record-key", resumeRecovery: true },
      currentSourceScene: {}, recoveryKey: "", recoveryNotice: "", activeText: null, fieldDrafts: new Map(), pointer: null, pendingPick: null,
      editorRecoveryDocumentKey: async () => assert.fail("resuming a rematerialized snapshot must not hash its replacement bytes"),
      editorServices: { isSourceProtected: async () => false }, session: { getState: () => ({}) }, query: () => ({}),
      createEditorRecovery(value) { configuration = value; return { probe: async () => ({ key: "original-record-key" }), restore: async () => events.push("restore"), draftChanged: () => events.push("checkpoint") }; }, report: error => { throw error; } });
    vm.runInContext(sourceFunction(source, "initializeRecovery"), context); await context.initializeRecovery();
    assert.equal(configuration.key, "original-record-key"); assert(configuration.createdDocument); assert.deepEqual(events, ["restore", "checkpoint"]); assert.equal(context.recoveryOffered, false);
  }
  {
    const context = editorUiTestContext({ hasUnsavedChanges: () => true, window: { confirm: () => true }, setStatus() {} });
    vm.runInContext(sourceFunction(source, "confirmDocumentChange"), context);
    assert(context.confirmDocumentChange({ deferRecoveryDiscard: true })); assert.equal(context.discardRecovery, false, "preparation approval does not delete the retained document's draft");
    assert(context.confirmDocumentChange()); assert.equal(context.discardRecovery, true);
  }
  {
    const start = source.indexOf("  dispose(options = {}) {"), end = source.indexOf("\n  }\n};", start);
    assert(start >= 0 && end > start);
    const dispose = source.slice(start, end + 4).replace(/^  dispose/, "function dispose").replace(/\n  }$/, "\n}");
    for (const preserve of [true, false]) {
      const events = [];
      const context = editorUiTestContext({ recoveryKey: "target-key", discardRecovery: false, active: false, frame: 0,
        recovery: { async discard() { events.push("discard"); }, dispose() { events.push("dispose"); } },
        window: { cancelAnimationFrame() {} }, scenePreparation: null, operation: null, pendingFieldFocus: null,
        pendingDrawings: { clear() {} }, releaseFrameListener: null, passwordDialog: null, pagesDialog: null, pageNumberingDialog: null,
        pdfProtection: { dispose() {} }, contextMenu: { dispose() {} }, layerControls: { dispose() {} }, layerDialog: null,
        unsubscribe() {}, picker: null, interaction: { dispose() {} }, session: { dispose() {} }, editorServices: { dispose() {} },
        toolbar: { remove() {} }, overlay: { remove() {} }, fontFaces: new Map(), document: { body: { classList: { remove() {} } }, fonts: { delete() {} } }, host: { setEditing() {} }, cancelPointerGesture() {} });
      vm.runInContext(dispose, context); context.dispose({ discardRecovery: true, ...(preserve ? { preserveRecoveryKey: "target-key" } : {}) }); await flush();
      assert.deepEqual(events, preserve ? ["dispose"] : ["discard", "dispose"], "resuming the same record must preserve its data until the new editor restores it");
    }
  }
  console.log("Recovery UI: explicit restore/discard/later, key-preserving new-document resume, deferred discard and source eligibility passed.");
} finally { hooks.deregister(); }
