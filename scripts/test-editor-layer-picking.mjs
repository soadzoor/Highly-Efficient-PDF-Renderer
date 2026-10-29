import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";

const source = await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8");
const ranks = new Map([["note", 1], ["source:stroke:0", 5], ["annotation:field", 3]]), hidden = new Set();
const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 }, scene = { annotations: [{ id: "field" }] };
let hit = { primitive: { kind: "stroke", index: 0 } }, reordered = true, objectOrderChanged = false;
const context = vm.createContext({
  session: {
    sourceScene: scene, getObjects: () => [{ id: "note", kind: "rectangle", pageIndex: 0 }], getSourceEdits: () => [],
    getLayerEdits: () => ({ stackingChanged: reordered, objectOrderChanged }), getObjectPaintRank: id => ranks.get(id) ?? -1,
    getPrimitivePaintRank: ref => ranks.get(`source:${ref.kind}:${ref.index}`) ?? -1,
    isObjectVisible: id => !hidden.has(id), isAnnotationVisible: id => !hidden.has(`annotation:${id}`),
    isPrimitiveVisible: () => true, getObjectBounds: () => box
  },
  IDENTITY: [1, 0, 0, 1, 0, 0], getSceneAnnotationRuns: () => new Map(),
  editorBoundsClickHit: (bounds, point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY,
  host: { sceneToClientPoint: (x, y) => ({ x, y }), clientToScenePoint: (x, y) => ({ x, y }) },
  latestScene: scene, pickEditorMetadataAnnotation: annotations => annotations[0]?.id,
  picker: { async pick(options) { if (hit) assert.equal(options.resolvePaintRank(hit.primitive), ranks.get("source:stroke:0")); return hit; } },
  picking: null, AbortController, AbortSignal, lifetime: new AbortController()
});
vm.runInContext(sourceFunction(source.replace(/^ {2}/gm, ""), "pick"), context);
const point = { x: 5, y: 5 };
assert.equal(await context.pick(point, point), "source:stroke:0", "front source artwork wins over an added object's bounds");
ranks.set("note", 6);
assert.equal(await context.pick(point, point), "note", "front authored object wins after layer reorder");
hidden.add("note");
assert.equal(await context.pick(point, point), "source:stroke:0", "hidden authored objects cannot intercept clicks");
hit = null;
assert.equal(await context.pick(point, point), "annotation:field", "metadata-only form widgets participate in stacking");
hidden.add("annotation:field");
assert.equal(await context.pick(point, point), null, "hidden fields cannot intercept clicks");
hidden.clear(); reordered = false;
assert.equal(await context.pick(point, point), "note", "ordinary source order keeps its existing fast path");
objectOrderChanged = true; hit = { primitive: { kind: "stroke", index: 0 } }; ranks.set("note", 1);
assert.equal(await context.pick(point, point), "source:stroke:0", "within-layer object order uses current ranks even when the OCG list was never reordered");
console.log("Layer-reordered editor picking respects source, authored and metadata annotation ranks and visibility.");

let layerRevision = 0, layerReads = 0, removals = [], visible = false;
const draft = { layerId: "A", height: 30, element: { hidden: false, scrollHeight: 70 } };
const draftContext = vm.createContext({ activeText: draft, draftLayerRevision: -1, draftLayers: new Map(), session: {
  getLayerRevision: () => layerRevision,
  getLayers: () => { layerReads++; return [{ id: "A", defaultVisible: visible }, { id: "B", defaultVisible: true }]; },
  getLayerEdits: () => ({ removals }), isObjectVisible: () => visible, isAnnotationVisible: () => visible
} });
vm.runInContext(sourceFunction(source.replace(/^ {2}/gm, ""), "updateTextVisibility"), draftContext);
assert.equal(draftContext.updateTextVisibility(), false); assert(draft.element.hidden);
assert.equal(draft.hiddenHeight, 70, "hiding a draft retains its measured text height");
draftContext.updateTextVisibility(); assert.equal(layerReads, 1, "unchanged frames reuse layer eligibility");
visible = true; layerRevision++;
assert(draftContext.updateTextVisibility()); assert(!draft.element.hidden); assert.equal(draft.hiddenHeight, undefined);
removals = [{ id: "A", targetLayerId: "B" }]; layerRevision++;
assert(draftContext.updateTextVisibility()); assert.equal(draft.layerId, "B", "layer removal retargets a new draft without losing its text");
draftContext.activeText = { ...draft, objectId: "existing", layerId: undefined };
visible = false; assert.equal(draftContext.updateTextVisibility(), false, "existing drafts use the object's current membership");
draftContext.activeText = { ...draft, sourceAnnotationId: "saved-text", layerId: undefined };
assert.equal(draftContext.updateTextVisibility(), false, "reopened annotation drafts follow their actual source membership");
