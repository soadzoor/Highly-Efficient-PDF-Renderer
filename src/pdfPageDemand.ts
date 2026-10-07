import { createEmptyVectorScene } from "./emptyVectorScene";
import { nativeVectorMissingFontResolver, resolvePdfPageNumbers, deriveSceneTextContentFromIndex, type VectorExtractOptions, type VectorScene } from "./pdfVectorExtractor";
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
  private readonly attempted = new Set<number>();
  private readonly failed = new Set<number>();
  private readonly evictedPreviews = new Set<number>();
  private wanted: number[] = [];
  private wantedDetail: number[] = [];
  private detailKey = "";
  private visibleKey = "";
  private reportedPreviewEviction = false;
  private allPreviews = false;
  private closed = false;
  private paused = false;
  private running: Promise<void> | null = null;
  private operation: AbortController | null = null;
  private readonly session: NativeVectorPdfSession;
  private onChange: () => void | Promise<void>;
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
  get previewCount(): number { return this.previews.size; }
  get detailedCount(): number { return this.detailed.size; }
  get residentBytes(): number {
    return [...this.previews.values(), ...this.detailed.values()].reduce((bytes, page) => bytes + page.bytes, 0);
  }
  get pageScenes(): VectorScene[] {
    return this.placeholders.map((_, index) => this.pageScene(index));
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
          Math.max((Math.max(...xs)-Math.min(...xs))*view.width/2, (Math.max(...ys)-Math.min(...ys))*view.height/2) > 256 });
        continue;
      }
      if (x1 < view.cameraCenterX - halfWidth - margin || x0 > view.cameraCenterX + halfWidth + margin ||
          y1 < view.cameraCenterY - halfHeight - margin || y0 > view.cameraCenterY + halfHeight + margin) continue;
      visible.push({ index, distance: Math.hypot((x0 + x1) / 2 - view.cameraCenterX, (y0 + y1) / 2 - view.cameraCenterY),
        detail: Math.max(x1 - x0, y1 - y0) * view.zoom > 256 });
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
    const previousDetail = this.wantedDetail;
    // Text-only overviews already contain the full vector glyphs at every zoom.
    this.wantedDetail = this.options.ocrTextOnly ? [] : visible.filter(page => page.detail).slice(0, MAX_DETAILED_PAGES).map(page => page.index);
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
    this.start();
  }

  /** Search can fill the document's preview text index while visible detail retains priority. */
  requestAllPreviews(): void { this.allPreviews = true; this.start(); }
  pause(): void { this.paused = true; this.operation?.abort(); }
  resume(): void { if (!this.closed) { this.paused = false; this.start(); } }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.operation?.abort();
    try { await this.session.close(); }
    finally { await this.running; this.previews.clear(); this.detailed.clear(); }
  }

  /** Test/host synchronization without polling or forcing additional pages. */
  async whenIdle(): Promise<void> { await this.running; }

  private async notifyChange(): Promise<void> {
    try { await this.onChange(); }
    catch (error) { console.warn("[HEPR] Demand-driven PDF page update failed.", error); }
  }

  private start(): void {
    if (this.running || this.closed || this.paused) return;
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
      try {
        const scene = await this.session.compileVectorPage(this.sourcePages[index], {
          ocrTextOnly: this.options.ocrTextOnly,
          signal: operation.signal, optimization: "safe",
          enableSegmentMerge: this.options.enableSegmentMerge !== false,
          enableInvisibleCull: this.options.enableInvisibleCull !== false,
          ...(detail ? {} : { previewMaxDimension: PREVIEW_DIMENSION }),
          ...(this.options.annotationAppearances ? { annotationAppearances: this.options.annotationAppearances } : {}),
          onProgress: () => {}
        });
        if (this.options.extractTextContent === true) scene.textContent = deriveSceneTextContentFromIndex(scene, 0);
        if (this.closed || operation.signal.aborted) { this.attempted.delete(index); continue; }
        const cache = detail ? this.detailed : this.previews;
        // Navigation supersedes full-page work; a compact preview is still useful after a pan.
        if (!detail || this.wantedDetail.includes(index)) {
          cache.set(index, { scene, bytes: sceneCpuBytes(scene) });
          this.trim(cache, detail);
          await this.notifyChange();
        }
      } catch (error) {
        if (operation.signal.aborted || this.closed) this.attempted.delete(index);
        else {
          this.failed.add(index);
          // A failed page is no longer getting an overview; do not animate indefinitely.
          this.placeholders[index].pendingPagePreviews?.fill(0);
          console.warn(`[HEPR] Page ${index + 1} could not be loaded; other pages remain available.`, error);
          await this.notifyChange();
        }
      } finally { if (this.operation === operation) this.operation = null; }
      // Worker work and scene updates stay sequential, with a paint opportunity between pages.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
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
