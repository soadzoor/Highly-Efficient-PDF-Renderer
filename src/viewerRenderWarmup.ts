import { waitForLoad, yieldForLoad } from "./loadCancellation";

const MAX_WARMUP_FRAMES = 12;
const MAX_WARMUP_MS = 250;

export interface ViewerRenderWarmupOptions {
  /** Submit the current view without changing its camera or scene. */
  renderFrame: (signal: AbortSignal) => void | Promise<void>;
  signal?: AbortSignal;
  /** Optional completion of already submitted work, after the last warm frame. */
  waitForGpu?: (signal: AbortSignal) => void | Promise<void>;
}

/**
 * Exercise lazy render resources and repeated submission while a document is
 * loading. The viewer returns to demand rendering after at most twelve frames
 * or 250 ms; an inactive tab or pending GPU completion cannot hold loading open.
 * Synchronous host rendering cannot be interrupted, so one frame can exceed
 * the time budget. Work already submitted to the GPU is never cancelled.
 */
export async function warmViewerRendering(options: ViewerRenderWarmupOptions): Promise<number> {
  const { renderFrame, signal, waitForGpu } = options;
  signal?.throwIfAborted();
  const controller = new AbortController();
  const budgetReason = Symbol("render warm-up budget elapsed");
  const startedAt = performance.now();
  let timedOut = false;
  let frames = 0;
  const onAbort = (): void => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(budgetReason);
  }, MAX_WARMUP_MS);
  const withinBudget = (): boolean => performance.now() - startedAt < MAX_WARMUP_MS;
  try {
    while (frames < MAX_WARMUP_FRAMES && withinBudget()) {
      await yieldForLoad(controller.signal);
      if (!withinBudget()) break;
      controller.signal.throwIfAborted();
      await waitForLoad(Promise.resolve(renderFrame(controller.signal)), controller.signal);
      frames++;
    }
    if (frames > 0 && waitForGpu && withinBudget()) {
      await waitForLoad(Promise.resolve(waitForGpu(controller.signal)), controller.signal);
    }
    signal?.throwIfAborted();
    return frames;
  } catch (error) {
    signal?.throwIfAborted();
    if (timedOut && controller.signal.reason === budgetReason) return frames;
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
