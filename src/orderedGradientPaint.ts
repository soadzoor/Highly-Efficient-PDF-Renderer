import type { VectorScene } from "./pdfVectorExtractor";

export const GRADIENT_LUT_WIDTH = 1024;

export interface GradientSceneData {
  gradientCount: number;
  gradientMetaA: Float32Array;
  gradientMetaB: Float32Array;
  gradientMetaC: Float32Array;
  gradientMetaD: Float32Array;
  gradientMetaE: Float32Array;
  gradientLut: Uint8Array<ArrayBufferLike>;
  gradientFillPathCount: number;
  gradientFillSegmentCount: number;
  gradientFillPathMetaA: Float32Array;
  gradientFillPathMetaB: Float32Array;
  gradientFillPathMetaC: Float32Array;
  gradientFillPaintMeta: Float32Array;
  gradientFillSegmentsA: Float32Array;
  gradientFillSegmentsB: Float32Array;
  gradientStrokeRunCount: number;
  gradientStrokeSegmentCount: number;
  gradientStrokeRunMetaA: Float32Array;
  gradientStrokeRunMetaB: Float32Array;
  gradientStrokeEndpoints: Float32Array;
  gradientStrokePrimitiveMeta: Float32Array;
  gradientStrokePrimitiveBounds: Float32Array;
  gradientStrokeStyles: Float32Array;
}

export interface OrderedRasterPaint {
  paintOrder: number;
  pageIndex: number;
}

export type OrderedGradientPaintCommand =
  | { kind: "raster"; index: number; paintOrder: number; pageIndex: number }
  | { kind: "gradient-fill"; index: number; paintOrder: number; pageIndex: number }
  | { kind: "gradient-stroke"; index: number; paintOrder: number; pageIndex: number };

export interface OrderedGradientMinifyPlan {
  splitOrderedGradientPrefix: boolean;
  includeGradientPaint: boolean;
  hasMinifiableContent: boolean;
}

const EMPTY_FLOATS = new Float32Array(0);
const EMPTY_BYTES = new Uint8Array(0);

/**
 * Read the sparse gradient extension without making older/partial scenes fatal.
 *
 * The current PDF extractor and parsed-data decoder always provide these fields,
 * but keeping the renderer boundary defensive makes a failed/partial load render
 * its ordinary vector content instead of poisoning every GPU texture upload.
 */
export function readGradientSceneData(scene: VectorScene): GradientSceneData {
  const source = scene as VectorScene & Partial<GradientSceneData>;
  return {
    gradientCount: nonNegativeInt(source.gradientCount),
    gradientMetaA: floatArray(source.gradientMetaA),
    gradientMetaB: floatArray(source.gradientMetaB),
    gradientMetaC: floatArray(source.gradientMetaC),
    gradientMetaD: floatArray(source.gradientMetaD),
    gradientMetaE: floatArray(source.gradientMetaE),
    gradientLut: byteArray(source.gradientLut),
    gradientFillPathCount: nonNegativeInt(source.gradientFillPathCount),
    gradientFillSegmentCount: nonNegativeInt(source.gradientFillSegmentCount),
    gradientFillPathMetaA: floatArray(source.gradientFillPathMetaA),
    gradientFillPathMetaB: floatArray(source.gradientFillPathMetaB),
    gradientFillPathMetaC: floatArray(source.gradientFillPathMetaC),
    gradientFillPaintMeta: floatArray(source.gradientFillPaintMeta),
    gradientFillSegmentsA: floatArray(source.gradientFillSegmentsA),
    gradientFillSegmentsB: floatArray(source.gradientFillSegmentsB),
    gradientStrokeRunCount: nonNegativeInt(source.gradientStrokeRunCount),
    gradientStrokeSegmentCount: nonNegativeInt(source.gradientStrokeSegmentCount),
    gradientStrokeRunMetaA: floatArray(source.gradientStrokeRunMetaA),
    gradientStrokeRunMetaB: floatArray(source.gradientStrokeRunMetaB),
    gradientStrokeEndpoints: floatArray(source.gradientStrokeEndpoints),
    gradientStrokePrimitiveMeta: floatArray(source.gradientStrokePrimitiveMeta),
    gradientStrokePrimitiveBounds: floatArray(source.gradientStrokePrimitiveBounds),
    gradientStrokeStyles: floatArray(source.gradientStrokeStyles)
  };
}

export function buildOrderedGradientPaintCommands(
  rasterPaints: readonly OrderedRasterPaint[],
  gradientData: GradientSceneData
): OrderedGradientPaintCommand[] {
  const commands: OrderedGradientPaintCommand[] = [];

  for (let index = 0; index < rasterPaints.length; index += 1) {
    const raster = rasterPaints[index];
    commands.push({
      kind: "raster",
      index,
      paintOrder: finiteOrder(raster.paintOrder, index),
      pageIndex: nonNegativeInt(raster.pageIndex)
    });
  }

  for (let index = 0; index < gradientData.gradientFillPathCount; index += 1) {
    const offset = index * 4;
    commands.push({
      kind: "gradient-fill",
      index,
      paintOrder: finiteOrder(gradientData.gradientFillPaintMeta[offset + 2], index),
      pageIndex: nonNegativeInt(gradientData.gradientFillPaintMeta[offset + 3])
    });
  }

  for (let index = 0; index < gradientData.gradientStrokeRunCount; index += 1) {
    const offset = index * 4;
    commands.push({
      kind: "gradient-stroke",
      index,
      paintOrder: finiteOrder(gradientData.gradientStrokeRunMetaB[offset], index),
      pageIndex: nonNegativeInt(gradientData.gradientStrokeRunMetaB[offset + 1])
    });
  }

  commands.sort((left, right) => {
    const pageDelta = left.pageIndex - right.pageIndex;
    if (pageDelta !== 0) {
      return pageDelta;
    }
    const orderDelta = left.paintOrder - right.paintOrder;
    if (orderDelta !== 0) {
      return orderDelta;
    }
    const kindDelta = commandKindRank(left.kind) - commandKindRank(right.kind);
    return kindDelta !== 0 ? kindDelta : left.index - right.index;
  });

  return commands;
}

/**
 * The ordinary-vector minify target can also contain sparse gradient paints
 * unless a raster on the same page follows one of them. In that case the
 * raster/gradient prefix must be drawn directly in painter order and only the
 * ordinary fill/stroke/text suffix is minified.
 */
export function orderedGradientPaintNeedsDirectRendering(
  commands: readonly OrderedGradientPaintCommand[]
): boolean {
  const pagesWithGradientPaint = new Set<number>();
  for (const command of commands) {
    if (command.kind === "raster") {
      if (pagesWithGradientPaint.has(command.pageIndex)) {
        return true;
      }
      continue;
    }
    pagesWithGradientPaint.add(command.pageIndex);
  }
  return false;
}

export function planOrderedGradientMinify(
  rasterRenderingEnabled: boolean,
  gradientPaintRequiresDirectRendering: boolean,
  hasOrdinaryVectorContent: boolean,
  hasVectorContent: boolean
): OrderedGradientMinifyPlan {
  const splitOrderedGradientPrefix =
    rasterRenderingEnabled && gradientPaintRequiresDirectRendering;
  return {
    splitOrderedGradientPrefix,
    includeGradientPaint: !splitOrderedGradientPrefix,
    hasMinifiableContent: splitOrderedGradientPrefix
      ? hasOrdinaryVectorContent
      : hasVectorContent
  };
}

function commandKindRank(kind: OrderedGradientPaintCommand["kind"]): number {
  if (kind === "raster") {
    return 0;
  }
  return kind === "gradient-fill" ? 1 : 2;
}

function nonNegativeInt(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, Math.trunc(numberValue)) : 0;
}

function finiteOrder(value: unknown, fallback: number): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function floatArray(value: unknown): Float32Array {
  return value instanceof Float32Array ? value : EMPTY_FLOATS;
}

function byteArray(value: unknown): Uint8Array<ArrayBufferLike> {
  return value instanceof Uint8Array ? value : EMPTY_BYTES;
}
