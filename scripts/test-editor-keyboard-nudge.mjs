import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { editorFrameCenter } from "../src/editorSelectionGeometry.ts";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { editorUiTestContext } from "./lib/editorUiTestContext.mjs";

const source = (await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8")).replace(/^ {2}/gm, "");
const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);
const nearPoint = (actual, expected, message) => {
  near(actual.x, expected.x, `${message} X`); near(actual.y, expected.y, `${message} Y`);
};

function harness(matrix = [1, 0, 0, -1, 137, 293], dpr = 1) {
  const nudges = [], projections = [], unprojections = [];
  let commits = 0, selection = ["first"], frame = { bounds: { minX: 10, minY: 20, maxX: 50, maxY: 70 }, transform: [1, 0, 0, 1, 0, 0], pageIndex: 2 };
  const bounds = { minX: 10, minY: 20, maxX: 50, maxY: 70 };
  const project = (x, y) => ({ x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] });
  const host = {
    getCanvas: () => ({ width: 800 * dpr, height: 600 * dpr, getBoundingClientRect: () => ({ left: 137, top: 93, width: 800, height: 600 }) }),
    sceneToClientPoint(x, y, pageIndex) { projections.push({ x, y, pageIndex }); return project(x, y); },
    clientToScenePoint(x, y, pageIndex) {
      unprojections.push({ x, y, pageIndex });
      const [a, b, c, d, e, f] = matrix, determinant = a * d - b * c;
      return { x: (d * (x - e) - c * (y - f)) / determinant, y: (-b * (x - e) + a * (y - f)) / determinant };
    }
  };
  const context = editorUiTestContext({
    active: true, layerDialog: null, polygon: null, recoveryDialog: null, host, window: { devicePixelRatio: dpr }, editorFrameCenter,
    inputTarget: target => Boolean(target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "")),
    session: { getSelection: () => selection, getSelectionFrame: () => frame, getObject: () => ({ pageIndex: 2 }), getObjectBounds: () => ({ ...bounds }) },
    interaction: { nudge(x, y) {
      nudges.push({ x, y }); frame.transform[4] += x; frame.transform[5] += y;
      bounds.minX += x; bounds.maxX += x; bounds.minY += y; bounds.maxY += y;
    } },
    commit(change) { commits++; change(); }
  });
  for (const name of ["nudgeSelectionByPixels", "keydown"]) vm.runInContext(sourceFunction(source, name), context);
  const key = (value, extra = {}) => {
    const event = { key: value, target: { closest: () => null }, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
    context.keydown(event); return event;
  };
  return { context, host, nudges, projections, unprojections, key, project, get commits() { return commits; },
    set matrix(value) { matrix = value; }, get frame() { return frame; }, set frame(value) { frame = value; },
    set selection(value) { selection = value; }, center: () => editorFrameCenter(frame) };
}

for (const zoom of [.25, 1, 4]) for (const dpr of [1, 2, 3]) {
  const h = harness([zoom, 0, 0, -zoom, 137, 293], dpr);
  for (const shiftKey of [false, true]) for (const [key, unitX, unitY] of [
    ["ArrowLeft", -1, 0], ["ArrowRight", 1, 0], ["ArrowUp", 0, -1], ["ArrowDown", 0, 1]
  ]) {
    const before = h.center(), start = h.project(before.x, before.y), count = h.commits;
    const event = h.key(key, { shiftKey }), after = h.center(), end = h.project(after.x, after.y), pixels = shiftKey ? 10 : 1;
    assert(event.defaultPrevented, "accepted nudging suppresses page scrolling"); assert.equal(h.commits, count + 1, "one keypress makes one undoable edit");
    nearPoint({ x: end.x - start.x, y: end.y - start.y }, { x: unitX * pixels, y: unitY * pixels }, `${key}, zoom ${zoom}, DPR ${dpr}, Shift ${shiftKey}`);
    nearPoint(h.nudges.at(-1), { x: unitX * pixels / zoom, y: -unitY * pixels / zoom }, "only the scene delta changes with zoom");
  }
  assert(h.projections.every(point => point.pageIndex === 2)); assert(h.unprojections.every(point => point.pageIndex === 2), "both conversions retain the selection's page");
}

for (const matrix of [[0, 2, 3, 0, 411, 227], [1.7, .35, .6, -2.4, 137, 293]]) {
  const h = harness(matrix);
  for (const [key, expected] of [["ArrowRight", { x: 1, y: 0 }], ["ArrowUp", { x: 0, y: -1 }]]) {
    const before = h.center(), start = h.project(before.x, before.y);
    h.key(key);
    const after = h.center(), end = h.project(after.x, after.y);
    nearPoint({ x: end.x - start.x, y: end.y - start.y }, expected, "arrows follow screen axes under rotated or skewed projection");
  }
}

{
  const h = harness(); h.key("ArrowRight"); near(h.nudges.at(-1).x, 1, "initial zoom");
  h.matrix = [4, 0, 0, -4, 137, 293]; h.key("ArrowRight"); near(h.nudges.at(-1).x, .25, "every keypress reads the active zoom");
  const inverse = h.host.clientToScenePoint;
  h.host.clientToScenePoint = (...args) => { const point = inverse(...args); return { x: point.x + .25, y: point.y - .75 }; };
  h.key("ArrowRight"); nearPoint(h.nudges.at(-1), { x: .25, y: 0 }, "roundtrip offsets cancel when both client positions are unprojected");
}

{
  const h = harness([2, 0, 0, -2, 137, 293]); h.selection = ["first", "second"];
  h.frame = { bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }, transform: [1, 0, 0, 1, 0, 0] };
  const project = h.host.sceneToClientPoint;
  h.host.sceneToClientPoint = (x, y, pageIndex) => pageIndex === undefined ? null : project(x, y, pageIndex);
  h.key("ArrowRight", { shiftKey: true });
  nearPoint(h.nudges[0], { x: 5, y: 0 }, "multi-page selections use a selected object's page instead of a gap at the collective center");
  assert.equal(h.commits, 1); assert(h.unprojections.every(point => point.pageIndex === 2));
  assert(h.projections.some(point => point.x === 30 && point.y === 45 && point.pageIndex === 2));
}

for (const failure of ["frame", "project-null", "project-nan", "start-null", "start-infinite", "end-null", "end-nan", "zero"]) {
  const h = harness();
  if (failure === "frame") h.frame = null;
  else if (failure === "project-null") h.host.sceneToClientPoint = () => null;
  else if (failure === "project-nan") h.host.sceneToClientPoint = () => ({ x: NaN, y: 0 });
  else {
    const inverse = h.host.clientToScenePoint; let calls = 0;
    h.host.clientToScenePoint = (...args) => {
      calls++; const fail = failure.startsWith("start-") ? calls === 1 : calls === 2;
      if (failure === "zero") return { x: 30, y: 45 };
      if (fail) return failure.endsWith("null") ? null : { x: failure.endsWith("infinite") ? Infinity : NaN, y: 0 };
      return inverse(...args);
    };
  }
  h.key("ArrowRight"); assert.equal(h.commits, 0, `${failure} cannot mutate the document`); assert.equal(h.nudges.length, 0);
}

for (const guard of ["input", "contenteditable", "handle", "dialog", "composing", "ime-keycode", "consumed", "locked", "inactive", "running", "structural", "saving", "empty-selection"]) {
  const h = harness(), extra = {};
  if (guard === "input") extra.target = { tagName: "INPUT", closest: () => null };
  else if (guard === "contenteditable") extra.target = { isContentEditable: true, closest: () => null };
  else if (guard === "handle") extra.target = { closest: selector => selector === ".hepr-editor-text-resize-controls" ? {} : null };
  else if (guard === "dialog") extra.target = { closest: selector => selector === "dialog" ? {} : null };
  else if (guard === "composing") extra.isComposing = true;
  else if (guard === "ime-keycode") extra.keyCode = 229;
  else if (guard === "consumed") extra.defaultPrevented = true;
  else if (guard === "locked") h.context.selectionLocked = () => true;
  else if (guard === "inactive") h.context.active = false;
  else if (guard === "running") h.context.running = true;
  else if (guard === "structural") h.context.structuralRunning = true;
  else if (guard === "saving") h.context.savePreparing = true;
  else if (guard === "empty-selection") h.selection = [];
  h.key("ArrowUp", extra); assert.equal(h.commits, 0, `${guard} keeps normal keyboard ownership`); assert.equal(h.nudges.length, 0);
}

console.log("Editor keyboard nudging: one/ten CSS pixels across zoom/DPR, screen directions, transformed views, multi-page fallback, invalid projections and keyboard ownership passed.");
