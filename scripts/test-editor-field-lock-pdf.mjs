import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";

const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { NativePdfDocument } = await import("../src/pdf/nativeDocument.ts");
  const { NativePdfWriter } = await import("../src/pdf/nativeWriter.ts");
  const { NativePdfFormAppearanceRegistry, decodePdfString } = await import("../src/pdf/nativeForms.ts");
  const { createNodeBundledStandardFontResolver } = await import("../src/nodePdfResources.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { applyEditorPdfFields } = await import("../src/editorNativePdf.ts");
  const open = async bytes => {
    const parser = bytes ? await openPdf({ kind: "bytes", bytes }, { missingFontResolver: createNodeBundledStandardFontResolver() }) : null;
    const services = await createEditorAppServices({ sourcePdf: bytes, loadFontAsset: url => readFile(url) });
    try {
      const scene = parser ? await parser.compileVectorPage(0, { optimization: "none" }) : buildStrokeScene([{ points: [[0, 0], [400, 500]], width: 1 }]);
      const session = await openEditorSession(scene, { ...services.sessionOptions, sourcePdf: bytes });
      return { session, services, async close() { session.dispose(); services.dispose(); await parser?.close(); } };
    } catch (error) { services.dispose(); await parser?.close(); throw error; }
  };
  const save = async session => new Uint8Array(await (await session.savePdf()).arrayBuffer());
  const inspect = async (bytes, action) => {
    const document = await NativePdfDocument.open({ kind: "bytes", bytes }, { repair: "off" });
    try {
      const widgets = await new NativePdfFormAppearanceRegistry(document).listPageAnnotations(0);
      const named = name => widgets.filter(widget => widget.widget?.fullyQualifiedName === name);
      await action(document, named);
    } finally { await document.close(); }
  };
  const choices = [{ value: "a", label: "A" }, { value: "b", label: "B" }];
  let lockedPdf;
  for (const source of [undefined, blankPdf()]) {
    const opened = await open(source), { session } = opened;
    try {
      const add = (fieldType, name, extra = {}) => session.addObject({ kind: "field", fieldType, name, pageIndex: 0,
        x: 20, y: 450 - session.getObjects().length * 24, width: 120, height: 20, value: "a", ...extra });
      const ids = [add("text", "Text", { multiline: true, required: true }), add("number", "Number", { value: "12" }),
        add("date", "Date", { value: "2026-11-06" }), add("email", "Email"), add("tel", "Telephone"), add("url", "URL"),
        add("dropdown", "Dropdown", { options: choices }), add("list", "List", { options: choices, multiSelect: true, value: ["a"] }),
        add("checkbox", "Check", { value: true }), add("text", "ReadOnly", { readOnly: true })];
      add("radio", "Radio", { onValue: "a" }); const radio = add("radio", "Radio", { onValue: "b" });
      const grouped = add("text", "Grouped");
      const shape = session.addObject({ kind: "shape", shape: "rectangle", pageIndex: 0, x: 200, y: 200, width: 20, height: 20 });
      session.select([grouped, shape]); const group = session.groupSelection();
      add("text", "Unlocked"); session.setObjectsLocked([...ids, radio, group], true);
      assert.throws(() => session.setFieldValue("Radio", "b"), /locked/);
      lockedPdf = await save(session);
      await inspect(lockedPdf, async (document, named) => {
        for (const name of ["Text", "Number", "Date", "Email", "Telephone", "URL", "Dropdown", "List", "Check", "Radio", "ReadOnly", "Grouped"])
          assert(named(name).every(widget => widget.widget.fieldFlags & 1), `${name}: editor locks become standard field ReadOnly`);
        assert.equal(named("Unlocked")[0].widget.fieldFlags & 1, 0);
        assert(named("Text")[0].widget.fieldFlags & 2); assert(named("Text")[0].widget.fieldFlags & 4096);
        assert(named("Dropdown")[0].widget.fieldFlags & 131072); assert(named("List")[0].widget.fieldFlags & 2097152);
        const owner = await document.resolveDictionary(named("Text")[0].dictionary.get("Parent"));
        assert.equal(owner.get("HEPRLockReadOnly"), true);
        const originalReadOnly = await document.resolveDictionary(named("ReadOnly")[0].dictionary.get("Parent"));
        assert.equal(originalReadOnly.has("HEPRLockReadOnly"), false, "explicit ReadOnly is independent of the editing lock");
        assert.equal(named("Radio")[0].flags & 128, 0); assert(named("Radio")[1].flags & 128, "a later radio member locks the shared owner");
      });
      session.setObjectsLocked([...ids, radio, group], false);
      const unlocked = await save(session);
      await inspect(unlocked, async (_document, named) => {
        assert.equal(named("Text")[0].widget.fieldFlags & 1, 0);
        assert.equal(named("Radio")[0].widget.fieldFlags & 1, 0);
        assert(named("ReadOnly")[0].widget.fieldFlags & 1);
      });
    } finally { await opened.close(); }
  }
  const reopened = await open(lockedPdf);
  try {
    const { session } = reopened;
    assert.throws(() => session.setFieldValue("Text", "b"), /locked/);
    assert.throws(() => session.setFieldValue("Radio", "b"), /locked/, "an unlocked peer cannot change a locked shared field value");
    const ids = session.sourceScene.annotations.filter(annotation => annotation.subtype === "Widget").map(annotation => `annotation:${annotation.id}`);
    session.setObjectsLocked(ids, false);
    session.setFieldValue("Text", "b"); session.setFieldValue("Dropdown", "b"); session.setFieldValue("Radio", "b");
    assert.throws(() => session.setFieldValue("ReadOnly", "b"), /read-only/);
    const updated = await save(session);
    await inspect(updated, async (document, named) => {
      for (const name of ["Text", "Dropdown", "Radio"]) assert(named(name).every(widget => !(widget.widget.fieldFlags & 1)), `${name}: reopening and unlocking restores fillability`);
      assert.equal(decodePdfString(named("Text")[0].widget.value, 0, 0), "b");
      assert.equal(named("Radio")[1].widget.value.value, "b"); assert(named("ReadOnly")[0].widget.fieldFlags & 1);
      const owner = await document.resolveDictionary(named("Text")[0].dictionary.get("Parent")); assert(!owner.has("HEPRLockReadOnly"));
    });
    await inspect(lockedPdf, async document => {
      await assert.rejects(applyEditorPdfFields(new NativePdfWriter(document), new Map([["Text", "b"]]), reopened.services.fonts), /read-only/,
        "generic field writers continue honoring the actual PDF ReadOnly flag");
      await assert.rejects(applyEditorPdfFields(new NativePdfWriter(document), new Map([["ReadOnly", "b"]]), reopened.services.fonts,
        { allowEditorLockReadOnly: true }), /read-only/);
    });
  } finally { await reopened.close(); }

  // Source widgets sharing inherited field flags, values, and direct catalog objects.
  for (const directAcro of [false, true]) {
    const original = inheritedPdf(directAcro), opened = await open(original);
    try {
      const { session } = opened, annotation = name => session.sourceScene.annotations.find(annotation => annotation.field?.name === name);
      session.setFieldValue("Shared", "B"); session.setFieldValue("Direct", "B");
      const lockIds = ["Hierarchy.Text", "Shared", "Direct"].map(name => `annotation:${annotation(name).id}`);
      session.setObjectsLocked(lockIds, true);
      assert.throws(() => session.setFieldValue("Shared", "A"), /locked/);
      const saved = await save(session);
      assert.deepEqual(original, inheritedPdf(directAcro), "export preserves caller-owned source bytes");
      await inspect(saved, async (_document, named) => {
        assert(named("Hierarchy.Text")[0].widget.fieldFlags & 1); assert(named("Hierarchy.Text")[0].widget.fieldFlags & 4096);
        assert(named("Hierarchy.Text")[0].widget.fieldFlags & 2);
        assert.equal(named("Hierarchy.Text")[0].flags, 132, "locking preserves indirect annotation Print flags");
        assert.equal(named("Hierarchy.Sibling")[0].widget.fieldFlags & 1, 0, "a terminal field lock does not lock unrelated siblings");
        assert(named("Shared").every(widget => widget.widget.fieldFlags & 1));
        assert.deepEqual(named("Shared").map(widget => widget.flags), [132, 4], "shared-field export preserves unrelated indirect annotation flags");
        assert(named("Shared").every(widget => decodePdfString(widget.widget.value, 0, 0) === "B"), "a value filled before locking survives export");
        assert(named("Direct")[0].widget.fieldFlags & 1);
        assert.equal(decodePdfString(named("Direct")[0].widget.value, 0, 0), "B", "locking a direct widget preserves its pending value");
      });
      session.setObjectsLocked(lockIds, false);
      session.undo(); assert.throws(() => session.setFieldValue("Shared", "A"), /locked/); session.redo();
      const savedUnlocked = await save(session);
      await inspect(savedUnlocked, async (_document, named) => {
        assert.equal(named("Hierarchy.Text")[0].widget.fieldFlags & 1, 0);
        assert.equal(named("Hierarchy.Text")[0].flags, 4);
        assert(named("Shared").every(widget => !(widget.widget.fieldFlags & 1)));
      });
    } finally { await opened.close(); }
  }
  console.log("Editor field locks: standard ReadOnly, authored/source/shared/radio/group locks, inherited flags, reopen/unlock/refill, original ReadOnly, values and undo passed.");
} finally { hooks.deregister(); }

function blankPdf() {
  return writeTinyPdf({ objects: ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << >> /Contents 4 0 R >>", tinyPdfStream("", "")]
    .map((body, index) => ({ number: index + 1, body })) });
}
function inheritedPdf(directAcro) {
  const appearance = "/AP << /N 6 0 R >>", acro = "<< /Fields 18 0 R /DA (/F 10 Tf 0 g) /DR << /Font << /F 5 0 R >> >> >>";
  const direct = `<< /Subtype /Widget /FT /Tx /T (Direct) /V (A) /Rect [20 240 120 260] ${appearance} >>`;
  return writeTinyPdf({ objects: [
    `<< /Type /Catalog /Pages 2 0 R /AcroForm ${directAcro ? acro : "17 0 R"} >>`,
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F 5 0 R >> >> /Contents 4 0 R /Annots [9 0 R 12 0 R 15 0 R 16 0 R ${direct}] >>`,
    tinyPdfStream("", ""), "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    tinyPdfStream("/Type /XObject /Subtype /Form /BBox [0 0 100 20] /Resources << /Font << /F 5 0 R >> >>", "BT /F 10 Tf 2 4 Td (A) Tj ET"),
    "<< /T (Hierarchy) /Ff 4098 /Kids [8 0 R 11 0 R] >>",
    "<< /T (Text) /FT /Tx /Parent 7 0 R /Kids [9 0 R] /V (A) >>",
    `<< /Subtype /Widget /Parent 8 0 R /F 19 0 R /Rect [20 400 120 420] ${appearance} >>`,
    "null", "<< /T (Sibling) /FT /Tx /Parent 7 0 R /Kids [12 0 R] /V (A) >>",
    `<< /Subtype /Widget /Parent 11 0 R /Rect [20 360 120 380] ${appearance} >>`,
    "null", "<< /T (Shared) /FT /Tx /Ff 2 /Kids [15 0 R 16 0 R] /V (A) >>",
    `<< /Subtype /Widget /Parent 14 0 R /F 19 0 R /Rect [20 320 120 340] ${appearance} >>`,
    `<< /Subtype /Widget /Parent 14 0 R /F 19 0 R /Rect [20 280 120 300] ${appearance} >>`, acro, "[7 0 R 14 0 R]", "4"
  ].map((body, index) => ({ number: index + 1, body })) });
}
