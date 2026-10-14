import { readPdfObjectSourceBytes, resolveSourceKind, resolveSourceLabel, type PdfObjectSource } from "./pdfObjectGenerator";
import type { DocumentSession, DocumentSessionOpenOptions, DocumentSessionHepOptions, DocumentSessionInfo } from "./documentSession";
import type { PdfThumbnailOptions, PdfThumbnailResult } from "./pdfThumbnail";
import { normalizeThumbnailOptions } from "./thumbnailOptions";
import { nativeVectorMissingFontResolver, resolvePdfPageNumbers, composeVectorScenesInGrid, type VectorScene } from "./pdfVectorExtractor";
import type { NativeVectorPdfSession } from "./pdfSession";
import { ScenePageViews } from "./scenePageViews";
import { PdfError, type PdfDiagnostic } from "./pdf/nativeTypes";
import { waitForLoad } from "./loadCancellation";
import type { ThumbnailSceneRenderer } from "./thumbnailRenderer";
import type { ThumbnailPixels } from "./thumbnailTypes";

interface ProcessingSessionEncoder {
  encode(pixels: ThumbnailPixels, format: "webp" | "png", signal?: AbortSignal,
    onDiagnostic?: (diagnostic: PdfDiagnostic) => void): Promise<Blob>;
  close(): void | Promise<void>;
}

/** Platform-specific resources stay owned by the same reusable session. */
export interface ProcessingSessionServices {
  readonly canvas2dOnly?: boolean;
  readonly createEncoder?: () => Promise<ProcessingSessionEncoder>;
}

export async function openDocumentSessionRuntime(source: PdfObjectSource, options: DocumentSessionOpenOptions): Promise<DocumentSession> {
  let bytes = await readPdfObjectSourceBytes(source, undefined, options.signal);
  options.signal?.throwIfAborted();
  const kind = resolveSourceKind(source, bytes, options.sourceKind);
  const label = options.sourceLabel ?? resolveSourceLabel(source, kind);
  const sourceByteLength = bytes.byteLength;
  const diagnostics: PdfDiagnostic[] = [];
  const onDiagnostic = (diagnostic: PdfDiagnostic): void => { diagnostics.push(diagnostic); options.onDiagnostic?.(diagnostic); };
  let pdf: NativeVectorPdfSession | undefined;
  let scene: VectorScene | undefined;
  try {
    if (kind === "pdf") {
      const openOptions = { ...options, repair: options.repair ?? "safe", onDiagnostic,
        missingFontResolver: options.missingFontResolver ?? await nativeVectorMissingFontResolver() };
      options.signal?.throwIfAborted();
      if (typeof Worker === "function") {
        const { openPdfInBrowserWorker } = await import("./pdf/workerClient");
        try {
          // Source reading already made an owned copy; transfer it instead of
          // copying the whole document again just to enter the parser worker.
          pdf = await openPdfInBrowserWorker({ kind: "bytes", bytes, ownership: "transfer", label }, openOptions) as NativeVectorPdfSession;
        } catch (error) {
          options.signal?.throwIfAborted();
          if (!(error instanceof PdfError) || error.code !== "worker-crash") throw error;
          // A worker can fail after taking ownership. Recover from the caller's
          // still-owned source only on this exceptional fallback path.
          if (bytes.byteLength === 0) bytes = await readPdfObjectSourceBytes(source, undefined, options.signal);
          onDiagnostic({ code: "thumbnail.worker-unavailable", severity: "info", message: "PDF thumbnail preparation is using the main thread because a module worker is unavailable." });
        }
      }
      if (!pdf) {
        const { openPdf } = await import("./pdfSession");
        pdf = await openPdf({ kind: "bytes", bytes, ownership: "transfer", label }, openOptions) as NativeVectorPdfSession;
      }
    } else {
      const { loadSceneFromHep } = await import("./hepReader");
      // Source reading already owns these bytes; copy only an exceptional
      // sliced/shared view, rather than duplicating every complete HEP input.
      const buffer = bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer : Uint8Array.from(bytes).buffer;
      scene = await loadSceneFromHep(buffer, { signal: options.signal });
    }
    options.signal?.throwIfAborted();
    return new ProcessingSession(kind, sourceByteLength, label, options, diagnostics, pdf, scene);
  } catch (error) { if (pdf) await (pdf.terminate?.() ?? pdf.close()).catch(() => undefined); options.signal?.throwIfAborted(); throw error; }
}

export class ProcessingSession implements DocumentSession {
  readonly info: DocumentSessionInfo;
  private readonly lifetime = new AbortController();
  private tail: Promise<void> = Promise.resolve();
  private closing: Promise<void> | undefined;
  private renderer: ThumbnailSceneRenderer | undefined;
  private encoder: ProcessingSessionEncoder | undefined;
  private partition: ScenePageViews | undefined;
  private canvas2dOnly = false;
  private readonly sourceByteLength: number;
  private readonly label: string;
  private readonly openOptions: DocumentSessionOpenOptions;
  private readonly diagnostics: PdfDiagnostic[];
  private readonly services: ProcessingSessionServices;
  private pdf: NativeVectorPdfSession | undefined;
  private scene: VectorScene | undefined;

  constructor(kind: "pdf" | "hep", sourceByteLength: number, label: string,
    openOptions: DocumentSessionOpenOptions, diagnostics: PdfDiagnostic[],
    pdf?: NativeVectorPdfSession, scene?: VectorScene,
    services: ProcessingSessionServices = {}) {
    this.services = services;
    this.sourceByteLength = sourceByteLength; this.label = label; this.openOptions = openOptions;
    this.diagnostics = diagnostics; this.pdf = pdf; this.scene = scene;
    const pages = pdf ? pdf.info.pages.map(page => ({ width: page.width, height: page.height })) :
      Array.from({ length: scene!.pageCount }, (_, index) => ({
        width: scene!.pageRects[index * 4 + 2] - scene!.pageRects[index * 4],
        height: scene!.pageRects[index * 4 + 3] - scene!.pageRects[index * 4 + 1]
      }));
    this.info = Object.freeze({ sourceKind: kind, pageCount: pages.length, pages: Object.freeze(pages.map(page => Object.freeze(page))) });
  }

  async renderThumbnail(options: PdfThumbnailOptions = {}): Promise<PdfThumbnailResult> {
    const normalized = normalizeThumbnailOptions(options);
    if (this.services.canvas2dOnly && normalized.backend === "webgl") {
      throw new RangeError("Node thumbnails support the auto and canvas2d backends.");
    }
    const renderOptions = this.services.canvas2dOnly ? { ...normalized, backend: "canvas2d" as const } : normalized;
    const page = (options.page ?? 1) - 1;
    if (page >= this.info.pageCount) throw new RangeError("page is outside this document.");
    const started = performance.now();
    return this.run(options.signal, async signal => {
      const diagnosticStart = this.diagnostics.length;
      try {
        const prepareStart = performance.now();
        let pixels;
        if (this.pdf) {
          const result = await this.pdf.renderThumbnailPage(page, { ...renderOptions,
            backend: this.canvas2dOnly && renderOptions.backend === "auto" ? "canvas2d" : renderOptions.backend, signal });
          if ("page" in result && !("scene" in result)) {
            const { renderThumbnailPageCanvas2d } = await import("./thumbnailCanvas2d");
            signal.throwIfAborted();
            pixels = await renderThumbnailPageCanvas2d(result.page, renderOptions, signal, result.limits,
              diagnostic => { this.diagnostics.push(diagnostic); this.openOptions.onDiagnostic?.(diagnostic); });
            pixels = { ...pixels, timings: [...(result.timings ?? []), ...(pixels.timings ?? [])] };
          } else if ("scene" in result) {
            const { ThumbnailSceneRenderer } = await import("./thumbnailRenderer");
            signal.throwIfAborted(); this.renderer ??= new ThumbnailSceneRenderer();
            try {
              pixels = await this.renderer.render(result.scene, renderOptions, signal);
              pixels = { ...pixels, timings: [...(result.timings ?? []), ...(pixels.timings ?? [])] };
            }
            catch (error) {
              signal.throwIfAborted();
              if (renderOptions.backend !== "auto" || (error as { code?: string })?.code !== "thumbnail.webgl-unavailable") throw error;
              this.canvas2dOnly = true;
              const diagnostic: PdfDiagnostic = { code: "thumbnail.canvas2d-fallback", severity: "info", pageIndex: page,
                message: "This thumbnail uses the retained Canvas2D compatibility renderer because WebGL2 is unavailable." };
              this.diagnostics.push(diagnostic); this.openOptions.onDiagnostic?.(diagnostic);
              const fallback = result.page ? { page: result.page, limits: result.limits, timings: result.timings }
                : await this.pdf.renderThumbnailPage(page, { ...renderOptions, backend: "canvas2d", signal });
              if ("scene" in fallback) throw new Error("The PDF Canvas2D thumbnail renderer returned an unsupported scene result.");
              if ("page" in fallback) {
                const { renderThumbnailPageCanvas2d } = await import("./thumbnailCanvas2d");
                signal.throwIfAborted();
                pixels = await renderThumbnailPageCanvas2d(fallback.page, renderOptions, signal, fallback.limits,
                  diagnostic => { this.diagnostics.push(diagnostic); this.openOptions.onDiagnostic?.(diagnostic); });
                pixels = { ...pixels, timings: [...(fallback.timings ?? []), ...(pixels.timings ?? [])] };
              } else pixels = fallback;
            }
          } else pixels = result;
        }
        else {
          const { ThumbnailSceneRenderer } = await import("./thumbnailRenderer");
          signal.throwIfAborted();
          this.renderer ??= new ThumbnailSceneRenderer();
          this.partition ??= new ScenePageViews(this.scene!);
          pixels = await this.renderer.render(this.partition.extract(page).scene, renderOptions, signal);
        }
        signal.throwIfAborted();
        for (const timing of pixels.timings ?? []) options.onTiming?.(timing);
        signal.throwIfAborted();
        options.onTiming?.({ stage: "prepare-render", durationMs: performance.now() - prepareStart });
        signal.throwIfAborted();
        if (!this.encoder) {
          if (this.services.createEncoder) this.encoder = await this.services.createEncoder();
          else {
            const { ThumbnailEncoder } = await import("./thumbnailEncoder");
            this.encoder = new ThumbnailEncoder();
          }
        }
        signal.throwIfAborted();
        const encodeStart = performance.now();
        const blob = await this.encoder.encode(pixels, options.format ?? "webp", signal, diagnostic => {
          this.diagnostics.push(diagnostic); this.openOptions.onDiagnostic?.(diagnostic);
        });
        signal.throwIfAborted();
        options.onTiming?.({ stage: "encode", durationMs: performance.now() - encodeStart });
        options.onTiming?.({ stage: "total", durationMs: performance.now() - started });
        signal.throwIfAborted();
        return { blob, width: pixels.width, height: pixels.height };
      } finally {
        if (options.onDiagnostic !== this.openOptions.onDiagnostic) {
          for (const diagnostic of this.diagnostics.slice(diagnosticStart)) options.onDiagnostic?.(diagnostic);
        }
      }
    });
  }

  buildHep(options: DocumentSessionHepOptions = {}): Promise<Blob> {
    for (const key of ["password", "imageCodecResolver", "iccTransformResolver", "iccEngine", "embeddedFontPaint"]) {
      if (key in options) return Promise.reject(new TypeError(`${key} is fixed when opening the document session.`));
    }
    if (options.maxPagesPerRow !== undefined && (!Number.isSafeInteger(options.maxPagesPerRow) || options.maxPagesPerRow < 1)) {
      return Promise.reject(new RangeError("maxPagesPerRow must be a positive integer."));
    }
    return this.run(options.signal, async signal => {
      const { buildHep } = await import("./hepBuilder");
      signal.throwIfAborted();
      if (!this.pdf) return buildHep(this.scene!, { ...options, signal, sourceLabel: options.sourceLabel ?? this.label });
      const indexes = resolvePdfPageNumbers(this.info.pageCount, options.pages).map(page => page - 1);
      const prepare = options.encodeRasterImages === false ? undefined : (await import("./hepRasterPreparation")).createHepRasterPagePreparer();
      const pages: VectorScene[] = [];
      const diagnosticStart = this.diagnostics.length;
      for (let index = 0; index < indexes.length; index++) {
        signal.throwIfAborted();
        const page = await this.pdf.compileVectorPage(indexes[index], {
          signal, optimization: options.segmentMerge === false && options.invisibleCull === false ? "none" : "safe",
          enableSegmentMerge: options.segmentMerge !== false, enableInvisibleCull: options.invisibleCull !== false,
          annotationAppearances: options.annotationAppearances
        });
        signal.throwIfAborted();
        await prepare?.(page, signal);
        signal.throwIfAborted();
        pages.push(page);
        options.onProgress?.({ stage: "pdf-page", sourceType: "pdf", value: (index + 1) / indexes.length * .8,
          unit: "pages", processed: index + 1, total: indexes.length, sourcePageIndex: indexes[index] });
      }
      const combined = composeVectorScenesInGrid(pages, options.maxPagesPerRow ?? Math.max(1, Math.ceil(Math.sqrt(pages.length))), options.onDiagnostic);
      if (options.onDiagnostic !== this.openOptions.onDiagnostic) {
        for (const diagnostic of this.diagnostics.slice(diagnosticStart)) options.onDiagnostic?.(diagnostic);
      }
      signal.throwIfAborted();
      return buildHep(combined, { ...options, signal, sourcePdfByteLength: options.sourcePdfByteLength ?? this.sourceByteLength,
        sourceLabel: options.sourceLabel ?? this.label,
        onProgress: options.onProgress ? event => options.onProgress!({ ...event, value: .8 + event.value * .2, sourceType: "pdf" }) : undefined });
    });
  }

  getDiagnostics(): readonly PdfDiagnostic[] { return this.diagnostics.slice(); }

  close(): Promise<void> {
    return this.closing ??= this.closeInternal();
  }

  private async closeInternal(): Promise<void> {
    this.lifetime.abort(new DOMException("Document session closed.", "AbortError"));
    const encoder = this.encoder;
    try {
      await Promise.all([
        encoder?.close(),
        this.pdf ? (this.pdf.terminate?.() ?? this.pdf.close()) : undefined
      ]);
    }
    finally {
      try { await this.tail; }
      finally {
        try {
          // An operation can finish creating its lazy encoder after close
          // began. Drain that operation before releasing this final owner.
          if (this.encoder !== encoder) await this.encoder?.close();
        } finally {
          const renderer = this.renderer;
          this.encoder = undefined; this.renderer = undefined; this.pdf = undefined; this.scene = undefined; this.partition = undefined;
          renderer?.close();
        }
      }
    }
  }

  private run<T>(signal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.lifetime.signal.aborted) return Promise.reject(new PdfError("closed", "The document session is closed."));
    const combined = signal ? AbortSignal.any([this.lifetime.signal, signal]) : this.lifetime.signal;
    const result = this.tail.then(async () => {
      combined.throwIfAborted();
      try { const value = await operation(combined); combined.throwIfAborted(); return value; }
      catch (error) { combined.throwIfAborted(); throw error; }
    });
    this.tail = result.then(() => {}, () => {});
    return waitForLoad(result, combined);
  }
}
