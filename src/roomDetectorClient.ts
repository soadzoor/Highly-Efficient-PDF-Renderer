import type { VectorScene } from "./pdfVectorExtractor";
import type { RoomDetectionOptions, RoomDetectionResult, RoomDetectionScene } from "./roomDetector";

export interface RoomDetectionRequest {
  scene: RoomDetectionScene;
  options: Omit<RoomDetectionOptions, "signal">;
}

export type RoomDetectionResponse =
  | { type: "result"; result: RoomDetectionResult }
  | { type: "error"; name: string; message: string };

/** Run each browser detection in an isolated worker, releasing it on completion or abort. */
export async function detectRoomsInWorker(
  scene: VectorScene,
  options: RoomDetectionOptions = {}
): Promise<RoomDetectionResult> {
  const { signal, ...detectorOptions } = options;
  signal?.throwIfAborted();

  if (typeof Worker === "undefined") {
    if (typeof window !== "undefined") {
      throw new Error("Room detection requires Web Worker support.");
    }
    // Preserve the package's non-browser API without requiring a worker shim.
    const { detectRooms } = await import("./roomDetector");
    signal?.throwIfAborted();
    return detectRooms(scene, detectorOptions);
  }

  const worker = new Worker(new URL("./roomDetectorWorker.ts", import.meta.url), {
    type: "module",
    name: "hepr-room-detector"
  });

  return new Promise<RoomDetectionResult>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onMessageError);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onMessage = (event: MessageEvent<RoomDetectionResponse>): void => {
      if (settled) return;
      const response = event.data;
      if (response.type === "error") {
        const error = new Error(response.message);
        error.name = response.name;
        fail(error);
      } else {
        settled = true;
        cleanup();
        resolve(response.result);
      }
    };
    const onError = (event: ErrorEvent): void => {
      event.preventDefault();
      fail(event.error ?? new Error(event.message || "The room detector worker failed."));
    };
    const onMessageError = (): void => {
      fail(new Error("The room detector worker returned an unreadable response."));
    };
    const onAbort = (): void => fail(signal?.reason);

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onMessageError);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    try {
      // Clone only detection inputs. Transferring the renderer's buffers would
      // detach them and break rendering, search, and subsequent detection calls.
      const request: RoomDetectionRequest = {
        scene: {
          pageRects: scene.pageRects,
          segmentCount: scene.segmentCount,
          endpoints: scene.endpoints,
          primitiveMeta: scene.primitiveMeta,
          primitiveBounds: scene.primitiveBounds,
          styles: scene.styles,
          textContent: scene.textContent,
          textIndex: scene.textIndex,
          textInstanceA: scene.textInstanceA,
          textInstanceB: scene.textInstanceB,
          textGlyphMetaA: scene.textGlyphMetaA,
          textGlyphMetaB: scene.textGlyphMetaB
        },
        options: detectorOptions
      };
      worker.postMessage(request);
    } catch (error) {
      fail(error);
    }
  });
}
