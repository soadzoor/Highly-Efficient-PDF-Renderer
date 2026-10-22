import { openDocumentSession } from "./documentSession";
import { renderPdfThumbnail, normalizeThumbnailOptions, type PdfThumbnailOptions, type PdfThumbnailResult } from "./pdfThumbnail";
import { loadPdfSceneFromSource, type LoadedPdfScene } from "./pdfObjectGenerator";
import { WebGlPdfRenderer } from "./webGlPdfRenderer";
import { ThumbnailEncoder } from "./thumbnailEncoder";
import { thumbnailSize } from "./thumbnailTypes";
import { RetainedPageReplay } from "./retainedPageReplay";
import { createDefaultOptionalContentSnapshot } from "./optionalContent";

type Backend = "webgl" | "canvas2d";
type Format = "png" | "webp";
type Mode = "fresh" | "reused";
type Route = "thumbnail" | "interactive-baseline";
interface BenchSession {
  renderThumbnail(options: PdfThumbnailOptions): Promise<PdfThumbnailResult>;
  close(): void | Promise<void>;
}
interface Sample {
  readonly iteration: number;
  readonly timings: Record<string, number>;
  readonly width?: number;
  readonly height?: number;
  readonly bytes?: number;
  readonly mimeType?: string;
  readonly diagnostics: unknown[];
  readonly error?: string;
}
interface Group {
  readonly file: string;
  readonly fileBytes: number;
  readonly page: number;
  readonly maxDimension: number;
  readonly backend: Backend;
  readonly mode: Mode;
  readonly format: Format;
  readonly background: string;
  readonly route: Route;
  readonly samples: Sample[];
  warmup?: Sample;
  sessionOpenMs?: number;
}

const query = <T extends Element>(selector: string): T => document.querySelector<T>(selector)!;
const controls = query<HTMLFormElement>("#controls");
const filesInput = query<HTMLInputElement>("#files");
const pageInput = query<HTMLInputElement>("#page");
const backgroundInput = query<HTMLSelectElement>("#background");
const runButton = query<HTMLButtonElement>("#run");
const cancelButton = query<HTMLButtonElement>("#cancel");
const downloadButton = query<HTMLButtonElement>("#download");
const status = query<HTMLParagraphElement>("#status");
const rows = query<HTMLTableSectionElement>("#rows");
const preview = query<HTMLDivElement>("#preview");
const groups: Group[] = [];
const repetitions = 5;
let controller: AbortController | undefined;
let previewUrl: string | undefined;
let startedAt: string | undefined;
let markSequence = 0;

controls.addEventListener("submit", event => {
  event.preventDefault();
  if (controller) return;
  const files = [...(filesInput.files ?? [])];
  const page = Number(pageInput.value), background = backgroundInput.value;
  if (!files.length || !Number.isSafeInteger(page) || page < 1) { status.textContent = "Select PDFs and a positive page number."; return; }
  controller = new AbortController();
  void runMatrix(files, page, background, controller.signal);
});
cancelButton.addEventListener("click", () => controller?.abort(new DOMException("Benchmark cancelled.", "AbortError")));
downloadButton.addEventListener("click", () => {
  const report = { version: 1, startedAt, repetitions, userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency, devicePixelRatio: window.devicePixelRatio,
    visibility: document.visibilityState,
    notes: ["Draw is CPU submission; readback includes GPU waiting.",
      "Presentation is a requestAnimationFrame plus following-task estimate, not an exact paint event.",
      "Prepare-render is an aggregate overlapping prepare, factory, upload, draw and readback.",
      "Fresh sessions retain browser module and HTTP caches; reused sessions have one unmeasured warmup."],
    groups: groups.map(group => ({ ...group, summary: summarize(group.samples) })) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "hepr-thumbnail-benchmark.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

async function runMatrix(files: File[], page: number, background: string, signal: AbortSignal): Promise<void> {
  groups.length = 0; rows.replaceChildren(); startedAt = new Date().toISOString();
  runButton.disabled = filesInput.disabled = pageInput.disabled = backgroundInput.disabled = true;
  cancelButton.disabled = false; downloadButton.disabled = true;
  try {
    for (const file of files) for (const maxDimension of [160, 400]) for (const format of ["png", "webp"] as const) {
      // Alternate backend order across dimensions/formats to reduce systematic
      // cache and thermal bias; modes still retain their distinct setup costs.
      const backends: Backend[] = (maxDimension === 160) === (format === "png") ? ["webgl", "canvas2d"] : ["canvas2d", "webgl"];
      const routes: { backend: Backend; route: Route }[] = backends.map(backend => ({ backend, route: "thumbnail" }));
      if (background !== "transparent") routes.push({ backend: "webgl", route: "interactive-baseline" });
      for (const { backend, route } of routes) for (const mode of ["fresh", "reused"] as const) {
        signal.throwIfAborted();
        const group: Group = { file: file.name, fileBytes: file.size, page, maxDimension, backend, mode, format, background, route, samples: [] };
        groups.push(group);
        const row = document.createElement("tr"); rows.append(row);
        let session: BenchSession | undefined;
        try {
          if (mode === "reused") {
            const opened = performance.now();
            session = route === "thumbnail" ? await openDocumentSession(file, { signal }) : new InteractiveBaseline(file);
            group.sessionOpenMs = performance.now() - opened;
            group.warmup = await measure(group, file, session, -1, signal);
            if (group.warmup.error) throw new Error(group.warmup.error);
          }
          for (let iteration = 0; iteration < repetitions; iteration++) {
            signal.throwIfAborted();
            status.textContent = `${file.name} · ${maxDimension}px · ${backend} · ${route} · ${mode} · ${format} · run ${iteration + 1}/${repetitions}`;
            group.samples.push(await measure(group, file, session, iteration, signal));
            updateRow(row, group);
          }
        } catch (error) {
          signal.throwIfAborted();
          group.samples.push({ iteration: group.samples.length, timings: {}, diagnostics: [], error: errorText(error) });
          updateRow(row, group);
        } finally { await session?.close(); }
        downloadButton.disabled = false;
      }
    }
    status.textContent = "Finished. Compare the displayed overviews and download the full timing report.";
  } catch (error) {
    status.textContent = signal.aborted ? "Cancelled. Completed measurements remain available." : errorText(error);
  } finally {
    controller = undefined;
    runButton.disabled = filesInput.disabled = pageInput.disabled = backgroundInput.disabled = false;
    cancelButton.disabled = true; downloadButton.disabled = groups.length === 0;
  }
}

async function measure(group: Group, file: File, session: BenchSession | undefined, iteration: number, signal: AbortSignal): Promise<Sample> {
  const timings: Record<string, number> = {}, diagnostics: unknown[] = [];
  const label = `hepr-thumbnail:${++markSequence}`;
  const mark = (phase: string): void => { performance.mark(`${label}:${phase}`); };
  const options: PdfThumbnailOptions = { page: group.page, maxDimension: group.maxDimension,
    format: group.format, backend: group.backend, background: group.background, signal,
    onTiming: timing => { timings[timing.stage] = (timings[timing.stage] ?? 0) + timing.durationMs; },
    onDiagnostic: diagnostic => diagnostics.push(diagnostic) };
  const began = performance.now(); mark("start");
  let result: PdfThumbnailResult;
  try {
    if (session) result = await session.renderThumbnail(options);
    else if (group.route === "interactive-baseline") {
      const baseline = new InteractiveBaseline(file);
      try { result = await baseline.renderThumbnail(options); }
      finally { await baseline.close(); }
    } else result = await renderPdfThumbnail(file, options);
    signal.throwIfAborted(); timings.result = performance.now() - began; mark("blob");
    const url = URL.createObjectURL(result.blob), image = document.createElement("img");
    try {
      image.width = result.width; image.height = result.height;
      image.alt = `${group.file}, page ${group.page}, ${group.backend}, ${group.format}`;
      const decodeStarted = performance.now(); image.src = url;
      await image.decode(); signal.throwIfAborted();
      timings.decode = performance.now() - decodeStarted; mark("decoded");
      const presentationStarted = performance.now();
      preview.replaceChildren(image);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = url;
      await presentationOpportunity(signal);
      timings["presentation-estimate"] = performance.now() - presentationStarted;
      timings["visible-estimate"] = performance.now() - began; mark("presentation-estimate");
      performance.measure(`${label}:until-blob`, `${label}:start`, `${label}:blob`);
      performance.measure(`${label}:until-presentation-estimate`, `${label}:start`, `${label}:presentation-estimate`);
    } catch (error) { if (previewUrl !== url) URL.revokeObjectURL(url); throw error; }
    return { iteration, timings, diagnostics, width: result.width, height: result.height,
      bytes: result.blob.size, mimeType: result.blob.type };
  } catch (error) {
    signal.throwIfAborted();
    return { iteration, timings, diagnostics, error: errorText(error) };
  }
}

async function presentationOpportunity(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    let frame = 0, task: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => { cancelAnimationFrame(frame); clearTimeout(task); signal.removeEventListener("abort", abort); };
    const abort = (): void => { cleanup(); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    frame = requestAnimationFrame(() => { task = setTimeout(() => { cleanup(); resolve(); }, 0); });
    if (signal.aborted) abort();
  });
}

function summarize(samples: readonly Sample[]): Record<string, { median: number; p95: number }> {
  const success = samples.filter(sample => !sample.error), stages = new Set(success.flatMap(sample => Object.keys(sample.timings)));
  return Object.fromEntries([...stages].map(stage => {
    const values = success.flatMap(sample => sample.timings[stage] === undefined ? [] : [sample.timings[stage]]).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return [stage, { median: values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
      p95: values[Math.max(0, Math.ceil(values.length * .95) - 1)] }];
  }));
}

function updateRow(row: HTMLTableRowElement, group: Group): void {
  const summary = summarize(group.samples), success = group.samples.filter(sample => !sample.error);
  const cell = (value: string): void => { const element = document.createElement("td"); element.textContent = value; row.append(element); };
  row.replaceChildren();
  const fallback = success.some(sample => sample.mimeType !== `image/${group.format}`) ? " (PNG fallback)" : "";
  cell(`${group.file} / ${group.maxDimension} / ${group.backend} / ${group.route} / ${group.mode} / ${group.format}${fallback}`);
  cell(`${success.length}/${group.samples.length}`);
  for (const stage of ["source-open", "prepare", "factory", "upload", "draw", "readback", "encode", "decode", "presentation-estimate", "result", "visible-estimate"]) {
    const timing = summary[stage]; cell(timing ? `${timing.median.toFixed(1)} / ${timing.p95.toFixed(1)}` : "—");
  }
  cell(success.length ? Math.round(success.reduce((sum, sample) => sum + sample.bytes!, 0) / success.length).toLocaleString() : "—");
  row.title = group.samples.filter(sample => sample.error).map(sample => sample.error).join("\n") ||
    [...new Set(success.map(sample => sample.mimeType))].join(", ");
}

function errorText(error: unknown): string { return error instanceof Error ? `${error.name}: ${error.message}` : String(error); }

/** Full page preparation and the existing interactive renderer at the matched
 * output size. This is a diagnostic baseline, not an exact old Reader replay. */
class InteractiveBaseline implements BenchSession {
  private loaded: LoadedPdfScene | undefined;
  private renderer: WebGlPdfRenderer | undefined;
  private canvas: HTMLCanvasElement | undefined;
  private readonly encoder = new ThumbnailEncoder();
  private replay: RetainedPageReplay | undefined;
  constructor(private readonly file: File) {}

  async renderThumbnail(options: PdfThumbnailOptions): Promise<PdfThumbnailResult> {
    const signal = options.signal;
    signal?.throwIfAborted();
    const started = performance.now(), renderOptions = normalizeThumbnailOptions(options);
    if (!this.loaded) {
      const prepareStarted = performance.now();
      this.loaded = await loadPdfSceneFromSource(this.file, { pages: String(options.page ?? 1), pageLoading: "eager",
        signal, onDiagnostic: options.onDiagnostic }, signal);
      options.onTiming?.({ stage: "prepare", durationMs: performance.now() - prepareStarted });
      signal?.throwIfAborted();
    }
    const scene = this.loaded.scene;
    const size = thumbnailSize(scene.pageBounds.maxX - scene.pageBounds.minX, scene.pageBounds.maxY - scene.pageBounds.minY, renderOptions.maxDimension);
    if (!this.renderer) {
      const factoryStarted = performance.now();
      const canvas = this.canvas = document.createElement("canvas");
      canvas.width = size.width; canvas.height = size.height;
      this.renderer = new WebGlPdfRenderer(canvas, { preserveDrawingBuffer: true });
      this.renderer.setExternalFrameDriver(true);
      options.onTiming?.({ stage: "factory", durationMs: performance.now() - factoryStarted });
      const uploadStarted = performance.now();
      this.renderer.setScene(scene);
      this.renderer.setPageBackgroundColor(...renderOptions.background);
      if (scene.retainedPages?.length) {
        this.replay = new RetainedPageReplay(scene);
        const replay = await this.replay.prepare(createDefaultOptionalContentSnapshot(scene), { signal: signal ?? new AbortController().signal });
        const staged = await this.renderer.prepareRasterLayerUpdatesAsync(replay.layers);
        try { signal?.throwIfAborted(); staged.commit(); replay.commit(); } finally { staged.dispose(); }
      }
      this.renderer.fitToBounds(scene.pageBounds, 0);
      options.onTiming?.({ stage: "upload", durationMs: performance.now() - uploadStarted });
    }
    signal?.throwIfAborted();
    const drawStarted = performance.now();
    this.renderer.renderExternalFrame();
    options.onTiming?.({ stage: "draw", durationMs: performance.now() - drawStarted });
    signal?.throwIfAborted();
    const readbackStarted = performance.now(), rgba = new Uint8Array(size.width * size.height * 4);
    const gl = this.canvas!.getContext("webgl2")!;
    gl.readPixels(0, 0, size.width, size.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    const rowBytes = size.width * 4;
    for (let y = 0; y < Math.floor(size.height / 2); y++) {
      signal?.throwIfAborted();
      for (let x = 0; x < rowBytes; x++) {
        const first = y * rowBytes + x, last = (size.height - y - 1) * rowBytes + x;
        const value = rgba[first]; rgba[first] = rgba[last]; rgba[last] = value;
      }
    }
    options.onTiming?.({ stage: "readback", durationMs: performance.now() - readbackStarted });
    options.onTiming?.({ stage: "prepare-render", durationMs: performance.now() - started });
    const encodeStarted = performance.now();
    const blob = await this.encoder.encode({ width: size.width, height: size.height, rgba }, options.format ?? "webp", signal, options.onDiagnostic);
    options.onTiming?.({ stage: "encode", durationMs: performance.now() - encodeStarted });
    options.onTiming?.({ stage: "total", durationMs: performance.now() - started });
    return { blob, width: size.width, height: size.height };
  }

  async close(): Promise<void> {
    this.encoder.close(); this.replay?.dispose(); this.renderer?.dispose();
    if (this.canvas) { this.canvas.width = this.canvas.height = 0; }
    await this.loaded?.pageDemand?.close();
    this.loaded = undefined; this.renderer = undefined; this.canvas = undefined;
  }
}

window.addEventListener("pagehide", () => {
  controller?.abort(new DOMException("Benchmark page closed.", "AbortError"));
  if (previewUrl) URL.revokeObjectURL(previewUrl);
});
