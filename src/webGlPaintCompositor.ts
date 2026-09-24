import type { Bounds, VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import { compositeScenePaintGraph, pdfCompositeScissorRect, type PdfCompositeOperation,
  type PdfCompositeProjector, type ScenePaintCompositorAdapter } from "./scenePaintCompositor";
import { PDF_COMPOSITE_FRAGMENT_GLSL, PDF_COMPOSITE_VERTEX_GLSL } from "./pdfCompositeShaders";
import { choosePdfCompositeResolution } from "./pdfCompositeBudget";

interface Surface { texture: WebGLTexture; framebuffer: WebGLFramebuffer }

/** Caller-known target and state to restore, avoiding synchronous GL queries. */
export interface WebGlPaintCompositorState {
  framebuffer: WebGLFramebuffer | null;
  readFramebuffer: WebGLFramebuffer | null;
  viewport: ArrayLike<number>;
  clearColor: ArrayLike<number>;
  scissor: boolean;
  blend: boolean;
  depth: boolean;
  program: WebGLProgram | null;
  vao: WebGLVertexArrayObject | null;
  blendFunction: readonly [number, number, number, number];
  blendEquation: readonly [number, number];
}

const SAMPLER_NAMES = ["uSource", "uShape", "uCurrent", "uStats", "uInitial", "uMask"];
// An absent soft mask must read as fully opaque, unlike every other input,
// whose neutral value is transparent black.
const MASK_SAMPLER = SAMPLER_NAMES.indexOf("uMask");

/** Transient GL surfaces for the shared PDF pass executor. */
export class WebGlPaintCompositor implements ScenePaintCompositorAdapter<Surface> {
  readonly blendsPasses = true;
  private readonly gl: WebGL2RenderingContext;
  private readonly onDraw: (() => void) | undefined;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<string, WebGLUniformLocation | null>;
  private readonly vao: WebGLVertexArrayObject;
  private readonly zero: WebGLTexture;
  private readonly one: WebGLTexture;
  private readonly transfers = new Map<Float32Array, WebGLTexture>();
  private readonly pool: Surface[] = [];
  private readonly all = new Set<Surface>();
  private width = 0;
  private height = 0;
  private approximationReported = false;
  private drawSpan: ((runs: readonly VectorDrawRun[], shapeOnly: boolean) => void) | null = null;
  private project: PdfCompositeProjector | null = null;
  private viewportWidth = 0;
  private viewportHeight = 0;

  constructor(gl: WebGL2RenderingContext, onDraw?: () => void) {
    this.gl = gl;
    this.onDraw = onDraw;
    const vertex = this.shader(gl.VERTEX_SHADER, PDF_COMPOSITE_VERTEX_GLSL);
    const fragment = this.shader(gl.FRAGMENT_SHADER, PDF_COMPOSITE_FRAGMENT_GLSL);
    const program = gl.createProgram();
    if (!program) throw new Error("Unable to allocate PDF compositor program.");
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const reason = gl.getProgramInfoLog(program); gl.deleteProgram(program); throw new Error(`PDF compositor: ${reason}`);
    }
    this.program = program;
    // Every composite pass binds the same uniforms. Resolving their locations
    // once keeps a page with hundreds of passes off the synchronous GL queries.
    this.uniforms = Object.fromEntries(SAMPLER_NAMES.concat(["uTransfer", "uParams", "uExtra", "uMaskBackdrop"])
      .map(name => [name, gl.getUniformLocation(program, name)]));
    this.vao = gl.createVertexArray()!;
    this.zero = this.constant(new Uint8Array(4));
    this.one = this.constant(Uint8Array.of(255, 255, 255, 255));
  }

  /**
   * `draw` receives a whole span at a time. Every paint in one reaches the same
   * surface with no composite pass between them, so a caller may batch and
   * reorder within a span and may cache GL state across it; neither holds
   * between spans. A renderer that owns its context may supply the known target
   * and desired return state; shared-context callers capture the current state.
   */
  render(scene: VectorScene, width: number, height: number,
    draw: (runs: readonly VectorDrawRun[], shapeOnly: boolean) => void,
    visible: (condition?: number) => boolean, selected: Uint8Array | null = null,
    project: PdfCompositeProjector | null = null, knownState?: WebGlPaintCompositorState): void {
    const gl = this.gl;
    const size = choosePdfCompositeResolution(scene, width, height);
    if (size.scale < 1 && !this.approximationReported) {
      this.approximationReported = true;
      console.warn(`[hepr] PDF composite surfaces use ${size.width}×${size.height} instead of ${width}×${height} to stay within the memory budget.`);
    }
    if (size.width !== this.width || size.height !== this.height) { this.releaseSurfaces(); this.width = size.width; this.height = size.height; }
    const state = knownState ?? this.captureState();
    const { framebuffer, viewport, clearColor } = state;
    this.drawSpan = draw;
    this.project = project; this.viewportWidth = width; this.viewportHeight = height;
    let backdrop: Surface | null = null, result: Surface | null = null;
    try {
      gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DEPTH_TEST);
      backdrop = this.acquire();
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, backdrop.framebuffer);
      gl.blitFramebuffer(viewport[0], viewport[1], viewport[0] + width, viewport[1] + height,
        0, 0, this.width, this.height, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      result = compositeScenePaintGraph(scene, this, backdrop, visible, selected);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, result.framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
      gl.blitFramebuffer(0, 0, this.width, this.height, viewport[0], viewport[1], viewport[0] + width, viewport[1] + height,
        gl.COLOR_BUFFER_BIT, gl.LINEAR);
    } finally {
      if (result) this.release(result);
      if (backdrop) this.release(backdrop);
      this.drawSpan = null; this.project = null;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, state.readFramebuffer); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
      gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
      gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
      gl.blendFuncSeparate(...state.blendFunction);
      gl.blendEquationSeparate(...state.blendEquation);
      if (state.blend) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
      if (state.scissor) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST);
      if (state.depth) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
      gl.useProgram(state.program); gl.bindVertexArray(state.vao);
    }
  }

  private captureState(): WebGlPaintCompositorState {
    const gl = this.gl;
    return {
      framebuffer: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
      readFramebuffer: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
      viewport: gl.getParameter(gl.VIEWPORT) as Int32Array,
      clearColor: gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array,
      scissor: gl.isEnabled(gl.SCISSOR_TEST), blend: gl.isEnabled(gl.BLEND), depth: gl.isEnabled(gl.DEPTH_TEST),
      program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
      vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null,
      blendFunction: [gl.getParameter(gl.BLEND_SRC_RGB), gl.getParameter(gl.BLEND_DST_RGB),
        gl.getParameter(gl.BLEND_SRC_ALPHA), gl.getParameter(gl.BLEND_DST_ALPHA)],
      blendEquation: [gl.getParameter(gl.BLEND_EQUATION_RGB), gl.getParameter(gl.BLEND_EQUATION_ALPHA)]
    };
  }

  acquire(): Surface {
    const free = this.pool.pop(); if (free) return free;
    if ((this.all.size + 1) * this.width * this.height * 4 > 512 * 1024 * 1024) throw new RangeError("PDF compositing surfaces exceed 512 MiB.");
    const gl = this.gl;
    const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) {
      if (texture) gl.deleteTexture(texture);
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      throw new Error("Unable to allocate PDF compositing surface.");
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteTexture(texture); gl.deleteFramebuffer(framebuffer); throw new Error("PDF compositing framebuffer is incomplete.");
    }
    const surface = { texture, framebuffer }; this.all.add(surface); return surface;
  }
  release(surface: Surface): void { this.pool.push(surface); }
  clear(surface: Surface, color: readonly [number, number, number, number] = [0, 0, 0, 0], bounds?: Bounds): void {
    const gl = this.gl; this.target(surface); gl.clearColor(...color);
    const rect = this.scissor(bounds);
    if (rect) { gl.enable(gl.SCISSOR_TEST); gl.scissor(rect.x, rect.y, rect.width, rect.height); }
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (rect) gl.disable(gl.SCISSOR_TEST);
  }
  copy(source: Surface, destination: Surface, bounds?: Bounds): void {
    const gl = this.gl;
    const rect = this.scissor(bounds) ?? { x: 0, y: 0, width: this.width, height: this.height };
    if (rect.width === 0 || rect.height === 0) return;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source.framebuffer); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destination.framebuffer);
    // An explicit blit rectangle needs no scissor, and copies nothing else.
    gl.blitFramebuffer(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height,
      rect.x, rect.y, rect.x + rect.width, rect.y + rect.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }
  /** Surface pixels an operation may touch, bottom-left origin; null covers it all. */
  private scissor(bounds: Bounds | undefined): { x: number; y: number; width: number; height: number } | null {
    return pdfCompositeScissorRect(bounds, this.project, this.viewportWidth, this.viewportHeight, this.width, this.height);
  }
  draw(runs: readonly VectorDrawRun[], destination: Surface, shapeOnly: boolean): void {
    if (runs.length === 0) return;
    const gl = this.gl; this.target(destination); gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // One framebuffer binding and blend setup for the whole span; source order
    // is the call order.
    this.drawSpan!(runs, shapeOnly);
  }
  pass(operation: PdfCompositeOperation<Surface>, destination: Surface): void {
    const gl = this.gl;
    this.target(destination);
    if (operation.blend) {
      // Premultiplied source-over: exactly what operation 0 computes for a
      // Normal composite, without reading the destination in the shader.
      gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else gl.disable(gl.BLEND);
    gl.useProgram(this.program); gl.bindVertexArray(this.vao);
    const textures = [operation.source, operation.shape, operation.current, operation.stats, operation.initial, operation.mask];
    for (let i = 0; i < textures.length; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, textures[i]?.texture ?? (i === MASK_SAMPLER ? this.one : this.zero));
      gl.uniform1i(this.uniforms[SAMPLER_NAMES[i]], i);
    }
    const transfer = operation.softMask?.transfer;
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, transfer ? this.transferTexture(transfer) : this.zero);
    gl.uniform1i(this.uniforms.uTransfer, 6);
    gl.uniform4f(this.uniforms.uParams, operation.operation, operation.blendMode ?? 0,
      operation.knockout ? 1 : 0, operation.opacity ?? 1);
    gl.uniform4f(this.uniforms.uExtra, operation.alphaIsShape ? 1 : 0,
      operation.softMask?.subtype === "Luminosity" ? 1 : 0, transfer?.length ?? 0, operation.isolated ? 1 : 0);
    gl.uniform3fv(this.uniforms.uMaskBackdrop, operation.softMask?.backdrop ?? [0, 0, 0]);
    const rect = this.scissor(operation.bounds);
    if (rect) { gl.enable(gl.SCISSOR_TEST); gl.scissor(rect.x, rect.y, rect.width, rect.height); }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (rect) gl.disable(gl.SCISSOR_TEST);
    if (operation.blend) gl.disable(gl.BLEND);
    this.onDraw?.();
  }
  dispose(): void {
    this.releaseSurfaces();
    for (const texture of this.transfers.values()) this.gl.deleteTexture(texture);
    this.transfers.clear(); this.gl.deleteTexture(this.zero); this.gl.deleteTexture(this.one);
    this.gl.deleteVertexArray(this.vao); this.gl.deleteProgram(this.program);
  }
  private constant(pixel: Uint8Array): WebGLTexture {
    const gl = this.gl, texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return texture;
  }
  private target(surface: Surface): void { this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, surface.framebuffer); this.gl.viewport(0, 0, this.width, this.height); }
  private releaseSurfaces(): void {
    for (const surface of this.all) { this.gl.deleteTexture(surface.texture); this.gl.deleteFramebuffer(surface.framebuffer); }
    this.pool.length = 0; this.all.clear();
  }
  private transferTexture(values: Float32Array): WebGLTexture {
    let texture = this.transfers.get(values);
    if (texture) return texture;
    const gl = this.gl;
    texture = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const width = Math.min(values.length, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number), height = Math.ceil(values.length / width);
    const pixels = new Float32Array(width * height); pixels.set(values);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, pixels);
    this.transfers.set(values, texture); return texture;
  }
  private shader(type: number, source: string): WebGLShader {
    const gl = this.gl, shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const reason = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(`PDF compositor shader: ${reason}`);
    }
    return shader;
  }
}
