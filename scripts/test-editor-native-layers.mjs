import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { getScenePrimitive } = await import("../src/scenePrimitives.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfWriter, pdfTextValue, pdfNameValue } = await import("../src/pdf/nativeWriter.ts");
  const { readEditorTextAnnotation } = await import("../src/editorTextAnnotations.ts");
  const { createEditorFontRegistry } = await import("../src/editorFonts.ts");
  const { decodePdfString } = await import("../src/pdf/nativeForms.ts");
  const { createNativeOptionalContentRegistry, nativeOptionalContentSceneIdentities } = await import("../src/pdf/nativeOptionalContent.ts");
  const { renderHeprPageToCanvas2d } = await import("../src/heprCanvas2dRenderer.ts");
  const { writeScenePdf } = await import("../src/editorPdfWriter.ts");
  const compile = async bytes => {
    const parser = await openPdf({ kind: "bytes", bytes });
    try { const pages = []; for (let i = 0; i < parser.info.pageCount; i++) pages.push(await parser.compileVectorPage(i, { optimization: "none", preserveDrawingOrder: true })); return composeVectorScenesInGrid(pages, 1); }
    finally { await parser.close(); }
  };
  const save = async (editor, options) => new Uint8Array(await (await editor.savePdf(options)).arrayBuffer());
  async function sample(bytes, pageIndex = 0) {
    const parser = await openPdf({ kind: "bytes", bytes });
    try {
      const original = await parser.compilePage(pageIndex, { optimization: "none" });
      const page = { ...original, displayProgram: { ...original.displayProgram, groups: original.displayProgram.groups.map(group => ({ ...group, blendingColorSpaceIndex: -1 })) } };
      const image = await renderHeprPageToCanvas2d(page, { scale: 2, background: [1, 1, 1, 1], surfaceFactory(width, height) { const canvas = createCanvas(width, height); return { canvas, context: canvas.getContext("2d") }; } });
      return (x, y) => Array.from(image.surface.context.getImageData(x * 2, (100 - y) * 2, 1, 1).data);
    } finally { await parser.close(); }
  }
  const bytes = fixture(), sourceScene = await compile(bytes), original = await NativePdfDocument.open({ kind: "bytes", bytes });
  const originalContents = await original.getDecodedPageContents(0), originalForm = await original.resolveObject({ kind: "ref", objectNumber: 8, generation: 0 });
  const originalFormBytes = await original.decodeStream(originalForm); await original.close();
  assert.deepEqual([...nativeOptionalContentSceneIdentities([
    { identity: "ref:3:0", sceneIdentity: "ref:5:0" }, { identity: "ref:5:0", sceneIdentity: "ref:3:0" }
  ]).values()], ["ref:5:0", "ref:3:0"], "unique persisted identities may permute current PDF references");
  assert.deepEqual([...nativeOptionalContentSceneIdentities([
    { identity: "a", sceneIdentity: "b" }, { identity: "b", sceneIdentity: "c" }, { identity: "c" }
  ]).values()], ["a", "b", "c"], "fallback identity collisions propagate through a persisted-ID chain");
  const hepScene = { ...sourceScene, optionalContent: { ...sourceScene.optionalContent,
    groups: [...sourceScene.optionalContent.groups, { id: "ref:3:0", name: "HEP retained layer", defaultVisible: true, usedInView: true, locked: false }],
    order: [...sourceScene.optionalContent.order, { kind: "group", groupId: "ref:3:0" }] } };
  const hepEditor = await openEditorSession(hepScene);
  try {
    const added = hepEditor.createLayer({ name: "HEP assigned layer" });
    const red = Array.from({ length: hepScene.fillPathCount }, (_, index) => ({ kind: "fill", index }))
      .find(ref => { const item = getScenePrimitive(hepScene, ref); return item.pageIndex === 0 && item.color?.[0] === 1 && item.color[1] === 0; });
    hepEditor.selectPrimitives([red]); hepEditor.assignSelectionToLayer(added);
    hepEditor.updateLayer("ref:5:0", { defaultVisible: false });
    hepEditor.addObject({ kind: "ink", pageIndex: 0, paths: [[[70, 70], [90, 85]]], color: "blue", strokeWidth: 3, layerId: "ref:3:0" });
    const saved = await save(hepEditor), scene = await compile(saved), groups = scene.optionalContent.groups.filter(group => !group.annotationId);
    assert.deepEqual(new Set(groups.map(group => group.id)), new Set(["ref:3:0", "ref:5:0", "ref:6:0", added]),
      "HEP-to-editable-PDF keeps ref-style identities despite collisions with newly allocated PDF object numbers");
    assert.equal(groups.find(group => group.id === "ref:3:0").name, "HEP retained layer");
    assert.deepEqual((await sample(saved))(80, 77.5), [0, 0, 255, 255], "imported HEP appearance gates reuse stable layer identities rather than coincidental physical object numbers");
    const reopened = await openEditorSession(scene, { sourcePdf: saved });
    try { reopened.updateLayer("ref:3:0", { name: "HEP layer edited after reopen" }); assert((await compile(await save(reopened))).optionalContent.groups.some(group => group.id === "ref:3:0" && group.name === "HEP layer edited after reopen")); }
    finally { reopened.dispose(); }
  } finally { hepEditor.dispose(); }
  const metadata = await openEditorSession(sourceScene, { sourcePdf: bytes });
  try {
    metadata.updateLayer("ref:5:0", { name: "Renamed Ω", defaultVisible: false });
    const empty = metadata.createLayer({ name: "Empty retained layer", defaultVisible: false });
    const saved = await save(metadata), document = await NativePdfDocument.open({ kind: "bytes", bytes: saved });
    try {
      assert.deepEqual(await document.getDecodedPageContents(0), originalContents, "metadata-only edits preserve original page operations byte-for-byte");
      assert.deepEqual(await document.decodeStream(await document.resolveObject({ kind: "ref", objectNumber: 8, generation: 0 })), originalFormBytes, "shared source Form streams remain untouched");
      const group = await document.resolveDictionary({ kind: "ref", objectNumber: 5, generation: 0 });
      assert.deepEqual(group.get("Intent"), [{ kind: "name", value: "View" }, { kind: "name", value: "Design" }]);
      assert.equal((await document.resolveDictionary((await document.resolveDictionary(group.get("Usage"))).get("Print"))).get("PrintState").value, "OFF");
      assert.equal(group.get("CreatorInfo").bytes.length, 9, "unrelated OCG metadata remains intact");
      const properties = await document.resolveDictionary(document.catalog.get("OCProperties")), defaults = await document.resolveDictionary(properties.get("D"));
      assert.equal(defaults.get("Custom").bytes.length, 12);
      const applications = await document.resolveValue(defaults.get("AS"));
      assert.equal(applications[0].get("OCGs").length, 1, "explicit visibility overrides only its default View usage application");
      const alternate = await document.resolveDictionary((await document.resolveValue(properties.get("Configs")))[0]);
      assert.equal(alternate.get("ON").length, 1); assert.equal(alternate.get("OFF").length, 1);
    } finally { await document.close(); }
    const reopened = await compile(saved);
    assert(reopened.optionalContent.groups.some(group => group.id === empty && group.name === "Empty retained layer"));
    assert.equal(reopened.optionalContent.groups.find(group => group.name === "Renamed Ω").defaultVisible, false);
    assert(reopened.optionalContent.groups.find(group => group.name === "B").locked);
    const scenePdf = await compile(new Uint8Array(await (await writeScenePdf(sourceScene)).arrayBuffer()));
    assert.deepEqual(scenePdf.optionalContent.groups.map(group => group.name), ["A", "B"], "internal annotation visibility groups never become PDF layers");
  } finally { metadata.dispose(); }
  const duplicateIds = await NativePdfDocument.open({ kind: "bytes", bytes });
  let duplicateBytes;
  try {
    const writer = new NativePdfWriter(duplicateIds);
    for (const objectNumber of [5, 6]) {
      const ref = { kind: "ref", objectNumber, generation: 0 }, group = new Map(await duplicateIds.resolveDictionary(ref));
      group.set("HEPRLayerId", pdfTextValue("editor:layer:1")); writer.set(ref, group);
    }
    duplicateBytes = await writer.save();
  } finally { await duplicateIds.close(); }
  const duplicateEditor = await openEditorSession(await compile(duplicateBytes), { sourcePdf: duplicateBytes });
  try {
    const added = duplicateEditor.createLayer({ name: "Independent despite malformed IDs" });
    assert.equal(added, "editor:layer:1");
    const groups = (await compile(await save(duplicateEditor))).optionalContent.groups.filter(group => !group.annotationId);
    assert.equal(groups.length, 3); assert.deepEqual(groups.map(group => group.name), ["A", "B", "Independent despite malformed IDs"]);
    assert.equal(new Set(groups.map(group => group.id)).size, 3, "duplicate persisted IDs cannot capture a newly created layer");
  } finally { duplicateEditor.dispose(); }

  const assignment = await openEditorSession(sourceScene, { sourcePdf: bytes });
  let assigned, added;
  try {
    added = assignment.createLayer({ name: "Assigned" });
    const red = Array.from({ length: sourceScene.fillPathCount }, (_, index) => ({ kind: "fill", index }))
      .find(ref => { const item = getScenePrimitive(sourceScene, ref); return item.pageIndex === 0 && item.color?.[0] === 1 && item.color[1] === 0; });
    assert(red); assignment.selectPrimitives([red]); assignment.assignSelectionToLayer(added);
    assignment.assignObjectsToLayer(["annotation:ref:10:0", "annotation:ref:12:0"], added);
    assignment.updateLayer("ref:5:0", { defaultVisible: false });
    assignment.addObject({ id: "new-layered-ink", kind: "ink", pageIndex: 0, paths: [[[70, 70], [90, 85]]], color: "blue", strokeWidth: 3, layerId: added });
    const warnings = []; assigned = await save(assignment, { onWarning: warning => warnings.push(warning) });
    assert(!warnings.some(warning => /rebuilt as vectors/.test(warning)), "source membership edits preserve the page and isolate only the affected invocation");
    const first = await sample(assigned), second = await sample(assigned, 1);
    assert.deepEqual(first(15, 15), [255, 0, 0, 255]); assert.deepEqual(second(15, 15), [255, 255, 255, 255], "one assigned shared Form invocation does not change the other page");
    const document = await NativePdfDocument.open({ kind: "bytes", bytes: assigned });
    try {
      const annotations = await document.resolveValue(document.getPage(0).dictionary.get("Annots"));
      for (const ref of annotations) { const annotation = await document.resolveDictionary(ref); assert(annotation.has("OC"), "source widgets, source annotations and new Ink persist explicit OCG ownership"); }
      assert.deepEqual(await document.decodeStream(await document.resolveObject({ kind: "ref", objectNumber: 8, generation: 0 })), originalFormBytes);
    } finally { await document.close(); }
  } finally { assignment.dispose(); }
  const reopened = await openEditorSession(await compile(assigned), { sourcePdf: assigned });
  try {
    assert(reopened.getLayers().some(group => group.id === added));
    reopened.removeLayer(added); const removed = await save(reopened), scene = await compile(removed);
    assert(!scene.optionalContent.groups.some(group => group.id === added));
    assert.deepEqual((await sample(removed))(15, 15), [255, 0, 0, 255], "removing the assigned layer retains visible content");
    const document = await NativePdfDocument.open({ kind: "bytes", bytes: removed });
    try { const registry = await createNativeOptionalContentRegistry(document); assert(!registry.getDiagnostics().some(item => /missing/.test(item.code))); }
    finally { await document.close(); }
  } finally { reopened.dispose(); }

  const compoundDocument = await NativePdfDocument.open({ kind: "bytes", bytes: fixture(true) });
  let compoundBytes;
  try {
    const writer = new NativePdfWriter(compoundDocument), ref = { kind: "ref", objectNumber: 10, generation: 0 };
    const annotation = new Map(await compoundDocument.resolveDictionary(ref));
    annotation.set("OC", writer.add(new Map([["Type", pdfNameValue("OCMD")],
      ["VE", [pdfNameValue("And"), { kind: "ref", objectNumber: 5, generation: 0 }, [pdfNameValue("Not"), { kind: "ref", objectNumber: 6, generation: 0 }]]]])));
    writer.set(ref, annotation); compoundBytes = await writer.save();
  } finally { await compoundDocument.close(); }
  const textOptions = sourcePdf => ({ sourcePdf, loadFontAsset: async url => new Uint8Array(await readFile(url)) });
  const compound = await openEditorSession(await compile(compoundBytes), textOptions(compoundBytes));
  let compoundSaved, textAnnotation;
  try {
    compound.updateLayer("ref:6:0", { locked: false, defaultVisible: false });
    const target = compound.addObject({ id: "compound-text", kind: "text", pageIndex: 0, x: 10, y: 65, width: 35, height: 20, fontSize: 8, text: "Compound Ω" });
    compound.copyObjectLayerMembership("annotation:ref:10:0", target);
    compound.select(["annotation:ref:10:0"]); compound.deleteSelection();
    compoundSaved = await save(compound);
    const scene = await compile(compoundSaved); textAnnotation = scene.annotations.find(annotation => annotation.name === target);
    assert(textAnnotation);
    const document = await NativePdfDocument.open({ kind: "bytes", bytes: compoundSaved });
    try {
      const ref = textAnnotation.id.split(":").slice(1).map(Number), dictionary = await document.resolveDictionary({ kind: "ref", objectNumber: ref[0], generation: ref[1] });
      const membership = await document.resolveDictionary(dictionary.get("OC")); assert.equal(membership.get("Type").value, "OCMD");
      assert(JSON.stringify(membership.get("VE")).includes("Not"), "re-edited text retains the exact compound membership");
      assert.equal(JSON.parse(decodePdfString(dictionary.get("HEPRText"), 0, 0)).object.layerCondition, undefined,
        "session-local condition indices never enter the textbox authoring JSON");
    } finally { await document.close(); }
  } finally { compound.dispose(); }
  const editing = await openEditorSession(await compile(compoundSaved), textOptions(compoundSaved));
  try {
    editing.removeLayer("ref:5:0", { targetLayerId: "ref:6:0" }); editing.removeLayer("ref:6:0");
    const saved = await save(editing), scene = await compile(saved);
    assert.equal(scene.optionalContent?.groups.filter(group => !group.annotationId).length ?? 0, 0, "constant-false membership needs no helper user layer");
    const document = await NativePdfDocument.open({ kind: "bytes", bytes: saved });
    try {
      const ref = textAnnotation.id.split(":").slice(1).map(Number), dictionary = await document.resolveDictionary({ kind: "ref", objectNumber: ref[0], generation: ref[1] });
      assert.equal(dictionary.get("F") & 2, 2); assert(!dictionary.has("OC"), "constant false stays hidden after all real layers are removed");
    } finally { await document.close(); }
    const fonts = createEditorFontRegistry({ loadAsset() { throw new Error("Rebuilt text must retain its original authoring fonts."); } });
    try { const text = await readEditorTextAnnotation(saved, textAnnotation.id, fonts); assert.equal(text.text, "Compound Ω"); assert(fonts.list().length > 0); }
    finally { fonts.dispose(); }
  } finally { editing.dispose(); }

  for (const targetLayerId of [null, "ref:6:0"]) {
    const editor = await openEditorSession(sourceScene, { sourcePdf: bytes });
    try {
      editor.removeLayer("ref:5:0", { targetLayerId }); const saved = await save(editor), scene = await compile(saved), pixels = await sample(saved);
      assert(!scene.optionalContent.groups.some(group => group.id === "ref:5:0"));
      assert.deepEqual(pixels(15, 15), targetLayerId ? [255, 255, 255, 255] : [255, 0, 0, 255]);
      assert.deepEqual(pixels(70, 15), [255, 0, 255, 255], "Not(A) content survives forgetting or retargeting to hidden B");
      assert.deepEqual(pixels(70, 30), [255, 255, 255, 255], "A And B retains the remaining hidden B dependency");
      assert.deepEqual(pixels(85, 15), targetLayerId ? [255, 255, 255, 255] : [0, 255, 255, 255], "existential forgetting preserves A Or B content");
      const document = await NativePdfDocument.open({ kind: "bytes", bytes: saved });
      try { const old = await document.resolveDictionary({ kind: "ref", objectNumber: 5, generation: 0 }); assert.equal(old.get("Type").value, "OCMD"); assert(!old.has("OCGs")); }
      finally { await document.close(); }
    } finally { editor.dispose(); }
  }
  const stackingBytes = fixture(true), stacking = await openEditorSession(await compile(stackingBytes), { sourcePdf: stackingBytes });
  try {
    stacking.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 10, y: 65, width: 20, height: 20, fill: "blue", layerId: "ref:6:0" });
    stacking.moveLayer("ref:5:0", { index: 1 }); stacking.moveLayer("ref:5:0", { index: 0 });
    const diagnostics = [], saved = await save(stacking, { onDiagnostic: value => diagnostics.push(value) }), pixels = await sample(saved);
    assert.deepEqual(pixels(30, 30), [255, 0, 0, 255], "layer order changes source page paint stacking");
    assert.deepEqual(pixels(20, 75), [0, 255, 0, 255], "annotation array stacking follows the same frontmost layer");
    assert(diagnostics.some(item => item.code === "editor.pdf-layer-stacking"));
    assert.deepEqual((await sample(await save(stacking, { flatten: true })))(20, 75), [0, 255, 0, 255]);
  } finally { stacking.dispose(); }
  console.log("Native PDF layers: metadata/provenance, stable IDs, shared Forms, source/widget/annotation assignments, removal/retargeting, stacking and flattened export passed.");
} finally { hooks.deregister(); }

function fixture(bothVisible = false) {
  return writeTinyPdf({ objects: [
    { number: 1, body: `<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [12 0 R] >> /OCProperties << /OCGs [5 0 R 6 0 R] /D << /Name (Default) /BaseState /OFF /ON [5 0 R${bothVisible ? " 6 0 R" : ""}] /OFF [${bothVisible ? "" : "6 0 R"}] /Order [5 0 R 6 0 R] /Locked [6 0 R] /RBGroups [${bothVisible ? "" : "[5 0 R 6 0 R]"}] /Custom (keep-default) /AS [<< /Event /View /Category [/View] /OCGs [5 0 R 6 0 R] >>] >> /Configs [<< /Name (Alternate) /BaseState /ON /ON [6 0 R] /OFF [5 0 R] /Order [[(Nested) 5 0 R 6 0 R]] /Locked [6 0 R] /RBGroups [[5 0 R 6 0 R]] >>] >> >>` },
    { number: 2, body: "<< /Type /Pages /Count 2 /Kids [3 0 R 14 0 R] >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << /XObject << /Shared 8 0 R >> >> /Annots [10 0 R 12 0 R] >>" },
    { number: 4, body: tinyPdfStream("", "1 1 1 rg 0 0 100 100 re f /Shared Do") },
    { number: 5, body: "<< /Type /OCG /Name (A) /Intent [/View /Design] /CreatorInfo (unchanged) /Usage << /View << /ViewState /ON >> /Print << /PrintState /OFF >> >> >>" },
    { number: 6, body: `<< /Type /OCG /Name (B) /Usage << /View << /ViewState /${bothVisible ? "ON" : "OFF"} >> >> >>` },
    { number: 7, body: "<< /Type /OCMD /VE [/And 5 0 R 6 0 R] >>" },
    { number: 8, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << /Properties << /A 5 0 R /B 6 0 R /NotA 9 0 R /Both 7 0 R /Either 16 0 R >> >>", "/OC /A BDC 1 0 0 rg 10 10 30 30 re f EMC /OC /B BDC 0 0 1 rg 25 25 30 30 re f EMC /OC /NotA BDC 1 0 1 rg 65 10 10 10 re f EMC /OC /Both BDC 0 1 0 rg 65 25 10 10 re f EMC /OC /Either BDC 0 1 1 rg 80 10 10 10 re f EMC") },
    { number: 9, body: "<< /Type /OCMD /VE [/Not 5 0 R] >>" },
    { number: 10, body: "<< /Type /Annot /Subtype /Square /F 4 /Rect [10 65 30 85] /OC 5 0 R /AP << /N 11 0 R >> >>" },
    { number: 11, body: tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 20 20] /Resources << >>", "0 1 0 rg 0 0 20 20 re f") },
    { number: 12, body: "<< /Type /Annot /Subtype /Widget /FT /Tx /T (Empty) /V () /F 4 /Rect [40 65 60 85] /OC 5 0 R >>" },
    { number: 14, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 15 0 R /Resources << /XObject << /Shared 8 0 R >> >> >>" },
    { number: 15, body: tinyPdfStream("", "1 1 1 rg 0 0 100 100 re f /Shared Do") },
    { number: 16, body: "<< /Type /OCMD /VE [/Or 5 0 R 6 0 R] >>" }
  ] });
}
