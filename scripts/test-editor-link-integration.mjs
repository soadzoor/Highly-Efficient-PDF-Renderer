import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { editorUiTestContext } from "./lib/editorUiTestContext.mjs";
const hooks = registerHooks({ resolve(s, c, n) { return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c); } });
try {
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { editorLinkSelectionOwner } = await import("../src/editorLinks.ts");
  const { pickEditorMetadataAnnotation, editorBoundsClickHit } = await import("../src/editorCoordinates.ts");
  const { getSceneAnnotationRuns } = await import("../src/scenePrimitives.ts");
  const source = (await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8")).replace(/^ {2}/gm, ""), identity = [1, 0, 0, 1, 0, 0];
  const scene = buildStrokeScene([{ points: [[0, 0], [100, 100]], width: 1 }]); scene.pageRects = Float32Array.of(0, 0, 100, 100);
  const session = createEditorSession(scene);
  const owner = session.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 10, y: 10, width: 20, height: 10, fill: "yellow", strokeWidth: 0 });
  const target = session.addObject({ kind: "shape", shape: "ellipse", pageIndex: 0, x: 60, y: 60, width: 20, height: 20, fill: "red" });
  session.select([owner]);
  try {
    const knownObjects = session.getObjects, generated = { id: `editor-link:${encodeURIComponent(owner)}`, name: `editor-link:${encodeURIComponent(owner)}`, subtype: "Link", pageIndex: 0,
      bounds: { minX: 10, minY: 10, maxX: 30, maxY: 20 }, visibleInDefaultView: true };
    session.getObjects = () => [];
    const picking = editorUiTestContext({ session, IDENTITY: identity, latestScene: { ...scene, annotations: [generated] }, editorLinkSelectionOwner, getSceneAnnotationRuns,
      pickEditorMetadataAnnotation, editorBoundsClickHit, picker: null, picking: null, lifetime: new AbortController(),
      ScenePrimitivePicker: class { async pick() { return null; } },
      host: { sceneToClientPoint: (x, y) => ({ x, y }), clientToScenePoint: (x, y) => ({ x, y }) } });
    vm.runInContext(sourceFunction(source, "pick"), picking);
    assert.equal(await picking.pick({ x: 20, y: 15 }, { x: 20, y: 15 }), owner, "metadata links select their visual owner rather than phantom annotation IDs");
    picking.latestScene.annotations = [{ ...generated, id: "editor-link:missing", name: "editor-link:missing" }];
    assert.equal(await picking.pick({ x: 20, y: 15 }, { x: 20, y: 15 }), null, "orphan generated metadata does not fabricate a selectable object");
    session.getObjects = knownObjects;

    const captures = new Set(), chosen = [], statuses = []; let resolvePick, xShift = 0, state = true;
    const context = editorUiTestContext({ session, active: true, tool: "select", textRequest: 0, pointer: null, pendingPick: null, activeText: null,
      overlay: { setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) },
      host: { clientToScenePoint: (x, y) => ({ x: x - xShift, y }), sceneToClientPoint: (x, y) => ({ x: x + xShift, y }) },
      links: { isPicking: () => state, pickTarget: id => chosen.push(id) }, cameraPan: { isPanning: () => false }, isSceneSettling: () => false,
      pick: () => new Promise(resolve => { resolvePick = resolve; }), updatePointerCursor() {}, updateLinkButtons() {}, setStatus: text => statuses.push(text) });
    vm.runInContext(sourceFunction(source, "pickLinkTarget"), context);
    const pointer = () => ({ button: 0, pointerId: 3, clientX: 70, clientY: 70, preventDefault() {}, stopPropagation() {} });
    const initial = session.getSelection();
    let work = context.pickLinkTarget(pointer()); resolvePick(target); await work;
    assert.deepEqual(chosen, [target]); assert.deepEqual(session.getSelection(), initial); assert.equal(captures.size, 0);
    work = context.pickLinkTarget(pointer()); xShift = 20; resolvePick(target); await work;
    assert.equal(chosen.length, 1, "a camera change invalidates asynchronous target picking"); assert.equal(context.pendingPick, null); xShift = 0;
    work = context.pickLinkTarget(pointer()); session.updateObject(target, { color: "blue" }); resolvePick(target); await work;
    assert.equal(chosen.length, 1, "document edits invalidate asynchronous target picking");
    work = context.pickLinkTarget(pointer()); state = false; resolvePick(target); await work; assert.equal(chosen.length, 1, "cancelled target picking cannot return into the dialog"); state = true;
    work = context.pickLinkTarget(pointer()); resolvePick(null); await work; assert(statuses.at(-1).startsWith("No object")); assert.equal(chosen.length, 1);
    const busy = [], switches = []; let cancelled = 0;
    const transitions = editorUiTestContext({ pointer: null, pendingPick: null, polygon: { points: [] }, signatureHover: {}, recoveryRunning: false,
      overlay: { dataset: {} }, contextMenu: { close() {} }, cameraPan: { isPanning: () => false },
      host: { onBusyChange: value => busy.push(value) }, cancelPointerGesture() { cancelled++; transitions.pendingPick = null; },
      setTool: (...args) => switches.push(args), updateLinkButtons() {} });
    vm.runInContext(sourceFunction(source, "linkPickingChanged"), transitions);
    transitions.linkPickingChanged(true); assert.equal(cancelled, 1); assert.deepEqual(switches, [["select", true]], "starting target picking changes tools without recursively cancelling the picker");
    assert.equal(transitions.overlay.dataset.linkPicking, "true"); assert.equal(transitions.polygon, null);
    transitions.pendingPick = {}; transitions.linkPickingChanged(false); assert.equal(cancelled, 2, "Escape aborts an in-flight asynchronous pick before returning to the dialog");
    assert.equal(transitions.overlay.dataset.linkPicking, "false"); assert.deepEqual(busy, [true, false]);
    const saved = editorUiTestContext({ links: { isOpen: () => true }, setStatus: text => statuses.push(text), session,
      recoveryRunning: false, recoveryDialog: null, passwordDialog: null });
    vm.runInContext(sourceFunction(source, "save"), saved); await saved.save("pdf"); assert(statuses.at(-1).includes("pending link"), "saving cannot omit an unfinished link dialog");
    assert(source.includes('link: links.getDraft()')); assert(source.includes('links.restoreDraft(draft.link)'));
    console.log("Link integration: generated owner picking, preserved source selection, camera/document/cancel guards, pending-save blocking and recovery wiring passed.");
  } finally { session.dispose(); }
} finally { hooks.deregister(); }
