import { ANNOTATION_LIMITS, transformAnnotationGeometry, type PdfAnnotation, type AnnotationAction,
  type AnnotationDestination, type AnnotationGeometry, type AnnotationField, type AnnotationBorder } from "../annotationData";
import type { PdfBox, PdfMatrix } from "../heprDocumentData";
import { isPdfDictionary, isPdfName, isPdfRef, isPdfString, pdfRefKey,
  type PdfValue, type PdfDictionary } from "./nativeCos";
import type { NativePdfDocument } from "./nativeDocument";
import { decodePdfString, type NativePdfFormAppearanceRegistry, type NativePdfAnnotationAppearance } from "./nativeForms";
import type { NativeOptionalContentRegistry } from "./nativeOptionalContent";
import { computeNativePdfPageGeometry } from "./nativePageGeometry";
import { PdfError, throwIfAborted, type PdfDiagnostic } from "./nativeTypes";

/** Reuses annotation discovery, without resolving or decoding appearance streams. */
export class NativePdfAnnotationMetadataRegistry {
  private readonly pages = new Map<number, readonly PdfAnnotation[]>();
  private readonly document: NativePdfDocument;
  private readonly forms: NativePdfFormAppearanceRegistry;
  private readonly optionalContent: NativeOptionalContentRegistry;
  private readonly onDiagnostic: (diagnostic: PdfDiagnostic) => void;
  constructor(document: NativePdfDocument, forms: NativePdfFormAppearanceRegistry,
    optionalContent: NativeOptionalContentRegistry, onDiagnostic: (diagnostic: PdfDiagnostic) => void) {
    this.document = document; this.forms = forms; this.optionalContent = optionalContent; this.onDiagnostic = onDiagnostic;
  }

  async getPageAnnotations(pageIndex: number, signal?: AbortSignal): Promise<readonly PdfAnnotation[]> {
    throwIfAborted(signal);
    const cached = this.pages.get(pageIndex);
    if (cached) return cached;
    const source = await this.forms.listPageAnnotations(pageIndex, signal, true);
    if (source.length > ANNOTATION_LIMITS.count) throw new PdfError("resource-limit", "Too many annotation records.", { pageIndex });
    const reader = new AnnotationReader(this.document, this.optionalContent, source, this.onDiagnostic, signal);
    const { pageMatrix } = computeNativePdfPageGeometry(this.document.getPage(pageIndex));
    const result: PdfAnnotation[] = [];
    for (const annotation of source) {
      throwIfAborted(signal);
      result.push(await reader.read(annotation, pageMatrix));
    }
    throwIfAborted(signal);
    freezeMetadata(result);
    this.pages.set(pageIndex, result);
    return result;
  }
}

class AnnotationReader {
  private numbers = 0;
  private textLength = 0;
  private actionCount = 0;
  private readonly ids = new Map<PdfDictionary, string>();
  private current!: NativePdfAnnotationAppearance;

  private readonly document: NativePdfDocument;
  private readonly optionalContent: NativeOptionalContentRegistry;
  private readonly onDiagnostic: (diagnostic: PdfDiagnostic) => void;
  private readonly signal?: AbortSignal;
  constructor(document: NativePdfDocument, optionalContent: NativeOptionalContentRegistry,
    source: readonly NativePdfAnnotationAppearance[], onDiagnostic: (diagnostic: PdfDiagnostic) => void,
    signal?: AbortSignal) {
    this.document = document; this.optionalContent = optionalContent;
    this.onDiagnostic = onDiagnostic; this.signal = signal;
    for (const annotation of source) this.ids.set(annotation.dictionary, annotation.id);
  }

  private resolve(value: PdfValue | undefined): Promise<PdfValue | undefined> {
    throwIfAborted(this.signal);
    return this.document.resolveValue(value, this.signal);
  }
  private invalid(message: string): never { throw new PdfError("invalid-object", message); }
  private limit(message: string): never { throw new PdfError("resource-limit", message, { pageIndex: this.current.pageIndex }); }
  private async optional<T>(key: string, read: () => Promise<T>): Promise<T | undefined> {
    try { return await read(); } catch (error) {
      throwIfAborted(this.signal);
      if (!(error instanceof PdfError) || error.code === "resource-limit" || error.code === "aborted" || error.code === "closed") throw error;
      this.onDiagnostic({ code: "annotation.metadata-invalid", severity: "warning", pageIndex: this.current.pageIndex,
        message: `Annotation ${this.current.annotationIndex} has unusable /${key} metadata: ${error.message}`,
        details: { annotationIndex: this.current.annotationIndex, key } });
      return undefined;
    }
  }

  private async text(value: PdfValue | undefined, allowName = false): Promise<string | undefined> {
    const v = await this.resolve(value);
    if (v == null) return undefined;
    if (!isPdfString(v) && !(allowName && isPdfName(v))) return this.invalid("Expected a PDF string.");
    const result = isPdfString(v) ? decodePdfString(v, this.current.pageIndex, this.current.annotationIndex) : v.value;
    this.textLength += result.length;
    if (this.textLength > ANNOTATION_LIMITS.text) this.limit("Annotation text exceeds the metadata limit.");
    return result;
  }

  private async numericArray(value: PdfValue | undefined, multiple: number, minimum = multiple): Promise<number[] | undefined> {
    const v = await this.resolve(value);
    if (v == null) return undefined;
    if (!Array.isArray(v) || v.length < minimum || v.length % multiple) return this.invalid("Invalid coordinate array.");
    this.numbers += v.length;
    if (this.numbers > Math.min(ANNOTATION_LIMITS.numbers, this.document.limits.maxPathCoordinatesPerPage)) this.limit("Annotation coordinates exceed the metadata limit.");
    const result: number[] = [];
    for (const item of v) {
      const n = await this.resolve(item);
      if (typeof n !== "number" || !Number.isFinite(n)) return this.invalid("Expected finite coordinates.");
      result.push(n);
    }
    return result;
  }

  async read(annotation: NativePdfAnnotationAppearance, matrix: PdfMatrix): Promise<PdfAnnotation> {
    this.current = annotation;
    const d = annotation.dictionary;
    const rect = await this.numericArray(d.get("Rect"), 4);
    if (!rect || rect.length !== 4) return this.invalid("Invalid annotation rectangle.");
    const geometry: AnnotationGeometry = { rect: rect as unknown as PdfBox };
    for (const [key, field, multiple] of [["QuadPoints", "quadPoints", 8], ["L", "line", 4], ["Vertices", "vertices", 2]] as const) {
      const points = await this.optional(key, async () => {
        const v = await this.numericArray(d.get(key), multiple);
        if (key === "L" && v && v.length !== 4) return this.invalid("A line needs two endpoints.");
        return v;
      });
      if (points) geometry[field] = points;
    }
    const ink = await this.optional("InkList", async () => {
      const v = await this.resolve(d.get("InkList"));
      if (v == null) return undefined;
      if (!Array.isArray(v) || v.length > ANNOTATION_LIMITS.numbers) return this.invalid("Invalid ink path list.");
      const paths: number[][] = [];
      for (const item of v) {
        const path = await this.numericArray(item, 2);
        if (!path) return this.invalid("Missing ink path.");
        paths.push(path);
      }
      return paths;
    });
    if (ink) geometry.inkList = ink;
    const result: PdfAnnotation = { id: annotation.id, sourcePageIndex: annotation.pageIndex,
      annotationIndex: annotation.annotationIndex, subtype: annotation.subtype, pdfGeometry: geometry,
      ...transformAnnotationGeometry(geometry, matrix), flags: annotation.flags,
      visibleInDefaultView: annotation.visibleInDefaultView, hasAppearance: annotation.hasAppearanceDictionary };
    const strings = { Contents: "contents", TU: "tooltip", Subj: "subject", NM: "name", CreationDate: "creationDate",
      M: "modificationDate", Name: "iconName", RT: "replyType", State: "state", StateModel: "stateModel" } as const;
    for (const [key, field] of Object.entries(strings)) {
      const value = await this.optional(key, () => this.text(d.get(key), key === "Name" || key === "RT"));
      if (value !== undefined) result[field as typeof strings[keyof typeof strings]] = value;
    }
    if (annotation.subtype !== "Widget") {
      const author = await this.optional("T", () => this.text(d.get("T")));
      if (author !== undefined) result.author = author;
    } else {
      const flags = await this.optional("Ff", async () => {
        const value = await this.fieldEntry(d, "Ff");
        if (value == null) return 0;
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) return this.invalid("Invalid field flags.");
        return value;
      });
      result.field = { flags: flags ?? 0,
        type: await this.optional("FT", () => this.fieldEntry(d, "FT").then(value => this.text(value, true))),
        name: await this.optional("T", () => this.fieldName(d)),
        value: await this.optional("V", () => this.fieldEntry(d, "V").then(value => this.fieldValue(value))),
        defaultValue: await this.optional("DV", () => this.fieldEntry(d, "DV").then(value => this.fieldValue(value))) };
      if (result.tooltip === undefined) result.tooltip = await this.optional("TU", async () => this.text(await this.fieldEntry(d, "TU")));
    }
    const open = await this.optional("Open", async () => {
      const value = await this.resolve(d.get("Open"));
      if (value != null && typeof value !== "boolean") return this.invalid("Expected a boolean.");
      return value ?? undefined;
    });
    if (open !== undefined) result.open = open;
    const color = await this.optional("C", async () => {
      const values = await this.numericArray(d.get("C"), 1, 0);
      if (values && (![0, 1, 3, 4].includes(values.length) || values.some(n => n < 0 || n > 1))) return this.invalid("Invalid annotation color.");
      return values;
    });
    if (color) result.color = color;
    const opacity = await this.optional("CA", async () => {
      const n = await this.resolve(d.get("CA"));
      if (n == null) return undefined;
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1) return this.invalid("Invalid opacity.");
      return n;
    });
    if (opacity !== undefined) result.opacity = opacity;
    const border = await this.optional("BS/Border", () => this.border(d));
    if (border) result.border = border;
    for (const [key, field] of [["Popup", "popupId"], ["IRT", "replyToId"], ["Parent", "parentId"]] as const) {
      if (key === "Parent" && annotation.subtype !== "Popup") continue;
      const id = await this.optional(key, async () => {
        const raw = d.get(key);
        if (raw == null) return undefined;
        if (isPdfRef(raw)) return `ref:${pdfRefKey(raw)}`;
        const target = await this.resolve(raw);
        if (!isPdfDictionary(target)) return this.invalid("Invalid annotation relationship.");
        return this.ids.get(target);
      });
      if (id !== undefined) result[field] = id;
    }
    if (annotation.optionalContent != null) {
      const membership = await this.optional("OC", () => this.optionalContent.resolvePropertyValue(annotation.optionalContent!, this.signal));
      if (membership) {
        result.optionalContent = membership.index;
        result.visibleInDefaultView &&= membership.defaultVisible;
      }
    }
    const action = await this.optional("A", () => this.action(d.get("A"), new Set(), 0));
    if (action) result.action = action;
    const destination = await this.optional("Dest", () => this.destination(d.get("Dest"), false, new Set(), 0));
    if (destination) result.destination = destination;
    return result;
  }

  private async fieldEntry(start: PdfDictionary, key: string): Promise<PdfValue | undefined> {
    const visited = new Set<PdfDictionary>();
    let d = start;
    while (true) {
      if (visited.has(d)) return this.invalid("Cyclic field ancestry.");
      if (visited.size >= this.document.limits.maxRecursionDepth) this.limit("Field ancestry exceeds the recursion limit.");
      visited.add(d);
      const value = await this.resolve(d.get(key));
      if (value != null) return value;
      const parent = await this.resolve(d.get("Parent"));
      if (parent == null) return undefined;
      if (!isPdfDictionary(parent)) return this.invalid("Invalid field parent.");
      d = parent;
    }
  }

  private async fieldName(start: PdfDictionary): Promise<string | undefined> {
    const names: string[] = [], visited = new Set<PdfDictionary>();
    let dictionary: PdfDictionary | undefined = start;
    while (dictionary) {
      if (visited.has(dictionary)) return this.invalid("Cyclic field ancestry.");
      if (visited.size >= this.document.limits.maxRecursionDepth) this.limit("Field ancestry exceeds the recursion limit.");
      visited.add(dictionary);
      const name = await this.text(dictionary.get("T"));
      if (name) names.unshift(name);
      const parent = await this.resolve(dictionary.get("Parent"));
      if (parent == null) break;
      if (!isPdfDictionary(parent)) return this.invalid("Invalid field parent.");
      dictionary = parent;
    }
    return names.length ? names.join(".") : undefined;
  }

  private async fieldValue(value: PdfValue | undefined): Promise<AnnotationField["value"]> {
    const v = await this.resolve(value);
    if (v == null || typeof v === "boolean" || typeof v === "number") return v;
    if (Array.isArray(v)) {
      if (v.length > ANNOTATION_LIMITS.count) this.limit("Too many field values.");
      const values: string[] = [];
      for (const item of v) {
        const text = await this.text(item, true);
        if (text === undefined) return this.invalid("Missing field value.");
        values.push(text);
      }
      return values;
    }
    if (isPdfDictionary(v)) return undefined; // Do not copy signature dictionaries.
    return this.text(v, true);
  }

  private async border(d: PdfDictionary): Promise<AnnotationBorder | undefined> {
    const bs = await this.resolve(d.get("BS"));
    const raw = await this.resolve(d.get("Border"));
    if (bs == null && raw == null) return undefined;
    const result: AnnotationBorder = { width: 1 };
    if (bs != null) {
      if (!isPdfDictionary(bs)) return this.invalid("Invalid border dictionary.");
      const width = await this.resolve(bs.get("W"));
      if (width != null) {
        if (typeof width !== "number" || !Number.isFinite(width) || width < 0) return this.invalid("Invalid border width.");
        result.width = width;
      }
      result.style = await this.text(bs.get("S"), true);
      result.dash = await this.numericArray(bs.get("D"), 1, 0);
    } else {
      if (!Array.isArray(raw) || raw.length < 3 || raw.length > 4) return this.invalid("Invalid border array.");
      const values = await this.numericArray(raw.slice(0, 3), 3);
      if (!values || values.some(n => n < 0)) return this.invalid("Invalid border dimensions.");
      [result.horizontalRadius, result.verticalRadius, result.width] = values;
      result.dash = await this.numericArray(raw[3], 1, 0);
    }
    if (result.dash?.some(n => n < 0)) return this.invalid("Invalid dash lengths.");
    return result;
  }

  private async destination(raw: PdfValue | undefined, remote: boolean, visited: Set<unknown>, depth: number): Promise<AnnotationDestination | undefined> {
    if (depth >= Math.min(this.document.limits.maxRecursionDepth, ANNOTATION_LIMITS.depth)) this.limit("Destination nesting exceeds the recursion limit.");
    const v = await this.resolve(raw);
    if (v == null) return undefined;
    if (isPdfString(v) || isPdfName(v)) {
      const name = (await this.text(v, true))!;
      if (remote) return { name };
      if (visited.has(name)) return this.invalid("Cyclic named destination.");
      visited.add(name);
      const dests = await this.resolve(this.document.catalog.get("Dests"));
      let target = isPdfDictionary(dests) ? dests.get(name) : undefined;
      if (target == null) {
        const names = await this.resolve(this.document.catalog.get("Names"));
        if (isPdfDictionary(names)) target = await this.findNamedDestination(names.get("Dests"), name, new Set(), 0);
      }
      return { name, ...(target == null ? {} : await this.destination(target, false, visited, depth + 1)) };
    }
    if (isPdfDictionary(v)) {
      if (visited.has(v)) return this.invalid("Cyclic destination dictionary.");
      visited.add(v);
      return this.destination(v.get("D"), remote, visited, depth + 1);
    }
    if (!Array.isArray(v) || v.length < 2 || v.length > 6) return this.invalid("Invalid destination array.");
    const fit = await this.text(v[1], true);
    if (!fit) return this.invalid("Missing destination fit mode.");
    const result: AnnotationDestination = { fit };
    const page = v[0];
    if (remote) {
      if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 0) return this.invalid("Invalid remote page index.");
      result.remotePageIndex = page;
    } else {
      const index = this.document.pages.findIndex(p => isPdfRef(page) ? p.ref && pdfRefKey(p.ref) === pdfRefKey(page) : p.dictionary === page);
      if (index >= 0) result.sourcePageIndex = index;
      else if (typeof page === "number" && Number.isSafeInteger(page) && page >= 0 && page < this.document.pages.length) result.sourcePageIndex = page;
    }
    const parameters: (number | null)[] = [];
    for (const rawParam of v.slice(2)) {
      const p = await this.resolve(rawParam);
      if (p !== null && (typeof p !== "number" || !Number.isFinite(p))) return this.invalid("Invalid destination parameter.");
      parameters.push(p);
    }
    result.parameters = parameters;
    return result;
  }

  private async findNamedDestination(raw: PdfValue | undefined, name: string, visited: Set<PdfDictionary>, depth: number): Promise<PdfValue | undefined> {
    if (depth >= Math.min(this.document.limits.maxRecursionDepth, ANNOTATION_LIMITS.depth)) this.limit("Destination name tree exceeds limits.");
    const node = await this.resolve(raw);
    if (node == null) return undefined;
    if (!isPdfDictionary(node) || visited.has(node)) return this.invalid("Invalid or cyclic destination name tree.");
    visited.add(node);
    const entries = await this.resolve(node.get("Names"));
    if (entries != null) {
      if (!Array.isArray(entries) || entries.length % 2) return this.invalid("Invalid destination name entries.");
      for (let i = 0; i < entries.length; i += 2) if (await this.text(entries[i], true) === name) return entries[i + 1];
    }
    const kids = await this.resolve(node.get("Kids"));
    if (kids != null) {
      if (!Array.isArray(kids)) return this.invalid("Invalid destination name children.");
      for (const kid of kids) {
        const match = await this.findNamedDestination(kid, name, visited, depth + 1);
        if (match !== undefined) return match;
      }
    }
    return undefined;
  }

  private async action(raw: PdfValue | undefined, active: Set<PdfDictionary>, depth: number): Promise<AnnotationAction | undefined> {
    const d = await this.resolve(raw);
    if (d == null) return undefined;
    if (++this.actionCount > ANNOTATION_LIMITS.actions || depth >= Math.min(ANNOTATION_LIMITS.depth, this.document.limits.maxRecursionDepth)) this.limit("Annotation action graph exceeds limits.");
    if (!isPdfDictionary(d) || active.has(d)) return this.invalid("Invalid or cyclic action dictionary.");
    active.add(d);
    try {
      const type = await this.text(d.get("S"), true);
      if (!type) return this.invalid("Missing action type.");
      const result: AnnotationAction = { type };
      if (type === "URI") {
        result.uri = await this.text(d.get("URI"));
        const catalogUri = await this.resolve(this.document.catalog.get("URI"));
        if (isPdfDictionary(catalogUri)) result.uriBase = await this.text(catalogUri.get("Base"));
      } else if (type === "GoTo" || type === "GoToR") {
        result.destination = await this.destination(d.get("D"), type === "GoToR", new Set(), 0);
        if (type === "GoToR") {
          const file = await this.resolve(d.get("F"));
          result.file = await this.text(isPdfDictionary(file) ? file.get("UF") ?? file.get("F") : file);
        }
      } else if (type === "Named") result.name = await this.text(d.get("N"), true);
      const next = await this.resolve(d.get("Next"));
      if (next != null) {
        const children: AnnotationAction[] = [];
        for (const item of Array.isArray(next) ? next : [next]) {
          const child = await this.optional("Next", () => this.action(item, active, depth + 1));
          if (child) children.push(child);
        }
        result.next = children;
      }
      return result;
    } finally { active.delete(d); }
  }
}

function freezeMetadata(value: object): void {
  for (const item of Object.values(value)) if (item && typeof item === "object") freezeMetadata(item);
  Object.freeze(value);
}
