import { requireThreeWebGpuBackend, type ThreeWebGpuBackend } from "./threeMaterialBackend";
import { bindRawPageTransform, type ThreePageTransforms } from "./threePageTransforms";
import { createThreeMultiplyMaterial } from "./threeVectorMultiply";
import { acquireThreeVectorClipTexture, initializeThreeVectorClip, createThreeVectorClipMaterial } from "./threeVectorClips";
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
  sameRasterTilePlan,
  type RasterTilePlan
} from "./rasterTiles";
import type { ThreeColorCompositing } from "./threeWebGpuColorSpace";
import type { ViewState } from "./webGlFloorplanRenderer";
import { detectMonochromeRaster, type MonochromeRaster } from "./monochromeRaster";
import { monochromeRasterFragmentGlsl } from "./monochromeRasterWebGlShader";
import { pagePlaceholderTime, pagePlaceholderVertexGlsl, pagePlaceholderFragmentGlsl } from "./pageLoadingPlaceholder";
import { assessRasterCompression, type PreparedRasterCompression, type RasterCompressionFormat } from "./rasterCompression";
import { ThreeRasterCompression } from "./threeRasterCompression";
import { createThreeRasterTileTextures, markThreeRasterTextureForUpload, threeRasterTextureInfo } from "./threeRasterTextures";
import {
  automaticRasterMemoryBudget,
  estimateRasterSourcePlanBytes,
  reportRasterMemoryBudget
} from "./rasterMemoryBudget";
import { RasterResolutionPlanner, type RasterResolutionView } from "./rasterResolution";
import { RasterResourceCache } from "./rasterResourceCache";
import { prepareRasterPixels, finishRasterUpdateSteps, finishRasterUpdateStepsAsync, type RasterPreparationJob, type PreparedRasterPixels } from "./rasterPreparation";
import { getThreeRenderPerformance } from "./threeRenderPerformance";

interface RasterLayerOptions {
  pageTransforms?: ThreePageTransforms;
  /** Current content of the same progressive document, before its replacement is installed. */
  previousLayer?: ThreeMaterialRasterLayer;
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
    Partial<Pick<ThreeWebGpuRasterMaterialState, "updateSource" | "pagePlaceholderTimeUniform">>;
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
  textures: THREE.Texture[];
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
  compressionEligible?: boolean;
  preferCompression?: boolean;
  compressionHint?: "scan";
  gpuCompression?: PreparedRasterCompression;
  gpuPreparation?: PreparedRasterPixels;
  pageIndex?: number;
  matrix: Float32Array;
}

function hasPreparedRasterCompression(source: RasterLayerSource, plan: RasterTilePlan,
  format?: RasterCompressionFormat | null): boolean {
  return !source.monochrome && !!source.gpuCompression && source.gpuCompression.format === format &&
    sameRasterTilePlan(source.gpuCompression.plan, plan) && source.gpuCompression.tiles.length === plan.tiles.length;
}

function hasPreparedRasterPixels(source: RasterLayerSource, plan: RasterTilePlan): boolean {
  return !!source.gpuPreparation && sameRasterTilePlan(source.gpuPreparation.plan, plan);
}

export class ThreeMaterialRasterLayer {
  private readonly resourceCache = new RasterResourceCache<THREE.Texture[]>(textures => {
    for (const texture of textures) texture.dispose();
  });
  private preparationRunning = false;
  private transitionProfile: ReturnType<typeof getThreeRenderPerformance> = null;
  private readonly pageTransforms: ThreePageTransforms | undefined;
  private readonly webGpu: ThreeWebGpuBackend | undefined;
  private readonly visibility: ScenePaintVisibility;
  private snapshot: OptionalContentSnapshot;
  private readonly vectorClipTexture: THREE.DataTexture;
  private readonly releaseVectorClipTexture: () => void;
  private readonly vectorClipIndices: number[];
  readonly group: THREE.Group;

  private readonly geometry: THREE.BufferGeometry;
  private readonly pageBackgroundGeometry: THREE.BufferGeometry | null;
  private readonly materialBackend: "webgl" | "webgpu";
  private readonly colorCompositing: ThreeColorCompositing;
  private readonly pageBackgroundTexture: THREE.DataTexture;
  private readonly entries: RasterLayerEntry[] = [];
  private pendingRasterBytes = 0;
  private readonly rasterResolutionPlanner = new RasterResolutionPlanner();
  private readonly compression = new ThreeRasterCompression(() => {
    this.rasterResolutionPlanner.invalidate(); this.needsResolutionUpdate = true; this.onChange?.();
  });
  private onChange: (() => void) | null = null;
  private hostRenderer: Parameters<ThreeRasterCompression["setHost"]>[0] | undefined;
  private memoryAllowance: number | undefined;
  private rasterResolutionView: RasterResolutionView | null = null;
  private rasterResolutionSources: RasterLayerSource[] | null = null;
  needsResolutionUpdate = false;
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
  private readonly pagePlaceholderTimeUniform = { value: 0 };

  constructor(scene: VectorScene, options: RasterLayerOptions) {
    this.pageTransforms = options.pageTransforms;
    this.webGpu = options.webGpu;
    this.appliedRasterLayers = [...scene.rasterLayers];
    this.visibility = new ScenePaintVisibility(scene);
    this.snapshot = createDefaultOptionalContentSnapshot(scene);
    this.visibility.setVisibility(this.snapshot);
    const clips = acquireThreeVectorClipTexture(scene);
    this.vectorClipTexture = clips.texture;
    this.releaseVectorClipTexture = clips.release;
    try {
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
      this.pageBackgroundGeometry = createPageBackgroundGeometry(pageRects, scene.pendingPagePreviews);
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
      this.rasterResolutionSources = rasterSources;
      // The automatic scene budget applies even before a host reports its texture limit.
      const previous = options.previousLayer;
      this.maxTextureSize = options.maxTextureSize ?? previous?.maxTextureSize ?? Number.POSITIVE_INFINITY;
      this.memoryAllowance = previous?.memoryAllowance;
      if (previous?.rasterTextureResidencyEnabled) {
        this.rasterResolutionView = previous.snapshotResolutionView(rasterSources);
        this.rasterResolutionPlanner.inheritTiers(previous.rasterResolutionPlanner,
          previous.rasterResolutionSources ?? [], rasterSources);
        if (previous.hostRenderer) this.setHostRenderer(previous.hostRenderer);
      }
      let initial: ReturnType<ThreeMaterialRasterLayer["createInitialRasterTextures"]>;
      try { initial = this.createInitialRasterTextures(rasterSources); }
      catch (error) { this.dispose(); throw error; }
      const { memoryPlan, textures: initialTextures } = initial;
      for (const tiles of initialTextures) for (const texture of tiles) this.ownedTextures.add(texture);
      reportRasterMemoryBudget(memoryPlan, this);
      try {
        for (let rasterIndex = 0; rasterIndex < rasterSources.length; rasterIndex += 1) {
          const source = rasterSources[rasterIndex];
          const plan = memoryPlan.plans[rasterIndex];
          const textures = initialTextures[rasterIndex];
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
            image: { rasterIndex, source, plan, multiply, tiles: [], textures }
          };
          this.entries.push(residentEntry);
          this.rasterEntries.push(residentEntry);
          this.group.add(entry.mesh);
          this.addRasterTiles(residentEntry, textures);
        }
      } catch (error) { this.dispose(); throw error; }
      this.updateMaxRasterTextureDimension();
      try {
        // 2048 is within WebGL2's minimum texture limit. The shared planner
        // applies the same per-batch and total allocation bounds as native paths.
        // Both Three backends generate ordinary image mips by linear sampling.
        const batches = memoryPlan.resolutionScale === 1 && !memoryPlan.overBudget &&
          memoryPlan.compressionFormats.every(format => !format) &&
          memoryPlan.plans.every((plan, index) => plan.width === rasterSources[index].width && plan.height === rasterSources[index].height) &&
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
    } catch (error) {
      clips.release();
      throw error;
    }
  }

  setChangeListener(listener: () => void): void { this.onChange = listener; }

  setMemoryAllowance(bytes: number): void {
    if (this.memoryAllowance === bytes) return;
    this.memoryAllowance = bytes; this.rasterResolutionPlanner.invalidate(); this.needsResolutionUpdate = true;
  }

  private availableRasterBytes(): number {
    const eligible = this.rasterResolutionSources?.some(source => source.compressionEligible) ??
      this.rasterEntries.some(entry => entry.image!.source.compressionEligible);
    const workspace = eligible
      ? this.compression.workspaceBytes : 0;
    return this.memoryAllowance ?? automaticRasterMemoryBudget().bytes - workspace;
  }

  /** Snapshot projections by page, since incoming raster indices and transform tables can differ. */
  private snapshotResolutionView(sources: RasterLayerSource[]): RasterResolutionView | null {
    const view = this.rasterResolutionView;
    if (!view) return null;
    if (!view.projection) return { ...view, ...(view.localToClip ? { localToClip: Array.from(view.localToClip) } : {}) };
    const projections = new Map<number, number[] | null>();
    if (this.pageTransforms) {
      this.pageTransforms.projectionElements.forEach((projection, page) =>
        projections.set(page, this.pageTransforms!.visibility[page] ? [...projection] : null));
    } else {
      this.rasterResolutionSources?.forEach((source, index) => {
        const projection = view.projection!(index);
        projections.set(source.pageIndex ?? 0, projection ? Array.from(projection) : null);
      });
    }
    return { ...view, projection: index => projections.get(sources[index].pageIndex ?? 0) ?? null };
  }

  private createInitialRasterTextures(sources: RasterLayerSource[]) {
    for (let attempt = 0; ; attempt++) {
      const format = this.compression.format;
      const memoryPlan = this.rasterResolutionPlanner.plan(sources, this.maxTextureSize,
        this.rasterResolutionView, this.availableRasterBytes(), format);
      const textures: THREE.Texture[][] = [];
      try {
        for (const [index, source] of sources.entries()) textures.push(this.createImageTextures(source,
          memoryPlan.plans[index], index, memoryPlan.compressionFormats[index]));
        return { memoryPlan, textures };
      } catch (error) {
        for (const tiles of textures) for (const texture of tiles) texture.dispose();
        if (attempt >= 2 || this.compression.format === format) throw error;
        this.rasterResolutionPlanner.invalidate();
        console.warn("[HEPR] Raster compression unavailable during page update; using bounded fallback textures.", error);
      }
    }
  }

  /** Allocate one document budget across independent page projections, including offscreen overview tiers. */
  planPageMemory(projections: (ArrayLike<number> | null)[], viewport: ViewportPixels): number[] {
    const sources = this.rasterResolutionSources ??= this.rasterEntries.map(entry => entry.image!.source);
    const view: RasterResolutionView = { width: viewport.width, height: viewport.height, zoom: 1,
      cameraCenterX: 0, cameraCenterY: 0, projection: index => projections[sources[index].pageIndex ?? 0] };
    const plan = this.rasterResolutionPlanner.plan(sources, this.maxTextureSize, view,
      this.availableRasterBytes(), this.compression.format);
    reportRasterMemoryBudget(plan, this);
    const allowances = projections.map(() => 0);
    sources.forEach((source,index) => {
      allowances[source.pageIndex ?? 0] += estimateRasterSourcePlanBytes({ width: source.width, height: source.height,
        monochrome: source.monochrome, reducedMonochrome: true }, plan.plans[index], plan.compressionFormats[index]);
    });
    return allowances;
  }

  setHostRenderer(renderer: Parameters<ThreeRasterCompression["setHost"]>[0]): void {
    this.hostRenderer = renderer;
    this.compression.setHost(renderer);
  }

  private rasterImageBytes(entry: ResidentRasterLayerEntry): number {
    return threeRasterTextureInfo(entry.texture).estimatedBytes +
      (entry.image?.tiles.reduce((bytes, tile) => bytes + threeRasterTextureInfo(tile.texture).estimatedBytes, 0) ?? 0);
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
    const memoryPlan = this.rasterResolutionPlanner.plan(this.rasterEntries.map(entry => entry.image!.source),
      maxTextureSize, this.rasterResolutionView, this.availableRasterBytes());
    reportRasterMemoryBudget(memoryPlan, this);
    if (memoryPlan.resolutionScale < 1 || memoryPlan.overBudget) this.destroyStripBatches();
    for (const [index, entry] of this.rasterEntries.entries()) {
      const image = entry.image;
      if (!image) continue;
      const plan = memoryPlan.plans[index];
      if (sameRasterTilePlan(plan, image.plan)) continue;
      this.setRasterImage(entry, image.source, plan,
        this.createImageTextures(image.source, plan, image.rasterIndex, memoryPlan.compressionFormats[index]));
    }
    this.updateMaxRasterTextureDimension();
    this.needsResolutionUpdate = true;
  }

  /** Stage replacement pixels without uploading resources on a dormant material path. */
  async prepareRasterLayerUpdatesAsync(updates: ReadonlyMap<number, RasterLayer>): Promise<{ commit(): void; dispose(): void }> {
    return finishRasterUpdateStepsAsync(this.prepareRasterLayerUpdateSteps(updates),
      (name, duration) => this.transitionProfile?.recordTransition(name, duration));
  }

  private replacementMemoryPlan(replacements: [number, RasterLayer][], sources = replacements.map(([, layer]) => classifyRasterSource(layer))) {
    const changed = new Set(replacements.map(([index]) => index)), budget = automaticRasterMemoryBudget();
    const unchangedBytes = this.rasterEntries.reduce((bytes, entry, index) => bytes +
      (changed.has(index) ? 0 : this.rasterImageBytes(entry)), 0);
    const residentBytes = this.rasterEntries.reduce((bytes, entry) => bytes +
      (entry.resident ? this.rasterImageBytes(entry) : 0), this.resourceCache.bytes) +
      this.stripEntries.reduce((bytes, entry) => {
        const image = entry.texture.image as { width: number; height: number };
        return bytes + (entry.resident ? image.width * image.height * 4 : 0);
      }, 0);
    const view = this.rasterResolutionView?.projection ? { ...this.rasterResolutionView,
      projection: (index: number) => this.rasterResolutionView!.projection!(replacements[index][0]) } : this.rasterResolutionView;
    return this.rasterResolutionPlanner.plan(sources, this.maxTextureSize, view,
      Math.max(0, Math.min(this.availableRasterBytes() - unchangedBytes - this.pendingRasterBytes,
        budget.peakBytes - residentBytes - this.pendingRasterBytes)), this.compression.format);
  }

  prepareRasterLayerUpdates(updates: ReadonlyMap<number, RasterLayer>): { commit(): void; dispose(): void } {
    return finishRasterUpdateSteps(this.prepareRasterLayerUpdateSteps(updates));
  }

  private *prepareRasterLayerUpdateSteps(updates: ReadonlyMap<number, RasterLayer>):
    Generator<RasterPreparationJob, { commit(): void; dispose(): void }, PreparedRasterPixels | undefined> {
    updates = new Map(updates);
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
    const staged: { index: number; layer: RasterLayer; plan: RasterTilePlan; textures: THREE.Texture[] }[] = [];
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
    const sources = replacements.map(([, layer]) => classifyRasterSource(layer));
    const memoryPlan = this.replacementMemoryPlan(replacements, sources);
    reportRasterMemoryBudget(memoryPlan, this);
    try {
      reservedBytes = memoryPlan.estimatedBytes;
      this.pendingRasterBytes += reservedBytes;
      for (const [replacementIndex, [index, layer]] of replacements.entries()) {
        const plan = memoryPlan.plans[replacementIndex], format = memoryPlan.compressionFormats[replacementIndex];
        const pixels = yield { source: sources[replacementIndex], plan,
          cached: hasPreparedRasterPixels(sources[replacementIndex], plan) || hasPreparedRasterCompression(sources[replacementIndex], plan, format) ||
            this.resourceCache.has(sources[replacementIndex], plan, format) };
        if (this.disposed) throw new DOMException("Raster material layer disposed.", "AbortError");
        staged.push({ index, layer, plan, textures: this.createImageTextures(layer, plan, index, format, pixels) });
      }
      const actualBytes = staged.reduce((bytes, item) => bytes + item.textures.reduce((sum,texture) =>
        sum + threeRasterTextureInfo(texture).estimatedBytes, 0), 0);
      this.pendingRasterBytes += actualBytes - reservedBytes;
      reservedBytes = actualBytes;
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
    if (!resident) this.resourceCache.clear();
    if (resident) {
      const sources = this.rasterResolutionSources ??= this.rasterEntries.map(entry => entry.image!.source);
      // Newly staged compressed handles are already drawable. Released handles
      // need an uncompressed budget before the host can upload them again.
      const liveCompressed = this.rasterEntries.some(entry => threeRasterTextureInfo(entry.texture).compressionFormat &&
        (entry.texture as THREE.Texture & { sourceTexture?: unknown }).sourceTexture);
      const plan = this.rasterResolutionPlanner.plan(sources, this.maxTextureSize,
        this.rasterResolutionView, this.availableRasterBytes(), liveCompressed ? this.compression.format : null);
      if (plan.resolutionScale < 1 || plan.overBudget) this.destroyStripBatches();
      for (const [index, entry] of this.rasterEntries.entries()) {
        if (entry.batched) {
          // Keep canonical meshes for replacement fallback, without traversing
          // thousands of hidden children on every Three.js frame.
          entry.mesh.removeFromParent();
          continue;
        }
        const desiredBytes = estimateRasterSourcePlanBytes({ width: sources[index].width, height: sources[index].height,
          monochrome: sources[index].monochrome, reducedMonochrome: true }, plan.plans[index], plan.compressionFormats[index]);
        const released = threeRasterTextureInfo(entry.texture).compressionFormat &&
          !(entry.texture as THREE.Texture & { sourceTexture?: unknown }).sourceTexture;
        if (released || this.rasterImageBytes(entry) > desiredBytes) {
          const image = entry.image!;
          this.setRasterImage(entry, image.source, plan.plans[index], this.createImageTextures(image.source, plan.plans[index], image.rasterIndex, plan.compressionFormats[index]));
        }
        markThreeRasterTextureForUpload(entry.texture);
        for (const tile of entry.image?.tiles ?? []) markThreeRasterTextureForUpload(tile.texture);
        entry.resident = true;
        entry.mesh.visible = this.isEntryVisible(entry);
      }
      for (const entry of this.stripEntries) {
        entry.texture.needsUpdate = true;
        entry.resident = true;
        entry.mesh.visible = this.isEntryVisible(entry);
      }
      this.needsResolutionUpdate = true;
      this.updateMaxRasterTextureDimension();
      return;
    }
    for (const entry of this.rasterEntries) {
      this.evictRasterEntry(entry);
    }
    for (const entry of this.stripEntries) this.evictRasterEntry(entry);
    this.compression.releaseWorkspace();
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
    this.transitionProfile = getThreeRenderPerformance() ?? this.transitionProfile;
    this.viewportUniform.set(Math.max(1, viewport.width), Math.max(1, viewport.height));
    this.cameraCenterUniform.set(viewState.cameraCenterX, viewState.cameraCenterY);
    this.zoomUniform.value = Math.max(1e-6, viewState.zoom);
    this.rasterResolutionView = { ...viewState, width: viewport.width, height: viewport.height,
      ...(this.useLocalToClipUniform.value ? { localToClip: this.localToClipUniform.elements } : {}),
      ...(this.pageTransforms ? { projection: (index: number) => {
        const page = this.pageTransforms!.page("raster", index).page!;
        return this.pageTransforms!.visibility[page] ? this.pageTransforms!.projectionElements[page] : null;
      } } : {}) };
    this.updateRasterResolution();
    this.pagePlaceholderTimeUniform.value = pagePlaceholderTime();
    for (const entry of this.activeEntries) {
      if (entry.webGpuState) {
        entry.webGpuState.zoomUniform.value = this.zoomUniform.value;
        if (entry.webGpuState.pagePlaceholderTimeUniform) {
          entry.webGpuState.pagePlaceholderTimeUniform.value = this.pagePlaceholderTimeUniform.value;
        }
      }
    }
  }

  private updateRasterResolution(): void {
    if (!this.rasterTextureResidencyEnabled || this.pendingRasterBytes > 0 || this.preparationRunning) return;
    const sources = this.rasterResolutionSources ??= this.rasterEntries.map(entry => entry.image!.source);
    const format = this.compression.format;
    const plan = this.rasterResolutionPlanner.plan(sources, this.maxTextureSize, this.rasterResolutionView,
      this.availableRasterBytes(), format);
    const resources = () => this.rasterEntries.map(entry => ({ rasterPlan: entry.image!.plan,
      estimatedBytes: this.rasterImageBytes(entry), compressionFormat: threeRasterTextureInfo(entry.texture).compressionFormat }));
    const index = this.rasterResolutionPlanner.nextChange(sources, resources(), plan);
    this.needsResolutionUpdate = false;
    if (index < 0) return;
    reportRasterMemoryBudget(plan, this);
    const entry = this.rasterEntries[index], source = sources[index], target = plan.plans[index];
    this.preparationRunning = true; this.needsResolutionUpdate = true;
    const started = performance.now();
    const pixels = hasPreparedRasterPixels(source, target) || hasPreparedRasterCompression(source, target, plan.compressionFormats[index]) ||
      this.resourceCache.has(source, target, plan.compressionFormats[index])
      ? Promise.resolve(undefined) : prepareRasterPixels(source, target);
    void pixels.then(pixels => {
      if (this.disposed || !this.rasterTextureResidencyEnabled || this.rasterResolutionSources !== sources || this.pendingRasterBytes > 0) return;
      const latest = this.rasterResolutionPlanner.plan(sources, this.maxTextureSize, this.rasterResolutionView, this.availableRasterBytes(), this.compression.format);
      if (!sameRasterTilePlan(latest.plans[index], target) || latest.compressionFormats[index] !== plan.compressionFormats[index]) return;
      this.transitionProfile?.recordTransition("rasterRefinement.prepare", performance.now() - started);
      const textures = this.createImageTextures(source, target, index, plan.compressionFormats[index], pixels);
      this.destroyStripBatches();
      this.setRasterImage(entry, source, target, textures);
      this.updateMaxRasterTextureDimension();
    }).catch(error => {
      // An encoder failure changes capabilities; replan on the next frame before reducing resolution.
      if (this.compression.format !== format) this.rasterResolutionPlanner.invalidate();
      else this.rasterResolutionPlanner.failed(index, plan);
      console.warn("[HEPR] Raster refinement unavailable; retaining the previous display resolution.", error);
    }).finally(() => {
      this.preparationRunning = false;
      if (!this.disposed) { this.needsResolutionUpdate = true; this.onChange?.(); }
    });
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
    this.resourceCache.clear();
    this.compression.dispose();
    this.releaseVectorClipTexture();
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
    source = classifyRasterSource(source);
    const image = entry.image!;
    const previousTextures = image.textures;
    this.removeRasterTiles(entry, false);
    const previous = entry.texture;
    entry.texture = textures[0];
    for (const texture of textures) this.ownedTextures.add(texture);
    this.ownedTextures.delete(previous);
    for (const texture of previousTextures) this.ownedTextures.delete(texture);
    if (entry.resident) this.resourceCache.park(previousTextures, previousTextures.reduce((bytes, texture) => bytes + threeRasterTextureInfo(texture).estimatedBytes, 0));
    else for (const texture of previousTextures) texture.dispose();
    image.textures = textures;
    if (image.source !== source) {
      this.rasterResolutionSources = null;
      this.rasterResolutionPlanner.invalidate();
    }
    image.source = source;
    image.plan = plan;
    const info = threeRasterTextureInfo(textures[0]);
    const tile = { quad: plan.tiles[0].quad, uv: plan.tiles[0].uv.map((value, index) => value * info.uvScale[index % 2]) };
    if (entry.webGpuState?.updateSource) entry.webGpuState.updateSource(textures[0], source.matrix, source.opacity ?? 1, tile);
    else {
      const uniforms = (entry.material as THREE.RawShaderMaterial).uniforms;
      uniforms.uRasterTex.value = textures[0];
      uniforms.uRasterMonoMips.value = info.coverage;
      uniforms.uRasterMonochrome.value = info.mode;
      uniforms.uRasterOpaque.value = info.compressionFormat ? 1 : 0;
      uniforms.uRasterMonoSize.value.copy(info.size);
      uniforms.uRasterMonoColor0.value.copy(info.color0);
      uniforms.uRasterMonoColor1.value.copy(info.color1);
      uniforms.uRasterMatrixABCD.value.set(source.matrix[0], source.matrix[1], source.matrix[2], source.matrix[3]);
      uniforms.uRasterMatrixEF.value.set(source.matrix[4], source.matrix[5]);
      uniforms.uRasterQuad.value.fromArray(tile.quad);
      uniforms.uRasterUv.value.fromArray(tile.uv);
      uniforms.uRasterOpacity.value = source.opacity ?? 1;
    }
    this.addRasterTiles(entry, textures);
    this.trimResourceCache();
  }

  private trimResourceCache(): void {
    const resident = this.rasterEntries.reduce((bytes, entry) => bytes + this.rasterImageBytes(entry), 0);
    this.resourceCache.trim(Math.max(0, this.availableRasterBytes() - resident - this.pendingRasterBytes));
  }

  private createImageTextures(source: RasterLayerSource, plan: RasterTilePlan, index: number,
    format?: RasterCompressionFormat | null, pixels?: PreparedRasterPixels): THREE.Texture[] {
    source = classifyRasterSource(source);
    const cached = this.resourceCache.take(source, plan, format);
    if (cached) {
      try { this.preloadRasterTextures(cached); }
      catch (error) { for (const texture of cached) texture.dispose(); throw error; }
      this.transitionProfile?.recordTransition("rasterUpload.cacheHit", 0); return cached;
    }
    const started = performance.now();
    const textures = createRasterTileTextures(source, plan, index, this.maxTextureSize, this.compression, format, pixels);
    try { this.preloadRasterTextures(textures); }
    catch (error) { for (const texture of textures) texture.dispose(); throw error; }
    this.transitionProfile?.recordTransition("rasterUpload.submit", performance.now() - started);
    return this.resourceCache.remember(textures, source, plan, format);
  }

  /** Warm the active host before visibility changes; initTexture reuses already uploaded versions. */
  private preloadRasterTextures(textures: readonly THREE.Texture[]): void {
    const host = this.hostRenderer;
    if (!this.rasterTextureResidencyEnabled || !host?.initTexture ||
        (host.isWebGPURenderer && (host.initialized === false || !host.backend?.device))) return;
    const started = performance.now();
    for (const texture of textures) {
      const info = threeRasterTextureInfo(texture);
      // External compressed allocations are already owned and uploaded by our encoder.
      if (info.compressionFormat) continue;
      host.initTexture(texture);
      if (info.coverage !== texture) host.initTexture(info.coverage);
    }
    this.transitionProfile?.recordTransition("rasterUpload.threeHost", performance.now() - started);
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

  private removeRasterTiles(entry: ResidentRasterLayerEntry, releaseTextures = true): void {
    const image = entry.image!;
    if (image.tiles.length === 0) return;
    for (const tile of image.tiles) {
      tile.mesh.removeFromParent();
      tile.material.dispose();
      if (tile.completionMaterial) {
        tile.completionMaterial.dispose();
        this.multiplyMaterials.splice(this.multiplyMaterials.indexOf(tile.completionMaterial), 1);
      }
      if (releaseTextures) tile.texture.dispose();
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
    const info = threeRasterTextureInfo(texture);
    tile = { quad: tile.quad, uv: tile.uv.map((value, index) => value * info.uvScale[index % 2]) };
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
      vertexShader: normalizeCoreShaderSource(instancedPageBackground
        ? pagePlaceholderVertexGlsl(CORE_RASTER_VERTEX_SHADER_SOURCE) : CORE_RASTER_VERTEX_SHADER_SOURCE),
      fragmentShader: normalizeCoreShaderSource(instancedPageBackground
        ? pagePlaceholderFragmentGlsl(monochromeRasterFragmentGlsl(CORE_RASTER_FRAGMENT_SHADER_SOURCE))
        : monochromeRasterFragmentGlsl(CORE_RASTER_FRAGMENT_SHADER_SOURCE)),
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
        uPagePlaceholderTime: this.pagePlaceholderTimeUniform,
        uRasterTex: { value: texture },
        uRasterMonoMips: { value: info.coverage },
        uRasterMonochrome: { value: info.mode },
        uRasterOpaque: { value: info.compressionFormat ? 1 : 0 },
        uRasterMonoSize: { value: info.size.clone() },
        uRasterMonoColor0: { value: info.color0.clone() },
        uRasterMonoColor1: { value: info.color1.clone() },
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
function createPageBackgroundGeometry(pageRects: Float32Array, pending?: Uint8Array): THREE.InstancedBufferGeometry | null {
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
  geometry.setAttribute("aPageLoading", new THREE.InstancedBufferAttribute(
    Float32Array.from({ length: pageCount }, (_, page) => pending?.[page] ? 1 : 0), 1));
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
  // Three WebGPU omits samplers for nearest-only textures, but the raster WGSL
  // needs one. Linear filtering samples the same solid color from this 1x1 texture.
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** One premultiplied texture per tile of `plan`. */
function createRasterTileTextures(
  source: RasterLayerSource, plan: RasterTilePlan, rasterIndex: number, maxTextureSize: number,
  compressor?: ThreeRasterCompression, format?: RasterCompressionFormat | null, pixels?: PreparedRasterPixels
): THREE.Texture[] {
  return createThreeRasterTileTextures(classifyRasterSource(source), plan, compressor, format, pixels);
}

const classifiedRasterSources = new WeakMap<RasterLayerSource, RasterLayerSource>();
function classifyRasterSource(source: RasterLayerSource): RasterLayerSource {
  if (source.compressionEligible !== undefined) return source;
  const cached = classifiedRasterSources.get(source);
  if (cached) return cached;
  const mono = source.monochrome ?? (source.gpuCompression ? undefined : detectMonochromeRaster(source.data, source.width, source.height));
  const classified = Object.defineProperties({}, Object.getOwnPropertyDescriptors(source)) as RasterLayerSource;
  if (mono) classified.monochrome = mono;
  classified.compressionEligible = !mono && (!!source.gpuCompression || assessRasterCompression(source).eligible);
  classified.preferCompression = !mono && (source.compressionHint === "scan" || !!source.gpuCompression);
  classifiedRasterSources.set(source, classified);
  return classified;
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
      if (!hasRasterSourcePixels(layer)) continue;
      const source = Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(layer),
        width: { value: width, writable: true, enumerable: true, configurable: true },
        height: { value: height, writable: true, enumerable: true, configurable: true },
        matrix: { value: layer.matrix instanceof Float32Array ? layer.matrix : new Float32Array(layer.matrix),
          writable: true, enumerable: true, configurable: true } }) as RasterLayerSource;
      out.push(classifyRasterSource(source));
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

  return out.map(classifyRasterSource);
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
