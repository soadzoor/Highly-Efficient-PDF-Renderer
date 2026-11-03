import assert from "node:assert/strict";
import { createEditorLinkController } from "../src/editorLinkUi.ts";

class Target extends EventTarget {
  listeners = new Map();
  addEventListener(name, handler, options = {}) {
    if (options.signal?.aborted) return;
    const forwarded = { ...options }; delete forwarded.signal;
    super.addEventListener(name, handler, forwarded);
    const set = this.listeners.get(name) ?? new Set(); set.add(handler); this.listeners.set(name, set);
    options.signal?.addEventListener("abort", () => this.removeEventListener(name, handler, forwarded), { once: true });
  }
  removeEventListener(name, handler, options) { super.removeEventListener(name, handler, options); this.listeners.get(name)?.delete(handler); }
  get listenerCount() { return [...this.listeners.values()].reduce((n, set) => n + set.size, 0); }
  emit(name, values = {}) { const event = new Event(name, { cancelable: true }); for (const [key, value] of Object.entries(values)) Object.defineProperty(event, key, { value }); this.dispatchEvent(event); return event; }
}
class Node extends Target {
  children = []; attributes = new Map(); dataset = {}; style = {}; value = ""; hidden = false; disabled = false;
  constructor(tag, ownerDocument) { super(); this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument; }
  append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; } }
  setAttribute(name, value) { this.attributes.set(name, value); }
  focus() { this.ownerDocument.activeElement = this; }
  close() { this.open = false; }
  showModal() { this.open = true; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); }
  find(predicate) { return predicate(this) ? this : this.children.map(node => node.find?.(predicate)).find(Boolean); }
}
const window = new Target(), document = { defaultView: window, createElement: tag => new Node(tag, document) };
document.body = document.createElement("body");
const sourceA = { id: "a", kind: "shape", shape: "polygon", review: { type: "highlight", contents: "Heading" }, pageIndex: 0 },
  sourceB = { id: "b", kind: "shape", shape: "polygon", review: { type: "highlight", contents: "Second line" }, pageIndex: 1 },
  destination = { id: "target", kind: "text", text: "Referenced section", pageIndex: 2 };
const objects = new Map([sourceA, sourceB, destination].map(object => [object.id, object])), links = new Map(), locked = new Set();
let selection = ["a", "b"], fail = false, editable = true, transactions = 0, draftChanges = 0;
const picks = [], errors = [], statuses = [], scans = [];
const clone = value => value == null ? null : structuredClone(value);
const session = {
  getSelection: () => selection.slice(),
  getObjects(options) { scans.push(options); return [...objects.values()]; },
  getObject(id) { if (!objects.has(id)) throw new RangeError("Destination was deleted"); return clone(objects.get(id)); },
  isObjectLocked: id => locked.has(id),
  getObjectLink: id => clone(links.get(id)),
  setObjectLink(id, link) { if (fail && id === "b") throw new Error("Injected commit failure"); if (link === null) links.delete(id); else links.set(id, clone(link)); },
  transaction(_label, change) { const before = clone([...links]); try { change(); transactions++; } catch (error) { links.clear(); for (const entry of before) links.set(...entry); throw error; } }
};
window.open = () => { throw new Error("The link dialog must never open an external destination"); };
const controller = createEditorLinkController({ document, session, canEdit: () => editable, change: operation => operation(),
  onError: error => errors.push(error.message), onStatus: text => statuses.push(text), onDraftChange: () => draftChanges++, onPickingChange: value => picks.push(value) });
const dialog = () => document.body.children.at(-1), field = name => dialog().find(node => node.attributes.get("aria-label") === name),
  button = action => dialog().find(node => node.dataset.linkAction === action);
const change = (name, value) => { const node = field(name); node.value = value; node.emit(node.tagName === "SELECT" ? "change" : "input"); };
try {
  assert(!controller.canEditSelection()); assert(!controller.editSelection());
  controller.setActive(true); assert(controller.editSelection()); assert(controller.hasOpenDialog());
  assert(scans.every(options => options.includeSource === false), "known target listing never enumerates every source primitive");
  const objectChoices = field("Link destination object").children.map(node => node.value);
  assert(objectChoices.includes("target") && !objectChoices.includes("a") && !objectChoices.includes("b"));
  change("Link URL", "https://example.test/reference"); assert(controller.hasDraftChanges());
  fail = true; assert.equal(controller.flushDraft(), false); assert(dialog().open); assert.equal(links.size, 0, "a failed multi-source edit remains atomic");
  assert.equal(controller.getDraft().url, "https://example.test/reference"); assert.equal(transactions, 0);
  fail = false; assert(controller.flushDraft()); assert(!controller.isOpen());
  assert.equal(transactions, 1); assert.deepEqual(links.get("a"), { type: "url", url: "https://example.test/reference" }); assert.deepEqual(links.get("a"), links.get("b"));
  assert.deepEqual(selection, ["a", "b"]);
  assert(controller.canRemoveSelection()); assert(controller.removeSelection()); assert.equal(links.size, 0);

  assert(controller.editSelection()); change("Link destination type", "object"); button("pick").emit("click");
  assert(controller.isPicking() && controller.isBusy()); assert(!controller.hasOpenDialog()); assert.deepEqual(picks, [true]);
  assert.deepEqual(selection, ["a", "b"], "picking a target keeps the original source selection");
  assert.equal(controller.pickTarget("a"), false); assert(controller.isPicking());
  assert(controller.pickTarget("target")); assert(!controller.isPicking()); assert(controller.hasOpenDialog());
  assert.equal(field("Link destination object").value, "target"); assert(controller.flushDraft());
  assert.deepEqual(links.get("a"), { type: "object", objectId: "target" }); assert.deepEqual(picks, [true, false]);
  assert.equal(window.listenerCount, 0);

  assert(controller.editSelection()); button("pick").emit("click"); const escape = window.emit("keydown", { key: "Escape" });
  assert(escape.defaultPrevented); assert(!controller.isPicking()); assert(controller.hasOpenDialog()); assert.equal(window.listenerCount, 0);
  assert.equal(controller.getDraft().objectId, "target"); button("cancel").emit("click"); assert(!controller.isOpen());
  assert.deepEqual(links.get("a"), { type: "object", objectId: "target" }, "cancel leaves document links untouched");

  const imported = { type: "destination", destination: { sourcePageIndex: 2, fit: "XYZ", parameters: [12, 42, null] } };
  links.set("a", imported); links.set("b", clone(imported)); assert(controller.editSelection());
  assert.equal(field("Link destination type").value, "destination");
  const draft = controller.getDraft(); draft.ids[0] = "changed"; draft.destination.parameters[0] = 999;
  assert.equal(controller.getDraft().ids[0], "a"); assert.equal(controller.getDraft().destination.parameters[0], 12);
  assert(controller.flushDraft()); assert.deepEqual(links.get("a"), imported, "existing standard PDF destination is preserved rather than reset to an empty URL");
  assert(controller.editSelection()); change("Link destination type", "url"); change("Link URL", "https://example.test/draft");
  const pending = controller.getDraft(); controller.setActive(false); assert(!controller.isOpen());
  controller.setActive(true); controller.restoreDraft(pending); assert(controller.hasDraftChanges()); assert.equal(field("Link URL").value, pending.url);
  editable = false; assert.equal(controller.flushDraft(), false); assert(controller.hasOpenDialog(), "a temporarily unavailable document keeps the draft");
  editable = true; assert(controller.flushDraft());
  locked.add("b"); assert(!controller.canEditSelection()); assert(!controller.canRemoveSelection()); assert(!controller.editSelection()); locked.clear();
  assert(controller.editSelection()); change("Link destination type", "object"); button("pick").emit("click");
  const savedDraftChanges = draftChanges; controller.dispose(); assert(!controller.isPicking()); assert.equal(window.listenerCount, 0); assert(!document.body.children.length);
  controller.dispose(); assert.equal(draftChanges, savedDraftChanges + 1, "disposing an idle controller never schedules another draft write");
  assert(errors.some(text => text.includes("Injected"))); assert(errors.some(text => text.includes("different"))); assert(statuses.some(text => text.includes("Click the destination")));
  console.log("Link UI: multi-selection, atomic failures, source-preserving target picking, cancellation, destination reuse, drafts, locks and disposal passed.");
} finally { controller.dispose(); }
