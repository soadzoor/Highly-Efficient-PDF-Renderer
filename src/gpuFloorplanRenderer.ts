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

out vec2 vLocal;
out float vHalfLength;
out float vHalfWidth;
out float vAAWorld;
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
    vLocal = vec2(0.0);
    vHalfLength = 0.0;
    vHalfWidth = 0.0;
    vAAWorld = 1.0;
    vLuma = luma;
    vAlpha = 0.0;
    return;
  }

  vec2 tangent = delta / lengthValue;
  vec2 normal = vec2(-tangent.y, tangent.x);
  float halfLength = 0.5 * lengthValue;

  float aaWorld = max(1.0 / uZoom, 0.0001) * uAAScreenPx;
  float halfExtentNormal = halfWidth + aaWorld;
  float halfExtentTangent = halfLength + halfExtentNormal;
  vec2 local = vec2(aCorner.x * halfExtentTangent, aCorner.y * halfExtentNormal);

  vec2 center = 0.5 * (p0 + p1);
  vec2 worldPosition = center + tangent * local.x + normal * local.y;

  vec2 screen = (worldPosition - uCameraCenter) * uZoom + 0.5 * uViewport;
  vec2 clip = (screen / (0.5 * uViewport)) - 1.0;

  gl_Position = vec4(clip, 0.0, 1.0);

  vLocal = local;
  vHalfLength = halfLength;
  vHalfWidth = halfWidth;
  vAAWorld = aaWorld;
  vLuma = luma;
  vAlpha = alpha;
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vHalfLength;
in float vHalfWidth;
in float vAAWorld;
in float vLuma;
in float vAlpha;

out vec4 outColor;

void main() {
  if (vAlpha <= 0.001) {
    discard;
  }

  float dx = max(abs(vLocal.x) - vHalfLength, 0.0);
  float dy = abs(vLocal.y);
  float distanceToSegment = length(vec2(dx, dy));

  float coverage = 1.0 - smoothstep(vHalfWidth - vAAWorld, vHalfWidth + vAAWorld, distanceToSegment);
  float alpha = coverage * vAlpha;

  if (alpha <= 0.001) {
    discard;
  }

  vec3 color = vec3(vLuma);
  outColor = vec4(color, alpha);
}
`;

const BLIT_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;

void main() {
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`;

const BLIT_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D uCacheTex;
uniform vec2 uViewportPx;
uniform vec2 uCacheSizePx;
uniform vec2 uOffsetPx;

out vec4 outColor;

void main() {
  vec2 base = 0.5 * (uCacheSizePx - uViewportPx);
  vec2 samplePx = gl_FragCoord.xy + base + uOffsetPx;
  vec2 uv = samplePx / uCacheSizePx;

  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    outColor = vec4(1.0);
    return;
  }

  outColor = texture(uCacheTex, uv);
}
`;

const INTERACTION_DECAY_MS = 140;
const FULL_VIEW_FALLBACK_THRESHOLD = 0.92;
const PAN_CACHE_MIN_SEGMENTS = 300_000;
const PAN_CACHE_OVERSCAN_FACTOR = 1.8;
const PAN_CACHE_BORDER_PX = 96;
const PAN_CACHE_ZOOM_EPSILON = 1e-5;

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

  private readonly segmentProgram: WebGLProgram;

  private readonly blitProgram: WebGLProgram;

  private readonly segmentVao: WebGLVertexArrayObject;

  private readonly blitVao: WebGLVertexArrayObject;

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

  private readonly uCacheTex: WebGLUniformLocation;

  private readonly uViewportPx: WebGLUniformLocation;

  private readonly uCacheSizePx: WebGLUniformLocation;

  private readonly uOffsetPx: WebGLUniformLocation;

  private scene: VectorScene | null = null;

  private grid: SpatialGrid | null = null;

  private sceneStats: SceneStats | null = null;

  private allSegmentIds = new Float32Array(0);

  private visibleSegmentIds = new Float32Array(0);

  private segmentMarks = new Uint32Array(0);

  private segmentMinX = new Float32Array(0);

  private segmentMinY = new Float32Array(0);

  private segmentMaxX = new Float32Array(0);

  private segmentMaxY = new Float32Array(0);

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

  private lastInteractionTime = Number.NEGATIVE_INFINITY;

  private isPanInteracting = false;

  private panCacheTexture: WebGLTexture | null = null;

  private panCacheFramebuffer: WebGLFramebuffer | null = null;

  private panCacheWidth = 0;

  private panCacheHeight = 0;

  private panCacheValid = false;

  private panCacheCenterX = 0;

  private panCacheCenterY = 0;

  private panCacheZoom = 1;

  private panCacheRenderedSegments = 0;

  private panCacheUsedCulling = false;

  private panOptimizationEnabled = true;

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

    this.segmentProgram = this.createProgram(VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
    this.blitProgram = this.createProgram(BLIT_VERTEX_SHADER_SOURCE, BLIT_FRAGMENT_SHADER_SOURCE);

    this.segmentVao = this.createVertexArray();
    this.blitVao = this.createVertexArray();

    this.cornerBuffer = this.mustCreateBuffer();
    this.allSegmentIdBuffer = this.mustCreateBuffer();
    this.visibleSegmentIdBuffer = this.mustCreateBuffer();

    this.segmentTextureA = this.mustCreateTexture();
    this.segmentTextureB = this.mustCreateTexture();

    this.uSegmentTexA = this.mustGetUniformLocation(this.segmentProgram, "uSegmentTexA");
    this.uSegmentTexB = this.mustGetUniformLocation(this.segmentProgram, "uSegmentTexB");
    this.uSegmentTexSize = this.mustGetUniformLocation(this.segmentProgram, "uSegmentTexSize");
    this.uViewport = this.mustGetUniformLocation(this.segmentProgram, "uViewport");
    this.uCameraCenter = this.mustGetUniformLocation(this.segmentProgram, "uCameraCenter");
    this.uZoom = this.mustGetUniformLocation(this.segmentProgram, "uZoom");
    this.uAAScreenPx = this.mustGetUniformLocation(this.segmentProgram, "uAAScreenPx");

    this.uCacheTex = this.mustGetUniformLocation(this.blitProgram, "uCacheTex");
    this.uViewportPx = this.mustGetUniformLocation(this.blitProgram, "uViewportPx");
    this.uCacheSizePx = this.mustGetUniformLocation(this.blitProgram, "uCacheSizePx");
    this.uOffsetPx = this.mustGetUniformLocation(this.blitProgram, "uOffsetPx");

    this.initializeGeometry();
    this.initializeState();
  }

  setFrameListener(listener: FrameListener | null): void {
    this.frameListener = listener;
  }

  setPanOptimizationEnabled(enabled: boolean): void {
    const nextEnabled = Boolean(enabled);
    if (this.panOptimizationEnabled === nextEnabled) {
      return;
    }

    this.panOptimizationEnabled = nextEnabled;
    this.isPanInteracting = false;
    this.panCacheValid = false;

    if (!this.panOptimizationEnabled) {
      this.destroyPanCacheResources();
    }

    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  beginPanInteraction(): void {
    this.isPanInteracting = true;
    this.markInteraction();
  }

  endPanInteraction(): void {
    this.isPanInteracting = false;
    this.markInteraction();
    this.needsVisibleSetUpdate = true;
    this.requestFrame();
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

    this.destroyPanCacheResources();
    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  setScene(scene: VectorScene): SceneStats {
    this.scene = scene;
    this.segmentCount = scene.segmentCount;
    this.buildSegmentBounds(scene);
    this.isPanInteracting = false;
    this.panCacheValid = false;

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
    this.isPanInteracting = false;

    this.panCacheValid = false;
    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  panByPixels(deltaX: number, deltaY: number): void {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      return;
    }

    this.markInteraction();
    this.cameraCenterX -= deltaX / this.zoom;
    this.cameraCenterY += deltaY / this.zoom;

    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  zoomAtClientPoint(clientX: number, clientY: number, zoomFactor: number): void {
    const clampedFactor = clamp(zoomFactor, 0.1, 10);
    this.isPanInteracting = false;
    this.markInteraction();
    const before = this.clientToWorld(clientX, clientY);

    const nextZoom = clamp(this.zoom * clampedFactor, this.minZoom, this.maxZoom);
    this.zoom = nextZoom;

    const after = this.clientToWorld(clientX, clientY);

    this.cameraCenterX += before.x - after.x;
    this.cameraCenterY += before.y - after.y;

    this.panCacheValid = false;
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

    if (!this.scene || this.segmentCount === 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(1, 1, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      this.frameListener?.({
        renderedSegments: 0,
        totalSegments: 0,
        usedCulling: false,
        zoom: this.zoom
      });
      return;
    }

    if (this.shouldUsePanCache()) {
      this.renderWithPanCache();
      return;
    }

    this.renderDirectToScreen();
  }

  private shouldUsePanCache(): boolean {
    return this.panOptimizationEnabled && this.isPanInteracting && this.segmentCount >= PAN_CACHE_MIN_SEGMENTS;
  }

  private renderDirectToScreen(): void {
    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (this.needsVisibleSetUpdate) {
      this.updateVisibleSet(this.cameraCenterX, this.cameraCenterY, this.canvas.width, this.canvas.height);
      this.needsVisibleSetUpdate = false;
    }

    const instanceCount = this.drawVisibleSegments(this.canvas.width, this.canvas.height, this.cameraCenterX, this.cameraCenterY);

    this.frameListener?.({
      renderedSegments: instanceCount,
      totalSegments: this.segmentCount,
      usedCulling: !this.usingAllSegments,
      zoom: this.zoom
    });
  }

  private renderWithPanCache(): void {
    if (!this.ensurePanCacheResources()) {
      this.renderDirectToScreen();
      return;
    }

    let offsetPxX = (this.cameraCenterX - this.panCacheCenterX) * this.zoom;
    let offsetPxY = (this.cameraCenterY - this.panCacheCenterY) * this.zoom;

    const maxOffsetX = Math.max(0, (this.panCacheWidth - this.canvas.width) * 0.5 - 2);
    const maxOffsetY = Math.max(0, (this.panCacheHeight - this.canvas.height) * 0.5 - 2);

    const zoomChanged = Math.abs(this.panCacheZoom - this.zoom) > PAN_CACHE_ZOOM_EPSILON;
    const cacheOutOfCoverage = Math.abs(offsetPxX) > maxOffsetX || Math.abs(offsetPxY) > maxOffsetY;
    const needsCacheRefresh = !this.panCacheValid || zoomChanged || cacheOutOfCoverage;

    if (needsCacheRefresh) {
      this.panCacheCenterX = this.cameraCenterX;
      this.panCacheCenterY = this.cameraCenterY;
      this.panCacheZoom = this.zoom;

      this.updateVisibleSet(this.panCacheCenterX, this.panCacheCenterY, this.panCacheWidth, this.panCacheHeight);
      this.needsVisibleSetUpdate = false;

      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.panCacheFramebuffer);
      gl.viewport(0, 0, this.panCacheWidth, this.panCacheHeight);
      gl.clearColor(1, 1, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      this.panCacheRenderedSegments = this.drawVisibleSegments(
        this.panCacheWidth,
        this.panCacheHeight,
        this.panCacheCenterX,
        this.panCacheCenterY
      );
      this.panCacheUsedCulling = !this.usingAllSegments;
      this.panCacheValid = true;

      offsetPxX = 0;
      offsetPxY = 0;
    }

    this.blitPanCache(offsetPxX, offsetPxY);

    this.frameListener?.({
      renderedSegments: this.panCacheRenderedSegments,
      totalSegments: this.segmentCount,
      usedCulling: this.panCacheUsedCulling,
      zoom: this.zoom
    });
  }

  private drawVisibleSegments(
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number
  ): number {
    const instanceCount = this.usingAllSegments ? this.segmentCount : this.visibleSegmentCount;
    if (instanceCount === 0) {
      return 0;
    }

    const gl = this.gl;

    gl.useProgram(this.segmentProgram);
    gl.bindVertexArray(this.segmentVao);

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
    gl.uniform2f(this.uViewport, viewportWidth, viewportHeight);
    gl.uniform2f(this.uCameraCenter, cameraCenterX, cameraCenterY);
    gl.uniform1f(this.uZoom, this.zoom);
    gl.uniform1f(this.uAAScreenPx, 1);

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instanceCount);

    return instanceCount;
  }

  private blitPanCache(offsetPxX: number, offsetPxY: number): void {
    if (!this.panCacheTexture) {
      return;
    }

    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.blitProgram);
    gl.bindVertexArray(this.blitVao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.panCacheTexture);

    gl.uniform1i(this.uCacheTex, 0);
    gl.uniform2f(this.uViewportPx, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uCacheSizePx, this.panCacheWidth, this.panCacheHeight);
    gl.uniform2f(this.uOffsetPx, offsetPxX, offsetPxY);

    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
  }

  private ensurePanCacheResources(): boolean {
    const gl = this.gl;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

    const desiredWidth = Math.min(
      maxTextureSize,
      Math.max(this.canvas.width + PAN_CACHE_BORDER_PX * 2, Math.ceil(this.canvas.width * PAN_CACHE_OVERSCAN_FACTOR))
    );
    const desiredHeight = Math.min(
      maxTextureSize,
      Math.max(this.canvas.height + PAN_CACHE_BORDER_PX * 2, Math.ceil(this.canvas.height * PAN_CACHE_OVERSCAN_FACTOR))
    );

    if (desiredWidth < this.canvas.width || desiredHeight < this.canvas.height) {
      return false;
    }

    if (
      this.panCacheTexture &&
      this.panCacheFramebuffer &&
      this.panCacheWidth === desiredWidth &&
      this.panCacheHeight === desiredHeight
    ) {
      return true;
    }

    this.destroyPanCacheResources();

    const texture = gl.createTexture();
    if (!texture) {
      return false;
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    configureColorTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, desiredWidth, desiredHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) {
      gl.deleteTexture(texture);
      return false;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      return false;
    }

    this.panCacheTexture = texture;
    this.panCacheFramebuffer = framebuffer;
    this.panCacheWidth = desiredWidth;
    this.panCacheHeight = desiredHeight;
    this.panCacheValid = false;

    return true;
  }

  private destroyPanCacheResources(): void {
    if (this.panCacheFramebuffer) {
      this.gl.deleteFramebuffer(this.panCacheFramebuffer);
      this.panCacheFramebuffer = null;
    }

    if (this.panCacheTexture) {
      this.gl.deleteTexture(this.panCacheTexture);
      this.panCacheTexture = null;
    }

    this.panCacheWidth = 0;
    this.panCacheHeight = 0;
    this.panCacheValid = false;
    this.panCacheRenderedSegments = 0;
    this.panCacheUsedCulling = false;
  }

  private updateVisibleSet(
    viewCenterX: number = this.cameraCenterX,
    viewCenterY: number = this.cameraCenterY,
    viewportWidthPx: number = this.canvas.width,
    viewportHeightPx: number = this.canvas.height
  ): void {
    if (!this.scene || !this.grid) {
      this.visibleSegmentCount = 0;
      this.usingAllSegments = true;
      return;
    }

    const grid = this.grid;

    const halfViewWidth = viewportWidthPx / (2 * this.zoom);
    const halfViewHeight = viewportHeightPx / (2 * this.zoom);

    const margin = Math.max(16 / this.zoom, this.scene.maxHalfWidth * 2);

    const viewMinX = viewCenterX - halfViewWidth - margin;
    const viewMaxX = viewCenterX + halfViewWidth + margin;
    const viewMinY = viewCenterY - halfViewHeight - margin;
    const viewMaxY = viewCenterY + halfViewHeight + margin;

    const c0 = clampToGrid(Math.floor((viewMinX - grid.minX) / grid.cellWidth), grid.gridWidth);
    const c1 = clampToGrid(Math.floor((viewMaxX - grid.minX) / grid.cellWidth), grid.gridWidth);
    const r0 = clampToGrid(Math.floor((viewMinY - grid.minY) / grid.cellHeight), grid.gridHeight);
    const r1 = clampToGrid(Math.floor((viewMaxY - grid.minY) / grid.cellHeight), grid.gridHeight);

    const visibleCellCount = (c1 - c0 + 1) * (r1 - r0 + 1);
    const totalCellCount = grid.gridWidth * grid.gridHeight;

    if (!this.isInteractionActive() && visibleCellCount >= totalCellCount * FULL_VIEW_FALLBACK_THRESHOLD) {
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

          if (
            this.segmentMaxX[segmentIndex] < viewMinX ||
            this.segmentMinX[segmentIndex] > viewMaxX ||
            this.segmentMaxY[segmentIndex] < viewMinY ||
            this.segmentMinY[segmentIndex] > viewMaxY
          ) {
            continue;
          }

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

  private buildSegmentBounds(scene: VectorScene): void {
    if (this.segmentMinX.length < this.segmentCount) {
      this.segmentMinX = new Float32Array(this.segmentCount);
      this.segmentMinY = new Float32Array(this.segmentCount);
      this.segmentMaxX = new Float32Array(this.segmentCount);
      this.segmentMaxY = new Float32Array(this.segmentCount);
    }

    for (let i = 0; i < this.segmentCount; i += 1) {
      const endpointOffset = i * 4;
      const styleOffset = i * 4;
      const x0 = scene.endpoints[endpointOffset];
      const y0 = scene.endpoints[endpointOffset + 1];
      const x1 = scene.endpoints[endpointOffset + 2];
      const y1 = scene.endpoints[endpointOffset + 3];
      const margin = scene.styles[styleOffset] + 0.35;

      this.segmentMinX[i] = Math.min(x0, x1) - margin;
      this.segmentMinY[i] = Math.min(y0, y1) - margin;
      this.segmentMaxX[i] = Math.max(x0, x1) + margin;
      this.segmentMaxY[i] = Math.max(y0, y1) + margin;
    }
  }

  private markInteraction(): void {
    this.lastInteractionTime = performance.now();
  }

  private isInteractionActive(): boolean {
    return performance.now() - this.lastInteractionTime <= INTERACTION_DECAY_MS;
  }

  private initializeGeometry(): void {
    const gl = this.gl;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    const corners = new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      1, 1
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);

    gl.bindVertexArray(this.segmentVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.vertexAttribDivisor(0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.allSegmentIdBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 4, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.bindVertexArray(this.blitVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.vertexAttribDivisor(0, 0);

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

  private mustGetUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation {
    const location = this.gl.getUniformLocation(program, name);
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

function configureColorTexture(gl: WebGL2RenderingContext): void {
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
