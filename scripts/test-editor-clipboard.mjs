import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { editorPaintIdentity, editorPaintOwnerObject, setEditorPaintIdentity } = await import("../src/editorPaintIdentity.ts");
  const { getEditorCapturedSourceScene, editorClipboardStore, shareEditorClipboard } = await import("../src/editorClipboard.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { editorPoint } = await import("../src/editorScene.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { createEditorRecoveryCodec } = await import("../src/editorRecoveryCodec.ts");
  const { createBundledStandardFontResolver } = await import("../src/standardFontResolver.ts");
  const missingFontResolver = createBundledStandardFontResolver({ loadAsset: asset => readFile(asset.url) });
  const center = bounds => [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
  const readPixels = async (bytes, pageIndex = 0) => {
    const reopened = await openPdf({ kind: "bytes", bytes }, { missingFontResolver });
    try {
      const page = await reopened.compilePage(pageIndex, { optimization: "none" });
      const rendered = await renderHeprPageToCanvas2d(page, { scale: 2, surfaceFactory(width, height) {
        const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") };
      } });
      return (x, y) => {
        assert(x >= 0 && y >= 0 && x * 2 < rendered.width && y * 2 < rendered.height, `Sample ${x},${y} lies outside ${rendered.width / 2}x${rendered.height / 2} page`);
        return Array.from(rendered.surface.context.getImageData(Math.floor(x * 2), rendered.height - 1 - Math.floor(y * 2), 1, 1).data);
      };
    } finally { await reopened.close(); }
  };
  const identity = [1, 0, 0, 1, 0, 0];
  const make = () => {
    const scene = buildStrokeScene([{ points: [[10, 20], [60, 20]], width: 2, color: "red" }, { points: [[10, 70], [60, 70]], width: 2 }]);
    scene.pageRects = Float32Array.of(0, 0, 100, 100); scene.pageBounds = scene.bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    return scene;
  };
  const shape = (x = 5) => ({ kind: "shape", shape: "rectangle", pageIndex: 0, x, y: 6, width: 10, height: 12, color: "red", fill: "blue", opacity: .7, fillOpacity: .4 });
  const ownedStrokes = (scene, id) => {
    const owner = editorPaintIdentity(scene), points = [];
    for (let index = 0; index < scene.segmentCount; index++) if (editorPaintOwnerObject(owner({ kind: "stroke", index })) === id) {
      points.push([...scene.endpoints.subarray(index * 4, index * 4 + 2), ...scene.primitiveMeta.subarray(index * 4, index * 4 + 2)]);
    }
    return points;
  };
  for (const open of [scene => createEditorSession(scene), openEditorSession]) {
    const session = await open(make());
    try {
      const a = session.createLayer({ name: "A" }), b = session.createLayer({ name: "B" }); session.setActiveLayer(a);
      const id = session.addObject(shape()), original = session.getObject(id); session.markSaved();
      const before = session.getState(); assert.equal(session.canPaste(), false);
      assert.equal(await session.copySelection(), 1); assert.equal(session.canPaste(), true);
      assert.deepEqual(session.getState(), before, "copy leaves dirty state and history unchanged");
      session.updateObject(id, { fill: "green", width: 90 }); session.setActiveLayer(b);
      const [paste] = session.pasteSelection();
      assert.deepEqual(session.getObjectLayerIds(paste), [b]); assert.equal(session.getObject(paste).fill, original.fill);
      assert.equal(session.getObject(paste).width, original.width, "later changes to originals cannot alter copied author models");
      assert.deepEqual(session.getObject(paste).transform, [1, 0, 0, 1, 12, -12]);
      const [next] = session.pasteSelection(); assert.deepEqual(session.getObject(next).transform, [1, 0, 0, 1, 24, -24]);
      assert(session.undo()); assert.throws(() => session.getObject(next)); assert(session.redo()); assert.equal(session.getObject(next).id, next);
      session.select([]); assert.equal(await session.copySelection(), 0); assert(session.canPaste(), "an empty copy preserves the previous clipboard");
      const untouched = session.getState(); assert.throws(() => session.pasteSelection({ offset: [NaN, 0] }), /finite/); assert.deepEqual(session.getState(), untouched);
      for (const target of [{ pageIndex: -1, center: [20, 30] }, { pageIndex: 1, center: [20, 30] }, { pageIndex: 0, center: [Infinity, 30] }]) {
        assert.throws(() => session.pasteSelection({ target }), /page|finite/); assert.deepEqual(session.getState(), untouched);
      }
      assert.throws(() => session.pasteSelection({ offset: [0, 0], target: { pageIndex: 0, center: [20, 30] } }), /combined/);
      assert.deepEqual(session.getState(), untouched);
      const [targeted] = session.pasteSelection({ target: { pageIndex: 0, center: [65, 45] } });
      assert.deepEqual(center(session.getObjectBounds(targeted)), [65, 45], "target placement uses the copied bounds even after originals change");
      const [repeated] = session.pasteSelection({ target: { pageIndex: 0, center: [65, 45] } });
      assert.deepEqual(session.getObject(repeated).transform, session.getObject(targeted).transform, "targeted paste never cascades away from its requested center");
      session.select([id]); const cutBounds = session.getSelectionBounds(); assert.equal(await session.cutSelection(), 1);
      assert.throws(() => session.getObject(id)); session.setActiveLayer(null);
      const [moved] = session.pasteSelection(); assert.deepEqual(session.getObjectLayerIds(moved), []);
      assert.deepEqual(session.getObjectBounds(moved), cutBounds, "cut/paste retains exact composed position");
      assert(session.undo()); assert.throws(() => session.getObject(moved)); assert(session.undo()); assert.equal(session.getObject(id).id, id, "undo restores the cut source independently of paste");
      session.updateLayer(b, { defaultVisible: false }); session.setActiveLayer(b);
      const [hidden] = session.pasteSelection(); assert.deepEqual(session.getObjectLayerIds(hidden), [b]); assert(!session.isObjectVisible(hidden));
      assert.equal(session.getLayers().find(layer => layer.id === b).defaultVisible, false, "paste never silently shows a hidden destination");
    } finally { session.dispose(); }
  }
  {
    const session = createEditorSession(make());
    try {
      const layer = session.createLayer({ name: "Destination" });
      const ids = [session.addObject(shape()), session.addObject({ kind: "text", pageIndex: 0, x: 20, y: 30, width: 40, height: 20,
        text: "Mixed", fontSize: 12, runs: [{ text: "Mi", fontSize: 9, color: "red" }, { text: "xed", fontSize: 15, underline: true }] }),
      session.addObject({ kind: "image", pageIndex: 0, x: 2, y: 3, width: 10, height: 10, imageWidth: 1, imageHeight: 1, data: Uint8Array.of(1, 2, 3, 128) }),
      session.addObject({ kind: "signature", pageIndex: 0, paths: [[[1, 2], [3, 4]]], color: "purple", smoothing: .2, strokeWidth: 3, fillOpacity: .4 }),
      session.addObject({ kind: "ink", pageIndex: 0, paths: [[[4, 5], [6, 7]]], color: "green", strokeWidth: 5 })];
      session.select(ids.slice(0, 2)); const nested = session.groupSelection(); session.select([nested, ...ids.slice(2)]); const group = session.groupSelection();
      session.transformSelection([0, 1, -1, 0, 80, 2]); const frame = session.getSelectionFrame(), bounds = session.getSelectionBounds();
      await session.copySelection(); session.deleteSelection(); session.setActiveLayer(layer);
      const [pasted] = session.pasteSelection({ offset: [0, 0] }); assert.equal(session.getObject(pasted).kind, "group");
      assert.deepEqual(session.getSelectionFrame(), frame); assert.deepEqual(session.getSelectionBounds(), bounds);
      const all = session.getObjects({ includeSource: false }); assert.equal(all.length, 7, "nested group topology is retained without orphan copies");
      const originalIds = new Set([...ids, nested, group]); assert(all.every(object => !originalIds.has(object.id)));
      for (const object of all) if (object.kind === "group") assert(object.children.every(id => all.some(child => child.id === id)));
      else assert.deepEqual(session.getObjectLayerIds(object.id), [layer]);
      assert.deepEqual(all.find(object => object.kind === "image").data, Uint8Array.of(1, 2, 3, 128));
      assert.deepEqual(all.find(object => object.kind === "text").runs.map(run => run.text), ["Mi", "xed"]);
      assert.equal(all.find(object => object.kind === "signature").smoothing, .2);
    } finally { session.dispose(); }
  }
  {
    const session = createEditorSession(make());
    try {
      session.selectPrimitives([{ kind: "stroke", index: 0 }]); session.transformSelection([0, 1, -1, 0, 80, 2]);
      const bounds = session.getSelectionBounds(), frame = session.getSelectionFrame(); await session.copySelection();
      session.transformSelection([1, 0, 0, 1, 30, 50]); session.deleteSelection();
      const [id] = session.pasteSelection({ offset: [0, 0] }); assert.deepEqual(session.getObjectBounds(id), bounds); assert.deepEqual(session.getSelectionFrame(), frame);
      assert.deepEqual(ownedStrokes(await session.getScene(), id), [[60, 12, 60, 62]], "source appearance is frozen at copy time");
      session.select([id]); const [duplicate] = session.cloneSelection([5, 3]);
      assert.deepEqual(ownedStrokes(await session.getScene(), duplicate), [[65, 15, 65, 65]], "duplicate preserves the frozen source geometry");
      session.select([id]); await session.copySelection(); session.deleteSelection(); const [recopy] = session.pasteSelection({ offset: [0, 0] });
      assert.deepEqual(ownedStrokes(await session.getScene(), recopy), [[60, 12, 60, 62]], "copying an already pasted source preserves its independent geometry");
      const saved = await loadSceneFromHep(await (await session.saveHep({ withVectorLod: false, withTextLod: false })).arrayBuffer());
      assert.equal(saved.segmentCount, 3); assert(!("clipboard" in saved)); assert(!("editor" in saved));
      assert.equal(getEditorCapturedSourceScene(session, recopy).segmentCount, 1);
    } finally { session.dispose(); }
  }
  {
    const scene = buildStrokeScene([{ points: [[40, 60], [60, 60]], width: 2, color: "red" }, { points: [[190, 90], [210, 90]], width: 2 }]);
    Object.assign(scene, { pageCount: 2, pageRects: Float32Array.of(30, 40, 130, 140, 180, 70, 680, 270), pageTextRanges: new Uint32Array(4),
      pageBounds: { minX: 30, minY: 40, maxX: 680, maxY: 270 }, bounds: { minX: 30, minY: 40, maxX: 680, maxY: 270 } });
    const session = await openEditorSession(scene);
    try {
      session.selectPrimitives([{ kind: "stroke", index: 0 }]); const source = session.getSelection()[0];
      const shapeId = session.addObject({ ...shape(), x: 2, y: 55 }); session.select([source, shapeId]); const inner = session.groupSelection();
      const sibling = session.addObject({ ...shape(), x: 50, y: 65 }); session.select([inner, sibling]); const group = session.groupSelection();
      session.transformSelection([1, .2, .3, 1, 10, -5]);
      const image = session.addObject({ kind: "image", pageIndex: 1, x: 50, y: 80, width: 10, height: 10, imageWidth: 1, imageHeight: 1, data: Uint8Array.of(0, 255, 0, 255) });
      session.select([group, image]); const beforeBounds = session.getSelectionBounds(); await session.copySelection();
      const captured = editorClipboardStore(session).value, bounds = new Map([...captured.objects.keys()].map(id => [id, session.getObjectBounds(id)]));
      const revision = session.revision, target = { pageIndex: 1, center: [400, 150] }, roots = session.pasteSelection({ target });
      assert.equal(session.revision, revision + 1, "cross-page paste is one undoable transaction");
      assert.deepEqual(center(session.getSelectionBounds()), target.center); assert.equal(session.getSelectionFrame().pageIndex, 1);
      const displacement = target.center.map((value, index) => value - center(beforeBounds)[index]);
      const verify = (oldId, newId) => {
        const original = captured.objects.get(oldId), pasted = session.getObject(newId), box = bounds.get(oldId);
        assert.equal(pasted.pageIndex, 1, "all nested groups and leaves move to the destination page");
        const expected = { minX: box.minX + displacement[0], minY: box.minY + displacement[1], maxX: box.maxX + displacement[0], maxY: box.maxY + displacement[1] };
        const actual = session.getObjectBounds(newId);
        for (const key of Object.keys(expected)) assert(Math.abs(actual[key] - expected[key]) < 1e-10, "mixed-page paste retains composed spacing and transforms");
        if (original.kind === "group") original.children.forEach((id, index) => verify(id, pasted.children[index]));
      };
      captured.roots.forEach((id, index) => verify(id, roots[index]));
      assert(session.undo()); for (const id of roots) assert.throws(() => session.getObject(id)); assert(session.redo());
      assert.deepEqual(center(session.getSelectionBounds()), target.center);
      session.select([roots[0]]); await session.cutSelection();
      const [cut] = session.pasteSelection({ target: { pageIndex: 0, center: [80, 90] } });
      center(session.getObjectBounds(cut)).forEach((value, index) => assert(Math.abs(value - [80, 90][index]) < 1e-10));
      assert.equal(session.getSelectionFrame().pageIndex, 0);
    } finally { session.dispose(); }
  }
  {
    const bytes = crossPagePdf(), parser = await openPdf({ kind: "bytes", bytes }, { missingFontResolver }); let scene;
    try { scene = composeVectorScenesInGrid([await parser.compileVectorPage(0, { optimization: "none" }), await parser.compileVectorPage(1, { optimization: "none" })], 2); }
    finally { await parser.close(); }
    assert(scene.gradientFillPathCount && scene.textInstanceCount && scene.rasterLayers.length, "fixture exercises gradient, source text and image page metadata");
    for (const sourcePdf of [undefined, bytes]) {
      const session = await openEditorSession(structuredClone(scene), { sourcePdf, loadFontAsset: async url => new Uint8Array(await readFile(url)) });
      try {
        const sourceObjects = session.getObjects({ includeSource: true, pageIndex: 1 }); session.select(sourceObjects.map(object => object.id));
        const bounds = session.getSelectionBounds(); await session.copySelection();
        const captured = editorClipboardStore(session).value, untouched = structuredClone(captured.sources), target = { pageIndex: 0, center: [scene.pageRects[0] + 120, scene.pageRects[1] + 100] };
        const pasted = session.pasteSelection({ target }); assert.deepEqual(center(session.getSelectionBounds()), target.center);
        assert(pasted.every(id => session.getObject(id).pageIndex === 0)); assert.equal(session.getSelectionFrame().pageIndex, 0);
        const dx = target.center[0] - center(bounds)[0], dy = target.center[1] - center(bounds)[1], sourceOrigin = scene.pageRects.subarray(4, 6), origin = scene.pageRects.subarray(0, 2);
        const point = (x, y) => [sourceOrigin[0] + x + dx - origin[0], sourceOrigin[1] + y + dy - origin[1]];
        for (const id of pasted) {
          const appearance = getEditorCapturedSourceScene(session, id); assert.equal(appearance.pageCount, 1);
          assert.deepEqual(appearance.pageRects, scene.pageRects.slice(0, 4));
          assert(appearance.rasterLayers.every(layer => layer.pageIndex === 0));
        }
        const output = new Uint8Array(await (await session.savePdf()).arrayBuffer()), pixel = await readPixels(output);
        assert.deepEqual(pixel(...point(65, 15)), [0, 255, 0, 255], "editable PDF retains a copied source image on its new page");
        const gradient = pixel(...point(20, 20)); assert(gradient[0] > 200 && gradient[2] < 30 && gradient[3] === 255, "editable PDF retains a copied gradient on its new page");
        const reopened = await openPdf({ kind: "bytes", bytes: output });
        try { assert((await reopened.compileVectorPage(0, { optimization: "none" })).textIndex.pages[0].text.includes("A"), "copied text retains its original page's searchable data"); }
        finally { await reopened.close(); }
        const flat = await readPixels(new Uint8Array(await (await session.savePdf({ flatten: true })).arrayBuffer()));
        assert.deepEqual(flat(...point(65, 15)), [0, 255, 0, 255]);
        const hep = await loadSceneFromHep(await (await session.saveHep({ withVectorLod: false, withTextLod: false })).arrayBuffer());
        assert.equal(hep.rasterLayers.filter(layer => layer.pageIndex === 0).length, 1);
        assert.deepEqual(captured.sources, untouched, "preview and exports never rewrite the frozen clipboard's page metadata");
        const codec = createEditorRecoveryCodec(), recovery = await codec.decode(await codec.encode(await session.captureRecovery()));
        const restored = await openEditorSession(structuredClone(scene), { sourcePdf, loadFontAsset: async url => new Uint8Array(await readFile(url)) });
        try {
          await restored.restoreRecovery(recovery.snapshot);
          const recovered = await readPixels(new Uint8Array(await (await restored.savePdf()).arrayBuffer()));
          assert.deepEqual(recovered(...point(65, 15)), [0, 255, 0, 255], "cross-page copies retain their frozen appearances through recovery and another PDF save");
        } finally { restored.dispose(); }
      } finally { session.dispose(); }
    }
  }
  {
    const session = await openEditorSession(make());
    try {
      const shapeId = session.addObject(shape()); session.setObjectsLocked([shapeId], true); await session.copySelection();
      const [lockedShape] = session.pasteSelection({ target: { pageIndex: 0, center: [60, 70] } });
      assert(session.isObjectLocked(lockedShape)); assert.deepEqual(center(session.getObjectBounds(lockedShape)), [60, 70]);
      assert(session.undo()); assert.throws(() => session.getObject(lockedShape)); assert(session.redo()); assert(session.isObjectLocked(lockedShape));
      session.selectPrimitives([{ kind: "stroke", index: 0 }]); session.setObjectsLocked(session.getSelection(), true); await session.copySelection();
      const [lockedSource] = session.pasteSelection(); assert(session.isObjectLocked(lockedSource), "source locks survive frozen appearance capture and default-offset paste");
      assert.throws(() => session.transformSelection([1, 0, 0, 1, 1, 0]), /locked/);
      const first = session.addObject(shape(25)), second = session.addObject(shape(45)); session.select([first, second]); const group = session.groupSelection();
      session.setObjectsLocked([first], true); await session.copySelection();
      const [partialGroup] = session.pasteSelection({ target: { pageIndex: 0, center: [50, 50] } }), children = session.getObject(partialGroup).children;
      assert(session.isObjectLocked(children[0])); assert(!session.isObjectLocked(children[1]));
      session.setObjectsLocked([children[0]], false); assert(!session.isObjectLocked(partialGroup), "a locked descendant does not become a new lock on its entire group");
      session.select([group]); session.setObjectsLocked([group], true); await session.copySelection();
      const [lockedGroup] = session.pasteSelection(); assert(session.isObjectLocked(lockedGroup));
      const output = new Uint8Array(await (await session.savePdf()).arrayBuffer()), reopened = await openPdf({ kind: "bytes", bytes: output });
      try {
        const saved = await reopened.compileVectorPage(0, { optimization: "none" });
        assert(saved.annotations.find(annotation => annotation.name === lockedSource).flags & 128, "copied source locks persist in editable PDF Stamp flags");
      } finally { await reopened.close(); }
    } finally { session.dispose(); }
  }
  {
    const standalone = createEditorSession(make()); standalone.addObject(shape()); await standalone.copySelection();
    const store = editorClipboardStore(standalone), sequence = store.sequence; standalone.dispose();
    assert.equal(store.value, null); assert(store.sequence > sequence, "standalone disposal releases copied image/model resources and invalidates pending capture");
    const old = createEditorSession(make()), current = createEditorSession(make());
    try {
      old.addObject(shape()); await old.copySelection(); const shared = editorClipboardStore(old); shareEditorClipboard(old, current);
      old.dispose(); assert(shared.value, "pruning an obsolete document page version preserves its shared clipboard");
    } finally { old.dispose(); current.dispose(); }
  }
  {
    const scene = make(); setEditorPaintIdentity(scene, "shared-source-owner");
    const session = createEditorSession(scene);
    try {
      session.selectPrimitives([{ kind: "stroke", index: 0 }]); await assert.rejects(session.cutSelection(), /complete source group/);
      assert.equal(session.getSourceEdits().length, 0, "ambiguous custom provenance cannot copy extra objects or delete source content");
    } finally { session.dispose(); }
  }
  {
    let finish;
    const gate = new Promise(resolve => { finish = resolve; });
    const session = createEditorSession(make(), { async compileObject() { await gate; throw new Error("Cannot compile copied source"); } });
    try {
      const first = session.addObject(shape()); await session.copySelection();
      session.selectPrimitives([{ kind: "stroke", index: 0 }]); const failed = session.cutSelection();
      session.select([first]); finish(); await assert.rejects(failed, /Cannot compile/);
      assert.equal(session.getSourceEdits().length, 0, "failed capture cannot delete source content");
      const [retained] = session.pasteSelection({ offset: [0, 0] }); assert.equal(session.getObject(retained).kind, "shape", "failed capture retains the previous clipboard");
      const cancelled = new AbortController(); cancelled.abort(); await assert.rejects(session.copySelection({ signal: cancelled.signal }), { name: "AbortError" });
    } finally { finish(); session.dispose(); }
  }
  {
    let finish; const gate = new Promise(resolve => { finish = resolve; });
    const session = createEditorSession(make(), { async compileObject() { await gate; return make(); } });
    try {
      const author = session.addObject(shape()); session.selectPrimitives([{ kind: "stroke", index: 0 }]); const pending = session.cutSelection();
      session.select([author]); finish(); await assert.rejects(pending, /selection or document changed/);
      assert.equal(session.getSourceEdits().length, 0); assert.equal(session.getObject(author).id, author); assert.equal(session.canPaste(), false);
    } finally { finish(); session.dispose(); }
  }
  {
    const bytes = checkboxPdf(), parser = await openPdf({ kind: "bytes", bytes }); let source;
    try { source = await parser.compileVectorPage(0, { optimization: "none" }); } finally { await parser.close(); }
    const session = await openEditorSession(source, { sourcePdf: bytes, loadFontAsset: async url => new Uint8Array(await readFile(url)) });
    try {
      const field = source.annotations.find(annotation => annotation.field?.name === "Check"); assert(field);
      session.setFieldValue("Check", true); session.selectAnnotations([field.id]); await session.copySelection();
      session.setFieldValue("Check", false); const layer = session.createLayer({ name: "Copied" }); session.setActiveLayer(layer);
      const [copy] = session.pasteSelection({ offset: [40, 0] }); assert.deepEqual(session.getObjectLayerIds(copy), [layer]);
      const frozen = getEditorCapturedSourceScene(session, copy); assert(frozen && frozen.fillPathCount);
      const output = new Uint8Array(await (await session.savePdf()).arrayBuffer());
      const pixel = await readPixels(output);
      assert.deepEqual(pixel(20, 20), [0, 0, 255, 255], "source field keeps its subsequently changed Off appearance");
      assert.deepEqual(pixel(60, 20), [255, 0, 0, 255], "saved PDF keeps the copied On appearance as an independent Stamp");
      await session.rotatePages([0], 90); assert(session.canPaste());
      const rotated = await session.getScene(), copyAnnotation = rotated.annotations.find(annotation => annotation.name === copy);
      assert(copyAnnotation, "page materialization retains a copied source as a real annotation");
      const rotatedBytes = new Uint8Array(await (await session.savePdf()).arrayBuffer()), rotatedPixel = await readPixels(rotatedBytes);
      const originalPoint = editorPoint(rotated.pdfPages[0].pdfToScene, 20, 20), copiedPoint = editorPoint(rotated.pdfPages[0].pdfToScene, 60, 20);
      assert.deepEqual(rotatedPixel(...originalPoint), [0, 0, 255, 255]);
      assert.deepEqual(rotatedPixel(...copiedPoint), [255, 0, 0, 255], "copied geometry survives page rotation, compilation and another PDF save without its old private metadata");
      assert.throws(() => session.pasteSelection(), /pages changed/, "page changes diagnose incompatible copied coordinates without stale refs");
      assert(session.undo()); assert.equal(session.pasteSelection({ offset: [0, 0] }).length, 1, "undoing a page edit restores valid clipboard coordinates");
      assert(session.canPaste(), "creating a new branch prunes the rotated version without erasing its shared clipboard");
      assert.equal(session.pasteSelection({ offset: [0, 0] }).length, 1);
      const store = editorClipboardStore(session), sequence = store.sequence; assert(store.value); session.dispose();
      assert.equal(store.value, null); assert(store.sequence > sequence, "document disposal releases the shared capture and invalidates pending publication");
    } finally { session.dispose(); }
  }
  console.log("Editor clipboard: author snapshots/groups, frozen source appearances, centered cross-page paste, recovery, destination layers, offsets, cut/undo, cancellation, PDF/HEP and page guards passed.");
} finally { hooks.deregister(); }

function checkboxPdf() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /AcroForm 5 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Annots [4 0 R] /Resources << >> >>" },
    { number: 4, body: "<< /Type /Annot /Subtype /Widget /FT /Btn /T (Check) /Rect [10 10 30 30] /F 4 /V /Off /AS /Off /AP << /N << /Off 6 0 R /Yes 7 0 R >> >> >>" },
    { number: 5, body: "<< /Fields [4 0 R] /NeedAppearances false >>" },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Resources << >>", "0 0 1 rg 0 0 20 20 re f") },
    { number: 7, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Resources << >>", "1 0 0 rg 0 0 20 20 re f") }
  ] });
}

function crossPagePdf() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << >> >>" },
    { number: 4, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 5 0 R /Resources << /Font << /F1 6 0 R >> /Shading << /Sh 7 0 R >> /XObject << /Im 8 0 R >> >> >>" },
    { number: 5, body: tinyPdfStream("", "q 10 10 20 20 re W n /Sh sh Q 1 0 0 RG 2 w 10 50 m 30 50 l S 0 0 0 rg BT /F1 10 Tf 40 20 Td (A) Tj ET q 10 0 0 10 60 10 cm /Im Do Q") },
    { number: 6, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
    { number: 7, body: "<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [10 10 30 10] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [1 1 0] /N 1 >> /Extend [true true] >>" },
    { number: 8, body: tinyPdfStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8", Uint8Array.of(0, 255, 0)) }
  ] });
}
