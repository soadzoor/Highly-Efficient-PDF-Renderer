import { createEmptyVectorScene } from "../emptyVectorScene";
import type { HeprPageData } from "../heprDocumentData";
import type { SceneTextIndex, VectorScene } from "../pdfVectorExtractor";

/** Keep a page's appearance and searchable text in the existing scene/HEP ABI. */
export function buildNativeRasterPage(
  page: HeprPageData,
  pixels: { rgba: Uint8ClampedArray; width: number; height: number; scale: number },
  signal: AbortSignal
): VectorScene {
  const { width, height } = page.pageInfo;
  const scene = createEmptyVectorScene();
  const layer = {
    width: pixels.width, height: pixels.height,
    // Native canvas may return externally owned, nontransferable memory.
    data: new Uint8Array(pixels.rgba),
    matrix: new Float32Array([pixels.width / pixels.scale, 0, 0, -pixels.height / pixels.scale, 0, height]),
    paintOrder: 0, pageIndex: 0
  };
  Object.assign(scene, {
    pageCount: 1, pageRects: new Float32Array([0, 0, width, height]),
    pageTextRanges: new Uint32Array([0, 0]),
    bounds: { minX: 0, minY: 0, maxX: width, maxY: height },
    pageBounds: { minX: 0, minY: 0, maxX: width, maxY: height },
    rasterLayers: [layer], rasterLayerWidth: layer.width, rasterLayerHeight: layer.height,
    rasterLayerData: layer.data, rasterLayerMatrix: layer.matrix, imagePaintOpCount: 1
  });
  scene.textIndex = buildNativeFallbackTextIndex(page, signal);
  scene.sourceTextCount = page.stores.glyphs.glyphIds.length;
  return scene;
}

/** Search quads for text whose paint lives partly or wholly in raster composites. */
export function buildNativeFallbackTextIndex(page: HeprPageData, signal: AbortSignal): SceneTextIndex {
  const index = page.textIndex;
  const references = new Int32Array(index.charGlyphIndices.length);
  const { fonts, glyphs, transforms, paths } = page.stores;
  // One quad per referencing character, never one per glyph. A ligature's
  // characters share a single glyph, but the char map addresses fallback quads
  // by position, so a shared quad leaves fewer quads than fallback characters
  // and a reader discards the whole text index.
  // Typed slots keep the extra search geometry bounded by the existing glyph
  // limit, without a large JS number array or per-glyph Map allocation.
  const converted = new Int32Array(glyphs.glyphIds.length);
  let count = 0;
  for (let i = 0; i < index.charGlyphIndices.length; i += 1) {
    if ((i & 1023) === 0) signal.throwIfAborted();
    if (index.charGlyphIndices[i] >= 0) count += 1;
  }
  const quads = new Float32Array(index.fallbackQuads.length + count * 4);
  quads.set(index.fallbackQuads);
  let nextQuad = index.fallbackQuads.length / 4;
  for (let i = 0; i < references.length; i += 1) {
    if ((i & 1023) === 0) signal.throwIfAborted();
    const glyph = index.charGlyphIndices[i];
    if (glyph < 0) { references[i] = glyph; continue; }
    const known = converted[glyph];
    if (known < 0) {
      // A repeat of an already measured glyph copies its rectangle into its own
      // slot, keeping one quad per character.
      const source = (-known - 2) * 4;
      const repeat = nextQuad++;
      quads.copyWithin(repeat * 4, source, source + 4);
      references[i] = -repeat - 2;
      continue;
    }
    const font = glyphs.fontIndices[glyph];
    let low = fonts.glyphOffsets[font];
    let high = fonts.glyphOffsets[font + 1];
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (fonts.glyphIds[middle] < glyphs.glyphIds[glyph]) low = middle + 1;
      else high = middle;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (low < fonts.glyphOffsets[font + 1] && fonts.glyphIds[low] === glyphs.glyphIds[glyph]) {
      const start = fonts.outlinePathStarts[low];
      const end = start + fonts.outlinePathCounts[low];
      for (let path = start; path < end; path += 1) {
        minX = Math.min(minX, paths.bounds[path * 4]);
        minY = Math.min(minY, paths.bounds[path * 4 + 1]);
        maxX = Math.max(maxX, paths.bounds[path * 4 + 2]);
        maxY = Math.max(maxY, paths.bounds[path * 4 + 3]);
      }
    }
    if (!Number.isFinite(minX) || minX === maxX || minY === maxY) {
      minX = 0; maxX = fonts.unitsPerEm[font];
      minY = fonts.descents[font]; maxY = fonts.ascents[font];
    }
    const offset = glyphs.transformIndices[glyph] * 6;
    const [a, b, c, d, e, f] = transforms.values.subarray(offset, offset + 6);
    const xs = [a * minX + c * minY + e, a * minX + c * maxY + e,
      a * maxX + c * minY + e, a * maxX + c * maxY + e];
    const ys = [b * minX + d * minY + f, b * minX + d * maxY + f,
      b * maxX + d * minY + f, b * maxX + d * maxY + f];
    const quadIndex = nextQuad++;
    const reference = -quadIndex - 2;
    quads.set([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], quadIndex * 4);
    converted[glyph] = reference;
    references[i] = reference;
  }
  return { version: 2, pages: [{
    text: index.text, charInstance: references, fallbackQuads: quads
  }] };
}
