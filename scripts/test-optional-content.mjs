// Synthetic scenes only; no PDF assets, conversion, browser, or server.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
try {
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { OptionalContentController, validateSceneOptionalContentReferences } = await import("../src/optionalContent.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const { HepArchive } = await import("../src/hepContainer.ts");
  const { encodeHeprPageData, decodeHeprPageData } = await import("../src/heprPageEncoding.ts");
  const { createEmptyHeprPageData } = await import("../src/heprDocumentData.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const scene = createEmptyVectorScene();
  const group = (id, visible, locked = false) => ({ id, name: "Duplicate display name", defaultVisible: visible, locked, usedInView: true });
  scene.optionalContent = { groups: [group("a", true), group("b", false), group("locked", true, true)],
    conditions: [{ kind: "group", groupId: "a" }, { kind: "group", groupId: "b" },
      { kind: "and", operands: [0, 1] }, { kind: "not", operand: 1 }, { kind: "or", operands: [2, 3] }],
    order: [{ kind: "label", label: "Architecture", children: [{ kind: "group", groupId: "a", children: [{ kind: "group", groupId: "b" }] }] }],
    radioGroups: [["a", "b"]] };
  scene.segmentCount = 1;
  scene.endpoints = new Float32Array([0, 0, 10, 10]);
  scene.primitiveMeta = new Float32Array([10, 10, 0, 1]);
  scene.primitiveBounds = new Float32Array([0, 0, 10, 10]);
  scene.styles = new Float32Array([0.5, 1, 0, 0]);
  scene.drawRuns = [{ kind: "stroke", first: 0, count: 1, optionalContent: 1 }];
  scene.textIndex = { version: 2, pages: [{ text: "x", charInstance: new Int32Array([-2]),
    fallbackQuads: new Float32Array([0, 0, 1, 1]), optionalContent: new Int32Array([1]) }] };
  const original = structuredClone(scene);
  const controller = new OptionalContentController(scene);
  assert.deepEqual([...controller.getSnapshot().conditions], [1, 0, 0, 1, 1]);
  assert.deepEqual(controller.getGroupIds(4), ["a", "b"]);
  await controller.setLayerVisibility("b", true);
  assert.deepEqual(controller.getLayers().map(layer => layer.visible), [false, true, true]);
  assert.deepEqual([...controller.getSnapshot().conditions], [0, 1, 0, 0, 0]);
  const revision = controller.revision;
  for (const changes of [[{ id: "a", visible: true }, { id: "missing", visible: false }],
    [{ id: "a", visible: true }, { id: "b", visible: true }], [{ id: "locked", visible: false }]]) {
    await assert.rejects(controller.setLayerVisibilities(changes));
    assert.equal(controller.revision, revision, "invalid batches cannot partially commit");
  }
  const detached = controller.getSnapshot(); detached.conditions.fill(1); detached.layers[0].visible = true;
  assert.equal(controller.isVisible(0), false);
  await controller.resetLayerVisibility();
  assert.deepEqual(scene, original, "runtime changes leave source arrays and defaults unchanged");
  let observed = 0;
  controller.subscribe(() => { throw new Error("broken observer"); });
  controller.subscribe(() => observed++);
  await controller.setLayerVisibility("b", true);
  assert.equal(observed, 1, "observer exceptions cannot block other listeners or reject applied updates");

  const prepares = [];
  const asyncController = new OptionalContentController(scene, { prepare: (value, { signal }) => new Promise((resolve, reject) => {
    prepares.push({ value, resolve }); signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }) });
  const first = asyncController.setLayerVisibility("a", false);
  const firstRejected = assert.rejects(first, { name: "AbortError" });
  const second = asyncController.setLayerVisibility("b", true);
  assert.equal(asyncController.isVisible(0), true, "old visibility stays presented during preparation");
  prepares[1].resolve(); await second; await firstRejected;
  assert.deepEqual(asyncController.getLayers().map(layer => layer.visible), [false, true, true]);
  const cancel = new AbortController();
  const cancelled = asyncController.resetLayerVisibility({ signal: cancel.signal });
  const cancelledRejected = assert.rejects(cancelled, { name: "AbortError" }); cancel.abort(); await cancelledRejected;
  assert.equal(asyncController.isVisible(1), true, "cancelled preparations keep committed visibility");
  const disposing = asyncController.resetLayerVisibility();
  const disposedRejected = assert.rejects(disposing, { name: "AbortError" }); asyncController.dispose(); await disposedRejected;
  await assert.rejects(asyncController.setLayerVisibility("a", false), /disposed/);

  const bulkScene = createEmptyVectorScene();
  bulkScene.optionalContent = {
    groups: [group("first", false), group("preferred", true), group("third", false), group("free", false),
      group("locked-on", true, true), group("locked-off", false, true), group("locked-peer", false),
      { ...group("non-view", true), usedInView: false }, group("non-view-peer", false)],
    conditions: [], order: [],
    radioGroups: [["first", "preferred"], ["preferred", "third"], ["locked-on", "locked-peer"], ["non-view", "non-view-peer"]]
  };
  const bulkOriginal = structuredClone(bulkScene);
  let bulkCommits = 0;
  const bulk = new OptionalContentController(bulkScene, { onChange: () => bulkCommits++ });
  const enabled = target => target.getLayers().filter(layer => layer.visible).map(layer => layer.id);
  assert.deepEqual(bulk.getAllLayerVisibility(), { checked: false, indeterminate: true, disabled: false });
  assert.deepEqual(bulk.getAllLayerVisibility(["locked-on", "locked-off", "non-view"]),
    { checked: false, indeterminate: false, disabled: true });
  assert.deepEqual(bulk.getAllLayerVisibility([]), { checked: false, indeterminate: false, disabled: true });
  assert.throws(() => bulk.getAllLayerVisibility(["free", "missing"]), /Unknown PDF layer/);
  await bulk.setAllLayerVisibility(false);
  assert.deepEqual(enabled(bulk), ["locked-on", "non-view"], "bulk off skips locked and non-View groups");
  assert.deepEqual(bulk.getAllLayerVisibility(), { checked: false, indeterminate: false, disabled: false });
  assert.equal(bulkCommits, 1, "bulk changes commit as one revision");
  await bulk.setAllLayerVisibility(true);
  assert.deepEqual(enabled(bulk), ["preferred", "free", "locked-on", "non-view"],
    "bulk on prefers source defaults and cannot conflict with immutable enabled members");
  assert.deepEqual(bulk.getAllLayerVisibility(), { checked: true, indeterminate: false, disabled: false },
    "compatible radio choices count as checked even when alternative layers remain off");
  assert.equal(bulkCommits, 2);
  await bulk.setAllLayerVisibility(false, ["preferred", "free"]);
  await bulk.setAllLayerVisibility(true, ["third", "first"]);
  assert.deepEqual(enabled(bulk), ["first", "third", "locked-on", "non-view"],
    "compatible endpoints of overlapping radio groups may both be enabled");
  await bulk.setAllLayerVisibility(true, ["preferred", "free", "free"]);
  assert.deepEqual(enabled(bulk), ["first", "third", "free", "locked-on", "non-view"],
    "current choices outside a filtered list beat a targeted default member");
  await bulk.setAllLayerVisibility(false, ["first", "third"]);
  const noDefaultScene = structuredClone(bulkScene);
  noDefaultScene.optionalContent.groups.find(group => group.id === "preferred").defaultVisible = false;
  const noDefault = new OptionalContentController(noDefaultScene);
  await noDefault.setAllLayerVisibility(true, ["third", "preferred", "first"]);
  assert.deepEqual(enabled(noDefault), ["first", "third", "locked-on", "non-view"],
    "with no current/default choice, document order chooses a compatible set across overlapping groups");
  const bulkRevision = bulk.revision;
  for (const [visible, ids] of [[true, ["preferred", "missing"]], [false, ["free", "missing"]], ["yes", undefined], [true, "free"]]) {
    await assert.rejects(bulk.setAllLayerVisibility(visible, ids));
    assert.equal(bulk.revision, bulkRevision, "invalid bulk input cannot partly apply");
  }
  await bulk.setAllLayerVisibility(true, []);
  await bulk.setAllLayerVisibility(false, ["locked-on", "locked-off", "non-view"]);
  assert.equal(bulk.revision, bulkRevision, "empty and wholly immutable target lists are no-ops");
  await assert.rejects(bulk.setLayerVisibilities([{ id: "first", visible: true }, { id: "preferred", visible: true }]), /radio group/);
  assert.deepEqual(bulkScene, bulkOriginal, "bulk operations preserve the original definitions and arrays");

  const bulkPrepares = [];
  const pendingBulk = new OptionalContentController(bulkScene, { prepare: (value, { signal }) => new Promise((resolve, reject) => {
    bulkPrepares.push({ value, resolve }); signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }) });
  const pendingChoice = pendingBulk.setLayerVisibility("first", true);
  const pendingRejected = assert.rejects(pendingChoice, { name: "AbortError" });
  const bulkChoice = pendingBulk.setAllLayerVisibility(true);
  assert.deepEqual(enabled(pendingBulk), ["preferred", "locked-on", "non-view"], "preparation keeps the old presented state");
  assert.deepEqual(pendingBulk.getAllLayerVisibility(), { checked: false, indeterminate: true, disabled: false },
    "summary reports applied visibility while a complete requested state is being prepared");
  const pendingValues = new Map(bulkPrepares[1].value.layers.map(layer => [layer.id, layer.visible]));
  assert.equal(pendingValues.get("first"), true, "bulk uses the latest requested choice rather than the committed default");
  assert.equal(pendingValues.get("preferred"), false);
  bulkPrepares[1].resolve(); await bulkChoice; await pendingRejected;
  assert.deepEqual(enabled(pendingBulk), ["first", "third", "free", "locked-on", "non-view"]);
  assert.deepEqual(pendingBulk.getAllLayerVisibility(), { checked: true, indeterminate: false, disabled: false });
  const bulkCancel = new AbortController();
  const bulkCancelled = pendingBulk.setAllLayerVisibility(false, undefined, { signal: bulkCancel.signal });
  const bulkCancelledRejected = assert.rejects(bulkCancelled, { name: "AbortError" });
  bulkCancel.abort(); await bulkCancelledRejected;
  assert.deepEqual(enabled(pendingBulk), ["first", "third", "free", "locked-on", "non-view"]);
  pendingBulk.dispose(); bulk.dispose(); noDefault.dispose();
  await assert.rejects(pendingBulk.setAllLayerVisibility(true), /disposed/);

  const { createLayerVisibilityController } = await import("../src/layerVisibility.ts");
  const wrapper = createLayerVisibilityController({ getScene: () => bulkScene, getRenderer: () => ({}) });
  assert.deepEqual(wrapper.getAllLayerVisibility(), { checked: false, indeterminate: false, disabled: true });
  await assert.rejects(wrapper.setAllLayerVisibility(false), /No PDF/);
  wrapper.sceneChanged();
  await wrapper.setAllLayerVisibility(false, ["preferred"]);
  assert.equal(wrapper.getLayers().find(layer => layer.id === "preferred").visible, false);
  assert.deepEqual(wrapper.getAllLayerVisibility(), { checked: false, indeterminate: false, disabled: false });
  wrapper.dispose();

  const { HeprThreePdfObject } = await import("../src/threePdfObject.ts");
  const threeBulk = new OptionalContentController(bulkScene);
  await HeprThreePdfObject.prototype.setAllLayerVisibility.call({ layerVisibility: threeBulk }, false, ["preferred"]);
  assert.equal(threeBulk.getLayers().find(layer => layer.id === "preferred").visible, false);
  assert.deepEqual(HeprThreePdfObject.prototype.getAllLayerVisibility.call({ layerVisibility: threeBulk }),
    { checked: false, indeterminate: false, disabled: false });
  threeBulk.dispose();

  for (const compression of ["store", "deflate"]) {
    const blob = await buildHep(scene, { compression, encodeRasterImages: false });
    const bytes = await blob.arrayBuffer();
    const archive = await HepArchive.loadAsync(bytes);
    const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
    assert.equal(manifest.formatVersion, 8);
    const loaded = await loadSceneFromHep(bytes);
    assert.equal(loaded.drawRuns[0].optionalContent, 1, "v8 carries the condition in the draw-run section");
    assert.deepEqual(loaded.optionalContent, original.optionalContent);
    assert.deepEqual(loaded.textIndex.pages[0].optionalContent, new Int32Array([1]));
    assert.equal(new OptionalContentController(loaded).isVisible(1), false, "exports retain source defaults");
    manifest.formatVersion = 7; archive.file("manifest.json", JSON.stringify(manifest));
    await assert.rejects(loadSceneFromHep(await archive.generateAsync({ type: "arraybuffer" })), /v7.*not supported.*v8.*Re-export/);
  }
  for (const mutate of [s => { s.optionalContent.conditions[0] = { kind: "not", operand: 0 }; },
    s => { s.optionalContent.conditions[0] = { kind: "group", groupId: "missing" }; },
    s => { s.optionalContent.groups[1].id = "a"; }, s => { s.drawRuns[0].optionalContent = 99; },
    s => { s.textIndex.pages[0].optionalContent[0] = 99; }, s => { s.textIndex.pages[0].optionalContent = new Int32Array(); }]) {
    const invalid = structuredClone(scene); mutate(invalid);
    assert.throws(() => validateSceneOptionalContentReferences(invalid), /optional content/);
    await assert.rejects(buildHep(invalid, { compression: "store" }), /optional[- ]content/);
  }
  const retainedPage = createEmptyHeprPageData({ sourcePageIndex: 0, mediaBox: [0, 0, 10, 10],
    cropBox: [0, 0, 10, 10], bleedBox: null, trimBox: null, artBox: null, rotation: 0, userUnit: 1, width: 10, height: 10 });
  retainedPage.stores.optionalContent = { names: ["a", "b"], defaultVisible: new Uint8Array([1, 0]) };
  const encoded = encodeHeprPageData(retainedPage);
  assert.deepEqual(decodeHeprPageData(encoded), retainedPage, "retained stores roundtrip as typed arrays");
  for (const bytes of [encoded.slice(0, -1), new Uint8Array(16), encoded.slice(0, 15)]) assert.throws(() => decodeHeprPageData(bytes));
  const cancelledEncoding = AbortSignal.abort(new Error("cancel retained resource"));
  assert.throws(() => encodeHeprPageData(retainedPage, cancelledEncoding), /cancel retained/);
  assert.throws(() => decodeHeprPageData(encoded, cancelledEncoding), /cancel retained/);
  const retainedScene = { ...scene, pageCount: 1, pageRects: new Float32Array([0, 0, 10, 10]),
    pageBounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    retainedPages: [0, 1].map(x => ({ page: retainedPage, optionalContentConditions: new Int32Array([0, 1]),
      matrix: new Float32Array([1, 0, 0, 1, x, 0]) })),
    paintGraph: { roots: [{ kind: "group", alpha: 0.5, isolated: true, knockout: false, blendMode: "Normal", optionalContent: 0,
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, children: [{ kind: "draw", runIndex: 0 }],
      softMask: { subtype: "Alpha", children: [], transfer: new Float32Array([0, 0.75, 1]) } }] } };
  const retainedBlob = await buildHep(retainedScene, { compression: "store", encodeRasterImages: false });
  const retainedArchive = await HepArchive.loadAsync(await retainedBlob.arrayBuffer());
  assert.equal(Object.keys(retainedArchive.files).filter(path => path.startsWith("retained/")).length, 1, "resource identity deduplicates section storage");
  const retainedLoaded = await loadSceneFromHep(await retainedBlob.arrayBuffer());
  assert.deepEqual(retainedLoaded.retainedPages, retainedScene.retainedPages);
  assert.equal(retainedLoaded.retainedPages[0].page, retainedLoaded.retainedPages[1].page, "one decoded page is reused");
  assert.deepEqual(retainedLoaded.paintGraph, retainedScene.paintGraph, "mask transfer is restored as a typed array");
  const composed = composeVectorScenesInGrid([retainedScene, retainedScene], 2);
  assert.equal(composed.drawRuns.length, 2, "graph-owned runs do not merge across page boundaries");
  assert.equal(composed.paintGraph.roots[1].children[0].runIndex, 1);
  assert.equal(composed.paintGraph.roots[1].optionalContent, scene.optionalContent.conditions.length);
  assert.deepEqual([...composed.retainedPages[2].optionalContentConditions], [5, 6]);
  assert.equal(composed.retainedPages[2].page, retainedPage, "page layout shares retained typed stores");
  assert.notEqual(composed.retainedPages[2].matrix[4], retainedScene.retainedPages[0].matrix[4]);
  const { GRADIENT_LUT_WIDTH } = await import("../src/orderedGradientPaint.ts");
  const meshScene = { ...scene, gradientCount: 1, gradientMetaA: new Float32Array([2, 0, 0, 0]),
    gradientMetaB: new Float32Array([1, 0, 0, 1]), gradientMetaC: new Float32Array(4),
    gradientMetaD: new Float32Array([1, 1, 0, 0]), gradientMetaE: new Float32Array(4),
    gradientLut: new Uint8Array(GRADIENT_LUT_WIDTH * 4),
    gradientMeshRanges: new Uint32Array([0, 3]), gradientMeshPositions: new Float32Array([0, 0, 10, 0, 0, 10]),
    gradientMeshColors: new Float32Array([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1]), gradientMeshIndices: new Uint32Array([0, 1, 2]) };
  const meshBlob = await buildHep(meshScene, { compression: "store", encodeRasterImages: false });
  const meshLoaded = await loadSceneFromHep(await meshBlob.arrayBuffer());
  for (const field of ["gradientMeshRanges", "gradientMeshPositions", "gradientMeshColors", "gradientMeshIndices"]) assert.deepEqual(meshLoaded[field], meshScene[field]);
  const invalidMesh = { ...meshScene, gradientMeshIndices: new Uint32Array([0, 1, 99]) };
  await assert.rejects(buildHep(invalidMesh, { compression: "store" }), /unknown vertex/);
  controller.dispose();
  console.log("Optional content passed: condition evaluation, atomic visibility, cancellation, detached state, and HEP v7 roundtrips.");
} finally { hooks.deregister(); }
