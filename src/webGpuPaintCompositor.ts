import { nativeGradientMaskVectors } from "./gradientMaskFold";
import type { Bounds, VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import { pdfCompositeScissorRect, type PdfCompositeOperation,
  type PdfCompositeProjector, type ScenePaintCompositorAdapter } from "./scenePaintCompositor";
import { ScenePaintPlan } from "./scenePaintPlan";
import { PDF_COMPOSITE_WGSL } from "./pdfCompositeShaders";
import { choosePdfCompositeResolution, PDF_COMPOSITE_MAX_BYTES } from "./pdfCompositeBudget";
import type { ScenePaintMask } from "./scenePaintGraph";

interface Surface { texture: any; view: any; width?: number; height?: number }
/** Diagnostic names of the shared executor's pass operations, by number, as in WebGL. */
const PASS_NAMES = ["composite", "stats", "extract", "shapeExtract", "softMask", "copy", "blendLayer"];
interface ManagedPass { encoder: any; descriptor: any; pause(): void; resume(): any }

/**
 * The renderer's side of folded paints: which leaves it can draw with an
 * opacity and mask of their own, and drawing one into the given pass.
 */
export interface WebGpuPaintFolding {
  canFold(run: VectorDrawRun): boolean;
  canFoldMaskPaint?(run: VectorDrawRun, maskRun: VectorDrawRun): boolean;
  /**
   * `mask` is the mask surface's view, or null. `content` is the soft mask
   * whose rendered content that surface holds, when it was not converted first.
   * With `gradient`, compute the mask using these vectors and the renderer's LUT.
   */
  draw(run: VectorDrawRun, pass: any, opacity: number, mask: any, content?: ScenePaintMask, gradient?: Float32Array): void;
}
const managedPasses = new WeakMap<object, ManagedPass>();

/** A pass can be suspended for intermediate surfaces and then resumed by the same caller. */
export function beginPdfManagedRenderPass(encoder: any, descriptor: any): any {
  let current = encoder.beginRenderPass(descriptor);
  const info: ManagedPass = { encoder, descriptor,
    pause() { current.end(); },
    resume() {
      current = encoder.beginRenderPass({ ...descriptor,
        colorAttachments: descriptor.colorAttachments.map((attachment: any) => ({ ...attachment, loadOp: "load" })) });
      return current;
    } };
  const proxy = new Proxy({}, { get(_target, key) {
    const value = current[key]; return typeof value === "function" ? value.bind(current) : value;
  } });
  managedPasses.set(proxy, info);
  return proxy;
}

export class WebGpuPaintCompositor implements ScenePaintCompositorAdapter<Surface> {
  readonly blendsPasses = true;
  private readonly device: any;
  private readonly format: string;
  private readonly pipeline: any;
  /** Same shader, premultiplied source-over onto the destination. */
  private readonly blendPipeline: any;
  private readonly zero: Surface;
  // An absent soft mask must read as fully opaque, unlike every other input,
  // whose neutral value is transparent black.
  private readonly one: Surface;
  private readonly uniforms: any[] = [];
  private uniformIndex = 0;
  private uniformEncoder: any = null;
  private readonly transfers = new Map<Float32Array, Surface>();
  private readonly pool: Surface[] = [];
  private readonly paintPlan = new ScenePaintPlan();
  private readonly all = new Set<Surface>();
  private width = 0;
  private height = 0;
  private approximationReported = false;
  private encoder: any;
  private activePass: { target: Surface; pass: any } | null = null;
  private drawSpan: ((runs: readonly VectorDrawRun[], pass: any, shapeOnly: boolean) => void) | null = null;
  private scene: VectorScene | null = null;
  private gradientMask: Float32Array | null = null;
  private folding: WebGpuPaintFolding | null = null;
  /**
   * Clears not yet encoded. A clear is its own render pass only when a surface
   * is read or partly copied into before anything renders into it; otherwise
   * the next pass that renders into the surface clears it as it loads.
   */
  private readonly pendingClears = new Map<Surface, { r: number; g: number; b: number; a: number }>();
  private project: PdfCompositeProjector | null = null;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private readonly onDraw: (() => void) | undefined;
  get paintPlanReused(): boolean { return this.paintPlan.reused; }
  get paintPlanOperations(): number { return this.paintPlan.operations; }

  constructor(device: any, format: string, onDraw?: () => void) {
    this.device = device; this.format = format;
    this.onDraw = onDraw;
    const module = device.createShaderModule({ code: PDF_COMPOSITE_WGSL });
    const layout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: 2, buffer: { type: "uniform", minBindingSize: 48 } },
      ...Array.from({ length: 7 }, (_, i) => ({ binding: i + 1, visibility: 2, texture: { sampleType: "unfilterable-float" } }))
    ] });
    const describe = (blend?: any): any => ({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format, ...(blend ? { blend } : {}) }] },
      primitive: { topology: "triangle-list" } });
    this.pipeline = device.createRenderPipeline(describe());
    const over = { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" };
    this.blendPipeline = device.createRenderPipeline(describe({ color: over, alpha: over }));
    this.zero = this.constant(new Uint8Array(4));
    this.one = this.constant(Uint8Array.of(255, 255, 255, 255));
  }

  /**
   * `draw` receives a whole span at a time. Every paint in one reaches the same
   * surface with no composite pass between them, so a caller may batch and
   * reorder within a span; that does not hold between spans.
   */
  render(scene: VectorScene, parentPass: any, width: number, height: number,
    draw: (runs: readonly VectorDrawRun[], pass: any, shapeOnly: boolean) => void,
    visible: (condition?: number) => boolean, selected: Uint8Array | null = null,
    project: PdfCompositeProjector | null = null, folding: WebGpuPaintFolding | null = null,
    colorBatchingEnabled = true, visibilityRevision?: number, blackDarkenSourceOverEnabled = true): void {
    const info = managedPasses.get(parentPass);
    if (!info) throw new Error("PDF compositing requires a managed render pass.");
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)
      throw new RangeError("PDF compositor dimensions must be positive integers.");
    // A frame can composite more than one target before submitting its encoder.
    // Queue writes are applied before command execution, so those passes need
    // distinct parameter buffers and must retain every previously encoded texture.
    const newEncoder = this.uniformEncoder !== info.encoder;
    let size = choosePdfCompositeResolution(scene, width, height);
    if (!newEncoder) {
      const pendingBytes = [...this.all].filter(surface => surface.width !== size.width || surface.height !== size.height)
        .reduce((sum, surface) => sum + surface.width! * surface.height! * 4, 0);
      size = choosePdfCompositeResolution(scene, width, height, Math.max(4096, PDF_COMPOSITE_MAX_BYTES - pendingBytes));
    }
    if (size.scale < 1 && !this.approximationReported) {
      this.approximationReported = true;
      console.warn(`[hepr] PDF composite surfaces use ${size.width}×${size.height} instead of ${width}×${height} to stay within the memory budget.`);
    }
    if (newEncoder) {
      this.uniformIndex = 0;
      this.uniformEncoder = info.encoder;
      this.trimSurfaces(size.width, size.height);
    }
    this.width = size.width; this.height = size.height;
    this.encoder = info.encoder; this.drawSpan = draw; this.folding = folding;
    this.scene = scene;
    this.project = project; this.viewportWidth = width; this.viewportHeight = height;
    info.pause();
    let backdrop: Surface | null = null, result: Surface | null = null;
    let resumed = false;
    try {
      backdrop = this.acquire();
      this.pass({ operation: 5, source: { view: info.descriptor.colorAttachments[0].view, texture: null } }, backdrop);
      result = this.paintPlan.execute(scene, this, backdrop, visible, selected, visibilityRevision, 0,
        width, height, colorBatchingEnabled, blackDarkenSourceOverEnabled);
      this.flushClears([result]);
      this.endPass();
      const pass = info.resume();
      resumed = true;
      this.encode({ operation: 5, source: result }, pass, width, height);
    } catch (error) {
      this.endPass();
      if (!resumed) info.resume();
      throw error;
    } finally {
      if (result) this.release(result); if (backdrop && backdrop !== result) this.release(backdrop);
      // Nothing reads an unused surface's content, and the next lease clears it.
      this.pendingClears.clear();
      this.drawSpan = null; this.folding = null; this.scene = null; this.gradientMask = null; this.encoder = null; this.project = null;
    }
  }
  acquire(): Surface {
    const freeIndex = this.pool.findIndex(surface => surface.width === this.width && surface.height === this.height);
    if (freeIndex >= 0) return this.pool.splice(freeIndex, 1)[0];
    const bytes = [...this.all].reduce((sum, surface) => sum + surface.width! * surface.height! * 4, 0);
    if (bytes + this.width * this.height * 4 > 512 * 1024 * 1024) throw new RangeError("PDF compositing surfaces exceed 512 MiB.");
    const texture = this.device.createTexture({ size: [this.width, this.height], format: this.format,
      usage: 0x10 | 0x04 | 0x01 | 0x02 });
    const surface = { texture, view: texture.createView(), width: this.width, height: this.height }; this.all.add(surface); return surface;
  }
  release(surface: Surface): void { this.pendingClears.delete(surface); this.pool.push(surface); }
  clear(surface: Surface, color: readonly [number, number, number, number] = [0, 0, 0, 0]): void {
    // A new lease can reuse a texture read or written by the open pass.
    this.endPass();
    this.pendingClears.set(surface, { r: color[0], g: color[1], b: color[2], a: color[3] });
  }
  copy(source: Surface, destination: Surface, bounds?: Bounds): void {
    this.endPass();
    const rect = this.scissor(bounds);
    this.flushClears([source]);
    // A whole-surface copy replaces a pending clear; a partial one keeps the
    // cleared pixels around it.
    if (rect) this.flushClears([destination]); else this.pendingClears.delete(destination);
    if (!rect) {
      this.encoder.copyTextureToTexture({ texture: source.texture }, { texture: destination.texture }, [this.width, this.height]);
      return;
    }
    if (rect.width === 0 || rect.height === 0) return;
    // Texture copies address rows from the top, unlike the bottom-left
    // rectangle every surface operation here is expressed in.
    const origin = { x: rect.x, y: this.height - rect.y - rect.height };
    this.encoder.copyTextureToTexture({ texture: source.texture, origin },
      { texture: destination.texture, origin }, [rect.width, rect.height]);
  }
  /**
   * Surface pixels an operation may touch, bottom-left origin; null covers it
   * all. Clears stay whole: a render pass loads or clears its entire
   * attachment, and clearing more than an operation needs is always safe.
   */
  private scissor(bounds: Bounds | undefined): { x: number; y: number; width: number; height: number } | null {
    return pdfCompositeScissorRect(bounds, this.project, this.viewportWidth, this.viewportHeight, this.width, this.height);
  }
  draw(runs: readonly VectorDrawRun[], destination: Surface, shapeOnly: boolean): void {
    if (runs.length === 0) return;
    // A whole span shares one render pass; source order is the call order.
    const pass = this.renderPass(destination, "span");
    this.drawSpan!(runs, pass, shapeOnly);
  }
  canFold(run: VectorDrawRun): boolean { return this.folding?.canFold(run) ?? false; }
  canFoldMaskPaint(run: VectorDrawRun, maskRun: VectorDrawRun): boolean {
    this.gradientMask = null;
    if (!this.scene || !this.folding?.canFoldMaskPaint?.(run, maskRun)) return false;
    this.gradientMask = nativeGradientMaskVectors(this.scene, maskRun, run.clipIndex, this.project,
      this.width, this.height, this.viewportWidth, this.viewportHeight, true);
    return this.gradientMask !== null;
  }
  drawFolded(run: VectorDrawRun, destination: Surface, opacity: number, mask: Surface | undefined,
    content?: ScenePaintMask, maskRun?: VectorDrawRun): void {
    if (mask) this.flushClears([mask]);
    const pass = this.renderPass(destination, "fold");
    this.folding!.draw(run, pass, opacity, mask?.view ?? null, content, maskRun ? this.gradientMask! : undefined);
  }
  pass(operation: PdfCompositeOperation<Surface>, destination: Surface): void {
    const rect = this.scissor(operation.bounds);
    if (rect && (rect.width === 0 || rect.height === 0)) return;
    this.flushClears([operation.source, operation.shape, operation.current, operation.stats, operation.initial,
      operation.mask].filter(surface => surface !== undefined && surface !== destination) as Surface[]);
    // Preserve pixels outside a bounded operation. A pending clear is consumed
    // when the attachment opens; full-surface replacement draws need no new clear.
    const pass = this.renderPass(destination, `composite:${PASS_NAMES[operation.operation]}`);
    if (rect) pass.setScissorRect(rect.x, this.height - rect.y - rect.height, rect.width, rect.height);
    this.encode(operation, pass);
  }
  dispose(): void {
    this.paintPlan.clear();
    this.releaseSurfaces(); this.zero.texture.destroy(); this.one.texture.destroy();
    for (const uniform of this.uniforms) uniform.destroy(); this.uniforms.length = 0;
    for (const transfer of this.transfers.values()) transfer.texture.destroy(); this.transfers.clear();
  }
  /** The destination attachment, clearing as it loads when a clear is pending. */
  private attachment(destination: Surface): any {
    const pending = this.pendingClears.get(destination);
    if (!pending) return { view: destination.view, loadOp: "load", storeOp: "store" };
    this.pendingClears.delete(destination);
    return { view: destination.view, loadOp: "clear", storeOp: "store", clearValue: pending };
  }
  /** Only consecutive writes to one attachment share a pass. Copies, clears,
   * target changes and presentation finish it before dependent work begins. */
  private renderPass(target: Surface, label: string): any {
    if (this.activePass?.target !== target) this.endPass();
    if (!this.activePass) this.activePass = { target,
      pass: this.encoder.beginRenderPass({ label, colorAttachments: [this.attachment(target)] }) };
    const pass = this.activePass.pass;
    // Composite operations may have left a bounded scissor on the same pass.
    pass.setScissorRect(0, 0, this.width, this.height);
    return pass;
  }
  private endPass(): void {
    const active = this.activePass;
    this.activePass = null;
    active?.pass.end();
  }
  /** Encodes the pending clears of surfaces about to be read. */
  private flushClears(surfaces: readonly Surface[]): void {
    for (const surface of surfaces) {
      const pending = this.pendingClears.get(surface);
      if (!pending) continue;
      this.endPass();
      this.pendingClears.delete(surface);
      this.encoder.beginRenderPass({ label: "clear", colorAttachments: [{ view: surface.view, loadOp: "clear",
        storeOp: "store", clearValue: pending }] }).end();
    }
  }
  private encode(operation: PdfCompositeOperation<Surface>, pass: any, outputWidth = this.width, outputHeight = this.height): void {
    const transfer = operation.softMask?.transfer;
    const values = new Float32Array([operation.operation, operation.blendMode ?? 0, operation.knockout ? 1 : 0, operation.opacity ?? 1,
      operation.alphaIsShape ? 1 : 0, operation.softMask?.subtype === "Luminosity" ? 1 : 0, transfer?.length ?? 0,
      operation.isolated ? 1 : 0,
      ...(operation.operation === 5 ? [outputWidth, outputHeight, 0] : operation.softMask?.backdrop ?? [0, 0, 0]), 0]);
    const index = this.uniformIndex++;
    if (index >= 262_144) throw new RangeError("PDF compositing exceeds its per-encoder pass budget.");
    const buffer = this.uniforms[index] ?? (this.uniforms[index] = this.device.createBuffer({ size: 48, usage: 0x40 | 0x08 }));
    this.device.queue.writeBuffer(buffer, 0, values);
    const textures = [operation.source, operation.shape, operation.current, operation.stats, operation.initial,
      operation.mask ?? this.one, transfer ? this.transferTexture(transfer) : this.zero];
    const group = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer, size: 48 } },
      ...textures.map((surface, i) => ({ binding: i + 1, resource: (surface ?? this.zero).view }))
    ] });
    pass.setPipeline(operation.blend ? this.blendPipeline : this.pipeline);
    pass.setBindGroup(0, group); pass.draw(3);
    this.onDraw?.();
  }
  private constant(pixel: Uint8Array): Surface {
    const texture = this.device.createTexture({ size: [1, 1], format: this.format, usage: 0x04 | 0x02 });
    this.device.queue.writeTexture({ texture }, pixel, {}, [1, 1]);
    return { texture, view: texture.createView() };
  }
  private transferTexture(values: Float32Array): Surface {
    let surface = this.transfers.get(values); if (surface) return surface;
    const width = Math.min(values.length, this.device.limits.maxTextureDimension2D), height = Math.ceil(values.length / width);
    const pixels = new Float32Array(width * height); pixels.set(values);
    const texture = this.device.createTexture({ size: [width, height], format: "r32float", usage: 0x04 | 0x02 });
    this.device.queue.writeTexture({ texture }, pixels, { bytesPerRow: width * 4 }, [width, height]);
    surface = { texture, view: texture.createView() }; this.transfers.set(values, surface); return surface;
  }
  private releaseSurfaces(): void {
    for (const surface of this.all) surface.texture.destroy(); this.all.clear(); this.pool.length = 0;
  }
  private trimSurfaces(width: number, height: number): void {
    for (let index = this.pool.length - 1; index >= 0; index--) {
      const surface = this.pool[index];
      if (surface.width === width && surface.height === height) continue;
      surface.texture.destroy(); this.all.delete(surface); this.pool.splice(index, 1);
    }
  }
}
