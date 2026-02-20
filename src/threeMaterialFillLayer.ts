import * as THREE from "three";

import type { VectorScene } from "./pdfVectorExtractor";
import {
  CORE_FILL_FRAGMENT_SHADER_SOURCE,
  CORE_FILL_VERTEX_SHADER_SOURCE
} from "./coreShaders";
import type { ViewState } from "./webGlFloorplanRenderer";

interface FillLayerOptions {
  vectorOverride: [number, number, number, number];
}

interface ViewportPixels {
  width: number;
  height: number;
}

export class ThreeMaterialFillLayer {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.RawShaderMaterial>;

  private readonly fillPathMetaTextureA: THREE.DataTexture;
  private readonly fillPathMetaTextureB: THREE.DataTexture;
  private readonly fillPathMetaTextureC: THREE.DataTexture;
  private readonly fillSegmentTextureA: THREE.DataTexture;
  private readonly fillSegmentTextureB: THREE.DataTexture;

  private readonly viewportUniform: THREE.Vector2;
  private readonly cameraCenterUniform: THREE.Vector2;
  private readonly zoomUniform: { value: number };
  private readonly vectorOverrideUniform: THREE.Vector4;

  constructor(scene: VectorScene, options: FillLayerOptions) {
    const fillPathCount = Math.max(0, scene.fillPathCount | 0);
    const fillSegmentCount = Math.max(0, scene.fillSegmentCount | 0);
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

    const geometry = createFillGeometry(fillPathCount);
    this.viewportUniform = new THREE.Vector2(1, 1);
    this.cameraCenterUniform = new THREE.Vector2();
    this.zoomUniform = { value: 1 };
    this.vectorOverrideUniform = new THREE.Vector4(
      options.vectorOverride[0],
      options.vectorOverride[1],
      options.vectorOverride[2],
      options.vectorOverride[3]
    );

    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: normalizeCoreShaderSource(CORE_FILL_VERTEX_SHADER_SOURCE),
      fragmentShader: normalizeCoreShaderSource(CORE_FILL_FRAGMENT_SHADER_SOURCE),
      transparent: true,
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
        uFillAAScreenPx: { value: 1.0 },
        uVectorOverride: { value: this.vectorOverrideUniform }
      }
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
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
    this.fillPathMetaTextureA.dispose();
    this.fillPathMetaTextureB.dispose();
    this.fillPathMetaTextureC.dispose();
    this.fillSegmentTextureA.dispose();
    this.fillSegmentTextureB.dispose();
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

function createFillGeometry(fillPathCount: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();

  const corners = new Float32Array([
    -1, -1,
    1, -1,
    1, 1,
    -1, 1
  ]);
  geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute(corners, 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

  const instanceCount = Math.max(0, fillPathCount | 0);
  const fillPathIds = new Float32Array(Math.max(1, instanceCount));
  for (let i = 0; i < instanceCount; i += 1) {
    fillPathIds[i] = i;
  }
  geometry.setAttribute("aFillPathIndex", new THREE.InstancedBufferAttribute(fillPathIds, 1));
  geometry.instanceCount = instanceCount;

  return geometry;
}

function normalizeCoreShaderSource(source: string): string {
  return source.replace(/^\s*#version\s+300\s+es\s*/m, "");
}
