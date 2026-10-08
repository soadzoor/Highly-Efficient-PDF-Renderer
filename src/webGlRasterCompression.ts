import { buildRasterCompressionMipChain, estimateCompressedRasterBytes, rasterCompressionMipLayout,
  type RasterCompressionCapabilities, type RasterCompressionFormat } from "./rasterCompression";
import { GPUTEX_BC7_FRAGMENT } from "./shaders/gputexBc7Fragment";
import { GPUTEX_ASTC4X4_FRAGMENT } from "./shaders/gputexAstc4x4Fragment";
import { GPUTEX_FULLSCREEN_VERTEX } from "./shaders/gputexFullscreenVertex";
import { throwIfAborted } from "./pdf/nativeTypes";

export const MAX_WEBGL_RASTER_COMPRESSION_WORKSPACE_BYTES = 4 * 1024 * 1024;

export interface WebGlCompressedRaster {
  readonly texture: WebGLTexture;
  readonly estimatedBytes: number;
  readonly uvScale: readonly [number, number];
}

interface EncoderProgram {
  program: WebGLProgram;
  source: WebGLUniformLocation;
  size: WebGLUniformLocation;
  flip: WebGLUniformLocation;
}

interface EncoderWorkspace {
  source: WebGLTexture;
  output: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  buffer: WebGLBuffer;
  vao: WebGLVertexArrayObject;
  width: number;
  blockRows: number;
  bytes: number;
}

/** Extensions are queried on the context that will sample the resulting textures. */
export function detectWebGlRasterCompression(gl: WebGL2RenderingContext): RasterCompressionCapabilities {
  try {
    // The pinned kernels emit little-endian u32 block words. A PBO upload
    // cannot repack those words on a big-endian platform without readback.
    if (new Uint8Array(Uint32Array.of(0x01020304).buffer)[0] !== 4 ||
        typeof gl.getExtension !== "function" || typeof gl.texStorage2D !== "function" ||
        typeof gl.readPixels !== "function" || typeof gl.compressedTexSubImage2D !== "function") {
      return { bc7: false, astc4x4: false };
    }
    const bc = gl.getExtension("EXT_texture_compression_bptc");
    const astc = gl.getExtension("WEBGL_compressed_texture_astc");
    return { bc7: typeof bc?.COMPRESSED_RGBA_BPTC_UNORM_EXT === "number",
      astc4x4: typeof astc?.COMPRESSED_RGBA_ASTC_4x4_KHR === "number" &&
        (!astc.getSupportedProfiles || astc.getSupportedProfiles().includes("ldr")) };
  } catch {
    return { bc7: false, astc4x4: false };
  }
}

/**
 * One fragment encodes one block. Integer FBO pixels travel through a PBO to
 * same-context texture storage or transferable parser output. Direct texture
 * uploads avoid JavaScript readback; fixed bands bound every encoder workspace.
 */
export class WebGlRasterCompression {
  private readonly gl: WebGL2RenderingContext;
  private readonly programs = new Map<RasterCompressionFormat, EncoderProgram>();
  private readonly failed = new Set<RasterCompressionFormat>();
  private available: RasterCompressionCapabilities;
  private workspace: EncoderWorkspace | null = null;
  private wasContextLost = false;
  private readonly onContextLost = (): void => {
    this.wasContextLost = true;
    this.releaseWorkspace();
    this.releasePrograms();
  };

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.available = detectWebGlRasterCompression(gl);
    gl.canvas?.addEventListener?.("webglcontextlost", this.onContextLost);
  }

  get capabilities(): RasterCompressionCapabilities {
    if (!this.refreshContext()) return { bc7: false, astc4x4: false };
    return { bc7: this.available.bc7 && !this.failed.has("bc7"),
      astc4x4: this.available.astc4x4 && !this.failed.has("astc-4x4") };
  }

  get workspaceBytes(): number { return this.workspace?.bytes ?? 0; }

  /** Encode transferable blocks during parsing, synchronizing one bounded band at a time. */
  encode(data: Uint8Array, width: number, height: number, format: RasterCompressionFormat,
    workspaceLimitBytes = MAX_WEBGL_RASTER_COMPRESSION_WORKSPACE_BYTES, signal?: AbortSignal): Uint8Array {
    throwIfAborted(signal);
    const caps = this.capabilities;
    if (!(format === "bc7" ? caps.bc7 : caps.astc4x4) || typeof this.gl.getBufferSubData !== "function") {
      throw new Error(`WebGL ${format} block readback is unavailable.`);
    }
    const gl = this.gl, state = captureState(gl);
    try {
      const layout = rasterCompressionMipLayout(width, height, format);
      if (layout[0].width > Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) ||
          layout[0].height > Number(gl.getParameter(gl.MAX_TEXTURE_SIZE))) {
        throw new Error("Block-aligned raster exceeds this context's texture dimension limit.");
      }
      const output = new Uint8Array(layout.reduce((sum, mip) => sum + mip.byteLength, 0));
      const program = this.getProgram(format);
      prepareState(gl);
      const workspace = this.getWorkspace(workspaceLimitBytes);
      gl.bindFramebuffer(gl.FRAMEBUFFER, workspace.framebuffer);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.useProgram(program.program);
      gl.bindVertexArray(workspace.vao);
      gl.uniform1i(program.source, 0);
      gl.uniform1i(program.flip, 0);
      let level = 0;
      for (const pixels of buildRasterCompressionMipChain(data, width, height, signal)) {
        const blocksX = Math.ceil(pixels.width / 4);
        for (let y = 0; y < pixels.height; y += workspace.blockRows * 4) {
          throwIfAborted(signal);
          const rows = Math.min(workspace.blockRows * 4, pixels.height - y);
          const blockRows = Math.ceil(rows / 4), bytes = blocksX * blockRows * 16;
          gl.bindTexture(gl.TEXTURE_2D, workspace.source);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, pixels.width, rows, gl.RGBA, gl.UNSIGNED_BYTE,
            pixels.data.subarray(y * pixels.width * 4, (y + rows) * pixels.width * 4));
          gl.uniform2i(program.size, pixels.width, rows);
          gl.viewport(0, 0, blocksX, blockRows);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, workspace.buffer);
          gl.readPixels(0, 0, blocksX, blockRows, gl.RGBA_INTEGER, gl.UNSIGNED_INT, 0);
          const offset = layout[level].byteOffset + (y / 4) * blocksX * 16;
          gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, output.subarray(offset, offset + bytes));
          checkError(gl, `${format} mip ${level} band readback`);
        }
        level++;
      }
      throwIfAborted(signal);
      return output;
    } catch (error) {
      if (!signal?.aborted) this.failed.add(format);
      this.releaseWorkspace();
      throw error;
    } finally {
      restoreState(gl, state);
    }
  }

  /** Upload parser-prepared blocks without creating encoder workspace or RGBA derivatives. */
  uploadEncoded(data: Uint8Array, width: number, height: number, format: RasterCompressionFormat): WebGlCompressedRaster {
    const layout = rasterCompressionMipLayout(width, height, format);
    const estimatedBytes = layout.reduce((sum, mip) => sum + mip.byteLength, 0);
    if (!(data instanceof Uint8Array) || data.length !== estimatedBytes) {
      throw new RangeError("Incorrect encoded raster mip byte length.");
    }
    const caps = this.capabilities;
    if (!(format === "bc7" ? caps.bc7 : caps.astc4x4)) throw new Error(`WebGL ${format} compression is unavailable.`);
    const gl = this.gl, state = captureState(gl), base = layout[0];
    let texture: WebGLTexture | null = null;
    try {
      if (base.width > Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || base.height > Number(gl.getParameter(gl.MAX_TEXTURE_SIZE))) {
        throw new Error("Block-aligned raster exceeds this context's texture dimension limit.");
      }
      prepareState(gl);
      texture = requireResource(gl.createTexture(), "compressed texture");
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const internalFormat = format === "bc7" ? 0x8e8c : 0x93b0;
      gl.texStorage2D(gl.TEXTURE_2D, layout.length, internalFormat, base.width, base.height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, layout.length - 1);
      checkError(gl, "compressed texture allocation");
      for (const [level, mip] of layout.entries()) {
        gl.compressedTexSubImage2D(gl.TEXTURE_2D, level, 0, 0, mip.width, mip.height, internalFormat,
          data.subarray(mip.byteOffset, mip.byteOffset + mip.byteLength));
        checkError(gl, `${format} encoded mip ${level} upload`);
      }
      return { texture, estimatedBytes, uvScale: [width / base.width, height / base.height] };
    } catch (error) {
      if (texture) gl.deleteTexture(texture);
      this.failed.add(format);
      this.releaseWorkspace();
      throw error;
    } finally {
      restoreState(gl, state);
    }
  }

  upload(data: Uint8Array, width: number, height: number, format: RasterCompressionFormat,
    workspaceLimitBytes = MAX_WEBGL_RASTER_COMPRESSION_WORKSPACE_BYTES): WebGlCompressedRaster {
    const caps = this.capabilities;
    if (!(format === "bc7" ? caps.bc7 : caps.astc4x4)) throw new Error(`WebGL ${format} compression is unavailable.`);
    const gl = this.gl, state = captureState(gl);
    let texture: WebGLTexture | null = null;
    try {
      const layout = rasterCompressionMipLayout(width, height, format);
      const base = layout[0];
      if (base.width > Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || base.height > Number(gl.getParameter(gl.MAX_TEXTURE_SIZE))) {
        throw new Error("Block-aligned raster exceeds this context's texture dimension limit.");
      }
      const program = this.getProgram(format);
      prepareState(gl);
      const workspace = this.getWorkspace(workspaceLimitBytes);
      texture = requireResource(gl.createTexture(), "compressed texture");
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const internalFormat = format === "bc7" ? 0x8e8c : 0x93b0;
      gl.texStorage2D(gl.TEXTURE_2D, layout.length, internalFormat, base.width, base.height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, layout.length - 1);
      checkError(gl, "compressed texture allocation");
      gl.bindFramebuffer(gl.FRAMEBUFFER, workspace.framebuffer);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.useProgram(program.program);
      gl.bindVertexArray(workspace.vao);
      gl.uniform1i(program.source, 0);
      gl.uniform1i(program.flip, 0);
      let level = 0;
      for (const pixels of buildRasterCompressionMipChain(data, width, height)) {
        const blocksX = Math.ceil(pixels.width / 4);
        for (let y = 0; y < pixels.height; y += workspace.blockRows * 4) {
          const rows = Math.min(workspace.blockRows * 4, pixels.height - y);
          const blockRows = Math.ceil(rows / 4), bytes = blocksX * blockRows * 16;
          gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
          gl.bindTexture(gl.TEXTURE_2D, workspace.source);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, pixels.width, rows, gl.RGBA, gl.UNSIGNED_BYTE,
            pixels.data.subarray(y * pixels.width * 4, (y + rows) * pixels.width * 4));
          gl.uniform2i(program.size, pixels.width, rows);
          gl.viewport(0, 0, blocksX, blockRows);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, workspace.buffer);
          gl.readPixels(0, 0, blocksX, blockRows, gl.RGBA_INTEGER, gl.UNSIGNED_INT, 0);
          gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, workspace.buffer);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.compressedTexSubImage2D(gl.TEXTURE_2D, level, 0, y, pixels.width, rows, internalFormat, bytes, 0);
          checkError(gl, `${format} mip ${level} band upload`);
        }
        level++;
      }
      return { texture, estimatedBytes: estimateCompressedRasterBytes(width, height, format),
        uvScale: [width / base.width, height / base.height] };
    } catch (error) {
      if (texture) gl.deleteTexture(texture);
      this.failed.add(format);
      this.releaseWorkspace();
      throw error;
    } finally {
      restoreState(gl, state);
    }
  }

  releaseWorkspace(): void {
    const value = this.workspace;
    this.workspace = null;
    if (!value) return;
    const gl = this.gl;
    gl.deleteTexture(value.source); gl.deleteTexture(value.output);
    gl.deleteFramebuffer(value.framebuffer); gl.deleteBuffer(value.buffer); gl.deleteVertexArray(value.vao);
  }

  dispose(): void {
    this.releaseWorkspace();
    this.releasePrograms();
    this.gl.canvas?.removeEventListener?.("webglcontextlost", this.onContextLost);
  }

  private releasePrograms(): void {
    for (const value of this.programs.values()) this.gl.deleteProgram(value.program);
    this.programs.clear();
  }

  private refreshContext(): boolean {
    if (this.gl.isContextLost?.()) {
      this.onContextLost();
      return false;
    }
    if (this.wasContextLost) {
      this.wasContextLost = false;
      this.failed.clear();
      this.available = detectWebGlRasterCompression(this.gl);
    }
    return true;
  }

  private getProgram(format: RasterCompressionFormat): EncoderProgram {
    const existing = this.programs.get(format);
    if (existing) return existing;
    const gl = this.gl;
    const shaders: WebGLShader[] = [];
    let program: WebGLProgram | null = null;
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, GPUTEX_FULLSCREEN_VERTEX],
        [gl.FRAGMENT_SHADER, format === "bc7" ? GPUTEX_BC7_FRAGMENT : GPUTEX_ASTC4X4_FRAGMENT]] as const) {
        const shader = requireResource(gl.createShader(type), "encoder shader");
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "Encoder shader compilation failed.");
      }
      program = requireResource(gl.createProgram(), "encoder program");
      for (const shader of shaders) gl.attachShader(program, shader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "Encoder program linking failed.");
      const value = { program, source: requireResource(gl.getUniformLocation(program, "uSrc"), "source uniform"),
        size: requireResource(gl.getUniformLocation(program, "uSrcSize"), "size uniform"),
        flip: requireResource(gl.getUniformLocation(program, "uFlipY"), "flip uniform") };
      this.programs.set(format, value);
      return value;
    } catch (error) {
      if (program) gl.deleteProgram(program);
      throw error;
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
  }

  private getWorkspace(requestedLimit: number): EncoderWorkspace {
    const limit = Math.min(MAX_WEBGL_RASTER_COMPRESSION_WORKSPACE_BYTES, Math.max(0, Math.floor(requestedLimit)));
    if (this.workspace && this.workspace.bytes <= limit) return this.workspace;
    this.releaseWorkspace();
    // A fixed device-width workspace avoids retaining a growing series of
    // deleted scratch textures while earlier encode commands finish on GPU.
    const gl = this.gl, width = Math.floor(Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) / 4) * 4;
    const blocksX = width / 4;
    const rowBytes = width * 4 * 4 + blocksX * 16 * 2;
    const blockRows = Math.min(Math.floor(Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) / 4), Math.floor(limit / rowBytes));
    if (blockRows < 1) throw new Error("Insufficient bounded workspace for one compressed block row.");
    let source: WebGLTexture | null = null, output: WebGLTexture | null = null;
    let framebuffer: WebGLFramebuffer | null = null, buffer: WebGLBuffer | null = null, vao: WebGLVertexArrayObject | null = null;
    try {
      source = requireResource(gl.createTexture(), "encoder source texture");
      output = requireResource(gl.createTexture(), "encoder output texture");
      framebuffer = requireResource(gl.createFramebuffer(), "encoder framebuffer");
      buffer = requireResource(gl.createBuffer(), "encoder pixel buffer");
      vao = requireResource(gl.createVertexArray(), "encoder vertex array");
      gl.bindTexture(gl.TEXTURE_2D, source);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, blockRows * 4);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, output);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32UI, blocksX, blockRows);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Integer encoder framebuffer is incomplete.");
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, blocksX * blockRows * 16, gl.STREAM_COPY);
      checkError(gl, "encoder workspace allocation");
      return this.workspace = { source, output, framebuffer, buffer, vao, width, blockRows, bytes: rowBytes * blockRows };
    } catch (error) {
      gl.deleteTexture(source); gl.deleteTexture(output); gl.deleteFramebuffer(framebuffer);
      gl.deleteBuffer(buffer); gl.deleteVertexArray(vao);
      throw error;
    }
  }
}

function requireResource<T>(value: T | null, name: string): T {
  if (value == null) throw new Error(`Unable to allocate ${name}.`);
  return value;
}

function checkError(gl: WebGL2RenderingContext, operation: string): void {
  const error = gl.getError();
  if (error !== gl.NO_ERROR) throw new Error(`${operation} failed (WebGL error ${error}).`);
}

function pixelStoreParameters(gl: WebGL2RenderingContext): number[] {
  return [gl.PACK_ALIGNMENT, gl.PACK_ROW_LENGTH, gl.PACK_SKIP_PIXELS, gl.PACK_SKIP_ROWS,
    gl.UNPACK_ALIGNMENT, gl.UNPACK_ROW_LENGTH, gl.UNPACK_IMAGE_HEIGHT, gl.UNPACK_SKIP_PIXELS,
    gl.UNPACK_SKIP_ROWS, gl.UNPACK_SKIP_IMAGES, gl.UNPACK_FLIP_Y_WEBGL, gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
    gl.UNPACK_COLORSPACE_CONVERSION_WEBGL];
}

function captureState(gl: WebGL2RenderingContext) {
  const activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
  gl.activeTexture(gl.TEXTURE0);
  const texture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  const toggles = [gl.BLEND, gl.DEPTH_TEST, gl.STENCIL_TEST, gl.SCISSOR_TEST, gl.CULL_FACE, gl.DITHER, gl.RASTERIZER_DISCARD];
  return { activeTexture, texture, toggles: toggles.map(cap => [cap, gl.isEnabled(cap)] as const),
    viewport: gl.getParameter(gl.VIEWPORT) as Int32Array,
    colorMask: gl.getParameter(gl.COLOR_WRITEMASK) as boolean[],
    program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
    sampler: gl.getParameter(gl.SAMPLER_BINDING) as WebGLSampler | null,
    vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null,
    drawFramebuffer: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
    readFramebuffer: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
    pack: gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) as WebGLBuffer | null,
    unpack: gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING) as WebGLBuffer | null,
    pixels: pixelStoreParameters(gl).map(parameter => [parameter, gl.getParameter(parameter)] as const) };
}

function prepareState(gl: WebGL2RenderingContext): void {
  for (const cap of [gl.BLEND, gl.DEPTH_TEST, gl.STENCIL_TEST, gl.SCISSOR_TEST, gl.CULL_FACE, gl.DITHER, gl.RASTERIZER_DISCARD]) gl.disable(cap);
  gl.colorMask(true, true, true, true);
  gl.bindSampler(0, null);
  gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
  for (const parameter of pixelStoreParameters(gl)) {
    gl.pixelStorei(parameter, parameter === gl.PACK_ALIGNMENT || parameter === gl.UNPACK_ALIGNMENT ? 1 :
      parameter === gl.UNPACK_COLORSPACE_CONVERSION_WEBGL ? gl.NONE : 0);
  }
}

function restoreState(gl: WebGL2RenderingContext, state: ReturnType<typeof captureState>): void {
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, state.drawFramebuffer);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, state.readFramebuffer);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, state.pack); gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, state.unpack);
  for (const [parameter, value] of state.pixels) gl.pixelStorei(parameter, value);
  for (const [cap, enabled] of state.toggles) enabled ? gl.enable(cap) : gl.disable(cap);
  gl.viewport(state.viewport[0], state.viewport[1], state.viewport[2], state.viewport[3]);
  gl.colorMask(state.colorMask[0], state.colorMask[1], state.colorMask[2], state.colorMask[3]);
  gl.useProgram(state.program); gl.bindVertexArray(state.vao);
  gl.bindSampler(0, state.sampler);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, state.texture); gl.activeTexture(state.activeTexture);
}
