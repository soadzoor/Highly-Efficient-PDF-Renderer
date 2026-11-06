import type { Bounds, PageTextIndex, VectorScene } from "./pdfVectorExtractor";
import { GRADIENT_LUT_WIDTH } from "./pdfVectorExtractor";
import type { EditorObject, EditorRecoveryFont, EditorSelectionFrame } from "./editorTypes";
import type { EditorCapturedSource } from "./editorClipboard";
import { createEmptyVectorScene } from "./emptyVectorScene";
import { encodeEditorRecoveryGraph, decodeEditorRecoveryGraph } from "./editorRecoveryCodec";
import { validatePagePrimitiveRanges, PAGE_PRIMITIVE_KINDS, scenePrimitiveCounts } from "./scenePageViews";
import { validateVectorDrawRuns } from "./vectorDrawOrder";
import { validateScenePaintGraph, type ScenePaintNode } from "./scenePaintGraph";
import { validateSceneOptionalContentReferences, createDefaultOptionalContentSnapshot } from "./optionalContent";
import { validateSceneRetainedPages } from "./retainedPageData";
import { editorPaintRole, setEditorPaintRole, type EditorPaintRole } from "./editorPaintIdentity";
import type { PrimitiveKind } from "./scenePrimitives";
import { validateRasterLayerUpdates } from "./rasterLayerUpdates";
import { isSourceJpxRaster } from "./sourceJpxRaster";
import { validateGradientMesh } from "./hepGradientMesh";

const roleValues: readonly EditorPaintRole[] = [null, "color", "fill"];

export interface PortableEditorClipboard {
  format: "hepr-editor-clipboard";
  version: 1;
  roots: string[];
  objects: Map<string, EditorObject>;
  sources: Map<string, EditorCapturedSource>;
  paintRoles: Map<string, Record<PrimitiveKind, Uint8Array>>;
  bounds: Bounds;
  basis?: EditorSelectionFrame["transform"];
  fonts: readonly EditorRecoveryFont[];
}

/** Copy the selected geometry stores, never arbitrary document/session metadata. */
export function portableEditorSourceScene(scene: VectorScene, bounds: Bounds): { scene: VectorScene; retained: boolean } {
  const result = createEmptyVectorScene();
  for (const key of [...Object.keys(result), "pagePrimitiveRanges", "drawRuns", "clipPaths", "paintGraph", "optionalContent",
    "textClipRects", "gradientMeshRanges", "gradientMeshPositions", "gradientMeshColors", "gradientMeshIndices"] as (keyof VectorScene)[]) {
    if (scene[key] !== undefined) Object.assign(result, { [key]: scene[key] });
  }
  let retained = false;
  const nodes = (input: readonly ScenePaintNode[]): ScenePaintNode[] => input.map(node => {
    if (node.kind === "group") return { ...node, children: nodes(node.children),
      ...(node.softMask ? { softMask: { ...node.softMask, children: nodes(node.softMask.children) } } : {}) };
    if (node.kind !== "retained") return { ...node };
    retained = true;
    const runIndex = result.drawRuns?.findIndex(run => run.kind === "raster" && run.first === node.rasterIndex && run.count === 1) ?? -1;
    if (runIndex < 0) throw new TypeError("Copied retained artwork has no frozen raster appearance.");
    return { kind: "draw", runIndex, ...(node.optionalContent === undefined ? {} : { optionalContent: node.optionalContent }) };
  });
  if (result.paintGraph) result.paintGraph = { roots: nodes(result.paintGraph.roots) };
  result.rasterLayers = result.rasterLayers.map(layer => ({ width: layer.width, height: layer.height,
    data: layer.monochrome ? new Uint8Array() : layer.data, matrix: layer.matrix, paintOrder: layer.paintOrder, pageIndex: layer.pageIndex,
    ...(layer.monochrome ? { monochrome: { data: layer.monochrome.data, colors: layer.monochrome.colors } } : {}),
    ...(layer.sourceJpx ? { sourceJpx: layer.sourceJpx } : {}), ...(layer.repeat ? { repeat: layer.repeat } : {}),
    ...(layer.opacity === undefined ? {} : { opacity: layer.opacity }), ...(layer.interpolate === undefined ? {} : { interpolate: layer.interpolate }) }));
  const primary = result.rasterLayers[0];
  result.rasterLayerData = primary?.data ?? new Uint8Array(); result.rasterLayerWidth = primary?.width ?? 0;
  result.rasterLayerHeight = primary?.height ?? 0; result.rasterLayerMatrix = primary?.matrix ?? Float32Array.of(1, 0, 0, 1, 0, 0);
  if (result.textIndex) result.textIndex = { version: 2, pages: result.textIndex.pages.map(page => portableTextIndex(page, bounds, result)) };
  if (result.optionalContent) {
    const defaults = createDefaultOptionalContentSnapshot(result);
    result.optionalContent = { groups: [], order: [], radioGroups: [],
      conditions: Array.from(defaults.conditions, value => ({ kind: "constant" as const, value: Boolean(value) })) };
  }
  setEditorPaintRole(result, editorPaintRole(scene));
  return { scene: result, retained };
}

/** Fallback OCR from unrelated page regions must not enter a copied appearance. */
function portableTextIndex(page: PageTextIndex, bounds: Bounds, scene: VectorScene): PageTextIndex {
  // OCR has no glyph ownership. Keep it only when the complete quad belongs to
  // a selected image; a vector's bounding box can surround unrelated page text.
  const rasterFootprints = scene.rasterLayers.filter(layer => !layer.repeat).map(layer => layer.matrix);
  const ownsQuad = (quads: Float32Array, offset: number): boolean => rasterFootprints.some(matrix => {
    const [a, b, c, d, e, f] = matrix, det = a * d - b * c;
    if (!Number.isFinite(det) || det === 0) return false;
    for (let corner = 0; corner < 4; corner++) {
      const x = quads[offset + (corner & 1 ? 2 : 0)] - e, y = quads[offset + (corner & 2 ? 3 : 1)] - f;
      const u = (d * x - c * y) / det, v = (a * y - b * x) / det;
      if (u < 0 || u > 1 || v < 0 || v > 1) return false;
    }
    return true;
  });
  let text = "", separator = "";
  const refs: number[] = [], fallback: number[] = [], conditions: number[] = [], mapped = new Map<number, number>();
  for (let i = 0; i < page.text.length; i++) {
    const ref = page.charInstance[i];
    if (ref === -1) { if (text) separator = /\s/.test(page.text[i]) ? page.text[i] : " "; continue; }
    let next = ref;
    if (ref <= -2) {
      const offset = (-ref - 2) * 4, q = page.fallbackQuads;
      if (offset < 0 || offset + 3 >= q.length || q[offset] < bounds.minX || q[offset + 1] < bounds.minY ||
          q[offset + 2] > bounds.maxX || q[offset + 3] > bounds.maxY || !ownsQuad(q, offset)) { separator = text ? " " : ""; continue; }
      const previous = mapped.get(ref);
      if (previous === undefined) { next = -2 - fallback.length / 4; mapped.set(ref, next); fallback.push(...q.subarray(offset, offset + 4)); }
      else next = previous;
    }
    if (separator) { text += separator; refs.push(-1); conditions.push(-1); separator = ""; }
    text += page.text[i]; refs.push(next); conditions.push(page.optionalContent?.[i] ?? -1);
  }
  return { text, charInstance: Int32Array.from(refs), fallbackQuads: Float32Array.from(fallback),
    ...(page.optionalContent ? { optionalContent: Int32Array.from(conditions) } : {}) };
}

function bounds(value: Bounds): void {
  if (!value || ![value.minX, value.minY, value.maxX, value.maxY].every(Number.isFinite) || value.minX > value.maxX || value.minY > value.maxY)
    throw new TypeError("Invalid portable clipboard bounds.");
}
function matrix(value: EditorSelectionFrame["transform"]): void {
  if (!Array.isArray(value) || value.length !== 6 || !value.every(Number.isFinite))
    throw new TypeError("Invalid portable clipboard transform.");
  const determinant = value[0] * value[3] - value[1] * value[2];
  if (!Number.isFinite(determinant) || determinant === 0) throw new TypeError("Invalid portable clipboard transform.");
}
function validateScene(scene: VectorScene): void {
  if (!scene || scene.pageCount !== 1 || !(scene.pageRects instanceof Float32Array) || scene.pageRects.length !== 4 ||
      !scene.pageRects.every(Number.isFinite) || !Array.isArray(scene.rasterLayers)) throw new TypeError("Invalid portable clipboard scene.");
  bounds(scene.bounds); bounds(scene.pageBounds);
  const stores: readonly [keyof VectorScene, readonly (keyof VectorScene)[]][] = [
    ["segmentCount", ["endpoints", "primitiveMeta", "primitiveBounds", "styles"]],
    ["fillPathCount", ["fillPathMetaA", "fillPathMetaB", "fillPathMetaC"]], ["fillSegmentCount", ["fillSegmentsA", "fillSegmentsB"]],
    ["gradientCount", ["gradientMetaA", "gradientMetaB", "gradientMetaC", "gradientMetaD", "gradientMetaE"]],
    ["gradientFillPathCount", ["gradientFillPathMetaA", "gradientFillPathMetaB", "gradientFillPathMetaC", "gradientFillPaintMeta"]],
    ["gradientFillSegmentCount", ["gradientFillSegmentsA", "gradientFillSegmentsB"]],
    ["gradientStrokeRunCount", ["gradientStrokeRunMetaA", "gradientStrokeRunMetaB"]],
    ["gradientStrokeSegmentCount", ["gradientStrokeEndpoints", "gradientStrokePrimitiveMeta", "gradientStrokePrimitiveBounds", "gradientStrokeStyles"]],
    ["textInstanceCount", ["textInstanceA", "textInstanceB", "textInstanceC"]], ["textGlyphCount", ["textGlyphMetaA", "textGlyphMetaB"]],
    ["textGlyphSegmentCount", ["textGlyphSegmentsA", "textGlyphSegmentsB"]]
  ];
  for (const [countKey, keys] of stores) {
    const count = scene[countKey];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) throw new TypeError("Invalid portable clipboard store count.");
    for (const key of keys) if (!(scene[key] instanceof Float32Array) || (scene[key] as Float32Array).length !== count * 4 || !(scene[key] as Float32Array).every(Number.isFinite))
      throw new TypeError("Invalid portable clipboard geometry store.");
  }
  const range = (array: Float32Array, count: number): void => {
    for (let i = 0; i < array.length; i += 4) if (!Number.isSafeInteger(array[i]) || !Number.isSafeInteger(array[i + 1]) ||
      array[i] < 0 || array[i + 1] < 0 || array[i] + array[i + 1] > count) throw new RangeError("Copied geometry exceeds its segment store.");
  };
  range(scene.fillPathMetaA, scene.fillSegmentCount); range(scene.gradientFillPathMetaA, scene.gradientFillSegmentCount);
  range(scene.gradientStrokeRunMetaA, scene.gradientStrokeSegmentCount); range(scene.textGlyphMetaA, scene.textGlyphSegmentCount);
  if (scene.textClipRects !== undefined && (!(scene.textClipRects instanceof Float32Array) || scene.textClipRects.length % 4 ||
      !scene.textClipRects.every(Number.isFinite))) throw new TypeError("Invalid copied text clip rectangles.");
  for (let i = 2; i < scene.textInstanceB.length; i += 4) {
    if (!Number.isSafeInteger(scene.textInstanceB[i]) || scene.textInstanceB[i] < 0 || scene.textInstanceB[i] >= scene.textGlyphCount)
      throw new RangeError("Copied text references an unknown glyph.");
    const clip = scene.textInstanceB[i + 1];
    if (!Number.isSafeInteger(clip) || clip < 0 || clip > (scene.textClipRects?.length ?? 0) / 4)
      throw new RangeError("Copied text references an unknown clip rectangle.");
  }
  const gradientRef = (value: number): void => {
    if (!Number.isSafeInteger(value) || value < -1 || value >= scene.gradientCount) throw new RangeError("Copied paint references an unknown gradient.");
  };
  for (let i = 0; i < scene.gradientFillPaintMeta.length; i += 4) { gradientRef(scene.gradientFillPaintMeta[i]); gradientRef(scene.gradientFillPaintMeta[i + 1]); }
  for (let i = 0; i < scene.gradientStrokeRunMetaA.length; i += 4) { gradientRef(scene.gradientStrokeRunMetaA[i + 2]); gradientRef(scene.gradientStrokeRunMetaA[i + 3]); }
  validateGradientMesh(scene);
  if (!(scene.gradientLut instanceof Uint8Array) || scene.gradientLut.length !== scene.gradientCount * GRADIENT_LUT_WIDTH * 4 ||
      !(scene.pageTextRanges instanceof Uint32Array) || scene.pageTextRanges.length !== 2 ||
      scene.pageTextRanges[0] !== 0 || scene.pageTextRanges[1] !== scene.textInstanceCount) throw new TypeError("Invalid portable clipboard page stores.");
  for (const layer of scene.rasterLayers) {
    if (!layer || !Number.isSafeInteger(layer.width) || layer.width < 1 || !Number.isSafeInteger(layer.height) || layer.height < 1 ||
        !(layer.data instanceof Uint8Array) || !(layer.matrix instanceof Float32Array) || layer.matrix.length !== 6 ||
        !layer.matrix.every(Number.isFinite) || layer.pageIndex !== 0 || layer.sourceJpx !== undefined && !isSourceJpxRaster(layer.sourceJpx))
      throw new TypeError("Invalid portable clipboard image.");
  }
  validateRasterLayerUpdates(scene, new Map(scene.rasterLayers.map((layer, index) => [index, layer])));
  if (scene.textIndex) {
    if (scene.textIndex.version !== 2 || !Array.isArray(scene.textIndex.pages) || scene.textIndex.pages.length !== 1) throw new TypeError("Invalid copied text index.");
    const page = scene.textIndex.pages[0];
    if (!page || typeof page.text !== "string" || !(page.charInstance instanceof Int32Array) || page.charInstance.length !== page.text.length ||
        !(page.fallbackQuads instanceof Float32Array) || page.fallbackQuads.length % 4 !== 0 || !page.fallbackQuads.every(Number.isFinite) ||
        page.charInstance.some(ref => ref >= scene.textInstanceCount || ref <= -2 && (-ref - 2) * 4 + 3 >= page.fallbackQuads.length)) throw new TypeError("Invalid copied text references.");
  }
  if (scene.annotations || scene.pdfPages || scene.documentAuthoring || scene.textContent || scene.retainedPages)
    throw new TypeError("Portable clipboard contains unrelated document metadata.");
  validatePagePrimitiveRanges(scene); validateVectorDrawRuns(scene); validateSceneOptionalContentReferences(scene);
  validateSceneRetainedPages(scene); validateScenePaintGraph(scene);
}

export function encodePortableEditorClipboard(value: Omit<PortableEditorClipboard, "paintRoles">): Uint8Array {
  const paintRoles = new Map([...value.sources].map(([id, capture]) => {
    const counts = scenePrimitiveCounts(capture.scene), role = editorPaintRole(capture.scene);
    return [id, Object.fromEntries(PAGE_PRIMITIVE_KINDS.map(kind => [kind, Uint8Array.from({ length: counts[kind] }, (_, index) => roleValues.indexOf(role({ kind, index })))]))];
  }));
  return encodeEditorRecoveryGraph({ ...value, paintRoles });
}
export function decodePortableEditorClipboard(bytes: Uint8Array, validateObject: (object: EditorObject, pageCount: number) => void): PortableEditorClipboard {
  const value = decodeEditorRecoveryGraph(bytes) as PortableEditorClipboard;
  if (value?.format !== "hepr-editor-clipboard" || value.version !== 1 || !Array.isArray(value.roots) || !value.roots.length ||
      !(value.objects instanceof Map) || !(value.sources instanceof Map) || !(value.paintRoles instanceof Map) || !Array.isArray(value.fonts)) throw new TypeError("Unsupported editor clipboard data.");
  bounds(value.bounds); if (value.basis) matrix(value.basis);
  const visited = new Set<string>(), visiting = new Set<string>();
  const visit = (id: string): void => {
    if (typeof id !== "string" || !value.objects.has(id) || visiting.has(id) || visited.has(id)) throw new TypeError("Invalid copied object group.");
    const object = value.objects.get(id)!;
    if (!object || object.id !== id || object.pageIndex !== 0) throw new TypeError("Invalid copied object identity.");
    validateObject(object, 1); visiting.add(id);
    if (object.layerId !== undefined || object.layerCondition !== undefined || object.kind === "text" && object.pageNumberingId)
      throw new TypeError("Copied objects reference source document metadata.");
    if (object.link && (object.link.type === "destination" || object.link.type === "object" && !value.objects.has(object.link.objectId)))
      throw new TypeError("Copied link references another document.");
    if (object.kind === "group") {
      if (!Array.isArray(object.children) || !object.children.length) throw new TypeError("Invalid copied object group.");
      object.children.forEach(visit);
    } else if (object.kind === "source") {
      const capture = value.sources.get(id);
      if (!capture || !capture.scene || !capture.frame || !object.isClone || !Array.isArray(object.primitives) || object.primitives.length || object.annotationId)
        throw new TypeError("Copied source artwork is incomplete.");
      bounds(object.bounds); bounds(capture.frame.bounds); matrix(capture.frame.transform);
      if (capture.frame.pageIndex !== 0) throw new TypeError("Copied source frame references another page.");
      validateScene(capture.scene);
      const roles = value.paintRoles.get(id), counts = scenePrimitiveCounts(capture.scene);
      if (!roles || PAGE_PRIMITIVE_KINDS.some(kind => !(roles[kind] instanceof Uint8Array) || roles[kind].length !== counts[kind] ||
          roles[kind].some(role => role >= roleValues.length))) throw new TypeError("Invalid copied paint roles.");
      setEditorPaintRole(capture.scene, ref => roleValues[roles[ref.kind][ref.index]]);
    }
    visiting.delete(id); visited.add(id);
  };
  value.roots.forEach(visit);
  if (visited.size !== value.objects.size || [...value.sources.keys()].some(id => value.objects.get(id)?.kind !== "source"))
    throw new TypeError("Clipboard contains unreachable copied objects.");
  const ids = new Set<string>();
  for (const font of value.fonts) {
    if (!font || typeof font.id !== "string" || !font.id || ids.has(font.id) || typeof font.family !== "string" ||
        !Number.isFinite(font.fontWeight) || !["normal", "italic"].includes(font.fontStyle) || !(font.bytes instanceof Uint8Array) || font.bytes.length < 12)
      throw new TypeError("Invalid copied font asset.");
    ids.add(font.id);
  }
  for (const object of value.objects.values()) if (object.kind === "text" || object.kind === "field") {
    for (const style of [object, ...(object.kind === "text" ? object.runs ?? [] : [])]) if (style.fontId !== undefined &&
        (typeof style.fontId !== "string" || !ids.has(style.fontId))) throw new TypeError("Copied text is missing its font assets.");
  }
  return value;
}
