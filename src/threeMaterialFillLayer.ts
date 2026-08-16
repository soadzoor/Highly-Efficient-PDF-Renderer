import * as THREE from "three";

import type { VectorScene } from "./pdfVectorExtractor";
import {
  CORE_FILL_FRAGMENT_SHADER_SOURCE,
  CORE_FILL_VERTEX_SHADER_SOURCE
} from "./coreShaders";
import { configureStraightAlphaBlending } from "./threeMaterialBlending";
import { HEPR_THREE_LAYER_ORDER_FILL } from "./threeLayerOrder";
import { normalizeThreeRawShaderSource } from "./threeRawShaderColorSpace";
import { createThreeWebGpuFillMaterial, type ThreeWebGpuFillMaterialState } from "./threeWebGpuFillMaterial";
import type { ViewState } from "./webGlFloorplanRenderer";

interface FillLayerOptions {
  materialBackend?: "webgl" | "webgpu";
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

export class ThreeMaterialFillLayer {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;

  private readonly fillPathMetaTextureA: THREE.DataTexture;
  private readonly fillPathMetaTextureB: THREE.DataTexture;
  private readonly fillPathMetaTextureC: THREE.DataTexture;
  private readonly fillSegmentTextureA: THREE.DataTexture;
  private readonly fillSegmentTextureB: THREE.DataTexture;

  private readonly viewportUniform: THREE.Vector2;
  private readonly cameraCenterUniform: THREE.Vector2;
  private readonly zoomUniform: { value: number };
  private readonly useLocalToClipUniform: { value: number };
  private readonly localToClipUniform: THREE.Matrix4;
  private readonly vectorOverrideUniform: THREE.Vector4;
  private readonly fillPathCount: number;
  private readonly fillPathIndexAttribute: THREE.InstancedBufferAttribute;
  private readonly allFillPathIds: Float32Array;
  private readonly visibleFillPathIds: Float32Array;
  private readonly fillMinX: Float32Array;
  private readonly fillMinY: Float32Array;
  private readonly fillMaxX: Float32Array;
  private readonly fillMaxY: Float32Array;
  private readonly sceneMinX: number;
  private readonly sceneMinY: number;
  private readonly sceneMaxX: number;
  private readonly sceneMaxY: number;
  private webGpuState: ThreeWebGpuFillMaterialState | null = null;
  private usingAllFillPaths = true;
  private useLocalToClip = false;

  constructor(scene: VectorScene, options: FillLayerOptions) {
    const fillPathCount = Math.max(0, scene.fillPathCount | 0);
    const fillSegmentCount = Math.max(0, scene.fillSegmentCount | 0);
    this.fillPathCount = fillPathCount;
    const pathTextureSize = chooseTextureSize(fillPathCount);
    const segmentTextureSize = chooseTextureSize(fillSegmentCount);

    this.fillPathMetaTextureA = createFloatTexture(
      scene.fillPathMetaA,
      fillPathCount,
      pathTextureSize.width,
      pathTextureSize.height
    );
    this.fillPathMetaTextureB = createFloatTexture(
      scene.fillPathMetaB,
      fillPathCount,
      pathTextureSize.width,
      pathTextureSize.height
    );
    this.fillPathMetaTextureC = createFloatTexture(
      scene.fillPathMetaC,
      fillPathCount,
      pathTextureSize.width,
      pathTextureSize.height
    );
    this.fillSegmentTextureA = createFloatTexture(
      scene.fillSegmentsA,
      fillSegmentCount,
      segmentTextureSize.width,
      segmentTextureSize.height
    );
    this.fillSegmentTextureB = createFloatTexture(
      scene.fillSegmentsB,
      fillSegmentCount,
      segmentTextureSize.width,
      segmentTextureSize.height
    );

    this.visibleFillPathIds = new Float32Array(Math.max(1, fillPathCount));
    this.allFillPathIds = new Float32Array(Math.max(1, fillPathCount));
    for (let i = 0; i < fillPathCount; i += 1) {
      this.visibleFillPathIds[i] = i;
      this.allFillPathIds[i] = i;
    }
    const fillBounds = buildFillPathBounds(scene, fillPathCount);
    this.fillMinX = fillBounds.minX;
    this.fillMinY = fillBounds.minY;
    this.fillMaxX = fillBounds.maxX;
    this.fillMaxY = fillBounds.maxY;
    this.sceneMinX = fillBounds.sceneMinX;
    this.sceneMinY = fillBounds.sceneMinY;
    this.sceneMaxX = fillBounds.sceneMaxX;
    this.sceneMaxY = fillBounds.sceneMaxY;

    const geometry = createFillGeometry(this.visibleFillPathIds, fillPathCount);
    this.fillPathIndexAttribute = geometry.getAttribute("aFillPathIndex") as THREE.InstancedBufferAttribute;
    this.viewportUniform = new THREE.Vector2(1, 1);
    this.cameraCenterUniform = new THREE.Vector2();
    this.zoomUniform = { value: 1 };
    this.useLocalToClipUniform = { value: 0 };
    this.localToClipUniform = new THREE.Matrix4();
    this.vectorOverrideUniform = new THREE.Vector4(
      options.vectorOverride[0],
      options.vectorOverride[1],
      options.vectorOverride[2],
      options.vectorOverride[3]
    );

    let material: THREE.Material;
    if ((options.materialBackend ?? "webgl") === "webgpu") {
      const state = createThreeWebGpuFillMaterial({
        fillPathMetaTextureA: this.fillPathMetaTextureA,
        fillPathMetaTextureB: this.fillPathMetaTextureB,
        fillPathMetaTextureC: this.fillPathMetaTextureC,
        fillSegmentTextureA: this.fillSegmentTextureA,
        fillSegmentTextureB: this.fillSegmentTextureB,
        fillPathTextureWidth: pathTextureSize.width,
        fillSegmentTextureWidth: segmentTextureSize.width,
        viewport: this.viewportUniform,
        cameraCenter: this.cameraCenterUniform,
        localToClip: this.localToClipUniform,
        vectorOverride: this.vectorOverrideUniform
      });
      state.zoomUniform.value = this.zoomUniform.value;
      state.useLocalToClipUniform.value = this.useLocalToClipUniform.value;
      this.webGpuState = state;
      material = state.material;
    } else {
      material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: normalizeThreeRawShaderSource(CORE_FILL_VERTEX_SHADER_SOURCE),
        fragmentShader: normalizeThreeRawShaderSource(CORE_FILL_FRAGMENT_SHADER_SOURCE, true),
        transparent: false,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        uniforms: {
          uFillPathMetaTexA: { value: this.fillPathMetaTextureA },
          uFillPathMetaTexB: { value: this.fillPathMetaTextureB },
          uFillPathMetaTexC: { value: this.fillPathMetaTextureC },
          uFillSegmentTexA: { value: this.fillSegmentTextureA },
          uFillSegmentTexB: { value: this.fillSegmentTextureB },
          uFillPathMetaTexSize: {
            value: new Int32Array([pathTextureSize.width, pathTextureSize.height])
          },
          uFillSegmentTexSize: {
            value: new Int32Array([segmentTextureSize.width, segmentTextureSize.height])
          },
          uViewport: { value: this.viewportUniform },
          uCameraCenter: { value: this.cameraCenterUniform },
          uZoom: this.zoomUniform,
          uUseLocalToClip: this.useLocalToClipUniform,
          uLocalToClip: { value: this.localToClipUniform },
          uFillAAScreenPx: { value: 1.0 },
          uVectorOverride: { value: this.vectorOverrideUniform }
        }
      });
    }
    configureStraightAlphaBlending(material);

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = HEPR_THREE_LAYER_ORDER_FILL;
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  setVectorOverride(red: number, green: number, blue: number, opacity: number): void {
    this.vectorOverrideUniform.set(red, green, blue, opacity);
  }

  setScreenSpaceTransform(): void {
    this.useLocalToClip = false;
    this.useLocalToClipUniform.value = 0;
    if (this.webGpuState) {
      this.webGpuState.useLocalToClipUniform.value = 0;
    }
  }

  setLocalToClipTransform(localToClip: THREE.Matrix4): void {
    this.useLocalToClip = true;
    this.useLocalToClipUniform.value = 1;
    this.localToClipUniform.copy(localToClip);
    if (this.webGpuState) {
      this.webGpuState.useLocalToClipUniform.value = 1;
    }
  }

  updateFrame(viewState: ViewState, viewport: ViewportPixels, cullingBounds?: CullingBounds | null): void {
    this.viewportUniform.set(Math.max(1, viewport.width), Math.max(1, viewport.height));
    this.cameraCenterUniform.set(viewState.cameraCenterX, viewState.cameraCenterY);
    this.zoomUniform.value = Math.max(1e-6, viewState.zoom);
    if (this.webGpuState) {
      this.webGpuState.zoomUniform.value = this.zoomUniform.value;
    }
    this.updateVisibleFillPaths(viewState, viewport, cullingBounds);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.fillPathMetaTextureA.dispose();
    this.fillPathMetaTextureB.dispose();
    this.fillPathMetaTextureC.dispose();
    this.fillSegmentTextureA.dispose();
    this.fillSegmentTextureB.dispose();
  }

  private updateVisibleFillPaths(
    viewState: ViewState,
    viewport: ViewportPixels,
    cullingBounds?: CullingBounds | null
  ): void {
    if (this.useLocalToClip && !cullingBounds) {
      this.setAllFillPathsVisible();
      return;
    }

    if (this.fillPathCount <= 0) {
      this.setAllFillPathsVisible();
      return;
    }

    const safeZoom = Math.max(1e-6, viewState.zoom);
    const halfViewWidth = Math.max(1, viewport.width) / (2 * safeZoom);
    const halfViewHeight = Math.max(1, viewport.height) / (2 * safeZoom);
    const margin = Math.max(16 / safeZoom, 0.5);

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

    if (
      viewMinX <= this.sceneMinX &&
      viewMaxX >= this.sceneMaxX &&
      viewMinY <= this.sceneMinY &&
      viewMaxY >= this.sceneMaxY
    ) {
      this.setAllFillPathsVisible();
      return;
    }

    let outCount = 0;
    for (let i = 0; i < this.fillPathCount; i += 1) {
      if (
        this.fillMaxX[i] < viewMinX ||
        this.fillMinX[i] > viewMaxX ||
        this.fillMaxY[i] < viewMinY ||
        this.fillMinY[i] > viewMaxY
      ) {
        continue;
      }

      this.visibleFillPathIds[outCount] = i;
      outCount += 1;
    }

    this.usingAllFillPaths = false;
    this.mesh.geometry.instanceCount = outCount;
    this.fillPathIndexAttribute.addUpdateRange(0, outCount);
    this.fillPathIndexAttribute.needsUpdate = true;
  }

  private setAllFillPathsVisible(): void {
    if (!this.usingAllFillPaths) {
      this.visibleFillPathIds.set(this.allFillPathIds.subarray(0, this.fillPathCount), 0);
      this.fillPathIndexAttribute.addUpdateRange(0, this.fillPathCount);
      this.fillPathIndexAttribute.needsUpdate = true;
    }
    this.usingAllFillPaths = true;
    this.mesh.geometry.instanceCount = this.fillPathCount;
  }
}

function chooseTextureSize(count: number): { width: number; height: number } {
  if (count <= 0) {
    return { width: 1, height: 1 };
  }

  const width = Math.max(1, Math.ceil(Math.sqrt(count)));
  const height = Math.max(1, Math.ceil(count / width));
  return { width, height };
}

function createFloatTexture(
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

function createFillGeometry(fillPathIds: Float32Array, fillPathCount: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();

  const corners = new Float32Array([
    -1, -1,
    1, -1,
    1, 1,
    -1, 1
  ]);
  geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute(corners, 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

  const fillPathIndexAttribute = new THREE.InstancedBufferAttribute(fillPathIds, 1);
  // Avoid Three's unconditional per-render upload for DynamicDrawUsage. The
  // culling path explicitly marks this stream dirty whenever its IDs change.
  fillPathIndexAttribute.setUsage(THREE.StreamDrawUsage);
  geometry.setAttribute("aFillPathIndex", fillPathIndexAttribute);
  geometry.instanceCount = Math.max(0, fillPathCount | 0);

  return geometry;
}

function buildFillPathBounds(scene: VectorScene, fillPathCount: number): {
  minX: Float32Array;
  minY: Float32Array;
  maxX: Float32Array;
  maxY: Float32Array;
  sceneMinX: number;
  sceneMinY: number;
  sceneMaxX: number;
  sceneMaxY: number;
} {
  const minX = new Float32Array(fillPathCount);
  const minY = new Float32Array(fillPathCount);
  const maxX = new Float32Array(fillPathCount);
  const maxY = new Float32Array(fillPathCount);

  let sceneMinX = Number.POSITIVE_INFINITY;
  let sceneMinY = Number.POSITIVE_INFINITY;
  let sceneMaxX = Number.NEGATIVE_INFINITY;
  let sceneMaxY = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < fillPathCount; i += 1) {
    const offset = i * 4;
    const x0 = scene.fillPathMetaA[offset + 2];
    const y0 = scene.fillPathMetaA[offset + 3];
    const x1 = scene.fillPathMetaB[offset];
    const y1 = scene.fillPathMetaB[offset + 1];

    minX[i] = Math.min(x0, x1);
    minY[i] = Math.min(y0, y1);
    maxX[i] = Math.max(x0, x1);
    maxY[i] = Math.max(y0, y1);

    sceneMinX = Math.min(sceneMinX, minX[i]);
    sceneMinY = Math.min(sceneMinY, minY[i]);
    sceneMaxX = Math.max(sceneMaxX, maxX[i]);
    sceneMaxY = Math.max(sceneMaxY, maxY[i]);
  }

  if (!Number.isFinite(sceneMinX) || !Number.isFinite(sceneMinY) || !Number.isFinite(sceneMaxX) || !Number.isFinite(sceneMaxY)) {
    sceneMinX = scene.bounds.minX;
    sceneMinY = scene.bounds.minY;
    sceneMaxX = scene.bounds.maxX;
    sceneMaxY = scene.bounds.maxY;
  }

  return { minX, minY, maxX, maxY, sceneMinX, sceneMinY, sceneMaxX, sceneMaxY };
}
