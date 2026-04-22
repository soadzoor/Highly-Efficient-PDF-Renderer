import * as THREE from "three";

import { createCanvasInteractionController, type CanvasInteractionController } from "./canvasInteractions";
import type { LoadedPdfScene } from "./pdfObjectGenerator";
import type { RendererApi } from "./rendererTypes";
import { ThreeMaterialFillLayer } from "./threeMaterialFillLayer";
import { ThreeMaterialRasterLayer } from "./threeMaterialRasterLayer";
import { ThreeMaterialStrokeLayer } from "./threeMaterialStrokeLayer";
import { ThreeMaterialTextLayer } from "./threeMaterialTextLayer";
import { WebGlFloorplanRenderer, type ViewState } from "./webGlFloorplanRenderer";
import { WebGpuFloorplanRenderer } from "./webGpuFloorplanRenderer";

const DEFAULT_FIT_PADDING_PIXELS = 64;
const DEFAULT_INITIAL_LONG_SIDE = 2048;
const DEFAULT_MIN_CANVAS_DIMENSION = 256;
const DEFAULT_MAX_CANVAS_DIMENSION = 4096;
const DEFAULT_MAX_CANVAS_PIXELS = 4_194_304;

export type HeprRendererType = "webgl" | "webgpu";
export type HeprColorInput = number | string | [number, number, number];

export interface HeprThreeObjectOptions {
  rendererType?: HeprRendererType;
  experimentalMaterialRasters?: boolean;
  experimentalMaterialFills?: boolean;
  experimentalMaterialStrokes?: boolean;
  experimentalMaterialTexts?: boolean;
  panOptimization?: boolean;
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

interface RendererConfig {
  panOptimizationEnabled: boolean;
  materialRasterEnabled: boolean;
  materialFillEnabled: boolean;
  materialStrokeEnabled: boolean;
  materialTextEnabled: boolean;
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

  private readonly pageMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly uvArray: Float32Array;
  private readonly uvAttribute: THREE.BufferAttribute;
  private readonly sceneBounds: { minX: number; minY: number; maxX: number; maxY: number };
  private readonly cameraDepthByCamera = new WeakMap<THREE.Camera, number>();
  private readonly rendererConfig: RendererConfig;
  private readonly rasterMaterialLayer: ThreeMaterialRasterLayer | null;
  private readonly fillMaterialLayer: ThreeMaterialFillLayer | null;
  private readonly strokeMaterialLayer: ThreeMaterialStrokeLayer | null;
  private readonly textMaterialLayer: ThreeMaterialTextLayer | null;

  private controlsCanvas: HTMLCanvasElement | null = null;
  private hostRenderCanvas: HTMLCanvasElement | null = null;
  private pendingInitialFit: boolean;
  private initialFitPaddingPixels: number;
  private lastSyncedFrameSerial = -1;
  private lastUploadedFrameSerial = -1;
  private lastViewportWidth = 0;
  private lastViewportHeight = 0;
  private isDisposed = false;

  constructor(
    loadedScene: LoadedPdfScene,
    rendererType: HeprRendererType,
    renderer: RendererApi,
    renderCanvas: HTMLCanvasElement,
    renderTexture: THREE.CanvasTexture | null,
    directHostRendering: boolean,
    rendererConfig: RendererConfig,
    initialFitPaddingPixels: number,
    rasterMaterialLayer: ThreeMaterialRasterLayer | null,
    fillMaterialLayer: ThreeMaterialFillLayer | null,
    strokeMaterialLayer: ThreeMaterialStrokeLayer | null,
    textMaterialLayer: ThreeMaterialTextLayer | null,
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
    this.rendererConfig = rendererConfig;
    this.rasterMaterialLayer = rasterMaterialLayer;
    this.fillMaterialLayer = fillMaterialLayer;
    this.strokeMaterialLayer = strokeMaterialLayer;
    this.textMaterialLayer = textMaterialLayer;
    this.pageMesh = pageMesh;
    this.uvArray = uvArray;
    this.uvAttribute = uvAttribute;
    this.pendingInitialFit = true;
    this.initialFitPaddingPixels = Math.max(0, initialFitPaddingPixels);
    this.sceneBounds = normalizeBounds(resolveSceneFitBounds(loadedScene.scene));
    this.interactionController = createCanvasInteractionController(() => this.renderer);
    this.renderer.setInteractionViewportProvider(() => this.resolveInteractionViewportRect());

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
    if (this.textMaterialLayer) {
      this.textMaterialLayer.setVisible(false);
      this.add(this.textMaterialLayer.mesh);
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

  setViewState(viewState: ViewState): void {
    this.pendingInitialFit = false;
    this.renderer.setViewState(viewState);
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.renderer.setInteractionViewportProvider(null);
    this.renderer.dispose();
    this.pageMesh.onBeforeRender = () => {};
    this.pageMesh.geometry.dispose();
    this.pageMesh.material.dispose();
    this.rasterMaterialLayer?.dispose();
    this.fillMaterialLayer?.dispose();
    this.strokeMaterialLayer?.dispose();
    this.textMaterialLayer?.dispose();
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
    if (this.textMaterialLayer) {
      this.remove(this.textMaterialLayer.mesh);
    }
    this.interactionController.detach();
    this.controlsCanvas = null;
  }

  handleBeforeRender(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    if (this.isDisposed) {
      return;
    }

    const rendererCanvas = readThreeRendererCanvas(renderer);
    if (rendererCanvas) {
      this.hostRenderCanvas = rendererCanvas;
      this.tryEnableDirectHostRendering(rendererCanvas);
    }

    const viewport = readThreeRendererViewportPixels(renderer);
    this.resizeNativeRendererCanvas(viewport);
    if (this.pendingInitialFit) {
      this.renderer.fitToBounds(resolveSceneFitBounds(this.sceneData), this.initialFitPaddingPixels);
      this.pendingInitialFit = false;
    }

    if (this.rendererType === "webgpu") {
      this.renderer.renderExternalFrame?.(performance.now());
    }

    if (this.directHostRendering && renderer.getRenderTarget() === null) {
      renderer.resetState();
      this.renderer.renderExternalFrame?.(performance.now());
      renderer.resetState();
    }

    const presentedFrameSerial = this.renderer.getPresentedFrameSerial();
    const viewportChanged = viewport.width !== this.lastViewportWidth || viewport.height !== this.lastViewportHeight;
    if (viewportChanged || presentedFrameSerial !== this.lastSyncedFrameSerial) {
      const viewState = this.renderer.getPresentedViewState();
      this.syncOrthographicCamera(camera, viewState, viewport);
      if (!this.directHostRendering) {
        this.updateUvFromViewState(viewState, viewport);
      }
      if (this.rasterMaterialLayer && this.rasterMaterialLayer.group.visible) {
        this.rasterMaterialLayer.updateFrame(viewState, viewport);
      }
      if (this.fillMaterialLayer && this.fillMaterialLayer.mesh.visible) {
        this.fillMaterialLayer.updateFrame(viewState, viewport);
      }
      if (this.strokeMaterialLayer && this.strokeMaterialLayer.mesh.visible) {
        this.strokeMaterialLayer.updateFrame(viewState, viewport);
      }
      if (this.textMaterialLayer && this.textMaterialLayer.mesh.visible) {
        this.textMaterialLayer.updateFrame(viewState, viewport);
      }
      this.lastSyncedFrameSerial = presentedFrameSerial;
      this.lastViewportWidth = viewport.width;
      this.lastViewportHeight = viewport.height;
    }

    if (!this.directHostRendering && this.renderTexture && presentedFrameSerial !== this.lastUploadedFrameSerial) {
      this.renderTexture.needsUpdate = true;
      this.lastUploadedFrameSerial = presentedFrameSerial;
    }
  }

  private resizeNativeRendererCanvas(viewport: ViewportPixels): void {
    if (this.directHostRendering) {
      return;
    }

    const width = Math.max(1, Math.round(viewport.width));
    const height = Math.max(1, Math.round(viewport.height));
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

  private tryEnableDirectHostRendering(hostCanvas: HTMLCanvasElement): void {
    if (this.directHostRendering || this.rendererType !== "webgl") {
      return;
    }
    if (this.renderCanvas === hostCanvas) {
      this.directHostRendering = true;
      return;
    }

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
    this.renderCanvas = hostCanvas;
    this.directHostRendering = true;
    this.userData.hepr.renderer = this.renderer;

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

    if (this.strokeMaterialLayer) {
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
    maybeOrtho.position.set(viewState.cameraCenterX, viewState.cameraCenterY, z);
    maybeOrtho.updateProjectionMatrix();
  }

  private updateUvFromViewState(viewState: ViewState, viewport: ViewportPixels): void {
    const safeZoom = Math.max(1e-6, viewState.zoom);
    const viewWidth = viewport.width / safeZoom;
    const viewHeight = viewport.height / safeZoom;
    const viewMinX = viewState.cameraCenterX - viewWidth * 0.5;
    const viewMinY = viewState.cameraCenterY - viewHeight * 0.5;

    const x0 = this.sceneBounds.minX;
    const y0 = this.sceneBounds.minY;
    const x1 = this.sceneBounds.maxX;
    const y1 = this.sceneBounds.maxY;

    this.uvArray[0] = (x0 - viewMinX) / viewWidth;
    this.uvArray[1] = (y0 - viewMinY) / viewHeight;
    this.uvArray[2] = (x1 - viewMinX) / viewWidth;
    this.uvArray[3] = (y0 - viewMinY) / viewHeight;
    this.uvArray[4] = (x1 - viewMinX) / viewWidth;
    this.uvArray[5] = (y1 - viewMinY) / viewHeight;
    this.uvArray[6] = (x0 - viewMinX) / viewWidth;
    this.uvArray[7] = (y1 - viewMinY) / viewHeight;
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
}

export async function createThreePdfObject(
  loadedScene: LoadedPdfScene,
  options: HeprThreeObjectOptions = {}
): Promise<HeprThreePdfObject> {
  const rendererType = options.rendererType ?? "webgl";
  const sceneBounds = normalizeBounds(resolveSceneFitBounds(loadedScene.scene));
  const initialCanvasSize = computeInitialCanvasSize(sceneBounds);
  const renderCanvas = document.createElement("canvas");
  renderCanvas.width = initialCanvasSize.width;
  renderCanvas.height = initialCanvasSize.height;

  const rendererConfig = normalizeRendererConfig(options);
  const nativeRenderer = await createNativeRenderer(rendererType, renderCanvas);
  applyRendererConfig(nativeRenderer, rendererConfig);
  if (rendererType === "webgpu") {
    nativeRenderer.setExternalFrameDriver?.(true);
  }
  nativeRenderer.setScene(loadedScene.scene);
  const initialFitPaddingPixels = normalizePadding(options.fitPadding);

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
    enableMaterialLayerConstruction && rendererConfig.materialRasterEnabled
      ? new ThreeMaterialRasterLayer(loadedScene.scene, {
        pageBackground: rendererConfig.pageBackground
      })
      : null;

  const fillMaterialLayer =
    enableMaterialLayerConstruction && rendererConfig.materialFillEnabled
      ? new ThreeMaterialFillLayer(loadedScene.scene, {
        vectorOverride: rendererConfig.vectorOverride
      })
      : null;

  const strokeMaterialLayer =
    enableMaterialLayerConstruction && rendererConfig.materialStrokeEnabled
      ? new ThreeMaterialStrokeLayer(loadedScene.scene, {
        strokeCurveEnabled: rendererConfig.strokeCurveEnabled,
        vectorOverride: rendererConfig.vectorOverride
      })
      : null;

  const textMaterialLayer =
    enableMaterialLayerConstruction && rendererConfig.materialTextEnabled
      ? new ThreeMaterialTextLayer(loadedScene.scene, {
        strokeCurveEnabled: rendererConfig.strokeCurveEnabled,
        textVectorOnly: rendererConfig.textVectorOnly,
        vectorOverride: rendererConfig.vectorOverride
      })
      : null;

  const renderTexture = new THREE.CanvasTexture(renderCanvas);
  renderTexture.colorSpace = THREE.SRGBColorSpace;
  renderTexture.flipY = true;
  renderTexture.generateMipmaps = false;
  renderTexture.minFilter = THREE.LinearFilter;
  renderTexture.magFilter = THREE.LinearFilter;
  renderTexture.wrapS = THREE.ClampToEdgeWrapping;
  renderTexture.wrapT = THREE.ClampToEdgeWrapping;

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([
    sceneBounds.minX, sceneBounds.minY, 0,
    sceneBounds.maxX, sceneBounds.minY, 0,
    sceneBounds.maxX, sceneBounds.maxY, 0,
    sceneBounds.minX, sceneBounds.maxY, 0
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

  const material = new THREE.MeshBasicMaterial({
    map: renderTexture,
    transparent: false,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false
  });

  const pageMesh = new THREE.Mesh(geometry, material);
  const object = new HeprThreePdfObject(
    loadedScene,
    rendererType,
    nativeRenderer,
    renderCanvas,
    renderTexture,
    false,
    rendererConfig,
    initialFitPaddingPixels,
    rasterMaterialLayer,
    fillMaterialLayer,
    strokeMaterialLayer,
    textMaterialLayer,
    pageMesh,
    uvArray,
    uvAttribute
  );
  pageMesh.onBeforeRender = (renderer, _scene, camera) => {
    object.handleBeforeRender(renderer as THREE.WebGLRenderer, camera as THREE.Camera);
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

function createDirectHostTriggerMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    colorWrite: false,
    toneMapped: false
  });
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
    strokeCurveEnabled: options.curveStrokes !== false,
    textVectorOnly: options.vectorOnly === true,
    pageBackground: [pageBackground[0], pageBackground[1], pageBackground[2], pageBackgroundOpacity],
    vectorOverride: [vectorColor[0], vectorColor[1], vectorColor[2], vectorOpacity]
  };
}

function applyRendererConfig(renderer: RendererApi, config: RendererConfig): void {
  renderer.setPanOptimizationEnabled(config.panOptimizationEnabled);
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
