// Exercise the document facade and real PDF/HEP output using small synthetic documents.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? next(`${specifier}.ts`, context) : next(specifier, context);
} });
try {
  const { createBlankPdfScene, createPdf } = await import("../src/pdfCreation.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { openPdf } = await import("../src/pdfSession.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const toBytes = async blob => new Uint8Array(await blob.arrayBuffer());
  const compile = async bytes => {
    const parser = await openPdf({ kind: "bytes", bytes });
    try {
      const pages = [];
      for (let index = 0; index < parser.info.pageCount; index++) pages.push(await parser.compileVectorPage(index, { optimization: "none", preserveDrawingOrder: true }));
      return composeVectorScenesInGrid(pages, 1);
    } finally { await parser.close(); }
  };
  const numbers = session => session.getObjects().filter(object => object.kind === "text" && object.pageNumberingId).sort((a, b) => a.pageIndex - b.pageIndex);
  const texts = session => numbers(session).map(object => object.text);
  const expected = session => {
    const policy = session.getPageNumbering(), count = session.getPages().length - (policy.skipFirstPage ? 1 : 0);
    return policy.enabled ? Array.from({ length: count }, (_, index) => {
      const number = policy.startNumber + index;
      return policy.format === "number" ? String(number) : policy.format === "page" ? `Page ${number}` : `Page ${number} of ${policy.startNumber + count - 1}`;
    }) : [];
  };
  function assertModels(session, label) {
    assert.deepEqual(texts(session), expected(session), `${label}: derived sequence and total`);
    for (const object of numbers(session)) {
      const page = session.getPages()[object.pageIndex];
      assert(session.isObjectLocked(object.id), `${label}: generated number is managed`);
      assert(object.x >= 0 && object.y >= 0 && object.x + object.width <= page.width + .001 && object.y + object.height <= page.height + .001, `${label}: placement follows displayed mixed-size/rotated page bounds`);
    }
  }
  function assertPaint(scene, session, label) {
    const wanted = expected(session), first = session.getPageNumbering().skipFirstPage ? 1 : 0;
    const owners = scene.annotations.filter(annotation => annotation.pageNumberingId);
    assert.equal(owners.length, wanted.length, `${label}: one portable owned appearance per numbered page`);
    for (let index = 0; index < wanted.length; index++) {
      const page = first + index, matches = owners.filter(annotation => annotation.pageIndex === page);
      assert.equal(matches.length, 1, `${label}: page ${page + 1} has one managed annotation`);
      assert.equal(matches[0].contents, wanted[index]);
      const text = scene.textIndex.pages[page].text;
      assert.equal(text.split(wanted[index]).length - 1, 1, `${label}: page ${page + 1} has one number paint/text instance`);
    }
  }
  async function roundTrips(session, label) {
    assertModels(session, label);
    const policy = session.getPageNumbering(), pdf = await toBytes(await session.savePdf({ markSaved: false }));
    const scene = await compile(pdf); assertPaint(scene, session, `${label} PDF`);
    const reopened = await openEditorSession(scene, { sourcePdf: pdf });
    try {
      assert.deepEqual(reopened.getPageNumbering(), policy, `${label}: PDF policy restored`); assertModels(reopened, `${label} reopened PDF`);
      assertPaint(await compile(await toBytes(await reopened.savePdf({ markSaved: false }))), reopened, `${label} resaved PDF`);
    } finally { reopened.dispose(); }
    const hep = await loadSceneFromHep(await toBytes(await session.saveHep({ compression: "store", markSaved: false })));
    const fromHep = await openEditorSession(hep);
    try {
      assert.deepEqual(fromHep.getPageNumbering(), policy, `${label}: HEP policy restored`); assertModels(fromHep, `${label} reopened HEP`);
      assertPaint(await compile(await toBytes(await fromHep.savePdf({ markSaved: false }))), fromHep, `${label} resaved HEP`);
    } finally { fromHep.dispose(); }
    return pdf;
  }
  const editor = await openEditorSession(createBlankPdfScene({ pageSize: { width: 240, height: 320 }, pageCount: 2 }));
  try {
    assert.equal(editor.getState().dirty, false); assert.equal(numbers(editor).length, 0);
    editor.setPageNumbering({ enabled: true, startNumber: 5, skipFirstPage: true, format: "page-of-total", marginX: 15, marginY: 15 });
    assert.deepEqual(texts(editor), ["Page 5 of 5"]); assert(editor.getState().dirty);
    assert(editor.undo()); assert.equal(numbers(editor).length, 0); assert.equal(editor.getPageNumbering().enabled, false);
    assert(editor.redo()); assert.deepEqual(texts(editor), ["Page 5 of 5"]);
    const managed = numbers(editor)[0]; editor.select([managed.id]);
    assert.throws(() => editor.updateObject(managed.id, { text: "fixed digits" }), /locked/);
    assert.throws(() => editor.deleteSelection(), /locked/);
    await editor.copySelection();
    const pasted = editor.pasteSelection({ offset: [10, 10] });
    assert.equal(pasted.length, 1); assert.equal(editor.getObject(pasted[0]).pageNumberingId, undefined);
    assert.equal(editor.isObjectLocked(pasted[0]), false, "copy/paste creates ordinary editable text without foreign numbering ownership");
    assert(editor.undo());
    editor.select([]);
    editor.addObject({ kind: "text", id: "body-text", pageIndex: 1, x: 30, y: 160, width: 150, height: 30, text: "Authored body Ω", fontSize: 12 });
    editor.addObject({ kind: "shape", id: "cover-shape", pageIndex: 0, shape: "rectangle", x: 20, y: 80, width: 60, height: 40, fill: "#123456", color: "#000000", strokeWidth: 1 });
    await roundTrips(editor, "source-free authoring");
    const revision = editor.revision;
    assert.throws(() => editor.setPageNumbering({ startNumber: 0 }), /Invalid/); assert.equal(editor.revision, revision);
    await editor.insertBlankPages({ at: 1, pageCount: 1, pageSize: "A5", orientation: "landscape" });
    assert.equal(editor.getPages().length, 3); await roundTrips(editor, "insert blank landscape");
    await editor.rotatePages([0], 90); assert.equal(editor.getPages()[0].width, 320); await roundTrips(editor, "rotate cover");
    await editor.resizePages([1], { width: 360, height: 240 });
    assert.equal(editor.getPages()[1].width, 360); assert.equal(editor.getPages()[1].height, 240); await roundTrips(editor, "resize page");
    await editor.reorderPages([2, 0, 1]); assert.equal(editor.getObject("body-text").pageIndex, 0); await roundTrips(editor, "reorder body before cover");
    const beforeDuplicate = texts(editor);
    await editor.duplicatePages([1], { at: 0 }); assert.equal(editor.getPages().length, 4); await roundTrips(editor, "duplicate before cover");
    assert(editor.undo()); assert.equal(editor.getPages().length, 3); assert.deepEqual(texts(editor), beforeDuplicate);
    assert(editor.redo()); assert.equal(editor.getPages().length, 4); assertModels(editor, "redo duplicate");
    await editor.removePages([2]); assert.equal(editor.getPages().length, 3); await roundTrips(editor, "remove page");
    editor.setPageNumbering({ skipFirstPage: false, format: "page", position: "header", align: "left", startNumber: 11 });
    assert.deepEqual(texts(editor), ["Page 11", "Page 12", "Page 13"]); await roundTrips(editor, "header format adjustment");
    const snapshot = await editor.captureRecovery();
    editor.setPageNumbering({ enabled: false, startNumber: 99 }); assert.equal(numbers(editor).length, 0);
    await editor.restoreRecovery(snapshot); assert.deepEqual(texts(editor), ["Page 11", "Page 12", "Page 13"]);
    await roundTrips(editor, "recovery retains policy newer than source PDF");
    const foreign = await toBytes(await createPdf({ pageSize: "Letter", pageCount: 2,
      pageNumbering: { enabled: true, startNumber: 41, format: "page" } }));
    await editor.insertPdf(foreign, { at: 1 });
    assert.equal(editor.getPages().length, 5); assert.deepEqual(texts(editor), ["Page 11", "Page 12", "Page 13", "Page 14", "Page 15"]);
    const imported = await roundTrips(editor, "numbered foreign import"), importedScene = await compile(imported);
    assert(importedScene.textIndex.pages[1].text.includes("Page 41")); assert(importedScene.textIndex.pages[2].text.includes("Page 42"));
    assert.equal(importedScene.annotations.filter(annotation => annotation.pageNumberingId).length, 5, "imported old numbers are ordinary fixed appearances");
    const extracted = await toBytes(await editor.extractPages([1, 3])), extractedScene = await compile(extracted);
    assert.equal(extractedScene.pageCount, 2); assert.equal(extractedScene.annotations.filter(annotation => annotation.pageNumberingId).length, 0);
    assert(extractedScene.textIndex.pages[0].text.includes("Page 12")); assert(extractedScene.textIndex.pages[1].text.includes("Page 14"));
    const extractedEditor = await openEditorSession(extractedScene, { sourcePdf: extracted });
    try { assert.equal(extractedEditor.getPageNumbering().enabled, false); assert.equal(numbers(extractedEditor).length, 0); }
    finally { extractedEditor.dispose(); }
    const count = editor.getPages().length, abort = new AbortController(); abort.abort();
    await assert.rejects(editor.insertBlankPages({ signal: abort.signal }), error => error.name === "AbortError"); assert.equal(editor.getPages().length, count);
    assertModels(editor, "cancelled insertion");
    console.log("Live page numbers: source-free authoring, all page operations, undo/redo, PDF/HEP reopening, recovery, imports, extraction and cancellation passed.");
  } finally { editor.dispose(); }
} finally { hooks.deregister(); }
