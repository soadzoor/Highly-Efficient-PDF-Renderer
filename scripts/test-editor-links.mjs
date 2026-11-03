import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { getEditorSceneTranslationHint } = await import("../src/editorScenePreview.ts");
  const { prepareEditorPreviewSceneUpdate } = await import("../src/editorPreviewSceneUpdate.ts");
  const { resolveAnnotationView } = await import("../src/viewerLinkNavigation.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const page = () => {
    const scene = buildStrokeScene([{ points: [[10, 10], [90, 10]], width: 2 }]);
    scene.pageRects = Float32Array.of(0, 0, 120, 100);
    scene.bounds = scene.pageBounds = { minX: 0, minY: 0, maxX: 120, maxY: 100 };
    return scene;
  };
  const base = composeVectorScenesInGrid([page(), page()], 1), origin = [...base.pageRects.subarray(0, 2)];
  const quads = [10, 40, 50, 40, 10, 30, 50, 30, 10, 20, 40, 20, 10, 10, 40, 10];
  base.annotations = [{ id: "source-highlight", name: "original-highlight", sourcePageIndex: 0, pageIndex: 0, annotationIndex: 0,
    subtype: "Highlight", flags: 4, visibleInDefaultView: true, hasAppearance: false, contents: "Existing highlighted words",
    bounds: { minX: origin[0] + 10, minY: origin[1] + 10, maxX: origin[0] + 50, maxY: origin[1] + 40 },
    quadPoints: quads.map((value, index) => value + origin[index % 2]), pdfGeometry: { rect: [10, 10, 50, 40], quadPoints: quads } }];
  const diagnostics = [], editor = createEditorSession(base, { onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  const sourceOwner = "annotation:source-highlight", generated = scene => (scene.annotations ?? []).filter(annotation => annotation.subtype === "Link");
  const linkFor = (scene, id) => generated(scene).find(annotation => annotation.name === `editor-link:${encodeURIComponent(id)}`);
  const destination = (scene, id) => {
    const annotation = linkFor(scene, id); assert(annotation, `link for ${id} exists`);
    return annotation.destination ?? annotation.action?.destination;
  };
  const assertNumbers = (actual, expected, label = "numbers") => {
    assert.equal(actual.length, expected.length, label); actual.forEach((value, index) => assert(Math.abs(value - expected[index]) < 1e-5, `${label}[${index}]: ${value} != ${expected[index]}`));
  };
  try {
    assert.equal(await editor.getScene(), base, "opening an unchanged document retains its original scene");
    const oldSnapshot = await editor.captureRecovery(); delete oldSnapshot.data.state.links;
    const legacy = createEditorSession(structuredClone(base));
    try { await legacy.restoreRecovery(oldSnapshot); assert.equal(legacy.getObjectLink(sourceOwner), null, "pre-link recovery states remain supported"); } finally { legacy.dispose(); }
    editor.setObjectLink(sourceOwner, { type: "url", url: "https://example.com/reference" });
    const revision = editor.revision, linked = await editor.getScene();
    assert.equal(linked.endpoints, base.endpoints); assert.equal(linked.fillSegmentsA, base.fillSegmentsA); assert.equal(linked.textInstanceA, base.textInstanceA, "metadata-only links do not copy drawing buffers");
    assert.equal(linked.segmentCount, base.segmentCount); assert.equal(linked.fillPathCount, base.fillPathCount);
    assert.deepEqual(linked.annotations.find(annotation => annotation.id === "source-highlight"), base.annotations[0], "a link preserves its source highlight and note");
    const hotspot = linkFor(linked, "original-highlight"); assert(hotspot && !hotspot.hasAppearance && hotspot.border.width === 0);
    assert.deepEqual(hotspot.quadPoints, base.annotations[0].quadPoints, "multi-line source highlight links use each text quad");
    assert.equal(hotspot.action.uri, "https://example.com/reference");
    editor.setObjectLink(sourceOwner, { type: "url", url: "https://example.com/reference" }); assert.equal(editor.revision, revision, "unchanged links have no empty history step");
    for (const url of ["javascript:alert(1)", "data:text/html,unsafe", "file:///tmp/private", "relative", ""]) {
      assert.throws(() => editor.setObjectLink(sourceOwner, { type: "url", url }), /absolute|URL/); assert.equal(editor.revision, revision);
    }
    for (const value of [{ type: "object", objectId: "missing-target" }, { type: "destination", destination: { sourcePageIndex: -1 } },
      { type: "destination", destination: { sourcePageIndex: 0, fit: "Unknown" } }, { type: "destination", destination: { sourcePageIndex: 0, parameters: [NaN] } }]) {
      assert.throws(() => editor.setObjectLink(sourceOwner, value)); assert.equal(editor.revision, revision, "invalid destinations do not create history");
    }
    for (const url of ["https://example.com", "http://example.com", "mailto:reviewer@example.com", "tel:+3615550100"]) editor.setObjectLink(sourceOwner, { type: "url", url });
    const detached = editor.getObjectLink(sourceOwner); detached.url = "https://changed.example"; assert.notEqual(editor.getObjectLink(sourceOwner).url, detached.url);
    editor.setObjectsLocked([sourceOwner], true); const lockedState = editor.getState();
    assert.throws(() => editor.setObjectLink(sourceOwner, null), /locked/); assert.deepEqual(editor.getState(), lockedState);
    editor.setObjectsLocked([sourceOwner], false);
    editor.setObjectLink(sourceOwner, { type: "object", objectId: sourceOwner });
    assertNumbers(destination(await editor.getScene(), "original-highlight").parameters, [10, 10, 50, 40], "self-reference is a normal bounded camera destination");
    editor.setObjectLink(sourceOwner, { type: "object", objectId: "source:stroke:0" });
    assertNumbers(destination(await editor.getScene(), "original-highlight").parameters, [9, 9, 91, 11], "anonymous source content can be an in-session target");
    editor.select(["source:stroke:0"]); editor.transformSelection([1, 0, 0, 1, 8, -3]);
    assertNumbers(destination(await editor.getScene(), "original-highlight").parameters, [17, 6, 99, 8], "references follow transformed source primitives"); editor.undo();

    const target = editor.addObject({ kind: "shape", shape: "rectangle", pageIndex: 1, x: 20, y: 20, width: 20, height: 10, fill: "blue", strokeWidth: 0 });
    editor.setObjectLink(sourceOwner, { type: "object", objectId: target });
    let current = await editor.getScene(), d = destination(current, "original-highlight");
    assert.equal(d.sourcePageIndex, current.pdfPages.find(page => page.pageIndex === 1).sourcePageIndex); assert.equal(d.fit, "FitR");
    assertNumbers(d.parameters, [20, 20, 40, 30], "cross-page target");
    assert(resolveAnnotationView(current, linkFor(current, "original-highlight"), { centerX: 0, centerY: 0, zoom: 1 }, { width: 800, height: 600 }), "HEP-only page mappings support normal viewer navigation");
    editor.updateObject(target, { x: 25, y: 35, width: 40, height: 20, transform: [0, 1, -1, 0, 100, 0] });
    current = await editor.getScene(); assertNumbers(destination(current, "original-highlight").parameters, [45, 25, 65, 65], "resized/rotated target");
    editor.select([target]); editor.setPreviewTransform([1, 0, 0, 1, 10, 5]);
    current = await editor.getScene({ preview: true }); assertNumbers(destination(current, "original-highlight").parameters, [55, 30, 75, 70], "preview target");
    assert(getEditorSceneTranslationHint(current), "link metadata retains the cached translation hint");
    editor.setPreviewTransform([1, 0, 0, 1, 11, 6]);
    const nextPreview = await editor.getScene({ preview: true });
    assert(prepareEditorPreviewSceneUpdate(current, nextPreview), "updating link destinations preserves position-only GPU uploads after gesture preparation");
    assertNumbers(destination(await editor.getScene({ preview: false }), "original-highlight").parameters, [45, 25, 65, 65], "uncommitted target pose is never persisted");
    editor.setPreviewTransform(null); editor.deleteSelection();
    assert.equal(linkFor(await editor.getScene(), "original-highlight"), undefined, "deleting a target omits its hotspot instead of redirecting elsewhere");
    assert(diagnostics.some(diagnostic => diagnostic.code === "editor.link-target-missing"));
    const other = editor.addObject({ kind: "shape", shape: "rectangle", pageIndex: 1, x: 25, y: 35, width: 40, height: 20, fill: "red", strokeWidth: 0 });
    assert.notEqual(other, target); assert.equal(linkFor(await editor.getScene(), "original-highlight"), undefined);
    editor.undo(); editor.undo(); assert(linkFor(await editor.getScene(), "original-highlight"), "Undo restores the same destination identity");

    const owner = editor.addObject({ kind: "shape", shape: "polygon", pageIndex: 0, x: 10, y: 10, width: 40, height: 30,
      transform: [0, 1, -1, 0, 80, 0], points: [[10, 30], [50, 30], [10, 40], [50, 40]], color: "yellow", strokeWidth: 0,
      review: { type: "highlight", contents: "New highlighted words", quads: [[[10, 40], [50, 40], [10, 30], [50, 30]], [[10, 20], [40, 20], [10, 10], [40, 10]]] } });
    editor.setObjectLink(owner, { type: "object", objectId: target });
    const authored = linkFor(await editor.getScene(), owner);
    assertNumbers(authored.quadPoints, [40, 10, 40, 50, 50, 10, 50, 50, 60, 10, 60, 40, 70, 10, 70, 40].map((value, index) => value + origin[index % 2]), "rotated author quads");
    editor.setObjectLink(owner, null); assert.equal(editor.getObject(owner).review.contents, "New highlighted words"); assert.equal(linkFor(await editor.getScene(), owner), undefined);
    editor.undo(); assert.deepEqual(editor.getObjectLink(owner), { type: "object", objectId: target }); editor.redo(); assert.equal(editor.getObjectLink(owner), null); editor.undo();
    editor.transaction("Cyclic references", () => { editor.setObjectLink(owner, { type: "object", objectId: target }); editor.setObjectLink(target, { type: "object", objectId: owner }); });
    assert(linkFor(await editor.getScene(), target), "cyclic references resolve one target frame without recursively following links"); editor.undo();
    editor.select([owner, target]); await editor.copySelection(); const [copyOwner, copyTarget] = editor.pasteSelection({ offset: [0, 0] });
    assert.deepEqual(editor.getObjectLink(copyOwner), { type: "object", objectId: copyTarget }, "copying both ends binds independent copied objects together");
    assert.deepEqual(editor.getObjectLink(owner), { type: "object", objectId: target });
    editor.select([owner]); await editor.copySelection(); const [copyOnlyOwner] = editor.pasteSelection({ offset: [0, 0] });
    assert.deepEqual(editor.getObjectLink(copyOnlyOwner), { type: "object", objectId: target }, "copying the owner only retains its original target");
    const recovery = await editor.captureRecovery(), restored = createEditorSession(structuredClone(base));
    try {
      await restored.restoreRecovery(recovery); assert.deepEqual(restored.getObjectLink(copyOwner), { type: "object", objectId: copyTarget });
      assert.equal(generated(await restored.getScene()).length, generated(await editor.getScene()).length, "recovery does not duplicate generated hotspots");
    } finally { restored.dispose(); }
  } finally { editor.dispose(); }

  const hairlines = createEditorSession(page());
  try {
    const id = hairlines.addObject({ kind: "shape", shape: "line", pageIndex: 0, x: 10, y: 40, width: 50, height: 0, strokeWidth: 0 });
    hairlines.setObjectLink(id, { type: "url", url: "https://example.com/hairline" });
    const link = linkFor(await hairlines.getScene(), id);
    assert(link && link.bounds.maxY > link.bounds.minY, "zero-height hairline artwork still has a usable link hotspot");
  } finally { hairlines.dispose(); }

  const opaqueSource = structuredClone(base);
  const opaqueAnnotation = (id, action, x) => ({ id, name: id, sourcePageIndex: 0, pageIndex: 0, annotationIndex: 1,
    subtype: "Link", flags: 4, visibleInDefaultView: true, hasAppearance: false, action,
    bounds: { minX: origin[0] + x, minY: origin[1] + 45, maxX: origin[0] + x + 15, maxY: origin[1] + 55 }, pdfGeometry: { rect: [x, 45, x + 15, 55] } });
  const relative = opaqueAnnotation("relative-source", { type: "URI", uri: "../reference.html", next: [{ type: "JavaScript" }] }, 10);
  const inert = opaqueAnnotation("inert-source", { type: "JavaScript" }, 50);
  opaqueSource.annotations.push(relative, inert);
  const opaqueEditor = createEditorSession(opaqueSource), relativeOwner = `annotation:${relative.id}`, inertOwner = `annotation:${inert.id}`;
  try {
    assert.equal(opaqueEditor.getObjectLink(relativeOwner), null, "a relative source URI requiring a viewer URL base need not become a newly authored absolute URI");
    assert.equal(await opaqueEditor.getScene(), opaqueSource, "untouched imported actions remain byte-model equivalent");
    opaqueEditor.setObjectLink(relativeOwner, { type: "url", url: "https://example.com/replaced" });
    let current = await opaqueEditor.getScene();
    assert.equal(generated(current).length, 2, "replacing an unresolved URI does not retain a duplicate old hotspot");
    assert.deepEqual(current.annotations.find(annotation => annotation.id === relative.id).action, { type: "URI", uri: "https://example.com/replaced" });
    assert.deepEqual(current.annotations.find(annotation => annotation.id === inert.id), inert, "unrelated inert actions are preserved");
    opaqueEditor.undo(); assert.deepEqual((await opaqueEditor.getScene()).annotations.find(annotation => annotation.id === relative.id), relative);
    const beforeRemoval = opaqueEditor.revision; opaqueEditor.setObjectLink(relativeOwner, null);
    assert.equal(opaqueEditor.revision, beforeRemoval + 1); assert(!(await opaqueEditor.getScene()).annotations.some(annotation => annotation.id === relative.id), "explicit null removes an unresolved existing URI");
    opaqueEditor.setObjectLink(relativeOwner, null); assert.equal(opaqueEditor.revision, beforeRemoval + 1, "repeated removal is a no-op");
    opaqueEditor.undo(); assert.deepEqual((await opaqueEditor.getScene()).annotations.find(annotation => annotation.id === relative.id).action.next, relative.action.next);
    opaqueEditor.setObjectLink(inertOwner, null); assert(!(await opaqueEditor.getScene()).annotations.some(annotation => annotation.id === inert.id), "an inert unrepresentable source Link can also be explicitly removed");
    opaqueEditor.undo(); assert.deepEqual((await opaqueEditor.getScene()).annotations.find(annotation => annotation.id === inert.id), inert);
  } finally { opaqueEditor.dispose(); }

  // The real document facade materializes native PDFs between page versions.
  // Keep internal references attached to author identities through those steps.
  const bytes = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 100] /CropBox [10 5 110 95] /Rotate 90 /UserUnit 2 /Resources << >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", "1 0 0 rg 20 20 20 20 re f") },
    { number: 5, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 140 120] /Resources << >> /Contents 6 0 R >>" },
    { number: 6, body: tinyPdfStream("", "0 0 1 rg 20 20 20 20 re f") }
  ] });
  const compile = async source => {
    const parser = await openPdf({ kind: "bytes", bytes: source });
    try { const pages = []; for (let index = 0; index < parser.info.pageCount; index++) pages.push(await parser.compileVectorPage(index, { optimization: "none", preserveDrawingOrder: true })); return composeVectorScenesInGrid(pages, 1); }
    finally { await parser.close(); }
  };
  const services = await createEditorAppServices({ sourcePdf: bytes }), doc = await openEditorSession(await compile(bytes), { ...services.sessionOptions, sourcePdf: bytes });
  try {
    const owner = doc.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 20, y: 20, width: 25, height: 15, fill: "yellow", strokeWidth: 0 });
    const target = doc.addObject({ kind: "shape", shape: "rectangle", pageIndex: 1, x: 30, y: 30, width: 20, height: 20, fill: "green", strokeWidth: 0 });
    doc.setObjectLink(owner, { type: "object", objectId: target });
    doc.select([target]); doc.deleteSelection(); await doc.getScene();
    const exportDiagnostics = [], exportWarnings = [];
    await doc.savePdf({ markSaved: false, onDiagnostic: value => exportDiagnostics.push(value), onWarning: value => exportWarnings.push(value) });
    assert(exportDiagnostics.some(value => value.code === "editor.link-target-missing") || exportWarnings.some(value => /link.*destination.*(unavailable|removed|missing)/i.test(value)),
      "saving after a cached scene must report an omitted broken link to that export's diagnostic callbacks");
    const hepWarnings = [];
    await doc.saveHep({ markSaved: false, withVectorLod: false, withTextLod: false, encodeRasterImages: false, onWarning: value => hepWarnings.push(value) });
    assert(hepWarnings.some(value => /link.*destination.*(unavailable|removed|missing)/i.test(value)), "HEP export also reports an omitted broken link through onWarning");
    doc.undo();
    await doc.reorderPages([1, 0]); assert.equal(doc.getObject(owner).pageIndex, 1); assert.equal(doc.getObject(target).pageIndex, 0);
    assert.deepEqual(doc.getObjectLink(owner), { type: "object", objectId: target });
    assertNumbers(destination(await doc.getScene(), owner).parameters, [30, 30, 50, 50], "target after page reorder");
    await doc.duplicatePages([0, 1], { at: 2 });
    const copies = doc.getObjects(), copyOwner = copies.find(object => object.kind === "shape" && object.pageIndex === 3 && object.fill === "yellow"), copyTarget = copies.find(object => object.kind === "shape" && object.pageIndex === 2 && object.fill === "green");
    assert(copyOwner && copyTarget); assert.deepEqual(doc.getObjectLink(copyOwner.id), { type: "object", objectId: copyTarget.id }, "duplicating both pages retargets their paired copies");
    await doc.cropPages([1], { x: 5, y: 5, width: 160, height: 180 }); assert.deepEqual(doc.getObjectLink(owner), { type: "object", objectId: target });
    assertNumbers(destination(await doc.getScene(), owner).parameters, [30, 30, 50, 50], "cropping link owner does not change its target");
    await doc.removePages([0]);
    assert.equal(linkFor(await doc.getScene(), owner), undefined, "removing the target page cannot redirect the link to a different page");
    assert.deepEqual(doc.getObjectLink(copyOwner.id), { type: "object", objectId: copyTarget.id });
    const extracted = await doc.extractPages([1, 2]), extractedScene = await compile(new Uint8Array(await extracted.arrayBuffer()));
    const link = generated(extractedScene)[0]; assert(link && (link.destination ?? link.action?.destination).sourcePageIndex === 0, "extracted paired pages retain their destination page");
    assert.equal(doc.getPages().length, 3, "extraction leaves the open document unchanged");
  } finally { doc.dispose(); services.dispose(); }

  const relativePdf = writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 100] /Resources << >> /Contents 4 0 R /Annots [5 0 R] >>" },
    { number: 4, body: tinyPdfStream("", "1 0 0 rg 10 10 20 10 re f") },
    { number: 5, body: "<< /Type /Annot /Subtype /Link /NM (relative-native) /Rect [10 10 30 20] /F 4 /Border [0 0 0] /A << /S /URI /URI (../reference.html) /Next << /S /JavaScript /JS (must remain inert) >> >> >>" }
  ] });
  const relativeServices = await createEditorAppServices({ sourcePdf: relativePdf }), relativeEditor = await openEditorSession(await compile(relativePdf), { ...relativeServices.sessionOptions, sourcePdf: relativePdf });
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const nativeActions = async bytes => {
    const document = await NativePdfDocument.open({ kind: "bytes", bytes });
    try {
      const refs = await document.resolveValue(document.getPage(0).dictionary.get("Annots")), links = [];
      for (const ref of refs ?? []) { const annotation = await document.resolveValue(ref); if (annotation.get("Subtype")?.value !== "Link") continue;
        const action = await document.resolveValue(annotation.get("A")), next = action && await document.resolveValue(action.get("Next")); links.push({ action, next }); }
      return links;
    } finally { await document.close(); }
  };
  try {
    const owner = `annotation:${relativeEditor.sourceScene.annotations.find(annotation => annotation.subtype === "Link").id}`;
    let saved = new Uint8Array(await (await relativeEditor.savePdf({ markSaved: false })).arrayBuffer()), actions = await nativeActions(saved);
    assert.equal(actions.length, 1); assert.equal(actions[0].next.get("S").value, "JavaScript", "an untouched inherited Next action is preserved without execution");
    relativeEditor.setObjectLink(owner, { type: "url", url: "https://example.com/replaced" });
    saved = new Uint8Array(await (await relativeEditor.savePdf({ markSaved: false })).arrayBuffer()); actions = await nativeActions(saved);
    assert.equal(actions.length, 1, "native export replaces rather than duplicates the old relative-URI annotation");
    assert.equal(new TextDecoder().decode(actions[0].action.get("URI").bytes), "https://example.com/replaced"); assert.equal(actions[0].next, undefined);
    relativeEditor.setObjectLink(owner, null); saved = new Uint8Array(await (await relativeEditor.savePdf({ markSaved: false })).arrayBuffer()); assert.equal((await nativeActions(saved)).length, 0);
    relativeEditor.undo(); relativeEditor.undo(); saved = new Uint8Array(await (await relativeEditor.savePdf({ markSaved: false })).arrayBuffer());
    assert.equal((await nativeActions(saved))[0].next.get("S").value, "JavaScript", "Undo restores the inherited action chain");
  } finally { relativeEditor.dispose(); relativeServices.dispose(); }
  console.log("Editor links: source/author quad hotspots, unchanged geometry, safe URLs, transforms/previews, deletion, locks/undo, copy rebinding, recovery and page operations passed.");
} finally { hooks.deregister(); }
