import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { sourceFunction } from "./lib/sourceFunction.mjs";
import { editorUiTestContext } from "./lib/editorUiTestContext.mjs";

const source = (await readFile(new URL("../src/editorUi.ts", import.meta.url), "utf8")).replace(/^ {2}/gm, "");
const plain = value => JSON.parse(JSON.stringify(value));

function harness(runs = [{ text: "Bold", fontSize: 18, fontWeight: 700 }, { text: " red", fontSize: 10, color: "#ff0000" }]) {
  const handlers = new Map(), applied = [], controls = new Map();
  let checkpoints = 0, geometry = 0, autoSizes = 0, focuses = 0;
  const root = { style: { fontSize: "12px", textAlign: "left" }, runs: structuredClone(runs), hidden: false,
    contains(node) { return node === this || node?.textbox === this; },
    get textContent() { return this.runs.map(run => run.text).join(""); },
    get innerText() { return this.textContent; },
    get childNodes() { return Array.from(this.textContent, text => ({ nodeType: 3, textContent: text, textbox: this })); },
    focus() { focuses++; document.activeElement = this; }
  };
  class TextRange {
    static START_TO_START = 0; static START_TO_END = 1; static END_TO_END = 2; static END_TO_START = 3;
    constructor(element = root, start = 0, end = start) { this.element = element; this.startOffset = start; this.endOffset = end; this.startContainer = this.endContainer = element; }
    get collapsed() { return this.startOffset === this.endOffset; }
    get commonAncestorContainer() { return this.element; }
    cloneRange() { return new TextRange(this.element, this.startOffset, this.endOffset); }
    selectNodeContents(element) { this.element = this.startContainer = this.endContainer = element; this.startOffset = 0; this.endOffset = element.textContent.length; }
    compareBoundaryPoints(how, other) {
      const a = how === TextRange.END_TO_END || how === TextRange.END_TO_START ? this.endOffset : this.startOffset;
      const b = how === TextRange.END_TO_END || how === TextRange.START_TO_END ? other.endOffset : other.startOffset;
      return Math.sign(a - b);
    }
    toString() { return this.element.textContent.slice(this.startOffset, this.endOffset); }
  }
  let current = new TextRange(root, 0, root.textContent.length);
  const selection = { get rangeCount() { return current ? 1 : 0; }, get isCollapsed() { return !current || current.collapsed; },
    get anchorNode() { return current?.startContainer; }, get focusNode() { return current?.endContainer; },
    getRangeAt() { return current; }, removeAllRanges() { current = null; }, addRange(range) { current = range; } };
  const fontInput = { dataset: { prop: "font-size" }, value: "12", disabled: false };
  controls.set("font-size", fontInput);
  const property = name => {
    if (!controls.has(name)) controls.set(name, { dataset: { prop: name }, value: name === "align" ? "left" : "#111111" });
    return controls.get(name);
  };
  const document = { activeElement: root, getSelection: () => selection, createRange: () => new TextRange() };
  const within = (element, range) => Boolean(range && element.contains(range.startContainer) && element.contains(range.endContainer));
  const editing = { element: root, pageIndex: 0, x: 20, y: 30, width: 80, height: 30, fixedHeight: true,
    autoSize: { width: 72, height: 15 }, transform: [1, 0, 0, 1, 0, 0], baseline: {} };
  const context = editorUiTestContext({
    active: true, activeText: editing, document, window: { getSelection: () => selection, getComputedStyle: element => ({ ...root.style, ...element.style }) }, Range: TextRange,
    toolbar: { addEventListener(name, handler) { handlers.set(name, handler); } }, property,
    query: () => property("align"), styleEnabled: () => false, selectedFont: async () => ({ id: "font", family: "Test" }),
    editorServices: { fonts: { list: () => [{ id: "font", family: "Test" }] } },
    readRichTextRuns: element => structuredClone(element.runs),
    editorTextRangeWithin: within,
    captureEditorTextRange: (element, selected) => selected?.rangeCount && within(element, selected.getRangeAt(0)) ? selected.getRangeAt(0).cloneRange() : null,
    applyEditorTextRangeCss(element, range, propertyName, value) {
      assert(within(element, range)); assert.equal(propertyName, "fontSize"); applied.push({ range, size: parseFloat(value) });
      if (range.collapsed) element.pendingSize = parseFloat(value);
      else {
        let index = 0;
        element.runs = element.runs.flatMap(run => {
          const start = index, end = index + run.text.length; index = end;
          const from = Math.max(start, range.startOffset), to = Math.min(end, range.endOffset);
          if (from >= to) return [run];
          return [from > start && { ...run, text: run.text.slice(0, from - start) },
            { ...run, text: run.text.slice(from - start, to - start), fontSize: parseFloat(value) },
            to < end && { ...run, text: run.text.slice(to - start) }].filter(Boolean);
        });
      }
      return range.cloneRange();
    },
    updateGeometry() { geometry++; }, updateTextAutoSize() { autoSizes++; },
    recovery: { draftChanged() { checkpoints++; } }, session: { revision: 4 },
    commit() { assert.fail("live typography remains a pending textbox draft until Apply"); },
    stageColorDraft: () => false, opacityInput() {}, changeOpacity: () => false
  });
  for (const name of ["rememberTextSelection", "restoreTextSelection", "changeTextFontSize", "changeAppearance", "toolbarInput", "readTextDraft"])
    vm.runInContext(sourceFunction(source, name), context);
  const registration = 'toolbar.addEventListener("input", toolbarInput);';
  assert(source.includes(registration), "font-size updates use the actual toolbar input registration"); vm.runInContext(registration, context);
  const start = source.indexOf('toolbar.addEventListener("change", event => {'), end = source.indexOf("\n});", start);
  assert(start >= 0 && end > start); vm.runInContext(stripTypeScriptTypes(source.slice(start, end + 4)), context);
  const input = value => { fontInput.value = value; handlers.get("input")({ target: fontInput }); };
  const select = (from, to = from) => { current = new TextRange(root, from, to); document.activeElement = root; context.rememberTextSelection(); };
  const toolbarFocus = () => { document.activeElement = fontInput; current = new TextRange({ textContent: "24" }, 0, 2); };
  return { context, root, editing, document, fontInput, property, applied, selection, select, toolbarFocus, input,
    change: () => handlers.get("change")({ target: fontInput }), get checkpoints() { return checkpoints; }, get focuses() { return focuses; },
    get geometry() { return geometry; }, get autoSizes() { return autoSizes; }, get current() { return current; } };
}

{
  const h = harness(); h.select(0, h.root.textContent.length); h.toolbarFocus();
  for (const value of ["2", "24"]) {
    h.input(value);
    assert.equal(h.document.activeElement, h.fontInput, "editing consecutive numeric digits never steals toolbar focus");
    assert(h.root.runs.every(run => run.fontSize === Number(value)), "input updates all selected rich runs immediately");
    assert.equal(h.root.style.fontSize, `${value}px`, "a full-content change updates the textbox's base size too");
  }
  assert.equal(h.focuses, 0); assert.equal(h.context.session.revision, 4); assert.equal(h.applied.length, 2);
  assert.equal(h.root.runs[0].fontWeight, 700); assert.equal(h.root.runs[1].color, "#ff0000");
  assert(h.geometry > 0 && h.autoSizes > 0, "live typography refreshes its draft geometry");
  const checkpoints = h.checkpoints, applications = h.applied.length;
  h.change(); assert.equal(h.applied.length, applications); assert.equal(h.checkpoints, checkpoints, "the eventual change event cannot apply the input twice");
  const draft = await h.context.readTextDraft(); assert.equal(draft.fontSize, 24); assert(draft.runs.every(run => run.fontSize === 24));
  h.document.activeElement = h.root; h.context.restoreTextSelection();
  assert(h.root.contains(h.current.startContainer), "returning to content editing restores the formatted text selection");
}

{
  const h = harness(); h.select(0, 4); h.toolbarFocus(); h.input("24");
  assert.deepEqual(h.root.runs.map(run => run.fontSize), [24, 10], "a partial selection leaves unselected sizes unchanged");
  assert.equal(h.root.style.fontSize, "12px");
  const draft = await h.context.readTextDraft(); assert.equal(draft.fontSize, 12, "toolbar selection size cannot replace the mixed textbox's base line metrics");
  assert.deepEqual(plain(draft.runs.map(run => run.fontSize)), [24, 10]);
}

{
  const h = harness(); h.select(0, 4); h.toolbarFocus(); h.input("10");
  assert(h.root.runs.every(run => run.fontSize === 10));
  assert.equal(h.root.style.fontSize, "12px");
  assert.equal((await h.context.readTextDraft()).fontSize, 12, "making mixed runs uniform through a partial selection retains the live root line-height strut");
}

{
  const h = harness(); h.select(3); h.toolbarFocus(); h.input("32");
  assert.deepEqual(h.root.runs.map(run => run.fontSize), [18, 10], "a collapsed caret changes future typing without restyling existing text");
  assert.equal(h.root.pendingSize, 32); assert.equal(h.root.style.fontSize, "12px");
  assert.equal((await h.context.readTextDraft()).fontSize, 12);
}

{
  const h = harness([]); h.select(0); h.toolbarFocus(); h.input("20");
  assert.equal(h.root.style.fontSize, "20px", "an empty textbox adopts its initial typing size");
  assert.equal(h.root.pendingSize, 20); assert.equal((await h.context.readTextDraft()).fontSize, 20);
}

{
  const h = harness([{ text: "Existing", fontSize: 12 }, { text: "", fontSize: 40 }]);
  const draft = await h.context.readTextDraft();
  assert.equal(draft.fontSize, 12);
  assert.deepEqual(plain(draft.runs), [{ text: "Existing", fontSize: 12 }], "an unused caret style cannot serialize an empty run or report mixed selected-object sizing");
}

{
  const h = harness(); h.editing.autoSize = undefined; const bounds = [h.editing.x, h.editing.y, h.editing.width, h.editing.height];
  h.select(0, h.root.textContent.length); h.toolbarFocus(); h.input("24");
  assert.deepEqual([h.editing.x, h.editing.y, h.editing.width, h.editing.height], bounds, "content-mode font changes retain a manually chosen textbox rectangle");
  assert(h.root.runs.every(run => run.fontSize === 24)); assert(h.geometry > 0);
}

{
  const h = harness(); h.toolbarFocus();
  const outside = { textContent: "Another textbox" };
  h.editing.selection = { startContainer: outside, endContainer: outside };
  h.input("24"); assert.equal(h.applied.length, 0); assert.equal(h.checkpoints, 0, "stale ranges cannot format unrelated content or checkpoint an unchanged draft");
}

for (const value of ["", "-", "0", "-2", "NaN", "Infinity"]) {
  const h = harness(); h.select(0, h.root.textContent.length); h.toolbarFocus(); const before = plain(h.root.runs);
  h.input(value); assert.equal(h.applied.length, 0, `${value} is an intermediate or invalid size`);
  assert.deepEqual(h.root.runs, before); assert.equal(h.root.style.fontSize, "12px"); assert.equal(h.checkpoints, 0);
}

console.log("Textbox font-size UI: real input/change routing, retained toolbar focus and ranges, full/partial/caret formatting, draft base sizes, validation and duplicate-event suppression passed.");
