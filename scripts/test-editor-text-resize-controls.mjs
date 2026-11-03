import assert from "node:assert/strict";
import { createEditorTextResizeControls } from "../src/editorTextResizeControls.ts";

class Element extends EventTarget {
  children = []; style = { cursor: "" }; dataset = {}; attributes = new Map(); hidden = false; capture = null;
  append(child) { this.children.push(child); child.parent = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  setPointerCapture(id) { this.capture = id; }
  hasPointerCapture(id) { return this.capture === id; }
  releasePointerCapture(id) { assert.equal(this.capture, id); this.capture = null; this.dispatchEvent(pointer("lostpointercapture", { pointerId: id })); }
}
const document = { createElement: () => new Element() };
const pointer = (type, values = {}) => Object.assign(new Event(type, { cancelable: true }), {
  pointerId: 1, pointerType: "mouse", button: 0, isPrimary: true, clientX: 0, clientY: 0, ...values
});
const keyboard = (key, values = {}) => Object.assign(new Event("keydown", { cancelable: true }), { key, ...values });
const initial = { x: 10, y: 20, width: 100, height: 50 };
function setup(inverse = point => ({ x: point.x, y: -point.y }), measure = () => ({ width: 60, height: 30 })) {
  let bounds = { ...initial }, allowed = true, changes = 0, writes = 0, starts = 0;
  const measurements = [], cancellations = [];
  const overlay = new Element(), model = { fontSize: 12, transform: [1, 0, 0, 1, 0, 0], text: "unchanged" };
  const controls = createEditorTextResizeControls(document, overlay, {
    getBounds: () => ({ ...bounds }), canResize: () => allowed, clientToLocal: inverse,
    getContentSize: measure && ((width, height) => { measurements.push([width, height]); return measure(width, height); }),
    onResizeStart: () => { starts++; },
    onResize: next => { bounds = next; writes++; }, onChange: canceled => { changes++; cancellations.push(canceled); }
  });
  const container = overlay.children[0], handle = name => container.children.find(button => button.dataset.textResize === name);
  controls.update((x, y) => ({ x, y: -y }), { x: 5, y: 7 }, true);
  return { controls, container, overlay, model, handle, measurements, cancellations, get bounds() { return bounds; }, get changes() { return changes; }, get writes() { return writes; }, get starts() { return starts; },
    get capture() { return container.children.find(button => button.capture !== null)?.capture ?? null; },
    set allowed(value) { allowed = value; }, down: (name, values) => handle(name).dispatchEvent(pointer("pointerdown", values)),
    move: values => container.dispatchEvent(pointer("pointermove", values)), up: values => container.dispatchEvent(pointer("pointerup", values)),
    fit: (name, values) => handle(name).dispatchEvent(pointer("dblclick", values)) };
}

{
  const test = setup();
  assert.equal(test.container.children.length, 8); assert.equal(test.container.hidden, false);
  assert.equal(test.handle("nw").style.left, "5px"); assert.equal(test.handle("nw").style.top, "-77px");
  assert.equal(test.handle("e").style.left, "105px"); assert.equal(test.handle("e").style.top, "-52px");
  assert.equal(test.handle("e").style.cursor, "ew-resize"); assert.equal(test.handle("n").style.cursor, "ns-resize");
  assert.equal(test.handle("ne").style.cursor, "nesw-resize"); assert.equal(test.handle("nw").style.cursor, "nwse-resize");
  assert.equal(test.handle("se").style.cursor, "nwse-resize"); assert.equal(test.handle("sw").style.cursor, "nesw-resize");
  assert.equal(test.handle("se").type, "button"); assert.match(test.handle("se").attributes.get("aria-label"), /bottom right corner/);
  const down = pointer("pointerdown"); test.handle("se").dispatchEvent(down); assert(down.defaultPrevented, "resize chrome preserves text focus and consumes outside clicks");
  assert.equal(test.starts, 1, "a captured drag snapshots its pending sizing mode");
  test.move({ clientX: 40, clientY: 20 });
  assert.deepEqual(test.bounds, { x: 10, y: 0, width: 140, height: 70 }); assert.equal(test.changes, 0);
  test.up({ clientX: 50, clientY: 30 });
  assert.deepEqual(test.bounds, { x: 10, y: -10, width: 150, height: 80 }, "release includes the last pointer coordinate and anchors the top left");
  assert.equal(test.changes, 1); assert.equal(test.capture, null, "release-triggered lost capture cannot roll back a completed resize");
  assert.deepEqual(test.cancellations, [undefined], "a committed resize reports a normal change");
  assert.deepEqual(test.model, { fontSize: 12, transform: [1, 0, 0, 1, 0, 0], text: "unchanged" });
  test.controls.dispose(); assert.equal(test.overlay.children.length, 0);
}
for (const [handle, expected, axes] of [
  ["n", { ...initial, height: 30 }, [false, true]],
  ["ne", { ...initial, width: 60, height: 30 }, [true, true]],
  ["e", { ...initial, width: 60 }, [true, false]],
  ["se", { x: 10, y: 40, width: 60, height: 30 }, [true, true]],
  ["s", { ...initial, y: 40, height: 30 }, [false, true]],
  ["sw", { x: 50, y: 40, width: 60, height: 30 }, [true, true]],
  ["w", { ...initial, x: 50, width: 60 }, [true, false]],
  ["nw", { x: 50, y: 20, width: 60, height: 30 }, [true, true]]
]) {
  const test = setup(), model = structuredClone(test.model);
  for (let click = 0; click < 2; click++) { test.down(handle); test.up(); }
  const event = pointer("dblclick"); test.handle(handle).dispatchEvent(event);
  assert(event.defaultPrevented, `${handle}: fitting preserves text focus and consumes the double-click`);
  assert.deepEqual(test.measurements, [axes], `${handle}: measure only the fitted axes`);
  assert.deepEqual(test.bounds, expected, `${handle}: fit content while anchoring opposite local edges`);
  assert.equal(test.changes, 1); assert.equal(test.writes, 1); assert.equal(test.capture, null);
  assert.deepEqual(test.model, model, "fitting never scales font size, rich text or the text transform");
  test.fit(handle); assert.equal(test.changes, 1, "fitting unchanged content does not dirty the draft");
  test.controls.dispose();
}
for (const measure of [null, () => null, () => ({ width: NaN, height: Infinity })]) {
  const test = setup(undefined, measure); test.fit("ne");
  assert.deepEqual(test.bounds, initial); assert.equal(test.writes, 0); assert.equal(test.changes, 0);
  test.controls.dispose();
}
{
  const test = setup(); test.fit("e", { button: 2 }); assert.equal(test.measurements.length, 0);
  test.down("e"); test.fit("e"); assert.equal(test.measurements.length, 0, "a second pointer cannot fit while another resize is active");
  test.up(); test.allowed = false; test.fit("e"); assert.equal(test.measurements.length, 0, "locked and stale drafts cannot fit");
  test.allowed = true; test.controls.dispose(); test.fit("e"); assert.equal(test.measurements.length, 0, "disposed fitting handlers are removed");
}
for (const [width, height] of [[1000, 10], [10, 1000]]) {
  const test = setup();
  test.down("ne"); test.up({ clientX: width - initial.width, clientY: initial.height - height });
  test.controls.update((x, y) => ({ x: 3 * x, y: -y }), { x: 0, y: 0 }, true);
  for (const [handle, cursor] of [["ne", "nesw-resize"], ["nw", "nwse-resize"], ["se", "nwse-resize"], ["sw", "nesw-resize"]])
    assert.equal(test.handle(handle).style.cursor, cursor, `${width}x${height}: corner cursor ignores box aspect ratio and axis scale`);
  test.controls.update((x, y) => ({ x: -y, y: -3 * x }), { x: 0, y: 0 }, true);
  assert.equal(test.handle("ne").style.cursor, "nwse-resize"); assert.equal(test.handle("se").style.cursor, "nesw-resize");
  test.controls.dispose();
}
for (const handle of ["n", "ne", "e", "se", "s", "sw", "w", "nw"]) {
  const test = setup(), hoverCursor = test.handle(handle).style.cursor, capturedCursors = [];
  test.overlay.style.cursor = "crosshair";
  const button = test.handle(handle), capture = button.setPointerCapture.bind(button);
  button.setPointerCapture = id => { capturedCursors.push([test.container.style.cursor, test.overlay.style.cursor]); capture(id); };
  test.down(handle);
  assert.deepEqual(capturedCursors, [[hoverCursor, hoverCursor]], `${handle}: pin the hover cursor on the container and overlay before capturing`);
  assert.equal(button.capture, 1, `${handle}: the pressed handle owns capture so native click pairs retain the double-click target`);
  assert.equal(test.container.capture, null, "the container must not capture and retarget native clicks away from the pressed handle");
  test.move({ clientX: 10, clientY: 5 });
  assert.equal(test.container.style.cursor, hoverCursor, `${handle}: capture keeps the resize cursor while dragging away from the handle`);
  assert.equal(test.overlay.style.cursor, hoverCursor);
  test.move({ pointerId: 2, clientX: 99 }); test.up({ pointerId: 2, clientX: 99 });
  assert.equal(test.container.style.cursor, hoverCursor, "another pointer cannot change the active cursor");
  test.up({ clientX: 10, clientY: 5 });
  assert.equal(test.container.style.cursor, ""); assert.equal(test.overlay.style.cursor, "crosshair", "release restores the previous overlay cursor");
  test.controls.dispose();
}
for (const [handle, delta, expected] of [
  ["e", [20, 10], { x: 10, y: 20, width: 120, height: 50 }],
  ["w", [20, 10], { x: 30, y: 20, width: 80, height: 50 }],
  ["n", [20, 10], { x: 10, y: 20, width: 100, height: 40 }],
  ["s", [20, 10], { x: 10, y: 10, width: 100, height: 60 }],
  ["nw", [20, 10], { x: 30, y: 20, width: 80, height: 40 }],
  ["sw", [20, 10], { x: 30, y: 10, width: 80, height: 60 }],
  ["ne", [20, 10], { x: 10, y: 20, width: 120, height: 40 }]
]) {
  const test = setup(); test.down(handle); test.up({ clientX: delta[0], clientY: delta[1] });
  assert.deepEqual(test.bounds, expected, handle); test.controls.dispose();
}
{
  const test = setup(); test.down("nw"); test.up({ clientX: 1000, clientY: 1000 });
  assert.deepEqual(test.bounds, { x: 109, y: 20, width: 1, height: 1 }, "dragging through opposite edges never mirrors or scales the font");
  test.controls.dispose();
}
for (const end of ["pointercancel", "lostpointercapture", "Escape", "cancel"]) {
  const test = setup(); test.overlay.style.cursor = "text"; test.down("se"); test.move({ clientX: 40, clientY: 20 });
  if (end === "Escape") { const event = keyboard("Escape"); test.container.dispatchEvent(event); assert(event.defaultPrevented); }
  else if (end === "cancel") assert.equal(test.controls.cancel(), true, "the editor can consume Escape for an active resize");
  else test.container.dispatchEvent(pointer(end));
  assert.deepEqual(test.bounds, initial, `${end} restores original draft bounds`); assert.equal(test.changes, 1); assert.equal(test.capture, null);
  assert.deepEqual(test.cancellations, [true], `${end} distinguishes draft restoration from committing a resize`);
  assert.equal(test.controls.cancel(), false, "idle resize cancellation leaves Escape to the editor");
  assert.equal(test.container.style.cursor, ""); assert.equal(test.overlay.style.cursor, "text", `${end} restores the cursor`);
  test.controls.dispose();
}
for (const end of ["cancel", "up"]) {
  const test = setup(); test.down("e"); test.move({ clientX: 40 }); test.move({ clientX: 0 });
  assert.deepEqual(test.bounds, initial); assert.equal(test.writes, 2);
  if (end === "cancel") test.controls.cancel(); else test.up();
  assert.equal(test.writes, 2, "returning to the original bounds needs no redundant geometry restoration");
  assert.deepEqual(test.cancellations, [end === "cancel" ? true : undefined],
    "a moved drag reports its final outcome even if it returned to the original bounds, so automatic sizing can be restored on cancel");
  test.controls.dispose();
}
{
  const test = setup(); test.down("se"); test.move({ pointerId: 2, clientX: 99 }); test.up({ pointerId: 2, clientX: 99 });
  assert.deepEqual(test.bounds, initial); assert.equal(test.capture, 1);
  test.up(); assert.equal(test.changes, 0, "stationary presses do not mark the draft changed");
  test.down("e", { button: 2 }); test.down("e", { isPrimary: false }); test.move({ clientX: 20 }); assert.deepEqual(test.bounds, initial);
  test.controls.dispose();
}
for (const phase of ["down", "move", "up", "update"]) {
  const test = setup(); test.overlay.style.cursor = "text";
  if (phase !== "down") test.down("e");
  test.allowed = false;
  if (phase === "down") test.down("e");
  else if (phase === "move") test.move({ clientX: 20 });
  else if (phase === "up") test.up({ clientX: 20 });
  else test.controls.update((x, y) => ({ x, y: -y }), { x: 0, y: 0 }, true);
  assert.equal(test.writes, 0, `${phase} rejects stale/locked drafts`); assert.equal(test.changes, 0); assert.equal(test.capture, null);
  assert.equal(test.container.style.cursor, ""); assert.equal(test.overlay.style.cursor, "text", `${phase} leaves no stale resize cursor`);
  test.controls.dispose();
}
{
  const test = setup(); test.down("e"); test.move({ clientX: 20 }); test.allowed = false; test.up({ clientX: 50 });
  assert.equal(test.writes, 1, "stale cancellation never invokes a callback against the replacement draft"); assert.equal(test.changes, 0);
  test.controls.dispose();
}
{
  const test = setup(); test.down("e"); test.allowed = false;
  assert.equal(test.controls.cancel(), true, "stale resize cancellation still consumes its Escape");
  assert.equal(test.writes, 0); assert.equal(test.changes, 0); test.controls.dispose();
}
{
  const test = setup();
  test.handle("e").dispatchEvent(keyboard("ArrowRight")); assert.deepEqual(test.bounds, { ...initial, width: 101 });
  test.handle("sw").dispatchEvent(keyboard("ArrowDown", { shiftKey: true })); assert.deepEqual(test.bounds, { x: 10, y: 10, width: 101, height: 60 });
  test.handle("nw").dispatchEvent(keyboard("ArrowRight", { shiftKey: true })); assert.deepEqual(test.bounds, { x: 20, y: 10, width: 91, height: 60 });
  const irrelevant = keyboard("ArrowUp"); test.handle("e").dispatchEvent(irrelevant); assert.equal(irrelevant.defaultPrevented, false);
  const escape = keyboard("Escape"); test.container.dispatchEvent(escape); assert.equal(escape.defaultPrevented, false, "idle Escape remains available to cancel textbox editing");
  assert.equal(test.changes, 3);
  assert.equal(test.container.style.cursor, ""); assert.equal(test.overlay.style.cursor, "", "keyboard sizing does not pin a pointer cursor");
  test.controls.dispose();
}
{
  const test = setup(); test.overlay.style.cursor = "crosshair"; test.down("e");
  assert.equal(test.container.style.cursor, "ew-resize");
  test.controls.update((x, y) => ({ x: 40 - 2 * y, y: 60 + 2 * x }), { x: 0, y: 0 }, true);
  assert.equal(test.handle("e").style.cursor, "ns-resize");
  assert.equal(test.container.style.cursor, "ns-resize", "active capture follows updated transformed handle geometry");
  assert.equal(test.overlay.style.cursor, "ns-resize");
  test.up(); assert.equal(test.overlay.style.cursor, "crosshair"); assert.equal(test.container.style.cursor, ""); test.controls.dispose();
}
for (const end of ["projection", "hidden", "dispose"]) {
  const test = setup(); test.overlay.style.cursor = "text"; test.down("e");
  if (end === "projection") test.controls.update(() => null, { x: 0, y: 0 }, true);
  else if (end === "hidden") test.controls.update((x, y) => ({ x, y }), { x: 0, y: 0 }, false);
  else test.controls.dispose();
  assert.equal(test.capture, null); assert.equal(test.container.style.cursor, "");
  assert.equal(test.overlay.style.cursor, "text", `${end} releases cursor ownership`); test.controls.dispose();
}
{
  const test = setup(); test.overlay.style.cursor = "crosshair"; test.down("e");
  test.overlay.style.cursor = "progress"; test.controls.cancel();
  assert.equal(test.overlay.style.cursor, "progress", "cursor cleanup does not overwrite a newer owner");
  assert.equal(test.container.style.cursor, ""); test.controls.dispose();
}
{
  const test = setup(); test.overlay.style.cursor = "text";
  test.handle("se").setPointerCapture = () => { throw new Error("Capture unavailable"); };
  test.down("se");
  assert.equal(test.starts, 0, "capture failure cannot retain a sizing snapshot");
  assert.equal(test.container.style.cursor, ""); assert.equal(test.overlay.style.cursor, "text", "capture failure restores cursors without starting a drag");
  assert.equal(test.controls.cancel(), false); assert.equal(test.writes, 0); test.controls.dispose();
}
{
  // Screen = 2x rotation by 90 degrees plus translation. A rightward local
  // resize is downward on screen and must leave the text transform untouched.
  const test = setup(point => ({ x: (point.y - 60) / 2, y: -(point.x - 40) / 2 }));
  test.controls.update((x, y) => ({ x: 40 - 2 * y, y: 60 + 2 * x }), { x: 0, y: 0 }, true);
  assert.equal(test.handle("e").style.cursor, "ns-resize");
  test.down("e", { clientX: 40, clientY: 60 }); test.up({ clientX: 40, clientY: 100 });
  assert.deepEqual(test.bounds, { ...initial, width: 120 });
  test.controls.dispose();
}
{
  const test = setup(point => point.x > 0 ? null : ({ x: point.x, y: point.y }));
  test.down("e"); test.move({ clientX: -10 }); test.move({ clientX: 10 }); assert.deepEqual(test.bounds, initial, "invalid inverse projection cancels and restores the draft");
  test.controls.update(() => null, { x: 0, y: 0 }, true); assert(test.container.hidden);
  test.controls.dispose(); test.handle("e").dispatchEvent(keyboard("ArrowRight")); assert.deepEqual(test.bounds, initial, "disposed controls have no live listeners");
}
console.log("Textbox resize controls: edges/corners, per-axis content fitting, diagonal corner cursors, local geometry, pointer capture, keyboard, cancellation, stale guards and transformed projection passed.");
