import { editorUiTestContext } from "./lib/editorUiTestContext.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
try {
  const { editorSignaturePlacement } = await import("../src/editorSignaturePlacement.ts");
  const { getEditorSignatureInkPaths } = await import("../src/editorSignatures.ts");
  const { fitEditorInkPaths, editorInkBounds, editorInkPathData } = await import("../src/editorInkGeometry.ts");
  const { compileEditorObjectGeometry } = await import("../src/editorSceneObjects.ts");
  const { getScenePrimitive } = await import("../src/scenePrimitives.ts");
  const source = await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8"), nested = source.replace(/^ {2}/gm, "");
  const noop = () => {};
  const close = (actual, expected, label, tolerance = 1e-7) => assert(Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, received ${actual}`);
  const map = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
  const matrix = value => value.match(/^matrix\(([^)]+)\)$/)[1].split(/[ ,]+/).map(Number);
  const curves = Array.from({ length: 101 }, (_, i) => {
    const t = i / 100; return [25 + 120 * t, 30 + 80 * t * (1 - t) + 18 * t];
  });
  // Metadata need not describe the actual path extents, especially with older
  // stored templates. Placement follows fitted ink, including nonzero offsets.
  const irregular = { id: "irregular", name: "Offset handwriting", width: 999, height: 999,
    paths: [[20, 70, 55, 15, 140, 45], [50, 90, 130, 100]] };
  const smoothed = { id: "smooth", name: "Curved handwriting", width: 120, height: 50, smoothing: .3, paths: [curves.flat()] };
  for (const signature of [irregular, smoothed]) {
    const bounds = editorInkBounds(getEditorSignatureInkPaths(signature)), untouched = structuredClone(signature);
    const placement = editorSignaturePlacement(signature, [123, -45], 180);
    const min = map(placement.transform, [bounds.minX, bounds.maxY]), max = map(placement.transform, [bounds.maxX, bounds.minY]);
    close((min[0] + max[0]) / 2, 123, "fitted horizontal center");
    close((min[1] + max[1]) / 2, -45, "fitted vertical center");
    close(max[0] - min[0], 180, "fitted width");
    assert.equal(placement.path, editorInkPathData(getEditorSignatureInkPaths(signature)));
    assert.deepEqual(signature, untouched, "placement never normalizes or mutates the stored template");
  }

  function harness(signature = irregular) {
    const objects = [], selections = [], shapes = [], listeners = new Map(), refreshes = [];
    const rect = { left: 100, top: 50, width: 1000, height: 800, right: 1100, bottom: 850 };
    const buttons = ["select", "rectangle", "ink"].map(tool => ({ dataset: { tool }, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } }));
    buttons.push({ dataset: { action: "signatures" }, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } });
    const properties = { color: { value: "#2a6cb0" }, stroke: { value: "2.75" }, opacity: { disabled: false } };
    let projection = [1, 0, 0, -1, -30, 1010], sceneProjectionMissing = false, clientProjectionMissing = false;
    const host = {
      getCanvas: () => ({ getBoundingClientRect: () => rect }),
      sceneToClientPoint(x, y) {
        if (sceneProjectionMissing) return null;
        const [px, py] = map(projection, [x, y]); return { x: px, y: py };
      },
      clientToScenePoint(x, y) {
        if (clientProjectionMissing) return null;
        const [a, b, c, d, e, f] = projection, det = a * d - b * c;
        return { x: (d * (x - e) - c * (y - f)) / det, y: (-b * (x - e) + a * (y - f)) / det };
      },
      setEditing: noop
    };
    const overlay = { dataset: {}, style: {}, addEventListener(name, listener) { listeners.set(name, listener); }, hasPointerCapture: () => false };
    const context = editorUiTestContext({
      AbortSignal, lifetime: new AbortController(),
      pendingDrawings: { add: noop, visible: () => [], capture: () => undefined }, updateRotationValue: noop,
      editorSignaturePlacement, signature, signatureHover: null, objectOpacity: .6,
      host, overlay, toolbar: { style: {}, querySelectorAll: () => buttons },
      graphic: { setAttribute: noop, replaceChildren() { shapes.length = 0; } },
      svg(tag, attributes) { const element = { tag, ...attributes, style: {} }; shapes.push(element); return element; },
      fields: { hidden: true, querySelectorAll: () => [] }, property: name => properties[name],
      session: { sourceScene: { pageRects: [200, 300, 800, 1100, 1200, -400, 1600, 100] },
        getSelectionBounds: () => null, getSelectionFrame: () => null,
        addObject(object) { objects.push(object); return `signature-${objects.length}`; }, select(ids) { selections.push(Array.from(ids)); } },
      pageLocal: (point, index) => [point.x - context.session.sourceScene.pageRects[index * 4], point.y - context.session.sourceScene.pageRects[index * 4 + 1]],
      displayedSelection: () => ({ frame: null }), isSceneSettling: () => context.settling,
      active: true, disposed: false, running: false, structuralRunning: false, clipboardRunning: false, settling: false,
      tool: "select", toolRequest: 0, textRequest: 0, pendingFieldFocus: null, pointer: null, pendingPick: null, picking: null,
      activeText: null, polygon: null, latestScene: {}, presented: null, fillOpacity: .7,
      currentState: { selection: [] }, updateOpacityControls: noop,
      layerControls: { setActive: noop, dispose: noop }, layerDialog: null,
      contextMenu: { close: noop, dispose: noop },
      cameraPan: { cancel: noop, isPanning: () => false, setActive: noop, dispose: noop }, updateAppearanceControls: noop,
      clearPreview: noop, focusPendingField: noop, renderFields: noop,
      refreshScene: async () => { refreshes.push(objects.length); }, report: error => assert.fail(String(error)),
      finishText: async () => {}, flushEditorFieldDrafts: noop, fieldDrafts: new Map(),
      releaseFrameListener: null, frame: 0,
      document: { body: { classList: { toggle: noop } } }, window: { cancelAnimationFrame: noop }, tick: noop, pointerUp: noop
    });
    for (const name of ["pageAt", "signaturePlacementAt", "drawSignatureGhost", "updatePolygonPreview", "updatePointerCursor", "cancelPointerGesture", "updateGeometry", "setTool", "commit", "placeSignature", "pointerDown", "pointerMove"])
      vm.runInContext(sourceFunction(nested, name), context);
    for (const name of ["pointermove", "pointerenter", "pointerleave", "pointercancel"]) {
      const registration = source.match(new RegExp(`^  overlay\\.addEventListener\\("${name}"[^\\n]+$`, "m"))?.[0];
      assert(registration, `${name}: exercise the real overlay registration`); vm.runInContext(registration.trim(), context);
    }
    const lifecycleStart = source.indexOf("    async setEditing(value, externalSignal) {"), lifecycleEnd = source.indexOf("\n    isEditing:", lifecycleStart);
    assert(lifecycleStart >= 0 && lifecycleEnd > lifecycleStart);
    vm.runInContext(stripTypeScriptTypes(`globalThis.lifecycle = {${source.slice(lifecycleStart, lifecycleEnd)}};`), context);
    context.setTool("signature");
    return {
      context, objects, selections, shapes, buttons, listeners, refreshes, rect, properties, host,
      setView(zoom, degrees, center = [450, 650], client = [420, 360]) {
        const radians = degrees * Math.PI / 180, a = zoom * Math.cos(radians), b = zoom * Math.sin(radians), c = b, d = -a;
        projection = [a, b, c, d, client[0] - a * center[0] - c * center[1], client[1] - b * center[0] - d * center[1]];
      },
      setProjectionMissing(scene, client) { sceneProjectionMissing = scene; clientProjectionMissing = client; },
      event(x, y, pointerType = "mouse") { return { pointerId: 1, button: 0, clientX: x, clientY: y, pointerType,
        target: { closest: () => null, getAttribute: () => null }, preventDefault: noop, stopPropagation: noop }; },
      hover(x, y, type = "mouse") { listeners.get("pointerenter")(this.event(x, y, type)); context.updateGeometry(); },
      ghost() { return shapes.find(shape => shape.class === "hepr-editor-signature-ghost"); }
    };
  }

  const repeated = harness();
  const signatureButton = repeated.buttons.at(-1);
  assert.equal(signatureButton.attributes["aria-pressed"], "true", "the signature action button reflects the active stamping tool");
  assert(repeated.buttons.slice(0, -1).every(button => button.attributes["aria-pressed"] === "false"));
  repeated.setView(1, 0); repeated.hover(420, 360);
  assert(repeated.ghost()); assert.equal(repeated.objects.length, 0); assert.equal(repeated.refreshes.length, 0, "hover does not compile or mutate the document");
  await repeated.context.pointerDown(repeated.event(470, 390));
  await repeated.context.pointerDown(repeated.event(550, 440));
  assert.equal(repeated.objects.length, 2); assert.equal(repeated.context.tool, "signature", "each stamp leaves the signature tool active");
  assert.equal(signatureButton.attributes["aria-pressed"], "true");
  assert.deepEqual(repeated.selections, [["signature-1"], ["signature-2"]]);
  for (const [index, client] of [[0, [470, 390]], [1, [550, 440]]]) {
    const point = repeated.host.clientToScenePoint(...client), bounds = editorInkBounds(fitEditorInkPaths(repeated.objects[index].paths));
    close((bounds.minX + bounds.maxX) / 2 + 200, point.x, "click uses its current horizontal coordinate rather than the prior ghost");
    close((bounds.minY + bounds.maxY) / 2 + 300, point.y, "click uses its current vertical coordinate rather than the prior ghost");
  }
  repeated.context.setTool("rectangle");
  assert.equal(signatureButton.attributes["aria-pressed"], "false");
  assert.equal(repeated.buttons[1].attributes["aria-pressed"], "true"); assert.equal(repeated.context.signatureHover, null);

  for (const signature of [irregular, smoothed]) for (const [zoom, rotation, center, pageIndex] of [
    [.35, 0, [450, 650], 0], [3.5, 90, [450, 650], 0], [12, 213, [1380, -150], 1]
  ]) {
    const h = harness(signature); h.setView(zoom, rotation, center); h.hover(420, 360);
    const ghost = h.ghost(); assert(ghost, "hover produces a projected vector preview");
    assert.equal(h.objects.length, 0); assert.equal(h.refreshes.length, 0);
    assert.equal(ghost.d, editorInkPathData(getEditorSignatureInkPaths(signature)));
    assert.equal(ghost.fill, "none"); assert.equal(ghost.stroke, h.properties.color.value);
    assert.equal(ghost["stroke-linecap"], "round"); assert.equal(ghost["stroke-linejoin"], "round");
    await h.context.pointerDown(h.event(420, 360));
    const object = h.objects[0], scene = await compileEditorObjectGeometry({ ...object, id: "committed", transform: [1, 0, 0, 1, 0, 0] });
    assert.equal(object.pageIndex, pageIndex); assert.equal(object.kind, "signature");
    assert.equal(object.color, ghost.stroke); close(ghost.opacity, object.opacity * .45, "ghost is a translucent version of the committed opacity");
    const canonical = getEditorSignatureInkPaths(signature).flat(), fitted = fitEditorInkPaths(object.paths, object.smoothing ?? 0).flat();
    assert.equal(fitted.length, canonical.length, "placement and compilation keep the canonical curve partition");
    const placement = h.context.signaturePlacementAt(h.host.clientToScenePoint(420, 360));
    close(ghost["stroke-width"] * placement.scale, object.strokeWidth, "projected preview and committed ink have the same page-space thickness");
    close(placement.scale * (editorInkBounds(getEditorSignatureInkPaths(signature)).maxX - editorInkBounds(getEditorSignatureInkPaths(signature)).minX),
      Math.min(180, (pageIndex === 0 ? 600 : 400) * .4), "page width determines signature size");
    const m = matrix(ghost.transform), pages = h.context.session.sourceScene.pageRects;
    for (let i = 0; i < canonical.length; i++) {
      const primitive = getScenePrimitive(scene, { kind: "stroke", index: i }).getSegment(0);
      for (const key of ["start", "control", "end"]) if (canonical[i][key]) {
        const previewPoint = map(m, canonical[i][key]);
        const actual = h.host.sceneToClientPoint(pages[pageIndex * 4] + primitive[key].x, pages[pageIndex * 4 + 1] + primitive[key].y, pageIndex);
        close(previewPoint[0] + h.rect.left, actual.x, `${key}: preview and committed vectors share projected X`, .002);
        close(previewPoint[1] + h.rect.top, actual.y, `${key}: preview and committed vectors share projected Y`, .002);
      }
    }
  }

  const hidden = harness(); hidden.setView(1, 0); hidden.hover(420, 360); assert(hidden.ghost());
  for (const [scene, client] of [[true, false], [false, true]]) {
    hidden.setProjectionMissing(scene, client); hidden.context.updateGeometry(); assert.equal(hidden.ghost(), undefined, "unprojectable pages have no ghost");
  }
  hidden.setProjectionMissing(false, false);
  hidden.hover(hidden.rect.left - 1, 360); assert.equal(hidden.ghost(), undefined, "hover outside the canvas has no ghost");
  hidden.setView(1, 0, [1000, 250]); hidden.hover(420, 360); assert.equal(hidden.ghost(), undefined, "page gaps cannot preview signatures");
  await hidden.context.pointerDown(hidden.event(420, 360)); assert.equal(hidden.objects.length, 0, "page gaps cannot stamp signatures");
  hidden.setView(1, 0); hidden.hover(420, 360);
  hidden.context.running = true; hidden.context.updateGeometry(); assert.equal(hidden.ghost(), undefined, "busy operations hide inactive previews");
  await hidden.context.pointerDown(hidden.event(420, 360)); assert.equal(hidden.objects.length, 0);
  hidden.context.running = false;
  const preparing = harness(); preparing.setView(1, 0); preparing.hover(420, 360);
  preparing.context.settling = true; preparing.context.presented = { sourceScene: preparing.context.session.sourceScene };
  preparing.context.updateGeometry(); assert(preparing.ghost(), "same-source preparation keeps the active signature placement preview");
  await preparing.context.pointerDown(preparing.event(420, 360)); assert.equal(preparing.objects.length, 1, "same-source preparation still allows repeated signature stamping");
  preparing.context.presented = { sourceScene: {} }; preparing.context.updateGeometry();
  assert.equal(preparing.ghost(), undefined, "a stale source cannot preview signatures on new document coordinates");
  await preparing.context.pointerDown(preparing.event(420, 360)); assert.equal(preparing.objects.length, 1, "stale-source preparation cannot stamp onto the wrong document");
  hidden.listeners.get("pointerleave")(); hidden.context.updateGeometry(); assert.equal(hidden.ghost(), undefined); assert.equal(hidden.context.signatureHover, null);
  hidden.hover(420, 360, "touch"); assert.equal(hidden.ghost(), undefined, "touch entry does not create a floating mouse preview");
  hidden.hover(420, 360); hidden.hover(420, 360, "touch");
  assert.equal(hidden.ghost(), undefined, "switching from mouse to touch clears the previous floating preview");
  hidden.hover(420, 360); hidden.listeners.get("pointercancel")(); hidden.context.updateGeometry();
  assert.equal(hidden.ghost(), undefined); assert.equal(hidden.context.signatureHover, null);
  hidden.hover(420, 360); await hidden.context.lifecycle.setEditing(false);
  assert.equal(hidden.context.signatureHover, null); assert.equal(hidden.context.overlay.hidden, true);
  hidden.listeners.get("pointermove")(hidden.event(420, 360)); assert.equal(hidden.context.signatureHover, null, "View mode does not track editor hover");
  await hidden.context.pointerDown(hidden.event(420, 360)); assert.equal(hidden.objects.length, 0, "View mode cannot stamp");
  await hidden.context.lifecycle.setEditing(true); assert.equal(hidden.ghost(), undefined, "returning to Edit cannot revive a stale ghost");
  console.log("Signature placement centers canonical ink, previews matching vectors, and preserves repeated stamping and hover ownership.");
} finally { hooks.deregister(); }
