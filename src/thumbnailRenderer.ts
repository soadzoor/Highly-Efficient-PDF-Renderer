import { waitForLoad } from "./loadCancellation";
import { createDefaultOptionalContentSnapshot, type OptionalContentSnapshot } from "./optionalContent";
import type { VectorScene } from "./pdfVectorExtractor";
import { RetainedPageReplay } from "./retainedPageReplay";
import { thumbnailSize, type ThumbnailPixels, type ThumbnailRenderOptions, type ThumbnailStageTiming } from "./thumbnailTypes";
import { defaultVectorDrawRuns } from "./vectorDrawOrder";
import { WebGlFloorplanRenderer } from "./webGlFloorplanRenderer";

type ThumbnailCanvas = HTMLCanvasElement | OffscreenCanvas;

/** Capability failure, distinct from an invalid scene or a failed draw. */
export class ThumbnailWebGlUnavailableError extends Error {
  readonly code = "thumbnail.webgl-unavailable";
  constructor(cause?: unknown) {
    super("WebGL2 thumbnail rendering is unavailable in this environment.", cause === undefined ? undefined : { cause });
    this.name = "ThumbnailWebGlUnavailableError";
  }
}

/** Reuses one static GPU context; scenes and their buffers remain caller-owned. */
export class ThumbnailSceneRenderer {
  private canvas: ThumbnailCanvas | null = null;
  private renderer: WebGlFloorplanRenderer | null = null;
  private readonly lifetime = new AbortController();
  private pending: Promise<void> = Promise.resolve();

  render(scene: VectorScene, options: ThumbnailRenderOptions, signal?: AbortSignal): Promise<ThumbnailPixels> {
    const operationSignal = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
    operationSignal.throwIfAborted();
    const operation = this.pending.then(() => this.renderPage(scene, options, operationSignal));
    this.pending = operation.then(() => {}, () => {});
    return waitForLoad(operation, operationSignal);
  }

  close(): void {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort(new DOMException("The thumbnail renderer is closed.", "AbortError"));
    this.releaseRenderer();
  }

  private async renderPage(scene: VectorScene, options: ThumbnailRenderOptions, signal: AbortSignal): Promise<ThumbnailPixels> {
    signal.throwIfAborted();
    if (options.backend === "canvas2d") throw new Error("Canvas2D thumbnails require a PDF page; compiled HEP scenes use WebGL2.");
    const bounds = scene.pageBounds;
    const size = thumbnailSize(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, options.maxDimension);
    if (!Number.isSafeInteger(size.width * size.height * 4)) throw new RangeError("Thumbnail pixel dimensions exceed safe integer limits.");
    const local = copyScene(scene);
    const visibility = thumbnailVisibility(local, options.optionalContent);
    const background = validateColor(options.background);
    const vector = validateColor(options.vectorOverride ?? [0, 0, 0, 0]);
    let replay: RetainedPageReplay | null = null;
    const timings: ThumbnailStageTiming[] = [];
    try {
      // A task boundary allows worker cancellation without depending on RAF or
      // a foreground browser tab. GPU upload and the draw stay in one task.
      await waitForLoad(new Promise<void>(resolve => setTimeout(resolve, 0)), signal);
      const needsFactory = !this.renderer, factoryStarted = performance.now();
      this.ensureRenderer();
      if (needsFactory) timings.push({ stage: "factory", durationMs: performance.now() - factoryStarted });
      const canvas = this.canvas!, renderer = this.renderer!;
      canvas.width = size.width; canvas.height = size.height;
      const uploadStarted = performance.now();
      renderer.setScene(local);
      renderer.setPageBackgroundColor(...background);
      renderer.setVectorColorOverride(...vector);
      renderer.setOptionalContentVisibility(visibility);
      let uploadMs = performance.now() - uploadStarted;
      if (local.retainedPages?.length) {
        replay = new RetainedPageReplay(local, async (page, first, count, spanSignal) => {
          const { renderNativeRetainedCommandSpan } = await import("./retainedPageCompositor");
          return renderNativeRetainedCommandSpan(page, first, count, spanSignal, undefined, undefined,
            { maxDimension: options.maxDimension });
        });
        const updates = await replay.prepare(visibility, { signal });
        signal.throwIfAborted();
        const updateStarted = performance.now();
        const staged = await renderer.prepareRasterLayerUpdatesAsync(updates.layers);
        try {
          signal.throwIfAborted(); staged.commit(); updates.commit();
        } finally { staged.dispose(); }
        uploadMs += performance.now() - updateStarted;
      }
      timings.push({ stage: "upload", durationMs: uploadMs });
      signal.throwIfAborted();
      const rgba = renderer.renderThumbnailFrame(bounds, size.width, size.height, signal,
        (stage, durationMs) => timings.push({ stage, durationMs }));
      return { width: size.width, height: size.height, rgba, timings };
    } catch (error) {
      this.releaseRenderer();
      signal.throwIfAborted();
      throw error;
    } finally { replay?.dispose(); }
  }

  private ensureRenderer(): void {
    if (this.renderer) return;
    let failure: unknown;
    const factories: (() => ThumbnailCanvas)[] = [];
    if (typeof OffscreenCanvas === "function") factories.push(() => new OffscreenCanvas(1, 1));
    if (typeof document !== "undefined") factories.push(() => document.createElement("canvas"));
    for (const factory of factories) {
      let canvas: ThumbnailCanvas | null = null;
      try {
        canvas = factory();
        const context = canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false,
          alpha: true, premultipliedAlpha: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
        if (!context) throw new ThumbnailWebGlUnavailableError();
      } catch (error) {
        failure = error;
        if (canvas) releaseCanvas(canvas);
        continue;
      }
      try {
        const renderer = new WebGlFloorplanRenderer(canvas, { thumbnail: true });
        this.canvas = canvas; this.renderer = renderer;
        return;
      } catch (error) { releaseCanvas(canvas); throw error; }
    }
    throw new ThumbnailWebGlUnavailableError(failure);
  }

  private releaseRenderer(): void {
    const renderer = this.renderer, canvas = this.canvas;
    this.renderer = null; this.canvas = null;
    try { renderer?.dispose(); }
    finally { if (canvas) releaseCanvas(canvas); }
  }
}

export async function renderThumbnailScene(scene: VectorScene, options: ThumbnailRenderOptions, signal?: AbortSignal): Promise<ThumbnailPixels> {
  const renderer = new ThumbnailSceneRenderer();
  try { return await renderer.render(scene, options, signal); }
  finally { renderer.close(); }
}

function copyScene(scene: VectorScene): VectorScene {
  const descriptors = Object.getOwnPropertyDescriptors(scene);
  descriptors.drawRuns = { enumerable: true, configurable: true, writable: true,
    value: scene.drawRuns ?? defaultVectorDrawRuns(scene) };
  // Page loaders mark overviews pending for an interactive loading animation.
  // Static thumbnails draw the available content without that animation.
  descriptors.pendingPagePreviews = { enumerable: true, configurable: true, writable: true, value: undefined };
  const local = Object.defineProperties({}, descriptors) as VectorScene;
  compactGlyphs(local);
  return local;
}

/** Extracted HEP pages share document-wide fonts. Upload only the outlines
 * referenced by this page, without copying or detaching the document buffers. */
function compactGlyphs(scene: VectorScene): void {
  const glyphs = new Map<number, number>();
  const instances = scene.textInstanceB.slice(0, scene.textInstanceCount * 4);
  let segments = 0;
  for (let instance = 0; instance < scene.textInstanceCount; instance++) {
    const offset = instance * 4 + 2, glyph = instances[offset];
    if (!Number.isSafeInteger(glyph) || glyph < 0 || glyph >= scene.textGlyphCount) throw new RangeError("Thumbnail text references an invalid glyph.");
    let local = glyphs.get(glyph);
    if (local === undefined) {
      local = glyphs.size; glyphs.set(glyph, local);
      const start = scene.textGlyphMetaA[glyph * 4], count = scene.textGlyphMetaA[glyph * 4 + 1];
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 0 || count < 0 ||
          (start + count) * 4 > Math.min(scene.textGlyphSegmentsA.length, scene.textGlyphSegmentsB.length)) {
        throw new RangeError("Thumbnail text has an invalid glyph outline range.");
      }
      segments += count;
    }
    instances[offset] = local;
  }
  const metaA = new Float32Array(glyphs.size * 4), metaB = new Float32Array(glyphs.size * 4);
  const segmentsA = new Float32Array(segments * 4), segmentsB = new Float32Array(segments * 4);
  let segment = 0;
  for (const [source, target] of glyphs) {
    const offset = source * 4, start = scene.textGlyphMetaA[offset], count = scene.textGlyphMetaA[offset + 1];
    metaA.set(scene.textGlyphMetaA.subarray(offset, offset + 4), target * 4);
    metaA[target * 4] = segment;
    metaB.set(scene.textGlyphMetaB.subarray(offset, offset + 4), target * 4);
    segmentsA.set(scene.textGlyphSegmentsA.subarray(start * 4, (start + count) * 4), segment * 4);
    segmentsB.set(scene.textGlyphSegmentsB.subarray(start * 4, (start + count) * 4), segment * 4);
    segment += count;
  }
  scene.textInstanceB = instances;
  scene.textGlyphCount = glyphs.size; scene.textGlyphSegmentCount = segments;
  scene.textGlyphMetaA = metaA; scene.textGlyphMetaB = metaB;
  scene.textGlyphSegmentsA = segmentsA; scene.textGlyphSegmentsB = segmentsB;
}

function thumbnailVisibility(scene: VectorScene, supplied?: OptionalContentSnapshot): OptionalContentSnapshot {
  if (!supplied || !scene.optionalContent) return createDefaultOptionalContentSnapshot(scene);
  const values = new Map(supplied.layers.map(layer => [layer.id, layer.visible]));
  const descriptors = Object.getOwnPropertyDescriptors(scene);
  descriptors.optionalContent = { enumerable: true, configurable: true, writable: true, value: { ...scene.optionalContent,
    groups: scene.optionalContent.groups.map(group => ({ ...group, defaultVisible: values.get(group.id) ?? group.defaultVisible }))
  } };
  const snapshot = createDefaultOptionalContentSnapshot(Object.defineProperties({}, descriptors) as VectorScene);
  return { ...snapshot, revision: supplied.revision };
}

function validateColor(value: readonly [number, number, number, number]): [number, number, number, number] {
  if (value.length !== 4 || !value.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 1)) {
    throw new RangeError("Thumbnail colors require four normalized finite channels.");
  }
  return [...value];
}

function releaseCanvas(canvas: ThumbnailCanvas): void {
  try {
    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch { /* Unsupported or already-lost contexts still release their surface. */ }
  finally { canvas.width = canvas.height = 0; }
}
