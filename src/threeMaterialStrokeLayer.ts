import * as THREE from "three";

import type { VectorScene } from "./pdfVectorExtractor";
import {
  CORE_STROKE_FRAGMENT_SHADER_SOURCE,
  CORE_STROKE_VERTEX_SHADER_SOURCE
} from "./coreShaders";
import type { ViewState } from "./webGlFloorplanRenderer";

interface StrokeLayerOptions {
  strokeCurveEnabled: boolean;
  vectorOverride: [number, number, number, number];
}

interface ViewportPixels {
  width: number;
  height: number;
}

export class ThreeMaterialStrokeLayer {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.RawShaderMaterial>;

  private readonly segmentTextureA: THREE.DataTexture;
  private readonly segmentTextureB: THREE.DataTexture;
  private readonly segmentStyleTexture: THREE.DataTexture;
  private readonly segmentBoundsTexture: THREE.DataTexture;

  private readonly viewportUniform: THREE.Vector2;
  private readonly cameraCenterUniform: THREE.Vector2;
  private readonly zoomUniform: { value: number };
  private readonly curveUniform: { value: number };
  private readonly vectorOverrideUniform: THREE.Vector4;

  constructor(scene: VectorScene, options: StrokeLayerOptions) {
    const segmentCount = Math.max(0, scene.segmentCount | 0);
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
    this.segmentBoundsTexture = createSegmentDataTexture(
      scene.primitiveBounds,
      segmentCount,
      segmentTextureSize.width,
      segmentTextureSize.height
    );

    const geometry = createStrokeGeometry(segmentCount);
    this.viewportUniform = new THREE.Vector2(1, 1);
    this.cameraCenterUniform = new THREE.Vector2();
    this.zoomUniform = { value: 1 };
    this.curveUniform = { value: options.strokeCurveEnabled ? 1 : 0 };
    this.vectorOverrideUniform = new THREE.Vector4(
      options.vectorOverride[0],
      options.vectorOverride[1],
      options.vectorOverride[2],
      options.vectorOverride[3]
    );

    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: normalizeCoreShaderSource(CORE_STROKE_VERTEX_SHADER_SOURCE),
      fragmentShader: normalizeCoreShaderSource(CORE_STROKE_FRAGMENT_SHADER_SOURCE),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      uniforms: {
        uSegmentTexA: { value: this.segmentTextureA },
        uSegmentTexB: { value: this.segmentTextureB },
        uSegmentStyleTex: { value: this.segmentStyleTexture },
        uSegmentBoundsTex: { value: this.segmentBoundsTexture },
        uSegmentTexSize: {
          value: new Int32Array([segmentTextureSize.width, segmentTextureSize.height])
        },
        uViewport: { value: this.viewportUniform },
        uCameraCenter: { value: this.cameraCenterUniform },
        uZoom: this.zoomUniform,
        uAAScreenPx: { value: 1.0 },
        uStrokeCurveEnabled: this.curveUniform,
        uVectorOverride: { value: this.vectorOverrideUniform }
      }
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  setStrokeCurveEnabled(enabled: boolean): void {
    this.curveUniform.value = enabled ? 1 : 0;
  }

  setVectorOverride(red: number, green: number, blue: number, opacity: number): void {
    this.vectorOverrideUniform.set(red, green, blue, opacity);
  }

  updateFrame(viewState: ViewState, viewport: ViewportPixels): void {
    this.viewportUniform.set(Math.max(1, viewport.width), Math.max(1, viewport.height));
    this.cameraCenterUniform.set(viewState.cameraCenterX, viewState.cameraCenterY);
    this.zoomUniform.value = Math.max(1e-6, viewState.zoom);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.segmentTextureA.dispose();
    this.segmentTextureB.dispose();
    this.segmentStyleTexture.dispose();
    this.segmentBoundsTexture.dispose();
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

function createStrokeGeometry(segmentCount: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();

  const corners = new Float32Array([
    -1, -1,
    1, -1,
    1, 1,
    -1, 1
  ]);
  geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute(corners, 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

  const instanceCount = Math.max(0, segmentCount | 0);
  const segmentIds = new Float32Array(Math.max(1, instanceCount));
  for (let i = 0; i < instanceCount; i += 1) {
    segmentIds[i] = i;
  }
  geometry.setAttribute("aSegmentIndex", new THREE.InstancedBufferAttribute(segmentIds, 1));
  geometry.instanceCount = instanceCount;

  return geometry;
}

function normalizeCoreShaderSource(source: string): string {
  return source.replace(/^\s*#version\s+300\s+es\s*/m, "");
}
