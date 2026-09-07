import {
  DENSE_PDF_STROKE_STYLE_FLAG_CLIPPED,
  DENSE_PDF_STROKE_STYLE_FLAG_HAIRLINE,
  type DensePdfBounds,
  type DensePdfCompiledPage,
  type DensePdfLegacyVectorOutput
} from "./nativeContentCompiler";
import type { NativeTextCompilation, NativeTextFontResource } from "./nativeText";

const STROKE_STYLE_FLAG_OFFSET = 2;
const VISIBLE_ALPHA_EPSILON = 1e-3;

/**
 * Prove that moving one Form's packed paint across its caller's grouped
 * ordinary paint cannot change a pixel. This is deliberately conservative:
 * every retained fill/stroke quad and every visible glyph ink box must be
 * disjoint from the Form's exact rectangular clip.
 */
export function callerOrdinaryPaintIsDisjointFromForm(
  compiled: DensePdfCompiledPage,
  text: NativeTextCompilation,
  sidecar: DensePdfLegacyVectorOutput,
  fontResources: readonly NativeTextFontResource[],
  formClip: Readonly<DensePdfBounds>
): boolean {
  for (let pathIndex = 0; pathIndex < compiled.fillPathCount; pathIndex += 1) {
    const offset = pathIndex * 4;
    if (boundsOverlap(formClip, {
      minX: compiled.fillPathMetaA[offset + 2],
      minY: compiled.fillPathMetaA[offset + 3],
      maxX: compiled.fillPathMetaB[offset],
      maxY: compiled.fillPathMetaB[offset + 1]
    })) {
      return false;
    }
  }

  for (let segmentIndex = 0; segmentIndex < compiled.segmentCount; segmentIndex += 1) {
    const offset = segmentIndex * 4;
    const packedStyle = compiled.primitiveMeta[offset + 3];
    const styleFlags = Math.max(
      0,
      Math.trunc(packedStyle / STROKE_STYLE_FLAG_OFFSET + 1e-6)
    );
    // Hairline support is device-space and therefore has no zoom-independent
    // page-space expansion with which to prove separation.
    if ((styleFlags & DENSE_PDF_STROKE_STYLE_FLAG_HAIRLINE) !== 0) {
      return false;
    }
    const halfWidth = Math.max(0, compiled.styles[offset]);
    let strokeBounds: DensePdfBounds | null = {
      minX: Math.min(
        compiled.endpoints[offset],
        compiled.endpoints[offset + 2],
        compiled.primitiveMeta[offset]
      ) - halfWidth,
      minY: Math.min(
        compiled.endpoints[offset + 1],
        compiled.endpoints[offset + 3],
        compiled.primitiveMeta[offset + 1]
      ) - halfWidth,
      maxX: Math.max(
        compiled.endpoints[offset],
        compiled.endpoints[offset + 2],
        compiled.primitiveMeta[offset]
      ) + halfWidth,
      maxY: Math.max(
        compiled.endpoints[offset + 1],
        compiled.endpoints[offset + 3],
        compiled.primitiveMeta[offset + 1]
      ) + halfWidth
    };
    if ((styleFlags & DENSE_PDF_STROKE_STYLE_FLAG_CLIPPED) !== 0) {
      strokeBounds = intersectBounds(strokeBounds, {
        minX: compiled.primitiveBounds[offset],
        minY: compiled.primitiveBounds[offset + 1],
        maxX: compiled.primitiveBounds[offset + 2],
        maxY: compiled.primitiveBounds[offset + 3]
      });
    }
    if (strokeBounds && boundsOverlap(formClip, strokeBounds)) return false;
  }

  const glyphs = text.glyphs;
  const transforms = text.transforms.values;
  const runCount = sidecar.glyphRunMeta.length / 3;
  for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
    const runOffset = runIndex * 3;
    const first = sidecar.glyphRunMeta[runOffset];
    const count = sidecar.glyphRunMeta[runOffset + 1];
    const renderingMode = sidecar.glyphRunMeta[runOffset + 2];
    if (renderingMode !== 0 ||
        sidecar.glyphFillColors[runIndex * 4 + 3] <= VISIBLE_ALPHA_EPSILON) {
      continue;
    }
    const clipOffset = runIndex * 4;
    const runClip: DensePdfBounds = sidecar.glyphClipBounds
      ? {
        minX: sidecar.glyphClipBounds[clipOffset],
        minY: sidecar.glyphClipBounds[clipOffset + 1],
        maxX: sidecar.glyphClipBounds[clipOffset + 2],
        maxY: sidecar.glyphClipBounds[clipOffset + 3]
      }
      : formClip;
    for (let glyphIndex = first; glyphIndex < first + count; glyphIndex += 1) {
      const fontResource = fontResources[glyphs.fontIndices[glyphIndex]];
      // A Type3 CharProc is a display program, not a single monochrome
      // outline, so its complete paint cannot be bounded by this proof.
      if (!fontResource || fontResource.type3) return false;
      const outline = fontResource.font.getGlyphOutline(glyphs.glyphIds[glyphIndex]);
      if (!outline) return false;
      if (outline.commands.length === 0) continue;
      const transformOffset = glyphs.transformIndices[glyphIndex] * 6;
      const glyphBounds = transformRectangleBounds(
        outline.bounds,
        transforms.subarray(transformOffset, transformOffset + 6)
      );
      const visibleGlyphBounds = intersectBounds(glyphBounds, runClip);
      if (visibleGlyphBounds && boundsOverlap(formClip, visibleGlyphBounds)) return false;
    }
  }
  return true;
}

function transformRectangleBounds(
  rectangle: readonly number[],
  matrix: ArrayLike<number>
): DensePdfBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of [
    [rectangle[0], rectangle[1]],
    [rectangle[2], rectangle[1]],
    [rectangle[2], rectangle[3]],
    [rectangle[0], rectangle[3]]
  ] as const) {
    const transformedX = matrix[0] * x + matrix[2] * y + matrix[4];
    const transformedY = matrix[1] * x + matrix[3] * y + matrix[5];
    minX = Math.min(minX, transformedX);
    minY = Math.min(minY, transformedY);
    maxX = Math.max(maxX, transformedX);
    maxY = Math.max(maxY, transformedY);
  }
  return { minX, minY, maxX, maxY };
}

function intersectBounds(
  first: Readonly<DensePdfBounds>,
  second: Readonly<DensePdfBounds>
): DensePdfBounds | null {
  const result = {
    minX: Math.max(first.minX, second.minX),
    minY: Math.max(first.minY, second.minY),
    maxX: Math.min(first.maxX, second.maxX),
    maxY: Math.min(first.maxY, second.maxY)
  };
  return result.minX < result.maxX && result.minY < result.maxY ? result : null;
}

function boundsOverlap(
  first: Readonly<DensePdfBounds>,
  second: Readonly<DensePdfBounds>
): boolean {
  return first.maxX >= second.minX && first.minX <= second.maxX &&
    first.maxY >= second.minY && first.minY <= second.maxY;
}
