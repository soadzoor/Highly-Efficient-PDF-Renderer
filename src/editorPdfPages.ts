import { NativePdfDocument, type NativePdfPage } from "./pdf/nativeDocument";
import { NativePdfWriter, pdfNameValue, pdfReference, pdfTextValue } from "./pdf/nativeWriter";
import { isPdfDictionary, isPdfName, isPdfRef, isPdfStream, isPdfString, pdfRefKey, type PdfDictionary, type PdfRef, type PdfValue } from "./pdf/nativeCos";
import { decodePdfString } from "./pdf/nativeForms";
import { computeNativePdfPageGeometry } from "./pdf/nativePageGeometry";
import { createNativeOptionalContentRegistry } from "./pdf/nativeOptionalContent";
import { invertEditorMatrix, multiplyEditorMatrices } from "./editorScene";
import { createLoadProgressReporter, type LoadProgressCallback } from "./loadProgress";
import type { PdfDiagnostic } from "./pdf/nativeTypes";

export type PdfPageOperation =
  | { readonly kind: "rotate"; readonly pages: readonly number[]; readonly degrees: number }
  | { readonly kind: "remove"; readonly pages: readonly number[] }
  | { readonly kind: "insert"; readonly at: number; readonly bytes: Uint8Array; readonly pages?: readonly number[]; readonly password?: string };
export interface PdfPageOperationOptions {
  readonly password?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: LoadProgressCallback;
  readonly onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
}
type Slot = { ref: PdfRef; dictionary: PdfDictionary; page: NativePdfPage; label?: PdfDictionary };
type Resolver = (value: PdfValue | undefined) => Promise<PdfValue | undefined>;

/** Native page operations retain PDF resources, forms, fonts and vector content. */
export async function manipulatePdfPages(primaryBytes: Uint8Array, operation: PdfPageOperation, options: PdfPageOperationOptions = {}): Promise<Blob> {
  options.signal?.throwIfAborted();
  const progress = createLoadProgressReporter(options.onProgress);
  const diagnostic = (code: string, message: string) => options.onDiagnostic?.({ code, message, severity: "warning" });
  progress.report(0, { stage: "source", sourceType: "pdf" });
  if (!operation || !["rotate", "remove", "insert"].includes(operation.kind)) throw new TypeError("Unknown PDF page operation.");
  const request = operation.kind === "insert" ? { ...operation, pages: operation.pages ? [...operation.pages] : undefined }
    : { ...operation, pages: [...operation.pages] };
  const primary = await NativePdfDocument.open({ kind: "bytes", bytes: primaryBytes }, { password: options.password, signal: options.signal });
  let foreign: NativePdfDocument | undefined;
  try {
    const writer = new NativePdfWriter(primary), root = primary.getWriterState().xref.trailers.map(trailer => trailer.get("Root")).find(isPdfRef);
    if (!root) throw new Error("The PDF catalog has no indirect reference.");
    const catalog = new Map(primary.catalog), pagesRoot = writer.add(null), blocked = new Set<string>();
    const resolve: Resolver = async value => isPdfRef(value) ? writer.get(value) ?? await primary.resolveObject(value, options.signal) : value;
    const primaryLabels = await pageLabels(primary, options.signal);
    const slots: Slot[] = primary.pages.map((page, index) => ({ ref: page.ref ?? writer.add(null), dictionary: materialize(page), page, label: primaryLabels[index] }));
    const oldTree = await pageTreeReferences(primary, options.signal); for (const key of oldTree) blocked.add(key);
    progress.report(.1, { stage: "pdf-page", sourceType: "pdf", unit: "pages", processed: 0, total: slots.length, pageCount: slots.length });
    if (request.kind === "rotate") {
      const indices = validatePages(request.pages, slots.length);
      if (!Number.isFinite(request.degrees) || request.degrees % 90 !== 0) throw new RangeError("Page rotation must be a multiple of 90 degrees.");
      for (const index of indices) slots[index].dictionary.set("Rotate", ((slots[index].page.rotation + request.degrees) % 360 + 360) % 360);
    } else if (request.kind === "remove") {
      const indices = validatePages(request.pages, slots.length);
      if (indices.size >= slots.length) throw new RangeError("A PDF must retain at least one page.");
      const kept = primary.pages.filter((_, index) => !indices.has(index));
      const fields = await selectedFields(primary, kept, options.signal, true);
      const inline = (value: PdfValue): PdfValue => {
        if (!isPdfDictionary(value)) return value;
        const replacement = new Map(fields.overrides.get(value) ?? value), kids = replacement.get("Kids");
        if (Array.isArray(kids)) replacement.set("Kids", kids.map(inline)); return replacement;
      };
      for (const [dictionary, replacement] of fields.overrides) {
        const reference = fields.references.get(dictionary); if (reference) writer.set(reference, inline(replacement));
      }
      if (fields.acro) {
        const acro = new Map(fields.acro); acro.set("Fields", fields.roots.map(inline));
        const order = await primary.resolveValue(acro.get("CO"), options.signal);
        if (Array.isArray(order)) acro.set("CO", order.filter(value => !isPdfRef(value) || fields.keptRefs.has(pdfRefKey(value))));
        catalog.set("AcroForm", acro);
      }
      for (const index of [...indices].sort((a, b) => b - a)) { if (slots[index].page.ref) blocked.add(pdfRefKey(slots[index].page.ref!)); slots.splice(index, 1); }
      if (catalog.has("StructTreeRoot")) diagnostic("pages.structure-detached", "Removed pages were detached from the PDF structure tree; tags or bookmarks targeting those pages may need review.");
    } else {
      if (!Number.isSafeInteger(request.at) || request.at < 0 || request.at > slots.length) throw new RangeError("The insertion position is outside the PDF.");
      foreign = await NativePdfDocument.open({ kind: "bytes", bytes: request.bytes }, { password: request.password, signal: options.signal });
      if (foreign.catalog.has("Outlines")) diagnostic("pages.bookmarks-not-merged", "Imported document bookmarks were not merged; links between selected imported pages are preserved.");
      const indices = request.pages === undefined ? new Set(foreign.pages.map((_, index) => index)) : validatePages(request.pages, foreign.pages.length);
      if (!indices.size) throw new RangeError("Select at least one page to insert.");
      const selected = [...indices].map(index => foreign!.getPage(index)), refs = new Map<string, PdfRef>(), overrides = new Map<PdfDictionary, PdfDictionary>();
      const foreignTree = await pageTreeReferences(foreign, options.signal), foreignPages = new Map(foreign.pages.filter(page => page.ref).map(page => [pdfRefKey(page.ref!), page]));
      const selectedReferences = new Set(selected.flatMap(page => page.ref ? [pdfRefKey(page.ref)] : []));
      const foreignLabels = await pageLabels(foreign, options.signal);
      const importedSlots: Slot[] = selected.map(page => { const ref = writer.add(null); if (page.ref) refs.set(pdfRefKey(page.ref), ref); return { ref, dictionary: materialize(page), page, label: foreignLabels[page.sourcePageIndex] }; });
      const fields = await selectedFields(foreign, selected, options.signal, indices.size === foreign.pages.length); for (const [key, value] of fields.overrides) overrides.set(key, value);
      const foreignDestinations = await namedDestinations(foreign, options.signal);
      const warned = new Set<string>();
      const warn = (code: string, message: string) => { if (!warned.has(code)) { warned.add(code); diagnostic(code, message); } };
      const layerPrefix = `import:${importedSlots[0].ref.objectNumber}:`;
      const destination = async (value: PdfValue): Promise<PdfValue> => {
        let actual = await foreign!.resolveValue(value, options.signal) ?? null;
        if (isPdfName(actual) || isPdfString(actual)) {
          const name = isPdfName(actual) ? actual.value : decodePdfString(actual, 0, 0);
          actual = foreignDestinations.get(name) ?? null;
          if (actual === null) warn("pages.navigation-detached", "An imported named destination could not be resolved and was detached.");
        }
        if (isPdfDictionary(actual)) actual = await foreign!.resolveValue(actual.get("D"), options.signal) ?? null;
        if (Array.isArray(actual) && typeof actual[0] === "number") {
          const page = foreign!.pages[actual[0]]; actual = page?.ref ? [page.ref, ...actual.slice(1)] : null;
        }
        return actual;
      };
      const importValue = async (value: PdfValue): Promise<PdfValue> => {
        options.signal?.throwIfAborted();
        if (isPdfRef(value)) {
          const key = pdfRefKey(value), known = refs.get(key); if (known) return known;
          if (foreignTree.has(key) || (foreignPages.has(key) && !selectedReferences.has(key))) {
            warn("pages.navigation-detached", "A reference to an unselected imported page was detached."); return null;
          }
          const ref = writer.add(null); refs.set(key, ref); writer.set(ref, await importValue(await foreign!.resolveObject(value, options.signal))); return ref;
        }
        if (Array.isArray(value)) { const array: PdfValue[] = []; for (const item of value) array.push(await importValue(item)); return array; }
        if (isPdfStream(value)) return { ...value, dictionary: await importValue(value.dictionary) as PdfDictionary };
        if (isPdfDictionary(value)) {
          const original = value, source = overrides.get(value) ?? value, dictionary: PdfDictionary = new Map();
          for (const [key, item] of source) {
            if (key === "StructParents" || key === "StructParent") { warn("pages.structure-detached", "Imported page tags were detached from their original document structure; visual content and annotations are preserved."); continue; }
            const internalDestination = key === "Dest" || (key === "D" && isPdfName(source.get("S"), "GoTo"));
            dictionary.set(key, await importValue(internalDestination ? await destination(item) : item));
          }
          if (isPdfName(original.get("Type"), "OCG") && dictionary.has("HEPRLayerId")) {
            const identity = dictionary.get("HEPRLayerId"); if (isPdfString(identity)) dictionary.set("HEPRLayerId", pdfTextValue(layerPrefix + decodePdfString(identity, 0, 0)));
          }
          return dictionary;
        }
        return value;
      };
      // Reserve all selected field nodes before importing annotation parents,
      // so shared owners never pull widgets from unselected pages.
      for (const [dictionary, ref] of fields.references) if (fields.overrides.has(dictionary) && !refs.has(pdfRefKey(ref))) refs.set(pdfRefKey(ref), writer.add(null));
      const mainAcro = await resolve(catalog.get("AcroForm")), acro = new Map(isPdfDictionary(mainAcro) ? mainAcro : []);
      const mainFields = await resolve(acro.get("Fields")), roots = Array.isArray(mainFields) ? [...mainFields] : [];
      const occupied = new Set<string>();
      for (const field of roots) { const dictionary = await resolve(field); if (isPdfDictionary(dictionary)) { const name = await resolve(dictionary.get("T")); if (isPdfString(name)) occupied.add(decodePdfString(name, 0, 0)); } }
      let namespace = "Imported1"; for (let count = 2; occupied.has(namespace); count++) namespace = `Imported${count}`;
      const namespaceRef = writer.add(null), namespaced: PdfValue[] = [];
      const defaults = await mergeFieldResources(acro, fields.acro, foreign, importValue, resolve, layerPrefix, options.signal);
      for (const [original, replacement] of fields.overrides) {
        const dictionary = new Map(replacement), rawDa = await foreign.resolveValue(dictionary.get("DA"), options.signal);
        if (isPdfString(rawDa)) dictionary.set("DA", { ...rawDa, bytes: rewriteAppearanceNames(rawDa.bytes, defaults.aliases) });
        overrides.set(original, dictionary);
      }
      for (const field of fields.roots) {
        const original = await foreign.resolveValue(field, options.signal); if (!isPdfDictionary(original)) continue;
        const dictionary = new Map(overrides.get(original) ?? original), name = await foreign.resolveValue(dictionary.get("T"), options.signal);
        if (!dictionary.has("DA") && defaults.appearance) dictionary.set("DA", defaults.appearance);
        if (!dictionary.has("Q") && fields.acro?.has("Q")) dictionary.set("Q", await foreign.resolveValue(fields.acro.get("Q"), options.signal) ?? 0);
        if (isPdfString(name) && occupied.has(decodePdfString(name, 0, 0))) { dictionary.delete("Parent"); namespaced.push(field); }
        else { dictionary.delete("Parent"); if (isPdfString(name)) occupied.add(decodePdfString(name, 0, 0)); }
        overrides.set(original, dictionary);
      }
      for (const [dictionary, ref] of fields.references) if (overrides.has(dictionary)) writer.set(refs.get(pdfRefKey(ref))!, await importValue(overrides.get(dictionary)!));
      for (const field of fields.roots) {
        const imported = await importValue(field); if (!namespaced.includes(field)) roots.push(imported);
      }
      if (namespaced.length) {
        const kids: PdfValue[] = []; for (const field of namespaced) {
          const imported = await importValue(field), current = await resolve(imported);
          if (isPdfDictionary(current)) {
            const dictionary = new Map(current); dictionary.set("Parent", namespaceRef);
            if (isPdfRef(imported)) { writer.set(imported, dictionary); kids.push(imported); } else kids.push(dictionary);
          }
        }
        writer.set(namespaceRef, new Map([["T", pdfTextValue(namespace)], ["Kids", kids]])); roots.push(namespaceRef);
        diagnostic("pages.fields-namespaced", `Colliding imported form fields were placed under ${namespace}; calculations referring to their original names may need review.`);
      }
      if (fields.roots.length) {
        const oldOrder = await resolve(acro.get("CO")), sourceOrder = fields.acro ? await foreign.resolveValue(fields.acro.get("CO"), options.signal) : undefined;
        const order: PdfValue[] = Array.isArray(oldOrder) ? [...oldOrder] : [];
        for (const field of Array.isArray(sourceOrder) ? sourceOrder : []) if (isPdfRef(field) && fields.keptRefs.has(pdfRefKey(field))) order.push(await importValue(field));
        if (order.length) acro.set("CO", order);
        acro.set("SigFlags", Number(acro.get("SigFlags") ?? 0) | Number(fields.acro?.get("SigFlags") ?? 0));
        acro.set("Fields", roots); acro.set("NeedAppearances", acro.get("NeedAppearances") === true || fields.acro?.get("NeedAppearances") === true); catalog.set("AcroForm", acro);
        if (fields.acro?.has("XFA")) diagnostic("pages.xfa-detached", "Imported XFA document data was not merged; widget appearances and AcroForm fields are preserved.");
      }
      for (let index = 0; index < importedSlots.length; index++) {
        const slot = importedSlots[index]; slot.dictionary.delete("Parent"); slot.dictionary = await importValue(slot.dictionary) as PdfDictionary;
        progress.report(.15 + .45 * (index + 1) / importedSlots.length, { stage: "pdf-page", sourceType: "pdf", unit: "pages", processed: index + 1, total: importedSlots.length, pageIndex: index, pageCount: importedSlots.length });
      }
      await mergeLayers(primary, foreign, catalog, importValue, resolve, options.signal);
      slots.splice(request.at, 0, ...importedSlots);
    }
    for (let index = 0; index < slots.length; index++) {
      const slot = slots[index]; slot.dictionary.set("Parent", pagesRoot);
      await updateTextMetadata(slot, index, writer, resolve, options.signal);
      writer.set(slot.ref, slot.dictionary);
    }
    writer.set(pagesRoot, new Map<string, PdfValue>([["Type", pdfNameValue("Pages")], ["Kids", slots.map(slot => slot.ref)], ["Count", slots.length]]));
    catalog.set("Pages", pagesRoot);
    const existingVersion = catalog.get("Version"), versions = ["1.7", primary.info.version, foreign?.info.version, isPdfName(existingVersion) ? existingVersion.value : undefined];
    catalog.set("Version", pdfNameValue(versions.reduce<string>((highest, version) => version && Number(version) > Number(highest) ? version : highest, "1.7")));
    if (request.kind !== "rotate" && slots.some(slot => slot.label)) catalog.set("PageLabels", new Map([["Nums", slots.flatMap((slot, index): PdfValue[] => [index, slot.label ?? new Map<string, PdfValue>([["S", pdfNameValue("D")], ["St", slot.page.sourcePageIndex + 1]])])]]));
    writer.set(root, catalog);
    progress.report(.65, { stage: "compile", sourceType: "pdf", unit: "pages", processed: slots.length, total: slots.length, pageCount: slots.length });
    await sanitizeReachable(root, writer, blocked, diagnostic, options.signal);
    progress.report(.85, { stage: "compile", sourceType: "pdf" });
    const bytes = await writer.save(options.signal, { rewrite: true });
    progress.complete({ sourceType: "pdf", unit: "bytes", processed: bytes.length, total: bytes.length, pageCount: slots.length });
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
  } finally { await foreign?.close(); await primary.close(); }
}

function validatePages(pages: readonly number[], count: number): Set<number> {
  if (!Array.isArray(pages)) throw new TypeError("Page indices must be an array.");
  const selected = new Set<number>();
  for (const page of pages) {
    if (!Number.isSafeInteger(page) || page < 0 || page >= count) throw new RangeError("A page index is outside the PDF.");
    if (selected.has(page)) throw new RangeError("Page indices must be unique."); selected.add(page);
  }
  return selected;
}
function materialize(page: NativePdfPage): PdfDictionary {
  return new Map([...page.dictionary, ["MediaBox", [...page.mediaBox]], ["CropBox", [...page.cropBox]], ["Rotate", page.rotation],
    ["UserUnit", page.userUnit], ["Resources", page.resources ?? new Map()]]);
}
async function pageTreeReferences(document: NativePdfDocument, signal?: AbortSignal): Promise<Set<string>> {
  const references = new Set<string>();
  for (const page of document.pages) {
    let parent = page.dictionary.get("Parent");
    while (isPdfRef(parent) && !references.has(pdfRefKey(parent))) {
      references.add(pdfRefKey(parent)); const dictionary = await document.resolveValue(parent, signal); parent = isPdfDictionary(dictionary) ? dictionary.get("Parent") : undefined;
    }
  }
  return references;
}

async function selectedFields(document: NativePdfDocument, pages: readonly NativePdfPage[], signal?: AbortSignal, preserveUnattached = false): Promise<{
  acro?: PdfDictionary; roots: PdfValue[]; overrides: Map<PdfDictionary, PdfDictionary>; references: Map<PdfDictionary, PdfRef>; keptRefs: Set<string>;
}> {
  const acro = await document.resolveValue(document.catalog.get("AcroForm"), signal), roots = isPdfDictionary(acro) ? await document.resolveValue(acro.get("Fields"), signal) : undefined;
  const selected = new Set<PdfDictionary>(), references = new Map<PdfDictionary, PdfRef>(), overrides = new Map<PdfDictionary, PdfDictionary>(), keptRefs = new Set<string>();
  for (const page of pages) {
    const annotations = await document.resolveValue(page.annotations, signal);
    for (const value of Array.isArray(annotations) ? annotations : []) {
      let raw: PdfValue | undefined = value;
      while (raw) {
        const dictionary = await document.resolveValue(raw, signal); if (!isPdfDictionary(dictionary) || selected.has(dictionary)) break;
        if (raw === value && !isPdfName(dictionary.get("Subtype"), "Widget")) break;
        selected.add(dictionary); if (isPdfRef(raw)) { references.set(dictionary, raw); keptRefs.add(pdfRefKey(raw)); }
        raw = dictionary.get("Parent");
      }
    }
  }
  if (preserveUnattached) {
    const visited = new Set<PdfDictionary>();
    const keepUnattached = async (raw: PdfValue, ancestors: { dictionary: PdfDictionary; reference?: PdfRef }[]): Promise<void> => {
      const dictionary = await document.resolveValue(raw, signal); if (!isPdfDictionary(dictionary) || visited.has(dictionary)) return; visited.add(dictionary);
      const current = { dictionary, reference: isPdfRef(raw) ? raw : undefined }, chain = [...ancestors, current], kids = await document.resolveValue(dictionary.get("Kids"), signal);
      if (Array.isArray(kids) && kids.length) { for (const child of kids) await keepUnattached(child, chain); }
      else if (!isPdfName(dictionary.get("Subtype"), "Widget")) for (const node of chain) {
        selected.add(node.dictionary); if (node.reference) { references.set(node.dictionary, node.reference); keptRefs.add(pdfRefKey(node.reference)); }
      }
    };
    for (const root of Array.isArray(roots) ? roots : []) await keepUnattached(root, []);
  }
  for (const dictionary of selected) {
    const replacement = new Map(dictionary), kids = await document.resolveValue(dictionary.get("Kids"), signal);
    if (Array.isArray(kids)) {
      const kept: PdfValue[] = []; for (const child of kids) { const value = await document.resolveValue(child, signal); if (isPdfDictionary(value) && selected.has(value)) kept.push(child); }
      replacement.set("Kids", kept);
      const active = replacement.get("V");
      if (isPdfName(replacement.get("FT"), "Btn") && isPdfName(active) && active.value !== "Off" && kept.length < kids.length) {
        let activeSurvives = false;
        for (const child of kept) { const widget = await document.resolveValue(child, signal); if (isPdfDictionary(widget) && isPdfName(widget.get("AS"), active.value)) activeSurvives = true; }
        if (!activeSurvives) replacement.set("V", pdfNameValue("Off"));
      }
    }
    overrides.set(dictionary, replacement);
  }
  const keptRoots: PdfValue[] = [];
  for (const root of Array.isArray(roots) ? roots : []) { const value = await document.resolveValue(root, signal); if (isPdfDictionary(value) && selected.has(value)) keptRoots.push(root); }
  for (const dictionary of selected) if (!dictionary.has("Parent") && !keptRoots.some(value => value === dictionary || (isPdfRef(value) && references.get(dictionary) && pdfRefKey(value) === pdfRefKey(references.get(dictionary)!)))) keptRoots.push(references.get(dictionary) ?? dictionary);
  return { acro: isPdfDictionary(acro) ? acro : undefined, roots: keptRoots, overrides, references, keptRefs };
}

async function updateTextMetadata(slot: Slot, pageIndex: number, writer: NativePdfWriter, resolve: Resolver, signal?: AbortSignal): Promise<void> {
  const annotations = await resolve(slot.dictionary.get("Annots")); if (!Array.isArray(annotations)) return;
  const rotation = Number(slot.dictionary.get("Rotate")) as NativePdfPage["rotation"];
  const before = computeNativePdfPageGeometry(slot.page).pageMatrix, after = computeNativePdfPageGeometry({ ...slot.page, rotation }).pageMatrix;
  const delta = multiplyEditorMatrices(after, invertEditorMatrix(before)), result: PdfValue[] = [];
  for (const raw of annotations) {
    signal?.throwIfAborted(); const annotation = await resolve(raw);
    if (!isPdfDictionary(annotation)) { result.push(raw); continue; }
    const stored = await resolve(annotation.get("HEPRText"));
    if (!isPdfString(stored)) { result.push(raw); continue; }
    try {
      const data = JSON.parse(decodePdfString(stored, pageIndex, 0));
      if (data?.version === 1 && data.object?.kind === "text" && Array.isArray(data.object.transform) && data.object.transform.length === 6 && data.object.transform.every((value: unknown) => typeof value === "number" && Number.isFinite(value))) {
        data.object.transform = multiplyEditorMatrices(delta, data.object.transform); data.object.pageIndex = pageIndex;
        const changed = new Map(annotation); changed.set("HEPRText", pdfTextValue(JSON.stringify(data)));
        if (isPdfRef(raw)) { writer.set(raw, changed); result.push(raw); } else result.push(changed);
      } else result.push(raw);
    } catch { result.push(raw); }
  }
  slot.dictionary.set("Annots", result);
}

async function mergeFieldResources(acro: PdfDictionary, foreignAcro: PdfDictionary | undefined, foreign: NativePdfDocument,
  importValue: (value: PdfValue) => Promise<PdfValue>, resolve: Resolver, prefix: string, signal?: AbortSignal): Promise<{ aliases: Map<string, string>; appearance?: PdfValue }> {
  const aliases = new Map<string, string>(), source = foreignAcro ? await foreign.resolveValue(foreignAcro.get("DR"), signal) : undefined;
  const original = await resolve(acro.get("DR")), resources = new Map(isPdfDictionary(original) ? original : []);
  const reserved = new Set<string>();
  for (const raw of resources.values()) { const dictionary = await resolve(raw); if (isPdfDictionary(dictionary)) for (const name of dictionary.keys()) reserved.add(name); }
  if (isPdfDictionary(source)) for (const [category, raw] of source) {
    const entries = await foreign.resolveValue(raw, signal); if (!isPdfDictionary(entries)) continue;
    const current = await resolve(resources.get(category)), merged = new Map(isPdfDictionary(current) ? current : []);
    for (const [name, value] of entries) {
      let alias = aliases.get(name);
      if (!alias) { alias = `HEPR${prefix.replace(/[^A-Za-z0-9]/g, "_")}${name}`; while (reserved.has(alias)) alias += "_"; aliases.set(name, alias); reserved.add(alias); }
      merged.set(alias, await importValue(value));
    }
    resources.set(category, merged);
  }
  if (resources.size) acro.set("DR", resources);
  const appearance = foreignAcro ? await foreign.resolveValue(foreignAcro.get("DA"), signal) : undefined;
  return { aliases, appearance: isPdfString(appearance) ? { ...appearance, bytes: rewriteAppearanceNames(appearance.bytes, aliases) } : undefined };
}
function rewriteAppearanceNames(bytes: Uint8Array, aliases: ReadonlyMap<string, string>): Uint8Array {
  const text = Array.from(bytes, byte => String.fromCharCode(byte)).join("");
  const replaced = text.replace(/\/([^\s()[\]<>\/%{}]+)/g, (token, name: string) => {
    const decoded = name.replace(/#([a-f\d]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))), alias = aliases.get(decoded);
    return alias ? "/" + Array.from(new TextEncoder().encode(alias), byte => byte >= 33 && byte <= 126 && !"#%()/<>[]{}".includes(String.fromCharCode(byte)) ? String.fromCharCode(byte) : "#" + byte.toString(16).padStart(2, "0")).join("") : token;
  });
  return Uint8Array.from(replaced, character => character.charCodeAt(0));
}

async function mergeLayers(primary: NativePdfDocument, foreign: NativePdfDocument, catalog: PdfDictionary,
  importValue: (value: PdfValue) => Promise<PdfValue>, resolve: Resolver, signal?: AbortSignal): Promise<void> {
  const raw = await foreign.resolveValue(foreign.catalog.get("OCProperties"), signal); if (!isPdfDictionary(raw)) return;
  const imported = await importValue(raw); if (!isPdfDictionary(imported)) return;
  const currentRaw = await resolve(catalog.get("OCProperties")), current = new Map(isPdfDictionary(currentRaw) ? currentRaw : []);
  const a = await resolve(current.get("OCGs")), b = await resolve(imported.get("OCGs"));
  const groups = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
  const defaultsRaw = await resolve(current.get("D")), defaults = new Map(isPdfDictionary(defaultsRaw) ? defaultsRaw : []), importedDefaults = await resolve(imported.get("D"));
  const on: PdfValue[] = [], off: PdfValue[] = [], primaryRegistry = await createNativeOptionalContentRegistry(primary, { signal }), foreignRegistry = await createNativeOptionalContentRegistry(foreign, { signal });
  for (const [entries, registry] of [[Array.isArray(a) ? a : [], primaryRegistry], [Array.isArray(b) ? b : [], foreignRegistry]] as const) {
    const original = registry.listGroups(); for (let index = 0; index < entries.length; index++) (original[index]?.defaultVisible === false ? off : on).push(entries[index]);
  }
  defaults.set("BaseState", pdfNameValue("ON")); defaults.set("ON", on); defaults.set("OFF", off);
  for (const key of ["Order", "Locked", "RBGroups", "AS"]) {
    const one = await resolve(defaults.get(key)), two = isPdfDictionary(importedDefaults) ? await resolve(importedDefaults.get(key)) : undefined;
    if (Array.isArray(one) || Array.isArray(two)) defaults.set(key, [...(Array.isArray(one) ? one : []), ...(Array.isArray(two) ? two : [])]);
  }
  current.set("OCGs", groups); current.set("D", defaults); catalog.set("OCProperties", current);
  const oldConfigurations = await resolve(current.get("Configs")), newConfigurations = await resolve(imported.get("Configs"));
  if (Array.isArray(oldConfigurations) || Array.isArray(newConfigurations)) current.set("Configs", [...(Array.isArray(oldConfigurations) ? oldConfigurations : []), ...(Array.isArray(newConfigurations) ? newConfigurations : [])]);
}

async function pageLabels(document: NativePdfDocument, signal?: AbortSignal): Promise<(PdfDictionary | undefined)[]> {
  const raw = document.catalog.get("PageLabels"); if (!raw) return [];
  const pending: PdfValue[] = [raw], visited = new Set<string>(), ranges = new Map<number, PdfDictionary>();
  while (pending.length) {
    const value = pending.pop()!; if (isPdfRef(value)) { if (visited.has(pdfRefKey(value))) continue; visited.add(pdfRefKey(value)); }
    const node = await document.resolveValue(value, signal); if (!isPdfDictionary(node)) continue;
    const numbers = await document.resolveValue(node.get("Nums"), signal), kids = await document.resolveValue(node.get("Kids"), signal);
    if (Array.isArray(numbers)) for (let index = 0; index + 1 < numbers.length; index += 2) {
      const start = numbers[index], source = await document.resolveValue(numbers[index + 1], signal); if (typeof start !== "number" || !isPdfDictionary(source)) continue;
      const dictionary: PdfDictionary = new Map(); for (const key of ["S", "P", "St"]) { const value = await document.resolveValue(source.get(key), signal); if (value !== undefined) dictionary.set(key, value); }
      ranges.set(start, dictionary);
    }
    if (Array.isArray(kids)) for (const child of kids) pending.push(child);
  }
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  return document.pages.map((_, index) => {
    let active: [number, PdfDictionary] | undefined;
    for (let position = sorted.length - 1; position >= 0; position--) if (sorted[position][0] <= index) { active = sorted[position]; break; }
    if (!active) return undefined;
    const dictionary = new Map(active[1]); if (dictionary.has("S")) dictionary.set("St", Number(dictionary.get("St") ?? 1) + index - active[0]); return dictionary;
  });
}

async function namedDestinations(document: NativePdfDocument, signal?: AbortSignal): Promise<Map<string, PdfValue>> {
  const names = new Map<string, PdfValue>(), legacy = await document.resolveValue(document.catalog.get("Dests"), signal);
  if (isPdfDictionary(legacy)) for (const [name, value] of legacy) names.set(name, value);
  const tree = await document.resolveValue(document.catalog.get("Names"), signal), pending: PdfValue[] = isPdfDictionary(tree) && tree.has("Dests") ? [tree.get("Dests")!] : [], seen = new Set<string>();
  while (pending.length) {
    const value = pending.pop()!; if (isPdfRef(value)) { if (seen.has(pdfRefKey(value))) continue; seen.add(pdfRefKey(value)); }
    const node = await document.resolveValue(value, signal); if (!isPdfDictionary(node)) continue;
    const entries = await document.resolveValue(node.get("Names"), signal), kids = await document.resolveValue(node.get("Kids"), signal);
    if (Array.isArray(entries)) for (let index = 0; index + 1 < entries.length; index += 2) { const name = entries[index]; if (isPdfString(name)) names.set(decodePdfString(name, 0, 0), entries[index + 1]); }
    if (Array.isArray(kids)) for (const child of kids) pending.push(child);
  }
  return names;
}

async function sanitizeReachable(root: PdfRef, writer: NativePdfWriter, blocked: ReadonlySet<string>, diagnostic: (code: string, message: string) => void, signal?: AbortSignal): Promise<void> {
  const pending: PdfRef[] = [root], visited = new Set<string>(); let warned = false;
  const clean = (value: PdfValue): PdfValue => {
    if (isPdfRef(value)) {
      if (blocked.has(pdfRefKey(value))) { if (!warned) { warned = true; diagnostic("pages.navigation-detached", "Navigation or structure references to removed pages were detached."); } return null; }
      pending.push(value); return value;
    }
    if (Array.isArray(value)) return value.map(clean);
    if (isPdfStream(value)) return { ...value, dictionary: clean(value.dictionary) as PdfDictionary };
    if (isPdfDictionary(value)) {
      const dictionary: PdfDictionary = new Map();
      for (const [key, item] of value) {
        const result = clean(item);
        if ((key === "Dest" || (key === "D" && isPdfName(value.get("S"), "GoTo"))) && (result === null || (Array.isArray(result) && result[0] === null))) continue;
        dictionary.set(key, result);
      }
      return dictionary;
    }
    return value;
  };
  for (const trailer of writer.document.getWriterState().xref.trailers) for (const [key, value] of trailer) if (!["Encrypt", "ID", "Prev", "XRefStm"].includes(key)) clean(value);
  while (pending.length) {
    signal?.throwIfAborted(); const ref = pending.pop()!, key = pdfRefKey(ref); if (visited.has(key)) continue; visited.add(key);
    const current = writer.get(ref), entry = writer.document.getWriterState().xref.entries.get(ref.objectNumber);
    if (current === undefined && (entry?.generation !== ref.generation || entry.kind === "free")) continue;
    writer.set(ref, clean(current ?? await writer.document.resolveObject(ref, signal)));
  }
}
