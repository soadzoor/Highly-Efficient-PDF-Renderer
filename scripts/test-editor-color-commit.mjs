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
  const { createEditorInteractionController } = await import("../src/editorInteraction.ts");
  const properties = await import("../src/editorProperties.ts");
  const { normalizePrimitiveColor } = await import("../src/colorInput.ts");
  const raw = await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8"), source = raw.replace(/^ {2}/gm, "");
  const registration = raw.match(/^  toolbar\.addEventListener\("change", event => \{[\s\S]*?^  \}\);/m)?.[0];
  assert(registration, "exercise the production toolbar change registration");
  const shape = (x, color, fill) => ({ kind: "shape", shape: "rectangle", pageIndex: 0, x, y: 30, width: 15, height: 15, color, fill });
  const seed = createEditorSession(buildStrokeScene([{ points: [[0, 10], [80, 10]], width: 1, color: "red" }]));
  seed.addObject(shape(10, "red", "blue"));
  const canonical = await seed.getScene(); seed.dispose();

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
  function harness() {
    const real = createEditorSession(canonical), listeners = new Map(), controls = new Map(), buttons = new Map();
    let currentSource = real.sourceScene, focused = null, commits = 0;
    const session = new Proxy(real, { get(target, key, receiver) { return key === "sourceScene" ? currentSource : Reflect.get(target, key, receiver); } });
    for (const name of ["color", "stroke", "fill", "font", "font-size", "align", "fill-enabled"]) {
      const input = new Control(["font", "align"].includes(name) ? "SELECT" : "INPUT");
      input.dataset.prop = name; input.type = name === "color" || name === "fill" ? "color" : "number";
      input.value = name === "color" ? "#111111" : name === "fill" ? "#ffff00" : name === "stroke" ? "2" : "12";
      controls.set(name, input);
    }
    for (const name of ["bold", "italic", "underline", "strikethrough"]) buttons.set(name, new Control("BUTTON"));
    const appearanceControls = createEditorPropertyControls({ session, control: name => controls.get(name), style: name => buttons.get(name), focused: () => focused, note: new Control("SPAN") });
    const context = editorUiTestContext({ ...properties, normalizePrimitiveColor, session, active: true, activeText: null, tool: "select",
      colorDraft: null, colorChangeHandled: new WeakSet(), pointer: null, pendingPick: null, currentState: session.getState(), appearanceControls,
      property: name => controls.get(name), toolbar: { addEventListener: (name, callback) => listeners.set(name, callback) },
      commit(change) { commits++; change(); }, opacityInput() {}, changeOpacity: () => false,
      report: error => assert.fail(String(error)) });
    for (const name of ["stageColorDraft", "flushColorDraft", "toolbarInput", "changeAppearance"])
      if (["toolbarInput", "changeAppearance"].includes(name) || source.includes(`function ${name}(`))
        vm.runInContext(sourceFunction(source, name), context);
    vm.runInContext('toolbar.addEventListener("input", toolbarInput);', context);
    vm.runInContext(stripTypeScriptTypes(registration.trim()), context);
    const off = session.subscribe(state => {
      context.currentState = state;
      appearanceControls.refresh(context.tool === "select" && state.selection.length ? "selection" : "defaults");
    });
    const a = session.addObject(shape(35, "red", "blue")), b = session.addObject(shape(60, "purple", null));
    const color = (id, name = "color") => session.getObjectPaintColors(id)[name].map(properties.editorPropertyColor);
    return { context, session, a, b, sourceStroke: "source:stroke:0", sourceFill: "source:fill:0", controls,
      get commits() { return commits; }, color,
      select: ids => session.select(ids), replaceSource() { currentSource = { ...currentSource }; },
      input(name, value) { const input = controls.get(name); focused = input; input.value = value; listeners.get("input")({ target: input }); },
      change(name) { listeners.get("change")({ target: controls.get(name) }); },
      close() { off(); session.dispose(); }
    };
  }

  for (const sourceOwner of [false, true]) {
    const h = harness();
    try {
      const owner = sourceOwner ? h.sourceStroke : h.a;
      h.select([owner]); const before = h.session.revision;
      h.input("color", "#008000"); h.input("color", "#ff8800"); h.input("color", "#00ff00");
      assert.equal(h.session.revision, before, "picker samples remain one pending gesture");
      h.select([h.b]);
      assert.equal(h.controls.get("color").value, "#800080", "B replaces toolbar readback before the delayed native change");
      h.change("color");
      assert.deepEqual(h.color(owner), ["#00ff00"], "A retains its captured final color after selecting B directly");
      assert.deepEqual(h.color(h.b), ["#800080"], "the late change cannot recolor B");
      assert.equal(h.session.revision, before + 1); assert.equal(h.commits, 1);
      assert.deepEqual(h.session.getSelection(), [h.b]);
      assert(h.session.undo()); assert.deepEqual(h.color(owner), ["#ff0000"], "one Undo restores the whole picker gesture");
    } finally { h.close(); }
  }

  for (const sourceOwner of [false, true]) {
    const h = harness();
    try {
      const owner = sourceOwner ? h.sourceFill : h.a;
      h.select([owner]); assert(h.controls.get("fill-enabled").checked);
      h.input("fill", "#00ff00"); h.select([h.b]);
      assert.equal(h.controls.get("fill-enabled").checked, false, "the new selection has Fill turned off");
      h.change("fill");
      assert.deepEqual(h.color(owner, "fill"), ["#00ff00"], "Fill uses A's RGB and checkbox state, not B's current controls");
      assert.equal(h.session.getObject(h.b).fill, null); assert.equal(h.commits, 1);
      assert(h.session.undo()); assert.deepEqual(h.color(owner, "fill"), ["#0000ff"]);
    } finally { h.close(); }
  }

  // A mixed source/authored selection can intentionally have Fill unchecked:
  // its source paint changes color while its unfilled authored member stays unfilled.
  {
    const h = harness();
    try {
      h.select([h.sourceFill, h.b]); assert.equal(h.controls.get("fill-enabled").checked, false);
      h.input("fill", "#ff8800"); h.select([h.a]); h.change("fill");
      assert.deepEqual(h.color(h.sourceFill, "fill"), ["#ff8800"]);
      assert.equal(h.session.getObject(h.b).fill, null); assert.deepEqual(h.color(h.a, "fill"), ["#0000ff"]);
    } finally { h.close(); }
  }

  for (const boundary of ["lock", "source"]) {
    const h = harness();
    try {
      h.select([h.a]); h.input("color", "#00ff00");
      if (boundary === "lock") h.session.setObjectsLocked([h.a], true); else h.replaceSource();
      h.select([h.b]); const before = h.session.revision; h.change("color");
      assert.deepEqual(h.color(h.a), ["#ff0000"], `${boundary}: a stale or locked owner cannot be edited`);
      assert.deepEqual(h.color(h.b), ["#800080"]); assert.equal(h.session.revision, before);
    } finally { h.close(); }
  }

  for (const next of ["empty", "unsupported"]) {
    const h = harness();
    try {
      const image = h.session.addObject({ kind: "image", pageIndex: 0, x: 0, y: 0, width: 1, height: 1,
        imageWidth: 1, imageHeight: 1, data: Uint8Array.of(1, 2, 3, 255) });
      h.select([h.a]); h.input("color", "#00ff00");
      h.select(next === "empty" ? [] : [image]);
      if (next === "unsupported") assert(h.controls.get("color").disabled);
      const before = h.session.revision;
      h.input("color", "#ff8800"); // Final native sample was already queued when A lost selection.
      h.change("color");
      assert.deepEqual(h.color(h.a), ["#ff8800"], `${next}: retain the final sample for the original owner`);
      assert.deepEqual(h.color(h.b), ["#800080"]); assert.equal(h.session.revision, before + 1);
      assert.deepEqual(h.session.getSelection(), next === "empty" ? [] : [image]);
    } finally { h.close(); }
  }

  for (const sourceOwner of [false, true]) {
    const h = harness();
    try {
      const owner = sourceOwner ? h.sourceStroke : h.a;
      h.select([owner]); h.input("color", "#00ff00"); h.session.deleteSelection();
      h.select([h.b]); const before = h.session.revision; h.change("color");
      assert.equal(h.session.revision, before, "deleting the original owner cancels its pending color without empty history");
      assert.deepEqual(h.color(h.b), ["#800080"], "a removed owner cannot redirect its color to B");
    } finally { h.close(); }
  }

  {
    const h = harness();
    try {
      h.select([h.a, h.sourceStroke]); h.session.groupSelection(); h.input("color", "#00ff00");
      h.session.ungroupSelection(); h.select([h.b]); h.change("color");
      assert.deepEqual(h.color(h.a), ["#00ff00"]); assert.deepEqual(h.color(h.sourceStroke), ["#00ff00"], "leaf owners remain valid after their temporary group is removed");
      assert.deepEqual(h.color(h.b), ["#800080"]);
    } finally { h.close(); }
  }

  // A late change can arrive while the next object's picker/drag owns the
  // pointer. It must not cancel that gesture or recolor the new selection.
  for (const gesture of ["pick", "drag"]) {
    const h = harness();
    try {
      h.select([h.a]); h.input("color", "#00ff00");
      const pending = { id: 4, action: "move" };
      if (gesture === "pick") h.context.pendingPick = pending; else h.context.pointer = pending;
      const before = h.session.revision; h.change("color");
      assert.equal(h.session.revision, before, `${gesture}: defer publication while the next pointer gesture is active`);
      assert.equal(gesture === "pick" ? h.context.pendingPick : h.context.pointer, pending);
      h.select([h.b]); h.context.pendingPick = h.context.pointer = null;
      h.context.flushColorDraft(false);
      assert.deepEqual(h.color(h.a), ["#00ff00"]); assert.deepEqual(h.color(h.b), ["#800080"]);
      assert.equal(h.session.revision, before + 1); assert.deepEqual(h.session.getSelection(), [h.b]);
    } finally { h.close(); }
  }

  // Complete the production click lifecycle too, including browsers that have
  // not delivered native `change` when the user presses another object.
  for (const coldPick of [false, true]) {
    const h = harness(), c = h.context, captures = new Set();
    const interaction = createEditorInteractionController(h.session);
    try {
      h.select([h.a]); h.input("color", "#00ff00");
      c.interaction = interaction; c.textRequest = 0; c.polygon = null; c.sceneApplication = null;
      c.presented = { sourceScene: h.session.sourceScene, revision: h.session.revision, delta: null };
      c.host = { clientToScenePoint: (x, y) => ({ x, y }), sceneToClientPoint: (x, y) => ({ x, y }) };
      c.overlay = { dataset: {}, style: {}, setPointerCapture: id => captures.add(id),
        hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) };
      c.refreshScene = async () => {}; c.clearPreview = () => {};
      c.cancelPointerGesture = () => assert.fail("committing the old color cannot cancel the new object's click");
      let resolvePick;
      c.pick = coldPick ? () => new Promise(resolve => { resolvePick = resolve; }) : async () => h.b;
      for (const name of ["commit", "isSceneSettling", "updatePointerCursor", "updateShapeGesture", "pointerDown", "pointerUp"])
        vm.runInContext(sourceFunction(source, name), c);
      const event = { button: 0, pointerId: 9, pointerType: "mouse", clientX: 65, clientY: 35,
        target: { closest: () => null, getAttribute: () => null }, preventDefault() {}, stopPropagation() {} };
      const pending = c.pointerDown(event);
      if (coldPick) {
        assert(c.pendingPick); c.pointerUp(event); resolvePick(h.b);
      }
      await pending;
      assert.deepEqual(h.color(h.a), ["#00ff00"], "clicking B itself commits A even before a native change arrives");
      assert.deepEqual(h.color(h.b), ["#800080"]); assert.deepEqual(h.session.getSelection(), [h.b]);
      if (!coldPick) {
        assert.equal(c.pointer?.action, "move"); assert(captures.has(9), "B keeps its pointer capture after color publication");
        c.pointerUp(event);
      }
      assert.equal(c.pointer, null); assert.equal(captures.size, 0);
      const before = h.session.revision; h.change("color");
      assert.equal(h.session.revision, before, "the eventual native change cannot recolor B or repeat A's edit");
      assert.deepEqual(h.color(h.b), ["#800080"]);
    } finally { interaction.dispose(); h.close(); }
  }

  {
    const h = harness();
    try {
      h.select([h.a]); h.input("color", "#00ff00"); h.context.flushColorDraft();
      assert.deepEqual(h.color(h.a), ["#00ff00"]);
      h.select([h.b]); const before = h.session.revision; h.change("color");
      assert.equal(h.session.revision, before, "a delayed native change after explicit flush does not create another edit");
      assert.deepEqual(h.color(h.b), ["#800080"]);
      h.input("color", "#ff8800"); h.change("color");
      assert.deepEqual(h.color(h.b), ["#ff8800"], "a new picker gesture is accepted after suppressing the older change");
      assert.deepEqual(h.color(h.a), ["#00ff00"]);
    } finally { h.close(); }
  }
  console.log("Color commits: native input/change ordering, direct selection changes, source/authored Fill, one-step Undo, stale owners and delayed-change suppression passed.");
} finally { hooks.deregister(); }
