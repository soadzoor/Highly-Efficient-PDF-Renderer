import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import vm from "node:vm";
import { tinyPdfStream, writeTinyPdf } from "./lib/tinyPdfWriter.mjs";
import { editorUiTestContext } from "./lib/editorUiTestContext.mjs";
import { sourceFunction } from "./lib/sourceFunction.mjs";
const hooks = registerHooks({ resolve(s, c, n) { return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c); } });
try {
  const { openPdf } = await import("../src/pdfSession.ts");
  const { nativeVectorMissingFontResolver } = await import("../src/pdfVectorExtractor.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { openEditorSession } = await import("../src/editorSession.ts");
  const { createEditorPropertyControls } = await import("../src/editorPropertyControls.ts");
  const properties = await import("../src/editorProperties.ts"), styles = await import("../src/editorTextStyles.ts"), review = await import("../src/editorReview.ts");
  const supplied = process.argv[2];
  const bytes = supplied ? new Uint8Array(await readFile(supplied)) : writeTinyPdf({ objects: [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    tinyPdfStream("", "BT /F1 16 Tf 1 0 0 1 20 130 Tm (Selected source text) Tj 0 -24 Td (Other text) Tj ET 1 w 10 10 m 200 10 l S")
  ].map((body, index) => ({ number: index + 1, body })) });
  const parser = await openPdf({ kind: "bytes", bytes }, { missingFontResolver: await nativeVectorMissingFontResolver() });
  let scene;
  try { scene = await parser.compileVectorPage(0, { optimization: "none", preserveDrawingOrder: true }); } finally { await parser.close(); }
  const services = await createEditorAppServices({ sourcePdf: bytes });
  const session = await openEditorSession(scene, { ...services.sessionOptions, sourcePdf: bytes });
  try {
    const page = scene.textIndex.pages[0], refs = [];
    for (let index = 0; index < page.text.length && refs.length < 12; index++) if (page.charInstance[index] >= 0) refs.push({ kind: "text", index: page.charInstance[index] });
    assert(refs.length > 1); session.selectPrimitives(refs);
    const selection = [...session.getSelection()], sourceSpans = styles.editorSelectedSourceTextSpans(session, scene);
    assert(sourceSpans.length > 0);
    class Control {
      value = ""; checked = false; disabled = false; dataset = {}; attributes = new Map(); children = []; placeholder = "";
      constructor(tagName = "INPUT") { this.tagName = tagName; this.ownerDocument = { createElement: tag => new Control(tag.toUpperCase()) }; }
      setAttribute(name, value) { this.attributes.set(name, value); }
      getAttribute(name) { return this.attributes.get(name); }
      removeAttribute(name) { this.attributes.delete(name); }
      querySelector() { return this.children.find(child => child.dataset.mixed); }
      prepend(child) { child.parent = this; this.children.unshift(child); }
      remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
    }
    const inputs = new Map(["color", "stroke", "fill", "font", "font-size", "align", "fill-enabled"].map(name => [name, new Control(["font", "align"].includes(name) ? "SELECT" : "INPUT")]));
    inputs.get("color").value = "#111111";
    const buttons = new Map(["bold", "italic", "underline", "strikethrough", "highlight"].map(name => [name, new Control("BUTTON")]));
    const appearanceControls = createEditorPropertyControls({ session, control: name => inputs.get(name), style: name => buttons.get(name), focused: () => null, note: new Control("SPAN") });
    const context = editorUiTestContext({ ...properties, ...styles, ...review, session, latestScene: scene, activeText: null, tool: "select", appearanceControls, objectOpacity: 1,
      query: selector => buttons.get(selector.match(/data-style="([^"]+)"/)[1]), property: name => inputs.get(name),
      styleEnabled: name => buttons.get(name).getAttribute("aria-pressed") === "true", commit: change => change() });
    const source = (await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8")).replace(/^ {2}/gm, "");
    for (const name of ["selectedObjectTextDecorationState", "updateAppearanceControls", "applyTextStyle"]) vm.runInContext(sourceFunction(source, name), context);
    context.updateAppearanceControls();
    assert(!buttons.get("bold").disabled && !buttons.get("italic").disabled);
    for (const name of ["underline", "strikethrough", "highlight"]) {
      const button = buttons.get(name); assert.equal(button.disabled, false, `${name} is enabled for normal Select source text`);
      const before = session.revision; context.applyTextStyle(name);
      assert.equal(session.revision, before + 1); assert.equal(button.getAttribute("aria-pressed"), "true");
      assert.deepEqual(session.getSelection(), selection, "formatting retains the selected source objects");
      context.latestScene = await session.getScene({ preview: false }); context.updateAppearanceControls();
      context.applyTextStyle(name); assert.equal(button.getAttribute("aria-pressed"), "false");
      assert.deepEqual(session.getSelection(), selection); session.undo(); context.updateAppearanceControls();
      assert.equal(button.getAttribute("aria-pressed"), "true", "one Undo restores the decoration");
      session.redo(); context.updateAppearanceControls(); assert.equal(button.getAttribute("aria-pressed"), "false");
    }
    const text = session.addObject({ kind: "text", pageIndex: 0, x: 20, y: 20, width: 60, height: 12, text: "Added", fontSize: 10, color: "red" });
    for (const name of ["underline", "highlight"]) {
      const key = name === "highlight" ? "backgroundColor" : name, button = buttons.get(name);
      session.select(selection); context.applyTextStyle(name);
      session.select([...selection, text]); context.updateAppearanceControls();
      assert.equal(button.getAttribute("aria-pressed"), "mixed");
      context.applyTextStyle(name); assert(session.getObject(text)[key]); assert.equal(button.getAttribute("aria-pressed"), "true");
      const revision = session.revision; context.applyTextStyle(name); assert.equal(session.revision, revision + 1, "mixed authored/source removal is one transaction");
      assert(!session.getObject(text)[key]); session.undo(); context.updateAppearanceControls();
      assert(session.getObject(text)[key]); assert.equal(button.getAttribute("aria-pressed"), "true");
      session.redo(); context.updateAppearanceControls();
    }
    session.select(selection); session.setObjectsLocked(selection, true); context.updateAppearanceControls();
    assert(buttons.get("underline").disabled && buttons.get("strikethrough").disabled);
    const locked = session.revision; context.applyTextStyle("underline"); assert.equal(session.revision, locked);
    session.setObjectsLocked(selection, false);
    const layer = session.createLayer({ name: "Hidden selected text" }); session.assignObjectsToLayer(selection, layer); session.updateLayer(layer, { defaultVisible: false }); context.updateAppearanceControls();
    assert.deepEqual(styles.editorSelectedSourceTextSpans(session, context.latestScene), []);
    const hidden = session.revision; context.applyTextStyle("underline"); assert.equal(session.revision, hidden, "hidden source cannot acquire review formatting");
    console.log(`Normal Select text formatting: both decoration buttons, on/off, redraw, mixed authored/source state, selection, Undo/Redo, locks and layers passed${supplied ? " on supplied PDF" : ""}.`);
  } finally { session.dispose(); services.dispose(); }
} finally { hooks.deregister(); }
