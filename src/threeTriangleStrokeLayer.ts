import * as THREE from "three";

import type { VectorScene } from "./pdfVectorExtractor";
import { buildSpatialGrid, type SpatialGrid } from "./spatialGrid";
import { configureStraightAlphaBlending } from "./threeMaterialBlending";
import { normalizeThreeRawShaderSource } from "./threeRawShaderColorSpace";
import type { ViewState } from "./webGlFloorplanRenderer";

interface TriangleStrokeLayerOptions {
  vectorOverride: [number, number, number, number];
}

interface ViewportPixels {
  width: number;
  height: number;
}

interface CullingBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const TRIANGLE_STROKE_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp sampler2D;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in float aSegmentIndex;

uniform sampler2D uSegmentTexA;
uniform sampler2D uSegmentTexB;
uniform sampler2D uSegmentStyleTex;
uniform ivec2 uSegmentTexSize;
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;
uniform float uLocalUnitsPerPixel;
uniform vec4 uVectorOverride;

out vec4 vColor;
out vec2 vStrokeCoord;
flat out float vAxisLength;
flat out float vHalfWidth;
flat out float vAAWorld;
flat out float vIsRoundCap;

ivec2 segmentCoord(int index) {
  int x = index % uSegmentTexSize.x;
  int y = index / uSegmentTexSize.x;
  return ivec2(x, y);
}

void main() {
  int index = int(aSegmentIndex + 0.5);
  vec4 primitiveA = texelFetch(uSegmentTexA, segmentCoord(index), 0);
  vec4 primitiveB = texelFetch(uSegmentTexB, segmentCoord(index), 0);
  vec4 style = texelFetch(uSegmentStyleTex, segmentCoord(index), 0);

  vec2 p0 = primitiveA.xy;
  vec2 p1 = primitiveB.xy;
  float packedStyle = primitiveB.w;
  float styleFlags = floor(packedStyle / 2.0 + 1e-6);
  float alpha = packedStyle - styleFlags * 2.0;
  bool isHairline = mod(styleFlags, 2.0) >= 0.5;
  bool isRoundCap = mod(floor(styleFlags * 0.5), 2.0) >= 0.5;

  vec2 axis = p1 - p0;
  float axisLen = length(axis);
  if ((axisLen <= 1e-6 && !isRoundCap) || alpha <= 0.001) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    vColor = vec4(0.0);
    vStrokeCoord = vec2(0.0);
    vAxisLength = 0.0;
    vHalfWidth = 0.0;
    vAAWorld = 1.0;
    vIsRoundCap = 0.0;
    return;
  }

  float localUnitsPerPixel = uUseLocalToClip >= 0.5
    ? max(uLocalUnitsPerPixel, 1e-6)
    : (1.0 / max(uZoom, 1e-4));
  float halfWidth = style.x;
  if (isHairline) {
    halfWidth = max(0.5 * localUnitsPerPixel, 1e-5);
  }

  float aaWorld = isHairline
    ? max(0.35 * localUnitsPerPixel, 5e-5)
    : max(localUnitsPerPixel, 0.0001);
  float extent = halfWidth + aaWorld;
  float capExtent = isRoundCap ? extent : aaWorld;
  vec2 tangent = axisLen > 1e-6 ? axis / axisLen : vec2(1.0, 0.0);
  vec2 normal = vec2(-tangent.y, tangent.x);
  float side01 = aCorner.x * 0.5 + 0.5;
  float lineCoord = mix(-capExtent, axisLen + capExtent, side01);
  float crossCoord = aCorner.y * extent;
  vec2 worldPosition = p0 + tangent * lineCoord + normal * crossCoord;

  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(worldPosition, 0.0, 1.0);
  } else {
    vec2 screen = (worldPosition - uCameraCenter) * uZoom + 0.5 * uViewport;
    vec2 clip = (screen / (0.5 * uViewport)) - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }

  vec3 color = mix(style.yzw, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
  vColor = vec4(color, alpha);
  vStrokeCoord = vec2(lineCoord, crossCoord);
  vAxisLength = axisLen;
  vHalfWidth = halfWidth;
  vAAWorld = aaWorld;
  vIsRoundCap = isRoundCap ? 1.0 : 0.0;
}
`;

const TRIANGLE_STROKE_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec4 vColor;
in vec2 vStrokeCoord;
flat in float vAxisLength;
flat in float vHalfWidth;
flat in float vAAWorld;
flat in float vIsRoundCap;
out vec4 outColor;

void main() {
  if (vColor.a <= 0.001) {
    discard;
  }

  float edgeDistance = abs(vStrokeCoord.y) - vHalfWidth;
  if (vIsRoundCap >= 0.5) {
    if (vStrokeCoord.x < 0.0) {
      edgeDistance = length(vStrokeCoord) - vHalfWidth;
    } else if (vStrokeCoord.x > vAxisLength) {
      edgeDistance = length(vec2(vStrokeCoord.x - vAxisLength, vStrokeCoord.y)) - vHalfWidth;
    }
  } else {
    edgeDistance = max(edgeDistance, max(-vStrokeCoord.x, vStrokeCoord.x - vAxisLength));
  }

  float coverage = 1.0 - smoothstep(-vAAWorld, vAAWorld, edgeDistance);
  float alpha = coverage * vColor.a;
  if (alpha <= 0.001) {
    discard;
  }
  outColor = vec4(vColor.rgb, alpha);
}
`;

export class ThreeTriangleStrokeLayer {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.RawShaderMaterial>;

  private readonly segmentTextureA: THREE.DataTexture;
  private readonly segmentTextureB: THREE.DataTexture;
  private readonly segmentStyleTexture: THREE.DataTexture;

  private readonly viewportUniform: THREE.Vector2;
  private readonly cameraCenterUniform: THREE.Vector2;
  private readonly zoomUniform: { value: number };
  private readonly useLocalToClipUniform: { value: number };
  private readonly localToClipUniform: THREE.Matrix4;
  private readonly localUnitsPerPixelUniform: { value: number };
  private readonly vectorOverrideUniform: THREE.Vector4;
  private readonly segmentCount: number;
  private readonly segmentIndexAttribute: THREE.InstancedBufferAttribute;
  private readonly allSegmentIds: Float32Array;
  private readonly visibleSegmentIds: Float32Array;
  private readonly grid: SpatialGrid | null;
  private readonly segmentMarks: Uint32Array;
  private readonly segmentMinX: Float32Array;
  private readonly segmentMinY: Float32Array;
  private readonly segmentMaxX: Float32Array;
  private readonly segmentMaxY: Float32Array;
  private readonly maxHalfWidth: number;
  private markToken = 1;
  private usingAllSegments = true;
  private useLocalToClip = false;

  constructor(scene: VectorScene, options: TriangleStrokeLayerOptions) {
    const segmentCount = Math.max(0, scene.segmentCount | 0);
    this.segmentCount = segmentCount;
    const segmentTextureSize = chooseSegmentTextureSize(segmentCount);

    this.segmentTextureA = createSegmentDataTexture(
      scene.endpoints,
      segmentCount,
      segmentTextureSize.width,
      segmentTextureSize.height
    );
    this.segmentTextureB = createSegmentDataTexture(
      scene.primitiveMeta,
      segmentCount,
      segmentTextureSize.width,
      segmentTextureSize.height
    );
    this.segmentStyleTexture = createSegmentDataTexture(
      scene.styles,
      segmentCount,
      segmentTextureSize.width,
      segmentTextureSize.height
    );

    this.grid = segmentCount > 0 ? buildSpatialGrid(scene) : null;
    this.segmentMarks = new Uint32Array(segmentCount);
    this.visibleSegmentIds = new Float32Array(Math.max(1, segmentCount));
    this.allSegmentIds = new Float32Array(Math.max(1, segmentCount));
    for (let i = 0; i < segmentCount; i += 1) {
      this.allSegmentIds[i] = i;
      this.visibleSegmentIds[i] = i;
    }
    const expandedBounds = buildExpandedSegmentBounds(scene, segmentCount);
    this.segmentMinX = expandedBounds.minX;
    this.segmentMinY = expandedBounds.minY;
    this.segmentMaxX = expandedBounds.maxX;
    this.segmentMaxY = expandedBounds.maxY;
    this.maxHalfWidth = Math.max(0, scene.maxHalfWidth);

    const geometry = createTriangleStrokeGeometry(this.visibleSegmentIds, segmentCount);
    this.segmentIndexAttribute = geometry.getAttribute("aSegmentIndex") as THREE.InstancedBufferAttribute;
    this.viewportUniform = new THREE.Vector2(1, 1);
    this.cameraCenterUniform = new THREE.Vector2();
    this.zoomUniform = { value: 1 };
    this.useLocalToClipUniform = { value: 0 };
    this.localToClipUniform = new THREE.Matrix4();
    this.localUnitsPerPixelUniform = { value: 1 };
    this.vectorOverrideUniform = new THREE.Vector4(
      options.vectorOverride[0],
      options.vectorOverride[1],
      options.vectorOverride[2],
      options.vectorOverride[3]
    );

    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: normalizeThreeRawShaderSource(TRIANGLE_STROKE_VERTEX_SHADER_SOURCE),
      fragmentShader: normalizeThreeRawShaderSource(TRIANGLE_STROKE_FRAGMENT_SHADER_SOURCE, true),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      uniforms: {
        uSegmentTexA: { value: this.segmentTextureA },
        uSegmentTexB: { value: this.segmentTextureB },
        uSegmentStyleTex: { value: this.segmentStyleTexture },
        uSegmentTexSize: {
          value: new Int32Array([segmentTextureSize.width, segmentTextureSize.height])
        },
        uViewport: { value: this.viewportUniform },
        uCameraCenter: { value: this.cameraCenterUniform },
        uZoom: this.zoomUniform,
        uUseLocalToClip: this.useLocalToClipUniform,
        uLocalToClip: { value: this.localToClipUniform },
        uLocalUnitsPerPixel: this.localUnitsPerPixelUniform,
        uVectorOverride: { value: this.vectorOverrideUniform }
      }
    });
    configureStraightAlphaBlending(material);

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  getRenderedSegmentCount(): number {
    if (!this.mesh.visible) {
      return 0;
    }
    return Math.max(0, this.mesh.geometry.instanceCount ?? 0);
  }

  setVectorOverride(red: number, green: number, blue: number, opacity: number): void {
    this.vectorOverrideUniform.set(red, green, blue, opacity);
  }

  setScreenSpaceTransform(): void {
    this.useLocalToClip = false;
    this.useLocalToClipUniform.value = 0;
  }

  setLocalToClipTransform(localToClip: THREE.Matrix4, localUnitsPerPixel: number): void {
    this.useLocalToClip = true;
    this.useLocalToClipUniform.value = 1;
    this.localToClipUniform.copy(localToClip);
    this.localUnitsPerPixelUniform.value =
      Number.isFinite(localUnitsPerPixel) && localUnitsPerPixel > 1e-8
        ? localUnitsPerPixel
        : 1;
  }

  updateFrame(viewState: ViewState, viewport: ViewportPixels, cullingBounds?: CullingBounds | null): void {
    this.viewportUniform.set(Math.max(1, viewport.width), Math.max(1, viewport.height));
    this.cameraCenterUniform.set(viewState.cameraCenterX, viewState.cameraCenterY);
    this.zoomUniform.value = Math.max(1e-6, viewState.zoom);
    this.updateVisibleSegments(viewState, viewport, cullingBounds);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.segmentTextureA.dispose();
    this.segmentTextureB.dispose();
    this.segmentStyleTexture.dispose();
  }

  private updateVisibleSegments(
    viewState: ViewState,
    viewport: ViewportPixels,
    cullingBounds?: CullingBounds | null
  ): void {
    const outCount = this.collectVisibleSegments(viewState, viewport, cullingBounds, true);
    if (outCount >= 0) {
      this.usingAllSegments = false;
      this.mesh.geometry.instanceCount = outCount;
      this.segmentIndexAttribute.addUpdateRange(0, outCount);
      this.segmentIndexAttribute.needsUpdate = true;
    }
  }

  private collectVisibleSegments(
    viewState: ViewState,
    viewport: ViewportPixels,
    cullingBounds: CullingBounds | null | undefined,
    writeVisibleIds: boolean
  ): number {
    if (this.useLocalToClip && !cullingBounds) {
      if (writeVisibleIds) {
        this.setAllSegmentsVisible();
      }
      return -1;
    }

    if (!this.grid || this.segmentCount <= 0) {
      if (writeVisibleIds) {
        this.setAllSegmentsVisible();
        return -1;
      }
      return this.segmentCount;
    }

    const safeZoom = Math.max(1e-6, viewState.zoom);
    const halfViewWidth = Math.max(1, viewport.width) / (2 * safeZoom);
    const halfViewHeight = Math.max(1, viewport.height) / (2 * safeZoom);
    const margin = Math.max(16 / safeZoom, this.maxHalfWidth * 2, 0.5);

    const viewMinX = cullingBounds
      ? cullingBounds.minX - margin
      : viewState.cameraCenterX - halfViewWidth - margin;
    const viewMaxX = cullingBounds
      ? cullingBounds.maxX + margin
      : viewState.cameraCenterX + halfViewWidth + margin;
    const viewMinY = cullingBounds
      ? cullingBounds.minY - margin
      : viewState.cameraCenterY - halfViewHeight - margin;
    const viewMaxY = cullingBounds
      ? cullingBounds.maxY + margin
      : viewState.cameraCenterY + halfViewHeight + margin;
    const grid = this.grid;

    if (
      viewMinX <= grid.minX &&
      viewMaxX >= grid.maxX &&
      viewMinY <= grid.minY &&
      viewMaxY >= grid.maxY
    ) {
      if (writeVisibleIds) {
        this.setAllSegmentsVisible();
        return -1;
      }
      return this.segmentCount;
    }

    const c0 = clampToGrid(Math.floor((viewMinX - grid.minX) / grid.cellWidth), grid.gridWidth);
    const c1 = clampToGrid(Math.floor((viewMaxX - grid.minX) / grid.cellWidth), grid.gridWidth);
    const r0 = clampToGrid(Math.floor((viewMinY - grid.minY) / grid.cellHeight), grid.gridHeight);
    const r1 = clampToGrid(Math.floor((viewMaxY - grid.minY) / grid.cellHeight), grid.gridHeight);

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

          if (writeVisibleIds) {
            this.visibleSegmentIds[outCount] = segmentIndex;
          }
          outCount += 1;
        }
        cellIndex += 1;
      }
    }
    return outCount;
  }

  private setAllSegmentsVisible(): void {
    if (!this.usingAllSegments) {
      this.visibleSegmentIds.set(this.allSegmentIds.subarray(0, this.segmentCount), 0);
      this.segmentIndexAttribute.addUpdateRange(0, this.segmentCount);
      this.segmentIndexAttribute.needsUpdate = true;
    }
    this.usingAllSegments = true;
    this.mesh.geometry.instanceCount = this.segmentCount;
  }
}

function chooseSegmentTextureSize(segmentCount: number): { width: number; height: number } {
  if (segmentCount <= 0) {
    return { width: 1, height: 1 };
  }

  const width = Math.max(1, Math.ceil(Math.sqrt(segmentCount)));
  const height = Math.max(1, Math.ceil(segmentCount / width));
  return { width, height };
}

function createSegmentDataTexture(
  source: Float32Array,
  count: number,
  width: number,
  height: number
): THREE.DataTexture {
  const data = new Float32Array(width * height * 4);
  const sourceLength = Math.min(source.length, count * 4);
  if (sourceLength > 0) {
    data.set(source.subarray(0, sourceLength), 0);
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createTriangleStrokeGeometry(segmentIds: Float32Array, segmentCount: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  const corners = new Float32Array([
    -1, -1,
    1, -1,
    1, 1,
    -1, 1
  ]);
  geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute(corners, 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

  const segmentIndexAttribute = new THREE.InstancedBufferAttribute(segmentIds, 1);
  segmentIndexAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aSegmentIndex", segmentIndexAttribute);
  geometry.instanceCount = Math.max(0, segmentCount | 0);
  return geometry;
}

function buildExpandedSegmentBounds(scene: VectorScene, segmentCount: number): {
  minX: Float32Array;
  minY: Float32Array;
  maxX: Float32Array;
  maxY: Float32Array;
} {
  const minX = new Float32Array(segmentCount);
  const minY = new Float32Array(segmentCount);
  const maxX = new Float32Array(segmentCount);
  const maxY = new Float32Array(segmentCount);

  for (let i = 0; i < segmentCount; i += 1) {
    const primitiveBoundsOffset = i * 4;
    const styleOffset = i * 4;
    const margin = (scene.styles[styleOffset] ?? 0) + 0.35;

    minX[i] = scene.primitiveBounds[primitiveBoundsOffset] - margin;
    minY[i] = scene.primitiveBounds[primitiveBoundsOffset + 1] - margin;
    maxX[i] = scene.primitiveBounds[primitiveBoundsOffset + 2] + margin;
    maxY[i] = scene.primitiveBounds[primitiveBoundsOffset + 3] + margin;
  }

  return { minX, minY, maxX, maxY };
}

function clampToGrid(value: number, side: number): number {
  if (side <= 1) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value >= side) {
    return side - 1;
  }
  return value;
}
