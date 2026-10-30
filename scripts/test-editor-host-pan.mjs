import assert from "node:assert/strict";
import { panEditorReader, editorPerspectivePanDelta } from "../src/editorHostPan.ts";

let current = { centerX: 50, centerY: 80, zoom: 2, width: 400, height: 300 }, writes = 0;
const reader = { isActive: () => true, getView: () => current, setView(view) { current = { ...current, ...view }; writes++; } };
assert(panEditorReader(reader, 20, -12)); assert.equal(current.centerX, 40); assert.equal(current.centerY, 74); assert.equal(current.zoom, 2);
assert(panEditorReader(reader, NaN, 3)); assert.equal(writes, 1);
assert.equal(panEditorReader({ ...reader, isActive: () => false }, 20, 30), false);
let nativePan;
assert(panEditorReader({ ...reader, panByPixels: (dx, dy) => { nativePan = [dx, dy]; }, getView() { assert.fail("native pan avoids zoom/layout work"); } }, 5, 6));
assert.deepEqual(nativePan, [5, 6]);
const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 10, 1];
const delta = editorPerspectivePanDelta(matrix, 10, 90, 1, 100, 10, 20);
assert(Math.abs(delta[0] + 2) < 1e-12); assert(Math.abs(delta[1] - 4) < 1e-12); assert.equal(delta[2], 0);
const rotated = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 10, 1];
const turned = editorPerspectivePanDelta(rotated, 10, 90, 2, 100, 10, 20);
assert(Math.abs(turned[0] + 2) < 1e-12); assert(Math.abs(turned[1] + 1) < 1e-12);
assert.deepEqual(editorPerspectivePanDelta(matrix, 1, 90, 1, 0, 1, 1), [0, 0, 0]);
console.log("Editor host pan: Reader CSS pixels, no zoom rebuild, camera-plane basis/zoom and invalid input passed.");
