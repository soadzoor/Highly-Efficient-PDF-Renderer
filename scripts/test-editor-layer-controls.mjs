import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });

class Element extends EventTarget {
  childNodes = []; style = {}; dataset = {}; value = ""; checked = false; disabled = false; hidden = false; attributes = new Map(); textContent = "";
  classList = { values: new Set(), toggle(name, value) { if (value) this.values.add(name); else this.values.delete(name); }, remove(name) { this.values.delete(name); }, contains(name) { return this.values.has(name); } };
  constructor(tag, document) { super(); this.tagName = tag; this.ownerDocument = document; }
  append(...children) { for (const child of children) { this.childNodes.push(child); child.parent = this; } }
  replaceChildren(...children) { this.childNodes = []; this.textContent = ""; this.append(...children); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  set innerHTML(html) {
    this.nodes = new Map(); this.childNodes = [];
    for (const [, tag, attrs] of html.matchAll(/<(input|select|button|div|fieldset)\b([^>]*)>/g)) {
      const name = attrs.match(/data-layer="([^"]+)"/)?.[1]; if (!name) continue;
      const node = this.ownerDocument.createElement(tag); node.dataset.layer = name; this.nodes.set(name, node); this.append(node);
    }
  }
  querySelector(selector) { return this.nodes?.get(selector.match(/data-layer="([^"]+)"/)?.[1]); }
  closest() { return this; }
  remove() { this.parent.childNodes = this.parent.childNodes.filter(child => child !== this); }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolled = true; }
}
const document = { createElement: tag => new Element(tag, document) };
const event = (node, type, target = node) => { const e = new Event(type); Object.defineProperty(e, "target", { value: target }); node.dispatchEvent(e); };
try {
  const { createEditorLayerControls, editorLayerEntries, reorderEditorLayerNodes } = await import("../src/editorLayerControls.ts");
  const group = (id, name = id) => ({ id, name, defaultVisible: true, locked: false, usedInView: true });
  let layers = [group("a", "<script>literal</script>"), group("b"), group("c")], revision = 0, selection = [], active = null;
  let order = [{ kind: "label", label: "Heading", children: [{ kind: "group", groupId: "a" }, { kind: "group", groupId: "b" }] }, { kind: "group", groupId: "c" }];
  const entries = editorLayerEntries(layers, order);
  assert.deepEqual(entries.map(e => [e.layer.id, e.depth]), [["a", 1], ["b", 1], ["c", 0]]);
  const reordered = reorderEditorLayerNodes(order, "a", 1);
  assert.equal(reordered[0].label, "Heading"); assert.equal(reordered[0].children[0].groupId, "b");
  assert.equal(order[0].children[0].groupId, "a", "reordering does not mutate source trees");
  const listeners = new Set(), calls = [], errors = [];
  const notify = () => { for (const listener of listeners) listener({}); };
  const session = {
    getLayerRevision: () => revision, getLayers: () => layers, getLayerOrder: () => order, getSelection: () => selection,
    getActiveLayer: () => active, getObjectLayerIds: () => ["a"], subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    createLayer(options) { const id = "new"; layers = [...layers, group(id, options.name)]; order = [...order, { kind: "group", groupId: id }]; revision++; calls.push(["add", options]); notify(); return id; },
    updateLayer(id, patch) { layers = layers.map(layer => layer.id === id ? { ...layer, ...patch } : layer); revision++; calls.push(["update", id, patch]); notify(); },
    setActiveLayer(id) { active = id; calls.push(["active", id]); notify(); },
    setLayerOrder(value) { order = value; revision++; calls.push(["order", value]); notify(); },
    moveLayer(id, value) { calls.push(["parent", id, value]); },
    selectLayerContents(id) { calls.push(["select", id]); },
    assignSelectionToLayer(id) { calls.push(["assign", id]); },
    removeLayer(id, options) { calls.push(["remove", id, options]); layers = layers.filter(layer => layer.id !== id); revision++; notify(); }
  };
  const container = document.createElement("div"), widget = createEditorLayerControls({ container, session, change: fn => fn(), onError: e => errors.push(e) });
  const panel = container.childNodes[0], node = name => panel.nodes.get(name), click = name => event(panel, "click", node(name)), change = name => event(panel, "change", node(name));
  assert(panel.hidden); assert.equal(listeners.size, 0, "View mode has no layer editor subscription");
  widget.setActive(true); assert(!panel.hidden && container.classList.contains("hepr-layer-editor-active"));
  const rows = () => node("list").childNodes.filter(child => child.className === "hepr-editor-layer-row");
  assert.equal(node("list").childNodes[0].textContent, "Heading", "PDF hierarchy headings remain visible");
  assert.equal(rows()[0].childNodes[1].textContent, "<script>literal</script>", "layer names remain plain text");
  const firstRow = rows()[0]; notify(); assert.equal(rows()[0], firstRow, "unchanged revisions do not rebuild on gesture notifications");
  const initialOrder = order;
  order = [{ kind: "group", groupId: "a" }, { kind: "label", label: "Separate heading", children: [{ kind: "group", groupId: "b" }] }, { kind: "group", groupId: "c" }];
  revision++; notify();
  assert(node("parent").childNodes.some(option => option.value === "b"), "heading indentation does not make a separate layer a descendant");
  order = initialOrder; revision++; notify();
  node("name").value = "Renamed"; change("name"); assert.deepEqual(calls.at(-1), ["update", "a", { name: "Renamed" }]);
  node("locked").checked = true; change("locked"); assert(node("visible").disabled); assert(rows()[0].childNodes[0].disabled);
  click("down"); assert.equal(order[0].children[1].groupId, "a");
  selection = ["object"]; notify(); node("assignment").value = "b"; click("assign"); assert.deepEqual(calls.at(-1), ["assign", "b"]);
  node("new-name").value = "Imported drawings"; click("add"); assert.equal(active, "new"); assert.equal(node("name").value, "Imported drawings");
  node("parent").value = "b"; change("parent"); assert.deepEqual(calls.at(-1), ["parent", "new", { parentId: "b", index: 0 }]);
  click("select"); assert.deepEqual(calls.at(-1), ["select", "new"]);
  node("target").value = "b"; click("remove"); assert.deepEqual(calls.at(-1), ["remove", "new", { targetLayerId: "b" }]);
  node("filter").value = "missing"; event(node("filter"), "input"); assert.equal(node("list").textContent, "No matching layers.");
  widget.show(); assert(panel.open && panel.scrolled && node("active").focused);
  widget.setActive(false); assert(panel.hidden); assert.equal(listeners.size, 0); assert(!container.classList.contains("hepr-layer-editor-active"));
  widget.setActive(true); widget.dispose(); assert.equal(container.childNodes.length, 0); assert.equal(listeners.size, 0); assert.deepEqual(errors, []);
  console.log("Editor layer controls: CRUD, nesting, stacking order, assignment, visibility locks, escaping and View detachment passed.");
} finally { hooks.deregister(); }
