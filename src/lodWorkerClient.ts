import type { VectorScene } from "./pdfVectorExtractor";
import type { PreparedVectorStrokeLod, StoredVectorStrokeLod, VectorStrokeLodBoundsSource,
  VectorStrokeLodAsyncBuildOptions } from "./vectorStrokeLodCore";
import type { TextLodAsyncBuildOptions, TextLodBuildResult } from "./textGreekLod";
import { explicitStrokePaintOrigins } from "./vectorStrokePaintOrder";
import { sceneRequiresPaintCompositing } from "./scenePaintVisibility";

type StrokeInputs = Pick<VectorScene, "bounds" | "maxHalfWidth" | "segmentCount" |
  "endpoints" | "primitiveMeta" | "primitiveBounds" | "styles" | "drawRuns">;
type TextInputs = Pick<VectorScene, "bounds" | "pageCount" | "pageRects" | "pageTextRanges" |
  "textInstanceCount" | "textInstanceA" | "textInstanceB" | "textInstanceC" |
  "textGlyphCount" | "textGlyphMetaA" | "textGlyphMetaB" | "textGlyphSegmentsA" | "textGlyphSegmentsB" | "drawRuns">;

export type LodWorkerRequest =
  | { type: "vector"; scene: StrokeInputs; stored?: VectorStrokeLodBoundsSource; origins?: Uint32Array; overviewAllowed: boolean }
  | { type: "text"; scene: TextInputs };
export type LodWorkerResponse =
  | { type: "progress"; value: number; message: string }
  | { type: "vector"; result: PreparedVectorStrokeLod }
  | { type: "text"; result: TextLodBuildResult }
  | { type: "error"; message: string };

export async function buildVectorLodInWorker(scene: VectorScene, stored: StoredVectorStrokeLod | undefined,
  options: VectorStrokeLodAsyncBuildOptions): Promise<PreparedVectorStrokeLod | null> {
  return runLodWorker({
    type: "vector", stored: stored && { literals: stored.literals, origins: stored.origins,
      levels: stored.levels.map(level => ({ segmentCount: level.segmentCount, records: level.records })) },
    origins: explicitStrokePaintOrigins(scene),
    overviewAllowed: !sceneRequiresPaintCompositing(scene) && !scene.drawRuns?.some(run => run.blendMode),
    scene: {
      bounds: scene.bounds, maxHalfWidth: scene.maxHalfWidth, segmentCount: scene.segmentCount,
      endpoints: scene.endpoints, primitiveMeta: scene.primitiveMeta,
      primitiveBounds: scene.primitiveBounds, styles: scene.styles,
      drawRuns: scene.drawRuns?.filter(run => run.kind === "stroke")
    }
  }, options) as Promise<PreparedVectorStrokeLod | null>;
}

export async function buildTextLodInWorker(scene: VectorScene,
  options: TextLodAsyncBuildOptions): Promise<TextLodBuildResult | null> {
  const result = await runLodWorker({
    type: "text", scene: {
      bounds: scene.bounds, pageCount: scene.pageCount, pageRects: scene.pageRects, pageTextRanges: scene.pageTextRanges,
      textInstanceCount: scene.textInstanceCount, textInstanceA: scene.textInstanceA,
      textInstanceB: scene.textInstanceB, textInstanceC: scene.textInstanceC,
      textGlyphCount: scene.textGlyphCount, textGlyphMetaA: scene.textGlyphMetaA,
      textGlyphMetaB: scene.textGlyphMetaB, textGlyphSegmentsA: scene.textGlyphSegmentsA,
      textGlyphSegmentsB: scene.textGlyphSegmentsB,
      drawRuns: scene.drawRuns?.filter(run => run.kind === "text")
    }
  }, options) as TextLodBuildResult | null;
  if (!result) return null;
  // Structured cloning preserves values, but drops Object.freeze. Restore the
  // immutable shared-data contract before publishing to the renderer caches.
  const data = result.data;
  if (data) {
    for (const run of data.runs) {
      Object.freeze(run.bounds); Object.freeze(run.transform); Object.freeze(run);
    }
    for (const node of [...data.clusters, ...data.pages]) {
      Object.freeze(node.bounds);
      if (node.inkHeightDirection) Object.freeze(node.inkHeightDirection);
      if (node.baselineDirection) Object.freeze(node.baselineDirection);
      Object.freeze(node);
    }
    Object.freeze(data.runs); Object.freeze(data.clusters); Object.freeze(data.pages); Object.freeze(data);
  }
  return Object.freeze(result);
}

type WorkerOptions = Pick<TextLodAsyncBuildOptions, "signal" | "shouldCancel" | "onProgress">;

function cancelledError(type: LodWorkerRequest["type"]): Error {
  const error = new Error(`${type === "vector" ? "Vector" : "Text"} LOD build cancelled.`);
  error.name = type === "vector" ? "VectorStrokeLodBuildCancelledError" : "TextLodBuildCancelledError";
  return error;
}

async function runLodWorker(request: LodWorkerRequest,
  options: WorkerOptions): Promise<PreparedVectorStrokeLod | TextLodBuildResult | null> {
  const checkCancelled = (): void => {
    if (options.signal?.aborted || options.shouldCancel?.()) throw cancelledError(request.type);
  };
  checkCancelled();
  let worker: Worker;
  try {
    worker = new Worker(new URL("./lodWorkerEntry.ts", import.meta.url), { type: "module", name: "hepr-lod" });
  } catch (error) {
    console.warn("[HEPR] LOD worker unavailable; preparing cooperatively.", error);
    return null;
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let cancellationTimer: ReturnType<typeof setInterval> | undefined;
    const cleanup = (): void => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onMessageError);
      options.signal?.removeEventListener("abort", onAbort);
      if (cancellationTimer !== undefined) clearInterval(cancellationTimer);
      worker.terminate();
    };
    const fail = (error: unknown, fallback = false): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (fallback) {
        console.warn("[HEPR] LOD worker failed; preparing cooperatively.", error);
        resolve(null);
      } else reject(error);
    };
    const pollCancellation = (): void => {
      try { checkCancelled(); } catch (error) { fail(error); }
    };
    const onAbort = (): void => fail(cancelledError(request.type));
    const onMessage = (event: MessageEvent<LodWorkerResponse>): void => {
      if (settled) return;
      try {
        checkCancelled();
        const response = event.data;
        if (!response || typeof response !== "object") {
          fail(new Error("The LOD worker returned an unreadable response."), true);
          return;
        }
        if (response.type === "progress") options.onProgress?.({ value: response.value, message: response.message });
        else if (response.type === "error") fail(new Error(response.message), true);
        else if (response.type === request.type) {
          settled = true;
          cleanup();
          resolve(response.result);
        } else fail(new Error("The LOD worker returned an unexpected response."), true);
      } catch (error) { fail(error); }
    };
    const onError = (event: ErrorEvent): void => {
      event.preventDefault();
      fail(event.error ?? new Error(event.message || "The LOD worker failed."), true);
    };
    const onMessageError = (): void => fail(new Error("The LOD worker returned an unreadable response."), true);
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onMessageError);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.shouldCancel) cancellationTimer = setInterval(pollCancellation, 50);
    pollCancellation();
    if (settled) return;
    try {
      // Clone only builder inputs. The renderer's canonical arrays stay attached;
      // only newly prepared buffers are transferred back from the worker.
      worker.postMessage(request);
    } catch (error) { fail(error, true); }
  });
}
