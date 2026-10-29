import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const source = await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8");
function harness() {
  let selection = ["a", "b"], pickResult = "c", projection = 1;
  const shown = [], selected = [], calls = { picks: 0, closes: 0 };
  const context = vm.createContext({ active: true, disposed: false, running: false, structuralRunning: false,
    inputTarget: () => false, canUseClipboard: () => false,
    activeText: null, pointer: null, pendingPick: null, tool: "select", textRequest: 0, isSceneSettling: () => false,
    session: { revision: 0, sourceScene: {}, getSelection: () => selection,
      select(ids) { selection = [...ids]; selected.push(selection); },
      getSelectionFrame: () => ({ bounds: { minX: 2, minY: 4, maxX: 12, maxY: 14 }, pageIndex: 0 }) },
    contextMenu: { show: point => shown.push({ ...point }), close: () => calls.closes++ },
    editorFrameCenter: frame => ({ x: (frame.bounds.minX + frame.bounds.maxX) / 2, y: (frame.bounds.minY + frame.bounds.maxY) / 2 }),
    host: { clientToScenePoint: (x, y) => ({ x, y }), sceneToClientPoint: (x, y) => ({ x: x * projection, y: y * projection }) },
    pick: async () => { calls.picks++; return pickResult; }
  });
  for (const name of ["canOpenContextMenu", "openContextMenu", "showSelectionContextMenu", "keydown"])
    vm.runInContext(sourceFunction(source.replace(/^ {2}/gm, ""), name), context);
  const event = (attributes = {}, field = false) => ({ clientX: 30, clientY: 40, prevented: 0,
    preventDefault() { this.prevented++; }, stopPropagation() {},
    target: { closest: () => field ? {} : null, getAttribute: name => attributes[name] ?? null } });
  return { context, shown, selected, calls, event, get selection() { return selection; },
    setSelection: ids => { selection = ids; }, setHit: id => { pickResult = id; }, setProjection: value => { projection = value; } };
}
{
  const h = harness(); await h.context.openContextMenu(h.event({ "data-selection-move": "true" }));
  assert.deepEqual(h.selection, ["a", "b"]); assert.equal(h.calls.picks, 0);
  assert.deepEqual(h.shown, [{ x: 30, y: 40 }], "right-clicking the selected frame preserves its entire selection");
  await h.context.openContextMenu(h.event({ "data-handle": "rotate" })); assert.equal(h.calls.picks, 0);
}
{
  const h = harness(); await h.context.openContextMenu(h.event());
  assert.deepEqual(h.selection, ["c"], "right-click selects an unselected hit before showing actions");
  h.setSelection(["a", "b"]); h.setHit("a"); await h.context.openContextMenu(h.event()); assert.deepEqual(h.selection, ["a", "b"]);
  h.setHit(null); const before = h.shown.length; await h.context.openContextMenu(h.event()); assert.equal(h.shown.length, before, "blank space has no object-arrangement menu");
}
{
  const h = harness(); h.setHit(null); h.context.canUseClipboard = action => action === "paste";
  await h.context.openContextMenu(h.event());
  assert.deepEqual(h.selection, []); assert.deepEqual(h.shown, [{ x: 30, y: 40 }], "blank document space offers Paste without retaining a misleading hit selection");
  h.context.host.getCanvas = () => ({ getBoundingClientRect: () => ({ left: 50, top: 100, width: 400, height: 200 }) });
  h.context.showSelectionContextMenu(); assert.deepEqual(h.shown.at(-1), { x: 250, y: 200 }, "keyboard Paste menu is available with no canvas selection");
}
for (const patch of [{ active: false }, { disposed: true }, { running: true }, { structuralRunning: true }, { tool: "rectangle" },
  { tool: "form" }, { activeText: {} }, { pointer: {} }, { pendingPick: {} }, { isSceneSettling: () => true }]) {
  const h = harness(), event = h.event(); Object.assign(h.context, patch); await h.context.openContextMenu(event);
  assert.equal(event.prevented, 0); assert.equal(h.shown.length, 0); assert.equal(h.calls.picks, 0);
}
{
  const h = harness(), event = h.event({}, true); await h.context.openContextMenu(event);
  assert.equal(event.prevented, 0, "typing controls retain their native copy/paste menu");
}
for (const boundary of ["request", "document", "source", "selection", "camera", "tool"]) {
  const h = harness(); let resolve;
  h.context.pick = () => new Promise(done => { resolve = done; });
  const pending = h.context.openContextMenu(h.event());
  if (boundary === "request") h.context.textRequest++;
  if (boundary === "document") h.context.session.revision++;
  if (boundary === "source") h.context.session.sourceScene = {};
  if (boundary === "selection") h.setSelection(["newer"]);
  if (boundary === "camera") h.setProjection(2);
  if (boundary === "tool") h.context.tool = "ink";
  resolve("stale"); await pending; assert.equal(h.shown.length, 0, `${boundary} changes cancel an asynchronous context hit`);
  assert.equal(h.selected.length, 0);
}
{
  const h = harness(); let resolve;
  h.context.pick = () => new Promise(done => { resolve = done; });
  const old = h.context.openContextMenu(h.event());
  await h.context.openContextMenu(h.event({ "data-selection-move": "true" }));
  resolve("stale"); await old;
  assert.equal(h.shown.length, 1); assert.deepEqual(h.selection, ["a", "b"], "an older hit cannot replace a newer frame menu");
}
{
  const h = harness(); h.context.showSelectionContextMenu(); assert.deepEqual(h.shown, [{ x: 7, y: 9 }], "keyboard invocation anchors to the selected frame");
  let prevented = 0;
  h.context.keydown({ key: "F10", shiftKey: true, target: { closest: () => null }, preventDefault() { prevented++; } });
  assert.equal(prevented, 1); assert.equal(h.shown.length, 2);
  h.context.tool = "rectangle";
  h.context.keydown({ key: "ContextMenu", target: { closest: () => null }, preventDefault() { prevented++; } });
  assert.equal(prevented, 1, "inactive tools retain the native keyboard context menu"); h.context.tool = "select";
  h.setSelection([]); h.context.showSelectionContextMenu(); assert.equal(h.shown.length, 2);
}
console.log("Editor context integration: selected frame, hit selection, typing/mode guards, async cancellation and keyboard anchor passed.");
