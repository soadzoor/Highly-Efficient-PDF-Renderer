import type { VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import { compositeScenePaintGraph, type PdfCompositeOperation, type ScenePaintCompositorAdapter } from "./scenePaintCompositor";
import { PDF_COMPOSITE_FRAGMENT_GLSL, PDF_COMPOSITE_VERTEX_GLSL } from "./pdfCompositeShaders";
import { choosePdfCompositeResolution } from "./pdfCompositeBudget";

interface Surface { texture: WebGLTexture; framebuffer: WebGLFramebuffer }

const SAMPLER_NAMES = ["uSource", "uShape", "uCurrent", "uStats", "uInitial", "uMask"];

/** Transient GL surfaces for the shared PDF pass executor. */
export class WebGlPaintCompositor implements ScenePaintCompositorAdapter<Surface> {
  private readonly gl: WebGL2RenderingContext;
  private readonly onDraw: (() => void) | undefined;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<string, WebGLUniformLocation | null>;
  private readonly vao: WebGLVertexArrayObject;
  private readonly zero: WebGLTexture;
  private readonly transfers = new Map<Float32Array, WebGLTexture>();
  private readonly pool: Surface[] = [];
  private readonly all = new Set<Surface>();
  private width = 0;
  private height = 0;
  private approximationReported = false;
  private drawRun: ((run: VectorDrawRun, shapeOnly: boolean) => void) | null = null;

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
    this.zero = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.zero);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  }

  render(scene: VectorScene, width: number, height: number, draw: (run: VectorDrawRun, shapeOnly: boolean) => void,
    visible: (condition?: number) => boolean): void {
    const gl = this.gl;
    const size = choosePdfCompositeResolution(scene, width, height);
    if (size.scale < 1 && !this.approximationReported) {
      this.approximationReported = true;
      console.warn(`[hepr] PDF composite surfaces use ${size.width}×${size.height} instead of ${width}×${height} to stay within the memory budget.`);
    }
    if (size.width !== this.width || size.height !== this.height) { this.releaseSurfaces(); this.width = size.width; this.height = size.height; }
    const framebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const readFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const scissor = gl.isEnabled(gl.SCISSOR_TEST), blend = gl.isEnabled(gl.BLEND), depth = gl.isEnabled(gl.DEPTH_TEST);
    const oldProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    const oldVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    const clearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
    const blendSrcRgb = gl.getParameter(gl.BLEND_SRC_RGB), blendDstRgb = gl.getParameter(gl.BLEND_DST_RGB);
    const blendSrcAlpha = gl.getParameter(gl.BLEND_SRC_ALPHA), blendDstAlpha = gl.getParameter(gl.BLEND_DST_ALPHA);
    const blendRgb = gl.getParameter(gl.BLEND_EQUATION_RGB), blendAlpha = gl.getParameter(gl.BLEND_EQUATION_ALPHA);
    this.drawRun = draw;
    let backdrop: Surface | null = null, result: Surface | null = null;
    try {
      gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DEPTH_TEST);
      backdrop = this.acquire();
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, backdrop.framebuffer);
      gl.blitFramebuffer(viewport[0], viewport[1], viewport[0] + width, viewport[1] + height,
        0, 0, this.width, this.height, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      result = compositeScenePaintGraph(scene, this, backdrop, visible);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, result.framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
      gl.blitFramebuffer(0, 0, this.width, this.height, viewport[0], viewport[1], viewport[0] + width, viewport[1] + height,
        gl.COLOR_BUFFER_BIT, gl.LINEAR);
    } finally {
      if (result) this.release(result);
      if (backdrop) this.release(backdrop);
      this.drawRun = null;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFramebuffer); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
      gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);
      gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
      gl.blendFuncSeparate(blendSrcRgb, blendDstRgb, blendSrcAlpha, blendDstAlpha);
      gl.blendEquationSeparate(blendRgb, blendAlpha);
      if (blend) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
      if (scissor) gl.enable(gl.SCISSOR_TEST); else gl.disable(gl.SCISSOR_TEST);
      if (depth) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
      gl.useProgram(oldProgram); gl.bindVertexArray(oldVao);
    }
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
  clear(surface: Surface, color: readonly [number, number, number, number] = [0, 0, 0, 0]): void {
    const gl = this.gl; this.target(surface); gl.clearColor(...color); gl.clear(gl.COLOR_BUFFER_BIT);
  }
  copy(source: Surface, destination: Surface): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source.framebuffer); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destination.framebuffer);
    gl.blitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }
  draw(runs: readonly VectorDrawRun[], destination: Surface, shapeOnly: boolean): void {
    if (runs.length === 0) return;
    const gl = this.gl; this.target(destination); gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // One framebuffer binding and blend setup for the whole span; source order
    // is the call order.
    for (const run of runs) this.drawRun!(run, shapeOnly);
  }
  pass(operation: PdfCompositeOperation<Surface>, destination: Surface): void {
    const gl = this.gl;
    this.target(destination); gl.disable(gl.BLEND); gl.useProgram(this.program); gl.bindVertexArray(this.vao);
    const textures = [operation.source, operation.shape, operation.current, operation.stats, operation.initial, operation.mask];
    for (let i = 0; i < textures.length; i++) {
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, textures[i]?.texture ?? this.zero);
      gl.uniform1i(this.uniforms[SAMPLER_NAMES[i]], i);
    }
    const transfer = operation.softMask?.transfer;
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, transfer ? this.transferTexture(transfer) : this.zero);
    gl.uniform1i(this.uniforms.uTransfer, 6);
    gl.uniform4f(this.uniforms.uParams, operation.operation, operation.blendMode ?? 0,
      operation.knockout ? 1 : 0, operation.opacity ?? 1);
    gl.uniform4f(this.uniforms.uExtra, operation.alphaIsShape ? 1 : 0,
      operation.softMask?.subtype === "Luminosity" ? 1 : 0, transfer?.length ?? 0, 0);
    gl.uniform3fv(this.uniforms.uMaskBackdrop, operation.softMask?.backdrop ?? [0, 0, 0]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.onDraw?.();
  }
  dispose(): void {
    this.releaseSurfaces();
    for (const texture of this.transfers.values()) this.gl.deleteTexture(texture);
    this.transfers.clear(); this.gl.deleteTexture(this.zero); this.gl.deleteVertexArray(this.vao); this.gl.deleteProgram(this.program);
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
