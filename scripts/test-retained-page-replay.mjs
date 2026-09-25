import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
try {
  const { openPdf, renderNativeRetainedCommandSpan } = await import("../src/pdfSession.ts");
  const { RetainedPageReplay, applyRetainedPageVisibility } = await import("../src/retainedPageReplay.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const session = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 12 10] /Resources << >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "1 0 0 rg 1 1 4 4 re f 0 0 1 rg 7 1 4 4 re f") }
  ] }) });
  let page;
  try { page = await session.compilePage(0, { optimization: "none" }); } finally { await session.close(); }
  const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
  assert.equal(root.commands.length, 2);
  root.commands[0].optionalContentIndex = 0;
  root.commands[1].optionalContentIndex = 1;
  page.stores.optionalContent = { names: ["A", "B", "Unused"], defaultVisible: new Uint8Array([1, 0, 1]) };
  const resource = { page, optionalContentConditions: new Int32Array([0, 1, 2]), matrix: new Float32Array([2, 0, 0, 2, 30, 40]) };
  const original = structuredClone(page);
  const snapshot = conditions => ({ revision: 1, layers: [], conditions: new Uint8Array(conditions) });
  const visiblePage = applyRetainedPageVisibility(resource, snapshot([0, 1, 1]));
  assert.equal(visiblePage.stores.paths, page.stores.paths, "replay reuses canonical path buffers");
  assert.equal(visiblePage.displayProgram, page.displayProgram);
  assert.deepEqual([...visiblePage.stores.optionalContent.defaultVisible], [0, 1, 1]);
  const signal = new AbortController().signal;
  const image = await renderNativeRetainedCommandSpan(visiblePage, 0, 2, signal);
  assert(image);
  assert(image.width * image.height < 18 * 15, "small retained spans store cropped pixels");
  const sample = (layer, x, y) => {
    const m = layer.matrix, dx = x - m[4], dy = y - m[5], det = m[0] * m[3] - m[1] * m[2];
    const u = Math.floor((dx * m[3] - dy * m[2]) / det * layer.width);
    const v = Math.floor((dy * m[0] - dx * m[1]) / det * layer.height);
    if (u < 0 || v < 0 || u >= layer.width || v >= layer.height) return [0, 0, 0, 0];
    return [...layer.data.subarray((v * layer.width + u) * 4, (v * layer.width + u) * 4 + 4)];
  };
  assert.equal(sample(image, 3, 3)[3], 0, "hidden layer is absent from replay");
  assert.deepEqual(sample(image, 9, 3), [0, 0, 255, 255]);
  const scene = createEmptyVectorScene();
  scene.retainedPages = [resource];
  const initial = await renderNativeRetainedCommandSpan(page, 0, 2, signal);
  scene.optionalContent = { groups: ["A", "B", "Unused"].map((id, i) => ({ id, name: id,
    defaultVisible: i !== 1, locked: false, usedInView: true })),
    conditions: ["A", "B", "Unused"].map(groupId => ({ kind: "group", groupId })), order: [], radioGroups: [] };
  scene.rasterLayers = [{ ...initial, matrix: Float32Array.of(initial.matrix[0] * 2, 0, 0, initial.matrix[3] * 2,
    initial.matrix[4] * 2 + 30, initial.matrix[5] * 2 + 40), paintOrder: 9, pageIndex: 2 }];
  scene.drawRuns = [{ kind: "raster", first: 0, count: 1 }];
  scene.paintGraph = { roots: [{ kind: "retained", retainedPage: 0, firstCommand: 0, count: 2, rasterIndex: 0 }] };
  let renders = 0;
  const replay = new RetainedPageReplay(scene, async (...args) => { renders++; return renderNativeRetainedCommandSpan(...args); });
  const first = await replay.prepare(snapshot([1, 0, 1]), { signal });
  assert.equal(replay.getLayers().get(0), scene.rasterLayers[0], "prepared resources cannot change committed state");
  first.commit();
  assert.equal(first.layers.size, 0, "default pixels need no replay or upload");
  assert.equal(replay.getLayers().get(0).pageIndex, 2);
  const repeated = await replay.prepare(snapshot([1, 0, 1]), { signal }); repeated.commit();
  assert.equal(renders, 0, "unchanged page visibility reuses parser-provided pixels");
  const changed = await replay.prepare(snapshot([0, 1, 1]), { signal }); changed.commit();
  assert.equal(renders, 1);
  assert.deepEqual(sample(replay.getLayers().get(0), 48, 46), [0, 0, 255, 255]);
  const unrelated = await replay.prepare(snapshot([0, 1, 0]), { signal }); unrelated.commit();
  assert.equal(renders, 1, "unused document OCG does not invalidate retained pixels");
  assert.equal(unrelated.layers.size, 0, "unchanged slots are absent from the upload delta");
  const { VectorDrawRunCuller } = await import("../src/vectorDrawRunCulling.ts");
  const { scenePaintNodeBounds } = await import("../src/scenePaintGraph.ts");
  const { ScenePrimitivePicker } = await import("../src/scenePrimitives.ts");
  const culler = new VectorDrawRunCuller(scene);
  assert.equal(culler.select({ minX: 47, minY: 45, maxX: 49, maxY: 47 }, 0.001).length, 1,
    "replayed content outside the initial crop remains a draw candidate");
  assert.deepEqual([...scenePaintNodeBounds(scene).runs], [30, 40, 54, 60], "cached compositor extents use structural bounds");
  const picker = new ScenePrimitivePicker(scene);
  const point = { x: 48, y: 46 };
  assert.equal((await picker.pick({ point, clientPoint: point, project: p => p, unproject: p => p,
    tolerancePx: 0, kinds: ["raster"], rasterLayers: replay.getLayers() }))?.primitive.index, 0,
    "cropped replacement pixels remain pickable outside the original texture");
  picker.dispose();
  const stale = await replay.prepare(snapshot([1, 0, 1]), { signal });
  const current = await replay.prepare(snapshot([0, 1, 1]), { signal });
  assert.throws(() => stale.commit(), { name: "AbortError" }); current.commit();
  const aborted = AbortSignal.abort(new Error("cancel replay"));
  await assert.rejects(replay.prepare(snapshot([1, 1, 1]), { signal: aborted }), /cancel replay/);
  assert.deepEqual(page, original, "all replay operations leave retained source data unchanged");
  replay.dispose();
  await assert.rejects(replay.prepare(snapshot([1, 1, 1]), { signal }), /disposed/);
  await testDependencies(page);
  await testIndependentSpans({ page, RetainedPageReplay, renderNativeRetainedCommandSpan, createEmptyVectorScene, snapshot, sample, signal });
  await testBackdropReplay({ openPdf, renderNativeRetainedCommandSpan, RetainedPageReplay, createEmptyVectorScene, snapshot, sample, signal });
  console.log("Retained page replay passed: self-contained Canvas rendering, HEP backdrop changes, hidden resources, stable slots/quads, cache reuse, and cancellation.");
} finally { hooks.deregister(); }

async function testBackdropReplay({ openPdf, renderNativeRetainedCommandSpan, RetainedPageReplay, createEmptyVectorScene, snapshot, sample, signal }) {
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const session = await openPdf({ kind: "bytes", bytes: writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 12 10] /Resources << /XObject << /Fm 5 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "1 0 0 rg 0 0 12 10 re f /Fm Do") },
    { number: 5, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 12 10] /Resources << /ExtGState << /Screen 6 0 R >> >>",
      "/Screen gs 0 0 1 rg 2 2 8 6 re f") },
    { number: 6, body: "<< /Type /ExtGState /BM /Screen /ca 0.5 >>" }
  ] }) });
  let page;
  try { page = await session.compilePage(0, { optimization: "none" }); }
  finally { await session.close(); }
  const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
  assert.equal(root.commands.length, 2);
  assert.ok(["group", "invoke-program"].includes(root.commands[1].kind));
  root.commands[0].optionalContentIndex = 0;
  page.stores.optionalContent = { names: ["Backdrop"], defaultVisible: Uint8Array.of(1) };
  const scene = createEmptyVectorScene();
  scene.pageCount = scene.pagesPerRow = 1;
  scene.bounds = scene.pageBounds = { minX: 0, minY: 0, maxX: 12, maxY: 10 };
  scene.pageRects = Float32Array.of(0, 0, 12, 10);
  scene.optionalContent = {
    groups: [{ id: "backdrop", name: "Backdrop", defaultVisible: true, locked: false, usedInView: true }],
    conditions: [{ kind: "group", groupId: "backdrop" }], order: [{ kind: "group", groupId: "backdrop" }], radioGroups: []
  };
  scene.retainedPages = [{ page, optionalContentConditions: Int32Array.of(0), matrix: Float32Array.of(1, 0, 0, 1, 0, 0) }];
  scene.rasterLayers = await Promise.all([0, 1].map(first => renderNativeRetainedCommandSpan(page, first, 1, signal)));
  assert(scene.rasterLayers.every(Boolean));
  scene.drawRuns = [{ kind: "raster", first: 0, count: 1, optionalContent: 0 }, { kind: "raster", first: 1, count: 1 }];
  scene.paintGraph = { roots: [0, 1].map(index => ({ kind: "retained", retainedPage: 0, firstCommand: index,
    count: 1, rasterIndex: index, ...(index === 0 ? { optionalContent: 0 } : {}) })) };
  const bytes = await (await buildHep(scene, { compression: "store", encodeRasterImages: false })).arrayBuffer();
  const loaded = await loadSceneFromHep(bytes);
  const canonical = loaded.rasterLayers.map(layer => layer.data.slice());
  let calls = 0;
  const replay = new RetainedPageReplay(loaded, async (...args) => {
    calls++; return renderNativeRetainedCommandSpan(...args);
  });
  const enabled = await replay.prepare(snapshot([1]), { signal }); enabled.commit();
  const before = sample(replay.getLayers().get(1), 4, 4);
  const disabled = await replay.prepare(snapshot([0]), { signal }); disabled.commit();
  const after = sample(replay.getLayers().get(1), 4, 4);
  assert.equal(calls, 1, "hiding the backdrop replays the unchanged blended island because its prefix changed");
  assert(before[0] >= 254 && before[2] >= 254 && Math.abs(before[3] - 128) <= 1,
    "Screen over opaque red needs a magenta correction layer");
  assert(after[0] <= 1 && after[2] >= 254 && Math.abs(after[3] - 128) <= 1,
    "after hiding red, the same canonical island replays to translucent blue");
  assert.equal(sample(replay.getLayers().get(0), 4, 4)[3], 0);
  const restored = await replay.prepare(snapshot([1]), { signal }); restored.commit();
  assert.deepEqual(sample(replay.getLayers().get(1), 4, 4), before, "backdrop restoration is reproducible without source PDF bytes");
  assert.deepEqual(loaded.retainedPages[0].page.stores.optionalContent.defaultVisible, Uint8Array.of(1));
  loaded.rasterLayers.forEach((layer, index) => assert.deepEqual(layer.data, canonical[index]));
  replay.dispose();
}

async function testIndependentSpans({ page, RetainedPageReplay, renderNativeRetainedCommandSpan, createEmptyVectorScene, snapshot, sample, signal }) {
  const scene = createEmptyVectorScene();
  scene.retainedPages = [{ page, optionalContentConditions: Int32Array.of(0, 1, 2), matrix: Float32Array.of(1, 0, 0, 1, 0, 0) }];
  scene.rasterLayers = await Promise.all([0, 1].map(first => renderNativeRetainedCommandSpan(page, first, 1, signal)));
  assert.equal(scene.rasterLayers[1].data.byteLength, 4, "initially empty spans retain transparent 1x1 slots");
  scene.drawRuns = [0, 1].map(first => ({ kind: "raster", first, count: 1 }));
  scene.paintGraph = { roots: [0, 1].map(firstCommand => ({ kind: "retained", firstCommand, count: 1, retainedPage: 0, rasterIndex: firstCommand })) };
  const calls = [];
  const replay = new RetainedPageReplay(scene, async (...args) => { calls.push(args[1]); return renderNativeRetainedCommandSpan(...args); });
  const first = await replay.prepare(snapshot([1, 1, 1]), { signal }); first.commit();
  assert.deepEqual(calls, [1], "enabling one layer only renders its dependent span");
  assert.deepEqual([...first.layers.keys()], [1]);
  assert.equal(replay.getLayers().size, 2, "renderer replacement still receives the complete cache");
  assert.equal(replay.getLayers().get(0), scene.rasterLayers[0]);
  assert.deepEqual(sample(replay.getLayers().get(1), 9, 3), [0, 0, 255, 255]);
  const repeated = await replay.prepare(snapshot([1, 1, 0]), { signal }); repeated.commit();
  assert.equal(repeated.layers.size, 0);
  assert.deepEqual(calls, [1]);
  const hidden = await replay.prepare(snapshot([0, 1, 0]), { signal }); hidden.commit();
  assert.deepEqual([...hidden.layers.keys()], [0]);
  assert.equal(hidden.layers.get(0).data.byteLength, 4);
  assert.deepEqual(calls, [1, 0]);
  replay.dispose();

  const { createLayerVisibilityController } = await import("../src/layerVisibility.ts");
  scene.optionalContent = { groups: ["A", "B", "Unused"].map((id, i) => ({ id, name: id,
    defaultVisible: i !== 1, locked: false, usedInView: true })),
    conditions: ["A", "B", "Unused"].map(groupId => ({ kind: "group", groupId })), order: [], radioGroups: [] };
  let swap = false, renderer;
  const makeRenderer = () => ({
    layers: new Map(scene.rasterLayers.map((layer, index) => [index, layer])),
    setOptionalContentVisibility() {},
    prepareRasterLayerUpdates(updates) {
      if (swap && this === firstRenderer) { renderer = replacement; swap = false; }
      return { commit: () => { for (const [index, layer] of updates) this.layers.set(index, layer); }, dispose() {} };
    }
  });
  const firstRenderer = makeRenderer(), replacement = makeRenderer(); renderer = firstRenderer;
  const controller = createLayerVisibilityController({ getScene: () => scene, getRenderer: () => renderer });
  controller.sceneChanged();
  await controller.setLayerVisibility("A", false);
  swap = true;
  await controller.setLayerVisibility("B", true);
  assert.equal(renderer, replacement);
  assert.equal(replacement.layers.get(0).data.byteLength, 4, "replacement receives earlier applied deltas as well as the pending one");
  assert.deepEqual(sample(replacement.layers.get(1), 9, 3), [0, 0, 255, 255]);
  controller.dispose();
}

async function testDependencies(source) {
  const { RetainedSpanDependencies } = await import("../src/retainedSpanDependencies.ts");
  const { HEPR_PAINT_KIND } = await import("../src/heprDocumentData.ts");
  const page = structuredClone(source), root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
  const draw = condition => ({ ...root.commands[0], optionalContentIndex: condition });
  const invoke = { ...draw(0), kind: "invoke-program", programIndex: 0, type3PaintIndex: -1, viewTransformFlags: 0 };
  const group = { ...root, isolated: true, commands: [draw(1)], softMaskGroupIndex: 2 };
  page.displayProgram.groups = [root, group, { ...root, isolated: true, softMaskGroupIndex: -1, commands: [draw(2)] }];
  page.displayProgram.rootGroupIndex = 0;
  page.displayProgram.programs = [{ kind: "form", commands: [{ ...draw(-1), kind: "invoke-group", groupIndex: 1 }] }];
  root.commands = [draw(0), { ...invoke, optionalContentIndex: -1 }];
  const read = () => [...new RetainedSpanDependencies(page).span(1, 1)].sort();
  assert.deepEqual(read(), [1, 2], "program and mask dependencies exclude an unrelated prefix");
  group.blendMode = "Screen";
  assert.deepEqual(read(), [0, 1, 2], "backdrop-dependent programs include prefix conditions");
  group.blendMode = "Normal";
  root.commands = [draw(0), { ...draw(-1), fillPaintIndex: 0 }];
  page.stores.paints.kinds = Uint8Array.of(HEPR_PAINT_KIND.Pattern, HEPR_PAINT_KIND.SolidColor);
  page.stores.paints.resourceIndices = Uint32Array.of(0, 0);
  group.commands[0].fillPaintIndex = group.commands[0].paintIndex = 1;
  page.displayProgram.groups[2].commands[0].fillPaintIndex = page.displayProgram.groups[2].commands[0].paintIndex = 1;
  page.stores.patterns.programIndices = Int32Array.of(0);
  assert.deepEqual(read(), [1, 2], "pattern paint programs retain their nested layer dependencies");
}
