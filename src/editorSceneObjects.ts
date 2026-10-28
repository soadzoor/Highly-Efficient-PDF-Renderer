import { createEmptyVectorScene } from "./emptyVectorScene";
import { buildStrokeScene } from "./strokeSceneBuilder";
import { normalizePrimitiveColor } from "./primitiveAppearance";
import { composeEditorPage, editorUnionBounds } from "./editorScene";
import type { EditorObject, EditorShapeObject } from "./editorTypes";
import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import { editorInkBounds, fitEditorInkPaths, type EditorInkSegment } from "./editorInkGeometry";

type Point = readonly [number, number];
/** The same local arrowhead is used for rendering and interaction bounds. */
export function editorArrowHeadPoints(object: EditorShapeObject): readonly Point[] {
  const endpoints = object.points?.length === 2 ? object.points : [[object.x, object.y], [object.x + object.width, object.y + object.height]];
  const start = endpoints[0], end = endpoints[1], [x, y] = end;
  const angle = Math.atan2(end[1] - start[1], end[0] - start[0]), size = Math.max((object.strokeWidth ?? 1) * 4, 8);
  return [[x, y], [x - size * Math.cos(angle - Math.PI / 6), y - size * Math.sin(angle - Math.PI / 6)],
    [x - size * Math.cos(angle + Math.PI / 6), y - size * Math.sin(angle + Math.PI / 6)]];
}
function page(scene: VectorScene, bounds: Bounds): VectorScene {
  scene.pageCount = 1; scene.pagesPerRow = 1;
  scene.pageRects = Float32Array.of(bounds.minX, bounds.minY, bounds.maxX === bounds.minX ? bounds.maxX + 1 : bounds.maxX,
    bounds.maxY === bounds.minY ? bounds.maxY + 1 : bounds.maxY);
  scene.pageTextRanges = Uint32Array.of(0, scene.textInstanceCount); scene.bounds = { ...bounds }; scene.pageBounds = { ...bounds }; return scene;
}
function polygon(points: readonly Point[], color: EditorShapeObject["fill"], opacity: number): VectorScene {
  const scene = createEmptyVectorScene(); if (points.length < 3 || color === null || color === undefined) return scene;
  const rgb = normalizePrimitiveColor(color), a: number[] = [], b: number[] = [];
  for (let index = 0; index < points.length; index++) {
    const next = points[(index + 1) % points.length]; a.push(...points[index], 0, 0); b.push(...next, 0, 0);
  }
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of points) { bounds.minX = Math.min(bounds.minX, x); bounds.minY = Math.min(bounds.minY, y); bounds.maxX = Math.max(bounds.maxX, x); bounds.maxY = Math.max(bounds.maxY, y); }
  Object.assign(scene, { fillPathCount: 1, fillSegmentCount: points.length, pathCount: 1,
    fillPathMetaA: Float32Array.of(0, points.length, bounds.minX, bounds.minY), fillPathMetaB: Float32Array.of(bounds.maxX, bounds.maxY, rgb[0], rgb[1]),
    fillPathMetaC: Float32Array.of(0, 0, rgb[2], opacity), fillSegmentsA: Float32Array.from(a), fillSegmentsB: Float32Array.from(b),
    drawRuns: [{ kind: "fill", first: 0, count: 1 }] }); return page(scene, bounds);
}

function inkStroke(paths: readonly (readonly EditorInkSegment[])[], color: EditorShapeObject["color"], width: number, signal?: AbortSignal): VectorScene {
  const scene = createEmptyVectorScene(), count = paths.reduce((sum, path) => sum + path.length, 0), rgb = normalizePrimitiveColor(color ?? 0);
  const half = Math.fround(width / 2), flags = 2 | (width === 0 ? 1 : 0);
  if (!Number.isFinite(width) || width < 0 || !Number.isFinite(Math.fround(width)) || width > 0 && half === 0) throw new RangeError("Stroke width must be nonnegative and float32-representable.");
  const a = new Float32Array(count * 4), b = new Float32Array(count * 4), bounds = new Float32Array(count * 4), styles = new Float32Array(count * 4);
  let offset = 0;
  for (const path of paths) for (const segment of path) {
    signal?.throwIfAborted();
    const { start, control, end } = segment, c = control ?? end;
    if (![...start, ...c, ...end].every(value => Number.isFinite(Math.fround(value)))) throw new RangeError("Ink coordinates exceed float32 range.");
    a.set([...start, ...c], offset); b.set([...end, control ? 1 : 0, 1 + flags * 2], offset);
    const box = editorInkBounds([[segment]])!;
    bounds.set([box.minX, box.minY, box.maxX, box.maxY], offset); styles.set([half, ...rgb], offset); offset += 4;
  }
  Object.assign(scene, { segmentCount: count, sourceSegmentCount: count, mergedSegmentCount: count,
    pathCount: paths.filter(path => path.length).length, endpoints: a, primitiveMeta: b, primitiveBounds: bounds, styles, maxHalfWidth: half });
  const box = editorInkBounds(paths);
  if (!box) return scene;
  const painted = { minX: box.minX - half, minY: box.minY - half, maxX: box.maxX + half, maxY: box.maxY + half };
  if (!Object.values(painted).every(value => Number.isFinite(Math.fround(value)))) throw new RangeError("Ink bounds exceed float32 range.");
  return page(scene, painted);
}

function inkFill(path: readonly EditorInkSegment[], color: EditorShapeObject["fill"], opacity: number, signal?: AbortSignal): VectorScene {
  const scene = createEmptyVectorScene(); if (!path.length || color === undefined || color === null) return scene;
  const segments = [...path], first = path[0].start, last = path[path.length - 1].end;
  if (first[0] !== last[0] || first[1] !== last[1]) segments.push({ start: last, end: first });
  const rgb = normalizePrimitiveColor(color), a = new Float32Array(segments.length * 4), b = new Float32Array(segments.length * 4);
  for (let i = 0; i < segments.length; i++) {
    signal?.throwIfAborted(); const { start, end, control } = segments[i];
    a.set([...start, ...(control ?? end)], i * 4); b.set([...end, control ? 1 : 0, 0], i * 4);
  }
  const box = editorInkBounds([segments])!;
  Object.assign(scene, { fillPathCount: 1, fillSegmentCount: segments.length, pathCount: 1,
    fillPathMetaA: Float32Array.of(0, segments.length, box.minX, box.minY), fillPathMetaB: Float32Array.of(box.maxX, box.maxY, rgb[0], rgb[1]),
    fillPathMetaC: Float32Array.of(0, 0, rgb[2], opacity), fillSegmentsA: a, fillSegmentsB: b,
    drawRuns: [{ kind: "fill", first: 0, count: 1 }] });
  return page(scene, box);
}

/** Compile editor geometry into the same canonical vectors as imported PDFs. */
export async function compileEditorObjectGeometry(object: EditorObject, signal?: AbortSignal): Promise<VectorScene> {
  signal?.throwIfAborted();
  const opacity = object.opacity ?? 1;
  if (object.kind === "text") throw new Error("Adding text requires the editor's portable font compiler.");
  if (object.kind === "source" || object.kind === "group") throw new Error("Source and group objects are compiled by the editor session.");
  if (object.kind === "image") {
    const scene = createEmptyVectorScene(), bounds = { minX: object.x, minY: object.y, maxX: object.x + object.width, maxY: object.y + object.height };
    scene.rasterLayers = [{ width: object.imageWidth, height: object.imageHeight, data: object.data,
      matrix: Float32Array.of(object.width, 0, 0, -object.height, object.x, object.y + object.height), paintOrder: 0, pageIndex: 0, opacity }];
    scene.rasterLayerWidth = object.imageWidth; scene.rasterLayerHeight = object.imageHeight; scene.rasterLayerData = object.data; scene.rasterLayerMatrix = scene.rasterLayers[0].matrix;
    scene.drawRuns = [{ kind: "raster", first: 0, count: 1 }]; return page(scene, bounds);
  }
  let paths: readonly (readonly Point[])[], curves: EditorInkSegment[][] | undefined, closed = false;
  if (object.kind === "ink" || object.kind === "signature") {
    paths = object.paths; curves = fitEditorInkPaths(paths, object.smoothing ?? 0, signal);
  }
  else {
    const { x, y, width, height } = object;
    if (object.shape === "ellipse") {
      // Bound centerline error in page points, independent of the number of marks.
      const radius = Math.max(width, height) / 2;
      // Subdivision below Float32 coordinate precision cannot improve the
      // canonical contour and would make very large valid coordinates stall.
      const tolerance = Math.max(0.002, radius * 2 ** -22), ratio = tolerance / Math.max(radius, tolerance);
      const angle = ratio < 1e-6 ? Math.sqrt(2 * ratio) : Math.acos(Math.max(-1, 1 - ratio));
      const count = Math.max(16, Math.ceil(Math.PI / angle));
      const points: Point[] = [];
      for (let i = 0; i < count; i++) { signal?.throwIfAborted(); const angle = i / count * Math.PI * 2; points.push([x + width / 2 * (1 + Math.cos(angle)), y + height / 2 * (1 + Math.sin(angle))]); }
      paths = [points]; closed = true;
    } else if (object.shape === "rectangle") { paths = [[[x, y], [x + width, y], [x + width, y + height], [x, y + height]]]; closed = true; }
    else if (object.shape === "polygon" || object.shape === "polyline") { paths = [object.points ?? []]; closed = object.shape === "polygon"; }
    else { paths = [object.points?.length === 2 ? object.points : [[x, y], [x + width, y + height]]]; }
  }
  const color = object.color ?? 0x000000, width = object.strokeWidth ?? 1;
  const stroke = curves ? inkStroke(curves, color, width, signal) : buildStrokeScene(paths.map(points => ({ points, closed, color, width })));
  if (opacity !== 1) {
    stroke.primitiveMeta = stroke.primitiveMeta.slice();
    for (let i = 3; i < stroke.primitiveMeta.length; i += 4) stroke.primitiveMeta[i] = Math.floor(stroke.primitiveMeta[i] / 2) * 2 + opacity;
  }
  const fills = object.fill !== null && object.fill !== undefined ? curves
    ? curves.flatMap((path, index) => paths[index].length >= 3 && path.length ? [inkFill(path, object.fill, opacity, signal)] : [])
    : paths.filter(points => points.length >= 3).map(points => polygon(points, object.fill, opacity)) : [];
  if (object.kind === "shape" && object.shape === "arrow") {
    fills.push(polygon(editorArrowHeadPoints(object), color, opacity));
  }
  if (!fills.length) return stroke;
  const first = fills.shift()!;
  const bounds = [first, ...fills, stroke].reduce<Bounds | null>((bounds, part) => part.pageCount ? editorUnionBounds(bounds, part.bounds) : bounds, null)!;
  return page(composeEditorPage(first, [...fills, stroke]), bounds);
}
