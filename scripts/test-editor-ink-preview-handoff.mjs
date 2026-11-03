import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEditorDrawingPreviewHarness: harness } = await import("./lib/editorDrawingPreviewHarness.mjs");
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const plain = value => JSON.parse(JSON.stringify(value));

  // The live and released previews use exactly the captured model, in page
  // coordinates, including coalesced samples and the final pointer-up point.
  {
    const h = harness(), c = h.context;
    await c.pointerDown(h.event(1, 10, 20));
    c.pointerMove(h.event(1, 50, 60, [h.event(1, 20, 30)]));
    const live = plain(h.draw());
    assert.equal(live.length, 2); assert.equal(live[0].fill, "rgb(170,187,204)"); assert.equal(live[0]["fill-opacity"], .2);
    assert.equal(live[1].stroke, "rgb(51,102,153)"); assert.equal(live[1]["stroke-opacity"], .6);
    assert.equal(live[1]["stroke-width"], 7, "page-unit pen width scales through the camera matrix");
    assert.equal(live[1].transform, "matrix(2,0,0,-2,20,820)"); assert.equal(live[1]["pointer-events"], "none");
    assert(live[1].d.startsWith("M10 20 "), "ink stores page-local points instead of composed page placement");
    const captured = c.pointer.ink;
    assert.deepEqual(plain(captured.paths[0]), [[10, 20], [20, 30], [50, 60]]);
    // Changing sidebar values mid-gesture cannot change the released ink.
    h.properties.stroke.value = "25"; h.properties.color.value = "red";
    c.pointerUp(h.event(1, 60, 65));
    assert.equal(c.pointer, null); assert.equal(h.objects.size, 1);
    const committed = h.objects.get("ink-1"), released = plain(h.draw());
    assert.deepEqual(plain(committed.paths), [[[10, 20], [20, 30], [50, 60], [60, 65]]]);
    assert.equal(committed.strokeWidth, 7); assert.equal(committed.color, "#369"); assert.equal(committed.smoothing, captured.smoothing);
    assert.equal(released.at(-1)["stroke-width"], 7); assert.equal(released.at(-1).stroke, live.at(-1).stroke);
    assert(released.at(-1).d.endsWith("60 65"));
    await tick(); assert.equal(h.preparations.length, 1); assert.equal(h.paths.length, 2, "released ink remains during compilation");
    h.resolve(0); await tick(); assert.equal(h.applications.length, 1);
    assert.deepEqual(plain(h.draw()), released, "installing a scene before its draw does not hide the stroke");
    h.acknowledge(0); assert.equal(h.paths.length, 0, "matching draw synchronously removes the temporary copy, preventing double opacity");
    h.finish(0); await tick(); assert.equal(h.paths.length, 0); assert.deepEqual(h.errors, []);
  }

  // A second gesture may start while the first canonical scene is being
  // installed. Its overlay belongs to its own later draw, never the old ACK.
  {
    const h = harness(), c = h.context;
    h.properties["fill-enabled"].checked = false;
    await c.pointerDown(h.event(1, 10, 20)); c.pointerMove(h.event(1, 30, 40)); c.pointerUp(h.event(1, 40, 50));
    await tick(); h.resolve(0); await tick(); assert.equal(c.isSceneSettling(), true);
    await c.pointerDown(h.event(2, 80, 100)); assert.equal(c.pointer?.id, 2, "pencil accepts the next stroke while a same-source scene settles");
    c.pointerMove(h.event(2, 100, 120)); c.pointerUp(h.event(2, 110, 130));
    await tick(); h.resolve(1); await tick(); assert.equal(h.applications.length, 1, "host installation remains serialized");
    assert.equal(h.draw().length, 2);
    h.acknowledge(0); assert.equal(h.paths.length, 1, "A-only draw must retain B's pending stroke");
    assert(h.paths[0].d.startsWith("M80 100 "));
    h.finish(0); await tick(); assert.equal(h.applications.length, 2);
    h.acknowledge(1); assert.equal(h.paths.length, 0); h.finish(1); await tick(); assert.deepEqual(h.errors, []);
  }

  // A tap is real round-cap ink. Cancelling another gesture removes only
  // that uncommitted gesture; existing pending ink survives tool changes.
  {
    const h = harness(), c = h.context;
    h.properties["fill-enabled"].checked = false;
    await c.pointerDown(h.event(1, 25, 35)); c.pointerUp(h.event(1, 25, 35)); await tick();
    assert.equal(h.draw()[0].d, "M25 35 L25 35"); assert.equal(h.objects.size, 1);
    await c.pointerDown(h.event(2, 60, 80)); c.pointerMove(h.event(2, 70, 90)); assert.equal(h.draw().length, 2);
    c.cancelPointerGesture(); assert.equal(c.pointer, null); assert.equal(h.draw().length, 1); assert.equal(h.objects.size, 1);
    c.tool = "select"; assert.equal(h.draw().length, 1, "switching tools retains committed previews");
    h.preparations[0].reject(new Error("Synthetic compilation failure")); await tick();
    assert.equal(h.draw().length, 1, "compilation failure retains visible pending ink"); assert.equal(h.errors.length, 1);
    const retry = c.refreshScene(); await tick(); h.resolve(1); await tick(); h.acknowledge(0); h.finish(0); await retry;
    assert.equal(h.paths.length, 0);
  }

  // Invalid sidebar input must be rejected before it can throw in the RAF
  // preview renderer. The next valid gesture still works.
  {
    const h = harness(), c = h.context;
    for (const width of ["-1", "NaN", "Infinity"]) {
      h.properties.stroke.value = width;
      await assert.rejects(c.pointerDown(h.event(1, 10, 20)), /Stroke width/);
      assert.equal(c.pointer, null); assert.equal(h.draw().length, 0);
    }
    h.properties.stroke.value = "3"; await c.pointerDown(h.event(1, 10, 20)); assert.equal(h.draw().at(-1)["stroke-width"], 3);
    c.cancelPointerGesture();
  }

  // Switching to View keeps ink visible until its final draw, then detaches
  // the overlay and editor listeners together. A cancelled exit stays in Edit.
  for (const cancel of [false, true]) {
    const h = harness(), c = h.context, controller = new AbortController(), modeEvents = [];
    Object.assign(c, { fieldDrafts: new Map(), flushEditorFieldDrafts() {}, toolRequest: 0, releaseFrameListener: null,
      contextMenu: { close() {} }, layerControls: { setActive() {} }, layerDialog: null, frame: 0,
      document: { body: { classList: { toggle() {} } } } });
    c.host.setEditing = value => modeEvents.push(value); c.host.onModeChange = () => {};
    await c.pointerDown(h.event(1, 20, 30)); c.pointerUp(h.event(1, 30, 40)); await tick();
    c.overlay.hidden = false; c.toolbar.hidden = false;
    const exit = c.setEditing(false, controller.signal); await tick();
    assert.equal(c.active, true); assert.equal(c.overlay.hidden, false); assert.equal(h.draw().length, 1);
    // Exit supersedes the earlier preparation with the current committed scene.
    h.resolve(0); h.resolve(1); await tick(); assert.equal(h.applications.length, 1);
    if (cancel) {
      controller.abort(); h.acknowledge(0); h.finish(0);
      await assert.rejects(exit, { name: "AbortError" });
      assert.equal(c.active, true); assert.equal(c.overlay.hidden, false); assert.equal(h.draw().length, 1);
      assert.deepEqual(modeEvents, []);
    } else {
      h.acknowledge(0); assert.equal(h.paths.length, 0); h.finish(0); await exit;
      assert.equal(c.active, false); assert.equal(c.overlay.hidden, true); assert.deepEqual(modeEvents, [false]);
    }
  }
  console.log("Ink UI handoff: matching live/released appearance, local coordinates, coalesced/final samples, rapid strokes, draw ACKs, cancellation, taps and retries passed.");
} finally { hooks.deregister(); }
