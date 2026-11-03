import assert from "node:assert/strict";
import { measureEditorTextBox } from "../src/editorTextBox.ts";

// The fake layout reports fixture dimensions. These tests verify which DOM and
// CSS reach layout; browser font and line-box rendering remains a manual check.
function fixture(measure = () => ({ width: 87.1, height: 21.2 }), scrollHeight = 22) {
  const measured = [];
  class Text {
    nodeType = 3; parentElement = null; parentNode = null; lastChild = null;
    constructor(text) { this.textContent = text; }
    cloneNode() { return new Text(this.textContent); }
  }
  class Element {
    nodeType = 1; parentElement = null; parentNode = null; childNodes = []; style = {}; attributes = new Map();
    contentEditable = "false"; hidden = false; className = "";
    constructor(tagName = "DIV") { this.tagName = tagName; }
    get lastChild() { return this.childNodes.at(-1) ?? null; }
    get textContent() { return this.childNodes.map(child => child.textContent).join(""); }
    set textContent(text) { this.childNodes = []; if (text) this.append(new Text(text)); }
    append(...children) { for (const child of children) { this.childNodes.push(child); child.parentNode = child.parentElement = this; } }
    appendChild(child) { this.append(child); return child; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    cloneNode(deep) {
      assert.equal(deep, true, "measurement must clone all rich-text descendants");
      const clone = new Element(this.tagName);
      clone.style = { ...this.style }; clone.attributes = new Map(this.attributes);
      clone.contentEditable = this.contentEditable; clone.hidden = this.hidden; clone.className = this.className;
      clone.append(...this.childNodes.map(child => child.cloneNode(true)));
      return clone;
    }
    getBoundingClientRect() { measured.push(this); return measure(this); }
    get scrollHeight() { return typeof scrollHeight === "function" ? scrollHeight(this) : scrollHeight; }
    focus() { assert.fail("measuring must never change focus"); }
    remove() {
      if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter(child => child !== this);
      this.parentNode = this.parentElement = null;
    }
  }
  const body = new Element("BODY"), parent = new Element(), source = new Element();
  source.className = "hepr-editor-text-input"; source.contentEditable = "true"; source.setAttribute("id", "active-textbox");
  Object.assign(source.style, { fontSize: "14.2px", lineHeight: "1.5", fontFamily: "editing-font", whiteSpace: "pre-wrap",
    transform: "matrix(0,3,-2,0,0,0)", width: "220px", minWidth: "80px", maxWidth: "400px", height: "100px", minHeight: "100px", maxHeight: "300px" });
  const run = new Element("SPAN"); run.style = { fontSize: "24px", fontWeight: "700", fontFamily: "other-font", color: "#336699" };
  run.append(new Text("Rich text")); source.append(run); parent.append(source); body.append(parent);
  const selection = { anchorNode: run.lastChild, anchorOffset: 2, focusNode: run.lastChild, focusOffset: 5 };
  const document = { body, activeElement: source, createTextNode: text => new Text(text),
    getSelection: () => selection };
  return { document, source, parent, run, selection, measured, Element, Text };
}

{
  const h = fixture(probe => {
    assert.equal(probe.parentElement, h.parent, "the probe keeps the same inherited CSS context");
    return probe.style.transform === "none" ? { width: 87.1, height: 21.2 } : { width: 400, height: 300 };
  });
  const sourceStyle = { ...h.source.style }, selection = { ...h.selection };
  assert.deepEqual(measureEditorTextBox(h.document, h.source), { width: 88, height: 22 }, "local dimensions exclude the editor camera/object transform");
  const probe = h.measured[0];
  assert.notEqual(probe, h.source); assert.notEqual(probe.lastChild, h.run);
  assert.equal(probe.textContent, h.source.textContent); assert.deepEqual(probe.lastChild.style, h.run.style, "mixed font, size and emphasis reach layout unchanged");
  assert.equal(probe.className, h.source.className, "the probe retains editor wrapping CSS");
  assert.equal(probe.getAttribute("id"), null); assert.equal(probe.getAttribute("aria-hidden"), "true");
  assert.equal(probe.contentEditable, "false"); assert.equal(probe.style.visibility, "hidden"); assert.equal(probe.style.pointerEvents, "none");
  assert.equal(probe.style.width, "max-content"); assert.equal(probe.style.height, "auto");
  assert.equal(probe.style.minWidth, "0"); assert.equal(probe.style.maxWidth, "none");
  assert.equal(probe.style.minHeight, "0"); assert.equal(probe.style.maxHeight, "none");
  assert.deepEqual(h.source.style, sourceStyle); assert.equal(h.source.contentEditable, "true"); assert.equal(h.source.getAttribute("id"), "active-textbox");
  assert.equal(h.document.activeElement, h.source); assert.deepEqual(h.selection, selection, "caret and selection nodes/offsets are untouched");
  assert.deepEqual(h.parent.childNodes, [h.source], "the probe is removed after successful measurement");
}

{
  const h = fixture(probe => {
    assert.equal(probe.style.width, "64.5px", "height fitting wraps to the supplied local width");
    return { width: 64.5, height: 77.2 };
  }, 79);
  assert.deepEqual(measureEditorTextBox(h.document, h.source, 64.5), { width: 65, height: 79 }, "rounded bounds include overflowing line-box height");
  assert.deepEqual(h.parent.childNodes, [h.source]);
}

{
  const h = fixture(() => ({ width: 0, height: 0 }), 0); h.source.textContent = "";
  assert.deepEqual(measureEditorTextBox(h.document, h.source), { width: 1, height: 14.2 * 1.5 }, "empty drafts retain a usable line at the active font size");
  h.source.style.lineHeight = "";
  assert.equal(measureEditorTextBox(h.document, h.source).height, 14.2 * 1.2, "unset spacing uses the editor's default line height");
}

for (const nested of [false, true]) {
  const h = fixture(probe => {
    assert(probe.textContent.endsWith("\n\u200b"), "a clone-only sentinel makes the final empty line measurable");
    return { width: 50, height: 42.6 };
  }, 43);
  if (nested) h.run.textContent = "First line\n"; else h.source.textContent = "First line\n";
  assert.deepEqual(measureEditorTextBox(h.document, h.source), { width: 50, height: 43 });
  assert.equal(h.source.textContent, "First line\n", "terminal newline repair never changes authored text");
}

{
  const h = fixture(probe => {
    assert.equal(probe.lastChild.tagName, "DIV"); assert.equal(probe.lastChild.lastChild.tagName, "BR", "a final BR already supplies an empty line");
    assert.equal(probe.textContent, "Rich text"); return { width: 50, height: 43 };
  }, 43);
  const block = new h.Element(), br = new h.Element("BR"); block.append(br); h.source.append(block);
  measureEditorTextBox(h.document, h.source); assert.deepEqual(h.parent.childNodes, [h.source]);
}

{
  const h = fixture(probe => {
    assert.equal(probe.parentElement, h.document.body, "detached editors use the document body for layout");
    return { width: 50, height: 25 };
  }, 25);
  h.source.remove(); const before = [...h.document.body.childNodes];
  assert.deepEqual(measureEditorTextBox(h.document, h.source), { width: 50, height: 25 });
  assert.deepEqual(h.document.body.childNodes, before); assert.equal(h.source.parentElement, null);
}

for (const phase of ["bounds", "scrollHeight"]) {
  const failure = new Error(`Failed ${phase}`), h = fixture(() => {
    if (phase === "bounds") throw failure; return { width: 50, height: 25 };
  }, () => { throw failure; });
  assert.throws(() => measureEditorTextBox(h.document, h.source), error => error === failure);
  assert.deepEqual(h.parent.childNodes, [h.source], `${phase}: failed layout cannot leak a hidden probe`);
  assert.equal(h.document.activeElement, h.source); assert.equal(h.source.contentEditable, "true");
}

console.log("Textbox measurement: rich clone layout, local transforms, natural/wrapped widths, terminal newlines, focus preservation and cleanup passed.");
