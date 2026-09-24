import type { DensePdfCompiledPage, DensePdfVectorSceneData, DensePdfBounds } from "./nativeContentCompiler";
import type { NativePdfFont } from "./nativeFont";
import type { NativeTextCompilation } from "./nativeText";
import { buildNativeGlyphStrokeAtOrigin, nativeGlyphStrokeCacheKey, type NativeGlyphStrokeGeometry } from "./nativeGlyphStroke";
import { PdfError, throwIfAborted } from "./nativeTypes";

export interface NativeStrokeTextStores {
  instanceA: Float32Array;
  instanceB: Float32Array;
  instanceC: Float32Array;
  clipRects?: Float32Array;
  glyphMetaA: Float32Array;
  glyphMetaB: Float32Array;
  glyphSegmentsA: Float32Array;
  glyphSegmentsB: Float32Array;
}

/** Stroke glyphs become filled vector outlines in the text stores, including overlapping joins. */
export function buildNativeVectorTextStrokes(
  compiled: DensePdfCompiledPage,
  sidecar: DensePdfVectorSceneData,
  text: NativeTextCompilation,
  stores: NativeStrokeTextStores,
  fonts: readonly NativePdfFont[],
  pageBounds: DensePdfBounds,
  maxPaths: number,
  maxCoordinates: number,
  signal?: AbortSignal
): { glyphToInstance: Int32Array | null; approximated: boolean } {
  if (!sidecar.glyphStrokePaints?.some(paint => paint && paint.color[3] > 1e-3)) {
    return { glyphToInstance: null, approximated: false };
  }
  const glyphToInstance = new Int32Array(text.glyphs.glyphIds.length).fill(-1);
  const metaA: number[] = [], metaB: number[] = [];
  const instanceA: number[] = [], instanceB: number[] = [], instanceC: number[] = [];
  const segmentsA: number[] = [], segmentsB: number[] = [];
  const atlas = new Map<string, { index: number; bounds: NativeGlyphStrokeGeometry["bounds"]; approximated: boolean } | null>();
  const clipRects = Array.from(stores.clipRects ?? []), clipIndices = new Map<string, number>();
  for (let i = 0; i < clipRects.length; i += 4) clipIndices.set(clipRects.slice(i, i + 4).join(":"), i / 4 + 1);
  let approximated = false;
  for (let run = 0; run < sidecar.glyphRunMeta.length / 3; run++) {
    const stroke = sidecar.glyphStrokePaints[run];
    if (!stroke || stroke.color[3] <= 1e-3) continue;
    const first = sidecar.glyphRunMeta[run * 3], end = first + sidecar.glyphRunMeta[run * 3 + 1];
    const clip = sidecar.glyphClipBounds?.subarray(run * 4, run * 4 + 4);
    for (let glyph = first; glyph < end; glyph++) {
      throwIfAborted(signal);
      if ((text.glyphs.flags[glyph] & (1 << 2)) !== 0) {
        throw new PdfError("unsupported-content", "Type3 stroked text requires its glyph program.");
      }
      const fontIndex = text.glyphs.fontIndices[glyph], glyphId = text.glyphs.glyphIds[glyph];
      const transform = text.glyphs.transformIndices[glyph] * 6;
      const placement = text.transforms.values.subarray(transform, transform + 6);
      const key = nativeGlyphStrokeCacheKey(fontIndex, glyphId, placement, stroke);
      const cached = atlas.get(key);
      if (cached === null) continue;
      const geometry = cached ? null : buildNativeGlyphStrokeAtOrigin(fonts[fontIndex].getGlyphOutline(glyphId).commands, placement, stroke, signal);
      if (!cached && !geometry) { atlas.set(key, null); continue; }
      const outline = cached ?? geometry!;
      const x = placement[4], y = placement[5];
      const bounds = {
        minX: Math.max(outline.bounds.minX + x, pageBounds.minX, clip?.[0] ?? -Infinity),
        minY: Math.max(outline.bounds.minY + y, pageBounds.minY, clip?.[1] ?? -Infinity),
        maxX: Math.min(outline.bounds.maxX + x, pageBounds.maxX, clip?.[2] ?? Infinity),
        maxY: Math.min(outline.bounds.maxY + y, pageBounds.maxY, clip?.[3] ?? Infinity)
      };
      if (bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) continue;
      let geometryIndex = cached?.index;
      const addedCoordinates = geometry ? geometry.segmentsA.length + geometry.segmentsB.length : 0;
      if (compiled.pathCount + stores.glyphMetaA.length / 4 + instanceA.length / 4 + 1 > maxPaths ||
          compiled.fillSegmentsA.length + compiled.fillSegmentsB.length + compiled.endpoints.length +
            stores.glyphSegmentsA.length + stores.glyphSegmentsB.length +
            segmentsA.length + segmentsB.length + addedCoordinates > maxCoordinates) {
        throw new PdfError("resource-limit", "Outlined text exceeds the page geometry limit.", {
          details: { reason: "vector-glyph-stroke-limit", maxPaths, maxCoordinates }
        });
      }
      if (geometryIndex === undefined && geometry) {
        geometryIndex = (stores.glyphMetaA.length + metaA.length) / 4;
        atlas.set(key, { index: geometryIndex, bounds: geometry.bounds, approximated: geometry.approximated });
        metaA.push((stores.glyphSegmentsA.length + segmentsA.length) / 4, geometry.segmentsA.length / 4,
          outline.bounds.minX, outline.bounds.minY);
        metaB.push(outline.bounds.maxX, outline.bounds.maxY, 0, 0);
        segmentsA.push(...geometry.segmentsA); segmentsB.push(...geometry.segmentsB);
      }
      let clipReference = 0;
      if (bounds.minX > outline.bounds.minX + x || bounds.minY > outline.bounds.minY + y ||
          bounds.maxX < outline.bounds.maxX + x || bounds.maxY < outline.bounds.maxY + y) {
        const rectangle = [Math.max(pageBounds.minX, clip?.[0] ?? -Infinity), Math.max(pageBounds.minY, clip?.[1] ?? -Infinity),
          Math.min(pageBounds.maxX, clip?.[2] ?? Infinity), Math.min(pageBounds.maxY, clip?.[3] ?? Infinity)];
        const clipKey = rectangle.join(":");
        clipReference = clipIndices.get(clipKey) ?? 0;
        if (!clipReference) { clipReference = clipRects.length / 4 + 1; clipIndices.set(clipKey, clipReference); clipRects.push(...rectangle); }
      }
      glyphToInstance[glyph] = (stores.instanceA.length + instanceA.length) / 4;
      instanceA.push(1, 0, 0, 1);
      instanceB.push(x, y, geometryIndex!, clipReference);
      instanceC.push(...stroke.color);
      approximated ||= outline.approximated;
    }
  }
  const append = (base: Float32Array, added: number[]): Float32Array => {
    if (added.length === 0) return base;
    const result = new Float32Array(base.length + added.length);
    result.set(base); result.set(added, base.length);
    return result;
  };
  stores.clipRects = Float32Array.from(clipRects);
  stores.instanceA = append(stores.instanceA, instanceA);
  stores.instanceB = append(stores.instanceB, instanceB);
  stores.instanceC = append(stores.instanceC, instanceC);
  stores.glyphMetaA = append(stores.glyphMetaA, metaA);
  stores.glyphMetaB = append(stores.glyphMetaB, metaB);
  stores.glyphSegmentsA = append(stores.glyphSegmentsA, segmentsA);
  stores.glyphSegmentsB = append(stores.glyphSegmentsB, segmentsB);
  return { glyphToInstance, approximated };
}
