import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const loaded = new Set();
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) &&
        !/\.[a-z0-9]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.includes("/src/")) {
      assert.doesNotMatch(url, /\/(?:pdfSession|densePdfPageData|retainedVectorPage|nativePdf|nativeDocument|nativeCos|nativeContentCompiler|nativeFont(?:Resources)?|nativeCff)\.ts$/,
        "retained replay must load no PDF parser, compiler, or font parsing modules");
      loaded.add(url);
    }
    return nextLoad(url, context);
  }
});

try {
  const { createEmptyHeprPageData } = await import("../src/heprDocumentData.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { RetainedPageReplay } = await import("../src/retainedPageReplay.ts");
  const { renderNativeRetainedCommandSpan } = await import("../src/retainedPageCompositor.ts");
  const { DEFAULT_PDF_RESOURCE_LIMITS } = await import("../src/pdf/nativeTypes.ts");
  const page = createEmptyHeprPageData({
    sourcePageIndex: 0, mediaBox: [0, 0, 12, 10], cropBox: [0, 0, 12, 10],
    bleedBox: null, trimBox: null, artBox: null, rotation: 0, userUnit: 1, width: 12, height: 10
  });
  page.displayProgram.groups.push({ ...page.displayProgram.groups[0], commands: [] });
  page.displayProgram.groups[0].commands = [{
    kind: "invoke-group", groupIndex: 1, transformIndex: 0, clipIndex: -1,
    optionalContentIndex: 0, markedContentIndex: -1, sourceOffset: -1, sourceLength: -1
  }];
  page.stores.optionalContent = { names: ["Empty group"], defaultVisible: Uint8Array.of(1) };
  const original = structuredClone(page);
  const signal = new AbortController().signal;
  const layer = await renderNativeRetainedCommandSpan(page, 0, 1, signal);
  assert.deepEqual([layer.width, layer.height, ...layer.data], [1, 1, 0, 0, 0, 0],
    "an empty retained span preserves its replay slot");
  assert.equal(layer.retainedFirstCommand, 0);
  assert.equal(layer.retainedCommandCount, 1);
  await assert.rejects(renderNativeRetainedCommandSpan(page, 0, 2, signal), RangeError);
  await assert.rejects(renderNativeRetainedCommandSpan(page, 0, 1, AbortSignal.abort(new Error("cancel replay"))),
    /cancel replay/);
  await assert.rejects(renderNativeRetainedCommandSpan(page, 0, 1, signal,
    { ...DEFAULT_PDF_RESOURCE_LIMITS, maxImagePixels: 0 }), { code: "resource-limit" });

  const scene = createEmptyVectorScene();
  scene.optionalContent = {
    groups: [{ id: "empty", name: "Empty group", defaultVisible: true, locked: false, usedInView: true }],
    conditions: [{ kind: "group", groupId: "empty" }], order: [], radioGroups: []
  };
  scene.retainedPages = [{ page, optionalContentConditions: Int32Array.of(0), matrix: Float32Array.of(1, 0, 0, 1, 0, 0) }];
  scene.rasterLayers = [layer];
  scene.paintGraph = { roots: [{ kind: "retained", retainedPage: 0, firstCommand: 0, count: 1, rasterIndex: 0 }] };
  const replay = new RetainedPageReplay(scene);
  try {
    const prepared = await replay.prepare({ revision: 1, layers: [], conditions: Uint8Array.of(0) }, { signal });
    assert.equal(prepared.layers.size, 1, "the default replay renderer handles a changed retained layer");
    prepared.commit();
    assert.deepEqual([...replay.getLayers().get(0).data], [0, 0, 0, 0]);
  } finally { replay.dispose(); }
  assert.deepEqual(page, original, "compositing leaves all retained resources unchanged");
  assert([...loaded].some(url => url.endsWith("/heprCanvas2dRenderer.ts")),
    "the graph assertion includes the renderer loaded during raster capture");
  console.log("Retained page compositor passed: parser-independent rendering/replay graph, empty slots, cancellation, resource limits, and immutable data.");
} finally { hooks.deregister(); }
