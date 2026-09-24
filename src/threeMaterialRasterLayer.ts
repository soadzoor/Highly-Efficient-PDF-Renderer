import { createThreeMultiplyMaterial } from "./threeVectorMultiply";
import { createThreeVectorClipTexture, initializeThreeVectorClip, createThreeVectorClipMaterial } from "./threeVectorClips";
import * as THREE from "three";
import { createDefaultOptionalContentSnapshot, type OptionalContentSnapshot } from "./optionalContent";
import { ScenePaintVisibility } from "./scenePaintVisibility";
import { buildRasterStripBatches, type RasterStripBatch } from "./rasterStripBatches";
import { RASTER_STRIP_VERTEX_GLSL, RASTER_STRIP_FRAGMENT_GLSL } from "./rasterStripWebGlShaders";
import { createThreeWebGpuRasterStripMaterial } from "./threeWebGpuRasterStripMaterial";

import {
  CORE_RASTER_FRAGMENT_SHADER_SOURCE,
  CORE_RASTER_VERTEX_SHADER_SOURCE
} from "./coreShaders";
import type { RasterLayer, VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import {
  HEPR_THREE_LAYER_ORDER_PAGE_BACKGROUND,
  HEPR_THREE_LAYER_ORDER_RASTER
} from "./threeLayerOrder";
import { createThreeWebGpuRasterMaterial, type ThreeWebGpuRasterMaterialState } from "./threeWebGpuRasterMaterial";
import type { ThreeColorCompositing } from "./threeWebGpuColorSpace";
import type { ViewState } from "./webGlFloorplanRenderer";

interface RasterLayerOptions {
  materialBackend?: "webgl" | "webgpu";
  colorCompositing?: ThreeColorCompositing;
  pageBackground: [number, number, number, number];
}

interface ViewportPixels {
  width: number;
  height: number;
}

interface RasterLayerEntry {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  material: THREE.Material;
  webGpuState?: Pick<ThreeWebGpuRasterMaterialState, "zoomUniform" | "useLocalToClipUniform"> &
    Partial<Pick<ThreeWebGpuRasterMaterialState, "updateSource">>;
  batched?: boolean;
}

interface ResidentRasterLayerEntry extends RasterLayerEntry {
  run?: VectorDrawRun;
  texture: THREE.Texture;
  resident: boolean;
}

interface RasterLayerSource {
  opacity?: number;
  width: number;
  height: number;
  data: Uint8Array<ArrayBufferLike>;
  matrix: Float32Array;
}

export class ThreeMaterialRasterLayer {
  private readonly visibility: ScenePaintVisibility;
  private snapshot: OptionalContentSnapshot;
  private readonly vectorClipTexture: THREE.DataTexture;
  private readonly vectorClipIndices: number[];
  readonly group: THREE.Group;

  private readonly geometry: THREE.BufferGeometry;
  private readonly pageBackgroundGeometry: THREE.BufferGeometry | null;
  private readonly materialBackend: "webgl" | "webgpu";
  private readonly colorCompositing: ThreeColorCompositing;
  private readonly pageBackgroundTexture: THREE.DataTexture;
  private readonly entries: RasterLayerEntry[] = [];
  private readonly rasterEntries: ResidentRasterLayerEntry[] = [];
  private readonly appliedRasterLayers: (RasterLayer | undefined)[];
  private readonly stripEntries: ResidentRasterLayerEntry[] = [];
  private activeEntries: RasterLayerEntry[] = [];
  private readonly multiplyMaterials: THREE.Material[] = [];
  private readonly ownedTextures = new Set<THREE.Texture>();
  private maxRasterTextureDimension: number;
  private rasterTextureResidencyEnabled = false;
  private disposed = false;

  private readonly viewportUniform: THREE.Vector2;
  private readonly cameraCenterUniform: THREE.Vector2;
  private readonly zoomUniform: { value: number };
  private readonly useLocalToClipUniform: { value: number };
  private readonly localToClipUniform: THREE.Matrix4;

  constructor(scene: VectorScene, options: RasterLayerOptions) {
    this.appliedRasterLayers = [...scene.rasterLayers];
    this.visibility = new ScenePaintVisibility(scene);
    this.snapshot = createDefaultOptionalContentSnapshot(scene);
    this.visibility.setVisibility(this.snapshot);
    this.vectorClipTexture = createThreeVectorClipTexture(scene);
    this.vectorClipIndices = Array(scene.rasterLayers.length).fill(-1);
    const rasterRuns: Array<VectorDrawRun | undefined> = Array(scene.rasterLayers.length);
    for (const run of scene.drawRuns ?? []) {
      if (run.kind !== "raster") continue;
      rasterRuns.fill(run, run.first, run.first + run.count);
      if (run.clipIndex !== undefined) this.vectorClipIndices.fill(run.clipIndex, run.first, run.first + run.count);
    }
    this.materialBackend = options.materialBackend ?? "webgl";
    this.colorCompositing = options.colorCompositing ?? "linear";
    this.group = new THREE.Group();
    this.group.visible = false;

    this.viewportUniform = new THREE.Vector2(1, 1);
    this.cameraCenterUniform = new THREE.Vector2();
    this.zoomUniform = { value: 1 };
    this.useLocalToClipUniform = { value: 0 };
    this.localToClipUniform = new THREE.Matrix4();

    this.geometry = createRasterGeometry();

    this.pageBackgroundTexture = createPageBackgroundTexture(options.pageBackground);
    this.ownedTextures.add(this.pageBackgroundTexture);

    const pageRects = normalizePageRects(scene);
    this.pageBackgroundGeometry = createPageBackgroundGeometry(pageRects);
    if (this.pageBackgroundGeometry) {
      const entry = this.createEntry(
        this.pageBackgroundTexture,
        PAGE_BACKGROUND_PLACEMENT_MATRIX,
        HEPR_THREE_LAYER_ORDER_PAGE_BACKGROUND,
        this.pageBackgroundGeometry
      );
      this.entries.push(entry);
      entry.mesh.userData.heprPageBackground = true;
      this.group.add(entry.mesh);
    }

    const rasterSources = getSceneRasterLayers(scene);
    this.maxRasterTextureDimension = rasterSources.reduce(
      (maximum, source) => Math.max(maximum, source.width, source.height),
      0
    );
    for (let rasterIndex = 0; rasterIndex < rasterSources.length; rasterIndex += 1) {
      const source = rasterSources[rasterIndex];
      const texture = createRasterTexture(source);
      this.ownedTextures.add(texture);
      const rasterOrderOffset = (rasterIndex + 1) / (rasterSources.length + 1);
      const entry = this.createEntry(
        texture,
        source.matrix,
        HEPR_THREE_LAYER_ORDER_RASTER + rasterOrderOffset,
        this.geometry,
        this.vectorClipIndices[this.rasterEntries.length] ?? -1,
        source.opacity ?? 1
      );
      entry.mesh.userData.heprDrawRun = { kind: "raster", first: rasterIndex, count: 1 };
      const run = rasterRuns[rasterIndex];
      const multiply = !scene.paintGraph && run?.blendMode === "Multiply";
      if (multiply) {
        const original = entry.material;
        entry.mesh.material = entry.material = createThreeMultiplyMaterial(original, 0, true);
        const second = createThreeMultiplyMaterial(original, 1, true);
        original.dispose();
        this.multiplyMaterials.push(second);
        const completion = new THREE.Mesh(this.geometry, second);
        completion.frustumCulled = false;
        completion.userData.heprMultiplyCompletion = true;
        entry.mesh.add(completion);
      }
      entry.mesh.visible = false;
      const residentEntry = {
        ...entry,
        run,
        texture,
        resident: false
      };
      this.entries.push(residentEntry);
      this.rasterEntries.push(residentEntry);
      this.group.add(entry.mesh);
    }
    try {
      // 2048 is within WebGL2's minimum texture limit. The shared planner
      // applies the same per-batch and total allocation bounds as native paths.
      // Both Three backends generate ordinary image mips by linear sampling.
      const batches = rasterSources.length === scene.rasterLayers.length
        ? buildRasterStripBatches(scene, 2048, "linear") : [];
      for (const batch of batches) this.addStripBatch(batch);
    } catch (error) {
      this.destroyStripBatches();
      console.warn("Raster strip batching unavailable; drawing original image layers.", error);
    }
    this.activeEntries = this.entries.filter(entry => !entry.batched);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  setOptionalContentVisibility(snapshot: OptionalContentSnapshot): void {
    this.snapshot = snapshot;
    this.visibility.setVisibility(snapshot);
    for (const entry of this.rasterEntries) entry.mesh.visible = !entry.batched && entry.resident && this.isEntryVisible(entry);
    for (const entry of this.stripEntries) entry.mesh.visible = entry.resident && this.isEntryVisible(entry);
  }

  private isEntryVisible(entry: ResidentRasterLayerEntry): boolean {
    if (!entry.run) return true;
    return this.visibility.requiresCompositing
      ? entry.run.optionalContent === undefined || this.snapshot.conditions[entry.run.optionalContent] !== 0
      : this.visibility.isRunVisible(entry.run);
  }

  getMaxRasterTextureDimension(): number {
    return this.stripEntries.reduce((maximum, entry) => {
      const image = entry.texture.image as { width: number; height: number };
      return Math.max(maximum, image.width, image.height);
    }, this.maxRasterTextureDimension);
  }

  /** Stage replacement pixels without uploading resources on a dormant material path. */
  prepareRasterLayerUpdates(updates: ReadonlyMap<number, RasterLayer>): { commit(): void; dispose(): void } {
    if (this.disposed) throw new Error("Raster material layer has been disposed.");
    for (const [index, layer] of updates) {
      if (!Number.isInteger(index) || index < 0 || index >= this.rasterEntries.length ||
          !Number.isInteger(layer.width) || !Number.isInteger(layer.height) || layer.width < 1 || layer.height < 1 ||
          !(layer.data instanceof Uint8Array) || layer.data.length !== layer.width * layer.height * 4 ||
          !(layer.matrix instanceof Float32Array) || layer.matrix.length !== 6 ||
          !layer.matrix.every(Number.isFinite) || !Number.isFinite(layer.opacity ?? 1) ||
          (layer.opacity ?? 1) < 0 || (layer.opacity ?? 1) > 1) {
        throw new Error("Invalid staged raster layer update.");
      }
    }
    const staged: { index: number; layer: RasterLayer; texture: THREE.DataTexture }[] = [];
    try {
      for (const [index, layer] of updates) {
        if (this.appliedRasterLayers[index] !== layer) staged.push({ index, layer, texture: createRasterTexture(layer) });
      }
    } catch (error) {
      for (const item of staged) item.texture.dispose();
      throw error;
    }
    let finished = false;
    return {
      commit: () => {
        if (finished) return;
        if (this.disposed) {
          for (const item of staged) item.texture.dispose();
          finished = true;
          throw new Error("Raster material layer has been disposed.");
        }
        finished = true;
        if (staged.length > 0) this.destroyStripBatches();
        for (const { index, layer, texture } of staged) {
          this.appliedRasterLayers[index] = layer;
          const entry = this.rasterEntries[index];
          const previous = entry.texture;
          entry.texture = texture;
          this.ownedTextures.add(texture);
          this.ownedTextures.delete(previous);
          previous.dispose();
          if (entry.webGpuState?.updateSource) entry.webGpuState.updateSource(texture, layer.matrix, layer.opacity ?? 1);
          else {
            const uniforms = (entry.material as THREE.RawShaderMaterial).uniforms;
            uniforms.uRasterTex.value = texture;
            uniforms.uRasterMatrixABCD.value.set(layer.matrix[0], layer.matrix[1], layer.matrix[2], layer.matrix[3]);
            uniforms.uRasterMatrixEF.value.set(layer.matrix[4], layer.matrix[5]);
            uniforms.uRasterOpacity.value = layer.opacity ?? 1;
          }
          this.maxRasterTextureDimension = Math.max(this.maxRasterTextureDimension, layer.width, layer.height);
          entry.resident = this.rasterTextureResidencyEnabled;
          entry.mesh.visible = entry.resident &&
            this.isEntryVisible(entry);
        }
      },
      dispose: () => {
        if (finished) return;
        finished = true;
        for (const item of staged) item.texture.dispose();
      }
    };
  }

  /** Allocate or release only raster GPU textures, retaining their CPU pixel data. */
  setTextureResidency(resident: boolean): void {
    if (resident === this.rasterTextureResidencyEnabled) {
      return;
    }
    this.rasterTextureResidencyEnabled = resident;
    if (resident) {
      for (const entry of this.rasterEntries) {
        if (entry.batched) {
          // Keep canonical meshes for replacement fallback, without traversing
          // thousands of hidden children on every Three.js frame.
          entry.mesh.removeFromParent();
          continue;
        }
        entry.texture.needsUpdate = true;
        entry.resident = true;
        entry.mesh.visible = this.isEntryVisible(entry);
      }
      for (const entry of this.stripEntries) {
        entry.texture.needsUpdate = true;
        entry.resident = true;
        entry.mesh.visible = this.isEntryVisible(entry);
      }
      return;
    }
    for (const entry of this.rasterEntries) {
      this.evictRasterEntry(entry);
    }
    for (const entry of this.stripEntries) this.evictRasterEntry(entry);
  }

  setPageBackgroundColor(red: number, green: number, blue: number, alpha: number): void {
    const image = this.pageBackgroundTexture.image as { data?: Uint8Array };
    const data = image?.data;
    if (!data || data.length < 4) {
      return;
    }

    const rgba = premultiplyRgbaPixel(
      Math.round(clamp01(red) * 255),
      Math.round(clamp01(green) * 255),
      Math.round(clamp01(blue) * 255),
      Math.round(clamp01(alpha) * 255)
    );

    data[0] = rgba[0];
    data[1] = rgba[1];
    data[2] = rgba[2];
    data[3] = rgba[3];
    this.pageBackgroundTexture.needsUpdate = true;
  }

  updateFrame(viewState: ViewState, viewport: ViewportPixels): void {
    this.viewportUniform.set(Math.max(1, viewport.width), Math.max(1, viewport.height));
    this.cameraCenterUniform.set(viewState.cameraCenterX, viewState.cameraCenterY);
    this.zoomUniform.value = Math.max(1e-6, viewState.zoom);
    for (const entry of this.activeEntries) {
      if (entry.webGpuState) {
        entry.webGpuState.zoomUniform.value = this.zoomUniform.value;
      }
    }
  }

  setScreenSpaceTransform(): void {
    this.useLocalToClipUniform.value = 0;
    for (const entry of this.activeEntries) {
      if (entry.webGpuState) {
        entry.webGpuState.useLocalToClipUniform.value = 0;
      }
    }
  }

  setLocalToClipTransform(localToClip: THREE.Matrix4): void {
    this.useLocalToClipUniform.value = 1;
    this.localToClipUniform.copy(localToClip);
    for (const entry of this.activeEntries) {
      if (entry.webGpuState) {
        entry.webGpuState.useLocalToClipUniform.value = 1;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.vectorClipTexture.dispose();
    for (const entry of this.entries) {
      this.group.remove(entry.mesh);
      entry.material.dispose();
    }
    this.entries.length = 0;
    this.activeEntries.length = 0;
    for (const material of this.multiplyMaterials) material.dispose();
    this.multiplyMaterials.length = 0;

    this.geometry.dispose();
    this.pageBackgroundGeometry?.dispose();
    for (const entry of this.stripEntries) entry.mesh.geometry.dispose();
    this.stripEntries.length = 0;

    for (const texture of this.ownedTextures) {
      texture.dispose();
    }
    this.ownedTextures.clear();
    this.rasterEntries.length = 0;
  }

  private evictRasterEntry(entry: ResidentRasterLayerEntry): void {
    entry.mesh.visible = false;
    if (!entry.resident) {
      return;
    }
    entry.texture.dispose();
    entry.resident = false;
  }

  private addStripBatch(batch: RasterStripBatch): void {
    const texture = new THREE.DataTexture(batch.data, batch.width, batch.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    let geometry: THREE.InstancedBufferGeometry | undefined;
    let material: THREE.Material | undefined;
    try {
      geometry = createRasterStripGeometry(batch);
      let webGpuState: RasterLayerEntry["webGpuState"];
      if (this.materialBackend === "webgpu") {
        const state = createThreeWebGpuRasterStripMaterial({ texture, colorCompositing: this.colorCompositing,
          viewport: this.viewportUniform, cameraCenter: this.cameraCenterUniform, localToClip: this.localToClipUniform });
        material = state.material;
        webGpuState = state;
        state.zoomUniform.value = this.zoomUniform.value;
        state.useLocalToClipUniform.value = this.useLocalToClipUniform.value;
      } else {
        // Reuse the native shader, including its independent mip sampling.
        material = new THREE.RawShaderMaterial({
          glslVersion: THREE.GLSL3,
          vertexShader: normalizeCoreShaderSource(RASTER_STRIP_VERTEX_GLSL),
          fragmentShader: normalizeCoreShaderSource(RASTER_STRIP_FRAGMENT_GLSL),
          transparent: false, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
          blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
          blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
          uniforms: {
            uRasterStripTex: { value: texture }, uRasterStripSize: { value: new THREE.Vector2(batch.width, batch.height) },
            uViewport: { value: this.viewportUniform }, uCameraCenter: { value: this.cameraCenterUniform },
            uZoom: this.zoomUniform, uUseLocalToClip: this.useLocalToClipUniform, uLocalToClip: { value: this.localToClipUniform }
          }
        });
      }
      initializeThreeVectorClip(material, this.vectorClipTexture);
      const clipped = createThreeVectorClipMaterial(material, this.vectorClipIndices[batch.first]);
      if (clipped !== material) material.dispose();
      material = clipped;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = this.rasterEntries[batch.first].mesh.renderOrder;
      mesh.userData.heprDrawRun = { kind: "raster", first: batch.first, count: batch.count };
      const entry = { mesh, material, webGpuState, texture, resident: false, run: this.rasterEntries[batch.first].run };
      this.stripEntries.push(entry);
      this.entries.push(entry);
      this.ownedTextures.add(texture);
      this.group.add(mesh);
      for (let index = batch.first; index < batch.first + batch.count; index++) this.rasterEntries[index].batched = true;
    } catch (error) {
      texture.dispose(); geometry?.dispose(); material?.dispose();
      throw error;
    }
  }

  private destroyStripBatches(): void {
    for (const entry of this.stripEntries) {
      entry.mesh.removeFromParent();
      entry.mesh.geometry.dispose();
      entry.material.dispose();
      entry.texture.dispose();
      this.ownedTextures.delete(entry.texture);
      this.entries.splice(this.entries.indexOf(entry), 1);
    }
    this.stripEntries.length = 0;
    for (const entry of this.rasterEntries) {
      if (!entry.batched) continue;
      entry.batched = false;
      if (entry.mesh.parent !== this.group) this.group.add(entry.mesh);
      entry.resident = this.rasterTextureResidencyEnabled;
      if (entry.resident) entry.texture.needsUpdate = true;
      entry.mesh.visible = entry.resident && this.isEntryVisible(entry);
      if (entry.webGpuState) {
        entry.webGpuState.zoomUniform.value = this.zoomUniform.value;
        entry.webGpuState.useLocalToClipUniform.value = this.useLocalToClipUniform.value;
      }
    }
    this.activeEntries = this.entries.filter(entry => !entry.batched);
  }

  private createEntry(
    texture: THREE.Texture,
    matrixSource: Float32Array,
    renderOrder: number,
    geometry: THREE.BufferGeometry = this.geometry,
    clipIndex = -1,
    opacity = 1
  ): RasterLayerEntry {
    const matrix = normalizeRasterMatrix(matrixSource);

    if (this.materialBackend === "webgpu") {
      const state = createThreeWebGpuRasterMaterial({
        colorCompositing: this.colorCompositing,
        opacity,
        texture,
        matrixABCD: new THREE.Vector4(matrix[0], matrix[1], matrix[2], matrix[3]),
        matrixEF: new THREE.Vector2(matrix[4], matrix[5]),
        viewport: this.viewportUniform,
        cameraCenter: this.cameraCenterUniform,
        localToClip: this.localToClipUniform
      });
      state.zoomUniform.value = this.zoomUniform.value;
      state.useLocalToClipUniform.value = this.useLocalToClipUniform.value;

      initializeThreeVectorClip(state.material, this.vectorClipTexture);
      const sourceMaterial = state.material;
      state.material = createThreeVectorClipMaterial(sourceMaterial, clipIndex);
      if (state.material !== sourceMaterial) sourceMaterial.dispose();
      const mesh = new THREE.Mesh(geometry, state.material);
      mesh.frustumCulled = false;
      mesh.renderOrder = renderOrder;
      return { mesh, material: state.material, webGpuState: state };
    }

    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: normalizeCoreShaderSource(CORE_RASTER_VERTEX_SHADER_SOURCE),
      fragmentShader: normalizeCoreShaderSource(CORE_RASTER_FRAGMENT_SHADER_SOURCE),
      transparent: false,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        uRasterTex: { value: texture },
        uRasterOpacity: { value: opacity },
        uRasterMatrixABCD: { value: new THREE.Vector4(matrix[0], matrix[1], matrix[2], matrix[3]) },
        uRasterMatrixEF: { value: new THREE.Vector2(matrix[4], matrix[5]) },
        uViewport: { value: this.viewportUniform },
        uCameraCenter: { value: this.cameraCenterUniform },
        uZoom: this.zoomUniform,
        uUseLocalToClip: this.useLocalToClipUniform,
        uLocalToClip: { value: this.localToClipUniform }
      }
    });

    initializeThreeVectorClip(material, this.vectorClipTexture);
    const clippedMaterial = createThreeVectorClipMaterial(material, clipIndex);
    if (clippedMaterial !== material) material.dispose();
    const mesh = new THREE.Mesh(geometry, clippedMaterial);
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;

    return { mesh, material: clippedMaterial };
  }
}

/**
 * Placement matrix that leaves the raster vertex shader's mapped quad position
 * untouched, so the merged page-background geometry supplies scene coordinates
 * itself. See {@link createPageBackgroundGeometry}.
 */
const PAGE_BACKGROUND_PLACEMENT_MATRIX = new Float32Array([1, 0, 0, 1, 0, 0]);

/**
 * All page backgrounds as one indexed mesh.
 *
 * A mesh per page meant a draw call, program setup, attribute rebind and uniform
 * upload per page every frame, which dominates the frame on documents with
 * hundreds of pages. Merging them costs one small buffer and leaves a single
 * draw call at every zoom level.
 *
 * The raster vertex shader maps `aCorner` through the unit quad into the
 * placement matrix. With an identity placement the mapping reduces to
 * `world = (aCorner.x * 0.5 + 0.5, 0.5 - aCorner.y * 0.5)`, so storing its
 * inverse per vertex puts scene coordinates on the attribute and keeps both
 * backends on their existing shader.
 */
function createPageBackgroundGeometry(pageRects: Float32Array): THREE.BufferGeometry | null {
  const pageCount = Math.floor(pageRects.length / 4);
  if (pageCount <= 0) {
    return null;
  }

  const corners = new Float32Array(pageCount * 8);
  const indices = new Uint32Array(pageCount * 6);
  for (let page = 0; page < pageCount; page += 1) {
    const rect = page * 4;
    const minX = Math.min(pageRects[rect], pageRects[rect + 2]);
    const minY = Math.min(pageRects[rect + 1], pageRects[rect + 3]);
    const maxX = Math.max(pageRects[rect], pageRects[rect + 2]);
    const maxY = Math.max(pageRects[rect + 1], pageRects[rect + 3]);

    const vertex = page * 8;
    writePageBackgroundCorner(corners, vertex, minX, minY);
    writePageBackgroundCorner(corners, vertex + 2, maxX, minY);
    writePageBackgroundCorner(corners, vertex + 4, maxX, maxY);
    writePageBackgroundCorner(corners, vertex + 6, minX, maxY);

    const base = page * 4;
    const index = page * 6;
    indices[index] = base;
    indices[index + 1] = base + 1;
    indices[index + 2] = base + 2;
    indices[index + 3] = base;
    indices[index + 4] = base + 2;
    indices[index + 5] = base + 3;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute(corners, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

function writePageBackgroundCorner(
  out: Float32Array,
  offset: number,
  worldX: number,
  worldY: number
): void {
  out[offset] = 2 * worldX - 1;
  out[offset + 1] = 1 - 2 * worldY;
}

function createRasterGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const corners = new Float32Array([
    -1, -1,
    1, -1,
    1, 1,
    -1, 1
  ]);
  geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute(corners, 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  return geometry;
}

function createRasterStripGeometry(batch: RasterStripBatch): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  // Match the native triangle strip's vertex IDs in an indexed Three mesh.
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], 3));
  geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute([-1, -1, 1, -1, -1, 1, 1, 1], 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 2, 1, 3]), 1));
  const instances = new THREE.InstancedInterleavedBuffer(batch.instances, 8);
  geometry.setAttribute("aRasterMatrixABCD", new THREE.InterleavedBufferAttribute(instances, 4, 0));
  geometry.setAttribute("aRasterMatrixEFWidthOpacity", new THREE.InterleavedBufferAttribute(instances, 4, 4));
  geometry.instanceCount = batch.count;
  return geometry;
}

function createPageBackgroundTexture(color: [number, number, number, number]): THREE.DataTexture {
  const rgba = premultiplyRgbaPixel(
    Math.round(clamp01(color[0]) * 255),
    Math.round(clamp01(color[1]) * 255),
    Math.round(clamp01(color[2]) * 255),
    Math.round(clamp01(color[3]) * 255)
  );
  const data = new Uint8Array(rgba);
  const texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createRasterTexture(source: RasterLayerSource): THREE.DataTexture {
  const pixelCount = source.width * source.height * 4;
  const pixels = source.data.subarray(0, pixelCount);
  const premultiplied = premultiplyRgba(pixels);
  const texture = new THREE.DataTexture(
    premultiplied,
    Math.max(1, source.width),
    Math.max(1, source.height),
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function getSceneRasterLayers(scene: VectorScene): RasterLayerSource[] {
  const out: RasterLayerSource[] = [];

  if (Array.isArray(scene.rasterLayers)) {
    for (const layer of scene.rasterLayers) {
      const width = Math.max(0, Math.trunc(layer?.width ?? 0));
      const height = Math.max(0, Math.trunc(layer?.height ?? 0));
      if (width <= 0 || height <= 0 || !(layer?.data instanceof Uint8Array) || layer.data.length < width * height * 4) {
        continue;
      }
      out.push({
        width,
        height,
        data: layer.data,
        opacity: layer.opacity,
        matrix: layer.matrix instanceof Float32Array ? layer.matrix : new Float32Array(layer.matrix)
      });
    }
  }

  if (out.length > 0) {
    return out;
  }

  const legacyWidth = Math.max(0, Math.trunc(scene.rasterLayerWidth));
  const legacyHeight = Math.max(0, Math.trunc(scene.rasterLayerHeight));
  if (legacyWidth <= 0 || legacyHeight <= 0 || scene.rasterLayerData.length < legacyWidth * legacyHeight * 4) {
    return out;
  }

  out.push({
    width: legacyWidth,
    height: legacyHeight,
    data: scene.rasterLayerData,
    matrix: scene.rasterLayerMatrix
  });

  return out;
}

function normalizePageRects(scene: VectorScene): Float32Array {
  if (scene.pageRects instanceof Float32Array && scene.pageRects.length >= 4) {
    return new Float32Array(scene.pageRects);
  }

  return new Float32Array([
    scene.pageBounds.minX,
    scene.pageBounds.minY,
    scene.pageBounds.maxX,
    scene.pageBounds.maxY
  ]);
}

function normalizeRasterMatrix(matrix: Float32Array): [number, number, number, number, number, number] {
  return [
    readFinite(matrix[0], 1),
    readFinite(matrix[1], 0),
    readFinite(matrix[2], 0),
    readFinite(matrix[3], 1),
    readFinite(matrix[4], 0),
    readFinite(matrix[5], 0)
  ];
}

function readFinite(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function premultiplyRgba(source: Uint8Array): Uint8Array {
  const out = new Uint8Array(source.length);
  for (let i = 0; i + 3 < source.length; i += 4) {
    const premultiplied = premultiplyRgbaPixel(source[i], source[i + 1], source[i + 2], source[i + 3]);
    out[i] = premultiplied[0];
    out[i + 1] = premultiplied[1];
    out[i + 2] = premultiplied[2];
    out[i + 3] = premultiplied[3];
  }
  return out;
}

function premultiplyRgbaPixel(red: number, green: number, blue: number, alpha: number): [number, number, number, number] {
  const a = clampByte(alpha);
  if (a <= 0) {
    return [0, 0, 0, 0];
  }
  if (a >= 255) {
    return [clampByte(red), clampByte(green), clampByte(blue), 255];
  }
  const scale = a / 255;
  return [
    Math.round(clampByte(red) * scale),
    Math.round(clampByte(green) * scale),
    Math.round(clampByte(blue) * scale),
    a
  ];
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 255) {
    return 255;
  }
  return Math.round(value);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function normalizeCoreShaderSource(source: string): string {
  return source.replace(/^\s*#version\s+300\s+es\s*/m, "");
}
