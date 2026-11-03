import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEditorPendingDrawings } = await import("../src/editorPendingDrawings.ts");
  const objects = new Map(), hidden = new Set(); let revision = 0, sourceScene = {}, reads = 0;
  const session = { get sourceScene() { return sourceScene; }, get revision() { return revision; },
    getObject(id) { reads++; if (!objects.has(id)) throw new Error("Unknown object"); return structuredClone(objects.get(id)); },
    isObjectVisible: id => !hidden.has(id) };
  const pending = createEditorPendingDrawings(session);
  const add = (id, kind = "ink", shape = "rectangle") => {
    objects.set(id, { id, kind, pageIndex: 0, transform: [1, 0, 0, 1, 0, 0], color: "black", strokeWidth: 4, opacity: .5,
      ...(kind === "shape" ? { shape, x: 0, y: 0, width: 20, height: 15, points: [[0, 0], [10, 15], [20, 0]], fill: "#abc", fillOpacity: .25 }
        : { paths: [[[0, 0], [10, 15], [20, 0]]], smoothing: .2 }) });
    revision++; pending.add(id);
  };
  const ids = () => pending.visible().map(entry => entry.object.id);
  assert.equal(pending.capture(), undefined); assert.deepEqual(ids(), []); assert.equal(reads, 0);
  add("A"); const first = pending.capture();
  assert.deepEqual(ids(), ["A"]);
  const copied = reads;
  for (let i = 0; i < 10; i++) { pending.reconcile(); pending.capture(); pending.visible(); }
  assert.equal(reads, copied, "camera-only updates never deep-copy every pending path");
  add("B"); const both = pending.capture();
  pending.acknowledge(first); assert.deepEqual(ids(), ["B"], "an A-only frame cannot remove the newer B preview");
  pending.acknowledge(both); assert.deepEqual(ids(), []);

  add("Style"); const oldStyle = pending.capture(), originalPaths = pending.visible()[0].object.paths;
  objects.get("Style").strokeWidth = 8; revision++; pending.reconcile();
  assert.equal(pending.visible()[0].object.paths, originalPaths, "style changes reuse unchanged centerline data");
  assert.equal(pending.visible()[0].object.strokeWidth, 8);
  pending.acknowledge(oldStyle); assert.deepEqual(ids(), ["Style"], "an older style cannot clear the current preview");
  pending.acknowledge(pending.capture()); assert.deepEqual(ids(), []);

  add("Moved"); const beforeMove = pending.capture();
  objects.get("Moved").transform = [0, 1, -1, 0, 50, 70]; revision++; pending.reconcile();
  pending.acknowledge(beforeMove); assert.deepEqual(ids(), ["Moved"]);
  assert.deepEqual(pending.visible()[0].object.transform, [0, 1, -1, 0, 50, 70]);
  hidden.add("Moved"); assert.deepEqual(ids(), [], "hidden layers suppress the temporary stroke");
  hidden.delete("Moved"); assert.deepEqual(ids(), ["Moved"]);
  const beforeDelete = pending.capture(); objects.delete("Moved"); revision++; pending.reconcile();
  pending.acknowledge(beforeDelete); assert.deepEqual(ids(), [], "undo/delete cannot leave a temporary stroke behind");

  add("Old source"); const oldSource = pending.capture(); sourceScene = {}; pending.reconcile();
  add("New source"); pending.acknowledge(oldSource);
  assert.deepEqual(ids(), ["New source"], "source replacement invalidates old coordinates and acknowledgements");
  pending.acknowledge(undefined); assert.deepEqual(ids(), ["New source"], "failed or missing publication cannot hide pending ink");
  pending.clear(); assert.deepEqual(ids(), []); assert.equal(pending.capture(), undefined);

  add("Rectangle", "shape"); const rectangleFrame = pending.capture(), rectangle = pending.visible()[0], shapeCache = rectangle.geometry;
  const originalRectangle = shapeCache.get(rectangle.object);
  assert(originalRectangle.paths.length > 0, "shapes use shape geometry rather than an ink centerline fitter");
  add("Signature", "signature"); const mixedFrame = pending.capture();
  assert.deepEqual(ids(), ["Rectangle", "Signature"]);
  objects.get("Rectangle").color = "red"; objects.get("Rectangle").width = 40;
  objects.get("Rectangle").transform = [0, 2, -1, 0, 50, 70]; revision++; pending.reconcile();
  const changedRectangle = pending.visible()[0];
  assert.equal(changedRectangle.geometry, shapeCache, "shape edits retain the local geometry cache");
  assert.notEqual(shapeCache.get(changedRectangle.object).paths[0].d, originalRectangle.paths[0].d, "resizing invalidates cached shape geometry");
  pending.acknowledge(rectangleFrame); assert.deepEqual(ids(), ["Rectangle", "Signature"], "a stale rectangle frame cannot hide its new pose or a newer signature");
  pending.acknowledge(mixedFrame); assert.deepEqual(ids(), ["Rectangle"], "a mixed frame removes only drawing versions it actually presents");
  pending.acknowledge(pending.capture()); assert.deepEqual(ids(), []);

  add("Signature style", "signature"); const signatureFrame = pending.capture(), signature = pending.visible()[0];
  const originalSignaturePaths = signature.object.paths, signatureCache = signature.geometry;
  assert(signatureCache.get(signature.object).paths.length > 0, "signatures use the ink preview geometry");
  objects.get("Signature style").strokeWidth = 9; objects.get("Signature style").color = "blue"; revision++; pending.reconcile();
  assert.equal(pending.visible()[0].object.paths, originalSignaturePaths, "signature style changes preserve the fitted centerline identity");
  assert.equal(pending.visible()[0].geometry, signatureCache);
  pending.acknowledge(signatureFrame); assert.deepEqual(ids(), ["Signature style"]);
  hidden.add("Signature style"); assert.deepEqual(ids(), []); hidden.clear();
  const deletedSignature = pending.capture(); objects.delete("Signature style"); revision++; pending.reconcile();
  pending.acknowledge(deletedSignature); assert.deepEqual(ids(), []);

  for (const shape of ["rectangle", "ellipse", "line", "arrow", "polygon", "polyline"]) add(shape, "shape", shape);
  assert.equal(ids().length, 6);
  for (const entry of pending.visible()) assert(entry.geometry.get(entry.object).paths.length > 0, `${entry.object.shape} has preview geometry`);
  const drawingReads = reads;
  for (let i = 0; i < 10; i++) { pending.reconcile(); pending.capture(); pending.visible(); }
  assert.equal(reads, drawingReads, "camera-only updates do not clone any drawing family");
  hidden.add("ellipse"); assert(!ids().includes("ellipse")); hidden.clear();
  const allShapes = pending.capture(); objects.delete("line"); objects.get("polygon").kind = "image"; revision++; pending.reconcile();
  assert.deepEqual(ids(), ["rectangle", "ellipse", "arrow", "polyline"], "deleted or no-longer-drawing objects cannot retain overlays");
  pending.add("polygon"); assert.deepEqual(ids(), ["rectangle", "ellipse", "arrow", "polyline"], "image/text/source objects do not enter the pending-drawing registry");
  pending.acknowledge(allShapes); assert.deepEqual(ids(), []);

  add("Switch family", "shape"); const oldFamilyCache = pending.visible()[0].geometry;
  objects.set("Switch family", { id: "Switch family", kind: "signature", pageIndex: 0, transform: [1, 0, 0, 1, 0, 0], paths: [[[0, 0], [5, 10]]] });
  revision++; pending.reconcile();
  assert.notEqual(pending.visible()[0].geometry, oldFamilyCache, "changing geometry family selects a compatible cache");
  assert(pending.visible()[0].geometry.get(pending.visible()[0].object).paths.length > 0);
  const priorSourceShapes = pending.capture(); sourceScene = {}; pending.reconcile();
  add("New shape", "shape"); pending.acknowledge(priorSourceShapes);
  assert.deepEqual(ids(), ["New shape"]); pending.clear(); assert.equal(pending.capture(), undefined);
  console.log("Pending drawings: mixed ink/shapes/signatures, matching draw ownership, geometry caches, rapid edits, visibility, undo/delete, source changes and idle costs passed.");
} finally { hooks.deregister(); }
