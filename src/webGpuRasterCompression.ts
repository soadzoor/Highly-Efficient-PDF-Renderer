import {
  buildRasterCompressionMipChain,
  estimateCompressedRasterBytes,
  rasterCompressionFormatInfo,
  type RasterCompressionFormat
} from "./rasterCompression";
import { RASTER_BC7_ENCODER_WGSL } from "./shaders/rasterBc7Encoder";
import { RASTER_ASTC4X4_ENCODER_WGSL } from "./shaders/rasterAstc4x4Encoder";

const PARAMS_BYTES = 32;
const MAX_WORKSPACE_BYTES = 4 * 1024 * 1024;

export interface WebGpuCompressedRasterTexture {
  readonly texture: any;
  readonly estimatedBytes: number;
  /** Edge padding belongs to the texture, never the image's placement. */
  readonly uvScale: readonly [number, number];
}

/**
 * Encode into a same-device storage buffer, then copy blocks directly into
 * the sampled texture. One fixed workspace is reused in queue order across
 * every band, mip and image; no block bytes cross back to the CPU.
 */
export class WebGpuRasterCompression {
  readonly format: RasterCompressionFormat;
  readonly workspaceBytes: number;
  private readonly device: any;
  private readonly pipeline: any;
  private readonly workspaceWidth: number;
  private readonly workspaceHeight: number;
  private readonly outputRowBytes: number;
  private inputTexture: any = null;
  private outputBuffer: any = null;
  private paramsBuffer: any = null;
  private bindGroup: any = null;
  private disabled = false;
  private disposed = false;
  private failureListener: ((error: unknown) => void) | null = null;

  private constructor(device: any, pipeline: any, format: RasterCompressionFormat, maxWorkspaceBytes: number) {
    this.device = device;
    this.pipeline = pipeline;
    this.format = format;
    this.workspaceWidth = Math.floor(Number(device.limits?.maxTextureDimension2D ?? 8192) / 4) * 4;
    this.outputRowBytes = align(this.workspaceWidth / 4 * 16, 256);
    const blockRowBytes = this.workspaceWidth * 16 + this.outputRowBytes;
    const rows = Math.min(Math.floor(this.workspaceWidth / 4), Math.floor((maxWorkspaceBytes - PARAMS_BYTES) / blockRowBytes));
    if (!(rows >= 1)) throw new RangeError("The raster compression workspace cannot hold one block row.");
    this.workspaceHeight = rows * 4;
    this.workspaceBytes = this.workspaceWidth * this.workspaceHeight * 4 + this.outputRowBytes * rows + PARAMS_BYTES;
    if (this.outputRowBytes * rows > Number(device.limits?.maxStorageBufferBindingSize ?? 128 * 1024 * 1024)) {
      throw new RangeError("The raster compression workspace exceeds the device storage-buffer limit.");
    }
    void device.lost?.then?.(() => this.dispose());
  }

  /** Optional features and pipeline errors leave the renderer on RGBA. */
  static async create(device: any, maxWorkspaceBytes = MAX_WORKSPACE_BYTES): Promise<WebGpuRasterCompression | null> {
    const formats: RasterCompressionFormat[] = [];
    if (device.features?.has?.("texture-compression-bc")) formats.push("bc7");
    if (device.features?.has?.("texture-compression-astc")) formats.push("astc-4x4");
    for (const format of formats) {
      try {
        const pipeline = await createValidatedPipeline(device, format);
        return new WebGpuRasterCompression(device, pipeline, format, Math.min(MAX_WORKSPACE_BYTES, maxWorkspaceBytes));
      } catch (error) {
        console.warn(`[HEPR] WebGPU ${format} raster encoder unavailable; retaining an available raster path.`, error);
      }
    }
    return null;
  }

  get available(): boolean { return !this.disabled && !this.disposed; }
  get residentBytes(): number { return this.inputTexture ? this.workspaceBytes : 0; }
  setFailureListener(listener: ((error: unknown) => void) | null): void { this.failureListener = listener; }
  releaseWorkspace(): void { this.destroyWorkspace(); }

  createTexture(width: number, height: number, premultiplied: Uint8Array): WebGpuCompressedRasterTexture | null {
    if (!this.available) return null;
    const paddedWidth = align(width, 4), paddedHeight = align(height, 4);
    if (paddedWidth > this.workspaceWidth || paddedHeight > this.workspaceWidth) return null;
    const usage = (globalThis as any).GPUTextureUsage;
    let texture: any = null;
    const scoped = pushCompressionErrorScopes(this.device);
    try {
      this.ensureWorkspace();
      texture = this.device.createTexture({
        label: `hepr-raster-${this.format}`,
        size: { width: paddedWidth, height: paddedHeight, depthOrArrayLayers: 1 },
        format: rasterCompressionFormatInfo(this.format).webGpuFormat,
        mipLevelCount: Math.floor(Math.log2(Math.max(paddedWidth, paddedHeight))) + 1,
        usage: usage.TEXTURE_BINDING | usage.COPY_DST
      });
      let mipLevel = 0;
      for (const level of buildRasterCompressionMipChain(premultiplied, width, height)) {
        const blocksX = Math.ceil(level.width / 4), blocksY = Math.ceil(level.height / 4);
        for (let blockRow = 0; blockRow < blocksY; blockRow += this.workspaceHeight / 4) {
          const bandBlocks = Math.min(this.workspaceHeight / 4, blocksY - blockRow);
          const bandY = blockRow * 4, bandHeight = Math.min(bandBlocks * 4, level.height - bandY);
          const first = bandY * level.width * 4, end = first + bandHeight * level.width * 4;
          this.device.queue.writeTexture({ texture: this.inputTexture }, level.data.subarray(first, end),
            { bytesPerRow: level.width * 4, rowsPerImage: bandHeight },
            { width: level.width, height: bandHeight, depthOrArrayLayers: 1 });
          this.device.queue.writeBuffer(this.paramsBuffer, 0, Uint32Array.of(
            blocksX, bandBlocks, level.width, bandHeight, 0, this.outputRowBytes / 16, 0, 0
          ));
          const encoder = this.device.createCommandEncoder({ label: `hepr-raster-${this.format}-band` });
          const pass = encoder.beginComputePass();
          pass.setPipeline(this.pipeline);
          pass.setBindGroup(0, this.bindGroup);
          pass.dispatchWorkgroups(Math.ceil(blocksX / 8), Math.ceil(bandBlocks / 8), 1);
          pass.end();
          encoder.copyBufferToTexture(
            { buffer: this.outputBuffer, bytesPerRow: this.outputRowBytes, rowsPerImage: bandBlocks },
            { texture, mipLevel, origin: { x: 0, y: bandY, z: 0 } },
            { width: blocksX * 4, height: bandBlocks * 4, depthOrArrayLayers: 1 }
          );
          this.device.queue.submit([encoder.finish()]);
        }
        mipLevel++;
      }
      return { texture, estimatedBytes: estimateCompressedRasterBytes(width, height, this.format),
        uvScale: [width / paddedWidth, height / paddedHeight] };
    } catch (error) {
      texture?.destroy();
      this.disable(error);
      return null;
    } finally {
      if (scoped) {
        void popCompressionErrorScopes(this.device).then((error: unknown) => {
          if (error) this.disable(error);
        }, (error: unknown) => this.disable(error));
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failureListener = null;
    this.destroyWorkspace();
  }

  private ensureWorkspace(): void {
    if (this.inputTexture) return;
    const textureUsage = (globalThis as any).GPUTextureUsage;
    const bufferUsage = (globalThis as any).GPUBufferUsage;
    try {
      this.inputTexture = this.device.createTexture({ label: "hepr-raster-compression-input",
        size: { width: this.workspaceWidth, height: this.workspaceHeight, depthOrArrayLayers: 1 },
        format: "rgba8unorm", usage: textureUsage.TEXTURE_BINDING | textureUsage.COPY_DST });
      this.outputBuffer = this.device.createBuffer({ label: "hepr-raster-compression-blocks",
        size: this.outputRowBytes * (this.workspaceHeight / 4), usage: bufferUsage.STORAGE | bufferUsage.COPY_SRC });
      this.paramsBuffer = this.device.createBuffer({ label: "hepr-raster-compression-params", size: PARAMS_BYTES,
        usage: bufferUsage.UNIFORM | bufferUsage.COPY_DST });
      this.bindGroup = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: this.inputTexture.createView() },
        { binding: 1, resource: { buffer: this.outputBuffer } },
        { binding: 2, resource: { buffer: this.paramsBuffer, size: PARAMS_BYTES } }
      ] });
    } catch (error) {
      this.destroyWorkspace();
      throw error;
    }
  }

  private disable(error: unknown): void {
    if (!this.available) return;
    this.disabled = true;
    this.destroyWorkspace();
    console.warn("[HEPR] WebGPU raster compression failed; rebuilding bounded RGBA raster resources.", error);
    const listener = this.failureListener;
    if (listener) queueMicrotask(() => { if (!this.disposed) listener(error); });
  }

  private destroyWorkspace(): void {
    this.inputTexture?.destroy(); this.inputTexture = null;
    this.outputBuffer?.destroy(); this.outputBuffer = null;
    this.paramsBuffer?.destroy(); this.paramsBuffer = null;
    this.bindGroup = null;
  }
}

async function createValidatedPipeline(device: any, format: RasterCompressionFormat): Promise<any> {
  const scoped = pushCompressionErrorScopes(device);
  let pipeline: any;
  let failure: unknown;
  try {
    const module = device.createShaderModule({ label: `hepr-raster-${format}-encoder`,
      code: format === "bc7" ? RASTER_BC7_ENCODER_WGSL : RASTER_ASTC4X4_ENCODER_WGSL });
    const descriptor = { label: `hepr-raster-${format}-encoder`, layout: "auto", compute: { module, entryPoint: "encode" } };
    pipeline = typeof device.createComputePipelineAsync === "function"
      ? await device.createComputePipelineAsync(descriptor) : device.createComputePipeline(descriptor);
  } catch (error) { failure = error; }
  const validationError = scoped ? await popCompressionErrorScopes(device) : null;
  if (failure || validationError) throw failure ?? validationError;
  return pipeline;
}

function align(value: number, alignment: number): number { return Math.ceil(value / alignment) * alignment; }

function pushCompressionErrorScopes(device: any): boolean {
  if (typeof device.pushErrorScope !== "function" || typeof device.popErrorScope !== "function") return false;
  device.pushErrorScope("out-of-memory");
  device.pushErrorScope("validation");
  return true;
}

async function popCompressionErrorScopes(device: any): Promise<unknown> {
  // Pop both immediately so later uploads cannot become children of this scope.
  const results = await Promise.all([device.popErrorScope(), device.popErrorScope()]);
  return results.find(Boolean) ?? null;
}
