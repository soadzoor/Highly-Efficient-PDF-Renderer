import { HEPR_STROKE_FLAG, type HeprDisplayCommand, type HeprPageData } from "./heprDocumentData";
import { PdfError, type PdfDiagnostic, type PdfResourceLimits } from "./pdf/nativeTypes";
import type { RasterLayer } from "./pdfVectorExtractor";
import { findRgbaAlphaBounds } from "./rgbaBounds";
import { loadNodeCanvas } from "./nodeCanvas";

/** Raster capture of self-contained retained pages, independent of PDF parsing. */
export type NativeSelectiveRasterLayer = RasterLayer & {
  retainedFirstCommand?: number;
  retainedCommandCount?: number;
};

/** Internal replay entry point; the supplied retained page needs no source PDF or parser session. */
export async function renderNativeRetainedCommandSpan(
  page: HeprPageData, firstCommand: number, count: number, signal: AbortSignal,
  limits?: Readonly<PdfResourceLimits>,
  onDiagnostic?: (diagnostic: PdfDiagnostic) => void
): Promise<NativeSelectiveRasterLayer | null> {
  signal.throwIfAborted();
  const commands = page.displayProgram.groups[page.displayProgram.rootGroupIndex]?.commands;
  if (!commands || !Number.isSafeInteger(firstCommand) || firstCommand < 0 || !Number.isSafeInteger(count) ||
      count <= 0 || firstCommand + count > commands.length) throw new RangeError("Invalid retained command span.");
  const surfaceFactory = await createNativeCompositeSurfaceFactory();
  const { renderHeprPageToCanvas2d, HeprCanvas2dImageSurfaceCache } = await import("./heprCanvas2dRenderer");
  const imageSurfaces = new HeprCanvas2dImageSurfaceCache(page, surfaceFactory,
    surface => surfaceFactory.retain(surface.canvas), surface => surfaceFactory.release(surface.canvas));
  try {
    return await renderNativeCompositeCommandSpan(page, firstCommand, firstCommand + count - 1,
      firstCommand + count - 1, signal, surfaceFactory, renderHeprPageToCanvas2d,
      { imageSurfaces, boundSoftMasks: true, onDiagnostic }, true, limits);
  } finally { imageSurfaces.dispose(); surfaceFactory.releaseAll(); }
}

export async function renderNativeCompositeCommandSpan(
  page: HeprPageData, first: number, last: number, paintOrder: number, signal: AbortSignal,
  surfaceFactory: Awaited<ReturnType<typeof createNativeCompositeSurfaceFactory>>,
  renderHeprPageToCanvas2d: NativeCompositeRenderer,
  renderInternals: import("./heprCanvas2dRenderer").HeprCanvas2dRenderInternals & {
    readonly onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
  },
  boundCompositeWork: boolean,
  limits?: Readonly<PdfResourceLimits>
): Promise<NativeSelectiveRasterLayer | null> {
  const rootCommands = page.displayProgram.groups[page.displayProgram.rootGroupIndex].commands;
  const commands = rootCommands.slice(first, last + 1);
  const scale = nativeSelectiveCompositeScale(page, rootCommands, last, limits);
  const rendered = await renderNativeCompositePixels(createSelectiveCompositePage(page, commands), {
    scale, background: null, surfaceFactory, signal
  }, renderHeprPageToCanvas2d, renderInternals);
  // Keep the slot even when its current layers are empty. Retained page bounds
  // describe where a later visibility revision can paint; its texture only
  // needs the pixels visible now.
  const crop = cropVisibleRgba(rendered.rgba, rendered.width, rendered.height, 2, signal) ??
    { x: 0, y: 0, width: 1, height: 1, data: new Uint8Array(4) };
  const backdropGroups = collectHeprBackdropGroups(page, commands);
  const data = backdropGroups.size !== 0 && [...backdropGroups].every(groupIndex => heprBackdropGroupCanRender(page, groupIndex))
    ? await renderNativeBackdropCorrection({ page, rootCommands, first, last, selectionRgba: rendered.rgba,
      crop, scale, backdropGroups, surfaceFactory, renderInternals, boundCompositeWork, signal, renderHeprPageToCanvas2d })
    : crop.data;
  return { width: crop.width, height: crop.height, data,
    matrix: new Float32Array([crop.width / rendered.scale, 0, 0, -crop.height / rendered.scale,
      crop.x / rendered.scale, page.pageInfo.height - crop.y / rendered.scale]), paintOrder, pageIndex: 0,
    retainedFirstCommand: first, retainedCommandCount: last - first + 1 };
}

export function createSelectiveCompositePage(
  page: HeprPageData,
  commands: readonly HeprDisplayCommand[],
  preserveBackdropGroups: ReadonlySet<number> | null = null
): HeprPageData {
  const groups = page.displayProgram.groups.map((group, index) => ({
    ...group,
    ...(index === page.displayProgram.rootGroupIndex ? { commands } : {}),
    // Canvas2D receives canonical sRGB resources and has no API for an
    // explicit PDF blending-space override or group backdrop color.
    blendingColorSpaceIndex: -1,
    backdropPaintIndex: -1,
    ...(!preserveBackdropGroups?.has(index) ? {
      // A standalone layer has no parent backdrop. Keep every nested scope
      // independent so the resulting RGBA can be moved through the VectorScene
      // raster-underlay ABI without sampling unrelated page pixels.
      isolated: true,
      alphaIsShape: false,
    } : {})
  }));
  const flags = page.stores.strokes.flags.slice();
  for (let index = 0; index < flags.length; index += 1) {
    flags[index] &= ~HEPR_STROKE_FLAG.StrokeAdjust;
  }
  const overprint = page.stores.paints.overprint.slice();
  overprint.fill(0);
  return {
    ...page,
    displayProgram: { ...page.displayProgram, groups },
    stores: {
      ...page.stores,
      strokes: { ...page.stores.strokes, flags },
      paints: { ...page.stores.paints, overprint }
    }
  };
}

const NATIVE_SELECTIVE_BASE_SCALE = 1.5;
// Four RGBA buffers can be live during backdrop correction. Keep their
// aggregate comfortably below the parser's 512 MiB decoded-stream ceiling.
export const NATIVE_SELECTIVE_MAX_CANVAS_PIXELS = 16_000_000;

/**
 * Match the sharpest source image already contributing below a selective
 * layer. This avoids resampling a high-density page image down to the old
 * fixed 1.5 px/unit bridge and then enlarging it again at viewer zoom.
 */
function nativeSelectiveCompositeScale(
  page: HeprPageData,
  rootCommands: readonly HeprDisplayCommand[],
  lastCommandIndex: number,
  limits?: Readonly<PdfResourceLimits>
): number {
  // Bound generated layers independently of Canvas source-image and working-surface budgets.
  const maxPixels = Math.min(NATIVE_SELECTIVE_MAX_CANVAS_PIXELS,
    limits?.maxImagePixels ?? Infinity, limits ? Math.floor(limits.maxDecodedStreamBytes / 4) : Infinity);
  if (maxPixels < 1) throw new PdfError("resource-limit", "No pixel budget for composite fallback.");
  const maxDimension = limits?.maxImageDimension ?? Infinity;
  let scale = NATIVE_SELECTIVE_BASE_SCALE;
  const transforms = page.stores.transforms.values;
  const images = page.stores.images;
  for (let commandIndex = 0;
    commandIndex <= lastCommandIndex && commandIndex < rootCommands.length;
    commandIndex += 1) {
    const command = rootCommands[commandIndex];
    if (command.kind !== "draw" || command.source !== "images") continue;
    const transformOffset = command.transformIndex * 6;
    const a = transforms[transformOffset];
    const b = transforms[transformOffset + 1];
    const c = transforms[transformOffset + 2];
    const d = transforms[transformOffset + 3];
    const xExtent = Math.hypot(a, b);
    const yExtent = Math.hypot(c, d);
    for (let imageOffset = 0; imageOffset < command.count; imageOffset += 1) {
      const imageIndex = command.first + imageOffset;
      if (xExtent > 0) scale = Math.max(scale, images.widths[imageIndex] / xExtent);
      if (yExtent > 0) scale = Math.max(scale, images.heights[imageIndex] / yExtent);
    }
  }
  const pagePixels = page.pageInfo.width * page.pageInfo.height;
  const cappedScale = pagePixels > 0
    ? Math.sqrt(maxPixels / pagePixels)
    : NATIVE_SELECTIVE_BASE_SCALE;
  scale = Math.min(scale, cappedScale,
    maxDimension / page.pageInfo.width, maxDimension / page.pageInfo.height);
  // Large sheets can require a scale below the preferred minimum. Account for
  // integer canvas dimensions too, so backdrop correction respects its budget.
  while (Math.ceil(page.pageInfo.width * scale) * Math.ceil(page.pageInfo.height * scale) > maxPixels ||
      Math.ceil(page.pageInfo.width * scale) > maxDimension ||
      Math.ceil(page.pageInfo.height * scale) > maxDimension) scale *= 0.99;
  return scale;
}

function collectHeprBackdropGroups(
  page: HeprPageData,
  commands: readonly HeprDisplayCommand[]
): ReadonlySet<number> {
  const result = new Set<number>();
  const activeGroups = new Set<number>();
  const activePrograms = new Set<number>();
  const visit = (command: HeprDisplayCommand): void => {
    if (command.kind === "draw") return;
    if (command.kind === "invoke-program") {
      if (activePrograms.has(command.programIndex)) return;
      activePrograms.add(command.programIndex);
      for (const nested of page.displayProgram.programs[command.programIndex]?.commands ?? []) {
        visit(nested);
      }
      activePrograms.delete(command.programIndex);
      return;
    }
    if (activeGroups.has(command.groupIndex)) return;
    activeGroups.add(command.groupIndex);
    const group = page.displayProgram.groups[command.groupIndex];
    if (group) {
      if (group.blendMode !== "Normal" || group.backdropPaintIndex >= 0 || group.knockout) {
        result.add(command.groupIndex);
      }
      for (const nested of group.commands) visit(nested);
    }
    activeGroups.delete(command.groupIndex);
  };
  for (const command of commands) visit(command);
  return result;
}

function heprBackdropGroupCanRender(page: HeprPageData, groupIndex: number): boolean {
  const group = page.displayProgram.groups[groupIndex];
  if (!group || group.knockout || group.softMaskTransferFunctionIndex >= 0) return false;
  if (group.alphaIsShape && (group.alpha !== 1 || group.softMaskGroupIndex >= 0)) return false;
  if (group.isolated) return true;
  if (group.alpha === 1 && group.blendMode === "Normal" && group.softMaskGroupIndex < 0) {
    return true;
  }
  const only = group.commands.length === 1 ? group.commands[0] : null;
  return only?.kind === "draw" && only.count === 1;
}

interface NativeBackdropCorrectionInput {
  readonly boundCompositeWork: boolean;
  readonly renderInternals: import("./heprCanvas2dRenderer").HeprCanvas2dRenderInternals;
  readonly page: HeprPageData;
  readonly rootCommands: readonly HeprDisplayCommand[];
  readonly first: number;
  readonly last: number;
  readonly selectionRgba: Uint8ClampedArray;
  readonly crop: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly scale: number;
  readonly backdropGroups: ReadonlySet<number>;
  readonly surfaceFactory: Awaited<ReturnType<typeof createNativeCompositeSurfaceFactory>>;
  readonly signal: AbortSignal;
  readonly renderHeprPageToCanvas2d: typeof import("./heprCanvas2dRenderer")["renderHeprPageToCanvas2d"];
}

/**
 * Convert a backdrop-dependent PDF blend into a normal source-over RGBA patch
 * for the established raster-layer ABI. Rendering the prefix both without and
 * with the selected commands gives the exact target pixel; the standalone
 * selection supplies its shape/coverage alpha.
 */
async function renderNativeBackdropCorrection(
  input: NativeBackdropCorrectionInput
): Promise<Uint8Array> {
  const {
    page,
    rootCommands,
    first,
    last,
    selectionRgba,
    crop,
    scale,
    backdropGroups,
    surfaceFactory,
    signal,
    renderHeprPageToCanvas2d
  } = input;
  const render = async (commands: readonly HeprDisplayCommand[]) => {
    const result = await renderNativeCompositePixels(
      createSelectiveCompositePage(page, commands, backdropGroups),
      {
        scale,
        background: null,
        surfaceFactory,
        signal,
        maxCanvasPixels: NATIVE_SELECTIVE_MAX_CANVAS_PIXELS
      },
      renderHeprPageToCanvas2d,
      { ...input.renderInternals, readback: input.boundCompositeWork ? crop : undefined }
    );
    return result.rgba;
  };
  const backdrop = await render(rootCommands.slice(0, first));
  signal.throwIfAborted();
  const composited = await render(rootCommands.slice(0, last + 1));
  signal.throwIfAborted();
  const width = Math.ceil(page.pageInfo.width * scale);
  const output = new Uint8Array(crop.width * crop.height * 4);
  for (let y = 0; y < crop.height; y += 1) {
    for (let x = 0; x < crop.width; x += 1) {
      const sourceOffset = ((crop.y + y) * width + crop.x + x) * 4;
      const targetOffset = (y * crop.width + x) * 4;
      const backdropOffset = input.boundCompositeWork ? targetOffset : sourceOffset;
      const shapeAlpha = selectionRgba[sourceOffset + 3] / 255;
      if (shapeAlpha <= 0) continue;
      const backdropAlpha = backdrop[backdropOffset + 3] / 255;
      const outputAlpha = composited[backdropOffset + 3] / 255;
      let layerAlpha = backdropAlpha < 1 - 1 / 255
        ? (outputAlpha - backdropAlpha) / (1 - backdropAlpha)
        : shapeAlpha;
      if (!Number.isFinite(layerAlpha) || layerAlpha <= 0) layerAlpha = shapeAlpha;
      if (backdropAlpha >= 1 - 1 / 255) {
        for (let channel = 0; channel < 3; channel += 1) {
          const backdropValue = backdrop[backdropOffset + channel] / 255;
          const outputValue = composited[backdropOffset + channel] / 255;
          if (outputValue < backdropValue && backdropValue > 0) {
            layerAlpha = Math.max(
              layerAlpha,
              (backdropValue - outputValue) / backdropValue
            );
          } else if (outputValue > backdropValue && backdropValue < 1) {
            layerAlpha = Math.max(
              layerAlpha,
              (outputValue - backdropValue) / (1 - backdropValue)
            );
          }
        }
      }
      layerAlpha = Math.max(1 / 255, Math.min(1, layerAlpha));
      for (let channel = 0; channel < 3; channel += 1) {
        const outputPremultiplied = composited[backdropOffset + channel] / 255 * outputAlpha;
        const backdropPremultiplied = backdrop[backdropOffset + channel] / 255 * backdropAlpha;
        const layer = (
          outputPremultiplied - backdropPremultiplied * (1 - layerAlpha)
        ) / layerAlpha;
        output[targetOffset + channel] = Math.round(Math.max(0, Math.min(1, layer)) * 255);
      }
      output[targetOffset + 3] = Math.round(layerAlpha * 255);
      assertNativeBackdropPixelReconstructs(
        output,
        targetOffset,
        backdrop,
        composited,
        backdropOffset
      );
    }
  }
  return output;
}

function assertNativeBackdropPixelReconstructs(
  layer: Uint8Array,
  layerOffset: number,
  backdrop: Uint8ClampedArray,
  composited: Uint8ClampedArray,
  sourceOffset: number
): void {
  const layerAlpha = layer[layerOffset + 3] / 255;
  const backdropAlpha = backdrop[sourceOffset + 3] / 255;
  const reconstructedAlpha = layerAlpha + backdropAlpha * (1 - layerAlpha);
  if (Math.abs(Math.round(reconstructedAlpha * 255) - composited[sourceOffset + 3]) > 1) {
    throw new PdfError("unsupported-content", "A backdrop correction cannot preserve alpha.", {
      details: { reason: "selective-backdrop-reconstruction" }
    });
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const reconstructedPremultiplied =
      layer[layerOffset + channel] / 255 * layerAlpha +
      backdrop[sourceOffset + channel] / 255 * backdropAlpha * (1 - layerAlpha);
    const reconstructed = reconstructedAlpha > 0
      ? reconstructedPremultiplied / reconstructedAlpha
      : 0;
    if (Math.abs(Math.round(reconstructed * 255) - composited[sourceOffset + channel]) > 1) {
      throw new PdfError("unsupported-content", "A backdrop correction cannot preserve color.", {
        details: { reason: "selective-backdrop-reconstruction", channel }
      });
    }
  }
}

type NativeCompositeRenderer = typeof import("./heprCanvas2dRenderer")["renderHeprPageToCanvas2d"];

export async function renderNativeCompositePixels(
  page: HeprPageData,
  options: Parameters<NativeCompositeRenderer>[1] & {
    readonly surfaceFactory: Awaited<ReturnType<typeof createNativeCompositeSurfaceFactory>>;
  },
  render: NativeCompositeRenderer,
  internal: import("./heprCanvas2dRenderer").HeprCanvas2dRenderInternals & {
    readonly onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
    readonly readback?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  } = {}
) {
  try {
    // A stored raster has no live camera transform. Approximate view-dependent
    // annotation flags only for raster capture; retain the original program.
    const hasViewFlags = (command: HeprDisplayCommand) =>
      command.kind === "invoke-program" && command.viewTransformFlags !== 0;
    const approximatedViewFlags = page.displayProgram.groups.some(group => group.commands.some(hasViewFlags)) ||
      page.displayProgram.programs.some(program => program.commands.some(hasViewFlags));
    const captureCommands = (commands: readonly HeprDisplayCommand[]) => commands.map(command =>
      hasViewFlags(command) ? { ...command, viewTransformFlags: 0 } : command);
    const displayProgram = approximatedViewFlags ? { ...page.displayProgram,
      groups: page.displayProgram.groups.map(group => ({ ...group, commands: captureCommands(group.commands) })),
      programs: page.displayProgram.programs.map(program => ({ ...program, commands: captureCommands(program.commands) }))
    } : page.displayProgram;
    const onDiagnostic = options.onDiagnostic ?? internal.onDiagnostic;
    if (approximatedViewFlags) onDiagnostic?.({
      code: "annotation.view-transform-approximated", severity: "warning", pageIndex: page.pageInfo.sourcePageIndex,
      message: "Rasterized NoZoom/NoRotate annotations use page geometry and scale with the page."
    });
    const { surface, width, height, scale } = await render(approximatedViewFlags ? { ...page, displayProgram } : page, {
      ...options, onDiagnostic
    }, internal);
    options.signal?.throwIfAborted();
    // getImageData owns its pixels. Release scratch surfaces after extraction;
    // immutable cached images survive only until this page operation finishes.
    const startedAt = internal.timings ? nativeVectorTimingNow() : 0;
    const rect = internal.readback ?? { x: 0, y: 0, width, height };
    const rgba = surface.context.getImageData(rect.x, rect.y, rect.width, rect.height).data;
    if (internal.timings) {
      internal.timings.readbackMs += nativeVectorTimingNow() - startedAt;
      internal.timings.readbackPixels += rect.width * rect.height;
    }
    return { rgba, width, height, scale };
  } finally {
    options.surfaceFactory.releaseScratch();
  }
}

export async function createNativeCompositeSurfaceFactory() {
  type Canvas = { width: number; height: number };
  const canvases = new Set<Canvas>();
  const retained = new Set<Canvas>();
  const release = (canvas: Canvas) => {
    retained.delete(canvas);
    if (canvases.delete(canvas)) {
      try {
        canvas.width = 1;
        canvas.height = 1;
      } catch {
        // Immutable host wrappers must rely on collection instead.
      }
    }
  };
  const releaseScratch = () => {
    for (const canvas of canvases) if (!retained.has(canvas)) release(canvas);
  };
  const releaseAll = () => {
    retained.clear();
    releaseScratch();
  };
  const lifetime = { releaseAll, releaseScratch, release, retain: (canvas: Canvas) => retained.add(canvas) };
  if (typeof OffscreenCanvas === "function") {
    return Object.assign((width: number, height: number) => {
      const canvas = new OffscreenCanvas(width, height);
      canvases.add(canvas);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new PdfError("unsupported-content", "OffscreenCanvas 2D is unavailable.");
      return { canvas, context: context as unknown as CanvasRenderingContext2D };
    }, lifetime);
  }
  let module: { createCanvas?: (width: number, height: number) => HTMLCanvasElement } | null;
  try {
    module = loadNodeCanvas() as typeof module;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "No worker Canvas2D surface is available.";
    throw new PdfError("unsupported-content", message, {
      cause,
      details: { reason: "selective-composite-surface" }
    });
  }
  if (typeof module?.createCanvas !== "function") {
    throw new PdfError("unsupported-content", "No worker Canvas2D surface is available.", {
      details: { reason: "selective-composite-surface" }
    });
  }
  return Object.assign((width: number, height: number) => {
    const canvas = module.createCanvas!(width, height);
    canvases.add(canvas);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new PdfError("unsupported-content", "Node Canvas2D is unavailable.");
    return { canvas, context };
  }, lifetime);
}

function cropVisibleRgba(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  padding: number,
  signal: AbortSignal
): { x: number; y: number; width: number; height: number; data: Uint8Array } | null {
  const bounds = findRgbaAlphaBounds(source, width, height, signal);
  if (!bounds) return null;
  const minX = Math.max(0, bounds.x - padding);
  const minY = Math.max(0, bounds.y - padding);
  const maxX = Math.min(width - 1, bounds.x + bounds.width - 1 + padding);
  const maxY = Math.min(height - 1, bounds.y + bounds.height - 1 + padding);
  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const data = new Uint8Array(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y += 1) {
    signal.throwIfAborted();
    const start = ((minY + y) * width + minX) * 4;
    data.set(source.subarray(start, start + cropWidth * 4), y * cropWidth * 4);
  }
  return { x: minX, y: minY, width: cropWidth, height: cropHeight, data };
}

function nativeVectorTimingNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
