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
    { number: 4, body: tinyPdfStream("", "/OC /L BDC 1 0 0 rg 10 10 45 45 re f EMC 0 0 1 rg 20 20 50 50 re f") },
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
    await clones.rotatePages([0], 90);
    const scene = await clones.getScene();
    assert.deepEqual(await pixel(scene, 0, 80, 30), [255, 0, 0, 255], "materialized source copies retain their canonical paint geometry");
    const saved = clones.sourceScene.annotations.find(annotation => annotation.name === id);
    assert(saved); assert(getSceneAnnotationRuns(clones.sourceScene).get(saved.id)?.length, "retained copy geometry keeps its actual new native annotation ownership");
    clones.selectAnnotations([saved.id]); assert(clones.canReorderSelection("bring-to-front"));
    clones.reorderSelection("bring-to-front");
    assert.deepEqual(await pixel(await clones.getScene(), 0, 60, 30), [255, 0, 0, 255]);
  } finally { clones.dispose(); }
  console.log("Object order survives PDF/HEP source rotation, insertion/removal, undo/redo, author reseeding and source-copy materialization.");
} finally { hooks.deregister(); }
