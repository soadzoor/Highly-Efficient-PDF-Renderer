import { requireThreeWebGpuBackend, type ThreeWebGpuBackend } from "./threeMaterialBackend";
import * as THREE from "three";
import { type PrimitiveHighlightSet } from "./primitiveAppearance";
import { PRIMITIVE_HIGHLIGHT_VERTEX_GLSL, PRIMITIVE_HIGHLIGHT_FRAGMENT_GLSL } from "./primitiveHighlightShaders";
import { normalizeThreeRawShaderSource } from "./threeRawShaderColorSpace";
import { configureStraightAlphaBlending } from "./threeMaterialBlending";
import type { ThreeColorCompositing } from "./threeWebGpuColorSpace";
import { packVectorClips } from "./vectorClips";
import { HEPR_THREE_LAYER_ORDER_TEXT_SELECTION } from "./threeLayerOrder";

/** Compact analytical traces, drawn after PDF content in both Three backends. */
export class ThreePrimitiveHighlightLayer {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.Material>;
  private readonly matrix = new THREE.Matrix4();
  private readonly units: { value: number } = { value: 1 };
  private readonly pixelRatio: { value: number } = { value: 1 };
  private readonly selectionCount: { value: number } = { value: 0 };
  private readonly clips = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  private segmentBuffer: THREE.InstancedInterleavedBuffer | null = null;
  private capacity = 0;

  constructor(backend: "webgl" | "webgpu", colorCompositing: ThreeColorCompositing, webGpu?: ThreeWebGpuBackend) {
    this.clips.minFilter = this.clips.magFilter = THREE.NearestFilter;
    this.clips.generateMipmaps = false;
    let material: THREE.Material;
    if (backend === "webgl") {
      material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: normalizeThreeRawShaderSource(PRIMITIVE_HIGHLIGHT_VERTEX_GLSL),
        fragmentShader: normalizeThreeRawShaderSource(PRIMITIVE_HIGHLIGHT_FRAGMENT_GLSL),
        uniforms: {
          uLocalToClip: { value: this.matrix }, uLocalUnitsPerPixel: this.units,
          uPixelRatio: this.pixelRatio, uSelectionCount: this.selectionCount,
          uVectorClipTex: { value: this.clips }
        },
        depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false
      });
    } else {
      const state = requireThreeWebGpuBackend(webGpu).createThreeWebGpuPrimitiveHighlightMaterial({
        matrix: this.matrix, clips: this.clips, colorCompositing
      });
      this.units = state.units;
      this.pixelRatio = state.pixelRatio;
      this.selectionCount = state.selectionCount;
      material = state.material;
    }
    configureStraightAlphaBlending(material);
    // Fallback page textures use renderOrder 0, unlike the negative vector
    // layer orders. Present traces in Three's overlay/transparent queue so
    // both the opaque fallback page and vector layers are already drawn.
    material.transparent = true;
    material.forceSinglePass = true;
    this.mesh = new THREE.Mesh(new THREE.InstancedBufferGeometry(), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = HEPR_THREE_LAYER_ORDER_TEXT_SELECTION + 4;
    this.mesh.name = "hepr-primitive-highlights";
  }

  setHighlights(highlights: PrimitiveHighlightSet): void {
    if (!this.segmentBuffer || highlights.count > this.capacity) {
      this.capacity = Math.max(1, 2 ** Math.ceil(Math.log2(Math.max(1, highlights.count))));
      const geometry = new THREE.InstancedBufferGeometry();
      geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
      geometry.setIndex([0, 1, 2, 2, 1, 3]);
      this.segmentBuffer = new THREE.InstancedInterleavedBuffer(new Float32Array(this.capacity * 8), 8);
      this.segmentBuffer.setUsage(THREE.StreamDrawUsage);
      geometry.setAttribute("aSegmentA", new THREE.InterleavedBufferAttribute(this.segmentBuffer, 4, 0));
      geometry.setAttribute("aSegmentB", new THREE.InterleavedBufferAttribute(this.segmentBuffer, 4, 4));
      const ids = Float32Array.from({ length: this.capacity }, (_, index) => index);
      geometry.setAttribute("aHighlightIndex", new THREE.InstancedBufferAttribute(ids, 1));
      this.mesh.geometry.dispose();
      this.mesh.geometry = geometry;
    }
    this.segmentBuffer.array.set(highlights.segments);
    this.segmentBuffer.clearUpdateRanges();
    this.segmentBuffer.addUpdateRange(0, highlights.count * 8);
    this.segmentBuffer.needsUpdate = true;
    this.mesh.geometry.instanceCount = highlights.count;
    this.selectionCount.value = highlights.selectionCount;
    const packed = packVectorClips(highlights.clipPaths);
    const width = Math.min(4096, Math.max(1, Math.ceil(Math.sqrt(packed.length / 4))));
    const height = Math.max(1, Math.ceil(packed.length / 4 / width));
    if (height > 4096) throw new RangeError("Primitive highlight clip texture exceeds material capacity.");
    const resized = this.clips.image.width !== width || this.clips.image.height !== height;
    const data = resized ? new Float32Array(width * height * 4) : this.clips.image.data as Float32Array;
    data.set(packed);
    if (resized) {
      this.clips.dispose();
      this.clips.image = { data, width, height };
    }
    this.clips.needsUpdate = true;
  }

  updateFrame(matrix: THREE.Matrix4, localUnitsPerPixel: number, pixelRatio: number): void {
    this.matrix.copy(matrix);
    this.units.value = Math.max(1e-6, localUnitsPerPixel);
    this.pixelRatio.value = Math.max(0.1, pixelRatio);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.clips.dispose();
  }
}
