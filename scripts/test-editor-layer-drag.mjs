import assert from "node:assert/strict";
import { createEditorLayerDrag } from "../src/editorLayerDrag.ts";

class Target extends EventTarget {
  registrations = [];
  addEventListener(type, listener, options) { this.registrations.push({ type, listener, signal: options?.signal }); super.addEventListener(type, listener, options); }
  get live() { return this.registrations.filter(item => !item.signal?.aborted).length; }
}
function event(target, type, values = {}) {
  const value = new Event(type, { cancelable: true });
  for (const [name, item] of Object.entries(values)) Object.defineProperty(value, name, { value: item });
  target.dispatchEvent(value); return value;
}
function harness() {
  const window = new Target(), frames = new Map(), captures = new Set(), calls = [], released = [];
  let time = 0, sequence = 0, covered = false, allowed = true;
  Object.assign(window, { innerWidth: 500, innerHeight: 500,
    requestAnimationFrame(callback) { const id = ++sequence; frames.set(id, callback); return id; }, cancelAnimationFrame(id) { frames.delete(id); } });
  const container = new Target();
  const document = { defaultView: window, elementFromPoint: () => covered ? null : container };
  Object.assign(container, { ownerDocument: document, clientTop: 0, clientLeft: 0, clientWidth: 200, clientHeight: 90,
    scrollHeight: 240, scrollTop: 0, contains: item => item === container,
    getBoundingClientRect: () => ({ left: 20, right: 220, top: 10, bottom: 100, width: 200, height: 90 }),
    setPointerCapture(id) { captures.add(id); }, hasPointerCapture: id => captures.has(id),
    releasePointerCapture(id) { assert(captures.delete(id)); released.push(id); event(container, "lostpointercapture", { pointerId: id }); } });
  const rows = Array.from({ length: 8 }, (_, index) => ({ id: String.fromCharCode(97 + index), element: {
    isConnected: true, getBoundingClientRect() { const top = 10 + index * 30 - container.scrollTop; return { top, bottom: top + 30, left: 20, right: 220, width: 200, height: 30 }; }
  } }));
  const drag = createEditorLayerDrag({ container, getRows: () => rows, canDrop: (source, target) => allowed && source !== target,
    start: source => calls.push(["start", source]), preview: (id, position) => calls.push(["preview", id, position]),
    drop: (...args) => calls.push(["drop", ...args]), end: () => calls.push(["end"]) });
  const point = (x = 60, y = 25, values = {}) => ({ pointerId: 7, button: 0, isPrimary: true, pointerType: "touch", clientX: x, clientY: y, ...values });
  return { window, container, captures, released, rows, frames, calls, drag, point,
    begin(values = {}) { const e = new Event("pointerdown", { cancelable: true }); for (const [key, value] of Object.entries(point(60, 25, values))) Object.defineProperty(e, key, { value }); return { accepted: drag.begin(e, "a"), event: e }; },
    move: (x, y, values) => event(window, "pointermove", point(x, y, values)), up: (x, y, values) => event(window, "pointerup", point(x, y, values)),
    advance(ms = 16) { time += ms; const work = [...frames.values()]; frames.clear(); for (const callback of work) callback(time); },
    setCovered: value => { covered = value; }, setAllowed: value => { allowed = value; },
    drops: () => calls.filter(call => call[0] === "drop"),
    assertIdle() { assert.equal(window.live, 0); assert.equal(container.live, 0); assert.equal(frames.size, 0); assert.equal(captures.size, 0); }
  };
}

for (const pointerType of ["mouse", "touch", "pen"]) {
  const h = harness(); h.assertIdle();
  const down = h.begin({ pointerType }); assert(down.accepted && down.event.defaultPrevented); assert(h.captures.has(7));
  h.move(60, 65, { pointerType }); assert.deepEqual(h.calls[0], ["start", "a"]);
  assert(h.calls.some(call => call[0] === "preview" && call[1] === "b" && call[2] === "after"));
  h.up(60, 66, { pointerType }); assert.deepEqual(h.drops(), [["drop", "a", "b", "after"]]);
  assert.equal(h.calls.filter(call => call[0] === "end").length, 1, "release capture cannot double-end a committed gesture");
  h.up(60, 66, { pointerType }); assert.equal(h.drops().length, 1); h.assertIdle();
}
{
  const h = harness(); h.begin(); h.move(62, 26); h.up(62, 26);
  assert(!h.calls.some(call => call[0] === "start")); assert.equal(h.drops().length, 0, "a tap or small tremor never reorders layers"); h.assertIdle();
}
{
  const h = harness(); h.begin(); h.up(60, 65);
  assert.equal(h.drops().length, 1, "a fast gesture with no delivered move sample uses its final position"); h.assertIdle();
}
for (const values of [{ button: 2 }, { isPrimary: false }]) {
  const h = harness(); assert.equal(h.begin(values).accepted, false); h.assertIdle();
}
{
  const h = harness(); h.begin(); h.move(60, 65, { pointerId: 99 }); h.up(60, 65, { pointerId: 99 });
  assert.equal(h.calls.length, 0, "a foreign pointer cannot move or release the captured gesture");
  event(h.window, "pointerdown", h.point(70, 60, { pointerId: 99, isPrimary: false }));
  assert.equal(h.drops().length, 0); h.assertIdle(); h.up(60, 65); assert.equal(h.drops().length, 0);
}
{
  const h = harness(); h.begin(); h.move(60, 65);
  assert.equal(h.begin({ pointerId: 99, isPrimary: false }).accepted, false, "direct secondary begin cancels without adopting it"); h.assertIdle();
}
{
  const h = harness(); h.begin({ pointerType: "pen" }); h.move(60, 65);
  const second = event(h.window, "pointerdown", h.point(60, 25, { pointerId: 99, pointerType: "touch", isPrimary: true }));
  assert(second.defaultPrevented && second.cancelBubble, "mixed primary pointer types consume the cancelling down");
  assert.equal(h.drag.begin(second, "b"), false, "that same event cannot restart a gesture if a host forwards it after capture");
  h.assertIdle(); assert.equal(h.drops().length, 0);
}
for (const [type, target] of [["pointercancel", "window"], ["lostpointercapture", "container"], ["blur", "window"], ["resize", "window"]]) {
  const h = harness(); h.begin(); h.move(60, 65); event(h[target], type, h.point());
  assert.equal(h.drops().length, 0, `${type} never commits`); h.assertIdle();
}
{
  const h = harness(); h.begin(); h.move(60, 65);
  const key = event(h.window, "keydown", { key: "Escape" }); assert(key.defaultPrevented);
  assert.equal(h.drops().length, 0); h.assertIdle();
}
for (const [x, y] of [[19, 65], [221, 65], [60, 9], [60, 101]]) {
  const h = harness(); h.begin(); h.move(60, 65); h.up(x, y);
  assert.equal(h.drops().length, 0, "releasing outside the clipped list cancels its last valid target"); h.assertIdle();
}
{
  const h = harness(); h.begin(); h.move(60, 65); h.window.innerHeight = 60; h.up(60, 65);
  assert.equal(h.drops().length, 0, "offscreen list geometry is not a drop target"); h.assertIdle();
}
{
  const h = harness(); h.begin(); h.move(60, 65); h.setCovered(true); h.up(60, 65);
  assert.equal(h.drops().length, 0, "another panel covering the list invalidates drop even under pointer capture"); h.assertIdle();
}
{
  const h = harness(); h.begin(); h.move(60, 65); h.setAllowed(false); h.up(60, 65);
  assert.equal(h.drops().length, 0, "hierarchy/permission changes are rechecked at release"); h.assertIdle();
}
{
  const h = harness(); h.begin(); h.move(60, 95); assert.equal(h.frames.size, 1);
  for (let index = 0; index < 8; index++) h.advance();
  assert(h.container.scrollTop > 80, "holding stationary at the bottom edge scrolls long lists");
  assert(h.calls.some(call => call[0] === "preview" && call[1] >= "e"), "target follows scrolled row geometry without another move");
  h.up(60, 95); assert.equal(h.drops().length, 1); assert(h.drops()[0][2] >= "e"); h.assertIdle();
}
{
  const h = harness(); h.container.scrollTop = 100; h.begin(); h.move(60, 12);
  h.advance(); assert(h.container.scrollTop < 100, "top-edge holding scrolls upward");
  h.move(19, 50); h.advance(); assert.equal(h.frames.size, 0, "leaving the list ends edge animation");
  h.drag.cancel(); h.assertIdle();
}
{
  const h = harness(); h.begin(); h.move(60, 95); h.drag.cancel(); h.assertIdle();
  assert.equal(h.drops().length, 0, "View detachment or list replacement cancels pending reorder");
  h.drag.dispose(); assert.equal(h.begin().accepted, false); h.assertIdle();
}
{
  const h = harness(); h.begin(); h.drag.dispose(); h.assertIdle();
  assert.equal(h.drops().length, 0, "disposing before movement clears capture and listeners");
}
{
  const h = harness(); h.container.setPointerCapture = () => { throw new Error("Capture unavailable"); };
  h.begin(); h.move(60, 65); h.up(60, 65); assert.equal(h.drops().length, 1); h.assertIdle();
}
{
  const h = harness(); const e = event(h.container, "pointerdown", h.point());
  assert(!e.defaultPrevented); h.assertIdle();
  assert.equal(h.container.scrollTop, 0, "idle helper does not intercept normal scrolling or non-grip pointers");
}
console.log("Layer pointer drag: mouse/touch/pen, threshold, capture, cancellation, secondary pointers, clipped targets and stationary edge scroll passed.");
