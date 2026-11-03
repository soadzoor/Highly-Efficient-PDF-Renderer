import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { editorUiTestContext } from "./lib/editorUiTestContext.mjs";
const hooks = registerHooks({ resolve(s, c, n) { return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c); } });
try {
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { setEditorPaintIdentity, retainEditorPaintIdentity, editorAuthoredOwner } = await import("../src/editorPaintIdentity.ts");
  const styles = await import("../src/editorTextStyles.ts");
  const scene = buildStrokeScene([{ points: [[0, 0], [100, 100]], width: 1 }]);
  const session = createEditorSession(scene);
  try {
    const id = session.addObject({ kind: "text", pageIndex: 0, x: 10, y: 10, width: 80, height: 12, text: "ABCDE", fontSize: 12,
      runs: [{ text: "AB", color: "red", underline: true }, { text: "CDE", fontStyle: "italic", color: "blue" }] });
    // A presented textbox's glyphs have an authored owner even when its indexes
    // differ from the source scene. This exercises the actual provenance API.
    const presented = { ...scene, textIndex: { version: 2, pages: [{ text: "ABCDE", charInstance: Int32Array.of(0, 1, 2, 3, 4) }] } };
    setEditorPaintIdentity(presented, editorAuthoredOwner(id));
    const spans = [{ pageIndex: 0, start: 1, length: 3 }];
    session.select([id]); assert.deepEqual(styles.editorSelectedSourceTextSpans(session, presented), [], "authored text remains on its own style-property path");
    assert.deepEqual(styles.editorSelectedTextStyleState(session, presented, spans, "underline"), { supported: 2, value: false, mixed: true });
    assert.deepEqual(styles.editorSourceTextSpans(session, presented, spans), []);
    const before = session.revision;
    styles.setEditorSelectedTextStyle(session, presented, spans, "underline", false);
    assert.equal(session.revision, before + 1);
    assert.deepEqual(session.getObject(id).runs.map(run => [run.text, run.underline, run.color]), [["A", true, "red"], ["B", false, "red"], ["CD", false, "blue"], ["E", undefined, "blue"]]);
    session.undo(); assert.equal(session.getObject(id).runs.length, 2);
    for (const name of ["bold", "italic", "underline", "strikethrough"]) {
      styles.setEditorSelectedTextStyle(session, presented, spans, name, true);
      assert.equal(styles.editorSelectedTextStyleState(session, presented, spans, name).value, true);
      styles.setEditorSelectedTextStyle(session, presented, spans, name, false);
      const state = styles.editorSelectedTextStyleState(session, presented, spans, name); assert.equal(state.value, false); assert.equal(state.mixed, false);
    }
    assert.equal(session.getObject(id).runs[0].underline, true, "unselected formatting is retained");
    session.setObjectsLocked([id], true); const locked = session.revision;
    styles.setEditorSelectedTextStyle(session, presented, spans, "bold", true); assert.equal(session.revision, locked);
    assert.equal(styles.editorSelectedTextStyleState(session, presented, spans, "bold").supported, 0);
    session.setObjectsLocked([id], false);
    const buttons = new Map(["bold", "italic", "underline", "strikethrough"].map(name => [name, { disabled: false, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }]));
    const source = (await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8")).replace(/^ {2}/gm, "");
    let selected = { scene: presented, spans, text: "BCD" }, changes = 0;
    const context = editorUiTestContext({ ...styles, session, activeText: null, tool: "select-text",
      review: { getTextSelection: () => selected }, query: selector => buttons.get(selector.match(/data-style="([^"]+)"/)[1]),
      commit: fn => { changes++; fn(); }, updateAppearanceControls() {}, property: () => ({ value: "#111111" }), report(error) { throw error; } });
    for (const name of ["selectedTextStyleState", "applyTextStyle"]) vm.runInContext(sourceFunction(source, name), context);
    context.applyTextStyle("bold"); assert.equal(context.selectedTextStyleState("bold").value, true);
    context.applyTextStyle("bold"); assert.equal(context.selectedTextStyleState("bold").value, false); assert.equal(changes, 2);
    selected = null; context.applyTextStyle("bold"); assert.equal(changes, 2, "no selection cannot enable a persistent formatting mode");
    assert(!source.includes('editorIconButton("tool", "underline-text"')); assert(!source.includes('editorIconButton("tool", "strikeout-text"'));
    console.log("Selected text styles: partial runs, mixed state, all four toggles, undo, locks, presented ownership and toolbar routing passed.");
  } finally { session.dispose(); }
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const services = await createEditorAppServices();
  try {
    for (const text of ["First\nSecond", "First\r\nSecond", "First\n\nSecond", "  First\t  Second  "]) {
      const editor = createEditorSession(scene, services.sessionOptions);
      try {
        const id = editor.addObject({ kind: "text", pageIndex: 0, x: 5, y: 5, width: 90, height: 90, text, fontSize: 10, color: "red" });
        const presented = await editor.getScene({ preview: false }), page = presented.textIndex.pages[0], indexedStart = page.text.indexOf("Second"), sourceStart = text.indexOf("Second");
        assert(indexedStart >= 0, "the real textbox compiler emits searchable second-line text");
        const spans = [{ pageIndex: 0, start: indexedStart, length: 3 }];
        for (const style of ["bold", "italic", "underline", "strikethrough"]) {
          assert.equal(styles.editorSelectedTextStyleState(editor, presented, spans, style).supported, 1, `multiline and collapsed whitespace retain a ${style} formatting target`);
          styles.setEditorSelectedTextStyle(editor, presented, spans, style, true);
          const object = editor.getObject(id), key = style === "bold" ? "fontWeight" : style === "italic" ? "fontStyle" : style;
          assert.equal(object.text, text, "formatting retains exact newlines, tabs and repeated spaces");
          assert.equal(object.runs.map(run => run.text).join(""), text);
          let offset = 0;
          for (const run of object.runs) {
            if (offset >= sourceStart && offset < sourceStart + 3) assert(run[key], "only selected original offsets receive formatting");
            else assert(!run[key] || run[key] === "normal", "unselected text retains its formatting");
            offset += run.text.length;
          }
          assert.equal(styles.editorSelectedTextStyleState(editor, presented, spans, style).value, true);
          styles.setEditorSelectedTextStyle(editor, presented, spans, style, false);
          assert.deepEqual(styles.editorSelectedTextStyleState(editor, presented, spans, style), { supported: 1, value: false, mixed: false });
        }
        const unknown = { ...presented, textIndex: { version: 2, pages: [{ ...page, text: "x".repeat(page.text.length) }] } };
        setEditorPaintIdentity(unknown, editorAuthoredOwner(id)); const unchanged = editor.revision;
        styles.setEditorSelectedTextStyle(editor, unknown, spans, "bold", true);
        assert.equal(editor.revision, unchanged, "unrecognized searchable text never guesses author offsets");
      } finally { editor.dispose(); }
    }
    console.log("Real compiled textbox styling retains multiline, CRLF and collapsed-whitespace offsets for all four toggles.");
    const author = createEditorSession(scene, services.sessionOptions);
    try {
      author.addObject({ kind: "text", pageIndex: 0, x: 5, y: 5, width: 90, height: 30, text: "ABCDE", fontSize: 10 });
      const canonical = await author.getScene({ preview: false });
      setEditorPaintIdentity(canonical, "annotation:shared-glyph-owner");
      const sourceEditor = createEditorSession(canonical);
      try {
        sourceEditor.select(["source:text:0"]); sourceEditor.deleteSelection();
        const compacted = await sourceEditor.getScene({ preview: false }), page = compacted.textIndex.pages[0], start = page.text.indexOf("B");
        assert.equal(page.charInstance[start], 0, "the selected original glyph now has a different presented index");
        const spans = [{ pageIndex: 0, start, length: 1 }];
        styles.setEditorSelectedTextStyle(sourceEditor, compacted, spans, "bold", true);
        assert.equal(sourceEditor.getObject("source:text:1").fontWeight, "bold", "annotation ownership still targets the precise canonical source glyph");
        assert.equal(sourceEditor.getObject("source:text:2").fontWeight, "normal");
        assert.deepEqual(styles.editorSourceTextSpans(sourceEditor, compacted, spans), spans);
        sourceEditor.select(["source:text:1", "source:text:2"]);
        const both = [{ pageIndex: 0, start, length: page.text.indexOf("C") + 1 - start }];
        assert.deepEqual(styles.editorSelectedSourceTextSpans(sourceEditor, compacted), both, "normal object selection maps compacted glyph indexes to source spans");
        sourceEditor.transformSelection([1, 0, 0, 1, 4, 3]);
        const transformed = await sourceEditor.getScene({ preview: false });
        assert.deepEqual(styles.editorSelectedSourceTextSpans(sourceEditor, transformed), both, "transforms and synthetic bold strokes retain source selection ownership");
        assert.deepEqual(styles.editorSelectedSourceTextSpans(sourceEditor, transformed, ["source:text:1", "source:text:3"]),
          [{ pageIndex: 0, start, length: 1 }, { pageIndex: 0, start: page.text.indexOf("D"), length: 1 }], "unselected indexed glyphs split selection spans");
        const transformedPage = transformed.textIndex.pages[0], separated = { ...transformed, textIndex: { version: 2, pages: [{ text: " B  C ", charInstance: Int32Array.of(-1, transformedPage.charInstance[start], -1, -1, transformedPage.charInstance[page.text.indexOf("C")], -1) }] } };
        retainEditorPaintIdentity(transformed, separated);
        assert.deepEqual(styles.editorSelectedSourceTextSpans(sourceEditor, separated), [{ pageIndex: 0, start: 1, length: 4 }], "inferred internal whitespace connects selected glyphs while outer whitespace is excluded");
        const group = sourceEditor.groupSelection(); assert(group);
        assert.deepEqual(styles.editorSelectedSourceTextSpans(sourceEditor, transformed), both, "source glyph groups resolve their selected leaves");
        sourceEditor.setObjectsLocked([group], true);
        assert.deepEqual(styles.editorSelectedSourceTextSpans(sourceEditor, transformed), [], "locked groups cannot acquire review formatting");
        sourceEditor.setObjectsLocked([group], false);
        const layer = sourceEditor.createLayer({ name: "Selected glyphs" }); sourceEditor.assignObjectsToLayer([group], layer);
        sourceEditor.updateLayer(layer, { defaultVisible: false });
        assert.deepEqual(styles.editorSelectedSourceTextSpans(sourceEditor, transformed), [], "hidden source layers cannot acquire review formatting from stale presented geometry");
        sourceEditor.updateLayer(layer, { defaultVisible: true });
        sourceEditor.select(["source:stroke:0"]);
        assert.deepEqual(styles.editorSelectedSourceTextSpans(sourceEditor, transformed), [], "non-text source selections do not enable text decorations");
        sourceEditor.select(["source:text:2"]); const [clone] = sourceEditor.cloneSelection([0, -15]);
        const copied = await sourceEditor.getScene({ preview: false }), copiedSpans = styles.editorSelectedSourceTextSpans(sourceEditor, copied);
        assert(copiedSpans.length > 0);
        assert.equal(copiedSpans.map(span => copied.textIndex.pages[span.pageIndex].text.slice(span.start, span.start + span.length)).join(""), "C", "source-copy selection resolves only the copied glyph, not its original");
        assert.deepEqual(styles.editorSelectedSourceTextSpans(sourceEditor, copied, ["source:text:2"]), [{ pageIndex: 0, start: copied.textIndex.pages[0].text.indexOf("C"), length: 1 }], "original source selections do not also decorate their copies");
        sourceEditor.setObjectsLocked([clone], true);
        assert.deepEqual(styles.editorSelectedSourceTextSpans(sourceEditor, copied), [], "locked source copies are not formatting targets");
        sourceEditor.setObjectsLocked(["source:text:1"], true);
        assert.deepEqual(styles.editorSourceTextSpans(sourceEditor, compacted, spans), [], "locked source glyphs cannot acquire review formatting");
      } finally { sourceEditor.dispose(); }
    } finally { author.dispose(); }
  } finally { services.dispose(); }
} finally { hooks.deregister(); }
