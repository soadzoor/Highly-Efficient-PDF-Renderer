import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { applyEditorSceneLayers, assignEditorGeometryLayer, createEditorLayerVisibility, detachEditorGeometryAnnotationLayers,
    reorderEditorSceneLayers, editorLayerPaintRank, captureEditorAnnotationLayerCondition } = await import("../src/editorLayerScene.ts");
  const { createDefaultOptionalContentSnapshot, OptionalContentController, validateSceneOptionalContentReferences } = await import("../src/optionalContent.ts");
  const { isScenePrimitiveVisible, getPrimitiveOptionalContent } = await import("../src/scenePrimitives.ts");
  const { validateScenePaintGraph, planScenePaintPasses } = await import("../src/scenePaintGraph.ts");
  const { validateVectorDrawRuns } = await import("../src/vectorDrawOrder.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { renderNativeRetainedCommandSpan } = await import("../src/retainedPageCompositor.ts");
  const { composeVectorScenesInGrid, composeVectorScenesInColumn } = await import("../src/pdfVectorExtractor.ts");
  const { ScenePageViews } = await import("../src/scenePageViews.ts");
  const { composeEditorPage } = await import("../src/editorScene.ts");

  const group = (id, visible = true, extra = {}) => ({ id, name: id, defaultVisible: visible, locked: false, usedInView: true, ...extra });
  const catalog = { groups: [group("A", false), group("B"), group("annotation:widget", true, { annotationId: "widget", locked: true, usedInView: false })],
    conditions: [{ kind: "group", groupId: "A" }, { kind: "group", groupId: "B" }, { kind: "not", operand: 0 },
      { kind: "group", groupId: "annotation:widget" }, { kind: "and", operands: [0, 3] }],
    order: [{ kind: "group", groupId: "A" }, { kind: "group", groupId: "B" }], radioGroups: [] };
  const edits = (patch = {}) => ({ catalog, catalogChanged: true, stackingChanged: false, removals: [], removedLayerIds: [], sourceAssignments: [], annotationAssignments: [], ...patch });
  const source = strokes(3); source.optionalContent = catalog;
  source.drawRuns = [{ kind: "stroke", first: 0, count: 1, optionalContent: 2 }, { kind: "stroke", first: 1, count: 1, optionalContent: 4 }, { kind: "stroke", first: 2, count: 1 }];
  source.paintGraph = { roots: [{ kind: "group", alpha: 1, isolated: true, knockout: false, blendMode: "Normal", optionalContent: 0,
    children: [{ kind: "draw", runIndex: 0 }, { kind: "draw", runIndex: 1 }] }, { kind: "draw", runIndex: 2 }] };
  source.annotations = [{ id: "widget", pageIndex: 0, sourcePageIndex: 0, annotationIndex: 0, subtype: "Widget", flags: 0,
    visibleInDefaultView: false, hasAppearance: true, pdfGeometry: { rect: [0, 0, 10, 10] }, bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, optionalContent: 0 }];
  source.clipPaths = [{ parent: -1, fillRule: 0, edges: Float32Array.of(0, 0, 50, 0, 50, 0, 50, 50, 50, 50, 0, 50, 0, 50, 0, 0) },
    { parent: 0, fillRule: 0, edges: Float32Array.of(1, 1, 40, 1, 40, 1, 40, 40, 40, 40, 1, 40, 1, 40, 1, 1) }];
  source.drawRuns[1].clipIndex = 1;
  const original = structuredClone(source), visible = (scene, index) => {
    const snapshot = createDefaultOptionalContentSnapshot(scene);
    return isScenePrimitiveVisible(scene, { kind: "stroke", index }, condition => condition === undefined || snapshot.conditions[condition] !== 0);
  };
  const assignedEdits = edits({ sourceAssignments: [{ ref: { kind: "stroke", index: 1 }, layerId: "B" }], annotationAssignments: [{ id: "widget", layerId: "B" }] });
  const assigned = await applyEditorSceneLayers(source, assignedEdits);
  assert.equal(visible(assigned, 0), false, "an unrelated contradictory source scope stays hidden");
  assert.equal(visible(assigned, 1), true, "replacement membership removes the ancestor's old OCG gate");
  assert.deepEqual(getPrimitiveOptionalContent(assigned, { kind: "stroke", index: 1 }).layerIds, ["B"]);
  assert.equal(assigned.annotations[0].visibleInDefaultView, true, "a reassigned field becomes interactive when its new layer is visible");
  assert.equal(assigned.endpoints, source.endpoints, "layer edits reuse canonical geometry buffers");
  assert.equal(assigned.clipPaths, source.clipPaths); assert.equal(assigned.drawRuns[1].clipIndex, 1, "owned paint keeps its complete ancestor clip chain");
  validate(assigned);
  const eligibility = createEditorLayerVisibility(source, assignedEdits);
  assert.equal(eligibility.isPrimitiveVisible({ kind: "stroke", index: 1 }), true);
  assert.equal(eligibility.isAnnotationVisible("widget"), true);
  const compoundSource = structuredClone(source);
  compoundSource.optionalContent = { ...catalog, conditions: [...catalog.conditions, { kind: "not", operand: 1 }, { kind: "and", operands: [0, 5] },
    { kind: "and", operands: [6, 3] }] };
  compoundSource.annotations[0].optionalContent = 7;
  const captured = captureEditorAnnotationLayerCondition(compoundSource, edits({ catalog: compoundSource.optionalContent }), "widget");
  const replacement = assignEditorGeometryLayer(strokes(1), captured.catalog, undefined, captured.condition);
  for (const a of [false, true]) for (const b of [false, true]) {
    const scene = { ...replacement, optionalContent: { ...replacement.optionalContent, groups: replacement.optionalContent.groups.map(group => ({ ...group,
      defaultVisible: group.id === "A" ? a : group.id === "B" ? b : false })) } };
    assert.equal(visible(scene, 0), a && !b, "replacing a source annotation preserves exact And/Not membership independently from its original appearance owner");
  }
  const falseCatalog = { groups: [], conditions: [{ kind: "constant", value: false }], order: [], radioGroups: [] };
  const falseSource = { ...strokes(0), optionalContent: falseCatalog, annotations: [{ ...source.annotations[0], optionalContent: 0 }] };
  const capturedFalse = captureEditorAnnotationLayerCondition(falseSource, edits({ catalog: falseCatalog }), "widget");
  assert.equal(capturedFalse.condition, 0, "condition zero and explicit false are preserved");
  const hiddenReplacement = assignEditorGeometryLayer(strokes(1), capturedFalse.catalog, undefined, capturedFalse.condition);
  const composedFalse = composeEditorPage(strokes(0), [hiddenReplacement]);
  assert.equal(visible(composedFalse, 0), false, "boolean-only layer tables remain intact when no OCGs remain after composition");
  validate(composedFalse);

  const removedCatalog = { ...catalog, groups: catalog.groups.filter(group => group.id !== "A"),
    conditions: [{ kind: "constant", value: true }, catalog.conditions[1], { kind: "constant", value: true }, catalog.conditions[3], catalog.conditions[3]],
    order: [{ kind: "group", groupId: "B" }] };
  const removed = await applyEditorSceneLayers(source, edits({ catalog: removedCatalog, removals: [{ id: "A", targetLayerId: null }], removedLayerIds: ["A"] }));
  assert.equal(visible(removed, 0), false, "existential forgetting applies to the combined A AND Not A ancestor/leaf expression");
  assert.equal(visible(removed, 1), true, "removing a layer keeps its possible visible content");
  assert(removed.optionalContent.conditions.every(condition => condition.kind !== "group" || condition.groupId !== "A"));
  assert.equal(removed.optionalContent.groups.some(group => group.annotationId === "widget"), true, "internal appearance ownership survives removal");
  validate(removed);
  const retargeted = await applyEditorSceneLayers(source, edits({ catalog: { ...removedCatalog,
    conditions: [{ kind: "group", groupId: "B" }, catalog.conditions[1], { kind: "not", operand: 0 }, catalog.conditions[3], { kind: "and", operands: [0, 3] }] },
    removals: [{ id: "A", targetLayerId: "B" }], removedLayerIds: ["A"] }));
  assert.equal(visible(retargeted, 0), false, "retargeting retains negative membership correlation");
  assert.equal(visible(retargeted, 1), true);
  const chained = await applyEditorSceneLayers(source, edits({ catalog: { ...removedCatalog, groups: removedCatalog.groups.filter(group => group.id !== "B"),
    conditions: removedCatalog.conditions.map(condition => condition.kind === "group" && condition.groupId === "B" ? { kind: "constant", value: true } : condition), order: [] },
    removals: [{ id: "A", targetLayerId: "B" }, { id: "B", targetLayerId: null }], removedLayerIds: ["A", "B"] }));
  assert.equal(visible(chained, 0), false, "retargeting through a subsequently removed layer keeps correlated scopes");
  assert.equal(visible(chained, 1), true); validate(chained);

  const masked = strokes(2); masked.optionalContent = catalog;
  masked.drawRuns = [{ kind: "stroke", first: 0, count: 1, optionalContent: 0 }, { kind: "stroke", first: 1, count: 1, optionalContent: 2 }];
  masked.paintGraph = { roots: [{ kind: "group", alpha: .6, isolated: true, knockout: true, blendMode: "Multiply",
    children: [{ kind: "draw", runIndex: 0 }], softMask: { subtype: "Alpha", children: [{ kind: "draw", runIndex: 1 }] } }] };
  const diagnostics = [], assignedMask = await applyEditorSceneLayers(masked, edits({ sourceAssignments: [{ ref: { kind: "stroke", index: 0 }, layerId: "B" }] }), { onDiagnostic: value => diagnostics.push(value) });
  const mask = assignedMask.paintGraph.roots[0];
  assert.equal(mask.alpha, .6); assert.equal(mask.knockout, true); assert.equal(mask.blendMode, "Multiply"); assert.equal(mask.softMask.subtype, "Alpha");
  assert.equal(mask.softMask.children.length, 1); assert.equal(diagnostics[0].code, "editor.layer-compositing-unit");
  assert.deepEqual(getPrimitiveOptionalContent(assignedMask, { kind: "stroke", index: 0 }).layerIds, ["B"]);
  validate(assignedMask);

  const detached = detachEditorGeometryAnnotationLayers(assigned);
  assert(detached.optionalContent.groups.every(group => group.annotationId === undefined));
  assert.equal(visible(detached, 1), true); validate(detached);
  const clone = assignEditorGeometryLayer(detached, catalog, "B");
  assert.equal(visible(clone, 1), true); validate(clone);
  const unlayered = assignEditorGeometryLayer(detached, catalog, null);
  assert.equal(editorLayerPaintRank(unlayered.optionalContent, unlayered.drawRuns[1].optionalContent), null, "explicit unlayered assignment removes PDF memberships");

  const text = strokes(0); text.optionalContent = catalog; text.textInstanceCount = 2;
  text.textInstanceA = Float32Array.of(1, 0, 0, 1, 1, 0, 0, 1); text.textInstanceB = Float32Array.of(0, 0, 0, 0, 10, 0, 0, 0); text.textInstanceC = new Float32Array(8);
  text.pageTextRanges = Uint32Array.of(0, 2); text.drawRuns = [{ kind: "text", first: 0, count: 2, optionalContent: 0 }];
  text.textIndex = { version: 2, pages: [{ text: "AB", charInstance: Int32Array.of(0, 1), fallbackQuads: new Float32Array(), optionalContent: Int32Array.of(0, 0) }] };
  const editedText = await applyEditorSceneLayers(text, edits({ sourceAssignments: [{ ref: { kind: "text", index: 0 }, layerId: "B" }] }));
  const textDefaults = createDefaultOptionalContentSnapshot(editedText).conditions;
  assert.deepEqual(Array.from(editedText.textIndex.pages[0].optionalContent, condition => textDefaults[condition]), [1, 0], "search geometry follows reassigned glyph memberships");

  const stack = strokes(5); stack.optionalContent = catalog;
  stack.drawRuns = [{ kind: "stroke", first: 0, count: 1, optionalContent: 0 }, { kind: "stroke", first: 1, count: 1 },
    { kind: "stroke", first: 2, count: 1, optionalContent: 1 }, { kind: "stroke", first: 3, count: 1, optionalContent: 0 }, { kind: "stroke", first: 4, count: 1, optionalContent: 1 }];
  assert.equal(reorderEditorSceneLayers(stack, { stackingChanged: false }), stack, "opening an existing layer tree never changes source paint order");
  const sorted = reorderEditorSceneLayers(stack, { stackingChanged: true });
  assert.deepEqual(sorted.drawRuns.map(run => run.first), [2, 1, 4, 0, 3], "frontmost layer paints last; unlayered slots and intra-layer order stay fixed");
  assert.deepEqual(planScenePaintPasses(sorted, () => true).map(pass => sorted.drawRuns[pass.runIndex].first), [2, 1, 4, 0, 3]); validate(sorted);
  const stackVisibility = createEditorLayerVisibility(stack, edits({ stackingChanged: true }));
  assert(stackVisibility.getPrimitivePaintRank({ kind: "stroke", index: 0 }) > stackVisibility.getPrimitivePaintRank({ kind: "stroke", index: 2 }));
  const hitStack = strokes(2); hitStack.optionalContent = catalog;
  hitStack.drawRuns = [{ kind: "stroke", first: 0, count: 1, optionalContent: 0 }, { kind: "stroke", first: 1, count: 1 }];
  const virtual = createEditorLayerVisibility(hitStack, edits({ stackingChanged: true }), [
    { id: "new-lower", pageIndex: 0, layerIds: ["B"] }, { id: "new-unlayered", pageIndex: 0, layerIds: [] }
  ]);
  assert(virtual.getObjectPaintRank("new-lower") < virtual.getPrimitivePaintRank({ kind: "stroke", index: 1 }), "a lower-layer addition can sort below an existing fixed unlayered slot");
  assert(virtual.getObjectPaintRank("new-unlayered") > virtual.getPrimitivePaintRank({ kind: "stroke", index: 0 }), "new unlayered paint retains its last slot");
  const mixedClone = createEditorLayerVisibility(hitStack, edits({ stackingChanged: true }), [
    { id: "mixed-clone", pageIndex: 0, layerIds: ["A"], sourcePrimitives: [{ kind: "stroke", index: 0 }, { kind: "stroke", index: 1 }], sourceLayerEdits: edits() },
    { id: "new-lower", pageIndex: 0, layerIds: ["B"] }
  ]);
  assert(mixedClone.getObjectPaintRank("mixed-clone") > mixedClone.getObjectPaintRank("new-lower"), "a preserved mixed clone keeps each original layer/unlayered paint unit in virtual hit order");
  const compound = { ...catalog, conditions: [...catalog.conditions, { kind: "and", operands: [0, 1] }] };
  assert.equal(editorLayerPaintRank(compound, 5), 0, "compound membership uses the frontmost member");
  const isolated = strokes(2); isolated.optionalContent = catalog;
  isolated.drawRuns = [{ kind: "stroke", first: 0, count: 1, optionalContent: 0 }, { kind: "stroke", first: 1, count: 1, optionalContent: 1 }];
  isolated.paintGraph = { roots: [{ kind: "group", alpha: 1, isolated: true, knockout: false, blendMode: "Normal", children: [
    { kind: "group", alpha: .5, isolated: true, knockout: false, blendMode: "Normal", children: [{ kind: "draw", runIndex: 0 }] }, { kind: "draw", runIndex: 1 }
  ] }] };
  const sortedIsolated = reorderEditorSceneLayers(isolated, { stackingChanged: true });
  assert.equal(sortedIsolated.paintGraph.roots.length, 1); assert.equal(sortedIsolated.paintGraph.roots[0].isolated, true);
  assert.deepEqual(sortedIsolated.drawRuns.map(run => run.first), [1, 0], "children restack inside an isolated container without dropping its compositing boundary");
  assert.equal(sortedIsolated.paintGraph.roots[0].children[1].alpha, .5); validate(sortedIsolated);
  const isolatedRanks = createEditorLayerVisibility(isolated, edits({ stackingChanged: true }), [{ id: "lower-subset-clone", pageIndex: 0,
    layerIds: ["B"], sourcePrimitives: [{ kind: "stroke", index: 1 }], sourceLayerEdits: edits() }]);
  assert(isolatedRanks.getObjectPaintRank("lower-subset-clone") < isolatedRanks.getPrimitivePaintRank({ kind: "stroke", index: 0 }), "a subset clone's paint rank excludes source siblings absent from the clone");
  const bare = strokes(1), newLayered = assignEditorGeometryLayer(bare, catalog, "B");
  assert.equal(newLayered.optionalContent.conditions.length, 1, "new content does not duplicate the document condition table");
  assert.equal(assignEditorGeometryLayer(bare, catalog, null), bare, "new unlayered content keeps the normal scene path");
  const independent = strokes(1); independent.optionalContent = { groups: [group("custom")], conditions: [{ kind: "group", groupId: "custom" }], order: [{ kind: "group", groupId: "custom" }], radioGroups: [] };
  independent.drawRuns = [{ kind: "stroke", first: 0, count: 1, optionalContent: 0 }];
  const imported = assignEditorGeometryLayer(independent, catalog, "B"); validate(imported);
  assert.equal(visible(imported, 0), true, "custom object compiler condition tables are remapped before replacing membership");

  const document = composeVectorScenesInGrid([stack, stack], 2), documentCatalog = { ...document.optionalContent,
    groups: document.optionalContent.groups.map(group => group.id === "B" ? { ...group, name: "Renamed on every page" } : group) };
  const documentEdits = edits({ catalog: documentCatalog, stackingChanged: true });
  const compiledDocument = await applyEditorSceneLayers(document, documentEdits), sortedDocument = reorderEditorSceneLayers(compiledDocument, documentEdits);
  assert.deepEqual(sortedDocument.drawRuns.map(run => run.first), [2, 1, 4, 0, 3, 7, 6, 9, 5, 8], "visual stacking is independently stable on every page");
  const partition = new ScenePageViews(sortedDocument), pageViews = [partition.extract(0).scene, partition.extract(1).scene];
  assert.equal(pageViews[0].optionalContent, pageViews[1].optionalContent, "page extraction retains the authoritative catalog identity");
  const column = composeVectorScenesInColumn(pageViews);
  assert.equal(column.optionalContent.conditions.length, sortedDocument.optionalContent.conditions.length, "shared Reader page catalogs do not multiply the condition table");
  assert.equal(column.optionalContent.groups.find(group => group.id === "B").name, "Renamed on every page");
  validate(column);

  const hep = await buildHep(assigned, { withVectorLod: false, withTextLod: false, encodeRasterImages: false });
  const reopened = await loadSceneFromHep(await hep.arrayBuffer()); validate(reopened);
  assert.equal(visible(reopened, 1), true); assert.deepEqual(reopened.optionalContent.order, assigned.optionalContent.order);
  assert.equal(reopened.optionalContent.groups.some(group => group.annotationId === "widget"), true);

  await retainedRoundTrip();
  const abort = AbortSignal.abort(new Error("cancel layers"));
  await assert.rejects(applyEditorSceneLayers(source, assignedEdits, { signal: abort }), /cancel layers/);
  assert.deepEqual(source, original, "all layer compilation and serialization preserve the source scene");
  console.log("Editor layer scene passed: effective memberships, Not/ancestor deletion, annotation independence, masks, search, stacking, retained pixels and HEP round trips.");

  function strokes(count) {
    const scene = createEmptyVectorScene(); Object.assign(scene, { pageCount: 1, pagesPerRow: 1, pageRects: Float32Array.of(0, 0, 100, 100), pageTextRanges: Uint32Array.of(0, 0),
      segmentCount: count, sourceSegmentCount: count, mergedSegmentCount: count, endpoints: Float32Array.from(Array.from({ length: count }, (_, i) => [5 + i * 10, 5, 0, 0]).flat()),
      primitiveMeta: Float32Array.from(Array.from({ length: count }, (_, i) => [10 + i * 10, 5, 0, 1]).flat()),
      primitiveBounds: Float32Array.from(Array.from({ length: count }, (_, i) => [5 + i * 10, 4, 10 + i * 10, 6]).flat()),
      styles: Float32Array.from(Array.from({ length: count }, () => [1, 0, 0, 0]).flat()), maxHalfWidth: count ? 1 : 0,
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 }, pageBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } }); return scene;
  }
  function validate(scene) { validateSceneOptionalContentReferences(scene); validateVectorDrawRuns(scene); validateScenePaintGraph(scene); }
  async function retainedRoundTrip() {
    const parser = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
      { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" }, { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
      { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 12 10] /Resources << >> /Contents 4 0 R >>" },
      { number: 4, body: tinyPdfStream("", "1 0 0 rg 1 1 4 4 re f 0 0 1 rg 7 1 4 4 re f") }
    ] }) });
    let page; try { page = await parser.compilePage(0, { optimization: "none" }); } finally { await parser.close(); }
    const commands = page.displayProgram.groups[page.displayProgram.rootGroupIndex].commands;
    commands[0].optionalContentIndex = 0; commands[1].optionalContentIndex = 1;
    page.stores.optionalContent = { names: ["A", "B"], defaultVisible: Uint8Array.of(0, 1) };
    const pixels = await renderNativeRetainedCommandSpan(page, 0, 2, new AbortController().signal);
    const scene = strokes(0); scene.pageRects = Float32Array.of(0, 0, 12, 10); scene.bounds = scene.pageBounds = { minX: 0, minY: 0, maxX: 12, maxY: 10 };
    scene.optionalContent = { ...catalog, groups: catalog.groups.filter(group => group.annotationId === undefined), conditions: catalog.conditions.slice(0, 3) };
    scene.rasterLayers = [pixels]; scene.drawRuns = [{ kind: "raster", first: 0, count: 1 }];
    scene.retainedPages = [{ page, matrix: Float32Array.of(1, 0, 0, 1, 0, 0), optionalContentConditions: Int32Array.of(0, 1) }];
    scene.paintGraph = { roots: [{ kind: "retained", retainedPage: 0, firstCommand: 0, count: 2, rasterIndex: 0 }] };
    const split = { ...scene, rasterLayers: [await renderNativeRetainedCommandSpan(page, 0, 1, new AbortController().signal),
      await renderNativeRetainedCommandSpan(page, 1, 1, new AbortController().signal)], drawRuns: [{ kind: "raster", first: 0, count: 1 }, { kind: "raster", first: 1, count: 1 }],
      paintGraph: { roots: [{ kind: "retained", retainedPage: 0, firstCommand: 0, count: 1, rasterIndex: 0 }, { kind: "retained", retainedPage: 0, firstCommand: 1, count: 1, rasterIndex: 1 }] } };
    const sortedSpans = reorderEditorSceneLayers(split, { stackingChanged: true });
    assert.deepEqual(sortedSpans.paintGraph.roots.map(node => node.rasterIndex), [1, 0], "retained paint ranks use only the memberships used by each island's command span");
    validate(sortedSpans);
    const changed = await applyEditorSceneLayers(scene, edits({ catalog: { ...scene.optionalContent, groups: scene.optionalContent.groups.map(group => ({ ...group, defaultVisible: group.id === "A" })) } }));
    assert.deepEqual(Array.from(changed.retainedPages[0].page.stores.optionalContent.defaultVisible), [1, 0]);
    assert.deepEqual(sample(changed.rasterLayers[0], 3, 3), [255, 0, 0, 255], "new defaults regenerate retained content before first presentation");
    assert.equal(sample(changed.rasterLayers[0], 9, 3)[3], 0);
    assert.deepEqual(Array.from(page.stores.optionalContent.defaultVisible), [0, 1], "retained source programs remain immutable");
    const assigned = await applyEditorSceneLayers(scene, edits({ catalog: scene.optionalContent, sourceAssignments: [{ ref: { kind: "raster", index: 0 }, layerId: "B" }] }));
    assert.deepEqual(sample(assigned.rasterLayers[0], 3, 3), [255, 0, 0, 255], "assigning a retained island removes hidden internal source membership");
    const encoded = await buildHep(changed, { withVectorLod: false, withTextLod: false, encodeRasterImages: false });
    const loaded = await loadSceneFromHep(await encoded.arrayBuffer());
    assert.deepEqual(sample(loaded.rasterLayers[0], 3, 3), [255, 0, 0, 255]);
    const controller = new OptionalContentController(loaded); await controller.setLayerVisibility("B", true); assert.equal(controller.getLayers().find(group => group.id === "B").visible, true); controller.dispose();
  }
  function sample(layer, x, y) {
    const m = layer.matrix, dx = x - m[4], dy = y - m[5], det = m[0] * m[3] - m[1] * m[2];
    const u = Math.floor((dx * m[3] - dy * m[2]) / det * layer.width), v = Math.floor((dy * m[0] - dx * m[1]) / det * layer.height);
    return u < 0 || v < 0 || u >= layer.width || v >= layer.height ? [0, 0, 0, 0] : [...layer.data.subarray((v * layer.width + u) * 4, (v * layer.width + u) * 4 + 4)];
  }
} finally { hooks.deregister(); }
