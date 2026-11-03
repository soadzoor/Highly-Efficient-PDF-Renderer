import type { EditorLink, EditorObject, EditorSession } from "./editorTypes";
import type { AnnotationDestination } from "./annotationData";

/** The editable target choices deliberately exclude PDF executable actions. */
export interface EditorLinkDraft {
  ids: string[];
  type: "url" | "object" | "destination";
  url: string;
  objectId: string;
  destination?: AnnotationDestination;
}

export interface EditorLinkControllerOptions {
  document: Document;
  session: EditorSession;
  canEdit(): boolean;
  /** Throw on failure so the dialog can keep its pending values. */
  change(operation: () => void): void;
  onError(error: unknown): void;
  onStatus?(message: string): void;
  onDraftChange?(): void;
  /** Hosts keep their own picker and pass its result to pickTarget(). */
  onPickingChange?(active: boolean): void;
}

function targetLabel(object: EditorObject): string {
  const name = object.kind === "text" ? object.runs?.map(run => run.text).join("") ?? object.text
    : object.kind === "shape" && object.review ? `${object.review.type}: ${object.review.contents ?? ""}`
      : object.kind === "shape" ? object.shape : object.kind === "source" && object.annotationId ? `Annotation ${object.annotationId}` : object.kind;
  return `Page ${object.pageIndex + 1} — ${name.replace(/\s+/g, " ").trim().slice(0, 80) || object.id}`;
}

/** Link creation stays outside picking/rendering and adds no View-mode work. */
export function createEditorLinkController(options: EditorLinkControllerOptions) {
  const { document, session } = options, window = document.defaultView!;
  let active = false, disposed = false, picking = false;
  let draft: EditorLinkDraft | null = null, baseline = "", dialog: HTMLDialogElement | null = null, status: HTMLElement | null = null;
  let pickEvents: AbortController | null = null;
  const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
  const canEditIds = (ids: readonly string[]): boolean => {
    if (!active || disposed || !options.canEdit() || !ids.length) return false;
    // isObjectLocked validates identities without cloning images/geometry just
    // to refresh toolbar availability.
    try { return ids.every(id => !session.isObjectLocked(id)); } catch { return false; }
  };
  function report(error: unknown): void {
    const text = error instanceof Error ? error.message : String(error);
    if (status) status.textContent = text;
    options.onError(error);
  }
  function removeDialog(): void { dialog?.close(); dialog?.remove(); dialog = null; status = null; }
  function endPick(): void {
    pickEvents?.abort(); pickEvents = null;
    if (!picking) return; picking = false; options.onPickingChange?.(false);
  }
  function close(): void {
    const hadDraft = draft !== null; endPick(); removeDialog(); draft = null;
    if (hadDraft) options.onDraftChange?.();
  }
  function apply(): boolean {
    if (!draft) return true;
    if (picking) { options.onStatus?.("Choose a destination object, or press Escape to return to link settings."); return false; }
    if (!canEditIds(draft.ids)) { report(new Error("The linked selection is no longer editable. Unlock it or cancel the link settings.")); return false; }
    try {
      const value: EditorLink = draft.type === "url" ? { type: "url", url: draft.url.trim() } : draft.type === "destination" && draft.destination
        ? { type: "destination", destination: { ...draft.destination, parameters: draft.destination.parameters?.slice() } } : { type: "object", objectId: draft.objectId };
      if (value.type === "url" && !value.url) throw new Error("Enter the destination URL.");
      if (value.type === "object" && !value.objectId) throw new Error("Choose a destination object.");
      options.change(() => session.transaction("Set links", () => {
        for (const id of draft!.ids) session.setObjectLink(id, value);
      }));
      const count = draft.ids.length; close(); options.onStatus?.(`${count === 1 ? "Link" : `${count} links`} applied.`); return true;
    } catch (error) { report(error); return false; }
  }
  function show(): void {
    if (!draft || disposed || !active) return;
    removeDialog();
    const current = draft;
    dialog = document.createElement("dialog"); dialog.className = "hepr-editor-link-dialog"; dialog.setAttribute("aria-label", "Edit link");
    const title = document.createElement("h2"); title.textContent = current.ids.length === 1 ? "Link" : `Link ${current.ids.length} objects`;
    const typeLabel = document.createElement("label"); typeLabel.textContent = "Destination ";
    const type = document.createElement("select"); type.setAttribute("aria-label", "Link destination type");
    for (const [value, name] of [["url", "Web address (URL)"], ["object", "Object in this document"]]) {
      const item = document.createElement("option"); item.value = value; item.textContent = name; type.append(item);
    }
    if (current.destination) { const item = document.createElement("option"); item.value = "destination"; item.textContent = "Existing PDF page destination"; type.append(item); }
    type.value = current.type; typeLabel.append(type);
    const urlLabel = document.createElement("label"); urlLabel.textContent = "URL ";
    const url = document.createElement("input"); url.type = "url"; url.value = current.url; url.placeholder = "https://example.com";
    url.setAttribute("autocomplete", "url"); url.spellcheck = false; url.setAttribute("aria-label", "Link URL"); urlLabel.append(url);
    const objectFields = document.createElement("div"); objectFields.className = "hepr-editor-link-object";
    const objectLabel = document.createElement("label"); objectLabel.textContent = "Object ";
    const target = document.createElement("select"); target.setAttribute("aria-label", "Link destination object");
    const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "Choose an object or pick it in the document"; target.append(placeholder);
    const known = session.getObjects({ includeSource: false }).filter(object => !current.ids.includes(object.id));
    const listed = new Set(known.map(object => object.id));
    if (current.objectId && !listed.has(current.objectId)) {
      try { const object = session.getObject(current.objectId); known.push(object); }
      catch { const removed = document.createElement("option"); removed.value = current.objectId; removed.textContent = "Destination object was removed"; removed.disabled = true; target.append(removed); }
    }
    for (const object of known) { const item = document.createElement("option"); item.value = object.id; item.textContent = targetLabel(object); item.title = object.id; target.append(item); }
    target.value = current.objectId; objectLabel.append(target);
    const pick = document.createElement("button"); pick.type = "button"; pick.textContent = "Pick in document"; pick.title = "Choose the destination by clicking an object in the document"; pick.dataset.linkAction = "pick";
    const detail = document.createElement("p"); detail.className = "hepr-editor-link-detail"; detail.textContent = "The reference follows the destination object's position while editing. The PDF stores a standard same-document destination.";
    objectFields.append(objectLabel, pick, detail);
    const destination = document.createElement("p"); destination.className = "hepr-editor-link-detail";
    const saved = current.destination;
    destination.textContent = saved ? `${saved.name ? `Named destination: ${saved.name}. ` : ""}${saved.sourcePageIndex !== undefined ? `Page ${saved.sourcePageIndex + 1}. ` : ""}${saved.fit ? `${saved.fit} page view. ` : ""}Keep this destination, or choose an object to replace it.` : "";
    status = document.createElement("p"); status.setAttribute("role", "alert");
    const actions = document.createElement("div"); actions.className = "hepr-editor-link-actions";
    const save = document.createElement("button"), remove = document.createElement("button"), cancel = document.createElement("button");
    for (const button of [save, remove, cancel]) button.type = "button";
    save.textContent = "Apply"; save.dataset.linkAction = "apply";
    remove.textContent = "Remove link"; remove.dataset.linkAction = "remove"; remove.disabled = !current.ids.some(id => session.getObjectLink(id) !== null);
    cancel.textContent = "Cancel"; cancel.dataset.linkAction = "cancel"; actions.append(save, remove, cancel);
    const refresh = (): void => { urlLabel.hidden = current.type !== "url"; objectFields.hidden = current.type !== "object"; destination.hidden = current.type !== "destination"; };
    const changed = (): void => { if (status) status.textContent = ""; options.onDraftChange?.(); };
    type.addEventListener("change", () => { current.type = type.value as EditorLinkDraft["type"]; changed(); refresh(); });
    url.addEventListener("input", () => { current.url = url.value; changed(); });
    target.addEventListener("change", () => { current.objectId = target.value; changed(); });
    pick.addEventListener("click", () => {
      if (!canEditIds(current.ids)) return;
      removeDialog(); picking = true; pickEvents = new AbortController(); options.onPickingChange?.(true);
      options.onStatus?.("Click the destination object. Press Escape to return to link settings.");
      window.addEventListener("keydown", event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); endPick(); show(); }
      }, { capture: true, signal: pickEvents.signal });
    });
    save.addEventListener("click", apply); remove.addEventListener("click", () => {
      if (!canEditIds(current.ids)) return;
      try { options.change(() => session.transaction("Remove links", () => current.ids.forEach(id => session.setObjectLink(id, null)))); close(); options.onStatus?.("Links removed."); }
      catch (error) { report(error); }
    });
    cancel.addEventListener("click", close);
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    dialog.addEventListener("keydown", event => {
      if (event.key === "Escape") event.stopPropagation();
      if (!event.isComposing && event.keyCode !== 229 && event.key === "Enter" && (event.ctrlKey || event.metaKey || event.target === url)) { event.preventDefault(); apply(); }
    });
    dialog.append(title, typeLabel, urlLabel, objectFields, destination, status, actions); document.body.append(dialog); refresh(); dialog.showModal();
    (current.type === "url" ? url : current.type === "object" ? target : type).focus();
  }
  return {
    setActive(value: boolean) { if (active === value) return; active = value; if (!value) close(); },
    canEditSelection: () => canEditIds(session.getSelection()),
    canRemoveSelection: () => canEditIds(session.getSelection()) && session.getSelection().some(id => session.getObjectLink(id) !== null),
    editSelection(): boolean {
      const ids = session.getSelection(); if (!canEditIds(ids)) return false;
      close();
      const links = ids.map(id => session.getObjectLink(id)), common = links.every(link => same(link, links[0])) ? links[0] : null;
      draft = { ids: [...ids], type: common?.type ?? "url", url: common?.type === "url" ? common.url : "", objectId: common?.type === "object" ? common.objectId : "",
        ...(common?.type === "destination" ? { destination: { ...common.destination, parameters: common.destination.parameters?.slice() } } : {}) };
      baseline = JSON.stringify(draft); show(); return true;
    },
    removeSelection(): boolean {
      const ids = session.getSelection(); if (!canEditIds(ids)) return false;
      try { options.change(() => session.transaction("Remove links", () => ids.forEach(id => session.setObjectLink(id, null)))); close(); options.onStatus?.("Links removed."); return true; }
      catch (error) { report(error); return false; }
    },
    isOpen: () => draft !== null,
    hasOpenDialog: () => dialog !== null,
    isBusy: () => picking,
    isPicking: () => picking,
    pickTarget(id: string): boolean {
      if (!picking || !draft) return false;
      try {
        const object = session.getObject(id);
        if (draft.ids.includes(object.id)) throw new Error("Choose a different object as the destination.");
        draft.objectId = object.id; draft.type = "object"; endPick(); show(); options.onDraftChange?.(); return true;
      } catch (error) { report(error); return false; }
    },
    cancelPick() { if (!picking) return; endPick(); show(); },
    flushDraft: apply,
    hasDraftChanges: () => draft !== null && JSON.stringify(draft) !== baseline,
    getDraft: (): EditorLinkDraft | null => draft ? { ...draft, ids: [...draft.ids], ...(draft.destination ? { destination: { ...draft.destination, parameters: draft.destination.parameters?.slice() } } : {}) } : null,
    restoreDraft(value: unknown) {
      if (!value || typeof value !== "object") return;
      const data = value as EditorLinkDraft;
      if (!Array.isArray(data.ids) || data.ids.some(id => typeof id !== "string") || !["url", "object", "destination"].includes(data.type) || typeof data.url !== "string" || typeof data.objectId !== "string" || !canEditIds(data.ids)) return;
      if (data.type === "destination" && (!data.destination || typeof data.destination !== "object")) return;
      if (data.destination?.parameters !== undefined && !Array.isArray(data.destination.parameters)) return;
      close(); draft = { ids: [...data.ids], type: data.type, url: data.url, objectId: data.objectId,
        ...(data.destination ? { destination: { ...data.destination, parameters: data.destination.parameters?.slice() } } : {}) }; baseline = ""; show();
    },
    dispose() { if (disposed) return; close(); disposed = true; active = false; }
  };
}
