import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { editorTextRangeWithin, captureEditorTextRange, applyEditorTextRangeCss } from "../src/editorTextFormatting.ts";

const hooks = registerHooks({ resolve(s, c, n) { return n(c.parentURL?.includes("/src/") && /^\.\.?\//.test(s) && !/\.[a-z0-9]+$/i.test(s) ? s + ".ts" : s, c); } });
try {
  const { readRichTextRuns } = await import("../src/editorRichText.ts");
  function fixture() {
    const document = { createElement: tag => new Element(tag), createTextNode: value => new Text(value),
      getSelection() { assert.fail("formatting a saved range must not inspect or change document selection"); } };
    class Text {
      nodeType = 3; parentElement = null;
      constructor(value) { this.textContent = value; this.ownerDocument = document; }
    }
    class Element {
      nodeType = 1; childNodes = []; parentElement = null; style = {};
      constructor(tag) { this.tagName = tag.toUpperCase(); this.ownerDocument = document; }
      append(...children) {
        for (const child of children) {
          if (child.nodeType === 11) { this.append(...[...child.childNodes]); child.childNodes = []; continue; }
          if (child.parentElement) child.parentElement.childNodes = child.parentElement.childNodes.filter(item => item !== child);
          child.parentElement = this; this.childNodes.push(child);
        }
      }
      contains(node) { return node === this || this.childNodes.some(child => child === node || child.contains?.(node)); }
      querySelectorAll() { return this.childNodes.flatMap(child => child.nodeType === 1 ? [child, ...child.querySelectorAll("*")] : []); }
      get textContent() { return this.childNodes.map(child => child.textContent).join(""); }
      get nextSibling() { const list = this.parentElement?.childNodes ?? []; return list[list.indexOf(this) + 1] ?? null; }
      focus() { assert.fail("formatting must keep focus in the toolbar input"); }
    }
    class Range {
      constructor(start, startOffset = 0, end = start, endOffset = startOffset) {
        this.startContainer = start; this.startOffset = startOffset; this.endContainer = end; this.endOffset = endOffset;
      }
      get collapsed() { return this.startContainer === this.endContainer && this.startOffset === this.endOffset; }
      cloneRange() { return new Range(this.startContainer, this.startOffset, this.endContainer, this.endOffset); }
      extractContents() {
        // Fixture ranges select complete direct child runs; the browser owns
        // partial text splitting. Exercise real formatting and rich-text readback.
        assert.equal(this.startContainer, this.endContainer);
        const fragment = new Element("fragment"); fragment.nodeType = 11;
        const nodes = this.startContainer.childNodes.slice(this.startOffset, this.endOffset);
        fragment.append(...nodes); this.endOffset = this.startOffset; return fragment;
      }
      insertNode(node) {
        const parent = this.startContainer;
        assert.equal(parent.nodeType, 1, "fixtures insert at a textbox child boundary");
        node.parentElement = parent; parent.childNodes.splice(this.startOffset, 0, node);
      }
      selectNodeContents(node) { this.startContainer = this.endContainer = node; this.startOffset = 0; this.endOffset = node.childNodes.length; }
      setStart(node, offset) { this.startContainer = node; this.startOffset = offset; }
      collapse() { this.endContainer = this.startContainer; this.endOffset = this.startOffset; }
    }
    const root = new Element("div"), toolbar = new Element("input"); document.activeElement = toolbar;
    root.style = { fontFamily: '"portable"', fontSize: "12px", fontWeight: "400", fontStyle: "normal", color: "#111111", textDecorationLine: "none", backgroundColor: "transparent" };
    const computed = element => ({ ...(element.parentElement ? computed(element.parentElement) : root.style), ...element.style });
    const read = () => readRichTextRuns(root, { getComputedStyle: computed }, [{ id: "portable", family: "Portable" }]);
    return { document, root, toolbar, Element, Text, Range, read };
  }

  {
    const h = fixture(), first = new h.Element("span"), second = new h.Element("span");
    first.append(new h.Text("First")); second.append(new h.Text("Second")); h.root.append(first, second);
    const original = new h.Range(first.childNodes[0], 1, second.childNodes[0], 3);
    assert(editorTextRangeWithin(h.root, original));
    const captured = captureEditorTextRange(h.root, { rangeCount: 1, getRangeAt: () => original });
    assert.notEqual(captured, original); assert.equal(captured.startContainer, original.startContainer); assert.equal(captured.endOffset, 3);
    assert.equal(captureEditorTextRange(h.root, null), null); assert.equal(captureEditorTextRange(h.root, { rangeCount: 0 }), null);
    const outside = new h.Text("Another textbox");
    for (const range of [new h.Range(outside), new h.Range(first.childNodes[0], 0, outside, 1), new h.Range(outside, 0, second.childNodes[0], 1)]) {
      assert.equal(editorTextRangeWithin(h.root, range), false);
      assert.equal(captureEditorTextRange(h.root, { rangeCount: 1, getRangeAt: () => range }), null);
      assert.equal(applyEditorTextRangeCss(h.root, range, "fontSize", "24px"), null, "ranges spanning unrelated UI cannot be formatted");
    }
    first.parentElement = null; h.root.childNodes.shift();
    assert.equal(editorTextRangeWithin(h.root, captured), false, "a saved range becomes invalid when either endpoint leaves its textbox");
    assert.equal(applyEditorTextRangeCss(h.root, captured, "fontSize", "24px"), null);
  }

  {
    const h = fixture(), prefix = new h.Text("Keep "), bold = new h.Element("span"), nested = new h.Element("span"), red = new h.Element("span"), line = new h.Element("br"), suffix = new h.Text(" after");
    bold.style = { fontSize: "18px", fontWeight: "700", textDecorationLine: "underline" };
    nested.style = { fontSize: "9px", fontStyle: "italic" }; nested.append(new h.Text("Bold")); bold.append(nested);
    red.style = { fontSize: "10px", color: "#ff0000" }; red.append(new h.Text("red"));
    h.root.append(prefix, bold, line, red, suffix);
    let range = new h.Range(h.root, 1, h.root, 4), wrapper;
    for (const value of ["24px", "32px"]) {
      range = applyEditorTextRangeCss(h.root, range, "fontSize", value);
      assert(range && !range.collapsed && editorTextRangeWithin(h.root, range));
      if (wrapper) assert.equal(range.startContainer, wrapper, "repeated numeric input updates the selected span without nesting wrappers");
      wrapper = range.startContainer;
      assert.equal(h.document.activeElement, h.toolbar, "repeated live sizes keep numeric input focus");
      const runs = h.read(), changed = runs.filter(run => ["Bold", "red"].includes(run.text));
      assert.deepEqual(changed.map(run => run.fontSize), [parseFloat(value), parseFloat(value)]);
      assert.equal(changed[0].fontWeight, 700); assert.equal(changed[0].fontStyle, "italic"); assert.equal(changed[0].underline, true);
      assert.equal(changed[1].color, "#ff0000");
      assert.equal(runs[0].fontSize, 12); assert.equal(runs.at(-1).fontSize, 12, "unselected text keeps its size");
      assert.equal(runs.map(run => run.text).join(""), "Keep Bold\nred after", "explicit line breaks and text survive nested formatting");
    }
  }

  {
    const h = fixture();
    let range = captureEditorTextRange(h.root, { rangeCount: 1, getRangeAt: () => new h.Range(h.root) });
    assert(range?.collapsed, "an empty textbox still captures a typing caret");
    range = applyEditorTextRangeCss(h.root, range, "fontSize", "24px");
    assert(range?.collapsed); assert.equal(h.root.childNodes.length, 1); assert.equal(h.root.childNodes[0].style.fontSize, "24px");
    const span = h.root.childNodes[0], caret = range.startContainer;
    assert.equal(caret.textContent, ""); assert.equal(range.startOffset, 0);
    range = applyEditorTextRangeCss(h.root, range, "fontSize", "32px");
    assert.equal(h.root.childNodes.length, 1); assert.equal(h.root.childNodes[0], span, "repeated size input reuses the empty caret span");
    assert.equal(span.childNodes.length, 1); assert.equal(span.style.fontSize, "32px"); assert.equal(h.document.activeElement, h.toolbar);
    assert.equal(h.root.textContent, ""); assert.equal(h.read().map(run => run.text).join(""), "", "no formatting marker enters saved or searchable text");
    // The browser receives this collapsed range when content editing resumes.
    // Simulate text insertion there, then use the real authoring readback.
    caret.textContent = "Typed";
    assert.deepEqual(h.read().map(run => [run.text, run.fontSize]), [["Typed", 32]], "future typing inherits only the caret's size");
    assert.equal(applyEditorTextRangeCss(h.root, null, "fontSize", "40px"), null);
  }
  console.log("Textbox range formatting: owned saved ranges, repeated live size input, nested rich runs, line breaks, toolbar focus and marker-free typing carets passed.");
} finally { hooks.deregister(); }
