import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const loaded = [];
const hooks = registerHooks({ resolve(specifier, context, next) {
  loaded.push(specifier);
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const decode = text => text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
class Button {
  id = "print-pdf"; disabled = true; hidden = true; dataset = { action: "print" }; attributes = new Map([["aria-pressed", "true"]]);
  title = ""; markup = ""; caption = ""; writes = 0; firstElementChild = null;
  classes = new Set(["existing-class"]);
  classList = { contains: value => this.classes.has(value), add: value => this.classes.add(value) };
  get innerHTML() { return this.markup; }
  set innerHTML(value) {
    this.writes++;
    // Browser SVG serialization expands empty tags. The unchanged presentation
    // must retain its DOM even when this differs from the source template.
    this.markup = value.replace(/<(path|rect|circle|ellipse)([^>]*)\/>/g, "<$1$2></$1>");
    this.caption = decode(/<span[^>]*>([^<]*)<\/span>/.exec(value)?.[1] ?? "");
    const icon = /<svg[^>]*data-icon="([^"]+)"/.exec(value)?.[1];
    this.firstElementChild = icon ? { getAttribute: name => name === "data-icon" ? icon : null } : null;
  }
  set textContent(value) { this.caption = value; this.markup = value; this.firstElementChild = null; }
  get textContent() { return this.caption; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
}
try {
  const { toolbarIconMarkup, toolbarButtonContent, toolbarButton, setToolbarIconButton, initializeToolbarIcons } = await import("../src/toolbarIcons.ts");
  const { editorIconButton } = await import("../src/editorToolbarIcons.ts");
  assert(!loaded.some(value => /(?:editorUi|editorSession|editorAppServices|editorFonts|pdfSession|\.css)/.test(value)),
    "View icons do not import editor, font, parser or stylesheet runtime");
  const button = new Button();
  setToolbarIconButton(button, "print", "Print"); const firstSvg = button.firstElementChild;
  assert.match(button.innerHTML, /<svg\b[^>]*aria-hidden="true"[^>]*focusable="false"/);
  assert.equal(button.textContent, "Print"); assert.equal(button.title, "Print"); assert.equal(button.getAttribute("aria-label"), "Print");
  assert.equal(button.id, "print-pdf"); assert(button.disabled && button.hidden); assert.equal(button.dataset.action, "print");
  assert.equal(button.getAttribute("aria-pressed"), "true"); assert(button.classes.has("existing-class"));
  assert.notEqual(button.innerHTML, toolbarButtonContent("print", "Print"));
  setToolbarIconButton(button, "print", "Print");
  assert.equal(button.writes, 1, "normalized SVG markup does not cause unchanged refreshes to rebuild DOM");
  assert.equal(button.firstElementChild, firstSvg);
  setToolbarIconButton(button, "print", "Preparing print…");
  assert.equal(button.writes, 2); assert.equal(button.firstElementChild.getAttribute("data-icon"), "print");
  assert.equal(button.textContent, "Preparing print…"); assert.equal(button.title, "Preparing print…");
  button.textContent = "Host replaced the contents"; setToolbarIconButton(button, "print", "Preparing print…");
  assert.equal(button.writes, 3, "a host text update cannot permanently erase the icon");
  for (const [icon, label] of [["edit", "Edit PDF"], ["cancel", "Cancel editing setup"], ["view", "View PDF"]]) {
    setToolbarIconButton(button, icon, label); assert.equal(button.firstElementChild.getAttribute("data-icon"), icon);
    assert.equal(button.getAttribute("aria-label"), label); assert.equal(button.title, label);
  }
  const search = new Button(); search.dataset.toolbarIcon = "search-previous"; search.textContent = "▲";
  search.setAttribute("aria-label", "Previous match"); search.title = "Previous match (Shift+Enter)";
  const unknown = new Button(); unknown.dataset.toolbarIcon = "unknown";
  initializeToolbarIcons({ querySelectorAll: () => [search, unknown] });
  assert.equal(search.title, "Previous match (Shift+Enter)", "initialization preserves detailed shortcut tooltips");
  assert.equal(search.getAttribute("aria-label"), "Previous match"); assert.equal(search.textContent, "Previous match");
  assert.equal(unknown.writes, 0); const before = search.firstElementChild;
  initializeToolbarIcons({ querySelectorAll: () => [search] }); assert.equal(search.firstElementChild, before);
  const label = 'Save "PDF" <copy> & keep';
  const markup = toolbarButton("save-pdf", label, 'data-action="save-pdf" hidden', "extra-class");
  assert(!markup.includes("<copy>")); assert.match(markup, /&#34;PDF&#34; &#60;copy&#62; &#38; keep/);
  assert.match(markup, /class="hepr-toolbar-icon-button extra-class"/); assert.match(markup, /data-action="save-pdf" hidden/);
  for (const name of ["pages", "pdf-password", "save-pdf", "flatten", "save-hep", "print"]) {
    const editor = editorIconButton("action", name, label);
    assert.match(editor, new RegExp(`data-action="${name}"`)); assert.match(editor, new RegExp(`data-icon="${name}"`));
    assert.match(editor, /title="Save &#34;PDF&#34;/); assert.match(editor, /aria-label="Save &#34;PDF&#34;/);
    assert(!editor.includes("undefined"));
  }
  assert.match(editorIconButton("tool", "select", "Select"), /aria-pressed="true"/);
  assert.match(editorIconButton("action", "cancel-operation", "Cancel", "hidden"), / hidden>/);
  assert.match(toolbarIconMarkup("print"), /stroke="currentColor"/);
  console.log("Shared toolbar icons: lazy View imports, accessible captions, safe labels, preserved states, busy modes and stable normalized SVG DOM passed.");
} finally { hooks.deregister(); }
