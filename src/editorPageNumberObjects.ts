import type { VectorScene } from "./pdfVectorExtractor";
import type { DocumentAuthoringData } from "./documentAuthoring";
import type { EditorTextObject } from "./editorTypes";

/** Page-local instances are derived from the document policy, never from saved digits. */
export function editorPageNumberObjects(scene: VectorScene, authoring?: DocumentAuthoringData): EditorTextObject[] {
  const settings = authoring?.pageNumbering;
  if (!authoring || !settings?.enabled) return [];
  const first = settings.skipFirstPage ? 1 : 0, count = scene.pageCount - first;
  const last = settings.startNumber + (count - 1);
  if (count && !Number.isSafeInteger(last)) throw new RangeError("Page numbers exceed the supported integer range.");
  const result: EditorTextObject[] = [];
  for (let pageIndex = first; pageIndex < scene.pageCount; pageIndex++) {
    const offset = pageIndex * 4, width = Math.abs(scene.pageRects[offset + 2] - scene.pageRects[offset]),
      height = Math.abs(scene.pageRects[offset + 3] - scene.pageRects[offset + 1]);
    const number = settings.startNumber + (pageIndex - first);
    const text = settings.format === "number" ? String(number) : settings.format === "page" ? `Page ${number}` : `Page ${number} of ${last}`;
    const inset = Math.min(settings.marginX, Math.max(0, (width - settings.fontSize) / 2)), lineHeight = settings.fontSize * 1.4;
    const marginY = Math.min(settings.marginY, Math.max(0, height - lineHeight));
    result.push({ kind: "text", id: `hepr-page-number:${authoring.id}:${pageIndex}`, pageNumberingId: authoring.id,
      pageIndex, transform: [1, 0, 0, 1, 0, 0], locked: true, layerId: null,
      x: inset, y: settings.position === "header" ? Math.max(0, height - marginY - lineHeight) : marginY,
      width: width - inset * 2, height: lineHeight, text, fontFamily: settings.fontFamily,
      fontSize: settings.fontSize, color: settings.color, align: settings.align, lineHeight: 1.2 });
  }
  return result;
}
