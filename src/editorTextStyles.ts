import type { EditorSession, EditorTextObject, EditorTextRun } from "./editorTypes";
import type { VectorScene } from "./pdfVectorExtractor";
import type { TextSelectionSpan } from "./textSelection";
import { editorOriginalPaintPrimitive, editorPaintIdentity, editorPaintOwnerObject } from "./editorPaintIdentity";
import { isSceneTextCharVisible } from "./optionalContentText";
import { editorSelectionLeaves } from "./editorProperties";

export type EditorTextStyle = "bold" | "italic" | "underline" | "strikethrough";
const property = (style: EditorTextStyle) => style === "bold" ? "fontWeight" : style === "italic" ? "fontStyle" : style;
const enabled = (style: EditorTextStyle, value: unknown): boolean => style === "bold" ? value === "bold" || typeof value === "number" && value >= 600
  : style === "italic" ? value === "italic" || value === "oblique" : Boolean(value);
const patch = (style: EditorTextStyle, value: boolean): Partial<EditorTextRun> => ({ [property(style)]:
  style === "bold" ? value ? "bold" : "normal" : style === "italic" ? value ? "italic" : "normal" : value });

/** The PDF text index collapses whitespace, while textbox runs retain its exact code units. */
function searchableTextboxText(text: string): { text: string; offsets: readonly (readonly number[])[] } {
  let searchable = ""; const offsets: number[][] = [];
  for (let index = 0; index < text.length;) {
    if (/\s/u.test(text[index])) {
      const start = index; while (index < text.length && /\s/u.test(text[index])) index++;
      if (searchable && index < text.length) { searchable += " "; offsets.push(Array.from({ length: index - start }, (_, offset) => start + offset)); }
    } else { searchable += text[index]; offsets.push([index]); index++; }
  }
  return { text: searchable, offsets };
}

/** Resolve presented glyph provenance, including compacted source indexes. */
function targets(session: EditorSession, scene: VectorScene, spans: readonly TextSelectionSpan[]) {
  const source = new Set<string>(), text = new Map<string, Set<number>>(), identity = editorPaintIdentity(scene), primitive = editorOriginalPaintPrimitive(scene);
  const searchableTexts = new Map<string, ReturnType<typeof searchableTextboxText>>();
  for (const span of spans) {
    const page = scene.textIndex?.pages[span.pageIndex]; if (!page) continue;
    for (let index = span.start; index < Math.min(page.text.length, span.start + span.length); index++) {
      if (!isSceneTextCharVisible(scene, page, index)) continue;
      const ref = page.charInstance[index]; if (ref < 0) continue;
      const owner = identity({ kind: "text", index: ref }), authored = editorPaintOwnerObject(owner);
      const id = authored ?? `source:text:${primitive({ kind: "text", index: ref }).index}`;
      let object; try { object = session.getObject(id); } catch { continue; }
      if (session.isObjectLocked(id) || !session.isObjectVisible(id)) continue;
      if (object.kind === "source" && !authored) source.add(id);
      if (object.kind !== "text") continue;
      // Locate this owned textbox, retaining an explicit offset map when the
      // compiler has collapsed line breaks, tabs or repeated spaces for search.
      let start = page.text.lastIndexOf(object.text, index), mapping: readonly (readonly number[])[] | undefined;
      if (start < 0 || index >= start + object.text.length) {
        let searchable = searchableTexts.get(id);
        if (!searchable) { searchable = searchableTextboxText(object.text); searchableTexts.set(id, searchable); }
        if (!searchable.text) continue;
        start = page.text.lastIndexOf(searchable.text, index); mapping = searchable.offsets;
        if (start < 0 || index >= start + searchable.text.length) continue;
      }
      const length = mapping?.length ?? object.text.length;
      const offsets = text.get(id) ?? new Set<number>();
      for (let offset = Math.max(span.start, start); offset < Math.min(span.start + span.length, start + length); offset++) {
        if (mapping) mapping[offset - start].forEach(value => offsets.add(value)); else offsets.add(offset - start);
      }
      text.set(id, offsets);
    }
  }
  return { source: [...source], text };
}

function runs(object: EditorTextObject): readonly EditorTextRun[] { return object.runs?.length ? object.runs : [{ text: object.text }]; }
/** Resolve ordinary object selections to their current searchable source glyphs. */
export function editorSelectedSourceTextSpans(session: EditorSession, scene: VectorScene, ids = session.getSelection()): TextSelectionSpan[] {
  const source = new Set<number>(), clones = new Set<string>();
  for (const object of editorSelectionLeaves(session, ids)) {
    if (object.kind !== "source" || session.isObjectLocked(object.id) || !session.isObjectVisible(object.id)) continue;
    if (object.isClone) clones.add(object.id);
    else for (const ref of object.primitives) if (ref.kind === "text") source.add(ref.index);
  }
  if (!source.size && !clones.size) return [];
  const identity = editorPaintIdentity(scene), primitive = editorOriginalPaintPrimitive(scene), result: TextSelectionSpan[] = [];
  for (const [pageIndex, page] of (scene.textIndex?.pages ?? []).entries()) {
    let start = -1, end = -1;
    const flush = () => { if (start >= 0) result.push({ pageIndex, start, length: end - start }); start = end = -1; };
    for (let index = 0; index < page.text.length; index++) {
      const ref = page.charInstance[index];
      if (!isSceneTextCharVisible(scene, page, index)) { flush(); continue; }
      // Inferred whitespace may connect selected glyphs, but never extend a
      // selection past its last selected glyph or include unrelated text.
      if (ref < 0 && /\s/u.test(page.text[index])) continue;
      if (!(ref >= 0)) { flush(); continue; }
      const owner = editorPaintOwnerObject(identity({ kind: "text", index: ref }));
      const selected = owner !== undefined ? clones.has(owner) : source.has(primitive({ kind: "text", index: ref }).index);
      if (!selected) { flush(); continue; }
      if (start < 0) start = index;
      end = index + 1;
    }
    flush();
  }
  return result;
}
export function editorSourceTextSpans(session: EditorSession, scene: VectorScene, spans: readonly TextSelectionSpan[]): TextSelectionSpan[] {
  const result: TextSelectionSpan[] = [], identity = editorPaintIdentity(scene), primitive = editorOriginalPaintPrimitive(scene);
  for (const span of spans) {
    const page = scene.textIndex?.pages[span.pageIndex]; if (!page) continue;
    const sourceChar = (index: number): boolean => {
      let ref = page.charInstance[index];
      // Indexed separators and OCR quads may not have their own glyph. Resolve
      // nearby ownership so textbox whitespace cannot acquire duplicate marks.
      if (ref < 0) {
        let next = index + 1; while (next < page.text.length && page.charInstance[next] < 0) next++;
        if (next < page.text.length) ref = page.charInstance[next];
        else { let previous = index - 1; while (previous >= 0 && page.charInstance[previous] < 0) previous--; if (previous >= 0) ref = page.charInstance[previous]; }
      }
      if (ref < 0) return true;
      const owner = identity({ kind: "text", index: ref }), authored = editorPaintOwnerObject(owner);
      const id = authored ?? `source:text:${primitive({ kind: "text", index: ref }).index}`;
      try { return session.getObject(id).kind === "source" && !session.isObjectLocked(id) && session.isObjectVisible(id); } catch { return false; }
    };
    let start = -1;
    for (let index = span.start; index <= Math.min(page.text.length, span.start + span.length); index++) {
      const source = index < span.start + span.length && index < page.text.length && isSceneTextCharVisible(scene, page, index) && sourceChar(index);
      if (source && start < 0) start = index;
      if (!source && start >= 0) { result.push({ pageIndex: span.pageIndex, start, length: index - start }); start = -1; }
    }
  }
  return result;
}
export function editorSelectedTextStyleState(session: EditorSession, scene: VectorScene, spans: readonly TextSelectionSpan[], style: EditorTextStyle) {
  const selection = targets(session, scene, spans), values: boolean[] = [], key = property(style);
  if (style === "bold" || style === "italic") for (const id of selection.source) {
    values.push(enabled(style, (session.getObject(id) as unknown as Record<string, unknown>)[key]));
  }
  for (const [id, offsets] of selection.text) {
    const object = session.getObject(id) as EditorTextObject; let offset = 0;
    for (const run of runs(object)) {
      if ([...offsets].some(index => index >= offset && index < offset + run.text.length)) values.push(enabled(style, run[key] ?? object[key]));
      offset += run.text.length;
    }
  }
  return { supported: values.length, value: values.length > 0 && values.every(Boolean), mixed: values.some(Boolean) && values.some(value => !value) };
}

/** Preserve other run properties and apply a single style only to selected characters. */
export function setEditorSelectedTextStyle(session: EditorSession, scene: VectorScene, spans: readonly TextSelectionSpan[], style: EditorTextStyle, value: boolean): void {
  const selection = targets(session, scene, spans), change = patch(style, value);
  session.transaction("Change text style", () => {
    if (style === "bold" || style === "italic") for (const id of selection.source) session.updateObject(id, change);
    for (const [id, offsets] of selection.text) {
      const object = session.getObject(id) as EditorTextObject, next: EditorTextRun[] = []; let offset = 0;
      for (const run of runs(object)) {
        let start = 0;
        while (start < run.text.length) {
          const selected = offsets.has(offset + start); let end = start + 1;
          while (end < run.text.length && offsets.has(offset + end) === selected) end++;
          next.push({ ...run, text: run.text.slice(start, end), ...(selected ? change : {}) }); start = end;
        }
        offset += run.text.length;
      }
      session.updateObject(id, { runs: next });
    }
  });
}
