import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const controls = await import("../src/editorFormControls.ts");
  const source = (await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8")).replace(/^ {2}/gm, "");
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
  class Element extends EventTarget {
    constructor(tag, ownerDocument) {
      super(); this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument; this.type = "text"; this.paintWrites = 0;
      this.dataset = new Proxy({}, {
        set: (data, key, value) => { if (key === "pdfAppearance" || key === "pdfPending") this.paintWrites++; data[key] = value; return true; },
        deleteProperty: (data, key) => { if (key === "pdfAppearance" || key === "pdfPending") this.paintWrites++; delete data[key]; return true; }
      });
      this.style = {}; this.children = []; this.value = "";
    }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    replaceChildren() { for (const child of this.children) child.parentElement = null; this.children = []; }
    setAttribute() {}
    get options() { return this.children; }
    get selectedOptions() { return this.children.filter(option => option.selected); }
  }
  const document = { activeElement: null, createElement(tag) { return tag === "canvas" ? { getContext: () => null } : new Element(tag, document); } };
  const fields = new Element("div", document), values = new Map(), compilations = [], frames = [], errors = [];
  let revision = 0;
  const widget = (id, name, value, index) => ({ id, subtype: "Widget", pageIndex: 0, sourcePageIndex: 0, annotationIndex: index,
    visibleInDefaultView: true, hasAppearance: true, flags: 0, bounds: { minX: 0, minY: index * 30, maxX: 100, maxY: index * 30 + 20 },
    field: { type: "Tx", name, flags: 0, value } });
  const sourceScene = { annotations: [widget("first", "Text", "Old", 0), widget("shared", "Text", "Old", 1), widget("other", "Other", "Keep", 2)] };
  const context = vm.createContext({ ...controls, AbortController, AbortSignal,
    pendingDrawings: { capture() {}, acknowledge() {} },
    document, fields, fieldDrafts: new Map(), fieldPaintCache: null, latestScene: sourceScene, tool: "form", active: true,
    disposed: false, structuralRunning: false, pointer: null, pendingPick: null, lifetime: new AbortController(),
    renderRevision: 0, scenePreparation: null, sceneApplication: null, requestedPreview: null, presented: null,
    synchronizeDocumentSource: async () => {}, updatePointerCursor() {}, updateGeometry() {},
    // Canonical source metadata intentionally retains the original values.
    getEditorAnnotationSource: (_scene, id) => sourceScene.annotations.find(annotation => annotation.id === id),
    getSceneAnnotationRuns: () => new Map(), report: error => errors.push(error),
    session: { sourceScene, getState: () => ({ revision, selection: [], previewing: false }), getSelectionFrame: () => null,
      getFieldValues: () => new Map(values), setFieldValue(name, value) { values.set(name, value); revision++; },
      getScene() {
        const job = deferred(), snapshot = new Map(values);
        job.scene = { annotations: sourceScene.annotations.map(annotation => ({ ...annotation,
          field: { ...annotation.field, value: snapshot.has(annotation.field.name) ? snapshot.get(annotation.field.name) : annotation.field.value } })) };
        compilations.push(job); return job.promise;
      } },
    host: { requestFrame() {}, applyScene(scene, signal, onPresented) {
      const job = deferred(); frames.push({ ...job, scene, draw() { signal.throwIfAborted(); onPresented(); job.resolve(); } }); return job.promise;
    } }
  });
  for (const name of ["renderFields", "updateFieldPaint", "refreshScene", "commit"]) vm.runInContext(sourceFunction(source, name), context);
  context.renderFields();
  const field = id => fields.children.find(control => control.dataset.fieldId === id);
  const type = (id, value) => { const control = field(id); document.activeElement = control; control.value = value; control.dispatchEvent(new Event("input")); return control; };
  const blur = control => { document.activeElement = null; control.dispatchEvent(new Event("change")); };
  const pending = (id, expected = true) => assert.equal(field(id).dataset.pdfPending === "true", expected, `${id}: expected ${expected ? "native pending value" : "presented PDF appearance"}`);
  const compile = async job => { job.resolve(job.scene); await tick(); };
  const draw = async job => { job.draw(); await tick(); };

  pending("first", false); pending("shared", false);
  const siblingPaintWrites = field("shared").paintWrites, otherPaintWrites = field("other").paintWrites;
  const first = type("first", "B"); pending("first");
  assert.equal(field("shared").paintWrites, siblingPaintWrites); assert.equal(field("other").paintWrites, otherPaintWrites,
    "typing updates only the edited control, without repainting every widget");
  blur(first); await tick();
  assert.equal(first.value, "B"); assert.equal(field("shared").value, "B"); pending("first"); pending("shared");
  await compile(compilations[0]); pending("first"); pending("shared");
  assert.equal(context.latestScene, sourceScene, "compilation alone does not hand paint back to an undrawn appearance");

  type("first", "C"); blur(first); await tick();
  await compile(compilations[1]);
  assert.equal(frames.length, 1, "new publication waits for the in-flight draw");
  await draw(frames[0]);
  assert.equal(context.latestScene.annotations[0].field.value, "B");
  assert.equal(first.value, "C"); pending("first"); pending("shared");
  await draw(frames[1]); pending("first", false); pending("shared", false);
  assert.equal(field("first"), first, "publication preserves the control and its draft/caret state");
  assert.equal(first.value, "C", "matching uses presented metadata, not the canonical source's Old value");

  type("first", ""); blur(first); await tick(); pending("first"); pending("shared");
  await compile(compilations[2]); pending("first");
  await draw(frames[2]); pending("first", false); assert.equal(first.value, "", "clearing text cannot expose the previous PDF value while pending");

  type("first", "Failed edit"); blur(first); await tick();
  compilations[3].reject(new Error("Synthetic appearance failure")); await tick();
  pending("first"); assert.equal(first.value, "Failed edit"); assert.match(errors.at(-1).message, /Synthetic appearance failure/);
  context.renderFields(); pending("first"); pending("shared");
  assert.equal(field("first").value, "Failed edit", "re-entering Fill preserves the current value after failed appearance compilation");

  // Undo removes an edited-value key; freshly rebuilt controls must retain the
  // original value until its corresponding appearance is actually drawn.
  values.delete("Text"); revision++; context.renderFields(); pending("first");
  assert.equal(field("first").value, "Old");
  const undo = context.refreshScene(); await tick(); await compile(compilations[4]); pending("first");
  await draw(frames[3]); await undo; pending("first", false); pending("shared", false);

  const other = type("other", "Changed elsewhere"); blur(other); await tick();
  await compile(compilations[5]);
  const draft = type("first", "Typing while another field draws"); draft.selectionStart = 3; draft.selectionEnd = 8;
  await draw(frames[4]); pending("first");
  assert.equal(document.activeElement, draft); assert.equal(draft.value, "Typing while another field draws");
  assert.equal(draft.selectionStart, 3); assert.equal(draft.selectionEnd, 8);
  assert.equal(controls.hasPendingEditorFields(context.fieldDrafts), true, "appearance handoff does not reset an uncommitted draft baseline");
  blur(draft); await tick(); await compile(compilations[6]); await draw(frames[5]); pending("first", false);
  context.session.sourceScene = context.latestScene; values.clear(); context.renderFields();
  assert.equal(field("first").value, "Typing while another field draws", "a compiled scene reused as a source retains its current values instead of canonical placement metadata");
  pending("first", false); pending("shared", false);
  context.disposed = true; context.lifetime.abort();
  console.log("Form appearance handoff: blur, shared widgets, deferred compilation/draw, stale frames, empty values, failures, Undo, and focused drafts passed.");
} finally { hooks.deregister(); }
