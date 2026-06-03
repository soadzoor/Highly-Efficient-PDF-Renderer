import * as THREE from "three";

import { createCanvasInteractionController, type CanvasInteractionController } from "./canvasInteractions";
import type { LoadedPdfScene } from "./pdfObjectGenerator";
import type { RendererApi } from "./rendererTypes";
import type { ThreeCompactedStrokeLayer } from "./threeCompactedStrokeLayer";
import { ThreeMaterialFillLayer } from "./threeMaterialFillLayer";
import { ThreeMaterialRasterLayer } from "./threeMaterialRasterLayer";
import { ThreeMaterialStrokeLayer } from "./threeMaterialStrokeLayer";
import { ThreeMaterialTextLayer } from "./threeMaterialTextLayer";
import type { ThreeTriangleStrokeLayer } from "./threeTriangleStrokeLayer";
import type { ThreeTiledOverviewLayer } from "./threeTiledOverviewLayer";
import {
  shouldUseVectorStrokeLod,
  ThreeVectorLodStrokeLayer,
  type VectorStrokeLodStats,
  type VectorLodMode
} from "./vectorStrokeLod";
import { WebGlFloorplanRenderer, type DrawStats, type ViewState } from "./webGlFloorplanRenderer";
import { WebGpuFloorplanRenderer } from "./webGpuFloorplanRenderer";

const DEFAULT_FIT_PADDING_PIXELS = 64;
const DEFAULT_INITIAL_LONG_SIDE = 2048;
const DEFAULT_MIN_CANVAS_DIMENSION = 256;
const DEFAULT_MAX_CANVAS_DIMENSION = 4096;
const DEFAULT_MAX_CANVAS_PIXELS = 4_194_304;
const PERSPECTIVE_NATIVE_OVERSAMPLE = 1.15;
const PERSPECTIVE_RESIZE_HYSTERESIS_MIN = 0.9;
const PERSPECTIVE_RESIZE_HYSTERESIS_MAX = 1.12;
const PERSPECTIVE_VECTOR_ENTER_MAX_VISIBLE_AREA_RATIO = 0.22;
const PERSPECTIVE_VECTOR_EXIT_MAX_VISIBLE_AREA_RATIO = 0.34;
const PERSPECTIVE_VECTOR_ENTER_MAX_VISIBLE_AXIS_RATIO = 0.58;
const PERSPECTIVE_VECTOR_EXIT_MAX_VISIBLE_AXIS_RATIO = 0.68;
const PERSPECTIVE_VECTOR_ENTER_MAX_VISIBLE_STROKES = 100_000;
const PERSPECTIVE_VECTOR_EXIT_MAX_VISIBLE_STROKES = 160_000;
const OVERVIEW_TILE_ENTER_MAX_PROJECTED_LONG_RATIO = 1.02;
const OVERVIEW_TILE_EXIT_MAX_PROJECTED_LONG_RATIO = 1.18;
const OVERVIEW_TILE_ENTER_NDC_MARGIN = 0.035;
const OVERVIEW_TILE_EXIT_NDC_MARGIN = 0.16;
const PERSPECTIVE_NATIVE_2D_ALIGNMENT_DOT = 0.9995;

export type HeprRendererType = "webgl" | "webgpu";
export type HeprColorInput = number | string | [number, number, number];

export interface HeprThreeObjectOptions {
  rendererType?: HeprRendererType;
  hostCanvas?: HTMLCanvasElement;
  threeCameraDriven?: boolean;
  threeCameraDebugLogs?: boolean;
  experimentalMaterialRasters?: boolean;
  experimentalMaterialFills?: boolean;
  experimentalMaterialStrokes?: boolean;
  experimentalMaterialTexts?: boolean;
  panOptimization?: boolean;
  vectorLod?: VectorLodMode;
  curveStrokes?: boolean;
  vectorOnly?: boolean;
  fitPadding?: number;
  pageBackground?: HeprColorInput;
  pageBackgroundOpacity?: number;
  vectorOverrideColor?: HeprColorInput;
  vectorOverrideOpacity?: number;
}

interface ViewportPixels {
  width: number;
  height: number;
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
  panOptimizationEnabled: boolean;
  materialRasterEnabled: boolean;
  materialFillEnabled: boolean;
  materialStrokeEnabled: boolean;
  materialTextEnabled: boolean;
  vectorLodMode: VectorLodMode;
  strokeCurveEnabled: boolean;
  textVectorOnly: boolean;
  pageBackground: [number, number, number, number];
  vectorOverride: [number, number, number, number];
}

export class HeprThreePdfObject extends THREE.Group {
  readonly sourceLabel: string;
  readonly sourceKind: LoadedPdfScene["sourceKind"];
  readonly rendererType: HeprRendererType;
  readonly sceneData: LoadedPdfScene["scene"];

  renderer: RendererApi;
  readonly interactionController: CanvasInteractionController;
  renderCanvas: HTMLCanvasElement;
  renderTexture: THREE.CanvasTexture | null;
  directHostRendering: boolean;
  readonly threeCameraDriven: boolean;
  readonly threeCameraDebugLogs: boolean;

  private readonly pageMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly uvArray: Float32Array;
  private readonly uvAttribute: THREE.BufferAttribute;
  private readonly sceneBounds: SceneBounds;
  private readonly localSceneBounds: SceneBounds;
  private readonly sceneCenterX: number;
  private readonly sceneCenterY: number;
  private readonly cameraDepthByCamera = new WeakMap<THREE.Camera, number>();
  private readonly rendererConfig: RendererConfig;
  private readonly rasterMaterialLayer: ThreeMaterialRasterLayer | null;
  private readonly fillMaterialLayer: ThreeMaterialFillLayer | null;
  private strokeMaterialLayer: ThreeMaterialStrokeLayer | null;
  private readonly triangleStrokeLayer: ThreeTriangleStrokeLayer | null;
  private vectorLodStrokeLayer: ThreeVectorLodStrokeLayer | null;
  private readonly compactedStrokeLayer: ThreeCompactedStrokeLayer | null;
  private readonly textMaterialLayer: ThreeMaterialTextLayer | null;
  private readonly overviewTileLayer: ThreeTiledOverviewLayer | null;

  private controlsCanvas: HTMLCanvasElement | null = null;
  private hostRenderCanvas: HTMLCanvasElement | null = null;
  private pendingInitialFit: boolean;
  private initialFitPaddingPixels: number;
  private lastSyncedFrameSerial = -1;
  private lastUploadedFrameSerial = -1;
  private lastViewportWidth = 0;
  private lastViewportHeight = 0;
  private textureAnisotropy = 1;
  private perspectiveVectorPipelineActive = false;
  private perspectiveNativeProjectionPipelineActive = false;
  private perspectiveOverviewTilePipelineActive = false;
  private frameListener: ((stats: DrawStats) => void) | null = null;
  private lastNativeDrawStats: DrawStats | null = null;
  private isDisposed = false;
  private skipNextBeforeRenderCallback = false;
  private warnedThreeCameraUnsupported = false;
  private warnedThreeCameraPerspectiveFallback = false;
  private lastThreeCameraWarningMessage: string | null = null;
  private lastThreeCameraWarningAtMs = 0;
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
  private readonly cameraForwardWorld = new THREE.Vector3();
  private readonly cameraRightWorld = new THREE.Vector3();
  private readonly cameraUpWorld = new THREE.Vector3();
  private readonly pageRightWorld = new THREE.Vector3();
  private readonly pageUpWorld = new THREE.Vector3();

  constructor(
    loadedScene: LoadedPdfScene,
    rendererType: HeprRendererType,
    renderer: RendererApi,
    renderCanvas: HTMLCanvasElement,
    renderTexture: THREE.CanvasTexture | null,
    directHostRendering: boolean,
    threeCameraDriven: boolean,
    threeCameraDebugLogs: boolean,
    rendererConfig: RendererConfig,
    initialFitPaddingPixels: number,
    rasterMaterialLayer: ThreeMaterialRasterLayer | null,
    fillMaterialLayer: ThreeMaterialFillLayer | null,
    strokeMaterialLayer: ThreeMaterialStrokeLayer | null,
    triangleStrokeLayer: ThreeTriangleStrokeLayer | null,
    vectorLodStrokeLayer: ThreeVectorLodStrokeLayer | null,
    compactedStrokeLayer: ThreeCompactedStrokeLayer | null,
    textMaterialLayer: ThreeMaterialTextLayer | null,
    overviewTileLayer: ThreeTiledOverviewLayer | null,
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
    this.directHostRendering = directHostRendering;
    this.threeCameraDriven = threeCameraDriven;
    this.threeCameraDebugLogs = threeCameraDebugLogs;
    this.rendererConfig = rendererConfig;
    this.rasterMaterialLayer = rasterMaterialLayer;
    this.fillMaterialLayer = fillMaterialLayer;
    this.strokeMaterialLayer = strokeMaterialLayer;
    this.triangleStrokeLayer = triangleStrokeLayer;
    this.vectorLodStrokeLayer = vectorLodStrokeLayer;
    this.compactedStrokeLayer = compactedStrokeLayer;
    this.textMaterialLayer = textMaterialLayer;
    this.overviewTileLayer = overviewTileLayer;
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

    this.name = loadedScene.sourceLabel;
    this.add(this.pageMesh);
    if (this.rasterMaterialLayer) {
      this.rasterMaterialLayer.setVisible(false);
      this.add(this.rasterMaterialLayer.group);
    }
    if (this.fillMaterialLayer) {
      this.fillMaterialLayer.setVisible(false);
      this.add(this.fillMaterialLayer.mesh);
    }
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
    if (this.textMaterialLayer) {
      this.textMaterialLayer.setVisible(false);
      this.add(this.textMaterialLayer.mesh);
    }
    if (this.overviewTileLayer) {
      this.overviewTileLayer.setVisible(false);
      this.add(this.overviewTileLayer.group);
    }
    this.userData.hepr = {
      sourceLabel: this.sourceLabel,
      sourceKind: this.sourceKind,
      rendererType: this.rendererType,
      renderer: this.renderer
    };

    this.configureWebGpuMaterialPipeline();
  }

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

  prepareHostRendering(targetCanvas: HTMLCanvasElement): void {
    if (this.isDisposed) {
      return;
    }
    this.hostRenderCanvas = targetCanvas;
    this.tryEnableDirectHostRendering(targetCanvas);
  }

  fitToBounds(paddingPixels = DEFAULT_FIT_PADDING_PIXELS): void {
    this.pendingInitialFit = false;
    this.initialFitPaddingPixels = Math.max(0, paddingPixels);
    const fitViewport = this.resolveKnownViewportPixelsForFit();
    if (fitViewport) {
      this.resizeNativeRendererCanvas(fitViewport);
    }
    this.renderer.fitToBounds(resolveSceneFitBounds(this.sceneData), this.initialFitPaddingPixels);
  }

  getViewState(): ViewState {
    return this.renderer.getViewState();
  }

  getVectorStrokeLodStats(): VectorStrokeLodStats | null {
    return this.vectorLodStrokeLayer?.getStats() ?? this.renderer.getVectorStrokeLodStats?.() ?? null;
  }

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

  getNativeDrawStats(): DrawStats | null {
    return this.lastNativeDrawStats ? { ...this.lastNativeDrawStats } : null;
  }

  setFrameListener(listener: ((stats: DrawStats) => void) | null): void {
    this.frameListener = listener;
  }

  prepareFrameForThreeRenderer(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    if (this.isDisposed) {
      return;
    }
    this.syncBeforeRender(renderer, camera);
    this.skipNextBeforeRenderCallback = true;
  }

  setVectorLodMode(mode: VectorLodMode): void {
    if (this.isDisposed) {
      return;
    }

    const nextMode = normalizeVectorLodMode(mode);
    const useVectorLodLayer = this.shouldUseThreeVectorLodLayer(nextMode);
    const useExactMaterialLayer = this.shouldUseThreeMaterialStrokeLayer() && !useVectorLodLayer;
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

  setPanOptimizationEnabled(enabled: boolean): void {
    if (this.isDisposed) {
      return;
    }
    this.rendererConfig.panOptimizationEnabled = Boolean(enabled);
    this.renderer.setPanOptimizationEnabled(this.rendererConfig.panOptimizationEnabled);
  }

  setStrokeCurveEnabled(enabled: boolean): void {
    if (this.isDisposed) {
      return;
    }
    this.rendererConfig.strokeCurveEnabled = Boolean(enabled);
    this.renderer.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
    this.vectorLodStrokeLayer?.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
    this.strokeMaterialLayer?.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
    this.textMaterialLayer?.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
  }

  setPageBackgroundColor(red: number, green: number, blue: number, alpha: number): void {
    if (this.isDisposed) {
      return;
    }
    this.rendererConfig.pageBackground = [red, green, blue, alpha];
    this.renderer.setPageBackgroundColor(red, green, blue, alpha);
    this.rasterMaterialLayer?.setPageBackgroundColor(red, green, blue, alpha);
  }

  setVectorColorOverride(red: number, green: number, blue: number, opacity: number): void {
    if (this.isDisposed) {
      return;
    }
    this.rendererConfig.vectorOverride = [red, green, blue, opacity];
    this.renderer.setVectorColorOverride(red, green, blue, opacity);
    this.fillMaterialLayer?.setVectorOverride(red, green, blue, opacity);
    this.vectorLodStrokeLayer?.setVectorOverride(red, green, blue, opacity);
    this.compactedStrokeLayer?.setVectorOverride(red, green, blue, opacity);
    this.triangleStrokeLayer?.setVectorOverride(red, green, blue, opacity);
    this.strokeMaterialLayer?.setVectorOverride(red, green, blue, opacity);
    this.textMaterialLayer?.setVectorOverride(red, green, blue, opacity);
  }

  setViewState(viewState: ViewState): void {
    this.pendingInitialFit = false;
    this.renderer.setViewState(viewState);
  }

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
    this.pageMesh.onBeforeRender = () => {};
    this.pageMesh.geometry.dispose();
    this.pageMesh.material.dispose();
    this.rasterMaterialLayer?.dispose();
    this.fillMaterialLayer?.dispose();
    this.strokeMaterialLayer?.dispose();
    this.triangleStrokeLayer?.dispose();
    this.vectorLodStrokeLayer?.dispose();
    this.compactedStrokeLayer?.dispose();
    this.textMaterialLayer?.dispose();
    this.overviewTileLayer?.dispose();
    this.renderTexture?.dispose();
    this.remove(this.pageMesh);
    if (this.rasterMaterialLayer) {
      this.remove(this.rasterMaterialLayer.group);
    }
    if (this.fillMaterialLayer) {
      this.remove(this.fillMaterialLayer.mesh);
    }
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
    if (this.textMaterialLayer) {
      this.remove(this.textMaterialLayer.mesh);
    }
    if (this.overviewTileLayer) {
      this.remove(this.overviewTileLayer.group);
    }
    this.interactionController.detach();
    this.controlsCanvas = null;
  }

  private shouldUseThreeMaterialStrokeLayer(): boolean {
    return this.rendererType === "webgl" && (this.rendererConfig.materialStrokeEnabled || this.threeCameraDriven);
  }

  private shouldUseThreeVectorLodLayer(mode: VectorLodMode): boolean {
    return (
      this.shouldUseThreeMaterialStrokeLayer() &&
      shouldUseVectorStrokeLod(mode, this.rendererType, this.sceneData.segmentCount)
    );
  }

  private rebuildThreeStrokeLayer(useVectorLodLayer: boolean, useExactMaterialLayer: boolean): void {
    this.disposeThreeStrokeLayers();

    if (useVectorLodLayer) {
      this.vectorLodStrokeLayer = new ThreeVectorLodStrokeLayer(this.sceneData, {
        strokeCurveEnabled: this.rendererConfig.strokeCurveEnabled,
        vectorOverride: this.rendererConfig.vectorOverride
      });
      this.vectorLodStrokeLayer.deactivate();
      this.add(this.vectorLodStrokeLayer.group);
      return;
    }

    if (useExactMaterialLayer) {
      this.strokeMaterialLayer = new ThreeMaterialStrokeLayer(this.sceneData, {
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
    this.perspectiveVectorPipelineActive = false;
    this.perspectiveNativeProjectionPipelineActive = false;
    this.perspectiveOverviewTilePipelineActive = false;
    this.lastSyncedFrameSerial = -1;
    this.lastUploadedFrameSerial = -1;
    this.lastViewportWidth = 0;
    this.lastViewportHeight = 0;
  }

  handleBeforeRender(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    if (this.skipNextBeforeRenderCallback) {
      this.skipNextBeforeRenderCallback = false;
      return;
    }
    this.syncBeforeRender(renderer, camera);
  }

  private syncBeforeRender(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    if (this.isDisposed) {
      return;
    }

    const rendererCanvas = readThreeRendererCanvas(renderer);
    if (rendererCanvas) {
      this.hostRenderCanvas = rendererCanvas;
    }

    const rendererViewport = readThreeRendererViewportPixels(renderer);
    this.updateTextureSampling(renderer);
    const cameraType = camera as { isPerspectiveCamera?: boolean };
    const perspectiveThreeCameraMode = this.threeCameraDriven && cameraType.isPerspectiveCamera === true;
    let perspectiveDerivedView: DerivedThreeCameraView | null = null;
    let perspectiveNativeDirectHost2dPipelineEnabled = false;
    let perspectiveNativeProjectionPipelineEnabled = false;
    let perspectiveVectorPipelineEnabled = false;
    let perspectiveVectorScreenSpacePipelineEnabled = false;
    let perspectiveOverviewTilePipelineEnabled = false;
    if (perspectiveThreeCameraMode) {
      perspectiveDerivedView = this.deriveViewStateFromThreeCamera(camera, rendererViewport);
      const perspectiveScreenSpaceCompatible =
        perspectiveDerivedView !== null && this.shouldUsePerspectiveNativeDirectHost2dPipeline(camera);
      const preferPerspectiveVectorLod = this.vectorLodStrokeLayer !== null && perspectiveDerivedView !== null;
      perspectiveNativeDirectHost2dPipelineEnabled =
        !preferPerspectiveVectorLod &&
        perspectiveDerivedView !== null &&
        perspectiveScreenSpaceCompatible &&
        this.renderPerspectiveNativeDirectHost2dFrame(renderer, rendererViewport, perspectiveDerivedView);
      if (perspectiveNativeDirectHost2dPipelineEnabled) {
        this.setPerspectiveVectorPipelineActive(false);
        this.setPerspectiveOverviewTilePipelineActive(false);
      } else {
        perspectiveOverviewTilePipelineEnabled =
          perspectiveDerivedView !== null &&
          this.overviewTileLayer !== null &&
          this.shouldUsePerspectiveOverviewTilePipeline(camera, rendererViewport, perspectiveDerivedView);
        if (perspectiveOverviewTilePipelineEnabled) {
          this.setPerspectiveNativeProjectionPipelineActive(false);
          this.setPerspectiveVectorPipelineActive(false);
        } else {
          perspectiveNativeProjectionPipelineEnabled =
            !preferPerspectiveVectorLod &&
            perspectiveDerivedView !== null &&
            this.renderPerspectiveNativeProjectionFrame(renderer, camera, rendererViewport, perspectiveDerivedView);
          if (perspectiveNativeProjectionPipelineEnabled) {
            this.setPerspectiveVectorPipelineActive(false);
            this.setPerspectiveOverviewTilePipelineActive(false);
          } else {
            const shouldUseVectorPipeline =
              perspectiveDerivedView !== null &&
              this.shouldUsePerspectiveVectorPipeline(perspectiveDerivedView);
            perspectiveVectorPipelineEnabled = shouldUseVectorPipeline && this.setPerspectiveVectorPipelineActive(true);
            perspectiveVectorScreenSpacePipelineEnabled =
              perspectiveVectorPipelineEnabled && perspectiveScreenSpaceCompatible;
            if (!perspectiveVectorPipelineEnabled) {
              this.setPerspectiveVectorPipelineActive(false);
              if (this.directHostRendering) {
                this.disableDirectHostRendering();
              }
            }
          }
        }
      }
      this.setPerspectiveNativeProjectionPipelineActive(
        perspectiveNativeDirectHost2dPipelineEnabled || perspectiveNativeProjectionPipelineEnabled
      );
      this.setPerspectiveOverviewTilePipelineActive(perspectiveOverviewTilePipelineEnabled);
    } else {
      this.setPerspectiveNativeProjectionPipelineActive(false);
      this.setPerspectiveVectorPipelineActive(false);
      this.setPerspectiveOverviewTilePipelineActive(false);
    }

    let nativeViewport = rendererViewport;
    let nativeViewChanged = false;
    let materialCullingBounds: SceneBounds | null = null;

    if (this.threeCameraDriven) {
      if (perspectiveThreeCameraMode) {
        if (perspectiveNativeDirectHost2dPipelineEnabled || perspectiveNativeProjectionPipelineEnabled) {
          this.warnedThreeCameraPerspectiveFallback = false;
          this.pendingInitialFit = false;
        } else if (perspectiveVectorPipelineEnabled) {
          this.warnedThreeCameraPerspectiveFallback = false;
          const derivedView = perspectiveDerivedView;
          if (derivedView) {
            nativeViewport = derivedView.nativeViewport;
            materialCullingBounds = perspectiveVectorScreenSpacePipelineEnabled
              ? null
              : derivedView.cullingBounds ?? null;
            this.resizeNativeRendererCanvas(nativeViewport);
            const previousView = this.renderer.getViewState();
            if (!isViewStateApproxEqual(previousView, derivedView.viewState)) {
              this.renderer.setViewState(derivedView.viewState);
              nativeViewChanged = true;
            }
            this.pendingInitialFit = false;
          }
        } else if (perspectiveOverviewTilePipelineEnabled) {
          this.warnedThreeCameraPerspectiveFallback = false;
          this.pendingInitialFit = false;
        } else {
          if (!this.warnedThreeCameraPerspectiveFallback) {
            this.warnedThreeCameraPerspectiveFallback = true;
            console.warn(
              "[HEPR] threeCameraDriven with PerspectiveCamera uses adaptive texture fallback. Camera rotation is handled by Three.js; HEPR updates texture resolution/view as needed."
            );
          }
          const perspectiveView = this.derivePerspectiveFallbackViewState(camera as THREE.PerspectiveCamera, rendererViewport);
          if (perspectiveView) {
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
        }
      } else {
        this.warnedThreeCameraPerspectiveFallback = false;
        const derivedView = this.deriveViewStateFromThreeCamera(camera, rendererViewport);
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
    } else {
      this.warnedThreeCameraPerspectiveFallback = false;
      this.resizeNativeRendererCanvas(nativeViewport);
    }

    const viewportChanged = nativeViewport.width !== this.lastViewportWidth || nativeViewport.height !== this.lastViewportHeight;
    if (this.pendingInitialFit) {
      this.renderer.fitToBounds(resolveSceneFitBounds(this.sceneData), this.initialFitPaddingPixels);
      this.pendingInitialFit = false;
      nativeViewChanged = true;
    }

    const shouldRenderDirectHost =
      this.directHostRendering &&
      !this.perspectiveNativeProjectionPipelineActive &&
      !this.perspectiveOverviewTilePipelineActive &&
      renderer.getRenderTarget() === null;
    const shouldRenderThreeCameraFrame =
      this.threeCameraDriven &&
      !this.perspectiveNativeProjectionPipelineActive &&
      !this.perspectiveVectorPipelineActive &&
      !this.perspectiveOverviewTilePipelineActive &&
      (
        !perspectiveThreeCameraMode ||
        nativeViewChanged ||
        viewportChanged
      );
    const shouldRenderExternally = shouldRenderDirectHost || shouldRenderThreeCameraFrame || this.rendererType === "webgpu";
    if (shouldRenderExternally) {
      if (shouldRenderDirectHost) {
        renderer.resetState();
      }
      this.renderer.renderExternalFrame?.(performance.now());
      if (shouldRenderDirectHost) {
        renderer.resetState();
      }
    }

    const localUnitsPerPixel = this.updateMaterialLayerTransforms(
      camera,
      nativeViewport,
      perspectiveVectorPipelineEnabled && !perspectiveVectorScreenSpacePipelineEnabled
    );
    const strokeMaterialPipelineActive =
      perspectiveVectorPipelineEnabled ||
      (
        this.directHostRendering &&
        !this.perspectiveNativeProjectionPipelineActive &&
        !this.perspectiveOverviewTilePipelineActive
      );
    this.updateStrokeLodVisibility(localUnitsPerPixel, strokeMaterialPipelineActive);

    const presentedFrameSerial = this.renderer.getPresentedFrameSerial();
    if (
      !this.perspectiveNativeProjectionPipelineActive &&
      !this.perspectiveOverviewTilePipelineActive &&
      (viewportChanged || presentedFrameSerial !== this.lastSyncedFrameSerial || this.perspectiveVectorPipelineActive)
    ) {
      const viewState = this.renderer.getPresentedViewState();
      if (!this.threeCameraDriven) {
        this.syncOrthographicCamera(camera, viewState, nativeViewport);
      }
      if (!this.directHostRendering && this.renderTexture) {
        if (perspectiveThreeCameraMode) {
          this.updateUvToFullPage();
        } else {
          this.updateUvFromViewState(viewState, nativeViewport);
        }
      }
      if (this.rasterMaterialLayer && this.rasterMaterialLayer.group.visible) {
        this.rasterMaterialLayer.updateFrame(viewState, nativeViewport);
      }
      if (this.fillMaterialLayer && this.fillMaterialLayer.mesh.visible) {
        this.fillMaterialLayer.updateFrame(viewState, nativeViewport, materialCullingBounds);
      }
      if (this.strokeMaterialLayer && this.strokeMaterialLayer.mesh.visible) {
        this.strokeMaterialLayer.updateFrame(viewState, nativeViewport, materialCullingBounds);
      }
      if (this.triangleStrokeLayer && this.triangleStrokeLayer.mesh.visible) {
        this.triangleStrokeLayer.updateFrame(viewState, nativeViewport, materialCullingBounds);
      }
      if (this.vectorLodStrokeLayer && this.vectorLodStrokeLayer.group.visible) {
        this.vectorLodStrokeLayer.updateFrame(viewState, nativeViewport, materialCullingBounds);
      }
      if (this.textMaterialLayer && this.textMaterialLayer.mesh.visible) {
        this.textMaterialLayer.updateFrame(viewState, nativeViewport);
      }
      this.lastSyncedFrameSerial = presentedFrameSerial;
      this.lastViewportWidth = nativeViewport.width;
      this.lastViewportHeight = nativeViewport.height;
    }

    if (
      !this.perspectiveNativeProjectionPipelineActive &&
      !this.perspectiveOverviewTilePipelineActive &&
      !this.directHostRendering &&
      this.renderTexture &&
      presentedFrameSerial !== this.lastUploadedFrameSerial
    ) {
      this.renderTexture.needsUpdate = true;
      this.lastUploadedFrameSerial = presentedFrameSerial;
    }
  }

  private resizeNativeRendererCanvas(viewport: ViewportPixels): void {
    if (this.directHostRendering) {
      return;
    }

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

  private updateTextureSampling(renderer: THREE.WebGLRenderer): void {
    if (this.directHostRendering || !this.renderTexture) {
      this.textureAnisotropy = 1;
      return;
    }

    const maxAnisotropy = Math.max(1, renderer.capabilities.getMaxAnisotropy());
    if (this.textureAnisotropy === maxAnisotropy && this.renderTexture.anisotropy === maxAnisotropy) {
      return;
    }

    this.textureAnisotropy = maxAnisotropy;
    this.renderTexture.anisotropy = maxAnisotropy;
    this.renderTexture.needsUpdate = true;
  }

  private hasCompleteMaterialLayers(): boolean {
    return (
      this.rasterMaterialLayer !== null &&
      this.fillMaterialLayer !== null &&
      (
        this.strokeMaterialLayer !== null ||
        this.triangleStrokeLayer !== null ||
        this.vectorLodStrokeLayer !== null ||
        this.compactedStrokeLayer !== null
      ) &&
      this.textMaterialLayer !== null
    );
  }

  private shouldUsePerspectiveNativeDirectHost2dPipeline(camera: THREE.Camera): boolean {
    if (this.rendererType !== "webgl") {
      return false;
    }

    this.pagePlaneNormal.set(0, 0, 1).transformDirection(this.pageMesh.matrixWorld);
    this.pageRightWorld.set(1, 0, 0).transformDirection(this.pageMesh.matrixWorld);
    this.pageUpWorld.set(0, 1, 0).transformDirection(this.pageMesh.matrixWorld);
    this.cameraForwardWorld.set(0, 0, -1).transformDirection(camera.matrixWorld);
    this.cameraRightWorld.set(1, 0, 0).transformDirection(camera.matrixWorld);
    this.cameraUpWorld.set(0, 1, 0).transformDirection(camera.matrixWorld);

    const normalDot = this.pagePlaneNormal.dot(this.cameraForwardWorld);
    const rightDot = this.pageRightWorld.dot(this.cameraRightWorld);
    const upDot = this.pageUpWorld.dot(this.cameraUpWorld);
    if (!Number.isFinite(normalDot) || !Number.isFinite(rightDot) || !Number.isFinite(upDot)) {
      return false;
    }

    return (
      normalDot <= -PERSPECTIVE_NATIVE_2D_ALIGNMENT_DOT &&
      rightDot >= PERSPECTIVE_NATIVE_2D_ALIGNMENT_DOT &&
      upDot >= PERSPECTIVE_NATIVE_2D_ALIGNMENT_DOT
    );
  }

  private renderPerspectiveNativeDirectHost2dFrame(
    threeRenderer: THREE.WebGLRenderer,
    viewport: ViewportPixels,
    derivedView: DerivedThreeCameraView
  ): boolean {
    if (this.rendererType !== "webgl") {
      return false;
    }
    if (threeRenderer.getRenderTarget() !== null) {
      return false;
    }

    const rendererCanvas = readThreeRendererCanvas(threeRenderer);
    if (!rendererCanvas || !this.ensureHostNativeProjectionRenderer(rendererCanvas)) {
      return false;
    }

    const previousView = this.renderer.getViewState();
    const viewChanged = !isViewStateApproxEqual(previousView, derivedView.viewState);
    const viewportChanged = viewport.width !== this.lastViewportWidth || viewport.height !== this.lastViewportHeight;
    this.renderer.setViewState(derivedView.viewState, {
      preservePanCache: true,
      interacting: viewChanged || viewportChanged
    });

    threeRenderer.resetState();
    this.renderer.renderExternalFrame?.(performance.now());
    threeRenderer.resetState();

    this.lastSyncedFrameSerial = this.renderer.getPresentedFrameSerial();
    this.lastUploadedFrameSerial = this.lastSyncedFrameSerial;
    this.lastViewportWidth = viewport.width;
    this.lastViewportHeight = viewport.height;
    return true;
  }

  private renderPerspectiveNativeProjectionFrame(
    threeRenderer: THREE.WebGLRenderer,
    camera: THREE.Camera,
    viewport: ViewportPixels,
    derivedView: DerivedThreeCameraView
  ): boolean {
    if (this.rendererType !== "webgl" || typeof this.renderer.renderProjectedFrame !== "function") {
      return false;
    }
    if (threeRenderer.getRenderTarget() !== null) {
      return false;
    }

    const rendererCanvas = readThreeRendererCanvas(threeRenderer);
    if (!rendererCanvas || !this.ensureHostNativeProjectionRenderer(rendererCanvas)) {
      return false;
    }

    this.clipFromWorldMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.clipFromLocalMatrix.multiplyMatrices(this.clipFromWorldMatrix, this.pageMesh.matrixWorld);
    this.clipFromDataMatrix.multiplyMatrices(this.clipFromLocalMatrix, this.dataToLocalMatrix);

    const localUnitsPerPixel = this.estimateLocalUnitsPerPixel(camera, viewport);
    threeRenderer.resetState();
    this.renderer.renderProjectedFrame({
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      localToClip: this.clipFromDataMatrix.elements,
      localUnitsPerPixel,
      cullingBounds: derivedView.cullingBounds ?? this.sceneBounds
    });
    threeRenderer.resetState();
    return true;
  }

  private ensureHostNativeProjectionRenderer(hostCanvas: HTMLCanvasElement): boolean {
    if (this.rendererType !== "webgl") {
      return false;
    }

    if (this.renderCanvas !== hostCanvas) {
      const previousRenderer = this.renderer;
      const previousView = previousRenderer.getViewState();
      const nextRenderer = new WebGlFloorplanRenderer(hostCanvas);
      applyRendererConfig(nextRenderer, this.rendererConfig);
      nextRenderer.setExternalFrameDriver?.(true);
      nextRenderer.setScene(this.sceneData);
      nextRenderer.setViewState(previousView);
      nextRenderer.setInteractionViewportProvider(() => this.resolveInteractionViewportRect());

      previousRenderer.setInteractionViewportProvider(null);
      previousRenderer.setFrameListener(null);
      previousRenderer.dispose();

      this.renderer = nextRenderer;
      this.attachNativeFrameListener(nextRenderer);
      this.renderCanvas = hostCanvas;
      this.userData.hepr.renderer = this.renderer;
    }

    this.directHostRendering = true;
    this.rasterMaterialLayer?.setVisible(false);
    this.fillMaterialLayer?.setVisible(false);
    this.strokeMaterialLayer?.setVisible(false);
    this.triangleStrokeLayer?.setVisible(false);
    this.vectorLodStrokeLayer?.deactivate();
    this.compactedStrokeLayer?.deactivate();
    this.textMaterialLayer?.setVisible(false);
    this.overviewTileLayer?.setVisible(false);
    this.renderer.setRasterRenderingEnabled?.(true);
    this.renderer.setFillRenderingEnabled?.(true);
    this.renderer.setStrokeRenderingEnabled?.(true);
    this.renderer.setTextRenderingEnabled?.(true);

    if (this.renderTexture) {
      this.renderTexture.dispose();
      this.renderTexture = null;
    }

    if (this.pageMesh.material.colorWrite !== false) {
      const previousMaterial = this.pageMesh.material;
      this.pageMesh.material = createDirectHostTriggerMaterial();
      previousMaterial.dispose();
    }
    this.pageMesh.frustumCulled = false;
    this.pageMesh.renderOrder = -1_000_000;

    this.lastSyncedFrameSerial = this.renderer.getPresentedFrameSerial();
    this.lastUploadedFrameSerial = this.lastSyncedFrameSerial;
    this.lastViewportWidth = hostCanvas.width;
    this.lastViewportHeight = hostCanvas.height;
    return true;
  }

  private setPerspectiveNativeProjectionPipelineActive(active: boolean): void {
    const nextActive = Boolean(active);
    if (this.perspectiveNativeProjectionPipelineActive === nextActive) {
      return;
    }

    this.perspectiveNativeProjectionPipelineActive = nextActive;
    if (!nextActive) {
      this.lastSyncedFrameSerial = -1;
      this.lastUploadedFrameSerial = -1;
    }
  }

  private setPerspectiveVectorPipelineActive(active: boolean): boolean {
    if (!active) {
      if (!this.perspectiveVectorPipelineActive) {
        return false;
      }
      this.perspectiveVectorPipelineActive = false;
      if (this.directHostRendering) {
        return false;
      }

      this.rasterMaterialLayer?.setVisible(false);
      this.fillMaterialLayer?.setVisible(false);
      this.strokeMaterialLayer?.setVisible(false);
      this.triangleStrokeLayer?.setVisible(false);
      this.vectorLodStrokeLayer?.deactivate();
      this.compactedStrokeLayer?.deactivate();
      this.textMaterialLayer?.setVisible(false);
      this.renderer.setRasterRenderingEnabled?.(true);
      this.renderer.setFillRenderingEnabled?.(true);
      this.renderer.setStrokeRenderingEnabled?.(true);
      this.renderer.setTextRenderingEnabled?.(true);

      const previousMaterial = this.pageMesh.material;
      if (!this.renderTexture) {
        this.renderTexture = createRenderCanvasTexture(this.renderCanvas);
      }
      this.pageMesh.material = createTexturedPageMaterial(this.renderTexture);
      previousMaterial.dispose();
      this.pageMesh.frustumCulled = true;
      this.pageMesh.renderOrder = 0;

      this.lastSyncedFrameSerial = -1;
      this.lastUploadedFrameSerial = -1;
      this.lastViewportWidth = 0;
      this.lastViewportHeight = 0;
      return false;
    }

    if (this.rendererType !== "webgl" || !this.hasCompleteMaterialLayers()) {
      this.perspectiveVectorPipelineActive = false;
      return false;
    }

    if (this.directHostRendering) {
      this.disableDirectHostRendering();
    }

    if (this.perspectiveVectorPipelineActive) {
      return true;
    }
    this.perspectiveVectorPipelineActive = true;
    this.setPerspectiveOverviewTilePipelineActive(false);

    this.rasterMaterialLayer?.setVisible(true);
    this.rasterMaterialLayer?.setPageBackgroundColor(
      this.rendererConfig.pageBackground[0],
      this.rendererConfig.pageBackground[1],
      this.rendererConfig.pageBackground[2],
      this.rendererConfig.pageBackground[3]
    );
    this.fillMaterialLayer?.setVisible(true);
    this.fillMaterialLayer?.setVectorOverride(
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
      this.compactedStrokeLayer.deactivate();
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
    this.textMaterialLayer?.setVisible(true);
    this.textMaterialLayer?.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
    this.textMaterialLayer?.setTextVectorOnly(this.rendererConfig.textVectorOnly);
    this.textMaterialLayer?.setVectorOverride(
      this.rendererConfig.vectorOverride[0],
      this.rendererConfig.vectorOverride[1],
      this.rendererConfig.vectorOverride[2],
      this.rendererConfig.vectorOverride[3]
    );
    this.renderer.setRasterRenderingEnabled?.(false);
    this.renderer.setFillRenderingEnabled?.(false);
    this.renderer.setStrokeRenderingEnabled?.(false);
    this.renderer.setTextRenderingEnabled?.(false);

    const previousMaterial = this.pageMesh.material;
    this.renderTexture?.dispose();
    this.renderTexture = null;
    this.pageMesh.material = createDirectHostTriggerMaterial();
    previousMaterial.dispose();
    this.pageMesh.frustumCulled = false;
    this.pageMesh.renderOrder = -1_000_000;

    this.lastSyncedFrameSerial = -1;
    this.lastUploadedFrameSerial = -1;
    this.lastViewportWidth = 0;
    this.lastViewportHeight = 0;
    return true;
  }

  private setPerspectiveOverviewTilePipelineActive(active: boolean): void {
    const nextActive = Boolean(active && this.overviewTileLayer);
    if (this.perspectiveOverviewTilePipelineActive === nextActive) {
      return;
    }

    this.perspectiveOverviewTilePipelineActive = nextActive;
    this.overviewTileLayer?.setVisible(nextActive);
    if (nextActive) {
      this.rasterMaterialLayer?.setVisible(false);
      this.fillMaterialLayer?.setVisible(false);
      this.strokeMaterialLayer?.setVisible(false);
      this.triangleStrokeLayer?.setVisible(false);
      this.vectorLodStrokeLayer?.deactivate();
      this.compactedStrokeLayer?.deactivate();
      this.textMaterialLayer?.setVisible(false);
      this.renderer.setRasterRenderingEnabled?.(false);
      this.renderer.setFillRenderingEnabled?.(false);
      this.renderer.setStrokeRenderingEnabled?.(false);
      this.renderer.setTextRenderingEnabled?.(false);
    } else {
      this.renderer.setRasterRenderingEnabled?.(true);
      this.renderer.setFillRenderingEnabled?.(true);
      this.renderer.setStrokeRenderingEnabled?.(true);
      this.renderer.setTextRenderingEnabled?.(true);
      this.lastSyncedFrameSerial = -1;
      this.lastUploadedFrameSerial = -1;
    }
  }

  private updateMaterialLayerTransforms(
    camera: THREE.Camera,
    viewport: ViewportPixels,
    useLocalToClip: boolean
  ): number | null {
    if (!this.rasterMaterialLayer || !this.fillMaterialLayer || !this.textMaterialLayer) {
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

  private shouldUsePerspectiveVectorPipeline(derivedView: DerivedThreeCameraView): boolean {
    if (this.rendererType !== "webgl" || !this.hasCompleteMaterialLayers()) {
      return false;
    }

    const bounds = derivedView.cullingBounds;
    if (!bounds) {
      return false;
    }

    if (this.vectorLodStrokeLayer) {
      return true;
    }

    const pageWidth = Math.max(1e-6, this.sceneBounds.maxX - this.sceneBounds.minX);
    const pageHeight = Math.max(1e-6, this.sceneBounds.maxY - this.sceneBounds.minY);
    const visibleWidth = Math.max(0, bounds.maxX - bounds.minX);
    const visibleHeight = Math.max(0, bounds.maxY - bounds.minY);
    const widthRatio = visibleWidth / pageWidth;
    const heightRatio = visibleHeight / pageHeight;
    const areaRatio = widthRatio * heightRatio;

    const maxAreaRatio = this.perspectiveVectorPipelineActive
      ? PERSPECTIVE_VECTOR_EXIT_MAX_VISIBLE_AREA_RATIO
      : PERSPECTIVE_VECTOR_ENTER_MAX_VISIBLE_AREA_RATIO;
    const maxAxisRatio = this.perspectiveVectorPipelineActive
      ? PERSPECTIVE_VECTOR_EXIT_MAX_VISIBLE_AXIS_RATIO
      : PERSPECTIVE_VECTOR_ENTER_MAX_VISIBLE_AXIS_RATIO;
    const maxVisibleStrokes = this.perspectiveVectorPipelineActive
      ? PERSPECTIVE_VECTOR_EXIT_MAX_VISIBLE_STROKES
      : PERSPECTIVE_VECTOR_ENTER_MAX_VISIBLE_STROKES;

    const estimatedVisibleStrokes =
      this.strokeMaterialLayer?.estimateVisibleSegmentCount(
        derivedView.viewState,
        derivedView.nativeViewport,
        bounds
      ) ??
      0;

    return (
      Number.isFinite(areaRatio) &&
      Number.isFinite(widthRatio) &&
      Number.isFinite(heightRatio) &&
      estimatedVisibleStrokes <= maxVisibleStrokes &&
      areaRatio <= maxAreaRatio &&
      widthRatio <= maxAxisRatio &&
      heightRatio <= maxAxisRatio
    );
  }

  private shouldUsePerspectiveOverviewTilePipeline(
    camera: THREE.Camera,
    viewport: ViewportPixels,
    derivedView: DerivedThreeCameraView
  ): boolean {
    if (this.rendererType !== "webgl" || !this.overviewTileLayer) {
      return false;
    }
    return this.overviewTileLayer.updateForCamera(
      camera,
      viewport,
      this.pageMesh.matrixWorld,
      derivedView.cullingBounds ?? this.sceneBounds
    );
  }

  private tryEnableDirectHostRendering(hostCanvas: HTMLCanvasElement): void {
    if (this.directHostRendering || this.rendererType !== "webgl") {
      return;
    }
    this.perspectiveVectorPipelineActive = false;
    if (this.renderCanvas !== hostCanvas) {
      const previousRenderer = this.renderer;
      const previousView = previousRenderer.getViewState();
      const nextRenderer = new WebGlFloorplanRenderer(hostCanvas);
      applyRendererConfig(nextRenderer, this.rendererConfig);
      nextRenderer.setExternalFrameDriver?.(true);
      nextRenderer.setScene(this.sceneData);
      nextRenderer.setViewState(previousView);
      nextRenderer.setInteractionViewportProvider(() => this.resolveInteractionViewportRect());

      previousRenderer.setInteractionViewportProvider(null);
      previousRenderer.setFrameListener(null);
      previousRenderer.dispose();

      this.renderer = nextRenderer;
      this.attachNativeFrameListener(nextRenderer);
      this.renderCanvas = hostCanvas;
      this.userData.hepr.renderer = this.renderer;
    }

    this.renderer.setExternalFrameDriver?.(true);
    this.directHostRendering = true;

    if (this.renderTexture) {
      this.renderTexture.dispose();
      this.renderTexture = null;
    }

    const previousMaterial = this.pageMesh.material;
    this.pageMesh.material = createDirectHostTriggerMaterial();
    previousMaterial.dispose();
    this.pageMesh.frustumCulled = false;
    this.pageMesh.renderOrder = -1_000_000;

    if (this.rasterMaterialLayer) {
      this.rasterMaterialLayer.setVisible(true);
      this.rasterMaterialLayer.setPageBackgroundColor(
        this.rendererConfig.pageBackground[0],
        this.rendererConfig.pageBackground[1],
        this.rendererConfig.pageBackground[2],
        this.rendererConfig.pageBackground[3]
      );
      this.renderer.setRasterRenderingEnabled?.(false);
    } else {
      this.renderer.setRasterRenderingEnabled?.(true);
    }

    if (this.fillMaterialLayer) {
      this.fillMaterialLayer.setVisible(true);
      this.fillMaterialLayer.setVectorOverride(
        this.rendererConfig.vectorOverride[0],
        this.rendererConfig.vectorOverride[1],
        this.rendererConfig.vectorOverride[2],
        this.rendererConfig.vectorOverride[3]
      );
      this.renderer.setFillRenderingEnabled?.(false);
    } else {
      this.renderer.setFillRenderingEnabled?.(true);
    }

    if (this.vectorLodStrokeLayer) {
      const localUnitsPerPixel = 1 / Math.max(1e-6, this.renderer.getViewState().zoom);
      this.strokeMaterialLayer?.setVisible(false);
      this.triangleStrokeLayer?.setVisible(false);
      this.compactedStrokeLayer?.deactivate();
      this.vectorLodStrokeLayer.setScreenSpaceTransform();
      this.vectorLodStrokeLayer.setVisible(true);
      this.vectorLodStrokeLayer.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
      this.vectorLodStrokeLayer.updateForLocalUnitsPerPixel(localUnitsPerPixel);
      this.vectorLodStrokeLayer.setVectorOverride(
        this.rendererConfig.vectorOverride[0],
        this.rendererConfig.vectorOverride[1],
        this.rendererConfig.vectorOverride[2],
        this.rendererConfig.vectorOverride[3]
      );
      this.renderer.setStrokeRenderingEnabled?.(false);
    } else if (this.compactedStrokeLayer) {
      this.strokeMaterialLayer?.setVisible(false);
      this.triangleStrokeLayer?.setVisible(false);
      this.compactedStrokeLayer.updateForLocalUnitsPerPixel(1 / Math.max(1e-6, this.renderer.getViewState().zoom));
      this.compactedStrokeLayer.setVectorOverride(
        this.rendererConfig.vectorOverride[0],
        this.rendererConfig.vectorOverride[1],
        this.rendererConfig.vectorOverride[2],
        this.rendererConfig.vectorOverride[3]
      );
      this.renderer.setStrokeRenderingEnabled?.(false);
    } else if (this.triangleStrokeLayer) {
      this.strokeMaterialLayer?.setVisible(false);
      this.triangleStrokeLayer.setVisible(true);
      this.triangleStrokeLayer.setVectorOverride(
        this.rendererConfig.vectorOverride[0],
        this.rendererConfig.vectorOverride[1],
        this.rendererConfig.vectorOverride[2],
        this.rendererConfig.vectorOverride[3]
      );
      this.renderer.setStrokeRenderingEnabled?.(false);
    } else if (this.strokeMaterialLayer) {
      this.strokeMaterialLayer.setVisible(true);
      this.strokeMaterialLayer.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
      this.strokeMaterialLayer.setVectorOverride(
        this.rendererConfig.vectorOverride[0],
        this.rendererConfig.vectorOverride[1],
        this.rendererConfig.vectorOverride[2],
        this.rendererConfig.vectorOverride[3]
      );
      this.renderer.setStrokeRenderingEnabled?.(false);
    } else {
      this.renderer.setStrokeRenderingEnabled?.(true);
    }

    if (this.textMaterialLayer) {
      this.textMaterialLayer.setVisible(true);
      this.textMaterialLayer.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
      this.textMaterialLayer.setTextVectorOnly(this.rendererConfig.textVectorOnly);
      this.textMaterialLayer.setVectorOverride(
        this.rendererConfig.vectorOverride[0],
        this.rendererConfig.vectorOverride[1],
        this.rendererConfig.vectorOverride[2],
        this.rendererConfig.vectorOverride[3]
      );
      this.renderer.setTextRenderingEnabled?.(false);
    } else {
      this.renderer.setTextRenderingEnabled?.(true);
    }

    this.lastSyncedFrameSerial = -1;
    this.lastUploadedFrameSerial = -1;
    this.lastViewportWidth = 0;
    this.lastViewportHeight = 0;
  }

  private disableDirectHostRendering(): void {
    if (!this.directHostRendering || this.rendererType !== "webgl") {
      return;
    }

    const previousRenderer = this.renderer;
    const previousView = previousRenderer.getViewState();
    const nextCanvas = document.createElement("canvas");
    const fallbackViewport = this.resolveKnownViewportPixelsForFit() ?? computeInitialCanvasSize(this.sceneBounds);
    const clampedViewport = clampViewportPixels(fallbackViewport);
    nextCanvas.width = clampedViewport.width;
    nextCanvas.height = clampedViewport.height;

    const nextRenderer = new WebGlFloorplanRenderer(nextCanvas);
    applyRendererConfig(nextRenderer, this.rendererConfig);
    nextRenderer.setExternalFrameDriver?.(true);
    nextRenderer.setScene(this.sceneData);
    nextRenderer.setViewState(previousView);
    nextRenderer.setInteractionViewportProvider(() => this.resolveInteractionViewportRect());

    previousRenderer.setInteractionViewportProvider(null);
    previousRenderer.setFrameListener(null);
    previousRenderer.dispose();

    this.renderer = nextRenderer;
    this.attachNativeFrameListener(nextRenderer);
    this.renderCanvas = nextCanvas;
    this.userData.hepr.renderer = this.renderer;
    this.directHostRendering = false;
    this.perspectiveVectorPipelineActive = false;

    this.rasterMaterialLayer?.setVisible(false);
    this.fillMaterialLayer?.setVisible(false);
    this.strokeMaterialLayer?.setVisible(false);
    this.triangleStrokeLayer?.setVisible(false);
    this.vectorLodStrokeLayer?.deactivate();
    this.compactedStrokeLayer?.deactivate();
    this.textMaterialLayer?.setVisible(false);
    this.renderer.setRasterRenderingEnabled?.(true);
    this.renderer.setFillRenderingEnabled?.(true);
    this.renderer.setStrokeRenderingEnabled?.(true);
    this.renderer.setTextRenderingEnabled?.(true);

    const previousMaterial = this.pageMesh.material;
    this.renderTexture?.dispose();
    this.renderTexture = createRenderCanvasTexture(this.renderCanvas);
    this.pageMesh.material = createTexturedPageMaterial(this.renderTexture);
    previousMaterial.dispose();
    this.pageMesh.frustumCulled = true;
    this.pageMesh.renderOrder = 0;

    this.lastSyncedFrameSerial = -1;
    this.lastUploadedFrameSerial = -1;
    this.lastViewportWidth = 0;
    this.lastViewportHeight = 0;
  }

  private configureWebGpuMaterialPipeline(): void {
    if (this.rendererType !== "webgpu") {
      return;
    }

    const requestedAnyMaterialLayers =
      this.rendererConfig.materialRasterEnabled ||
      this.rendererConfig.materialFillEnabled ||
      this.rendererConfig.materialStrokeEnabled ||
      this.rendererConfig.materialTextEnabled;
    const useRaster = this.rendererConfig.materialRasterEnabled && this.rasterMaterialLayer !== null;
    const useFill = this.rendererConfig.materialFillEnabled && this.fillMaterialLayer !== null;
    const useStroke = this.rendererConfig.materialStrokeEnabled && this.strokeMaterialLayer !== null;
    const useText = this.rendererConfig.materialTextEnabled && this.textMaterialLayer !== null;
    const enableMaterialPipeline = useRaster && useFill && useStroke && useText;

    if (!enableMaterialPipeline) {
      if (requestedAnyMaterialLayers) {
        console.warn(
          "[HEPR] WebGPU material mode requires all flags enabled (rasters/fills/strokes/texts). Falling back to native pipeline."
        );
      }
      this.rasterMaterialLayer?.setVisible(false);
      this.fillMaterialLayer?.setVisible(false);
      this.strokeMaterialLayer?.setVisible(false);
      this.triangleStrokeLayer?.setVisible(false);
      this.vectorLodStrokeLayer?.deactivate();
      this.compactedStrokeLayer?.deactivate();
      this.textMaterialLayer?.setVisible(false);
      this.renderer.setRasterRenderingEnabled?.(true);
      this.renderer.setFillRenderingEnabled?.(true);
      this.renderer.setStrokeRenderingEnabled?.(true);
      this.renderer.setTextRenderingEnabled?.(true);
      return;
    }

    this.rasterMaterialLayer?.setVisible(true);
    this.rasterMaterialLayer?.setPageBackgroundColor(
      this.rendererConfig.pageBackground[0],
      this.rendererConfig.pageBackground[1],
      this.rendererConfig.pageBackground[2],
      this.rendererConfig.pageBackground[3]
    );

    this.fillMaterialLayer?.setVisible(true);
    this.fillMaterialLayer?.setVectorOverride(
      this.rendererConfig.vectorOverride[0],
      this.rendererConfig.vectorOverride[1],
      this.rendererConfig.vectorOverride[2],
      this.rendererConfig.vectorOverride[3]
    );

    this.strokeMaterialLayer?.setVisible(true);
    this.vectorLodStrokeLayer?.deactivate();
    this.compactedStrokeLayer?.deactivate();
    this.strokeMaterialLayer?.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
    this.strokeMaterialLayer?.setVectorOverride(
      this.rendererConfig.vectorOverride[0],
      this.rendererConfig.vectorOverride[1],
      this.rendererConfig.vectorOverride[2],
      this.rendererConfig.vectorOverride[3]
    );

    this.textMaterialLayer?.setVisible(true);
    this.textMaterialLayer?.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
    this.textMaterialLayer?.setTextVectorOnly(this.rendererConfig.textVectorOnly);
    this.textMaterialLayer?.setVectorOverride(
      this.rendererConfig.vectorOverride[0],
      this.rendererConfig.vectorOverride[1],
      this.rendererConfig.vectorOverride[2],
      this.rendererConfig.vectorOverride[3]
    );

    this.renderer.setRasterRenderingEnabled?.(false);
    this.renderer.setFillRenderingEnabled?.(false);
    this.renderer.setStrokeRenderingEnabled?.(false);
    this.renderer.setTextRenderingEnabled?.(false);

    const previousMaterial = this.pageMesh.material;
    this.pageMesh.material = createDirectHostTriggerMaterial();
    previousMaterial.dispose();
    this.pageMesh.frustumCulled = false;
    this.pageMesh.renderOrder = -1_000_000;

    if (this.renderTexture) {
      this.renderTexture.dispose();
      this.renderTexture = null;
    }

    this.lastSyncedFrameSerial = -1;
    this.lastUploadedFrameSerial = -1;
    this.lastViewportWidth = 0;
    this.lastViewportHeight = 0;
  }

  private syncOrthographicCamera(camera: THREE.Camera, viewState: ViewState, viewport: ViewportPixels): void {
    const maybeOrtho = camera as THREE.OrthographicCamera;
    if (!maybeOrtho || (maybeOrtho as { isOrthographicCamera?: boolean }).isOrthographicCamera !== true) {
      return;
    }

    const safeZoom = Math.max(1e-6, viewState.zoom);
    const halfWidth = viewport.width / (2 * safeZoom);
    const halfHeight = viewport.height / (2 * safeZoom);
    maybeOrtho.left = -halfWidth;
    maybeOrtho.right = halfWidth;
    maybeOrtho.top = halfHeight;
    maybeOrtho.bottom = -halfHeight;
    maybeOrtho.zoom = 1;

    const z = this.cameraDepthByCamera.get(maybeOrtho) ?? maybeOrtho.position.z;
    this.cameraDepthByCamera.set(maybeOrtho, z);
    maybeOrtho.position.set(
      viewState.cameraCenterX - this.sceneCenterX,
      viewState.cameraCenterY - this.sceneCenterY,
      z
    );
    maybeOrtho.updateProjectionMatrix();
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
    if (this.hostRenderCanvas) {
      return this.hostRenderCanvas.getBoundingClientRect();
    }
    return null;
  }

  private resolveKnownViewportPixelsForFit(): ViewportPixels | null {
    if (this.lastViewportWidth > 0 && this.lastViewportHeight > 0) {
      return { width: this.lastViewportWidth, height: this.lastViewportHeight };
    }

    const canvas = this.hostRenderCanvas ?? this.controlsCanvas;
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
      this.warnThreeCameraUnsupported("[HEPR] threeCameraDriven mode supports orthographic or perspective cameras.");
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
      this.warnThreeCameraUnsupported("[HEPR] threeCameraDriven mode requires a non-singular PDF object transform.");
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
        "[HEPR] threeCameraDriven mode could not project enough viewport corners onto the PDF plane for this camera/view."
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
        `[HEPR] threeCameraDriven orthographic mode has invalid axis scale (sx=${sx.toExponential(3)}, sy=${sy.toExponential(3)}).`
      );
      return null;
    }

    const maxCrossAxis = 1e-4;
    if (!Number.isFinite(shearX) || !Number.isFinite(shearY) || Math.abs(shearX) > maxCrossAxis || Math.abs(shearY) > maxCrossAxis) {
      this.warnThreeCameraUnsupported(
        `[HEPR] threeCameraDriven orthographic mode is skewed (shearX=${shearX.toExponential(3)}, shearY=${shearY.toExponential(3)}).`
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
        `[HEPR] threeCameraDriven orthographic mode produced non-finite view values (cx=${localCenterX}, cy=${localCenterY}, zoom=${zoom}).`
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
    if (!this.threeCameraDebugLogs) {
      if (this.warnedThreeCameraUnsupported) {
        return;
      }
      this.warnedThreeCameraUnsupported = true;
      console.warn(message);
      return;
    }

    const now = performance.now();
    const sameMessage = this.lastThreeCameraWarningMessage === message;
    const tooSoon = sameMessage && now - this.lastThreeCameraWarningAtMs < 250;
    if (tooSoon) {
      this.warnedThreeCameraUnsupported = true;
      return;
    }

    this.warnedThreeCameraUnsupported = true;
    this.lastThreeCameraWarningMessage = message;
    this.lastThreeCameraWarningAtMs = now;
    console.warn(`${message} source=${this.sourceLabel}`);
  }

  private attachNativeFrameListener(renderer: RendererApi): void {
    renderer.setFrameListener((stats) => {
      this.lastNativeDrawStats = stats;
      this.frameListener?.(stats);
    });
  }
}

export async function createThreePdfObject(
  loadedScene: LoadedPdfScene,
  options: HeprThreeObjectOptions = {}
): Promise<HeprThreePdfObject> {
  const rendererType = options.rendererType ?? "webgl";
  const threeCameraDriven = options.threeCameraDriven === true;
  const threeCameraDebugLogs = options.threeCameraDebugLogs === true;
  const sceneBounds = normalizeBounds(resolveSceneFitBounds(loadedScene.scene));
  const sceneCenterX = (sceneBounds.minX + sceneBounds.maxX) * 0.5;
  const sceneCenterY = (sceneBounds.minY + sceneBounds.maxY) * 0.5;
  const hostCanvas = rendererType === "webgl" ? options.hostCanvas ?? null : null;
  const renderCanvas = hostCanvas ?? document.createElement("canvas");
  if (hostCanvas) {
    if (renderCanvas.width <= 0 || renderCanvas.height <= 0) {
      const fallbackCanvasSize = computeInitialCanvasSize(sceneBounds);
      renderCanvas.width = fallbackCanvasSize.width;
      renderCanvas.height = fallbackCanvasSize.height;
    }
  } else {
    const initialCanvasSize = computeInitialCanvasSize(sceneBounds);
    renderCanvas.width = initialCanvasSize.width;
    renderCanvas.height = initialCanvasSize.height;
  }

  const rendererConfig = normalizeRendererConfig(options);
  const initialFitPaddingPixels = normalizePadding(options.fitPadding);
  const forceWebGlMaterialLayers = rendererType === "webgl" && threeCameraDriven;
  const shouldConstructStrokeMaterial =
    rendererConfig.materialStrokeEnabled || forceWebGlMaterialLayers;
  const useVectorLodStrokeLayer =
    shouldConstructStrokeMaterial &&
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
  if (rendererType === "webgpu" || hostCanvas || threeCameraDriven) {
    nativeRenderer.setExternalFrameDriver?.(true);
  }
  nativeRenderer.setScene(loadedScene.scene);

  const enableMaterialLayerConstruction =
    rendererType === "webgl" ||
    (
      rendererType === "webgpu" &&
      rendererConfig.materialRasterEnabled &&
      rendererConfig.materialFillEnabled &&
      rendererConfig.materialStrokeEnabled &&
      rendererConfig.materialTextEnabled
    );

  const rasterMaterialLayer =
    enableMaterialLayerConstruction && (rendererConfig.materialRasterEnabled || forceWebGlMaterialLayers)
      ? new ThreeMaterialRasterLayer(loadedScene.scene, {
        pageBackground: rendererConfig.pageBackground
      })
      : null;

  const fillMaterialLayer =
    enableMaterialLayerConstruction && (rendererConfig.materialFillEnabled || forceWebGlMaterialLayers)
      ? new ThreeMaterialFillLayer(loadedScene.scene, {
        vectorOverride: rendererConfig.vectorOverride
      })
      : null;

  const strokeMaterialLayer =
    !useVectorLodStrokeLayer &&
    enableMaterialLayerConstruction &&
    shouldConstructStrokeMaterial
      ? new ThreeMaterialStrokeLayer(loadedScene.scene, {
        strokeCurveEnabled: rendererConfig.strokeCurveEnabled,
        vectorOverride: rendererConfig.vectorOverride
      })
      : null;

  const triangleStrokeLayer = null;

  const vectorLodStrokeLayer =
    useVectorLodStrokeLayer && enableMaterialLayerConstruction
      ? new ThreeVectorLodStrokeLayer(loadedScene.scene, {
        strokeCurveEnabled: rendererConfig.strokeCurveEnabled,
        vectorOverride: rendererConfig.vectorOverride
      })
      : null;

  const compactedStrokeLayer: ThreeCompactedStrokeLayer | null = null;

  const textMaterialLayer =
    enableMaterialLayerConstruction && (rendererConfig.materialTextEnabled || forceWebGlMaterialLayers)
      ? new ThreeMaterialTextLayer(loadedScene.scene, {
        strokeCurveEnabled: rendererConfig.strokeCurveEnabled,
        textVectorOnly: rendererConfig.textVectorOnly,
        vectorOverride: rendererConfig.vectorOverride
      })
      : null;

  const overviewTileLayer: ThreeTiledOverviewLayer | null = null;

  const renderTexture = createRenderCanvasTexture(renderCanvas);

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

  const material = createTexturedPageMaterial(renderTexture);

  const pageMesh = new THREE.Mesh(geometry, material);
  const object = new HeprThreePdfObject(
    loadedScene,
    rendererType,
    nativeRenderer,
    renderCanvas,
    renderTexture,
    false,
    threeCameraDriven,
    threeCameraDebugLogs,
    rendererConfig,
    initialFitPaddingPixels,
    rasterMaterialLayer,
    fillMaterialLayer,
    strokeMaterialLayer,
    triangleStrokeLayer,
    vectorLodStrokeLayer,
    compactedStrokeLayer,
    textMaterialLayer,
    overviewTileLayer,
    pageMesh,
    uvArray,
    uvAttribute
  );
  pageMesh.onBeforeRender = (renderer, _scene, camera) => {
    object.handleBeforeRender(renderer as THREE.WebGLRenderer, camera as THREE.Camera);
  };
  if (options.hostCanvas) {
    object.prepareHostRendering(options.hostCanvas);
  }

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

function createDirectHostTriggerMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
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
    panOptimizationEnabled: options.panOptimization !== false,
    materialRasterEnabled: options.experimentalMaterialRasters === true,
    materialFillEnabled: options.experimentalMaterialFills === true,
    materialStrokeEnabled: options.experimentalMaterialStrokes === true,
    materialTextEnabled: options.experimentalMaterialTexts === true,
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
  renderer.setPanOptimizationEnabled(config.panOptimizationEnabled);
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

function readThreeRendererViewportPixels(renderer: THREE.WebGLRenderer): ViewportPixels {
  const context = typeof renderer.getContext === "function" ? renderer.getContext() : null;
  if (context && typeof context.drawingBufferWidth === "number" && typeof context.drawingBufferHeight === "number") {
    const width = Math.max(1, Math.round(context.drawingBufferWidth));
    const height = Math.max(1, Math.round(context.drawingBufferHeight));
    return { width, height };
  }

  const size = typeof renderer.getSize === "function" ? renderer.getSize(new THREE.Vector2()) : null;
  const pixelRatio = typeof renderer.getPixelRatio === "function" ? renderer.getPixelRatio() : window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round((size?.x ?? renderer.domElement.clientWidth) * pixelRatio));
  const height = Math.max(1, Math.round((size?.y ?? renderer.domElement.clientHeight) * pixelRatio));
  return { width, height };
}

function readThreeRendererCanvas(renderer: THREE.WebGLRenderer): HTMLCanvasElement | null {
  const element = renderer.domElement;
  return element instanceof HTMLCanvasElement ? element : null;
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

function normalizePadding(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_FIT_PADDING_PIXELS;
  }
  return Math.max(0, value);
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
