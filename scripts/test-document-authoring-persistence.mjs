// Synthetic documents only: verify real PDF/HEP serialization, with no browser or client files.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
try {
  const { createDocumentAuthoring, normalizePageNumbering, parseDocumentAuthoring } = await import("../src/documentAuthoring.ts");
  const { createEmptyVectorScene } = await import("../src/emptyVectorScene.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { writeScenePdf } = await import("../src/editorPdfWriter.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfWriter, pdfTextValue } = await import("../src/pdf/nativeWriter.ts");
  const { isPdfRef } = await import("../src/pdf/nativeCos.ts");
  const { decodePdfString } = await import("../src/pdf/nativeForms.ts");
  const { buildHep } = await import("../src/hepBuilder.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const { HepArchive } = await import("../src/hepContainer.ts");
  const { writeHepAnnotations, readHepAnnotations } = await import("../src/hepAnnotations.ts");
  const { editorRecoveryDocumentKey } = await import("../src/editorRecovery.ts");
  const { preparePrintPdf } = await import("../src/pdfPrint.ts");
  const { PdfPageDemandLoader } = await import("../src/pdfPageDemand.ts");
  const { openDocumentSession } = await import("../src/documentSession.ts");
  const page = (width, height) => ({ ...createEmptyVectorScene(), pageCount: 1, pageRects: Float32Array.of(0, 0, width, height),
    pageTextRanges: Uint32Array.of(0, 0), bounds: { minX: 0, minY: 0, maxX: width, maxY: height }, pageBounds: { minX: 0, minY: 0, maxX: width, maxY: height } });
  const toBytes = async blob => new Uint8Array(await blob.arrayBuffer());
  const compile = async bytes => {
    const parser = await openPdf({ kind: "bytes", bytes });
    try {
      const pages = [];
      for (let index = 0; index < parser.info.pageCount; index++) pages.push(await parser.compileVectorPage(index, { optimization: "none", preserveDrawingOrder: true }));
      return composeVectorScenesInGrid(pages, 1);
    } finally { await parser.close(); }
  };
  const metadata = async bytes => {
    const document = await NativePdfDocument.open({ kind: "bytes", bytes });
    try {
      const raw = await document.resolveValue(document.catalog.get("HEPRDocument"));
      return { data: raw ? JSON.parse(decodePdfString(raw, 0, 0)) : undefined, title: document.info.metadata.title };
    } finally { await document.close(); }
  };
  const enabled = normalizePageNumbering({ enabled: true, skipFirstPage: true, startNumber: 7, format: "page-of-total", position: "header", align: "right" });
  const scene = composeVectorScenesInGrid([page(200, 300), page(400, 250)], 1);
  scene.documentAuthoring = createDocumentAuthoring(enabled, "Created Ω PDF");
  const authoring = structuredClone(scene.documentAuthoring);
  const otherScene = { ...scene, documentAuthoring: createDocumentAuthoring(enabled, "Created Ω PDF") };
  const first = await toBytes(await writeScenePdf(scene)), second = await toBytes(await writeScenePdf(otherScene));
  assert.notEqual(await editorRecoveryDocumentKey({ bytes: first }), await editorRecoveryDocumentKey({ bytes: second }), "identical new page layouts have independent recovery identities");
  assert.deepEqual((await metadata(first)).data, authoring);
  assert.equal((await metadata(first)).title, "Created Ω PDF");
  const metadataOnly = await loadSceneFromHep(await toBytes(await buildHep(scene, { compression: "store" })));
  assert.deepEqual(metadataOnly.documentAuthoring, authoring, "settings survive HEP even before any number appearances exist");

  const editor = await openEditorSession(scene);
  let editable, flattened, hep;
  try {
    editable = await toBytes(await editor.savePdf());
    flattened = await toBytes(await editor.savePdf({ flatten: true }));
    hep = await toBytes(await editor.saveHep({ compression: "store" }));
  } finally { editor.dispose(); }
  assert.deepEqual((await metadata(editable)).data, authoring);
  assert.equal((await metadata(flattened)).data, undefined, "flattening emits no live numbering policy");
  const savedScene = await compile(editable), flatScene = await compile(flattened);
  assert.deepEqual(savedScene.documentAuthoring, authoring, "normal PDF viewing retains optional settings before entering edit mode");
  assert.equal(savedScene.annotations.filter(item => item.pageNumberingId === authoring.id).length, 1);
  assert(flatScene.textIndex.pages.some(page => page.text.includes("Page 7")), "flattened numbers stay visible/searchable");
  const reopened = await openEditorSession(savedScene, { sourcePdf: editable });
  try {
    assert.deepEqual(reopened.getPageNumbering(), enabled, "PDF opening discovers document settings without requiring form fields");
    const again = await compile(await toBytes(await reopened.savePdf()));
    assert.equal(again.annotations.filter(item => item.pageNumberingId === authoring.id).length, 1, "reopening replaces the old appearance instead of duplicating numbers");
    reopened.setPageNumbering({ enabled: false });
    const disabled = await toBytes(await reopened.savePdf());
    assert.equal((await metadata(disabled)).data.pageNumbering.enabled, false, "disabled settings remain adjustable after reopening");
    assert.equal((await compile(disabled)).annotations.filter(item => item.pageNumberingId === authoring.id).length, 0);
  } finally { reopened.dispose(); }
  const loadedHep = await loadSceneFromHep(hep), fromHep = await openEditorSession(loadedHep);
  try {
    assert.deepEqual(fromHep.getPageNumbering(), enabled);
    const output = await compile(await toBytes(await fromHep.savePdf()));
    assert.equal(output.annotations.filter(item => item.pageNumberingId === authoring.id).length, 1, "HEP reopening replaces compiled number ownership exactly");
    assert.equal(output.textIndex.pages[1].text.match(/Page 7/g)?.length, 1, "HEP round trips do not retain old number paint");
  } finally { fromHep.dispose(); }
  for (const [label, directScene] of [["compiled PDF", savedScene], ["HEP", loadedHep]]) {
    const directBytes = await toBytes(await writeScenePdf(directScene)), direct = await openEditorSession(await compile(directBytes), { sourcePdf: directBytes });
    try {
      const retained = await compile(await toBytes(await direct.savePdf()));
      assert.equal(retained.annotations.filter(annotation => annotation.pageNumberingId === authoring.id).length, 1, `${label}: direct scene writer retains one replaceable appearance`);
      assert.equal(retained.textIndex.pages[1].text.match(/Page 7/g)?.length, 1);
      direct.setPageNumbering({ enabled: false });
      const disabled = await compile(await toBytes(await direct.savePdf()));
      assert(!disabled.textIndex.pages.some(page => page.text.includes("Page 7")), `${label}: disabling removes the saved appearance, including its original paint`);
    } finally { direct.dispose(); }
  }
  const printable = await toBytes(await preparePrintPdf({ scene: loadedHep }));
  assert.equal((await metadata(printable)).data, undefined, "scene printing bakes visible numbers without retaining an automatic policy");
  assert((await compile(printable)).textIndex.pages[1].text.includes("Page 7"));
  const convertedHep = await loadSceneFromHep(await toBytes(await buildHep(editable, { compression: "store" })));
  assert.deepEqual(convertedHep.documentAuthoring, authoring, "direct PDF-to-HEP conversion retains numbering policy without entering edit mode");
  const convertedEditor = await openEditorSession(convertedHep);
  try {
    const converted = await compile(await toBytes(await convertedEditor.savePdf()));
    assert.equal(converted.annotations.filter(annotation => annotation.pageNumberingId === authoring.id).length, 1);
    assert.equal(converted.textIndex.pages[1].text.match(/Page 7/g)?.length, 1);
  } finally { convertedEditor.dispose(); }
  const selected = await loadSceneFromHep(await toBytes(await buildHep(editable, { pages: "2", compression: "store" })));
  assert.equal(selected.documentAuthoring, undefined, "selected-page conversion retains fixed visible numbers without a full-document policy");
  const selectedEditor = await openEditorSession(selected);
  try {
    assert.equal(selectedEditor.getPageNumbering().enabled, false);
    assert((await selectedEditor.getScene()).textIndex.pages[0].text.includes("Page 7"), "selected numbered page remains visible when it becomes the first page");
  } finally { selectedEditor.dispose(); }
  const selectedParser = await openPdf({ kind: "bytes", bytes: editable });
  let selectedScene;
  try { selectedScene = await selectedParser.compileVectorPage(1); } finally { await selectedParser.close(); }
  const sourceSelection = await openEditorSession(selectedScene, { sourcePdf: editable });
  try {
    assert.equal(sourceSelection.getPageNumbering().enabled, false, "editor preparation does not reattach a complete-source policy to a partial scene");
    assert((await sourceSelection.getScene()).textIndex.pages[0].text.includes("Page 7"));
  } finally { sourceSelection.dispose(); }
  const demandParser = await openPdf({ kind: "bytes", bytes: editable }), demand = new PdfPageDemandLoader(demandParser, () => {}, { pages: "2" });
  try {
    const selectedPages = await demand.loadCompletePageScenes();
    assert.equal(selectedPages[0].documentAuthoring, undefined, "page-demand export also detaches a selected-page policy");
  } finally { await demand.close(); }
  const processing = await openDocumentSession(editable);
  try {
    const selection = await loadSceneFromHep(await toBytes(await processing.buildHep({ pages: "2", compression: "store" })));
    assert.equal(selection.documentAuthoring, undefined, "reusable document-session selected-page export keeps its original fixed numbers");
    assert(selection.textIndex.pages[0].text.includes("Page 7"));
  } finally { await processing.close(); }

  const document = await NativePdfDocument.open({ kind: "bytes", bytes: first });
  let invalid;
  try {
    const writer = new NativePdfWriter(document), root = document.getWriterState().xref.trailers.map(trailer => trailer.get("Root")).find(isPdfRef);
    const catalog = new Map(document.catalog); catalog.set("HEPRDocument", pdfTextValue("{invalid")); writer.set(root, catalog);
    invalid = await writer.save();
  } finally { await document.close(); }
  const diagnostics = [], services = await createEditorAppServices({ sourcePdf: invalid, onDiagnostic: diagnostic => diagnostics.push(diagnostic) });
  try {
    const prepared = await services.sessionOptions.prepareScene(await compile(invalid));
    assert.equal(prepared.pageCount, 2); assert.equal(prepared.documentAuthoring, undefined);
    assert(diagnostics.some(diagnostic => diagnostic.code === "authoring.invalid-metadata"), "corrupt optional settings diagnose reduced authoring fidelity without blocking a PDF");
  } finally { services.dispose(); }
  const parserDiagnostics = [], invalidParser = await openPdf({ kind: "bytes", bytes: invalid }, { onDiagnostic: diagnostic => parserDiagnostics.push(diagnostic) });
  try {
    await invalidParser.compileVectorPage(0); await invalidParser.compileVectorPage(1); await invalidParser.compileVectorPage(0);
    assert.equal(parserDiagnostics.filter(diagnostic => diagnostic.code === "authoring.invalid-metadata").length, 1,
      "optional document metadata is decoded once per parser, with no per-page duplicate diagnostics");
  } finally { await invalidParser.close(); }
  const warnings = [];
  assert.equal(parseDocumentAuthoring({ ...authoring, pageNumbering: { enabled: "yes" } }, diagnostic => warnings.push(diagnostic)), undefined);
  assert.equal(warnings.length, 1);
  const archive = new HepArchive(), descriptor = writeHepAnnotations(archive, scene);
  archive.file(descriptor.file, new TextEncoder().encode(JSON.stringify({ version: 1, annotations: [], pdfPages: scene.pdfPages,
    documentAuthoring: { ...authoring, version: 99 } })));
  const previousWarn = console.warn; let warned = false;
  try { console.warn = () => { warned = true; }; await readHepAnnotations(archive, descriptor, scene); }
  finally { console.warn = previousWarn; }
  assert(warned); assert.equal(scene.documentAuthoring, undefined);
  const appearanceArchive = new HepArchive(), appearanceDescriptor = writeHepAnnotations(appearanceArchive, savedScene);
  const appearanceData = JSON.parse(await appearanceArchive.file(appearanceDescriptor.file).async("string"));
  appearanceData.annotations[0].pageNumberingId = { invalid: true };
  appearanceArchive.file(appearanceDescriptor.file, new TextEncoder().encode(JSON.stringify(appearanceData)));
  try {
    console.warn = () => {};
    const retained = await readHepAnnotations(appearanceArchive, appearanceDescriptor, savedScene);
    assert.equal(retained.length, 1); assert.equal(retained[0].pageNumberingId, undefined, "invalid optional ownership keeps the visible ordinary annotation");
  } finally { console.warn = previousWarn; }
  console.log("Document authoring persistence: PDF/HEP round trips, owned appearances, disabled/flattened output, unique recovery and invalid optional metadata passed.");
} finally { hooks.deregister(); }
