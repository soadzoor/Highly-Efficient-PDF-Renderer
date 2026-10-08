import { createEmptyVectorScene } from "./emptyVectorScene";
import { nativeVectorMissingFontResolver, resolvePdfPageNumbers, deriveSceneTextContentFromIndex, reportNativePdfProgress, type RasterLayer, type VectorExtractOptions, type VectorScene } from "./pdfVectorExtractor";
import { createOcrDemandScene, createOcrDetailDemandScene, needsOcrDetailGeometry, placeDemandRaster } from "./pdfDemandScene";
import { createLoadProgressReporter, type LoadProgressCallback, type LoadProgressReporter } from "./loadProgress";
import type { NativeVectorPdfSession } from "./pdfSession";
import { automaticRasterMemoryBudget } from "./rasterMemoryBudget";
import { sceneCpuBytes } from "./pageRasterPreview";
import type { RasterResolutionView } from "./rasterResolution";

const PREVIEW_DIMENSION = 96;
const MAX_DETAILED_PAGES = 12;

interface CachedPage { scene: VectorScene; bytes: number }

/** One sequential worker, bounded page caches, and metadata-only placeholders for unloaded pages. */
export class PdfPageDemandLoader {
  readonly placeholders: VectorScene[];
  readonly password: string | undefined;
  private readonly previews = new Map<number, CachedPage>();
  private readonly detailed = new Map<number, CachedPage>();
  private readonly overviewKinds = new Map<number, NonNullable<VectorScene["pdfOverviewKind"]>>();
  private readonly attempted = new Set<number>();
  private readonly failed = new Set<number>();
  private readonly evictedPreviews = new Set<number>();
  private readonly displayPages = new Map<number, { overview: VectorScene; scene: VectorScene; detailed: boolean }>();
  private boundDisplayPages: VectorScene[] | null = null;
  private boundDisplayScene: VectorScene | null = null;
  private readonly placedRasters = new WeakMap<RasterLayer, Map<number, RasterLayer>>();
  private wanted: number[] = [];
  private wantedDetail: number[] = [];
  private detailCandidates: number[] = [];
  private detailKey = "";
  private visibleKey = "";
  private reportedPreviewEviction = false;
  private allPreviews = false;
  private initialProgress: LoadProgressReporter | null = null;
  private retainAllOverviews = false;
  private closed = false;
  private paused = false;
  private running: Promise<void> | null = null;
  private operation: AbortController | null = null;
  private completeOperation: AbortController | null = null;
  private readonly session: NativeVectorPdfSession;
  private onChange: () => void | Promise<void>;
  private onTiming: ((name: string, durationMs: number) => void) | null = null;
  private readonly reportedCompatibilityPages = new Set<number>();
  private readonly options: VectorExtractOptions;
  private readonly sourcePages: number[];

  constructor(session: NativeVectorPdfSession,
    onChange: () => void | Promise<void>, options: VectorExtractOptions = {}) {
    this.session = session; this.onChange = onChange; this.options = options;
    this.password = options.password;
    this.sourcePages = resolvePdfPageNumbers(session.info.pages.length, options.pages).map(page => page - 1);
    this.placeholders = this.sourcePages.map(index => {
      const page = session.info.pages[index];
      const scene = createEmptyVectorScene();
      const bounds = { minX: 0, minY: 0, maxX: page.width, maxY: page.height };
      scene.pageCount = 1;
      scene.pageRects = Float32Array.of(0, 0, page.width, page.height);
      scene.pendingPagePreviews = Uint8Array.of(1);
      scene.pageTextRanges = Uint32Array.of(0, 0);
      scene.bounds = scene.pageBounds = bounds;
      return scene;
    });
  }

  get pageCount(): number { return this.placeholders.length; }
  setOnChange(onChange: () => void | Promise<void>): void { this.onChange = onChange; }
  setPerformanceListener(listener: ((name: string, durationMs: number) => void) | null): void { this.onTiming = listener; }
  get previewCount(): number { return this.previews.size; }
  get detailedCount(): number { return this.detailed.size; }
  /** Fully compiled vector documents can keep their complete scene without a paging worker. */
  get requiresPageDemand(): boolean {
    return this.previews.size !== this.pageCount || [...this.overviewKinds.values()].some(kind => kind !== "vector");
  }
  get residentBytes(): number {
    return [...this.previews.values(), ...this.detailed.values()].reduce((bytes, page) => bytes + page.bytes, 0);
  }
  get pageScenes(): VectorScene[] {
    return this.placeholders.map((_, index) => this.pageScene(index));
  }

  /** Stable OCR geometry: changing its selected representation does not replace a page scene. */
  get displayPageScenes(): VectorScene[] {
    return this.placeholders.map((_, index) => {
      const overview = this.previews.get(index)?.scene;
      if (!overview || this.overviewKinds.get(index) === "vector" || this.options.ocrTextOnly) return this.pageScene(index);
      let display = this.displayPages.get(index);
      if (!display || display.overview !== overview) {
        display = { overview, scene: createOcrDemandScene(overview), detailed: false };
        this.displayPages.set(index, display);
      }
      const detail = this.detailed.get(index)?.scene;
      if (detail && needsOcrDetailGeometry(detail) && !display.detailed) {
        const combined = createOcrDetailDemandScene(overview, detail);
        if (!combined) {
          if (!this.reportedCompatibilityPages.has(index)) {
            this.reportedCompatibilityPages.add(index);
            console.warn(`[HEPR] Page ${index + 1} retains its complete scene update path to preserve compositing effects.`);
          }
          return this.pageScene(index);
        }
        display.scene = combined; display.detailed = true;
      }
      return display.scene;
    });
  }

  bindDisplayScene(scene: VectorScene, pages = this.displayPageScenes): void {
    this.boundDisplayPages = pages;
    this.boundDisplayScene = scene;
  }

  /** Null means newly loaded geometry requires a scene generation; otherwise only scan pixels/visibility change. */
  getDisplayUpdate(scene: VectorScene): { layers: Map<number, RasterLayer>; rasterPages: Set<number> } | null {
    const pages = this.displayPageScenes;
    if (scene !== this.boundDisplayScene || !this.boundDisplayPages ||
        pages.some((page, index) => page !== this.boundDisplayPages![index])) return null;
    const layers = new Map<number, RasterLayer>(), rasterPages = new Set<number>();
    const offsets = new Map<number, number>();
    scene.rasterLayers.forEach((slot, index) => {
      if (!slot.pageDemandSlot) return;
      const page = slot.pageIndex, offset = offsets.get(page) ?? 0;
      offsets.set(page, offset + 1);
      const source = this.wantedDetail.includes(page) ? this.detailed.get(page)?.scene.rasterLayers[offset] : undefined;
      if (!source) { layers.set(index, slot); return; }
      let placed = this.placedRasters.get(source);
      if (!placed) this.placedRasters.set(source, placed = new Map());
      let layer = placed.get(page);
      if (!layer || layer.matrix[4] !== Math.fround(source.matrix[4] + scene.pageRects[page * 4] - pages[page].pageRects[0]) ||
          layer.matrix[5] !== Math.fround(source.matrix[5] + scene.pageRects[page * 4 + 1] - pages[page].pageRects[1])) {
        layer = placeDemandRaster(source, scene, pages[page], page); placed.set(page, layer);
      }
      layers.set(index, layer); rasterPages.add(page);
    });
    return { layers, rasterPages };
  }

  isDisplayUpdateCurrent(scene: VectorScene, update: { layers: ReadonlyMap<number, RasterLayer>; rasterPages: ReadonlySet<number> }): boolean {
    const latest = this.getDisplayUpdate(scene);
    return !!latest && latest.layers.size === update.layers.size && latest.rasterPages.size === update.rasterPages.size &&
      [...latest.rasterPages].every(page => update.rasterPages.has(page)) &&
      [...latest.layers].every(([index, layer]) => update.layers.get(index) === layer);
  }

  private pageScene(index: number, wantedDetail = this.wantedDetail): VectorScene {
    return (wantedDetail.includes(index) ? this.detailed.get(index)?.scene : undefined) ??
      this.previews.get(index)?.scene ?? this.detailed.get(index)?.scene ?? this.placeholders[index];
  }

  update(view: RasterResolutionView, pageRects: Float32Array): void {
    if (this.closed || !(view.zoom > 0)) return;
    const halfWidth = view.width / view.zoom / 2, halfHeight = view.height / view.zoom / 2;
    const margin = Math.min(halfWidth, halfHeight) * .15;
    const visible: { index: number; distance: number; detail: boolean }[] = [];
    for (let index = 0; index < this.pageCount; index++) {
      const offset = index * 4;
      const x0 = pageRects[offset], y0 = pageRects[offset + 1], x1 = pageRects[offset + 2], y1 = pageRects[offset + 3];
      if (view.projection || view.localToClip) {
        const m = view.projection ? view.projection(index) : view.localToClip;
        if (!m) continue;
        const corners = [[x0,y0], [x1,y0], [x0,y1], [x1,y1]].map(([x,y]) => {
          const w = m[3]*x + m[7]*y + m[15];
          return w > 1e-8 ? [(m[0]*x + m[4]*y + m[12])/w, (m[1]*x + m[5]*y + m[13])/w] : null;
        });
        const points = corners.filter(point => point !== null);
        if (!points.length) continue;
        const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
        // A near-plane intersection has unbounded demand; the detail/cache caps still apply.
        if (points.length === 4 && (Math.max(...xs) < -1.15 || Math.min(...xs) > 1.15 ||
            Math.max(...ys) < -1.15 || Math.min(...ys) > 1.15)) continue;
        visible.push({ index, distance: Math.hypot((Math.min(...xs)+Math.max(...xs))/2,
          (Math.min(...ys)+Math.max(...ys))/2), detail: points.length !== 4 ||
          Math.max((Math.max(...xs)-Math.min(...xs))*view.width/2, (Math.max(...ys)-Math.min(...ys))*view.height/2) >
            (this.wantedDetail.includes(index) ? 224 : 256) });
        continue;
      }
      if (x1 < view.cameraCenterX - halfWidth - margin || x0 > view.cameraCenterX + halfWidth + margin ||
          y1 < view.cameraCenterY - halfHeight - margin || y0 > view.cameraCenterY + halfHeight + margin) continue;
      visible.push({ index, distance: Math.hypot((x0 + x1) / 2 - view.cameraCenterX, (y0 + y1) / 2 - view.cameraCenterY),
        detail: Math.max(x1 - x0, y1 - y0) * view.zoom > (this.wantedDetail.includes(index) ? 224 : 256) });
    }
    visible.sort((a, b) => a.distance - b.distance || a.index - b.index);
    this.wanted = visible.map(page => page.index);
    const visibleKey = this.wanted.join(",");
    if (visibleKey !== this.visibleKey) {
      this.visibleKey = visibleKey;
      // Revisit an evicted overview after navigation, without repeatedly rebuilding
      // previews that cannot all fit the same stationary viewport.
      for (const index of this.wanted) this.evictedPreviews.delete(index);
    }
    this.detailCandidates = visible.filter(page => page.detail).map(page => page.index);
    this.refreshDetailDemand();
    this.start();
  }

  private refreshDetailDemand(): void {
    const previousDetail = this.wantedDetail;
    // Vector pages already contain full geometry. Only scans need a second CPU tier.
    this.wantedDetail = this.options.ocrTextOnly ? [] : this.detailCandidates
      .filter(index => this.overviewKinds.get(index) !== "vector").slice(0, MAX_DETAILED_PAGES);
    const key = this.wantedDetail.join(",");
    if (key !== this.detailKey) {
      this.detailKey = key; this.attempted.clear();
      for (const index of this.wantedDetail) this.evictedPreviews.delete(index);
      // Display selection follows the current view, independently of cached detail.
      // Reload an evicted preview while retaining its drawable detail as a fallback.
      for (const index of previousDetail) if (!this.wantedDetail.includes(index)) this.evictedPreviews.delete(index);
      if ([...previousDetail, ...this.wantedDetail].some(index => this.pageScene(index, previousDetail) !== this.pageScene(index))) {
        void this.notifyChange();
      }
    }
  }

  /** Search can fill the document's preview text index while visible detail retains priority. */
  requestAllPreviews(): void { this.allPreviews = true; this.start(); }
  /** Collect the initial scene without per-page uploads or frame waits; scans still decode on zoom. */
  async loadInitialOverviews(signal?: AbortSignal, retainAll = false): Promise<void> {
    signal?.throwIfAborted();
    const abort = () => this.pause();
    signal?.addEventListener("abort", abort, { once: true });
    this.initialProgress = createLoadProgressReporter(this.options.onProgress);
    this.retainAllOverviews ||= retainAll;
    try {
      this.requestAllPreviews();
      await this.whenIdle();
      signal?.throwIfAborted();
    } finally { this.initialProgress = null; signal?.removeEventListener("abort", abort); }
  }

  /** Reuse canonical pages for export; remaining pages compile once without growing the viewing caches. */
  async loadCompletePageScenes(options: {
    signal?: AbortSignal; onProgress?: LoadProgressCallback
  } = {}): Promise<VectorScene[]> {
    options.signal?.throwIfAborted();
    if (this.closed) throw new Error("The PDF page loader is closed.");
    if (this.completeOperation) throw new Error("Complete PDF page extraction is already running.");
    const operation = this.completeOperation = new AbortController();
    const abort = (): void => operation.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    const wasPaused = this.paused;
    this.pause();
    const progress = createLoadProgressReporter(options.onProgress);
    const checkActive = (): void => {
      operation.signal.throwIfAborted();
      if (this.closed) throw new Error("The PDF page loader is closed.");
    };
    try {
      await this.whenIdle();
      checkActive();
      const pages: VectorScene[] = [];
      for (let index = 0; index < this.pageCount; index++) {
        checkActive();
        const sourcePageIndex = this.sourcePages[index];
        const pageProgress = { stage: "pdf-page" as const, sourceType: "pdf" as const, executionPath: "worker" as const,
          unit: "pages" as const, total: this.pageCount, pageIndex: index, pageCount: this.pageCount,
          sourcePageIndex, sourcePageCount: this.session.info.pages.length };
        progress.report(.12 + index / this.pageCount * .82, { ...pageProgress, processed: index });
        const cached = this.options.ocrTextOnly ? undefined : this.detailed.get(index)?.scene ??
          (this.overviewKinds.get(index) === "vector" ? this.previews.get(index)?.scene : undefined);
        const scene = cached ?? await this.session.compileVectorPage(sourcePageIndex, {
          ocrTextOnly: false,
          signal: operation.signal,
          optimization: this.options.enableSegmentMerge === false && this.options.enableInvisibleCull === false ? "none" : "safe",
          enableSegmentMerge: this.options.enableSegmentMerge !== false,
          enableInvisibleCull: this.options.enableInvisibleCull !== false,
          ...(this.options.annotationAppearances ? { annotationAppearances: this.options.annotationAppearances } : {}),
          onProgress: event => reportNativePdfProgress(progress, event, {
            selectionIndex: index, selectedPageCount: this.pageCount, sourcePageCount: this.session.info.pages.length
          })
        });
        checkActive();
        if (!cached && this.options.extractTextContent === true) scene.textContent = deriveSceneTextContentFromIndex(scene, 0);
        pages.push(scene);
        progress.report(.12 + (index + 1) / this.pageCount * .82, { ...pageProgress, processed: index + 1 });
      }
      checkActive();
      progress.complete({ stage: "compile", sourceType: "pdf", executionPath: "worker", unit: "pages",
        processed: pages.length, total: pages.length, pageCount: pages.length, sourcePageCount: this.session.info.pages.length });
      checkActive();
      return pages;
    } finally {
      options.signal?.removeEventListener("abort", abort);
      if (this.completeOperation === operation) this.completeOperation = null;
      this.paused = wasPaused;
      if (!wasPaused && !this.closed) this.start();
    }
  }

  pause(): void { this.paused = true; this.operation?.abort(); }
  resume(): void { if (!this.closed && !this.completeOperation) { this.paused = false; this.start(); } }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.operation?.abort();
    this.completeOperation?.abort(new DOMException("PDF page loader closed.", "AbortError"));
    try { await this.session.close(); }
    finally { await this.running; this.previews.clear(); this.detailed.clear(); this.overviewKinds.clear();
      this.displayPages.clear(); this.boundDisplayPages = null; this.boundDisplayScene = null; this.onTiming = null; }
  }

  /** Test/host synchronization without polling or forcing additional pages. */
  async whenIdle(): Promise<void> { await this.running; }

  private async notifyChange(): Promise<void> {
    try { await this.onChange(); }
    catch (error) { console.warn("[HEPR] Demand-driven PDF page update failed.", error); }
  }

  private start(): void {
    if (this.running || this.closed || this.paused || this.completeOperation) return;
    this.running = this.pump().finally(() => { this.running = null; });
    // A host callback failure is reported, never an unhandled promise rejection.
    void this.running.catch(error => console.warn("[HEPR] Demand-driven PDF page update failed.", error));
  }

  private next(): { index: number; detail: boolean } | null {
    for (const index of this.wantedDetail) {
      if (this.previews.has(index) && !this.detailed.has(index) && !this.attempted.has(index) && !this.failed.has(index)) return { index, detail: true };
    }
    for (const index of this.wanted) {
      if (!this.previews.has(index) && !this.failed.has(index) && !this.evictedPreviews.has(index)) return { index, detail: false };
    }
    if (this.allPreviews) for (let index = 0; index < this.pageCount; index++) {
      if (!this.previews.has(index) && !this.failed.has(index) && !this.evictedPreviews.has(index)) return { index, detail: false };
    }
    return null;
  }

  private async pump(): Promise<void> {
    while (!this.closed && !this.paused) {
      const request = this.next();
      if (!request) return;
      const { index, detail } = request;
      if (detail) this.attempted.add(index);
      const operation = this.operation = new AbortController();
      const progress = this.initialProgress;
      const pageProgress = { stage: "pdf-page" as const, sourceType: "pdf" as const, executionPath: "worker" as const,
        unit: "pages" as const, total: this.pageCount, pageIndex: index, pageCount: this.pageCount,
        sourcePageIndex: this.sourcePages[index], sourcePageCount: this.session.info.pages.length };
      progress?.report(.12 + index / this.pageCount * .82, { ...pageProgress, processed: index });
      try {
        const started = performance.now();
        const scene = await this.session.compileVectorPage(this.sourcePages[index], {
          ocrTextOnly: this.options.ocrTextOnly,
          signal: operation.signal, optimization: "safe",
          enableSegmentMerge: this.options.enableSegmentMerge !== false,
          enableInvisibleCull: this.options.enableInvisibleCull !== false,
          ...(detail ? {} : { previewMaxDimension: PREVIEW_DIMENSION }),
          ...(this.options.annotationAppearances ? { annotationAppearances: this.options.annotationAppearances } : {}),
          onProgress: event => {
            if (progress) reportNativePdfProgress(progress, event, {
              selectionIndex: index, selectedPageCount: this.pageCount, sourcePageCount: this.session.info.pages.length
            });
          }
        });
        try { this.onTiming?.(detail ? "pageSwap.decode" : "pageSwap.overview", performance.now() - started); }
        catch (error) { console.warn("[HEPR] Page timing listener failed.", error); }
        if (this.options.extractTextContent === true) scene.textContent = deriveSceneTextContentFromIndex(scene, 0);
        if (this.closed || operation.signal.aborted) { this.attempted.delete(index); continue; }
        const cache = detail ? this.detailed : this.previews;
        // Navigation supersedes full-page work; a compact preview is still useful after a pan.
        if (!detail || this.wantedDetail.includes(index)) {
          cache.set(index, { scene, bytes: sceneCpuBytes(scene) });
          if (!detail) {
            this.overviewKinds.set(index, scene.pdfOverviewKind ?? (scene.rasterLayers.length || scene.retainedPages?.length ? "raster" : "vector"));
            this.refreshDetailDemand();
          }
          if (detail || !this.retainAllOverviews) this.trim(cache, detail);
          if (!progress) await this.notifyChange();
        }
      } catch (error) {
        if (operation.signal.aborted || this.closed) this.attempted.delete(index);
        else {
          this.failed.add(index);
          // A failed page is no longer getting an overview; do not animate indefinitely.
          this.placeholders[index].pendingPagePreviews?.fill(0);
          console.warn(`[HEPR] Page ${index + 1} could not be loaded; other pages remain available.`, error);
          if (!progress) await this.notifyChange();
        }
      } finally { if (this.operation === operation) this.operation = null; }
      progress?.report(.12 + (index + 1) / this.pageCount * .82, { ...pageProgress, processed: index + 1 });
      // Streaming offers a paint opportunity; initial full-document work goes straight to the next page.
      if (!progress) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }

  private trim(cache: Map<number, CachedPage>, detail: boolean): void {
    const budget = automaticRasterMemoryBudget().bytes;
    let bytes = [...cache.values()].reduce((sum, page) => sum + page.bytes, 0);
    while (cache.size > 1 && (bytes > budget || (detail && cache.size > MAX_DETAILED_PAGES))) {
      const rank = (index: number) => {
        const position = (detail ? this.wantedDetail : this.wanted).indexOf(index);
        return position < 0 ? Infinity : position;
      };
      const index = [...cache.keys()].sort((a, b) => rank(b) - rank(a))[0];
      bytes -= cache.get(index)!.bytes;
      cache.delete(index);
      if (!detail) this.displayPages.delete(index);
      if (!detail) {
        this.evictedPreviews.add(index);
        if (!this.reportedPreviewEviction) {
          this.reportedPreviewEviction = true;
          console.warn("[HEPR] PDF preview cache reached its automatic memory target; evicted previews reload as you navigate.");
        }
      }
    }
  }
}

export async function openPdfPageDemand(pdfData: ArrayBuffer, options: VectorExtractOptions,
  onChange: () => void | Promise<void>, signal?: AbortSignal): Promise<PdfPageDemandLoader> {
  const { openPdfInBrowserWorker, openPdfInNodeWorker } = await import("./pdf/workerClient");
  const missingFontResolver = await nativeVectorMissingFontResolver();
  const open = typeof (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node === "string"
    ? openPdfInNodeWorker : openPdfInBrowserWorker;
  const session = await open({ kind: "bytes", bytes: new Uint8Array(pdfData), ownership: "copy" }, {
    repair: "safe", password: options.password, signal, missingFontResolver,
    imageCodecResolver: options.imageCodecResolver, iccEngine: options.iccEngine,
    iccTransformResolver: options.iccTransformResolver, onDiagnostic: options.onDiagnostic
  });
  try { return new PdfPageDemandLoader(session as NativeVectorPdfSession, onChange, options); }
  catch (error) { await session.close(); throw error; }
}
