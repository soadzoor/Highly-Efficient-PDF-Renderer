import type { PdfDiagnostic } from "./pdf/nativeTypes";
import type { ThumbnailPixels } from "./thumbnailTypes";
import type { ThumbnailEncodeResponse } from "./thumbnailEncoder";
import { sanitizeNodePdfWorkerExecArgv } from "./pdf/workerClient";
import { validateThumbnailPixels, throwIfThumbnailEncodingCancelled, thumbnailEncodingAbortReason,
  type ThumbnailEncodingFormat } from "./thumbnailEncodingCore";

const PUBLISHED_ENCODER_WORKER = "@soadzoor/hepr/experimental/thumbnail-encoder-worker";

interface NodeWorkerLike {
  on(type: "message", listener: (response: ThumbnailEncodeResponse) => void): unknown;
  on(type: "error", listener: (error: Error) => void): unknown;
  on(type: "exit", listener: (code: number) => void): unknown;
  off(type: "message", listener: (response: ThumbnailEncodeResponse) => void): unknown;
  off(type: "error", listener: (error: Error) => void): unknown;
  off(type: "exit", listener: (code: number) => void): unknown;
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  terminate(): Promise<number>;
}
interface NodeWorkerModule {
  Worker: new (entry: string | URL, options: { name: string; execArgv: readonly string[] }) => NodeWorkerLike;
}
interface WorkerHandle {
  readonly worker: NodeWorkerLike;
  readonly onMessage: (response: ThumbnailEncodeResponse) => void;
  readonly onError: (error: Error) => void;
  readonly onExit: (code: number) => void;
  terminating?: Promise<void>;
}
interface EncodeJob {
  readonly id: number;
  readonly pixels: ThumbnailPixels;
  readonly format: ThumbnailEncodingFormat;
  readonly signal?: AbortSignal;
  readonly onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
  readonly resolve: (blob: Blob) => void;
  readonly reject: (error: unknown) => void;
  abort(): void;
  settled: boolean;
  worker?: WorkerHandle;
}

/** @internal Node-only worker overrides, primarily for controlled hosts/tests. */
export interface NodeThumbnailEncoderOptions { readonly workerUrl?: string | URL }

/** Node sessions own this encoder separately from their PDF/font workers.
 * Cancelling an active synchronous encode terminates only its encoder thread. */
export class NodeThumbnailEncoder {
  private readonly options: NodeThumbnailEncoderOptions;
  private worker?: WorkerHandle;
  private active?: EncodeJob;
  private readonly pending: EncodeJob[] = [];
  private readonly terminations = new Set<Promise<void>>();
  private nextId = 1;
  private closed = false;
  private closing?: Promise<void>;

  constructor(options: NodeThumbnailEncoderOptions = {}) { this.options = options; }

  encode(pixels: ThumbnailPixels, format: ThumbnailEncodingFormat, signal?: AbortSignal,
    onDiagnostic?: (diagnostic: PdfDiagnostic) => void): Promise<Blob> {
    return new Promise((resolve, reject) => {
      validateThumbnailPixels(pixels);
      if (format !== "webp" && format !== "png") throw new TypeError("Thumbnail format must be webp or png.");
      throwIfThumbnailEncodingCancelled(signal);
      if (this.closed) throw new Error("The thumbnail encoder is closed.");
      const job: EncodeJob = { id: this.nextId++, pixels, format, signal, onDiagnostic, resolve, reject, settled: false,
        abort: () => this.cancel(job) };
      signal?.addEventListener("abort", job.abort, { once: true });
      this.pending.push(job);
      this.drain();
    });
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    const reason = new DOMException("The thumbnail encoder was closed.", "AbortError");
    for (const job of this.pending.splice(0)) this.settle(job, undefined, reason);
    if (this.active) this.settle(this.active, undefined, reason);
    this.active = undefined;
    if (this.worker) this.terminate(this.worker);
    this.closing = Promise.all([...this.terminations]).then(() => undefined);
    return this.closing;
  }

  private settle(job: EncodeJob, blob?: Blob, error?: unknown): void {
    if (job.settled) return;
    job.settled = true;
    job.signal?.removeEventListener("abort", job.abort);
    if (blob) job.resolve(blob); else job.reject(error);
  }

  private cancel(job: EncodeJob): void {
    const index = this.pending.indexOf(job);
    if (index >= 0) this.pending.splice(index, 1);
    this.settle(job, undefined, thumbnailEncodingAbortReason(job.signal));
    if (this.active === job && job.worker) {
      this.terminate(job.worker);
      this.active = undefined;
      this.drain();
    }
    // A cancelled startup finishes its small dynamic import before draining;
    // it checks settled/closed before creating or posting to any new worker.
  }

  private drain(): void {
    if (this.closed || this.active || !this.pending.length) return;
    const job = this.active = this.pending.shift()!;
    if (job.signal?.aborted) { this.cancel(job); this.active = undefined; this.drain(); return; }
    void this.start(job);
  }

  private async start(job: EncodeJob): Promise<void> {
    try {
      const module = await loadNodeWorkers();
      if (this.closed || job.settled || this.active !== job) return;
      if (!this.worker) {
        const nodeProcess = (globalThis as { process?: { execArgv?: readonly string[] } }).process;
        const worker = new module.Worker(this.options.workerUrl ?? resolveNodeThumbnailEncoderWorkerUrl(), {
          name: "hepr-thumbnail-encoder", execArgv: sanitizeNodePdfWorkerExecArgv(nodeProcess?.execArgv ?? [])
        });
        const handle: WorkerHandle = {
          worker,
          onMessage: response => this.receive(handle, response),
          onError: error => this.fail(handle, error),
          onExit: code => this.fail(handle, new Error(`The thumbnail encoder worker exited (${code}).`))
        };
        worker.on("message", handle.onMessage);
        worker.on("error", handle.onError);
        worker.on("exit", handle.onExit);
        this.worker = handle;
      }
      const handle = job.worker = this.worker;
      // Keep caller memory attached and retain it for diagnostics/retries. This
      // also isolates pooled Node Buffers, whose slice() can remain shared.
      const rgba = Uint8Array.from(job.pixels.rgba);
      handle.worker.postMessage({ id: job.id, pixels: { ...job.pixels, rgba }, format: job.format }, [rgba.buffer]);
    } catch (error) {
      if (job.worker) this.terminate(job.worker);
      this.settle(job, undefined, error);
    } finally {
      if (job.settled && this.active === job) { this.active = undefined; this.drain(); }
    }
  }

  private receive(handle: WorkerHandle, response: ThumbnailEncodeResponse): void {
    const job = this.active;
    if (!job || job.worker !== handle || response.id !== job.id) return;
    this.active = undefined;
    try {
      for (const diagnostic of response.diagnostics ?? []) job.onDiagnostic?.(diagnostic);
      this.settle(job, response.blob, response.error ? new Error(response.error) : undefined);
    } catch (error) { this.settle(job, undefined, error); }
    this.drain();
  }

  private fail(handle: WorkerHandle, error: Error): void {
    if (this.worker !== handle || handle.terminating) return;
    this.terminate(handle);
    const job = this.active;
    if (job?.worker === handle) { this.active = undefined; this.settle(job, undefined, error); }
    this.drain();
  }

  private terminate(handle: WorkerHandle): Promise<void> {
    if (handle.terminating) return handle.terminating;
    if (this.worker === handle) this.worker = undefined;
    handle.worker.off("message", handle.onMessage);
    handle.worker.off("error", handle.onError);
    handle.worker.off("exit", handle.onExit);
    // Ignore a startup error racing termination after the owning request was
    // cancelled; otherwise an unobserved EventEmitter error can escape.
    const ignoreError = (): void => {};
    handle.worker.on("error", ignoreError);
    const terminating = handle.worker.terminate().then(() => undefined).finally(() => {
      handle.worker.off("error", ignoreError);
      this.terminations.delete(terminating);
    });
    handle.terminating = terminating;
    this.terminations.add(terminating);
    // close() observes pending terminations; cancellation also drains failures
    // when a caller reuses the session without closing it immediately.
    void terminating.catch(() => undefined);
    return terminating;
  }
}

let workerModule: Promise<NodeWorkerModule> | undefined;
function loadNodeWorkers(): Promise<NodeWorkerModule> {
  if (workerModule) return workerModule;
  const nodeProcess = (globalThis as { process?: { versions?: { node?: string } } }).process;
  if (!nodeProcess?.versions?.node) return Promise.reject(new Error("Node thumbnail encoding requires node:worker_threads."));
  const moduleName = "node:worker_threads";
  const pending = import(/* @vite-ignore */ moduleName) as unknown as Promise<NodeWorkerModule>;
  workerModule = pending;
  void pending.catch(() => { if (workerModule === pending) workerModule = undefined; });
  return pending;
}

/** A package self-reference remains stable when the Node API is SSR bundled. */
export function resolveNodeThumbnailEncoderWorkerUrl(): URL {
  const current = new URL(import.meta.url);
  if (current.pathname.endsWith(".ts")) {
    const entry = new URL("./nodeThumbnailEncodeWorker.ts", current).href;
    const bootstrap = `import { registerHooks } from "node:module";
registerHooks({ resolve(s,c,n) { return n(c.parentURL?.includes("/src/") && /^\\.\\.?\\//.test(s) && !/\\.[a-z0-9]+(?:[?#]|$)/i.test(s) ? s+".ts" : s,c); } });
await import(${JSON.stringify(entry)});`;
    return new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`);
  }
  try { return new URL(import.meta.resolve(PUBLISHED_ENCODER_WORKER)); }
  catch { return new URL(/* @vite-ignore */ "./thumbnail-encoder-worker.js", current); }
}
