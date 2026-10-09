import type { PrimitiveHighlightSet } from "./primitiveAppearance";
import { MAX_VECTOR_CLIP_TEXELS, packVectorClips } from "./vectorClips";
import {
  PRIMITIVE_HIGHLIGHT_VERTEX_GLSL,
  PRIMITIVE_HIGHLIGHT_FRAGMENT_GLSL,
  PRIMITIVE_HIGHLIGHT_WGSL
} from "./primitiveHighlightShaders";

function clipPixels(highlights: PrimitiveHighlightSet, maxSize: number): { data: Float32Array; width: number; height: number } {
  const packed = packVectorClips(highlights.clipPaths, Math.min(MAX_VECTOR_CLIP_TEXELS, maxSize ** 2));
  const width = Math.max(1, Math.min(maxSize, Math.ceil(Math.sqrt(packed.length / 4))));
  const height = Math.max(1, Math.ceil(packed.length / 4 / width));
  if (height > maxSize) throw new RangeError("Primitive highlight clips exceed GPU limits.");
  const data = new Float32Array(width * height * 4);
  data.set(packed);
  return { data, width, height };
}

/** Small, independent geometry overlay, allocated only when explicitly requested. */
export class WebGlPrimitiveHighlights {
  private readonly program: WebGLProgram;
  private readonly buffer: WebGLBuffer;
  private readonly vao: WebGLVertexArrayObject;
  private readonly clips: WebGLTexture;
  private readonly uniforms: Record<string, WebGLUniformLocation | null> = {};
  private count = 0;
  private selectionCount = 0;
  private readonly matrix = new Float32Array(16);
  private capacityBytes = 0;
  private clipWidth = 0;
  private clipHeight = 0;

  private readonly gl: WebGL2RenderingContext;

  constructor(gl: WebGL2RenderingContext, createProgram: (vertex: string, fragment: string) => WebGLProgram) {
    this.gl = gl;
    this.program = createProgram(PRIMITIVE_HIGHLIGHT_VERTEX_GLSL
      .replace("layout(location=2) in float aHighlightIndex;", "")
      .replace("aHighlightIndex <", "float(gl_InstanceID) <"), PRIMITIVE_HIGHLIGHT_FRAGMENT_GLSL);
    const buffer = gl.createBuffer();
    const vao = gl.createVertexArray();
    const clips = gl.createTexture();
    if (!buffer || !vao || !clips) {
      gl.deleteBuffer(buffer); gl.deleteVertexArray(vao); gl.deleteTexture(clips); gl.deleteProgram(this.program);
      throw new Error("Unable to allocate primitive highlight resources.");
    }
    this.buffer = buffer;
    this.vao = vao;
    this.clips = clips;
    for (const name of ["uLocalToClip", "uLocalUnitsPerPixel", "uPixelRatio", "uSelectionCount", "uVectorClipTex"]) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (let attribute = 0; attribute < 2; attribute++) {
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, 4, gl.FLOAT, false, 32, attribute * 16);
      gl.vertexAttribDivisor(attribute, 1);
    }
    gl.bindVertexArray(null);
  }

  set(highlights: PrimitiveHighlightSet | null): void {
    this.count = highlights?.count ?? 0;
    this.selectionCount = highlights?.selectionCount ?? 0;
    if (!highlights || !this.count) return;
    const gl = this.gl;
    const packed = clipPixels(highlights, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    if (this.capacityBytes < this.count * 32) {
      this.capacityBytes = Math.max(this.count * 32, this.capacityBytes * 2, 1024);
      gl.bufferData(gl.ARRAY_BUFFER, this.capacityBytes, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, highlights.segments.subarray(0, this.count * 8));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.clips);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (this.clipWidth !== packed.width || this.clipHeight !== packed.height) {
      this.clipWidth = packed.width;
      this.clipHeight = packed.height;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, packed.width, packed.height, 0, gl.RGBA, gl.FLOAT, packed.data);
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, packed.width, packed.height, gl.RGBA, gl.FLOAT, packed.data);
    }
  }

  /** Returns the number of GPU draw commands submitted. */
  draw(matrix: ArrayLike<number>, localUnitsPerPixel: number, pixelRatio: number): number {
    if (!this.count) return 0;
    const gl = this.gl;
    this.matrix.set(matrix);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.uLocalToClip, false, this.matrix);
    gl.uniform1f(this.uniforms.uLocalUnitsPerPixel, localUnitsPerPixel);
    gl.uniform1f(this.uniforms.uPixelRatio, pixelRatio);
    gl.uniform1f(this.uniforms.uSelectionCount, this.selectionCount);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.clips);
    gl.uniform1i(this.uniforms.uVectorClipTex, 0);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    gl.bindVertexArray(null);
    return 1;
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteTexture(this.clips);
  }
}

export class WebGpuPrimitiveHighlights {
  private readonly pipeline: any;
  private readonly camera: any;
  private segments: any = null;
  private clips: any = null;
  private bindGroup: any = null;
  private count = 0;
  private selectionCount = 0;
  private readonly cameraData = new Float32Array(20);
  private readonly device: any;
  private capacityBytes = 0;
  private clipWidth = 0;
  private clipHeight = 0;

  constructor(device: any, format: string) {
    this.device = device;
    const usage = (globalThis as any).GPUBufferUsage;
    this.camera = device.createBuffer({ size: 80, usage: usage.UNIFORM | usage.COPY_DST });
    const shader = device.createShaderModule({ code: PRIMITIVE_HIGHLIGHT_WGSL });
    const stage = (globalThis as any).GPUShaderStage;
    const layout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: stage.VERTEX | stage.FRAGMENT, buffer: { type: "uniform", minBindingSize: 80 } },
      { binding: 1, visibility: stage.VERTEX, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: stage.FRAGMENT, texture: { sampleType: "unfilterable-float" } }
    ] });
    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module: shader, entryPoint: "vsMain" },
      fragment: { module: shader, entryPoint: "fsMain", targets: [{ format, blend: {
        color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
        alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
      } }] },
      primitive: { topology: "triangle-strip" }
    });
  }

  set(highlights: PrimitiveHighlightSet | null): void {
    this.count = highlights?.count ?? 0;
    this.selectionCount = highlights?.selectionCount ?? 0;
    if (!highlights || !this.count) return;
    const usage = (globalThis as any).GPUBufferUsage;
    const textureUsage = (globalThis as any).GPUTextureUsage;
    const packed = clipPixels(highlights, this.device.limits.maxTextureDimension2D);
    let resourcesChanged = false;
    if (this.capacityBytes < this.count * 32) {
      this.segments?.destroy();
      this.capacityBytes = Math.max(this.count * 32, this.capacityBytes * 2, 1024);
      this.segments = this.device.createBuffer({ size: this.capacityBytes, usage: usage.STORAGE | usage.COPY_DST });
      resourcesChanged = true;
    }
    this.device.queue.writeBuffer(this.segments, 0, highlights.segments.subarray(0, this.count * 8));
    if (this.clipWidth !== packed.width || this.clipHeight !== packed.height) {
      this.clips?.destroy();
      this.clipWidth = packed.width;
      this.clipHeight = packed.height;
      this.clips = this.device.createTexture({ size: [packed.width, packed.height], format: "rgba32float", usage: textureUsage.TEXTURE_BINDING | textureUsage.COPY_DST });
      resourcesChanged = true;
    }
    this.device.queue.writeTexture({ texture: this.clips }, packed.data, { bytesPerRow: packed.width * 16 }, [packed.width, packed.height]);
    if (resourcesChanged || !this.bindGroup) this.bindGroup = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.camera } },
      { binding: 1, resource: { buffer: this.segments } },
      { binding: 2, resource: this.clips.createView() }
    ] });
  }

  /** Returns the number of GPU draw commands submitted. */
  draw(pass: any, matrix: ArrayLike<number>, localUnitsPerPixel: number, pixelRatio: number): number {
    if (!this.count || !this.bindGroup) return 0;
    this.cameraData.set(matrix, 0);
    this.cameraData.set([localUnitsPerPixel, pixelRatio, this.selectionCount, 0], 16);
    this.device.queue.writeBuffer(this.camera, 0, this.cameraData);
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(4, this.count);
    return 1;
  }

  dispose(): void { this.camera.destroy(); this.segments?.destroy(); this.clips?.destroy(); }
}
