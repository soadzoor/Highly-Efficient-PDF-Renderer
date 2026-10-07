import { requireThreeWebGpuBackend, type ThreeWebGpuBackend } from "./threeMaterialBackend";
import { bindRawPageTransform, type ThreePageTransforms } from "./threePageTransforms";
import { createThreeMultiplyMaterial } from "./threeVectorMultiply";
import { createThreeVectorClipTexture, initializeThreeVectorClip, createThreeVectorClipMaterial } from "./threeVectorClips";
import * as THREE from "three";
import { createDefaultOptionalContentSnapshot, type OptionalContentSnapshot } from "./optionalContent";
import { ScenePaintVisibility } from "./scenePaintVisibility";
import { buildRasterStripBatches, type RasterStripBatch } from "./rasterStripBatches";
import { RASTER_STRIP_VERTEX_GLSL, RASTER_STRIP_FRAGMENT_GLSL } from "./rasterStripWebGlShaders";

import {
  CORE_RASTER_FRAGMENT_SHADER_SOURCE,
  CORE_RASTER_VERTEX_SHADER_SOURCE
} from "./coreShaders";
import type { RasterLayer, VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import {
  HEPR_THREE_LAYER_ORDER_PAGE_BACKGROUND,
  HEPR_THREE_LAYER_ORDER_RASTER
} from "./threeLayerOrder";
import type {
  ThreeRasterTileRect,
  ThreeWebGpuRasterMaterialState
} from "./threeWebGpuRasterMaterial";
import {
  rasterTilePixels,
  reportRasterTileDownscale,
  sameRasterTilePlan,
  type RasterTilePlan
} from "./rasterTiles";
import type { ThreeColorCompositing } from "./threeWebGpuColorSpace";
import type { ViewState } from "./webGlFloorplanRenderer";
import type { MonochromeRaster } from "./monochromeRaster";
import {
  automaticRasterMemoryBudget,
  estimateRasterTilePlanBytes,
  planSceneRasterMemory,
  reportRasterMemoryBudget
} from "./rasterMemoryBudget";

interface RasterLayerOptions {
  pageTransforms?: ThreePageTransforms;
  /** Initial texture limit for tiling large images; see setMaxTextureSize. */
  maxTextureSize?: number;
  materialBackend?: "webgl" | "webgpu";
  webGpu?: ThreeWebGpuBackend;
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
  /** Canonical images only; strip batches have neither. */
  image?: RasterImageState;
}

interface RasterImageState {
  rasterIndex: number;
  source: RasterLayerSource;
  plan: RasterTilePlan;
  multiply: boolean;
  /** Further tiles of an image larger than one texture, drawn as children of the image's mesh. */
  tiles: RasterTileEntry[];
}

interface RasterTileEntry extends RasterLayerEntry {
  texture: THREE.Texture;
  completionMaterial?: THREE.Material;
}

interface RasterLayerSource {
  opacity?: number;
  width: number;
  height: number;
  data: Uint8Array<ArrayBufferLike>;
  monochrome?: MonochromeRaster;
  matrix: Float32Array;
}

export class ThreeMaterialRasterLayer {
  private readonly pageTransforms: ThreePageTransforms | undefined;
  private readonly webGpu: ThreeWebGpuBackend | undefined;
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
  private pendingRasterBytes = 0;
  private readonly rasterEntries: ResidentRasterLayerEntry[] = [];
  private readonly appliedRasterLayers: (RasterLayer | undefined)[];
  private readonly stripEntries: ResidentRasterLayerEntry[] = [];
  private activeEntries: RasterLayerEntry[] = [];
  private readonly multiplyMaterials: THREE.Material[] = [];
  private readonly ownedTextures = new Set<THREE.Texture>();
  private maxRasterTextureDimension = 0;
  private maxTextureSize: number;
  private rasterTextureResidencyEnabled = false;
  private disposed = false;

  private readonly viewportUniform: THREE.Vector2;
  private readonly cameraCenterUniform: THREE.Vector2;
  private readonly zoomUniform: { value: number };
  private readonly useLocalToClipUniform: { value: number };
  private readonly localToClipUniform: THREE.Matrix4;

  constructor(scene: VectorScene, options: RasterLayerOptions) {
    this.pageTransforms = options.pageTransforms;
    this.webGpu = options.webGpu;
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
    if (this.pageTransforms && this.pageBackgroundGeometry) this.pageBackgroundGeometry.setAttribute("aPageIndex",
      new THREE.InstancedBufferAttribute(Float32Array.from({ length: pageRects.length / 4 }, (_, i) => i), 1));
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
    // The automatic scene budget applies even before a host reports its texture limit.
    this.maxTextureSize = options.maxTextureSize ?? Number.POSITIVE_INFINITY;
    // These materials upload RGBA even when their source is packed binary.
    const memoryPlan = planSceneRasterMemory(rasterSources.map(({ width, height }) => ({ width, height })), this.maxTextureSize);
    reportRasterMemoryBudget(memoryPlan, this);
    for (let rasterIndex = 0; rasterIndex < rasterSources.length; rasterIndex += 1) {
      const source = rasterSources[rasterIndex];
      const plan = memoryPlan.plans[rasterIndex];
      const textures = createRasterTileTextures(source, plan, rasterIndex, this.maxTextureSize);
      for (const texture of textures) this.ownedTextures.add(texture);
      const rasterOrderOffset = (rasterIndex + 1) / (rasterSources.length + 1);
      const entry = this.createEntry(
        textures[0],
        source.matrix,
        HEPR_THREE_LAYER_ORDER_RASTER + rasterOrderOffset,
        this.geometry,
        this.vectorClipIndices[rasterIndex] ?? -1,
        source.opacity ?? 1,
        rasterIndex,
        plan.tiles[0]
      );
      entry.mesh.userData.heprDrawRun = { kind: "raster", first: rasterIndex, count: 1 };
      const run = rasterRuns[rasterIndex];
      const multiply = !scene.paintGraph && run?.blendMode === "Multiply";
      if (multiply) this.applyMultiply(entry);
      entry.mesh.visible = false;
      const residentEntry: ResidentRasterLayerEntry = {
        ...entry,
        run,
        texture: textures[0],
        resident: false,
        image: { rasterIndex, source, plan, multiply, tiles: [] }
      };
      this.entries.push(residentEntry);
      this.rasterEntries.push(residentEntry);
      this.group.add(entry.mesh);
      this.addRasterTiles(residentEntry, textures);
    }
    this.updateMaxRasterTextureDimension();
    try {
      // 2048 is within WebGL2's minimum texture limit. The shared planner
      // applies the same per-batch and total allocation bounds as native paths.
      // Both Three backends generate ordinary image mips by linear sampling.
      const batches = memoryPlan.resolutionScale === 1 && !memoryPlan.overBudget &&
        rasterSources.length === scene.rasterLayers.length
        ? buildRasterStripBatches(scene, 2048, "linear") : [];
      let remainingBytes = memoryPlan.availableBytes - memoryPlan.estimatedBytes;
      for (const batch of batches) {
        const bytes = batch.data.byteLength + batch.instances.byteLength;
        if (bytes > remainingBytes) continue;
        this.addStripBatch(batch);
        remainingBytes -= bytes;
      }
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

  /**
   * Tile images that exceed the host renderer's texture limit. Textures upload
   * lazily, so a host calling this before its first render uploads only tiles.
   */
  setMaxTextureSize(maxTextureSize: number): void {
    if (this.disposed || maxTextureSize === this.maxTextureSize) return;
    this.maxTextureSize = maxTextureSize;
    const memoryPlan = planSceneRasterMemory(this.rasterEntries.map(entry => ({
      width: entry.image!.source.width, height: entry.image!.source.height
    })), maxTextureSize);
    reportRasterMemoryBudget(memoryPlan, this);
    if (memoryPlan.resolutionScale < 1 || memoryPlan.overBudget) this.destroyStripBatches();
    for (const [index, entry] of this.rasterEntries.entries()) {
      const image = entry.image;
      if (!image) continue;
      const plan = memoryPlan.plans[index];
      if (sameRasterTilePlan(plan, image.plan)) continue;
      this.setRasterImage(entry, image.source, plan,
        createRasterTileTextures(image.source, plan, image.rasterIndex, maxTextureSize));
    }
    this.updateMaxRasterTextureDimension();
  }

  /** Stage replacement pixels without uploading resources on a dormant material path. */
  prepareRasterLayerUpdates(updates: ReadonlyMap<number, RasterLayer>): { commit(): void; dispose(): void } {
    if (this.disposed) throw new Error("Raster material layer has been disposed.");
    for (const [index, layer] of updates) {
      if (!Number.isInteger(index) || index < 0 || index >= this.rasterEntries.length ||
          !Number.isInteger(layer.width) || !Number.isInteger(layer.height) || layer.width < 1 || layer.height < 1 ||
          !hasRasterSourcePixels(layer, true) ||
          !(layer.matrix instanceof Float32Array) || layer.matrix.length !== 6 ||
          !layer.matrix.every(Number.isFinite) || !Number.isFinite(layer.opacity ?? 1) ||
          (layer.opacity ?? 1) < 0 || (layer.opacity ?? 1) > 1) {
        throw new Error("Invalid staged raster layer update.");
      }
    }
    const staged: { index: number; layer: RasterLayer; plan: RasterTilePlan; textures: THREE.DataTexture[] }[] = [];
    let reservedBytes = 0;
    const releaseReservation = (): void => {
      this.pendingRasterBytes = Math.max(0, this.pendingRasterBytes - reservedBytes);
      reservedBytes = 0;
    };
    const disposeStaged = (): void => {
      releaseReservation();
      for (const item of staged) for (const texture of item.textures) texture.dispose();
    };
    const replacements = [...updates].filter(([index, layer]) => this.appliedRasterLayers[index] !== layer);
    const changed = new Set(replacements.map(([index]) => index));
    const budget = automaticRasterMemoryBudget();
    const unchangedBytes = this.rasterEntries.reduce((bytes, entry, index) => bytes +
      (changed.has(index) ? 0 : estimateRasterTilePlanBytes(entry.image!.plan, false)), 0);
    const oldResidentBytes = this.rasterEntries.reduce((bytes, entry) => bytes +
      (entry.resident ? estimateRasterTilePlanBytes(entry.image!.plan, false) : 0), 0) +
      this.stripEntries.reduce((bytes, entry) => {
        const image = entry.texture.image as { width: number; height: number };
        return bytes + (entry.resident ? image.width * image.height * 4 : 0);
      }, 0);
    const memoryPlan = planSceneRasterMemory(replacements.map(([, layer]) => ({ width: layer.width, height: layer.height })),
      this.maxTextureSize, Math.min(budget.bytes - unchangedBytes - this.pendingRasterBytes,
        budget.peakBytes - oldResidentBytes - this.pendingRasterBytes));
    reportRasterMemoryBudget(memoryPlan, this);
    try {
      for (const [replacementIndex, [index, layer]] of replacements.entries()) {
        const plan = memoryPlan.plans[replacementIndex];
        staged.push({ index, layer, plan, textures: createRasterTileTextures(layer, plan, index, this.maxTextureSize) });
      }
      reservedBytes = staged.reduce((bytes, item) => bytes + estimateRasterTilePlanBytes(item.plan, false), 0);
      this.pendingRasterBytes += reservedBytes;
    } catch (error) {
      disposeStaged();
      throw error;
    }
    let finished = false;
    return {
      commit: () => {
        if (finished) return;
        if (this.disposed) {
          disposeStaged();
          finished = true;
          throw new Error("Raster material layer has been disposed.");
        }
        finished = true;
        releaseReservation();
        if (staged.length > 0) this.destroyStripBatches();
        for (const { index, layer, plan, textures } of staged) {
          this.appliedRasterLayers[index] = layer;
          const entry = this.rasterEntries[index];
          this.setRasterImage(entry, layer, plan, textures);
          entry.resident = this.rasterTextureResidencyEnabled;
          entry.mesh.visible = entry.resident &&
            this.isEntryVisible(entry);
        }
        if (staged.length > 0) this.updateMaxRasterTextureDimension();
      },
      dispose: () => {
        if (finished) return;
        finished = true;
        disposeStaged();
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
        for (const tile of entry.image?.tiles ?? []) tile.texture.needsUpdate = true;
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

    // Called every frame; an unchanged color must not upload the texture again.
    if (data[0] === rgba[0] && data[1] === rgba[1] && data[2] === rgba[2] && data[3] === rgba[3]) {
      return;
    }
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
    for (const tile of entry.image?.tiles ?? []) tile.texture.dispose();
    entry.resident = false;
  }

  /** Point an image's meshes at new pixels, rebuilding its further tiles for the new plan. */
  private setRasterImage(
    entry: ResidentRasterLayerEntry,
    source: RasterLayerSource,
    plan: RasterTilePlan,
    textures: THREE.Texture[]
  ): void {
    const image = entry.image!;
    this.removeRasterTiles(entry);
    const previous = entry.texture;
    entry.texture = textures[0];
    for (const texture of textures) this.ownedTextures.add(texture);
    this.ownedTextures.delete(previous);
    previous.dispose();
    image.source = source;
    image.plan = plan;
    const tile = plan.tiles[0];
    if (entry.webGpuState?.updateSource) entry.webGpuState.updateSource(textures[0], source.matrix, source.opacity ?? 1, tile);
    else {
      const uniforms = (entry.material as THREE.RawShaderMaterial).uniforms;
      uniforms.uRasterTex.value = textures[0];
      uniforms.uRasterMatrixABCD.value.set(source.matrix[0], source.matrix[1], source.matrix[2], source.matrix[3]);
      uniforms.uRasterMatrixEF.value.set(source.matrix[4], source.matrix[5]);
      uniforms.uRasterQuad.value.fromArray(tile.quad);
      uniforms.uRasterUv.value.fromArray(tile.uv);
      uniforms.uRasterOpacity.value = source.opacity ?? 1;
    }
    this.addRasterTiles(entry, textures);
  }

  /**
   * Tiles of one image never overlap. As children of its mesh they share its
   * visibility, and paint ordering gives them its render order.
   */
  private addRasterTiles(entry: ResidentRasterLayerEntry, textures: THREE.Texture[]): void {
    const image = entry.image!;
    if (image.plan.tiles.length < 2) return;
    const completionOrder = entry.mesh.children.find(child => child.userData.heprMultiplyCompletion)?.renderOrder;
    for (let index = 1; index < image.plan.tiles.length; index++) {
      const tile = this.createEntry(textures[index], image.source.matrix, entry.mesh.renderOrder, this.geometry,
        this.vectorClipIndices[image.rasterIndex] ?? -1, image.source.opacity ?? 1, image.rasterIndex, image.plan.tiles[index]);
      const tileEntry: RasterTileEntry = {
        ...tile,
        texture: textures[index],
        completionMaterial: image.multiply ? this.applyMultiply(tile, completionOrder) : undefined
      };
      tile.mesh.userData.heprDrawRun = { ...entry.mesh.userData.heprDrawRun };
      tile.mesh.userData.heprRasterTile = true;
      image.tiles.push(tileEntry);
      this.entries.push(tileEntry);
      entry.mesh.add(tile.mesh);
    }
    this.activeEntries = this.entries.filter(item => !item.batched);
  }

  private removeRasterTiles(entry: ResidentRasterLayerEntry): void {
    const image = entry.image!;
    if (image.tiles.length === 0) return;
    for (const tile of image.tiles) {
      tile.mesh.removeFromParent();
      tile.material.dispose();
      if (tile.completionMaterial) {
        tile.completionMaterial.dispose();
        this.multiplyMaterials.splice(this.multiplyMaterials.indexOf(tile.completionMaterial), 1);
      }
      tile.texture.dispose();
      this.ownedTextures.delete(tile.texture);
      this.entries.splice(this.entries.indexOf(tile), 1);
    }
    image.tiles.length = 0;
    this.activeEntries = this.entries.filter(item => !item.batched);
  }

  /** Paint Multiply as two ordered passes; the completion pass is a child mesh. */
  private applyMultiply(entry: RasterLayerEntry, completionOrder?: number): THREE.Material {
    const original = entry.material;
    entry.mesh.material = entry.material = createThreeMultiplyMaterial(original, 0, true);
    const second = createThreeMultiplyMaterial(original, 1, true);
    original.dispose();
    this.multiplyMaterials.push(second);
    const completion = new THREE.Mesh(this.geometry, second);
    completion.frustumCulled = false;
    completion.userData.heprMultiplyCompletion = true;
    if (completionOrder !== undefined) completion.renderOrder = completionOrder;
    entry.mesh.add(completion);
    return second;
  }

  private updateMaxRasterTextureDimension(): void {
    let maximum = 0;
    for (const entry of this.rasterEntries) {
      for (const tile of entry.image?.plan.tiles ?? []) maximum = Math.max(maximum, tile.width, tile.height);
    }
    this.maxRasterTextureDimension = maximum;
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
      const pageBinding = this.pageTransforms ? { table: this.pageTransforms } : undefined;
      if (this.pageTransforms) geometry.setAttribute("aPageIndex", new THREE.InstancedBufferAttribute(
        Float32Array.from({ length: batch.count }, (_, i) => this.pageTransforms!.page("raster", batch.first + i).page!), 1));
      let webGpuState: RasterLayerEntry["webGpuState"];
      if (this.materialBackend === "webgpu") {
        const state = requireThreeWebGpuBackend(this.webGpu).createThreeWebGpuRasterStripMaterial({ pageBinding, texture, colorCompositing: this.colorCompositing,
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
      bindRawPageTransform(material, pageBinding);
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
    opacity = 1,
    rasterIndex = this.rasterEntries.length,
    tile: ThreeRasterTileRect = WHOLE_RASTER_TILE
  ): RasterLayerEntry {
    const matrix = normalizeRasterMatrix(matrixSource);
    const instancedPageBackground = geometry.hasAttribute("aPageRect");
    const pageBinding = this.pageTransforms ? instancedPageBackground ? { table: this.pageTransforms }
      : this.pageTransforms.page("raster", rasterIndex) : undefined;

    if (this.materialBackend === "webgpu") {
      const state = requireThreeWebGpuBackend(this.webGpu).createThreeWebGpuRasterMaterial({
        instancedPageBackground,
        pageBinding,
        colorCompositing: this.colorCompositing,
        opacity,
        texture,
        matrixABCD: new THREE.Vector4(matrix[0], matrix[1], matrix[2], matrix[3]),
        matrixEF: new THREE.Vector2(matrix[4], matrix[5]),
        tile,
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
      defines: instancedPageBackground ? { INSTANCED_PAGE_BACKGROUNDS: 1 } : {},
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
        uRasterQuad: { value: new THREE.Vector4().fromArray(tile.quad) },
        uRasterUv: { value: new THREE.Vector4().fromArray(tile.uv) },
        uViewport: { value: this.viewportUniform },
        uCameraCenter: { value: this.cameraCenterUniform },
        uZoom: this.zoomUniform,
        uUseLocalToClip: this.useLocalToClipUniform,
        uLocalToClip: { value: this.localToClipUniform }
      }
    });

    bindRawPageTransform(material, pageBinding);
    initializeThreeVectorClip(material, this.vectorClipTexture);
    const clippedMaterial = createThreeVectorClipMaterial(material, clipIndex);
    if (clippedMaterial !== material) material.dispose();
    const mesh = new THREE.Mesh(geometry, clippedMaterial);
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;

    return { mesh, material: clippedMaterial };
  }
}

// Background placement comes from aPageRect; ordinary rasters use their matrix.
const PAGE_BACKGROUND_PLACEMENT_MATRIX = new Float32Array([1, 0, 0, 1, 0, 0]);
const WHOLE_RASTER_TILE: ThreeRasterTileRect = { quad: [0, 0, 1, 1], uv: [0, 0, 1, 1] };

/**
 * One shared quad and a packed (x, y, width, height) instance per page.
 * Instance order matches scene.pageRects, preserving each page's identity.
 * These are document-space rectangles, not independent page transforms: any
 * future page matrix must also be applied to content, culling and interaction.
 */
function createPageBackgroundGeometry(pageRects: Float32Array): THREE.InstancedBufferGeometry | null {
  const pageCount = Math.floor(pageRects.length / 4);
  if (pageCount <= 0) {
    return null;
  }

  const rects = new Float32Array(pageCount * 4);
  for (let page = 0; page < pageCount; page += 1) {
    const rect = page * 4;
    const minX = Math.min(pageRects[rect], pageRects[rect + 2]);
    const minY = Math.min(pageRects[rect + 1], pageRects[rect + 3]);
    rects[rect] = minX;
    rects[rect + 1] = minY;
    rects[rect + 2] = Math.max(pageRects[rect], pageRects[rect + 2]) - minX;
    rects[rect + 3] = Math.max(pageRects[rect + 1], pageRects[rect + 3]) - minY;
  }

  const geometry = new THREE.InstancedBufferGeometry();
  // position supplies Three's vertex count; projection uses aCorner/aPageRect.
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  geometry.setAttribute("aCorner", new THREE.Float32BufferAttribute([-1, 1, 1, 1, 1, -1, -1, -1], 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  geometry.setAttribute("aPageRect", new THREE.InstancedBufferAttribute(rects, 4));
  geometry.instanceCount = pageCount;
  return geometry;
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

/** One premultiplied texture per tile of `plan`. */
function createRasterTileTextures(
  source: RasterLayerSource,
  plan: RasterTilePlan,
  rasterIndex: number,
  maxTextureSize: number
): THREE.DataTexture[] {
  reportRasterTileDownscale(rasterIndex, source, plan, maxTextureSize);
  const pixels = rasterTilePixels(source, plan);
  return plan.tiles.map((tile, index) => createRasterTexture(pixels[index], tile.width, tile.height));
}

function createRasterTexture(premultiplied: Uint8Array, width: number, height: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    premultiplied,
    Math.max(1, width),
    Math.max(1, height),
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
      if (width <= 0 || height <= 0) continue;
      const monochrome = layer.monochrome;
      if (!hasRasterSourcePixels(layer)) continue;
      out.push({
        width,
        height,
        get data() { return layer.data; },
        ...(monochrome ? { monochrome } : {}),
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

function hasRasterSourcePixels(source: RasterLayerSource, exactRgba = false): boolean {
  const packed = source.monochrome;
  if (packed) return packed.data instanceof Uint8Array && packed.data.length >= Math.ceil(source.width / 8) * source.height &&
    packed.colors instanceof Uint8Array && packed.colors.length === 8;
  const data = source.data;
  return data instanceof Uint8Array && (exactRgba ? data.length === source.width * source.height * 4 :
    data.length >= source.width * source.height * 4);
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
