import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { writeScenePdf } = await import("../src/editorPdfWriter.ts");
  const { getSceneAnnotationRuns } = await import("../src/scenePrimitives.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const bytes = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [6 0 R] /D << /Order [6 0 R] /ON [6 0 R] >> >> >>" },
    { number: 2, body: "<< /Type /Pages /Count 2 /Kids [3 0 R 7 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Properties << /L 6 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "/OC /L BDC 1 0 0 rg 10 10 45 45 re f EMC 0 0 1 rg 20 20 50 50 re f 1 0 1 rg 1 1 6 6 re f") },
    { number: 6, body: "<< /Type /OCG /Name (Layer 1) >>" },
    { number: 7, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 8 0 R >>" },
    { number: 8, body: tinyPdfStream("", "") }
  ] });
  async function compile(data) {
    const document = await openPdf({ kind: "bytes", bytes: data });
    try {
      const pages = []; for (let i = 0; i < document.info.pageCount; i++) pages.push(await document.compileVectorPage(i, { optimization: "none", preserveDrawingOrder: true }));
      return composeVectorScenesInGrid(pages, 1);
    } finally { await document.close(); }
  }
  async function pixel(scene, page, x, y) {
    const map = scene.pdfPages.find(info => info.pageIndex === page).pdfToScene, rect = scene.pageRects.subarray(page * 4, page * 4 + 4);
    const px = map[0] * x + map[2] * y + map[4] - rect[0], py = map[1] * x + map[3] * y + map[5] - rect[1];
    const output = new Uint8Array(await (await writeScenePdf(scene, { flatten: true })).arrayBuffer());
    const document = await openPdf({ kind: "bytes", bytes: output });
    try {
      const compiled = await document.compilePage(page, { optimization: "none" });
      const result = await renderHeprPageToCanvas2d({ ...compiled, displayProgram: { ...compiled.displayProgram,
        groups: compiled.displayProgram.groups.map(group => ({ ...group, blendingColorSpaceIndex: -1 })) } },
      { scale: 1, background: [1, 1, 1, 1], surfaceFactory(width, height) { const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") }; } });
      assert(Number.isFinite(px) && Number.isFinite(py) && px >= 0 && px < result.surface.canvas.width && py >= 0 && py < result.surface.canvas.height,
        JSON.stringify({ page, x, y, px, py, map, rect: [...rect], rects: [...scene.pageRects], pdfPages: scene.pdfPages, canvas: [result.surface.canvas.width, result.surface.canvas.height] }));
      return [...result.surface.context.getImageData(Math.floor(px), Math.floor(rect[3] - rect[1] - py), 1, 1).data];
    } finally { await document.close(); }
  }
  const source = await compile(bytes);
  for (const hepOnly of [false, true]) {
    const editor = await openEditorSession(source, hepOnly ? {} : { sourcePdf: bytes });
    try {
      const id = editor.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 25, y: 25, width: 40, height: 40,
        fill: "#00ff00", strokeWidth: 0, layerId: "ref:6:0" });
      editor.select([id]); editor.reorderSelection("send-to-back");
      assert.deepEqual(await pixel(await editor.getScene(), 0, 30, 30), [255, 0, 0, 255]);
      await editor.rotatePages([0], 90);
      assert.deepEqual(await pixel(await editor.getScene(), 0, 30, 30), [255, 0, 0, 255], "rotation retains source/annotation interleaving in the active document");
      assert.equal(editor.getObject(id).kind, "shape", "page operations retain the author model");
      assert(editor.undo()); assert.deepEqual(await pixel(await editor.getScene(), 0, 30, 30), [255, 0, 0, 255]);
      assert(editor.redo()); assert.deepEqual(await pixel(await editor.getScene(), 0, 30, 30), [255, 0, 0, 255]);
      await editor.insertPdf(bytes, { at: 0, pages: [1] });
      assert.equal(editor.getObject(id).pageIndex, 1);
      assert.deepEqual(await pixel(await editor.getScene(), 1, 30, 30), [255, 0, 0, 255], "insertion preserves private owner mapping and ordering on shifted pages");
      await editor.removePages([0]);
      assert.deepEqual(await pixel(await editor.getScene(), 0, 30, 30), [255, 0, 0, 255], "removal retains ordering and correct page transforms");
      await editor.duplicatePages([0], { at: 0 });
      assert.equal(editor.getObject(id).pageIndex, 1);
      const copied = editor.getObjects().find(object => object.kind === "shape" && object.pageIndex === 0);
      assert(copied && copied.id !== id, "ordered page copies keep an independent author model");
      assert.deepEqual(await pixel(await editor.getScene(), 0, 30, 30), [255, 0, 0, 255]);
      assert.deepEqual(await pixel(await editor.getScene(), 1, 30, 30), [255, 0, 0, 255], "copies preserve source/annotation interleaving on both pages");
      editor.select([copied.id]); editor.reorderSelection("bring-to-front");
      assert.deepEqual(await pixel(await editor.getScene(), 0, 30, 30), [0, 255, 0, 255]);
      assert.deepEqual(await pixel(await editor.getScene(), 1, 30, 30), [255, 0, 0, 255], "copy stacking is independent from the original");
      assert(editor.undo()); assert(editor.undo());
      await editor.reorderPages([1, 0]);
      assert.equal(editor.getObject(id).pageIndex, 1); assert.deepEqual(await pixel(await editor.getScene(), 1, 30, 30), [255, 0, 0, 255]); assert(editor.undo());
      await editor.cropPages([0], { x: 20, y: 50, width: 40, height: 40 });
      assert.deepEqual(await pixel(await editor.getScene(), 0, 30, 30), [255, 0, 0, 255]);
      const clipped = editor.sourceScene, page = clipped.pageRects.subarray(0, 4);
      assert(clipped.clipPaths.some(clip => clip.parent < 0 && clip.edges.every((value, index) => Math.abs(value - page[index % 2]) < .001 || Math.abs(value - page[index % 2 + 2]) < .001)), "retained canonical geometry has the new page clipping boundary");
      await editor.cropPages([0], null);
      assert.deepEqual(await pixel(await editor.getScene(), 0, 15, 15), [255, 0, 0, 255], "resetting a crop reveals retained geometry outside the former visible box");
      assert.deepEqual(await pixel(await editor.getScene(), 0, 30, 30), [255, 0, 0, 255]);
      const hep = await loadSceneFromHep(await (await editor.saveHep()).arrayBuffer());
      assert.deepEqual(await pixel(hep, 0, 30, 30), [255, 0, 0, 255], "page changes bake order into normal HEP paint data");
      assert(!("objectOrder" in hep)); assert(!JSON.stringify(hep).includes("source:page:"), "operation-local owner labels are never persisted in HEP");
      editor.select([id]); editor.reorderSelection("bring-to-front");
      assert.deepEqual(await pixel(await editor.getScene(), 0, 30, 30), [0, 255, 0, 255], "reordering remains usable after repeated structural operations");
      if (!hepOnly) {
        const top = editor.createLayer({ name: "Top" });
        editor.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 0, y: 0, width: 100, height: 100, fill: "#ff00ff", strokeWidth: 0, layerId: top });
        editor.moveLayer(top, { parentId: null, index: 0 });
        await editor.rotatePages([0], 90);
        editor.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 0, y: 0, width: 100, height: 100, fill: "#00ffff", strokeWidth: 0, layerId: "ref:6:0" });
        assert.deepEqual(await pixel(await editor.getScene(), 0, 30, 30), [255, 0, 255, 255], "page rebase retains the current global layer order and its behavior for later additions");
      }
    } finally { editor.dispose(); }
  }
  const clones = await openEditorSession(source, { sourcePdf: bytes });
  try {
    clones.selectPrimitives([{ kind: "fill", index: 0 }]); const [id] = clones.cloneSelection([40, 0]);
    clones.select([id]); clones.reorderSelection("send-to-back");
    assert.deepEqual(await pixel(await clones.getScene(), 0, 80, 30), [255, 0, 0, 255]);
    await clones.duplicatePages([0], { at: 0 });
    for (const page of [0, 1]) {
      assert.deepEqual(await pixel(await clones.getScene(), page, 80, 30), [255, 0, 0, 255]);
      const annotation = clones.sourceScene.annotations.find(annotation => annotation.name === id && annotation.pageIndex === page);
      assert(annotation && getSceneAnnotationRuns(clones.sourceScene).get(annotation.id)?.length, "copied source units retain actual independent annotation ownership");
    }
    const copied = clones.sourceScene.annotations.find(annotation => annotation.name === id && annotation.pageIndex === 0);
    clones.selectAnnotations([copied.id]); clones.reorderSelection("bring-to-front");
    assert.deepEqual(await pixel(await clones.getScene(), 1, 80, 30), [255, 0, 0, 255], "source-copy stacking changes remain page-local");
    assert(clones.undo()); assert(clones.undo());
    await clones.rotatePages([0], 90);
    const scene = await clones.getScene();
    assert.deepEqual(await pixel(scene, 0, 80, 30), [255, 0, 0, 255], "materialized source copies retain their canonical paint geometry");
    const saved = clones.sourceScene.annotations.find(annotation => annotation.name === id);
    assert(saved); assert(getSceneAnnotationRuns(clones.sourceScene).get(saved.id)?.length, "retained copy geometry keeps its actual new native annotation ownership");
    clones.selectAnnotations([saved.id]); assert(clones.canReorderSelection("bring-to-front"));
    clones.reorderSelection("bring-to-front");
    assert.deepEqual(await pixel(await clones.getScene(), 0, 60, 30), [255, 0, 0, 255]);
  } finally { clones.dispose(); }
  // Resetting a PDF's initial CropBox must reveal its native hidden artwork,
  // even when current stacking requires canonical source/annotation interleaving.
  const { manipulatePdfPages } = await import("../src/editorPdfPages.ts");
  const croppingSourceBytes = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [6 0 R] /D << /Order [6 0 R] /ON [6 0 R] >> >> >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Properties << /L 6 0 R >> /ExtGState << /Half 7 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "/OC /L BDC 1 0 0 rg 10 10 45 45 re f EMC 0 0 1 rg 20 20 50 50 re f 1 0 1 rg 1 1 6 6 re f q /Half gs 0 1 1 rg 70 5 25 30 re f Q") },
    { number: 6, body: "<< /Type /OCG /Name (Layer 1) >>" }, { number: 7, body: "<< /Type /ExtGState /ca 0.5 >>" }
  ] });
  const initiallyCroppedBytes = new Uint8Array(await (await manipulatePdfPages(croppingSourceBytes, { kind: "crop", pages: [0], box: { x: 20, y: 20, width: 60, height: 60 } })).arrayBuffer());
  const initiallyCropped = await openEditorSession(await compile(initiallyCroppedBytes), { sourcePdf: initiallyCroppedBytes });
  try {
    const mark = initiallyCropped.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 5, y: 5, width: 40, height: 40, fill: "#00ff00", strokeWidth: 0, layerId: "ref:6:0" });
    initiallyCropped.select([mark]); initiallyCropped.reorderSelection("send-to-back");
    const { rebaseEditorOrderedSource } = await import("../src/editorPageOrderRebase.ts");
    const fullNative = new Uint8Array(await (await manipulatePdfPages(initiallyCroppedBytes, { kind: "crop", pages: [0], box: null })).arrayBuffer());
    const rebased = rebaseEditorOrderedSource(initiallyCropped, await initiallyCropped.getScene({ preview: false, sourceCopiesOnly: true }), await compile(fullNative),
      { kind: "crop", pages: [0], box: null }, "crop-test:", new AbortController().signal).scene;
    assert.deepEqual(await pixel(rebased, 0, 5, 5), [255, 0, 255, 255]); assert.deepEqual(await pixel(rebased, 0, 15, 15), [255, 0, 0, 255]);
    for (const [x, y] of [[75, 25], [85, 15]]) {
      const rgba = await pixel(rebased, 0, x, y); assert(Math.abs(rgba[0] - 127) <= 1 && rgba[1] === 255 && rgba[2] === 255 && rgba[3] === 255, `canonical/exterior page composition must paint translucent source once at ${x},${y}: ${rgba}`);
    }
    await initiallyCropped.cropPages([0], null);
    assert.deepEqual(await pixel(await compile(initiallyCropped.sourcePdf), 0, 5, 5), [255, 0, 255, 255], "native bytes retain paint wholly outside the original crop");
    assert.deepEqual(await pixel(await compile(initiallyCropped.sourcePdf), 0, 15, 15), [255, 0, 0, 255], "native bytes reveal partially cropped paths after resetting the crop");
    assert.deepEqual(await pixel(await initiallyCropped.getScene(), 0, 5, 5), [255, 0, 255, 255], "resetting an initial crop restores paint wholly outside its initial visible box");
    assert.deepEqual(await pixel(await initiallyCropped.getScene(), 0, 15, 15), [255, 0, 0, 255], "resetting an initial crop restores partially cropped native paint after restacking");
    for (const [x, y] of [[75, 25], [85, 15]]) {
      const pixelValue = await pixel(await initiallyCropped.getScene(), 0, x, y);
      assert(Math.abs(pixelValue[0] - 127) <= 1 && pixelValue[1] === 255 && pixelValue[2] === 255 && pixelValue[3] === 255,
        `crop reset paints translucent source content once inside and outside the former box: ${pixelValue}`);
    }
    assert.equal((initiallyCropped.sourceScene.annotations ?? []).filter(annotation => annotation.name === mark).length, 1, "reveal composition does not duplicate authored annotation identities");
    assert.deepEqual(await pixel(await initiallyCropped.getScene(), 0, 30, 30), [255, 0, 0, 255], "reset keeps existing interleaving in the former crop region");
  } finally { initiallyCropped.dispose(); }
  console.log("Object order survives PDF/HEP source rotation, insertion/removal, undo/redo, author reseeding and source-copy materialization.");
} finally { hooks.deregister(); }
