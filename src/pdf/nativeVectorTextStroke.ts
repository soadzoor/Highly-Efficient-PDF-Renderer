import type { DensePdfCompiledPage, DensePdfVectorSceneData, DensePdfBounds } from "./nativeContentCompiler";
import type { NativePdfFont } from "./nativeFont";
import type { NativeTextCompilation } from "./nativeText";
import { buildNativeGlyphStrokeAtOrigin, nativeGlyphStrokeCacheKey, type NativeGlyphStrokeGeometry } from "./nativeGlyphStroke";
import type { VectorScene, VectorDrawRun } from "../pdfVectorExtractor";
import type { ScenePaintNode } from "../scenePaintGraph";
import { buildNativeGlyphHairline } from "./nativeGlyphHairline";
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

interface NativeHairlineTextStrokes {
  endpoints: number[];
  primitiveMeta: number[];
  primitiveBounds: number[];
  styles: number[];
  /** Per source glyph, the first packed stroke and its count. */
  glyphRanges: Uint32Array;
  glyphAlphas: Float32Array;
  bounds: DensePdfBounds;
  glyphCount: number;
}

/** Fixed-width strokes use filled outlines; device hairlines use packed vector strokes. */
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
): { glyphToInstance: Int32Array | null; hairlines: NativeHairlineTextStrokes | null; approximated: boolean; approximateHairlineStyle: boolean } {
  if (!sidecar.glyphStrokePaints?.some(paint => paint && paint.color[3] > 1e-3)) {
    return { glyphToInstance: null, hairlines: null, approximated: false, approximateHairlineStyle: false };
  }
  const glyphToInstance = new Int32Array(text.glyphs.glyphIds.length).fill(-1);
  const metaA: number[] = [], metaB: number[] = [];
  const instanceA: number[] = [], instanceB: number[] = [], instanceC: number[] = [];
  const segmentsA: number[] = [], segmentsB: number[] = [];
  const atlas = new Map<string, { index: number; bounds: NativeGlyphStrokeGeometry["bounds"]; approximated: boolean } | null>();
  const hairlineAtlas = new Map<string, ReturnType<typeof buildNativeGlyphHairline>>();
  let hairlines: NativeHairlineTextStrokes | null = null;
  const clipRects = Array.from(stores.clipRects ?? []), clipIndices = new Map<string, number>();
  for (let i = 0; i < clipRects.length; i += 4) clipIndices.set(clipRects.slice(i, i + 4).join(":"), i / 4 + 1);
  let approximated = false;
  let approximateHairlineStyle = false;
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
      if (stroke.width === 0) {
        let geometry = hairlineAtlas.get(key);
        if (geometry === undefined) {
          geometry = buildNativeGlyphHairline(fonts[fontIndex].getGlyphOutline(glyphId).commands,
            [placement[0], placement[1], placement[2], placement[3], 0, 0], stroke, signal);
          hairlineAtlas.set(key, geometry);
        }
        if (!geometry) continue;
        const x = placement[4], y = placement[5];
        const bounds = {
          minX: Math.max(geometry.bounds.minX + x, pageBounds.minX, clip?.[0] ?? -Infinity),
          minY: Math.max(geometry.bounds.minY + y, pageBounds.minY, clip?.[1] ?? -Infinity),
          maxX: Math.min(geometry.bounds.maxX + x, pageBounds.maxX, clip?.[2] ?? Infinity),
          maxY: Math.min(geometry.bounds.maxY + y, pageBounds.maxY, clip?.[3] ?? Infinity)
        };
        if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) continue;
        hairlines ??= { endpoints: [], primitiveMeta: [], primitiveBounds: [], styles: [],
          glyphRanges: new Uint32Array(text.glyphs.glyphIds.length * 2),
          glyphAlphas: new Float32Array(text.glyphs.glyphIds.length), glyphCount: 0,
          bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity } };
        const count = geometry.endpoints.length / 4;
        if (compiled.pathCount + stores.glyphMetaA.length / 4 + instanceA.length / 4 +
              hairlines.endpoints.length / 4 + count > maxPaths ||
            compiled.fillSegmentsA.length + compiled.fillSegmentsB.length + compiled.endpoints.length +
              stores.glyphSegmentsA.length + stores.glyphSegmentsB.length + segmentsA.length + segmentsB.length +
              hairlines.endpoints.length * 4 + geometry.endpoints.length * 4 > maxCoordinates) {
          throw new PdfError("resource-limit", "Hairline text exceeds the page geometry limit.", {
            details: { reason: "vector-glyph-stroke-limit", maxPaths, maxCoordinates }
          });
        }
        hairlines.glyphRanges.set([compiled.segmentCount + hairlines.endpoints.length / 4, count], glyph * 2);
        for (let offset = 0; offset < geometry.endpoints.length; offset += 4) {
          const e = geometry.endpoints, m = geometry.primitiveMeta, b = geometry.primitiveBounds;
          hairlines.endpoints.push(e[offset] + x, e[offset + 1] + y, e[offset + 2] + x, e[offset + 3] + y);
          hairlines.primitiveMeta.push(m[offset] + x, m[offset + 1] + y, m[offset + 2], m[offset + 3] - 1 + stroke.color[3]);
          hairlines.primitiveBounds.push(b[offset] + x, b[offset + 1] + y, b[offset + 2] + x, b[offset + 3] + y);
          hairlines.styles.push(0, stroke.color[0], stroke.color[1], stroke.color[2]);
        }
        hairlines.glyphAlphas[glyph] = stroke.color[3];
        hairlines.glyphCount++;
        hairlines.bounds.minX = Math.min(hairlines.bounds.minX, bounds.minX);
        hairlines.bounds.minY = Math.min(hairlines.bounds.minY, bounds.minY);
        hairlines.bounds.maxX = Math.max(hairlines.bounds.maxX, bounds.maxX);
        hairlines.bounds.maxY = Math.max(hairlines.bounds.maxY, bounds.maxY);
        approximated ||= geometry.approximated;
        approximateHairlineStyle ||= geometry.approximateStyle;
        continue;
      }
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
      if (compiled.pathCount + stores.glyphMetaA.length / 4 + instanceA.length / 4 + (hairlines?.endpoints.length ?? 0) / 4 + 1 > maxPaths ||
          compiled.fillSegmentsA.length + compiled.fillSegmentsB.length + compiled.endpoints.length +
            stores.glyphSegmentsA.length + stores.glyphSegmentsB.length +
            segmentsA.length + segmentsB.length + (hairlines?.endpoints.length ?? 0) * 4 + addedCoordinates > maxCoordinates) {
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
  return { glyphToInstance, hairlines, approximated, approximateHairlineStyle };
}

/** Paint a translucent glyph's overlapping contour segments with opacity once. */
export function applyNativeHairlineTextOpacity(scene: VectorScene, hairlines: NativeHairlineTextStrokes | null): void {
  if (!hairlines || !scene.drawRuns) return;
  const spans: { first: number; count: number; alpha: number }[] = [];
  for (let glyph = 0; glyph < hairlines.glyphAlphas.length; glyph++) {
    const count = hairlines.glyphRanges[glyph * 2 + 1], alpha = hairlines.glyphAlphas[glyph];
    if (count && alpha < 1) spans.push({ first: hairlines.glyphRanges[glyph * 2], count, alpha });
  }
  if (!spans.length) return;
  spans.sort((a, b) => a.first - b.first);
  const runs: VectorDrawRun[] = [], roots: ScenePaintNode[] = [];
  const append = (run: VectorDrawRun, alpha?: number): void => {
    const runIndex = runs.length;
    if (alpha === undefined) { runs.push(run); roots.push({ kind: "draw", runIndex }); return; }
    const blendMode = run.blendMode ?? "Normal";
    const opaque = { ...run }; delete opaque.blendMode;
    runs.push(opaque);
    roots.push({ kind: "group", alpha, isolated: true, knockout: false, blendMode,
      children: [{ kind: "draw", runIndex }], ...(run.optionalContent === undefined ? {} : { optionalContent: run.optionalContent }) });
    for (let i = run.first; i < run.first + run.count; i++) {
      const offset = i * 4 + 3;
      scene.primitiveMeta[offset] = Math.floor(scene.primitiveMeta[offset] / 2) * 2 + 1;
    }
  };
  for (const run of scene.drawRuns) {
    if (run.kind !== "stroke") { append(run); continue; }
    let first = run.first;
    const end = first + run.count;
    // Runs are source ordered, so their packed ranges need not be monotonic.
    let lo = 0, hi = spans.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (spans[mid].first + spans[mid].count <= first) lo = mid + 1; else hi = mid; }
    for (let index = lo; index < spans.length && spans[index].first < end; index++) {
      const span = spans[index], start = Math.max(first, span.first), stop = Math.min(end, span.first + span.count);
      if (start > first) append({ ...run, first, count: start - first });
      append({ ...run, first: start, count: stop - start }, span.alpha);
      first = stop;
    }
    if (first < end) append({ ...run, first, count: end - first });
  }
  scene.drawRuns = runs;
  scene.paintGraph = { roots };
}
