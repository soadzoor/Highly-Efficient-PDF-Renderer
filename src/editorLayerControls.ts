import type { EditorSession } from "./editorTypes";
import type { OptionalContentGroup, OptionalContentOrderNode } from "./optionalContentData";
import { toolbarButton } from "./toolbarIcons";

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
    <p>Reorder to paint top layers in front. Unlayered artwork keeps its existing position; compositing groups move together.</p>
    <label>New objects <select data-layer="active" aria-label="Active layer for new objects"></select></label>
    <div class="hepr-editor-layer-add"><input data-layer="new-name" placeholder="New layer name" aria-label="New layer name">${toolbarButton("add-layer", "Add a layer", 'data-layer="add"')}</div>
    <label>Filter layers <input data-layer="filter" type="search" placeholder="Layer name"></label>
    <div data-layer="list" class="hepr-editor-layer-list" role="group" aria-label="Document layers"></div>
    <fieldset data-layer="properties"><legend>Selected layer</legend>
      <label>Name <input data-layer="name" aria-label="Layer name"></label>
      <label><input data-layer="visible" type="checkbox"> Visible by default</label>
      <label><input data-layer="locked" type="checkbox"> Lock visibility</label>
      <label>Parent <select data-layer="parent" aria-label="Parent layer"></select></label>
      <div class="hepr-editor-layer-actions">${toolbarButton("search-previous", "Move layer up", 'data-layer="up"')}${toolbarButton("search-next", "Move layer down", 'data-layer="down"')}<button type="button" data-layer="select">Select contents</button></div>
      <label>On removal <select data-layer="target" aria-label="Destination when removing layer"></select></label>
      <button type="button" data-layer="remove">Remove layer, keep artwork</button>
    </fieldset>
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
  function renderList(): void {
    list.replaceChildren();
    const needle = input("filter").value.trim().toLocaleLowerCase(), headingsSeen = new Set<string>();
    for (const { layer, depth, headings } of entries) {
      if (needle && !layer.name.toLocaleLowerCase().includes(needle)) continue;
      for (const heading of headings) if (!headingsSeen.has(heading.id)) {
        const label = document.createElement("div"); label.className = "hepr-editor-layer-heading";
        label.textContent = heading.label; label.style.paddingInlineStart = `${heading.depth * 12}px`; list.append(label); headingsSeen.add(heading.id);
      }
      const row = document.createElement("div"); row.className = "hepr-editor-layer-row"; row.style.paddingInlineStart = `${depth * 12}px`;
      const visible = document.createElement("input"); visible.type = "checkbox"; visible.checked = layer.defaultVisible;
      visible.disabled = layer.locked || !layer.usedInView; visible.setAttribute("aria-label", `Show ${layer.name}`);
      visible.title = layer.locked ? "Layer visibility is locked" : !layer.usedInView ? "This layer is excluded by the PDF View intent" : "Default visibility (saved in PDF and HEP)";
      visible.addEventListener("change", () => act(() => session.updateLayer(layer.id, { defaultVisible: visible.checked })));
      const name = document.createElement("button"); name.type = "button"; name.textContent = layer.name || "Unnamed layer";
      name.setAttribute("aria-pressed", String(selected === layer.id)); name.title = `${layer.name}\n${layer.id}`;
      name.addEventListener("click", () => { selected = layer.id; renderList(); renderProperties(); });
      row.append(visible, name); list.append(row);
    }
    if (!list.childNodes.length) list.textContent = layers.length ? "No matching layers." : "No layers yet. Add a layer to organize this document.";
  }
  function renderProperties(): void {
    const layer = layers.find(item => item.id === selected), entry = entries.find(item => item.layer.id === selected);
    properties.disabled = !layer;
    input("name").value = layer?.name ?? ""; input("visible").checked = layer?.defaultVisible ?? false;
    input("visible").disabled = !layer || layer.locked || !layer.usedInView; input("locked").checked = layer?.locked ?? false;
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
    const catalogChanged = force || nextRevision !== revision;
    if (catalogChanged) {
      revision = nextRevision; layers = session.getLayers(); entries = editorLayerEntries(layers, session.getLayerOrder());
      if (!layers.some(layer => layer.id === selected)) selected = layers[0]?.id ?? null;
      const values = entries.map(({ layer, depth }) => ({ id: layer.id, name: `${"  ".repeat(depth)}${layer.name}` }));
      choices(select("active"), values, "Unlayered", nextActive ?? "");
      choices(select("assignment"), values, "Unlayered", select("assignment").value);
      renderList(); renderProperties();
    } else if (nextActive !== activeLayer) select("active").value = nextActive ?? "";
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
    if (name === "active") act(() => session.setActiveLayer(select("active").value || null));
    if (!selected) return;
    if (name === "name") act(() => session.updateLayer(selected!, { name: input("name").value }));
    if (name === "visible") act(() => session.updateLayer(selected!, { defaultVisible: input("visible").checked }));
    if (name === "locked") act(() => session.updateLayer(selected!, { locked: input("locked").checked }));
    if (name === "parent") act(() => session.moveLayer(selected!, { parentId: select("parent").value || null, index: 0 }));
  }, { signal: lifetime.signal });
  input("filter").addEventListener("input", renderList, { signal: lifetime.signal });
  return {
    setActive(value) {
      if (disposed || active === value) return;
      active = value; panel.hidden = !value; container.classList.toggle("hepr-layer-editor-active", value);
      unsubscribe?.(); unsubscribe = value ? session.subscribe(state => { if (!state.previewing) refresh(); }) : undefined;
      if (value) refresh(true);
    },
    show() { panel.open = true; panel.scrollIntoView?.({ block: "nearest" }); select("active").focus(); },
    refresh: () => refresh(true),
    dispose() { if (disposed) return; disposed = true; unsubscribe?.(); lifetime.abort(); panel.remove(); container.classList.remove("hepr-layer-editor-active"); }
  };
}
