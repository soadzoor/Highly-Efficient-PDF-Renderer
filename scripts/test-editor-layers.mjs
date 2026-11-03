import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
try {
  const { editorLayerCatalog, removeEditorLayer, setEditorLayerOrder } = await import("../src/editorLayers.ts");
  const { createDefaultOptionalContentSnapshot } = await import("../src/optionalContent.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { getScenePrimitive } = await import("../src/scenePrimitives.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const group = (id, extra = {}) => ({ id, name: id, defaultVisible: true, locked: false, usedInView: true, ...extra });
  const catalog = editorLayerCatalog({ groups: [group("A"), group("B"), group("internal", { annotationId: "field", locked: true, usedInView: false })],
    conditions: [{ kind: "group", groupId: "A" }, { kind: "group", groupId: "B" }, { kind: "not", operand: 0 },
      { kind: "and", operands: [0, 1] }, { kind: "and", operands: [0, 2] }, { kind: "or", operands: [0, 1] }],
    order: [{ kind: "label", label: "Source", children: [{ kind: "group", groupId: "A" }] }, { kind: "group", groupId: "B" }], radioGroups: [] });
  const forgetting = removeEditorLayer(catalog, "A", null);
  for (const enabled of [false, true]) {
    const scene = buildStrokeScene([]); scene.optionalContent = { ...forgetting, groups: forgetting.groups.map(value => value.id === "B" ? { ...value, defaultVisible: enabled } : value) };
    assert.deepEqual([...createDefaultOptionalContentSnapshot(scene).conditions].slice(0, 6), [1, Number(enabled), 1, Number(enabled), 0, 1],
      "forgetting a layer preserves both polarities and correlations inside composite membership expressions");
  }
  assert.throws(() => removeEditorLayer(catalog, "internal", null), /Unknown PDF layer/);
  assert.throws(() => removeEditorLayer(catalog, "A", "A"), /different/);
  const cyclic = []; cyclic.push({ kind: "label", label: "Cycle", children: cyclic });
  assert.throws(() => setEditorLayerOrder(catalog, cyclic), /cyclic/i);

  const source = buildStrokeScene([{ points: [[0, 0], [10, 10]], width: 1 }, { points: [[20, 0], [30, 10]], width: 1 }, { points: [[40, 0], [50, 10]], width: 1 }]);
  source.optionalContent = catalog; source.drawRuns = [{ kind: "stroke", first: 0, count: 1, optionalContent: 0 },
    { kind: "stroke", first: 1, count: 1, optionalContent: 1 }, { kind: "stroke", first: 2, count: 1 }];
  const editor = await openEditorSession(source);
  const shape = (extra = {}) => ({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 2, y: 2, width: 4, height: 4, fill: "red", ...extra });
  try {
    assert.deepEqual(editor.getLayers().map(layer => layer.id), ["A", "B"]);
    assert.equal(editor.getState().dirty, false);
    editor.setActiveLayer("A"); assert.equal(editor.getState().dirty, false); assert.equal(editor.getState().canUndo, false);
    const child = editor.createLayer({ name: "  注釈 Ω  ", parentId: "A", index: 0 });
    assert.equal(editor.getLayers().find(layer => layer.id === child).name, "注釈 Ω"); assert(editor.getState().dirty);
    assert(editor.undo()); assert(!editor.getLayers().some(layer => layer.id === child)); assert(editor.redo());
    assert.throws(() => editor.moveLayer("A", { parentId: child, index: 0 }), /descendant/i);
    editor.moveLayer(child, { parentId: null, index: 0 }); assert.equal(editor.getLayerEdits().stackingChanged, true);
    assert.equal(editor.getLayerOrder()[0].groupId, child);
    const before = editor.revision;
    assert.throws(() => editor.setLayerOrder([{ kind: "group", groupId: child }]), /every/);
    assert.throws(() => editor.setLayerOrder([{ kind: "group", groupId: "A" }, { kind: "group", groupId: "A" }, { kind: "group", groupId: "B" }, { kind: "group", groupId: child }]), /once/);
    assert.equal(editor.revision, before, "invalid layer operations leave history untouched");
    const beforeRollback = editor.getLayerRevision(), layerCount = editor.getLayers().length;
    assert.throws(() => editor.transaction("Rollback layers", () => { editor.createLayer({ name: "Aborted" }); throw new Error("Abort edit"); }), /Abort edit/);
    assert.equal(editor.getLayers().length, layerCount); assert.equal(editor.getLayerRevision(), beforeRollback);
    editor.updateLayer("A", { locked: true });
    assert.throws(() => editor.updateLayer("A", { defaultVisible: false }), /Unlock/);
    const id = editor.addObject(shape()); assert.equal(editor.getObject(id).layerId, "A", "locked visibility does not lock content authoring");
    editor.select([id]); const layerRevision = editor.getLayerRevision();
    editor.setPreviewTransform([1, 0, 0, 1, 2, 3]); editor.setPreviewTransform(null); editor.transformSelection([1, 0, 0, 1, 1, 0]);
    assert.equal(editor.getLayerRevision(), layerRevision, "pointer previews and geometry transforms do not rebuild layer catalogs");
    editor.updateLayer("A", { locked: false, defaultVisible: false });
    assert(!editor.isObjectVisible(id)); assert.equal(editor.getSelection().length, 0);
    assert.throws(() => editor.addObject(shape()), /active layer/);
    const hidden = editor.addObject(shape({ layerId: "A" })); assert(!editor.isObjectVisible(hidden), "explicit API assignments may target a hidden layer");
    const unlayered = editor.addObject(shape({ layerId: null })); assert.deepEqual(editor.getObjectLayerIds(unlayered), []);
    editor.selectPrimitives([{ kind: "stroke", index: 0 }]); const sourceId = editor.getSelection()[0];
    editor.assignSelectionToLayer(child); assert.deepEqual(editor.getObjectLayerIds(sourceId), [child]); assert(editor.isPrimitiveVisible({ kind: "stroke", index: 0 }));
    editor.selectPrimitives([{ kind: "stroke", index: 0 }]); const [clone] = editor.cloneSelection([0, 0]);
    editor.assignObjectsToLayer([sourceId], "B");
    assert.deepEqual(editor.getObjectLayerIds(clone), [child], "a source clone retains its own captured membership when the original is reassigned");
    assert.equal(editor.getObjectLayerEdits(clone).sourceAssignments.find(value => value.ref.index === 0).layerId, child);
    editor.updateLayer(child, { defaultVisible: false }); assert(!editor.isObjectVisible(clone)); assert(editor.isObjectVisible(sourceId));
    assert(editor.getLayerObjects(child).includes(clone)); editor.selectLayerContents(child);
    assert.equal(editor.getSelection().length, 0, "selecting layer contents skips hidden objects while membership queries remain inclusive");
    editor.selectArea({ minX: -100, minY: -100, maxX: 100, maxY: 100 });
    assert(!editor.getSelection().includes(id) && !editor.getSelection().includes(hidden) && !editor.getSelection().includes(clone),
      "area selection filters cached source objects and author objects using current edited visibility");
    editor.updateLayer(child, { defaultVisible: true }); editor.assignObjectsToLayer([unlayered], child);
    assert(editor.getLayerObjects(child).includes(unlayered));
    editor.selectLayerContents(child); assert(editor.getSelection().includes(unlayered));
    const copy = editor.getLayerEdits(); copy.catalog.groups[0].name = "mutated";
    assert.notEqual(editor.getLayers()[0].name, "mutated", "public layer snapshots are detached");
    editor.removeLayer(child, { targetLayerId: "B" }); assert.deepEqual(editor.getObjectLayerIds(unlayered), ["B"]); assert(editor.undo());
    assert.deepEqual(editor.getObjectLayerIds(unlayered), [child]);
    const result = await editor.getScene({ preview: false }), again = await editor.getScene({ preview: false }); assert.equal(result, again);
    assert(result.optionalContent.groups.some(layer => layer.id === child));
    const hep = await editor.saveHep({ withVectorLod: false, withTextLod: false, encodeRasterImages: false });
    const restored = await loadSceneFromHep(await hep.arrayBuffer()), reopened = await openEditorSession(restored);
    try { assert.equal(reopened.getLayers().find(layer => layer.id === child).name, "注釈 Ω"); assert(reopened.getLayerObjects(child).length > 0); }
    finally { reopened.dispose(); }
  } finally { editor.dispose(); }

  const ranked = await openEditorSession(source);
  try {
    const id = ranked.createLayer({ name: "Added" }), object = ranked.addObject(shape({ layerId: id }));
    assert.equal(ranked.getLayerEdits().stackingChanged, false, "creating a layer does not reorder existing paint");
    const unlayeredRank = ranked.getPrimitivePaintRank({ kind: "stroke", index: 2 });
    ranked.moveLayer("B", { parentId: null, index: 0 });
    ranked.selectPrimitives([{ kind: "stroke", index: 1 }]); const sourceId = ranked.getSelection()[0];
    assert.equal(ranked.getObjectPaintRank(sourceId), ranked.getPrimitivePaintRank({ kind: "stroke", index: 1 }),
      "source object picking uses its real primitive paint rank rather than an absent authored placeholder");
    assert(ranked.getPrimitivePaintRank({ kind: "stroke", index: 1 }) > ranked.getObjectPaintRank(object),
      "source and authored object picking share the reordered top-layer/frontmost paint ranking");
    assert.equal(ranked.getPrimitivePaintRank({ kind: "stroke", index: 2 }), unlayeredRank, "restacking preserves unlayered source slots");
    assert(ranked.undo()); assert.equal(ranked.getLayerEdits().stackingChanged, false);
  } finally { ranked.dispose(); }

  const metadataOnly = await openEditorSession({ ...source, annotations: [{ id: "field", pageIndex: 0, sourcePageIndex: 0, annotationIndex: 0,
    subtype: "Widget", pdfGeometry: { rect: [2, 2, 6, 6] }, bounds: { minX: 2, minY: 2, maxX: 6, maxY: 6 },
    flags: 4, visibleInDefaultView: true, hasAppearance: false, optionalContent: 1, field: { type: "Tx", name: "Field", flags: 0 } }] });
  try {
    const author = metadataOnly.addObject(shape({ layerId: "A" })); metadataOnly.moveLayer("B", { parentId: null, index: 0 });
    assert(metadataOnly.getObjectPaintRank("annotation:field") > metadataOnly.getObjectPaintRank(author),
      "metadata-only form controls retain a selectable annotation-plane paint rank");
    metadataOnly.assignObjectsToLayer(["annotation:field"], "A"); metadataOnly.updateLayer("A", { defaultVisible: false });
    assert(!metadataOnly.isAnnotationVisible("field") && !metadataOnly.isObjectVisible("annotation:field"),
      "metadata-only field controls use current assigned layer visibility");
  } finally { metadataOnly.dispose(); }

  let release, started;
  const ready = new Promise(resolve => { started = resolve; }), proceed = new Promise(resolve => { release = resolve; });
  let owner;
  const saving = await openEditorSession(source, { savePdf: async (_scene, snapshot) => { owner = snapshot; started(); await proceed; return new Blob(["PDF"]); } });
  try {
    const layer = saving.createLayer({ name: "Captured layer" }), object = saving.addObject(shape({ layerId: layer }));
    const pending = saving.savePdf(); await ready;
    saving.updateLayer(layer, { name: "Live layer" }); saving.assignObjectsToLayer([object], "B");
    assert.equal(owner.getLayers().find(value => value.id === layer).name, "Captured layer");
    assert.deepEqual(owner.getObjectLayerIds(object), [layer]); assert.equal(owner.getLayerEdits().catalog.groups.find(value => value.id === layer).name, "Captured layer");
    const membership = owner.getObjectLayerCondition(object);
    assert.equal(membership.catalog.conditions[membership.condition].groupId, layer, "readonly export resolves the captured object membership rather than live reassignment");
    assert.throws(() => owner.updateLayer(layer, { name: "Rejected" }), /read-only/);
    assert.throws(() => owner.setActiveLayer(layer), /read-only/);
    assert.throws(() => owner.copyObjectLayerMembership(object, object), /read-only/);
    release(); await pending; assert(saving.getState().dirty, "a concurrent layer edit is not marked saved by an older snapshot export");
  } finally { release(); saving.dispose(); }

  const radio = await openEditorSession({ ...source, optionalContent: { ...catalog, groups: catalog.groups.map(layer => layer.id === "B" ? { ...layer, defaultVisible: false } : layer), radioGroups: [["A", "B"]] } });
  try { radio.updateLayer("B", { defaultVisible: true }); assert.equal(radio.getLayers().find(layer => layer.id === "A").defaultVisible, false); }
  finally { radio.dispose(); }
  const nonView = await openEditorSession({ ...source, optionalContent: { ...catalog, groups: catalog.groups.map(layer => layer.id === "B" ? { ...layer, usedInView: false } : layer) } });
  try { assert.throws(() => nonView.updateLayer("B", { defaultVisible: false }), /intent|visibility/i); }
  finally { nonView.dispose(); }

  const compoundSource = { ...source, optionalContent: { groups: [group("A"), group("B", { defaultVisible: false }), group("owner", { annotationId: "saved-text" })],
    conditions: [{ kind: "group", groupId: "A" }, { kind: "group", groupId: "B" }, { kind: "group", groupId: "owner" },
      { kind: "not", operand: 1 }, { kind: "and", operands: [0, 3] }, { kind: "and", operands: [4, 2] }],
    order: [{ kind: "group", groupId: "A" }, { kind: "group", groupId: "B" }], radioGroups: [] },
    annotations: [{ id: "saved-text", pageIndex: 0, sourcePageIndex: 0, annotationIndex: 0, subtype: "FreeText", flags: 0,
      visibleInDefaultView: true, hasAppearance: false, pdfGeometry: { rect: [0, 0, 10, 10] }, optionalContent: 5,
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } }] };
  const compound = await openEditorSession(compoundSource);
  try {
    compound.setActiveLayer("B");
    let replacement;
    compound.transaction("Replace layered textbox", () => {
      compound.selectAnnotations(["saved-text"]); compound.deleteSelection();
      replacement = compound.addObject(shape({ layerId: null }));
      compound.copyObjectLayerMembership("annotation:saved-text", replacement);
    });
    assert.deepEqual(compound.getObjectLayerIds(replacement), ["A", "B"]);
    assert.equal(compound.getObject(replacement).layerId, undefined, "compound copying does not silently reduce membership to the active layer");
    assert(compound.isObjectVisible(replacement), "a hidden active layer does not block editing a visible annotation on another membership");
    const savedCondition = compound.getObjectLayerCondition(replacement);
    assert.equal(savedCondition.catalog.conditions[savedCondition.condition].kind, "and");
    const scene = await compound.getScene({ preview: false });
    assert(scene.drawRuns.some(run => run.optionalContent !== undefined), "compiled replacement retains its visibility expression");
    compound.updateLayer("B", { defaultVisible: true }); assert(!compound.isObjectVisible(replacement), "Not B remains a negated visibility condition");
    assert(compound.undo()); assert(compound.isObjectVisible(replacement));
    compound.select([replacement]); const [clone] = compound.cloneSelection([2, 2]);
    assert.deepEqual(compound.getObjectLayerIds(clone), ["A", "B"]); assert(compound.isObjectVisible(clone));
    compound.assignObjectsToLayer([clone], "B"); assert.equal(compound.getObject(clone).layerCondition, undefined); assert(!compound.isObjectVisible(clone));
    compound.removeLayer("A"); assert.deepEqual(compound.getObjectLayerIds(replacement), ["B"]); assert(compound.isObjectVisible(replacement));
    compound.updateLayer("B", { defaultVisible: true }); assert(!compound.isObjectVisible(replacement));
    compound.removeLayer("B"); assert(compound.isObjectVisible(replacement), "removing every source layer existentially preserves the edited content");
    assert(compound.undo()); assert(!compound.isObjectVisible(replacement));
    assert.throws(() => compound.addObject(shape({ layerCondition: -1 })), /condition/);
    assert.throws(() => compound.addObject({ kind: "group", pageIndex: 0, children: [replacement], layerCondition: 0 }), /contents/);
    assert.throws(() => compound.copyObjectLayerMembership("source:stroke:0", replacement), /annotation|authored/);
    const detached = compound.getObjectLayerCondition(replacement); detached.catalog.conditions.length = 0;
    assert(compound.getObjectLayerCondition(replacement).catalog.conditions.length > 0);
  } finally { compound.dispose(); }

  const falseSource = { ...source, optionalContent: { groups: [], conditions: [{ kind: "constant", value: false }], order: [], radioGroups: [] },
    drawRuns: [{ kind: "stroke", first: 0, count: source.segmentCount }],
    annotations: [{ ...compoundSource.annotations[0], optionalContent: 0, visibleInDefaultView: false }] };
  const falseMembership = await openEditorSession(falseSource);
  try {
    const id = falseMembership.addObject(shape({ layerId: null })); falseMembership.copyObjectLayerMembership("annotation:saved-text", id);
    assert.equal(falseMembership.getObject(id).layerCondition, 0); assert(!falseMembership.isObjectVisible(id));
    const hep = await falseMembership.saveHep({ withVectorLod: false, withTextLod: false, encodeRasterImages: false });
    const result = await loadSceneFromHep(await hep.arrayBuffer()), snapshot = createDefaultOptionalContentSnapshot(result);
    assert(result.optionalContent.conditions.some(condition => condition.kind === "constant" && !condition.value));
    assert(result.drawRuns.some(run => run.optionalContent !== undefined && snapshot.conditions[run.optionalContent] === 0), "false membership survives scene/HEP composition with no OCG groups");
  } finally { falseMembership.dispose(); }

  const compile = async bytes => {
    const parser = await openPdf({ kind: "bytes", bytes });
    try { const pages = []; for (let page = 0; page < parser.info.pageCount; page++) pages.push(await parser.compileVectorPage(page, { optimization: "none" })); return composeVectorScenesInGrid(pages, 1); }
    finally { await parser.close(); }
  };
  const bytes = pdfFixture(), document = await openEditorSession(await compile(bytes), { sourcePdf: bytes });
  try {
    const layer = document.createLayer({ name: "Added" }), empty = document.createLayer({ name: "Empty retained layer" });
    document.setActiveLayer(layer); const id = document.addObject(shape({ pageIndex: 1 }));
    const original = document.sourceScene.annotations.find(annotation => annotation.name === "Layered source");
    const copied = document.addObject(shape({ pageIndex: 1, layerId: null })); document.copyObjectLayerMembership(`annotation:${original.id}`, copied);
    const membership = document.getObjectLayerIds(copied); assert.equal(membership.length, 2); assert(document.isObjectVisible(copied));
    const metadata = document.getLayers(); await document.rotatePages([1], 90);
    assert(document.getLayers().some(value => value.id === layer && value.name === "Added"));
    assert(document.getLayers().some(value => value.id === empty), "unused layers survive page materialization");
    assert.equal(document.getActiveLayer(), layer); assert.deepEqual(document.getObjectLayerIds(id), [layer]);
    assert.deepEqual(document.getObjectLayerIds(copied), membership, "page reseeding imports compound membership from fresh annotation IDs rather than stale condition indices");
    const hiddenLayer = document.getLayers().find(layer => layer.name === "Hidden");
    document.updateLayer(hiddenLayer.id, { defaultVisible: true }); assert(!document.isObjectVisible(copied)); assert(document.undo());
    await document.removePages([0]); assert.equal(document.getObject(id).pageIndex, 0); assert.deepEqual(document.getObjectLayerIds(id), [layer]);
    assert.deepEqual(document.getObjectLayerIds(copied), membership); assert(document.isObjectVisible(copied));
    assert(document.undo()); assert.equal(document.getObject(id).pageIndex, 1); assert(document.undo());
    assert.deepEqual(document.getLayers(), metadata, "undoing page operations restores the layer model and author assignments");
  } finally { document.dispose(); }
  console.log("Editor layers: CRUD/order/history, visibility/locks/radio groups, source/author/clone membership, picking, HEP and page operations passed.");
} finally { hooks.deregister(); }

function pdfFixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [7 0 R 8 0 R] /D << /Order [7 0 R 8 0 R] /OFF [8 0 R] >> >> >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Properties << /A 7 0 R >> >> /Contents 5 0 R /Annots [10 0 R] >>" },
    { number: 4, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Properties << /A 7 0 R >> >> /Contents 6 0 R >>" },
    { number: 5, body: tinyPdfStream("", "/OC /A BDC 0 0 m 100 100 l S EMC") },
    { number: 6, body: tinyPdfStream("", "/OC /A BDC 0 100 m 100 0 l S EMC") },
    { number: 7, body: "<< /Type /OCG /Name (Original) >>" },
    { number: 8, body: "<< /Type /OCG /Name (Hidden) >>" },
    { number: 9, body: "<< /Type /OCMD /VE [/And 7 0 R [/Not 8 0 R]] >>" },
    { number: 10, body: "<< /Type /Annot /Subtype /FreeText /Rect [2 2 12 12] /NM (Layered source) /Contents (Original) /OC 9 0 R /AP << /N 11 0 R >> >>" },
    { number: 11, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Resources << >>", "0 0 1 rg 0 0 10 10 re f") }
  ] });
}
