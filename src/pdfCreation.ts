import type { VectorScene } from "./pdfVectorExtractor";
import { composeVectorScenesInGrid } from "./pdfVectorExtractor";
import { createEmptyVectorScene } from "./emptyVectorScene";
import { resolvePdfPageSize, type PdfPageOrientation, type PdfPageSize } from "./pdfPageSizes";
import { createDocumentAuthoring, type PageNumberingSettings } from "./documentAuthoring";
import type { LoadProgressCallback } from "./loadProgress";

export interface PdfBlankDocumentOptions {
  pageSize?: PdfPageSize;
  orientation?: PdfPageOrientation;
  pageCount?: number;
  signal?: AbortSignal;
}
export interface PdfCreateOptions extends PdfBlankDocumentOptions {
  title?: string;
  pageNumbering?: Partial<PageNumberingSettings>;
  onProgress?: LoadProgressCallback;
}

/** Complete, paint-free page geometry that can immediately enter edit mode. */
export function createBlankPdfScene(options: PdfBlankDocumentOptions = {}): VectorScene {
  options.signal?.throwIfAborted();
  const { width, height } = resolvePdfPageSize(options.pageSize, options.orientation), count = options.pageCount ?? 1;
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError("A new PDF requires a positive whole number of pages.");
  const pages = Array.from({ length: count }, () => {
    options.signal?.throwIfAborted();
    const scene = createEmptyVectorScene(), rect = Float32Array.of(0, 0, width, height);
    return Object.assign(scene, { pageCount: 1, pagesPerRow: 1, pageRects: rect, pageTextRanges: Uint32Array.of(0, 0),
      bounds: { minX: 0, minY: 0, maxX: rect[2], maxY: rect[3] }, pageBounds: { minX: 0, minY: 0, maxX: rect[2], maxY: rect[3] } });
  });
  const scene = composeVectorScenesInGrid(pages, 1);
  for (let page = 0; page < count; page++) {
    const rect = scene.pageRects.subarray(page * 4, page * 4 + 4);
    if (!Array.from(rect).every(Number.isFinite) || rect[2] <= rect[0] || rect[3] <= rect[1]) throw new RangeError("The document's page layout exceeds the scene's representable coordinate range.");
  }
  return scene;
}

/** Create a unique, editable PDF without requiring an existing document. */
export async function createPdf(options: PdfCreateOptions = {}): Promise<Blob> {
  options = { ...options, pageSize: typeof options.pageSize === "object" ? { ...options.pageSize } : options.pageSize,
    pageNumbering: options.pageNumbering ? { ...options.pageNumbering, ...(Array.isArray(options.pageNumbering.color)
      ? { color: [...options.pageNumbering.color] as [number, number, number] } : {}) } : undefined };
  const scene = createBlankPdfScene(options);
  scene.documentAuthoring = createDocumentAuthoring(options.pageNumbering, options.title);
  if (!scene.documentAuthoring.pageNumbering.enabled) return (await import("./editorPdfWriter")).writeScenePdf(scene, options);
  const { openEditorSession } = await import("./editorSession"); options.signal?.throwIfAborted();
  const editor = await openEditorSession(scene, { signal: options.signal });
  try { return await editor.savePdf({ signal: options.signal, onProgress: options.onProgress }); }
  finally { editor.dispose(); }
}
