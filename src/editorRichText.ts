import type { EditorObjectInput, EditorSession, EditorTextRun } from "./editorTypes";
import type { EditorFont } from "./editorFonts";
import { rebindEditorLinkTarget } from "./editorLinks";

export interface EditorTextDraftBaseline { html: string; align: string; opacity: number }
export function hasPendingEditorTextChanges(draft: {
  element: Pick<HTMLElement, "innerHTML"> & { style: Pick<CSSStyleDeclaration, "textAlign"> };
  opacity?: number;
  baseline: EditorTextDraftBaseline;
} | null): boolean {
  return draft !== null && (draft.element.innerHTML !== draft.baseline.html ||
    draft.element.style.textAlign !== draft.baseline.align || (draft.opacity ?? 1) !== draft.baseline.opacity);
}

export function normalizeEditorTextColor(value: string): string {
  const rgb = value.match(/^rgba?\((.*)\)$/i);
  if (!rgb) return value;
  const channels = rgb[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
  if (channels.length !== 3) return value;
  const values = channels.map(channel => channel.endsWith("%") ? parseFloat(channel) * 255 / 100 : parseFloat(channel));
  if (!values.every(Number.isFinite)) return value;
  return "#" + values.map(channel => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, "0")).join("");
}

/** Keep replacement/deletion of a saved textbox in one undo transaction. */
export function commitEditorText(session: EditorSession, object: Extract<EditorObjectInput, { kind: "text" }> | null,
  target: { objectId?: string; sourceAnnotationId?: string }): string | null {
  if (!object && !target.objectId && !target.sourceAnnotationId) return null;
  let id: string | null = null;
  session.transaction("Edit text", () => {
    const link = object && target.sourceAnnotationId ? session.getObjectLink?.(`annotation:${target.sourceAnnotationId}`) : undefined;
    if (target.sourceAnnotationId) { session.selectAnnotations([target.sourceAnnotationId]); session.deleteSelection(); }
    else if (target.objectId && !object) { session.select([target.objectId]); session.deleteSelection(); }
    if (object) {
      id = target.objectId && !target.sourceAnnotationId ? target.objectId : session.addObject({ ...object, ...(link ? { link } : {}) });
      if (target.sourceAnnotationId) session.copyObjectLayerMembership(`annotation:${target.sourceAnnotationId}`, id);
      if (target.sourceAnnotationId) rebindEditorLinkTarget(session, `annotation:${target.sourceAnnotationId}`, id);
      if (target.objectId && !target.sourceAnnotationId) session.updateObject(id, object);
    }
    session.select(id ? [id] : []);
  });
  return id;
}

/** Read styled text as inert data, keeping the exact imported font identity. */
export function readRichTextRuns(element: HTMLElement, window: Pick<Window, "getComputedStyle">,
  fonts: readonly Pick<EditorFont, "id" | "family">[] = [], defaultFontId?: string, defaultFamily?: string): EditorTextRun[] {
  const runs: EditorTextRun[] = [];
  function newline(): void {
    if (runs.length && !runs[runs.length - 1].text.endsWith("\n")) runs.push({ ...runs[runs.length - 1], text: "\n" });
  }
  function walk(node: Node): void {
    if (node.nodeType === 3) {
      const parent = node.parentElement ?? element, style = window.getComputedStyle(parent), decoration = style.textDecorationLine;
      const family = style.fontFamily.split(",")[0].trim().replace(/^['"]|['"]$/g, ""), font = fonts.find(item => item.id === family);
      runs.push({ text: node.textContent ?? "", fontId: font?.id ?? (family === defaultFamily ? defaultFontId : undefined),
        fontFamily: font?.family ?? (family || defaultFamily), fontSize: parseFloat(style.fontSize) || 12,
        fontWeight: style.fontWeight === "bold" ? 700 : parseInt(style.fontWeight, 10) || 400,
        fontStyle: style.fontStyle === "italic" || style.fontStyle === "oblique" ? "italic" : "normal", color: normalizeEditorTextColor(style.color),
        underline: decoration.includes("underline") || Boolean(parent.closest("u")),
        strikethrough: decoration.includes("line-through") || Boolean(parent.closest("s,strike")) });
    } else if (node.nodeType === 1) {
      const child = node as HTMLElement;
      if (child.tagName === "BR") { if (runs.length) runs.push({ ...runs[runs.length - 1], text: "\n" }); else runs.push({ text: "\n" }); return; }
      const block = child !== element && /^(DIV|P)$/.test(child.tagName);
      if (block) newline();
      for (const item of child.childNodes) walk(item);
      if (block && child.nextSibling) newline();
    }
  }
  walk(element); return runs;
}
