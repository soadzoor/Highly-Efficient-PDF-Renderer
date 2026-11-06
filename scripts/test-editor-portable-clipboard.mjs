import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { decodeEditorRecoveryGraph, encodeEditorRecoveryGraph } = await import("../src/editorRecoveryCodec.ts");
  const { getEditorCapturedSourceScene } = await import("../src/editorClipboard.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { createBundledStandardFontResolver, BUNDLED_STANDARD_FONT_ASSETS } = await import("../src/standardFontResolver.ts");
  const { resolveEditorColorPreviewRefs } = await import("../src/editorColorPreview.ts");
  const { editorSourcePaintColors } = await import("../src/editorSourceColors.ts");
  const { applyEditorPropertyPatch } = await import("../src/editorProperties.ts");
  const { PAGE_PRIMITIVE_KINDS, scenePrimitiveCounts } = await import("../src/scenePageViews.ts");
  const { portableEditorSourceScene } = await import("../src/editorClipboardPayload.ts");
  const { validateScenePaintGraph } = await import("../src/scenePaintGraph.ts");
  const { editorPaintRole } = await import("../src/editorPaintIdentity.ts");
  const missingFontResolver = createBundledStandardFontResolver({ loadAsset: asset => readFile(asset.url) });
  const secret = "unselected-private-document-content";
  const make = () => {
    const scene = buildStrokeScene([{ points: [[40, 60], [60, 60]], width: 2, color: "blue" },
      { points: [[190, 90], [210, 90]], width: 2, color: "red" }]);
    Object.assign(scene, { pageCount: 2, pageRects: Float32Array.of(30, 40, 130, 140, 180, 70, 580, 470), pageTextRanges: new Uint32Array(4),
      pageBounds: { minX: 30, minY: 40, maxX: 580, maxY: 470 }, bounds: { minX: 30, minY: 40, maxX: 580, maxY: 470 } });
    return scene;
  };
  const shape = x => ({ kind: "shape", shape: "rectangle", pageIndex: 1, x, y: 30, width: 20, height: 20, color: "green", fill: "green" });
  const services = await createEditorAppServices({ loadFontAsset: url => readFile(url) });
  const font = await services.fonts.register(new Uint8Array(await readFile(BUNDLED_STANDARD_FONT_ASSETS["liberation-sans-regular"].url)),
    { family: "Portable Custom Family", fontWeight: 400 });
  const bold = await services.fonts.register(new Uint8Array(await readFile(BUNDLED_STANDARD_FONT_ASSETS["liberation-sans-bold"].url)),
    { family: "Portable Custom Family", fontWeight: 700 });
  await services.fonts.loadBundled("Liberation Mono"); // An unrelated font must stay outside the payload.
  const sourceScene = make();
  sourceScene.textContent = [{ text: secret, minX: 0, minY: 0, maxX: 1, maxY: 1 }];
  sourceScene.optionalContent = { groups: [{ id: "private-layer", name: secret, defaultVisible: true, locked: false, usedInView: true }],
    conditions: [{ kind: "group", groupId: "private-layer" }], order: [{ kind: "group", groupId: "private-layer" }], radioGroups: [] };
  sourceScene.drawRuns = [{ kind: "stroke", first: 0, count: 2, optionalContent: 0 }];
  sourceScene.textIndex = { version: 2, pages: [
    { text: secret, charInstance: Int32Array.from(secret, () => -2), fallbackQuads: Float32Array.of(40, 40, 60, 60) },
    { text: `A ${secret}`, charInstance: Int32Array.from(`A ${secret}`, (_, i) => i === 0 ? -2 : i === 1 ? -1 : -3),
      fallbackQuads: Float32Array.of(192, 89, 198, 91, 500, 400, 550, 450) }
  ] };
  const source = createEditorSession(sourceScene, { ...services.sessionOptions, sourcePdf: new TextEncoder().encode(`%PDF ${secret}`) });
  let bytes, originalBounds;
  try {
    source.selectPrimitives([{ kind: "stroke", index: 1 }]); const stroke = source.getSelection()[0];
    const a = source.addObject(shape(35)), text = source.addObject({ kind: "text", pageIndex: 1, x: 60, y: 50, width: 110, height: 25,
      text: "Portable text", fontSize: 12, fontId: font.id, fontFamily: font.family,
      runs: [{ text: "Portable ", fontId: font.id }, { text: "text", fontWeight: 700, underline: true }] });
    const image = source.addObject({ kind: "image", pageIndex: 1, x: 80, y: 10, width: 15, height: 15,
      imageWidth: 1, imageHeight: 1, data: Uint8Array.of(0, 255, 0, 255) });
    const field = source.addObject({ kind: "field", fieldType: "dropdown", pageIndex: 1, x: 60, y: 100, width: 100, height: 20,
      name: "SharedName", value: "a", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], fontId: font.id });
    const outside = source.addObject(shape(250));
    source.setObjectLink(a, { type: "object", objectId: text }); source.setObjectLink(image, { type: "object", objectId: outside });
    source.setObjectLink(field, { type: "destination", destination: { sourcePageIndex: 0 } });
    source.select([stroke, a]); const group = source.groupSelection();
    source.setObjectsLocked([text], true); source.select([group, text, image, field]); originalBounds = source.getSelectionBounds();
    await source.copySelection(); const before = source.getState(); bytes = await source.exportClipboard(); assert(bytes instanceof Uint8Array);
    assert.deepEqual(source.getState(), before, "exporting copied objects never changes dirty state or history");
    const payload = decodeEditorRecoveryGraph(bytes);
    assert.equal(payload.source, undefined); assert.equal(payload.sourcePdf, undefined); assert.equal(payload.sourceScene, undefined);
    assert.equal(payload.fonts.length, 2); assert(payload.fonts.some(asset => asset.id === font.id));
    assert(payload.fonts.some(asset => asset.id === bold.id), "inherited rich-text weight retains the actual registered custom bold face");
    assert.equal(new TextDecoder().decode(bytes).includes(secret), false, "unselected page text and PDF bytes never enter portable clipboard data");
    assert(payload.objects.get(a).link); assert.equal(payload.objects.get(image).link, undefined); assert.equal(payload.objects.get(field).link, undefined);
    assert.equal(payload.sources.get(stroke).scene.pageCount, 1); assert.equal(payload.sources.get(stroke).frame.pageIndex, 0);
    assert.equal(payload.sources.get(stroke).scene.textIndex.pages[0].text, "", "a copied vector's bounds cannot claim unrelated OCR text");
    assert.equal(payload.sources.get(stroke).scene.optionalContent.groups.length, 0);
    assert(payload.sources.get(stroke).scene.optionalContent.conditions.every(condition => condition.kind === "constant"));
  } finally { source.dispose(); services.dispose(); }

  const destinationScene = make(); destinationScene.pageRects = Float32Array.of(10, 20, 410, 420, 500, 600, 900, 1000);
  const destination = await openEditorSession(destinationScene, { loadFontAsset: url => readFile(url) });
  try {
    destination.addObject({ kind: "field", fieldType: "text", name: "SharedName", pageIndex: 0, x: 10, y: 10, width: 30, height: 20, value: "original" });
    const layer = destination.createLayer({ name: "Destination" }); destination.setActiveLayer(layer);
    const before = destination.getState(), imported = new Uint8Array(bytes);
    const importing = destination.importClipboard(imported); imported.fill(0);
    assert.equal(await importing, 4);
    assert.deepEqual(destination.getState(), before, "import only prepares the clipboard without document edits");
    destination.pasteSelection({ offset: [0, 0] });
    const inPlace = destination.getSelectionBounds();
    assert.deepEqual(inPlace, { minX: originalBounds.minX - 180 + 10, minY: originalBounds.minY - 70 + 20,
      maxX: originalBounds.maxX - 180 + 10, maxY: originalBounds.maxY - 70 + 20 }, "foreign paste-in-place preserves source page-local coordinates on destination page zero");
    assert(destination.undo());
    const target = { pageIndex: 1, center: [700, 800] }, revision = destination.revision, roots = destination.pasteSelection({ target });
    assert.equal(destination.revision, revision + 1); assert.equal(roots.length, 4);
    const box = destination.getSelectionBounds(); assert.deepEqual([(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2], target.center);
    const objects = destination.getObjects({ includeSource: false }), copied = objects.filter(object => object.pageIndex === 1);
    assert(copied.every(object => object.kind === "group" || destination.getObjectLayerIds(object.id).includes(layer)));
    const text = copied.find(object => object.kind === "text"), shape = copied.find(object => object.kind === "shape"), image = copied.find(object => object.kind === "image");
    assert(destination.isObjectLocked(text.id)); assert.equal(shape.link.objectId, text.id); assert.equal(image.link, undefined);
    assert.equal(copied.find(object => object.kind === "field").link, undefined);
    assert.notEqual(copied.find(object => object.kind === "field").name, "SharedName");
    const source = copied.find(object => object.kind === "source"), appearance = getEditorCapturedSourceScene(destination, source.id);
    assert.equal(appearance.segmentCount, 1); assert.equal(appearance.pageCount, 1); assert.equal(appearance.textIndex.pages[0].text, "");
    assert(destination.undo()); assert(destination.redo()); assert.equal(destination.getObject(text.id).text, "Portable text");
    const saved = new Uint8Array(await (await destination.savePdf()).arrayBuffer());
    const pdf = await openPdf({ kind: "bytes", bytes: saved }, { missingFontResolver });
    try {
      const vector = await pdf.compileVectorPage(1, { optimization: "none" });
      assert(vector.textIndex.pages[0].text.includes("Portable"), "registered font programs preserve editable text across documents");
      const rendered = await renderHeprPageToCanvas2d(await pdf.compilePage(1, { optimization: "none" }), { scale: 2,
        surfaceFactory(width, height) { const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") }; } });
      const dx = 700 - (originalBounds.minX + originalBounds.maxX) / 2, dy = 800 - (originalBounds.minY + originalBounds.maxY) / 2;
      const x = 200 + dx - 500, y = 90 + dy - 600;
      const pixel = rendered.surface.context.getImageData(Math.floor(x * 2), rendered.height - 1 - Math.floor(y * 2), 1, 1).data;
      assert(pixel[0] > 200 && pixel[1] < 30 && pixel[2] < 30, "exported destination PDF retains frozen source artwork from the closed source editor");
    } finally { await pdf.close(); }
    const valid = bytes, invalid = decodeEditorRecoveryGraph(valid), previous = destination.getState(); invalid.roots.push("unknown");
    await assert.rejects(destination.importClipboard(encodeEditorRecoveryGraph(invalid)), /group/);
    assert.deepEqual(destination.getState(), previous); assert(destination.canPaste(), "invalid payloads preserve the previous clipboard");
    const cyclic = decodeEditorRecoveryGraph(valid), group = [...cyclic.objects.values()].find(object => object.kind === "group"); group.children.push(group.id);
    await assert.rejects(destination.importClipboard(encodeEditorRecoveryGraph(cyclic)), /group/);
    const malformed = decodeEditorRecoveryGraph(valid); [...malformed.sources.values()][0].scene.endpoints = new Float32Array();
    await assert.rejects(destination.importClipboard(encodeEditorRecoveryGraph(malformed)), /store/);
    const nan = decodeEditorRecoveryGraph(valid); [...nan.sources.values()][0].scene.endpoints[0] = NaN;
    await assert.rejects(destination.importClipboard(encodeEditorRecoveryGraph(nan)), /store/);
    const missingFonts = decodeEditorRecoveryGraph(valid); missingFonts.fonts = [];
    await assert.rejects(destination.importClipboard(encodeEditorRecoveryGraph(missingFonts)), /font assets/);
    destination.clearClipboard(); assert.equal(destination.canPaste(), false); assert.deepEqual(destination.getState(), previous);
  } finally { destination.dispose(); }

  let finish; const gate = new Promise(resolve => { finish = resolve; });
  const delayed = createEditorSession(make(), { restoreRecoveryFonts: async () => { await gate; } });
  try {
    const importing = delayed.importClipboard(bytes); delayed.clearClipboard(); finish();
    await assert.rejects(importing, { name: "AbortError" }); assert.equal(delayed.canPaste(), false);
  } finally { delayed.dispose(); }
  const unavailable = createEditorSession(make());
  try { await assert.rejects(unavailable.importClipboard(bytes), /font assets/); assert.equal(unavailable.canPaste(), false); }
  finally { unavailable.dispose(); }

  // Outlined source strokes must keep their Color role rather than become Fill paint.
  const outlined = createEditorSession(make()), outlinedTarget = createEditorSession(make());
  try {
    outlined.selectPrimitives([{ kind: "stroke", index: 1 }]); outlined.transformSelection([2, 0, 0, .5, 0, 0]);
    await outlined.copySelection(); await outlinedTarget.importClipboard(await outlined.exportClipboard());
    const [id] = outlinedTarget.pasteSelection({ target: { pageIndex: 0, center: [60, 80] } });
    const captured = getEditorCapturedSourceScene(outlinedTarget, id);
    assert(captured.fillPathCount > 0);
    assert.equal(editorPaintRole(captured)({ kind: "fill", index: 0 }), "color", "portable outlined strokes retain their original Color semantics");
    for (const property of ["color", "fill"]) {
      const before = await outlinedTarget.getScene({ preview: false }), counts = scenePrimitiveCounts(before);
      const refs = PAGE_PRIMITIVE_KINDS.flatMap(kind => kind === "raster" ? [] : Array.from({ length: counts[kind] }, (_, index) => ({ kind, index })));
      const selected = resolveEditorColorPreviewRefs(outlinedTarget, before, [id], property);
      const paint = (scene, ref) => JSON.stringify(editorSourcePaintColors(scene, [ref]));
      applyEditorPropertyPatch(outlinedTarget, { [property]: "#d03090" }, [id]);
      const after = await outlinedTarget.getScene({ preview: false });
      assert.deepEqual(selected.map(ref => `${ref.kind}:${ref.index}`).sort(),
        refs.filter(ref => paint(before, ref) !== paint(after, ref)).map(ref => `${ref.kind}:${ref.index}`).sort(), `${property}: imported source preview matches committed paint`);
      if (selected.length) assert(outlinedTarget.undo());
    }
  } finally { outlined.dispose(); outlinedTarget.dispose(); }

  // Retained fallback paint is already represented by canonical raster pixels.
  const retained = make(); retained.pageCount = 1; retained.pageRects = Float32Array.of(0, 0, 100, 100); retained.pageTextRanges = new Uint32Array(2);
  retained.rasterLayers = Array.from({ length: 4 }, (_, index) => ({ width: 1, height: 1, data: Uint8Array.of(index * 40, 0, 0, 255),
    matrix: Float32Array.of(10, 0, 0, 10, index * 10, 0), pageIndex: 0, paintOrder: index }));
  retained.drawRuns = [{ kind: "stroke", first: 0, count: 2 }, { kind: "raster", first: 0, count: 1 },
    { kind: "raster", first: 1, count: 1 }, { kind: "raster", first: 2, count: 2 }];
  retained.retainedPages = [{ page: { unrelated: secret } }];
  retained.textIndex = { version: 2, pages: [{ text: `A ${secret}`, charInstance: Int32Array.from(`A ${secret}`, (_, index) => index ? index === 1 ? -1 : -3 : -2),
    fallbackQuads: Float32Array.of(2, 2, 4, 4, 80, 80, 90, 90) }] };
  retained.paintGraph = { roots: [{ kind: "draw", runIndex: 0 }, { kind: "group", alpha: .5, isolated: true, knockout: false, blendMode: "Normal",
    children: [{ kind: "retained", retainedPage: 0, firstCommand: 0, count: 1, rasterIndex: 0 },
      { kind: "retained", retainedPage: 0, firstCommand: 1, count: 1, rasterIndex: 1 }],
    softMask: { subtype: "Alpha", children: [{ kind: "draw", runIndex: 3 }] } }] };
  const frozen = portableEditorSourceScene(retained, { minX: 0, minY: 0, maxX: 100, maxY: 100 });
  assert(frozen.retained); assert.equal(frozen.scene.retainedPages, undefined); validateScenePaintGraph(frozen.scene);
  assert.equal(frozen.scene.textIndex.pages[0].text, "A", "copied raster footprints retain their own OCR and discard text in uncopied page regions");
  assert(frozen.scene.paintGraph.roots[1].softMask); assert.equal(frozen.scene.rasterLayers.length, 4);
  assert.equal(new TextDecoder().decode(encodeEditorRecoveryGraph(frozen.scene)).includes(secret), false);
  console.log("Portable editor clipboard: cross-document models/groups/fonts/source paint, selected-only bytes, links, destination placement, PDF pixels, ownership, undo, validation and cancellation passed.");
} finally { hooks.deregister(); }
