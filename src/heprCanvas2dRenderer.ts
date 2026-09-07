import {
  HEPR_COLOR_SPACE_KIND,
  HEPR_GRADIENT_KIND,
  HEPR_GLYPH_FLAG,
  HEPR_IMAGE_FORMAT,
  HEPR_LINE_CAP,
  HEPR_LINE_JOIN,
  HEPR_MESH_KIND,
  HEPR_PAINT_KIND,
  HEPR_STROKE_FLAG,
  type HeprDisplayCommand,
  type HeprPageData,
  type PdfBlendMode,
  type PdfMatrix
} from "./heprDocumentData";
import {
  collectHeprExecutionScopes,
  executeHeprDisplayProgram,
  multiplyHeprMatrices,
  resolveHeprPatternPaint,
  type HeprCompositeGroupExecution,
  type HeprDisplayBackend,
  type HeprDisplayExecutionLimits,
  type HeprDisplayExecutionStats,
  type HeprDrawRunExecution,
  type HeprExecutionClipScope,
  type HeprExecutionOutcome,
  type HeprProgramExecution,
  type HeprResolvedPatternPaint
} from "./heprDisplayExecutor";
import {
  HEPR_FUNCTION_EVALUATION_CODES,
  HeprFunctionEvaluationError,
  HeprFunctionEvaluator
} from "./heprFunctionEvaluator";
import { visitHeprPath } from "./heprPathGeometry";
import {
  HeprPatchTessellationError,
  tessellateHeprPatchMesh
} from "./heprPatchMeshTessellator";
import { convertDeviceCmykToSrgb } from "./pdf/deviceCmyk";
import { findRgbaAlphaBounds } from "./rgbaBounds";

export const HEPR_CANVAS_2D_ERROR_CODES = Object.freeze({
  InvalidOptions: "canvas2d.invalid-options",
  InvalidSurface: "canvas2d.invalid-surface",
  ResourceLimit: "canvas2d.resource-limit",
  UnsupportedPaint: "canvas2d.unsupported-paint",
  UnsupportedColor: "canvas2d.unsupported-color",
  UnsupportedImage: "canvas2d.unsupported-image",
  UnsupportedComposite: "canvas2d.unsupported-composite",
  UnsupportedClip: "canvas2d.unsupported-clip",
  UnsupportedStroke: "canvas2d.unsupported-stroke",
  UnsupportedViewTransform: "canvas2d.unsupported-view-transform"
} as const);

export type HeprCanvas2dErrorCode =
  (typeof HEPR_CANVAS_2D_ERROR_CODES)[keyof typeof HEPR_CANVAS_2D_ERROR_CODES];

/** Typed, stable failure for a visible construct Canvas2D cannot represent exactly. */
export class HeprCanvas2dError extends Error {
  readonly code: HeprCanvas2dErrorCode;
  readonly path: string | null;

  constructor(
    code: HeprCanvas2dErrorCode,
    message: string,
    options: { readonly path?: string; readonly cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "HeprCanvas2dError";
    this.code = code;
    this.path = options.path ?? null;
  }
}

export interface HeprCanvas2dSurface {
  readonly canvas: CanvasImageSource & {
    readonly width: number;
    readonly height: number;
  };
  readonly context: CanvasRenderingContext2D;
}

export type HeprCanvas2dSurfaceFactory = (
  width: number,
  height: number
) => HeprCanvas2dSurface;

export interface HeprCanvas2dDecodedImage {
  readonly width: number;
  readonly height: number;
  /** Canonical, unpremultiplied RGBA8 in source row order. */
  readonly rgba: Uint8Array | Uint8ClampedArray;
}

export interface HeprCanvas2dImageDecodeRequest {
  readonly imageIndex: number;
  readonly format: number;
  readonly width: number;
  readonly height: number;
  readonly bitsPerComponent: number;
  readonly colorSpaceIndex: number;
  readonly interpolate: boolean;
  /** The self-contained encoded image payload stored in page data. */
  readonly data: Uint8Array;
  readonly decode: Float32Array;
  readonly colorKeyMask: Int32Array;
}

export type HeprCanvas2dImageDecoder = (
  request: Readonly<HeprCanvas2dImageDecodeRequest>,
  signal?: AbortSignal
) => HeprCanvas2dDecodedImage | PromiseLike<HeprCanvas2dDecodedImage>;

export interface HeprCanvas2dBackendOptions {
  /** Page-native units to device pixels. */
  readonly scale?: number;
  /** Painted behind the completed transparent page, never into transparency groups. */
  readonly background?: readonly [red: number, green: number, blue: number, alpha: number] | null;
  readonly surfaceFactory: HeprCanvas2dSurfaceFactory;
  readonly imageDecoder?: HeprCanvas2dImageDecoder;
  readonly signal?: AbortSignal;
  readonly maxCanvasPixels?: number;
  /** Aggregate live offscreen/image-cache pixels. */
  readonly maxWorkingPixels?: number;
  /** Maximum exact/adaptive color stops retained for one axial or radial shading. */
  readonly maxGradientStops?: number;
  /** Maximum adaptive subdivision depth for one-dimensional shading functions. */
  readonly maxGradientSubdivisionDepth?: number;
  /** Maximum nonlinear sRGB interpolation error between generated gradient stops. */
  readonly gradientColorTolerance?: number;
  /** Aggregate solid vector triangles emitted for mesh shadings during one render. */
  readonly maxMeshTriangles?: number;
  /** Maximum recursive subdivision depth used to approximate Gouraud interpolation. */
  readonly maxMeshSubdivisionDepth?: number;
  /** Maximum per-channel sRGB variation within one emitted solid mesh triangle. */
  readonly meshColorTolerance?: number;
  /** Maximum patch-geometry deviation in device pixels before Gouraud subdivision. */
  readonly patchFlatnessPixels?: number;
  /** Maximum nesting depth of tiling/shading pattern paints. */
  readonly maxPatternDepth?: number;
  /** Aggregate translated cell invocations used to construct pattern tiles. */
  readonly maxPatternCells?: number;
  /** Aggregate cached offscreen pixels used by pattern tiles. */
  readonly maxPatternPixels?: number;
}

export interface RenderHeprPageToCanvas2dOptions extends HeprCanvas2dBackendOptions {
  readonly executionLimits?: Partial<HeprDisplayExecutionLimits>;
}

export interface HeprCanvas2dRenderResult {
  readonly surface: HeprCanvas2dSurface;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly stats: HeprDisplayExecutionStats;
}

/** @internal Accumulated across the selective passes of one page operation. */
export interface HeprCanvas2dTimings {
  renderMs: number;
  imageSurfaceMs: number;
  imageSurfaces: number;
  imageSurfacePixels: number;
  imageSurfaceHits: number;
  softMaskMs: number;
  softMaskPixels: number;
  readbackMs: number;
  readbackPixels: number;
  renders: number;
}

/** @internal Kept separate from the rendering/public parser options. */
export interface HeprCanvas2dRenderInternals {
  readonly timings?: HeprCanvas2dTimings;
  readonly imageSurfaces?: HeprCanvas2dImageSurfaceCache;
  readonly boundSoftMasks?: boolean;
}

/**
 * @internal Immutable image surfaces only, scoped to one serial page operation.
 * Admission is bounded; no live surface is evicted out from under a backend.
 * Group/mask/output surfaces are never retained here.
 */
export class HeprCanvas2dImageSurfaceCache {
  private readonly entries = new Map<string, CachedImage>();
  private pixels = 0;
  private disposed = false;
  private active = false;
  private readonly pinned = new Set<string>();
  private readonly page: HeprPageData;
  private readonly factory: HeprCanvas2dSurfaceFactory;
  private readonly retain: (surface: HeprCanvas2dSurface) => void;
  private readonly release: (surface: HeprCanvas2dSurface) => void;
  private readonly maxPixels: number;

  constructor(
    page: HeprPageData,
    factory: HeprCanvas2dSurfaceFactory,
    retain: (surface: HeprCanvas2dSurface) => void,
    release: (surface: HeprCanvas2dSurface) => void,
    maxPixels = 16_000_000
  ) {
    this.page = page;
    this.factory = factory;
    this.retain = retain;
    this.release = release;
    this.maxPixels = positiveSafeInteger(maxPixels, "image surface cache pixels");
  }

  get pixelCount(): number { return this.pixels; }

  assertCompatible(page: HeprPageData, options: ResolvedBackendOptions): void {
    if (this.disposed || this.active || page.stores.images !== this.page.stores.images ||
        page.stores.colors !== this.page.stores.colors ||
        options.surfaceFactory !== this.factory || options.imageDecoder !== undefined) {
      throw canvasError(HEPR_CANVAS_2D_ERROR_CODES.InvalidOptions,
        "An image surface cache cannot cross page resources, factories, or codec decoders.");
    }
    this.trimUnused(options.maxWorkingPixels);
  }

  beginRender(): void { this.active = true; }
  endRender(): void { this.active = false; this.pinned.clear(); }

  get(key: string): CachedImage | undefined {
    const image = this.entries.get(key);
    if (image) this.pinned.add(key);
    return image;
  }

  add(key: string, image: CachedImage): boolean {
    if (this.disposed || this.entries.has(key) ||
        image.accountedPixels > this.maxPixels - this.pixels) return false;
    this.retain(image.surface);
    this.entries.set(key, image);
    this.pinned.add(key);
    this.pixels += image.accountedPixels;
    return true;
  }

  trimUnused(maxPixels: number): void {
    for (const [key, image] of this.entries) {
      if (this.pixels <= maxPixels) break;
      if (this.pinned.has(key)) continue;
      this.entries.delete(key);
      this.pixels -= image.accountedPixels;
      this.release(image.surface);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const image of this.entries.values()) this.release(image.surface);
    this.entries.clear();
    this.pinned.clear();
    this.pixels = 0;
  }
}

interface ResolvedBackendOptions {
  readonly scale: number;
  readonly background: readonly [number, number, number, number] | null;
  readonly surfaceFactory: HeprCanvas2dSurfaceFactory;
  readonly imageDecoder: HeprCanvas2dImageDecoder | undefined;
  readonly signal: AbortSignal | undefined;
  readonly maxCanvasPixels: number;
  readonly maxWorkingPixels: number;
  readonly maxGradientStops: number;
  readonly maxGradientSubdivisionDepth: number;
  readonly gradientColorTolerance: number;
  readonly maxMeshTriangles: number;
  readonly maxMeshSubdivisionDepth: number;
  readonly meshColorTolerance: number;
  readonly patchFlatnessPixels: number;
  readonly maxPatternDepth: number;
  readonly maxPatternCells: number;
  readonly maxPatternPixels: number;
}

interface GroupFrame {
  readonly execution: HeprCompositeGroupExecution;
  readonly surface: HeprCanvas2dSurface;
  readonly direct: boolean;
  readonly discard: boolean;
  readonly accountedPixels: number;
}

interface CachedImage {
  readonly surface: HeprCanvas2dSurface;
  readonly accountedPixels: number;
}

interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
}

interface SolidPaint {
  readonly kind: "solid";
  readonly css: string;
  readonly rgb: readonly [number, number, number];
  readonly alpha: number;
  readonly visible: boolean;
  readonly index: number;
}

interface GradientPaint {
  readonly kind: "gradient";
  readonly gradientIndex: number;
  readonly alpha: number;
  readonly visible: boolean;
  readonly index: number;
}

interface PatternPaint {
  readonly kind: "pattern";
  readonly pattern: Readonly<HeprResolvedPatternPaint>;
  readonly alpha: number;
  readonly visible: boolean;
  readonly index: number;
}

type ResolvedPaint = SolidPaint | GradientPaint | PatternPaint;

interface GradientMetadata {
  readonly gradientIndex: number;
  readonly kind: number;
  readonly colorSpaceIndex: number;
  readonly componentCount: number;
  readonly coordinates: Float32Array;
  readonly domain: readonly [number, number] | null;
  readonly functionIndices: readonly number[];
  readonly boundingBox: readonly [number, number, number, number] | null;
  readonly background: readonly number[] | null;
  readonly extendStart: boolean;
  readonly extendEnd: boolean;
}

interface GradientStop {
  readonly offset: number;
  readonly rgb: readonly [number, number, number];
  readonly alpha: number;
}

interface MeshVertex {
  readonly x: number;
  readonly y: number;
  readonly components: readonly number[];
  readonly functionInput: number | null;
  readonly rgb: readonly [number, number, number];
}

interface PatternTile {
  readonly surface: HeprCanvas2dSurface;
  readonly bounds: readonly [number, number, number, number];
  readonly pixelsPerUnitX: number;
  readonly pixelsPerUnitY: number;
}

interface PatternRuntime {
  readonly active: Set<number>;
  readonly cache: Map<string, Promise<PatternTile>>;
  depth: number;
  cells: number;
  pixels: number;
}

interface InternalCanvasBackendOptions {
  readonly deviceMatrix: PdfMatrix;
  readonly width: number;
  readonly height: number;
  readonly patternRuntime: PatternRuntime;
  readonly ownsPatternRuntime: boolean;
  readonly timings?: HeprCanvas2dTimings;
  readonly imageSurfaces?: HeprCanvas2dImageSurfaceCache;
  readonly boundSoftMasks?: boolean;
}

const DEFAULT_MAX_CANVAS_PIXELS = 100_000_000;
const DEFAULT_MAX_WORKING_PIXELS = 256_000_000;
const DEFAULT_MAX_GRADIENT_STOPS = 8_192;
const DEFAULT_MAX_GRADIENT_SUBDIVISION_DEPTH = 12;
const DEFAULT_GRADIENT_COLOR_TOLERANCE = 1 / 1024;
const DEFAULT_MAX_MESH_TRIANGLES = 1_000_000;
const DEFAULT_MAX_MESH_SUBDIVISION_DEPTH = 10;
const DEFAULT_MESH_COLOR_TOLERANCE = 8 / 255;
const DEFAULT_PATCH_FLATNESS_PIXELS = 0.25;
const DEFAULT_MAX_PATTERN_DEPTH = 16;
const DEFAULT_MAX_PATTERN_CELLS = 65_536;
const DEFAULT_MAX_PATTERN_PIXELS = 64_000_000;
const SHADING_FLAG_EXTEND_START = 1 << 0;
const SHADING_FLAG_EXTEND_END = 1 << 1;
const SHADING_FLAG_ANTI_ALIAS = 1 << 2;
const SHADING_FLAG_HAS_BOUNDING_BOX = 1 << 3;
const SHADING_FLAG_HAS_BACKGROUND = 1 << 4;
const SHADING_FLAG_HAS_FUNCTION_ARRAY = 1 << 5;
const KNOWN_SHADING_FLAGS = SHADING_FLAG_EXTEND_START | SHADING_FLAG_EXTEND_END |
  SHADING_FLAG_ANTI_ALIAS | SHADING_FLAG_HAS_BOUNDING_BOX |
  SHADING_FLAG_HAS_BACKGROUND | SHADING_FLAG_HAS_FUNCTION_ARRAY;
const DENSE_STYLE_FLAG_HAIRLINE = 1 << 0;
const DENSE_STYLE_FLAG_ROUND_CAP = 1 << 1;
const DENSE_STYLE_FLAG_CLIPPED = 1 << 2;
const DENSE_STYLE_FLAG_OFFSET = 2;
const IDENTITY: PdfMatrix = [1, 0, 0, 1, 0, 0];

export function computeHeprCanvas2dSize(
  page: Pick<HeprPageData, "pageInfo">,
  scale = 1
): { readonly width: number; readonly height: number; readonly scale: number } {
  const resolvedScale = finitePositive(scale, "Canvas2D scale");
  const pageWidth = finitePositive(page.pageInfo.width, "page width");
  const pageHeight = finitePositive(page.pageInfo.height, "page height");
  const width = Math.ceil(pageWidth * resolvedScale);
  const height = Math.ceil(pageHeight * resolvedScale);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit,
      "The scaled Canvas2D page dimensions exceed safe integer limits."
    );
  }
  return Object.freeze({ width, height, scale: resolvedScale });
}

/**
 * Render one page through the canonical ordered executor. The caller supplies
 * surfaces, keeping this reference backend independent of DOM and Node canvas packages.
 */
export async function renderHeprPageToCanvas2d(
  page: HeprPageData,
  options: RenderHeprPageToCanvas2dOptions,
  internal: HeprCanvas2dRenderInternals = {}
): Promise<HeprCanvas2dRenderResult> {
  const startedAt = internal.timings ? performance.now() : 0;
  const resolved = resolveOptions(options);
  const size = computeHeprCanvas2dSize(page, resolved.scale);
  assertPixelLimit(size.width, size.height, resolved.maxCanvasPixels, "output canvas");
  const surface = createSurface(
    resolved.surfaceFactory,
    size.width,
    size.height,
    "output canvas"
  );
  const backend = new HeprCanvas2dBackend(page, surface, resolved, {
    width: size.width, height: size.height,
    deviceMatrix: [size.scale, 0, 0, -size.scale, 0, size.height],
    patternRuntime: { active: new Set(), cache: new Map(), depth: 0, cells: 0, pixels: 0 },
    ownsPatternRuntime: true,
    timings: internal.timings,
    imageSurfaces: internal.imageSurfaces,
    boundSoftMasks: internal.boundSoftMasks
  });
  try {
    const stats = await executeHeprDisplayProgram(page, backend, {
      signal: resolved.signal,
      limits: options.executionLimits
    });
    return Object.freeze({ surface, ...size, stats });
  } finally {
    backend.dispose();
    if (internal.timings) {
      internal.timings.renderMs += performance.now() - startedAt;
      internal.timings.renders += 1;
    }
  }
}

/** Stateful backend intended for executeHeprDisplayProgram(). */
export class HeprCanvas2dBackend implements HeprDisplayBackend {
  private readonly page: HeprPageData;
  private readonly target: HeprCanvas2dSurface;
  private readonly options: ResolvedBackendOptions;
  private readonly deviceMatrix: PdfMatrix;
  private readonly width: number;
  private readonly height: number;
  private readonly patternRuntime: PatternRuntime;
  private readonly ownsPatternRuntime: boolean;
  private readonly frames: GroupFrame[] = [];
  private readonly masks = new Map<number, CachedImage>();
  private readonly imageCache = new Map<string, Promise<CachedImage>>();
  private readonly timings: HeprCanvas2dTimings | undefined;
  private readonly sharedImages: HeprCanvas2dImageSurfaceCache | undefined;
  private readonly boundSoftMasks: boolean;
  private functionEvaluator: HeprFunctionEvaluator | null = null;
  private liveWorkingPixels = 0;
  private emittedMeshTriangles = 0;
  private rootCompleted = false;
  private disposed = false;

  constructor(
    page: HeprPageData,
    target: HeprCanvas2dSurface,
    options: HeprCanvas2dBackendOptions | ResolvedBackendOptions,
    internal?: InternalCanvasBackendOptions
  ) {
    this.page = page;
    this.timings = internal?.timings;
    this.boundSoftMasks = internal?.boundSoftMasks === true;
    this.options = isResolvedOptions(options) ? options : resolveOptions(options);
    this.sharedImages = internal?.imageSurfaces;
    this.sharedImages?.assertCompatible(page, this.options);
    const size = internal ?? computeHeprCanvas2dSize(page, this.options.scale);
    this.width = size.width;
    this.height = size.height;
    assertPixelLimit(this.width, this.height, this.options.maxCanvasPixels, "output canvas");
    assertSurface(target, this.width, this.height, "output canvas");
    this.target = target;
    this.deviceMatrix = internal?.deviceMatrix ?? [
      this.options.scale, 0, 0, -this.options.scale, 0, this.height
    ];
    this.patternRuntime = internal?.patternRuntime ?? {
      active: new Set(),
      cache: new Map(),
      depth: 0,
      cells: 0,
      pixels: 0
    };
    this.ownsPatternRuntime = internal?.ownsPatternRuntime ?? true;
    clearSurface(target);
    this.sharedImages?.beginRender();
  }

  beginCompositeGroup(execution: HeprCompositeGroupExecution): void {
    this.assertUsable();
    this.options.signal?.throwIfAborted();
    if (execution.role === "root") {
      this.beginRoot(execution);
      return;
    }

    const parent = this.currentFrame();
    const discard = parent.discard ||
      (execution.alpha === 0 && execution.role !== "soft-mask");
    if (!discard) this.assertSupportedGroup(execution);
    if (discard) {
      this.frames.push({
        execution,
        surface: parent.surface,
        direct: true,
        discard: true,
        accountedPixels: 0
      });
      return;
    }

    const direct = execution.role === "invoked" && isTransparentBoundaryNoOp(execution);
    if (direct) {
      this.frames.push({
        execution,
        surface: parent.surface,
        direct: true,
        discard: parent.discard,
        accountedPixels: 0
      });
      return;
    }

    const layer = this.allocateSurface(`composite group ${execution.groupIndex}`);
    this.frames.push({
      execution,
      surface: layer.surface,
      direct: false,
      discard: parent.discard,
      accountedPixels: layer.accountedPixels
    });
  }

  beginProgram(execution: HeprProgramExecution): void {
    this.assertUsable();
    this.options.signal?.throwIfAborted();
    if (this.currentFrame().discard) return;
    if (execution.state.viewTransformFlags !== 0) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedViewTransform,
        "NoZoom/NoRotate annotation appearances require explicit viewer transform inputs.",
        `displayProgram.programs[${execution.programIndex}]`
      );
    }
  }

  async endCompositeGroup(
    execution: HeprCompositeGroupExecution,
    outcome: HeprExecutionOutcome
  ): Promise<void> {
    const frame = this.frames.pop();
    if (!frame || frame.execution.executionId !== execution.executionId) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.InvalidSurface,
        "Canvas2D composite group callbacks are unbalanced."
      );
    }
    if (execution.role === "root") {
      if (outcome.status === "complete") this.finishRoot();
      return;
    }
    if (frame.discard || outcome.status !== "complete") {
      this.releaseMask(execution.softMaskExecutionId);
      this.releasePixels(frame.accountedPixels);
      return;
    }
    if (frame.direct) return;

    if (execution.role === "soft-mask") {
      this.masks.set(execution.executionId, {
        surface: frame.surface,
        accountedPixels: frame.accountedPixels
      });
      return;
    }
    const parent = this.currentFrame();
    let mask: CachedImage | null = null;
    try {
      if (execution.softMaskExecutionId !== null) {
        mask = this.masks.get(execution.softMaskExecutionId) ?? null;
        if (!mask) {
          throw canvasError(
            HEPR_CANVAS_2D_ERROR_CODES.UnsupportedComposite,
            `Composite group ${execution.groupIndex} has no rendered soft mask.`,
            `displayProgram.groups[${execution.groupIndex}].softMaskGroupIndex`
          );
        }
        this.applySoftMask(frame.surface, mask.surface, execution);
      }
      this.compositeLayer(parent.surface.context, frame.surface.canvas, execution);
    } finally {
      if (mask !== null) this.releaseMask(execution.softMaskExecutionId);
      this.releasePixels(frame.accountedPixels);
    }
  }

  async drawRun(execution: HeprDrawRunExecution): Promise<void> {
    this.assertUsable();
    this.options.signal?.throwIfAborted();
    const frame = this.currentFrame();
    if (frame.discard || execution.command.count === 0) return;
    switch (execution.command.source) {
      case "paths":
        await this.drawGenericPaths(frame.surface.context, execution);
        return;
      case "fill-paths":
        await this.drawDenseFills(frame.surface.context, execution);
        return;
      case "stroke-segments":
        await this.drawDenseStrokes(frame.surface.context, execution);
        return;
      case "glyphs":
        await this.drawGlyphs(frame.surface.context, execution);
        return;
      case "images":
        await this.drawImages(frame.surface.context, execution);
        return;
      case "meshes":
        this.drawMeshes(frame.surface.context, execution);
        return;
      case "gradients":
        this.drawGradients(frame.surface.context, execution);
        return;
      case "patterns":
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
          `Canvas2D reference rendering does not support visible ${execution.command.source}.`,
          `${execution.commandPath}.source`
        );
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.frames.length = 0;
    this.masks.clear();
    this.imageCache.clear();
    this.sharedImages?.endRender();
    if (this.ownsPatternRuntime) {
      this.patternRuntime.active.clear();
      this.patternRuntime.cache.clear();
      this.patternRuntime.depth = 0;
      this.patternRuntime.cells = 0;
      this.patternRuntime.pixels = 0;
    }
    this.liveWorkingPixels = 0;
  }

  private beginRoot(execution: HeprCompositeGroupExecution): void {
    if (this.frames.length !== 0 || execution.parentExecutionId !== null) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.InvalidSurface,
        "Canvas2D received an invalid root group boundary."
      );
    }
    if (
      !execution.isolated || execution.knockout || execution.blendMode !== "Normal" ||
      execution.alpha !== 1 || execution.softMaskGroupIndex !== -1 ||
      execution.backdropPaintIndex !== -1 || execution.blendingColorSpaceIndex !== -1
    ) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedComposite,
        "Canvas2D requires the root group to be an isolated, opaque Normal boundary.",
        `displayProgram.groups[${execution.groupIndex}]`
      );
    }
    this.frames.push({
      execution,
      surface: this.target,
      direct: true,
      discard: false,
      accountedPixels: 0
    });
  }

  private finishRoot(): void {
    this.rootCompleted = true;
    const background = this.options.background;
    if (background === null || background[3] === 0) return;
    const context = this.target.context;
    context.save();
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalCompositeOperation = "destination-over";
      context.globalAlpha = background[3];
      context.fillStyle = rgbCss(background[0], background[1], background[2]);
      context.fillRect(0, 0, this.width, this.height);
    } finally {
      context.restore();
    }
  }

  private assertSupportedGroup(execution: HeprCompositeGroupExecution): void {
    const path = `displayProgram.groups[${execution.groupIndex}]`;
    if (
      execution.alphaIsShape &&
      (execution.alpha !== 1 || execution.softMaskGroupIndex >= 0)
    ) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedComposite,
        "Canvas2D cannot preserve distinct PDF shape and opacity accumulation.",
        `${path}.alphaIsShape`
      );
    }
    if (execution.knockout) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedComposite,
        "Canvas2D cannot exactly represent a visible PDF knockout group.",
        `${path}.knockout`
      );
    }
    if (execution.backdropPaintIndex !== -1) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedComposite,
        "Canvas2D cannot exactly represent an explicit PDF group backdrop.",
        `${path}.backdropPaintIndex`
      );
    }
    if (execution.blendingColorSpaceIndex !== -1) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedComposite,
        "Canvas2D cannot blend a group in an explicitly managed PDF color space.",
        `${path}.blendingColorSpaceIndex`
      );
    }
    if (execution.softMaskTransferFunctionIndex !== -1) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedComposite,
        "Canvas2D soft-mask transfer functions require the function kernel.",
        `${path}.softMaskTransferFunctionIndex`
      );
    }
    if (execution.role === "soft-mask") {
      if (
        !execution.isolated || execution.blendMode !== "Normal" || execution.alpha !== 1 ||
        execution.softMaskGroupIndex !== -1
      ) {
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.UnsupportedComposite,
          "Canvas2D supports only isolated, opaque, unmasked soft-mask source groups.",
          path
        );
      }
      return;
    }
    if (!execution.isolated && !isTransparentBoundaryNoOp(execution)) {
      const only = execution.group.commands.length === 1
        ? execution.group.commands[0]
        : null;
      if (only?.kind !== "draw" || only.count !== 1) {
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.UnsupportedComposite,
          "Canvas2D supports a non-isolated composited group only when it wraps one draw item.",
          `${path}.isolated`
        );
      }
    }
    assertCanvasBlendMode(execution.blendMode, path);
  }

  private compositeLayer(
    context: CanvasRenderingContext2D,
    canvas: CanvasImageSource,
    execution: HeprCompositeGroupExecution
  ): void {
    context.save();
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = execution.alpha;
      setCompositeOperation(context, execution.blendMode, execution.groupIndex);
      context.drawImage(canvas, 0, 0);
    } finally {
      context.restore();
    }
  }

  private applySoftMask(
    content: HeprCanvas2dSurface,
    mask: HeprCanvas2dSurface,
    execution: HeprCompositeGroupExecution
  ): void {
    const startedAt = this.timings ? performance.now() : 0;
    if (execution.softMaskSubtype === null) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedComposite,
        "A rendered soft mask has no Alpha or Luminosity subtype."
      );
    }
    this.options.signal?.throwIfAborted();
    const contentImage = content.context.getImageData(0, 0, this.width, this.height);
    const target = contentImage.data;
    // Masking cannot make a transparent content pixel visible. Keep the full
    // rendering/coordinate system, but read and update only its nonzero bounds.
    const bounds = this.boundSoftMasks
      ? findRgbaAlphaBounds(target, this.width, this.height, this.options.signal)
      : { x: 0, y: 0, width: this.width, height: this.height };
    if (!bounds) {
      if (this.timings) this.timings.softMaskMs += performance.now() - startedAt;
      return;
    }
    const maskImage = mask.context.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
    const source = maskImage.data;
    const alphaOnly = execution.softMaskSubtype === "Alpha";
    for (let y = 0; y < bounds.height; y += 1) {
      this.options.signal?.throwIfAborted();
      let offset = ((y + bounds.y) * this.width + bounds.x) * 4;
      let maskOffset = y * bounds.width * 4;
      for (let x = 0; x < bounds.width; x += 1, offset += 4, maskOffset += 4) {
        if (target[offset + 3] === 0) continue;
        const factor = alphaOnly
          ? source[maskOffset + 3] / 255
          : (0.3 * source[maskOffset] + 0.59 * source[maskOffset + 1] + 0.11 * source[maskOffset + 2]) /
            255 * (source[maskOffset + 3] / 255);
        target[offset + 3] = Math.round(target[offset + 3] * factor);
      }
    }
    content.context.putImageData(contentImage, 0, 0, bounds.x, bounds.y, bounds.width, bounds.height);
    if (this.timings) {
      this.timings.softMaskMs += performance.now() - startedAt;
      this.timings.softMaskPixels += bounds.width * bounds.height;
    }
  }

  private async drawGenericPaths(
    context: CanvasRenderingContext2D,
    execution: HeprDrawRunExecution
  ): Promise<void> {
    const command = execution.command;
    if (command.source !== "paths") return;
    const fill = this.readOptionalPaint(
      command.fillPaintIndex,
      command.fillPaintInherited === true,
      execution,
      "fillPaintIndex"
    );
    const stroke = this.readOptionalPaint(
      command.strokePaintIndex,
      command.strokePaintInherited === true,
      execution,
      "strokePaintIndex"
    );
    if (!fill?.visible && !stroke?.visible) return;
    const transform = execution.state.transform;
    const localTransform = readTransform(this.page, command.transformIndex);
    for (let pathIndex = command.first; pathIndex < command.first + command.count; pathIndex += 1) {
      this.options.signal?.throwIfAborted();
      if (fill?.visible) {
        context.save();
        try {
          this.applyClips(context, execution.state.clips);
          setCanvasTransform(context, multiplyHeprMatrices(this.deviceMatrix, transform));
          context.beginPath();
          appendStoredPath(context, this.page, pathIndex);
          await this.fillCurrentPath(
            context,
            fill,
            command.fillRule === 1 ? "evenodd" : "nonzero",
            transform,
            localTransform,
            `${execution.commandPath}.fillPaintIndex`
          );
        } finally {
          context.restore();
        }
      }
      if (stroke?.visible) {
        context.save();
        try {
          this.applyClips(context, execution.state.clips);
          setCanvasTransform(context, multiplyHeprMatrices(this.deviceMatrix, transform));
          context.beginPath();
          appendStoredPath(context, this.page, pathIndex);
          this.applyGenericStrokeStyle(
            context,
            command.strokeStyleIndex,
            multiplyHeprMatrices(this.deviceMatrix, transform),
            execution.commandPath
          );
          await this.strokeCurrentPath(
            context,
            stroke,
            transform,
            localTransform,
            `${execution.commandPath}.strokePaintIndex`
          );
        } finally {
          context.restore();
        }
      }
    }
  }

  private async drawDenseFills(
    context: CanvasRenderingContext2D,
    execution: HeprDrawRunExecution
  ): Promise<void> {
    const command = execution.command;
    if (command.source !== "fill-paths") return;
    const paint = this.readRequiredPaint(command.paintIndex, execution, "paintIndex");
    if (!paint.visible) return;
    const matrix = multiplyHeprMatrices(this.deviceMatrix, execution.state.transform);
    const localTransform = readTransform(this.page, command.transformIndex);
    for (let pathIndex = command.first; pathIndex < command.first + command.count; pathIndex += 1) {
      this.options.signal?.throwIfAborted();
      context.save();
      try {
        this.applyClips(context, execution.state.clips);
        setCanvasTransform(context, matrix);
        context.beginPath();
        appendDenseFillPath(context, this.page, pathIndex);
        const rule = this.page.stores.paths.fillPathMetaC[pathIndex * 4] === 1
          ? "evenodd"
          : "nonzero";
        await this.fillCurrentPath(
          context,
          paint,
          rule,
          execution.state.transform,
          localTransform,
          `${execution.commandPath}.paintIndex`
        );
      } finally {
        context.restore();
      }
    }
  }

  private async drawDenseStrokes(
    context: CanvasRenderingContext2D,
    execution: HeprDrawRunExecution
  ): Promise<void> {
    const command = execution.command;
    if (command.source !== "stroke-segments") return;
    const paint = this.readRequiredPaint(command.paintIndex, execution, "paintIndex");
    if (!paint.visible) return;
    const matrix = multiplyHeprMatrices(this.deviceMatrix, execution.state.transform);
    const localTransform = readTransform(this.page, command.transformIndex);
    const strokes = this.page.stores.strokes;
    for (let index = command.first; index < command.first + command.count; index += 1) {
      this.options.signal?.throwIfAborted();
      const offset = index * 4;
      const packed = strokes.primitiveMeta[offset + 3];
      const styleFlags = Math.max(0, Math.trunc(packed / DENSE_STYLE_FLAG_OFFSET + 1e-6));
      const primitiveAlpha = clamp01(packed - styleFlags * DENSE_STYLE_FLAG_OFFSET);
      const unknownFlags = styleFlags & ~(
        DENSE_STYLE_FLAG_HAIRLINE | DENSE_STYLE_FLAG_ROUND_CAP | DENSE_STYLE_FLAG_CLIPPED
      );
      if (unknownFlags !== 0) {
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.UnsupportedStroke,
          `Dense stroke ${index} has unsupported style flags ${unknownFlags}.`,
          `${execution.commandPath}.first`
        );
      }
      if (primitiveAlpha === 0) continue;
      const halfWidth = strokes.styles[offset];
      const hairline = (styleFlags & DENSE_STYLE_FLAG_HAIRLINE) !== 0 || halfWidth === 0;
      const lineWidth = hairline
        ? hairlineWidth(matrix, `${execution.commandPath}.first`)
        : halfWidth * 2;
      context.save();
      try {
        this.applyClips(context, execution.state.clips);
        setCanvasTransform(context, matrix);
        context.beginPath();
        context.moveTo(strokes.endpoints[offset], strokes.endpoints[offset + 1]);
        if (strokes.primitiveMeta[offset + 2] >= 0.5) {
          context.quadraticCurveTo(
            strokes.endpoints[offset + 2],
            strokes.endpoints[offset + 3],
            strokes.primitiveMeta[offset],
            strokes.primitiveMeta[offset + 1]
          );
        } else {
          context.lineTo(strokes.primitiveMeta[offset], strokes.primitiveMeta[offset + 1]);
        }
        context.lineWidth = lineWidth;
        context.lineCap = (styleFlags & DENSE_STYLE_FLAG_ROUND_CAP) !== 0 ? "round" : "butt";
        context.lineJoin = "miter";
        context.setLineDash([]);
        await this.strokeCurrentPath(
          context,
          paint,
          execution.state.transform,
          localTransform,
          `${execution.commandPath}.paintIndex`,
          primitiveAlpha
        );
      } finally {
        context.restore();
      }
    }
  }

  private async drawGlyphs(
    context: CanvasRenderingContext2D,
    execution: HeprDrawRunExecution
  ): Promise<void> {
    const command = execution.command;
    if (command.source !== "glyphs") return;
    const mode = command.renderingMode & 3;
    const fill = mode === 0 || mode === 2
      ? this.readOptionalPaint(command.fillPaintIndex, false, execution, "fillPaintIndex")
      : null;
    const stroke = mode === 1 || mode === 2
      ? this.readOptionalPaint(command.strokePaintIndex, false, execution, "strokePaintIndex")
      : null;
    if (mode === 3 || (!fill?.visible && !stroke?.visible)) return;
    const glyphs = this.page.stores.glyphs;
    for (let glyphIndex = command.first; glyphIndex < command.first + command.count; glyphIndex += 1) {
      this.options.signal?.throwIfAborted();
      if ((glyphs.flags[glyphIndex] & HEPR_GLYPH_FLAG.Invisible) !== 0) continue;
      if ((glyphs.flags[glyphIndex] & HEPR_GLYPH_FLAG.Type3) !== 0) {
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
          `Type3 glyph ${glyphIndex} must execute through its reusable CharProc program.`,
          `${execution.commandPath}.first`
        );
      }
      const recordIndex = findGlyphRecord(
        this.page,
        glyphs.fontIndices[glyphIndex],
        glyphs.glyphIds[glyphIndex]
      );
      if (recordIndex < 0) {
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
          `Visible glyph ${glyphIndex} has no derived outline.`,
          `${execution.commandPath}.first`
        );
      }
      const pathStart = this.page.stores.fonts.outlinePathStarts[recordIndex];
      const pathCount = this.page.stores.fonts.outlinePathCounts[recordIndex];
      if (pathCount === 0) continue;
      const glyphTransform = readTransform(this.page, glyphs.transformIndices[glyphIndex]);
      const transform = multiplyHeprMatrices(execution.state.transform, glyphTransform);
      const localTransform = multiplyHeprMatrices(
        readTransform(this.page, command.transformIndex),
        glyphTransform
      );
      const canvasTransform = multiplyHeprMatrices(this.deviceMatrix, transform);
      if (fill?.visible) {
        context.save();
        try {
          this.applyClips(context, execution.state.clips);
          setCanvasTransform(context, canvasTransform);
          context.beginPath();
          for (let pathIndex = pathStart; pathIndex < pathStart + pathCount; pathIndex += 1) {
            appendStoredPath(context, this.page, pathIndex);
          }
          await this.fillCurrentPath(
            context,
            fill,
            "nonzero",
            transform,
            localTransform,
            `${execution.commandPath}.fillPaintIndex`
          );
        } finally {
          context.restore();
        }
      }
      if (stroke?.visible) {
        context.save();
        try {
          this.applyClips(context, execution.state.clips);
          setCanvasTransform(context, canvasTransform);
          context.beginPath();
          for (let pathIndex = pathStart; pathIndex < pathStart + pathCount; pathIndex += 1) {
            appendStoredPath(context, this.page, pathIndex);
          }
          this.applyGenericStrokeStyle(
            context,
            command.strokeStyleIndex,
            canvasTransform,
            execution.commandPath
          );
          await this.strokeCurrentPath(
            context,
            stroke,
            transform,
            localTransform,
            `${execution.commandPath}.strokePaintIndex`
          );
        } finally {
          context.restore();
        }
      }
    }
  }

  private async fillCurrentPath(
    context: CanvasRenderingContext2D,
    paint: ResolvedPaint,
    fillRule: CanvasFillRule,
    ownerTransform: PdfMatrix,
    localTransform: PdfMatrix,
    path: string
  ): Promise<void> {
    if (paint.kind === "solid") {
      context.globalAlpha = paint.alpha;
      context.fillStyle = paint.css;
      context.fill(fillRule);
      return;
    }
    context.save();
    try {
      context.clip(fillRule);
      if (paint.kind === "gradient") {
        this.drawGradientResource(
          context,
          paint.gradientIndex,
          ownerTransform,
          paint.alpha,
          path
        );
      } else {
        const outerTransform = deriveOuterTransform(ownerTransform, localTransform, path);
        await this.drawPatternResource(context, paint, outerTransform, paint.alpha, path);
      }
    } finally {
      context.restore();
    }
  }

  private async strokeCurrentPath(
    context: CanvasRenderingContext2D,
    paint: ResolvedPaint,
    ownerTransform: PdfMatrix,
    localTransform: PdfMatrix,
    path: string,
    alphaMultiplier = 1
  ): Promise<void> {
    if (paint.kind === "solid") {
      context.globalAlpha = paint.alpha * alphaMultiplier;
      context.strokeStyle = paint.css;
      context.stroke();
      return;
    }
    if (paint.kind === "pattern") {
      if (paint.pattern.kind === "shading") {
        const metadata = this.readGradientMetadata(paint.pattern.gradientIndex, path);
        if (
          metadata.boundingBox !== null || metadata.background !== null ||
          (metadata.kind !== HEPR_GRADIENT_KIND.Axial &&
            metadata.kind !== HEPR_GRADIENT_KIND.Radial)
        ) {
          throw canvasError(
            HEPR_CANVAS_2D_ERROR_CODES.UnsupportedStroke,
            "Canvas2D supports shading-pattern strokes only for axial/radial shadings without BBox or Background metadata.",
            path
          );
        }
        const outerTransform = deriveOuterTransform(ownerTransform, localTransform, path);
        const currentToDevice = multiplyHeprMatrices(this.deviceMatrix, ownerTransform);
        const patternToDevice = multiplyHeprMatrices(
          multiplyHeprMatrices(this.deviceMatrix, outerTransform),
          paint.pattern.patternToOwnerTransform
        );
        context.strokeStyle = metadata.kind === HEPR_GRADIENT_KIND.Axial
          ? this.createAxialGradient(context, metadata, patternToDevice, path)
          : this.createRadialGradient(context, metadata, patternToDevice, path);
        setCanvasTransform(context, currentToDevice);
        context.globalAlpha = paint.alpha * alphaMultiplier;
        context.stroke();
        return;
      }
      const outerTransform = deriveOuterTransform(ownerTransform, localTransform, path);
      const currentToDevice = multiplyHeprMatrices(this.deviceMatrix, ownerTransform);
      const patternToDevice = multiplyHeprMatrices(
        multiplyHeprMatrices(this.deviceMatrix, outerTransform),
        paint.pattern.patternToOwnerTransform
      );
      const patternToCurrent = multiplyHeprMatrices(
        invertCanvasMatrix(currentToDevice, path),
        patternToDevice
      );
      context.strokeStyle = await this.createTilingCanvasPattern(
        context,
        paint,
        patternToCurrent,
        patternToDevice,
        path
      );
      context.globalAlpha = paint.alpha * alphaMultiplier;
      context.stroke();
      return;
    }
    const metadata = this.readGradientMetadata(paint.gradientIndex, path);
    if (
      metadata.boundingBox !== null || metadata.background !== null ||
      (metadata.kind !== HEPR_GRADIENT_KIND.Axial &&
        metadata.kind !== HEPR_GRADIENT_KIND.Radial)
    ) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedStroke,
        "Canvas2D supports gradient strokes only for axial/radial shadings without BBox or Background metadata.",
        path
      );
    }
    const localToDevice = multiplyHeprMatrices(this.deviceMatrix, ownerTransform);
    context.strokeStyle = metadata.kind === HEPR_GRADIENT_KIND.Axial
      ? this.createAxialGradient(context, metadata, localToDevice, path)
      : this.createRadialGradient(context, metadata, localToDevice, path);
    setCanvasTransform(context, localToDevice);
    context.globalAlpha = paint.alpha * alphaMultiplier;
    context.stroke();
  }

  private requireSolidResolvedPaint(paint: ResolvedPaint, path: string): SolidPaint {
    if (paint.kind === "solid") return paint;
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
      "Canvas2D cannot apply a procedural gradient directly through a stencil image mask.",
      path
    );
  }

  private async drawImages(
    context: CanvasRenderingContext2D,
    execution: HeprDrawRunExecution
  ): Promise<void> {
    const command = execution.command;
    if (command.source !== "images") return;
    const matrix = multiplyHeprMatrices(
      multiplyHeprMatrices(this.deviceMatrix, execution.state.transform),
      [1, 0, 0, -1, 0, 1]
    );
    for (let imageIndex = command.first; imageIndex < command.first + command.count; imageIndex += 1) {
      this.options.signal?.throwIfAborted();
      const imageMask = this.page.stores.images.imageMask[imageIndex] !== 0;
      const resolvedPaint = imageMask
        ? this.readRequiredPaint(command.paintIndex, execution, "paintIndex")
        : null;
      const paint = resolvedPaint === null
        ? null
        : this.requireSolidResolvedPaint(resolvedPaint, `${execution.commandPath}.paintIndex`);
      if (paint !== null && !paint.visible) continue;
      const cached = await this.getImageSurface(imageIndex, paint);
      context.save();
      try {
        this.applyClips(context, execution.state.clips);
        setCanvasTransform(context, matrix);
        context.imageSmoothingEnabled = this.page.stores.images.interpolate[imageIndex] !== 0;
        context.globalAlpha = 1;
        context.drawImage(cached.surface.canvas, 0, 0, 1, 1);
      } finally {
        context.restore();
      }
    }
  }

  private async drawPatternResource(
    context: CanvasRenderingContext2D,
    paint: PatternPaint,
    outerTransform: PdfMatrix,
    alpha: number,
    path: string
  ): Promise<void> {
    const patternToDevice = multiplyHeprMatrices(
      multiplyHeprMatrices(this.deviceMatrix, outerTransform),
      paint.pattern.patternToOwnerTransform
    );
    if (paint.pattern.kind === "shading") {
      this.drawGradientResource(
        context,
        paint.pattern.gradientIndex,
        multiplyHeprMatrices(outerTransform, paint.pattern.patternToOwnerTransform),
        alpha,
        path
      );
      return;
    }
    const canvasPattern = await this.createTilingCanvasPattern(
      context,
      paint,
      patternToDevice,
      patternToDevice,
      path
    );
    setCanvasTransform(context, IDENTITY);
    context.globalAlpha = alpha;
    context.fillStyle = canvasPattern;
    context.fillRect(0, 0, this.width, this.height);
  }

  private async createTilingCanvasPattern(
    context: CanvasRenderingContext2D,
    paint: PatternPaint,
    patternToCurrent: PdfMatrix,
    patternToDevice: PdfMatrix,
    path: string
  ): Promise<CanvasPattern> {
    if (paint.pattern.kind === "shading") {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        "A shading pattern cannot be materialized as a repeating CanvasPattern.",
        path
      );
    }
    const tile = await this.getPatternTile(paint, patternToDevice, path);
    let pattern: CanvasPattern | null;
    try {
      pattern = context.createPattern(tile.surface.canvas, "repeat");
    } catch (cause) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        `Canvas2D could not create pattern ${paint.pattern.patternIndex}.`,
        path,
        cause
      );
    }
    if (pattern === null || typeof pattern.setTransform !== "function") {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        "This Canvas2D implementation lacks CanvasPattern.setTransform().",
        path
      );
    }
    const pixelToPattern: PdfMatrix = [
      1 / tile.pixelsPerUnitX,
      0,
      0,
      -1 / tile.pixelsPerUnitY,
      tile.bounds[0],
      tile.bounds[3]
    ];
    const transform = multiplyHeprMatrices(patternToCurrent, pixelToPattern);
    try {
      pattern.setTransform({
        a: transform[0],
        b: transform[1],
        c: transform[2],
        d: transform[3],
        e: transform[4],
        f: transform[5]
      });
    } catch (cause) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        `Canvas2D rejected the transform for pattern ${paint.pattern.patternIndex}.`,
        path,
        cause
      );
    }
    return pattern;
  }

  private async getPatternTile(
    paint: PatternPaint,
    patternToDevice: PdfMatrix,
    path: string
  ): Promise<PatternTile> {
    const patternIndex = paint.pattern.patternIndex;
    if (this.patternRuntime.active.has(patternIndex)) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        `Pattern ${patternIndex} recursively invokes itself.`,
        path
      );
    }
    if (this.patternRuntime.depth >= this.options.maxPatternDepth) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit,
        `Pattern nesting exceeds limit ${this.options.maxPatternDepth}.`,
        path
      );
    }
    const key = [
      patternIndex,
      paint.pattern.basePaintIndex,
      ...patternToDevice.map((value) => canonicalMatrixValue(value))
    ].join(":");
    let pending = this.patternRuntime.cache.get(key);
    if (!pending) {
      pending = this.createPatternTile(paint, patternToDevice, path).catch((cause) => {
        this.patternRuntime.cache.delete(key);
        throw cause;
      });
      this.patternRuntime.cache.set(key, pending);
    }
    return await pending;
  }

  private async createPatternTile(
    paint: PatternPaint,
    patternToDevice: PdfMatrix,
    path: string
  ): Promise<PatternTile> {
    const patternIndex = paint.pattern.patternIndex;
    const patterns = this.page.stores.patterns;
    const xStep = patterns.xSteps[patternIndex];
    const yStep = patterns.ySteps[patternIndex];
    const tilingType = patterns.tilingTypes[patternIndex];
    const paintType = patterns.paintTypes[patternIndex];
    if (
      !Number.isFinite(xStep) || !Number.isFinite(yStep) || xStep === 0 || yStep === 0 ||
      (tilingType !== 1 && tilingType !== 2 && tilingType !== 3) ||
      (paintType !== 1 && paintType !== 2)
    ) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        `Pattern ${patternIndex} has invalid tiling metadata.`,
        path
      );
    }
    if (
      (paint.pattern.kind === "uncolored-tiling") !== (paintType === 2) ||
      (paint.pattern.kind === "colored-tiling") !== (paintType === 1)
    ) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        `Pattern ${patternIndex} has inconsistent PaintType metadata.`,
        path
      );
    }
    if (paintType === 2) {
      this.readSolidPaint(paint.pattern.basePaintIndex, `${path}.basePaintIndex`);
    }
    const scaleX = Math.hypot(patternToDevice[0], patternToDevice[1]);
    const scaleY = Math.hypot(patternToDevice[2], patternToDevice[3]);
    const determinant = patternToDevice[0] * patternToDevice[3] -
      patternToDevice[1] * patternToDevice[2];
    if (
      !(scaleX > 0) || !(scaleY > 0) ||
      !Number.isFinite(scaleX) || !Number.isFinite(scaleY) ||
      !Number.isFinite(determinant) || Math.abs(determinant) <= Number.EPSILON
    ) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        `Pattern ${patternIndex} has a singular device transform.`,
        path
      );
    }
    const tileBounds = [
      Math.min(0, xStep),
      Math.min(0, yStep),
      Math.max(0, xStep),
      Math.max(0, yStep)
    ] as const;
    const width = Math.max(1, Math.ceil(Math.abs(xStep) * scaleX));
    const height = Math.max(1, Math.ceil(Math.abs(yStep) * scaleY));
    const pixels = checkedPixels(width, height, `pattern ${patternIndex} tile`);
    if (
      pixels > this.options.maxCanvasPixels ||
      pixels > this.options.maxWorkingPixels ||
      pixels > this.options.maxPatternPixels - this.patternRuntime.pixels
    ) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit,
        `Pattern ${patternIndex} exceeds the offscreen pattern-pixel ceiling.`,
        path
      );
    }
    const boundsOffset = patternIndex * 4;
    const cellBounds = [
      patterns.bounds[boundsOffset],
      patterns.bounds[boundsOffset + 1],
      patterns.bounds[boundsOffset + 2],
      patterns.bounds[boundsOffset + 3]
    ] as const;
    const xCells = intersectingPatternCells(
      cellBounds[0], cellBounds[2], tileBounds[0], tileBounds[2], xStep
    );
    const yCells = intersectingPatternCells(
      cellBounds[1], cellBounds[3], tileBounds[1], tileBounds[3], yStep
    );
    const cellCount = checkedPatternCellCount(xCells.length, yCells.length, path);
    if (cellCount > this.options.maxPatternCells - this.patternRuntime.cells) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit,
        `Pattern ${patternIndex} exceeds the aggregate cell limit ${this.options.maxPatternCells}.`,
        path
      );
    }
    const surface = createSurface(
      this.options.surfaceFactory,
      width,
      height,
      `pattern ${patternIndex} tile`
    );
    clearSurface(surface);
    this.patternRuntime.active.add(patternIndex);
    this.patternRuntime.depth += 1;
    this.patternRuntime.cells += cellCount;
    this.patternRuntime.pixels += pixels;
    try {
      const synthetic = buildPatternCellPage(
        this.page,
        paint.pattern.programIndex,
        paintType === 2 ? paint.pattern.basePaintIndex : -1,
        xCells,
        yCells,
        xStep,
        yStep
      );
      const pixelsPerUnitX = width / Math.abs(xStep);
      const pixelsPerUnitY = height / Math.abs(yStep);
      const deviceMatrix: PdfMatrix = [
        pixelsPerUnitX,
        0,
        0,
        -pixelsPerUnitY,
        -tileBounds[0] * pixelsPerUnitX,
        tileBounds[3] * pixelsPerUnitY
      ];
      const childOptions = Object.freeze({ ...this.options, scale: 1, background: null });
      const backend = new HeprCanvas2dBackend(synthetic, surface, childOptions, {
        deviceMatrix,
        width,
        height,
        patternRuntime: this.patternRuntime,
        ownsPatternRuntime: false
      });
      try {
        await executeHeprDisplayProgram(synthetic, backend, { signal: this.options.signal });
      } finally {
        backend.dispose();
      }
      return {
        surface,
        bounds: tileBounds,
        pixelsPerUnitX,
        pixelsPerUnitY
      };
    } finally {
      this.patternRuntime.depth -= 1;
      this.patternRuntime.active.delete(patternIndex);
    }
  }

  private drawGradients(
    context: CanvasRenderingContext2D,
    execution: HeprDrawRunExecution
  ): void {
    const command = execution.command;
    if (command.source !== "gradients") return;
    for (
      let gradientIndex = command.first;
      gradientIndex < command.first + command.count;
      gradientIndex += 1
    ) {
      this.options.signal?.throwIfAborted();
      context.save();
      try {
        this.applyClips(context, execution.state.clips);
        this.drawGradientResource(
          context,
          gradientIndex,
          execution.state.transform,
          1,
          `${execution.commandPath}.first`
        );
      } finally {
        context.restore();
      }
    }
  }

  private drawMeshes(
    context: CanvasRenderingContext2D,
    execution: HeprDrawRunExecution
  ): void {
    const command = execution.command;
    if (command.source !== "meshes") return;
    for (let meshIndex = command.first; meshIndex < command.first + command.count; meshIndex += 1) {
      this.options.signal?.throwIfAborted();
      context.save();
      try {
        this.applyClips(context, execution.state.clips);
        this.drawTriangleMesh(
          context,
          meshIndex,
          execution.state.transform,
          1,
          [],
          `${execution.commandPath}.first`
        );
      } finally {
        context.restore();
      }
    }
  }

  private drawGradientResource(
    context: CanvasRenderingContext2D,
    gradientIndex: number,
    ownerTransform: PdfMatrix,
    alpha: number,
    path: string
  ): void {
    this.options.signal?.throwIfAborted();
    const metadata = this.readGradientMetadata(gradientIndex, path);
    const localToDevice = multiplyHeprMatrices(this.deviceMatrix, ownerTransform);
    context.save();
    try {
      if (metadata.boundingBox !== null) {
        setCanvasTransform(context, localToDevice);
        context.beginPath();
        context.rect(
          metadata.boundingBox[0],
          metadata.boundingBox[1],
          metadata.boundingBox[2] - metadata.boundingBox[0],
          metadata.boundingBox[3] - metadata.boundingBox[1]
        );
        context.clip("nonzero");
      }
      if (metadata.background !== null) {
        const background = this.convertColorToSrgb(
          metadata.colorSpaceIndex,
          metadata.background,
          `${path}.background`
        );
        setCanvasTransform(context, IDENTITY);
        context.globalAlpha = alpha;
        context.fillStyle = rgbCss(...background);
        context.fillRect(0, 0, this.width, this.height);
      }
      if (metadata.kind === HEPR_GRADIENT_KIND.Axial) {
        const gradient = this.createAxialGradient(context, metadata, localToDevice, path);
        const coverage = localCanvasBounds(localToDevice, this.width, this.height, path);
        setCanvasTransform(context, localToDevice);
        context.globalAlpha = alpha;
        context.fillStyle = gradient;
        context.fillRect(
          coverage[0],
          coverage[1],
          coverage[2] - coverage[0],
          coverage[3] - coverage[1]
        );
        return;
      }
      if (metadata.kind === HEPR_GRADIENT_KIND.Radial) {
        const gradient = this.createRadialGradient(context, metadata, localToDevice, path);
        const coverage = localCanvasBounds(localToDevice, this.width, this.height, path);
        setCanvasTransform(context, localToDevice);
        context.globalAlpha = alpha;
        context.fillStyle = gradient;
        context.fillRect(
          coverage[0],
          coverage[1],
          coverage[2] - coverage[0],
          coverage[3] - coverage[1]
        );
        return;
      }
      if (
        metadata.kind === HEPR_GRADIENT_KIND.FreeFormMesh ||
        metadata.kind === HEPR_GRADIENT_KIND.LatticeMesh
      ) {
        const meshIndex = this.page.stores.gradients.meshIndices[gradientIndex];
        this.drawTriangleMesh(
          context,
          meshIndex,
          ownerTransform,
          alpha,
          metadata.functionIndices,
          path
        );
        return;
      }
      if (
        metadata.kind === HEPR_GRADIENT_KIND.CoonsPatchMesh ||
        metadata.kind === HEPR_GRADIENT_KIND.TensorPatchMesh
      ) {
        this.drawPatchMesh(context, metadata, ownerTransform, alpha, path);
        return;
      }
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        "Canvas2D cannot represent a visible two-dimensional function shading without a procedural shader.",
        path
      );
    } finally {
      context.restore();
    }
  }

  private createAxialGradient(
    context: CanvasRenderingContext2D,
    metadata: GradientMetadata,
    localToDevice: PdfMatrix,
    path: string
  ): CanvasGradient {
    const [x0, y0, x1, y1] = metadata.coordinates;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lengthSquared = dx * dx + dy * dy;
    if (!(lengthSquared > 0) || !Number.isFinite(lengthSquared)) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        "Axial shading coordinates are degenerate.",
        path
      );
    }
    const inverse = invertCanvasMatrix(localToDevice, path);
    let minimum = 0;
    let maximum = 1;
    for (const [deviceX, deviceY] of deviceCorners(this.width, this.height)) {
      const [x, y] = transformCanvasPoint(inverse, deviceX, deviceY);
      const parameter = ((x - x0) * dx + (y - y0) * dy) / lengthSquared;
      minimum = Math.min(minimum, parameter);
      maximum = Math.max(maximum, parameter);
    }
    assertFiniteGradientExtent(minimum, maximum, path);
    const startX = x0 + dx * minimum;
    const startY = y0 + dy * minimum;
    const endX = x0 + dx * maximum;
    const endY = y0 + dy * maximum;
    setCanvasTransform(context, localToDevice);
    const gradient = context.createLinearGradient(startX, startY, endX, endY);
    this.appendCanvasGradientStops(
      gradient,
      this.gradientStops(metadata, path),
      minimum,
      maximum,
      metadata.extendStart,
      metadata.extendEnd,
      path
    );
    return gradient;
  }

  private createRadialGradient(
    context: CanvasRenderingContext2D,
    metadata: GradientMetadata,
    localToDevice: PdfMatrix,
    path: string
  ): CanvasGradient {
    const [x0, y0, r0, x1, y1, r1] = metadata.coordinates;
    let minimum = 0;
    let maximum = 1;
    const concentric = nearlyEqual(x0, x1) && nearlyEqual(y0, y1);
    if ((!metadata.extendStart || !metadata.extendEnd) && !concentric) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        "Canvas2D cannot exactly clip a non-concentric radial shading with a disabled extension.",
        path
      );
    }
    if (concentric) {
      const deltaRadius = r1 - r0;
      if (deltaRadius === 0) {
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
          "Radial shading circles are degenerate.",
          path
        );
      }
      const inverse = invertCanvasMatrix(localToDevice, path);
      let maximumRadius = Math.max(r0, r1);
      for (const [deviceX, deviceY] of deviceCorners(this.width, this.height)) {
        const [x, y] = transformCanvasPoint(inverse, deviceX, deviceY);
        maximumRadius = Math.max(maximumRadius, Math.hypot(x - x0, y - y0));
      }
      const zeroParameter = -r0 / deltaRadius;
      const coverageParameter = (maximumRadius - r0) / deltaRadius;
      if (deltaRadius > 0) {
        minimum = Math.min(0, zeroParameter);
        maximum = Math.max(1, coverageParameter);
      } else {
        minimum = Math.min(0, coverageParameter);
        maximum = Math.max(1, Math.min(zeroParameter, Math.max(coverageParameter, 1)));
      }
    }
    assertFiniteGradientExtent(minimum, maximum, path);
    const startRadius = r0 + (r1 - r0) * minimum;
    const endRadius = r0 + (r1 - r0) * maximum;
    if (startRadius < 0 || endRadius < 0) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        "Canvas2D cannot represent the radial shading extension without a negative circle radius.",
        path
      );
    }
    setCanvasTransform(context, localToDevice);
    let gradient: CanvasGradient;
    try {
      gradient = context.createRadialGradient(
        x0 + (x1 - x0) * minimum,
        y0 + (y1 - y0) * minimum,
        startRadius,
        x0 + (x1 - x0) * maximum,
        y0 + (y1 - y0) * maximum,
        endRadius
      );
    } catch (cause) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        "The Canvas2D implementation rejected the radial shading geometry.",
        path,
        cause
      );
    }
    this.appendCanvasGradientStops(
      gradient,
      this.gradientStops(metadata, path),
      minimum,
      maximum,
      metadata.extendStart,
      metadata.extendEnd,
      path
    );
    return gradient;
  }

  private appendCanvasGradientStops(
    gradient: CanvasGradient,
    stops: readonly GradientStop[],
    minimum: number,
    maximum: number,
    extendStart: boolean,
    extendEnd: boolean,
    path: string
  ): void {
    const extent = maximum - minimum;
    if (!(extent > 0)) {
      throw canvasError(HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint, "Gradient extent is empty.", path);
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    const start = clamp01((0 - minimum) / extent);
    const end = clamp01((1 - minimum) / extent);
    const append = (offset: number, stop: GradientStop): void => {
      try {
        gradient.addColorStop(clamp01(offset), rgbaCss(stop.rgb, stop.alpha));
      } catch (cause) {
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
          "The Canvas2D implementation rejected a generated shading stop.",
          path,
          cause
        );
      }
    };
    if (minimum < 0) {
      append(0, extendStart ? first : transparentStop(first));
      if (!extendStart) append(start, transparentStop(first));
    }
    for (const stop of stops) append((stop.offset - minimum) / extent, stop);
    if (maximum > 1) {
      if (!extendEnd) append(end, transparentStop(last));
      append(1, extendEnd ? last : transparentStop(last));
    }
  }

  private gradientStops(metadata: GradientMetadata, path: string): readonly GradientStop[] {
    const gradients = this.page.stores.gradients;
    const stopStart = gradients.stopOffsets[metadata.gradientIndex];
    const stopEnd = gradients.stopOffsets[metadata.gradientIndex + 1];
    if (stopEnd > stopStart) {
      if (stopEnd - stopStart > this.options.maxGradientStops) {
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit,
          `Gradient ${metadata.gradientIndex} exceeds the stop limit ${this.options.maxGradientStops}.`,
          path
        );
      }
      const stops: GradientStop[] = [];
      let previous = -Infinity;
      for (let index = stopStart; index < stopEnd; index += 1) {
        const offset = gradients.stopPositions[index];
        if (!Number.isFinite(offset) || offset < 0 || offset > 1 || offset < previous) {
          throw canvasError(
            HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
            `Gradient ${metadata.gradientIndex} has invalid ordered stop positions.`,
            path
          );
        }
        const paint = this.readSolidPaint(gradients.stopPaintIndices[index], path);
        stops.push({ offset, rgb: paint.rgb, alpha: paint.alpha });
        previous = offset;
      }
      if (stops[0].offset !== 0 || stops[stops.length - 1].offset !== 1) {
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
          `Gradient ${metadata.gradientIndex} stops must cover the normalized interval.`,
          path
        );
      }
      return stops;
    }
    if (metadata.domain === null || metadata.functionIndices.length === 0) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        `Gradient ${metadata.gradientIndex} has neither stops nor a callable function.`,
        path
      );
    }
    const cache = new Map<number, GradientStop>();
    const sample = (offset: number): GradientStop => {
      const cached = cache.get(offset);
      if (cached) return cached;
      if (cache.size >= this.options.maxGradientStops) {
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit,
          `Gradient ${metadata.gradientIndex} exceeds the adaptive stop limit ${this.options.maxGradientStops}.`,
          path
        );
      }
      const input = metadata.domain![0] + offset * (metadata.domain![1] - metadata.domain![0]);
      const components = this.evaluateFunctions(metadata.functionIndices, [input], path);
      const stop: GradientStop = {
        offset,
        rgb: this.convertColorToSrgb(metadata.colorSpaceIndex, components, path),
        alpha: 1
      };
      cache.set(offset, stop);
      return stop;
    };
    const output: GradientStop[] = [sample(0)];
    const subdivide = (low: GradientStop, high: GradientStop, depth: number): void => {
      this.options.signal?.throwIfAborted();
      const middleOffset = (low.offset + high.offset) / 2;
      const quarterOffset = (low.offset + middleOffset) / 2;
      const threeQuarterOffset = (middleOffset + high.offset) / 2;
      const middle = sample(middleOffset);
      const quarter = sample(quarterOffset);
      const threeQuarter = sample(threeQuarterOffset);
      const error = Math.max(
        stopInterpolationError(low, high, quarter, 0.25),
        stopInterpolationError(low, high, middle, 0.5),
        stopInterpolationError(low, high, threeQuarter, 0.75)
      );
      const needsMinimumSampling = depth < 2;
      if ((needsMinimumSampling || error > this.options.gradientColorTolerance) &&
          depth < this.options.maxGradientSubdivisionDepth) {
        subdivide(low, middle, depth + 1);
        subdivide(middle, high, depth + 1);
        return;
      }
      if (error > this.options.gradientColorTolerance) {
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit,
          `Gradient ${metadata.gradientIndex} cannot meet its color tolerance within the subdivision limit.`,
          path
        );
      }
      output.push(high);
    };
    subdivide(output[0], sample(1), 0);
    return output;
  }

  private readGradientMetadata(gradientIndex: number, path: string): GradientMetadata {
    const gradients = this.page.stores.gradients;
    const colors = this.page.stores.colors;
    const kind = gradients.kinds[gradientIndex];
    const flags = gradients.extendFlags[gradientIndex];
    if ((flags & ~KNOWN_SHADING_FLAGS) !== 0) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        `Gradient ${gradientIndex} has unknown shading flags ${flags & ~KNOWN_SHADING_FLAGS}.`,
        path
      );
    }
    const colorSpaceIndex = gradients.colorSpaceIndices[gradientIndex];
    const componentCount = colors.componentCounts[colorSpaceIndex];
    if (!Number.isSafeInteger(componentCount) || componentCount <= 0) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedColor,
        `Gradient ${gradientIndex} has an invalid color-space component count.`,
        path
      );
    }
    const payload = gradients.coordinates.subarray(
      gradients.coordinateOffsets[gradientIndex],
      gradients.coordinateOffsets[gradientIndex + 1]
    );
    let baseLength: number;
    let domain: readonly [number, number] | null = null;
    if (kind === HEPR_GRADIENT_KIND.Axial) {
      baseLength = 6;
      if (payload.length >= baseLength) domain = [payload[4], payload[5]];
    } else if (kind === HEPR_GRADIENT_KIND.Radial) {
      baseLength = 8;
      if (payload.length >= baseLength) domain = [payload[6], payload[7]];
    } else if (kind === HEPR_GRADIENT_KIND.Function) {
      baseLength = 10;
    } else if (
      kind === HEPR_GRADIENT_KIND.FreeFormMesh ||
      kind === HEPR_GRADIENT_KIND.LatticeMesh ||
      kind === HEPR_GRADIENT_KIND.CoonsPatchMesh ||
      kind === HEPR_GRADIENT_KIND.TensorPatchMesh
    ) {
      baseLength = 0;
    } else {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        `Gradient ${gradientIndex} has an unknown kind ${kind}.`,
        path
      );
    }
    if (payload.length < baseLength) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        `Gradient ${gradientIndex} has a truncated coordinate payload.`,
        path
      );
    }
    let cursor = baseLength;
    let functionIndices: number[];
    if ((flags & SHADING_FLAG_HAS_FUNCTION_ARRAY) !== 0) {
      if (gradients.functionIndices[gradientIndex] !== -1 || payload.length - cursor < componentCount) {
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
          `Gradient ${gradientIndex} has an invalid function-array sidecar.`,
          path
        );
      }
      functionIndices = Array.from(payload.subarray(cursor, cursor + componentCount));
      cursor += componentCount;
    } else {
      const functionIndex = gradients.functionIndices[gradientIndex];
      functionIndices = functionIndex >= 0 ? [functionIndex] : [];
    }
    for (const functionIndex of functionIndices) {
      if (
        !Number.isSafeInteger(functionIndex) ||
        functionIndex < 0 ||
        functionIndex >= this.page.stores.functions.kinds.length
      ) {
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
          `Gradient ${gradientIndex} references an invalid function.`,
          path
        );
      }
    }
    let boundingBox: readonly [number, number, number, number] | null = null;
    if ((flags & SHADING_FLAG_HAS_BOUNDING_BOX) !== 0) {
      if (payload.length - cursor < 4) {
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
          `Gradient ${gradientIndex} has a truncated bounding box.`,
          path
        );
      }
      const raw = [...payload.subarray(cursor, cursor + 4)] as [number, number, number, number];
      boundingBox = [
        Math.min(raw[0], raw[2]),
        Math.min(raw[1], raw[3]),
        Math.max(raw[0], raw[2]),
        Math.max(raw[1], raw[3])
      ];
      cursor += 4;
    }
    let background: readonly number[] | null = null;
    if ((flags & SHADING_FLAG_HAS_BACKGROUND) !== 0) {
      if (payload.length - cursor < componentCount) {
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
          `Gradient ${gradientIndex} has a truncated background color.`,
          path
        );
      }
      background = [...payload.subarray(cursor, cursor + componentCount)];
      cursor += componentCount;
    }
    if (cursor !== payload.length) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        `Gradient ${gradientIndex} has ambiguous trailing metadata.`,
        path
      );
    }
    if (domain !== null && !(domain[0] < domain[1])) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        `Gradient ${gradientIndex} has an invalid parameter domain.`,
        path
      );
    }
    return {
      gradientIndex,
      kind,
      colorSpaceIndex,
      componentCount,
      coordinates: payload.subarray(0, baseLength),
      domain,
      functionIndices,
      boundingBox,
      background,
      extendStart: (flags & SHADING_FLAG_EXTEND_START) !== 0,
      extendEnd: (flags & SHADING_FLAG_EXTEND_END) !== 0
    };
  }

  private drawTriangleMesh(
    context: CanvasRenderingContext2D,
    meshIndex: number,
    ownerTransform: PdfMatrix,
    alpha: number,
    functionIndices: readonly number[],
    path: string
  ): void {
    const meshes = this.page.stores.meshes;
    if (meshes.kinds[meshIndex] !== HEPR_MESH_KIND.Triangles) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        `Mesh ${meshIndex} is not an indexed triangle mesh.`,
        path
      );
    }
    const colorSpaceIndex = meshes.colorSpaceIndices[meshIndex];
    const componentCount = this.page.stores.colors.componentCounts[colorSpaceIndex];
    const vertexStart = meshes.vertexOffsets[meshIndex];
    const vertexEnd = meshes.vertexOffsets[meshIndex + 1];
    const indexStart = meshes.indexOffsets[meshIndex];
    const indexEnd = meshes.indexOffsets[meshIndex + 1];
    if ((indexEnd - indexStart) % 3 !== 0) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        `Mesh ${meshIndex} has an incomplete triangle index span.`,
        path
      );
    }
    const readVertex = (vertexIndex: number): MeshVertex => {
      if (vertexIndex < vertexStart || vertexIndex >= vertexEnd) {
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
          `Mesh ${meshIndex} has an out-of-range vertex index.`,
          path
        );
      }
      const positionOffset = vertexIndex * 2;
      const colorOffset = vertexIndex * 4;
      const functionInput = functionIndices.length > 0 ? meshes.colors[colorOffset] : null;
      const components = functionInput === null
        ? [...meshes.colors.subarray(colorOffset, colorOffset + componentCount)]
        : this.evaluateFunctions(functionIndices, [functionInput], path);
      return {
        x: meshes.positions[positionOffset],
        y: meshes.positions[positionOffset + 1],
        components,
        functionInput,
        rgb: this.convertColorToSrgb(colorSpaceIndex, components, path)
      };
    };
    setCanvasTransform(context, multiplyHeprMatrices(this.deviceMatrix, ownerTransform));
    context.globalAlpha = alpha;
    for (let index = indexStart; index < indexEnd; index += 3) {
      this.options.signal?.throwIfAborted();
      this.drawGouraudTriangle(
        context,
        [
          readVertex(meshes.indices[index]),
          readVertex(meshes.indices[index + 1]),
          readVertex(meshes.indices[index + 2])
        ],
        colorSpaceIndex,
        functionIndices,
        0,
        path
      );
    }
  }

  private drawPatchMesh(
    context: CanvasRenderingContext2D,
    metadata: GradientMetadata,
    ownerTransform: PdfMatrix,
    alpha: number,
    path: string
  ): void {
    const localToDevice = multiplyHeprMatrices(this.deviceMatrix, ownerTransform);
    const deviceScale = maximumMatrixScale(localToDevice);
    let tessellation: ReturnType<typeof tessellateHeprPatchMesh>;
    try {
      tessellation = tessellateHeprPatchMesh(this.page, metadata.gradientIndex, {
        flatness: this.options.patchFlatnessPixels / deviceScale,
        componentFlatness: this.options.gradientColorTolerance,
        maxDepth: Math.min(20, this.options.maxMeshSubdivisionDepth + 4),
        maxTriangles: this.options.maxMeshTriangles,
        maxOutputBytes: Math.min(
          256 * 1024 * 1024,
          Math.max(1_024, this.options.maxMeshTriangles * 80)
        ),
        maxSubdivisionNodes: Math.max(1, this.options.maxMeshTriangles * 2),
        maxFunctionEvaluations: Math.max(1, this.options.maxMeshTriangles * 2),
        signal: this.options.signal,
        evaluateFunction: metadata.functionIndices.length === 0
          ? undefined
          : (functionIndex, inputs) => this.evaluateFunctions([functionIndex], inputs, path)
      });
    } catch (cause) {
      if (cause instanceof HeprPatchTessellationError) {
        if (cause.code === "aborted") this.options.signal?.throwIfAborted();
        throw canvasError(
          cause.code === "resource-limit"
            ? HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit
            : HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
          `Patch gradient ${metadata.gradientIndex} could not be tessellated: ${cause.message}`,
          path,
          cause
        );
      }
      throw cause;
    }
    setCanvasTransform(context, localToDevice);
    context.globalAlpha = alpha;
    const componentCount = tessellation.componentCount;
    for (let triangle = 0; triangle < tessellation.positions.length / 6; triangle += 1) {
      this.options.signal?.throwIfAborted();
      const vertices: MeshVertex[] = [];
      for (let localVertex = 0; localVertex < 3; localVertex += 1) {
        const vertex = triangle * 3 + localVertex;
        const positionOffset = vertex * 2;
        const componentOffset = vertex * componentCount;
        const components = [...tessellation.components.subarray(
          componentOffset,
          componentOffset + componentCount
        )];
        const functionInput = tessellation.functionInputs.length > 0
          ? tessellation.functionInputs[vertex]
          : null;
        vertices.push({
          x: tessellation.positions[positionOffset],
          y: tessellation.positions[positionOffset + 1],
          components,
          functionInput,
          rgb: this.convertColorToSrgb(metadata.colorSpaceIndex, components, path)
        });
      }
      this.drawGouraudTriangle(
        context,
        vertices as [MeshVertex, MeshVertex, MeshVertex],
        metadata.colorSpaceIndex,
        metadata.functionIndices,
        0,
        path
      );
    }
  }

  private drawGouraudTriangle(
    context: CanvasRenderingContext2D,
    vertices: readonly [MeshVertex, MeshVertex, MeshVertex],
    colorSpaceIndex: number,
    functionIndices: readonly number[],
    depth: number,
    path: string
  ): void {
    this.options.signal?.throwIfAborted();
    const variation = triangleColorVariation(vertices);
    if (variation <= this.options.meshColorTolerance) {
      this.emitSolidTriangle(context, vertices, path);
      return;
    }
    if (depth >= this.options.maxMeshSubdivisionDepth) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit,
        "A mesh shading cannot meet its color tolerance within the subdivision-depth limit.",
        path
      );
    }
    const midpoint = (first: MeshVertex, second: MeshVertex): MeshVertex => {
      const functionInput = first.functionInput !== null && second.functionInput !== null
        ? (first.functionInput + second.functionInput) / 2
        : null;
      const components = functionInput === null
        ? first.components.map((value, index) => (value + second.components[index]) / 2)
        : this.evaluateFunctions(functionIndices, [functionInput], path);
      return {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
        components,
        functionInput,
        rgb: this.convertColorToSrgb(colorSpaceIndex, components, path)
      };
    };
    const ab = midpoint(vertices[0], vertices[1]);
    const bc = midpoint(vertices[1], vertices[2]);
    const ca = midpoint(vertices[2], vertices[0]);
    this.drawGouraudTriangle(context, [vertices[0], ab, ca], colorSpaceIndex, functionIndices, depth + 1, path);
    this.drawGouraudTriangle(context, [ab, vertices[1], bc], colorSpaceIndex, functionIndices, depth + 1, path);
    this.drawGouraudTriangle(context, [ca, bc, vertices[2]], colorSpaceIndex, functionIndices, depth + 1, path);
    this.drawGouraudTriangle(context, [ab, bc, ca], colorSpaceIndex, functionIndices, depth + 1, path);
  }

  private emitSolidTriangle(
    context: CanvasRenderingContext2D,
    vertices: readonly [MeshVertex, MeshVertex, MeshVertex],
    path: string
  ): void {
    this.emittedMeshTriangles += 1;
    if (this.emittedMeshTriangles > this.options.maxMeshTriangles) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit,
        `Mesh rendering exceeds the aggregate triangle limit ${this.options.maxMeshTriangles}.`,
        path
      );
    }
    const rgb: [number, number, number] = [0, 0, 0];
    for (const vertex of vertices) {
      rgb[0] += vertex.rgb[0] / 3;
      rgb[1] += vertex.rgb[1] / 3;
      rgb[2] += vertex.rgb[2] / 3;
    }
    context.beginPath();
    context.moveTo(vertices[0].x, vertices[0].y);
    context.lineTo(vertices[1].x, vertices[1].y);
    context.lineTo(vertices[2].x, vertices[2].y);
    context.closePath();
    context.fillStyle = rgbCss(...rgb);
    context.fill("nonzero");
  }

  private evaluateFunctions(
    functionIndices: readonly number[],
    inputs: readonly number[],
    path: string
  ): number[] {
    try {
      const evaluator = this.functionEvaluator ??= new HeprFunctionEvaluator(
        this.page.stores.functions
      );
      if (functionIndices.length === 1) {
        return [...evaluator.evaluate(functionIndices[0], inputs, { signal: this.options.signal })];
      }
      const values: number[] = [];
      for (const functionIndex of functionIndices) {
        const output = evaluator.evaluate(functionIndex, inputs, { signal: this.options.signal });
        if (output.length !== 1) {
          throw canvasError(
            HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
            "A shading function array child did not return exactly one component.",
            path
          );
        }
        values.push(output[0]);
      }
      return values;
    } catch (cause) {
      if (cause instanceof HeprCanvas2dError) throw cause;
      if (cause instanceof HeprFunctionEvaluationError) {
        if (cause.code === HEPR_FUNCTION_EVALUATION_CODES.Aborted) {
          this.options.signal?.throwIfAborted();
        }
        throw canvasError(
          cause.code === HEPR_FUNCTION_EVALUATION_CODES.ResourceLimit
            ? HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit
            : HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
          `A renderer-owned PDF function could not be evaluated: ${cause.message}`,
          path,
          cause
        );
      }
      throw cause;
    }
  }

  private applyClips(
    context: CanvasRenderingContext2D,
    clips: HeprExecutionClipScope | null
  ): void {
    for (const scope of collectHeprExecutionScopes(clips)) {
      if (scope.kind === "program-bounds") {
        setCanvasTransform(
          context,
          multiplyHeprMatrices(this.deviceMatrix, scope.outerTransform)
        );
        context.beginPath();
        context.rect(
          scope.bounds[0],
          scope.bounds[1],
          scope.bounds[2] - scope.bounds[0],
          scope.bounds[3] - scope.bounds[1]
        );
        context.clip("nonzero");
      } else {
        this.applyResourceClip(context, scope);
      }
    }
  }

  private applyResourceClip(
    context: CanvasRenderingContext2D,
    scope: Extract<HeprExecutionClipScope, { readonly kind: "resource" }>
  ): void {
    const chain: number[] = [];
    for (let index = scope.clipIndex; index >= 0; index = this.page.stores.clips.parentIndices[index]) {
      chain.push(index);
    }
    chain.reverse();
    for (const clipIndex of chain) {
      this.options.signal?.throwIfAborted();
      const clips = this.page.stores.clips;
      const localTransform = readTransform(this.page, clips.transformIndices[clipIndex]);
      const clipTransform = multiplyHeprMatrices(scope.outerTransform, localTransform);
      const firstPath = clips.firstPaths[clipIndex];
      const pathCount = clips.pathCounts[clipIndex];
      const firstGlyph = clips.firstGlyphs[clipIndex];
      const glyphCount = clips.glyphCounts[clipIndex];
      context.beginPath();
      if (pathCount > 0) {
        setCanvasTransform(
          context,
          multiplyHeprMatrices(this.deviceMatrix, clipTransform)
        );
        for (let pathIndex = firstPath; pathIndex < firstPath + pathCount; pathIndex += 1) {
          appendStoredPath(context, this.page, pathIndex);
        }
      } else if (glyphCount > 0) {
        for (let glyphIndex = firstGlyph; glyphIndex < firstGlyph + glyphCount; glyphIndex += 1) {
          this.appendGlyphClip(context, glyphIndex, clipTransform, clipIndex);
        }
      } else {
        setCanvasTransform(context, IDENTITY);
        context.rect(0, 0, 0, 0);
      }
      context.clip(clips.fillRules[clipIndex] === 1 ? "evenodd" : "nonzero");
    }
  }

  private appendGlyphClip(
    context: CanvasRenderingContext2D,
    glyphIndex: number,
    clipTransform: PdfMatrix,
    clipIndex: number
  ): void {
    const glyphs = this.page.stores.glyphs;
    if ((glyphs.flags[glyphIndex] & HEPR_GLYPH_FLAG.Type3) !== 0) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedClip,
        "Canvas2D cannot derive an exact clipping outline from a Type3 glyph.",
        `stores.clips[${clipIndex}]`
      );
    }
    const recordIndex = findGlyphRecord(
      this.page,
      glyphs.fontIndices[glyphIndex],
      glyphs.glyphIds[glyphIndex]
    );
    if (recordIndex < 0) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedClip,
        `Clipping glyph ${glyphIndex} has no outline.`,
        `stores.clips[${clipIndex}]`
      );
    }
    const glyphTransform = readTransform(this.page, glyphs.transformIndices[glyphIndex]);
    setCanvasTransform(
      context,
      multiplyHeprMatrices(
        this.deviceMatrix,
        multiplyHeprMatrices(clipTransform, glyphTransform)
      )
    );
    const start = this.page.stores.fonts.outlinePathStarts[recordIndex];
    const count = this.page.stores.fonts.outlinePathCounts[recordIndex];
    for (let pathIndex = start; pathIndex < start + count; pathIndex += 1) {
      appendStoredPath(context, this.page, pathIndex);
    }
  }

  private readOptionalPaint(
    paintIndex: number,
    inherited: boolean,
    execution: HeprDrawRunExecution,
    field: string
  ): ResolvedPaint | null {
    if (inherited) return this.readRequiredPaint(-1, execution, field);
    if (paintIndex < 0) return null;
    return this.readPaint(paintIndex, `${execution.commandPath}.${field}`);
  }

  private readRequiredPaint(
    paintIndex: number,
    execution: HeprDrawRunExecution,
    field: string
  ): ResolvedPaint {
    const resolved = paintIndex >= 0 ? paintIndex : execution.state.type3PaintIndex;
    if (resolved < 0) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        "A visible uncolored program has no inherited paint.",
        `${execution.commandPath}.${field}`
      );
    }
    return this.readPaint(resolved, `${execution.commandPath}.${field}`);
  }

  private readPaint(index: number, path: string): ResolvedPaint {
    const paints = this.page.stores.paints;
    const alpha = clamp01(paints.alphas[index]);
    const kind = paints.kinds[index];
    if (alpha !== 0 && paints.overprint[index] !== 0) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        "Canvas2D cannot exactly represent visible PDF overprint.",
        path
      );
    }
    if (kind === HEPR_PAINT_KIND.Gradient) {
      return {
        kind: "gradient",
        gradientIndex: paints.resourceIndices[index],
        alpha,
        visible: alpha !== 0,
        index
      };
    }
    if (kind === HEPR_PAINT_KIND.Pattern) {
      let pattern: Readonly<HeprResolvedPatternPaint> | null;
      try {
        pattern = resolveHeprPatternPaint(this.page, index);
      } catch (cause) {
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
          `Pattern paint ${index} could not be resolved from its self-contained stores.`,
          path,
          cause
        );
      }
      if (pattern === null) {
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
          `Paint ${index} does not resolve to a pattern resource.`,
          path
        );
      }
      return { kind: "pattern", pattern, alpha, visible: alpha !== 0, index };
    }
    if (kind !== HEPR_PAINT_KIND.SolidColor) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        `Canvas2D cannot use paint kind ${kind} without a tiling-pattern executor.`,
        path
      );
    }
    if (alpha === 0) {
      return {
        kind: "solid",
        css: "rgb(0, 0, 0)",
        rgb: [0, 0, 0],
        alpha: 0,
        visible: false,
        index
      };
    }
    const colorIndex = paints.resourceIndices[index];
    const rgb = this.readSimpleColor(colorIndex, path);
    return {
      kind: "solid",
      css: rgbCss(rgb[0], rgb[1], rgb[2]),
      rgb,
      alpha,
      visible: true,
      index
    };
  }

  private readSolidPaint(index: number, path: string): SolidPaint {
    const paint = this.readPaint(index, path);
    if (paint.kind !== "solid") {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
        "A gradient stop or stencil source must resolve to one static solid paint.",
        path
      );
    }
    return paint;
  }

  private readSimpleColor(index: number, path: string): readonly [number, number, number] {
    const colors = this.page.stores.colors;
    const parameters = colors.parameters.subarray(
      colors.parameterOffsets[index],
      colors.parameterOffsets[index + 1]
    );
    if (parameters.length === colors.componentCounts[index]) {
      return this.convertColorToSrgb(index, parameters, path);
    }
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.UnsupportedColor,
      `Canvas2D cannot resolve color resource ${index} to one static sRGB paint.`,
      path
    );
  }

  private convertColorToSrgb(
    index: number,
    components: ArrayLike<number>,
    path: string,
    active: ReadonlySet<number> = new Set(),
    depth = 0
  ): readonly [number, number, number] {
    this.options.signal?.throwIfAborted();
    const colors = this.page.stores.colors;
    if (depth >= 64 || active.has(index)) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedColor,
        "The page-native color-space graph is recursive or too deep.",
        path
      );
    }
    const componentCount = colors.componentCounts[index];
    const values = Array.from(components);
    if (values.length !== componentCount || values.some((value) => !Number.isFinite(value))) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedColor,
        `Color space ${index} received an invalid component vector.`,
        path
      );
    }
    const parameters = colors.parameters.subarray(
      colors.parameterOffsets[index],
      colors.parameterOffsets[index + 1]
    );
    let rgb: readonly [number, number, number];
    switch (colors.spaceKinds[index]) {
      case HEPR_COLOR_SPACE_KIND.DeviceGray: {
        const gray = clamp01(values[0]);
        rgb = [gray, gray, gray];
        break;
      }
      case HEPR_COLOR_SPACE_KIND.DeviceRgb:
        rgb = [clamp01(values[0]), clamp01(values[1]), clamp01(values[2])];
        break;
      case HEPR_COLOR_SPACE_KIND.DeviceCmyk: {
        const [cyan, magenta, yellow, black] = values.map(clamp01);
        rgb = convertDeviceCmykToSrgb(cyan, magenta, yellow, black);
        break;
      }
      case HEPR_COLOR_SPACE_KIND.CalGray: {
        if (parameters.length !== 7) return this.unsupportedColorMetadata(index, path);
        const gray = Math.pow(clamp01(values[0]), parameters[6]);
        rgb = xyzToSrgb(
          [parameters[0] * gray, parameters[1] * gray, parameters[2] * gray],
          parameters.subarray(0, 3)
        );
        break;
      }
      case HEPR_COLOR_SPACE_KIND.CalRgb: {
        if (parameters.length !== 18) return this.unsupportedColorMetadata(index, path);
        const first = Math.pow(clamp01(values[0]), parameters[6]);
        const second = Math.pow(clamp01(values[1]), parameters[7]);
        const third = Math.pow(clamp01(values[2]), parameters[8]);
        const matrix = parameters.subarray(9, 18);
        rgb = xyzToSrgb([
          matrix[0] * first + matrix[3] * second + matrix[6] * third,
          matrix[1] * first + matrix[4] * second + matrix[7] * third,
          matrix[2] * first + matrix[5] * second + matrix[8] * third
        ], parameters.subarray(0, 3));
        break;
      }
      case HEPR_COLOR_SPACE_KIND.Lab: {
        if (parameters.length !== 10) return this.unsupportedColorMetadata(index, path);
        const lightness = clampRange(values[0], 0, 100);
        const first = clampRange(values[1], parameters[6], parameters[7]);
        const second = clampRange(values[2], parameters[8], parameters[9]);
        const middle = (lightness + 16) / 116;
        rgb = xyzToSrgb([
          parameters[0] * labInverse(middle + first / 500),
          parameters[1] * labInverse(middle),
          parameters[2] * labInverse(middle - second / 200)
        ], parameters.subarray(0, 3));
        break;
      }
      case HEPR_COLOR_SPACE_KIND.IccBased:
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.UnsupportedColor,
          "ICCBased shading conversion requires the pinned renderer qcms kernel.",
          path
        );
      case HEPR_COLOR_SPACE_KIND.Indexed: {
        if (parameters.length !== 1) return this.unsupportedColorMetadata(index, path);
        const alternate = colors.alternateSpaceIndices[index];
        const alternateCount = colors.componentCounts[alternate];
        const highValue = Math.trunc(parameters[0]);
        const item = Math.round(clampRange(values[0], 0, highValue));
        const lookupStart = colors.lookupOffsets[index] + item * alternateCount;
        const lookupEnd = lookupStart + alternateCount;
        if (lookupEnd > colors.lookupOffsets[index + 1]) {
          return this.unsupportedColorMetadata(index, path);
        }
        const alternateValues = Array.from(
          colors.lookupBytes.subarray(lookupStart, lookupEnd),
          (entry, component) => {
            const [low, high] = defaultColorDecode(colors, alternate, component);
            return low + (entry / 255) * (high - low);
          }
        );
        const next = new Set(active);
        next.add(index);
        return this.convertColorToSrgb(alternate, alternateValues, path, next, depth + 1);
      }
      case HEPR_COLOR_SPACE_KIND.Separation:
      case HEPR_COLOR_SPACE_KIND.DeviceN: {
        const names = colors.names.slice(colors.nameOffsets[index], colors.nameOffsets[index + 1]);
        if (
          (colors.spaceKinds[index] === HEPR_COLOR_SPACE_KIND.Separation &&
            (names[0] === "All" || names[0] === "None")) ||
          (colors.spaceKinds[index] === HEPR_COLOR_SPACE_KIND.DeviceN &&
            names.every((name) => name === "None"))
        ) {
          throw canvasError(
            HEPR_CANVAS_2D_ERROR_CODES.UnsupportedColor,
            "A special all/none colorant has no backdrop-independent sRGB value.",
            path
          );
        }
        const alternate = colors.alternateSpaceIndices[index];
        const transformed = this.evaluateFunctions(
          [colors.functionIndices[index]],
          values.map(clamp01),
          path
        );
        const next = new Set(active);
        next.add(index);
        return this.convertColorToSrgb(alternate, transformed, path, next, depth + 1);
      }
      default:
        throw canvasError(
          HEPR_CANVAS_2D_ERROR_CODES.UnsupportedColor,
          `Canvas2D cannot convert color-space kind ${colors.spaceKinds[index]}.`,
          path
        );
    }
    return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
  }

  private unsupportedColorMetadata(index: number, path: string): never {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.UnsupportedColor,
      `Color space ${index} has invalid self-contained conversion metadata.`,
      path
    );
  }

  private applyGenericStrokeStyle(
    context: CanvasRenderingContext2D,
    index: number,
    canvasTransform: PdfMatrix,
    path: string
  ): void {
    const strokes = this.page.stores.strokes;
    if ((strokes.flags[index] & HEPR_STROKE_FLAG.StrokeAdjust) !== 0) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedStroke,
        "Canvas2D cannot exactly represent PDF stroke adjustment.",
        `${path}.strokeStyleIndex`
      );
    }
    const hairline = (strokes.flags[index] & HEPR_STROKE_FLAG.Hairline) !== 0 ||
      strokes.lineWidths[index] === 0;
    context.lineWidth = hairline
      ? hairlineWidth(canvasTransform, `${path}.strokeStyleIndex`)
      : strokes.lineWidths[index];
    context.miterLimit = strokes.miterLimits[index];
    context.lineCap = lineCap(strokes.lineCaps[index]);
    context.lineJoin = lineJoin(strokes.lineJoins[index]);
    const dashStart = strokes.dashOffsets[index];
    const dashEnd = strokes.dashOffsets[index + 1];
    context.setLineDash([...strokes.dashValues.subarray(dashStart, dashEnd)]);
    context.lineDashOffset = strokes.dashPhases[index];
  }

  private async getImageSurface(
    imageIndex: number,
    paint: SolidPaint | null
  ): Promise<CachedImage> {
    // Inherited stencil paints may share an index but differ in actual color.
    const key = `${imageIndex}:${paint ? `${paint.rgb.join(",")}:${paint.alpha}` : "none"}`;
    let pending = this.imageCache.get(key);
    if (!pending) {
      const shared = this.sharedImages?.get(key);
      if (shared) {
        assertPixelLimit(shared.surface.canvas.width, shared.surface.canvas.height,
          this.options.maxCanvasPixels, `image ${imageIndex}`);
        if (this.timings) this.timings.imageSurfaceHits += 1;
        pending = Promise.resolve(shared);
      } else pending = this.createImageSurface(imageIndex, paint).then((image) => {
        if (this.sharedImages?.add(key, image)) this.releasePixels(image.accountedPixels);
        return image;
      }).catch((error) => {
        this.imageCache.delete(key);
        throw error;
      });
      this.imageCache.set(key, pending);
    }
    return await pending;
  }

  private async createImageSurface(
    imageIndex: number,
    paint: SolidPaint | null
  ): Promise<CachedImage> {
    const startedAt = this.timings ? performance.now() : 0;
    const image = await this.decodeImage(imageIndex, paint, new Set<number>());
    const cached = this.allocateSurface(`image ${imageIndex}`, image.width, image.height);
    try {
      const imageData = cached.surface.context.createImageData(image.width, image.height);
      imageData.data.set(image.rgba);
      cached.surface.context.putImageData(imageData, 0, 0);
      if (this.timings) {
        this.timings.imageSurfaceMs += performance.now() - startedAt;
        this.timings.imageSurfaces += 1;
        this.timings.imageSurfacePixels += image.width * image.height;
      }
      return cached;
    } catch (cause) {
      this.releasePixels(cached.accountedPixels);
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedImage,
        `Canvas2D could not materialize image ${imageIndex}.`,
        `stores.images.dataOffsets[${imageIndex}]`,
        cause
      );
    }
  }

  private async decodeImage(
    imageIndex: number,
    paint: SolidPaint | null,
    active: Set<number>
  ): Promise<RgbaImage> {
    this.options.signal?.throwIfAborted();
    if (active.has(imageIndex)) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedImage,
        "Canvas2D encountered a cyclic image-mask graph.",
        `stores.images.softMaskImageIndices[${imageIndex}]`
      );
    }
    active.add(imageIndex);
    try {
      const images = this.page.stores.images;
      const width = images.widths[imageIndex];
      const height = images.heights[imageIndex];
      assertPixelLimit(width, height, this.options.maxCanvasPixels, `image ${imageIndex}`);
      const data = images.data.subarray(
        images.dataOffsets[imageIndex],
        images.dataOffsets[imageIndex + 1]
      );
      let rgba = await this.decodeImagePayload(imageIndex, width, height, data);
      if (images.imageMask[imageIndex] !== 0) {
        if (paint === null) {
          // Mask resources consumed by another image need only their coverage.
          for (let offset = 0; offset < rgba.length; offset += 4) {
            rgba[offset + 3] = rgba[offset];
            rgba[offset] = 255;
            rgba[offset + 1] = 255;
            rgba[offset + 2] = 255;
          }
        } else {
          for (let offset = 0; offset < rgba.length; offset += 4) {
            const coverage = rgba[offset] / 255;
            rgba[offset] = Math.round(paint.rgb[0] * 255);
            rgba[offset + 1] = Math.round(paint.rgb[1] * 255);
            rgba[offset + 2] = Math.round(paint.rgb[2] * 255);
            rgba[offset + 3] = Math.round(coverage * paint.alpha * 255);
          }
        }
      }

      const maskIndex = images.softMaskImageIndices[imageIndex];
      if (maskIndex >= 0) {
        const mask = await this.decodeImage(maskIndex, null, active);
        this.applyImageMask(imageIndex, rgba, width, height, mask, maskIndex);
      }
      return { width, height, rgba };
    } finally {
      active.delete(imageIndex);
    }
  }

  private async decodeImagePayload(
    imageIndex: number,
    width: number,
    height: number,
    data: Uint8Array
  ): Promise<Uint8ClampedArray> {
    const images = this.page.stores.images;
    const pixelCount = width * height;
    const output = new Uint8ClampedArray(pixelCount * 4);
    switch (images.formats[imageIndex]) {
      case HEPR_IMAGE_FORMAT.Rgba8:
        requireByteLength(data, pixelCount * 4, imageIndex);
        output.set(data);
        return output;
      case HEPR_IMAGE_FORMAT.Gray8:
        requireByteLength(data, pixelCount, imageIndex);
        for (let pixel = 0; pixel < pixelCount; pixel += 1) {
          if ((pixel & 0x3fff) === 0) this.options.signal?.throwIfAborted();
          const value = data[pixel];
          const offset = pixel * 4;
          output[offset] = value;
          output[offset + 1] = value;
          output[offset + 2] = value;
          output[offset + 3] = 255;
        }
        return output;
      case HEPR_IMAGE_FORMAT.GrayAlpha8:
        requireByteLength(data, pixelCount * 2, imageIndex);
        for (let pixel = 0; pixel < pixelCount; pixel += 1) {
          if ((pixel & 0x3fff) === 0) this.options.signal?.throwIfAborted();
          const source = pixel * 2;
          const target = pixel * 4;
          output[target] = data[source];
          output[target + 1] = data[source];
          output[target + 2] = data[source];
          output[target + 3] = data[source + 1];
        }
        return output;
      case HEPR_IMAGE_FORMAT.Rgba16: {
        requireByteLength(data, pixelCount * 8, imageIndex);
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        for (let pixel = 0; pixel < pixelCount; pixel += 1) {
          if ((pixel & 0x3fff) === 0) this.options.signal?.throwIfAborted();
          const source = pixel * 8;
          const target = pixel * 4;
          for (let component = 0; component < 4; component += 1) {
            output[target + component] = Math.round(view.getUint16(source + component * 2, false) / 257);
          }
        }
        return output;
      }
      default:
        return await this.decodeEncodedImage(imageIndex, width, height, data);
    }
  }

  private async decodeEncodedImage(
    imageIndex: number,
    width: number,
    height: number,
    data: Uint8Array
  ): Promise<Uint8ClampedArray> {
    const decoder = this.options.imageDecoder;
    if (!decoder) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedImage,
        `Encoded image ${imageIndex} requires a caller-provided codec decoder.`,
        `stores.images.formats[${imageIndex}]`
      );
    }
    const images = this.page.stores.images;
    let decoded: HeprCanvas2dDecodedImage;
    try {
      decoded = await decoder({
        imageIndex,
        format: images.formats[imageIndex],
        width,
        height,
        bitsPerComponent: images.bitsPerComponent[imageIndex],
        colorSpaceIndex: images.colorSpaceIndices[imageIndex],
        interpolate: images.interpolate[imageIndex] !== 0,
        data,
        decode: images.decodeValues.subarray(
          images.decodeOffsets[imageIndex],
          images.decodeOffsets[imageIndex + 1]
        ),
        colorKeyMask: images.colorKeyMaskValues.subarray(
          images.colorKeyMaskOffsets[imageIndex],
          images.colorKeyMaskOffsets[imageIndex + 1]
        )
      }, this.options.signal);
    } catch (cause) {
      if (this.options.signal?.aborted) this.options.signal.throwIfAborted();
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedImage,
        `The image decoder rejected image ${imageIndex}.`,
        `stores.images.formats[${imageIndex}]`,
        cause
      );
    }
    if (
      decoded.width !== width || decoded.height !== height ||
      !(decoded.rgba instanceof Uint8Array || decoded.rgba instanceof Uint8ClampedArray) ||
      decoded.rgba.length !== width * height * 4
    ) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.UnsupportedImage,
        `The image decoder returned invalid RGBA data for image ${imageIndex}.`,
        `stores.images.formats[${imageIndex}]`
      );
    }
    return new Uint8ClampedArray(
      decoded.rgba.buffer,
      decoded.rgba.byteOffset,
      decoded.rgba.byteLength
    ).slice();
  }

  private applyImageMask(
    imageIndex: number,
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    mask: RgbaImage,
    maskIndex: number
  ): void {
    const images = this.page.stores.images;
    const interpolateMask = images.interpolate[maskIndex] !== 0;
    const matte = images.matteValues.subarray(
      images.matteOffsets[imageIndex],
      images.matteOffsets[imageIndex + 1]
    );
    const matteRgb = matte.length === 0
      ? null
      : this.convertMatte(imageIndex, matte);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        if ((pixel & 0x3fff) === 0) this.options.signal?.throwIfAborted();
        const factor = sampleMask(mask, x, y, width, height, interpolateMask);
        const offset = pixel * 4;
        if (matteRgb && factor > 0) {
          for (let component = 0; component < 3; component += 1) {
            const color = rgba[offset + component] / 255;
            rgba[offset + component] = Math.round(clamp01(
              (color - matteRgb[component] * (1 - factor)) / factor
            ) * 255);
          }
        } else if (matteRgb && factor === 0) {
          rgba[offset] = 0;
          rgba[offset + 1] = 0;
          rgba[offset + 2] = 0;
        }
        rgba[offset + 3] = Math.round(rgba[offset + 3] * factor);
      }
    }
  }

  private convertMatte(
    imageIndex: number,
    matte: Float32Array
  ): readonly [number, number, number] {
    const colorIndex = this.page.stores.images.colorSpaceIndices[imageIndex];
    const kind = colorIndex >= 0 ? this.page.stores.colors.spaceKinds[colorIndex] : -1;
    if (kind === HEPR_COLOR_SPACE_KIND.DeviceGray && matte.length === 1) {
      const gray = clamp01(matte[0]);
      return [gray, gray, gray];
    }
    if (kind === HEPR_COLOR_SPACE_KIND.DeviceRgb && matte.length === 3) {
      return [clamp01(matte[0]), clamp01(matte[1]), clamp01(matte[2])];
    }
    if (kind === HEPR_COLOR_SPACE_KIND.DeviceCmyk && matte.length === 4) {
      const c = clamp01(matte[0]);
      const m = clamp01(matte[1]);
      const y = clamp01(matte[2]);
      const k = clamp01(matte[3]);
      return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
    }
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.UnsupportedImage,
      `Canvas2D cannot remove the matte from image ${imageIndex} in its managed color space.`,
      `stores.images.matteOffsets[${imageIndex}]`
    );
  }

  private allocateSurface(
    label: string,
    width = this.width,
    height = this.height
  ): CachedImage {
    const pixels = checkedPixels(width, height, label);
    this.sharedImages?.trimUnused(this.options.maxWorkingPixels - this.liveWorkingPixels - pixels);
    if (pixels > this.options.maxWorkingPixels - this.liveWorkingPixels -
        (this.sharedImages?.pixelCount ?? 0)) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit,
        `${label} exceeds the Canvas2D aggregate working-pixel limit ${this.options.maxWorkingPixels}.`
      );
    }
    const surface = createSurface(this.options.surfaceFactory, width, height, label);
    clearSurface(surface);
    this.liveWorkingPixels += pixels;
    return { surface, accountedPixels: pixels };
  }

  private releasePixels(pixels: number): void {
    this.liveWorkingPixels = Math.max(0, this.liveWorkingPixels - pixels);
  }

  private releaseMask(executionId: number | null): void {
    if (executionId === null) return;
    const mask = this.masks.get(executionId);
    if (mask === undefined) return;
    this.masks.delete(executionId);
    this.releasePixels(mask.accountedPixels);
  }

  private currentFrame(): GroupFrame {
    const frame = this.frames[this.frames.length - 1];
    if (!frame) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.InvalidSurface,
        "Canvas2D received a draw outside a composite group."
      );
    }
    return frame;
  }

  private assertUsable(): void {
    if (this.disposed || this.rootCompleted) {
      throw canvasError(
        HEPR_CANVAS_2D_ERROR_CODES.InvalidSurface,
        "The Canvas2D backend cannot be reused after completion or disposal."
      );
    }
  }
}

function resolveOptions(options: HeprCanvas2dBackendOptions): ResolvedBackendOptions {
  if (typeof options !== "object" || options === null) {
    throw canvasError(HEPR_CANVAS_2D_ERROR_CODES.InvalidOptions, "Canvas2D options are required.");
  }
  if (typeof options.surfaceFactory !== "function") {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.InvalidOptions,
      "Canvas2D rendering requires a surfaceFactory."
    );
  }
  return Object.freeze({
    scale: finitePositive(options.scale ?? 1, "Canvas2D scale"),
    background: normalizeBackground(options.background ?? null),
    surfaceFactory: options.surfaceFactory,
    imageDecoder: options.imageDecoder,
    signal: options.signal,
    maxCanvasPixels: positiveSafeInteger(
      options.maxCanvasPixels ?? DEFAULT_MAX_CANVAS_PIXELS,
      "maxCanvasPixels"
    ),
    maxWorkingPixels: positiveSafeInteger(
      options.maxWorkingPixels ?? DEFAULT_MAX_WORKING_PIXELS,
      "maxWorkingPixels"
    ),
    maxGradientStops: positiveSafeInteger(
      options.maxGradientStops ?? DEFAULT_MAX_GRADIENT_STOPS,
      "maxGradientStops"
    ),
    maxGradientSubdivisionDepth: nonnegativeInteger(
      options.maxGradientSubdivisionDepth ?? DEFAULT_MAX_GRADIENT_SUBDIVISION_DEPTH,
      20,
      "maxGradientSubdivisionDepth"
    ),
    gradientColorTolerance: unitTolerance(
      options.gradientColorTolerance ?? DEFAULT_GRADIENT_COLOR_TOLERANCE,
      "gradientColorTolerance"
    ),
    maxMeshTriangles: positiveSafeInteger(
      options.maxMeshTriangles ?? DEFAULT_MAX_MESH_TRIANGLES,
      "maxMeshTriangles"
    ),
    maxMeshSubdivisionDepth: nonnegativeInteger(
      options.maxMeshSubdivisionDepth ?? DEFAULT_MAX_MESH_SUBDIVISION_DEPTH,
      20,
      "maxMeshSubdivisionDepth"
    ),
    meshColorTolerance: unitTolerance(
      options.meshColorTolerance ?? DEFAULT_MESH_COLOR_TOLERANCE,
      "meshColorTolerance"
    ),
    patchFlatnessPixels: finitePositive(
      options.patchFlatnessPixels ?? DEFAULT_PATCH_FLATNESS_PIXELS,
      "patchFlatnessPixels"
    ),
    maxPatternDepth: nonnegativeInteger(
      options.maxPatternDepth ?? DEFAULT_MAX_PATTERN_DEPTH,
      64,
      "maxPatternDepth"
    ),
    maxPatternCells: positiveSafeInteger(
      options.maxPatternCells ?? DEFAULT_MAX_PATTERN_CELLS,
      "maxPatternCells"
    ),
    maxPatternPixels: positiveSafeInteger(
      options.maxPatternPixels ?? DEFAULT_MAX_PATTERN_PIXELS,
      "maxPatternPixels"
    )
  });
}

function isResolvedOptions(
  options: HeprCanvas2dBackendOptions | ResolvedBackendOptions
): options is ResolvedBackendOptions {
  return Object.isFrozen(options) &&
    typeof options.scale === "number" &&
    typeof options.maxWorkingPixels === "number" &&
    typeof options.maxGradientStops === "number" &&
    typeof options.maxMeshTriangles === "number";
}

function normalizeBackground(
  value: readonly [number, number, number, number] | null
): readonly [number, number, number, number] | null {
  if (value === null) return null;
  if (value.length !== 4 || value.some((component) => !Number.isFinite(component))) {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.InvalidOptions,
      "Canvas2D background must contain four finite components."
    );
  }
  return Object.freeze(value.map(clamp01) as [number, number, number, number]);
}

function createSurface(
  factory: HeprCanvas2dSurfaceFactory,
  width: number,
  height: number,
  label: string
): HeprCanvas2dSurface {
  let surface: HeprCanvas2dSurface;
  try {
    surface = factory(width, height);
  } catch (cause) {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.InvalidSurface,
      `The Canvas2D surface factory failed for ${label}.`,
      undefined,
      cause
    );
  }
  assertSurface(surface, width, height, label);
  return surface;
}

function assertSurface(
  surface: HeprCanvas2dSurface,
  width: number,
  height: number,
  label: string
): void {
  const context = surface?.context;
  if (
    typeof surface !== "object" || surface === null ||
    typeof surface.canvas !== "object" || surface.canvas === null ||
    surface.canvas.width !== width || surface.canvas.height !== height ||
    typeof context !== "object" || context === null ||
    typeof context.save !== "function" || typeof context.restore !== "function" ||
    typeof context.setTransform !== "function" || typeof context.drawImage !== "function" ||
    typeof context.getImageData !== "function" || typeof context.putImageData !== "function"
  ) {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.InvalidSurface,
      `The ${label} surface is not an exact ${width}x${height} Canvas2D target.`
    );
  }
}

function clearSurface(surface: HeprCanvas2dSurface): void {
  const context = surface.context;
  context.save();
  try {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "copy";
    context.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
  } finally {
    context.restore();
  }
}

function appendStoredPath(
  context: CanvasRenderingContext2D,
  page: HeprPageData,
  pathIndex: number
): void {
  visitHeprPath(page.stores.paths, pathIndex, {
    moveTo: (x, y) => context.moveTo(x, y),
    lineTo: (x, y) => context.lineTo(x, y),
    quadraticTo: (controlX, controlY, x, y) =>
      context.quadraticCurveTo(controlX, controlY, x, y),
    cubicTo: (control1X, control1Y, control2X, control2Y, x, y) =>
      context.bezierCurveTo(control1X, control1Y, control2X, control2Y, x, y),
    close: () => context.closePath()
  });
}

function appendDenseFillPath(
  context: CanvasRenderingContext2D,
  page: HeprPageData,
  pathIndex: number
): void {
  const paths = page.stores.paths;
  const metaOffset = pathIndex * 4;
  const first = Math.trunc(paths.fillPathMetaA[metaOffset]);
  const count = Math.trunc(paths.fillPathMetaA[metaOffset + 1]);
  let currentX = Number.NaN;
  let currentY = Number.NaN;
  let subpathX = Number.NaN;
  let subpathY = Number.NaN;
  for (let index = first; index < first + count; index += 1) {
    const offset = index * 4;
    const startX = paths.fillSegmentsA[offset];
    const startY = paths.fillSegmentsA[offset + 1];
    if (startX !== currentX || startY !== currentY) {
      context.moveTo(startX, startY);
      subpathX = startX;
      subpathY = startY;
    }
    const endX = paths.fillSegmentsB[offset];
    const endY = paths.fillSegmentsB[offset + 1];
    if (paths.fillSegmentsB[offset + 2] >= 0.5) {
      context.quadraticCurveTo(
        paths.fillSegmentsA[offset + 2],
        paths.fillSegmentsA[offset + 3],
        endX,
        endY
      );
    } else {
      context.lineTo(endX, endY);
    }
    currentX = endX;
    currentY = endY;
    if (currentX === subpathX && currentY === subpathY) {
      context.closePath();
      currentX = Number.NaN;
      currentY = Number.NaN;
    }
  }
}

function readTransform(page: HeprPageData, index: number): PdfMatrix {
  const values = page.stores.transforms.values;
  const offset = index * 6;
  return [
    values[offset], values[offset + 1], values[offset + 2],
    values[offset + 3], values[offset + 4], values[offset + 5]
  ];
}

function findGlyphRecord(page: HeprPageData, fontIndex: number, glyphId: number): number {
  const fonts = page.stores.fonts;
  let low = fonts.glyphOffsets[fontIndex];
  let high = fonts.glyphOffsets[fontIndex + 1];
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if (fonts.glyphIds[middle] < glyphId) low = middle + 1;
    else high = middle;
  }
  return low < fonts.glyphOffsets[fontIndex + 1] && fonts.glyphIds[low] === glyphId
    ? low
    : -1;
}

function setCanvasTransform(context: CanvasRenderingContext2D, matrix: PdfMatrix): void {
  context.setTransform(...matrix);
}

function hairlineWidth(matrix: PdfMatrix, path: string): number {
  const firstScale = Math.hypot(matrix[0], matrix[1]);
  const secondScale = Math.hypot(matrix[2], matrix[3]);
  const dot = matrix[0] * matrix[2] + matrix[1] * matrix[3];
  const tolerance = 1e-6 * Math.max(1, firstScale * secondScale);
  if (
    !(firstScale > 0) || !(secondScale > 0) ||
    Math.abs(firstScale - secondScale) > 1e-6 * Math.max(firstScale, secondScale) ||
    Math.abs(dot) > tolerance
  ) {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.UnsupportedStroke,
      "Canvas2D cannot make a device-pixel hairline exact under a non-similarity transform.",
      path
    );
  }
  return 1 / firstScale;
}

function lineCap(value: number): CanvasLineCap {
  if (value === HEPR_LINE_CAP.Round) return "round";
  if (value === HEPR_LINE_CAP.Square) return "square";
  return "butt";
}

function lineJoin(value: number): CanvasLineJoin {
  if (value === HEPR_LINE_JOIN.Round) return "round";
  if (value === HEPR_LINE_JOIN.Bevel) return "bevel";
  return "miter";
}

function isTransparentBoundaryNoOp(execution: HeprCompositeGroupExecution): boolean {
  return execution.alpha === 1 && execution.blendMode === "Normal" &&
    execution.softMaskGroupIndex === -1 && execution.backdropPaintIndex === -1 &&
    execution.blendingColorSpaceIndex === -1 && !execution.isolated && !execution.knockout;
}

function setCompositeOperation(
  context: CanvasRenderingContext2D,
  blendMode: PdfBlendMode,
  groupIndex: number
): void {
  const operation = canvasBlendOperation(blendMode);
  context.globalCompositeOperation = operation;
  if (context.globalCompositeOperation !== operation) {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.UnsupportedComposite,
      `This Canvas2D implementation rejected PDF blend mode ${blendMode}.`,
      `displayProgram.groups[${groupIndex}].blendMode`
    );
  }
}

function assertCanvasBlendMode(blendMode: PdfBlendMode, path: string): void {
  try {
    canvasBlendOperation(blendMode);
  } catch (cause) {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.UnsupportedComposite,
      `Canvas2D does not support PDF blend mode ${blendMode}.`,
      `${path}.blendMode`,
      cause
    );
  }
}

function canvasBlendOperation(blendMode: PdfBlendMode): GlobalCompositeOperation {
  switch (blendMode) {
    case "Normal": return "source-over";
    case "Multiply": return "multiply";
    case "Screen": return "screen";
    case "Overlay": return "overlay";
    case "Darken": return "darken";
    case "Lighten": return "lighten";
    case "ColorDodge": return "color-dodge";
    case "ColorBurn": return "color-burn";
    case "HardLight": return "hard-light";
    case "SoftLight": return "soft-light";
    case "Difference": return "difference";
    case "Exclusion": return "exclusion";
    case "Hue": return "hue";
    case "Saturation": return "saturation";
    case "Color": return "color";
    case "Luminosity": return "luminosity";
  }
}

function sampleMask(
  image: RgbaImage,
  x: number,
  y: number,
  targetWidth: number,
  targetHeight: number,
  interpolate: boolean
): number {
  if (!interpolate) {
    const sourceX = Math.min(image.width - 1, Math.floor((x + 0.5) * image.width / targetWidth));
    const sourceY = Math.min(image.height - 1, Math.floor((y + 0.5) * image.height / targetHeight));
    return maskPixel(image, sourceX, sourceY);
  }
  const sourceX = (x + 0.5) * image.width / targetWidth - 0.5;
  const sourceY = (y + 0.5) * image.height / targetHeight - 0.5;
  const x0 = clampInteger(Math.floor(sourceX), 0, image.width - 1);
  const y0 = clampInteger(Math.floor(sourceY), 0, image.height - 1);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const tx = clamp01(sourceX - Math.floor(sourceX));
  const ty = clamp01(sourceY - Math.floor(sourceY));
  const top = maskPixel(image, x0, y0) * (1 - tx) + maskPixel(image, x1, y0) * tx;
  const bottom = maskPixel(image, x0, y1) * (1 - tx) + maskPixel(image, x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

function maskPixel(image: RgbaImage, x: number, y: number): number {
  const offset = (y * image.width + x) * 4;
  return image.rgba[offset] / 255 * (image.rgba[offset + 3] / 255);
}

function requireByteLength(data: Uint8Array, expected: number, imageIndex: number): void {
  if (data.length !== expected) {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.UnsupportedImage,
      `Image ${imageIndex} has ${data.length} bytes; expected ${expected}.`,
      `stores.images.dataOffsets[${imageIndex}]`
    );
  }
}

function assertPixelLimit(width: number, height: number, limit: number, label: string): void {
  const pixels = checkedPixels(width, height, label);
  if (pixels > limit) {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit,
      `The ${label} has ${pixels} pixels; limit ${limit}.`
    );
  }
}

function checkedPixels(width: number, height: number, label: string): number {
  if (
    !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
    width <= 0 || height <= 0 || width > Math.floor(Number.MAX_SAFE_INTEGER / height)
  ) {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit,
      `The ${label} has invalid dimensions ${width}x${height}.`
    );
  }
  return width * height;
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.InvalidOptions,
      `${name} must be a positive safe integer.`
    );
  }
  return value;
}

function finitePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.InvalidOptions,
      `${name} must be finite and positive.`
    );
  }
  return value;
}

function rgbCss(red: number, green: number, blue: number): string {
  return `rgb(${Math.round(clamp01(red) * 255)}, ${Math.round(clamp01(green) * 255)}, ${Math.round(clamp01(blue) * 255)})`;
}

function rgbaCss(rgb: readonly [number, number, number], alpha: number): string {
  return `rgba(${Math.round(clamp01(rgb[0]) * 255)}, ${Math.round(clamp01(rgb[1]) * 255)}, ${Math.round(clamp01(rgb[2]) * 255)}, ${clamp01(alpha)})`;
}

function transparentStop(source: GradientStop): GradientStop {
  return { offset: source.offset, rgb: source.rgb, alpha: 0 };
}

function stopInterpolationError(
  low: GradientStop,
  high: GradientStop,
  actual: GradientStop,
  ratio: number
): number {
  let error = Math.abs(actual.alpha - (low.alpha + ratio * (high.alpha - low.alpha)));
  for (let component = 0; component < 3; component += 1) {
    error = Math.max(
      error,
      Math.abs(
        actual.rgb[component] -
        (low.rgb[component] + ratio * (high.rgb[component] - low.rgb[component]))
      )
    );
  }
  return error;
}

function triangleColorVariation(
  vertices: readonly [MeshVertex, MeshVertex, MeshVertex]
): number {
  let variation = 0;
  for (let component = 0; component < 3; component += 1) {
    const first = vertices[0].rgb[component];
    const second = vertices[1].rgb[component];
    const third = vertices[2].rgb[component];
    variation = Math.max(
      variation,
      Math.max(first, second, third) - Math.min(first, second, third)
    );
  }
  return variation;
}

function deviceCorners(width: number, height: number): readonly (readonly [number, number])[] {
  return [[0, 0], [width, 0], [0, height], [width, height]];
}

function invertCanvasMatrix(matrix: PdfMatrix, path: string): PdfMatrix {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= Number.EPSILON) {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
      "A shading transform is singular.",
      path
    );
  }
  return [
    matrix[3] / determinant,
    -matrix[1] / determinant,
    -matrix[2] / determinant,
    matrix[0] / determinant,
    (matrix[2] * matrix[5] - matrix[3] * matrix[4]) / determinant,
    (matrix[1] * matrix[4] - matrix[0] * matrix[5]) / determinant
  ];
}

function deriveOuterTransform(
  absoluteTransform: PdfMatrix,
  localTransform: PdfMatrix,
  path: string
): PdfMatrix {
  return multiplyHeprMatrices(
    absoluteTransform,
    invertCanvasMatrix(localTransform, path)
  );
}

function canonicalMatrixValue(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Object.is(value, -0)) return "0";
  return value.toPrecision(12);
}

function intersectingPatternCells(
  cellMinimum: number,
  cellMaximum: number,
  tileMinimum: number,
  tileMaximum: number,
  step: number
): readonly number[] {
  const first = (tileMinimum - cellMaximum) / step;
  const second = (tileMaximum - cellMinimum) / step;
  const minimum = Math.floor(Math.min(first, second)) - 1;
  const maximum = Math.ceil(Math.max(first, second)) + 1;
  if (
    !Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) ||
    maximum < minimum || maximum - minimum > 1_000_000
  ) {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit,
      "A tiling pattern requires an unsafe translated-cell range."
    );
  }
  const result: number[] = [];
  for (let index = minimum; index <= maximum; index += 1) {
    const translatedMinimum = cellMinimum + index * step;
    const translatedMaximum = cellMaximum + index * step;
    const low = Math.min(translatedMinimum, translatedMaximum);
    const high = Math.max(translatedMinimum, translatedMaximum);
    if (low < tileMaximum && high > tileMinimum) result.push(index);
  }
  return result;
}

function checkedPatternCellCount(xCount: number, yCount: number, path: string): number {
  if (
    !Number.isSafeInteger(xCount) || !Number.isSafeInteger(yCount) ||
    xCount < 0 || yCount < 0 ||
    (xCount !== 0 && yCount > Math.floor(Number.MAX_SAFE_INTEGER / xCount))
  ) {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit,
      "A tiling pattern cell count exceeds safe integer limits.",
      path
    );
  }
  return xCount * yCount;
}

function buildPatternCellPage(
  page: HeprPageData,
  programIndex: number,
  inheritedPaintIndex: number,
  xCells: readonly number[],
  yCells: readonly number[],
  xStep: number,
  yStep: number
): HeprPageData {
  const sourceTransforms = page.stores.transforms.values;
  const cellCount = xCells.length * yCells.length;
  const needsInheritedPaintWrapper = inheritedPaintIndex >= 0;
  const wrapperTransformCount = needsInheritedPaintWrapper ? 1 : 0;
  const transforms = new Float32Array(
    sourceTransforms.length + (cellCount + wrapperTransformCount) * 6
  );
  transforms.set(sourceTransforms);
  const commands: HeprDisplayCommand[] = [];
  let transformIndex = sourceTransforms.length / 6;
  let offset = sourceTransforms.length;
  const wrapperTransformIndex = needsInheritedPaintWrapper
    ? transformIndex + cellCount
    : -1;
  const wrapperProgramIndex = page.displayProgram.programs.length;
  const targetProgramIndex = needsInheritedPaintWrapper ? wrapperProgramIndex : programIndex;
  for (const yCell of yCells) {
    for (const xCell of xCells) {
      transforms.set([1, 0, 0, 1, xCell * xStep, yCell * yStep], offset);
      commands.push({
        kind: "invoke-program",
        transformIndex,
        clipIndex: -1,
        optionalContentIndex: -1,
        markedContentIndex: -1,
        sourceOffset: -1,
        sourceLength: -1,
        programIndex: targetProgramIndex,
        type3PaintIndex: inheritedPaintIndex,
        viewTransformFlags: 0
      });
      transformIndex += 1;
      offset += 6;
    }
  }
  if (needsInheritedPaintWrapper) {
    transforms.set([1, 0, 0, 1, 0, 0], offset);
  }
  const programs = needsInheritedPaintWrapper
    ? [...page.displayProgram.programs, {
        kind: "type3" as const,
        commands: [{
          kind: "invoke-program" as const,
          transformIndex: wrapperTransformIndex,
          clipIndex: -1,
          optionalContentIndex: -1,
          markedContentIndex: -1,
          sourceOffset: -1,
          sourceLength: -1,
          programIndex,
          type3PaintIndex: -1,
          viewTransformFlags: 0
        }],
        matrixIndex: wrapperTransformIndex,
        bounds: null,
        clipToBounds: false,
        resourceName: "Canvas2D uncolored-pattern paint adapter"
      }]
    : page.displayProgram.programs;
  const groups = [...page.displayProgram.groups, {
    commands,
    isolated: true,
    knockout: false,
    blendMode: "Normal" as const,
    alpha: 1,
    alphaIsShape: false,
    softMaskGroupIndex: -1,
    softMaskSubtype: null,
    softMaskTransferFunctionIndex: -1,
    backdropPaintIndex: -1,
    blendingColorSpaceIndex: -1,
    clipIndex: -1
  }];
  return {
    ...page,
    stores: {
      ...page.stores,
      transforms: { values: transforms }
    },
    displayProgram: {
      ...page.displayProgram,
      groups,
      programs,
      rootGroupIndex: groups.length - 1
    }
  };
}

function transformCanvasPoint(matrix: PdfMatrix, x: number, y: number): readonly [number, number] {
  return [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5]
  ];
}

function localCanvasBounds(
  localToDevice: PdfMatrix,
  width: number,
  height: number,
  path: string
): readonly [number, number, number, number] {
  const inverse = invertCanvasMatrix(localToDevice, path);
  let minimumX = Infinity;
  let minimumY = Infinity;
  let maximumX = -Infinity;
  let maximumY = -Infinity;
  for (const [deviceX, deviceY] of deviceCorners(width, height)) {
    const [x, y] = transformCanvasPoint(inverse, deviceX, deviceY);
    minimumX = Math.min(minimumX, x);
    minimumY = Math.min(minimumY, y);
    maximumX = Math.max(maximumX, x);
    maximumY = Math.max(maximumY, y);
  }
  if (![minimumX, minimumY, maximumX, maximumY].every(Number.isFinite)) {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit,
      "A shading requires unsafe local Canvas2D coverage.",
      path
    );
  }
  return [minimumX, minimumY, maximumX, maximumY];
}

function assertFiniteGradientExtent(minimum: number, maximum: number, path: string): void {
  if (
    !Number.isFinite(minimum) || !Number.isFinite(maximum) ||
    !(maximum > minimum) || Math.max(Math.abs(minimum), Math.abs(maximum)) > 1e12
  ) {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.ResourceLimit,
      "A shading requires an unsafe Canvas2D gradient extent.",
      path
    );
  }
}

function nearlyEqual(first: number, second: number): boolean {
  return Math.abs(first - second) <= 1e-9 * Math.max(1, Math.abs(first), Math.abs(second));
}

function maximumMatrixScale(matrix: PdfMatrix): number {
  const first = Math.hypot(matrix[0], matrix[1]);
  const second = Math.hypot(matrix[2], matrix[3]);
  const scale = Math.max(first, second);
  if (!(scale > 0) || !Number.isFinite(scale)) {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.UnsupportedPaint,
      "A mesh shading transform has no finite device scale."
    );
  }
  return scale;
}

const D65_WHITE_POINT = [0.95047, 1, 1.08883] as const;

function xyzToSrgb(
  xyz: readonly number[],
  sourceWhite: ArrayLike<number>
): readonly [number, number, number] {
  const adapted = adaptBradford(xyz, sourceWhite, D65_WHITE_POINT);
  return [
    srgbCompand(3.2404542 * adapted[0] - 1.5371385 * adapted[1] - 0.4985314 * adapted[2]),
    srgbCompand(-0.969266 * adapted[0] + 1.8760108 * adapted[1] + 0.041556 * adapted[2]),
    srgbCompand(0.0556434 * adapted[0] - 0.2040259 * adapted[1] + 1.0572252 * adapted[2])
  ];
}

function adaptBradford(
  xyz: readonly number[],
  sourceWhite: ArrayLike<number>,
  targetWhite: ArrayLike<number>
): readonly [number, number, number] {
  const forward = [
    0.8951, 0.2664, -0.1614,
    -0.7502, 1.7135, 0.0367,
    0.0389, -0.0685, 1.0296
  ];
  const inverse = [
    0.9869929, -0.1470543, 0.1599627,
    0.4323053, 0.5183603, 0.0492912,
    -0.0085287, 0.0400428, 0.9684867
  ];
  const sourceCone = multiplyColorMatrix(forward, sourceWhite);
  const targetCone = multiplyColorMatrix(forward, targetWhite);
  const cone = multiplyColorMatrix(forward, xyz);
  if (sourceCone.some((value) => value === 0 || !Number.isFinite(value))) {
    return [0, 0, 0];
  }
  return multiplyColorMatrix(inverse, [
    cone[0] * targetCone[0] / sourceCone[0],
    cone[1] * targetCone[1] / sourceCone[1],
    cone[2] * targetCone[2] / sourceCone[2]
  ]);
}

function multiplyColorMatrix(
  matrix: readonly number[],
  vector: ArrayLike<number>
): [number, number, number] {
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2]
  ];
}

function labInverse(value: number): number {
  const delta = 6 / 29;
  return value >= delta ? value ** 3 : 3 * delta * delta * (value - 4 / 29);
}

function srgbCompand(value: number): number {
  return clamp01(value <= 0.0031308
    ? 12.92 * value
    : 1.055 * Math.pow(value, 1 / 2.4) - 0.055);
}

function defaultColorDecode(
  colors: HeprPageData["stores"]["colors"],
  colorSpaceIndex: number,
  component: number
): readonly [number, number] {
  const kind = colors.spaceKinds[colorSpaceIndex];
  const parameters = colors.parameters.subarray(
    colors.parameterOffsets[colorSpaceIndex],
    colors.parameterOffsets[colorSpaceIndex + 1]
  );
  if (kind === HEPR_COLOR_SPACE_KIND.Indexed) return [0, parameters[0]];
  if (kind === HEPR_COLOR_SPACE_KIND.Lab) {
    if (component === 0) return [0, 100];
    return component === 1 ? [parameters[6], parameters[7]] : [parameters[8], parameters[9]];
  }
  if (kind === HEPR_COLOR_SPACE_KIND.IccBased && parameters.length >= component * 2 + 2) {
    return [parameters[component * 2], parameters[component * 2 + 1]];
  }
  return [0, 1];
}

function nonnegativeInteger(value: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.InvalidOptions,
      `${name} must be a safe integer from 0 through ${maximum}.`
    );
  }
  return value;
}

function unitTolerance(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw canvasError(
      HEPR_CANVAS_2D_ERROR_CODES.InvalidOptions,
      `${name} must be finite and in the interval (0, 1].`
    );
  }
  return value;
}

function clampRange(value: number, minimum: number, maximum: number): number {
  return Math.max(Math.min(minimum, maximum), Math.min(Math.max(minimum, maximum), value));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function canvasError(
  code: HeprCanvas2dErrorCode,
  message: string,
  path?: string,
  cause?: unknown
): HeprCanvas2dError {
  return new HeprCanvas2dError(code, message, { path, cause });
}
