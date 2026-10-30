import type { VectorScene } from "./pdfVectorExtractor";
import type { EditorAppServicesOptions } from "./editorAppServices";
import type { EditorUiHost, EditorUi } from "./editorUi";
import type { EditorPdfSaveOptions, EditorSession } from "./editorTypes";
import type { PdfOutputProtection } from "./pdf/pdfProtection";
import type { PdfProtectionChangeOptions } from "./editorPdfProtection";
import type { PdfPageOperation, PdfPageOperationOptions } from "./editorPdfPages";

/** Per-page visual alignment and prepared snapping for custom editor hosts. */
export async function createEditorLayoutController(session: EditorSession) {
  const layout = await import("./editorLayout");
  return {
    align: (alignment: import("./editorLayout").EditorAlignment, reference?: "selection" | "page") => layout.alignEditorSelection(session, alignment, reference),
    distribute: (direction: import("./editorLayout").EditorDistribution) => layout.distributeEditorSelection(session, direction),
    createAlignmentSnap: (candidates?: readonly import("./pdfVectorExtractor").Bounds[]) => layout.createEditorAlignmentSnap(session, candidates)
  };
}
/** Glyph-bound PDF review annotations, sharing the same geometry as export. */
export async function createEditorReviewTools(session: EditorSession) {
  const review = await import("./editorReview");
  return {
    textQuads: review.editorTextMarkupQuads,
    addTextMarkup: (scene: VectorScene, spans: readonly import("./textSelection").TextSelectionSpan[], type: "highlight" | "underline" | "strikeout", style?: Parameters<typeof review.addEditorTextMarkup>[4]) => review.addEditorTextMarkup(session, scene, spans, type, style),
    addComment: (page: number, x: number, y: number, contents: string, author?: string, style?: Parameters<typeof review.addEditorComment>[6]) => review.addEditorComment(session, page, x, y, contents, author, style)
  };
}

/** Complete font, form and preservation-first PDF services, loaded on demand. */
export async function createEditorAppServices(options: EditorAppServicesOptions = {}) {
  return (await import("./editorAppServices")).createEditorAppServices(options);
}
/** Rebuild a vector-first PDF using only a compiled scene (including HEP input). */
export async function writeScenePdf(scene: VectorScene, options: EditorPdfSaveOptions = {}): Promise<Blob> {
  return (await import("./editorPdfWriter")).writeScenePdf(scene, options);
}
/** Change PDF password protection without compiling or rendering its pages. */
export async function changePdfProtection(bytes: Uint8Array, protection: PdfOutputProtection, options: PdfProtectionChangeOptions = {}): Promise<Blob> {
  const policy = { ...protection }, settings = { ...options };
  return (await import("./editorPdfProtection")).changePdfProtection(bytes, policy, settings);
}
/** Rotate, remove or import PDF pages while retaining native page resources. */
export async function manipulatePdfPages(bytes: Uint8Array, operation: PdfPageOperation, options: PdfPageOperationOptions = {}): Promise<Blob> {
  const primary = bytes.slice(), settings = { ...options };
  const request = operation.kind === "insert" ? { ...operation, bytes: operation.bytes.slice(), pages: operation.pages?.slice() }
    : operation.kind === "crop" ? { ...operation, pages: operation.pages.slice(), box: operation.box ? { ...operation.box } : null }
    : { ...operation, pages: operation.pages.slice() };
  return (await import("./editorPdfPages")).manipulatePdfPages(primary, request, settings);
}
/** Optional shared browser controls; hosts can use EditorSession without these. */
export async function createEditorUi(host: EditorUiHost, signal?: AbortSignal): Promise<EditorUi> {
  return (await import("./editorUi")).createEditorUi(host, signal);
}
/** DOM-free selection and transform gestures for custom hosts, loaded on demand. */
export async function createEditorInteractionController(session: EditorSession) {
  return (await import("./editorInteraction")).createEditorInteractionController(session);
}
/** Separate local browser recovery, loaded only when a host enables it. */
export async function createEditorRecovery(options: Parameters<typeof import("./editorRecovery")["createEditorRecovery"]>[0]) {
  return (await import("./editorRecovery")).createEditorRecovery(options);
}
export async function editorRecoveryDocumentKey(source: { bytes?: Uint8Array; scene?: VectorScene }, signal?: AbortSignal): Promise<string> {
  return (await import("./editorRecovery")).editorRecoveryDocumentKey(source, signal);
}
