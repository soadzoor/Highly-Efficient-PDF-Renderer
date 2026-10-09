import type { VectorScene } from "./pdfVectorExtractor";
import type { PrimitiveKind, PrimitiveRef } from "./scenePrimitives";

/**
 * A marked-content sequence with an MCID (a structure content item, PDF
 * 32000-1 §14.7.4) that painted scene primitives.
 */
export interface SceneContentItem {
  /** Page slot in VectorScene.pageRects. */
  pageIndex: number;
  sourcePageIndex: number;
  /** Marked-content identifier; unique within its page's content stream. */
  mcid: number;
  /** Marked-content tag, such as "Figure" or "P". */
  tag: string;
  /** `StructureElement.id` of the element owning this item, when the PDF's structure tree maps it. */
  elementId?: string;
}

/** One entry of a UserProperties attribute object (PDF 32000-1 §14.7.5.4). */
export interface StructureUserProperty {
  name: string;
  /** Text, numbers and booleans keep their type; other PDF values are null. */
  value: string | number | boolean | null;
  /** The producer's display form of the value (`/F`). */
  formattedValue?: string;
  /** Hidden from end users (`/H true`). */
  hidden?: boolean;
}

/** A detached structure element (PDF 32000-1 §14.7.2): painted content's owner, or an ancestor of one. */
export interface StructureElement {
  /** Document-local identity: `ref:<object>:<generation>`. */
  id: string;
  /** Structure type (`/S`), such as "Figure". */
  type: string;
  /** Standard structure type after `/RoleMap`, when it differs from `type`. */
  standardType?: string;
  /** Parent element id; absent for elements directly under the structure tree root. */
  parentId?: string;
  title?: string;
  alt?: string;
  actualText?: string;
  expansion?: string;
  lang?: string;
  /** The element identifier (`/ID`). */
  elementId?: string;
  /** User properties from the element's attributes and attribute classes, in source order. */
  userProperties?: readonly StructureUserProperty[];
}

/** Per primitive kind: sorted, non-overlapping `[first, count, item]` triples into `items`. */
export type SceneContentItemRanges = Partial<Record<PrimitiveKind, Uint32Array>>;

export interface SceneMarkedContent {
  items: readonly SceneContentItem[];
  ranges: SceneContentItemRanges;
}

export const PRIMITIVE_KINDS: readonly PrimitiveKind[] = Object.freeze(["stroke", "fill", "text", "raster", "gradient-fill", "gradient-stroke"]);

export const STRUCTURE_LIMITS = Object.freeze({
  items: 0xffffffff, ranges: Number.MAX_SAFE_INTEGER, elements: 0xffffffff,
  userProperties: Number.MAX_SAFE_INTEGER, text: Number.MAX_SAFE_INTEGER
});

export function scenePrimitiveCount(scene: VectorScene, kind: PrimitiveKind): number {
  switch (kind) {
    case "stroke": return scene.segmentCount;
    case "fill": return scene.fillPathCount;
    case "text": return scene.textInstanceCount;
    case "raster": return scene.rasterLayers.length;
    case "gradient-fill": return scene.gradientFillPathCount;
    case "gradient-stroke": return scene.gradientStrokeRunCount;
  }
}

/** Collects the primitives each content item painted, in any order. */
export class ContentItemRangeBuilder {
  private readonly pending = new Map<PrimitiveKind, number[]>();

  add(kind: PrimitiveKind, first: number, count: number, item: number): void {
    if (count <= 0 || item < 0) return;
    let values = this.pending.get(kind);
    if (!values) this.pending.set(kind, values = []);
    const last = values.length - 3;
    // Consecutive primitives of one item form a single range.
    if (last >= 0 && values[last + 2] === item && values[last] + values[last + 1] === first) values[last + 1] += count;
    else values.push(first, count, item);
  }

  get isEmpty(): boolean {
    return this.pending.size === 0;
  }

  build(): SceneContentItemRanges {
    const ranges: SceneContentItemRanges = {};
    for (const [kind, values] of this.pending) {
      const order = Array.from({ length: values.length / 3 }, (_, index) => index)
        .sort((a, b) => values[a * 3] - values[b * 3]);
      const sorted: number[] = [];
      for (const index of order) {
        const first = values[index * 3], count = values[index * 3 + 1], item = values[index * 3 + 2];
        const last = sorted.length - 3;
        const end = last >= 0 ? sorted[last] + sorted[last + 1] : 0;
        // A primitive belongs to one item; a repeated claim keeps the first.
        const start = Math.max(first, end);
        if (start >= first + count) continue;
        if (last >= 0 && sorted[last + 2] === item && end === start) sorted[last + 1] += first + count - start;
        else sorted.push(start, first + count - start, item);
      }
      ranges[kind] = Uint32Array.from(sorted);
    }
    return ranges;
  }
}

/** Index in `markedContent.items` of the item that painted a primitive, or -1; a binary search over its kind's ranges. */
export function findSceneContentItemIndex(scene: VectorScene, ref: PrimitiveRef): number {
  const ranges = scene.markedContent?.ranges[ref.kind];
  if (!ranges?.length) return -1;
  let lo = 0, hi = ranges.length / 3;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ranges[mid * 3] <= ref.index) lo = mid + 1;
    else hi = mid;
  }
  const range = lo - 1;
  return range < 0 || ref.index >= ranges[range * 3] + ranges[range * 3 + 1] ? -1 : ranges[range * 3 + 2];
}

/** The content item that painted a primitive. */
export function findSceneContentItem(scene: VectorScene, ref: PrimitiveRef): SceneContentItem | undefined {
  const index = findSceneContentItemIndex(scene, ref);
  return index < 0 ? undefined : scene.markedContent!.items[index];
}

/**
 * Attribution for a one-page subset of a scene's primitives, where
 * `primitives[kind][local]` is the canonical index. Items move to page slot 0.
 */
export function selectSceneMarkedContent(scene: VectorScene,
  primitives: Readonly<Record<PrimitiveKind, ArrayLike<number>>>): SceneMarkedContent | undefined {
  const content = scene.markedContent;
  if (!content) return undefined;
  const items: SceneContentItem[] = [], selected = new Map<number, number>(), ranges = new ContentItemRangeBuilder();
  for (const kind of PRIMITIVE_KINDS) {
    const indices = primitives[kind];
    for (let local = 0; local < indices.length; local++) {
      const item = findSceneContentItemIndex(scene, { kind, index: indices[local] });
      if (item < 0) continue;
      let index = selected.get(item);
      if (index === undefined) {
        index = items.length;
        selected.set(item, index);
        items.push({ ...content.items[item], pageIndex: 0 });
      }
      ranges.add(kind, local, 1, index);
    }
  }
  return items.length ? { items, ranges: ranges.build() } : undefined;
}

const elementLookups = new WeakMap<readonly StructureElement[], Map<string, StructureElement>>();
export function findStructureElement(scene: VectorScene, id: string): StructureElement | undefined {
  const elements = scene.structureElements;
  if (!elements) return undefined;
  let byId = elementLookups.get(elements);
  if (!byId) elementLookups.set(elements, byId = new Map(elements.map(element => [element.id, element])));
  return byId.get(id);
}

/** Validate marked-content attribution and structure elements before they reach hosts. */
export function validateSceneStructure(scene: VectorScene): void {
  const fail = (): never => { throw new Error("Invalid structure metadata."); };
  const text = { length: 0 };
  const string = (value: unknown, optional = false): void => {
    if (value === undefined && optional) return;
    if (typeof value !== "string" || (text.length += value.length) > STRUCTURE_LIMITS.text) fail();
  };
  const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
  const record = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail();
    return value as Record<string, unknown>;
  };
  const ids = new Set<string>();
  if (scene.structureElements !== undefined) {
    if (!Array.isArray(scene.structureElements) || scene.structureElements.length > STRUCTURE_LIMITS.elements) fail();
    let properties = 0;
    for (const value of scene.structureElements) {
      const element = record(value);
      string(element.id); string(element.type);
      if (!element.id || ids.has(element.id as string)) fail();
      ids.add(element.id as string);
      for (const key of ["standardType", "parentId", "title", "alt", "actualText", "expansion", "lang", "elementId"]) string(element[key], true);
      if (element.userProperties !== undefined) {
        if (!Array.isArray(element.userProperties) || (properties += element.userProperties.length) > STRUCTURE_LIMITS.userProperties) fail();
        for (const propertyValue of element.userProperties as unknown[]) {
          const property = record(propertyValue);
          string(property.name); string(property.formattedValue, true);
          const v = property.value;
          if (typeof v === "string") string(v);
          else if (v !== null && typeof v !== "boolean" && (typeof v !== "number" || !Number.isFinite(v))) fail();
          if (property.hidden !== undefined && typeof property.hidden !== "boolean") fail();
        }
      }
    }
  }
  const content = scene.markedContent;
  if (content === undefined) return;
  const { items, ranges } = record(content) as unknown as SceneMarkedContent;
  if (!Array.isArray(items) || items.length > STRUCTURE_LIMITS.items || !ranges || typeof ranges !== "object") fail();
  for (const value of items) {
    const item = record(value);
    if (!integer(item.pageIndex) || item.pageIndex >= scene.pageCount || !integer(item.sourcePageIndex) || !integer(item.mcid)) fail();
    string(item.tag);
    if (item.elementId !== undefined && (typeof item.elementId !== "string" || !ids.has(item.elementId))) fail();
  }
  let rangeCount = 0;
  for (const [kind, values] of Object.entries(ranges)) {
    if (!PRIMITIVE_KINDS.includes(kind as PrimitiveKind) || !(values instanceof Uint32Array) || values.length % 3 !== 0 ||
        (rangeCount += values.length / 3) > STRUCTURE_LIMITS.ranges) fail();
    const count = scenePrimitiveCount(scene, kind as PrimitiveKind);
    let end = 0;
    for (let offset = 0; offset < values.length; offset += 3) {
      const first = values[offset], length = values[offset + 1], item = values[offset + 2];
      if (first < end || length === 0 || first + length > count || item >= items.length) fail();
      end = first + length;
    }
  }
}

/** Offsets that place one page scene's primitives inside a composed scene. */
export interface ScenePrimitiveOffsets {
  readonly pageRectBase: number;
  readonly primitives: Readonly<Record<PrimitiveKind, number>>;
}

/**
 * Concatenate per-page attribution; document-local element ids are shared
 * across pages. Pages that would exceed the scene's limits keep their geometry
 * but lose attribution, counted in `droppedPages`.
 */
export function composeSceneStructure(pages: readonly { readonly scene: VectorScene; readonly offsets: ScenePrimitiveOffsets }[]): {
  markedContent?: SceneMarkedContent;
  structureElements?: StructureElement[];
  droppedPages: number;
} {
  if (!pages.some(({ scene }) => scene.markedContent?.items.length || scene.structureElements?.length)) return { droppedPages: 0 };
  const items: SceneContentItem[] = [];
  const parts = new Map<PrimitiveKind, Uint32Array[]>();
  const elements = new Map<string, StructureElement>();
  let rangeCount = 0, droppedPages = 0;
  for (const { scene, offsets } of pages) {
    const pageRanges = Object.values(scene.markedContent?.ranges ?? {}).reduce((sum, values) => sum + values.length / 3, 0);
    const pageElements = (scene.structureElements ?? []).filter(element => !elements.has(element.id)).length;
    if (items.length + (scene.markedContent?.items.length ?? 0) > STRUCTURE_LIMITS.items ||
        rangeCount + pageRanges > STRUCTURE_LIMITS.ranges || elements.size + pageElements > STRUCTURE_LIMITS.elements) {
      if (scene.markedContent?.items.length) droppedPages++;
      continue;
    }
    rangeCount += pageRanges;
    const itemBase = items.length;
    for (const item of scene.markedContent?.items ?? []) items.push({ ...item, pageIndex: offsets.pageRectBase + item.pageIndex });
    for (const [kind, values] of Object.entries(scene.markedContent?.ranges ?? {}) as [PrimitiveKind, Uint32Array][]) {
      const shifted = new Uint32Array(values.length);
      for (let offset = 0; offset < values.length; offset += 3) {
        shifted[offset] = values[offset] + offsets.primitives[kind];
        shifted[offset + 1] = values[offset + 1];
        shifted[offset + 2] = values[offset + 2] + itemBase;
      }
      let list = parts.get(kind);
      if (!list) parts.set(kind, list = []);
      list.push(shifted);
    }
    for (const element of scene.structureElements ?? []) if (!elements.has(element.id)) elements.set(element.id, element);
  }
  const ranges: SceneContentItemRanges = {};
  for (const [kind, list] of parts) {
    const values = new Uint32Array(list.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of list) { values.set(part, offset); offset += part.length; }
    ranges[kind] = values;
  }
  return {
    ...(items.length ? { markedContent: { items, ranges } } : {}),
    ...(elements.size ? { structureElements: [...elements.values()] } : {}),
    droppedPages
  };
}
