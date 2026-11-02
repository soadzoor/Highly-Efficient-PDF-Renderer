import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { editorUiTestContext } from "./lib/editorUiTestContext.mjs";
const hooks = registerHooks({ resolve(s, c, n) { return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c); } });
try {
  const { buildStrokeScene } = await import("../src/strokeSceneBuilder.ts");
  const { createEditorSession } = await import("../src/editorSessionRuntime.ts");
  const { createEditorAppServices } = await import("../src/editorAppServices.ts");
  const { createEditorInteractionController } = await import("../src/editorInteraction.ts");
  const { createEditorFieldActivation } = await import("../src/editorFieldActivation.ts");
  const { editorBoundsClickHit } = await import("../src/editorCoordinates.ts");
  const { normalizePrimitiveColor } = await import("../src/colorInput.ts");
  const rich = await import("../src/editorRichText.ts");
  const textMetrics = await import("../src/editorTextEditingMetrics.ts");
  const { createEditorTextResizeControls } = await import("../src/editorTextResizeControls.ts");
  const { editorFrameSize, editorFrameScaleMatrix } = await import("../src/editorSelectionGeometry.ts");
  const { layoutEditorText } = await import("../src/editorText.ts");
  const source = (await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8")).replace(/^ {2}/gm, "");
  const css = await readFile(new URL("../src/editorUi.css", import.meta.url), "utf8");
  const textRule = css.match(/\.hepr-editor-text-input\s*\{([^}]*)\}/)?.[1]; assert(textRule);
  const textDeclarations = Object.fromEntries([...textRule.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g)].map(([, name, value]) => [name, value.trim()]));
  function computedWrapping(element) {
    const result = element.parentElement ? computedWrapping(element.parentElement) : { whiteSpace: "normal", overflowWrap: "normal", webkitLineBreak: "auto" };
    // Chromium's contenteditable presentation attributes set these inherited
    // wrapping values only while editable. Author CSS must survive their removal.
    if (element.contentEditable === "true") Object.assign(result, { overflowWrap: "break-word", webkitLineBreak: "after-white-space" });
    for (const [cssName, styleName] of [["white-space", "whiteSpace"], ["overflow-wrap", "overflowWrap"], ["-webkit-line-break", "webkitLineBreak"]]) {
      if (element.className?.split(" ").includes("hepr-editor-text-input") && textDeclarations[cssName]) result[styleName] = textDeclarations[cssName];
      if (element.style[styleName] || element.style[cssName]) result[styleName] = element.style[styleName] || element.style[cssName];
    }
    return result;
  }
  const scene = buildStrokeScene([]); scene.pageCount = 1; scene.pageRects = Float32Array.of(0, 0, 500, 500); scene.pageTextRanges = new Uint32Array(2);
  const services = await createEditorAppServices(), font = await services.fonts.loadBundled(), session = createEditorSession(scene, services.sessionOptions);
  const interaction = createEditorInteractionController(session), errors = [], controls = new Map(), tick = () => new Promise(resolve => setImmediate(resolve));
  const document = { activeElement: null, createElement: tag => new Element(tag), execCommand() {} };
  class Element extends EventTarget {
    nodeType = 1; childNodes = []; attributes = new Map(); dataset = {}; style = {}; value = ""; hidden = false; scrollHeight = 50;
    constructor(tag = "div") { super(); this.tagName = tag.toUpperCase(); this.ownerDocument = document; }
    set textContent(value) { this.childNodes = value ? [{ nodeType: 3, textContent: value, parentElement: this }] : []; }
    get textContent() { return this.childNodes.map(node => node.textContent).join(""); }
    get innerText() { return this.textContent; }
    get innerHTML() { return JSON.stringify(this.childNodes.map(node => [node.textContent, node.style])); }
    append(...children) { for (const child of children) { child.parentElement = this; this.childNodes.push(child); } }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    closest(selector) { return selector.split(",").some(value => value === this.tagName.toLowerCase() || value.startsWith(".") && this.className === value.slice(1)) ? this : this.parentElement?.closest(selector) ?? null; }
    contains(node) { return node === this || this.childNodes.some(child => child === node || child.contains?.(node)); }
    focus() { document.activeElement = this; }
    remove() { if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter(node => node !== this); }
    setPointerCapture() {} hasPointerCapture() { return false; } releasePointerCapture() {}
  }
  const control = key => { if (!controls.has(key)) controls.set(key, new Element("button")); return controls.get(key); };
  const property = name => { const value = control(`prop:${name}`); value.value ||= name === "font" ? font.id : name === "font-size" ? "12" : name === "align" ? "left" : "#111111"; return value; };
  const overlay = new Element(), toolButtons = ["select", "text"].map(tool => { const button = new Element("button"); button.dataset.tool = tool; return button; });
  overlay.dataset = {}; overlay.style = {};
  let acknowledgeTextPaints = true;
  const context = editorUiTestContext({ ...rich, ...textMetrics, createEditorTextResizeControls, editorFrameSize, editorFrameScaleMatrix, session, interaction, editorServices: services, source: {}, active: true, activeText: null,
    tool: "text", toolRequest: 0, textRequest: 0, pointer: null, pendingPick: null, pendingFieldFocus: null, picking: null, picker: null, polygon: null,
    fieldActivation: createEditorFieldActivation(), textActivation: createEditorFieldActivation(), activeLayer: null, drawingDefaults: null,
    draftLayerRevision: -1, draftLayers: new Map(),
    IDENTITY: [1, 0, 0, 1, 0, 0], objectOpacity: 1, fillOpacity: 1, presented: null, currentState: session.getState(), latestScene: scene,
    host: { clientToScenePoint: (x, y) => ({ x, y }), sceneToClientPoint: (x, y) => ({ x, y }) }, overlay, fields: { hidden: true },
    document, window: { getComputedStyle(element) { return { fontFamily: `"${font.id}"`, fontSize: "12px", fontWeight: "400", fontStyle: "normal", color: "#111111", textDecorationLine: "none", ...computedWrapping(element), ...element.style }; } },
    toolbar: { querySelectorAll: () => toolButtons }, contextMenu: { close() {} }, editorBoundsClickHit,
    property, query: selector => { const style = /data-style="([^"]+)"/.exec(selector); return style ? control(`style:${style[1]}`) : /data-prop="([^"]+)"/.test(selector) ? property(/data-prop="([^"]+)"/.exec(selector)[1]) : control(selector); },
    selectedFont: async () => font, activateFont: async () => {}, updateFonts() {}, updateGeometry() {}, updateOpacityControls() {}, syncOpacityControls() {},
    clearPreview() { interaction.cancelTransform(); }, updatePointerCursor() {}, isSceneSettling: () => false, inputTarget: () => false,
    fieldAtClientPoint: () => null, pageLocal: point => [point.x, point.y], styleEnabled: name => control(`style:${name}`).getAttribute("aria-pressed") === "true",
    normalizePrimitiveColor, commit(change) { try { change(); if (acknowledgeTextPaints) context.releaseTextPaints({ sourceScene: session.sourceScene, revision: session.revision }); } catch (error) { errors.push(error); } }, report: error => errors.push(error)
  });
  for (const name of ["colorCss", "pageAt", "textDraftBounds", "canResizeTextDraft", "textClientToLocal", "updateTextVisibility", "updateTextGeometry", "updateTransformControls", "transformProperty", "changeTransform", "cancelPointerGesture", "setTool", "canActivateField", "editableTextObject", "selectedEditableText", "updateTextEditButton", "canActivateText", "textAtClientPoint", "openTextEditor", "editTextObject", "startText", "releaseTextPaints", "cancelText", "finishText", "readTextDraft", "updateShapeGesture", "pointerDown", "pointerMove", "pointerUp", "forwardWheel", "doubleClick", "keydown"])
    vm.runInContext(sourceFunction(source, name), context);
  context.pick = async point => context.textAtClientPoint(point);
  const event = (timeStamp, x = 40, y = 80, target = new Element()) => ({ target, timeStamp, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true,
    clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} });
  const dispatch = (target, type, x, y) => {
    const pointer = new Event(type, { cancelable: true }); Object.assign(pointer, { button: 0, pointerId: 1, isPrimary: true, clientX: x, clientY: y });
    target.dispatchEvent(pointer); return pointer;
  };
  try {
    await context.pointerDown(event(0, 30, 100)); assert(context.activeText);
    assert.equal(context.activeText.element.style.fontFamily, `"${textMetrics.editorTextEditingFamily(font.id)}"`, "draft text uses the committed baseline metrics");
    context.activeText.element.textContent = "Original textbox";
    {
      const draft = context.activeText, html = draft.element.innerHTML, revision = session.revision, forwarded = [];
      const selection = { anchorNode: draft.element.childNodes[0], anchorOffset: 3, focusNode: draft.element.childNodes[0], focusOffset: 7 };
      context.window.getSelection = () => selection;
      const project = context.host.sceneToClientPoint;
      context.WheelEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
      context.host.getCanvas = () => ({ dispatchEvent(wheel) {
        forwarded.push(wheel);
        context.host.sceneToClientPoint = (x, y) => ({ x: 2 * x, y: 2 * y });
        context.updateTextGeometry({ left: 0, top: 0 });
      } });
      const input = { target: draft.element, clientX: 50, clientY: 90, deltaX: 0, deltaY: -100, deltaZ: 0, deltaMode: 0, ctrlKey: true, metaKey: false, shiftKey: false,
        preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
      context.forwardWheel(input);
      assert.equal(forwarded.length, 1); assert(input.prevented && input.stopped, "textbox wheel zoom suppresses browser scrolling and forwards to the document");
      assert.equal(context.activeText, draft); assert.equal(draft.element.innerHTML, html); assert.equal(document.activeElement, draft.element);
      assert.equal(context.window.getSelection(), selection); assert.equal(selection.anchorOffset, 3); assert.equal(selection.focusOffset, 7);
      assert.equal(session.revision, revision, "zoom does not apply the draft or create document history");
      assert.equal(draft.element.style.transform, "matrix(2,0,0,-2,0,0)"); assert.equal(draft.element.style.fontSize, "12px");
      const chrome = overlay.childNodes.find(node => node.className === "hepr-editor-text-resize-controls");
      assert(!chrome.hidden); assert.equal(chrome.childNodes.find(node => node.dataset.textResize === "e").style.left, "500px", "the same resize handles follow the zoomed document");
      context.host.sceneToClientPoint = project; context.updateTextGeometry({ left: 0, top: 0 });
      delete context.window.getSelection;
    }
    await context.pointerDown(event(20, 40, 80, context.activeText.element)); assert.equal(session.getObjects().length, 0, "draft clicks never commit the active textbox");
    await context.pointerDown(event(40, 400, 400)); assert.equal(context.activeText, null); assert.equal(context.tool, "select");
    const id = session.getSelection()[0]; assert.equal(session.getObject(id).text, "Original textbox");
    assert.equal(session.getObject(id).fontId, font.id);
    assert(session.getObject(id).runs.every(run => run.fontId === font.id && run.fontFamily === font.family), "editing aliases never replace the stored font identity");
    context.updateTextEditButton(); assert.equal(control('[data-action="edit-text"]').disabled, false);
    // Two releases over different SVG targets must reopen without a native dblclick.
    await context.pointerDown(event(100)); context.pointerUp(event(140));
    const replacement = new Element("polygon"); replacement.setAttribute("data-selection-move", "true");
    await context.pointerDown(event(220, 40, 80, replacement)); context.pointerUp(event(260, 40, 80, new Element())); await tick();
    assert.equal(context.activeText?.objectId, id, "pointer click pairs reopen the same author model across SVG replacement");
    assert.equal(context.activeText.element.textContent, "Original textbox");
    context.activeText.element.textContent = "Changed textbox"; await context.pointerDown(event(300, 400, 400));
    assert.equal(session.getObject(id).text, "Changed textbox"); assert.equal(session.getObjects().length, 1, "reediting updates the textbox rather than inserting a copy");
    session.undo(); assert.equal(session.getObject(id).text, "Original textbox"); session.redo(); assert.equal(session.getObject(id).text, "Changed textbox");
    await context.openTextEditor(); assert.equal(context.activeText.objectId, id, "the Edit text toolbar action opens the selected textbox"); context.cancelText();
    context.setTool("text"); await context.pointerDown(event(340)); assert.equal(context.activeText.objectId, id, "Text tool clicks edit existing content"); assert.equal(session.getObjects().length, 1); context.cancelText();
    context.setTool("select"); await context.doubleClick(event(380)); assert.equal(context.activeText.objectId, id, "native double-click remains available"); context.cancelText();
    session.updateObject(id, { color: 0x123456, backgroundColor: 0xffdc00, runs: undefined });
    await context.openTextEditor();
    assert.equal(context.activeText.element.childNodes[0].style.backgroundColor, "rgb(255,220,0)", "reopening numeric highlight colors preserves yellow");
    assert.equal(context.activeText.element.childNodes[0].style.color, "rgb(18,52,86)", "reopening numeric foreground colors preserves the original ink");
    await context.pointerDown(event(400, 400, 400));
    assert.equal(session.getObject(id).runs[0].backgroundColor, "#ffdc00", "committing a reopened draft retains its numeric highlight color");
    context.updateGeometry = () => context.updateTextGeometry({ left: 0, top: 0 });
    await context.openTextEditor();
    const editing = context.activeText, original = session.getObject(id), html = editing.element.innerHTML, top = editing.y + editing.height;
    const resizeChrome = overlay.childNodes.find(node => node.className === "hepr-editor-text-resize-controls");
    assert(resizeChrome && !resizeChrome.hidden); assert.equal(resizeChrome.childNodes.length, 8);
    assert(!editing.element.contains(resizeChrome), "resize handles remain outside editable content");
    const east = resizeChrome.childNodes.find(node => node.dataset.textResize === "e"), southeast = resizeChrome.childNodes.find(node => node.dataset.textResize === "se");
    const revisionBeforeResize = session.revision;
    const down = dispatch(east, "pointerdown", editing.x + editing.width, top - editing.height / 2); assert(down.defaultPrevented);
    dispatch(resizeChrome, "pointermove", editing.x + 120, top - editing.height / 2);
    assert.equal(context.activeText, editing); assert.equal(document.activeElement, editing.element, "resizing preserves the content editor's focus");
    assert.equal(editing.width, 120); assert.equal(editing.element.innerHTML, html); assert.equal(session.revision, revisionBeforeResize, "dragging changes only the pending draft");
    dispatch(resizeChrome, "pointerup", editing.x + 150, top - editing.height / 2); assert.equal(editing.width, 150, "final release coordinates determine the width");
    assert(rich.hasPendingEditorTextChanges(editing), "geometry-only changes mark the draft dirty");
    for (const key of ["Delete", "Backspace", "ArrowUp", "z"]) context.keydown({ key, ctrlKey: key === "z", target: east });
    assert.equal(session.revision, revisionBeforeResize, "keyboard focus on resize handles cannot delete, undo or nudge the committed textbox");
    dispatch(east, "pointerdown", editing.x + editing.width, top - editing.height / 2);
    dispatch(resizeChrome, "pointermove", editing.x + 180, top - editing.height / 2);
    context.keydown({ key: "Escape", target: editing.element, preventDefault() {}, stopPropagation() {} });
    assert.equal(editing.width, 150); assert.equal(context.activeText, editing, "Escape cancels the resize while retaining the content draft");
    dispatch(southeast, "pointerdown", editing.x + editing.width, editing.y);
    dispatch(resizeChrome, "pointerup", editing.x + 55, top - 18);
    assert.equal(editing.width, 55); assert.equal(editing.height, 18); assert.equal(editing.y + editing.height, top, "resizing the bottom keeps the text's top anchor fixed");
    assert.equal(editing.backdrop.style.width, `${original.width}px`, "the original appearance stays covered after narrowing the editor");
    assert.equal(editing.backdrop.style.height, `${original.height}px`);
    assert.equal(editing.element.style.height, "18px", "manual height is retained even when content overflows");
    const draft = await context.readTextDraft(); assert.equal(draft.height, 18); assert.equal(draft.fontSize, original.fontSize);
    assert.deepEqual(draft.runs, original.runs); assert.deepEqual(draft.transform, original.transform);
    const fullLayout = await layoutEditorText(original, services.fonts), narrowLayout = await layoutEditorText(draft, services.fonts);
    assert(new Set(narrowLayout.glyphs.map(glyph => glyph.y)).size > new Set(fullLayout.glyphs.map(glyph => glyph.y)).size, "narrowing changes wrapping in the actual text compiler");
    acknowledgeTextPaints = false;
    await context.pointerDown(event(450, 400, 400)); assert.equal(context.activeText, null); assert(!overlay.childNodes.includes(resizeChrome), "committing removes interactive resize chrome");
    assert(overlay.childNodes.includes(editing.element) && overlay.childNodes.includes(editing.backdrop), "outside Apply keeps resized text and original mask until its frame is drawn");
    assert.equal(editing.element.contentEditable, "false"); assert.equal(editing.element.style.pointerEvents, "none");
    assert.equal(editing.element.style.width, "55px"); assert.equal(context.pendingTextPaints.size, 1);
    const committedRevision = session.revision; await context.finishText(); assert.equal(session.revision, committedRevision, "pending visuals cannot commit the same text twice");
    context.releaseTextPaints({ sourceScene: session.sourceScene, revision: committedRevision - 1 });
    assert(overlay.childNodes.includes(editing.backdrop), "an older acknowledged frame cannot reveal the old textbox size");
    context.releaseTextPaints({ sourceScene: session.sourceScene, revision: committedRevision }); acknowledgeTextPaints = true;
    assert(!overlay.childNodes.includes(editing.element) && !overlay.childNodes.includes(editing.backdrop), "the matching drawn frame removes the retained text and original mask together");
    assert.equal(session.getObject(id).width, 55); assert.equal(session.getObject(id).height, 18); assert.equal(session.getObject(id).fontSize, original.fontSize);
    session.undo(); assert.equal(session.getObject(id).width, original.width); session.redo(); assert.equal(session.getObject(id).width, 55);
    await context.openTextEditor(); assert.equal(context.activeText.height, 18, "reopening retains explicitly chosen bounds");
    assert(!rich.hasPendingEditorTextChanges(context.activeText), "reopening does not create geometry changes");
    context.changeTransform({ dataset: { transform: "width" }, value: "130" });
    context.changeTransform({ dataset: { transform: "height" }, value: "23" });
    assert.equal(context.activeText.width, 130); assert.equal(context.activeText.height, 23); assert.equal(context.activeText.y + 23, top);
    assert.equal(session.getObject(id).width, 55, "numeric draft sizing waits for Apply");
    context.cancelText(); assert.equal(session.getObject(id).width, 55, "Cancel discards pending numeric bounds");
    const selectedText = session.getObject(id);
    context.transformProperty("width", 110); context.transformProperty("height", 36);
    const sizedText = session.getObject(id);
    assert.equal(sizedText.width, selectedText.width); assert.equal(sizedText.height, selectedText.height, "Select sizing preserves the original wrapping dimensions");
    assert.equal(sizedText.fontSize, selectedText.fontSize);
    assert.deepEqual(sizedText.transform, [2, 0, 0, 2, -selectedText.x, -selectedText.y], "Select-mode W/H scales the textbox and its characters through the same transform");
    assert.deepEqual(sizedText.runs, selectedText.runs, "Select sizing preserves mixed formatting while scaling the complete appearance");
    session.undo(); session.undo(); assert.deepEqual(session.getObject(id).transform, selectedText.transform);
    session.redo(); session.redo(); assert.deepEqual(session.getObject(id).transform, sizedText.transform);
    session.setObjectsLocked([id], true); context.updateTextEditButton(); assert(control('[data-action="edit-text"]').disabled); await context.openTextEditor(); assert.equal(context.activeText, null); session.setObjectsLocked([id], false);
    context.running = true; context.updateTextEditButton(); assert(control('[data-action="edit-text"]').disabled); await context.openTextEditor(); assert.equal(context.activeText, null); context.running = false;
    let loaded; context.activateFont = () => new Promise(resolve => { loaded = resolve; });
    const delayed = context.openTextEditor(); await tick(); session.setObjectsLocked([id], true); loaded(); await delayed;
    assert.equal(context.activeText, null, "locking during a font load cannot reopen a stale editable draft"); session.setObjectsLocked([id], false);
    const layer = session.createLayer({ name: "Textbox" }); session.assignObjectsToLayer([id], layer);
    const hidden = context.openTextEditor(); await tick(); session.updateLayer(layer, { defaultVisible: false }); loaded(); await hidden;
    assert.equal(context.activeText, null, "hiding a layer during a font load cannot reopen its textbox"); session.updateLayer(layer, { defaultVisible: true });
    session.select([id]); const switched = context.openTextEditor(); await tick(); context.setTool("rectangle"); loaded(); await switched;
    assert.equal(context.activeText, null, "changing tools during a font load cancels textbox reentry"); context.activateFont = async () => {}; context.setTool("select");
    const before = session.revision; await context.openTextEditor(); context.cancelText(); assert.equal(session.revision, before, "canceling reopened content creates no history");
    const { id: originalId, ...textInput } = sizedText;
    for (const transform of [[0, 1, -1, 0, 200, 10], [1.5, .2, .3, .8, 30, 40]]) {
      const rotated = session.addObject({ ...textInput, transform }); session.select([rotated]);
      await context.openTextEditor(); const draft = context.activeText, oldWidth = draft.width, oldHeight = draft.height;
      const chrome = overlay.childNodes.find(node => node.className === "hepr-editor-text-resize-controls");
      const handle = chrome.childNodes.find(node => node.dataset.textResize === "se");
      const project = (x, y) => ({ x: transform[0] * x + transform[2] * y + transform[4], y: transform[1] * x + transform[3] * y + transform[5] });
      const start = project(draft.x + draft.width, draft.y), end = project(draft.x + draft.width + 30, draft.y - 12);
      dispatch(handle, "pointerdown", start.x, start.y); dispatch(chrome, "pointerup", end.x, end.y);
      assert(Math.abs(draft.width - oldWidth - 30) < 1e-9); assert(Math.abs(draft.height - oldHeight - 12) < 1e-9);
      const resized = await context.readTextDraft(); assert.deepEqual(resized.transform, transform); assert.equal(resized.fontSize, sizedText.fontSize);
      await context.finishText(); assert.deepEqual(session.getObject(rotated).transform, transform);
    }
    await context.openTextEditor(); const deleted = context.activeText;
    deleted.element.textContent = ""; acknowledgeTextPaints = false; await context.finishText();
    assert.equal(context.activeText, null); assert(overlay.childNodes.includes(deleted.backdrop), "deleting all text also masks the old canvas appearance until its frame is drawn");
    context.releaseTextPaints({ sourceScene: session.sourceScene, revision: session.revision }); acknowledgeTextPaints = true;
    assert(!overlay.childNodes.includes(deleted.backdrop));
    {
      const text = "LongUnbrokenWordThatMustWrap first  second ";
      const wrappedId = session.addObject({ kind: "text", pageIndex: 0, x: 15, y: 15, width: 400, height: 180, text,
        fontId: font.id, fontSize: 12, runs: [{ text: "LongUnbrokenWordThatMustWrap", fontId: font.id, fontSize: 12 },
          { text: " first  second ", fontId: font.id, fontSize: 12, underline: true, backgroundColor: "#ffdc00" }] });
      session.select([wrappedId]); await context.openTextEditor();
      const editing = context.activeText, original = session.getObject(wrappedId);
      context.transformProperty("width", 48);
      const narrow = await context.readTextDraft(), wideLayout = await layoutEditorText(original, services.fonts), narrowLayout = await layoutEditorText(narrow, services.fonts);
      assert(new Set(narrowLayout.glyphs.map(glyph => glyph.y)).size > new Set(wideLayout.glyphs.map(glyph => glyph.y)).size,
        "the fixture changes line-break positions, including within an oversized word");
      const rootWrapping = computedWrapping(editing.element), spanWrapping = editing.element.childNodes.map(computedWrapping), html = editing.element.innerHTML;
      assert.deepEqual(rootWrapping, { whiteSpace: "pre-wrap", overflowWrap: "break-word", webkitLineBreak: "after-white-space" });
      assert(spanWrapping.every(style => JSON.stringify(style) === JSON.stringify(rootWrapping)), "mixed-format runs inherit the same wrapping rules");
      acknowledgeTextPaints = false; await context.finishText();
      assert.equal(context.activeText, null); assert.equal(editing.element.contentEditable, "false");
      assert(overlay.childNodes.includes(editing.element), "the live wrapped DOM remains until the new canvas frame is acknowledged");
      assert.deepEqual(computedWrapping(editing.element), rootWrapping, "leaving content-edit mode must not change the retained textbox's effective line-breaking rules");
      assert.deepEqual(editing.element.childNodes.map(computedWrapping), spanWrapping, "styled spans keep their wrapping through the passive handoff");
      assert.equal(editing.element.innerHTML, html); assert.equal(editing.element.style.width, "48px");
      assert.equal(session.getObject(wrappedId).text, text); assert.deepEqual(session.getObject(wrappedId).runs, narrow.runs);
      const revision = session.revision;
      context.releaseTextPaints({ sourceScene: session.sourceScene, revision: revision - 1 });
      assert(overlay.childNodes.includes(editing.element)); assert.deepEqual(computedWrapping(editing.element), rootWrapping);
      context.releaseTextPaints({ sourceScene: session.sourceScene, revision }); acknowledgeTextPaints = true;
      assert(!overlay.childNodes.includes(editing.element));
    }
    assert.deepEqual(errors, []);
    assert(source.includes('editorIconButton("action", "edit-text"')); assert(source.includes('case "edit-text": void openTextEditor()'));
    console.log("Textbox editing: create, outside apply, stable-pointer reentry, direct Edit text/Text tool/native doubleclick, exact object updates, Undo/Redo, locks, busy state and cancel passed.");
  } finally { context.releaseTextPaints(); interaction.dispose(); session.dispose(); services.dispose(); }
} finally { hooks.deregister(); }
