import { STRUCTURE_LIMITS, type StructureElement, type StructureUserProperty } from "../structureData";
import { isPdfDictionary, isPdfName, isPdfRef, isPdfString, pdfRefKey, type PdfDictionary, type PdfValue } from "./nativeCos";
import type { NativePdfDocument } from "./nativeDocument";
import { decodePdfString } from "./nativeForms";
import { PdfError, throwIfAborted, type PdfDiagnostic } from "./nativeTypes";

interface StructureRoot {
  readonly dictionary: PdfDictionary;
  readonly identity: string | null;
  readonly parentTree: PdfValue | undefined;
  readonly roleMap: PdfDictionary | null;
  readonly classMap: PdfDictionary | null;
}

/**
 * Lazy reader for the logical structure tree (PDF 32000-1 §14.7): maps a
 * page's MCIDs to structure elements through `/StructParents` and the
 * `/ParentTree`, and detaches the elements a host needs. Malformed structure
 * is diagnosed and skipped; it never prevents a page from opening.
 */
export class NativePdfStructureTree {
  private readonly document: NativePdfDocument;
  private readonly onDiagnostic: (diagnostic: PdfDiagnostic) => void;
  private root: Promise<StructureRoot | null> | null = null;
  private readonly sources = new Map<string, PdfValue>();
  private readonly directIdentities = new WeakMap<PdfDictionary, string>();
  private readonly elements = new Map<string, StructureElement | null>();
  private nextDirectIdentity = 0;
  private textLength = 0;
  private propertyCount = 0;

  constructor(document: NativePdfDocument, onDiagnostic: (diagnostic: PdfDiagnostic) => void) {
    this.document = document;
    this.onDiagnostic = onDiagnostic;
  }

  /** Element ids for a page's MCIDs; MCIDs the structure tree does not map are absent. */
  async resolvePageContentItems(pageIndex: number, mcids: readonly number[], signal?: AbortSignal): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    const root = await this.loadRoot(signal);
    if (!root || root.parentTree == null || mcids.length === 0) return result;
    const key = await this.resolve(this.document.getPage(pageIndex).dictionary.get("StructParents"), signal);
    if (key == null) return result;
    if (typeof key !== "number" || !Number.isSafeInteger(key) || key < 0) {
      this.invalid(`Page ${pageIndex + 1} has an invalid /StructParents key.`, pageIndex);
      return result;
    }
    const entry = await this.resolve(await this.findNumber(root.parentTree, key, signal), signal);
    if (entry == null) return result;
    if (!Array.isArray(entry)) {
      this.invalid(`The /ParentTree entry for page ${pageIndex + 1} is not an array.`, pageIndex);
      return result;
    }
    for (const mcid of new Set(mcids)) {
      const raw = entry[mcid];
      if (raw == null) continue;
      const value = await this.resolve(raw, signal);
      if (!isPdfDictionary(value)) continue;
      result.set(mcid, this.register(raw, value));
    }
    return result;
  }

  /** The elements with these ids, followed by any ancestors not listed, in discovery order. */
  async readElements(ids: Iterable<string>, signal?: AbortSignal): Promise<StructureElement[]> {
    const result = new Map<string, StructureElement>();
    const pending = [...ids].map(id => ({ id, depth: 0 }));
    for (let index = 0; index < pending.length; index++) {
      throwIfAborted(signal);
      const { id, depth } = pending[index];
      if (result.has(id)) continue;
      const element = await this.readElement(id, signal);
      if (!element) continue;
      result.set(id, element);
      if (element.parentId && depth < this.document.limits.maxRecursionDepth) pending.push({ id: element.parentId, depth: depth + 1 });
    }
    return [...result.values()];
  }

  private async loadRoot(signal?: AbortSignal): Promise<StructureRoot | null> {
    this.root ??= (async () => {
      const raw = this.document.catalog.get("StructTreeRoot");
      const dictionary = await this.resolve(raw, signal);
      if (dictionary == null) return null;
      if (!isPdfDictionary(dictionary)) {
        this.invalid("The catalog /StructTreeRoot is not a dictionary.");
        return null;
      }
      const map = async (key: string): Promise<PdfDictionary | null> => {
        const value = await this.resolve(dictionary.get(key), signal);
        if (value == null) return null;
        if (!isPdfDictionary(value)) {
          this.invalid(`The structure tree /${key} is not a dictionary.`);
          return null;
        }
        return value;
      };
      return { dictionary, identity: isPdfRef(raw) ? `ref:${pdfRefKey(raw)}` : null, parentTree: dictionary.get("ParentTree"),
        roleMap: await map("RoleMap"), classMap: await map("ClassMap") };
    })().catch(error => {
      // A cancelled operation must not leave a rejected root cached for later pages.
      if (signal?.aborted || (error instanceof PdfError && error.code === "aborted")) this.root = null;
      throw error;
    });
    return this.root;
  }

  /** Look up a number tree key by following `/Limits`; bounded against cycles and depth. */
  private async findNumber(raw: PdfValue | undefined, key: number, signal?: AbortSignal): Promise<PdfValue | undefined> {
    const visited = new Set<PdfDictionary>();
    const visit = async (value: PdfValue | undefined, depth: number): Promise<PdfValue | undefined> => {
      const node = await this.resolve(value, signal);
      if (node == null) return undefined;
      if (!isPdfDictionary(node) || visited.has(node) || depth > this.document.limits.maxRecursionDepth) {
        this.invalid("The structure /ParentTree is malformed or too deep.");
        return undefined;
      }
      visited.add(node);
      const numbers = await this.resolve(node.get("Nums"), signal);
      if (Array.isArray(numbers)) {
        for (let index = 0; index + 1 < numbers.length; index += 2) {
          if (await this.resolve(numbers[index], signal) === key) return numbers[index + 1];
        }
      }
      const kids = await this.resolve(node.get("Kids"), signal);
      if (!Array.isArray(kids)) return undefined;
      for (const kid of kids) {
        const child = await this.resolve(kid, signal);
        if (!isPdfDictionary(child)) continue;
        const limits = await this.resolve(child.get("Limits"), signal);
        if (Array.isArray(limits) && limits.length === 2) {
          const low = await this.resolve(limits[0], signal), high = await this.resolve(limits[1], signal);
          if (typeof low === "number" && typeof high === "number" && (key < low || key > high)) continue;
        }
        const found = await visit(kid, depth + 1);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    return visit(raw, 0);
  }

  private register(raw: PdfValue, value: PdfDictionary): string {
    let id: string;
    if (isPdfRef(raw)) id = `ref:${pdfRefKey(raw)}`;
    else {
      id = this.directIdentities.get(value) ?? `direct:${this.nextDirectIdentity++}`;
      this.directIdentities.set(value, id);
    }
    if (!this.sources.has(id)) this.sources.set(id, raw);
    return id;
  }

  private async readElement(id: string, signal?: AbortSignal): Promise<StructureElement | null> {
    const cached = this.elements.get(id);
    if (cached !== undefined) return cached;
    if (this.elements.size >= STRUCTURE_LIMITS.elements) {
      this.limit("Structure elements exceed the metadata limit.");
      return null;
    }
    const root = await this.loadRoot(signal);
    const dictionary = await this.resolve(this.sources.get(id), signal);
    let element: StructureElement | null = null;
    if (!root || !isPdfDictionary(dictionary)) this.invalid(`Structure element ${id} is not a dictionary.`);
    else {
      const type = await this.resolve(dictionary.get("S"), signal);
      if (!isPdfName(type)) this.invalid(`Structure element ${id} has no /S type.`);
      else element = await this.detach(id, dictionary, type.value, root, signal);
    }
    this.elements.set(id, element);
    return element;
  }

  private async detach(id: string, dictionary: PdfDictionary, type: string, root: StructureRoot,
    signal?: AbortSignal): Promise<StructureElement> {
    const element: StructureElement = { id, type };
    let standard = type;
    const roles = new Set<string>();
    while (root.roleMap && !roles.has(standard)) {
      roles.add(standard);
      const mapped = await this.resolve(root.roleMap.get(standard), signal);
      if (!isPdfName(mapped) || mapped.value === standard) break;
      standard = mapped.value;
    }
    if (standard !== type) element.standardType = standard;
    const parentRaw = dictionary.get("P");
    const parent = await this.resolve(parentRaw, signal);
    const parentIsRoot = parent === root.dictionary || (isPdfRef(parentRaw) && `ref:${pdfRefKey(parentRaw)}` === root.identity) ||
      (isPdfDictionary(parent) && isPdfName(await this.resolve(parent.get("Type"), signal), "StructTreeRoot"));
    if (parentRaw != null && isPdfDictionary(parent) && !parentIsRoot) element.parentId = this.register(parentRaw, parent);
    for (const [key, field] of [["T", "title"], ["Alt", "alt"], ["ActualText", "actualText"], ["E", "expansion"],
      ["Lang", "lang"], ["ID", "elementId"]] as const) {
      const value = await this.text(dictionary.get(key), id, key, signal);
      if (value !== undefined) element[field] = value;
    }
    const properties = await this.userProperties(dictionary, root, id, signal);
    if (properties.length) element.userProperties = properties;
    return element;
  }

  /** User properties from `/C` attribute classes, then the element's own `/A` attributes. */
  private async userProperties(dictionary: PdfDictionary, root: StructureRoot, id: string,
    signal?: AbortSignal): Promise<StructureUserProperty[]> {
    const attributes: PdfDictionary[] = [];
    const collect = async (raw: PdfValue | undefined): Promise<void> => {
      const value = await this.resolve(raw, signal);
      // Attribute arrays may interleave revision numbers.
      for (const item of Array.isArray(value) ? value : [value]) {
        const attribute = await this.resolve(item, signal);
        if (isPdfDictionary(attribute)) attributes.push(attribute);
      }
    };
    const classes = await this.resolve(dictionary.get("C"), signal);
    for (const name of Array.isArray(classes) ? classes : [classes]) {
      const resolved = await this.resolve(name, signal);
      if (isPdfName(resolved) && root.classMap) await collect(root.classMap.get(resolved.value));
    }
    await collect(dictionary.get("A"));
    const result: StructureUserProperty[] = [];
    for (const attribute of attributes) {
      throwIfAborted(signal);
      if (!isPdfName(await this.resolve(attribute.get("O"), signal), "UserProperties")) continue;
      const entries = await this.resolve(attribute.get("P"), signal);
      if (!Array.isArray(entries)) {
        this.invalid(`Structure element ${id} has a UserProperties attribute without a /P array.`);
        continue;
      }
      for (const raw of entries) {
        const entry = await this.resolve(raw, signal);
        if (!isPdfDictionary(entry)) continue;
        const name = await this.text(entry.get("N"), id, "N", signal);
        if (name === undefined) continue;
        if (++this.propertyCount > STRUCTURE_LIMITS.userProperties) {
          this.limit("Structure user properties exceed the metadata limit.");
          return result;
        }
        const property: StructureUserProperty = { name, value: await this.value(entry.get("V"), id, signal) };
        const formatted = await this.text(entry.get("F"), id, "F", signal);
        if (formatted !== undefined) property.formattedValue = formatted;
        const hidden = await this.resolve(entry.get("H"), signal);
        if (typeof hidden === "boolean") property.hidden = hidden;
        result.push(property);
      }
    }
    return result;
  }

  private async value(raw: PdfValue | undefined, id: string, signal?: AbortSignal): Promise<StructureUserProperty["value"]> {
    const value = await this.resolve(raw, signal);
    if (isPdfString(value)) return (await this.text(value, id, "V", signal)) ?? null;
    if (isPdfName(value)) return this.count(value.value);
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
    return null;
  }

  private async text(raw: PdfValue | undefined, id: string, key: string, signal?: AbortSignal): Promise<string | undefined> {
    const value = await this.resolve(raw, signal);
    if (value == null) return undefined;
    if (!isPdfString(value)) {
      this.invalid(`Structure element ${id} has a non-string /${key}.`);
      return undefined;
    }
    try {
      return this.count(decodePdfString(value, -1, -1));
    } catch (error) {
      if (!(error instanceof PdfError) || error.code === "resource-limit" || error.code === "aborted") throw error;
      this.invalid(`Structure element ${id} has an undecodable /${key} string.`);
      return undefined;
    }
  }

  private count(text: string): string {
    this.textLength += text.length;
    if (this.textLength > STRUCTURE_LIMITS.text) {
      throw new PdfError("resource-limit", "Structure text exceeds the metadata limit.", { details: { reason: "structure-text" } });
    }
    return text;
  }

  private resolve(value: PdfValue | undefined, signal?: AbortSignal): Promise<PdfValue | undefined> {
    throwIfAborted(signal);
    return this.document.resolveValue(value, signal);
  }

  private invalid(message: string, pageIndex?: number): void {
    this.onDiagnostic({ code: "structure.invalid", severity: "warning", message, ...(pageIndex === undefined ? {} : { pageIndex }) });
  }

  private limit(message: string): void {
    this.onDiagnostic({ code: "structure.limit", severity: "warning", message });
  }
}
