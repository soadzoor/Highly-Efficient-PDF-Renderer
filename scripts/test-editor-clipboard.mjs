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
      const readPixels = async bytes => {
        const reopened = await openPdf({ kind: "bytes", bytes });
        try {
          const page = await reopened.compilePage(0, { optimization: "none" });
          const rendered = await renderHeprPageToCanvas2d(page, { scale: 2, surfaceFactory(width, height) {
            const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") };
          } });
          return (x, y) => Array.from(rendered.surface.context.getImageData(Math.floor(x * 2), rendered.height - 1 - Math.floor(y * 2), 1, 1).data);
        } finally { await reopened.close(); }
      };
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
  console.log("Editor clipboard: author snapshots/groups, source and current form appearances, destination layers, offsets, cut/undo, cancellation, PDF/HEP and page guards passed.");
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
