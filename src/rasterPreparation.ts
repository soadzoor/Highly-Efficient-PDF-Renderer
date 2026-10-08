import { buildPreparedRasterPixelsAsync, type PreparedRasterPixels } from "./rasterPreparationCore";
import type { RasterTilePlan, RasterTileSource } from "./rasterTiles";
export type { PreparedRasterPixels } from "./rasterPreparationCore";

let worker: Worker | null = null;
let unavailable = false;
let queue = Promise.resolve();
let idle: ReturnType<typeof setTimeout> | undefined;

/** One shared worker prevents simultaneous page refinements from multiplying decoded memory. */
export function prepareRasterPixels(source: RasterTileSource, plan: RasterTilePlan): Promise<PreparedRasterPixels> {
  const task = queue.then(async () => {
    if (idle !== undefined) clearTimeout(idle);
    if (!unavailable && typeof Worker !== "undefined" && source.width * source.height >= 65_536) {
      try {
        worker ??= new Worker(new URL("./rasterPreparationWorker.ts", import.meta.url), { type: "module" });
        const active = worker;
        // Never structured-clone a monochrome layer's lazy RGBA getter or detach canonical pixels.
        const monochrome = source.monochrome;
        // Reduced coverage does not use JBIG2 dictionaries, which can outweigh the packed image.
        const workerMonochrome = monochrome ? {
          data: monochrome.data, colors: monochrome.colors,
          ...(plan.width === source.width && plan.height === source.height && monochrome.symbols
            ? { symbols: monochrome.symbols } : {})
        } : undefined;
        const input = { width: source.width, height: source.height,
          data: monochrome ? new Uint8Array(0) : source.data, monochrome: workerMonochrome };
        return await new Promise<PreparedRasterPixels>((resolve, reject) => {
          const deadline = setTimeout(() => reject(new Error("Raster preparation worker timed out.")), 30_000);
          active.onmessage = event => { clearTimeout(deadline); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result); };
          active.onerror = event => { clearTimeout(deadline); reject(new Error(event.message || "Raster preparation worker failed.")); };
          active.onmessageerror = () => { clearTimeout(deadline); reject(new Error("Raster preparation worker returned invalid data.")); };
          try { active.postMessage({ source: input, plan }); }
          catch (error) { clearTimeout(deadline); reject(error); }
        });
      } catch (error) {
        worker?.terminate(); worker = null; unavailable = true;
        console.warn("[HEPR] Raster preparation worker unavailable; preparing pixels cooperatively.", error);
      } finally {
        idle = setTimeout(() => { worker?.terminate(); worker = null; }, 30_000);
        (idle as unknown as { unref?: () => void }).unref?.();
      }
    }
    // Even the fallback gives navigation a paint opportunity before preparing pixels.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    return buildPreparedRasterPixelsAsync(source, plan);
  });
  queue = task.then(() => {}, () => {});
  return task;
}

export interface RasterPreparationJob {
  source: RasterTileSource;
  plan: RasterTilePlan;
  cached: boolean;
}

export function finishRasterUpdateSteps<T>(steps: Generator<RasterPreparationJob, T, PreparedRasterPixels | undefined>): T {
  let step = steps.next();
  while (!step.done) step = steps.next(undefined);
  return step.value;
}

/** Prepare and submit one image per turn, retaining the displayed transaction until commit. */
export async function finishRasterUpdateStepsAsync<T>(
  steps: Generator<RasterPreparationJob, T, PreparedRasterPixels | undefined>,
  record: (name: string, duration: number) => void
): Promise<T> {
  let step = steps.next();
  while (!step.done) {
    const job = step.value, started = performance.now();
    try {
      const pixels = job.cached ? undefined : await prepareRasterPixels(job.source, job.plan);
      if (!job.cached) record("pageSwap.rasterPreparation", performance.now() - started);
      // Separate submissions, including cache hits, so input and rendering can run between images.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      step = steps.next(pixels);
    } catch (error) { step = steps.throw(error); }
  }
  return step.value;
}
