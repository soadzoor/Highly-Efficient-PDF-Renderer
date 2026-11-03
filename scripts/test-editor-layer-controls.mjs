import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.includes("/src/") && /^\.\.?\//.test(specifier) && !/\.[a-z0-9]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
} });

class Element extends EventTarget {
  childNodes = []; style = {}; dataset = {}; value = ""; checked = false; disabled = false; hidden = false; attributes = new Map(); textContent = "";
  captures = new Set(); scrollTop = 0; clientLeft = 0; clientTop = 0; clientWidth = 300; clientHeight = 160; isConnected = true;
  classList = { values: new Set(), toggle(name, value) { if (value) this.values.add(name); else this.values.delete(name); }, remove(name) { this.values.delete(name); }, contains(name) { return this.values.has(name); } };
  constructor(tag, document) { super(); this.tagName = tag; this.ownerDocument = document; }
  append(...children) { for (const child of children) { this.childNodes.push(child); child.parent = this; } }
  replaceChildren(...children) { this.childNodes = []; this.textContent = ""; this.append(...children); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  set innerHTML(html) {
    this.nodes = new Map(); this.childNodes = [];
    for (const [, tag, attrs] of html.matchAll(/<(input|select|button|div|fieldset)\b([^>]*)>/g)) {
      const name = attrs.match(/data-layer="([^"]+)"/)?.[1]; if (!name) continue;
      const node = this.ownerDocument.createElement(tag); node.dataset.layer = name; this.nodes.set(name, node); this.append(node);
    }
  }
  querySelector(selector) {
    const name = selector.match(/data-layer="([^"]+)"/)?.[1];
    const find = node => node.dataset.layer === name ? node : node.childNodes.map(find).find(Boolean);
    return this.nodes?.get(name) ?? this.childNodes.map(find).find(Boolean);
  }
  closest(selector) {
    const matches = selector === "button[data-layer]" ? this.tagName === "button" && this.dataset.layer !== undefined
      : selector === ".hepr-editor-layer-row" ? this.className?.split(" ").includes("hepr-editor-layer-row") : false;
    return matches ? this : this.parent?.closest(selector) ?? null;
  }
  contains(node) { return node === this || this.childNodes.some(child => child.contains(node)); }
  remove() { this.isConnected = false; this.parent.childNodes = this.parent.childNodes.filter(child => child !== this); }
  focus() { this.focused = true; this.ownerDocument.activeElement = this; }
  select() { this.selected = true; }
  get scrollHeight() { return this.dataset.layer === "list" ? this.childNodes.length * 32 : 32; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
  getBoundingClientRect() {
    let top = 100, height = this.clientHeight;
    if (this.parent?.dataset.layer === "list") { top += this.parent.childNodes.indexOf(this) * 32 - this.parent.scrollTop; height = 32; }
    else if (this.parent?.className?.includes("hepr-editor-layer-row")) return this.parent.getBoundingClientRect();
    return { left: 0, right: 300, top, bottom: top + height, width: 300, height };
  }
  scrollIntoView() { this.scrolled = true; }
}
const frames = new Map(); let nextFrame = 1;
const window = Object.assign(new EventTarget(), {
  requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
  cancelAnimationFrame(id) { frames.delete(id); }
});
const document = { defaultView: window, createElement: tag => new Element(tag, document) };
const event = (node, type, target = node, props = {}) => {
  const e = new Event(type, { cancelable: true }); Object.defineProperty(e, "target", { value: target });
  for (const [name, value] of Object.entries(props)) Object.defineProperty(e, name, { value });
  node.dispatchEvent(e); return e;
};
const pointer = (node, type, id, x, y, pointerType = "touch", props = {}) => event(node, type, node, {
  pointerId: id, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, isPrimary: true, pointerType, ...props
});
const frame = time => { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(time); };
try {
  const { createEditorLayerControls, editorLayerEntries, reorderEditorLayerNodes, dropEditorLayerNode } = await import("../src/editorLayerControls.ts");
  const group = (id, name = id) => ({ id, name, defaultVisible: true, locked: false, usedInView: true });
  let layers = [group("a", "<script>literal</script>"), group("b"), group("c")], revision = 0, selection = [], active = null;
  let order = [{ kind: "label", label: "Heading", children: [{ kind: "group", groupId: "a" }, { kind: "group", groupId: "b" }] }, { kind: "group", groupId: "c" }];
  const entries = editorLayerEntries(layers, order);
  assert.deepEqual(entries.map(e => [e.layer.id, e.depth]), [["a", 1], ["b", 1], ["c", 0]]);
  const reordered = reorderEditorLayerNodes(order, "a", 1);
  assert.equal(reordered[0].label, "Heading"); assert.equal(reordered[0].children[0].groupId, "b");
  assert.equal(order[0].children[0].groupId, "a", "reordering does not mutate source trees");
  const nested = [{ kind: "label", label: "Heading", children: [{ kind: "group", groupId: "a", children: [{ kind: "group", groupId: "child" }] }, { kind: "group", groupId: "b" }] }, { kind: "group", groupId: "c" }];
  const moved = dropEditorLayerNode(nested, "a", "c", "after");
  assert.equal(moved[0].label, "Heading"); assert.equal(moved[0].children[0].groupId, "b");
  assert.equal(moved[2].groupId, "a"); assert.equal(moved[2].children[0].groupId, "child", "a layer's subtree moves with it");
  assert.equal(nested[0].children[0].groupId, "a", "drag reordering leaves the source hierarchy immutable");
  assert.equal(dropEditorLayerNode(nested, "a", "child", "before"), nested, "dropping against a descendant is rejected");
  assert.equal(dropEditorLayerNode(nested, "a", "a", "after"), nested, "self drops are rejected");
  assert.equal(dropEditorLayerNode(nested, "missing", "a", "before"), nested, "unknown layers cannot enter the hierarchy");
  assert.deepEqual(dropEditorLayerNode(nested, "child", "b", "before")[0].children.map(node => node.groupId), ["a", "child", "b"], "nested children can move to a sibling position under a PDF heading");
  assert.equal(dropEditorLayerNode(order, "a", "b", "before"), order, "an unchanged drop retains identity and creates no history entry");
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
  assert.equal(node("active"), undefined, "the active destination no longer has a redundant dropdown");
  const unlayered = () => node("list").childNodes.find(row => row.dataset.layer === "unlayered");
  assert.equal(unlayered().dataset.active, "true", "the unlayered destination has an active row even without an OCG");
  assert.equal(node("list").childNodes.find(child => child.className === "hepr-editor-layer-heading").textContent, "Heading", "PDF hierarchy headings remain visible");
  const rowFor = id => id === null ? unlayered() : rows().find(row => row.dataset.layerId === id), control = (id, kind) => rowFor(id).childNodes.find(node => node.dataset.layerControl === kind);
  const nameFor = id => rowFor(id).childNodes.find(node => node.className === "hepr-editor-layer-name");
  const gripFor = id => rowFor(id).childNodes.find(node => node.className === "hepr-editor-layer-grip");
  assert.equal(nameFor("a").textContent, "<script>literal</script>", "layer names remain plain text");
  const firstRow = rows()[0]; notify(); assert.equal(rows()[0], firstRow, "unchanged revisions do not rebuild on gesture notifications");
  const initialOrder = order;
  order = [{ kind: "group", groupId: "a" }, { kind: "label", label: "Separate heading", children: [{ kind: "group", groupId: "b" }] }, { kind: "group", groupId: "c" }];
  revision++; notify();
  assert(node("parent").childNodes.some(option => option.value === "b"), "heading indentation does not make a separate layer a descendant");
  order = initialOrder; revision++; notify();
  event(nameFor("a"), "click"); assert.equal(active, "a"); assert.equal(rowFor("a").dataset.active, "true");
  assert.equal(document.activeElement, rowFor("a"), "choosing a layer focuses a non-input target for object paste shortcuts");
  assert.equal(calls.at(-1)[0], "active", "choosing a layer does not change the canvas selection");
  const activeRow = rowFor("a"); event(nameFor("b"), "click"); assert.equal(rowFor("a"), activeRow, "changing the active layer does not rebuild rows");
  assert.equal(rowFor("b").dataset.active, "true"); assert.equal(rowFor("a").dataset.active, "false");
  const canvasKeys = [], rowKey = (id, key, props = {}) => {
    const e = event(rowFor(id), "keydown", rowFor(id), { key, ...props });
    if (!e.cancelBubble) canvasKeys.push(key); return e;
  };
  const canvasSelection = [...selection];
  for (const [from, key, to] of [["b", "ArrowUp", "a"], ["a", "ArrowDown", "b"], ["b", "End", "c"], ["c", "Home", null], [null, "ArrowDown", "a"], ["a", "ArrowUp", null]]) {
    const e = rowKey(from, key); assert(e.defaultPrevented && e.cancelBubble);
    assert.equal(active, to); assert.equal(document.activeElement, rowFor(to), `${key} selects and focuses the destination layer`);
  }
  for (const key of ["Delete", "Backspace", "ArrowLeft", "ArrowRight"]) assert(rowKey("a", key).defaultPrevented);
  assert.deepEqual(canvasKeys, [], "navigation/delete events consumed by a focused layer row never reach the canvas key handler");
  assert.deepEqual(selection, canvasSelection, "layer keyboard navigation keeps the canvas object selection");
  event(unlayered(), "click"); assert.equal(active, null); assert.equal(document.activeElement, unlayered());
  assert.equal(unlayered().dataset.active, "true"); assert(rows().every(row => row.dataset.active === "false"));
  for (const key of ["Enter", " "]) {
    event(nameFor("a"), "click"); const pressed = rowKey(null, key);
    assert(pressed.defaultPrevented && pressed.cancelBubble); assert.equal(active, null, "the unlayered destination is keyboard selectable");
  }
  for (const key of ["c", "x", "v"]) {
    const e = rowKey("a", key, { ctrlKey: true }); assert(!e.defaultPrevented && !e.cancelBubble, "object clipboard shortcuts still bubble");
    const plain = rowKey(null, key, { metaKey: true }); assert(!plain.defaultPrevented && !plain.cancelBubble, "unlayered rows retain object paste shortcuts");
  }
  event(nameFor("a"), "dblclick"); const rename = control("a", "rename");
  const otherRow = rowFor("b");
  assert.equal(active, "a"); assert(!rename.hidden && rename.selected && document.activeElement === rename);
  rename.value = "Composing";
  assert(!event(rename, "keydown", rename, { key: "Enter", isComposing: true }).defaultPrevented);
  assert(!rename.hidden && nameFor("a").textContent === "<script>literal</script>", "IME confirmation does not commit the layer name");
  assert(!event(rename, "keydown", rename, { key: "Enter", keyCode: 229 }).defaultPrevented);
  assert(!rename.hidden, "legacy IME keycode is also retained for composition");
  rename.value = "Renamed"; event(rename, "keydown", rename, { key: "Enter" });
  assert.deepEqual(calls.at(-1), ["update", "a", { name: "Renamed" }]);
  assert.equal(nameFor("a").textContent, "Renamed"); assert.equal(document.activeElement, rowFor("a"));
  assert.equal(rowFor("b"), otherRow, "committing a name retains other rows so a blur cannot swallow the following layer click");
  event(rowFor("a"), "keydown", rowFor("a"), { key: "F2" });
  control("a", "rename").value = "Discard me";
  event(control("a", "rename"), "keydown", control("a", "rename"), { key: "Escape" });
  assert.equal(nameFor("a").textContent, "Renamed", "Escape cancels inline name changes");
  event(rowFor("a"), "keydown", rowFor("a"), { key: "Enter" });
  control("a", "rename").value = "Renamed on blur"; event(control("a", "rename"), "blur");
  assert.equal(nameFor("a").textContent, "Renamed on blur", "blur commits the name");
  const locked = control("a", "locked"); locked.checked = true; event(locked, "change");
  assert(control("a", "visible").disabled); assert.equal(control("a", "locked").title, "Lock visibility");
  const unlock = control("a", "locked"); unlock.checked = false; event(unlock, "change");
  const visible = control("a", "visible"); visible.checked = false; event(visible, "change");
  assert.deepEqual(calls.at(-1), ["update", "a", { defaultVisible: false }], "visibility is changed directly in the same row");
  click("down"); assert.equal(order[0].children[1].groupId, "a");
  const orderCalls = () => calls.filter(call => call[0] === "order").length;
  const start = (id = "a", pointerType = "touch", pointerId = 10) => {
    const bounds = rowFor(id).getBoundingClientRect(), y = bounds.top + bounds.height / 2;
    const down = pointer(gripFor(id), "pointerdown", pointerId, 12, y, pointerType);
    assert(down.defaultPrevented && node("list").hasPointerCapture(pointerId), `${pointerType} grip owns the drag pointer`);
    return { pointerId, pointerType, x: 12, y };
  };
  const moveTo = (drag, id, position = "after") => {
    const bounds = rowFor(id).getBoundingClientRect(), y = position === "before" ? bounds.top + 2 : bounds.bottom - 2;
    pointer(window, "pointermove", drag.pointerId, drag.x, y, drag.pointerType); return y;
  };
  const end = (drag, y, props = {}) => pointer(window, "pointerup", drag.pointerId, drag.x, y, drag.pointerType, props);
  const resetOrder = () => { order = initialOrder; revision++; notify(); node("list").scrollTop = 0; };
  for (const pointerType of ["touch", "mouse", "pen"]) {
    resetOrder(); const before = orderCalls(), drag = start("a", pointerType);
    assert.equal(gripFor("a").draggable, false, "grips use the shared Pointer Events path, not HTML drag-and-drop");
    pointer(window, "pointermove", drag.pointerId, drag.x + 1, drag.y + 1, drag.pointerType);
    assert.notEqual(rowFor("a").dataset.dragging, "true", "small finger jitter does not start dragging");
    const y = moveTo(drag, "c");
    assert.equal(rowFor("c").dataset.dropPosition, "after", "the pointer drag exposes its actual insertion target");
    assert.equal(orderCalls(), before, "moving the pointer only previews order");
    end(drag, y);
    assert.equal(orderCalls(), before + 1, "release commits one undoable reorder");
    assert.equal(order[2].groupId, "a", `${pointerType} dragging below a row updates PDF order`);
    assert.equal(active, "a"); assert.equal(document.activeElement, rowFor("a"));
    assert.equal(node("list").captures.size, 0); assert.equal(frames.size, 0);
  }
  for (const cancel of ["pointercancel", "lostpointercapture", "blur", "Escape", "secondary", "outside"]) {
    resetOrder(); const before = orderCalls(), drag = start(); const y = moveTo(drag, "c");
    if (cancel === "pointercancel") pointer(window, "pointercancel", drag.pointerId, drag.x, y);
    if (cancel === "lostpointercapture") pointer(node("list"), "lostpointercapture", drag.pointerId, drag.x, y);
    if (cancel === "blur") event(window, "blur");
    if (cancel === "Escape") event(window, "keydown", window, { key: "Escape" });
    if (cancel === "secondary") pointer(window, "pointerdown", drag.pointerId + 1, 20, y, "touch", { isPrimary: false });
    if (cancel === "outside") end(drag, 1000);
    else end(drag, y);
    assert.equal(orderCalls(), before, `${cancel} cancels without committing order`);
    assert.equal(node("list").captures.size, 0); assert.equal(frames.size, 0);
    assert(rows().every(row => !row.dataset.dropPosition && !row.dataset.dragging), "cancellation removes every drag indicator");
  }
  {
    resetOrder(); const before = orderCalls(), drag = start();
    const y = moveTo(drag, "a", "after"); end(drag, y);
    assert.equal(orderCalls(), before, "self/no-op drops do not enter history");
    const rejected = pointer(gripFor("a"), "pointerdown", 40, 10, 150, "mouse", { button: 2 });
    assert(!rejected.defaultPrevented && !node("list").hasPointerCapture(40), "secondary mouse buttons do not start a drag");
  }
  {
    resetOrder(); const before = orderCalls(), drag = start(); const y = moveTo(drag, "c");
    pointer(window, "pointerup", drag.pointerId + 1, drag.x, y);
    assert.equal(orderCalls(), before); assert(node("list").hasPointerCapture(drag.pointerId), "only the matching release can finish a drag");
    end(drag, y); assert.equal(orderCalls(), before + 1);
  }
  {
    const before = orderCalls(), bounds = nameFor("a").getBoundingClientRect();
    const down = pointer(nameFor("a"), "pointerdown", 50, 100, bounds.top + 16);
    assert(!down.defaultPrevented && node("list").captures.size === 0, "touches outside a grip remain available for list scrolling");
    pointer(window, "pointermove", 50, 100, bounds.top - 40); pointer(window, "pointerup", 50, 100, bounds.top - 40);
    assert.equal(orderCalls(), before);
  }
  {
    const previousLayers = layers, previousOrder = order;
    const extra = Array.from({ length: 7 }, (_, index) => group(`extra-${index}`));
    layers = [...layers, ...extra]; order = [...initialOrder, ...extra.map(layer => ({ kind: "group", groupId: layer.id }))];
    revision++; notify(); node("list").clientHeight = 96; node("list").scrollTop = 0;
    const before = orderCalls(), drag = start(), bottom = node("list").getBoundingClientRect().bottom - 2;
    pointer(window, "pointermove", drag.pointerId, drag.x, bottom);
    assert(frames.size > 0, "a held grip near the scroll edge schedules scrolling");
    for (let time = 0; time <= 48; time += 16) frame(time);
    assert(node("list").scrollTop > 0, "a stationary finger scrolls a longer layer list");
    assert(rows().some(row => row.dataset.layerId !== "a" && row.dataset.dropPosition), "scrolling recomputes the insertion target underneath the held finger");
    assert.equal(orderCalls(), before, "scrolling a held preview does not commit intermediate order");
    end(drag, bottom); assert.equal(orderCalls(), before + 1); assert.equal(frames.size, 0);
    layers = previousLayers; order = previousOrder; node("list").clientHeight = 160; node("list").scrollTop = 0; revision++; notify();
  }
  {
    const before = orderCalls(), drag = start(); moveTo(drag, "c");
    node("filter").value = "b"; event(node("filter"), "input");
    assert.equal(node("list").captures.size, 0, "filtering cancels the drag before replacing its rows");
    end(drag, 220); assert.equal(orderCalls(), before); assert.equal(frames.size, 0);
    node("filter").value = ""; event(node("filter"), "input");
  }
  event(rowFor("a"), "keydown", rowFor("a"), { key: "ArrowUp", altKey: true });
  assert.equal(order[1].groupId, "a", "Alt+Up is an accessible reorder fallback");
  selection = ["object"]; notify(); node("assignment").value = "b"; click("assign"); assert.deepEqual(calls.at(-1), ["assign", "b"]);
  node("new-name").value = "Imported drawings"; click("add"); assert.equal(active, "new"); assert.equal(nameFor("new").textContent, "Imported drawings");
  node("parent").value = "b"; change("parent"); assert.deepEqual(calls.at(-1), ["parent", "new", { parentId: "b", index: 0 }]);
  click("select"); assert.deepEqual(calls.at(-1), ["select", "new"]);
  node("target").value = "b"; click("remove"); assert.deepEqual(calls.at(-1), ["remove", "new", { targetLayerId: "b" }]);
  node("filter").value = "missing"; event(node("filter"), "input");
  assert(node("list").childNodes.some(child => child.textContent === "No matching layers."));
  assert(unlayered(), "filtering cannot remove the unlayered destination");
  widget.show(); assert(panel.open && panel.scrolled && document.activeElement === unlayered());
  node("filter").value = ""; event(node("filter"), "input");
  const beforeView = orderCalls(), viewDrag = start(); moveTo(viewDrag, "c");
  widget.setActive(false); assert(panel.hidden); assert.equal(listeners.size, 0); assert(!container.classList.contains("hepr-layer-editor-active"));
  end(viewDrag, 220); assert.equal(orderCalls(), beforeView); assert.equal(node("list").captures.size, 0); assert.equal(frames.size, 0);
  widget.setActive(true); const beforeDispose = orderCalls(), disposeDrag = start(); moveTo(disposeDrag, "c");
  widget.dispose(); end(disposeDrag, 220);
  assert.equal(orderCalls(), beforeDispose); assert.equal(container.childNodes.length, 0); assert.equal(listeners.size, 0); assert.equal(node("list").captures.size, 0); assert.equal(frames.size, 0); assert.deepEqual(errors, []);
  console.log("Editor layer controls: direct active/unlayered rows, inline rename, visibility/lock, touch/mouse/pen drag, cancellation, keyboard fallback, CRUD and View detachment passed.");
} finally { hooks.deregister(); }
