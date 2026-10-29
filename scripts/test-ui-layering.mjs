import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [reader, editor, native, three, workspace] = await Promise.all([
  readFile(new URL("../src/readerViewport.css", import.meta.url), "utf8"),
  readFile(new URL("../src/editorUi.css", import.meta.url), "utf8"),
  readFile(new URL("../src/style.css", import.meta.url), "utf8"),
  readFile(new URL("../three-example.html", import.meta.url), "utf8"),
  readFile(new URL("../src/viewerWorkspace.css", import.meta.url), "utf8")
]);
function declarations(css, selector) {
  const result = new Map();
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const clean = selectors.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (!clean.split(",").map(item => item.trim()).includes(selector)) continue;
    for (const declaration of body.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon >= 0) result.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
    }
  }
  return result;
}
const z = (css, selector) => {
  const value = Number(declarations(css, selector).get("z-index"));
  assert(Number.isFinite(value), `${selector} needs an explicit finite stacking tier`); return value;
};
const shell = declarations(reader, ".reader-shell");
assert.equal(shell.get("position"), "absolute", "the viewport shell must not create the fixed-position context that trapped its toolbar");
assert(!shell.has("z-index") || shell.get("z-index") === "auto");
for (const property of ["transform", "filter", "backdrop-filter", "isolation", "contain", "will-change"])
  assert(!shell.has(property), `${property} must not reintroduce a containing stacking context around the document and toolbar`);
assert(!shell.has("opacity") || Number(shell.get("opacity")) === 1);
const documentLayer = z(editor, ".hepr-editor-overlay"), editorToolbar = z(editor, ".hepr-editor-toolbar");
assert.equal(declarations(editor, ".hepr-editor-toolbar").get("box-sizing"), "border-box",
  "the canvas-constrained toolbar width includes padding and borders in both viewers");
assert.equal(declarations(editor, ".hepr-editor-toolbar").get("overflow"), "auto",
  "narrow canvas widths retain access to wrapped and overflowing editor controls");
const sidebar = z(reader, ".reader-thumbnails"), settings = z(workspace, ".viewer-workspace > #hud.viewer-settings");
const toolbar = z(reader, ".reader-toolbar"), restore = z(reader, ".reader-toolbar-restore");
assert(documentLayer < sidebar && sidebar < editorToolbar, "document affordances stay below sidebar and editor controls");
assert(editorToolbar < settings && settings < toolbar, "Settings and the main toolbar stay above document editing chrome");
assert.equal(z(workspace, ".viewer-workspace > #panel.viewer-settings"), settings, "both viewers use the same Settings tier");
const workspaceLayout = declarations(workspace, ".viewer-workspace");
assert.equal(workspaceLayout.get("display"), "flex", "Settings and document navigation share a horizontal workspace");
assert.notEqual(workspaceLayout.get("flex-direction"), "column");
for (const selector of [".viewer-workspace > #hud.viewer-settings", ".viewer-workspace > #panel.viewer-settings"]) {
  const settingsLayout = declarations(workspace, selector);
  assert.equal(settingsLayout.get("position"), "relative", "Settings participates in workspace layout");
  assert.equal(settingsLayout.get("inset"), "auto", "legacy floating Settings offsets cannot cover the canvas");
  assert.equal(settingsLayout.get("overflow"), "auto", "narrow Settings docks retain access to their controls");
}
assert(restore >= toolbar, "the floating restore control stays above document overlays");
assert(z(native, ".example-menu") > toolbar && z(three, ".example-menu") > toolbar,
  "body-mounted example menus stay above the main toolbar in both viewers");
assert(["clip", "hidden"].includes(declarations(editor, ".hepr-editor-overlay").get("overflow")),
  "the canvas-sized editor overlay clips both paint and hit testing outside its viewport");
console.log("UI layering: root-level chrome ordering, canvas overlay clipping, sidebar occlusion and menu/restore priority passed.");
