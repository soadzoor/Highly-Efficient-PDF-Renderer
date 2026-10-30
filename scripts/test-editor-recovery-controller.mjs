import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(s, c, n) { return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c); } });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
try {
  const { createEditorRecovery } = await import("../src/editorRecovery.ts");
  const { createEditorRecoveryCodec } = await import("../src/editorRecoveryCodec.ts");
  const records = new Map(), puts = [], errors = [], statuses = [], listeners = new Set();
  let revision = 0, preview = false, dirty = false, interacting = false, draft = { text: "draft-0" }, captureGate, captures = 0, restored = 0, fail = false;
  const state = () => ({ revision, previewing: preview, dirty, selection: [], canUndo: dirty, canRedo: false });
  const snapshot = () => ({ format: "hepr-editor-recovery", version: 1, sourceScene: {}, fonts: [], data: { revision } });
  const session = { get revision() { return revision; }, getState: state, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async captureRecovery({ signal }) { const captured = snapshot(); captures++; if (captureGate) await captureGate.promise; signal.throwIfAborted(); return captured; },
    async restoreRecovery(value) { restored++; revision = value.data.revision; dirty = true; for (const fn of listeners) fn(state()); } };
  const store = { async get(key) { return records.get(key); }, async list() { return [...records.values()].map(({ envelope, ...metadata }) => metadata); },
    async put(record) { if (fail) throw new Error("Storage quota exceeded"); records.set(record.key, structuredClone(record)); puts.push(record); }, async remove(key) { records.delete(key); } };
  const controller = createEditorRecovery({ session, store, key: "document", label: "Document", debounceMs: 1,
    getDraft: () => draft, applyDraft: value => { draft = value; }, isInteracting: () => interacting,
    onError: error => errors.push(error), onStatus: value => statuses.push(value) });
  const emit = () => { for (const fn of listeners) fn(state()); };
  await controller.probe(); await wait(5); assert.equal(captures, 0, "opening or viewing a document never writes recovery");
  assert.equal(controller.hasPendingDecision(), false);
  preview = true; for (let i = 0; i < 100; i++) emit(); await wait(5); assert.equal(captures, 0, "pointer previews do no recovery work");
  preview = false; revision++; dirty = true; emit(); await wait(10); assert.equal(puts.length, 1);
  for (let i = 0; i < 40; i++) { draft = { text: `draft-${i}` }; controller.draftChanged(); }
  await wait(10); assert.equal(puts.length, 2, "draft input changes are coalesced");
  const codec = createEditorRecoveryCodec(); assert.equal((await codec.decode(records.get("document").envelope)).draft.text, "draft-39");
  interacting = true; revision++; emit(); const beforeInteraction = captures; await wait(8); assert.equal(captures, beforeInteraction);
  interacting = false; await wait(10); assert.equal(puts.length, 3);
  captureGate = deferred(); revision++; emit(); await wait(5); const waiting = captures;
  revision++; emit(); captureGate.resolve(); captureGate = undefined; await wait(12);
  assert(captures > waiting); assert.equal(puts.at(-1).revision, revision, "superseded captures cannot replace newer document state");
  fail = true; revision++; emit(); await wait(8); assert.match(errors.at(-1).message, /quota/); assert(dirty); assert.equal(session.revision, revision);
  const preserved = records.get("document"); fail = false; await controller.flush(); assert.equal(puts.at(-1).revision, revision);
  assert.notEqual(records.get("document"), preserved);
  const oldRevision = revision; draft = { text: "not committed" }; controller.draftChanged();
  await controller.restore(); assert.equal(restored, 1); assert.equal(revision, oldRevision); assert.equal(draft.text, "draft-39");
  await controller.discard(); assert(!records.has("document"));
  controller.dispose(); assert.equal(listeners.size, 0);
  const count = puts.length; await wait(8); assert.equal(puts.length, count, "disposal detaches timers and subscriptions");

  const prior = { key: "document", label: "Old draft", protected: false, updatedAt: 1, revision: 2, envelope: await codec.encode({ ...snapshot(), data: { revision: 2 } }, { text: "keep me" }) };
  records.set("document", prior);
  const later = createEditorRecovery({ session, store, key: "document", label: "Document", debounceMs: 1 });
  assert.equal((await later.probe()).label, "Old draft"); assert(later.hasPendingDecision()); revision++; emit(); later.draftChanged(); await later.flush(); await wait(8);
  assert.equal(records.get("document"), prior, "keeping an offered recovery draft never silently overwrites it");
  await later.restore(); assert.equal(revision, 2); assert.equal(later.hasPendingDecision(), false); later.dispose();
  const missing = createEditorRecovery({ session, store, key: "document", label: "Document", debounceMs: 1 });
  await missing.probe(); assert(missing.hasPendingDecision()); records.delete("document");
  await missing.restore(); assert.equal(missing.hasPendingDecision(), false, "a draft removed by another tab releases the decision gate"); missing.dispose();

  let sessionDisposed = false; const removal = deferred();
  const closing = createEditorRecovery({ session: { ...session, getState() { if (sessionDisposed) throw new Error("Session disposed"); return state(); } },
    store: { ...store, remove: () => removal.promise }, key: "document", label: "Document", debounceMs: 100 });
  await closing.probe(); const deleting = closing.discard(); sessionDisposed = true; removal.resolve(); await deleting; closing.dispose();

  const protectedRecords = [], protectedController = createEditorRecovery({ session, key: "protected", label: "Secret title", protected: true,
    debounceMs: 1, store: { ...store, async get() { return undefined; }, async put(value) { protectedRecords.push(value); } }, onError: error => errors.push(error) });
  await protectedController.probe(); await protectedController.flush();
  assert.equal(protectedRecords.length, 0, "a missing password never stores protected source models or fonts as plaintext");
  assert.match(errors.at(-1).message, /password/); protectedController.dispose();
  console.log("Recovery controller: gesture-free/debounced snapshots, drafts, races, storage failures, restore/discard, old-draft decisions and disposal passed.");
} finally { hooks.deregister(); }
