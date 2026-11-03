import type { EditorSession } from "./editorTypes";
import type { OptionalContentGroup, OptionalContentOrderNode } from "./optionalContentData";
import { toolbarButton, toolbarIconMarkup } from "./toolbarIcons";
import { createEditorLayerDrag } from "./editorLayerDrag";

interface LayerHeading { id: string; label: string; depth: number; }
interface LayerEntry { layer: OptionalContentGroup; depth: number; parentId: string | null; index: number; siblings: number; headings: readonly LayerHeading[]; }

/** Flatten the OCG hierarchy for controls, retaining labels and unlisted groups. */
export function editorLayerEntries(layers: readonly OptionalContentGroup[], order: readonly OptionalContentOrderNode[]): LayerEntry[] {
  const byId = new Map(layers.map(layer => [layer.id, layer])), seen = new Set<string>(), entries: LayerEntry[] = [];
  function visit(nodes: readonly OptionalContentOrderNode[], depth: number, parentId: string | null, headings: readonly LayerHeading[] = [], path = "root"): void {
    nodes.forEach((node, index) => {
      const id = `${path}/${index}`;
      if (node.kind === "label") { visit(node.children, depth + 1, parentId, [...headings, { id, label: node.label, depth }], id); return; }
      const layer = byId.get(node.groupId);
      if (layer && !seen.has(layer.id)) { seen.add(layer.id); entries.push({ layer, depth, parentId, index, siblings: nodes.length, headings }); }
      if (node.children) visit(node.children, depth + 1, layer?.id ?? parentId, headings, id);
    });
  }
  visit(order, 0, null);
  for (const layer of layers) if (!seen.has(layer.id)) entries.push({ layer, depth: 0, parentId: null, index: order.length, siblings: order.length + 1, headings: [] });
  return entries;
}

/** Reorder siblings without erasing PDF heading nodes or nested layer groups. */
export function reorderEditorLayerNodes(order: readonly OptionalContentOrderNode[], id: string, direction: -1 | 1): readonly OptionalContentOrderNode[] {
  const index = order.findIndex(node => node.kind === "group" && node.groupId === id);
  if (index >= 0) {
    const next = index + direction;
    if (next < 0 || next >= order.length) return order;
    const result = [...order]; [result[index], result[next]] = [result[next], result[index]]; return result;
  }
  return order.map(node => node.children ? { ...node, children: reorderEditorLayerNodes(node.children, id, direction) } : node);
}

/** Place a complete layer subtree beside another layer, retaining PDF headings. */
export function dropEditorLayerNode(order: readonly OptionalContentOrderNode[], id: string, targetId: string,
  position: "before" | "after"): readonly OptionalContentOrderNode[] {
  const find = (nodes: readonly OptionalContentOrderNode[], wanted: string): OptionalContentOrderNode | undefined => {
    for (const node of nodes) {
      if (node.kind === "group" && node.groupId === wanted) return node;
      const child = node.children && find(node.children, wanted); if (child) return child;
    }
  };
  const source = find(order, id);
  if (!source || id === targetId || !find(order, targetId) || find(source.children ?? [], targetId)) return order;
  const remove = (nodes: readonly OptionalContentOrderNode[]): OptionalContentOrderNode[] => nodes.flatMap(node =>
    node === source ? [] : [{ ...node, ...(node.children ? { children: remove(node.children) } : {}) }]);
  const insert = (nodes: readonly OptionalContentOrderNode[]): OptionalContentOrderNode[] => nodes.flatMap(node =>
    node.kind === "group" && node.groupId === targetId ? position === "before" ? [source, node] : [node, source]
      : [{ ...node, ...(node.children ? { children: insert(node.children) } : {}) }]);
  const result = insert(remove(order));
  return JSON.stringify(result) === JSON.stringify(order) ? order : result;
}

export interface EditorLayerControls {
  setActive(active: boolean): void;
  show(): void;
  refresh(): void;
  dispose(): void;
}

/** Editor-only controls; hosts can mount them beside either renderer's canvas. */
export function createEditorLayerControls(options: {
  container: HTMLElement;
  session: EditorSession;
  change(operation: () => void): void;
  onError?(error: unknown): void;
}): EditorLayerControls {
  const { container, session } = options, document = container.ownerDocument;
  const panel = document.createElement("details"); panel.className = "hepr-editor-layers"; panel.hidden = true; panel.open = true;
  panel.innerHTML = `<summary>PDF layers</summary>
    <p>Drag a grip to change stacking. Double-click a name to rename. The highlighted layer receives new and pasted objects.</p>
    <div class="hepr-editor-layer-add"><input data-layer="new-name" placeholder="New layer name" aria-label="New layer name">${toolbarButton("add-layer", "Add a layer", 'data-layer="add"')}</div>
    <label>Filter layers <input data-layer="filter" type="search" placeholder="Layer name"></label>
    <div class="hepr-editor-layer-columns" aria-hidden="true"><span></span><span>Layer</span><span title="Visible by default">${toolbarIconMarkup("view")}</span><span title="Lock visibility">${toolbarIconMarkup("lock")}</span></div>
    <div data-layer="list" class="hepr-editor-layer-list" role="group" aria-label="Document layers"></div>
    <details class="hepr-editor-layer-options"><summary>Layer options</summary>
    <fieldset data-layer="properties"><legend>Selected layer</legend>
      <label>Parent <select data-layer="parent" aria-label="Parent layer"></select></label>
      <div class="hepr-editor-layer-actions">${toolbarButton("search-previous", "Move layer up", 'data-layer="up"')}${toolbarButton("search-next", "Move layer down", 'data-layer="down"')}<button type="button" data-layer="select">Select contents</button></div>
      <label>On removal <select data-layer="target" aria-label="Destination when removing layer"></select></label>
      <button type="button" data-layer="remove">Remove layer, keep artwork</button>
    </fieldset></details>
    <label>Assign selection to <select data-layer="assignment" aria-label="Layer for selected objects"></select></label>
    <button type="button" data-layer="assign">Assign selection</button>
    <div data-layer="selection" class="hepr-editor-layer-selection"></div>
    <div data-layer="status" role="status" aria-live="polite"></div>`;
  container.append(panel);
  const query = <T extends HTMLElement>(name: string): T => panel.querySelector<T>(`[data-layer="${name}"]`)!;
  const input = (name: string): HTMLInputElement => query(name), select = (name: string): HTMLSelectElement => query(name);
  const list = query("list"), status = query("status"), properties = query<HTMLFieldSetElement>("properties");
  const lifetime = new AbortController();
  let active = false, disposed = false, selected: string | null = null, revision = -1, selectionKey = "", activeLayer: string | null | undefined;
  let entries: LayerEntry[] = [], layers: readonly OptionalContentGroup[] = [], unsubscribe: (() => void) | undefined;
  const rows = new Map<string, HTMLElement>();
  const controls = new Map<string, { visible: HTMLInputElement; locked: HTMLInputElement; name: HTMLButtonElement; rename: HTMLInputElement }>();
  const unlayered = document.createElement("div"); unlayered.className = "hepr-editor-layer-row hepr-editor-layer-unlayered";
  unlayered.dataset.layer = "unlayered"; unlayered.dataset.layerId = ""; unlayered.tabIndex = 0; unlayered.setAttribute("role", "group");
  const unlayeredName = document.createElement("button"); unlayeredName.type = "button"; unlayeredName.tabIndex = -1;
  unlayeredName.className = "hepr-editor-layer-name"; unlayeredName.textContent = "Unlayered";
  unlayeredName.title = "Place new and pasted objects outside PDF layers"; unlayered.append(unlayeredName);
  let renderedRows = "";
  let renaming: { id: string; input: HTMLInputElement; name: HTMLButtonElement } | null = null;
  const layerDrag = createEditorLayerDrag({ container: list,
    getRows: () => [...rows].map(([id, element]) => ({ id, element })),
    canDrop(source, target, position) {
      if (!active || disposed) return false;
      const order = session.getLayerOrder(); return dropEditorLayerNode(order, source, target, position) !== order;
    },
    start(source) { const row = rows.get(source); if (row) row.dataset.dragging = "true"; },
    preview(target, position) { clearDrop(); const row = target && rows.get(target); if (row && position) row.dataset.dropPosition = position; },
    drop(source, target, position) {
      if (!active || disposed) return;
      const order = session.getLayerOrder(), next = dropEditorLayerNode(order, source, target, position);
      if (next !== order) act(() => session.setLayerOrder(next));
      rows.get(source)?.focus();
    },
    end() { for (const row of rows.values()) delete row.dataset.dragging; clearDrop(); }
  });
  function chooseUnlayered(): void { activate(null); unlayered.focus(); }
  unlayeredName.addEventListener("click", chooseUnlayered);
  unlayered.addEventListener("click", event => { if (event.target === unlayered) chooseUnlayered(); });
  unlayered.addEventListener("keydown", event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); chooseUnlayered(); }
    else navigateRows(event, null);
  });
  function choices(control: HTMLSelectElement, values: readonly { id: string; name: string }[], first: string, value = ""): void {
    control.replaceChildren();
    for (const item of [{ id: "", name: first }, ...values]) {
      const option = document.createElement("option"); option.value = item.id; option.textContent = item.name; control.append(option);
    }
    control.value = value;
  }
  function act(operation: () => void): void {
    if (!active || disposed) return;
    try { options.change(operation); status.textContent = ""; refresh(true); }
    catch (error) { status.textContent = error instanceof Error ? error.message : String(error); options.onError?.(error); refresh(true); }
  }
  function markSelected(): void {
    unlayered.dataset.active = String(selected === null); unlayered.setAttribute("aria-current", String(selected === null));
    unlayered.setAttribute("aria-label", `Unlayered${selected === null ? ", active layer" : ""}`);
    for (const [id, row] of rows) {
      row.dataset.active = String(id === selected);
      row.setAttribute("aria-current", String(id === selected));
      row.setAttribute("aria-label", `${layers.find(layer => layer.id === id)?.name ?? id}${id === selected ? ", active layer" : ""}`);
    }
  }
  function activate(id: string | null): void {
    if (!active || disposed) return;
    try {
      selected = id; session.setActiveLayer(id); status.textContent = "";
      activeLayer = id; markSelected(); renderProperties();
    } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); options.onError?.(error); refresh(true); }
  }
  function finishRename(commit: boolean, focus = true): void {
    const edit = renaming; if (!edit) return;
    renaming = null; edit.input.hidden = true; edit.name.hidden = false;
    const name = edit.input.value.trim(), original = layers.find(layer => layer.id === edit.id)?.name;
    if (commit && name !== original) act(() => session.updateLayer(edit.id, { name }));
    if (focus) rows.get(edit.id)?.focus();
  }
  function startRename(id: string, name: HTMLButtonElement, control: HTMLInputElement): void {
    if (renaming?.id === id) return;
    finishRename(true, false); activate(id); renaming = { id, input: control, name };
    control.value = layers.find(layer => layer.id === id)?.name ?? "";
    name.hidden = true; control.hidden = false; control.focus(); control.select();
  }
  function clearDrop(): void {
    for (const row of rows.values()) delete row.dataset.dropPosition;
  }
  function navigateRows(event: KeyboardEvent, id: string | null): void {
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const items = [{ id: null, element: unlayered }, ...[...rows].map(([id, element]) => ({ id, element }))], index = items.findIndex(item => item.id === id);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)));
      activate(items[next].id); items[next].element.focus(); items[next].element.scrollIntoView?.({ block: "nearest" });
    } else if (["Delete", "Backspace", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
    }
  }
  function renderList(): void {
    const needle = input("filter").value.trim().toLocaleLowerCase(), headingsSeen = new Set<string>();
    const matching = entries.filter(({ layer }) => !needle || layer.name.toLocaleLowerCase().includes(needle));
    const key = JSON.stringify(matching.map(({ layer, depth, headings }) => [layer.id, depth, headings]));
    if (key === renderedRows && rows.size) {
      for (const { layer } of matching) {
        const control = controls.get(layer.id)!;
        control.name.textContent = layer.name || "Unnamed layer"; control.name.title = `${layer.name}\nDouble-click, Enter or F2 to rename`;
        control.visible.checked = layer.defaultVisible; control.visible.disabled = layer.locked || !layer.usedInView;
        control.visible.setAttribute("aria-label", `Visible by default: ${layer.name}`);
        control.visible.title = layer.locked ? "Layer visibility is locked" : !layer.usedInView ? "This layer is excluded by the PDF View intent" : "Default visibility (saved in PDF and HEP)";
        control.locked.checked = layer.locked; control.locked.setAttribute("aria-label", `Lock visibility: ${layer.name}`);
        control.rename.setAttribute("aria-label", `Rename layer: ${layer.name}`);
      }
      markSelected(); return;
    }
    layerDrag.cancel(); renderedRows = key; renaming = null; rows.clear(); controls.clear(); list.replaceChildren(unlayered);
    for (const { layer, depth, headings } of matching) {
      for (const heading of headings) if (!headingsSeen.has(heading.id)) {
        const label = document.createElement("div"); label.className = "hepr-editor-layer-heading";
        label.textContent = heading.label; label.style.paddingInlineStart = `min(${heading.depth * 12}px, 25%)`; list.append(label); headingsSeen.add(heading.id);
      }
      const row = document.createElement("div"); row.className = "hepr-editor-layer-row"; row.style.paddingInlineStart = `min(${depth * 12}px, 25%)`;
      row.tabIndex = 0; row.setAttribute("role", "group"); row.dataset.layerId = layer.id; rows.set(layer.id, row);
      const grip = document.createElement("button"); grip.type = "button"; grip.className = "hepr-editor-layer-grip"; grip.draggable = false; grip.tabIndex = -1;
      grip.innerHTML = toolbarIconMarkup("drag-handle"); grip.title = "Drag with mouse, touch or pen to reorder; Alt+Up/Down moves the active layer"; grip.setAttribute("aria-label", `Reorder ${layer.name}`);
      const visible = document.createElement("input"); visible.type = "checkbox"; visible.checked = layer.defaultVisible;
      visible.dataset.layerControl = "visible"; visible.disabled = layer.locked || !layer.usedInView; visible.setAttribute("aria-label", `Visible by default: ${layer.name}`);
      visible.title = layer.locked ? "Layer visibility is locked" : !layer.usedInView ? "This layer is excluded by the PDF View intent" : "Default visibility (saved in PDF and HEP)";
      visible.addEventListener("change", () => act(() => session.updateLayer(layer.id, { defaultVisible: visible.checked })));
      const locked = document.createElement("input"); locked.type = "checkbox"; locked.checked = layer.locked; locked.dataset.layerControl = "locked";
      locked.title = "Lock visibility"; locked.setAttribute("aria-label", `Lock visibility: ${layer.name}`);
      locked.addEventListener("change", () => act(() => session.updateLayer(layer.id, { locked: locked.checked })));
      const name = document.createElement("button"); name.type = "button"; name.className = "hepr-editor-layer-name"; name.tabIndex = -1;
      name.textContent = layer.name || "Unnamed layer"; name.title = `${layer.name}\nDouble-click, Enter or F2 to rename`;
      const rename = document.createElement("input"); rename.type = "text"; rename.className = "hepr-editor-layer-rename"; rename.hidden = true;
      rename.setAttribute("aria-label", `Rename layer: ${layer.name}`); rename.dataset.layerControl = "rename";
      controls.set(layer.id, { visible, locked, name, rename });
      name.addEventListener("click", () => { activate(layer.id); row.focus(); });
      name.addEventListener("dblclick", event => { event.preventDefault(); startRename(layer.id, name, rename); });
      row.addEventListener("click", event => { if (event.target === row) { activate(layer.id); row.focus(); } });
      grip.addEventListener("pointerdown", event => {
        if (!active || disposed) return;
        finishRename(true, false);
        if (rows.has(layer.id) && layerDrag.begin(event, layer.id)) { activate(layer.id); rows.get(layer.id)?.focus(); }
      });
      grip.addEventListener("dragstart", event => event.preventDefault());
      grip.addEventListener("contextmenu", event => { event.preventDefault(); event.stopPropagation(); });
      row.addEventListener("keydown", event => {
        if (event.target === rename || event.target === visible || event.target === locked) return;
        if (event.isComposing || event.keyCode === 229) { event.stopPropagation(); return; }
        if (event.key === "F2" || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); startRename(layer.id, name, rename); }
        else if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
          event.preventDefault(); event.stopPropagation(); activate(layer.id);
          act(() => session.setLayerOrder(reorderEditorLayerNodes(session.getLayerOrder(), layer.id, event.key === "ArrowUp" ? -1 : 1)));
          rows.get(layer.id)?.focus();
        } else navigateRows(event, layer.id);
      });
      rename.addEventListener("keydown", event => {
        event.stopPropagation();
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === "Enter" || event.key === "Escape") { event.preventDefault(); finishRename(event.key === "Enter"); }
      });
      rename.addEventListener("blur", () => finishRename(true, false));
      row.append(grip, name, rename, visible, locked); list.append(row);
    }
    markSelected();
    if (!matching.length) {
      const empty = document.createElement("div"); empty.className = "hepr-editor-layer-empty";
      empty.textContent = layers.length ? "No matching layers." : "No layers yet. Add a layer to organize this document."; list.append(empty);
    }
  }
  function renderProperties(): void {
    const layer = layers.find(item => item.id === selected), entry = entries.find(item => item.layer.id === selected);
    properties.disabled = !layer;
    const descendants = new Set<string>(), byId = new Map(entries.map(item => [item.layer.id, item]));
    for (const candidate of entries) {
      let parent = candidate.parentId;
      while (parent !== null) {
        if (parent === selected) { descendants.add(candidate.layer.id); break; }
        parent = byId.get(parent)?.parentId ?? null;
      }
    }
    const others = entries.filter(item => item.layer.id !== selected);
    choices(select("parent"), others.filter(item => !descendants.has(item.layer.id)).map(item => ({ id: item.layer.id, name: item.layer.name })), "Top level", entry?.parentId ?? "");
    choices(select("target"), others.map(item => ({ id: item.layer.id, name: item.layer.name })), "Keep artwork with remaining memberships");
    query<HTMLButtonElement>("up").disabled = !entry || entry.index <= 0;
    query<HTMLButtonElement>("down").disabled = !entry || entry.index >= entry.siblings - 1;
  }
  function refresh(force = false): void {
    if (disposed || !active) return;
    const nextRevision = session.getLayerRevision(), selection = session.getSelection(), key = JSON.stringify(selection), nextActive = session.getActiveLayer();
    if (nextActive !== activeLayer) selected = nextActive;
    const catalogChanged = force || nextRevision !== revision;
    if (catalogChanged) {
      revision = nextRevision; layers = session.getLayers(); entries = editorLayerEntries(layers, session.getLayerOrder());
      if (!layers.some(layer => layer.id === selected)) selected = null;
      const values = entries.map(({ layer, depth }) => ({ id: layer.id, name: `${"  ".repeat(depth)}${layer.name}` }));
      choices(select("assignment"), values, "Unlayered", select("assignment").value);
      renderList(); renderProperties();
    } else if (nextActive !== activeLayer) { markSelected(); renderProperties(); }
    activeLayer = nextActive;
    if (catalogChanged || key !== selectionKey) {
      selectionKey = key; query<HTMLButtonElement>("assign").disabled = !selection.length;
      const ids = new Set(selection.flatMap(id => session.getObjectLayerIds(id))), byId = new Map(layers.map(layer => [layer.id, layer.name]));
      query("selection").textContent = selection.length ? `${selection.length} selected. Layers: ${ids.size ? [...ids].map(id => byId.get(id) ?? id).join(", ") : "unlayered"}.` : "Select objects to assign them to a layer.";
    }
  }
  panel.addEventListener("click", event => {
    const name = (event.target as Element).closest<HTMLElement>("button[data-layer]")?.dataset.layer;
    if (name === "add") act(() => {
      selected = session.createLayer({ name: input("new-name").value.trim() || `Layer ${layers.length + 1}` });
      session.setActiveLayer(selected); input("new-name").value = "";
    });
    if (name === "remove" && selected) act(() => session.removeLayer(selected!, { targetLayerId: select("target").value || null }));
    if (name === "select" && selected) act(() => session.selectLayerContents(selected!));
    if (name === "assign") act(() => session.assignSelectionToLayer(select("assignment").value || null));
    if ((name === "up" || name === "down") && selected) act(() => {
      session.setLayerOrder(reorderEditorLayerNodes(session.getLayerOrder(), selected!, name === "up" ? -1 : 1));
    });
  }, { signal: lifetime.signal });
  panel.addEventListener("change", event => {
    const name = (event.target as HTMLElement).dataset.layer;
    if (!selected) return;
    if (name === "parent") act(() => session.moveLayer(selected!, { parentId: select("parent").value || null, index: 0 }));
  }, { signal: lifetime.signal });
  input("filter").addEventListener("input", () => { layerDrag.cancel(); renderList(); }, { signal: lifetime.signal });
  return {
    setActive(value) {
      if (disposed || active === value) return;
      if (!value) { layerDrag.cancel(); finishRename(true, false); }
      active = value; panel.hidden = !value; container.classList.toggle("hepr-layer-editor-active", value);
      unsubscribe?.(); unsubscribe = value ? session.subscribe(state => { if (!state.previewing) refresh(); }) : undefined;
      if (value) refresh(true);
    },
    show() { panel.open = true; panel.scrollIntoView?.({ block: "nearest" }); (selected === null ? unlayered : rows.get(selected) ?? unlayered).focus(); },
    refresh: () => refresh(true),
    dispose() { if (disposed) return; disposed = true; layerDrag.dispose(); unsubscribe?.(); lifetime.abort(); panel.remove(); container.classList.remove("hepr-layer-editor-active"); }
  };
}
