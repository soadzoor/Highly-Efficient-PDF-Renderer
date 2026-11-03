import assert from "node:assert/strict";
import { createEditorFieldActivation } from "../src/editorFieldActivation.ts";

const scene = {}, field = { id: "widget", sourceScene: scene, revision: 3 };
const event = (timeStamp, properties = {}) => ({ button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true,
  clientX: 100, clientY: 200, timeStamp, ...properties });
const click = (controller, start, candidate = field, properties = {}) => {
  controller.pointerDown(event(start, properties), candidate);
  return controller.pointerUp(event(start + 40, properties));
};

// Real UI targets can differ even during one press because selection SVGs are
// replaced every frame and capture sends the release to the stable overlay.
for (const pointerType of ["mouse", "pen", "touch"]) {
  const controller = createEditorFieldActivation(), downTarget = {}, upTarget = {};
  controller.pointerDown(event(0, { pointerType, target: downTarget }), field);
  controller.pointerMove(event(20, { pointerType, button: -1, target: {}, clientX: 100.75, clientY: 200.5 }));
  assert.equal(controller.pointerUp(event(40, { pointerType, target: upTarget, clientX: 100.75, clientY: 200.5 })), null);
  controller.pointerDown(event(140, { pointerType, target: {} }), field);
  controller.pointerMove(event(160, { pointerType, button: -1, target: {}, clientX: 101.25, clientY: 200.25 }));
  assert.deepEqual(controller.pointerUp(event(180, { pointerType, target: {}, clientX: 101.25, clientY: 200.25 })), field);
  assert.equal(click(controller, 240, field, { pointerType }), null, "activation consumes its pair rather than firing on a third click");
}

// Timing and distance boundaries include their limits, with no second-down
// activation. Release completes the intent even while a host's pick is pending.
{
  const controller = createEditorFieldActivation();
  assert.equal(click(controller, 0), null);
  let resolvePick; const pendingPick = new Promise(resolve => { resolvePick = resolve; });
  assert.equal(controller.pointerDown(event(500, { clientX: 104 }), field), undefined);
  assert.deepEqual(controller.pointerUp(event(540, { clientX: 104 })), field);
  resolvePick(); await pendingPick;
  assert.equal(click(controller, 600), null);
}
for (const properties of [{ clientX: 104.001 }, { clientY: 204.001 }]) {
  const controller = createEditorFieldActivation(); click(controller, 0);
  assert.equal(click(controller, 120, field, properties), null, "completed clicks farther than four pixels form a new sequence");
}
for (const properties of [{ clientX: 102.001 }, { clientX: 101.5, clientY: 201.5 }]) {
  const controller = createEditorFieldActivation(); click(controller, 0); controller.pointerDown(event(120), field);
  assert.equal(controller.pointerUp(event(180, properties)), null, "release checks click slop even without a move event");
  assert.equal(click(controller, 240), null);
}
{
  const controller = createEditorFieldActivation(); click(controller, 0);
  assert.equal(click(controller, 501), null, "more than 500ms between releases is a new sequence");
}

// A drag cannot be turned back into a click by returning to its press position.
for (const excursion of [{ clientX: 102.001 }, { clientX: 101.5, clientY: 201.5 }]) {
  const controller = createEditorFieldActivation(); click(controller, 0);
  controller.pointerDown(event(120), field);
  controller.pointerMove(event(140, { button: -1, ...excursion }));
  controller.pointerMove(event(160, { button: -1 }));
  assert.equal(controller.pointerUp(event(180)), null);
  assert.equal(click(controller, 240), null, "dragging clears the completed-click sequence");
}
{
  const controller = createEditorFieldActivation();
  controller.pointerDown(event(0), field); controller.pointerMove(event(20, { button: -1, clientX: 102 }));
  assert.equal(controller.pointerUp(event(40, { clientX: 102 })), null, "two pixels is still click slop");
  assert.deepEqual(click(controller, 120, field, { clientX: 102 }), field);
}

// Field, source, revision and pointer-device changes cannot reuse the old click.
for (const candidate of [{ ...field, id: "another" }, { ...field, sourceScene: {} }, { ...field, revision: 4 }, null]) {
  const controller = createEditorFieldActivation(); click(controller, 0);
  assert.equal(click(controller, 120, candidate), null);
  assert.equal(click(controller, 240), null);
}
{
  const controller = createEditorFieldActivation(); click(controller, 0);
  assert.equal(click(controller, 120, field, { pointerType: "pen" }), null);
  assert.equal(click(controller, 240), null);
}

// Secondary buttons, modifier selection, non-primary touch, unknown pointers,
// cancellation and duplicate presses all invalidate the sequence.
for (const properties of [{ button: 1 }, { button: 2 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true },
  { isPrimary: false }, { pointerType: "" }, { pointerType: "unknown" }, { pointerId: NaN }, { clientX: Infinity }, { clientY: NaN }]) {
  for (const phase of ["down", "move", "up"]) {
    const controller = createEditorFieldActivation(); click(controller, 0);
    controller.pointerDown(event(120, phase === "down" ? properties : {}), field);
    if (phase === "move") controller.pointerMove(event(140, properties));
    assert.equal(controller.pointerUp(event(180, phase === "up" ? properties : {})), null);
    assert.equal(click(controller, 240), null, `${phase} ${JSON.stringify(properties)} cannot complete an old click pair`);
  }
}
for (const boundary of ["reset", "duplicate", "other-pointer", "changed-device"]) {
  const controller = createEditorFieldActivation(); click(controller, 0); controller.pointerDown(event(120), field);
  if (boundary === "reset") controller.reset();
  else if (boundary === "duplicate") controller.pointerDown(event(140), field);
  else controller.pointerMove(event(140, boundary === "other-pointer" ? { pointerId: 2 } : { pointerType: "touch" }));
  assert.equal(controller.pointerUp(event(180)), null); assert.equal(click(controller, 240), null);
}
for (const badTime of [NaN, Infinity, -1, 119]) {
  const controller = createEditorFieldActivation(); click(controller, 0); controller.pointerDown(event(120), field);
  controller.pointerMove(event(badTime));
  assert.equal(controller.pointerUp(event(180)), null); assert.equal(click(controller, 240), null);
}
{
  const controller = createEditorFieldActivation(); click(controller, 0);
  const mutable = { ...field }; controller.pointerDown(event(120), mutable); mutable.id = "changed externally"; mutable.revision = 99;
  assert.deepEqual(controller.pointerUp(event(160)), field, "press context is snapshotted without cloning the source identity");
}

console.log("Form double-click activation: stable pointer releases, SVG/capture target changes, timing/slop, stale context, modifiers, cancellation and drag rejection passed.");
