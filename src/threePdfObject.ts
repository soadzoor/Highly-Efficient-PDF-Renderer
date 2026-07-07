import * as THREE from "three";

import { createCanvasInteractionController, type CanvasInteractionController } from "./canvasInteractions";
import type { Bounds } from "./pdfVectorExtractor";
import type { LoadedPdfScene } from "./pdfObjectGenerator";
import type { RendererApi } from "./rendererTypes";
import type { ThreeCompactedStrokeLayer } from "./threeCompactedStrokeLayer";
import { ThreeMaterialFillLayer } from "./threeMaterialFillLayer";
import { ThreeMaterialPageTileLayer } from "./threeMaterialPageTileLayer";
import { ThreeMaterialRasterLayer } from "./threeMaterialRasterLayer";
import { ThreeMaterialStrokeLayer } from "./threeMaterialStrokeLayer";
import { ThreeMaterialTextLayer } from "./threeMaterialTextLayer";
import { HEPR_THREE_LAYER_ORDER_PAGE_DEPTH } from "./threeLayerOrder";
import type { ThreeTriangleStrokeLayer } from "./threeTriangleStrokeLayer";
import {
  shouldUseVectorStrokeLod,
  ThreeVectorLodStrokeLayer,
  type VectorStrokeLodStats,
  type VectorLodMode
} from "./vectorStrokeLod";
import {
  WebGlFloorplanRenderer,
  type DrawStats,
  type PageTextTileBakeRequest,
  type PageTextTileStats,
  type ViewState
} from "./webGlFloorplanRenderer";
import { WebGpuFloorplanRenderer } from "./webGpuFloorplanRenderer";

const DEFAULT_FIT_PADDING_PIXELS = 64;
const DEFAULT_INITIAL_LONG_SIDE = 2048;
const DEFAULT_MIN_CANVAS_DIMENSION = 256;
const DEFAULT_MAX_CANVAS_DIMENSION = 4096;
const DEFAULT_MAX_CANVAS_PIXELS = 4_194_304;
const PERSPECTIVE_NATIVE_OVERSAMPLE = 1.15;
const PERSPECTIVE_RESIZE_HYSTERESIS_MIN = 0.9;
const PERSPECTIVE_RESIZE_HYSTERESIS_MAX = 1.12;
const THREE_PAGE_TEXT_TILE_MIN_TEXT_INSTANCES = 150_000;
const THREE_PAGE_TEXT_TILE_ENTER_PAGE_SCREEN_PX = 176;
const THREE_PAGE_TEXT_TILE_EXIT_PAGE_SCREEN_PX = 200;
const THREE_PAGE_TEXT_TILE_RATIO_MIN = 0.75;
const THREE_PAGE_TEXT_TILE_RATIO_MAX = 1.3333333333;
const THREE_PAGE_TEXT_TILE_GUTTER_PX = 2;
const THREE_PAGE_TEXT_TILE_ATLAS_DIM = 2048;
const THREE_PAGE_TEXT_TILE_MAX_TILE_DIM = 512;
const THREE_PAGE_TEXT_TILE_BAKE_MAX_PAGES = 128;
const THREE_PAGE_TEXT_TILE_BAKE_INSTANCE_BUDGET = 300_000;
const THREE_PAGE_TEXT_TILE_STABLE_FRAMES = 3;

interface ThreePageTextTileRecord {
  hasTile: boolean;
  atlasX: number;
  atlasY: number;
  innerWidth: number;
  innerHeight: number;
  epoch: number;
}

type ThreeSceneRenderCallback = THREE.Scene["onBeforeRender"];

interface HeprSceneRenderHook {
  callback: ThreeSceneRenderCallback;
  objects: Set<HeprThreePdfObject>;
  previous: ThreeSceneRenderCallback;
}

const sceneRenderHooks = new WeakMap<THREE.Scene, HeprSceneRenderHook>();

/**
 * Native renderer backend used to upload and draw HEPR data.
 *
 * `webgl` is the broad-compatibility default. Use `webgpu` only in browsers
 * where `navigator.gpu` is available and your application already uses a
 * WebGPU-capable three.js renderer.
 */
export type HeprRendererType = "webgl" | "webgpu";

/**
 * Color accepted by HEPR option helpers.
 *
 * Supported forms:
 * - `"#ffffff"` or `"ffffff"`
 * - `0xffffff`
 * - normalized RGB tuple such as `[1, 1, 1]`
 */
export type HeprColorInput = number | string | [number, number, number];

/**
 * Options for creating a `HeprThreePdfObject`.
 *
 * Example:
 *
 * ```ts
 * const pdfObject = await pdfObjectGenerator(file, {
 *   vectorLod: "auto",
 *   pageBackground: "#ffffff",
 *   pageBackgroundOpacity: 1,
 *   vectorOverrideColor: "#111827",
 *   vectorOverrideOpacity: 0
 * });
 * scene.add(pdfObject);
 * ```
 */
export interface HeprThreeObjectOptions {
  /**
   * Native upload/render backend. Defaults to `"webgl"` when passed through
   * `pdfObjectGenerator`.
   */
  rendererType?: HeprRendererType;

  /**
   * Vector level-of-detail mode for large stroke-heavy PDFs.
   *
   * - `"auto"` enables LOD only for large scenes.
   * - `"off"` always uses exact strokes.
   * - `"force"` builds and uses LOD even below the normal size threshold.
   *
   * @default "auto"
   */
  vectorLod?: VectorLodMode;

  /**
   * Render strokes with curve-aware joins/caps where supported.
   *
   * @default true
   */
  curveStrokes?: boolean;

  /**
   * Render text as vector glyph geometry only. Raster glyph atlas rendering is
   * disabled when this is true.
   *
   * @default false
   */
  vectorOnly?: boolean;

  /**
   * Page background color behind PDF content.
   *
   * @default "#ffffff"
   */
  pageBackground?: HeprColorInput;

  /**
   * Page background alpha in the range 0..1.
   *
   * @default 1
   */
  pageBackgroundOpacity?: number;

  /**
   * Optional color override for vector content. Use with
   * `vectorOverrideOpacity` to tint or replace vector drawing colors.
   *
   * @default "#000000"
   */
  vectorOverrideColor?: HeprColorInput;

  /**
   * Strength of `vectorOverrideColor` in the range 0..1. A value of 0 preserves
   * original vector colors; 1 fully replaces them.
   *
   * @default 0
   */
  vectorOverrideOpacity?: number;
}

interface ViewportPixels {
  width: number;
  height: number;
}

interface ThreeHostRenderer {
  readonly domElement: HTMLCanvasElement | OffscreenCanvas;
  readonly capabilities?: {
    getMaxAnisotropy?: () => number;
  };
  getContext?: () => unknown;
  getDrawingBufferSize?: (target: THREE.Vector2) => THREE.Vector2;
  getSize?: (target: THREE.Vector2) => THREE.Vector2;
  getPixelRatio?: () => number;
}

interface SceneBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface DerivedThreeCameraView {
  viewState: ViewState;
  nativeViewport: ViewportPixels;
  cullingBounds?: SceneBounds;
}

interface RendererConfig {
  vectorLodMode: VectorLodMode;
  strokeCurveEnabled: boolean;
  textVectorOnly: boolean;
  pageBackground: [number, number, number, number];
  vectorOverride: [number, number, number, number];
}

/**
 * A three.js `Group` that represents a loaded PDF or parsed HEPR ZIP scene.
 *
 * Add it to your scene like any other object. HEPR derives its PDF view from
 * your `THREE.Camera` and synchronizes itself from three.js `onBeforeRender`,
 * so typical render loops do not need a separate per-frame HEPR call.
 *
 * Example:
 *
 * ```ts
 * const pdfObject = await pdfObjectGenerator(file);
 * scene.add(pdfObject);
 *
 * function frame() {
 *   renderer.render(scene, camera);
 *   requestAnimationFrame(frame);
 * }
 * ```
 */
export class HeprThreePdfObject extends THREE.Group {
  /** Human-readable source label, usually the file name or URL basename. */
  readonly sourceLabel: string;

  /** Whether this object was loaded from a PDF or a parsed-data ZIP. */
  readonly sourceKind: LoadedPdfScene["sourceKind"];

  /** Native renderer backend used internally by this object. */
  readonly rendererType: HeprRendererType;

  /** Parsed scene data backing this three.js object. Treat as read-only. */
  readonly sceneData: LoadedPdfScene["scene"];

  /** Internal native renderer. Advanced escape hatch; prefer object methods. */
  renderer: RendererApi;

  /** Built-in 2D interaction helper for the fallback viewport path. */
  readonly interactionController: CanvasInteractionController;

  /** Internal canvas used by the fallback texture pipeline. */
  renderCanvas: HTMLCanvasElement;

  /** Texture wrapping `renderCanvas`, or `null` while using material layers. */
  renderTexture: THREE.CanvasTexture | null;

  private readonly pageMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly uvArray: Float32Array;
  private readonly uvAttribute: THREE.BufferAttribute;
  private readonly sceneBounds: SceneBounds;
  private readonly localSceneBounds: SceneBounds;
  private readonly sceneCenterX: number;
  private readonly sceneCenterY: number;
  private readonly rendererConfig: RendererConfig;
  private readonly rasterMaterialLayer: ThreeMaterialRasterLayer;
  private readonly fillMaterialLayer: ThreeMaterialFillLayer;
  private strokeMaterialLayer: ThreeMaterialStrokeLayer | null;
  private readonly triangleStrokeLayer: ThreeTriangleStrokeLayer | null;
  private vectorLodStrokeLayer: ThreeVectorLodStrokeLayer | null;
  private readonly compactedStrokeLayer: ThreeCompactedStrokeLayer | null;
  private readonly textMaterialLayer: ThreeMaterialTextLayer;
  private readonly pageTileLayer: ThreeMaterialPageTileLayer;
  private readonly tilePageRects: Float32Array;
  private readonly tilePageTextRanges: Uint32Array;
  private readonly pageTileRecords: ThreePageTextTileRecord[];
  private readonly pageTileInstanceData: Float32Array;
  private readonly pageTileMaskScratch: Uint8Array;
  private readonly previousClipFromDataElements = new Float32Array(16);
  private clipFromDataStableFrames = 0;
  private pageTileShelfX = 0;
  private pageTileShelfY = 0;
  private pageTileShelfRowHeight = 0;
  private pageTileEpoch = 0;
  private pageTextTilesEnabled = true;
  private pageTileModeActive = false;
  private pageTileBakeInFlight = false;
  private lastPageTileStats: PageTextTileStats = {
    enabled: true,
    active: false,
    tiledPages: 0,
    directPages: 0,
    bakedPages: 0,
    atlasWidth: 0,
    atlasHeight: 0
  };

  private controlsCanvas: HTMLCanvasElement | null = null;
  private pendingInitialFit: boolean;
  private initialFitPaddingPixels: number;
  private lastSyncedFrameSerial = -1;
  private lastUploadedFrameSerial = -1;
  private lastViewportWidth = 0;
  private lastViewportHeight = 0;
  private textureAnisotropy = 1;
  private materialPipelineActive = false;
  private frameListener: ((stats: DrawStats) => void) | null = null;
  private lastNativeDrawStats: DrawStats | null = null;
  private isDisposed = false;
  private skipNextBeforeRenderCallback = false;
  private warnedThreeCameraUnsupported = false;
  private warnedThreeCameraPerspectiveFallback = false;
  private hookedScene: THREE.Scene | null = null;
  private readonly pagePlane = new THREE.Plane();
  private readonly pagePlanePoint = new THREE.Vector3();
  private readonly pagePlaneNormal = new THREE.Vector3();
  private readonly pageWorldInverse = new THREE.Matrix4();
  private readonly clipFromWorldMatrix = new THREE.Matrix4();
  private readonly clipFromLocalMatrix = new THREE.Matrix4();
  private readonly clipFromDataMatrix = new THREE.Matrix4();
  private readonly dataToLocalMatrix = new THREE.Matrix4();
  private readonly ndcOrigin = new THREE.Vector3();
  private readonly ndcLocalX = new THREE.Vector3();
  private readonly ndcLocalY = new THREE.Vector3();
  private readonly rayOriginNear = new THREE.Vector3();
  private readonly rayFarPoint = new THREE.Vector3();
  private readonly rayDirection = new THREE.Vector3();
  private readonly worldIntersection = new THREE.Vector3();
  private readonly localIntersection = new THREE.Vector3();
  private readonly projectedCorner0 = new THREE.Vector3();
  private readonly projectedCorner1 = new THREE.Vector3();
  private readonly projectedCorner2 = new THREE.Vector3();
  private readonly projectedCorner3 = new THREE.Vector3();
  private readonly projectedCenter = new THREE.Vector3();
  private readonly projectedBasisX = new THREE.Vector3();
  private readonly projectedBasisY = new THREE.Vector3();
  private readonly handleAddedToParent = (): void => {
    this.refreshSceneRenderHook();
  };
  private readonly handleRemovedFromParent = (): void => {
    this.detachSceneRenderHook();
  };

  /**
   * Internal constructor used by `createThreePdfObject`.
   *
   * Application code should create objects with `pdfObjectGenerator(source,
   * options)` or `createThreePdfObject(loadedScene, options)` instead of
   * calling this constructor directly.
   */
  constructor(
    loadedScene: LoadedPdfScene,
    rendererType: HeprRendererType,
    renderer: RendererApi,
    renderCanvas: HTMLCanvasElement,
    renderTexture: THREE.CanvasTexture | null,
    rendererConfig: RendererConfig,
    initialFitPaddingPixels: number,
    rasterMaterialLayer: ThreeMaterialRasterLayer,
    fillMaterialLayer: ThreeMaterialFillLayer,
    strokeMaterialLayer: ThreeMaterialStrokeLayer | null,
    triangleStrokeLayer: ThreeTriangleStrokeLayer | null,
    vectorLodStrokeLayer: ThreeVectorLodStrokeLayer | null,
    compactedStrokeLayer: ThreeCompactedStrokeLayer | null,
    textMaterialLayer: ThreeMaterialTextLayer,
    pageMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
    uvArray: Float32Array,
    uvAttribute: THREE.BufferAttribute
  ) {
    super();
    this.sourceLabel = loadedScene.sourceLabel;
    this.sourceKind = loadedScene.sourceKind;
    this.sceneData = loadedScene.scene;
    this.rendererType = rendererType;
    this.renderer = renderer;
    this.renderCanvas = renderCanvas;
    this.renderTexture = renderTexture;
    this.rendererConfig = rendererConfig;
    this.rasterMaterialLayer = rasterMaterialLayer;
    this.fillMaterialLayer = fillMaterialLayer;
    this.strokeMaterialLayer = strokeMaterialLayer;
    this.triangleStrokeLayer = triangleStrokeLayer;
    this.vectorLodStrokeLayer = vectorLodStrokeLayer;
    this.compactedStrokeLayer = compactedStrokeLayer;
    this.textMaterialLayer = textMaterialLayer;
    this.pageMesh = pageMesh;
    this.uvArray = uvArray;
    this.uvAttribute = uvAttribute;
    this.pendingInitialFit = true;
    this.initialFitPaddingPixels = Math.max(0, initialFitPaddingPixels);
    this.sceneBounds = normalizeBounds(resolveSceneFitBounds(loadedScene.scene));
    this.sceneCenterX = (this.sceneBounds.minX + this.sceneBounds.maxX) * 0.5;
    this.sceneCenterY = (this.sceneBounds.minY + this.sceneBounds.maxY) * 0.5;
    this.localSceneBounds = {
      minX: this.sceneBounds.minX - this.sceneCenterX,
      minY: this.sceneBounds.minY - this.sceneCenterY,
      maxX: this.sceneBounds.maxX - this.sceneCenterX,
      maxY: this.sceneBounds.maxY - this.sceneCenterY
    };
    this.dataToLocalMatrix.makeTranslation(-this.sceneCenterX, -this.sceneCenterY, 0);
    this.interactionController = createCanvasInteractionController(() => this.renderer);
    this.renderer.setInteractionViewportProvider(() => this.resolveInteractionViewportRect());
    this.attachNativeFrameListener(this.renderer);
    this.addEventListener("added", this.handleAddedToParent);
    this.addEventListener("removed", this.handleRemovedFromParent);

    this.name = loadedScene.sourceLabel;
    this.add(this.pageMesh);
    this.rasterMaterialLayer.setVisible(false);
    this.add(this.rasterMaterialLayer.group);
    this.fillMaterialLayer.setVisible(false);
    this.add(this.fillMaterialLayer.mesh);
    if (this.strokeMaterialLayer) {
      this.strokeMaterialLayer.setVisible(false);
      this.add(this.strokeMaterialLayer.mesh);
    }
    if (this.triangleStrokeLayer) {
      this.triangleStrokeLayer.setVisible(false);
      this.add(this.triangleStrokeLayer.mesh);
    }
    if (this.vectorLodStrokeLayer) {
      this.vectorLodStrokeLayer.deactivate();
      this.add(this.vectorLodStrokeLayer.group);
    }
    if (this.compactedStrokeLayer) {
      this.compactedStrokeLayer.deactivate();
      this.add(this.compactedStrokeLayer.group);
    }
    this.textMaterialLayer.setVisible(false);
    this.add(this.textMaterialLayer.mesh);

    this.tilePageRects = normalizeObjectPageRects(loadedScene.scene);
    this.tilePageTextRanges = normalizeObjectPageTextRanges(
      loadedScene.scene,
      this.tilePageRects,
      loadedScene.scene.textInstanceCount
    );
    const tilePageCount = Math.floor(this.tilePageRects.length / 4);
    this.pageTileRecords = new Array(tilePageCount);
    for (let i = 0; i < tilePageCount; i += 1) {
      this.pageTileRecords[i] = {
        hasTile: false,
        atlasX: 0,
        atlasY: 0,
        innerWidth: 0,
        innerHeight: 0,
        epoch: -1
      };
    }
    this.pageTileInstanceData = new Float32Array(Math.max(8, tilePageCount * 8));
    this.pageTileMaskScratch = new Uint8Array(Math.max(1, tilePageCount));
    this.pageTileLayer = new ThreeMaterialPageTileLayer({
      materialBackend: rendererType === "webgpu" ? "webgpu" : "webgl",
      atlasWidth: THREE_PAGE_TEXT_TILE_ATLAS_DIM,
      atlasHeight: THREE_PAGE_TEXT_TILE_ATLAS_DIM,
      maxTileCount: Math.max(1, tilePageCount)
    });
    this.add(this.pageTileLayer.mesh);

    this.userData.hepr = {
      sourceLabel: this.sourceLabel,
      sourceKind: this.sourceKind,
      rendererType: this.rendererType,
      renderer: this.renderer
    };

    this.configureThreeMaterialPipeline();
  }

  /**
   * Attach HEPR's built-in pointer controls to a canvas.
   *
   * Most three.js applications already use `OrbitControls`, `MapControls`, or
   * custom controls; in that case do not call this method. It exists for the
   * self-contained fallback viewport path.
   */
  attachControls(targetCanvas: HTMLCanvasElement): void {
    if (this.controlsCanvas === targetCanvas) {
      return;
    }
    if (this.controlsCanvas) {
      throw new Error("Controls are already attached. Create a new object or reuse the same canvas.");
    }
    this.interactionController.attach(targetCanvas);
    this.controlsCanvas = targetCanvas;
  }

  /**
   * Fit the internal HEPR view to the full PDF bounds.
   *
   * In camera-driven three.js integrations, applications often position their
   * own camera instead. Use this method when you want HEPR's fallback view
   * state to frame the source.
   *
   * @param paddingPixels Padding in device pixels around the fitted PDF.
   */
  fitToBounds(paddingPixels = DEFAULT_FIT_PADDING_PIXELS): void {
    this.pendingInitialFit = false;
    this.initialFitPaddingPixels = Math.max(0, paddingPixels);
    const fitViewport = this.resolveKnownViewportPixelsForFit();
    if (fitViewport) {
      this.resizeNativeRendererCanvas(fitViewport);
    }
    this.renderer.fitToBounds(resolveSceneFitBounds(this.sceneData), this.initialFitPaddingPixels);
  }

  /**
   * Read the current HEPR view state.
   *
   * The returned values are in PDF scene coordinates. In camera-driven mode
   * this is the view derived from the current three.js camera after the latest
   * prepared frame.
   */
  getViewState(): ViewState {
    return this.renderer.getViewState();
  }

  /**
   * Return Vector LOD statistics for diagnostics, or `null` when Vector LOD is
   * inactive.
   */
  getVectorStrokeLodStats(): VectorStrokeLodStats | null {
    return this.vectorLodStrokeLayer?.getStats() ?? this.renderer.getVectorStrokeLodStats?.() ?? null;
  }

  /**
   * Return the current rendered stroke segment count when it is known.
   *
   * This is useful for debug HUDs. Returns `null` when the active pipeline does
   * not expose a separate stroke count.
   */
  getRenderedStrokeSegmentCount(): number | null {
    if (this.vectorLodStrokeLayer?.group.visible) {
      return this.vectorLodStrokeLayer.getRenderedSegmentCount();
    }
    if (this.strokeMaterialLayer?.mesh.visible) {
      return this.strokeMaterialLayer.getRenderedSegmentCount();
    }
    if (this.triangleStrokeLayer?.mesh.visible) {
      return this.triangleStrokeLayer.getRenderedSegmentCount();
    }
    if (this.compactedStrokeLayer?.group.visible) {
      return this.compactedStrokeLayer.getRenderedSegmentCount();
    }

    const nativeLodStats = this.renderer.getVectorStrokeLodStats?.();
    if (nativeLodStats && nativeLodStats.totalLevels > 1) {
      return nativeLodStats.renderedSegments;
    }

    return null;
  }

  /**
   * Return the most recent native renderer draw stats, or `null` before the
   * first native frame.
   */
  getNativeDrawStats(): DrawStats | null {
    return this.lastNativeDrawStats ? { ...this.lastNativeDrawStats } : null;
  }

  /**
   * Subscribe to native frame statistics.
   *
   * Pass `null` to clear the listener.
   */
  setFrameListener(listener: ((stats: DrawStats) => void) | null): void {
    this.frameListener = listener;
  }

  /**
   * Manually synchronize HEPR with a three.js renderer/camera before rendering.
   *
   * This is optional for normal three.js usage because the object installs an
   * internal `onBeforeRender` hook. Use it only for advanced render pipelines
   * where you intentionally need to prepare HEPR before three.js reaches the
   * PDF object during scene traversal.
   *
   * Example:
   *
   * ```ts
   * pdfObject.prepareFrameForThreeRenderer(renderer, camera);
   * renderer.render(scene, camera);
   * ```
   */
  prepareFrameForThreeRenderer(renderer: ThreeHostRenderer, camera: THREE.Camera): void {
    if (this.isDisposed) {
      return;
    }
    this.syncBeforeRender(renderer, camera);
    this.skipNextBeforeRenderCallback = true;
  }

  /**
   * Change Vector LOD mode at runtime.
   *
   * Use `"auto"` for normal use, `"off"` for exact strokes, and `"force"` to
   * always use LOD when supported.
   */
  setVectorLodMode(mode: VectorLodMode): void {
    if (this.isDisposed) {
      return;
    }

    const nextMode = normalizeVectorLodMode(mode);
    const useVectorLodLayer = this.shouldUseThreeVectorLodLayer(nextMode);
    const useExactMaterialLayer = !useVectorLodLayer;
    const hasExpectedLayer =
      (useVectorLodLayer && this.vectorLodStrokeLayer !== null && this.strokeMaterialLayer === null) ||
      (useExactMaterialLayer && this.strokeMaterialLayer !== null && this.vectorLodStrokeLayer === null) ||
      (!useVectorLodLayer && !useExactMaterialLayer && this.strokeMaterialLayer === null && this.vectorLodStrokeLayer === null);

    this.rendererConfig.vectorLodMode = nextMode;
    this.renderer.setVectorLodMode?.(useVectorLodLayer || useExactMaterialLayer ? "off" : nextMode);

    if (!hasExpectedLayer) {
      this.rebuildThreeStrokeLayer(useVectorLodLayer, useExactMaterialLayer);
    }

    this.resetRenderPipelinesAfterLayerChange();
  }

  /**
   * Enable or disable curve-aware stroke rendering where supported.
   */
  setStrokeCurveEnabled(enabled: boolean): void {
    if (this.isDisposed) {
      return;
    }
    this.rendererConfig.strokeCurveEnabled = Boolean(enabled);
    this.renderer.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
    this.vectorLodStrokeLayer?.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
    this.strokeMaterialLayer?.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
    this.textMaterialLayer.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
    this.invalidatePageTextTiles();
  }

  /**
   * Enable or disable baked page text tiles for far-zoom text rendering.
   */
  setPageTextTilesEnabled(enabled: boolean): void {
    const nextEnabled = Boolean(enabled);
    if (this.pageTextTilesEnabled === nextEnabled) {
      return;
    }
    this.pageTextTilesEnabled = nextEnabled;
    this.invalidatePageTextTiles();
    if (!nextEnabled) {
      this.pageTileLayer.setVisible(false);
      this.pageTileModeActive = false;
    }
  }

  /**
   * Return page text tile diagnostics for the last prepared frame.
   */
  getPageTextTileStats(): PageTextTileStats {
    return { ...this.lastPageTileStats };
  }

  /**
   * Set the page background color.
   *
   * All channels are normalized floats in the range 0..1.
   */
  setPageBackgroundColor(red: number, green: number, blue: number, alpha: number): void {
    if (this.isDisposed) {
      return;
    }
    this.rendererConfig.pageBackground = [red, green, blue, alpha];
    this.renderer.setPageBackgroundColor(red, green, blue, alpha);
    this.rasterMaterialLayer.setPageBackgroundColor(red, green, blue, alpha);
  }

  /**
   * Blend vector drawing colors toward a single override color.
   *
   * Color channels and opacity are normalized floats in the range 0..1.
   * `opacity = 0` preserves source colors; `opacity = 1` fully replaces them.
   */
  setVectorColorOverride(red: number, green: number, blue: number, opacity: number): void {
    if (this.isDisposed) {
      return;
    }
    this.rendererConfig.vectorOverride = [red, green, blue, opacity];
    this.renderer.setVectorColorOverride(red, green, blue, opacity);
    this.fillMaterialLayer.setVectorOverride(red, green, blue, opacity);
    this.vectorLodStrokeLayer?.setVectorOverride(red, green, blue, opacity);
    this.compactedStrokeLayer?.setVectorOverride(red, green, blue, opacity);
    this.triangleStrokeLayer?.setVectorOverride(red, green, blue, opacity);
    this.strokeMaterialLayer?.setVectorOverride(red, green, blue, opacity);
    this.textMaterialLayer.setVectorOverride(red, green, blue, opacity);
    this.invalidatePageTextTiles();
  }

  /**
   * Set the internal HEPR view state.
   *
   * The next prepared frame derives this state from the three.js camera again,
   * so this is mainly useful for inspecting or temporarily overriding fallback
   * native view state.
   */
  setViewState(viewState: ViewState): void {
    this.pendingInitialFit = false;
    this.renderer.setViewState(viewState);
  }

  /**
   * Dispose GPU resources, textures, geometry, event listeners, and the native
   * renderer owned by this object.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.skipNextBeforeRenderCallback = false;
    this.frameListener = null;
    this.renderer.setFrameListener(null);
    this.renderer.setInteractionViewportProvider(null);
    this.renderer.dispose();
    this.removeEventListener("added", this.handleAddedToParent);
    this.removeEventListener("removed", this.handleRemovedFromParent);
    this.detachSceneRenderHook();
    this.pageMesh.onBeforeRender = () => {};
    this.pageMesh.geometry.dispose();
    this.pageMesh.material.dispose();
    this.rasterMaterialLayer.dispose();
    this.fillMaterialLayer.dispose();
    this.strokeMaterialLayer?.dispose();
    this.triangleStrokeLayer?.dispose();
    this.vectorLodStrokeLayer?.dispose();
    this.compactedStrokeLayer?.dispose();
    this.textMaterialLayer.dispose();
    this.pageTileLayer.dispose();
    this.remove(this.pageTileLayer.mesh);
    this.renderTexture?.dispose();
    this.remove(this.pageMesh);
    this.remove(this.rasterMaterialLayer.group);
    this.remove(this.fillMaterialLayer.mesh);
    if (this.strokeMaterialLayer) {
      this.remove(this.strokeMaterialLayer.mesh);
    }
    if (this.triangleStrokeLayer) {
      this.remove(this.triangleStrokeLayer.mesh);
    }
    if (this.vectorLodStrokeLayer) {
      this.remove(this.vectorLodStrokeLayer.group);
    }
    if (this.compactedStrokeLayer) {
      this.remove(this.compactedStrokeLayer.group);
    }
    this.remove(this.textMaterialLayer.mesh);
    this.interactionController.detach();
    this.controlsCanvas = null;
  }

  private shouldUseThreeVectorLodLayer(mode: VectorLodMode): boolean {
    return shouldUseVectorStrokeLod(mode, this.rendererType, this.sceneData.segmentCount);
  }

  private rebuildThreeStrokeLayer(useVectorLodLayer: boolean, useExactMaterialLayer: boolean): void {
    this.disposeThreeStrokeLayers();

    if (useVectorLodLayer) {
      this.vectorLodStrokeLayer = new ThreeVectorLodStrokeLayer(this.sceneData, {
        materialBackend: this.rendererType === "webgpu" ? "webgpu" : "webgl",
        strokeCurveEnabled: this.rendererConfig.strokeCurveEnabled,
        vectorOverride: this.rendererConfig.vectorOverride
      });
      this.vectorLodStrokeLayer.deactivate();
      this.add(this.vectorLodStrokeLayer.group);
      return;
    }

    if (useExactMaterialLayer) {
      this.strokeMaterialLayer = new ThreeMaterialStrokeLayer(this.sceneData, {
        materialBackend: this.rendererType === "webgpu" ? "webgpu" : "webgl",
        strokeCurveEnabled: this.rendererConfig.strokeCurveEnabled,
        vectorOverride: this.rendererConfig.vectorOverride
      });
      this.strokeMaterialLayer.setVisible(false);
      this.add(this.strokeMaterialLayer.mesh);
    }
  }

  private disposeThreeStrokeLayers(): void {
    if (this.strokeMaterialLayer) {
      this.remove(this.strokeMaterialLayer.mesh);
      this.strokeMaterialLayer.dispose();
      this.strokeMaterialLayer = null;
    }
    if (this.vectorLodStrokeLayer) {
      this.remove(this.vectorLodStrokeLayer.group);
      this.vectorLodStrokeLayer.dispose();
      this.vectorLodStrokeLayer = null;
    }
  }

  private resetRenderPipelinesAfterLayerChange(): void {
    this.strokeMaterialLayer?.setVisible(false);
    this.triangleStrokeLayer?.setVisible(false);
    this.vectorLodStrokeLayer?.deactivate();
    this.compactedStrokeLayer?.deactivate();
    this.materialPipelineActive = false;
    this.lastSyncedFrameSerial = -1;
    this.lastUploadedFrameSerial = -1;
    this.lastViewportWidth = 0;
    this.lastViewportHeight = 0;
    this.configureThreeMaterialPipeline();
  }

  handleBeforeRender(renderer: ThreeHostRenderer, camera: THREE.Camera): void {
    this.refreshSceneRenderHook();
    if (this.skipNextBeforeRenderCallback) {
      this.skipNextBeforeRenderCallback = false;
      return;
    }
    this.syncBeforeRender(renderer, camera);
  }

  private refreshSceneRenderHook(): void {
    if (this.isDisposed) {
      return;
    }
    const scene = findAncestorScene(this);
    if (scene === this.hookedScene) {
      if (scene) {
        installSceneRenderHook(scene, this);
      }
      return;
    }

    this.detachSceneRenderHook();
    if (!scene) {
      return;
    }

    installSceneRenderHook(scene, this);
    this.hookedScene = scene;
  }

  private detachSceneRenderHook(): void {
    const scene = this.hookedScene;
    if (!scene) {
      return;
    }
    removeSceneRenderHookObject(scene, this);
    this.hookedScene = null;
  }

  private syncBeforeRender(renderer: ThreeHostRenderer, camera: THREE.Camera): void {
    if (this.isDisposed) {
      return;
    }

    const rendererViewport = readThreeRendererViewportPixels(renderer);
    this.updateTextureSampling(renderer);
    const cameraType = camera as { isPerspectiveCamera?: boolean };
    const perspectiveThreeCameraMode = cameraType.isPerspectiveCamera === true;
    const derivedView = this.deriveViewStateFromThreeCamera(camera, rendererViewport);
    const cameraDrivenMaterialPipelineEnabled = this.hasCompleteMaterialLayers() && derivedView !== null;

    let nativeViewport = rendererViewport;
    let nativeViewChanged = false;
    const materialCullingBounds = cameraDrivenMaterialPipelineEnabled
      ? derivedView.cullingBounds ?? null
      : null;

    if (cameraDrivenMaterialPipelineEnabled) {
      this.warnedThreeCameraPerspectiveFallback = false;
      nativeViewport = derivedView.nativeViewport;
      const previousView = this.renderer.getViewState();
      if (!isViewStateApproxEqual(previousView, derivedView.viewState)) {
        this.renderer.setViewState(derivedView.viewState);
        nativeViewChanged = true;
      }
      this.pendingInitialFit = false;
    } else if (perspectiveThreeCameraMode) {
      if (!this.warnedThreeCameraPerspectiveFallback) {
        this.warnedThreeCameraPerspectiveFallback = true;
        console.warn(
          "[HEPR] PerspectiveCamera uses adaptive texture fallback because the PDF plane could not be projected from the current camera."
        );
      }
      const perspectiveView = this.derivePerspectiveFallbackViewState(camera as THREE.PerspectiveCamera, rendererViewport);
      if (perspectiveView) {
        this.warnedThreeCameraPerspectiveFallback = false;
        nativeViewport = perspectiveView.nativeViewport;
        this.resizeNativeRendererCanvas(nativeViewport);
        const previousView = this.renderer.getViewState();
        if (!isViewStateApproxEqual(previousView, perspectiveView.viewState)) {
          this.renderer.setViewState(perspectiveView.viewState);
          nativeViewChanged = true;
        }
        this.pendingInitialFit = false;
      } else {
        this.resizeNativeRendererCanvas(nativeViewport);
      }
    } else {
      this.warnedThreeCameraPerspectiveFallback = false;
      if (derivedView) {
        nativeViewport = derivedView.nativeViewport;
        this.resizeNativeRendererCanvas(nativeViewport);
        this.renderer.setViewState(derivedView.viewState);
        this.pendingInitialFit = false;
        nativeViewChanged = true;
      } else {
        this.resizeNativeRendererCanvas(nativeViewport);
      }
    }

    if (cameraDrivenMaterialPipelineEnabled) {
      this.configureThreeMaterialPipeline();
    } else {
      this.configureNativeTexturePipeline();
    }

    const viewportChanged = nativeViewport.width !== this.lastViewportWidth || nativeViewport.height !== this.lastViewportHeight;
    if (this.pendingInitialFit) {
      this.renderer.fitToBounds(resolveSceneFitBounds(this.sceneData), this.initialFitPaddingPixels);
      this.pendingInitialFit = false;
      nativeViewChanged = true;
    }

    const shouldRenderThreeCameraFrame =
      !cameraDrivenMaterialPipelineEnabled &&
      (
        !perspectiveThreeCameraMode ||
        nativeViewChanged ||
        viewportChanged
      );
    const shouldRenderExternally =
      shouldRenderThreeCameraFrame ||
      (this.rendererType === "webgpu" && !cameraDrivenMaterialPipelineEnabled);
    if (shouldRenderExternally) {
      this.renderer.renderExternalFrame?.(performance.now());
    }

    const materialLayerViewport = cameraDrivenMaterialPipelineEnabled ? rendererViewport : nativeViewport;
    const localUnitsPerPixel = this.updateMaterialLayerTransforms(
      camera,
      materialLayerViewport,
      cameraDrivenMaterialPipelineEnabled
    );
    this.updateStrokeLodVisibility(localUnitsPerPixel, cameraDrivenMaterialPipelineEnabled);
    this.updatePageTextTiles(cameraDrivenMaterialPipelineEnabled, materialCullingBounds, materialLayerViewport);

    const presentedFrameSerial = this.renderer.getPresentedFrameSerial();
    if (
      viewportChanged ||
      presentedFrameSerial !== this.lastSyncedFrameSerial ||
      cameraDrivenMaterialPipelineEnabled
    ) {
      const viewState =
        cameraDrivenMaterialPipelineEnabled && derivedView
          ? derivedView.viewState
          : this.renderer.getPresentedViewState();
      if (!cameraDrivenMaterialPipelineEnabled && this.renderTexture) {
        if (perspectiveThreeCameraMode) {
          this.updateUvToFullPage();
        } else {
          this.updateUvFromViewState(viewState, nativeViewport);
        }
      }
      if (this.rasterMaterialLayer.group.visible) {
        this.rasterMaterialLayer.updateFrame(viewState, materialLayerViewport);
      }
      if (this.fillMaterialLayer.mesh.visible) {
        this.fillMaterialLayer.updateFrame(viewState, materialLayerViewport, materialCullingBounds);
      }
      if (this.strokeMaterialLayer && this.strokeMaterialLayer.mesh.visible) {
        this.strokeMaterialLayer.updateFrame(viewState, materialLayerViewport, materialCullingBounds);
      }
      if (this.triangleStrokeLayer && this.triangleStrokeLayer.mesh.visible) {
        this.triangleStrokeLayer.updateFrame(viewState, materialLayerViewport, materialCullingBounds);
      }
      if (this.vectorLodStrokeLayer && this.vectorLodStrokeLayer.group.visible) {
        this.vectorLodStrokeLayer.updateFrame(viewState, materialLayerViewport, materialCullingBounds);
      }
      if (this.textMaterialLayer.mesh.visible) {
        this.textMaterialLayer.updateFrame(viewState, materialLayerViewport, materialCullingBounds);
      }
      if (this.pageTileLayer.mesh.visible) {
        this.pageTileLayer.updateFrame(viewState, materialLayerViewport);
      }
      this.lastSyncedFrameSerial = presentedFrameSerial;
      this.lastViewportWidth = nativeViewport.width;
      this.lastViewportHeight = nativeViewport.height;
    }

    if (
      !cameraDrivenMaterialPipelineEnabled &&
      this.renderTexture &&
      presentedFrameSerial !== this.lastUploadedFrameSerial
    ) {
      this.renderTexture.needsUpdate = true;
      this.lastUploadedFrameSerial = presentedFrameSerial;
    }
  }

  private resizeNativeRendererCanvas(viewport: ViewportPixels): void {
    const clampedViewport = clampViewportPixels(viewport);
    const width = clampedViewport.width;
    const height = clampedViewport.height;
    if (this.renderCanvas.width === width && this.renderCanvas.height === height) {
      return;
    }

    const previousView = this.renderer.getViewState();
    this.renderCanvas.width = width;
    this.renderCanvas.height = height;
    this.renderer.setViewState(previousView);
    this.lastSyncedFrameSerial = -1;
    this.lastUploadedFrameSerial = -1;
  }

  private updateTextureSampling(renderer: ThreeHostRenderer): void {
    if (!this.renderTexture) {
      this.textureAnisotropy = 1;
      return;
    }

    const maxAnisotropy = Math.max(1, renderer.capabilities?.getMaxAnisotropy?.() ?? 1);
    if (this.textureAnisotropy === maxAnisotropy && this.renderTexture.anisotropy === maxAnisotropy) {
      return;
    }

    this.textureAnisotropy = maxAnisotropy;
    this.renderTexture.anisotropy = maxAnisotropy;
    this.renderTexture.needsUpdate = true;
  }

  private hasCompleteMaterialLayers(): boolean {
    return this.hasThreeStrokeMaterialLayer();
  }

  private hasThreeStrokeMaterialLayer(): boolean {
    return (
      this.strokeMaterialLayer !== null ||
      this.triangleStrokeLayer !== null ||
      this.vectorLodStrokeLayer !== null ||
      this.compactedStrokeLayer !== null
    );
  }

  private configureNativeTexturePipeline(): void {
    const wasMaterialPipelineActive = this.materialPipelineActive;
    this.materialPipelineActive = false;

    this.rasterMaterialLayer.setVisible(false);
    this.fillMaterialLayer.setVisible(false);
    this.strokeMaterialLayer?.setVisible(false);
    this.triangleStrokeLayer?.setVisible(false);
    this.vectorLodStrokeLayer?.deactivate();
    this.compactedStrokeLayer?.deactivate();
    this.textMaterialLayer.setVisible(false);
    this.renderer.setRasterRenderingEnabled?.(true);
    this.renderer.setFillRenderingEnabled?.(true);
    this.renderer.setStrokeRenderingEnabled?.(true);
    this.renderer.setTextRenderingEnabled?.(true);

    if (!this.renderTexture) {
      this.renderTexture = createRenderCanvasTexture(this.renderCanvas);
      const previousMaterial = this.pageMesh.material;
      this.pageMesh.material = createTexturedPageMaterial(this.renderTexture);
      previousMaterial.dispose();
    }

    this.pageMesh.frustumCulled = true;
    this.pageMesh.renderOrder = 0;

    if (wasMaterialPipelineActive) {
      this.lastSyncedFrameSerial = -1;
      this.lastUploadedFrameSerial = -1;
      this.lastViewportWidth = 0;
      this.lastViewportHeight = 0;
    }
  }

  private configureThreeMaterialPipeline(): void {
    if (!this.hasCompleteMaterialLayers()) {
      this.configureNativeTexturePipeline();
      return;
    }

    const wasMaterialPipelineActive = this.materialPipelineActive;
    this.materialPipelineActive = true;

    this.rasterMaterialLayer.setVisible(true);
    this.rasterMaterialLayer.setPageBackgroundColor(
      this.rendererConfig.pageBackground[0],
      this.rendererConfig.pageBackground[1],
      this.rendererConfig.pageBackground[2],
      this.rendererConfig.pageBackground[3]
    );
    this.fillMaterialLayer.setVisible(true);
    this.fillMaterialLayer.setVectorOverride(
      this.rendererConfig.vectorOverride[0],
      this.rendererConfig.vectorOverride[1],
      this.rendererConfig.vectorOverride[2],
      this.rendererConfig.vectorOverride[3]
    );
    if (this.vectorLodStrokeLayer) {
      this.strokeMaterialLayer?.setVisible(false);
      this.triangleStrokeLayer?.setVisible(false);
      this.compactedStrokeLayer?.deactivate();
      this.vectorLodStrokeLayer.setVisible(true);
      this.vectorLodStrokeLayer.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
      this.vectorLodStrokeLayer.setVectorOverride(
        this.rendererConfig.vectorOverride[0],
        this.rendererConfig.vectorOverride[1],
        this.rendererConfig.vectorOverride[2],
        this.rendererConfig.vectorOverride[3]
      );
    } else if (this.compactedStrokeLayer) {
      this.strokeMaterialLayer?.setVisible(false);
      this.triangleStrokeLayer?.setVisible(false);
      this.compactedStrokeLayer.setVectorOverride(
        this.rendererConfig.vectorOverride[0],
        this.rendererConfig.vectorOverride[1],
        this.rendererConfig.vectorOverride[2],
        this.rendererConfig.vectorOverride[3]
      );
    } else if (this.triangleStrokeLayer) {
      this.strokeMaterialLayer?.setVisible(false);
      this.triangleStrokeLayer.setVisible(true);
      this.triangleStrokeLayer.setVectorOverride(
        this.rendererConfig.vectorOverride[0],
        this.rendererConfig.vectorOverride[1],
        this.rendererConfig.vectorOverride[2],
        this.rendererConfig.vectorOverride[3]
      );
    } else {
      this.strokeMaterialLayer?.setVisible(true);
      this.strokeMaterialLayer?.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
      this.strokeMaterialLayer?.setVectorOverride(
        this.rendererConfig.vectorOverride[0],
        this.rendererConfig.vectorOverride[1],
        this.rendererConfig.vectorOverride[2],
        this.rendererConfig.vectorOverride[3]
      );
    }
    this.textMaterialLayer.setVisible(true);
    this.textMaterialLayer.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
    this.textMaterialLayer.setTextVectorOnly(this.rendererConfig.textVectorOnly);
    this.textMaterialLayer.setVectorOverride(
      this.rendererConfig.vectorOverride[0],
      this.rendererConfig.vectorOverride[1],
      this.rendererConfig.vectorOverride[2],
      this.rendererConfig.vectorOverride[3]
    );

    this.renderer.setRasterRenderingEnabled?.(false);
    this.renderer.setFillRenderingEnabled?.(false);
    this.renderer.setStrokeRenderingEnabled?.(false);
    this.renderer.setTextRenderingEnabled?.(false);

    if (this.renderTexture) {
      this.renderTexture.dispose();
      this.renderTexture = null;
      const previousMaterial = this.pageMesh.material;
      this.pageMesh.material = createInvisiblePageMaterial();
      previousMaterial.dispose();
    } else if (this.pageMesh.material.colorWrite !== false) {
      const previousMaterial = this.pageMesh.material;
      this.pageMesh.material = createInvisiblePageMaterial();
      previousMaterial.dispose();
    }

    // The invisible page rectangle is a cheap depth pre-pass for the PDF as a
    // single scene object. PDF material layers draw after it in fixed order
    // without depth testing, so coplanar page content cannot self-fight.
    this.pageMesh.frustumCulled = false;
    this.pageMesh.renderOrder = HEPR_THREE_LAYER_ORDER_PAGE_DEPTH;

    if (!wasMaterialPipelineActive) {
      this.lastSyncedFrameSerial = -1;
      this.lastUploadedFrameSerial = -1;
      this.lastViewportWidth = 0;
      this.lastViewportHeight = 0;
    }
  }

  private updateMaterialLayerTransforms(
    camera: THREE.Camera,
    viewport: ViewportPixels,
    useLocalToClip: boolean
  ): number | null {
    if (
      !this.strokeMaterialLayer &&
      !this.triangleStrokeLayer &&
      !this.vectorLodStrokeLayer &&
      !this.compactedStrokeLayer
    ) {
      return null;
    }

    if (!useLocalToClip) {
      const localUnitsPerPixel = 1 / Math.max(1e-6, this.renderer.getViewState().zoom);
      this.rasterMaterialLayer.setScreenSpaceTransform();
      this.fillMaterialLayer.setScreenSpaceTransform();
      this.strokeMaterialLayer?.setScreenSpaceTransform();
      this.triangleStrokeLayer?.setScreenSpaceTransform();
      this.vectorLodStrokeLayer?.setScreenSpaceTransform();
      this.textMaterialLayer.setScreenSpaceTransform();
      this.pageTileLayer.setScreenSpaceTransform();
      return localUnitsPerPixel;
    }

    this.clipFromWorldMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.clipFromLocalMatrix.multiplyMatrices(this.clipFromWorldMatrix, this.pageMesh.matrixWorld);
    this.clipFromDataMatrix.multiplyMatrices(this.clipFromLocalMatrix, this.dataToLocalMatrix);
    const localUnitsPerPixel = this.estimateLocalUnitsPerPixel(camera, viewport);
    this.rasterMaterialLayer.setLocalToClipTransform(this.clipFromDataMatrix);
    this.fillMaterialLayer.setLocalToClipTransform(this.clipFromDataMatrix);
    this.strokeMaterialLayer?.setLocalToClipTransform(this.clipFromDataMatrix, localUnitsPerPixel);
    this.triangleStrokeLayer?.setLocalToClipTransform(this.clipFromDataMatrix, localUnitsPerPixel);
    this.vectorLodStrokeLayer?.setLocalToClipTransform(this.clipFromDataMatrix, localUnitsPerPixel);
    this.textMaterialLayer.setLocalToClipTransform(this.clipFromDataMatrix);
    this.pageTileLayer.setLocalToClipTransform(this.clipFromDataMatrix);
    return localUnitsPerPixel;
  }

  private updateStrokeLodVisibility(localUnitsPerPixel: number | null, vectorPipelineActive: boolean): void {
    if (this.vectorLodStrokeLayer) {
      if (!vectorPipelineActive || localUnitsPerPixel === null) {
        this.vectorLodStrokeLayer.deactivate();
        return;
      }

      this.vectorLodStrokeLayer.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
      this.vectorLodStrokeLayer.setVectorOverride(
        this.rendererConfig.vectorOverride[0],
        this.rendererConfig.vectorOverride[1],
        this.rendererConfig.vectorOverride[2],
        this.rendererConfig.vectorOverride[3]
      );
      this.vectorLodStrokeLayer.setVisible(true);
      this.vectorLodStrokeLayer.updateForLocalUnitsPerPixel(localUnitsPerPixel);
      this.strokeMaterialLayer?.setVisible(false);
      this.triangleStrokeLayer?.setVisible(false);
      this.compactedStrokeLayer?.deactivate();
      return;
    }

    if (!this.compactedStrokeLayer || !vectorPipelineActive || localUnitsPerPixel === null) {
      this.compactedStrokeLayer?.deactivate();
      return;
    }

    this.compactedStrokeLayer.setVectorOverride(
      this.rendererConfig.vectorOverride[0],
      this.rendererConfig.vectorOverride[1],
      this.rendererConfig.vectorOverride[2],
      this.rendererConfig.vectorOverride[3]
    );
    const compactedActive = this.compactedStrokeLayer.updateForLocalUnitsPerPixel(localUnitsPerPixel);
    if (compactedActive) {
      this.strokeMaterialLayer?.setVisible(false);
      this.triangleStrokeLayer?.setVisible(false);
      return;
    }

    if (!this.triangleStrokeLayer) {
      return;
    }

    this.triangleStrokeLayer.setVisible(true);
    this.triangleStrokeLayer.setVectorOverride(
      this.rendererConfig.vectorOverride[0],
      this.rendererConfig.vectorOverride[1],
      this.rendererConfig.vectorOverride[2],
      this.rendererConfig.vectorOverride[3]
    );
  }

  // Swaps the per-glyph text mesh for baked page tiles when every visible page
  // is small on screen. All-or-nothing per frame: tiles draw only once each
  // visible page has a valid bake, so glyphs and tiles never double-draw.
  private updatePageTextTiles(
    pipelineActive: boolean,
    cullingBounds: Bounds | null,
    viewport: ViewportPixels
  ): void {
    const textInstanceCount = Math.max(0, this.sceneData.textInstanceCount | 0);
    const pageCount = this.pageTileRecords.length;
    const bakeSupported = typeof this.renderer.bakePageTextTilePixels === "function";

    if (
      this.isDisposed ||
      !pipelineActive ||
      !this.pageTextTilesEnabled ||
      !bakeSupported ||
      !cullingBounds ||
      pageCount === 0 ||
      textInstanceCount < THREE_PAGE_TEXT_TILE_MIN_TEXT_INSTANCES
    ) {
      this.deactivatePageTileRendering();
      this.pageTileModeActive = false;
      this.updatePageTileStats(false, 0, 0, 0);
      return;
    }

    const transformStable = this.trackClipFromDataStability();

    const visiblePages: number[] = [];
    const targetWidths: number[] = [];
    const targetHeights: number[] = [];
    let maxHeight = 0;
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const rangeCount = this.tilePageTextRanges[pageIndex * 2 + 1] ?? 0;
      if (rangeCount <= 0) {
        continue;
      }
      const rectOffset = pageIndex * 4;
      const minX = Math.min(this.tilePageRects[rectOffset], this.tilePageRects[rectOffset + 2]);
      const minY = Math.min(this.tilePageRects[rectOffset + 1], this.tilePageRects[rectOffset + 3]);
      const maxX = Math.max(this.tilePageRects[rectOffset], this.tilePageRects[rectOffset + 2]);
      const maxY = Math.max(this.tilePageRects[rectOffset + 1], this.tilePageRects[rectOffset + 3]);
      if (
        maxX < cullingBounds.minX ||
        minX > cullingBounds.maxX ||
        maxY < cullingBounds.minY ||
        minY > cullingBounds.maxY
      ) {
        continue;
      }

      const size = this.measurePageProjectedSizePx(minX, minY, maxX, maxY, viewport);
      if (!size || size.width > THREE_PAGE_TEXT_TILE_MAX_TILE_DIM) {
        // Behind-camera or oversized pages cannot be tiled; a clamped bake would
        // crop them, so fall back to direct text for the whole view.
        maxHeight = Number.POSITIVE_INFINITY;
        break;
      }
      visiblePages.push(pageIndex);
      targetWidths.push(size.width);
      targetHeights.push(size.height);
      maxHeight = Math.max(maxHeight, size.height);
    }

    if (visiblePages.length === 0 || !Number.isFinite(maxHeight)) {
      this.deactivatePageTileRendering();
      this.pageTileModeActive = false;
      this.updatePageTileStats(true, 0, visiblePages.length, 0);
      return;
    }

    if (this.pageTileModeActive) {
      if (maxHeight >= THREE_PAGE_TEXT_TILE_EXIT_PAGE_SCREEN_PX) {
        this.pageTileModeActive = false;
      }
    } else if (maxHeight <= THREE_PAGE_TEXT_TILE_ENTER_PAGE_SCREEN_PX) {
      this.pageTileModeActive = true;
    }
    if (!this.pageTileModeActive) {
      this.deactivatePageTileRendering();
      this.updatePageTileStats(true, 0, visiblePages.length, 0);
      return;
    }

    // Granular per-page mixing: baked pages draw as tile quads and are masked
    // out of the glyph draw; missing/stale pages keep drawing glyphs while
    // their bakes are in flight, so panning never falls back to full direct.
    const pageTileMask = this.pageTileMaskScratch;
    pageTileMask.fill(0);
    const missing: PageTextTileBakeRequest[] = [];
    let tileCount = 0;
    let directPages = 0;
    let directStart = textInstanceCount;
    let directEnd = 0;
    for (let i = 0; i < visiblePages.length; i += 1) {
      const pageIndex = visiblePages[i];
      const record = this.pageTileRecords[pageIndex];
      const targetWidth = clampTileDimension(targetWidths[i]);
      const targetHeight = clampTileDimension(targetHeights[i]);
      const heightRatio = record.hasTile ? targetHeight / Math.max(1, record.innerHeight) : 0;
      const tileValid =
        record.hasTile &&
        record.epoch === this.pageTileEpoch &&
        heightRatio >= THREE_PAGE_TEXT_TILE_RATIO_MIN &&
        heightRatio <= THREE_PAGE_TEXT_TILE_RATIO_MAX &&
        !(transformStable && Math.abs(targetHeight - record.innerHeight) > 1);

      if (tileValid) {
        tileCount = this.appendPageTileInstance(pageIndex, record, tileCount);
        pageTileMask[pageIndex] = 1;
      } else {
        missing.push({ pageIndex, innerWidth: targetWidth, innerHeight: targetHeight });
        const rangeOffset = pageIndex * 2;
        const rangeStart = this.tilePageTextRanges[rangeOffset] ?? 0;
        const rangeCount = this.tilePageTextRanges[rangeOffset + 1] ?? 0;
        if (rangeCount > 0) {
          directStart = Math.min(directStart, rangeStart);
          directEnd = Math.max(directEnd, rangeStart + rangeCount);
          directPages += 1;
        }
      }
    }

    if (tileCount > 0) {
      this.pageTileLayer.setTiles(this.pageTileInstanceData, tileCount);
      this.pageTileLayer.setVisible(true);
    } else {
      this.pageTileLayer.setVisible(false);
    }

    if (directPages > 0 && directEnd > directStart) {
      this.textMaterialLayer.setPageTileMask(tileCount > 0 ? pageTileMask : null);
      this.textMaterialLayer.setInstanceWindow(directStart, directEnd - directStart);
    } else {
      this.textMaterialLayer.setVisible(false);
      this.textMaterialLayer.setPageTileMask(null);
      this.textMaterialLayer.clearInstanceWindow();
    }

    this.updatePageTileStats(true, tileCount, directPages, missing.length);
    this.kickPageTileBakes(missing);
  }

  private deactivatePageTileRendering(): void {
    this.pageTileLayer.setVisible(false);
    this.textMaterialLayer.setPageTileMask(null);
    this.textMaterialLayer.clearInstanceWindow();
  }

  private appendPageTileInstance(pageIndex: number, record: ThreePageTextTileRecord, tileCount: number): number {
    const rectOffset = pageIndex * 4;
    const minX = Math.min(this.tilePageRects[rectOffset], this.tilePageRects[rectOffset + 2]);
    const minY = Math.min(this.tilePageRects[rectOffset + 1], this.tilePageRects[rectOffset + 3]);
    const maxX = Math.max(this.tilePageRects[rectOffset], this.tilePageRects[rectOffset + 2]);
    const maxY = Math.max(this.tilePageRects[rectOffset + 1], this.tilePageRects[rectOffset + 3]);

    const atlasWidth = this.pageTileLayer.atlasWidth;
    const atlasHeight = this.pageTileLayer.atlasHeight;
    const out = this.pageTileInstanceData;
    const offset = tileCount * 8;
    out[offset] = minX;
    out[offset + 1] = minY;
    out[offset + 2] = maxX;
    out[offset + 3] = maxY;
    // Baked pixels store row 0 at the page top (world maxY), so v is flipped
    // relative to the world rect.
    out[offset + 4] = record.atlasX / atlasWidth;
    out[offset + 5] = (record.atlasY + record.innerHeight) / atlasHeight;
    out[offset + 6] = (record.atlasX + record.innerWidth) / atlasWidth;
    out[offset + 7] = record.atlasY / atlasHeight;
    return tileCount + 1;
  }

  private kickPageTileBakes(missing: PageTextTileBakeRequest[]): void {
    if (this.pageTileBakeInFlight || missing.length === 0) {
      return;
    }

    const batch: PageTextTileBakeRequest[] = [];
    let batchedInstances = 0;
    for (const request of missing) {
      if (batch.length >= THREE_PAGE_TEXT_TILE_BAKE_MAX_PAGES) {
        break;
      }
      if (batch.length > 0 && batchedInstances >= THREE_PAGE_TEXT_TILE_BAKE_INSTANCE_BUDGET) {
        break;
      }
      batch.push(request);
      batchedInstances += this.tilePageTextRanges[request.pageIndex * 2 + 1] ?? 0;
    }
    if (batch.length === 0) {
      return;
    }

    const bakeTiles = this.renderer.bakePageTextTilePixels;
    if (!bakeTiles) {
      return;
    }
    this.pageTileBakeInFlight = true;
    const epochAtRequest = this.pageTileEpoch;
    bakeTiles
      .call(this.renderer, batch)
      .then((results) => {
        this.pageTileBakeInFlight = false;
        if (!results || this.isDisposed || epochAtRequest !== this.pageTileEpoch) {
          return;
        }

        let wroteAny = false;
        for (const result of results) {
          const record = this.pageTileRecords[result.pageIndex];
          if (!record) {
            continue;
          }
          // A transient GPU hiccup can yield an empty bake for a page that has
          // glyphs; leave the record missing so the page stays direct and rebakes.
          if ((this.tilePageTextRanges[result.pageIndex * 2 + 1] ?? 0) > 0 && isAllZeroAlpha(result.pixels)) {
            continue;
          }
          const slot = this.allocatePageTileSlot(result.innerWidth, result.innerHeight);
          if (!slot) {
            // Atlas full: drop every tile (including this batch) and let the
            // next frames rebake into the fresh atlas.
            this.resetPageTileAtlas();
            break;
          }
          this.pageTileLayer.writeTilePixels(slot.x, slot.y, result.innerWidth, result.innerHeight, result.pixels);
          record.hasTile = true;
          record.atlasX = slot.x;
          record.atlasY = slot.y;
          record.innerWidth = result.innerWidth;
          record.innerHeight = result.innerHeight;
          record.epoch = epochAtRequest;
          wroteAny = true;
        }
        if (wroteAny) {
          this.pageTileLayer.markAtlasDirty();
        }
      })
      .catch(() => {
        this.pageTileBakeInFlight = false;
      });
  }

  private measurePageProjectedSizePx(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    viewport: ViewportPixels
  ): { width: number; height: number } | null {
    const elements = this.clipFromDataMatrix.elements;
    const halfWidth = Math.max(1, viewport.width) * 0.5;
    const halfHeight = Math.max(1, viewport.height) * 0.5;

    const project = (x: number, y: number): [number, number] | null => {
      const clipW = elements[3] * x + elements[7] * y + elements[15];
      if (!(clipW > 1e-9)) {
        return null;
      }
      const clipX = elements[0] * x + elements[4] * y + elements[12];
      const clipY = elements[1] * x + elements[5] * y + elements[13];
      return [(clipX / clipW) * halfWidth, (clipY / clipW) * halfHeight];
    };

    const p00 = project(minX, minY);
    const p10 = project(maxX, minY);
    const p11 = project(maxX, maxY);
    const p01 = project(minX, maxY);
    if (!p00 || !p10 || !p11 || !p01) {
      return null;
    }

    const width = Math.max(Math.hypot(p10[0] - p00[0], p10[1] - p00[1]), Math.hypot(p11[0] - p01[0], p11[1] - p01[1]));
    const height = Math.max(Math.hypot(p01[0] - p00[0], p01[1] - p00[1]), Math.hypot(p11[0] - p10[0], p11[1] - p10[1]));
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return null;
    }
    return { width, height };
  }

  private trackClipFromDataStability(): boolean {
    const elements = this.clipFromDataMatrix.elements;
    let unchanged = true;
    for (let i = 0; i < 16; i += 1) {
      const previous = this.previousClipFromDataElements[i];
      const next = elements[i];
      const scale = Math.max(Math.abs(previous), Math.abs(next), 1e-6);
      if (Math.abs(next - previous) > scale * 1e-6) {
        unchanged = false;
      }
      this.previousClipFromDataElements[i] = next;
    }

    this.clipFromDataStableFrames = unchanged ? this.clipFromDataStableFrames + 1 : 0;
    return this.clipFromDataStableFrames >= THREE_PAGE_TEXT_TILE_STABLE_FRAMES;
  }

  private allocatePageTileSlot(innerWidth: number, innerHeight: number): { x: number; y: number } | null {
    const atlasWidth = this.pageTileLayer.atlasWidth;
    const atlasHeight = this.pageTileLayer.atlasHeight;
    const slotWidth = innerWidth + THREE_PAGE_TEXT_TILE_GUTTER_PX * 2;
    const slotHeight = innerHeight + THREE_PAGE_TEXT_TILE_GUTTER_PX * 2;
    if (slotWidth > atlasWidth || slotHeight > atlasHeight) {
      return null;
    }

    if (this.pageTileShelfX + slotWidth > atlasWidth) {
      this.pageTileShelfY += this.pageTileShelfRowHeight;
      this.pageTileShelfX = 0;
      this.pageTileShelfRowHeight = 0;
    }
    if (this.pageTileShelfY + slotHeight > atlasHeight) {
      return null;
    }

    const x = this.pageTileShelfX + THREE_PAGE_TEXT_TILE_GUTTER_PX;
    const y = this.pageTileShelfY + THREE_PAGE_TEXT_TILE_GUTTER_PX;
    this.pageTileShelfX += slotWidth;
    this.pageTileShelfRowHeight = Math.max(this.pageTileShelfRowHeight, slotHeight);
    return { x, y };
  }

  private resetPageTileAtlas(): void {
    this.pageTileShelfX = 0;
    this.pageTileShelfY = 0;
    this.pageTileShelfRowHeight = 0;
    for (const record of this.pageTileRecords) {
      record.hasTile = false;
    }
  }

  private invalidatePageTextTiles(): void {
    this.pageTileEpoch += 1;
    this.resetPageTileAtlas();
  }

  private updatePageTileStats(active: boolean, tiledPages: number, directPages: number, bakedPages: number): void {
    this.lastPageTileStats = {
      enabled: this.pageTextTilesEnabled,
      active,
      tiledPages,
      directPages,
      bakedPages,
      atlasWidth: this.pageTileLayer.atlasWidth,
      atlasHeight: this.pageTileLayer.atlasHeight
    };
  }

  private estimateLocalUnitsPerPixel(camera: THREE.Camera, viewport: ViewportPixels): number {
    const viewportWidth = Math.max(1, viewport.width);
    const viewportHeight = Math.max(1, viewport.height);
    this.projectedCenter.set(0, 0, 0).applyMatrix4(this.pageMesh.matrixWorld).project(camera);
    this.projectedBasisX.set(1, 0, 0).applyMatrix4(this.pageMesh.matrixWorld).project(camera);
    this.projectedBasisY.set(0, 1, 0).applyMatrix4(this.pageMesh.matrixWorld).project(camera);

    if (
      !Number.isFinite(this.projectedCenter.x) || !Number.isFinite(this.projectedCenter.y) ||
      !Number.isFinite(this.projectedBasisX.x) || !Number.isFinite(this.projectedBasisX.y) ||
      !Number.isFinite(this.projectedBasisY.x) || !Number.isFinite(this.projectedBasisY.y)
    ) {
      return 1 / Math.max(1e-6, this.renderer.getViewState().zoom);
    }

    const scaleX = Math.hypot(
      (this.projectedBasisX.x - this.projectedCenter.x) * 0.5 * viewportWidth,
      (this.projectedBasisX.y - this.projectedCenter.y) * 0.5 * viewportHeight
    );
    const scaleY = Math.hypot(
      (this.projectedBasisY.x - this.projectedCenter.x) * 0.5 * viewportWidth,
      (this.projectedBasisY.y - this.projectedCenter.y) * 0.5 * viewportHeight
    );
    const pixelsPerLocalUnit = Math.max(scaleX, scaleY);
    if (!Number.isFinite(pixelsPerLocalUnit) || pixelsPerLocalUnit <= 1e-6) {
      return 1 / Math.max(1e-6, this.renderer.getViewState().zoom);
    }
    return 1 / pixelsPerLocalUnit;
  }

  private updateUvFromViewState(viewState: ViewState, viewport: ViewportPixels): void {
    const safeZoom = Math.max(1e-6, viewState.zoom);
    const viewWidth = viewport.width / safeZoom;
    const viewHeight = viewport.height / safeZoom;
    const viewMinX = viewState.cameraCenterX - viewWidth * 0.5;
    const viewMinY = viewState.cameraCenterY - viewHeight * 0.5;

    const localX0 = this.localSceneBounds.minX;
    const localY0 = this.localSceneBounds.minY;
    const localX1 = this.localSceneBounds.maxX;
    const localY1 = this.localSceneBounds.maxY;

    this.uvArray[0] = (localX0 + this.sceneCenterX - viewMinX) / viewWidth;
    this.uvArray[1] = (localY0 + this.sceneCenterY - viewMinY) / viewHeight;
    this.uvArray[2] = (localX1 + this.sceneCenterX - viewMinX) / viewWidth;
    this.uvArray[3] = (localY0 + this.sceneCenterY - viewMinY) / viewHeight;
    this.uvArray[4] = (localX1 + this.sceneCenterX - viewMinX) / viewWidth;
    this.uvArray[5] = (localY1 + this.sceneCenterY - viewMinY) / viewHeight;
    this.uvArray[6] = (localX0 + this.sceneCenterX - viewMinX) / viewWidth;
    this.uvArray[7] = (localY1 + this.sceneCenterY - viewMinY) / viewHeight;
    this.uvAttribute.needsUpdate = true;
  }

  private updateUvToFullPage(): void {
    const expected = [0, 0, 1, 0, 1, 1, 0, 1] as const;
    let changed = false;
    for (let i = 0; i < expected.length; i += 1) {
      if (Math.abs(this.uvArray[i] - expected[i]) > 1e-7) {
        changed = true;
        break;
      }
    }
    if (!changed) {
      return;
    }

    this.uvArray[0] = 0;
    this.uvArray[1] = 0;
    this.uvArray[2] = 1;
    this.uvArray[3] = 0;
    this.uvArray[4] = 1;
    this.uvArray[5] = 1;
    this.uvArray[6] = 0;
    this.uvArray[7] = 1;
    this.uvAttribute.needsUpdate = true;
  }

  private resolveInteractionViewportRect(): DOMRect | DOMRectReadOnly | null {
    if (this.controlsCanvas) {
      return this.controlsCanvas.getBoundingClientRect();
    }
    return null;
  }

  private resolveKnownViewportPixelsForFit(): ViewportPixels | null {
    if (this.lastViewportWidth > 0 && this.lastViewportHeight > 0) {
      return { width: this.lastViewportWidth, height: this.lastViewportHeight };
    }

    const canvas = this.controlsCanvas;
    if (!canvas) {
      return null;
    }

    const width = Number.isFinite(canvas.width) && canvas.width > 0
      ? canvas.width
      : Math.max(1, Math.round(canvas.clientWidth * (window.devicePixelRatio || 1)));
    const height = Number.isFinite(canvas.height) && canvas.height > 0
      ? canvas.height
      : Math.max(1, Math.round(canvas.clientHeight * (window.devicePixelRatio || 1)));
    return { width, height };
  }

  private deriveViewStateFromThreeCamera(camera: THREE.Camera, viewport: ViewportPixels): DerivedThreeCameraView | null {
    const cameraType = camera as { isOrthographicCamera?: boolean; isPerspectiveCamera?: boolean };
    if (cameraType.isOrthographicCamera !== true && cameraType.isPerspectiveCamera !== true) {
      this.warnThreeCameraUnsupported("[HEPR] Camera-driven rendering supports orthographic or perspective cameras.");
      return null;
    }

    if (cameraType.isOrthographicCamera === true) {
      const orthographicView = this.deriveAxisAlignedOrthographicViewState(camera as THREE.OrthographicCamera, viewport);
      if (!orthographicView) {
        return null;
      }
      this.warnedThreeCameraUnsupported = false;
      return orthographicView;
    }

    this.pagePlanePoint.set(0, 0, 0).applyMatrix4(this.pageMesh.matrixWorld);
    this.pagePlaneNormal.set(0, 0, 1).transformDirection(this.pageMesh.matrixWorld);
    if (!Number.isFinite(this.pagePlaneNormal.x) || !Number.isFinite(this.pagePlaneNormal.y) || !Number.isFinite(this.pagePlaneNormal.z)) {
      return null;
    }
    this.pagePlane.setFromNormalAndCoplanarPoint(this.pagePlaneNormal, this.pagePlanePoint);
    this.pageWorldInverse.copy(this.pageMesh.matrixWorld);
    if (Math.abs(this.pageWorldInverse.determinant()) < 1e-10) {
      this.warnThreeCameraUnsupported("[HEPR] Camera-driven rendering requires a non-singular PDF object transform.");
      return null;
    }
    this.pageWorldInverse.invert();

    let minLocalX = Number.POSITIVE_INFINITY;
    let minLocalY = Number.POSITIVE_INFINITY;
    let maxLocalX = Number.NEGATIVE_INFINITY;
    let maxLocalY = Number.NEGATIVE_INFINITY;
    const ndcCorners: readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1]
    ] as const;
    let projectedCornerCount = 0;
    for (const [ndcX, ndcY] of ndcCorners) {
      const localPoint = this.intersectViewportCornerWithPagePlane(camera, ndcX, ndcY);
      if (!localPoint) {
        continue;
      }
      projectedCornerCount += 1;
      minLocalX = Math.min(minLocalX, localPoint.x);
      minLocalY = Math.min(minLocalY, localPoint.y);
      maxLocalX = Math.max(maxLocalX, localPoint.x);
      maxLocalY = Math.max(maxLocalY, localPoint.y);
    }

    if (projectedCornerCount < ndcCorners.length) {
      const fallbackView = this.deriveFullSceneMaterialView(viewport);
      if (fallbackView) {
        this.warnedThreeCameraUnsupported = false;
        return fallbackView;
      }
      this.warnThreeCameraUnsupported(
        "[HEPR] Camera-driven rendering could not project enough viewport corners onto the PDF plane for this camera/view."
      );
      return null;
    }

    const visibleWidth = Math.max(1e-6, maxLocalX - minLocalX);
    const visibleHeight = Math.max(1e-6, maxLocalY - minLocalY);
    const desiredNativeViewport = clampViewportPixels(viewport);
    const zoom = Math.max(
      1e-6,
      Math.min(
        desiredNativeViewport.width / visibleWidth,
        desiredNativeViewport.height / visibleHeight
      )
    );
    if (!Number.isFinite(zoom)) {
      return null;
    }

    const cameraCenterX = (minLocalX + maxLocalX) * 0.5 + this.sceneCenterX;
    const cameraCenterY = (minLocalY + maxLocalY) * 0.5 + this.sceneCenterY;
    if (!Number.isFinite(cameraCenterX) || !Number.isFinite(cameraCenterY)) {
      return null;
    }

    this.warnedThreeCameraUnsupported = false;
    return {
      viewState: { cameraCenterX, cameraCenterY, zoom },
      nativeViewport: desiredNativeViewport,
      cullingBounds: {
        minX: minLocalX + this.sceneCenterX,
        minY: minLocalY + this.sceneCenterY,
        maxX: maxLocalX + this.sceneCenterX,
        maxY: maxLocalY + this.sceneCenterY
      }
    };
  }

  private deriveFullSceneMaterialView(viewport: ViewportPixels): DerivedThreeCameraView | null {
    const nativeViewport = clampViewportPixels(viewport);
    const pageWidth = Math.max(1e-6, this.sceneBounds.maxX - this.sceneBounds.minX);
    const pageHeight = Math.max(1e-6, this.sceneBounds.maxY - this.sceneBounds.minY);
    const zoom = Math.max(
      1e-6,
      Math.min(nativeViewport.width / pageWidth, nativeViewport.height / pageHeight)
    );
    if (!Number.isFinite(zoom)) {
      return null;
    }

    return {
      viewState: {
        cameraCenterX: this.sceneCenterX,
        cameraCenterY: this.sceneCenterY,
        zoom
      },
      nativeViewport,
      cullingBounds: this.sceneBounds
    };
  }

  private deriveAxisAlignedOrthographicViewState(
    camera: THREE.OrthographicCamera,
    viewport: ViewportPixels
  ): DerivedThreeCameraView | null {
    const nativeViewport = clampViewportPixels(viewport);
    this.clipFromWorldMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.clipFromLocalMatrix.multiplyMatrices(this.clipFromWorldMatrix, this.pageMesh.matrixWorld);

    this.ndcOrigin.set(0, 0, 0).applyMatrix4(this.clipFromLocalMatrix);
    this.ndcLocalX.set(1, 0, 0).applyMatrix4(this.clipFromLocalMatrix);
    this.ndcLocalY.set(0, 1, 0).applyMatrix4(this.clipFromLocalMatrix);

    const sx = this.ndcLocalX.x - this.ndcOrigin.x;
    const sy = this.ndcLocalY.y - this.ndcOrigin.y;
    const shearX = this.ndcLocalY.x - this.ndcOrigin.x;
    const shearY = this.ndcLocalX.y - this.ndcOrigin.y;
    const minAxisScale = 1e-8;
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || Math.abs(sx) < minAxisScale || Math.abs(sy) < minAxisScale) {
      this.warnThreeCameraUnsupported(
        `[HEPR] Camera-driven orthographic rendering has invalid axis scale (sx=${sx.toExponential(3)}, sy=${sy.toExponential(3)}).`
      );
      return null;
    }

    const maxCrossAxis = 1e-4;
    if (!Number.isFinite(shearX) || !Number.isFinite(shearY) || Math.abs(shearX) > maxCrossAxis || Math.abs(shearY) > maxCrossAxis) {
      this.warnThreeCameraUnsupported(
        `[HEPR] Camera-driven orthographic rendering is skewed (shearX=${shearX.toExponential(3)}, shearY=${shearY.toExponential(3)}).`
      );
      return null;
    }

    const localCenterX = -this.ndcOrigin.x / sx;
    const localCenterY = -this.ndcOrigin.y / sy;
    const zoomX = Math.abs(sx) * nativeViewport.width * 0.5;
    const zoomY = Math.abs(sy) * nativeViewport.height * 0.5;
    const zoom = Math.max(1e-6, Math.min(zoomX, zoomY));
    if (!Number.isFinite(localCenterX) || !Number.isFinite(localCenterY) || !Number.isFinite(zoom)) {
      this.warnThreeCameraUnsupported(
        `[HEPR] Camera-driven orthographic rendering produced non-finite view values (cx=${localCenterX}, cy=${localCenterY}, zoom=${zoom}).`
      );
      return null;
    }

    return {
      viewState: {
        cameraCenterX: localCenterX + this.sceneCenterX,
        cameraCenterY: localCenterY + this.sceneCenterY,
        zoom
      },
      nativeViewport
    };
  }

  private derivePerspectiveFallbackViewState(
    camera: THREE.PerspectiveCamera,
    viewport: ViewportPixels
  ): DerivedThreeCameraView | null {
    const clampedViewport = clampViewportPixels(viewport);
    if (clampedViewport.width <= 0 || clampedViewport.height <= 0) {
      return null;
    }

    const pageWidth = Math.max(1e-6, this.sceneBounds.maxX - this.sceneBounds.minX);
    const pageHeight = Math.max(1e-6, this.sceneBounds.maxY - this.sceneBounds.minY);
    const pageAspect = pageWidth / pageHeight;

    const projectedFootprint = this.measureProjectedPageFootprint(camera, clampedViewport);
    const targetFootprintWidth = Math.max(
      1,
      (projectedFootprint?.width ?? clampedViewport.width) * PERSPECTIVE_NATIVE_OVERSAMPLE
    );
    const targetFootprintHeight = Math.max(
      1,
      (projectedFootprint?.height ?? clampedViewport.height) * PERSPECTIVE_NATIVE_OVERSAMPLE
    );

    const requiredWidth = Math.max(targetFootprintWidth, targetFootprintHeight * pageAspect);
    const requiredHeight = requiredWidth / pageAspect;
    const desiredViewport = clampViewportPixels({
      width: requiredWidth,
      height: requiredHeight
    });

    let nativeViewport = desiredViewport;
    const currentWidth = Math.max(1, Math.round(this.renderCanvas.width));
    const currentHeight = Math.max(1, Math.round(this.renderCanvas.height));
    if (currentWidth > 0 && currentHeight > 0) {
      const widthRatio = desiredViewport.width / currentWidth;
      const heightRatio = desiredViewport.height / currentHeight;
      const withinHysteresis =
        widthRatio >= PERSPECTIVE_RESIZE_HYSTERESIS_MIN &&
        widthRatio <= PERSPECTIVE_RESIZE_HYSTERESIS_MAX &&
        heightRatio >= PERSPECTIVE_RESIZE_HYSTERESIS_MIN &&
        heightRatio <= PERSPECTIVE_RESIZE_HYSTERESIS_MAX;
      if (withinHysteresis) {
        nativeViewport = {
          width: currentWidth,
          height: currentHeight
        };
      }
    }

    const zoom = Math.max(
      1e-6,
      Math.min(
        nativeViewport.width / pageWidth,
        nativeViewport.height / pageHeight
      )
    );

    return {
      viewState: {
        cameraCenterX: this.sceneCenterX,
        cameraCenterY: this.sceneCenterY,
        zoom
      },
      nativeViewport
    };
  }

  private measureProjectedPageFootprint(
    camera: THREE.PerspectiveCamera,
    viewport: ViewportPixels
  ): { width: number; height: number } | null {
    const bounds = this.measureProjectedPageNdcBounds(camera, viewport);
    if (!bounds) {
      return null;
    }

    const minPixelX = (bounds.minX * 0.5 + 0.5) * viewport.width;
    const minPixelY = (1 - (bounds.maxY * 0.5 + 0.5)) * viewport.height;
    const maxPixelX = (bounds.maxX * 0.5 + 0.5) * viewport.width;
    const maxPixelY = (1 - (bounds.minY * 0.5 + 0.5)) * viewport.height;
    const clippedMinX = Math.max(0, Math.min(viewport.width, minPixelX));
    const clippedMinY = Math.max(0, Math.min(viewport.height, minPixelY));
    const clippedMaxX = Math.max(0, Math.min(viewport.width, maxPixelX));
    const clippedMaxY = Math.max(0, Math.min(viewport.height, maxPixelY));
    const width = Math.max(0, clippedMaxX - clippedMinX);
    const height = Math.max(0, clippedMaxY - clippedMinY);

    if (width < 1 || height < 1) {
      return null;
    }
    return { width, height };
  }

  private measureProjectedPageNdcBounds(
    camera: THREE.Camera,
    viewport: ViewportPixels
  ): { minX: number; minY: number; maxX: number; maxY: number; longRatio: number } | null {
    const localX0 = this.localSceneBounds.minX;
    const localY0 = this.localSceneBounds.minY;
    const localX1 = this.localSceneBounds.maxX;
    const localY1 = this.localSceneBounds.maxY;

    this.projectedCorner0.set(localX0, localY0, 0).applyMatrix4(this.pageMesh.matrixWorld).project(camera);
    this.projectedCorner1.set(localX1, localY0, 0).applyMatrix4(this.pageMesh.matrixWorld).project(camera);
    this.projectedCorner2.set(localX1, localY1, 0).applyMatrix4(this.pageMesh.matrixWorld).project(camera);
    this.projectedCorner3.set(localX0, localY1, 0).applyMatrix4(this.pageMesh.matrixWorld).project(camera);

    const corners = [this.projectedCorner0, this.projectedCorner1, this.projectedCorner2, this.projectedCorner3];
    let minPixelX = Number.POSITIVE_INFINITY;
    let minPixelY = Number.POSITIVE_INFINITY;
    let maxPixelX = Number.NEGATIVE_INFINITY;
    let maxPixelY = Number.NEGATIVE_INFINITY;

    for (const corner of corners) {
      if (!Number.isFinite(corner.x) || !Number.isFinite(corner.y) || !Number.isFinite(corner.z)) {
        return null;
      }
      minPixelX = Math.min(minPixelX, corner.x);
      minPixelY = Math.min(minPixelY, corner.y);
      maxPixelX = Math.max(maxPixelX, corner.x);
      maxPixelY = Math.max(maxPixelY, corner.y);
    }

    if (!Number.isFinite(minPixelX) || !Number.isFinite(minPixelY) || !Number.isFinite(maxPixelX) || !Number.isFinite(maxPixelY)) {
      return null;
    }

    const projectedWidthRatio = Math.max(0, maxPixelX - minPixelX) * 0.5;
    const projectedHeightRatio = Math.max(0, maxPixelY - minPixelY) * 0.5;
    const longRatio = Math.max(projectedWidthRatio, projectedHeightRatio);
    return {
      minX: minPixelX,
      minY: minPixelY,
      maxX: maxPixelX,
      maxY: maxPixelY,
      longRatio
    };
  }

  private intersectViewportCornerWithPagePlane(
    camera: THREE.Camera,
    ndcX: number,
    ndcY: number
  ): THREE.Vector3 | null {
    this.rayOriginNear.set(ndcX, ndcY, -1).unproject(camera);
    this.rayFarPoint.set(ndcX, ndcY, 1).unproject(camera);
    this.rayDirection.copy(this.rayFarPoint).sub(this.rayOriginNear);
    const rayLengthSq = this.rayDirection.lengthSq();
    if (!Number.isFinite(rayLengthSq) || rayLengthSq <= 1e-16) {
      return null;
    }
    this.rayDirection.multiplyScalar(1 / Math.sqrt(rayLengthSq));

    const denominator = this.pagePlane.normal.dot(this.rayDirection);
    if (!Number.isFinite(denominator) || Math.abs(denominator) <= 1e-8) {
      return null;
    }
    const distance = -(
      this.pagePlane.normal.dot(this.rayOriginNear) + this.pagePlane.constant
    ) / denominator;
    if (!Number.isFinite(distance) || distance < 0) {
      return null;
    }

    this.worldIntersection.copy(this.rayDirection).multiplyScalar(distance).add(this.rayOriginNear);
    this.localIntersection.copy(this.worldIntersection).applyMatrix4(this.pageWorldInverse);
    if (!Number.isFinite(this.localIntersection.x) || !Number.isFinite(this.localIntersection.y)) {
      return null;
    }
    return this.localIntersection;
  }

  private warnThreeCameraUnsupported(message: string): void {
    if (this.warnedThreeCameraUnsupported) {
      return;
    }
    this.warnedThreeCameraUnsupported = true;
    console.warn(`${message} source=${this.sourceLabel}`);
  }

  private attachNativeFrameListener(renderer: RendererApi): void {
    renderer.setFrameListener((stats) => {
      this.lastNativeDrawStats = stats;
      this.frameListener?.(stats);
    });
  }
}

function installSceneRenderHook(scene: THREE.Scene, object: HeprThreePdfObject): void {
  const existingHook = sceneRenderHooks.get(scene);
  if (existingHook) {
    existingHook.objects.add(object);
    if (scene.onBeforeRender !== existingHook.callback) {
      existingHook.previous = scene.onBeforeRender;
      scene.onBeforeRender = existingHook.callback;
    }
    return;
  }

  let hook: HeprSceneRenderHook;
  const callback = ((...args: Parameters<ThreeSceneRenderCallback>) => {
    hook.previous(...args);

    const renderer = args[0] as unknown as ThreeHostRenderer;
    const activeScene = args[1] as THREE.Scene;
    const camera = args[2] as THREE.Camera;

    for (const pdfObject of Array.from(hook.objects)) {
      if (findAncestorScene(pdfObject) !== activeScene) {
        hook.objects.delete(pdfObject);
        continue;
      }
      pdfObject.prepareFrameForThreeRenderer(renderer, camera);
    }

    if (hook.objects.size === 0) {
      removeSceneRenderHookObject(activeScene, object);
    }
  }) as ThreeSceneRenderCallback;

  hook = {
    callback,
    objects: new Set([object]),
    previous: scene.onBeforeRender
  };
  sceneRenderHooks.set(scene, hook);
  scene.onBeforeRender = callback;
}

function removeSceneRenderHookObject(scene: THREE.Scene, object: HeprThreePdfObject): void {
  const hook = sceneRenderHooks.get(scene);
  if (!hook) {
    return;
  }

  hook.objects.delete(object);
  if (hook.objects.size > 0) {
    return;
  }

  if (scene.onBeforeRender === hook.callback) {
    scene.onBeforeRender = hook.previous;
  }
  sceneRenderHooks.delete(scene);
}

function findAncestorScene(object: THREE.Object3D): THREE.Scene | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    if ((current as THREE.Scene & { isScene?: boolean }).isScene === true) {
      return current as THREE.Scene;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Create a three.js PDF object from an already parsed HEPR scene.
 *
 * Most applications should call `pdfObjectGenerator(source, options)` instead,
 * which loads/parses the source before creating this object. Use this lower
 * level helper when you already have a `LoadedPdfScene`, for example from
 * `loadPdfSceneFromSource`.
 *
 * Example:
 *
 * ```ts
 * const loaded = await loadPdfSceneFromSource(file);
 * const pdfObject = await createThreePdfObject(loaded, {
 *   vectorLod: "auto"
 * });
 * scene.add(pdfObject);
 * ```
 */
export async function createThreePdfObject(
  loadedScene: LoadedPdfScene,
  options: HeprThreeObjectOptions = {}
): Promise<HeprThreePdfObject> {
  const rendererType = options.rendererType ?? "webgl";
  const sceneBounds = normalizeBounds(resolveSceneFitBounds(loadedScene.scene));
  const sceneCenterX = (sceneBounds.minX + sceneBounds.maxX) * 0.5;
  const sceneCenterY = (sceneBounds.minY + sceneBounds.maxY) * 0.5;
  const renderCanvas = document.createElement("canvas");
  const initialCanvasSize = computeInitialCanvasSize(sceneBounds);
  renderCanvas.width = initialCanvasSize.width;
  renderCanvas.height = initialCanvasSize.height;

  const rendererConfig = normalizeRendererConfig(options);
  const initialFitPaddingPixels = DEFAULT_FIT_PADDING_PIXELS;
  const useVectorLodStrokeLayer =
    shouldUseVectorStrokeLod(
      rendererConfig.vectorLodMode,
      rendererType,
      loadedScene.scene.segmentCount
    );
  const nativeRenderer = await createNativeRenderer(rendererType, renderCanvas);
  applyRendererConfig(nativeRenderer, rendererConfig);
  if (useVectorLodStrokeLayer) {
    nativeRenderer.setVectorLodMode?.("off");
  }
  nativeRenderer.setExternalFrameDriver?.(true);
  nativeRenderer.setScene(loadedScene.scene);

  const materialBackend = rendererType === "webgpu" ? "webgpu" : "webgl";

  const rasterMaterialLayer = new ThreeMaterialRasterLayer(loadedScene.scene, {
    materialBackend,
    pageBackground: rendererConfig.pageBackground
  });

  const fillMaterialLayer = new ThreeMaterialFillLayer(loadedScene.scene, {
    materialBackend,
    vectorOverride: rendererConfig.vectorOverride
  });

  const strokeMaterialLayer =
    !useVectorLodStrokeLayer
      ? new ThreeMaterialStrokeLayer(loadedScene.scene, {
        materialBackend,
        strokeCurveEnabled: rendererConfig.strokeCurveEnabled,
        vectorOverride: rendererConfig.vectorOverride
      })
      : null;

  const triangleStrokeLayer = null;

  const vectorLodStrokeLayer =
    useVectorLodStrokeLayer
      ? new ThreeVectorLodStrokeLayer(loadedScene.scene, {
        materialBackend,
        strokeCurveEnabled: rendererConfig.strokeCurveEnabled,
        vectorOverride: rendererConfig.vectorOverride
      })
      : null;

  const compactedStrokeLayer: ThreeCompactedStrokeLayer | null = null;

  const textMaterialLayer = new ThreeMaterialTextLayer(loadedScene.scene, {
    materialBackend,
    strokeCurveEnabled: rendererConfig.strokeCurveEnabled,
    textVectorOnly: rendererConfig.textVectorOnly,
    vectorOverride: rendererConfig.vectorOverride
  });

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([
    sceneBounds.minX - sceneCenterX, sceneBounds.minY - sceneCenterY, 0,
    sceneBounds.maxX - sceneCenterX, sceneBounds.minY - sceneCenterY, 0,
    sceneBounds.maxX - sceneCenterX, sceneBounds.maxY - sceneCenterY, 0,
    sceneBounds.minX - sceneCenterX, sceneBounds.maxY - sceneCenterY, 0
  ]);
  const uvArray = new Float32Array([
    0, 0,
    1, 0,
    1, 1,
    0, 1
  ]);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const uvAttribute = new THREE.BufferAttribute(uvArray, 2);
  geometry.setAttribute("uv", uvAttribute);
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

  const material = createInvisiblePageMaterial();

  const pageMesh = new THREE.Mesh(geometry, material);
  const object = new HeprThreePdfObject(
    loadedScene,
    rendererType,
    nativeRenderer,
    renderCanvas,
    null,
    rendererConfig,
    initialFitPaddingPixels,
    rasterMaterialLayer,
    fillMaterialLayer,
    strokeMaterialLayer,
    triangleStrokeLayer,
    vectorLodStrokeLayer,
    compactedStrokeLayer,
    textMaterialLayer,
    pageMesh,
    uvArray,
    uvAttribute
  );
  pageMesh.onBeforeRender = (renderer, _scene, camera) => {
    object.handleBeforeRender(renderer as ThreeHostRenderer, camera as THREE.Camera);
  };

  return object;
}

async function createNativeRenderer(
  rendererType: HeprRendererType,
  renderCanvas: HTMLCanvasElement
): Promise<RendererApi> {
  if (rendererType === "webgpu") {
    return WebGpuFloorplanRenderer.create(renderCanvas);
  }
  return new WebGlFloorplanRenderer(renderCanvas);
}

function createInvisiblePageMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
    depthFunc: THREE.LessEqualDepth,
    colorWrite: false,
    toneMapped: false
  });
}

function createRenderCanvasTexture(renderCanvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(renderCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = true;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function createTexturedPageMaterial(texture: THREE.CanvasTexture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: texture,
    transparent: false,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
    depthFunc: THREE.LessEqualDepth,
    toneMapped: false
  });
}

function isViewStateApproxEqual(previous: ViewState, next: ViewState): boolean {
  const centerTolerance = 1e-4;
  const zoomTolerance = 1e-4;
  const centerClose =
    Math.abs(previous.cameraCenterX - next.cameraCenterX) <= centerTolerance &&
    Math.abs(previous.cameraCenterY - next.cameraCenterY) <= centerTolerance;
  if (!centerClose) {
    return false;
  }

  const previousZoom = Math.max(1e-6, previous.zoom);
  const nextZoom = Math.max(1e-6, next.zoom);
  const zoomRelativeDelta = Math.abs(nextZoom - previousZoom) / Math.max(previousZoom, nextZoom);
  return zoomRelativeDelta <= zoomTolerance;
}

function normalizeRendererConfig(options: HeprThreeObjectOptions): RendererConfig {
  const pageBackground = parseColorInput(options.pageBackground, [1, 1, 1]);
  const pageBackgroundOpacity =
    typeof options.pageBackgroundOpacity === "number" && Number.isFinite(options.pageBackgroundOpacity)
      ? clamp01(options.pageBackgroundOpacity)
      : 1;
  const vectorColor = parseColorInput(options.vectorOverrideColor, [0, 0, 0]);
  const vectorOpacity =
    typeof options.vectorOverrideOpacity === "number" && Number.isFinite(options.vectorOverrideOpacity)
      ? clamp01(options.vectorOverrideOpacity)
      : options.vectorOverrideColor === undefined
        ? 0
        : 1;

  return {
    vectorLodMode: normalizeVectorLodMode(options.vectorLod),
    strokeCurveEnabled: options.curveStrokes !== false,
    textVectorOnly: options.vectorOnly === true,
    pageBackground: [pageBackground[0], pageBackground[1], pageBackground[2], pageBackgroundOpacity],
    vectorOverride: [vectorColor[0], vectorColor[1], vectorColor[2], vectorOpacity]
  };
}

function normalizeVectorLodMode(value: VectorLodMode | undefined): VectorLodMode {
  return value === "off" || value === "force" ? value : "auto";
}

function applyRendererConfig(renderer: RendererApi, config: RendererConfig): void {
  renderer.setVectorLodMode?.(config.vectorLodMode);
  renderer.setRasterRenderingEnabled?.(true);
  renderer.setFillRenderingEnabled?.(true);
  renderer.setStrokeRenderingEnabled?.(true);
  renderer.setTextRenderingEnabled?.(true);
  renderer.setStrokeCurveEnabled(config.strokeCurveEnabled);
  renderer.setTextVectorOnly(config.textVectorOnly);
  renderer.setPageBackgroundColor(
    config.pageBackground[0],
    config.pageBackground[1],
    config.pageBackground[2],
    config.pageBackground[3]
  );
  renderer.setVectorColorOverride(
    config.vectorOverride[0],
    config.vectorOverride[1],
    config.vectorOverride[2],
    config.vectorOverride[3]
  );
}

function readThreeRendererViewportPixels(renderer: ThreeHostRenderer): ViewportPixels {
  const drawingBufferSize = typeof renderer.getDrawingBufferSize === "function"
    ? renderer.getDrawingBufferSize(new THREE.Vector2())
    : null;
  if (drawingBufferSize) {
    return {
      width: Math.max(1, Math.round(drawingBufferSize.x)),
      height: Math.max(1, Math.round(drawingBufferSize.y))
    };
  }

  const context = typeof renderer.getContext === "function" ? renderer.getContext() : null;
  const webGlContext = context as { drawingBufferWidth?: number; drawingBufferHeight?: number } | null;
  if (
    typeof webGlContext?.drawingBufferWidth === "number" &&
    typeof webGlContext.drawingBufferHeight === "number"
  ) {
    const width = Math.max(1, Math.round(webGlContext.drawingBufferWidth));
    const height = Math.max(1, Math.round(webGlContext.drawingBufferHeight));
    return { width, height };
  }

  const size = typeof renderer.getSize === "function" ? renderer.getSize(new THREE.Vector2()) : null;
  const pixelRatio = typeof renderer.getPixelRatio === "function" ? renderer.getPixelRatio() : window.devicePixelRatio || 1;
  const domElement = renderer.domElement;
  const fallbackWidth = domElement instanceof HTMLCanvasElement ? domElement.clientWidth : domElement.width;
  const fallbackHeight = domElement instanceof HTMLCanvasElement ? domElement.clientHeight : domElement.height;
  const width = Math.max(1, Math.round((size?.x ?? fallbackWidth) * pixelRatio));
  const height = Math.max(1, Math.round((size?.y ?? fallbackHeight) * pixelRatio));
  return { width, height };
}

function clampViewportPixels(viewport: ViewportPixels): ViewportPixels {
  let width = Math.max(1, Math.round(viewport.width));
  let height = Math.max(1, Math.round(viewport.height));

  if (width > DEFAULT_MAX_CANVAS_DIMENSION || height > DEFAULT_MAX_CANVAS_DIMENSION) {
    const scale = Math.min(
      DEFAULT_MAX_CANVAS_DIMENSION / width,
      DEFAULT_MAX_CANVAS_DIMENSION / height
    );
    width = Math.max(1, Math.floor(width * scale));
    height = Math.max(1, Math.floor(height * scale));
  }

  const pixelCount = width * height;
  if (pixelCount > DEFAULT_MAX_CANVAS_PIXELS) {
    const scale = Math.sqrt(DEFAULT_MAX_CANVAS_PIXELS / pixelCount);
    width = Math.max(1, Math.floor(width * scale));
    height = Math.max(1, Math.floor(height * scale));
  }

  return { width, height };
}

function normalizeBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  return {
    minX: Math.min(bounds.minX, bounds.maxX),
    minY: Math.min(bounds.minY, bounds.maxY),
    maxX: Math.max(bounds.minX, bounds.maxX),
    maxY: Math.max(bounds.minY, bounds.maxY)
  };
}

function resolveSceneFitBounds(scene: LoadedPdfScene["scene"]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (scene.pageRects instanceof Float32Array && scene.pageRects.length >= 4) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let i = 0; i + 3 < scene.pageRects.length; i += 4) {
      const x0 = scene.pageRects[i];
      const y0 = scene.pageRects[i + 1];
      const x1 = scene.pageRects[i + 2];
      const y1 = scene.pageRects[i + 3];
      if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
        continue;
      }

      minX = Math.min(minX, x0, x1);
      minY = Math.min(minY, y0, y1);
      maxX = Math.max(maxX, x0, x1);
      maxY = Math.max(maxY, y0, y1);
    }

    if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) {
      return { minX, minY, maxX, maxY };
    }
  }

  if (
    Number.isFinite(scene.pageBounds.minX) &&
    Number.isFinite(scene.pageBounds.minY) &&
    Number.isFinite(scene.pageBounds.maxX) &&
    Number.isFinite(scene.pageBounds.maxY)
  ) {
    return {
      minX: scene.pageBounds.minX,
      minY: scene.pageBounds.minY,
      maxX: scene.pageBounds.maxX,
      maxY: scene.pageBounds.maxY
    };
  }

  return {
    minX: scene.bounds.minX,
    minY: scene.bounds.minY,
    maxX: scene.bounds.maxX,
    maxY: scene.bounds.maxY
  };
}

function isAllZeroAlpha(pixels: Uint8Array): boolean {
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] !== 0) {
      return false;
    }
  }
  return true;
}

function clampTileDimension(value: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) {
    return 4;
  }
  return Math.min(THREE_PAGE_TEXT_TILE_MAX_TILE_DIM, Math.max(4, rounded));
}

function normalizeObjectPageRects(scene: LoadedPdfScene["scene"]): Float32Array {
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

function normalizeObjectPageTextRanges(
  scene: LoadedPdfScene["scene"],
  pageRects: Float32Array,
  textInstanceCount: number
): Uint32Array {
  const pageCount = Math.max(1, Math.floor(pageRects.length / 4));
  const expectedLength = pageCount * 2;
  const maxTextInstanceCount = Math.max(0, textInstanceCount | 0);

  if (scene.pageTextRanges instanceof Uint32Array && scene.pageTextRanges.length >= expectedLength) {
    const out = new Uint32Array(expectedLength);
    let previousEnd = 0;
    for (let i = 0; i < pageCount; i += 1) {
      const offset = i * 2;
      const start = Math.min(maxTextInstanceCount, Math.max(previousEnd, Math.trunc(scene.pageTextRanges[offset])));
      const count = Math.min(maxTextInstanceCount - start, Math.max(0, Math.trunc(scene.pageTextRanges[offset + 1])));
      out[offset] = start;
      out[offset + 1] = count;
      previousEnd = start + count;
    }
    return out;
  }

  const out = new Uint32Array(expectedLength);
  out[0] = 0;
  out[1] = maxTextInstanceCount;
  for (let i = 1; i < pageCount; i += 1) {
    const offset = i * 2;
    out[offset] = maxTextInstanceCount;
    out[offset + 1] = 0;
  }
  return out;
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

function parseColorInput(input: HeprColorInput | undefined, fallback: [number, number, number]): [number, number, number] {
  if (typeof input === "number" && Number.isFinite(input)) {
    return numberHexToRgb(input);
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return fallback;
    }
    if (/^#?[0-9a-fA-F]{6}$/.test(trimmed)) {
      const normalized = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
      return numberHexToRgb(Number.parseInt(normalized, 16));
    }
    return fallback;
  }
  if (Array.isArray(input) && input.length >= 3) {
    return [clamp01(input[0]), clamp01(input[1]), clamp01(input[2])];
  }
  return fallback;
}

function numberHexToRgb(value: number): [number, number, number] {
  const hex = Math.max(0, Math.min(0xffffff, Math.trunc(value)));
  const red = (hex >> 16) & 0xff;
  const green = (hex >> 8) & 0xff;
  const blue = hex & 0xff;
  return [red / 255, green / 255, blue / 255];
}

function computeInitialCanvasSize(bounds: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}): ViewportPixels {
  const width = Math.max(1e-6, bounds.maxX - bounds.minX);
  const height = Math.max(1e-6, bounds.maxY - bounds.minY);
  const aspect = width / height;

  let canvasWidth = DEFAULT_INITIAL_LONG_SIDE;
  let canvasHeight = DEFAULT_INITIAL_LONG_SIDE;
  if (aspect >= 1) {
    canvasHeight = Math.max(1, Math.round(canvasWidth / aspect));
  } else {
    canvasWidth = Math.max(1, Math.round(canvasHeight * aspect));
  }

  if (canvasWidth < DEFAULT_MIN_CANVAS_DIMENSION || canvasHeight < DEFAULT_MIN_CANVAS_DIMENSION) {
    const scale = Math.max(
      DEFAULT_MIN_CANVAS_DIMENSION / Math.max(1, canvasWidth),
      DEFAULT_MIN_CANVAS_DIMENSION / Math.max(1, canvasHeight)
    );
    canvasWidth = Math.round(canvasWidth * scale);
    canvasHeight = Math.round(canvasHeight * scale);
  }

  if (canvasWidth > DEFAULT_MAX_CANVAS_DIMENSION || canvasHeight > DEFAULT_MAX_CANVAS_DIMENSION) {
    const scale = Math.min(
      DEFAULT_MAX_CANVAS_DIMENSION / canvasWidth,
      DEFAULT_MAX_CANVAS_DIMENSION / canvasHeight
    );
    canvasWidth = Math.max(1, Math.floor(canvasWidth * scale));
    canvasHeight = Math.max(1, Math.floor(canvasHeight * scale));
  }

  const pixelCount = canvasWidth * canvasHeight;
  if (pixelCount > DEFAULT_MAX_CANVAS_PIXELS) {
    const scale = Math.sqrt(DEFAULT_MAX_CANVAS_PIXELS / pixelCount);
    canvasWidth = Math.max(1, Math.floor(canvasWidth * scale));
    canvasHeight = Math.max(1, Math.floor(canvasHeight * scale));
  }

  return {
    width: Math.max(1, canvasWidth),
    height: Math.max(1, canvasHeight)
  };
}
