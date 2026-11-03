import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { editorUiTestContext } from "./lib/editorUiTestContext.mjs";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { editorPropertyState, editorPropertySelection, editorSelectionLeaves, editorFillSelection, editorStyledSelection, applyEditorPropertyPatch } = await import("../src/editorProperties.ts");
  const { createEditorPropertyControls } = await import("../src/editorPropertyControls.ts");
  const scene = buildStrokeScene([{ points: [[0, 0], [100, 0]], width: 1 }]);
  const session = createEditorSession(scene);
  const shape = session.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 10, y: 10, width: 10, height: 10,
    color: "red", fill: "blue", strokeWidth: 2 });
  const a = session.addObject({ kind: "text", pageIndex: 0, x: 10, y: 30, width: 40, height: 20, text: "One", fontSize: 12, color: "red",
    runs: [{ text: "O", fontSize: 9, fontWeight: "bold" }, { text: "ne", fontSize: 15 }] });
  const b = session.addObject({ kind: "text", pageIndex: 0, x: 10, y: 60, width: 40, height: 20, text: "Two", fontSize: 18, color: "blue" });
  const image = session.addObject({ kind: "image", pageIndex: 0, x: 10, y: 80, width: 10, height: 10, imageWidth: 1, imageHeight: 1, data: Uint8Array.of(1, 2, 3, 255) });
  const source = "source:stroke:0";
  session.select([source]); const clean = session.getState();
  assert.equal(applyEditorPropertyPatch(session, { fontSize: 20, strokeWidth: 4 }), 0);
  assert.deepEqual(session.getState(), clean, "unsupported source properties never create empty history or refresh work");
  assert.deepEqual(editorPropertySelection(session, "color"), [source]);
  assert.equal(applyEditorPropertyPatch(session, { color: "green", fontSize: 20 }), 1);
  assert.equal(editorPropertyState(session, "color").value, "#008000", "source controls read back the committed color override");
  assert.equal(session.getSourceEdits().length, 1); assert(session.undo()); assert.deepEqual(session.getSourceEdits(), []);
  session.select([shape, a, b, image, source]); const group = session.groupSelection();
  assert(editorPropertyState(session, "fontSize").mixed, "formatting inside rich runs participates in mixed values");
  const originals = [shape, a, b, image].map(id => session.getObject(id));
  assert.equal(applyEditorPropertyPatch(session, { color: "purple", strokeWidth: 3, fill: "green", fontSize: 17, align: "right" }), 4);
  assert.equal(session.getObject(shape).strokeWidth, 3); assert.equal(session.getObject(shape).fill, "green");
  for (const id of [a, b]) {
    const text = session.getObject(id); assert.equal(text.fontSize, 17); assert.equal(text.align, "right");
    assert.equal(text.color, "purple"); assert.equal(text.strokeWidth, undefined);
    if (text.runs) assert(text.runs.every(run => run.fontSize === 17 && run.color === "purple"));
  }
  assert.deepEqual(session.getObject(image), originals[3]);
  assert.equal(session.getSourceEdits().length, 1); assert.equal(editorPropertyState(session, "color", [source]).value, "#800080");
  assert.equal(session.getObject(group).kind, "group"); assert(session.undo());
  assert.deepEqual([shape, a, b, image].map(id => session.getObject(id)), originals, "one Undo restores all changed children");
  assert.deepEqual(session.getSourceEdits(), [], "the same Undo restores original page colors");

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
  const inputs = new Map(["color", "stroke", "fill", "font", "font-size", "align", "fill-enabled"].map(name => [name, new Control(["font", "align"].includes(name) ? "SELECT" : "INPUT")]));
  inputs.get("stroke").value = "2"; inputs.get("font-size").value = "12"; inputs.get("color").value = "#111111";
  const buttons = new Map(["bold", "italic", "underline", "strikethrough", "highlight"].map(name => [name, new Control("BUTTON")]));
  let focused = null; const note = new Control("SPAN");
  const controls = createEditorPropertyControls({ session, control: name => inputs.get(name), style: name => buttons.get(name), focused: () => focused, note });
  session.select([source]); controls.refresh("selection");
  assert(!inputs.get("color").disabled && inputs.get("stroke").disabled && inputs.get("font-size").disabled);
  assert(buttons.get("bold").disabled); assert.equal(note.textContent, "");
  assert(inputs.get("fill-enabled").disabled && inputs.get("fill").disabled);
  session.select([group]); controls.refresh("selection");
  assert(!inputs.get("color").disabled); assert.equal(inputs.get("color").dataset.mixed, "true");
  assert.equal(inputs.get("font-size").placeholder, "Mixed"); assert.equal(buttons.get("bold").getAttribute("aria-pressed"), "mixed");
  assert.match(note.textContent, /4 supported objects/); assert(inputs.get("fill-enabled").checked);
  session.select([a]); controls.refresh("selection"); focused = inputs.get("font-size"); focused.value = "99"; controls.refresh("selection");
  assert.equal(focused.value, "99", "uncommitted numeric typing survives unrelated state readback");
  session.select([b]); controls.refresh("selection"); assert.equal(focused.value, "18", "a new selection cannot inherit another object's numeric draft");
  focused = null; controls.refresh("defaults");
  assert.equal(inputs.get("font-size").value, "12"); assert.equal(inputs.get("stroke").value, "2"); assert(!inputs.get("color").disabled);
  session.select([shape]); session.setObjectsLocked([shape], true); controls.refresh("selection");
  assert(inputs.get("color").disabled); assert.equal(applyEditorPropertyPatch(session, { color: "orange" }), 0);
  assert.equal(session.getObject(shape).color, "red", "appearance helpers never mutate an editing-locked object");
  session.dispose();

  // Reopened geometry has source identities. It exposes existing fill colors
  // while fill creation/removal and opacity remain authored-object operations.
  const author = createEditorSession(buildStrokeScene([{ points: [[0, 0], [100, 0]], width: 1 }]));
  author.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 10, y: 10, width: 20, height: 20,
    color: "red", fill: "blue", fillOpacity: .35, strokeWidth: 2 });
  author.addObject({ kind: "image", pageIndex: 0, x: 50, y: 50, width: 10, height: 10,
    imageWidth: 1, imageHeight: 1, data: Uint8Array.of(1, 2, 3, 255) });
  const reopened = createEditorSession(await author.getScene()); author.dispose();
  try {
    const fill = "source:fill:0", raster = "source:raster:0";
    reopened.select([fill]);
    const reopenedControls = createEditorPropertyControls({ session: reopened, control: name => inputs.get(name), style: name => buttons.get(name), focused: () => null, note });
    reopenedControls.refresh("selection");
    assert(!inputs.get("color").disabled && !inputs.get("fill").disabled);
    assert.equal(inputs.get("fill").value, "#0000ff");
    assert(inputs.get("fill-enabled").disabled && inputs.get("fill-enabled").checked, "existing fill cannot be removed by the authored Fill toggle");
    assert.deepEqual(editorStyledSelection(reopened), []); assert.deepEqual(editorFillSelection(reopened), [], "source paints keep their alpha");
    const state = reopened.getState(); assert.equal(applyEditorPropertyPatch(reopened, { fill: null }), 0); assert.deepEqual(reopened.getState(), state);
    assert.equal(applyEditorPropertyPatch(reopened, { fill: "green" }), 1);
    assert.equal(editorPropertyState(reopened, "fill").value, "#008000");
    assert.equal(editorPropertyState(reopened, "color").value, "#008000", "Color and Fill read back the same existing fill paint");

    const unfilled = reopened.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 70, y: 10, width: 10, height: 10, color: "black", fill: null });
    reopened.select([fill, unfilled]); reopenedControls.refresh("selection");
    assert(!inputs.get("fill-enabled").disabled && !inputs.get("fill-enabled").checked);
    const uiSource = (await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8")).replace(/^ {2}/gm, "");
    const context = editorUiTestContext({ session: reopened, tool: "select", activeText: null,
      editorPropertySelection, editorSelectionLeaves, editorFillSelection, applyEditorPropertyPatch,
      property: name => inputs.get(name), commit: change => change() });
    vm.runInContext(sourceFunction(uiSource, "changeAppearance"), context);
    inputs.get("fill").value = "#ff8800"; inputs.get("fill").dataset.prop = "fill";
    context.changeAppearance(inputs.get("fill"));
    assert.equal(editorPropertyState(reopened, "fill", [fill]).value, "#ff8800", "Fill color recolors source even when an authored peer has Fill unchecked");
    assert.equal(reopened.getObject(unfilled).fill, null, "the authored Fill checkbox semantics remain unchanged");
    assert(reopened.undo()); assert.equal(editorPropertyState(reopened, "fill", [fill]).value, "#008000");
    inputs.get("fill-enabled").checked = true; inputs.get("fill-enabled").dataset.prop = "fill-enabled";
    context.changeAppearance(inputs.get("fill-enabled"));
    assert.equal(reopened.getObject(unfilled).fill, "#ff8800");
    assert.equal(editorPropertyState(reopened, "fill", [fill]).value, "#008000", "the authored Fill toggle never repaints source peers");

    reopened.select([raster]); reopenedControls.refresh("selection");
    assert(inputs.get("color").disabled && inputs.get("fill").disabled && inputs.get("fill-enabled").disabled);
    const rasterState = reopened.getState(); assert.equal(applyEditorPropertyPatch(reopened, { color: "purple", fill: "red" }), 0);
    assert.deepEqual(reopened.getState(), rasterState); assert.match(note.textContent, /text and vector objects/);
  } finally { reopened.dispose(); }
  console.log("Editor properties: capability-aware source/groups, mixed rich runs, supported leaf patches, locks, history, readback and defaults passed.");
} finally { hooks.deregister(); }
