import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(s, c, n) {
  return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { createBundledStandardFontResolver } = await import("../src/standardFontResolver.ts");
  const { loadSceneFromHep } = await import("../src/hep.ts");
  const { editorPaintIdentity } = await import("../src/editorPaintIdentity.ts");
  const { getScenePrimitive } = await import("../src/scenePrimitives.ts");
  const { composeVectorScenesInGrid } = await import("../src/pdfVectorExtractor.ts");
  const { ScenePageViews } = await import("../src/scenePageViews.ts");
  const { editorOriginalPaintPrimitive } = await import("../src/editorPaintIdentity.ts");
  const resolver = createBundledStandardFontResolver({ loadAsset: asset => readFile(asset.url) });
  const compile = async bytes => {
    const parser = await openPdf({ kind: "bytes", bytes }, { missingFontResolver: resolver });
    try { return await parser.compileVectorPage(0, { optimization: "none", preserveDrawingOrder: true }); }
    finally { await parser.close(); }
  };
  for (const matrix of ["1 0 0 1 20 50", "1 .2 .3 1.5 20 50"]) {
    const bytes = fixture(matrix), source = await compile(bytes), diagnostics = [];
    const services = await createEditorAppServices({ sourcePdf: bytes, loadFontAsset: url => readFile(url) });
    const session = await openEditorSession(source, { ...services.sessionOptions, onDiagnostic: value => diagnostics.push(value) });
    try {
      const originalA = source.textInstanceA.slice(), originalB = source.textInstanceB.slice(), originalGlyphs = source.textGlyphSegmentsA.slice();
      const id = "source:text:0";
      assert.equal(session.getObject(id).fontWeight, "normal"); assert.equal(session.getObject(id).fontStyle, "normal");
      session.updateObject(id, { fontWeight: "bold", fontStyle: "italic" });
      assert.equal(session.getObject(id).fontWeight, "bold"); assert.equal(session.getObject(id).fontStyle, "italic");
      const revision = session.revision; session.updateObject(id, { fontWeight: 700, fontStyle: "oblique" });
      assert.equal(session.revision, revision, "equivalent emphasis does not add history");
      let styled = await session.getScene();
      assert.equal(styled.textInstanceCount, source.textInstanceCount + 1, "emphasis retains searchable glyphs and adds one synthetic pen instance");
      assert.equal(styled.textIndex.pages[0].text, source.textIndex.pages[0].text);
      assert.equal(editorPaintIdentity(styled)({ kind: "text", index: 0 }), editorPaintIdentity(source)({ kind: "text", index: 0 }));
      assert.notEqual(styled.textInstanceB.at(-2), source.textInstanceB[2], "only selected glyph receives an expanded pen outline");
      assert.deepEqual(styled.textInstanceA.slice(4, originalA.length), source.textInstanceA.slice(4), "neighboring source glyph placement is unchanged");
      assert(Math.abs(styled.textInstanceA[2] - source.textInstanceA[2] - source.textInstanceA[0] * .212556) < 1e-7);
      assert.deepEqual(source.textInstanceA, originalA); assert.deepEqual(source.textInstanceB, originalB); assert.deepEqual(source.textGlyphSegmentsA, originalGlyphs);
      session.updateObject(id, { fontWeight: "normal", fontStyle: "normal" });
      let plain = await session.getScene(); assert.deepEqual(plain.textInstanceA, source.textInstanceA); assert.deepEqual(plain.textInstanceB, source.textInstanceB);
      assert(session.undo()); assert.equal(session.getObject(id).fontWeight, "bold"); assert(session.redo()); assert.equal(session.getObject(id).fontWeight, "normal");
      session.updateObject(id, { fontWeight: "bold", fontStyle: "italic", color: "#3377cc" });
      session.select([id]); session.transformSelection([1, 0, 0, 1, 3, 2]);
      styled = await session.getScene();
      const snapshot = await session.captureRecovery(), recovered = createEditorSession(source, { sourcePdf: bytes });
      try {
        await recovered.restoreRecovery(snapshot); assert.equal(recovered.getObject(id).fontWeight, "bold");
        assert.deepEqual((await recovered.getScene()).textInstanceA, styled.textInstanceA);
        assert.deepEqual((await recovered.getScene()).textInstanceB, styled.textInstanceB);
        const invalid = structuredClone(snapshot); invalid.data.state.edits.get("text:0").textStyle.bold = "yes";
        await assert.rejects(recovered.restoreRecovery(invalid), /text emphasis/);
      } finally { recovered.dispose(); }
      session.setObjectsLocked([id], true); assert.throws(() => session.updateObject(id, { fontWeight: "normal" }), /locked/); session.setObjectsLocked([id], false);
      const saved = new Uint8Array(await (await session.savePdf({ markSaved: false, onDiagnostic: value => diagnostics.push(value) })).arrayBuffer());
      const actual = await compile(saved);
      assert(actual.textIndex.pages[0].text.replace(/\s/g, "").includes("OBCD"), `native codes and subsequent text survive source styling: ${actual.textIndex.pages[0].text}`);
      assert(Math.abs(actual.textInstanceA[2] - styled.textInstanceA[2]) < 1e-6, "PDF keeps the same glyph-local shear");
      assert(Math.abs(actual.textInstanceB[0] - styled.textInstanceB[0]) < 1e-4, "PDF keeps the transformed source origin");
      assert(!diagnostics.some(value => value.code === "editor.pdf-source-operation-fallback"), JSON.stringify(diagnostics));
      const hep = await session.saveHep({ withVectorLod: false, withTextLod: false, markSaved: false });
      const reopened = await loadSceneFromHep(await hep.arrayBuffer());
      close(reopened.textInstanceA, styled.textInstanceA, .001); close(reopened.textInstanceB, styled.textInstanceB, .005);
      close(reopened.textGlyphSegmentsA, styled.textGlyphSegmentsA, .5);
      assert.equal(reopened.textIndex.pages[0].text, styled.textIndex.pages[0].text);
      const [clone] = session.cloneSelection([10, 0]);
      assert.equal(session.getObjects().find(object => object.id === clone).kind, "source");
      assert.equal((await session.getScene()).textInstanceCount, styled.textInstanceCount + 2, "source duplication retains both the original fill and synthetic pen");
      // A source font style request never modifies a selected non-text primitive.
      const vector = "source:stroke:0", before = session.revision; session.updateObject(vector, { fontWeight: "bold" });
      assert.equal(session.revision, before);
      assert(getScenePrimitive(actual, { kind: "text", index: 0 }).segmentCount > 0);
    } finally { session.dispose(); services.dispose(); }
  }
  const page = await compile(fixture("1 0 0 1 20 50")), multipage = composeVectorScenesInGrid([page, page], 1);
  const session = createEditorSession(multipage);
  try {
    const selected = page.textInstanceCount;
    session.updateObject(`source:text:${selected}`, { fontWeight: "bold", fontStyle: "italic" });
    session.select(["source:text:0"]); session.deleteSelection();
    const scene = await session.getScene(), views = new ScenePageViews(scene), original = editorOriginalPaintPrimitive(scene);
    assert.equal(scene.pageTextRanges[1], page.textInstanceCount - 1);
    assert.equal(scene.pageTextRanges[3], page.textInstanceCount + 1, "appended pen belongs to the correct page after earlier glyph deletion");
    const matches = Array.from({ length: scene.textInstanceCount }, (_, index) => index)
      .filter(index => original({ kind: "text", index }).index === selected);
    assert.equal(matches.length, 2, "the source fill and synthetic pen retain precise glyph provenance through compaction");
    assert(matches.every(index => views.owners.text[index] === 1));
    const pageView = views.extract(1).scene;
    assert.equal(pageView.textInstanceCount, page.textInstanceCount + 1);
    assert.equal(pageView.textIndex.pages[0].text, page.textIndex.pages[0].text);
    const next = createEditorSession(scene);
    try {
      const canonical = editorOriginalPaintPrimitive(scene);
      assert.equal(canonical({ kind: "text", index: selected - 1 }).index, selected - 1, "a new canonical source resets provenance from the previous layout");
      next.updateObject(`source:text:${selected - 1}`, { fontStyle: "italic" });
      const after = await next.getScene();
      assert(after.textInstanceA[selected * 4 - 2] !== scene.textInstanceA[selected * 4 - 2], "a new source edit addresses its current canonical glyph index");
    } finally { next.dispose(); }
  } finally { session.dispose(); }
  console.log("Source text styles: reversible glyph emphasis, source immutability, provenance, undo/redo, color/transforms, locks, recovery, copies and PDF/HEP persistence passed.");
} finally { hooks.deregister(); }

function fixture(matrix) {
  return writeTinyPdf({ objects: [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    { number: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    { number: 3, body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F 5 0 R >> /ExtGState << /Half 6 0 R >> >> /Contents 4 0 R >>" },
    { number: 4, body: tinyPdfStream("", `0 0 0 RG 1 w 10 20 m 150 20 l S q /Half gs [2] 1 d BT /F 12 Tf ${matrix} Tm (OBC) Tj (D) Tj ET Q`) },
    { number: 5, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
    { number: 6, body: "<< /Type /ExtGState /ca .5 /CA 1 >>" }
  ] });
}

function close(actual, expected, tolerance) {
  assert.equal(actual.length, expected.length, "HEP retains every styled geometry component");
  actual.forEach((value, index) => assert(Math.abs(value - expected[index]) <= tolerance,
    `HEP quantized component ${index}: ${value} differs from ${expected[index]} by more than ${tolerance}`));
}
