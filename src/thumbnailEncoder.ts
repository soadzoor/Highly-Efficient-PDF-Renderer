import type { PdfDiagnostic } from "./pdf/nativeTypes";
import type { ThumbnailPixels } from "./thumbnailTypes";

import { encodeThumbnailPixelsDirect, validateThumbnailPixels, throwIfThumbnailEncodingCancelled,
  thumbnailEncodingAbortReason, type ThumbnailEncodingFormat } from "./thumbnailEncodingCore";
export { encodeThumbnailPixelsDirect, createThumbnailWebpCodec, THUMBNAIL_WEBP_ASSET } from "./thumbnailEncodingCore";
export type { ThumbnailEncodingFormat } from "./thumbnailEncodingCore";
type DiagnosticHandler = (diagnostic: PdfDiagnostic) => void;

interface EncodeRequest { readonly id: number; readonly pixels: ThumbnailPixels; readonly format: ThumbnailEncodingFormat }
export interface ThumbnailEncodeResponse { readonly id: number; readonly blob?: Blob; readonly error?: string; readonly diagnostics?: PdfDiagnostic[] }
interface EncodeJob extends EncodeRequest {
  readonly signal?: AbortSignal;
  readonly onDiagnostic?: DiagnosticHandler;
  readonly resolve: (blob: Blob) => void;
  readonly reject: (reason: unknown) => void;
  readonly cancellation: AbortController;
  abort(): void;
  settled: boolean;
  worker?: Worker;
}

/** A session-owned encoder. Active WASM work is cancelled by terminating only
 * this worker, retaining the independently owned document/parser session. */
export class ThumbnailEncoder {
  private worker?: Worker;
  private workerUnavailable = false;
  private active?: EncodeJob;
  private readonly pending: EncodeJob[] = [];
  private nextId = 1;
  private closed = false;

  encode(pixels: ThumbnailPixels, format: ThumbnailEncodingFormat, signal?: AbortSignal, onDiagnostic?: DiagnosticHandler): Promise<Blob> {
    return new Promise((resolve, reject) => {
      validateThumbnailPixels(pixels);
      if (format !== "webp" && format !== "png") throw new TypeError("Thumbnail format must be webp or png.");
      throwIfThumbnailEncodingCancelled(signal);
      if (this.closed) throw new Error("The thumbnail encoder is closed.");
      const job: EncodeJob = { id: this.nextId++, pixels, format, signal, onDiagnostic, resolve, reject, settled: false,
        cancellation: new AbortController(),
        abort: () => this.cancel(job) };
      signal?.addEventListener("abort", job.abort, { once: true });
      this.pending.push(job);
      this.drain();
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const reason = new DOMException("The thumbnail encoder was closed.", "AbortError");
    for (const job of this.pending.splice(0)) this.settle(job, undefined, reason);
    if (this.active) { this.active.cancellation.abort(reason); this.settle(this.active, undefined, reason); }
    this.worker?.terminate();
    this.worker = undefined;
    this.active = undefined;
  }

  private cancel(job: EncodeJob): void {
    const reason = thumbnailEncodingAbortReason(job.signal);
    job.cancellation.abort(reason);
    const queued = this.pending.indexOf(job);
    if (queued >= 0) this.pending.splice(queued, 1);
    this.settle(job, undefined, reason);
    if (this.active === job && job.worker) {
      job.worker.terminate();
      if (this.worker === job.worker) this.worker = undefined;
      this.active = undefined;
      this.drain();
    }
  }

  private settle(job: EncodeJob, blob?: Blob, error?: unknown): void {
    if (job.settled) return;
    job.settled = true;
    job.signal?.removeEventListener("abort", job.abort);
    if (blob) job.resolve(blob); else job.reject(error);
  }

  private drain(): void {
    if (this.closed || this.active || !this.pending.length) return;
    const job = this.active = this.pending.shift()!;
    if (job.signal?.aborted) { this.cancel(job); this.active = undefined; this.drain(); return; }
    if (!this.workerUnavailable && typeof Worker !== "undefined") {
      try {
        if (!this.worker) {
          this.worker = new Worker(new URL("./thumbnailEncodeWorker.ts", import.meta.url), { type: "module", name: "hepr-thumbnail-encoder" });
        }
        const worker = job.worker = this.worker;
        worker.onmessage = (event: MessageEvent<ThumbnailEncodeResponse>) => {
          if (this.active !== job || event.data.id !== job.id) return;
          this.active = undefined;
          try {
            for (const diagnostic of event.data.diagnostics ?? []) job.onDiagnostic?.(diagnostic);
            this.settle(job, event.data.blob, event.data.error ? new Error(event.data.error) : undefined);
          } catch (error) { this.settle(job, undefined, error); }
          this.drain();
        };
        worker.onerror = event => {
          if (this.active !== job) return;
          event.preventDefault();
          worker.terminate();
          this.worker = undefined;
          this.workerUnavailable = true;
          // Keep the original pixels until completion so worker startup errors
          // (CSP, worker fetching) can recover locally without re-rendering.
          void this.runInline(job);
        };
        const rgba = job.pixels.rgba.slice();
        worker.postMessage({ id: job.id, pixels: { ...job.pixels, rgba }, format: job.format } satisfies EncodeRequest, [rgba.buffer]);
        return;
      } catch {
        this.worker?.terminate();
        this.worker = undefined;
        this.workerUnavailable = true;
      }
    }
    void this.runInline(job);
  }

  private async runInline(job: EncodeJob): Promise<void> {
    job.worker = undefined;
    try {
      const blob = await encodeThumbnailPixelsDirect(job.pixels, job.format, job.cancellation.signal, job.onDiagnostic);
      this.settle(job, blob);
    } catch (error) { this.settle(job, undefined, error); }
    finally { if (this.active === job) this.active = undefined; this.drain(); }
  }
}

