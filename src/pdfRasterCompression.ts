import type { VectorScene } from "./pdfVectorExtractor";
import { assessRasterCompression, selectRasterCompressionFormat, type RasterCompressionCapabilities,
  type RasterCompressionFormat } from "./rasterCompression";
import { automaticRasterMemoryBudget, planSceneRasterMemory } from "./rasterMemoryBudget";
import { rasterTilePixelsAsync } from "./rasterTiles";
import { buildPreparedRasterPixelsAsync } from "./rasterPreparationCore";
import { copyRasterLayer } from "./monochromeRaster";
import { MAX_WEBGL_RASTER_COMPRESSION_WORKSPACE_BYTES, WebGlRasterCompression } from "./webGlRasterCompression";
import { throwIfAborted, type PdfDiagnostic } from "./pdf/nativeTypes";

interface ScanEncoder {
  readonly capabilities: RasterCompressionCapabilities;
  encode(pixels: Uint8Array, width: number, height: number, format: RasterCompressionFormat,
    maxWorkspaceBytes?: number, signal?: AbortSignal): Uint8Array;
  releaseWorkspace(): void;
  dispose(): void;
}

/** Sequential page preparation retains bounded display blocks, never live per-page GPU textures. */
export class PdfRasterCompressor {
  private retainedBytes = 0;
  private reported = false;
  private reportedMonochrome = false;
  private reportedUnavailable = false;
  private disposed = false;
  private encoder: ScanEncoder | null;
  private readonly maxTextureSize: number;
  private readonly onDiagnostic: ((diagnostic: PdfDiagnostic) => void) | undefined;
  private readonly budgetBytes: number;
  private readonly releaseContext: (() => void) | undefined;

  constructor(encoder: ScanEncoder | null, maxTextureSize: number,
    onDiagnostic?: (diagnostic: PdfDiagnostic) => void,
    budgetBytes = automaticRasterMemoryBudget().bytes, releaseContext?: () => void) {
    this.encoder = encoder; this.maxTextureSize = maxTextureSize;
    this.onDiagnostic = onDiagnostic; this.budgetBytes = budgetBytes; this.releaseContext = releaseContext;
  }

  async preparePage(scene: VectorScene, pageCount: number, sourcePageIndex: number, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (this.disposed || scene.segmentCount || scene.fillPathCount || scene.textInstanceCount ||
        scene.gradientFillPathCount || scene.gradientStrokeRunCount) return;
    const bounds = scene.pageBounds;
    const pageArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
    if (!(pageArea > 0)) return;
    const scans = scene.rasterLayers.filter(layer => {
      // Metadata comes first so packed scans never expand their lazy RGBA fallback.
      if (layer.gpuCompression || layer.gpuPreparation || layer.matrix.length < 6) return false;
      const [a, b, c, d] = layer.matrix;
      if (Math.abs(a * d - b * c) < pageArea * .5) return false;
      if (layer.monochrome) return true;
      const candidate = copyRasterLayer(layer, { compressionHint: "scan" });
      if (!assessRasterCompression(candidate).eligible) return false;
      layer.compressionHint = "scan";
      return true;
    });
    if (!scans.length) return;
    const format = this.encoder && selectRasterCompressionFormat(this.encoder.capabilities);
    if (!format && scans.some(layer => !layer.monochrome)) {
      if (!this.reportedUnavailable) {
        this.reportedUnavailable = true;
        this.report({ code: "raster.scan-compression-unavailable", severity: "warning",
          message: "Parse-time GPU scan compression is unavailable; the renderer will use its bounded raster path." });
      }
    }
    const candidates = scans.filter(layer => layer.monochrome || format);
    if (!candidates.length) return;
    // Reserve one shared encoder workspace, then divide display storage between all selected pages.
    const storageBudget = Math.floor(Math.max(0, this.budgetBytes - MAX_WEBGL_RASTER_COMPRESSION_WORKSPACE_BYTES) * .98);
    const allowance = Math.min(Math.floor(storageBudget / Math.max(1, pageCount)), storageBudget - this.retainedBytes);
    // Monochrome preparation can hold plain and compact candidates together. Reserve both on the CPU.
    const preparationAllowance = candidates.some(layer => layer.monochrome) ? Math.floor(allowance / 2) : allowance;
    const plan = planSceneRasterMemory(candidates.map(layer => ({ width: layer.width, height: layer.height,
      ...(layer.monochrome ? { monochrome: layer.monochrome, reducedMonochrome: true,
        displayWidth: layer.width, displayHeight: layer.height } : { compressionEligible: true, preferCompression: true }) })),
      this.maxTextureSize, preparationAllowance, format);
    if (plan.overBudget) return;
    try {
      for (const [index, layer] of candidates.entries()) {
        throwIfAborted(signal);
        if (layer.monochrome) {
          const prepared = await buildPreparedRasterPixelsAsync(layer, plan.plans[index], signal);
          throwIfAborted(signal);
          const bytes = preparationBytes(prepared);
          if (bytes > allowance || bytes > storageBudget - this.retainedBytes) continue;
          layer.gpuPreparation = prepared;
          this.retainedBytes += bytes;
          if (!this.reportedMonochrome) {
            this.reportedMonochrome = true;
            this.report({ code: "raster.scan-monochrome-preparation", severity: "info", pageIndex: sourcePageIndex,
              message: "Packed scanned pages prepare compact GPU atlases during parsing. All selected pages share a bounded display budget; original packed pixels remain available for zoom detail and export.",
              details: { pageCount, displayBudgetBytes: storageBudget } });
          }
          continue;
        }
        if (plan.compressionFormats[index] !== format) continue;
        const tilePlan = plan.plans[index];
        const pixels = await rasterTilePixelsAsync(layer, tilePlan, signal);
        const tiles: Uint8Array[] = [];
        for (const [tileIndex, tile] of tilePlan.tiles.entries()) {
          throwIfAborted(signal);
          tiles.push(this.encoder!.encode(pixels[tileIndex], tile.width, tile.height, format!,
            MAX_WEBGL_RASTER_COMPRESSION_WORKSPACE_BYTES, signal));
          // Yield between tiles/pages; parsing waits for GPU work instead of building a submission backlog.
          await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
        throwIfAborted(signal);
        const bytes = tiles.reduce((sum, tile) => sum + tile.byteLength, 0);
        if (bytes > allowance || bytes > storageBudget - this.retainedBytes) continue;
        layer.gpuCompression = { format: format!, plan: tilePlan, tiles };
        this.retainedBytes += bytes;
        if (!this.reported) {
          this.reported = true;
          this.report({ code: "raster.scan-compression", severity: "warning", pageIndex: sourcePageIndex,
            message: "Scanned pages use lossy GPU compression prepared during parsing. Fine text may soften; original pixels remain available for export and recovery.",
            details: { format, pageCount, displayBudgetBytes: storageBudget } });
        }
      }
    } catch (error) {
      throwIfAborted(signal);
      this.encoder?.dispose(); this.encoder = null;
      this.report({ code: "raster.scan-compression-failed", severity: "warning", pageIndex: sourcePageIndex,
        message: "Parse-time scan compression failed; original pixels remain available through the bounded raster path." });
      console.warn("[HEPR] Parse-time scan encoder failed.", error);
    } finally {
      this.encoder?.releaseWorkspace();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.encoder?.dispose(); this.encoder = null;
    this.releaseContext?.();
  }

  private report(diagnostic: PdfDiagnostic): void {
    console.warn(`[HEPR] ${diagnostic.message}`, diagnostic.details ?? "");
    this.onDiagnostic?.(diagnostic);
  }
}

/** Count retained buffers once, including the plain fallback alongside a compact atlas. */
function preparationBytes(prepared: object): number {
  const buffers = new Set<ArrayBufferLike>(), visited = new Set<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (ArrayBuffer.isView(value)) { buffers.add(value.buffer); return; }
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if ("value" in descriptor) visit(descriptor.value);
    }
  };
  visit(prepared);
  return [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);
}

export function createPdfRasterCompressor(onDiagnostic?: (diagnostic: PdfDiagnostic) => void): PdfRasterCompressor {
  let gl: WebGL2RenderingContext | null = null;
  try {
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1)
      : typeof document !== "undefined" ? document.createElement("canvas") : null;
    gl = canvas?.getContext("webgl2", { antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
    if (gl && typeof gl.getBufferSubData === "function") {
      const encoder = new WebGlRasterCompression(gl);
      // Every base tile must also fit after rounding its dimensions to whole compression blocks.
      const limit = Math.min(2048, Math.floor(Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) / 4) * 4);
      const context = gl;
      return new PdfRasterCompressor(encoder, limit, onDiagnostic, undefined,
        () => context.getExtension("WEBGL_lose_context")?.loseContext());
    }
  } catch (error) {
    console.warn("[HEPR] Cannot initialize the parse-time scan encoder.", error);
  }
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return new PdfRasterCompressor(null, 2048, onDiagnostic);
}
