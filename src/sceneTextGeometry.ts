import type { Bounds, PageTextIndex, VectorScene } from "./pdfVectorExtractor";

/**
 * Breathing room added around text bounds so highlights don't hug the glyph
 * ink. Proportional to the text height (em-relative), so it scales with the
 * text at every zoom. Horizontally half of the vertical padding looks best.
 */
export const TEXT_BOUNDS_VERTICAL_PADDING_FACTOR = 0.12;
export const TEXT_BOUNDS_HORIZONTAL_PADDING_FACTOR = TEXT_BOUNDS_VERTICAL_PADDING_FACTOR * 0.5;

/**
 * Writes the scene-space AABB of one indexed character into `out` as
 * minX, minY, maxX, maxY at out[outOffset..outOffset+3].
 *
 * Chars referencing a text instance get the glyph ink box (textGlyphMetaA/B)
 * transformed by the instance matrix — the same math the extractor used to
 * render the glyph — and fallback chars use their stored quad. Returns false
 * for separators (charInstance -1) and invalid references; `out` is left
 * untouched in that case.
 */
export function computeCharQuad(
  scene: VectorScene,
  page: PageTextIndex,
  charIndex: number,
  out: Float32Array,
  outOffset: number
): boolean {
  const ref = page.charInstance[charIndex];
  if (ref === -1 || ref === undefined) {
    return false;
  }

  if (ref <= -2) {
    const q = (-ref - 2) * 4;
    const fallbackQuads = page.fallbackQuads;
    if (q + 3 >= fallbackQuads.length) {
      return false;
    }
    out[outOffset] = fallbackQuads[q];
    out[outOffset + 1] = fallbackQuads[q + 1];
    out[outOffset + 2] = fallbackQuads[q + 2];
    out[outOffset + 3] = fallbackQuads[q + 3];
    return true;
  }

  const instanceA = scene.textInstanceA;
  const instanceB = scene.textInstanceB;
  const glyphMetaA = scene.textGlyphMetaA;
  const glyphMetaB = scene.textGlyphMetaB;

  const o = ref * 4;
  if (o + 3 >= instanceA.length || o + 3 >= instanceB.length) {
    return false;
  }
  const a = instanceA[o];
  const b = instanceA[o + 1];
  const c = instanceA[o + 2];
  const d = instanceA[o + 3];
  const e = instanceB[o];
  const f = instanceB[o + 1];
  const g = Math.trunc(instanceB[o + 2]) * 4;
  if (g < 0 || g + 3 >= glyphMetaA.length || g + 1 >= glyphMetaB.length) {
    return false;
  }
  const inkMinX = glyphMetaA[g + 2];
  const inkMinY = glyphMetaA[g + 3];
  const inkMaxX = glyphMetaB[g];
  const inkMaxY = glyphMetaB[g + 1];

  const x00 = a * inkMinX + c * inkMinY + e;
  const y00 = b * inkMinX + d * inkMinY + f;
  const x01 = a * inkMinX + c * inkMaxY + e;
  const y01 = b * inkMinX + d * inkMaxY + f;
  const x10 = a * inkMaxX + c * inkMinY + e;
  const y10 = b * inkMaxX + d * inkMinY + f;
  const x11 = a * inkMaxX + c * inkMaxY + e;
  const y11 = b * inkMaxX + d * inkMaxY + f;

  out[outOffset] = Math.min(x00, x01, x10, x11);
  out[outOffset + 1] = Math.min(y00, y01, y10, y11);
  out[outOffset + 2] = Math.max(x00, x01, x10, x11);
  out[outOffset + 3] = Math.max(y00, y01, y10, y11);
  return true;
}

const charQuadScratch = new Float32Array(4);

/**
 * Scene-space union of the character quads over [startChar, startChar+length)
 * plus em-relative padding. Char bounds are derived on demand; nothing
 * per-character is materialized up front.
 */
export function computeCharRangeBounds(
  scene: VectorScene,
  page: PageTextIndex,
  startChar: number,
  length: number
): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const end = Math.min(startChar + length, page.charInstance.length);
  for (let i = startChar; i < end; i += 1) {
    if (!computeCharQuad(scene, page, i, charQuadScratch, 0)) {
      continue;
    }
    minX = Math.min(minX, charQuadScratch[0]);
    minY = Math.min(minY, charQuadScratch[1]);
    maxX = Math.max(maxX, charQuadScratch[2]);
    maxY = Math.max(maxY, charQuadScratch[3]);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  // Degenerate unions (e.g. separator-only spans) still need a visible box.
  if (maxX - minX <= 0 || maxY - minY <= 0) {
    const inflate = 0.5;
    return { minX: minX - inflate, minY: minY - inflate, maxX: maxX + inflate, maxY: maxY + inflate };
  }

  const verticalPadding = (maxY - minY) * TEXT_BOUNDS_VERTICAL_PADDING_FACTOR;
  const horizontalPadding = (maxY - minY) * TEXT_BOUNDS_HORIZONTAL_PADDING_FACTOR;
  return {
    minX: minX - horizontalPadding,
    minY: minY - verticalPadding,
    maxX: maxX + horizontalPadding,
    maxY: maxY + verticalPadding
  };
}
