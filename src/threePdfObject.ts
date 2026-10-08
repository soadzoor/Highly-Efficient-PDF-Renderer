import type { ThreeWebGpuBackend } from "./threeMaterialBackend";
import { ThreePageTransforms } from "./threePageTransforms";
import { updateThreePageBatchFrame } from "./threePageBatchFrame";
import { PAGE_PRIMITIVE_KINDS, ScenePageViews, type ScenePageView } from "./scenePageViews";
import { SharedPageRenderer } from "./sharedPageRenderer";
import { createLoadYielder, yieldAfterPaint } from "./loadCancellation";
import * as THREE from "three";
import { projectThreePdfCompositeBounds, ThreePaintCompositor, type ThreePaintHostRenderer } from "./threePaintCompositor";
import { ScenePaintVisibility, sceneRequiresPaintCompositing } from "./scenePaintVisibility";
import { ScenePrimitivePicker, getScenePrimitive, validatePrimitiveRef, type PrimitiveRef, type PrimitiveInfo, type PrimitiveHit,
  type ScenePrimitivePickOptions, type PrimitiveKind } from "./scenePrimitives";
import { SceneAnnotationIndex, annotationPrimitiveRefs, applySceneAnnotationHighlights, pickSceneAnnotationInteraction, type AnnotationHit } from "./sceneAnnotationInteraction";
import { PrimitiveAppearanceState, type PrimitiveColorUpdate, type PrimitiveHighlightSet,
  type PrimitiveOverride } from "./primitiveAppearance";
import { ThreePrimitiveHighlightLayer } from "./threePrimitiveHighlightLayer";
import { estimateHighlightLocalUnitsPerPixel } from "./primitiveHighlightProjection";
import { waitForLoad } from "./loadCancellation";

import { createCanvasInteractionController, type CanvasInteractionController } from "./canvasInteractions";
import {
  deferRendererSceneUpload,
  type DeferredSceneRendererApi
} from "./deferredRendererApi";
import { composeVectorScenesInGrid, type RasterLayer } from "./pdfVectorExtractor";
import { copyRasterLayer } from "./monochromeRaster";
import { hasVisiblePagePlaceholders, pagePlaceholderAnimationEnabled } from "./pageLoadingPlaceholder";
import { prepareSceneForHepRendering } from "./hepShared";
import type { PdfPageDemandLoader } from "./pdfPageDemand";
import type { LoadedPdfScene } from "./pdfObjectGenerator";
import type { RendererApi } from "./rendererTypes";
import type { ThreeCompactedStrokeLayer } from "./threeCompactedStrokeLayer";
import { ThreeMaterialFillLayer } from "./threeMaterialFillLayer";
import { ThreeMaterialGradientLayer } from "./threeMaterialGradientLayer";
import { OptionalContentController, type AnnotationLayerVisibility, type LayerVisibilityChange, type OptionalContentListener,
  createAnnotationInteractionSnapshot, type OptionalContentSnapshot } from "./optionalContent";
import { getPrimitiveMarkedContent, isScenePrimitiveVisible } from "./scenePrimitives";
import { findStructureElement, type StructureElement } from "./structureData";
import { RetainedPageReplay } from "./retainedPageReplay";
import { ThreeMaterialRasterLayer } from "./threeMaterialRasterLayer";
import { ThreeMaterialStrokeLayer } from "./threeMaterialStrokeLayer";
import { ThreeMaterialTextLayer } from "./threeMaterialTextLayer";
import { getThreeRenderPerformance } from "./threeRenderPerformance";
import { ThreeTextLodLayer } from "./textLodLayer";
import {
  HEPR_THREE_LAYER_ORDER_PAGE_DEPTH,
  HEPR_THREE_LAYER_ORDER_SEARCH_HIGHLIGHT,
  HEPR_THREE_LAYER_ORDER_TEXT_SELECTION
} from "./threeLayerOrder";
import { applyThreePdfOverlayPaintOrder } from "./threePdfPaintOrder";
import { ThreeVectorDrawPlan } from "./threeVectorDrawPlan";
import type { Bounds } from "./pdfVectorExtractor";
import {
  createSceneTextSearcher,
  flattenSearchMatchHighlightBounds,
  getSearchMatchHighlightBounds,
  type SceneTextSearcher,
  type SceneTextSearchOptions,
  type TextSearchMatch
} from "./textSearch";
import type { ThreeTriangleStrokeLayer } from "./threeTriangleStrokeLayer";
import { getOrBuildTextLod, type TextLodMode, type TextLodStats } from "./textLodCore";
import type { VectorStrokeLodRuntimeReservation } from "./vectorStrokeLodCore";
import {
  shouldUseVectorStrokeLod,
  ThreeVectorLodStrokeLayer,
  type VectorStrokeLodStats,
  type VectorLodMode
} from "./vectorStrokeLod";
import type { DrawStats, ViewState } from "./webGlFloorplanRenderer";
import type { ThreeColorCompositing } from "./threeWebGpuColorSpace";

export type { ThreeColorCompositing } from "./threeWebGpuColorSpace";

/** Source metadata for rendering an already compiled scene. */
export interface ThreePdfSceneSource {
  scene: LoadedPdfScene["scene"];
  sourceLabel: string;
  sourceKind: LoadedPdfScene["sourceKind"] | "scene";
  sourceBytes?: LoadedPdfScene["sourceBytes"];
  sourceOptions?: LoadedPdfScene["sourceOptions"];
  pageDemand?: PdfPageDemandLoader;
}

/** How page views that depth cannot order exactly are drawn; see `setPageOverlapMode`. */
export type HeprPageOverlapMode = "exact" | "fast";

/** A text-search match with bounds in PDF scene space and this object's local space. */
export interface HeprTextSearchMatch extends TextSearchMatch {
  /**
   * Match bounds translated into the object's local (centered) coordinate
   * space — the space of this THREE.Group's children, convenient for framing
   * a three.js camera on the match.
   */
  localBounds: Bounds;
  /** Per-line local highlight rectangles; optional for legacy match objects. */
  localHighlightBounds?: Bounds[];
}

/** Mouse position in CSS pixels; results refer to canonical loaded-scene primitives. */
export interface PrimitivePickOptions {
  camera: THREE.Camera;
  element: HTMLElement;
  clientX: number;
  clientY: number;
  tolerancePx?: number;
  kinds?: readonly PrimitiveKind[];
  signal?: AbortSignal;
}

export interface AnnotationPickOptions extends Omit<PrimitivePickOptions, "kinds"> {
  /** Include appearances hidden with setAnnotationVisibility; PDF layers and flags still apply. Default false. */
  includeHidden?: boolean;
}

const DEFAULT_FIT_PADDING_PIXELS = 64;
const DEFAULT_INITIAL_LONG_SIDE = 2048;
const DEFAULT_MIN_CANVAS_DIMENSION = 256;
const DEFAULT_MAX_CANVAS_DIMENSION = 4096;
const DEFAULT_MAX_CANVAS_PIXELS = 4_194_304;
const PERSPECTIVE_NATIVE_OVERSAMPLE = 1.15;
const PERSPECTIVE_RESIZE_HYSTERESIS_MIN = 0.9;
const PERSPECTIVE_RESIZE_HYSTERESIS_MAX = 1.12;
const SEARCH_HIGHLIGHT_OTHERS_FILL = 0xffeb3b;
const SEARCH_HIGHLIGHT_OTHERS_OUTLINE = 0xca8a04;
const SEARCH_HIGHLIGHT_CURRENT_FILL = 0xff9800;
const SEARCH_HIGHLIGHT_CURRENT_OUTLINE = 0xea580c;
const TEXT_SELECTION_FILL = 0x4285f4;
const TEXT_SELECTION_OUTLINE = 0x1b5dc9;

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
 *   textLod: "auto",
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
   * Alpha-compositing domain for HEPR's custom Three/WebGPU materials.
   *
   * `"linear"` follows Three's normal color-managed pipeline. `"display"`
   * matches the native HEPR and Three/WebGL paths exactly by blending PDF
   * display values directly; it requires a WebGPU host configured with
   * `renderer.outputColorSpace = THREE.LinearSRGBColorSpace`.
   *
   * @default "linear"
   */
  threeColorCompositing?: ThreeColorCompositing;

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
   * Clustered level-of-detail mode for text-heavy PDFs. `"auto"` replaces
   * only genuinely subpixel clusters with coverage-preserving coarse runs;
   * `"off"` always selects exact glyphs.
   *
   * @default "auto"
   */
  textLod?: TextLodMode;

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
  readonly isWebGLRenderer?: boolean;
  readonly isWebGPURenderer?: boolean;
  readonly domElement: HTMLCanvasElement | OffscreenCanvas;
  readonly outputColorSpace?: string;
  readonly capabilities?: {
    getMaxAnisotropy?: () => number;
    maxTextureSize?: number;
  };
  readonly backend?: {
    readonly device?: {
      readonly limits?: { readonly maxTextureDimension2D?: number };
    };
  };
  getContext?: () => unknown;
  getDrawingBufferSize?: (target: THREE.Vector2) => THREE.Vector2;
  getSize?: (target: THREE.Vector2) => THREE.Vector2;
  getPixelRatio?: () => number;
  getRenderTarget?: () => THREE.RenderTarget | null;
  getViewport?: (target: THREE.Vector4) => THREE.Vector4;
  /** WebGPURenderer exposes anisotropy here; WebGL exposes it on capabilities. */
  getMaxAnisotropy?: () => number;
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
  threeColorCompositing: ThreeColorCompositing;
  vectorLodMode: VectorLodMode;
  textLodMode: TextLodMode;
  strokeCurveEnabled: boolean;
  textVectorOnly: boolean;
  pageBackground: [number, number, number, number];
  vectorOverride: [number, number, number, number];
}

export interface HeprThreePdfObjectEventMap extends THREE.Object3DEventMap {
  /** Request another frame for asynchronous content, overlays or visible loading animation. */
  change: { reason: "primitive-highlights-ready" | "pages-loaded" | "raster-ready" | "page-loading-animation" };
}

/**
 * A three.js `Group` that represents a loaded PDF or HEP scene.
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
export class HeprThreePdfObject extends THREE.Group<HeprThreePdfObjectEventMap> {
  private pageViews: { object: HeprThreePdfObject; view: ScenePageView }[] | null = null;
  private pagePartition: ScenePageViews | null = null;
  private pageBatch: HeprThreePdfObject | null = null;
  private pageBatchActive = false;
  private pageBatchReason: string | null = "not-prepared";
  private pageBatchFringesApproximated = false;
  /** Page views are all in the loaded layout, so the document draws itself. */
  private pageDocumentMode = false;
  /** Colors changed after page preparation reach only the page views. */
  private pageColorsDiverged = false;
  private readonly pageOverlayObjects: HeprThreePdfObject[] = [];
  /** Bumped by page views whose appearance or overlays change. */
  private pageAppearanceRevision = 0;
  private pageAppearanceChecked = -1;
  private pageAppearanceMatches = false;
  private pageOverlapMode: HeprPageOverlapMode = "exact";
  private pageTransforms!: ThreePageTransforms | undefined;
  private pageBatchView: DerivedThreeCameraView | null = null;
  private pagePreparation: Promise<readonly HeprThreePdfObject[]> | null = null;
  private readonly pagePreparationAbort = new AbortController();
  private pendingLayerUpdate: Promise<void> | null = null;
  private pageOwner: HeprThreePdfObject | null = null;
  private sourcePageSlot: number | null = null;

  /** Zero-based slot in the owning document, or null for a document object. */
  get pageIndex(): number | null { return this.sourcePageSlot; }
  /** Number of displayed pages (selected PDF pages or pages stored in a HEP). */
  get pageCount(): number { return Math.floor(this.sceneData.pageRects.length / 4); }

  /**
   * Prepare independent page views once, preserving their initial document layout.
   * Each view is a document-owned THREE.Group with position/rotation/quaternion/
   * scale/matrix APIs and its own picking, search and highlight methods. Its pivot
   * is the page center; position is relative to this document's centered origin.
   * Compatible pages share GPU geometry batches and a page matrix table.
   * Ordered effects and unsupported projections use independent page rendering.
   */
  async getPages(options: { signal?: AbortSignal } = {}): Promise<readonly HeprThreePdfObject[]> {
    if (this.isDisposed) throw new DOMException("PDF object disposed.", "AbortError");
    options.signal?.throwIfAborted();
    if (this.pageCount <= 1) return Object.freeze(this.pageCount ? [this] : []);
    this.pagePreparation ??= this.preparePageViews().catch(error => { this.pagePreparation = null; throw error; });
    return waitForLoad(this.pagePreparation, options.signal);
  }

  /**
   * Observe page view preparation started by `getPage` / `getPages`. The current
   * integer percentage (or null when idle, prepared or failed) is delivered
   * immediately. Unsubscribe when the host detaches from this object.
   */
  subscribePagePreparationProgress(listener: (percentage: number | null) => void): () => void {
    if (this.isDisposed) throw new Error("PDF object disposed.");
    this.pagePreparationListeners.add(listener);
    try { listener(this.pagePreparationProgress); } catch { /* Observers cannot interrupt preparation. */ }
    return () => { this.pagePreparationListeners.delete(listener); };
  }

  private reportPagePreparationProgress(percentage: number | null): void {
    if (this.pagePreparationProgress === percentage) return;
    this.pagePreparationProgress = percentage;
    for (const listener of this.pagePreparationListeners) {
      try { listener(percentage); } catch { /* Observers cannot interrupt preparation. */ }
    }
  }

  /** Zero-based displayed page index, independent of the PDF's source page number. */
  async getPage(index: number, options: { signal?: AbortSignal } = {}): Promise<HeprThreePdfObject> {
    if (!Number.isInteger(index) || index < 0 || index >= this.pageCount) throw new RangeError("Invalid page index.");
    return (await this.getPages(options))[index];
  }

  /** Set the page center in document-local XYZ coordinates. */
  async setPagePosition(index: number, x: number, y: number, z = 0): Promise<void> {
    if (![x, y, z].every(Number.isFinite)) throw new RangeError("Page position must be finite.");
    const page = await this.getPage(index);
    page.position.set(x, y, z);
    if (page.matrixAutoUpdate) page.updateMatrix();
    else { page.matrix.setPosition(x, y, z); page.matrixWorldNeedsUpdate = true; }
  }

  /** Replace a page's local affine matrix, including shear. Disables matrixAutoUpdate. */
  async setPageTransform(index: number, matrix: THREE.Matrix4): Promise<void> {
    const elements = matrix?.elements;
    if (!elements || elements.length !== 16 || !elements.every(Number.isFinite) ||
        elements[3] !== 0 || elements[7] !== 0 || elements[11] !== 0 || elements[15] !== 1)
      throw new RangeError("Page transform must be a finite affine Matrix4.");
    const copy = matrix.clone();
    const page = await this.getPage(index);
    page.matrix.copy(copy);
    if (copy.determinant() !== 0) page.matrix.decompose(page.position, page.quaternion, page.scale);
    else { page.position.setFromMatrixPosition(copy); page.scale.setFromMatrixScale(copy); page.quaternion.identity(); }
    page.matrixAutoUpdate = false; page.matrixWorldNeedsUpdate = true;
  }

  private async preparePageViews(): Promise<readonly HeprThreePdfObject[]> {
    const signal = this.pagePreparationAbort.signal;
    this.reportPagePreparationProgress(0);
    // Let hosts present their progress UI before the first slice of work.
    await yieldAfterPaint(signal);
    // Page views take ~75%, the shared batches most of the rest.
    const yieldControl = createLoadYielder(signal);
    const partition = new ScenePageViews(this.sceneData);
    const pool = new SharedPageRenderer(this.renderer, this.renderCanvas);
    const prepared: { object: HeprThreePdfObject; view: ScenePageView }[] = [];
    let batch: HeprThreePdfObject | null = null;
    let table: ThreePageTransforms | undefined;
    const config = this.rendererConfig;
    const options: HeprThreeObjectOptions = { rendererType: this.rendererType,
      vectorLod: config.vectorLodMode, textLod: config.textLodMode, curveStrokes: config.strokeCurveEnabled,
      vectorOnly: config.textVectorOnly, threeColorCompositing: config.threeColorCompositing,
      pageBackground: config.pageBackground.slice(0, 3) as [number, number, number], pageBackgroundOpacity: config.pageBackground[3],
      vectorOverrideColor: config.vectorOverride.slice(0, 3) as [number, number, number], vectorOverrideOpacity: config.vectorOverride[3] };
    try {
      for (let index = 0; index < partition.pageCount; index++) {
        await yieldControl();
        const view = partition.extract(index);
        const object = await createThreePdfObject({ scene: view.scene, sourceKind: this.sourceKind,
          sourceLabel: `${this.sourceLabel} — page ${index + 1}` }, options, signal, undefined,
          canvas => pool.createView(view.scene, canvas), undefined, yieldControl);
        prepared.push({ object, view });
        object.sourcePageSlot = index; object.pageOwner = this;
        object.layerVisibility.dispose(); object.layerVisibility = this.layerVisibility;
        object.position.set(object.sceneCenterX - this.sceneCenterX, object.sceneCenterY - this.sceneCenterY, 0);
        object.updateMatrix();
        this.reportPagePreparationProgress(Math.floor(75 * (index + 1) / partition.pageCount));
      }
      this.pageBatchReason = "pdf-compositing";
      if (!sceneRequiresPaintCompositing(this.sceneData) && !this.sceneData.retainedPages?.length) {
        try {
          table = new ThreePageTransforms(partition);
          await yieldControl();
          batch = await createThreePdfObject({ scene: this.sceneData, sourceKind: this.sourceKind, sourceLabel: `${this.sourceLabel} — page batches` },
            options, signal, undefined, canvas => pool.createView(this.sceneData, canvas), table, yieldControl);
          batch.pageOwner = this;
          batch.layerVisibility.dispose(); batch.layerVisibility = this.layerVisibility;
          batch.visible = false;
          this.pageBatchReason = "not-rendered";
        } catch (error) {
          table?.dispose(); table = undefined;
          if (!(error instanceof RangeError)) throw error;
          this.pageBatchReason = "resource-capacity";
          console.warn("[HEPR] Shared page batches exceed material capacity; using independent page rendering.", error.message);
        }
      }
      this.reportPagePreparationProgress(95);
      let revision: number;
      do {
        // A layer update begun on the batched object must commit before views
        // become visible, otherwise its retained pixels would miss the pages.
        await this.waitForPendingLayers(signal);
        const snapshot = this.layerVisibility.getSnapshot(); revision = snapshot.revision;
        for (const { object } of prepared) {
          const replay = await object.retainedReplay?.prepare(snapshot, { signal });
          if (replay) {
            const staged = object.rasterMaterialLayer.prepareRasterLayerUpdates(replay.layers);
            try { signal.throwIfAborted(); staged.commit(); replay.commit(); } finally { staged.dispose(); }
          }
        }
        signal.throwIfAborted();
      } while (revision !== this.layerVisibility.revision || this.pendingLayerUpdate);
      // No partially prepared layout is ever exposed. The batched document stays
      // visible until all page resources are ready, and survives failed setup.
      const snapshot = this.layerVisibility.getSnapshot();
      for (const object of [...prepared.map(page => page.object), ...(batch ? [batch] : [])]) {
        // Settings may have changed while resources were being prepared.
        object.setVectorLodMode(config.vectorLodMode); object.setTextLodMode(config.textLodMode);
        object.setStrokeCurveEnabled(config.strokeCurveEnabled);
        object.setPageBackgroundColor(...config.pageBackground);
        object.setVectorColorOverride(...config.vectorOverride);
        object.applyLayerVisibility(snapshot);
      }
      this.configureDormantPipeline();
      this.pageMesh.visible = false;
      if (this.paintCompositor) this.paintCompositor.mesh.visible = false;
      if (this.searchHighlightGroup) this.searchHighlightGroup.visible = false;
      if (this.textSelectionHighlightGroup) this.textSelectionHighlightGroup.visible = false;
      if (this.primitiveHighlightLayer) this.primitiveHighlightLayer.mesh.visible = false;
      this.pagePartition = partition; this.pageViews = prepared; this.pageBatch = batch;
      for (const { object } of prepared) this.add(object);
      if (batch) this.add(batch);
      this.setSearchHighlights(this.searchHighlightMatches, { currentIndex: this.searchHighlightIndex });
      this.setTextSelectionHighlights(this.textSelectionHighlightRects);
      this.setSelection(this.primitiveAppearance.getSelection());
      this.setHover(this.primitiveAppearance.getHover());
      this.setAnnotationSelection(this.annotationSelected);
      this.setAnnotationHover(this.annotationHovered);
      this.applyPrimitiveColorUpdates(this.primitiveAppearance.getColorUpdates());
      // That replay mirrors colors the document's own layers already show.
      this.pageColorsDiverged = false;
      this.reportPagePreparationProgress(null);
      return Object.freeze(prepared.map(page => page.object));
    } catch (error) {
      this.reportPagePreparationProgress(null);
      this.pageViews = null; this.pagePartition = null; this.pageBatch = null; this.pageDocumentMode = false;
      batch?.removeFromParent();
      if (batch) batch.dispose(); else table?.dispose();
      this.pageMesh.visible = true;
      if (this.searchHighlightGroup) this.searchHighlightGroup.visible = this.searchHighlightMatches.length > 0;
      if (this.textSelectionHighlightGroup) this.textSelectionHighlightGroup.visible = this.textSelectionHighlightRects.length > 0;
      for (const { object } of prepared) { object.removeFromParent(); object.dispose(); }
      throw error;
    }
  }

  /**
   * Choose how page views that overlap on screen are drawn when depth cannot
   * order them exactly, e.g. nearly coplanar pages crossing mid-animation.
   * `"exact"` (default) renders them separately in page order. `"fast"` keeps
   * opaque pages in shared batches, so such overlaps may z-fight or blend out
   * of page order; `isPaintOrderApproximated()` reports when that happens.
   * Use it while pages move and restore `"exact"` once they settle.
   * Translucent overlaps always keep page order.
   */
  setPageOverlapMode(mode: HeprPageOverlapMode): void {
    this.pageOverlapMode = mode === "fast" ? "fast" : "exact";
  }

  getPageOverlapMode(): HeprPageOverlapMode {
    return this.pageOverlapMode;
  }

  /** Whether transformed pages currently share draws, and why a separate path is needed. */
  getPageBatchingStats(): { mode: "document" | "pages-batched" | "pages-separate"; pageCount: number; reason: string | null } {
    const pages = this.pageViews && !this.pageDocumentMode;
    return { mode: !pages ? "document" : this.pageBatchActive ? "pages-batched" : "pages-separate",
      pageCount: this.pageCount, reason: pages && !this.pageBatchActive ? this.pageBatchReason : null };
  }

  private prepareBatchedPages(renderer: ThreeHostRenderer, camera: THREE.Camera): boolean {
    const batch = this.pageBatch, table = batch?.pageTransforms;
    if (!batch || !table) return false;
    if (!batch.hostUsesMaterialBackend(renderer) || !batch.hostSupportsRasterTextures(renderer)) {
      this.pageBatchReason = "host-capabilities"; return false;
    }
    if (table.requiredTextureDimension > readThreeRendererMaxTextureSize(renderer)) {
      this.pageBatchReason = "resource-capacity"; return false;
    }
    const cameraType = camera as THREE.Camera & { isOrthographicCamera?: boolean; isPerspectiveCamera?: boolean };
    if (!cameraType.isOrthographicCamera && !cameraType.isPerspectiveCamera) {
      this.pageBatchReason = "unsupported-camera"; return false;
    }
    const config = this.rendererConfig;
    for (const { object } of this.pageViews!) {
      if (object.parent !== this) { this.pageBatchReason = "reparented-page"; return false; }
      if (!object.matrixWorldAutoUpdate) { this.pageBatchReason = "manual-world-matrix"; return false; }
      if (!object.visible || object.isDisposed) continue;
      const other = object.rendererConfig;
      if (other.vectorLodMode !== config.vectorLodMode || other.textLodMode !== config.textLodMode ||
          other.strokeCurveEnabled !== config.strokeCurveEnabled || other.textVectorOnly !== config.textVectorOnly ||
          other.pageBackground.some((value,i)=>value !== config.pageBackground[i]) ||
          other.vectorOverride.some((value,i)=>value !== config.vectorOverride[i]) ||
          PAGE_PRIMITIVE_KINDS.some(kind => object.primitiveAppearance.hasOverrides(kind))) {
        this.pageBatchReason = "page-appearance"; return false;
      }
    }
    const viewport = readThreeRendererViewportPixels(renderer);
    const documentOrigin = new THREE.Matrix4().makeTranslation(this.sceneCenterX, this.sceneCenterY, 0);
    const worldToClip = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    const frames = this.pageViews!.map(({ object, view }) => {
      const derived = object.visible && !object.isDisposed ? object.deriveViewStateFromThreeCamera(camera,viewport) : null;
      return { scene: view.scene, paintBounds: view.paintBounds, dataToDocument: documentOrigin.clone().multiply(object.matrix).multiply(object.dataToLocalMatrix),
        dataToClip: worldToClip.clone().multiply(object.matrixWorld).multiply(object.dataToLocalMatrix),
        visible: object.visible && !object.isDisposed, opaque: object.rendererConfig.pageBackground[3] >= 1,
        cullingBounds: derived?.cullingBounds };
    });
    const frame = updateThreePageBatchFrame(table, frames, viewport, camera.coordinateSystem === THREE.WebGPUCoordinateSystem ? 0 : -1,
      this.pageOverlapMode === "fast");
    this.pageBatchReason = frame.reason;
    this.pageBatchFringesApproximated = frame.approximated;
    if (frame.reason) return false;
    for (const { object } of this.pageViews!) {
      if (!this.pageBatchActive) object.configureDormantPipeline();
      object.showPageMesh(false);
      if (object.paintCompositor) object.paintCompositor.mesh.visible = false;
      if (object.visible && !object.isDisposed) {
        object.syncAuxiliaryOutputColorSpace(renderer);
        object.syncPrimitiveHighlightFrame(renderer,camera);
      }
      if (!this.pageBatchActive) object.traverse(child => { if ((child as THREE.Group).isGroup) child.renderOrder = 0; });
    }
    // Overlays keep their existing transparent-queue behavior and page order.
    // Only pages with overlays need sorting while content uses shared batches.
    const overlays = this.pageViews!.filter(({ object }) => object.visible && !object.isDisposed &&
      (object.searchHighlightMatches.length || object.textSelectionHighlightRects.length || object.primitiveAppearance.getHighlights()?.count));
    const overlayPosition = new THREE.Vector3();
    const depth = (object: HeprThreePdfObject) => overlayPosition.setFromMatrixPosition(object.matrixWorld).applyMatrix4(camera.matrixWorldInverse).z;
    overlays.sort((a, b) => depth(a.object) - depth(b.object) || a.view.pageIndex - b.view.pageIndex);
    overlays.forEach(({ object }, index) => object.traverse(child => {
      if ((child as THREE.Group).isGroup) child.renderOrder = HEPR_THREE_LAYER_ORDER_PAGE_DEPTH + index;
    }));
    batch.pageBatchView = frame.view; batch.visible = true;
    batch.prepareFrameForThreeRenderer(renderer,camera);
    batch.pageMesh.visible = false;
    batch.traverse(child => { if ((child as THREE.Group).isGroup) child.renderOrder = HEPR_THREE_LAYER_ORDER_PAGE_DEPTH; });
    this.pageBatchActive = true;
    return true;
  }

  /**
   * Whether every page view is exactly where preparation placed it, with the
   * document's appearance, so the document's own draws are identical. Anyone
   * may move a page, so transforms are read every frame; appearance and
   * overlays change only through page setters and are rechecked on demand.
   */
  private pagesMatchDocumentLayout(): boolean {
    if (this.pageColorsDiverged || this.retainedReplay) return false;
    if (this.pageAppearanceChecked !== this.pageAppearanceRevision) {
      this.pageAppearanceChecked = this.pageAppearanceRevision;
      this.pageAppearanceMatches = this.pagesMatchDocumentAppearance();
    }
    if (!this.pageAppearanceMatches) return false;
    for (const { object } of this.pageViews!) {
      if (object.parent !== this || !object.visible || object.isDisposed || !object.matrixWorldAutoUpdate) return false;
      const x = object.sceneCenterX - this.sceneCenterX, y = object.sceneCenterY - this.sceneCenterY;
      if (object.matrixAutoUpdate) {
        const p = object.position, q = object.quaternion, s = object.scale;
        if (p.x !== x || p.y !== y || p.z !== 0 || q.x !== 0 || q.y !== 0 || q.z !== 0 || q.w !== 1 ||
            s.x !== 1 || s.y !== 1 || s.z !== 1) return false;
      } else {
        const e = object.matrix.elements;
        for (let i = 0; i < 16; i++) if (e[i] !== (i === 12 ? x : i === 13 ? y : i % 5 === 0 ? 1 : 0)) return false;
      }
    }
    return true;
  }

  /** Same appearance as the document on every page; collects pages with overlays. */
  private pagesMatchDocumentAppearance(): boolean {
    const overlays = this.pageOverlayObjects;
    overlays.length = 0;
    const config = this.rendererConfig, background = config.pageBackground, override = config.vectorOverride;
    for (const { object } of this.pageViews!) {
      const other = object.rendererConfig, b = other.pageBackground, o = other.vectorOverride;
      if (other.vectorLodMode !== config.vectorLodMode || other.textLodMode !== config.textLodMode ||
          other.strokeCurveEnabled !== config.strokeCurveEnabled || other.textVectorOnly !== config.textVectorOnly ||
          b[0] !== background[0] || b[1] !== background[1] || b[2] !== background[2] || b[3] !== background[3] ||
          o[0] !== override[0] || o[1] !== override[1] || o[2] !== override[2] || o[3] !== override[3] ||
          object.primitiveAppearance.hasAnyOverrides()) return false;
      if (object.searchHighlightMatches.length || object.textSelectionHighlightRects.length ||
          object.primitiveAppearance.getHighlights()?.count) overlays.push(object);
    }
    return true;
  }

  /**
   * A dormant page view keeps its depth rectangle out of the scene graph, so
   * three.js does not update a thousand hidden meshes every frame.
   */
  private showPageMesh(shown: boolean): void {
    this.pageMesh.visible = shown;
    if (shown && this.pageMesh.parent !== this) this.add(this.pageMesh);
    else if (!shown && this.pageMesh.parent === this) this.remove(this.pageMesh);
  }

  private markPageAppearanceChanged(): void {
    if (this.pageOwner) this.pageOwner.pageAppearanceRevision++;
  }

  /** Switch between the document's own draws and page rendering once per change. */
  private setPageDocumentMode(active: boolean): void {
    if (this.pageDocumentMode === active) return;
    this.pageDocumentMode = active;
    if (active) {
      this.pageBatchActive = false;
      if (this.pageBatch) this.pageBatch.visible = false;
      for (const { object } of this.pageViews!) {
        if (object.materialPipelineActive || object.renderTexture) object.configureDormantPipeline();
        object.showPageMesh(false);
        if (object.paintCompositor) object.paintCompositor.mesh.visible = false;
        // Page overlays follow the document's content, as in its own path.
        object.traverse(child => { if ((child as THREE.Group).isGroup) child.renderOrder = 0; });
      }
      this.pageMesh.visible = true;
    } else {
      this.configureDormantPipeline();
      this.pageMesh.visible = false;
      if (this.paintCompositor) this.paintCompositor.mesh.visible = false;
    }
  }

  private syncPageOverlays(renderer: ThreeHostRenderer, camera: THREE.Camera): void {
    for (const object of this.pageOverlayObjects) {
      object.syncAuxiliaryOutputColorSpace(renderer);
      object.syncPrimitiveHighlightFrame(renderer, camera);
    }
  }

  private prepareIndependentPages(renderer: ThreeHostRenderer, camera: THREE.Camera): void {
    // Three already updated world matrices for this frame; batched pages only
    // read their own. Dormant page content is refreshed only when drawn.
    this.updateWorldMatrix(true, false); camera.updateMatrixWorld();
    for (const { object } of this.pageViews!) object.updateWorldMatrix(false, false);
    this.pageBatch?.updateWorldMatrix(false, true);
    if (this.prepareBatchedPages(renderer,camera)) return;
    this.updateWorldMatrix(false, true);
    this.pageBatchActive = false;
    if (this.pageBatch) this.pageBatch.visible = false;
    const point = new THREE.Vector3();
    const pages = this.pageViews!.filter(page => page.object.parent === this && page.object.visible && !page.object.isDisposed);
    pages.sort((a, b) => {
      const az = point.setFromMatrixPosition(a.object.matrixWorld).applyMatrix4(camera.matrixWorldInverse).z;
      const bz = point.setFromMatrixPosition(b.object.matrixWorld).applyMatrix4(camera.matrixWorldInverse).z;
      return az - bz || a.view.pageIndex - b.view.pageIndex;
    });
    const viewport = readThreeRendererViewportPixels(renderer);
    const worldToClip = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const allowances = this.rasterMaterialLayer.planPageMemory(this.pageViews!.map(({ object }) =>
      object.visible && !object.isDisposed ? worldToClip.clone().multiply(object.matrixWorld).multiply(object.dataToLocalMatrix).elements : null), viewport);
    pages.forEach(({ object, view }, index) => {
      object.rasterMaterialLayer.setMemoryAllowance(allowances[view.pageIndex]);
      object.showPageMesh(true);
      object.prepareFrameForThreeRenderer(renderer, camera);
      const groupOrder = HEPR_THREE_LAYER_ORDER_PAGE_DEPTH + index;
      object.traverse(child => {
        if ((child as THREE.Group).isGroup) child.renderOrder = groupOrder;
      });
    });
  }

  /** Human-readable source label, usually the file name or URL basename. */
  readonly sourceLabel: string;

  /** PDF, HEP, or a directly supplied compiled scene. */
  readonly sourceKind: ThreePdfSceneSource["sourceKind"];

  /** Native renderer backend used internally by this object. */
  readonly rendererType: HeprRendererType;

  /** Parsed scene data backing this three.js object. Treat as read-only. */
  private currentScene!: LoadedPdfScene["scene"];
  get sceneData(): LoadedPdfScene["scene"] { return this.currentScene; }
  readonly sourceBytes: Uint8Array | undefined;
  readonly sourceOptions: LoadedPdfScene["sourceOptions"];
  private readonly pageDemand: PdfPageDemandLoader | undefined;
  private loadingAnimationActive = false;
  private demandUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  private demandUpdatePending = false;
  private demandUpdateRunning: Promise<void> | null = null;
  private rasterPages: ReadonlySet<number> = new Set();
  private readonly localDemandRasters = new WeakMap<RasterLayer, RasterLayer>();
  private transitionProfile: ReturnType<typeof getThreeRenderPerformance> = null;

  /** Internal native renderer. Advanced escape hatch; prefer object methods. */
  renderer!: RendererApi;

  /** Built-in 2D interaction helper for the fallback viewport path. */
  readonly interactionController: CanvasInteractionController;

  /** Internal canvas used by the fallback texture pipeline. */
  renderCanvas!: HTMLCanvasElement;

  /** Texture wrapping `renderCanvas`, or `null` while using material layers. */
  renderTexture!: THREE.CanvasTexture | null;

  private pageMesh!: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private uvArray!: Float32Array;
  private uvAttribute!: THREE.BufferAttribute;
  private sceneBounds!: SceneBounds;
  private localSceneBounds!: SceneBounds;
  private sceneCenterX!: number;
  private sceneCenterY!: number;
  private readonly rendererConfig: RendererConfig;
  private rasterMaterialLayer!: ThreeMaterialRasterLayer;
  private gradientMaterialLayer!: ThreeMaterialGradientLayer;
  private fillMaterialLayer!: ThreeMaterialFillLayer;
  private strokeMaterialLayer!: ThreeMaterialStrokeLayer | null;
  private triangleStrokeLayer!: ThreeTriangleStrokeLayer | null;
  private vectorLodStrokeLayer!: ThreeVectorLodStrokeLayer | null;
  private compactedStrokeLayer!: ThreeCompactedStrokeLayer | null;
  private textMaterialLayer!: ThreeMaterialTextLayer;

  private textLodLayer!: ThreeTextLodLayer | null;
  private threeTextLodResourceFallback = false;

  private primitiveAppearance!: PrimitiveAppearanceState;
  private layerVisibility!: OptionalContentController;
  private layerVisibilityProgress: number | null = null;
  private readonly layerVisibilityProgressListeners = new Set<(percentage: number | null) => void>();
  private paintVisibility!: ScenePaintVisibility;
  private retainedReplay!: RetainedPageReplay | null;
  private primitivePicker: ScenePrimitivePicker | null = null;
  private annotationIndex: SceneAnnotationIndex | null = null;
  private annotationSelected: string[] = [];
  private annotationHovered: string | null = null;
  private annotationVisibilitySnapshot: OptionalContentSnapshot | null = null;
  private annotationAppliedSnapshot: OptionalContentSnapshot | null = null;
  private annotationSuppressed = new Set<string>();
  private annotationInteractionRevision = 0;
  private primitivePreparationProgress: number | null = null;
  private readonly primitivePreparationListeners = new Set<(percentage: number | null) => void>();
  private pagePreparationProgress: number | null = null;
  private readonly pagePreparationListeners = new Set<(percentage: number | null) => void>();
  private primitiveHighlightLayer: ThreePrimitiveHighlightLayer | null = null;
  private webGpu: ThreeWebGpuBackend | undefined;
  private pendingHighlightBackend: Promise<void> | null = null;
  private pendingHighlightFrame: { renderer: ThreeHostRenderer; camera: THREE.Camera } | null = null;
  private primitiveHighlightBackend: HeprRendererType | null = null;
  private primitiveHighlightColorCompositing: ThreeColorCompositing | null = null;
  private nativePrimitiveColorsReplayed = false;

  private textSearcher: SceneTextSearcher | null = null;
  private searchHighlightMatches: ReadonlyArray<Pick<TextSearchMatch, "bounds"> & Partial<Pick<TextSearchMatch, "highlightBounds" | "pageIndex">>> = [];
  private searchHighlightIndex = -1;
  private textSelectionHighlightRects: ReadonlyArray<Bounds> = [];
  private searchHighlightGroup: THREE.Group | null = null;
  private searchHighlightOthersMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  private searchHighlightCurrentMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  private searchHighlightOthersOutline: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null;
  private searchHighlightCurrentOutline: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null;
  private textSelectionHighlightGroup: THREE.Group | null = null;
  private textSelectionHighlightMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  private textSelectionHighlightOutline: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null;
  private controlsCanvas: HTMLCanvasElement | null = null;
  private pendingInitialFit: boolean;
  private initialFitPaddingPixels!: number;
  private lastSyncedFrameSerial = -1;
  private lastHostRenderer: ThreeHostRenderer | null = null;
  private lastUploadedFrameSerial = -1;
  private lastViewportWidth = 0;
  private lastViewportHeight = 0;
  private textureAnisotropy = 1;
  private materialPipelineActive = false;
  private paintCompositor: ThreePaintCompositor | null = null;
  private frameListener: ((stats: DrawStats) => void) | null = null;
  private lastNativeDrawStats: DrawStats | null = null;
  private isDisposed = false;
  private skipNextBeforeRenderCallback = false;
  private warnedThreeCameraUnsupported = false;
  private warnedThreeCameraPerspectiveFallback = false;
  private warnedHostRasterTextureFallback = false;
  private warnedHostBackendFallback = false;
  private warnedHostColorCompositingFallback = false;
  private directDisplayOutputActive = false;
  private hookedScene: THREE.Scene | null = null;
  private readonly pagePlane = new THREE.Plane();
  private readonly pagePlanePoint = new THREE.Vector3();
  private readonly pagePlaneNormal = new THREE.Vector3();
  private readonly pageNormalMatrix = new THREE.Matrix3();
  private readonly pageWorldInverse = new THREE.Matrix4();
  private readonly clipFromWorldMatrix = new THREE.Matrix4();
  private readonly clipFromLocalMatrix = new THREE.Matrix4();
  private readonly clipFromDataMatrix = new THREE.Matrix4();
  private readonly dataToLocalMatrix = new THREE.Matrix4();
  private drawPlan!: ThreeVectorDrawPlan | null;
  private appliedDrawPlanVersion = -1;
  private readonly ndcOrigin = new THREE.Vector3();
  private readonly ndcLocalX = new THREE.Vector3();
  private readonly ndcLocalY = new THREE.Vector3();
  private readonly rayOriginNear = new THREE.Vector3();
  private readonly rayFarPoint = new THREE.Vector3();
  private readonly rayDirection = new THREE.Vector3();
  private readonly worldIntersection = new THREE.Vector3();
  private readonly localIntersection = new THREE.Vector3();
  private readonly sceneToClientScratch = new THREE.Vector3();
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
    this.configureDormantPipeline();
    this.refreshSceneRenderHook();
  };
  private readonly handleAncestorAdded = (): void => {
    this.refreshSceneRenderHook();
  };
  private readonly handleAncestorRemoved = (): void => {
    this.configureDormantPipeline();
    this.refreshSceneRenderHook();
  };
  private readonly ancestorHookWatchers: THREE.Object3D[] = [];

  /**
   * Internal constructor used by the PDF object factory.
   *
   * Application code should use `pdfObjectGenerator(source, options)` instead
   * of calling this constructor directly.
   */
  constructor(
    loadedScene: ThreePdfSceneSource,
    rendererType: HeprRendererType,
    renderer: RendererApi,
    renderCanvas: HTMLCanvasElement,
    renderTexture: THREE.CanvasTexture | null,
    rendererConfig: RendererConfig,
    initialFitPaddingPixels: number,
    rasterMaterialLayer: ThreeMaterialRasterLayer,
    gradientMaterialLayer: ThreeMaterialGradientLayer,
    fillMaterialLayer: ThreeMaterialFillLayer,
    strokeMaterialLayer: ThreeMaterialStrokeLayer | null,
    triangleStrokeLayer: ThreeTriangleStrokeLayer | null,
    vectorLodStrokeLayer: ThreeVectorLodStrokeLayer | null,
    compactedStrokeLayer: ThreeCompactedStrokeLayer | null,
    textMaterialLayer: ThreeMaterialTextLayer,
    textLodLayer: ThreeTextLodLayer | null,
    pageMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
    uvArray: Float32Array,
    uvAttribute: THREE.BufferAttribute,
    drawPlan?: ThreeVectorDrawPlan,
    pageTransforms?: ThreePageTransforms,
    webGpu?: ThreeWebGpuBackend
  ) {
    super();
    this.sourceLabel = loadedScene.sourceLabel;
    this.sourceKind = loadedScene.sourceKind;
    this.rendererType = rendererType;
    this.rendererConfig = rendererConfig;
    this.pageDemand = loadedScene.pageDemand;
    // Both eager and demand-loaded PDFs can be reopened with another viewing mode.
    this.sourceBytes = loadedScene.sourceKind === "pdf" ? loadedScene.sourceBytes : undefined;
    this.sourceOptions = loadedScene.sourceOptions ? { ...loadedScene.sourceOptions, signal: undefined, onProgress: undefined } : undefined;
    this.pendingInitialFit = true;
    this.installSceneContent([loadedScene, rendererType, renderer, renderCanvas, renderTexture, rendererConfig, initialFitPaddingPixels, rasterMaterialLayer, gradientMaterialLayer, fillMaterialLayer, strokeMaterialLayer, triangleStrokeLayer, vectorLodStrokeLayer, compactedStrokeLayer, textMaterialLayer, textLodLayer, pageMesh, uvArray, uvAttribute, drawPlan, pageTransforms, webGpu]);
    this.interactionController = createCanvasInteractionController(() => this.renderer);
    this.addEventListener("added", this.handleAddedToParent);
    this.addEventListener("removed", this.handleRemovedFromParent);
    this.pageDemand?.setOnChange(() => this.scheduleDemandUpdate());
    this.pageDemand?.setPerformanceListener((name, ms) => this.transitionProfile?.recordTransition(name, ms));
  }

  private installSceneContent(content: ThreePdfContent): void {
    const [loadedScene, rendererType, renderer, renderCanvas, renderTexture, rendererConfig, initialFitPaddingPixels, rasterMaterialLayer, gradientMaterialLayer, fillMaterialLayer, strokeMaterialLayer, triangleStrokeLayer, vectorLodStrokeLayer, compactedStrokeLayer, textMaterialLayer, textLodLayer, pageMesh, uvArray, uvAttribute, drawPlan, pageTransforms, webGpu] = content;
    this.pageTransforms = pageTransforms;
    this.webGpu = webGpu;
    this.currentScene = loadedScene.scene;
    this.paintVisibility = new ScenePaintVisibility(this.sceneData);
    this.renderer = renderer;
    this.renderCanvas = renderCanvas;
    this.renderTexture = renderTexture;
    this.rasterMaterialLayer = rasterMaterialLayer;
    rasterMaterialLayer.setChangeListener(() => {
      if (!this.isDisposed) (this.pageOwner ?? this).dispatchEvent({ type: "change", reason: "raster-ready" });
    });
    this.gradientMaterialLayer = gradientMaterialLayer;
    this.fillMaterialLayer = fillMaterialLayer;
    this.strokeMaterialLayer = strokeMaterialLayer;
    this.triangleStrokeLayer = triangleStrokeLayer;
    this.vectorLodStrokeLayer = vectorLodStrokeLayer;
    this.compactedStrokeLayer = compactedStrokeLayer;
    this.textMaterialLayer = textMaterialLayer;
    this.textLodLayer = textLodLayer;
    this.pageMesh = pageMesh;
    this.uvArray = uvArray;
    this.uvAttribute = uvAttribute;
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
    this.drawPlan = this.sceneData.drawRuns ? drawPlan ?? new ThreeVectorDrawPlan(this.sceneData) : null;
    this.renderer.setInteractionViewportProvider(() => this.resolveInteractionViewportRect());
    this.attachNativeFrameListener(this.renderer);

    this.name = loadedScene.sourceLabel;
    this.add(this.pageMesh);
    this.rasterMaterialLayer.setVisible(false);
    this.add(this.rasterMaterialLayer.group);
    this.gradientMaterialLayer.setVisible(false);
    this.add(this.gradientMaterialLayer.group);
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
    this.userData.hepr = {
      sourceLabel: this.sourceLabel,
      sourceKind: this.sourceKind,
      rendererType: this.rendererType,
      renderer: this.renderer
    };

    this.primitiveAppearance = new PrimitiveAppearanceState(this.sceneData, {
      onColors: updates => { this.markPageAppearanceChanged(); this.applyPrimitiveColorUpdates(updates); },
      onHighlights: highlights => { this.markPageAppearanceChanged(); this.applyPrimitiveHighlights(highlights); }
    });
    this.retainedReplay = this.sceneData.retainedPages?.length ? new RetainedPageReplay(this.sceneData) : null;
    const initialVisibility = !this.layerVisibility;
    if (initialVisibility) this.layerVisibility = new OptionalContentController(this.sceneData, {
      onChange: snapshot => this.applyLayerVisibility(snapshot),
      onProgress: percentage => this.reportLayerVisibilityProgress(percentage),
      prepare: async (snapshot, context) => {
        const staged: { commit(): void; dispose(): void }[] = [];
        const release = () => { for (const item of staged) item.dispose(); };
        context.signal.addEventListener("abort", release, { once: true });
        try {
          for (const object of this.pageViews?.map(page => page.object) ?? [this]) {
            const prepared = await object.retainedReplay?.prepare(snapshot, context);
            if (!prepared) continue;
            context.signal.throwIfAborted();
            const materials = object.rasterMaterialLayer.prepareRasterLayerUpdates(prepared.layers);
            const deferred = object.renderer as Partial<DeferredSceneRendererApi>;
            let native: ReturnType<NonNullable<RendererApi["prepareRasterLayerUpdates"]>> | undefined;
            try {
              if (!object.pageViews && (!deferred.hasUploadedScene || deferred.hasUploadedScene())) native = object.renderer.prepareRasterLayerUpdates?.(prepared.layers);
            } catch (error) { materials.dispose(); throw error; }
            staged.push({ commit: () => {
              if (!object.pageViews && !native && (!deferred.hasUploadedScene || deferred.hasUploadedScene())) native = object.renderer.prepareRasterLayerUpdates?.(prepared.layers);
              native?.commit(); materials.commit(); prepared.commit();
            }, dispose: () => { materials.dispose(); native?.dispose(); } });
          }
          context.signal.throwIfAborted();
          return () => {
            try { context.signal.throwIfAborted(); for (const item of staged) item.commit(); }
            finally { context.signal.removeEventListener("abort", release); release(); }
          };
        } catch (error) { context.signal.removeEventListener("abort", release); release(); throw error; }
      }
    });
    if (initialVisibility) this.applyLayerVisibility(this.layerVisibility.getSnapshot());
    this.pageMesh.onBeforeRender = (renderer, _scene, camera) => {
      this.handleBeforeRender(renderer as ThreeHostRenderer, camera as THREE.Camera);
    };
    this.configureDormantPipeline();
  }

  private trackLayerUpdate(promise: Promise<void>): Promise<void> {
    const owner = this.pageOwner ?? this;
    owner.pendingLayerUpdate = promise;
    const clear = () => { if (owner.pendingLayerUpdate === promise) owner.pendingLayerUpdate = null; };
    void promise.then(clear, clear);
    return promise;
  }

  /** Large PDF scenes contain the current viewing window; source bytes are retained for complete export. */
  get isPageDemandLoaded(): boolean { return !!this.pageDemand; }
  /** Whether a visible pending overview needs another host frame. */
  get needsLoadingAnimation(): boolean {
    return !this.isDisposed && this.loadingAnimationActive && pagePlaceholderAnimationEnabled();
  }
  pausePageLoading(): void { this.pageDemand?.pause(); }
  resumePageLoading(): void { this.pageDemand?.resume(); }

  /** Explicit full extraction for geometry analysis. Viewing and exporting need not retain this scene. */
  async loadCompleteScene(options: { signal?: AbortSignal; pages?: string } = {}): Promise<LoadedPdfScene["scene"]> {
    const signal = options.signal;
    signal?.throwIfAborted();
    if ((!this.pageDemand && !this.sourceOptions?.ocrTextOnly) || !this.sourceBytes) return this.sceneData;
    const { loadPdfSceneFromSource } = await import("./pdfObjectGenerator");
    return (await loadPdfSceneFromSource(this.sourceBytes, { ...this.sourceOptions, ...options, ocrTextOnly: false })).scene;
  }

  private scheduleDemandUpdate(): void {
    if (!this.pageDemand || this.isDisposed) return;
    this.demandUpdatePending = true;
    if (this.demandUpdateRunning || this.demandUpdateTimer !== null) return;
    this.demandUpdateTimer = setTimeout(() => {
      this.demandUpdateTimer = null;
      const update = this.demandUpdateRunning = this.updateDemandPages();
      void update.catch(error => {
        if (!this.isDisposed) console.warn("[HEPR] Three PDF page update failed; retaining available content.", error);
      }).finally(() => {
        this.demandUpdateRunning = null;
        if (this.demandUpdatePending) this.scheduleDemandUpdate();
      });
    }, 100);
  }

  private contentOptions(): HeprThreeObjectOptions {
    const config = this.rendererConfig;
    return { rendererType: this.rendererType, vectorLod: config.vectorLodMode, textLod: config.textLodMode,
      curveStrokes: config.strokeCurveEnabled, vectorOnly: config.textVectorOnly,
      threeColorCompositing: config.threeColorCompositing,
      pageBackground: config.pageBackground.slice(0,3) as [number,number,number], pageBackgroundOpacity: config.pageBackground[3],
      vectorOverrideColor: config.vectorOverride.slice(0,3) as [number,number,number], vectorOverrideOpacity: config.vectorOverride[3] };
  }

  private async waitForPendingLayers(signal: AbortSignal): Promise<void> {
    while (this.pendingLayerUpdate) await waitForLoad(this.pendingLayerUpdate.catch(() => {}), signal);
  }

  private async updateDemandPages(): Promise<void> {
    if (!this.pageDemand || this.isDisposed) return;
    const signal = this.pagePreparationAbort.signal;
    // Page preparation and visibility replay each own their resource transaction.
    if (this.pagePreparation) await waitForLoad(this.pagePreparation, signal);
    await this.waitForPendingLayers(signal);
    if (!this.demandUpdatePending) return;
    this.demandUpdatePending = false;
    const started = performance.now();
    const update = this.pageDemand.getDisplayUpdate(this.sceneData);
    if (update) {
      await this.applyDemandRasterUpdate(update);
      this.transitionProfile?.recordTransition("pageSwap.total", performance.now() - started);
      this.dispatchEvent({ type: "change", reason: "pages-loaded" });
      return;
    }
    const pageScenes = this.pageDemand.displayPageScenes;
    const composed = composeVectorScenesInGrid(pageScenes,
      this.sceneData.pagesPerRow, this.sourceOptions?.onDiagnostic);
    this.transitionProfile?.recordTransition("pageSwap.compose", performance.now() - started);
    const prepareStarted = performance.now();
    const scene = prepareSceneForHepRendering(composed);
    this.transitionProfile?.recordTransition("pageSwap.prepareScene", performance.now() - prepareStarted);
    const yieldControl = createLoadYielder(signal);
    const staged: { object: HeprThreePdfObject; content: ThreePdfContent }[] = [];
    const pageViews = this.pageViews;
    let partition: ScenePageViews | null = null;
    let table: ThreePageTransforms | undefined;
    let committed = false;
    try {
      staged.push({ object: this, content: await createThreePdfContent({ scene, sourceKind: this.sourceKind,
        sourceLabel: this.sourceLabel }, this.contentOptions(), signal, undefined, undefined, undefined, yieldControl,
        this.renderer, this.renderCanvas, this.rasterMaterialLayer) });
      if (this.pageViews) {
        partition = new ScenePageViews(scene);
        for (const [index, page] of this.pageViews.entries()) {
          await yieldControl();
          const view = partition.extract(index);
          staged.push({ object: page.object, content: await createThreePdfContent({ scene: view.scene,
            sourceKind: this.sourceKind, sourceLabel: page.object.sourceLabel }, page.object.contentOptions(),
          signal, undefined, undefined, undefined, yieldControl, page.object.renderer, page.object.renderCanvas, page.object.rasterMaterialLayer) });
        }
        if (this.pageBatch && !sceneRequiresPaintCompositing(scene) && !scene.retainedPages?.length) {
          table = new ThreePageTransforms(partition);
          staged.push({ object: this.pageBatch, content: await createThreePdfContent({ scene,
            sourceKind: this.sourceKind, sourceLabel: this.pageBatch.sourceLabel }, this.contentOptions(),
          signal, undefined, undefined, table, yieldControl, this.pageBatch.renderer, this.pageBatch.renderCanvas, this.pageBatch.rasterMaterialLayer) });
        }
      }
      await this.waitForPendingLayers(signal);
      signal.throwIfAborted();
      if (this.pageViews !== pageViews) { this.demandUpdatePending = true; return; }
      // No host frame can observe a partially installed generation.
      for (const { object, content } of staged) {
        const host = object.lastHostRenderer ?? this.lastHostRenderer;
        if (host) content[7].setHostRenderer(host);
        object.disposeSceneContent();
        object.pageTransforms?.dispose();
        object.installSceneContent(content);
        (object.renderer as DeferredSceneRendererApi).replaceDeferredScene(content[0].scene, { preserveRasterResolution: true });
      }
      committed = true;
      if (partition && this.pageViews) {
        this.pagePartition = partition;
        this.pageViews.forEach((page,index) => { page.view = partition!.extract(index); });
        if (this.pageBatch && !table) {
          this.pageBatch.removeFromParent(); this.pageBatch.dispose(); this.pageBatch = null;
          this.pageBatchReason = "pdf-compositing";
        }
        this.pageBatchActive = false; this.pageAppearanceChecked = -1;
        // Installation resets material residency; force layout visibility to be reapplied.
        const documentMode = this.pageDocumentMode;
        this.pageDocumentMode = !documentMode;
        this.setPageDocumentMode(documentMode);
      }
      // Clearing a previously uploaded page uses the shared native renderer.
      // Restore the document's pending scene and callbacks after all page updates.
      (this.renderer as DeferredSceneRendererApi).replaceDeferredScene(scene, { preserveRasterResolution: true });
      this.renderer.setInteractionViewportProvider(() => this.resolveInteractionViewportRect());
      this.attachNativeFrameListener(this.renderer);
      await this.trackLayerUpdate(this.layerVisibility.replaceScene(scene));
      if (this.isDisposed) return;
      this.pageDemand.bindDisplayScene(scene, pageScenes);
      const initialUpdate = this.pageDemand.getDisplayUpdate(scene);
      if (initialUpdate) await this.applyDemandRasterUpdate(initialUpdate);
      this.transitionProfile?.recordTransition("pageSwap.total", performance.now() - started);
      this.dispatchEvent({ type: "change", reason: "pages-loaded" });
    } finally {
      if (!committed) {
        for (const { content } of staged) disposeThreePdfContent(content);
        table?.dispose();
      }
    }
  }

  private async applyDemandRasterUpdate(update: { layers: Map<number, RasterLayer>; rasterPages: Set<number> }): Promise<void> {
    const targets: { object: HeprThreePdfObject; layers: Map<number, RasterLayer>; pages: ReadonlySet<number> }[] = [
      { object: this, layers: update.layers, pages: update.rasterPages }
    ];
    if (this.pageBatch) targets.push({ object: this.pageBatch, layers: update.layers, pages: update.rasterPages });
    for (const page of this.pageViews ?? []) {
      const layers = new Map<number, RasterLayer>();
      page.view.primitives.raster.forEach((global, local) => {
        const layer = update.layers.get(global);
        if (!layer) return;
        let mapped = this.localDemandRasters.get(layer);
        if (!mapped) { mapped = copyRasterLayer(layer, { pageIndex: 0 }); this.localDemandRasters.set(layer, mapped); }
        layers.set(local, mapped);
      });
      targets.push({ object: page.object, layers, pages: new Set(update.rasterPages.has(page.view.pageIndex) ? [0] : []) });
    }
    const staged: { commit(): void; dispose(): void }[] = [];
    try {
      for (const { object, layers } of targets) {
        if (object.isDisposed) continue;
        staged.push(await object.rasterMaterialLayer.prepareRasterLayerUpdatesAsync(layers));
        const prepare = object.renderer.prepareRasterLayerUpdatesAsync?.bind(object.renderer);
        if (prepare) {
          const native = await prepare(layers);
          if (native) staged.push(native);
        }
        else {
          const deferred = object.renderer as Partial<DeferredSceneRendererApi>;
          if (!deferred.hasUploadedScene || deferred.hasUploadedScene()) {
            const native = object.renderer.prepareRasterLayerUpdates?.(layers);
            if (native) staged.push(native);
          }
        }
      }
      this.pagePreparationAbort.signal.throwIfAborted();
      if (this.isDisposed) return;
      if (this.pageDemand && !this.pageDemand.isDisplayUpdateCurrent(this.sceneData, update)) {
        this.demandUpdatePending = true; return;
      }
      for (const transaction of staged) transaction.commit();
      for (const { object, pages } of targets) if (!object.isDisposed) object.setPageRasterVisibility(pages);
    } finally { for (const transaction of staged) transaction.dispose(); }
  }

  private setPageRasterVisibility(pages: ReadonlySet<number>): void {
    this.rasterPages = new Set(pages);
    const snapshot = { ...this.layerVisibility.getSnapshot(), rasterPages: this.rasterPages };
    this.paintVisibility.setVisibility(snapshot);
    this.strokeMaterialLayer?.setOptionalContentVisibility(snapshot);
    this.vectorLodStrokeLayer?.setOptionalContentVisibility(snapshot);
    this.fillMaterialLayer.setOptionalContentVisibility(snapshot);
    this.textMaterialLayer.setOptionalContentVisibility(snapshot);
    this.gradientMaterialLayer.setOptionalContentVisibility(snapshot);
    this.rasterMaterialLayer.setOptionalContentVisibility(snapshot);
    this.renderer.setPageRasterVisibility?.(this.rasterPages);
  }

  private updatePageDemand(renderer: ThreeHostRenderer, camera: THREE.Camera): void {
    if (this.isDisposed || (!this.pageDemand && !this.sceneData.pendingPagePreviews)) {
      this.loadingAnimationActive = false;
      return;
    }
    const viewport = readThreeRendererViewportPixels(renderer);
    const worldToClip = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const projection = (object: HeprThreePdfObject) => worldToClip.clone().multiply(object.matrixWorld)
      .multiply(object.dataToLocalMatrix).elements;
    const view = { width: viewport.width, height: viewport.height, zoom: 1, cameraCenterX: 0, cameraCenterY: 0,
      clipDepth: camera.coordinateSystem === THREE.WebGPUCoordinateSystem ? 0 : -1,
      ...(this.pageViews ? { projection: (index: number) => {
        const page = this.pageViews![index].object;
        return page.visible && !page.isDisposed ? projection(page) : null;
      } } : { localToClip: projection(this) }) };
    this.loadingAnimationActive = this.rendererConfig.pageBackground[3] > 0 && hasVisiblePagePlaceholders(this.sceneData, view);
    if (!this.pageOwner && this.needsLoadingAnimation) this.dispatchEvent({ type: "change", reason: "page-loading-animation" });
    this.pageDemand?.update(view, this.sceneData.pageRects);
  }

  /** Release one generation of content without changing the Group, page handles or controls. */
  private disposeSceneContent(): void {
    this.pageMesh.onBeforeRender = () => {};
    this.renderer.setFrameListener(null);
    this.renderer.setInteractionViewportProvider(null);
    this.retainedReplay?.dispose(); this.primitiveAppearance.dispose();
    this.primitivePicker?.dispose(); this.primitivePicker = null;
    this.annotationIndex?.dispose(); this.annotationIndex = null;
    this.annotationSelected = []; this.annotationHovered = null;
    this.annotationVisibilitySnapshot = this.annotationAppliedSnapshot = null;
    this.annotationInteractionRevision++; this.annotationSuppressed.clear();
    this.primitiveHighlightLayer?.dispose();
    if (this.primitiveHighlightLayer) this.remove(this.primitiveHighlightLayer.mesh);
    this.primitiveHighlightLayer = null;
    this.textSearcher = null;
    this.setSearchHighlights(null); this.setTextSelectionHighlights(null);
    this.paintCompositor?.dispose(); this.paintCompositor = null;
    this.pageMesh.removeFromParent(); this.pageMesh.geometry.dispose(); this.pageMesh.material.dispose();
    for (const root of this.listThreeMaterialObjects()) root.removeFromParent();
    this.rasterMaterialLayer.dispose(); this.gradientMaterialLayer.dispose(); this.fillMaterialLayer.dispose();
    this.strokeMaterialLayer?.dispose(); this.triangleStrokeLayer?.dispose();
    this.vectorLodStrokeLayer?.dispose(); this.compactedStrokeLayer?.dispose();
    this.textMaterialLayer.dispose(); this.textLodLayer?.dispose(); this.renderTexture?.dispose();
    this.materialPipelineActive = false; this.directDisplayOutputActive = false;
    this.lastSyncedFrameSerial = this.lastUploadedFrameSerial = this.appliedDrawPlanVersion = -1;
    this.lastViewportWidth = this.lastViewportHeight = 0;
    this.threeTextLodResourceFallback = false;
  }

  getLayers() { return this.layerVisibility.getLayers(); }
  get layerVisibilityRevision(): number { return this.layerVisibility.revision; }
  getLayerOrder() { return this.layerVisibility.getOrder(); }
  getOptionalContentVisibility(): OptionalContentSnapshot { return this.layerVisibility.getSnapshot(); }
  setLayerVisibility(layerId: string, visible: boolean): Promise<void> {
    return this.trackLayerUpdate(this.layerVisibility.setLayerVisibility(layerId, visible));
  }
  setLayerVisibilities(changes: readonly LayerVisibilityChange[]): Promise<void> {
    return this.trackLayerUpdate(this.layerVisibility.setLayerVisibilities(changes));
  }
  setAllLayerVisibility(visible: boolean, layerIds?: readonly string[]): Promise<void> {
    return this.trackLayerUpdate(this.layerVisibility.setAllLayerVisibility(visible, layerIds));
  }
  getAllLayerVisibility(layerIds?: readonly string[]) { return this.layerVisibility.getAllLayerVisibility(layerIds); }
  resetLayerVisibility(): Promise<void> { return this.trackLayerUpdate(this.layerVisibility.resetLayerVisibility()); }
  subscribeLayerVisibility(listener: OptionalContentListener): () => void { return this.layerVisibility.subscribe(listener); }

  /**
   * Annotations whose compiled appearance can be shown or hidden at runtime,
   * with their applied visibility. Empty for HEP files converted before
   * annotation layers existed, and for pages rendered as a single raster.
   */
  getAnnotationLayers(): AnnotationLayerVisibility[] { return this.layerVisibility.getAnnotationLayers(); }
  /**
   * Show or hide the compiled appearances of `SceneAnnotation.id`s, for
   * example while the host draws its own marker. Annotation metadata, bubbles
   * and `pickSceneAnnotation` keep working; hidden appearances are skipped by
   * `pick()`, search and selection. Ids without an appearance layer are
   * ignored; ids missing from `sceneData.annotations` reject with a RangeError.
   */
  setAnnotationVisibility(annotationIds: readonly string[], visible: boolean): Promise<void> {
    return this.layerVisibility.setAnnotationVisibility(annotationIds, visible);
  }

  private getAnnotationIndex(): SceneAnnotationIndex {
    if (this.isDisposed) throw new Error("PDF object disposed.");
    return this.annotationIndex ??= new SceneAnnotationIndex(this.sceneData);
  }

  /** Detached canonical references for attributable compiled appearances, including hidden paint.
   * Returns [] for metadata-only annotations and older HEPs without appearance ownership.
   */
  getAnnotationPrimitives(id: string): PrimitiveRef[] {
    return annotationPrimitiveRefs(this.getAnnotationIndex().get(id).runs);
  }

  /** Select annotations independently of primitive selection. null or [] clears the annotation selection.
   * Traces remain visible when their appearance is suppressed; metadata geometry is used when necessary.
   */
  setAnnotationSelection(ids: readonly string[] | null): void {
    if (this.isDisposed) throw new Error("PDF object disposed.");
    if (ids !== null && !Array.isArray(ids)) throw new TypeError("Annotation IDs must be an array or null.");
    const next = [...new Set(ids ?? [])];
    if (next.length === this.annotationSelected.length && next.every((id, i) => id === this.annotationSelected[i]) && !this.pageViews) return;
    const index = this.getAnnotationIndex();
    for (const id of next) index.get(id);
    this.updateAnnotationHighlights(next, this.annotationHovered);
    this.annotationSelected = next;
    for (const { object } of this.pageViews ?? []) {
      const local = new Set(object.sceneData.annotations?.map(annotation => annotation.id));
      object.setAnnotationSelection(next.filter(id => local.has(id)));
    }
  }

  /** Hover every primitive of an annotation, or its metadata geometry when no appearance is available. */
  setAnnotationHover(id: string | null): void {
    if (this.isDisposed) throw new Error("PDF object disposed.");
    if (id === this.annotationHovered && !this.pageViews) return;
    if (id !== null) this.getAnnotationIndex().get(id);
    this.updateAnnotationHighlights(this.annotationSelected, id);
    this.annotationHovered = id;
    for (const { object } of this.pageViews ?? []) object.setAnnotationHover(
      id !== null && object.sceneData.annotations?.some(annotation => annotation.id === id) ? id : null);
  }

  private getAnnotationInteractionVisibility(): OptionalContentSnapshot {
    if (this.annotationVisibilitySnapshot?.revision !== this.layerVisibility.revision) {
      this.annotationVisibilitySnapshot = createAnnotationInteractionSnapshot(this.sceneData, this.getAnnotationAppliedVisibility());
    }
    return this.annotationVisibilitySnapshot;
  }

  private getAnnotationAppliedVisibility(): OptionalContentSnapshot {
    if (this.annotationAppliedSnapshot?.revision !== this.layerVisibility.revision) {
      this.annotationAppliedSnapshot = this.layerVisibility.getSnapshot();
      const applied = new Map(this.annotationAppliedSnapshot.layers.map(layer => [layer.id, layer.visible]));
      this.annotationSuppressed = new Set(this.sceneData.optionalContent?.groups.filter(group =>
        group.annotationId !== undefined && applied.get(group.id) === false).map(group => group.annotationId!));
    }
    return this.annotationAppliedSnapshot;
  }

  private updateAnnotationHighlights(selected: readonly string[], hovered: string | null): void {
    if (this.pageViews) return;
    const snapshot = this.getAnnotationInteractionVisibility(), index = this.getAnnotationIndex();
    applySceneAnnotationHighlights(this.sceneData, index, this.primitiveAppearance, snapshot, selected, hovered);
  }

  /**
   * A detached structure element by `id`, such as `markedContent.elementId` from
   * `pick()` or `getPrimitive()`, with its user properties. Follow `parentId`
   * for ancestors. `undefined` when the scene has no such element.
   */
  getStructureElement(id: string): StructureElement | undefined {
    const element = findStructureElement(this.sceneData, id);
    return element && structuredClone(element);
  }

  /** Observe layer preparation; immediately reports the current percentage or null when idle. */
  subscribeLayerVisibilityProgress(listener: (percentage: number | null) => void): () => void {
    if (this.isDisposed) throw new Error("PDF object disposed.");
    this.layerVisibilityProgressListeners.add(listener);
    try { listener(this.layerVisibilityProgress); } catch { /* Observers cannot interrupt preparation. */ }
    return () => { this.layerVisibilityProgressListeners.delete(listener); };
  }

  private reportLayerVisibilityProgress(percentage: number | null): void {
    if (this.layerVisibilityProgress === percentage) return;
    this.layerVisibilityProgress = percentage;
    for (const listener of this.layerVisibilityProgressListeners) {
      try { listener(percentage); } catch { /* Observers cannot interrupt preparation. */ }
    }
  }

  isPrimitiveVisible(ref: PrimitiveRef): boolean {
    validatePrimitiveRef(this.sceneData, ref);
    return isScenePrimitiveVisible(this.sceneData, ref, condition => this.layerVisibility.isVisible(condition));
  }

  private applyLayerVisibility(snapshot: OptionalContentSnapshot): void {
    snapshot = { ...snapshot, rasterPages: this.rasterPages };
    for (const page of this.pageViews ?? []) page.object.applyLayerVisibility(snapshot);
    this.pageBatch?.applyLayerVisibility(snapshot);
    this.paintVisibility.setVisibility(snapshot);
    this.strokeMaterialLayer?.setOptionalContentVisibility(snapshot);
    this.vectorLodStrokeLayer?.setOptionalContentVisibility(snapshot);
    this.fillMaterialLayer.setOptionalContentVisibility(snapshot);
    this.textMaterialLayer.setOptionalContentVisibility(snapshot);
    this.gradientMaterialLayer.setOptionalContentVisibility(snapshot);
    this.rasterMaterialLayer.setOptionalContentVisibility(snapshot);
    // A deferred native renderer remains dormant; replay immediately after upload.
    const deferred = this.renderer as Partial<DeferredSceneRendererApi>;
    if (!deferred.hasUploadedScene || deferred.hasUploadedScene()) this.renderer.setOptionalContentVisibility?.(snapshot);
    const hover = this.primitiveAppearance.getHover();
    if (hover && !this.isPrimitiveVisible(hover)) this.primitiveAppearance.setHover(null);
    this.primitiveAppearance.setSelection(this.primitiveAppearance.getSelection().filter(ref => this.isPrimitiveVisible(ref)));
    if (this.annotationSelected.length || this.annotationHovered !== null) this.updateAnnotationHighlights(this.annotationSelected, this.annotationHovered);
    this.setSearchHighlights(null);
    this.setTextSelectionHighlights(null);
  }

  private pageHits(camera: THREE.Camera, x: number, y: number, element: HTMLElement) {
    camera.updateMatrixWorld();
    const hits = [];
    for (const page of this.pageViews ?? []) {
      if (!page.object.visible || page.object.isDisposed) continue;
      const point = page.object.clientToScenePoint(camera, x, y, element);
      const b = page.view.scene.pageBounds;
      if (!point || point.x < b.minX || point.x > b.maxX || point.y < b.minY || point.y > b.maxY) continue;
      const world = new THREE.Vector3(point.x - page.object.sceneCenterX, point.y - page.object.sceneCenterY, 0)
        .applyMatrix4(page.object.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      if (world.z >= 0) continue;
      hits.push({ page, point, depth: -world.z });
    }
    hits.sort((a, b) => a.depth - b.depth || b.page.view.pageIndex - a.page.view.pageIndex);
    return hits;
  }

  /** Geometric picking against the canonical scene, independent of render LOD. */
  async pick(options: PrimitivePickOptions): Promise<PrimitiveHit | null> {
    if (this.isDisposed) throw new DOMException("PDF object disposed.", "AbortError");
    options.signal?.throwIfAborted();
    if (this.pageViews) {
      for (const candidate of this.pageHits(options.camera, options.clientX, options.clientY, options.element)) {
        const hit = await candidate.page.object.pick(options);
        if (hit) {
          // The page reports its own slot; the document reports its page slot.
          const { markedContent: _page, ...rest } = hit;
          const primitive = { kind: hit.primitive.kind, index: candidate.page.view.primitives[hit.primitive.kind][hit.primitive.index] };
          const markedContent = getPrimitiveMarkedContent(this.sceneData, primitive);
          return { ...rest, primitive, ...(markedContent ? { markedContent } : {}) };
        }
        if (candidate.page.object.rendererConfig.pageBackground[3] >= 1) return null;
      }
      return null;
    }
    const context = this.createPrimitivePickContext(options);
    if (!context) return null;
    this.primitivePicker ??= new ScenePrimitivePicker(this.sceneData,
      percentage => this.reportPrimitivePreparationProgress(percentage));
    const revision = this.layerVisibility.revision;
    const hit = await this.primitivePicker.pick({ ...context,
      isConditionVisible: condition => this.layerVisibility.isVisible(condition),
      isVisible: ref => this.isPrimitiveVisible(ref) });
    if (revision !== this.layerVisibility.revision) throw new DOMException("Layer visibility changed during picking.", "AbortError");
    return hit;
  }

  private createPrimitivePickContext(options: PrimitivePickOptions): ScenePrimitivePickOptions | null {
    const { camera, element, clientX, clientY } = options;
    const rect = element.getBoundingClientRect();
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || rect.width <= 0 || rect.height <= 0) return null;
    if (clientX < rect.left || clientY < rect.top || clientX >= rect.left + rect.width ||
      clientY >= rect.top + rect.height) return null;
    const point = this.clientToScenePoint(camera, clientX, clientY, element);
    if (!point) return null;
    // Snapshot projection so a camera change during a cooperative query cannot
    // mix coordinate systems. The host decides whether the result is still current.
    const projection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .multiply(this.matrixWorld).multiply(this.dataToLocalMatrix);
    const inverse = projection.clone().invert();
    const project = (input: { x: number; y: number }): { x: number; y: number } | null => {
      const clip = new THREE.Vector4(input.x, input.y, 0, 1).applyMatrix4(projection);
      if (clip.w <= 0 || !Number.isFinite(clip.w)) return null;
      return { x: rect.left + (clip.x / clip.w + 1) * rect.width * 0.5,
        y: rect.top + (1 - clip.y / clip.w) * rect.height * 0.5 };
    };
    const unproject = (input: { x: number; y: number }): { x: number; y: number } | null => {
      const x = 2 * (input.x - rect.left) / rect.width - 1;
      const y = 1 - 2 * (input.y - rect.top) / rect.height;
      const near = new THREE.Vector3(x, y, -1).applyMatrix4(inverse);
      const far = new THREE.Vector3(x, y, 1).applyMatrix4(inverse);
      const dz = far.z - near.z;
      if (Math.abs(dz) < 1e-15) return null;
      const t = -near.z / dz;
      return { x: near.x + t * (far.x - near.x), y: near.y + t * (far.y - near.y) };
    };
    return { point, clientPoint: { x: clientX, y: clientY }, project, unproject,
      tolerancePx: options.tolerancePx, kinds: options.kinds, signal: options.signal,
      rasterLayers: this.retainedReplay?.getLayers(),
      resolveColor: (ref, original) => {
        const rgb = this.primitiveAppearance.getOverrideColor(ref) ?? original;
        const tint = this.rendererConfig.vectorOverride;
        return rgb.map((value, channel) => value * (1 - tint[3]) + tint[channel] * tint[3]) as [number, number, number];
      } };
  }

  /** Pick annotation appearances or metadata in client CSS pixels. Within a page the smallest
   * matching annotation wins, then distance, then source annotation order. Geometry misses do not
   * fall back to bounds. Independent overlapping pages use the same depth policy as pick().
   */
  async pickAnnotation(options: AnnotationPickOptions): Promise<AnnotationHit | null> {
    if (this.isDisposed) throw new DOMException("PDF object disposed.", "AbortError");
    options.signal?.throwIfAborted();
    const tolerance = options.tolerancePx ?? 4;
    if (!Number.isFinite(tolerance) || tolerance < 0) throw new RangeError("Picking tolerance must be a finite nonnegative CSS pixel value.");
    if (options.includeHidden !== undefined && typeof options.includeHidden !== "boolean") throw new TypeError("includeHidden must be a boolean.");
    if (this.pageViews) {
      for (const candidate of this.pageHits(options.camera, options.clientX, options.clientY, options.element)) {
        const hit = await candidate.page.object.pickAnnotation(options);
        if (hit) return hit;
        if (candidate.page.object.rendererConfig.pageBackground[3] >= 1) return null;
      }
      return null;
    }
    const context = this.createPrimitivePickContext(options);
    if (!context) return null;
    const revision = this.layerVisibility.revision;
    const interactionRevision = this.annotationInteractionRevision;
    const snapshot = options.includeHidden ? this.getAnnotationInteractionVisibility() : this.getAnnotationAppliedVisibility();
    const picker = this.primitivePicker ??= new ScenePrimitivePicker(this.sceneData,
      percentage => this.reportPrimitivePreparationProgress(percentage));
    return pickSceneAnnotationInteraction(this.sceneData, this.getAnnotationIndex(), picker, context, snapshot,
      options.includeHidden ?? false, this.annotationSuppressed, () => {
        if (this.isDisposed) throw new DOMException("PDF object disposed.", "AbortError");
        if (interactionRevision !== this.annotationInteractionRevision) throw new DOMException("Annotation interaction cleared during picking.", "AbortError");
        if (revision !== this.layerVisibility.revision) throw new DOMException("Layer visibility changed during annotation picking.", "AbortError");
      });
  }

  /** Observe shared picking preparation, including after an individual query is cancelled.
   * The current percentage (or null before preparation) is delivered immediately.
   * Unsubscribe when the host detaches from this object.
   */
  subscribePrimitivePreparationProgress(listener: (percentage: number | null) => void): () => void {
    if (this.isDisposed) throw new Error("PDF object disposed.");
    this.primitivePreparationListeners.add(listener);
    try { listener(this.primitivePreparationProgress); } catch { /* Observers cannot interrupt preparation. */ }
    return () => { this.primitivePreparationListeners.delete(listener); };
  }

  private reportPrimitivePreparationProgress(percentage: number | null): void {
    if (this.primitivePreparationProgress === percentage) return;
    this.primitivePreparationProgress = percentage;
    for (const listener of this.primitivePreparationListeners) {
      try { listener(percentage); } catch { /* Observers cannot interrupt preparation. */ }
    }
  }

  /** Detached original geometry and style; changes to the result do not edit the scene. */
  getPrimitive(ref: PrimitiveRef): PrimitiveInfo {
    if (this.isDisposed) throw new Error("PDF object disposed.");
    return getScenePrimitive(this.sceneData, ref);
  }

  setHover(ref: PrimitiveRef | null): void {
    this.primitiveAppearance.setHover(ref && this.isPrimitiveVisible(ref) ? ref : null);
    for (const { object, view } of this.pageViews ?? []) object.setHover(ref ? this.pagePartition!.localRef(view, ref) : null);
  }
  setSelection(refs: readonly PrimitiveRef[]): void {
    for (const { object, view } of this.pageViews ?? []) object.setSelection(refs.flatMap(ref => {
      const local = this.pagePartition!.localRef(view, ref); return local ? [local] : [];
    }));
    // Validate the complete batch even when some of its primitives are hidden.
    for (const ref of refs) validatePrimitiveRef(this.sceneData, ref);
    this.primitiveAppearance.setSelection(refs.filter(ref => this.isPrimitiveVisible(ref)));
  }
  setPrimitiveOverrides(refs: readonly PrimitiveRef[], override: PrimitiveOverride): void {
    this.primitiveAppearance.setOverrides(refs, override);
  }
  clearPrimitiveOverrides(refs?: readonly PrimitiveRef[]): void { this.primitiveAppearance.clearOverrides(refs); }

  /** Clear temporary interaction state and release the lazily constructed picking index. */
  clearPrimitiveInteraction(): void {
    for (const page of this.pageViews ?? []) page.object.clearPrimitiveInteraction();
    if (this.isDisposed) return;
    this.annotationInteractionRevision++;
    this.annotationSelected = []; this.annotationHovered = null;
    this.annotationIndex?.dispose(); this.annotationIndex = null;
    this.annotationVisibilitySnapshot = null;
    this.annotationAppliedSnapshot = null; this.annotationSuppressed.clear();
    this.primitiveAppearance.clear();
    this.primitivePicker?.dispose();
    this.primitivePicker = null;
    this.reportPrimitivePreparationProgress(null);
  }

  private applyPrimitiveColorUpdates(updates: readonly PrimitiveColorUpdate[]): void {
    if (this.pageViews) {
      if (updates.length) this.pageColorsDiverged = true;
      for (const { object, view } of this.pageViews) {
        const local = updates.flatMap(update => { const ref = this.pagePartition!.localRef(view, update.ref);
          return ref ? [{ ...update, ref }] : []; });
        for (const update of local) {
          if (update.color) object.setPrimitiveOverrides([update.ref], { color: update.color });
          else object.clearPrimitiveOverrides([update.ref]);
        }
      }
      return;
    }
    if (this.isDisposed) return;
    this.strokeMaterialLayer?.setPrimitiveColorUpdates(updates, this.sceneData);
    this.vectorLodStrokeLayer?.setPrimitiveColorUpdates(updates);
    this.vectorLodStrokeLayer?.setForceExact(this.primitiveAppearance.hasOverrides("stroke"));
    this.fillMaterialLayer.setPrimitiveColorUpdates(updates, this.sceneData);
    this.textMaterialLayer.setPrimitiveColorUpdates(updates, this.sceneData);
    this.gradientMaterialLayer.setPrimitiveColorUpdates(updates);
    this.setVectorDrawPlanColorCommutation();
    if (updates.some(update => update.ref.kind === "text")) this.setTextLodMode(this.rendererConfig.textLodMode);
    if (this.hasUploadedNativeScene()) {
      this.renderer.setPrimitiveColorUpdates?.(this.nativePrimitiveColorsReplayed
        ? updates : this.primitiveAppearance.getColorUpdates());
      this.nativePrimitiveColorsReplayed = true;
    }
    this.lastSyncedFrameSerial = -1;
    this.lastUploadedFrameSerial = -1;
  }

  private applyPrimitiveHighlights(highlights: PrimitiveHighlightSet | null): void {
    if (this.pageViews) return;
    if (this.isDisposed) return;
    if (!highlights) {
      if (this.primitiveHighlightLayer) {
        this.remove(this.primitiveHighlightLayer.mesh);
        this.primitiveHighlightLayer.dispose();
        this.primitiveHighlightLayer = null;
      }
      return;
    }
    if (!this.primitiveHighlightLayer) {
      this.primitiveHighlightLayer = new ThreePrimitiveHighlightLayer(this.rendererType,
        this.rendererConfig.threeColorCompositing, this.webGpu);
      this.primitiveHighlightBackend = this.rendererType;
      this.primitiveHighlightColorCompositing = this.rendererConfig.threeColorCompositing;
      this.add(this.primitiveHighlightLayer.mesh);
    }
    this.primitiveHighlightLayer.setHighlights(highlights);
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

  /** Whether the loaded document carries a searchable text index. */
  get hasSearchableText(): boolean {
    this.textSearcher ??= createSceneTextSearcher(this.sceneData);
    return this.textSearcher.hasText;
  }

  /**
   * Find text in the document (browser Ctrl+F-style building block).
   *
   * Matching is case-insensitive unless `options.caseSensitive` is set, and
   * whitespace in the query matches across line breaks. Matches come back in
   * composed page/reading order with `bounds` in PDF scene space and
   * `localBounds` in this object's local space. Wrapped matches additionally
   * carry tight per-line `highlightBounds` / `localHighlightBounds`; feed the
   * matches to `setSearchHighlights` and frame your camera on `localBounds` to
   * implement a find feature.
   */
  searchText(query: string, options: SceneTextSearchOptions = {}): HeprTextSearchMatch[] {
    if (query.trim()) this.pageDemand?.requestAllPreviews();
    if (this.isDisposed) {
      return [];
    }
    this.textSearcher ??= createSceneTextSearcher(this.sceneData);
    const toLocal = (bounds: Bounds, pageIndex: number): Bounds => {
      const page = this.pageViews?.[pageIndex]?.object;
      if (!page) return { minX: bounds.minX - this.sceneCenterX, minY: bounds.minY - this.sceneCenterY,
        maxX: bounds.maxX - this.sceneCenterX, maxY: bounds.maxY - this.sceneCenterY };
      this.updateWorldMatrix(true, false); page.updateWorldMatrix(true, false);
      const matrix = this.matrixWorld.clone().invert().multiply(page.matrixWorld).multiply(page.dataToLocalMatrix);
      const box = new THREE.Box3(new THREE.Vector3(bounds.minX, bounds.minY, 0),
        new THREE.Vector3(bounds.maxX, bounds.maxY, 0)).applyMatrix4(matrix);
      return { minX: box.min.x, minY: box.min.y, maxX: box.max.x, maxY: box.max.y };
    };
    return this.textSearcher.search(query, { ...options, optionalContent: this.layerVisibility.getSnapshot() }).map(match => ({
      ...match, localBounds: toLocal(match.bounds, match.pageIndex),
      localHighlightBounds: getSearchMatchHighlightBounds(match).map(bounds => toLocal(bounds, match.pageIndex))
    }));
  }

  /**
   * Show browser-find style highlight rectangles for search matches.
   *
   * Highlights are plain three.js meshes parented to this object, so they
   * stay in perfect sync with your camera in every pipeline. The match at
   * `options.currentIndex` is emphasized. Pass `null` or an empty array to
   * clear.
   */
  setSearchHighlights(
    matches:
      | ReadonlyArray<
          Pick<TextSearchMatch, "bounds"> & Partial<Pick<TextSearchMatch, "highlightBounds" | "pageIndex">>
        >
      | null,
    options: { currentIndex?: number } = {}
  ): void {
    if (this.isDisposed) {
      return;
    }
    const list = matches ?? [];
    this.searchHighlightMatches = list;
    this.markPageAppearanceChanged();
    this.searchHighlightIndex = options.currentIndex ?? -1;
    if (this.pageViews) {
      for (const { object, view } of this.pageViews) {
        const selected = list.map((match, index) => ({ match, index })).filter(({ match }) =>
          (match.pageIndex ?? this.pagePartition!.pageAt((match.bounds.minX + match.bounds.maxX) / 2,
            (match.bounds.minY + match.bounds.maxY) / 2)) === view.pageIndex);
        object.setSearchHighlights(selected.map(item => item.match),
          { currentIndex: selected.findIndex(item => item.index === options.currentIndex) });
      }
      return;
    }
    if (list.length === 0) {
      if (this.searchHighlightGroup) {
        this.searchHighlightGroup.visible = false;
      }
      return;
    }

    this.ensureSearchHighlightLayer();
    const currentIndex =
      options.currentIndex !== undefined && options.currentIndex >= 0 && options.currentIndex < list.length
        ? options.currentIndex
        : -1;

    const flattened = flattenSearchMatchHighlightBounds(list, currentIndex);
    const totalRectCount = flattened.bounds.length;
    const currentRectCount = flattened.currentCount;
    const othersCount = totalRectCount - currentRectCount;
    const othersPositions = new Float32Array(othersCount * 18);
    const othersOutlinePositions = new Float32Array(othersCount * 24);
    const currentPositions = new Float32Array(currentRectCount * 18);
    const currentOutlinePositions = new Float32Array(currentRectCount * 24);
    let othersIndex = 0;
    let currentRectIndex = 0;
    const currentEnd = flattened.currentIndex + currentRectCount;
    for (let rectIndex = 0; rectIndex < totalRectCount; rectIndex += 1) {
      const bounds = flattened.bounds[rectIndex];
      if (rectIndex >= flattened.currentIndex && rectIndex < currentEnd) {
        this.writeHighlightQuad(currentPositions, currentRectIndex * 18, bounds);
        this.writeHighlightOutline(currentOutlinePositions, currentRectIndex * 24, bounds);
        currentRectIndex += 1;
      } else {
        this.writeHighlightQuad(othersPositions, othersIndex * 18, bounds);
        this.writeHighlightOutline(othersOutlinePositions, othersIndex * 24, bounds);
        othersIndex += 1;
      }
    }

    if (this.searchHighlightOthersMesh) {
      this.replaceHighlightGeometry(this.searchHighlightOthersMesh, othersPositions);
    }
    if (this.searchHighlightOthersOutline) {
      this.replaceHighlightGeometry(this.searchHighlightOthersOutline, othersOutlinePositions);
    }
    if (this.searchHighlightCurrentMesh) {
      this.replaceHighlightGeometry(this.searchHighlightCurrentMesh, currentPositions);
    }
    if (this.searchHighlightCurrentOutline) {
      this.replaceHighlightGeometry(this.searchHighlightCurrentOutline, currentOutlinePositions);
    }
  }

  private ensureSearchHighlightLayer(): void {
    if (this.searchHighlightGroup) {
      this.searchHighlightGroup.visible = true;
      return;
    }

    const group = new THREE.Group();
    const makeMesh = (
      color: number,
      opacity: number,
      renderOrder: number
    ): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> => {
      const material = new THREE.MeshBasicMaterial({
        color: createThreeOverlayColor(color, this.directDisplayOutputActive),
        opacity,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      mesh.renderOrder = renderOrder;
      mesh.frustumCulled = false;
      group.add(mesh);
      return mesh;
    };
    const makeOutline = (
      color: number,
      renderOrder: number
    ): THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> => {
      const material = new THREE.LineBasicMaterial({
        color: createThreeOverlayColor(color, this.directDisplayOutputActive),
        transparent: true,
        depthTest: false,
        depthWrite: false
      });
      const outline = new THREE.LineSegments(new THREE.BufferGeometry(), material);
      outline.renderOrder = renderOrder;
      outline.frustumCulled = false;
      group.add(outline);
      return outline;
    };

    // Semi-transparent fill under a solid outline, matching the app renderers.
    this.searchHighlightOthersMesh = makeMesh(
      SEARCH_HIGHLIGHT_OTHERS_FILL,
      0.35,
      HEPR_THREE_LAYER_ORDER_SEARCH_HIGHLIGHT
    );
    this.searchHighlightOthersOutline = makeOutline(
      SEARCH_HIGHLIGHT_OTHERS_OUTLINE,
      HEPR_THREE_LAYER_ORDER_SEARCH_HIGHLIGHT + 1
    );
    this.searchHighlightCurrentMesh = makeMesh(
      SEARCH_HIGHLIGHT_CURRENT_FILL,
      0.45,
      HEPR_THREE_LAYER_ORDER_SEARCH_HIGHLIGHT + 2
    );
    this.searchHighlightCurrentOutline = makeOutline(
      SEARCH_HIGHLIGHT_CURRENT_OUTLINE,
      HEPR_THREE_LAYER_ORDER_SEARCH_HIGHLIGHT + 3
    );
    this.searchHighlightGroup = group;
    this.add(group);
  }

  /**
   * Show text-selection highlight rectangles (browser-selection blue).
   *
   * Rectangles are in PDF scene space — the same space as the text index and
   * `searchText` bounds — either as `Bounds` objects or as a packed
   * `Float32Array` (minX, minY, maxX, maxY per rect, the format produced by
   * `createTextSelectionController`). Like search highlights, they are plain
   * three.js meshes parented to this object. Pass `null` or an empty array to
   * clear.
   */
  setTextSelectionHighlights(rects: ReadonlyArray<Bounds> | Float32Array | null): void {
    if (this.isDisposed) {
      return;
    }
    const list: ReadonlyArray<Bounds> =
      rects instanceof Float32Array
        ? Array.from({ length: Math.floor(rects.length / 4) }, (_, i) => ({
            minX: rects[i * 4],
            minY: rects[i * 4 + 1],
            maxX: rects[i * 4 + 2],
            maxY: rects[i * 4 + 3]
          }))
        : rects ?? [];
    this.textSelectionHighlightRects = list;
    this.markPageAppearanceChanged();
    if (this.pageViews) {
      for (const { object, view } of this.pageViews) object.setTextSelectionHighlights(list.filter(rect =>
        this.pagePartition!.pageAt((rect.minX + rect.maxX) / 2, (rect.minY + rect.maxY) / 2) === view.pageIndex));
      return;
    }
    if (list.length === 0) {
      if (this.textSelectionHighlightGroup) {
        this.textSelectionHighlightGroup.visible = false;
      }
      return;
    }

    this.ensureTextSelectionHighlightLayer();
    const positions = new Float32Array(list.length * 18);
    const outlinePositions = new Float32Array(list.length * 24);
    for (let i = 0; i < list.length; i += 1) {
      this.writeHighlightQuad(positions, i * 18, list[i]);
      this.writeHighlightOutline(outlinePositions, i * 24, list[i]);
    }

    if (this.textSelectionHighlightMesh) {
      this.replaceHighlightGeometry(this.textSelectionHighlightMesh, positions);
    }
    if (this.textSelectionHighlightOutline) {
      this.replaceHighlightGeometry(this.textSelectionHighlightOutline, outlinePositions);
    }
  }

  private ensureTextSelectionHighlightLayer(): void {
    if (this.textSelectionHighlightGroup) {
      this.textSelectionHighlightGroup.visible = true;
      return;
    }

    const group = new THREE.Group();
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: createThreeOverlayColor(TEXT_SELECTION_FILL, this.directDisplayOutputActive),
      opacity: 0.35,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), fillMaterial);
    mesh.renderOrder = HEPR_THREE_LAYER_ORDER_TEXT_SELECTION;
    mesh.frustumCulled = false;
    group.add(mesh);
    const outlineMaterial = new THREE.LineBasicMaterial({
      color: createThreeOverlayColor(TEXT_SELECTION_OUTLINE, this.directDisplayOutputActive),
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    const outline = new THREE.LineSegments(new THREE.BufferGeometry(), outlineMaterial);
    outline.renderOrder = HEPR_THREE_LAYER_ORDER_TEXT_SELECTION + 1;
    outline.frustumCulled = false;
    group.add(outline);

    this.textSelectionHighlightMesh = mesh;
    this.textSelectionHighlightOutline = outline;
    this.textSelectionHighlightGroup = group;
    this.add(group);
  }

  /**
   * Intersect a client-space (CSS px) point with the PDF page plane through
   * the given camera and return PDF scene coordinates — the same space as the
   * text index and `searchText` bounds. Returns `null` when the point misses
   * the page plane.
   */
  clientToScenePoint(
    camera: THREE.Camera,
    clientX: number,
    clientY: number,
    domElement: HTMLElement
  ): { x: number; y: number } | null {
    if (this.isDisposed) {
      return null;
    }
    if (this.pageViews) return this.pageHits(camera, clientX, clientY, domElement)[0]?.point ?? null;
    const rect = domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);

    camera.updateMatrixWorld();
    if (!this.refreshPagePlaneForPicking()) {
      return null;
    }
    const localPoint = this.intersectViewportCornerWithPagePlane(camera, ndcX, ndcY);
    if (!localPoint) {
      return null;
    }
    // intersectViewportCornerWithPagePlane returns a reused scratch vector.
    return {
      x: localPoint.x + this.sceneCenterX,
      y: localPoint.y + this.sceneCenterY
    };
  }

  /**
   * Project PDF scene coordinates to a client-space (CSS px) point through
   * the given camera. Returns `null` when the point is behind the camera or
   * cannot be projected.
   */
  sceneToClientPoint(
    camera: THREE.Camera,
    sceneX: number,
    sceneY: number,
    domElement: HTMLElement,
    pageIndex?: number
  ): { x: number; y: number } | null {
    if (this.pageViews) {
      const page = this.pageViews[pageIndex ?? this.pagePartition!.pageAt(sceneX, sceneY)];
      return page?.object.visible ? page.object.sceneToClientPoint(camera, sceneX, sceneY, domElement) : null;
    }
    if (this.isDisposed) {
      return null;
    }
    const rect = domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    camera.updateMatrixWorld();
    this.updateWorldMatrix(true, false);
    const point = this.sceneToClientScratch
      .set(sceneX - this.sceneCenterX, sceneY - this.sceneCenterY, 0)
      .applyMatrix4(this.matrixWorld);

    // Reject points behind the camera before projecting (project() would
    // mirror them into view).
    const cameraType = camera as THREE.Camera & { isPerspectiveCamera?: boolean };
    if (cameraType.isPerspectiveCamera === true) {
      const viewZ =
        camera.matrixWorldInverse.elements[2] * point.x +
        camera.matrixWorldInverse.elements[6] * point.y +
        camera.matrixWorldInverse.elements[10] * point.z +
        camera.matrixWorldInverse.elements[14];
      if (viewZ >= 0) {
        return null;
      }
    }

    point.project(camera);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return null;
    }

    return {
      x: rect.left + (point.x + 1) * 0.5 * rect.width,
      y: rect.top + (1 - point.y) * 0.5 * rect.height
    };
  }

  /**
   * Refresh the page plane and world-inverse used by plane picking, matching
   * the setup camera-driven rendering performs before corner projection.
   */
  private refreshPagePlaneForPicking(): boolean {
    this.updateWorldMatrix(true, false);
    this.pagePlanePoint.set(0, 0, 0).applyMatrix4(this.matrixWorld);
    this.pagePlaneNormal.set(0, 0, 1).applyNormalMatrix(this.pageNormalMatrix.getNormalMatrix(this.matrixWorld));
    if (
      !Number.isFinite(this.pagePlaneNormal.x) ||
      !Number.isFinite(this.pagePlaneNormal.y) ||
      !Number.isFinite(this.pagePlaneNormal.z)
    ) {
      return false;
    }
    this.pagePlane.setFromNormalAndCoplanarPoint(this.pagePlaneNormal, this.pagePlanePoint);
    this.pageWorldInverse.copy(this.matrixWorld);
    if (Math.abs(this.pageWorldInverse.determinant()) < 1e-10) {
      return false;
    }
    this.pageWorldInverse.invert();
    return true;
  }

  private writeHighlightOutline(target: Float32Array, offset: number, bounds: Bounds): void {
    const minX = bounds.minX - this.sceneCenterX;
    const minY = bounds.minY - this.sceneCenterY;
    const maxX = bounds.maxX - this.sceneCenterX;
    const maxY = bounds.maxY - this.sceneCenterY;
    // 4 edges as line-segment pairs.
    const points = [
      minX, minY, maxX, minY,
      maxX, minY, maxX, maxY,
      maxX, maxY, minX, maxY,
      minX, maxY, minX, minY
    ];
    for (let point = 0; point < 8; point += 1) {
      target[offset + point * 3] = points[point * 2];
      target[offset + point * 3 + 1] = points[point * 2 + 1];
      target[offset + point * 3 + 2] = 0;
    }
  }

  private writeHighlightQuad(target: Float32Array, offset: number, bounds: Bounds): void {
    const minX = bounds.minX - this.sceneCenterX;
    const minY = bounds.minY - this.sceneCenterY;
    const maxX = bounds.maxX - this.sceneCenterX;
    const maxY = bounds.maxY - this.sceneCenterY;
    const corners = [minX, minY, maxX, minY, maxX, maxY, minX, minY, maxX, maxY, minX, maxY];
    for (let vertex = 0; vertex < 6; vertex += 1) {
      target[offset + vertex * 3] = corners[vertex * 2];
      target[offset + vertex * 3 + 1] = corners[vertex * 2 + 1];
      target[offset + vertex * 3 + 2] = 0;
    }
  }

  private replaceHighlightGeometry(
    target:
      | THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
      | THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>,
    positions: Float32Array
  ): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const previous = target.geometry;
    target.geometry = geometry;
    previous.dispose();
    target.visible = positions.length > 0;
  }

  /**
   * Return Vector LOD statistics for diagnostics, or `null` when Vector LOD is
   * inactive.
   */
  getVectorStrokeLodStats(): VectorStrokeLodStats | null {
    if (this.pageBatchActive) return this.pageBatch!.getVectorStrokeLodStats();
    if (this.pageViews && !this.pageDocumentMode) return null; // Query each page for its independent level selection.
    return this.vectorLodStrokeLayer?.getStats() ??
      (this.hasUploadedNativeScene() ? this.renderer.getVectorStrokeLodStats?.() ?? null : null);
  }

  /**
   * Return the current rendered stroke segment count when it is known.
   *
   * This is useful for debug HUDs. Returns `null` when the active pipeline does
   * not expose a separate stroke count.
   */
  getRenderedStrokeSegmentCount(): number | null {
    if (this.pageBatchActive) return this.pageBatch!.getRenderedStrokeSegmentCount();
    if (this.pageViews && !this.pageDocumentMode) return this.pageViews.reduce((sum, page) => sum +
      (page.object.visible ? page.object.getRenderedStrokeSegmentCount() ?? 0 : 0), 0);
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

    const nativeLodStats = this.hasUploadedNativeScene()
      ? this.renderer.getVectorStrokeLodStats?.()
      : null;
    if (nativeLodStats && nativeLodStats.totalLevels > 1) {
      return nativeLodStats.renderedSegments;
    }

    return null;
  }

  /**
   * Return the rendered and total text instance counts when the material text
   * layer is active, or `null` when text is drawn by the native pipeline.
   */
  getTextInstanceStats(): { rendered: number; total: number; mode: "glyphs" | "greeked" | "mixed" } | null {
    if (this.pageBatchActive) return this.pageBatch!.getTextInstanceStats();
    if (this.pageViews && !this.pageDocumentMode) {
      const stats = this.pageViews.filter(page => page.object.visible).map(page => page.object.getTextInstanceStats());
      if (stats.some(value => value === null)) return null;
      const modes = new Set(stats.map(value => value!.mode));
      return { rendered: stats.reduce((sum, value) => sum + value!.rendered, 0), total: this.sceneData.textInstanceCount,
        mode: modes.size > 1 ? "mixed" : stats[0]?.mode ?? "glyphs" };
    }
    if (!this.textMaterialLayer.mesh.visible) {
      return null;
    }

    const lodStats = this.getTextLodStats();
    const exactClusters = lodStats?.exactClusters ?? 0;
    const coarseClusters = lodStats?.coarseClusters ?? 0;
    return {
      rendered: this.textMaterialLayer.getRenderedTextInstanceCount(),
      total: this.sceneData.textInstanceCount,
      mode: coarseClusters <= 0 ? "glyphs" : (exactClusters <= 0 ? "greeked" : "mixed")
    };
  }

  /** Return clustered text-LOD diagnostics for the active rendering path. */
  getTextLodStats(): TextLodStats | null {
    if (this.pageBatchActive) return this.pageBatch!.getTextLodStats();
    if (this.pageViews && !this.pageDocumentMode) return null; // Independent pages have separate LOD levels; query their views.
    if (!this.materialPipelineActive) {
      const nativeStats = this.hasUploadedNativeScene()
        ? this.renderer.getTextLodStats?.() ?? null
        : null;
      return nativeStats ?? this.textLodLayer?.getStats() ?? null;
    }
    return this.textLodLayer?.getStats() ??
      (this.hasUploadedNativeScene() ? this.renderer.getTextLodStats?.() ?? null : null);
  }

  /**
   * Whether the active pipeline is holding the paint scheduler's coverage
   * margin. Every paint is still drawn; on a thumbnail-sized page, paints
   * within a fraction of a pixel of each other may swap to bound draw calls.
   * Batched overlapping pages report the same when a thumbnail's antialiasing
   * fringe reaches past its opaque background and may blend out of page order.
   */
  isPaintOrderApproximated(): boolean {
    if (this.pageBatchActive) return this.pageBatchFringesApproximated || this.pageBatch!.isPaintOrderApproximated();
    if (this.pageViews && !this.pageDocumentMode) return this.pageViews.some(page => page.object.visible && page.object.isPaintOrderApproximated());
    return this.materialPipelineActive
      ? this.drawPlan?.paintOrderApproximated ?? false
      : this.lastNativeDrawStats?.paintOrderApproximated ?? false;
  }

  /**
   * Return the most recent native renderer draw stats, or `null` before the
   * first native frame.
   */
  getNativeDrawStats(): DrawStats | null {
    if (this.pageBatchActive) return this.pageBatch!.getNativeDrawStats();
    if (this.pageViews && !this.pageDocumentMode) {
      const stats = this.pageViews.filter(page => page.object.visible).map(page => page.object.getNativeDrawStats());
      if (!stats.length || stats.some(value => !value)) return null;
      return { ...stats[0]!, renderedSegments: stats.reduce((sum, value) => sum + value!.renderedSegments, 0),
        totalSegments: this.sceneData.segmentCount, drawCalls: stats.every(value => value!.drawCalls !== undefined)
          ? stats.reduce((sum, value) => sum + value!.drawCalls!, 0) : undefined,
        usedCulling: stats.some(value => value!.usedCulling), paintOrderApproximated: this.isPaintOrderApproximated() };
    }
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
    for (const page of this.pageViews ?? []) page.object.setVectorLodMode(mode);
    this.pageBatch?.setVectorLodMode(mode);
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
    this.markPageAppearanceChanged();
    this.renderer.setVectorLodMode?.(useVectorLodLayer || useExactMaterialLayer ? "off" : nextMode);

    if (!hasExpectedLayer) {
      this.rebuildThreeStrokeLayer(useVectorLodLayer, useExactMaterialLayer);
    }

    this.applyPrimitiveColorUpdates(this.primitiveAppearance.getColorUpdates());
    this.resetRenderPipelinesAfterLayerChange();
  }

  /** Change clustered text LOD mode; an initially disabled LOD builds lazily on first Auto use. */
  setTextLodMode(mode: TextLodMode): void {
    for (const page of this.pageViews ?? []) page.object.setTextLodMode(mode);
    this.pageBatch?.setTextLodMode(mode);
    if (this.isDisposed) {
      return;
    }
    const nextMode: TextLodMode = this.paintVisibility.requiresCompositing || mode === "off" ? "off" : "auto";
    this.rendererConfig.textLodMode = nextMode;
    this.markPageAppearanceChanged();
    this.renderer.setTextLodMode?.(nextMode);
    const replacementScene = this.textLodLayer?.setMode(this.primitiveAppearance.hasOverrides("text") ? "off" : nextMode, this.sceneData) ?? null;
    if (replacementScene && this.textLodLayer) {
      try {
        const replacementLayer = this.createThreeTextMaterialLayer(replacementScene);
        this.replaceThreeTextMaterialLayer(replacementLayer);
      } catch (error) {
        // The adapter has already prepared combined IDs, but the currently
        // installed material is still exact-only. Roll selection back before
        // either swallowing an allocation failure or propagating another
        // constructor error.
        this.textLodLayer.useExactResourceFallback(
          error instanceof RangeError ? "resource-capacity" : "material-construction",
          this.sceneData
        );
        if (!(error instanceof RangeError)) {
          throw error;
        }
      } finally {
        this.textLodLayer.releaseRenderSceneReference();
      }
    }
    this.lastSyncedFrameSerial = -1;
  }

  /**
   * Enable or disable curve-aware stroke rendering where supported.
   */
  setStrokeCurveEnabled(enabled: boolean): void {
    for (const page of this.pageViews ?? []) page.object.setStrokeCurveEnabled(enabled);
    this.pageBatch?.setStrokeCurveEnabled(enabled);
    if (this.isDisposed) {
      return;
    }
    this.rendererConfig.strokeCurveEnabled = Boolean(enabled);
    this.markPageAppearanceChanged();
    this.renderer.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
    this.gradientMaterialLayer.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
    this.vectorLodStrokeLayer?.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
    this.strokeMaterialLayer?.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
    this.textMaterialLayer.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
  }

  /**
   * Set the page background color.
   *
   * All channels are normalized floats in the range 0..1.
   */
  setPageBackgroundColor(red: number, green: number, blue: number, alpha: number): void {
    for (const page of this.pageViews ?? []) page.object.setPageBackgroundColor(red, green, blue, alpha);
    this.pageBatch?.setPageBackgroundColor(red, green, blue, alpha);
    if (this.isDisposed) {
      return;
    }
    this.rendererConfig.pageBackground = [red, green, blue, alpha];
    this.markPageAppearanceChanged();
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
    for (const page of this.pageViews ?? []) page.object.setVectorColorOverride(red, green, blue, opacity);
    this.pageBatch?.setVectorColorOverride(red, green, blue, opacity);
    if (this.isDisposed) {
      return;
    }
    this.rendererConfig.vectorOverride = [red, green, blue, opacity];
    this.markPageAppearanceChanged();
    this.renderer.setVectorColorOverride(red, green, blue, opacity);
    this.gradientMaterialLayer.setVectorOverride(red, green, blue, opacity);
    this.fillMaterialLayer.setVectorOverride(red, green, blue, opacity);
    this.vectorLodStrokeLayer?.setVectorOverride(red, green, blue, opacity);
    this.compactedStrokeLayer?.setVectorOverride(red, green, blue, opacity);
    this.triangleStrokeLayer?.setVectorOverride(red, green, blue, opacity);
    this.strokeMaterialLayer?.setVectorOverride(red, green, blue, opacity);
    this.textMaterialLayer.setVectorOverride(red, green, blue, opacity);
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
    if (this.demandUpdateTimer !== null) clearTimeout(this.demandUpdateTimer);
    this.demandUpdateTimer = null; this.demandUpdatePending = false;
    void this.pageDemand?.close().catch(error => console.warn("[HEPR] PDF worker cleanup failed.", error));
    this.pagePreparationAbort.abort(new DOMException("PDF object disposed.", "AbortError"));
    for (const page of this.pageViews ?? []) { page.object.removeFromParent(); page.object.dispose(); }
    this.pageBatch?.removeFromParent(); this.pageBatch?.dispose(); this.pageBatch = null; this.pageBatchActive = false;
    this.pageTransforms?.dispose();
    this.pageViews = null; this.pagePartition = null; this.pagePreparation = null;
    this.searchHighlightMatches = []; this.textSelectionHighlightRects = [];
    this.primitivePicker?.dispose();
    this.annotationIndex?.dispose(); this.annotationIndex = null;
    this.annotationInteractionRevision++;
    this.annotationSelected = []; this.annotationHovered = null; this.annotationVisibilitySnapshot = null;
    this.annotationAppliedSnapshot = null; this.annotationSuppressed.clear();
    this.primitivePicker = null;
    this.reportPrimitivePreparationProgress(null);
    this.primitivePreparationListeners.clear();
    this.reportPagePreparationProgress(null);
    this.pagePreparationListeners.clear();
    if (!this.pageOwner) this.layerVisibility.dispose();
    this.layerVisibilityProgressListeners.clear();
    this.retainedReplay?.dispose();
    this.isDisposed = true;
    this.pendingHighlightFrame = null;
    this.primitiveAppearance.dispose();
    this.primitiveHighlightLayer?.dispose();
    if (this.primitiveHighlightLayer) this.remove(this.primitiveHighlightLayer.mesh);
    this.primitiveHighlightLayer = null;
    this.skipNextBeforeRenderCallback = false;
    this.frameListener = null;
    this.renderer.setFrameListener(null);
    this.renderer.setInteractionViewportProvider(null);
    this.renderer.dispose();
    this.removeEventListener("added", this.handleAddedToParent);
    this.removeEventListener("removed", this.handleRemovedFromParent);
    this.detachSceneRenderHook();
    this.clearAncestorHookWatchers();
    this.pageMesh.onBeforeRender = () => {};
    this.pageMesh.geometry.dispose();
    this.pageMesh.material.dispose();
    this.rasterMaterialLayer.dispose();
    this.paintCompositor?.dispose();
    this.paintCompositor = null;
    this.gradientMaterialLayer.dispose();
    this.fillMaterialLayer.dispose();
    this.strokeMaterialLayer?.dispose();
    this.triangleStrokeLayer?.dispose();
    this.vectorLodStrokeLayer?.dispose();
    this.compactedStrokeLayer?.dispose();
    this.textMaterialLayer.dispose();
    this.textLodLayer?.dispose();
    this.renderTexture?.dispose();
    if (this.searchHighlightGroup) {
      this.searchHighlightOthersMesh?.geometry.dispose();
      this.searchHighlightOthersMesh?.material.dispose();
      this.searchHighlightOthersOutline?.geometry.dispose();
      this.searchHighlightOthersOutline?.material.dispose();
      this.searchHighlightCurrentMesh?.geometry.dispose();
      this.searchHighlightCurrentMesh?.material.dispose();
      this.searchHighlightCurrentOutline?.geometry.dispose();
      this.searchHighlightCurrentOutline?.material.dispose();
      this.remove(this.searchHighlightGroup);
      this.searchHighlightGroup = null;
      this.searchHighlightOthersMesh = null;
      this.searchHighlightOthersOutline = null;
      this.searchHighlightCurrentMesh = null;
      this.searchHighlightCurrentOutline = null;
    }
    if (this.textSelectionHighlightGroup) {
      this.textSelectionHighlightMesh?.geometry.dispose();
      this.textSelectionHighlightMesh?.material.dispose();
      this.textSelectionHighlightOutline?.geometry.dispose();
      this.textSelectionHighlightOutline?.material.dispose();
      this.remove(this.textSelectionHighlightGroup);
      this.textSelectionHighlightGroup = null;
      this.textSelectionHighlightMesh = null;
      this.textSelectionHighlightOutline = null;
    }
    this.remove(this.pageMesh);
    this.remove(this.rasterMaterialLayer.group);
    this.remove(this.gradientMaterialLayer.group);
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
        pageTransforms: this.pageTransforms,
        drawPlan: this.drawPlan ?? undefined,
        materialBackend: this.rendererType === "webgpu" ? "webgpu" : "webgl",
        webGpu: this.webGpu,
        colorCompositing: this.rendererConfig.threeColorCompositing,
        strokeCurveEnabled: this.rendererConfig.strokeCurveEnabled,
        vectorOverride: this.rendererConfig.vectorOverride
      });
      this.vectorLodStrokeLayer.deactivate();
      this.add(this.vectorLodStrokeLayer.group);
      return;
    }

    if (useExactMaterialLayer) {
      this.strokeMaterialLayer = new ThreeMaterialStrokeLayer(this.sceneData, {
        pageTransforms: this.pageTransforms,
        drawPlan: this.drawPlan ?? undefined,
        materialBackend: this.rendererType === "webgpu" ? "webgpu" : "webgl",
        webGpu: this.webGpu,
        colorCompositing: this.rendererConfig.threeColorCompositing,
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
    this.strokeMaterialLayer?.setOptionalContentVisibility(this.layerVisibility.getSnapshot());
    this.vectorLodStrokeLayer?.setOptionalContentVisibility(this.layerVisibility.getSnapshot());
    this.strokeMaterialLayer?.setVisible(false);
    this.triangleStrokeLayer?.setVisible(false);
    this.vectorLodStrokeLayer?.deactivate();
    this.compactedStrokeLayer?.deactivate();
    this.materialPipelineActive = false;
    this.lastSyncedFrameSerial = -1;
    this.lastUploadedFrameSerial = -1;
    this.lastViewportWidth = 0;
    this.lastViewportHeight = 0;
    this.configureDormantPipeline();
  }

  handleBeforeRender(renderer: ThreeHostRenderer, camera: THREE.Camera): void {
    this.transitionProfile = getThreeRenderPerformance() ?? this.transitionProfile;
    this.refreshSceneRenderHook();
    if (this.skipNextBeforeRenderCallback) {
      this.skipNextBeforeRenderCallback = false;
      return;
    }
    this.syncBeforeRender(renderer, camera);
  }

  private refreshSceneRenderHook(): void {
    if (this.pageOwner && this.parent === this.pageOwner) { this.detachSceneRenderHook(); return; }
    if (this.isDisposed) {
      return;
    }
    const scene = findAncestorScene(this);
    if (scene && scene === this.hookedScene) {
      installSceneRenderHook(scene, this);
      this.watchAncestorsForSceneChanges();
      return;
    }

    this.detachSceneRenderHook();
    if (!scene) {
      this.watchAncestorsForSceneChanges();
      return;
    }

    installSceneRenderHook(scene, this);
    this.hookedScene = scene;
    this.watchAncestorsForSceneChanges();
  }

  private watchAncestorsForSceneChanges(): void {
    this.clearAncestorHookWatchers();
    let ancestor = this.parent;
    while (ancestor && (ancestor as { isScene?: boolean }).isScene !== true) {
      ancestor.addEventListener("added", this.handleAncestorAdded);
      ancestor.addEventListener("removed", this.handleAncestorRemoved);
      this.ancestorHookWatchers.push(ancestor);
      ancestor = ancestor.parent;
    }
  }

  private clearAncestorHookWatchers(): void {
    for (const ancestor of this.ancestorHookWatchers) {
      ancestor.removeEventListener("added", this.handleAncestorAdded);
      ancestor.removeEventListener("removed", this.handleAncestorRemoved);
    }
    this.ancestorHookWatchers.length = 0;
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
    const profile = getThreeRenderPerformance();
    profile?.beginSection("three.sync");
    try { this.syncFrame(renderer, camera); }
    finally { profile?.endSection("three.sync"); }
  }

  private syncPrimitiveHighlightFrame(renderer: ThreeHostRenderer, camera: THREE.Camera): void {
    if (this.pendingHighlightBackend) this.pendingHighlightFrame = { renderer, camera };
    if (this.primitiveHighlightLayer) {
      const backend = renderer.isWebGPURenderer === true ? "webgpu" : "webgl";
      const compositing = this.directDisplayOutputActive ? "display" : "linear";
      if (backend === "webgpu" && !this.webGpu) {
        // A WebGL object can use its native texture in a WebGPU host. Only the
        // independent highlight overlay needs the host's optional material graph.
        this.primitiveHighlightLayer.mesh.visible = false;
        if (!this.pendingHighlightBackend) {
          this.pendingHighlightFrame = { renderer, camera };
          this.pendingHighlightBackend = import("./threeWebGpuBackend").then(webGpu => {
            if (this.isDisposed) return;
            this.webGpu = webGpu;
            const frame = this.pendingHighlightFrame;
            if (frame) {
              this.syncPrimitiveHighlightFrame(frame.renderer, frame.camera);
              if (!this.isDisposed && this.primitiveHighlightLayer?.mesh.visible) {
                this.dispatchEvent({ type: "change", reason: "primitive-highlights-ready" });
              }
            }
          }).catch(error => {
            if (!this.isDisposed) console.warn("[HEPR] Unable to prepare the host WebGPU highlight overlay.", error);
          }).finally(() => {
            this.pendingHighlightBackend = null;
            this.pendingHighlightFrame = null;
          });
        }
        return;
      }
      // Native-texture fallback may be hosted by a different Three backend.
      // Its independent overlay must use that host's material type and output.
      if (this.primitiveHighlightBackend !== backend || this.primitiveHighlightColorCompositing !== compositing) {
        this.remove(this.primitiveHighlightLayer.mesh);
        this.primitiveHighlightLayer.dispose();
        this.primitiveHighlightLayer = new ThreePrimitiveHighlightLayer(backend, compositing, this.webGpu);
        this.primitiveHighlightBackend = backend;
        this.primitiveHighlightColorCompositing = compositing;
        this.primitiveHighlightLayer.setHighlights(this.primitiveAppearance.getHighlights()!);
        this.add(this.primitiveHighlightLayer.mesh);
      }
      camera.updateMatrixWorld();
      this.updateWorldMatrix(true, false);
      const viewport = readThreeRendererViewportPixels(renderer);
      const matrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        .multiply(this.matrixWorld).multiply(this.dataToLocalMatrix);
      const rect = (renderer.domElement as HTMLCanvasElement).getBoundingClientRect?.();
      const pixelRatio = rect && rect.width > 0 && rect.height > 0
        ? Math.max(viewport.width / rect.width, viewport.height / rect.height)
        : renderer.getPixelRatio?.() ?? 1;
      this.primitiveHighlightLayer.mesh.visible = true;
      this.primitiveHighlightLayer.updateFrame(matrix, estimateHighlightLocalUnitsPerPixel(matrix.elements, viewport, this.sceneBounds),
        pixelRatio);
    }
  }

  private syncFrame(renderer: ThreeHostRenderer, camera: THREE.Camera): void {
    this.lastHostRenderer = renderer;
    this.rasterMaterialLayer.setHostRenderer(renderer);
    this.updatePageDemand(renderer, camera);
    if (this.pageViews && !this.isDisposed) {
      // Pages still in the loaded layout draw exactly the document. Its own
      // pipeline then skips all per-page work; only page overlays follow.
      if (!this.pagesMatchDocumentLayout()) {
        this.setPageDocumentMode(false);
        this.prepareIndependentPages(renderer, camera);
        return;
      }
      this.setPageDocumentMode(true);
      this.syncPageOverlays(renderer, camera);
    }
    if (this.isDisposed) {
      return;
    }

    const profile = getThreeRenderPerformance();
    profile?.beginSection("three.camera");
    this.transitionProfile = profile ?? this.transitionProfile;
    this.syncAuxiliaryOutputColorSpace(renderer);
    // With page views, primitive highlights are drawn by the pages.
    if (!this.pageViews) this.syncPrimitiveHighlightFrame(renderer,camera);
    const rendererViewport = readThreeRendererViewportPixels(renderer);
    this.ensureThreeTextLodResourceSupport(renderer);
    this.updateTextureSampling(renderer);
    const cameraType = camera as { isPerspectiveCamera?: boolean };
    const perspectiveThreeCameraMode = cameraType.isPerspectiveCamera === true;
    const derivedView = this.pageBatchView ?? this.deriveViewStateFromThreeCamera(camera, rendererViewport);
    const hostBackendMatches = this.hostBackendMatchesMaterialBackend(renderer);
    const hostColorCompositingMatches = this.hostColorCompositingMatches(renderer);
    const hostUsesMaterialBackend = this.hostUsesMaterialBackend(renderer);
    const hostSupportsRasterTextures =
      hostUsesMaterialBackend && this.hostSupportsRasterTextures(renderer);
    const cameraDrivenMaterialPipelineEnabled =
      this.hasCompleteMaterialLayers() && derivedView !== null && hostSupportsRasterTextures;
    const usePaintCompositor = cameraDrivenMaterialPipelineEnabled &&
      this.paintVisibility.requiresCompositing && !threeCompositorDisabled();

    profile?.endSection("three.camera");
    profile?.beginSection("three.pipeline");
    if (!hostSupportsRasterTextures) {
      if (!hostBackendMatches) {
        if (!this.warnedHostBackendFallback) {
          this.warnedHostBackendFallback = true;
          console.warn(
            `[HEPR] rendererType=${this.rendererType} does not match the host three.js renderer; using the native texture fallback.`
          );
        }
      } else if (!hostColorCompositingMatches) {
        if (!this.warnedHostColorCompositingFallback) {
          this.warnedHostColorCompositingFallback = true;
          console.warn(
            `[HEPR] threeColorCompositing="${this.rendererConfig.threeColorCompositing}" is incompatible with ` +
            `host outputColorSpace="${renderer.outputColorSpace ?? "unknown"}"; using the native texture fallback.`
          );
        }
      } else if (!this.warnedHostRasterTextureFallback) {
        this.warnedHostRasterTextureFallback = true;
        console.warn(
          "[HEPR] A raster layer exceeds the host three.js texture-size limit; using the native texture fallback."
        );
      }
    }

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
        // The material layers present this frame, so the native renderer only
        // needs its view state current for hit testing and a later pipeline
        // switch. Letting it schedule a frame would draw the whole document a
        // second time, into a canvas nobody displays.
        this.renderer.setViewState(derivedView.viewState, { scheduleFrame: false });
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
      this.configureThreeMaterialPipeline(usePaintCompositor);
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
        this.needsLoadingAnimation ||
        nativeViewChanged ||
        viewportChanged
      );
    const shouldRenderExternally =
      shouldRenderThreeCameraFrame ||
      (this.rendererType === "webgpu" && !cameraDrivenMaterialPipelineEnabled);
    profile?.endSection("three.pipeline");
    if (shouldRenderExternally) {
      profile?.beginSection("three.nativeFallback");
      if (!this.nativePrimitiveColorsReplayed) {
        const deferred = this.renderer as Partial<DeferredSceneRendererApi>;
        deferred.ensureSceneUploaded?.();
        if (this.retainedReplay) {
          const updates = this.renderer.prepareRasterLayerUpdates?.(this.retainedReplay.getLayers());
          try { updates?.commit(); } finally { updates?.dispose(); }
        }
        this.renderer.setOptionalContentVisibility?.(this.layerVisibility.getSnapshot());
        this.renderer.setPrimitiveColorUpdates?.(this.primitiveAppearance.getColorUpdates());
        this.nativePrimitiveColorsReplayed = true;
      }
      this.renderer.renderExternalFrame?.(performance.now());
      profile?.endSection("three.nativeFallback");
    }

    const materialLayerViewport = cameraDrivenMaterialPipelineEnabled ? rendererViewport : nativeViewport;
    profile?.beginSection("three.transforms");
    const localUnitsPerPixel = this.updateMaterialLayerTransforms(
      camera,
      materialLayerViewport,
      cameraDrivenMaterialPipelineEnabled
    );
    profile?.endSection("three.transforms");
    profile?.beginSection("three.schedule");
    const previousPlanVersion = this.drawPlan?.version;
    this.updateVectorDrawPlan(localUnitsPerPixel, cameraDrivenMaterialPipelineEnabled);
    profile?.endSection("three.schedule");
    if (profile) {
      profile.add("three.scheduleChanges", this.drawPlan?.version !== previousPlanVersion ? 1 : 0);
      profile.add("three.scheduleVersion", this.drawPlan?.version ?? 0);
      profile.add("three.materialPipeline", cameraDrivenMaterialPipelineEnabled ? 1 : 0);
      const view = derivedView?.viewState ?? this.renderer.getViewState();
      profile.setFrameContext({ cameraCenterX: view.cameraCenterX, cameraCenterY: view.cameraCenterY,
        zoom: view.zoom, unitsPerPixel: localUnitsPerPixel,
        viewportWidth: materialLayerViewport.width, viewportHeight: materialLayerViewport.height });
    }
    profile?.beginSection("three.strokeLod");
    this.updateStrokeLodVisibility(localUnitsPerPixel, cameraDrivenMaterialPipelineEnabled);
    profile?.endSection("three.strokeLod");

    const presentedFrameSerial = this.renderer.getPresentedFrameSerial();
    if (
      viewportChanged ||
      presentedFrameSerial !== this.lastSyncedFrameSerial ||
      this.rasterMaterialLayer.needsResolutionUpdate ||
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
      profile?.beginSection("three.imageGradientUpdate");
      if (this.rasterMaterialLayer.group.visible) {
        this.rasterMaterialLayer.updateFrame(viewState, materialLayerViewport);
      }
      if (this.gradientMaterialLayer.group.visible) {
        this.gradientMaterialLayer.updateFrame(viewState, materialLayerViewport);
      }
      profile?.endSection("three.imageGradientUpdate");
      profile?.beginSection("three.vectorUpdate");
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
      profile?.endSection("three.vectorUpdate");
      profile?.beginSection("three.textLod");
      this.updateTextLodSelection(
        viewState,
        materialLayerViewport,
        materialCullingBounds,
        cameraDrivenMaterialPipelineEnabled,
        renderer.getRenderTarget?.() ? 1 : renderer.getPixelRatio?.() ?? 1
      );
      profile?.endSection("three.textLod");
      profile?.beginSection("three.textUpdate");
      if (this.textMaterialLayer.mesh.visible) {
        this.textMaterialLayer.updateFrame(viewState, materialLayerViewport, materialCullingBounds);
      }
      profile?.endSection("three.textUpdate");
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
    if (profile) {
      // Report the selected source geometry, including compositor-only layers.
      const strokes = this.getRenderedStrokeSegmentCount(), text = this.getTextInstanceStats();
      if (strokes !== null) profile.add("renderedSegments", strokes);
      if (text) profile.add("renderedTextInstances", text.rendered);
      const strokeLod = this.getVectorStrokeLodStats(), textLod = this.getTextLodStats();
      if (strokeLod) {
        profile.add("three.strokeLodLevel", strokeLod.baselineLevelIndex);
        profile.add("three.strokeLodVisibleTiles", strokeLod.visibleTileCount);
        profile.add("three.strokeLodActiveLevels", strokeLod.activeLevels.length);
      }
      if (textLod) {
        profile.add("three.textExactClusters", textLod.exactClusters);
        profile.add("three.textCoarseClusters", textLod.coarseClusters);
        profile.add("three.textSelectionUploads", textLod.selectionUploads);
      }
    }
    if (this.pageOwner && !this.pageTransforms) {
      this.pageMesh.material.depthWrite = this.rendererConfig.pageBackground[3] >= 1;
      // Keep the depth-only rectangle just behind the shader-projected paints.
      // Their separately computed matrices can otherwise self-fight at a tilt.
      this.pageMesh.material.polygonOffset = cameraDrivenMaterialPipelineEnabled;
      this.pageMesh.material.polygonOffsetFactor = this.pageMesh.material.polygonOffsetUnits = 1;
      this.pageMesh.material.transparent = !cameraDrivenMaterialPipelineEnabled && this.rendererConfig.pageBackground[3] < 1;
      for (const root of this.listThreeMaterialObjects()) root.traverse(child => {
        if (!(child as THREE.Mesh).isMesh) return;
        const material = (child as THREE.Mesh).material;
        for (const item of Array.isArray(material) ? material : [material]) {
          if (item.depthTest !== !usePaintCompositor) { item.depthTest = !usePaintCompositor; item.needsUpdate = true; }
        }
      });
    }

    if (this.pageTransforms) {
      for (const root of this.listThreeMaterialObjects()) root.traverse(child => {
        if (!(child as THREE.Mesh).isMesh) return;
        const mesh = child as THREE.Mesh;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const depthWrite = !!mesh.userData.heprPageBackground && this.pageTransforms!.opaque;
          if (!material.depthTest || material.depthWrite !== depthWrite) material.needsUpdate = true;
          material.depthTest = true;
          material.depthWrite = depthWrite;
          material.polygonOffset = material.depthWrite;
          material.polygonOffsetFactor = material.polygonOffsetUnits = 1;
        }
      });
    }
    if (usePaintCompositor) {
      if (!this.paintCompositor) {
        this.paintCompositor = new ThreePaintCompositor(this.rendererType, this.webGpu);
        this.add(this.paintCompositor.mesh);
      }
      if (this.pageOwner) this.paintCompositor.setPageDepth(this.clipFromDataMatrix);
      const roots: THREE.Object3D[] = [this.rasterMaterialLayer.group, this.gradientMaterialLayer.group,
        this.fillMaterialLayer.mesh, this.textMaterialLayer.mesh];
      if (this.strokeMaterialLayer) roots.push(this.strokeMaterialLayer.mesh);
      if (this.vectorLodStrokeLayer) roots.push(this.vectorLodStrokeLayer.group);
      this.paintCompositor.render(renderer as unknown as ThreePaintHostRenderer, this.sceneData, roots,
        materialLayerViewport.width, materialLayerViewport.height,
        condition => this.layerVisibility.isVisible(condition),
        bounds => projectThreePdfCompositeBounds(bounds, this.clipFromDataMatrix, materialLayerViewport.width, materialLayerViewport.height, this.rendererType),
        this.clipFromDataMatrix);
    } else if (this.paintCompositor) this.paintCompositor.mesh.visible = false;
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
    const reportedAnisotropy = renderer.getMaxAnisotropy?.() ??
      renderer.capabilities?.getMaxAnisotropy?.() ?? 1;
    const maxAnisotropy = Number.isFinite(reportedAnisotropy)
      ? Math.max(1, Math.floor(reportedAnisotropy))
      : 1;
    this.textMaterialLayer.setRasterAtlasAnisotropy(maxAnisotropy);
    if (!this.renderTexture) {
      this.textureAnisotropy = 1;
      return;
    }
    if (this.textureAnisotropy === maxAnisotropy && this.renderTexture.anisotropy === maxAnisotropy) {
      return;
    }

    this.textureAnisotropy = maxAnisotropy;
    this.renderTexture.anisotropy = maxAnisotropy;
    this.renderTexture.needsUpdate = true;
  }

  private syncAuxiliaryOutputColorSpace(renderer: ThreeHostRenderer): void {
    const directDisplayOutput = renderer.outputColorSpace === THREE.LinearSRGBColorSpace;
    if (directDisplayOutput === this.directDisplayOutputActive) {
      return;
    }

    this.directDisplayOutputActive = directDisplayOutput;
    if (this.renderTexture) {
      this.renderTexture.colorSpace = directDisplayOutput
        ? THREE.NoColorSpace
        : THREE.SRGBColorSpace;
      this.renderTexture.needsUpdate = true;
      this.pageMesh.material.needsUpdate = true;
    }
    this.updateOverlayOutputColors();
  }

  private updateOverlayOutputColors(): void {
    setThreeOverlayColor(
      this.searchHighlightOthersMesh?.material.color,
      SEARCH_HIGHLIGHT_OTHERS_FILL,
      this.directDisplayOutputActive
    );
    setThreeOverlayColor(
      this.searchHighlightOthersOutline?.material.color,
      SEARCH_HIGHLIGHT_OTHERS_OUTLINE,
      this.directDisplayOutputActive
    );
    setThreeOverlayColor(
      this.searchHighlightCurrentMesh?.material.color,
      SEARCH_HIGHLIGHT_CURRENT_FILL,
      this.directDisplayOutputActive
    );
    setThreeOverlayColor(
      this.searchHighlightCurrentOutline?.material.color,
      SEARCH_HIGHLIGHT_CURRENT_OUTLINE,
      this.directDisplayOutputActive
    );
    setThreeOverlayColor(
      this.textSelectionHighlightMesh?.material.color,
      TEXT_SELECTION_FILL,
      this.directDisplayOutputActive
    );
    setThreeOverlayColor(
      this.textSelectionHighlightOutline?.material.color,
      TEXT_SELECTION_OUTLINE,
      this.directDisplayOutputActive
    );
  }

  private ensureThreeTextLodResourceSupport(renderer: ThreeHostRenderer): void {
    if (
      this.threeTextLodResourceFallback ||
      !this.textLodLayer?.hasCombinedPayload()
    ) {
      return;
    }
    const maxTextureSize = readThreeRendererMaxTextureSize(renderer);
    if (this.textLodLayer.getRequiredTextureDimension() <= maxTextureSize) {
      return;
    }

    // The combined exact/coarse payload cannot be uploaded by this host. Keep
    // rendering correct by replacing it before first GPU use with the original
    // exact scene; LOD diagnostics retain the resource fallback reason.
    const replacementLayer = this.createThreeTextMaterialLayer(
      this.sceneData,
      Number.isFinite(maxTextureSize) ? maxTextureSize : undefined
    );
    this.replaceThreeTextMaterialLayer(replacementLayer);
    this.textLodLayer.useExactResourceFallback("resource-capacity", this.sceneData);
    this.threeTextLodResourceFallback = true;
  }

  private createThreeTextMaterialLayer(
    scene: LoadedPdfScene["scene"],
    maxRasterAtlasTextureSize?: number
  ): ThreeMaterialTextLayer {
    return new ThreeMaterialTextLayer(scene, {
      pageTransforms: this.pageTransforms,
      drawPlan: this.drawPlan ?? undefined,
      materialBackend: this.rendererType === "webgpu" ? "webgpu" : "webgl",
      webGpu: this.webGpu,
      colorCompositing: this.rendererConfig.threeColorCompositing,
      strokeCurveEnabled: this.rendererConfig.strokeCurveEnabled,
      textVectorOnly: this.rendererConfig.textVectorOnly,
      vectorOverride: this.rendererConfig.vectorOverride,
      maxRasterAtlasTextureSize,
      rasterAtlasGlyphCount: Math.min(scene.textGlyphCount, this.sceneData.textGlyphCount)
    });
  }

  private replaceThreeTextMaterialLayer(replacementLayer: ThreeMaterialTextLayer): void {
    const previousLayer = this.textMaterialLayer;
    const wasVisible = previousLayer.mesh.visible;
    const wasAttached = previousLayer.mesh.parent === this;
    replacementLayer.setVisible(wasVisible);
    if (wasAttached) {
      this.remove(previousLayer.mesh);
      this.add(replacementLayer.mesh);
    }
    this.textMaterialLayer = replacementLayer;
    replacementLayer.setOptionalContentVisibility(this.layerVisibility.getSnapshot());
    replacementLayer.setPrimitiveColorUpdates(this.primitiveAppearance.getColorUpdates(), this.sceneData);
    previousLayer.dispose();
    this.lastSyncedFrameSerial = -1;
  }

  private hasCompleteMaterialLayers(): boolean {
    return this.hasThreeStrokeMaterialLayer();
  }

  private hostSupportsRasterTextures(renderer: ThreeHostRenderer): boolean {
    const maxTextureSize = readThreeRendererMaxTextureSize(renderer);
    // Images larger than the host allows are tiled before their first upload.
    this.rasterMaterialLayer.setMaxTextureSize(maxTextureSize);
    return this.rasterMaterialLayer.getMaxRasterTextureDimension() <= maxTextureSize;
  }

  private hostUsesMaterialBackend(renderer: ThreeHostRenderer): boolean {
    return this.hostBackendMatchesMaterialBackend(renderer) &&
      this.hostColorCompositingMatches(renderer);
  }

  private hostBackendMatchesMaterialBackend(renderer: ThreeHostRenderer): boolean {
    return this.rendererType === "webgpu"
      ? renderer.isWebGPURenderer === true
      : renderer.isWebGLRenderer === true;
  }

  private hostColorCompositingMatches(renderer: ThreeHostRenderer): boolean {
    if (this.rendererType !== "webgpu" || renderer.isWebGPURenderer !== true) {
      return true;
    }
    // WebGPURenderer defaults to sRGB; accepting an omitted value also keeps
    // lightweight host mocks compatible. Other strings are not assumed to be
    // color-managed: NoColorSpace and unknown/custom spaces could otherwise
    // silently present decoded linear values as display values.
    const hostOutputColorSpace = renderer.outputColorSpace ?? THREE.SRGBColorSpace;
    return this.rendererConfig.threeColorCompositing === "display"
      ? hostOutputColorSpace === THREE.LinearSRGBColorSpace
      : hostOutputColorSpace === THREE.SRGBColorSpace;
  }

  private hasThreeStrokeMaterialLayer(): boolean {
    return (
      this.strokeMaterialLayer !== null ||
      this.triangleStrokeLayer !== null ||
      this.vectorLodStrokeLayer !== null ||
      this.compactedStrokeLayer !== null
    );
  }

  private configureDormantPipeline(): void {
    this.materialPipelineActive = false;
    this.rasterMaterialLayer.setVisible(false);
    this.rasterMaterialLayer.setTextureResidency(false);
    this.gradientMaterialLayer.setVisible(false);
    this.fillMaterialLayer.setVisible(false);
    this.strokeMaterialLayer?.setVisible(false);
    this.triangleStrokeLayer?.setVisible(false);
    this.vectorLodStrokeLayer?.deactivate();
    this.compactedStrokeLayer?.deactivate();
    this.textMaterialLayer.setVisible(false);
    this.textLodLayer?.deactivate();
    this.detachThreeMaterialObjects();
    this.renderer.setRasterRenderingEnabled?.(false);
    this.renderer.setRasterTextureResidency?.(false);
    this.renderer.setFillRenderingEnabled?.(false);
    this.renderer.setStrokeRenderingEnabled?.(false);
    this.renderer.setTextRenderingEnabled?.(false);

    if (this.renderTexture) {
      this.renderTexture.dispose();
      this.renderTexture = null;
    }
    if (this.pageMesh.material.colorWrite !== false) {
      const previousMaterial = this.pageMesh.material;
      this.pageMesh.material = createInvisiblePageMaterial();
      previousMaterial.dispose();
    }
    this.pageMesh.frustumCulled = false;
    this.pageMesh.renderOrder = HEPR_THREE_LAYER_ORDER_PAGE_DEPTH;
  }

  private configureNativeTexturePipeline(): void {
    const wasMaterialPipelineActive = this.materialPipelineActive;
    this.materialPipelineActive = false;

    this.rasterMaterialLayer.setVisible(false);
    this.rasterMaterialLayer.setTextureResidency(false);
    this.gradientMaterialLayer.setVisible(false);
    this.fillMaterialLayer.setVisible(false);
    this.strokeMaterialLayer?.setVisible(false);
    this.triangleStrokeLayer?.setVisible(false);
    this.vectorLodStrokeLayer?.deactivate();
    this.compactedStrokeLayer?.deactivate();
    this.textMaterialLayer.setVisible(false);
    this.textLodLayer?.deactivate();
    this.detachThreeMaterialObjects();
    this.renderer.setRasterTextureResidency?.(true);
    this.renderer.setRasterRenderingEnabled?.(true);
    this.renderer.setFillRenderingEnabled?.(true);
    this.renderer.setStrokeRenderingEnabled?.(true);
    this.renderer.setTextRenderingEnabled?.(true);

    if (!this.renderTexture) {
      this.renderTexture = createRenderCanvasTexture(
        this.renderCanvas,
        this.directDisplayOutputActive
      );
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

  private configureThreeMaterialPipeline(compositing: boolean): void {
    if (!this.hasCompleteMaterialLayers()) {
      this.configureNativeTexturePipeline();
      return;
    }

    const wasMaterialPipelineActive = this.materialPipelineActive;
    this.materialPipelineActive = true;
    // The compositor submits these layers through proxies sharing their GPU
    // geometry and materials. Keep its sources out of the host scene so only
    // the composite is presented, with no redundant matrix traversal. Their
    // visibility still describes selection for updates and public statistics.
    if (compositing) this.detachThreeMaterialObjects();
    else this.attachThreeMaterialObjects();

    this.renderer.setRasterRenderingEnabled?.(false);
    this.renderer.setRasterTextureResidency?.(false);
    this.rasterMaterialLayer.setTextureResidency(true);
    this.rasterMaterialLayer.setVisible(true);
    this.rasterMaterialLayer.setPageBackgroundColor(
      this.rendererConfig.pageBackground[0],
      this.rendererConfig.pageBackground[1],
      this.rendererConfig.pageBackground[2],
      this.rendererConfig.pageBackground[3]
    );
    this.gradientMaterialLayer.setVisible(true);
    this.gradientMaterialLayer.setStrokeCurveEnabled(this.rendererConfig.strokeCurveEnabled);
    this.gradientMaterialLayer.setVectorOverride(
      this.rendererConfig.vectorOverride[0],
      this.rendererConfig.vectorOverride[1],
      this.rendererConfig.vectorOverride[2],
      this.rendererConfig.vectorOverride[3]
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
    // single scene object. PDF material layers draw after it in paint order
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

  private attachThreeMaterialObjects(): void {
    for (const object of this.listThreeMaterialObjects()) {
      if (object.parent !== this) {
        this.add(object);
      }
    }
  }

  private detachThreeMaterialObjects(): void {
    for (const object of this.listThreeMaterialObjects()) {
      if (object.parent === this) {
        this.remove(object);
      }
    }
  }

  private listThreeMaterialObjects(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [
      this.rasterMaterialLayer.group,
      this.gradientMaterialLayer.group,
      this.fillMaterialLayer.mesh,
      this.textMaterialLayer.mesh
    ];
    if (this.strokeMaterialLayer) {
      objects.push(this.strokeMaterialLayer.mesh);
    }
    if (this.triangleStrokeLayer) {
      objects.push(this.triangleStrokeLayer.mesh);
    }
    if (this.vectorLodStrokeLayer) {
      objects.push(this.vectorLodStrokeLayer.group);
    }
    if (this.compactedStrokeLayer) {
      objects.push(this.compactedStrokeLayer.group);
    }
    return objects;
  }

  private updateMaterialLayerTransforms(
    camera: THREE.Camera,
    viewport: ViewportPixels,
    useLocalToClip: boolean
  ): number | null {
    if (!useLocalToClip) {
      const localUnitsPerPixel = 1 / Math.max(1e-6, this.renderer.getViewState().zoom);
      this.rasterMaterialLayer.setScreenSpaceTransform();
      this.gradientMaterialLayer.setScreenSpaceTransform();
      this.fillMaterialLayer.setScreenSpaceTransform();
      this.strokeMaterialLayer?.setScreenSpaceTransform();
      this.triangleStrokeLayer?.setScreenSpaceTransform();
      this.vectorLodStrokeLayer?.setScreenSpaceTransform();
      this.textMaterialLayer.setScreenSpaceTransform();
      this.textLodLayer?.setScreenSpaceTransform();
      return localUnitsPerPixel;
    }

    this.clipFromWorldMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.clipFromLocalMatrix.multiplyMatrices(this.clipFromWorldMatrix, this.matrixWorld);
    this.clipFromDataMatrix.multiplyMatrices(this.clipFromLocalMatrix, this.dataToLocalMatrix);
    const localUnitsPerPixel = this.pageTransforms?.minUnitsPerPixel ?? this.estimateLocalUnitsPerPixel(camera, viewport);
    this.rasterMaterialLayer.setLocalToClipTransform(this.clipFromDataMatrix);
    this.gradientMaterialLayer.setLocalToClipTransform(this.clipFromDataMatrix, localUnitsPerPixel);
    this.fillMaterialLayer.setLocalToClipTransform(this.clipFromDataMatrix);
    this.strokeMaterialLayer?.setLocalToClipTransform(this.clipFromDataMatrix, localUnitsPerPixel);
    this.triangleStrokeLayer?.setLocalToClipTransform(this.clipFromDataMatrix, localUnitsPerPixel);
    this.vectorLodStrokeLayer?.setLocalToClipTransform(this.clipFromDataMatrix, localUnitsPerPixel);
    this.textMaterialLayer.setLocalToClipTransform(this.clipFromDataMatrix);
    this.textLodLayer?.setLocalToClipTransform(this.clipFromDataMatrix);
    return localUnitsPerPixel;
  }

  /** Recoloured primitives no longer match their source RGB, so equal-colour paints stop commuting. */
  private setVectorDrawPlanColorCommutation(): void {
    const commutes = !this.primitiveAppearance.hasOverrides("stroke") &&
      !this.primitiveAppearance.hasOverrides("fill") && !this.primitiveAppearance.hasOverrides("text");
    this.drawPlan?.setColorCommutationEnabled(commutes);
    this.syncVectorDrawPlanOrder();
  }

  /**
   * Replan the shared submission order for the current pixel scale.
   *
   * Commuting paints are grouped so the material layers can submit a few dozen
   * instanced draws instead of one per canonical paint. The scale is the same
   * one the material shaders derive their antialiasing from, which is what the
   * schedule pads its overlap tests with.
   */
  private updateVectorDrawPlan(localUnitsPerPixel: number | null, vectorPipelineActive: boolean): void {
    // Only the material layers submit from this plan. While the native renderer
    // draws into a texture instead, replanning would rebuild batches nothing draws.
    if (!vectorPipelineActive) return;
    if (this.pageTransforms && this.textLodLayer?.hasCombinedPayload()) {
      const data = getOrBuildTextLod(this.sceneData).data;
      if (data) this.drawPlan?.setTextLodSource(data);
    }
    this.drawPlan?.setTextLodEnabled(this.textLodLayer?.hasCombinedPayload() === true &&
      this.rendererConfig.textLodMode === "auto" && !this.primitiveAppearance.hasOverrides("text"));
    this.drawPlan?.update(this.pageTransforms?.maxUnitsPerPixel ?? localUnitsPerPixel);
    this.syncVectorDrawPlanOrder();
  }

  /**
   * Renumber the image and gradient meshes for the current submission order.
   *
   * The order is global, so these have to move with the batched vector paints.
   * Tracking the applied version also covers a plan invalidated by color
   * overrides or by replacing the stroke LOD geometry.
   */
  private syncVectorDrawPlanOrder(): void {
    if (!this.drawPlan || this.drawPlan.version === this.appliedDrawPlanVersion) return;
    this.appliedDrawPlanVersion = this.drawPlan.version;
    applyThreePdfOverlayPaintOrder(
      this.sceneData,
      this.rasterMaterialLayer.group,
      this.gradientMaterialLayer.getOrderedPaintMeshes(),
      this.drawPlan.positions
    );
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

  private updateTextLodSelection(
    viewState: ViewState,
    viewport: ViewportPixels,
    cullingBounds: SceneBounds | null,
    vectorPipelineActive: boolean,
    pixelRatio: number
  ): void {
    if (
      !vectorPipelineActive ||
      !this.textLodLayer?.hasCombinedPayload() ||
      this.threeTextLodResourceFallback
    ) {
      return;
    }
    this.textLodLayer.updateFrame(this.textMaterialLayer, viewState, viewport, cullingBounds, pixelRatio);
  }

  private estimateLocalUnitsPerPixel(camera: THREE.Camera, viewport: ViewportPixels): number {
    const viewportWidth = Math.max(1, viewport.width);
    const viewportHeight = Math.max(1, viewport.height);
    this.projectedCenter.set(0, 0, 0).applyMatrix4(this.matrixWorld).project(camera);
    this.projectedBasisX.set(1, 0, 0).applyMatrix4(this.matrixWorld).project(camera);
    this.projectedBasisY.set(0, 1, 0).applyMatrix4(this.matrixWorld).project(camera);

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

    // Plane/frustum intersection handles perspective and orthographic cameras,
    // including page rotation, nonuniform scale, reflections and shear.
    this.pagePlanePoint.set(0, 0, 0).applyMatrix4(this.matrixWorld);
    this.pagePlaneNormal.set(0, 0, 1).applyNormalMatrix(this.pageNormalMatrix.getNormalMatrix(this.matrixWorld));
    if (!Number.isFinite(this.pagePlaneNormal.x) || !Number.isFinite(this.pagePlaneNormal.y) || !Number.isFinite(this.pagePlaneNormal.z)) {
      return null;
    }
    this.pagePlane.setFromNormalAndCoplanarPoint(this.pagePlaneNormal, this.pagePlanePoint);
    this.pageWorldInverse.copy(this.matrixWorld);
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
    const bounds = this.measureProjectedPageNdcBounds(camera);
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
    camera: THREE.Camera
  ): { minX: number; minY: number; maxX: number; maxY: number; longRatio: number } | null {
    const localX0 = this.localSceneBounds.minX;
    const localY0 = this.localSceneBounds.minY;
    const localX1 = this.localSceneBounds.maxX;
    const localY1 = this.localSceneBounds.maxY;

    this.projectedCorner0.set(localX0, localY0, 0).applyMatrix4(this.matrixWorld).project(camera);
    this.projectedCorner1.set(localX1, localY0, 0).applyMatrix4(this.matrixWorld).project(camera);
    this.projectedCorner2.set(localX1, localY1, 0).applyMatrix4(this.matrixWorld).project(camera);
    this.projectedCorner3.set(localX0, localY1, 0).applyMatrix4(this.matrixWorld).project(camera);

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

  private hasUploadedNativeScene(): boolean {
    const renderer = this.renderer as RendererApi & Partial<DeferredSceneRendererApi>;
    return typeof renderer.hasUploadedScene !== "function" || renderer.hasUploadedScene();
  }
}

function installSceneRenderHook(scene: THREE.Scene, object: HeprThreePdfObject): void {
  const existingHook = sceneRenderHooks.get(scene);
  if (existingHook) {
    existingHook.objects.add(object);
    // Do not take the callback back from application code. A common wrapper
    // captures our callback and invokes it before/after its own work; chaining
    // that wrapper back as `previous` would create an immediate recursion.
    return;
  }

  let hook: HeprSceneRenderHook;
  const callback = ((...args: Parameters<ThreeSceneRenderCallback>) => {
    hook.previous.apply(scene, args);

    const renderer = args[0] as unknown as ThreeHostRenderer;
    const camera = args[2] as THREE.Camera;

    for (const pdfObject of Array.from(hook.objects)) {
      if (findAncestorScene(pdfObject) !== scene) {
        hook.objects.delete(pdfObject);
        continue;
      }
      pdfObject.prepareFrameForThreeRenderer(renderer, camera);
    }

    if (hook.objects.size === 0 && sceneRenderHooks.get(scene) === hook) {
      removeSceneRenderHookObject(scene, object);
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

function readThreeRendererMaxTextureSize(renderer: ThreeHostRenderer): number {
  const reportedLimit = renderer.isWebGPURenderer === true
    ? renderer.backend?.device?.limits?.maxTextureDimension2D
    : renderer.capabilities?.maxTextureSize;
  if (Number.isFinite(reportedLimit) && (reportedLimit as number) >= 1) {
    return Math.floor(reportedLimit as number);
  }

  if (renderer.isWebGLRenderer === true) {
    const context = renderer.getContext?.() as {
      MAX_TEXTURE_SIZE?: number;
      getParameter?: (parameter: number) => unknown;
    } | undefined;
    const parameter = context?.MAX_TEXTURE_SIZE;
    const contextLimit = parameter === undefined ? undefined : context?.getParameter?.(parameter);
    if (typeof contextLimit === "number" && Number.isFinite(contextLimit) && contextLimit >= 1) {
      return Math.floor(contextLimit);
    }
  }

  return Number.POSITIVE_INFINITY;
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
 * Internal factory that creates a three.js PDF object from a parsed HEPR
 * scene. The public factories in index.ts own source loading (when needed),
 * LOD preparation, cancellation, and object creation.
 */
export async function createThreePdfObject(
  loadedScene: ThreePdfSceneSource,
  options: HeprThreeObjectOptions = {},
  signal?: AbortSignal,
  preparedVectorLod?: VectorStrokeLodRuntimeReservation | null,
  pageRenderer?: (canvas: HTMLCanvasElement) => RendererApi,
  pageTransforms?: ThreePageTransforms,
  /** Lets long background preparation return to the event loop between layers. */
  yieldControl?: () => Promise<void>
): Promise<HeprThreePdfObject> {
  const content = await createThreePdfContent(loadedScene, options, signal, preparedVectorLod, pageRenderer, pageTransforms, yieldControl);
  try { signal?.throwIfAborted(); return new HeprThreePdfObject(...content); }
  catch (error) { disposeThreePdfContent(content); content[2].dispose(); throw error; }
}

type ThreePdfContent = ConstructorParameters<typeof HeprThreePdfObject>;

function disposeThreePdfContent(content: ThreePdfContent): void {
  const [, , , , texture, , , raster, gradient, fill, stroke, triangle, vectorLod, compacted, text, textLod, mesh] = content;
  for (const resource of [texture, raster, gradient, fill, stroke, triangle, vectorLod, compacted,
    text, textLod, mesh.geometry, mesh.material]) resource?.dispose();
}

async function createThreePdfContent(
  loadedScene: ThreePdfSceneSource,
  options: HeprThreeObjectOptions = {},
  signal?: AbortSignal,
  preparedVectorLod?: VectorStrokeLodRuntimeReservation | null,
  pageRenderer?: (canvas: HTMLCanvasElement) => RendererApi,
  pageTransforms?: ThreePageTransforms,
  /** Lets long background preparation return to the event loop between layers. */
  yieldControl?: () => Promise<void>,
  reuseRenderer?: RendererApi,
  reuseCanvas?: HTMLCanvasElement,
  previousRasterLayer?: ThreeMaterialRasterLayer
): Promise<ThreePdfContent> {
  signal?.throwIfAborted();
  const rendererType = options.rendererType ?? "webgl";
  const webGpu = rendererType === "webgpu"
    ? await waitForLoad(import("./threeWebGpuBackend"), signal) : undefined;
  signal?.throwIfAborted();
  const sceneBounds = normalizeBounds(resolveSceneFitBounds(loadedScene.scene));
  const sceneCenterX = (sceneBounds.minX + sceneBounds.maxX) * 0.5;
  const sceneCenterY = (sceneBounds.minY + sceneBounds.maxY) * 0.5;
  const renderCanvas = reuseCanvas ?? document.createElement("canvas");
  const initialCanvasSize = computeInitialCanvasSize(sceneBounds);
  if (!reuseCanvas) {
    renderCanvas.width = initialCanvasSize.width;
    renderCanvas.height = initialCanvasSize.height;
  }

  const rendererConfig = normalizeRendererConfig(options);
  const initialFitPaddingPixels = DEFAULT_FIT_PADDING_PIXELS;
  const drawPlan = loadedScene.scene.drawRuns ? new ThreeVectorDrawPlan(loadedScene.scene, pageTransforms?.runPages) : undefined;
  const useVectorLodStrokeLayer = shouldUseVectorStrokeLod(
      rendererConfig.vectorLodMode,
      rendererType,
      loadedScene.scene.segmentCount
    );
  const nativeRenderer: RendererApi = reuseRenderer ?? (pageRenderer ? pageRenderer(renderCanvas) : await waitForLoad(
    createNativeRenderer(rendererType, renderCanvas).then<RendererApi>((renderer) => {
      if (signal?.aborted) {
        renderer.dispose();
        signal.throwIfAborted();
      }
      return renderer;
    }),
    signal
  ));
  const owned: { dispose(): void }[] = [];
  let vectorLodStrokeLayer: ThreeVectorLodStrokeLayer | null = null;
  try {
    signal?.throwIfAborted();
    if (!reuseRenderer) applyRendererConfig(nativeRenderer, rendererConfig);
    if (!reuseRenderer && useVectorLodStrokeLayer) {
      nativeRenderer.setVectorLodMode?.("off");
    }
    if (!reuseRenderer) {
      nativeRenderer.setExternalFrameDriver?.(true);
      nativeRenderer.setRasterTextureResidency?.(false);
    }
    const deferredRenderer = reuseRenderer ?? deferRendererSceneUpload(nativeRenderer, loadedScene.scene);

    const materialBackend = rendererType === "webgpu" ? "webgpu" : "webgl";

    const rasterMaterialLayer = new ThreeMaterialRasterLayer(loadedScene.scene, {
      pageTransforms,
      previousLayer: previousRasterLayer,
      materialBackend,
      webGpu,
      colorCompositing: rendererConfig.threeColorCompositing,
      pageBackground: rendererConfig.pageBackground
    });
    owned.push(rasterMaterialLayer);

    const gradientMaterialLayer = new ThreeMaterialGradientLayer(loadedScene.scene, {
      pageTransforms,
      materialBackend,
      webGpu,
      colorCompositing: rendererConfig.threeColorCompositing,
      strokeCurveEnabled: rendererConfig.strokeCurveEnabled,
      vectorOverride: rendererConfig.vectorOverride
    });
    owned.push(gradientMaterialLayer);
    applyThreePdfOverlayPaintOrder(
      loadedScene.scene,
      rasterMaterialLayer.group,
      gradientMaterialLayer.getOrderedPaintMeshes()
    );
    await yieldControl?.();

    const fillMaterialLayer = new ThreeMaterialFillLayer(loadedScene.scene, {
      pageTransforms,
      drawPlan,
      materialBackend,
      webGpu,
      colorCompositing: rendererConfig.threeColorCompositing,
      vectorOverride: rendererConfig.vectorOverride
    });
    owned.push(fillMaterialLayer);
    await yieldControl?.();

    const strokeMaterialLayer =
      !useVectorLodStrokeLayer
        ? new ThreeMaterialStrokeLayer(loadedScene.scene, {
          pageTransforms,
          drawPlan,
          materialBackend,
          webGpu,
          colorCompositing: rendererConfig.threeColorCompositing,
          strokeCurveEnabled: rendererConfig.strokeCurveEnabled,
          vectorOverride: rendererConfig.vectorOverride
        })
        : null;

    if (strokeMaterialLayer) owned.push(strokeMaterialLayer);
    const triangleStrokeLayer = null;
    await yieldControl?.();

    vectorLodStrokeLayer =
      useVectorLodStrokeLayer
        ? new ThreeVectorLodStrokeLayer(loadedScene.scene, {
          pageTransforms,
          drawPlan,
          materialBackend,
          webGpu,
          colorCompositing: rendererConfig.threeColorCompositing,
          strokeCurveEnabled: rendererConfig.strokeCurveEnabled,
          vectorOverride: rendererConfig.vectorOverride
        }, preparedVectorLod)
        : null;

    if (vectorLodStrokeLayer) owned.push(vectorLodStrokeLayer);
    const compactedStrokeLayer: ThreeCompactedStrokeLayer | null = null;
    await yieldControl?.();

    const textLodLayer = ThreeTextLodLayer.create(loadedScene.scene, sceneRequiresPaintCompositing(loadedScene.scene) ? "off" : rendererConfig.textLodMode, pageTransforms);
    owned.push(textLodLayer);
    await yieldControl?.();
    let textMaterialLayer: ThreeMaterialTextLayer;
    try {
      textMaterialLayer = new ThreeMaterialTextLayer(textLodLayer.getRenderScene(), {
        pageTransforms,
        drawPlan,
        materialBackend,
        webGpu,
        colorCompositing: rendererConfig.threeColorCompositing,
        strokeCurveEnabled: rendererConfig.strokeCurveEnabled,
        textVectorOnly: rendererConfig.textVectorOnly,
        vectorOverride: rendererConfig.vectorOverride,
        rasterAtlasGlyphCount: loadedScene.scene.textGlyphCount
      });
    } catch (error) {
      if (!(error instanceof RangeError) || !textLodLayer.hasCombinedPayload()) {
        throw error;
      }
      textLodLayer.useExactResourceFallback("resource-capacity");
      textMaterialLayer = new ThreeMaterialTextLayer(loadedScene.scene, {
        pageTransforms,
        drawPlan,
        materialBackend,
        webGpu,
        colorCompositing: rendererConfig.threeColorCompositing,
        strokeCurveEnabled: rendererConfig.strokeCurveEnabled,
        textVectorOnly: rendererConfig.textVectorOnly,
        vectorOverride: rendererConfig.vectorOverride
      });
    } finally {
      textLodLayer.releaseRenderSceneReference();
    }

    owned.push(textMaterialLayer);
    const geometry = new THREE.BufferGeometry();
    owned.push(geometry);
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
    owned.push(material);

    const pageMesh = new THREE.Mesh(geometry, material);
    return [
      loadedScene,
      rendererType,
      deferredRenderer,
      renderCanvas,
      null,
      rendererConfig,
      initialFitPaddingPixels,
      rasterMaterialLayer,
      gradientMaterialLayer,
      fillMaterialLayer,
      strokeMaterialLayer,
      triangleStrokeLayer,
      vectorLodStrokeLayer,
      compactedStrokeLayer,
      textMaterialLayer,
      textLodLayer,
      pageMesh,
      uvArray,
      uvAttribute,
      drawPlan,
      pageTransforms,
      webGpu
    ];
  } catch (error) {
    for (const resource of owned.reverse()) {
      try { resource.dispose(); } catch { /* Preserve the original initialization error. */ }
    }
    try {
      if (!reuseRenderer) nativeRenderer.dispose();
    } catch {
      // Preserve the original initialization error.
    }
    throw error;
  }
}

async function createNativeRenderer(
  rendererType: HeprRendererType,
  renderCanvas: HTMLCanvasElement
): Promise<RendererApi> {
  if (rendererType === "webgpu") {
    const { WebGpuFloorplanRenderer } = await import("./webGpuFloorplanRenderer");
    return WebGpuFloorplanRenderer.create(renderCanvas);
  }
  const { WebGlFloorplanRenderer } = await import("./webGlFloorplanRenderer");
  return new WebGlFloorplanRenderer(renderCanvas);
}

/**
 * Development bisection switch. Transparency groups, blend modes and soft masks
 * all route through the paint compositor, so when something only misbehaves on
 * a compositing document there is no way to tell the compositor apart from the
 * layers it draws. Setting `HEPR_DEBUG_DISABLE_COMPOSITOR` renders the layers
 * directly instead, which drops PDF group semantics but isolates the cause.
 */
function threeCompositorDisabled(): boolean {
  return (globalThis as { HEPR_DEBUG_DISABLE_COMPOSITOR?: boolean }).HEPR_DEBUG_DISABLE_COMPOSITOR === true;
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

function createThreeOverlayColor(hex: number, directDisplayOutput: boolean): THREE.Color {
  const color = new THREE.Color();
  setThreeOverlayColor(color, hex, directDisplayOutput);
  return color;
}

function setThreeOverlayColor(
  color: THREE.Color | undefined,
  hex: number,
  directDisplayOutput: boolean
): void {
  color?.setHex(
    hex,
    directDisplayOutput ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace
  );
}

function createRenderCanvasTexture(
  renderCanvas: HTMLCanvasElement,
  directDisplayOutput: boolean
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(renderCanvas);
  texture.colorSpace = directDisplayOutput ? THREE.NoColorSpace : THREE.SRGBColorSpace;
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
    threeColorCompositing: options.threeColorCompositing === "display"
      ? "display"
      : "linear",
    vectorLodMode: normalizeVectorLodMode(options.vectorLod),
    textLodMode: options.textLod === "off" ? "off" : "auto",
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
  renderer.setTextLodMode?.(config.textLodMode);
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
  const target = renderer.getRenderTarget?.();
  const viewport = target?.viewport ?? renderer.getViewport?.(new THREE.Vector4());
  const ratio = target ? 1 : renderer.getPixelRatio?.() ?? 1;
  if (viewport && viewport.z > 0 && viewport.w > 0) {
    return { width: Math.max(1, Math.round(viewport.z * ratio)), height: Math.max(1, Math.round(viewport.w * ratio)) };
  }
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
