import { buildPreparedRasterPixels } from "./rasterPreparationCore";
import type { RasterTilePlan, RasterTileSource } from "./rasterTiles";

const host = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ source: RasterTileSource; plan: RasterTilePlan }>) => void) | null;
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
};
host.onmessage = event => {
  try {
    const result = buildPreparedRasterPixels(event.data.source, event.data.plan);
    const buffers = new Set<ArrayBuffer>();
    for (const pixels of result.pixels) buffers.add(pixels.buffer as ArrayBuffer);
    for (const bits of result.monochromeTiles ?? []) { buffers.add(bits.data.buffer as ArrayBuffer); buffers.add(bits.colors.buffer as ArrayBuffer); }
    for (const chain of result.mipChains ?? []) for (const level of chain) buffers.add(level.data.buffer as ArrayBuffer);
    host.postMessage({ result }, [...buffers]);
  } catch (error) { host.postMessage({ error: error instanceof Error ? error.message : String(error) }, []); }
};
