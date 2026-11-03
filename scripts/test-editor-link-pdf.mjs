import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
const hooks = registerHooks({ resolve(s, c, n) { return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c); } });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { decodePdfString } = await import("../src/pdf/nativeForms.ts");
  const { writeScenePdf } = await import("../src/editorPdfWriter.ts");
  const { loadSceneFromHep } = await import("../src/hepReader.ts");
  const { annotationBounds } = await import("../src/annotationData.ts");
  const compile = async bytes => {
    const parser = await openPdf({ kind: "bytes", bytes });
    try { const pages = []; for (let i = 0; i < parser.info.pageCount; i++) pages.push(await parser.compileVectorPage(i, { optimization: "none", preserveDrawingOrder: true }));
      return composeVectorScenesInGrid(pages, 1); } finally { await parser.close(); }
  };
  const original = fixture(), scene = await compile(original), services = await createEditorAppServices({ sourcePdf: original });
  const editor = await openEditorSession(scene, services.sessionOptions);
  const highlight = editor.addObject({ id: "review", kind: "shape", shape: "polygon", pageIndex: 0, x: 20, y: 70, width: 100, height: 34,
    color: "#ffdd00", opacity: .3, strokeWidth: 0, review: { type: "highlight", contents: "Linked passage", quads: [
      [[20, 104], [120, 104], [20, 92], [120, 92]], [[20, 82], [90, 82], [20, 70], [90, 70]] ] } });
  const target = editor.addObject({ id: "destination", kind: "shape", shape: "rectangle", pageIndex: 1, x: 20, y: 30, width: 60, height: 25, fill: "green", strokeWidth: 0 });
  const reference = editor.addObject({ id: "reference", kind: "shape", shape: "ellipse", pageIndex: 0, x: 130, y: 60, width: 28, height: 24, fill: "red" });
  try {
    editor.setObjectLink(highlight, { type: "url", url: "https://example.com/path?q=one&v=two#part" });
    editor.setObjectLink(reference, { type: "object", objectId: target });
    editor.select([target]); editor.transformSelection([1, 0, 0, 1, 11, -7]);
    const targetBounds = editor.getObjectBounds(target), committed = await editor.getScene();
    assert.equal(committed.annotations.filter(a => a.subtype === "Link").length, 4);
    const warnings = [], bytes = new Uint8Array(await (await editor.savePdf({ markSaved: false, onWarning: value => warnings.push(value) })).arrayBuffer());
    await assertNative(bytes);
    const reopenedScene = await compile(bytes), links = reopenedScene.annotations.filter(a => a.subtype === "Link");
    assert.equal(links.length, 4); assert.equal(reopenedScene.annotations.filter(a => a.subtype === "Highlight").length, 1, "link overlay does not replace or duplicate the highlight appearance");
    const external = links.find(a => a.action?.uri?.startsWith("https://example.com"));
    assert.equal(external.quadPoints.length, 16, "each highlighted line has an exact clickable quad rather than filling the gap between lines");
    const local = links.find(a => a.destination?.name?.startsWith("editor-target:"));
    assert(local); assertDestination(reopenedScene, local, targetBounds);
    const nextServices = await createEditorAppServices({ sourcePdf: bytes }), next = await openEditorSession(reopenedScene, nextServices.sessionOptions);
    try {
      const targetAnnotation = reopenedScene.annotations.find(a => a.name === target), ownerAnnotation = reopenedScene.annotations.find(a => a.name === reference);
      assert.equal(next.getObjectLink(`annotation:${ownerAnnotation.id}`).type, "object", "saved named targets rebind authored objects");
      next.select([`annotation:${targetAnnotation.id}`]); next.transformSelection([1, 0, 0, 1, -4, 9]);
      const moved = next.getObjectBounds(`annotation:${targetAnnotation.id}`), originalLink = reopenedScene.annotations.find(a => a.name === "existing");
      const b = originalLink.bounds, cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, c = Math.SQRT1_2;
      const rotation = [c, c, -c, c, cx - c * cx + c * cy + 3, cy - c * cx - c * cy + 6];
      next.select([`annotation:${originalLink.id}`]); next.transformSelection(rotation);
      const movedLink = next.getObjectBounds(`annotation:${originalLink.id}`), resaved = new Uint8Array(await (await next.savePdf()).arrayBuffer());
      const again = await compile(resaved); assert.equal(again.annotations.filter(a => a.subtype === "Link").length, 4);
      assertDestination(again, again.annotations.find(a => a.destination?.name?.startsWith("editor-target:")), moved);
      const againOriginal = again.annotations.find(a => a.name === "existing");
      for (const key of ["minX", "minY", "maxX", "maxY"]) assert(Math.abs(againOriginal.bounds[key] - movedLink[key]) < .03, "moving an imported link keeps its original action dictionary");
      assert.equal(againOriginal.action.next[0].type, "Named");
      assert.equal(againOriginal.quadPoints.length, 8, "rotating an imported link without original quads creates an exact clickable rectangle");
      assert(Math.abs(againOriginal.quadPoints[1] - againOriginal.quadPoints[3]) > 1, "clickable quad rotates rather than using the enlarged axis-aligned rectangle");
      const highlightAnnotation = reopenedScene.annotations.find(a => a.name === highlight);
      next.setObjectLink(`annotation:${highlightAnnotation.id}`, null);
      const removed = await compile(new Uint8Array(await (await next.savePdf()).arrayBuffer()));
      assert.equal(removed.annotations.filter(a => a.subtype === "Link").length, 3); assert.equal(removed.annotations.filter(a => a.subtype === "Highlight").length, 1);
    } finally { next.dispose(); nextServices.dispose(); }
    const flattened = new Uint8Array(await (await editor.savePdf({ flatten: true })).arrayBuffer()), flatScene = await compile(flattened);
    assert.equal(flatScene.annotations.length, 4, "flattened copies keep functional links while visual annotations become page content");
    assert(flatScene.annotations.every(a => a.subtype === "Link"));
    assertDestination(flatScene, flatScene.annotations.find(a => a.destination?.name?.startsWith("editor-target:")), targetBounds);
    const hep = await editor.saveHep({ markSaved: false, withVectorLod: false, withTextLod: false, encodeRasterImages: false });
    const baked = await loadSceneFromHep(await hep.arrayBuffer()); assert.equal(baked.annotations.filter(a => a.subtype === "Link").length, 4);
    const rebuilt = await compile(new Uint8Array(await (await writeScenePdf(baked)).arrayBuffer()));
    assert.equal(rebuilt.annotations.filter(a => a.subtype === "Link").length, 4);
    assertDestination(rebuilt, rebuilt.annotations.find(a => a.destination?.name?.startsWith("editor-target:")), targetBounds);
    const hepEditor = await openEditorSession(baked);
    try {
      const saved = await compile(new Uint8Array(await (await hepEditor.savePdf()).arrayBuffer()));
      assert.equal(saved.annotations.filter(a => a.subtype === "Link").length, 4, "HEP-native PDF rebuilding does not double existing link metadata");
      assertDestination(saved, saved.annotations.find(a => a.destination?.name?.startsWith("editor-target:")), targetBounds);
    } finally { hepEditor.dispose(); }
    const sparse = structuredClone(baked), pageIds = new Map([[0, 7], [1, 11]]);
    for (const mapping of sparse.pdfPages) mapping.sourcePageIndex = pageIds.get(mapping.sourcePageIndex);
    for (const annotation of sparse.annotations) {
      annotation.sourcePageIndex = pageIds.get(annotation.sourcePageIndex);
      const destination = annotation.destination ?? annotation.action?.destination;
      if (destination) destination.sourcePageIndex = pageIds.get(destination.sourcePageIndex);
    }
    const sparseEditor = await openEditorSession(sparse);
    try { const rebuilt = await compile(new Uint8Array(await (await sparseEditor.savePdf()).arrayBuffer()));
      assert.equal(rebuilt.annotations.filter(a => a.subtype === "Link").length, 4);
      assertDestination(rebuilt, rebuilt.annotations.find(a => a.destination?.name?.startsWith("editor-target:")), targetBounds);
    } finally { sparseEditor.dispose(); }
    // Independently inspect standard annotation dictionaries when the optional reference is available.
    const referenceModule = process.env.HEPR_PDFJS_MODULE ?? "/tmp/hepr-editor-reference/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
    if (await access(referenceModule).then(() => true, () => false)) {
      const pdfjs = await import(pathToFileURL(referenceModule).href), task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false, isEvalSupported: false });
      try { const pdf = await task.promise, annotations = await (await pdf.getPage(1)).getAnnotations();
        const independentLinks = annotations.filter(a => a.subtype === "Link"); assert.equal(independentLinks.length, 4);
        assert(independentLinks.some(a => a.url === "https://example.com/path?q=one&v=two#part"));
        const named = independentLinks.find(a => typeof a.dest === "string" && a.dest.startsWith("editor-target:")); assert(named); assert(await pdf.getDestination(named.dest));
        assert(await pdf.getDestination("z-existing"), "adding named object targets preserves an existing destination name tree");
      } finally { await task.destroy(); }
    }
    assert(!Object.hasOwn(baked, "editor") && !Object.hasOwn(baked, "sourcePdf"));
    assert.deepEqual(warnings, []);
    console.log("PDF links: native URI/raw action preservation, exact highlight quads, object targets/rebinding/movement, unlink, cropped/rotated/UserUnit pages, flattened and HEP round trips passed.");
  } finally { editor.dispose(); services.dispose(); }
  const directBytes = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" }, { number: 2, body: "<< /Type /Pages /Count 1 /Kids [3 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 120] /Resources << >> /Contents 4 0 R /Annots [5 0 R << /Type /Annot /Subtype /Link /Rect [10 10 30 30] /A << /S /URI /URI (https://direct.example/) >> /AP << /N 6 0 R >> >>] >>" },
    { number: 4, body: tinyPdfStream("", "0 0 m 120 120 l S") }, { number: 5, body: "<< /Type /Annot /Subtype /Square /Rect [60 60 80 80] /C [1 0 0] >>" },
    { number: 6, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Resources << >>", "0 0 1 rg 0 0 20 20 re f") }
  ] });
  const directScene = await compile(directBytes), directServices = await createEditorAppServices({ sourcePdf: directBytes }), directEditor = await openEditorSession(directScene, directServices.sessionOptions);
  try {
    const square = directScene.annotations.find(a => a.subtype === "Square"), link = directScene.annotations.find(a => a.subtype === "Link");
    directEditor.selectAnnotations([square.id]); directEditor.deleteSelection();
    directEditor.selectAnnotations([link.id]); directEditor.transformSelection([0, 1, -1, 0, 100, 0]);
    const saved = new Uint8Array(await (await directEditor.savePdf()).arrayBuffer()), parsed = await compile(saved);
    assert.equal(parsed.annotations.length, 1); assert.equal(parsed.annotations[0].subtype, "Link", "deleting a preceding annotation does not duplicate a direct Link dictionary");
    assert.equal(parsed.annotations[0].quadPoints.length, 8);
    const doc = await NativePdfDocument.open({ kind: "bytes", bytes: saved });
    try {
      const refs = await doc.resolveValue(doc.getPage(0).dictionary.get("Annots")), annotation = await doc.resolveValue(refs[0]), ap = await doc.resolveValue(annotation.get("AP")), appearance = await doc.resolveValue(ap.get("N"));
      const matrix = appearance.dictionary.get("Matrix"); assert(matrix && matrix.some((value, index) => value !== [1, 0, 0, 1, 0, 0][index]), "custom link appearances keep their native rotation wrapper");
    } finally { await doc.close(); }
  } finally { directEditor.dispose(); directServices.dispose(); }
  function assertDestination(scene, link, expected) {
    assert(link?.destination); const destination = link.destination, mapping = scene.pdfPages.find(page => page.sourcePageIndex === destination.sourcePageIndex);
    const actual = annotationBounds(destination.parameters, mapping.pdfToScene);
    for (const key of ["minX", "minY", "maxX", "maxY"]) assert(Math.abs(actual[key] - expected[key]) < .03, `internal target ${key}: ${actual[key]} vs ${expected[key]}`);
  }
  async function assertNative(bytes) {
    const document = await NativePdfDocument.open({ kind: "bytes", bytes });
    try {
      const refs = await document.resolveValue(document.getPage(0).dictionary.get("Annots")), values = await Promise.all(refs.map(ref => document.resolveValue(ref)));
      const nativeLinks = values.filter(value => value.get("Subtype")?.value === "Link"); assert.equal(nativeLinks.length, 4);
      assert.equal(values.filter(value => value.get("Subtype")?.value === "Highlight").length, 1);
      const original = nativeLinks.find(value => decodePdfString(value.get("NM"), 0, 0) === "existing");
      const action = await document.resolveValue(original.get("A")); assert(action.has("Next"), "unmodified existing actions remain byte-semantic native dictionaries");
      assert(!original.has("QuadPoints"), "untouched imported links retain their original rectangle-only dictionary");
      const overlay = nativeLinks.find(value => decodePdfString(value.get("NM"), 0, 0) === "editor-link:review");
      assert(!overlay.has("AP")); assert.deepEqual(overlay.get("Border"), [0, 0, 0]); assert.equal(overlay.get("QuadPoints").length, 16);
      const destinations = await document.resolveValue(document.catalog.get("Dests")); assert(destinations.has("editor-target:destination"));
    } finally { await document.close(); }
  }
} finally { hooks.deregister(); }
function fixture() {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R /Names << /Dests 8 0 R >> >>" }, { number: 2, body: "<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 220] /CropBox [20 10 280 210] /Rotate 90 /UserUnit 2 /Resources << >> /Contents 5 0 R /Annots [7 0 R 9 0 R] >>" },
    { number: 4, body: "<< /Type /Page /Parent 2 0 R /MediaBox [-10 -20 200 260] /CropBox [0 0 180 240] /Rotate 270 /Resources << >> /Contents 6 0 R >>" },
    { number: 5, body: tinyPdfStream("", ".2 .3 .4 rg 30 30 100 80 re f") }, { number: 6, body: tinyPdfStream("", ".7 .8 .9 rg 10 10 120 100 re f") },
    { number: 7, body: "<< /Type /Annot /Subtype /Link /Rect [30 30 80 50] /Border [0 0 0] /NM (existing) /A << /S /URI /URI (https://existing.example/) /Next << /S /Named /N /NextPage >> >> >>" },
    { number: 8, body: "<< /Names [(a-existing) [3 0 R /Fit] (z-existing) [4 0 R /Fit]] >>" },
    { number: 9, body: "<< /Type /Annot /Subtype /Link /Rect [90 30 120 50] /Border [0 0 0] /NM (existing-destination) /Dest (z-existing) >>" }
  ] });
}
