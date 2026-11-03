import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { createPdf, createBlankPdfScene } = await import("../src/pdfCreation.ts");
  const { createPdf: lazyCreatePdf } = await import("../src/editorApi.ts");
  const { PDF_PAGE_SIZE_PRESETS, resolvePdfPageSize } = await import("../src/pdfPageSizes.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { decodePdfString } = await import("../src/pdf/nativeForms.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { manipulatePdfPages } = await import("../src/editorPdfPages.ts");
  const { NativePdfFormAppearanceRegistry } = await import("../src/pdf/nativeForms.ts");
  const closeTo = (actual, expected) => assert(Math.abs(actual - expected) < .001, `${actual} should match ${expected}`);
  const open = async blob => NativePdfDocument.open({ kind: "bytes", bytes: new Uint8Array(await blob.arrayBuffer()) }, { repair: "off" });
  const authoring = document => JSON.parse(decodePdfString(document.catalog.get("HEPRDocument"), 0, 0));
  assert.deepEqual(Object.keys(PDF_PAGE_SIZE_PRESETS), ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "Letter", "Legal", "Tabloid", "Executive"]);
  for (const [name, size] of Object.entries(PDF_PAGE_SIZE_PRESETS)) {
    assert.deepEqual(resolvePdfPageSize(name), size);
    assert.deepEqual(resolvePdfPageSize(name, "landscape"), { width: size.height, height: size.width });
  }
  assert.deepEqual(resolvePdfPageSize({ width: 400, height: 200 }), { width: 400, height: 200 });
  assert.deepEqual(resolvePdfPageSize({ width: 400, height: 200 }, "portrait"), { width: 200, height: 400 });
  const first = await open(await createPdf()), second = await open(await lazyCreatePdf());
  try {
    assert.equal(first.pages.length, 1); closeTo(first.pages[0].mediaBox[2], 210 * 72 / 25.4); closeTo(first.pages[0].mediaBox[3], 297 * 72 / 25.4);
    const identity = authoring(first); assert.equal(identity.created, true); assert.equal(identity.pageNumbering.enabled, false);
    assert.notEqual(identity.id, authoring(second).id, "identical blank documents retain independent recovery identities");
    assert.equal(first.pages[0].annotations, undefined, "numbering starts disabled on a new blank document");
  } finally { await first.close(); await second.close(); }
  const scene = createBlankPdfScene({ pageSize: { width: 500, height: 300 }, pageCount: 3 });
  assert.equal(scene.pageCount, 3); assert.equal(scene.pageTextRanges.length, 6); assert.equal(scene.segmentCount, 0); assert.equal(scene.textInstanceCount, 0);
  const editor = await openEditorSession(scene);
  try {
    assert.deepEqual(editor.getPages().map(page => [page.width, page.height]), [[500, 300], [500, 300], [500, 300]]);
    editor.addObject({ kind: "shape", shape: "rectangle", pageIndex: 1, x: 20, y: 30, width: 50, height: 40, fill: "red" });
    const document = await open(await editor.savePdf());
    try { assert.equal(document.pages.length, 3); assert(document.pages[1].annotations, "newly authored objects export as editable annotations"); }
    finally { await document.close(); }
  } finally { editor.dispose(); }
  const titled = await open(await createPdf({ pageSize: "Letter", orientation: "landscape", pageCount: 2, title: "A new document" }));
  try {
    assert.equal(titled.info.metadata.title, "A new document"); assert.equal(authoring(titled).title, "A new document");
    assert.deepEqual(titled.pages.map(page => page.mediaBox), [[0, 0, 792, 612], [0, 0, 792, 612]]);
  } finally { await titled.close(); }
  const numberedBlob = await createPdf({ pageCount: 2, pageNumbering: { enabled: true, format: "page-of-total" } });
  const numberedBytes = new Uint8Array(await numberedBlob.arrayBuffer()), numbered = await open(numberedBlob);
  try {
    const identity = authoring(numbered);
    for (let page = 0; page < 2; page++) {
      const annotations = await new NativePdfFormAppearanceRegistry(numbered).listPageAnnotations(page);
      const number = annotations.find(annotation => annotation.subtype === "FreeText");
      assert.equal(decodePdfString(number.dictionary.get("Contents"), page, 0), `Page ${page + 1} of 2`);
      assert.equal(decodePdfString(number.dictionary.get("HEPRPageNumber"), page, 0), identity.id);
    }
    const extracted = await open(await manipulatePdfPages(numberedBytes, { kind: "extract", pages: [1] }));
    try {
      assert.equal(extracted.catalog.has("HEPRDocument"), false, "extraction retains visible digits without carrying the original numbering policy");
      const number = (await new NativePdfFormAppearanceRegistry(extracted).listPageAnnotations(0)).find(annotation => annotation.subtype === "FreeText");
      assert.equal(number.dictionary.has("HEPRPageNumber"), false);
      assert.equal(number.dictionary.get("F") & 128, 0, "extracted page numbers lose their managed editing lock");
      const model = JSON.parse(decodePdfString(number.dictionary.get("HEPRText"), 0, 0)).object;
      assert.equal(model.pageNumberingId, undefined); assert.equal(model.text, "Page 2 of 2", "extracted numbers stay editable ordinary text");
    } finally { await extracted.close(); }
    const primaryBlob = await createPdf(), primaryBytes = new Uint8Array(await primaryBlob.arrayBuffer());
    const primary = await open(primaryBlob), merged = await open(await manipulatePdfPages(primaryBytes, { kind: "insert", at: 1, bytes: numberedBytes }));
    try {
      assert.equal(authoring(merged).id, authoring(primary).id, "import retains the primary document's authoring identity and policy");
      const number = (await new NativePdfFormAppearanceRegistry(merged).listPageAnnotations(1)).find(annotation => annotation.subtype === "FreeText");
      assert.equal(number.dictionary.has("HEPRPageNumber"), false);
      assert.equal(number.dictionary.get("F") & 128, 0, "foreign page numbers become ordinary editable annotations");
      assert.equal(JSON.parse(decodePdfString(number.dictionary.get("HEPRText"), 1, 0)).object.pageNumberingId, undefined, "foreign numbers import as ordinary text");
    } finally { await primary.close(); await merged.close(); }
    const duplicated = await open(await manipulatePdfPages(numberedBytes, { kind: "duplicate", pages: [0], at: 0 }));
    try {
      assert.equal(authoring(duplicated).id, identity.id);
      const number = (await new NativePdfFormAppearanceRegistry(duplicated).listPageAnnotations(0)).find(annotation => annotation.subtype === "FreeText");
      assert.equal(decodePdfString(number.dictionary.get("HEPRPageNumber"), 0, 0), identity.id, "same-document duplication retains managed number identity for facade regeneration");
    } finally { await duplicated.close(); }
  } finally { await numbered.close(); }
  for (const create of [createPdf, lazyCreatePdf]) {
    const size = { width: 321, height: 456 }, options = { pageSize: size, pageCount: 2 }, pending = create(options);
    size.width = 999; options.pageCount = 10;
    const document = await open(await pending);
    try { assert.equal(document.pages.length, 2); assert.equal(document.pages[0].mediaBox[2], 321, "creation snapshots mutable settings before awaiting"); }
    finally { await document.close(); }
    const color = [0.2, 0.3, 0.4], settings = { enabled: false, color }, created = create({ pageNumbering: settings });
    color[0] = 1; settings.enabled = true;
    const snapped = await open(await created);
    try { assert.equal(authoring(snapped).pageNumbering.enabled, false); assert.deepEqual(authoring(snapped).pageNumbering.color, [0.2, 0.3, 0.4], "lazy creation snapshots nested color settings"); }
    finally { await snapped.close(); }
  }
  const blob = await createPdf({ pageSize: "A5", pageCount: 2 }), parser = await openPdf({ kind: "bytes", bytes: new Uint8Array(await blob.arrayBuffer()) });
  try {
    const blank = await parser.compileVectorPage(0, { optimization: "none", preserveDrawingOrder: true });
    assert.equal(blank.pageCount, 1); assert.equal(blank.segmentCount, 0); assert.equal(blank.fillPathCount, 0); assert.equal(blank.textInstanceCount, 0);
    assert(blank.pageRects[2] > blank.pageRects[0] && blank.pageRects[3] > blank.pageRects[1], "a genuine paint-free PDF compiles complete visible page geometry");
  } finally { await parser.close(); }
  for (const pageSize of ["Unknown", { width: 0, height: 1 }, { width: 1e39, height: 1 }, { width: 1e-50, height: 1 }, { width: NaN, height: 2 }]) await assert.rejects(createPdf({ pageSize }));
  for (const pageCount of [0, -1, 1.5, Infinity]) await assert.rejects(createPdf({ pageCount }), RangeError);
  await assert.rejects(createPdf({ signal: AbortSignal.abort() }), { name: "AbortError" });
  console.log("PDF creation: presets/custom sizes, orientation, blank geometry, independent identity, title, editable authoring, settings snapshots, validation and cancellation passed.");
} finally { hooks.deregister(); }
