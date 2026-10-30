import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import vm from "node:vm";
import { editorUiTestContext } from "./lib/editorUiTestContext.mjs";
import { sourceFunction } from "./lib/sourceFunction.mjs";
const hooks = registerHooks({ resolve(s, c, n) { return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c); } });
try {
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const properties = await import("../src/editorProperties.ts");
  const source = (await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8")).replace(/^ {2}/gm, "");
  const session = createEditorSession(buildStrokeScene([{ points: [[0, 0], [100, 100]], width: 1 }]));
  const shape = session.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 0, y: 0, width: 20, height: 20, color: "red" });
  const text = session.addObject({ kind: "text", pageIndex: 0, x: 30, y: 30, width: 40, height: 10, text: "Text", color: "red", fontSize: 12 });
  session.select([shape, text]);
  const buttons = new Map(), calls = [], errors = [];
  const button = name => { if (!buttons.has(name)) buttons.set(name, { value: "false", setAttribute(_name, value) { this.value = value; } }); return buttons.get(name); };
  let draftChanges = 0;
  const context = editorUiTestContext({ ...properties, session, tool: "select", activeText: null,
    query: selector => button(selector.match(/data-style="([^"]+)"/)[1]), styleEnabled: name => button(name).value === "true",
    property: name => name === "fill-enabled" ? { checked: true } : { value: "#123456" },
    commit: action => action(), report: error => errors.push(error), selectedFont: async () => ({ id: "font-choice", family: "Chosen font" }), activateFont: async () => {},
    document: { execCommand: (...args) => calls.push(args) }, applySelectionCss: (...args) => calls.push(args), recovery: { draftChanged: () => draftChanges++ }
  });
  for (const name of ["changeAppearance", "applyTextStyle"]) vm.runInContext(sourceFunction(source, name), context);
  const change = (name, value) => context.changeAppearance({ dataset: { prop: name }, value });
  const before = session.revision;
  for (const tool of ["rectangle", "ink", "text", "highlight", "underline-text", "strikeout-text", "comment", "signature"]) {
    context.tool = tool; change("color", "blue"); change("stroke", "7"); change("font-size", "25"); change("font", "font-choice"); context.applyTextStyle("bold");
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.revision, before, "creation preferences do not edit the previous selection or create history");
  assert.equal(session.getObject(shape).color, "red"); assert.equal(session.getObject(text).fontSize, 12);
  context.tool = "select"; change("color", "blue"); change("stroke", "7"); change("font-size", "25"); change("font", "font-choice");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.getObject(shape).color, "blue"); assert.equal(session.getObject(shape).strokeWidth, 7); assert.equal(session.getObject(shape).fontSize, undefined);
  assert.equal(session.getObject(text).fontSize, 25); assert.equal(session.getObject(text).fontFamily, "Chosen font");
  session.select(["source:stroke:0"]); const revision = session.revision; change("color", "green"); context.applyTextStyle("italic"); assert.equal(session.revision, revision, "unsupported source controls create no document change");
  context.activeText = { element: { focus() {}, style: {} } }; const saved = session.revision;
  change("align", "right"); change("font-size", "18"); context.applyTextStyle("underline");
  assert.equal(context.activeText.element.style.textAlign, "right"); assert.equal(session.revision, saved); assert.equal(draftChanges, 3, "formatting without DOM typing checkpoints the active draft");
  assert.deepEqual(errors, []); session.dispose();
  console.log("Toolbar properties target Select selections, preserve creation defaults and checkpoint active textbox formatting.");
} finally { hooks.deregister(); }
