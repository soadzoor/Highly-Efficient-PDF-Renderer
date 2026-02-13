import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import { buildSpatialGrid, type SpatialGrid } from "./spatialGrid";

const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp sampler2D;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in float aSegmentIndex;

uniform sampler2D uSegmentTexA;
uniform sampler2D uSegmentTexB;
uniform ivec2 uSegmentTexSize;
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uAAScreenPx;

out vec2 vP0;
out vec2 vP1;
out float vHalfWidth;
out float vLuma;
out float vAlpha;

ivec2 segmentCoord(int index) {
  int x = index % uSegmentTexSize.x;
  int y = index / uSegmentTexSize.x;
  return ivec2(x, y);
}

void main() {
  int index = int(aSegmentIndex + 0.5);
  vec4 endpoints = texelFetch(uSegmentTexA, segmentCoord(index), 0);
  vec4 style = texelFetch(uSegmentTexB, segmentCoord(index), 0);

  vec2 p0 = endpoints.xy;
  vec2 p1 = endpoints.zw;
  float halfWidth = style.x;
  float luma = style.y;
  float alpha = style.z;

  vec2 delta = p1 - p0;
  float lengthValue = length(delta);

  if (lengthValue < 1e-5 || alpha <= 0.001) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    vP0 = p0;
    vP1 = p1;
    vHalfWidth = 0.0;
    vLuma = luma;
    vAlpha = 0.0;
    return;
  }

  vec2 tangent = delta / lengthValue;
  vec2 normal = vec2(-tangent.y, tangent.x);

  float aaWorld = max(1.0 / uZoom, 0.0001) * uAAScreenPx;

  vec2 center = 0.5 * (p0 + p1);
  vec2 worldPosition = center
    + tangent * aCorner.x * (0.5 * lengthValue + halfWidth + aaWorld)
    + normal * aCorner.y * (halfWidth + aaWorld);

  vec2 screen = (worldPosition - uCameraCenter) * uZoom + 0.5 * uViewport;
  vec2 clip = (screen / (0.5 * uViewport)) - 1.0;

  gl_Position = vec4(clip, 0.0, 1.0);

  vP0 = p0;
  vP1 = p1;
  vHalfWidth = halfWidth;
  vLuma = luma;
  vAlpha = alpha;
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;

in vec2 vP0;
in vec2 vP1;
in float vHalfWidth;
in float vLuma;
in float vAlpha;

out vec4 outColor;

float lineDistance(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float abLenSq = dot(ab, ab);
  if (abLenSq < 1e-10) {
    return length(p - a);
  }
  float t = clamp(dot(p - a, ab) / abLenSq, 0.0, 1.0);
  vec2 projection = a + ab * t;
  return length(p - projection);
}

void main() {
  if (vAlpha <= 0.001) {
    discard;
  }

  vec2 world = (gl_FragCoord.xy - 0.5 * uViewport) / uZoom + uCameraCenter;
  float distanceToSegment = lineDistance(world, vP0, vP1);
  float aaWorld = max(1.0 / uZoom, 0.0001);

  float coverage = 1.0 - smoothstep(vHalfWidth - aaWorld, vHalfWidth + aaWorld, distanceToSegment);
  float alpha = coverage * vAlpha;

  if (alpha <= 0.001) {
    discard;
  }

  vec3 color = vec3(vLuma);
  outColor = vec4(color, alpha);
}
`;

export interface DrawStats {
  renderedSegments: number;
  totalSegments: number;
  usedCulling: boolean;
  zoom: number;
}

export interface SceneStats {
  gridWidth: number;
  gridHeight: number;
  gridIndexCount: number;
  maxCellPopulation: number;
  textureWidth: number;
  textureHeight: number;
  maxTextureSize: number;
}

type FrameListener = (stats: DrawStats) => void;

export class GpuFloorplanRenderer {
  private readonly canvas: HTMLCanvasElement;

  private readonly gl: WebGL2RenderingContext;

  private readonly program: WebGLProgram;

  private readonly vao: WebGLVertexArrayObject;

  private readonly cornerBuffer: WebGLBuffer;

  private readonly allSegmentIdBuffer: WebGLBuffer;

  private readonly visibleSegmentIdBuffer: WebGLBuffer;

  private readonly segmentTextureA: WebGLTexture;

  private readonly segmentTextureB: WebGLTexture;

  private readonly uSegmentTexA: WebGLUniformLocation;

  private readonly uSegmentTexB: WebGLUniformLocation;

  private readonly uSegmentTexSize: WebGLUniformLocation;

  private readonly uViewport: WebGLUniformLocation;

  private readonly uCameraCenter: WebGLUniformLocation;

  private readonly uZoom: WebGLUniformLocation;

  private readonly uAAScreenPx: WebGLUniformLocation;

  private scene: VectorScene | null = null;

  private grid: SpatialGrid | null = null;

  private sceneStats: SceneStats | null = null;

  private allSegmentIds = new Float32Array(0);

  private visibleSegmentIds = new Float32Array(0);

  private segmentMarks = new Uint32Array(0);

  private markToken = 1;

  private segmentCount = 0;

  private visibleSegmentCount = 0;

  private usingAllSegments = true;

  private segmentTextureWidth = 1;

  private segmentTextureHeight = 1;

  private needsVisibleSetUpdate = false;

  private rafHandle = 0;

  private frameListener: FrameListener | null = null;

  private cameraCenterX = 0;

  private cameraCenterY = 0;

  private zoom = 1;

  private minZoom = 0.01;

  private maxZoom = 4_096;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    const context = canvas.getContext("webgl2", {
      antialias: false,
      depth: false,
      stencil: false,
      alpha: false,
      premultipliedAlpha: false
    });

    if (!context) {
      throw new Error("WebGL2 is required for this proof-of-concept renderer.");
    }

    this.gl = context;

    this.program = this.createProgram(VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
    this.vao = this.createVertexArray();

    this.cornerBuffer = this.mustCreateBuffer();
    this.allSegmentIdBuffer = this.mustCreateBuffer();
    this.visibleSegmentIdBuffer = this.mustCreateBuffer();

    this.segmentTextureA = this.mustCreateTexture();
    this.segmentTextureB = this.mustCreateTexture();

    this.uSegmentTexA = this.mustGetUniformLocation("uSegmentTexA");
    this.uSegmentTexB = this.mustGetUniformLocation("uSegmentTexB");
    this.uSegmentTexSize = this.mustGetUniformLocation("uSegmentTexSize");
    this.uViewport = this.mustGetUniformLocation("uViewport");
    this.uCameraCenter = this.mustGetUniformLocation("uCameraCenter");
    this.uZoom = this.mustGetUniformLocation("uZoom");
    this.uAAScreenPx = this.mustGetUniformLocation("uAAScreenPx");

    this.initializeGeometry();
    this.initializeState();
  }

  setFrameListener(listener: FrameListener | null): void {
    this.frameListener = listener;
  }

  resize(): void {
    const devicePixelRatio = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.round(this.canvas.clientWidth * devicePixelRatio));
    const nextHeight = Math.max(1, Math.round(this.canvas.clientHeight * devicePixelRatio));

    if (this.canvas.width === nextWidth && this.canvas.height === nextHeight) {
      return;
    }

    this.canvas.width = nextWidth;
    this.canvas.height = nextHeight;

    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  setScene(scene: VectorScene): SceneStats {
    this.scene = scene;
    this.segmentCount = scene.segmentCount;

    this.grid = buildSpatialGrid(scene);
    const textureStats = this.uploadSegments(scene);
    this.sceneStats = {
      gridWidth: this.grid.gridWidth,
      gridHeight: this.grid.gridHeight,
      gridIndexCount: this.grid.indices.length,
      maxCellPopulation: this.grid.maxCellPopulation,
      textureWidth: textureStats.textureWidth,
      textureHeight: textureStats.textureHeight,
      maxTextureSize: textureStats.maxTextureSize
    };

    this.allSegmentIds = new Float32Array(this.segmentCount);
    for (let i = 0; i < this.segmentCount; i += 1) {
      this.allSegmentIds[i] = i;
    }

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.allSegmentIdBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.allSegmentIds, this.gl.STATIC_DRAW);

    if (this.visibleSegmentIds.length < this.segmentCount) {
      this.visibleSegmentIds = new Float32Array(this.segmentCount);
    }

    if (this.segmentMarks.length < this.segmentCount) {
      this.segmentMarks = new Uint32Array(this.segmentCount);
      this.markToken = 1;
    }

    this.visibleSegmentCount = this.segmentCount;
    this.usingAllSegments = true;

    this.minZoom = 0.01;
    this.maxZoom = 8_192;

    this.needsVisibleSetUpdate = true;
    this.requestFrame();

    return this.sceneStats;
  }

  getSceneStats(): SceneStats | null {
    return this.sceneStats;
  }

  fitToBounds(bounds: Bounds, paddingPixels = 64): void {
    const width = Math.max(bounds.maxX - bounds.minX, 1e-4);
    const height = Math.max(bounds.maxY - bounds.minY, 1e-4);

    const viewWidth = Math.max(1, this.canvas.width - paddingPixels * 2);
    const viewHeight = Math.max(1, this.canvas.height - paddingPixels * 2);

    this.zoom = Math.min(viewWidth / width, viewHeight / height);
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);

    this.cameraCenterX = (bounds.minX + bounds.maxX) * 0.5;
    this.cameraCenterY = (bounds.minY + bounds.maxY) * 0.5;

    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  panByPixels(deltaX: number, deltaY: number): void {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      return;
    }

    this.cameraCenterX -= deltaX / this.zoom;
    this.cameraCenterY += deltaY / this.zoom;

    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  zoomAtClientPoint(clientX: number, clientY: number, zoomFactor: number): void {
    const clampedFactor = clamp(zoomFactor, 0.1, 10);
    const before = this.clientToWorld(clientX, clientY);

    const nextZoom = clamp(this.zoom * clampedFactor, this.minZoom, this.maxZoom);
    this.zoom = nextZoom;

    const after = this.clientToWorld(clientX, clientY);

    this.cameraCenterX += before.x - after.x;
    this.cameraCenterY += before.y - after.y;

    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  requestFrame(): void {
    if (this.rafHandle !== 0) {
      return;
    }

    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = 0;
      this.render();
    });
  }

  private render(): void {
    const gl = this.gl;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (!this.scene || this.segmentCount === 0) {
      this.frameListener?.({
        renderedSegments: 0,
        totalSegments: 0,
        usedCulling: false,
        zoom: this.zoom
      });
      return;
    }

    if (this.needsVisibleSetUpdate) {
      this.updateVisibleSet();
      this.needsVisibleSetUpdate = false;
    }

    const instanceCount = this.usingAllSegments ? this.segmentCount : this.visibleSegmentCount;

    if (instanceCount === 0) {
      this.frameListener?.({
        renderedSegments: 0,
        totalSegments: this.segmentCount,
        usedCulling: !this.usingAllSegments,
        zoom: this.zoom
      });
      return;
    }

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    const segmentIdBuffer = this.usingAllSegments ? this.allSegmentIdBuffer : this.visibleSegmentIdBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, segmentIdBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 4, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.segmentTextureA);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.segmentTextureB);

    gl.uniform1i(this.uSegmentTexA, 0);
    gl.uniform1i(this.uSegmentTexB, 1);
    gl.uniform2i(this.uSegmentTexSize, this.segmentTextureWidth, this.segmentTextureHeight);
    gl.uniform2f(this.uViewport, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uCameraCenter, this.cameraCenterX, this.cameraCenterY);
    gl.uniform1f(this.uZoom, this.zoom);
    gl.uniform1f(this.uAAScreenPx, 1);

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instanceCount);

    this.frameListener?.({
      renderedSegments: instanceCount,
      totalSegments: this.segmentCount,
      usedCulling: !this.usingAllSegments,
      zoom: this.zoom
    });
  }

  private updateVisibleSet(): void {
    if (!this.scene || !this.grid) {
      this.visibleSegmentCount = 0;
      this.usingAllSegments = true;
      return;
    }

    const grid = this.grid;

    const halfViewWidth = this.canvas.width / (2 * this.zoom);
    const halfViewHeight = this.canvas.height / (2 * this.zoom);

    const margin = Math.max(16 / this.zoom, this.scene.maxHalfWidth * 2);

    const viewMinX = this.cameraCenterX - halfViewWidth - margin;
    const viewMaxX = this.cameraCenterX + halfViewWidth + margin;
    const viewMinY = this.cameraCenterY - halfViewHeight - margin;
    const viewMaxY = this.cameraCenterY + halfViewHeight + margin;

    const c0 = clampToGrid(Math.floor((viewMinX - grid.minX) / grid.cellWidth), grid.gridWidth);
    const c1 = clampToGrid(Math.floor((viewMaxX - grid.minX) / grid.cellWidth), grid.gridWidth);
    const r0 = clampToGrid(Math.floor((viewMinY - grid.minY) / grid.cellHeight), grid.gridHeight);
    const r1 = clampToGrid(Math.floor((viewMaxY - grid.minY) / grid.cellHeight), grid.gridHeight);

    const visibleCellCount = (c1 - c0 + 1) * (r1 - r0 + 1);
    const totalCellCount = grid.gridWidth * grid.gridHeight;

    if (visibleCellCount >= totalCellCount * 0.7) {
      this.usingAllSegments = true;
      this.visibleSegmentCount = this.segmentCount;
      return;
    }

    this.usingAllSegments = false;

    this.markToken += 1;
    if (this.markToken === 0xffffffff) {
      this.segmentMarks.fill(0);
      this.markToken = 1;
    }

    let outCount = 0;

    for (let row = r0; row <= r1; row += 1) {
      let cellIndex = row * grid.gridWidth + c0;
      for (let col = c0; col <= c1; col += 1) {
        const offset = grid.offsets[cellIndex];
        const count = grid.counts[cellIndex];
        for (let i = 0; i < count; i += 1) {
          const segmentIndex = grid.indices[offset + i];
          if (this.segmentMarks[segmentIndex] === this.markToken) {
            continue;
          }
          this.segmentMarks[segmentIndex] = this.markToken;
          this.visibleSegmentIds[outCount] = segmentIndex;
          outCount += 1;
        }
        cellIndex += 1;
      }
    }

    this.visibleSegmentCount = outCount;

    const slice = this.visibleSegmentIds.subarray(0, outCount);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.visibleSegmentIdBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, slice, this.gl.DYNAMIC_DRAW);
  }

  private uploadSegments(scene: VectorScene): {
    textureWidth: number;
    textureHeight: number;
    maxTextureSize: number;
  } {
    const gl = this.gl;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

    const preferredWidth = Math.ceil(Math.sqrt(scene.segmentCount));
    this.segmentTextureWidth = clamp(preferredWidth, 1, maxTextureSize);
    this.segmentTextureHeight = Math.max(1, Math.ceil(scene.segmentCount / this.segmentTextureWidth));

    if (this.segmentTextureHeight > maxTextureSize) {
      throw new Error("Segment texture exceeds GPU limits for this browser/GPU.");
    }

    const texelCount = this.segmentTextureWidth * this.segmentTextureHeight;

    const endpointsTextureData = new Float32Array(texelCount * 4);
    endpointsTextureData.set(scene.endpoints);

    const styleTextureData = new Float32Array(texelCount * 4);
    styleTextureData.set(scene.styles);

    gl.bindTexture(gl.TEXTURE_2D, this.segmentTextureA);
    configureFloatTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      this.segmentTextureWidth,
      this.segmentTextureHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      endpointsTextureData
    );

    gl.bindTexture(gl.TEXTURE_2D, this.segmentTextureB);
    configureFloatTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      this.segmentTextureWidth,
      this.segmentTextureHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      styleTextureData
    );

    return {
      textureWidth: this.segmentTextureWidth,
      textureHeight: this.segmentTextureHeight,
      maxTextureSize
    };
  }

  private initializeGeometry(): void {
    const gl = this.gl;

    gl.bindVertexArray(this.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    const corners = new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      1, 1
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.vertexAttribDivisor(0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.allSegmentIdBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 4, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.bindVertexArray(null);
  }

  private initializeState(): void {
    const gl = this.gl;

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const pixelX = (clientX - rect.left) * dpr;
    const pixelY = (rect.bottom - clientY) * dpr;

    return {
      x: (pixelX - this.canvas.width * 0.5) / this.zoom + this.cameraCenterX,
      y: (pixelY - this.canvas.height * 0.5) / this.zoom + this.cameraCenterY
    };
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;

    const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);

    const program = gl.createProgram();
    if (!program) {
      throw new Error("Unable to create WebGL program.");
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    const linkStatus = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!linkStatus) {
      const error = gl.getProgramInfoLog(program) || "Unknown linker error.";
      gl.deleteProgram(program);
      throw new Error(`Program link failed: ${error}`);
    }

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    return program;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) {
      throw new Error("Unable to create shader.");
    }

    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    const status = this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS);
    if (!status) {
      const error = this.gl.getShaderInfoLog(shader) || "Unknown shader compiler error.";
      this.gl.deleteShader(shader);
      throw new Error(`Shader compilation failed: ${error}`);
    }

    return shader;
  }

  private createVertexArray(): WebGLVertexArrayObject {
    const vao = this.gl.createVertexArray();
    if (!vao) {
      throw new Error("Unable to create VAO.");
    }
    return vao;
  }

  private mustCreateBuffer(): WebGLBuffer {
    const buffer = this.gl.createBuffer();
    if (!buffer) {
      throw new Error("Unable to create WebGL buffer.");
    }
    return buffer;
  }

  private mustCreateTexture(): WebGLTexture {
    const texture = this.gl.createTexture();
    if (!texture) {
      throw new Error("Unable to create WebGL texture.");
    }
    return texture;
  }

  private mustGetUniformLocation(name: string): WebGLUniformLocation {
    const location = this.gl.getUniformLocation(this.program, name);
    if (!location) {
      throw new Error(`Missing uniform: ${name}`);
    }
    return location;
  }
}

function configureFloatTexture(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function clampToGrid(value: number, gridSize: number): number {
  if (value < 0) {
    return 0;
  }
  if (value >= gridSize) {
    return gridSize - 1;
  }
  return value;
}
