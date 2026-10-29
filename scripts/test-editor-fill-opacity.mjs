import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { compileEditorObjectGeometry } = await import("../src/editorSceneObjects.ts");
  const { editorObjectHasVisiblePaint } = await import("../src/editorObjectOpacity.ts");
  const { findEditorPdfFormOverlaps } = await import("../src/editorPdfFormOverlap.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const { writeScenePdf } = await import("../src/editorPdfWriter.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const identity = [1, 0, 0, 1, 0, 0];
  const shape = { id: "shape", kind: "shape", shape: "rectangle", pageIndex: 0, transform: identity,
    x: 20, y: 20, width: 60, height: 60, color: "#ff0000", fill: "#0000ff", strokeWidth: 8, opacity: .8, fillOpacity: .3 };
  const near = (actual, expected, tolerance = 1e-5, message = "") => assert(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
  function geometryAlphas(scene, stroke, fill) {
    assert(scene.segmentCount > 0); assert(scene.fillPathCount > 0);
    for (let i = 3; i < scene.primitiveMeta.length; i += 4) near(scene.primitiveMeta[i] % 2, stroke, 1e-5, "stroke alpha");
    for (let i = 3; i < scene.fillPathMetaC.length; i += 4) near(scene.fillPathMetaC[i], fill, 1e-5, "fill alpha");
  }
  geometryAlphas(await compileEditorObjectGeometry(shape), .8, .3);
  const { fillOpacity: _fillOpacity, ...legacy } = shape;
  geometryAlphas(await compileEditorObjectGeometry(legacy), .8, .8);
  for (const kind of ["ink", "signature"]) geometryAlphas(await compileEditorObjectGeometry({ id: kind, kind, pageIndex: 0, transform: identity,
    paths: [[[20, 20], [80, 20], [50, 80], [20, 20]]], smoothing: .1, color: "#ff0000", fill: "#0000ff", strokeWidth: 4, opacity: .2, fillOpacity: .7 }), .2, .7);
  const arrow = await compileEditorObjectGeometry({ ...shape, shape: "arrow", fillOpacity: 0 });
  geometryAlphas(arrow, .8, .8);
  assert(!editorObjectHasVisiblePaint({ ...shape, shape: "line", opacity: 0, fillOpacity: 1 }), "a two-point line has no independently filled region");
  assert(editorObjectHasVisiblePaint({ ...shape, opacity: 0, fillOpacity: .4 }), "a transparent stroke leaves a visible fill");
  assert(!editorObjectHasVisiblePaint({ ...shape, opacity: 0, fillOpacity: 0 }));

  const bytes = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "") }
  ] });
  const parser = await openPdf({ kind: "bytes", bytes });
  const source = await parser.compileVectorPage(0, { optimization: "none", preserveDrawingOrder: true });
  await parser.close();
  const editor = await openEditorSession(source, { sourcePdf: bytes });
  try {
    for (const fillOpacity of [-.1, 1.1, NaN, Infinity, "0.5"]) assert.throws(() => editor.addObject({ ...shape, id: undefined, fillOpacity }), /Fill opacity/);
    const id = editor.addObject({ ...shape, id: undefined }); editor.select([id]);
    assert.throws(() => editor.updateObject(id, { fillOpacity: 2 }), /Fill opacity/);
    editor.updateObject(id, { opacity: 0, fillOpacity: .4 }); assert(editor.isObjectVisible(id));
    editor.updateObject(id, { fillOpacity: 0 }); assert(!editor.isObjectVisible(id));
    assert(editor.undo()); assert(editor.isObjectVisible(id)); assert.equal(editor.getObject(id).fillOpacity, .4);
    editor.updateObject(id, { opacity: .8, fillOpacity: .3 });
    const scene = await editor.getScene(); geometryAlphas(scene, .8, .3);
    editor.updateObject(id, { fillOpacity: .6 }); geometryAlphas(await editor.getScene(), .8, .6);
    assert(editor.undo()); geometryAlphas(await editor.getScene(), .8, .3);
    const hep = await loadSceneFromHep(await (await editor.saveHep()).arrayBuffer());
    for (let i = 3; i < hep.fillPathMetaC.length; i += 4) near(hep.fillPathMetaC[i], .3, .003, "HEP preserves independent fill alpha");

    async function checkPdf(blob, label, strokeAlpha = .8, fillAlpha = .3) {
      const pdf = await openPdf({ kind: "bytes", bytes: new Uint8Array(await blob.arrayBuffer()) });
      try {
        const page = await pdf.compilePage(0, { optimization: "none" });
        const rgbPage = { ...page, displayProgram: { ...page.displayProgram,
          groups: page.displayProgram.groups.map(group => ({ ...group, blendingColorSpaceIndex: -1 })) } };
        const result = await renderHeprPageToCanvas2d(rgbPage, { scale: 2, background: [1, 1, 1, 1], surfaceFactory(width, height) {
          const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") };
        } });
        const data = result.surface.context.getImageData(0, 0, result.width, result.height).data;
        const pixel = (x, y) => [...data.subarray(((result.height - 1 - y * 2) * result.width + x * 2) * 4, ((result.height - 1 - y * 2) * result.width + x * 2) * 4 + 4)];
        const inside = pixel(50, 50), edge = pixel(18, 50);
        inside.forEach((value, channel) => near(value, [255 * (1 - fillAlpha), 255 * (1 - fillAlpha), 255, 255][channel], 2, `${label} fill`));
        edge.forEach((value, channel) => near(value, [255, 255 * (1 - strokeAlpha), 255 * (1 - strokeAlpha), 255][channel], 2, `${label} stroke`));
      } finally { await pdf.close(); }
    }
    await checkPdf(await editor.savePdf(), "Editable PDF");
    await checkPdf(await editor.savePdf({ flatten: true }), "Flattened PDF");
    await checkPdf(await writeScenePdf(hep), "HEP-only PDF");
    editor.updateObject(id, { opacity: 0 });
    await checkPdf(await editor.savePdf(), "Editable PDF with transparent stroke", 0, .3);
    editor.updateObject(id, { opacity: .8, fillOpacity: 0 });
    await checkPdf(await editor.savePdf(), "Editable PDF with transparent fill", .8, 0);

    const widget = { id: "field", subtype: "Widget", pageIndex: 0, annotationIndex: 0, flags: 0, visibleInDefaultView: true,
      bounds: scene.bounds, field: { name: "Field" } };
    const fillOnly = { ...shape, id: "fill-only", opacity: 0, fillOpacity: .5 };
    const overlap = findEditorPdfFormOverlaps({ ...scene, annotations: [widget] }, {
      getObjects: () => [fillOnly], getObjectBounds: () => scene.bounds, getSourceEdits: () => [], getAnnotationEdits: () => []
    });
    assert.equal(overlap.length, 1, "fill-only visible markup still reports editable form overlap");
  } finally { editor.dispose(); }
  console.log("Independent fill opacity: validation, legacy fallback, strokes/arrowheads, filled ink/signatures, undo/visibility and PDF/HEP pixel round trips passed.");
} finally { hooks.deregister(); }
