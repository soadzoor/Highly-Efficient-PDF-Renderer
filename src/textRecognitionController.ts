import type { PageTextIndex, VectorScene } from "./pdfVectorExtractor";
import type { PdfDiagnostic } from "./pdf/nativeTypes";
import type { ThumbnailPixels } from "./thumbnailTypes";
import { createNativeTextRecognitionProvider } from "./nativeTextRecognition";
import { waitForTextRecognition, type TextRecognitionOptions, type TextRecognitionPolygon,
  type TextRecognitionLine, type TextRecognitionProgress, type TextRecognitionProvider, type TextRecognitionResult,
  type TextRecognitionSetting } from "./textRecognition";

export interface TextRecognitionControllerHost {
  renderPage(index: number, dpi: number, signal: AbortSignal): Promise<ThumbnailPixels>;
  onChange(index: number): void;
  onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
}

interface PageRecord { sourcePageIndex: number; scene: VectorScene }
interface NormalizedText { text: string; references: Int32Array; quads: Float32Array }
interface AppliedText { sourcePageIndex: number; result: NormalizedText; rectangle: readonly number[] }

/** Recognition belongs to the document, independently of raster residency and layout. */
export class TextRecognitionController {
  private readonly host: TextRecognitionControllerHost;
  private options: TextRecognitionOptions = {};
  private enabled = true;
  private paused = false;
  private disposed = false;
  private generation = 0;
  private readonly pages = new Map<number, PageRecord>();
  private readonly results = new Map<number, NormalizedText>();
  private readonly failed = new Set<number>();
  private readonly applied = new WeakMap<PageTextIndex, AppliedText>();
  private visible: readonly number[] = [];
  private provider: TextRecognitionProvider | null = null;
  private providerKind: TextRecognitionProgress["provider"];
  private nativeUnavailableReason: unknown;
  private ownsProvider = false;
  private providerPending: Promise<TextRecognitionProvider | null> | undefined;
  private fallbackAttempted = false;
  private unavailable = false;
  private operation: AbortController | null = null;
  private running: Promise<void> | null = null;
  private progress: TextRecognitionProgress = { state: "idle", completed: 0, total: 0 };

  constructor(setting: TextRecognitionSetting | undefined, host: TextRecognitionControllerHost) {
    this.host = host;
    this.configure(setting);
  }

  /** Changes settings while retaining completed page-local recognition. */
  configure(setting: TextRecognitionSetting | undefined): void {
    if (this.disposed) return;
    const options = typeof setting === "object" ? setting : {};
    if (options.dpi !== undefined && (!Number.isFinite(options.dpi) || options.dpi <= 0)) {
      throw new RangeError("Text recognition dpi must be a positive finite number.");
    }
    this.generation++;
    this.operation?.abort(new DOMException("Text recognition settings changed.", "AbortError"));
    this.releaseProvider();
    this.providerPending = undefined;
    this.options = { ...options, languages: options.languages ? [...options.languages] : [] };
    this.providerKind = undefined;
    this.nativeUnavailableReason = undefined;
    this.enabled = setting !== undefined && setting !== "off";
    this.paused = false;
    this.unavailable = false;
    this.fallbackAttempted = false;
    this.failed.clear();
    this.clearEmptyResults();
    this.emit(this.enabled ? "idle" : "paused");
    this.start();
  }

  update(pages: readonly VectorScene[], visiblePages?: readonly number[]): void {
    if (this.disposed) return;
    pages.forEach((scene, index) => this.pages.set(index, {
      scene, sourcePageIndex: scene.pdfPages?.find(page => page.pageIndex === 0)?.sourcePageIndex ?? index
    }));
    if (visiblePages) this.visible = [...visiblePages];
    pages.forEach((scene, index) => this.apply(scene, [index]));
    this.start();
  }

  /** Replace only searchable metadata; callers can retain all GPU resources. */
  apply(scene: VectorScene, pageIndexes?: readonly number[]): void {
    if (!this.results.size) return;
    let changed = false;
    const original = scene.textIndex?.pages ?? [];
    const pages: PageTextIndex[] = [];
    for (let index = 0; index < scene.pageCount; index++) {
      const selectedIndex = pageIndexes?.[index] ?? index;
      const existing = original[index];
      const identity = scene.pdfPages?.find(page => page.pageIndex === index);
      if (scene.pendingPagePreviews?.[index] || (!identity && this.pages.get(selectedIndex)?.scene.pendingPagePreviews?.[0])) {
        pages.push(existing ?? emptyIndex());
        continue;
      }
      const sourcePageIndex = identity?.sourcePageIndex ??
        this.pages.get(selectedIndex)?.sourcePageIndex ?? selectedIndex;
      const result = this.results.get(sourcePageIndex);
      const rectangle = Array.from(scene.pageRects.subarray(index * 4, index * 4 + 4));
      const known = existing ? this.applied.get(existing) : undefined;
      if (!result || !hasUsableText(result.text) || (existing && hasUsableText(existing.text) && !known)) {
        pages.push(existing ?? emptyIndex());
        continue;
      }
      if (known?.result === result && known.sourcePageIndex === sourcePageIndex &&
          rectangle.every((value, offset) => value === known.rectangle[offset])) {
        pages.push(existing!);
        continue;
      }
      const [x0, y0, x1, y1] = rectangle;
      const quads = new Float32Array(result.quads.length);
      for (let slot = 0; slot < quads.length; slot += 4) {
        const ax = x0 + result.quads[slot] * (x1 - x0), bx = x0 + result.quads[slot + 2] * (x1 - x0);
        const ay = y1 - result.quads[slot + 1] * (y1 - y0), by = y1 - result.quads[slot + 3] * (y1 - y0);
        quads.set([Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)], slot);
      }
      const page: PageTextIndex = { text: result.text, charInstance: result.references.slice(), fallbackQuads: quads };
      this.applied.set(page, { result, sourcePageIndex, rectangle });
      pages.push(page);
      changed = true;
    }
    if (changed) scene.textIndex = { version: 2, pages };
  }

  async recognizeAll(pages: readonly VectorScene[], signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const abort = () => this.pause();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      this.paused = false;
      this.update(pages);
      while (this.running) {
        const pending = this.running;
        if (signal) await waitForTextRecognition(pending, signal); else await pending;
      }
      signal?.throwIfAborted();
      pages.forEach((scene, index) => this.apply(scene, [index]));
    } finally { signal?.removeEventListener("abort", abort); }
  }

  retry(): void {
    if (this.disposed) return;
    this.failed.clear(); this.paused = false; this.unavailable = false;
    this.clearEmptyResults();
    if (!this.provider) { this.providerPending = undefined; this.fallbackAttempted = false; }
    this.start();
  }

  pause(): void {
    if (this.disposed) return;
    this.paused = true;
    this.operation?.abort(new DOMException("Text recognition paused.", "AbortError"));
    this.emit("paused");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.generation++;
    this.operation?.abort(new DOMException("Text recognition disposed.", "AbortError"));
    this.releaseProvider(); this.pages.clear(); this.results.clear(); this.failed.clear();
    this.emit("disposed");
  }

  getProgress(): TextRecognitionProgress { return { ...this.progress }; }

  private candidate(record: PageRecord): boolean {
    const scene = record.scene;
    if (scene.pendingPagePreviews?.some(value => value !== 0)) return false;
    const text = scene.textIndex?.pages[0];
    if (text && hasUsableText(text.text) && !this.applied.has(text)) return false;
    if (scene.pdfOverviewKind === "raster" || scene.pdfOverviewKind === "ocr") return true;
    const r = scene.pageRects;
    const area = Math.abs((r[2] - r[0]) * (r[3] - r[1]));
    let coverage = 0;
    for (const layer of scene.rasterLayers) {
      if (layer.pageDemandSlot || layer.opacity === 0) continue;
      const m = layer.matrix;
      const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]];
      const ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
      const clipped = Math.max(0, Math.min(Math.max(...xs), Math.max(r[0], r[2])) - Math.max(Math.min(...xs), Math.min(r[0], r[2]))) *
        Math.max(0, Math.min(Math.max(...ys), Math.max(r[1], r[3])) - Math.max(Math.min(...ys), Math.min(r[1], r[3])));
      coverage += Math.min(clipped, Math.abs(m[0] * m[3] - m[1] * m[2]));
    }
    return area > 0 && coverage >= area * .5;
  }

  private next(): [number, PageRecord] | undefined {
    const order = [...new Set([...this.visible, ...this.pages.keys()])];
    for (const index of order) {
      const page = this.pages.get(index);
      if (page && !this.results.has(page.sourcePageIndex) && !this.failed.has(page.sourcePageIndex) && this.candidate(page)) return [index, page];
    }
    return undefined;
  }

  private start(): void {
    if (this.running || this.disposed || !this.enabled || this.paused || this.unavailable) return;
    if (!this.next()) { this.emit(this.failed.size ? "failed" : this.pages.size ? "complete" : "idle"); return; }
    this.running = this.pump().catch(error => {
      if (!this.disposed && !this.paused) this.diagnostic("text-recognition.failed", "Text recognition could not continue.", error);
    }).finally(() => {
      this.running = null;
      if (!this.disposed && !this.paused && !this.unavailable && this.next()) this.start();
    });
  }

  private async pump(): Promise<void> {
    while (!this.disposed && this.enabled && !this.paused) {
      const next = this.next();
      if (!next) { this.emit(this.failed.size ? "failed" : "complete"); return; }
      const [index, record] = next;
      const generation = this.generation;
      const operation = this.operation = new AbortController();
      const signal = operation.signal;
      try {
        this.emit("recognizing", index, record.sourcePageIndex, "initializing");
        signal.throwIfAborted();
        let provider: TextRecognitionProvider | null;
        try { provider = await waitForTextRecognition(this.getProvider(generation), signal); }
        catch (error) {
          signal.throwIfAborted();
          this.unavailable = true;
          this.diagnostic("text-recognition.unavailable", "A text recognition provider could not be loaded.", error);
          this.emit("unavailable");
          return;
        }
        signal.throwIfAborted();
        if (!provider) {
          this.unavailable = true;
          this.diagnostic("text-recognition.unavailable", "Text recognition is unavailable. Configure a local recognition provider to enable it on this platform.",
            this.nativeUnavailableReason ?? "No native or configured local recognizer is available.", undefined, "info");
          this.emit("unavailable");
          return;
        }
        this.emit("recognizing", index, record.sourcePageIndex, "rendering");
        signal.throwIfAborted();
        const pixels = await waitForTextRecognition(this.host.renderPage(index, this.options.dpi ?? 300, signal), signal);
        signal.throwIfAborted();
        if (!Number.isSafeInteger(pixels.width) || !Number.isSafeInteger(pixels.height) || pixels.width <= 0 || pixels.height <= 0 ||
            pixels.rgba.length !== pixels.width * pixels.height * 4) throw new Error("Recognition raster has invalid dimensions or pixels.");
        const input = { ...pixels, rgba: new Uint8Array(pixels.rgba), sourcePageIndex: record.sourcePageIndex,
          languages: this.options.languages ?? [], signal };
        this.emit("recognizing", index, record.sourcePageIndex, "recognizing");
        signal.throwIfAborted();
        let result: NormalizedText;
        try { result = normalizeResult(await waitForTextRecognition(provider.recognize(input), signal), pixels.width, pixels.height); }
        catch (error) {
          signal.throwIfAborted();
          if (this.fallbackAttempted || !this.options.fallback) throw error;
          this.diagnostic("text-recognition.native-failed", "The recognizer failed; trying the configured local fallback.", error, record.sourcePageIndex);
          const fallback = await waitForTextRecognition(this.loadFallback(generation), signal);
          signal.throwIfAborted();
          if (!fallback) throw error;
          this.emit("recognizing", index, record.sourcePageIndex, "recognizing");
          signal.throwIfAborted();
          result = normalizeResult(await waitForTextRecognition(fallback.recognize(input), signal), pixels.width, pixels.height);
        }
        signal.throwIfAborted();
        if (this.disposed || generation !== this.generation) continue;
        this.results.set(record.sourcePageIndex, result);
        if (hasUsableText(result.text)) {
          this.apply(record.scene, [index]);
          this.host.onChange(index);
        } else {
          this.diagnostic("text-recognition.no-text", "Text recognition found no usable text on the scanned page.",
            "The recognition engine returned no usable text.", record.sourcePageIndex, "info");
        }
      } catch (error) {
        if (!signal.aborted && !this.disposed && generation === this.generation) {
          this.failed.add(record.sourcePageIndex);
          this.diagnostic("text-recognition.page-failed", "Text recognition failed; the scanned page remains available.", error, record.sourcePageIndex);
        }
      } finally { if (this.operation === operation) this.operation = null; }
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }

  private getProvider(generation: number): Promise<TextRecognitionProvider | null> {
    return this.providerPending ??= (async () => {
      const configuredProvider = this.options.provider;
      const provider = configuredProvider ?? await createNativeTextRecognitionProvider({
        onUnavailable: reason => { if (generation === this.generation) this.nativeUnavailableReason = reason; }
      });
      if (generation !== this.generation || this.disposed) {
        if (provider && provider !== configuredProvider) this.disposeProvider(provider);
        return null;
      }
      if (!provider) {
        if (this.options.fallback) this.diagnostic("text-recognition.native-unavailable",
          "Browser text recognition is unavailable; trying the configured local fallback.", this.nativeUnavailableReason, undefined, "info");
        return this.loadFallback(generation);
      }
      this.providerKind = configuredProvider ? "custom" : "native";
      this.provider = provider; this.ownsProvider = provider !== this.options.provider;
      return provider;
    })();
  }

  private async loadFallback(generation: number): Promise<TextRecognitionProvider | null> {
    this.fallbackAttempted = true;
    this.releaseProvider();
    this.providerPending = Promise.resolve(null);
    const provider = await this.options.fallback?.() ?? null;
    if (generation !== this.generation || this.disposed) {
      if (provider) this.disposeProvider(provider);
      return null;
    }
    this.provider = provider; this.ownsProvider = !!provider;
    this.providerKind = provider ? "fallback" : undefined;
    this.providerPending = Promise.resolve(provider);
    return provider;
  }

  private releaseProvider(): void {
    if (this.provider && this.ownsProvider) this.disposeProvider(this.provider);
    this.provider = null; this.ownsProvider = false;
  }

  private clearEmptyResults(): void {
    for (const [sourcePageIndex, result] of this.results) {
      if (!hasUsableText(result.text)) this.results.delete(sourcePageIndex);
    }
  }

  private disposeProvider(provider: TextRecognitionProvider): void {
    try { void Promise.resolve(provider.dispose?.()).catch(error => this.diagnostic("text-recognition.cleanup-failed", "Recognition cleanup failed.", error)); }
    catch (error) { this.diagnostic("text-recognition.cleanup-failed", "Recognition cleanup failed.", error); }
  }

  private emit(state: TextRecognitionProgress["state"], pageIndex?: number, sourcePageIndex?: number,
    stage?: TextRecognitionProgress["stage"]): void {
    let total = 0, completed = 0, recognizedPages = 0;
    for (const page of this.pages.values()) {
      if (page.scene.pendingPagePreviews?.some(value => value !== 0)) continue;
      const result = this.results.get(page.sourcePageIndex);
      if (result) { total++; completed++; if (hasUsableText(result.text)) recognizedPages++; }
      else if (this.candidate(page)) total++;
    }
    if (this.progress.state === state && this.progress.completed === completed && this.progress.total === total &&
        this.progress.recognizedPages === recognizedPages &&
        this.progress.pageIndex === pageIndex && this.progress.sourcePageIndex === sourcePageIndex &&
        this.progress.provider === this.providerKind && this.progress.stage === stage) return;
    this.progress = { state, completed, total, recognizedPages, ...(pageIndex === undefined ? {} : { pageIndex }),
      ...(sourcePageIndex === undefined ? {} : { sourcePageIndex }),
      ...(this.providerKind ? { provider: this.providerKind } : {}), ...(stage ? { stage } : {}) };
    try { this.options.onProgress?.(this.getProgress()); }
    catch (error) { console.warn("[HEPR] Text recognition progress callback failed.", error); }
  }

  private diagnostic(code: string, message: string, error: unknown, pageIndex?: number, severity: "info" | "warning" = "warning"): void {
    try { this.host.onDiagnostic?.({ code, message, severity, ...(pageIndex === undefined ? {} : { pageIndex }),
      details: { reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        ...(this.providerKind ? { provider: this.providerKind } : {}) } }); }
    catch (callbackError) { console.warn("[HEPR] Text recognition diagnostic callback failed.", callbackError); }
  }
}

function emptyIndex(): PageTextIndex { return { text: "", charInstance: new Int32Array(0), fallbackQuads: new Float32Array(0) }; }
function hasUsableText(text: string): boolean { return /[^\s\ufffd\u0000]/u.test(text); }

function polygonBounds(polygon: TextRecognitionPolygon): readonly [number, number, number, number] {
  if (!Array.isArray(polygon) || polygon.length < 3) throw new Error("Recognition polygons must contain at least three points.");
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of polygon) {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) throw new Error("Recognition polygon coordinates must be finite.");
    minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]);
  }
  if (!(maxX > minX && maxY > minY)) throw new Error("Recognition polygon has no area.");
  return [minX, minY, maxX, maxY];
}

function normalizeResult(result: TextRecognitionResult, width: number, height: number): NormalizedText {
  if (!result || !Array.isArray(result.lines)) throw new Error("Recognition result must contain lines.");
  const text: string[] = [], references: number[] = [], quads: number[] = [];
  const append = (value: string, bounds: readonly number[]) => {
    for (let offset = 0; offset < value.length; offset++) {
      if (/\s/u.test(value[offset])) {
        if (text.length && text[text.length - 1] !== " ") { text.push(" "); references.push(-1); }
      } else {
        text.push(value[offset]); references.push(-2 - quads.length / 4);
        quads.push(bounds[0] / width, bounds[1] / height, bounds[2] / width, bounds[3] / height);
      }
    }
  };
  const lines: readonly TextRecognitionLine[] = result.lines;
  for (const line of lines) {
    if (typeof line.text !== "string") throw new Error("Recognition line text must be a string.");
    if (!line.text.trim()) continue;
    const bounds = polygonBounds(line.polygon);
    if (text.length && text[text.length - 1] !== " ") { text.push(" "); references.push(-1); }
    if (line.characters?.length && line.characters.map(character => character.text).join("") === line.text) {
      for (const character of line.characters) append(character.text, polygonBounds(character.polygon));
    } else {
      const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => {
        segment(text: string): Iterable<{ segment: string }> } }).Segmenter;
      const graphemes = Segmenter ? Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(line.text), part => part.segment) : Array.from(line.text);
      const polygon = line.polygon.length === 4 ? line.polygon :
        [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]];
      for (let index = 0; index < graphemes.length; index++) {
        const from = index / graphemes.length, to = (index + 1) / graphemes.length;
        const points = [from, to].flatMap(t => [[polygon[0][0] + (polygon[1][0] - polygon[0][0]) * t,
          polygon[0][1] + (polygon[1][1] - polygon[0][1]) * t],
          [polygon[3][0] + (polygon[2][0] - polygon[3][0]) * t, polygon[3][1] + (polygon[2][1] - polygon[3][1]) * t]] as const);
        append(graphemes[index], polygonBounds(points));
      }
    }
  }
  if (text.at(-1) === " ") { text.pop(); references.pop(); }
  return { text: text.join(""), references: Int32Array.from(references), quads: Float32Array.from(quads) };
}
