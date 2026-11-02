import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { editorUiTestContext } from "./lib/editorUiTestContext.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { createEditorPropertyControls } = await import("../src/editorPropertyControls.ts");
  const { normalizePrimitiveColor } = await import("../src/colorInput.ts");
  const { applyEditorSourceColors, editorSourcePaintColors } = await import("../src/editorSourceColors.ts");
  const { resolveEditorColorPreviewRefs } = await import("../src/editorColorPreview.ts");
  const properties = await import("../src/editorProperties.ts");
  const raw = await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8"), source = raw.replace(/^ {2}/gm, "");
  const registration = raw.match(/^  toolbar\.addEventListener\("change", event => \{[\s\S]*?^  \}\);/m)?.[0];
  assert(registration);
  const shape = (x, color, fill) => ({ kind: "shape", shape: "rectangle", pageIndex: 0, x, y: 30, width: 15, height: 15, color, fill });
  const seed = createEditorSession(buildStrokeScene([{ points: [[0, 10], [80, 10]], width: 1, color: "red" }]));
  seed.addObject({ ...shape(10, "red", "blue"), id: "fixture:source-body" }); const canonical = await seed.getScene(); seed.dispose();
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
  class Control {
    value = ""; checked = false; disabled = false; dataset = {}; attributes = new Map(); children = []; placeholder = "";
    constructor(tagName = "INPUT") { this.tagName = tagName; this.ownerDocument = { createElement: tag => new Control(tag.toUpperCase()) }; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    querySelector() { return this.children.find(child => child.dataset.mixed); }
    prepend(child) { child.parent = this; this.children.unshift(child); }
    remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  }

  // Execute production picker orchestration against a real session and a
  // deterministic renderer-only host, without starting a browser or GPU.
  async function harness() {
    const real = createEditorSession(canonical), listeners = new Map(), controls = new Map(), buttons = new Map();
    let currentSource = real.sourceScene, focused = null, commits = 0, nextFrame = 0;
    const jobs = [], raf = new Map(), previews = [], publications = [], errors = [];
    const session = new Proxy(real, { get(target, key, receiver) { return key === "sourceScene" ? currentSource : Reflect.get(target, key, receiver); } });
    for (const name of ["color", "stroke", "fill", "font", "font-size", "align", "fill-enabled"]) {
      const input = new Control(["font", "align"].includes(name) ? "SELECT" : "INPUT"); input.dataset.prop = name;
      input.type = name === "color" || name === "fill" ? "color" : "number";
      input.value = name === "color" ? "#111111" : name === "fill" ? "#ffff00" : name === "stroke" ? "2" : "12";
      input.blur = () => { focused = null; };
      controls.set(name, input);
    }
    for (const name of ["bold", "italic", "underline", "strikethrough", "highlight"]) buttons.set(name, new Control("BUTTON"));
    const appearanceControls = createEditorPropertyControls({ session, control: name => controls.get(name), style: name => buttons.get(name), focused: () => focused, note: new Control("SPAN") });
    const a = session.addObject(shape(35, "red", "blue")), b = session.addObject(shape(60, "purple", null));
    const compiled = await session.getScene({ preview: false });
    const host = { previewColors(updates) { previews.push(updates && structuredClone(updates)); return true; }, requestFrame() {} };
    const context = editorUiTestContext({ ...properties, session, host, active: true, activeText: null, tool: "select",
      colorDraft: null, colorChangeHandled: new WeakSet(), pointer: null, pendingPick: null, currentState: session.getState(), appearanceControls,
      latestScene: compiled, presented: { sourceScene: session.sourceScene, revision: session.revision, delta: null },
      colorPreviewGeneration: 0, colorPreviewQueued: false, colorPreviewRunning: false, colorPreviewPending: false, colorPreviewApplied: false,
      colorPreviewAbort: null, IDENTITY: [1, 0, 0, 1, 0, 0],
      queueMicrotask: callback => jobs.push(callback),
      window: { requestAnimationFrame(callback) { const id = ++nextFrame; raf.set(id, callback); return id; }, cancelAnimationFrame: id => raf.delete(id) },
      normalizePrimitiveColor, property: name => controls.get(name), toolbar: { addEventListener: (name, callback) => listeners.set(name, callback) },
      applyEditorSourceColors, resolveEditorColorPreviewRefs,
      updateAppearanceControls: () => appearanceControls.refresh(context.tool === "select" && session.getSelection().length ? "selection" : "defaults"),
      commit(change) { commits++; change(); }, opacityInput() {}, changeOpacity: () => false,
      refreshScene: async (...args) => { publications.push(args); }, report: error => errors.push(error) });
    const off = session.subscribe(state => { context.currentState = state; appearanceControls.refresh(context.tool === "select" && state.selection.length ? "selection" : "defaults"); });
    const color = (id, name = "color") => session.getObjectPaintColors(id)[name].map(properties.editorPropertyColor);
    return { context, session, host, controls, previews, publications, errors, jobs, raf, a, b,
      sourceStroke: "source:stroke:0", sourceFill: "source:fill:0", get commits() { return commits; }, color,
      install() {
        for (const name of ["runColorPreview", "queueColorPreview", "stopColorPreview", "cancelColorDraft", "stageColorDraft", "flushColorDraft", "toolbarInput", "changeAppearance"])
          vm.runInContext(sourceFunction(source, name), context);
        vm.runInContext('toolbar.addEventListener("input", toolbarInput);', context);
        vm.runInContext(stripTypeScriptTypes(registration.trim()), context);
      },
      select(ids) { session.select(ids); }, replaceSource() { currentSource = { ...currentSource }; },
      input(name, value) { const input = controls.get(name); focused = input; input.value = value; listeners.get("input")({ target: input }); },
      change(name) { listeners.get("change")({ target: controls.get(name) }); },
      async flushJobs() {
        const callbacks = jobs.splice(0); for (const callback of callbacks) callback();
        const frames = [...raf.values()]; raf.clear(); for (const callback of frames) callback(0);
        await tick();
      }, close() { context.disposed = true; off(); session.dispose(); }
    };
  }

  const rgb = value => normalizePrimitiveColor(value);
  const sameRgb = (actual, expected) => rgb(actual).every((channel, index) => Math.abs(channel - rgb(expected)[index]) < 1e-6);
  const colored = h => h.previews.filter(value => value !== null);
  for (const [ownerType, property, original] of [["sourceStroke", "color", "#ff0000"], ["a", "color", "#ff0000"], ["sourceFill", "fill", "#0000ff"], ["a", "fill", "#0000ff"]]) {
    const h = await harness(); h.install();
    try {
      const owner = h[ownerType]; h.select([owner]); h.session.markSaved();
      const before = h.session.getState(), committed = await h.session.getScene({ preview: false });
      h.input(property, "#008000"); h.input(property, "#ff8800"); h.input(property, "#00ff00");
      assert.deepEqual(h.session.getState(), before, "live samples cannot mutate model revision, dirty state or history");
      assert.deepEqual(h.color(owner, property), [original]); assert.equal(h.commits, 0);
      assert.equal(colored(h).length, 0, "synchronous picker samples coalesce before drawing");
      await h.flushJobs();
      assert.equal(colored(h).length, 1, "one rendered preview uses the latest sample in the burst");
      assert(colored(h)[0].length && colored(h)[0].every(update => sameRgb(update.color, "#00ff00")));
      assert.deepEqual(h.session.getState(), before); assert.equal(await h.session.getScene({ preview: false }), committed);
      h.input(property, "#ff8800"); await h.flushJobs();
      assert.equal(colored(h).length, 2); assert(colored(h).at(-1).every(update => sameRgb(update.color, "#ff8800")));
      h.change(property);
      assert.equal(h.commits, 1); assert.equal(h.session.revision, before.revision + 1);
      assert.deepEqual(h.color(owner, property), ["#ff8800"]);
      assert(h.session.undo()); assert.deepEqual(h.color(owner, property), [original], "one Undo restores the pre-picker color");
      assert.deepEqual(h.errors, []);
    } finally { h.close(); }
  }

  // Committing before a queued frame must never publish an obsolete intermediate
  // color after the committed document has been installed.
  {
    const h = await harness(); h.install();
    try {
      h.select([h.a]); h.input("color", "#008000"); h.input("color", "#00ff00"); h.change("color");
      await h.flushJobs(); assert.equal(colored(h).length, 0);
      assert.deepEqual(h.color(h.a), ["#00ff00"]); assert.equal(h.commits, 1);
    } finally { h.close(); }
  }

  for (const [ownerType, property, original] of [["sourceStroke", "color", "#ff0000"], ["a", "color", "#ff0000"], ["sourceFill", "fill", "#0000ff"], ["a", "fill", "#0000ff"]]) {
    const h = await harness(); h.install();
    try {
      h.select([h[ownerType]]); h.session.markSaved(); const before = h.session.getState();
      h.input(property, "#00ff00"); await h.flushJobs();
      h.input(property, original); await h.flushJobs(); h.change(property);
      assert.equal(h.previews.at(-1), null, "returning to the original RGB clears the transient override");
      assert.deepEqual(h.session.getState(), before, "a no-op picker round trip creates neither revision nor Undo history");
      assert.equal(h.commits, 0); assert.deepEqual(h.color(h[ownerType], property), [original]);
    } finally { h.close(); }
  }

  // The visual preview has the same original-owner binding as the final action.
  {
    const h = await harness(); h.install();
    try {
      h.select([h.a]); h.input("color", "#00ff00"); await h.flushJobs();
      const refs = colored(h)[0].map(update => update.ref);
      h.select([h.b]); h.input("color", "#ff8800"); await h.flushJobs();
      assert.deepEqual(colored(h).at(-1).map(update => update.ref), refs, "selection readback cannot retarget the preview");
      assert.deepEqual(h.color(h.a), ["#ff0000"]); assert.deepEqual(h.color(h.b), ["#800080"]);
      h.change("color"); assert.deepEqual(h.color(h.a), ["#ff8800"]); assert.deepEqual(h.color(h.b), ["#800080"]);
      assert.equal(h.commits, 1);
    } finally { h.close(); }
  }

  // Escape/cancellation restores the renderer without adding an undoable edit;
  // an already-queued callback cannot resurrect the discarded color.
  {
    const h = await harness(); h.install();
    try {
      h.select([h.a]); const before = h.session.getState();
      h.input("color", "#00ff00"); await h.flushJobs(); assert.equal(colored(h).length, 1);
      h.input("color", "#ff8800"); h.context.cancelColorDraft(); await h.flushJobs();
      assert.equal(colored(h).length, 1); assert.equal(h.previews.at(-1), null);
      assert.equal(h.context.colorDraft, null); assert.deepEqual(h.session.getState(), before); assert.equal(h.commits, 0);
      h.change("color"); assert.equal(h.commits, 0, "the late native change after cancellation stays inert");
      h.input("color", "#0000ff"); await h.flushJobs(); assert(colored(h).at(-1).every(update => sameRgb(update.color, "#0000ff")));
    } finally { h.close(); }
  }

  for (const boundary of ["source", "view", "dispose"]) {
    const h = await harness(); h.install();
    try {
      h.select([h.a]); h.input("color", "#00ff00");
      if (boundary === "source") h.replaceSource();
      else { h.context.stopColorPreview(true); if (boundary === "view") h.context.active = false; else h.context.disposed = true; }
      await h.flushJobs(); assert.equal(colored(h).length, 0, `${boundary}: stale queued work cannot change the renderer`);
      assert.deepEqual(h.color(h.a), ["#ff0000"]);
    } finally { h.close(); }
  }

  for (const boundary of ["lock", "delete", "source"]) {
    const h = await harness(); h.install();
    try {
      h.select([h.a]); h.input("color", "#00ff00"); await h.flushJobs();
      assert.equal(colored(h).length, 1);
      if (boundary === "lock") h.session.setObjectsLocked([h.a], true);
      else if (boundary === "delete") h.session.deleteSelection();
      else h.replaceSource();
      const before = h.session.getState(); h.change("color");
      assert.equal(h.previews.at(-1), null, `${boundary}: rejecting the draft restores an already visible preview`);
      assert.deepEqual(h.session.getState(), before); assert.equal(h.commits, 0);
    } finally { h.close(); }
  }

  // A host may reject RGB updates but successfully clear an empty override
  // layer. That clear still cannot restore a preview installed as scene data.
  for (const finish of ["cancel", "no-op"]) {
    const h = await harness(); h.install();
    try {
      h.host.previewColors = updates => { h.previews.push(updates && structuredClone(updates)); return updates === null; };
      h.select([h.sourceStroke]); h.session.markSaved(); const before = h.session.getState();
      h.input("color", "#00ff00"); await h.flushJobs();
      assert.equal(h.publications.length, 1); assert.equal(h.publications[0][1], true);
      assert.equal(h.context.colorPreviewFallback, true);
      if (finish === "cancel") h.context.cancelColorDraft();
      else { h.input("color", "#ff0000"); await h.flushJobs(); h.change("color"); }
      const expected = finish === "cancel" ? 2 : 3;
      assert.equal(h.previews.at(-1), null, "the host cleared its sparse RGB layer successfully");
      assert.equal(h.publications.length, expected, `${finish}: restoring the compiled fallback still needs a normal scene publication`);
      assert.notEqual(h.publications.at(-1)[1], true); assert.equal(h.publications.at(-1)[3], undefined);
      assert.equal(h.context.colorPreviewFallback, false); assert.deepEqual(h.session.getState(), before); assert.equal(h.commits, 0);
    } finally { h.close(); }
  }

  // Custom hosts without sparse RGB updates retain a serial scene fallback.
  // A slow publication coalesces incoming input and then submits only the latest.
  {
    const h = await harness(); h.install();
    try {
      delete h.host.previewColors;
      let active = 0, maximum = 0;
      h.context.refreshScene = async (...args) => {
        const done = deferred(); active++; maximum = Math.max(maximum, active);
        h.publications.push({ args, resolve: done.resolve }); await done.promise; active--;
      };
      h.select([h.sourceStroke]); const before = h.session.getState();
      h.input("color", "#008000"); await h.flushJobs(); assert.equal(h.publications.length, 1);
      assert.equal(h.publications[0].args[1], true);
      assert(editorSourcePaintColors(h.publications[0].args[3], [{ kind: "stroke", index: 0 }]).color.every(value => sameRgb(value, "#008000")));
      h.input("color", "#0000ff"); h.input("color", "#ff8800"); await h.flushJobs();
      assert.equal(h.publications.length, 1, "a slow host never has overlapping color publications");
      h.publications[0].resolve(); await tick(); await h.flushJobs();
      assert.equal(h.publications.length, 2); assert.equal(maximum, 1);
      assert(editorSourcePaintColors(h.publications[1].args[3], [{ kind: "stroke", index: 0 }]).color.every(value => sameRgb(value, "#ff8800")));
      h.publications[1].resolve(); await tick(); assert.equal(h.context.colorPreviewRunning, false);
      assert.deepEqual(h.session.getState(), before); assert.equal(h.commits, 0);
    } finally { h.close(); }
  }
  console.log("Live color previews: coalesced renderer-only RGB, stable owners, one final Undo step, cancellation, stale-work guards and serial fallback passed.");
} finally { hooks.deregister(); }
