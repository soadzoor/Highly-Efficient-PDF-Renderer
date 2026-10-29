import { formatPdfDownloadFilename, type PdfDownloadSource } from "./downloadUtils";
import type { EditorUi } from "./editorUi";
import type { VectorScene } from "./pdfVectorExtractor";
import { setToolbarIconButton } from "./toolbarIcons";

export interface ViewerPrintDocument {
  identity: unknown;
  label: string;
  editor?: Pick<EditorUi, "save">;
  sourcePdf?: PdfDownloadSource;
  password?: string;
  pages?: string;
  scene?: VectorScene;
}
export interface ViewerPrintActionOptions {
  button: HTMLButtonElement;
  document: Document;
  getDocument(): ViewerPrintDocument | null;
  isBusy(): boolean;
  setStatus(message: string): void;
}
export interface ViewerPrintAction {
  print(): Promise<void>;
  refresh(): void;
  cancel(): void;
}

/** Print from View without initializing editing services or loading their UI. */
export function createViewerPrintAction(options: ViewerPrintActionOptions): ViewerPrintAction {
  let job: { source: ViewerPrintDocument; abort: AbortController } | null = null;
  function refresh(): void {
    options.button.disabled = !options.getDocument() || options.isBusy() || job !== null;
    setToolbarIconButton(options.button, "print", job ? "Preparing print…" : "Print");
    options.button.setAttribute("aria-busy", String(job !== null));
  }
  async function print(): Promise<void> {
    if (job || options.isBusy()) return;
    const source = options.getDocument();
    if (!source) { options.setStatus("Open a PDF or HEP before printing."); return; }
    const current = job = { source, abort: new AbortController() };
    const isCurrent = (): boolean => {
      const selected = options.getDocument();
      return job === current && !current.abort.signal.aborted && selected !== null && Object.is(selected.identity, source.identity);
    };
    const ensureCurrent = (): void => {
      current.abort.signal.throwIfAborted();
      if (!isCurrent()) throw new DOMException("The document changed before printing.", "AbortError");
    };
    refresh(); options.setStatus("Preparing print…");
    try {
      if (source.editor) {
        await source.editor.save("print");
        // The editor reports its own progress and failures through its host.
        return;
      }
      const { preparePrintPdf, printPdfBlob } = await import("./pdfPrint");
      ensureCurrent();
      const warnings: string[] = [];
      const blob = await preparePrintPdf({ sourcePdf: source.sourcePdf, password: source.password, pages: source.pages, scene: source.scene }, {
        signal: current.abort.signal,
        onProgress(value) { if (isCurrent()) options.setStatus(`Preparing print… ${Math.round(value.value * 100)}%`); },
        onWarning(message) { if (isCurrent()) { if (!warnings.includes(message)) warnings.push(message); options.setStatus(message); } }
      });
      ensureCurrent();
      printPdfBlob(blob, options.document, { filename: formatPdfDownloadFilename(source.label).replace(/\.pdf$/i, "-print.pdf"), title: "Print PDF" });
      options.setStatus(["Print-ready PDF opened.", ...warnings].join(" "));
    } catch (error) {
      if (isCurrent() && !((error instanceof DOMException || error instanceof Error) && error.name === "AbortError"))
        options.setStatus(`Failed to prepare printing: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (job === current) job = null;
      refresh();
    }
  }
  function cancel(): void { job?.abort.abort(); job = null; refresh(); }
  options.button.addEventListener("click", () => { void print(); });
  refresh(); return { print, refresh, cancel };
}
