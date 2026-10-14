import { encodeThumbnailPixelsDirect, type ThumbnailEncodingFormat } from "./thumbnailEncodingCore";
import type { ThumbnailEncodeResponse } from "./thumbnailEncoder";
import type { PdfDiagnostic } from "./pdf/nativeTypes";
import type { ThumbnailPixels } from "./thumbnailTypes";

interface NodeParentPort {
  on(type: "message", listener: (request: { id: number; pixels: ThumbnailPixels; format: ThumbnailEncodingFormat }) => void): void;
  postMessage(response: ThumbnailEncodeResponse): void;
}

async function attach(): Promise<void> {
  const moduleName = "node:worker_threads";
  const { parentPort } = await import(/* @vite-ignore */ moduleName) as { parentPort: NodeParentPort | null };
  if (!parentPort) throw new Error("The Node thumbnail encoder entry must run inside a worker thread.");
  parentPort.on("message", ({ id, pixels, format }) => {
    const diagnostics: PdfDiagnostic[] = [];
    void encodeThumbnailPixelsDirect(pixels, format, undefined, diagnostic => diagnostics.push(diagnostic)).then(
      blob => parentPort.postMessage({ id, blob, diagnostics }),
      error => parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error), diagnostics })
    );
  });
}

void attach().catch(error => { setTimeout(() => { throw error; }, 0); });
