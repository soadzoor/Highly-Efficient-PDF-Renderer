import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const properties = await import("../src/editorProperties.ts");
  const source = await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8");
  for (const name of ["opacity", "fill-opacity"]) {
    for (const attribute of ["data-prop", "data-opacity-slider"]) {
      const input = source.match(new RegExp(`<input ${attribute}="${name}"[^>]+>`))?.[0]; assert(input);
      assert.match(input, /min="0"/); assert.match(input, /max="1"/); assert.match(input, /step="0\.1"/);
      assert.match(input, attribute === "data-prop" ? /type="number"/ : /type="range"/);
    }
  }
  function control(dataset) {
    return { dataset, value: "1", disabled: false, placeholder: "", attributes: new Map(),
      setAttribute(name, value) { this.attributes.set(name, value); }, removeAttribute(name) { this.attributes.delete(name); } };
  }
  const numbers = new Map(["opacity", "fill-opacity"].map(name => [name, control({ prop: name })]));
  const sliders = new Map(["opacity", "fill-opacity"].map(name => [name, control({ opacitySlider: name })]));
  const objects = {
    shape: { id: "shape", kind: "shape", opacity: .8, fill: "red" },
    ink: { id: "ink", kind: "ink", opacity: .2, fillOpacity: .4, fill: "blue" },
    text: { id: "text", kind: "text", opacity: .6 }, source: { id: "source", kind: "source" },
    group: { id: "group", kind: "group", children: ["shape", "ink", "text", "source"] }
  };
  let selection = ["shape"], transactions = 0, refreshes = 0;
  const patches = [], errors = [];
  const session = { getSelection: () => selection, getObject: id => objects[id],
    transaction(_label, operation) { transactions++; operation(); },
    updateObject(id, patch) { patches.push([id, patch]); Object.assign(objects[id], patch); } };
  const context = vm.createContext({ ...properties, session, document: { activeElement: null }, objectOpacity: 1, fillOpacity: 1,
    tool: "select", activeText: null, structuralRunning: false, opacityControlSelection: "", property: name => numbers.get(name),
    query: selector => sliders.get(selector.match(/data-opacity-slider="([^"]+)"/)[1]),
    commit(operation) { refreshes++; operation(); }, report: error => errors.push(error) });
  for (const name of ["opacitySlider", "syncOpacityControls", "updateOpacityControls", "opacityInput", "changeOpacity"])
    vm.runInContext(sourceFunction(source.replace(/^ {2}/gm, ""), name), context);
  const refresh = () => context.updateOpacityControls({ selection });
  refresh(); assert.equal(numbers.get("opacity").value, "0.8"); assert.equal(numbers.get("fill-opacity").value, "0.8");
  const stroke = sliders.get("opacity"), fill = sliders.get("fill-opacity");
  stroke.value = "0.3"; context.opacityInput({ target: stroke });
  assert.equal(numbers.get("opacity").value, "0.3"); assert.equal(objects.shape.opacity, .8); assert.equal(transactions, 0, "range input only previews the number, without per-pointer history or recompilation");
  context.changeOpacity(stroke);
  assert.equal(objects.shape.opacity, .3); assert.equal(objects.shape.fillOpacity, .8, "changing color opacity preserves a legacy object's fill opacity");
  assert.equal(transactions, 1); assert.equal(refreshes, 1, "release commits one undoable change");
  fill.value = "0.1"; context.opacityInput({ target: fill }); context.changeOpacity(fill);
  assert.equal(objects.shape.fillOpacity, .1); assert.equal(objects.shape.opacity, .3); assert.equal(numbers.get("fill-opacity").value, "0.1");
  numbers.get("fill-opacity").value = "0.7"; context.opacityInput({ target: numbers.get("fill-opacity") });
  assert.equal(fill.value, "0.7", "typing updates the paired slider"); context.changeOpacity(numbers.get("fill-opacity"));
  assert.equal(objects.shape.fillOpacity, .7);
  selection = ["group"]; refresh(); assert.equal(numbers.get("fill-opacity").placeholder, "Mixed"); assert(fill.attributes.has("aria-valuetext"));
  fill.value = "0.5"; context.changeOpacity(fill);
  assert.equal(objects.shape.fillOpacity, .5); assert.equal(objects.ink.fillOpacity, .5);
  assert.equal(objects.text.fillOpacity, undefined); assert.equal(objects.source.fillOpacity, undefined, "fill opacity only applies to authored fill-capable children");
  context.document.activeElement = stroke;
  selection = ["text"]; refresh(); assert(numbers.get("fill-opacity").disabled && fill.disabled); assert(!stroke.disabled);
  assert.equal(numbers.get("opacity").value, "0.6", "a new selection refreshes a slider that kept keyboard focus");
  context.document.activeElement = null;
  selection = ["source"]; refresh(); assert(stroke.disabled && fill.disabled);
  context.tool = "rectangle"; refresh(); assert(!stroke.disabled && !fill.disabled, "creation tools keep both controls available");
  context.activeText = { opacity: .6 }; selection = ["shape"];
  stroke.value = "0.2"; context.changeOpacity(stroke); assert.equal(context.activeText.opacity, .2); assert.equal(objects.shape.opacity, .3);
  fill.value = "0.4"; context.changeOpacity(fill); assert.equal(objects.shape.fillOpacity, .5, "typing does not style a previously selected shape");
  assert.equal(context.fillOpacity, .4, "fill control remains a creation preference while typing");
  numbers.get("opacity").value = "1.5"; context.changeOpacity(numbers.get("opacity"));
  assert.equal(numbers.get("opacity").value, "0.2"); assert.equal(stroke.value, "0.2"); assert.equal(errors.length, 1);
  const before = patches.length, previousNumber = numbers.get("fill-opacity").value;
  context.structuralRunning = true; fill.value = "0.9"; context.opacityInput({ target: fill });
  assert.equal(patches.length, before); assert.equal(numbers.get("fill-opacity").value, previousNumber);
  context.structuralRunning = false; context.activeText = null; selection = ["shape"]; objects.shape.opacity = .375;
  refresh(); assert.equal(numbers.get("opacity").value, "0.375"); assert.equal(objects.shape.opacity, .375);
  assert.equal(patches.length, before, "refreshing controls never rounds an existing arbitrary opacity into the document");
  console.log("Opacity controls: paired ranges/numbers, 0.1 steps, independent fills, mixed/group selections, single drag history and drafts passed.");
} finally { hooks.deregister(); }
