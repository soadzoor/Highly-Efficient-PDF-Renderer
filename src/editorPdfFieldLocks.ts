import type { EditorSession } from "./editorTypes";
import { NativePdfDocument } from "./pdf/nativeDocument";
import type { NativePdfAnnotationAppearance } from "./pdf/nativeForms";
import { isPdfDictionary, isPdfRef, type PdfDictionary, type PdfRef, type PdfValue } from "./pdf/nativeCos";
import { NativePdfWriter } from "./pdf/nativeWriter";

const LOCK_READ_ONLY = "HEPRLockReadOnly";
const replacements = new WeakMap<NativePdfWriter, Map<PdfDictionary, PdfDictionary>>();

/** Keep successive edits to direct field/widget dictionaries on the same snapshot. */
export function pendingEditorPdfDictionary(writer: NativePdfWriter, dictionary: PdfDictionary): PdfDictionary {
  const pending = replacements.get(writer), seen = new Set<PdfDictionary>();
  while (pending?.has(dictionary) && !seen.has(dictionary)) { seen.add(dictionary); dictionary = pending.get(dictionary)!; }
  return dictionary;
}
export function replaceEditorPdfDictionary(writer: NativePdfWriter, before: PdfDictionary, after: PdfDictionary): void {
  if (before === after) return;
  const current = pendingEditorPdfDictionary(writer, before);
  let pending = replacements.get(writer); if (!pending) replacements.set(writer, pending = new Map());
  if (current !== after) pending.set(current, after);
  pending.set(before, after);
}

export async function readEditorPdfAnnotationFlags(writer: NativePdfWriter, dictionary: PdfDictionary, signal?: AbortSignal): Promise<number> {
  let value = pendingEditorPdfDictionary(writer, dictionary).get("F");
  const seen = new Set<string>();
  while (isPdfRef(value)) {
    signal?.throwIfAborted();
    const key = `${value.objectNumber}:${value.generation}`; if (seen.has(key)) return 0;
    seen.add(key); value = writer.get(value) ?? await writer.document.resolveValue(value, signal);
  }
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** The marker belongs to the dictionary defining the effective /Ff, not an unrelated ancestor. */
export async function readEditorPdfFieldLockState(document: NativePdfDocument, dictionary: PdfDictionary,
  signal?: AbortSignal, writer?: NativePdfWriter): Promise<{ flags: number; readOnlyFromLock: boolean }> {
  const seen = new Set<PdfDictionary>();
  while (true) {
    signal?.throwIfAborted();
    if (writer) dictionary = pendingEditorPdfDictionary(writer, dictionary);
    if (seen.has(dictionary)) break;
    seen.add(dictionary);
    const rawFlags = dictionary.get("Ff"), flags = isPdfRef(rawFlags) && writer
      ? writer.get(rawFlags) ?? await document.resolveValue(rawFlags, signal) : await document.resolveValue(rawFlags, signal);
    if (typeof flags === "number") return { flags, readOnlyFromLock: Boolean(flags & 1) && dictionary.get(LOCK_READ_ONLY) === true };
    const rawParent = dictionary.get("Parent"), parent = isPdfRef(rawParent) && writer
      ? writer.get(rawParent) ?? await document.resolveValue(rawParent, signal) : await document.resolveValue(rawParent, signal);
    if (!isPdfDictionary(parent)) break;
    dictionary = parent;
  }
  return { flags: 0, readOnlyFromLock: false };
}

/** Preserve independent ReadOnly while making editor locks reversible after PDF reopening. */
export function setEditorPdfFieldReadOnly(dictionary: PdfDictionary, flags: number, readOnly: boolean, fromLock: boolean): void {
  const baseline = flags - (flags & 1);
  dictionary.set("Ff", baseline + (readOnly ? 1 : 0));
  if (fromLock) dictionary.set(LOCK_READ_ONLY, true); else dictionary.delete(LOCK_READ_ONLY);
}

/** Apply source locks to shared terminal fields, after values and appearances have been written. */
export async function applyEditorPdfSourceFieldLocks(writer: NativePdfWriter, session: EditorSession,
  widgets: readonly NativePdfAnnotationAppearance[], signal?: AbortSignal): Promise<void> {
  const document = writer.document, metadata = new Map(session.sourceScene.annotations?.map(annotation => [annotation.id, annotation]));
  const deleted = new Set(session.getAnnotationEdits().filter(edit => edit.deleted).map(edit => edit.id));
  const groups = new Map<string, { locked: boolean; readOnly: boolean; fromLock: boolean }>();
  const members: { widget: NativePdfAnnotationAppearance; name: string; locked: boolean }[] = [];
  for (const widget of widgets) {
    const name = metadata.get(widget.id)?.field?.name;
    if (!name || deleted.has(widget.id)) continue;
    const original = await readEditorPdfFieldLockState(document, widget.dictionary, signal);
    const locked = session.isObjectLocked(`annotation:${widget.id}`), group = groups.get(name) ?? { locked: false, readOnly: false, fromLock: false };
    group.locked ||= locked; group.readOnly ||= Boolean(original.flags & 1) && !original.readOnlyFromLock;
    group.fromLock ||= original.readOnlyFromLock;
    groups.set(name, group); members.push({ widget, name, locked });
  }
  const current = (dictionary: PdfDictionary, ref: PdfRef | null): PdfDictionary => {
    const pending = ref ? writer.get(ref) : undefined;
    return pendingEditorPdfDictionary(writer, isPdfDictionary(pending) ? pending : dictionary);
  };
  const write = (before: PdfDictionary, after: PdfDictionary, ref: PdfRef | null): void => {
    replaceEditorPdfDictionary(writer, before, after); if (ref) writer.set(ref, after);
  };
  for (const { widget, name, locked } of members) {
    signal?.throwIfAborted();
    const group = groups.get(name)!;
    if (!group.locked && !group.fromLock) continue;
    const dictionary = current(widget.dictionary, widget.ref);
    let owner = dictionary, ownerRef = widget.ref;
    // A named/typed widget is a merged terminal field. A bare widget's parent
    // owns its shared value; do not modify a higher, nonterminal /Ff ancestor.
    if (!dictionary.has("T") && !dictionary.has("FT") && dictionary.has("Parent")) {
      const raw = dictionary.get("Parent"), parent = isPdfRef(raw) ? writer.get(raw) ?? await document.resolveValue(raw, signal)
        : await document.resolveValue(raw, signal);
      if (isPdfDictionary(parent)) { ownerRef = isPdfRef(raw) ? raw : null; owner = current(parent, ownerRef); }
    }
    const state = await readEditorPdfFieldLockState(document, owner, signal, writer), next = new Map(owner);
    setEditorPdfFieldReadOnly(next, state.flags, group.readOnly || group.locked, !group.readOnly && group.locked);
    write(owner, next, ownerRef);
    const beforeWidget = current(widget.dictionary, widget.ref), nextWidget = new Map(beforeWidget);
    const annotationFlags = await readEditorPdfAnnotationFlags(writer, beforeWidget, signal);
    nextWidget.set("F", annotationFlags - (annotationFlags & 128) + (locked ? 128 : 0));
    // Nonstandard local widget flags must not override its terminal field lock.
    if (owner !== dictionary && beforeWidget.has("Ff")) {
      const local = await readEditorPdfFieldLockState(document, beforeWidget, signal, writer);
      setEditorPdfFieldReadOnly(nextWidget, local.flags, group.readOnly || group.locked, !group.readOnly && group.locked);
    }
    write(beforeWidget, nextWidget, widget.ref);
  }
}

/** Reconnect direct fields through every standard owner without mutating parser dictionaries. */
export async function flushEditorPdfDictionaryReplacements(writer: NativePdfWriter, signal?: AbortSignal): Promise<void> {
  if (!replacements.get(writer)?.size) return;
  const document = writer.document, references = new Set<string>(), dictionaries = new Map<PdfDictionary, PdfDictionary>();
  const visit = async (value: PdfValue): Promise<PdfValue> => {
    signal?.throwIfAborted();
    if (isPdfRef(value)) {
      const key = `${value.objectNumber}:${value.generation}`; if (references.has(key)) return value;
      references.add(key);
      const before = writer.get(value) ?? await document.resolveObject(value, signal), after = await visit(before);
      if (after !== before) writer.set(value, after);
      return value;
    }
    if (Array.isArray(value)) {
      const next: PdfValue[] = []; for (const item of value) next.push(await visit(item));
      return next.some((item, index) => item !== value[index]) ? next : value;
    }
    if (!isPdfDictionary(value)) return value;
    let dictionary = pendingEditorPdfDictionary(writer, value);
    const cached = dictionaries.get(dictionary); if (cached) return cached;
    const next = new Map(dictionary); dictionaries.set(dictionary, next);
    let changed = dictionary !== value;
    for (const key of ["AcroForm", "Fields", "Kids", "Parent", "Annots"]) {
      const child = dictionary.get(key); if (child === undefined) continue;
      const replaced = await visit(child); if (replaced !== child) { next.set(key, replaced); changed = true; }
    }
    if (!changed) { dictionaries.set(dictionary, dictionary); return dictionary; }
    return next;
  };
  const root = document.getWriterState().xref.trailers.map(trailer => trailer.get("Root")).find(isPdfRef);
  if (root) await visit(root);
  for (const page of document.pages) if (page.ref) await visit(page.ref);
}
