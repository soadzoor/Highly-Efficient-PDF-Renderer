import type { AnnotationDestination, SceneAnnotation } from "./annotationData";
import type { VectorScene } from "./pdfVectorExtractor";
import type { EditorMatrix, EditorSession } from "./editorTypes";
import type { PdfDictionary, PdfRef, PdfString, PdfValue } from "./pdf/nativeCos";
import { isPdfDictionary, isPdfRef, isPdfString } from "./pdf/nativeCos";
import { NativePdfWriter, pdfAsciiValue, pdfNameValue, pdfTextValue } from "./pdf/nativeWriter";
import { NativePdfFormAppearanceRegistry, decodePdfString } from "./pdf/nativeForms";
import { computeNativePdfPageGeometry } from "./pdf/nativePageGeometry";
import { editorPoint, editorTransformBounds, invertEditorMatrix, multiplyEditorMatrices } from "./editorScene";
import { pdfName, pdfNumber, pdfRef, pdfUtf16Hex, type PdfByteWriter } from "./editorPdfBytes";
import { resolvePdfLinkUrl } from "./viewerLinkNavigation";

const GENERATED_LINK_PREFIX = "editor-link:";
const OBJECT_DESTINATION_PREFIX = "editor-target:";
const destination = (annotation: SceneAnnotation): AnnotationDestination | undefined => annotation.action
  ? annotation.action.type === "GoTo" ? annotation.action.destination : undefined : annotation.destination;
const linkName = (annotation: SceneAnnotation): string => annotation.name ?? annotation.id;
const managed = (annotation: SceneAnnotation): boolean => linkName(annotation).startsWith(GENERATED_LINK_PREFIX);
// /URI is an ASCII byte string, not a PDF text string. A UTF-16 BOM prevents
// independent readers from recognizing its scheme, even if HEPR decodes it.
const asciiUri = (value: string): string => encodeURI(value).replace(/%25([0-9a-f]{2})/gi, "%$1");
const uriHex = (value: string): string => `<${Array.from(new TextEncoder().encode(asciiUri(value)), byte => byte.toString(16).padStart(2, "0")).join("")}>`;

/** Deliberately excludes active PDF actions; only ordinary URI and local GoTo links are authored. */
function uri(annotation: SceneAnnotation): string | undefined {
  if (annotation.action?.type !== "URI" || !annotation.action.uri) return;
  const value = annotation.action.uri;
  if (/^[\u0000-\u0020]*[\w+.-]+:/.test(value) && !/^(?:https?|mailto|tel):/i.test(value)) return;
  if (/[\u0000-\u001f\u007f]/.test(value)) return;
  if (!annotation.action.uriBase && !/^[\w+.-]+:/.test(value)) return value;
  return resolvePdfLinkUrl(value, undefined, annotation.action.uriBase) ?? undefined;
}
function parameters(value: AnnotationDestination): (number | null)[] | undefined {
  const counts: Record<string, number> = { XYZ: 3, Fit: 0, FitB: 0, FitH: 1, FitBH: 1, FitV: 1, FitBV: 1, FitR: 4 };
  const count = counts[value.fit ?? "Fit"]; if (count === undefined) return;
  const result = value.parameters ? [...value.parameters] : [];
  if (result.length > count || result.some(number => number !== null && !Number.isFinite(number))) return;
  while (result.length < count) result.push(null);
  if (value.fit === "FitR" && (result.some(number => number === null) || result[2]! <= result[0]! || result[3]! <= result[1]!)) return;
  return result;
}
function pointList(points: readonly number[], matrix: EditorMatrix): number[] {
  const result: number[] = [];
  for (let index = 0; index + 1 < points.length; index += 2) result.push(...editorPoint(matrix, points[index], points[index + 1]));
  return result;
}
/** A fresh PDF's displayed Y-up page coordinates differ from source PDF user space. */
function freshDestination(scene: VectorScene, value: AnnotationDestination, toPdf?: (page: number) => EditorMatrix): { page: number; fit: string; values: (number | null)[] } | undefined {
  const mapping = scene.pdfPages?.find(page => page.sourcePageIndex === value.sourcePageIndex);
  const page = mapping?.pageIndex ?? (scene.pdfPages?.length ? -1 : value.sourcePageIndex ?? -1);
  if (page < 0 || page >= scene.pageCount) return;
  const values = parameters(value); if (!values) return;
  const offset = page * 4, matrix = mapping?.pdfToScene ?? [1, 0, 0, 1, scene.pageRects[offset], scene.pageRects[offset + 1]] as EditorMatrix;
  const local = multiplyEditorMatrices(toPdf?.(page) ?? [1, 0, 0, 1, -scene.pageRects[offset], -scene.pageRects[offset + 1]], matrix);
  const fit = value.fit ?? "Fit";
  if (fit === "FitR") {
    const bounds = editorTransformBounds({ minX: values[0]!, minY: values[1]!, maxX: values[2]!, maxY: values[3]! }, local);
    return { page, fit, values: [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY] };
  }
  if (fit === "XYZ") {
    const x = values[0], y = values[1];
    // Preserve nullable components only when the affine mapping does not mix them.
    const tx = x === null && local[0] !== 0 || y === null && local[2] !== 0 ? null : local[0] * (x ?? 0) + local[2] * (y ?? 0) + local[4];
    const ty = x === null && local[1] !== 0 || y === null && local[3] !== 0 ? null : local[1] * (x ?? 0) + local[3] * (y ?? 0) + local[5];
    const scale = Math.hypot(local[0], local[1]);
    return { page, fit, values: [tx, ty, values[2] === null || values[2] === 0 ? values[2] : values[2]! / scale] };
  }
  if (["FitH", "FitBH"].includes(fit)) return local[1] === 0 ? { page, fit, values: [values[0] === null ? null : local[3] * values[0]! + local[5]] }
    : { page, fit: fit === "FitBH" ? "FitBV" : "FitV", values: [values[0] === null ? null : local[2] * values[0]! + local[4]] };
  if (["FitV", "FitBV"].includes(fit)) return local[2] === 0 ? { page, fit, values: [values[0] === null ? null : local[0] * values[0]! + local[4]] }
    : { page, fit: fit === "FitBV" ? "FitBH" : "FitH", values: [values[0] === null ? null : local[1] * values[0]! + local[5]] };
  return { page, fit, values };
}

/** Link annotations have no appearance; their anchor artwork remains ordinary page paint. */
export function writeScenePdfLinks(writer: PdfByteWriter, scene: VectorScene, pages: readonly number[], options: {
  flatten?: boolean; signal?: AbortSignal; onWarning?: (message: string) => void;
  condition?(index: number): number | boolean;
}): { annotations: ReadonlyMap<number, readonly number[]>; names: string } {
  const annotations = new Map<number, number[]>(), names = new Map<string, string>();
  for (const annotation of scene.annotations ?? []) {
    if (annotation.subtype !== "Link" || options.flatten && !annotation.visibleInDefaultView) continue;
    options.signal?.throwIfAborted();
    const page = annotation.pageIndex, offset = page * 4;
    if (page < 0 || page >= pages.length) continue;
    const url = uri(annotation), target = destination(annotation);
    let action: string;
    if (url !== undefined) action = `/A << /S /URI /URI ${uriHex(url)} >>`;
    else {
      const resolved = target && freshDestination(scene, target);
      if (!target || !resolved) { options.onWarning?.(`Link ${annotation.id}: its unsupported or unavailable destination was omitted from the rebuilt PDF.`); continue; }
      const array = `[${pdfRef(pages[resolved.page])} ${pdfName(resolved.fit)} ${resolved.values.map(value => value === null ? "null" : pdfNumber(value)).join(" ")}]`;
      if (target.name?.startsWith(OBJECT_DESTINATION_PREFIX)) { names.set(target.name, array); action = `/Dest ${pdfUtf16Hex(target.name)}`; }
      else action = `/Dest ${array}`;
    }
    const matrix: EditorMatrix = [1, 0, 0, 1, -scene.pageRects[offset], -scene.pageRects[offset + 1]], bounds = editorTransformBounds(annotation.bounds, matrix);
    const condition = annotation.optionalContent === undefined || options.flatten ? true : options.condition?.(annotation.optionalContent) ?? true;
    let flags = annotation.flags;
    if (condition === false) flags |= 2;
    const quads = annotation.quadPoints?.length ? `/QuadPoints [${pointList(annotation.quadPoints, matrix).map(pdfNumber).join(" ")}]` : "";
    const reference = writer.add(`<< /Type /Annot /Subtype /Link /Rect [${[bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].map(pdfNumber).join(" ")}] ` +
      `/NM ${pdfUtf16Hex(linkName(annotation))} /F ${flags} /Border [0 0 0] /H /N ${quads} ${action} ${typeof condition === "number" ? `/OC ${pdfRef(condition)}` : ""} >>`);
    const list = annotations.get(page) ?? []; list.push(reference); annotations.set(page, list);
  }
  return { annotations, names: names.size ? `/Names << /Dests << /Names [${[...names].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, value]) => `${pdfUtf16Hex(name)} ${value}`).join(" ")}] >> >>` : "" };
}

/** Update supported navigation without rebuilding unrelated source annotations or appearances. */
export async function writeEditorNativePdfLinks(writer: NativePdfWriter, scene: VectorScene, session: EditorSession, options: {
  signal?: AbortSignal; onWarning?: (message: string) => void;
  pageDictionary(sourceIndex: number): PdfDictionary;
  condition(index: number): PdfRef | boolean;
}): Promise<void> {
  const document = writer.document, forms = new NativePdfFormAppearanceRegistry(document), names = new Map<string, PdfValue>();
  const current = (scene.annotations ?? []).filter(annotation => annotation.subtype === "Link");
  const source = (session.sourceScene.annotations ?? []).filter(annotation => annotation.subtype === "Link");
  if (!current.length && !source.length) return;
  const visited = new Set<SceneAnnotation>();
  const sourceIndex = (page: number) => session.sourceScene.pdfPages?.find(mapping => mapping.pageIndex === page)?.sourcePageIndex ?? page;
  const pdfMatrix = (pageIndex: number): EditorMatrix => {
    const page = document.getPage(sourceIndex(pageIndex)), origin = pageIndex * 4;
    return session.sourceScene.pdfPages?.find(mapping => mapping.pageIndex === pageIndex)?.pdfToScene
      ?? multiplyEditorMatrices([1, 0, 0, 1, scene.pageRects[origin], scene.pageRects[origin + 1]], computeNativePdfPageGeometry(page).pageMatrix);
  };
  const resolve = async (value: PdfValue | undefined): Promise<PdfValue | undefined> => isPdfRef(value) ? writer.get(value) ?? await document.resolveValue(value, options.signal) : value;
  function dictionary(annotation: SceneAnnotation, original?: PdfDictionary): PdfDictionary | undefined {
    const value = new Map(original), url = uri(annotation), target = destination(annotation);
    const originalMetadata = source.find(item => item.id === annotation.id) ?? source.find(item => linkName(item) === linkName(annotation));
    const locked = (() => { try { return session.isObjectLocked(`annotation:${annotation.id}`); } catch { return Boolean(annotation.flags & 128); } })();
    if (original && originalMetadata && locked === Boolean(originalMetadata.flags & 128) &&
        JSON.stringify([annotation.bounds, annotation.quadPoints, annotation.action, annotation.destination, annotation.flags, annotation.optionalContent]) ===
        JSON.stringify([originalMetadata.bounds, originalMetadata.quadPoints, originalMetadata.action, originalMetadata.destination, originalMetadata.flags, originalMetadata.optionalContent])) return original;
    const changedAction = managed(annotation) || !originalMetadata || JSON.stringify([annotation.action, annotation.destination]) !== JSON.stringify([originalMetadata.action, originalMetadata.destination]);
    if (changedAction) {
      if (url !== undefined) { value.delete("Dest"); value.set("A", new Map<string, PdfValue>([["S", pdfNameValue("URI")], ["URI", pdfAsciiValue(asciiUri(url))]])); }
      else if (target && target.sourcePageIndex !== undefined) {
        const resolved = freshDestination(scene, target, page => invertEditorMatrix(pdfMatrix(page)));
        const index = resolved ? sourceIndex(resolved.page) : target.sourcePageIndex;
        const values = resolved?.values ?? parameters(target); if (!values || !document.pages[index]?.ref) return;
        const array: PdfValue[] = [document.pages[index].ref!, pdfNameValue(resolved?.fit ?? target.fit ?? "Fit"), ...values];
        value.delete("A");
        if (target.name?.startsWith(OBJECT_DESTINATION_PREFIX)) { names.set(target.name, array); value.set("Dest", pdfTextValue(target.name)); }
        else value.set("Dest", array);
      } else if (!original || managed(annotation)) {
        options.onWarning?.(`Link ${annotation.id}: its unsupported or unavailable destination was omitted from the saved PDF.`); return;
      }
    }
    const inverse = invertEditorMatrix(pdfMatrix(annotation.pageIndex)), bounds = editorTransformBounds(annotation.bounds, inverse);
    value.set("Type", pdfNameValue("Annot")); value.set("Subtype", pdfNameValue("Link"));
    value.set("Rect", [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]);
    if (annotation.quadPoints?.length) value.set("QuadPoints", pointList(annotation.quadPoints, inverse)); else value.delete("QuadPoints");
    value.set("NM", pdfTextValue(linkName(annotation)));
    let flags = annotation.flags;
    flags = locked ? flags | 128 : flags & ~128;
    if (annotation.optionalContent !== undefined) {
      const condition = options.condition(annotation.optionalContent);
      value.delete("OC"); if (typeof condition !== "boolean") value.set("OC", condition); else if (!condition) flags |= 2;
    } else if (managed(annotation)) value.delete("OC");
    value.set("F", flags);
    if (!original) { value.set("Border", [0, 0, 0]); value.set("H", pdfNameValue("N")); }
    return value;
  }
  for (let pageIndex = 0; pageIndex < scene.pageCount; pageIndex++) {
    options.signal?.throwIfAborted();
    const index = sourceIndex(pageIndex), page = document.getPage(index), owner = options.pageDictionary(index);
    const pending = await resolve(owner.get("Annots")), entries = Array.isArray(pending) ? [...pending] : [];
    type LinkRecord = { annotation: SceneAnnotation | undefined; original: PdfDictionary; known: boolean };
    const byReference = new Map<string, LinkRecord>(), direct = new Map<PdfDictionary, LinkRecord>();
    for (const native of await forms.listPageAnnotations(index, options.signal, true)) {
      if (native.subtype !== "Link") continue;
      const rawName = await resolve(native.dictionary.get("NM")), nativeName = rawName && typeof rawName === "object" && "bytes" in rawName
        ? decodePdfString(rawName as import("./pdf/nativeCos").PdfString, index, native.annotationIndex) : undefined;
      const match = current.find(annotation => annotation.id === native.id) ?? current.find(annotation => linkName(annotation) === nativeName);
      const key = native.ref ? `${native.ref.objectNumber}:${native.ref.generation}` : `direct:${native.annotationIndex}`;
      const pendingDictionary = native.ref ? writer.get(native.ref) : undefined;
      const record = { annotation: match, original: isPdfDictionary(pendingDictionary) ? pendingDictionary : native.dictionary,
        known: source.some(annotation => annotation.id === native.id || linkName(annotation) === nativeName) };
      if (native.ref) byReference.set(key, record); else direct.set(native.dictionary, record);
    }
    const next: PdfValue[] = [];
    for (let position = 0; position < entries.length; position++) {
      const entry = entries[position];
      let record = isPdfRef(entry) ? byReference.get(`${entry.objectNumber}:${entry.generation}`) : isPdfDictionary(entry) ? direct.get(entry) : undefined;
      if (!record && isPdfRef(entry)) {
        const pending = writer.get(entry), name = isPdfDictionary(pending) ? pending.get("NM") : undefined;
        if (isPdfDictionary(pending) && isPdfString(name)) {
          const annotation = current.find(item => linkName(item) === decodePdfString(name, index, position));
          if (annotation) record = { annotation, original: pending, known: true };
        }
      }
      if (!record) { next.push(entry); continue; }
      if (!record.annotation) { if (!record.known) next.push(entry); continue; }
      const annotation = record.annotation; if (visited.has(annotation)) continue; visited.add(annotation);
      const result = dictionary(annotation, record.original);
      if (!result) { next.push(entry); continue; }
      if (result === record.original) { next.push(entry); continue; }
      if (isPdfRef(entry)) { writer.set(entry, result); next.push(entry); } else next.push(writer.add(result));
    }
    for (const annotation of current) {
      if (annotation.pageIndex !== pageIndex || visited.has(annotation)) continue;
      const result = dictionary(annotation); if (!result) continue;
      visited.add(annotation); next.push(writer.add(result));
    }
    owner.set("Annots", next);
  }
  if (!names.size) return;
  const root = document.getWriterState().xref.trailers.map(trailer => trailer.get("Root")).find(isPdfRef);
  if (!root) throw new Error("The PDF catalog requires a full rewrite to save internal links.");
  const pending = writer.get(root), catalog = new Map(isPdfDictionary(pending) ? pending : document.catalog);
  const original = await resolve(catalog.get("Dests")), destinations = new Map(isPdfDictionary(original) ? original : []);
  for (const [name, value] of names) destinations.set(name, value);
  const rawNames = await resolve(catalog.get("Names")), nameDictionary = new Map(isPdfDictionary(rawNames) ? rawNames : []);
  const entries = new Map<string, { key: PdfString; value: PdfValue }>();
  for (const [name, value] of isPdfDictionary(original) ? original : []) entries.set(name, { key: pdfTextValue(name) as PdfString, value });
  const stack = [nameDictionary.get("Dests")], seen = new Set<PdfDictionary>();
  while (stack.length) {
    options.signal?.throwIfAborted(); const node = await resolve(stack.pop());
    if (!isPdfDictionary(node) || seen.has(node)) continue; seen.add(node);
    const values = await resolve(node.get("Names"));
    if (Array.isArray(values)) for (let index = 0; index + 1 < values.length; index += 2) {
      const key = await resolve(values[index]); if (!isPdfString(key)) continue;
      entries.set(decodePdfString(key, 0, 0), { key, value: values[index + 1] });
    }
    const kids = await resolve(node.get("Kids")); if (Array.isArray(kids)) stack.push(...kids);
  }
  for (const [name, value] of names) entries.set(name, { key: pdfTextValue(name) as PdfString, value });
  const sorted = [...entries.values()].sort((a, b) => {
    const left = a.key.bytes, right = b.key.bytes;
    for (let index = 0; index < Math.min(left.length, right.length); index++) if (left[index] !== right[index]) return left[index] - right[index];
    return left.length - right.length;
  });
  nameDictionary.set("Dests", writer.add(new Map<string, PdfValue>([["Names", sorted.flatMap(value => [value.key, value.value])]])));
  catalog.set("Dests", destinations); catalog.set("Names", nameDictionary); writer.set(root, catalog);
}
