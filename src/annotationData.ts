import type { Bounds } from "./pdfVectorExtractor";
import type { PdfBox, PdfMatrix } from "./heprDocumentData";

/** Coordinates are pairs of x/y values; quad points retain the PDF's vertex order. */
export interface AnnotationGeometry {
  rect: PdfBox;
  quadPoints?: readonly number[];
  line?: readonly number[];
  vertices?: readonly number[];
  inkList?: readonly (readonly number[])[];
}

/** Destination coordinates remain in the target page's PDF default user space. */
export interface AnnotationDestination {
  name?: string;
  sourcePageIndex?: number;
  remotePageIndex?: number;
  fit?: string;
  parameters?: readonly (number | null)[];
}

/** Inert descriptions only. HEPR never executes PDF actions. */
export interface AnnotationAction {
  type: string;
  uri?: string;
  uriBase?: string;
  destination?: AnnotationDestination;
  file?: string;
  name?: string;
  next?: readonly AnnotationAction[];
}

export interface AnnotationBorder {
  width: number;
  style?: string;
  dash?: readonly number[];
  horizontalRadius?: number;
  verticalRadius?: number;
}

export interface AnnotationField {
  type?: string;
  name?: string;
  flags: number;
  value?: string | number | boolean | null | readonly string[];
  defaultValue?: string | number | boolean | null | readonly string[];
}

/** A detached, clone-safe annotation; no live PDF dictionaries or appearance bytes. */
export interface PdfAnnotation {
  /** Document-local identity, preserved through PDF compilation and HEP serialization. */
  id: string;
  sourcePageIndex: number;
  annotationIndex: number;
  subtype: string;
  /** Original, unscaled PDF geometry, before crop, rotation and page placement. */
  pdfGeometry: AnnotationGeometry;
  /** Page-native Y-up bounds; SceneAnnotation uses composed scene coordinates. */
  bounds: Bounds;
  quadPoints?: readonly number[];
  line?: readonly number[];
  vertices?: readonly number[];
  inkList?: readonly (readonly number[])[];
  flags: number;
  visibleInDefaultView: boolean;
  /** Index in the corresponding page/scene optional-content condition store. */
  optionalContent?: number;
  hasAppearance: boolean;
  contents?: string;
  tooltip?: string;
  author?: string;
  subject?: string;
  name?: string;
  creationDate?: string;
  modificationDate?: string;
  iconName?: string;
  open?: boolean;
  /** PDF color components: empty (transparent), Gray, RGB or CMYK. */
  color?: readonly number[];
  opacity?: number;
  border?: AnnotationBorder;
  popupId?: string;
  parentId?: string;
  replyToId?: string;
  replyType?: string;
  state?: string;
  stateModel?: string;
  field?: AnnotationField;
  action?: AnnotationAction;
  destination?: AnnotationDestination;
}

/** Identifies a displayed page and maps PDF default user space into its scene, including crop and rotation. */
export interface ScenePdfPage {
  pageIndex: number;
  sourcePageIndex: number;
  pdfToScene: PdfMatrix;
}

export function validateScenePdfPages(value: unknown, pageCount: number): asserts value is ScenePdfPage[] | undefined {
  if (value === undefined) return;
  const fail = (): never => { throw new Error("Invalid PDF page mapping metadata."); };
  if (!Array.isArray(value) || value.length > pageCount) fail();
  const slots = new Set<number>();
  for (const page of value as ScenePdfPage[]) {
    if (!page || !Number.isSafeInteger(page.pageIndex) || page.pageIndex < 0 || page.pageIndex >= pageCount ||
      slots.has(page.pageIndex) || !Number.isSafeInteger(page.sourcePageIndex) || page.sourcePageIndex < 0 ||
      !Array.isArray(page.pdfToScene) || page.pdfToScene.length !== 6 || ![...page.pdfToScene].every(Number.isFinite)) fail();
    const [a, b, c, d] = page.pdfToScene;
    if (!Number.isFinite(a * d - b * c) || a * d - b * c === 0) fail();
    slots.add(page.pageIndex);
  }
}

export interface SceneAnnotation extends PdfAnnotation {
  /** Page slot in VectorScene.pageRects, independent of the source PDF index. */
  pageIndex: number;
}

export const ANNOTATION_LIMITS = Object.freeze({
  count: 0xffffffff, numbers: Number.MAX_SAFE_INTEGER, text: Number.MAX_SAFE_INTEGER,
  actions: Number.MAX_SAFE_INTEGER, depth: Number.MAX_SAFE_INTEGER
});

/**
 * Which annotation appearances become page content at compile time. `"forms"`
 * keeps only Widget (form field) appearances. Metadata is extracted either way.
 */
export type AnnotationAppearanceMode = "render" | "forms" | "none";

export const ANNOTATION_APPEARANCE_MODES: readonly AnnotationAppearanceMode[] = Object.freeze(["render", "forms", "none"]);

export function validateAnnotationAppearanceMode(value: unknown): asserts value is AnnotationAppearanceMode | undefined {
  if (value !== undefined && !ANNOTATION_APPEARANCE_MODES.includes(value as AnnotationAppearanceMode)) {
    throw new RangeError('annotationAppearances must be "render", "forms" or "none".');
  }
}

export function annotationAppearanceIncluded(mode: AnnotationAppearanceMode | undefined, subtype: string): boolean {
  return mode === undefined || mode === "render" || (mode === "forms" && subtype === "Widget");
}

export function transformAnnotationPoints(values: readonly number[], matrix: PdfMatrix): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i += 2) {
    result.push(matrix[0] * values[i] + matrix[2] * values[i + 1] + matrix[4],
      matrix[1] * values[i] + matrix[3] * values[i + 1] + matrix[5]);
  }
  return result;
}

export function annotationBounds(rect: PdfBox, matrix: PdfMatrix): Bounds {
  const points = transformAnnotationPoints([rect[0], rect[1], rect[2], rect[1],
    rect[2], rect[3], rect[0], rect[3]], matrix);
  return { minX: Math.min(points[0], points[2], points[4], points[6]),
    minY: Math.min(points[1], points[3], points[5], points[7]),
    maxX: Math.max(points[0], points[2], points[4], points[6]),
    maxY: Math.max(points[1], points[3], points[5], points[7]) };
}

export function transformAnnotationGeometry(geometry: AnnotationGeometry, matrix: PdfMatrix): Pick<
  PdfAnnotation, "bounds" | "quadPoints" | "line" | "vertices" | "inkList"
> {
  return {
    bounds: annotationBounds(geometry.rect, matrix),
    ...(geometry.quadPoints ? { quadPoints: transformAnnotationPoints(geometry.quadPoints, matrix) } : {}),
    ...(geometry.line ? { line: transformAnnotationPoints(geometry.line, matrix) } : {}),
    ...(geometry.vertices ? { vertices: transformAnnotationPoints(geometry.vertices, matrix) } : {}),
    ...(geometry.inkList ? { inkList: geometry.inkList.map(path => transformAnnotationPoints(path, matrix)) } : {})
  };
}

/** Translate already-normalized geometry without modifying the source PDF coordinates. */
export function placeSceneAnnotation(annotation: PdfAnnotation, pageIndex: number,
  x = 0, y = 0, conditionOffset = 0): SceneAnnotation {
  const { minX, minY, maxX, maxY } = annotation.bounds;
  return { ...annotation, pageIndex, ...transformAnnotationGeometry({
    rect: [minX, minY, maxX, maxY], quadPoints: annotation.quadPoints, line: annotation.line,
    vertices: annotation.vertices, inkList: annotation.inkList
  }, [1, 0, 0, 1, x, y]),
  ...(annotation.optionalContent === undefined ? {} : { optionalContent: annotation.optionalContent + conditionOffset }) };
}

/** Validate both JSON sections and page-native data before exposing it to hosts. */
export function validateAnnotations(value: unknown, options: {
  pageCount?: number; sourcePageIndex?: number; conditionCount: number;
}): asserts value is PdfAnnotation[] | SceneAnnotation[] {
  const fail = (): never => { throw new Error("Invalid annotation metadata."); };
  const record = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== "object" || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) fail();
    return v as Record<string, unknown>;
  };
  let numbers = 0, text = 0, actions = 0;
  const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
  const string = (v: unknown): void => { if (typeof v !== "string" || (text += v.length) > ANNOTATION_LIMITS.text) fail(); };
  const array = (v: unknown, multiple: number, minimum = multiple): void => {
    if (!Array.isArray(v) || v.length < minimum || v.length % multiple ||
        (numbers += v.length) > ANNOTATION_LIMITS.numbers || v.some(n => typeof n !== "number" || !Number.isFinite(n))) fail();
  };
  const geometry = (v: Record<string, unknown>): void => {
    for (const key of ["quadPoints", "line", "vertices"]) if (v[key] !== undefined) {
      array(v[key], key === "quadPoints" ? 8 : 2, key === "line" ? 4 : key === "quadPoints" ? 8 : 2);
      if (key === "line" && (v[key] as number[]).length !== 4) fail();
    }
    if (v.inkList !== undefined) {
      if (!Array.isArray(v.inkList) || v.inkList.length > ANNOTATION_LIMITS.numbers) fail();
      for (const path of v.inkList as unknown[]) array(path, 2);
    }
  };
  const destination = (v: unknown): void => {
    const d = record(v);
    for (const key of ["name", "fit"]) if (d[key] !== undefined) string(d[key]);
    for (const key of ["sourcePageIndex", "remotePageIndex"]) if (d[key] !== undefined && !integer(d[key])) fail();
    if (d.parameters !== undefined && (!Array.isArray(d.parameters) || d.parameters.length > 4 ||
      d.parameters.some(n => n !== null && (typeof n !== "number" || !Number.isFinite(n))))) fail();
  };
  const active = new Set<unknown>();
  const action = (v: unknown, depth = 0): void => {
    if (depth >= ANNOTATION_LIMITS.depth || ++actions > ANNOTATION_LIMITS.actions || active.has(v)) fail();
    active.add(v);
    const a = record(v); string(a.type);
    for (const key of ["uri", "uriBase", "file", "name"]) if (a[key] !== undefined) string(a[key]);
    if (a.destination !== undefined) destination(a.destination);
    if (a.next !== undefined) {
      if (!Array.isArray(a.next)) fail();
      for (const next of a.next as unknown[]) action(next, depth + 1);
    }
    active.delete(v);
  };
  if (!Array.isArray(value) || value.length > ANNOTATION_LIMITS.count) fail();
  for (const item of value as unknown[]) {
    const a = record(item);
    string(a.id); string(a.subtype);
    if (!integer(a.sourcePageIndex) || !integer(a.annotationIndex) || !integer(a.flags) || (a.flags as number) > 0xffff_ffff ||
        typeof a.visibleInDefaultView !== "boolean" || typeof a.hasAppearance !== "boolean") fail();
    if (options.sourcePageIndex !== undefined && a.sourcePageIndex !== options.sourcePageIndex) fail();
    if (options.pageCount !== undefined && (!integer(a.pageIndex) || a.pageIndex >= options.pageCount)) fail();
    if (a.optionalContent !== undefined && (!integer(a.optionalContent) || a.optionalContent >= options.conditionCount)) fail();
    const b = record(a.bounds);
    array([b.minX, b.minY, b.maxX, b.maxY], 4);
    if ((b.minX as number) > (b.maxX as number) || (b.minY as number) > (b.maxY as number)) fail();
    const pdf = record(a.pdfGeometry); array(pdf.rect, 4);
    if ((pdf.rect as number[]).length !== 4) fail();
    geometry(pdf); geometry(a);
    for (const key of ["contents", "tooltip", "author", "subject", "name", "creationDate", "modificationDate",
      "iconName", "popupId", "parentId", "replyToId", "replyType", "state", "stateModel"]) if (a[key] !== undefined) string(a[key]);
    if (a.open !== undefined && typeof a.open !== "boolean") fail();
    if (a.opacity !== undefined && (typeof a.opacity !== "number" || !Number.isFinite(a.opacity) || a.opacity < 0 || a.opacity > 1)) fail();
    if (a.color !== undefined) {
      array(a.color, 1, 0);
      if (![0, 1, 3, 4].includes((a.color as number[]).length) || (a.color as number[]).some(n => n < 0 || n > 1)) fail();
    }
    if (a.border !== undefined) {
      const border = record(a.border);
      if (typeof border.width !== "number" || !Number.isFinite(border.width) || border.width < 0) fail();
      if (border.style !== undefined) string(border.style);
      if (border.dash !== undefined) { array(border.dash, 1, 0); if ((border.dash as number[]).some(n => n < 0)) fail(); }
      for (const key of ["horizontalRadius", "verticalRadius"]) if (border[key] !== undefined &&
        (typeof border[key] !== "number" || !Number.isFinite(border[key]) || (border[key] as number) < 0)) fail();
    }
    if (a.field !== undefined) {
      const field = record(a.field);
      if (!integer(field.flags) || field.flags > 0xffff_ffff) fail();
      for (const key of ["type", "name"]) if (field[key] !== undefined) string(field[key]);
      for (const key of ["value", "defaultValue"]) {
        const v = field[key];
        if (typeof v === "string") string(v);
        else if (Array.isArray(v)) { if (v.length > ANNOTATION_LIMITS.count) fail(); for (const s of v) string(s); }
        else if (v !== undefined && v !== null && typeof v !== "boolean" && (typeof v !== "number" || !Number.isFinite(v))) fail();
      }
    }
    if (a.action !== undefined) action(a.action);
    if (a.destination !== undefined) destination(a.destination);
  }
}
