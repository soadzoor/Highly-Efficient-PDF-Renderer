import type { NativePdfDocument } from "./pdf/nativeDocument";
import { NativePdfWriter, pdfNameValue, serializePdfValue } from "./pdf/nativeWriter";
import { decodePdfString } from "./pdf/nativeForms";
import { isPdfDictionary, isPdfName, isPdfRef, isPdfStream, isPdfString, type PdfDictionary, type PdfRef, type PdfStream, type PdfValue } from "./pdf/nativeCos";
import { createNativeOptionalContentRegistry, nativeOptionalContentSceneIdentities } from "./pdf/nativeOptionalContent";

/** Import reachable resources with copy-on-write identities, including cycles. */
export async function importNativePdfValue(value: PdfValue, source: NativePdfDocument, writer: NativePdfWriter,
  signal?: AbortSignal, refs = new Map<string, PdfRef>()): Promise<PdfValue> {
  signal?.throwIfAborted();
  if (isPdfRef(value)) {
    const key = `${value.objectNumber}:${value.generation}`; const known = refs.get(key); if (known) return known;
    const resolved = await source.resolveObject(value, signal);
    if (isPdfStream(resolved) && (resolved.dictionary.has("Length1") ||
      isPdfName(await source.resolveValue(resolved.dictionary.get("Subtype"), signal), "OpenType"))) {
      const normalized = await internableFontStream(resolved, source, signal);
      if (normalized) {
        const serialized = serializePdfValue(normalized);
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", serialized.slice().buffer));
        signal?.throwIfAborted();
        const hash = [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
        const target = writer.intern(`font:${hash}`, normalized); refs.set(key, target); return target;
      }
    }
    const target = writer.add(null); refs.set(key, target);
    writer.set(target, await importNativePdfValue(resolved, source, writer, signal, refs)); return target;
  }
  if (Array.isArray(value)) return await Promise.all(value.map(item => importNativePdfValue(item, source, writer, signal, refs)));
  if (isPdfStream(value)) return { ...value, dictionary: await importNativePdfValue(value.dictionary, source, writer, signal, refs) as PdfDictionary };
  if (isPdfDictionary(value)) {
    const result: PdfDictionary = new Map(); for (const [key, item] of value) result.set(key, await importNativePdfValue(item, source, writer, signal, refs)); return result;
  }
  return value;
}

/** Normalize ordinary font-file metadata before deduplicating it across documents. */
async function internableFontStream(stream: PdfStream, source: NativePdfDocument, signal?: AbortSignal): Promise<PdfStream | undefined> {
  const active = new Set<string>(), memo = new Map<string, PdfValue | undefined>();
  const direct = async (value: PdfValue): Promise<PdfValue | undefined> => {
    signal?.throwIfAborted();
    if (isPdfRef(value)) {
      const key = `${value.objectNumber}:${value.generation}`;
      if (active.has(key) || active.size >= source.limits.maxRecursionDepth) return undefined;
      if (memo.has(key)) return memo.get(key);
      active.add(key);
      const result = await direct(await source.resolveObject(value, signal));
      active.delete(key); memo.set(key, result); return result;
    }
    // Stream references and cyclic/other indirect metadata use the ordinary
    // reserve-and-copy path below, retaining their original graph identities.
    if (isPdfStream(value)) return undefined;
    if (Array.isArray(value)) {
      const result: PdfValue[] = [];
      for (const item of value) { const child = await direct(item); if (child === undefined) return undefined; result.push(child); }
      return result;
    }
    if (isPdfDictionary(value)) {
      const result: PdfDictionary = new Map();
      for (const [key, item] of [...value].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) { const child = await direct(item); if (child === undefined) return undefined; result.set(key, child); }
      return result;
    }
    return value;
  };
  const dictionary = new Map(stream.dictionary); dictionary.delete("Length");
  for (const key of ["Length1", "Length2", "Length3", "Subtype", "Filter", "DecodeParms", "DP"]) {
    const value = dictionary.get(key);
    if (value === undefined) continue;
    const normalized = await direct(value); if (normalized === undefined) return undefined;
    dictionary.set(key, normalized);
  }
  const hasReferences = (value: PdfValue): boolean => isPdfRef(value) || isPdfStream(value) ||
    (Array.isArray(value) ? value.some(hasReferences) : isPdfDictionary(value) ? [...value.values()].some(hasReferences) : false);
  if (hasReferences(dictionary)) return undefined;
  return { ...stream, dictionary: new Map([...dictionary].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) };
}

/** Import default layer visibility alongside the resources that reference it. */
export async function importNativePdfLayers(source: NativePdfDocument, writer: NativePdfWriter,
  refs: Map<string, PdfRef>, signal?: AbortSignal): Promise<void> {
  const properties = await source.resolveValue(source.catalog.get("OCProperties"), signal);
  if (!isPdfDictionary(properties)) return;
  const reused = await reuseImportedNativePdfLayers(source, properties, writer, refs, signal);
  const registry = await createNativeOptionalContentRegistry(source, { signal });
  const visible = new Set(registry.listGroups().filter(group => group.defaultVisible).map(group => group.identity));
  const imported = await importNativePdfValue(properties, source, writer, signal, refs);
  if (!isPdfDictionary(imported)) return;
  const sourceGroups = await source.resolveValue(properties.get("OCGs"), signal), on: PdfRef[] = [], off: PdfRef[] = [];
  for (const group of Array.isArray(sourceGroups) ? sourceGroups : []) if (isPdfRef(group)) {
    const reference = refs.get(`${group.objectNumber}:${group.generation}`);
    if (reference) (visible.has(`ref:${group.objectNumber}:${group.generation}`) ? on : off).push(reference);
  }
  await mergeImportedNativePdfLayers(writer, imported, on, off, reused, signal);
}

async function reuseImportedNativePdfLayers(source: NativePdfDocument, properties: PdfDictionary, writer: NativePdfWriter,
  refs: Map<string, PdfRef>, signal?: AbortSignal): Promise<Set<string>> {
  const destination = writer.document, reused = new Set<string>();
  const root = destination.getWriterState().xref.trailers.map(trailer => trailer.get("Root")).find(isPdfRef);
  const pending = root ? writer.get(root) : undefined, catalog = isPdfDictionary(pending) ? pending : destination.catalog;
  const resolve = async (value: PdfValue | undefined): Promise<PdfValue | undefined> => isPdfRef(value) ? writer.get(value) ?? await destination.resolveValue(value, signal) : value;
  const current = await resolve(catalog.get("OCProperties")); if (!isPdfDictionary(current)) return reused;
  const currentGroups = await resolve(current.get("OCGs")); if (!Array.isArray(currentGroups)) return reused;
  const candidates: { ref: PdfRef; name: string; identity?: string }[] = [];
  for (const ref of currentGroups) if (isPdfRef(ref)) {
    const group = await resolve(ref); if (!isPdfDictionary(group)) continue;
    const type = group.get("Type"); if (!isPdfName(type) || type.value !== "OCG") continue;
    const name = await resolve(group.get("Name")), identity = await resolve(group.get("HEPRLayerId"));
    if (isPdfString(name)) candidates.push({ ref, name: decodePdfString(name, 0, 0), identity: isPdfString(identity) ? decodePdfString(identity, 0, 0) : undefined });
  }
  const identities = nativeOptionalContentSceneIdentities(candidates.map(candidate => ({
    identity: `ref:${candidate.ref.objectNumber}:${candidate.ref.generation}`, sceneIdentity: candidate.identity
  })));
  const groups = await source.resolveValue(properties.get("OCGs"), signal);
  for (const ref of Array.isArray(groups) ? groups : []) if (isPdfRef(ref)) {
    const group = await source.resolveValue(ref, signal);
    if (!isPdfDictionary(group)) continue;
    const type = group.get("Type"); if (!isPdfName(type) || type.value !== "OCG") continue;
    const name = await source.resolveValue(group.get("Name"), signal), identity = await source.resolveValue(group.get("HEPRLayerId"), signal);
    if (!isPdfString(name) || !isPdfString(identity)) continue;
    const id = decodePdfString(identity, 0, 0);
    const match = candidates.find(candidate => identities.get(`ref:${candidate.ref.objectNumber}:${candidate.ref.generation}`) === id);
    if (match) { refs.set(`${ref.objectNumber}:${ref.generation}`, match.ref); reused.add(`${match.ref.objectNumber}:${match.ref.generation}`); }
  }
  return reused;
}

/** Imported Form resources and their catalog visibility must use the same OCG references. */
async function mergeImportedNativePdfLayers(writer: NativePdfWriter, imported: PdfDictionary,
  importedOn: readonly PdfRef[], importedOff: readonly PdfRef[], reused: ReadonlySet<string>, signal?: AbortSignal): Promise<void> {
  const document = writer.document;
  const resolve = async (value: PdfValue | undefined): Promise<PdfValue | undefined> => isPdfRef(value)
    ? writer.get(value) ?? await document.resolveValue(value, signal) : value;
  const array = async (value: PdfValue | undefined): Promise<PdfValue[]> => { const resolved = await resolve(value); return Array.isArray(resolved) ? resolved : []; };
  const unique = (values: readonly PdfValue[]): PdfValue[] => {
    const refs = new Set<string>(), objects = new Set<PdfValue>();
    return values.filter(value => {
      if (isPdfRef(value)) { const key = `${value.objectNumber}:${value.generation}`; if (refs.has(key)) return false; refs.add(key); }
      else { if (objects.has(value)) return false; objects.add(value); }
      return true;
    });
  };
  const root = document.getWriterState().xref.trailers.map(trailer => trailer.get("Root")).find(isPdfRef);
  if (!root) throw new Error("Importing PDF layers requires an indirect document catalog.");
  const pendingRoot = writer.get(root), catalog = new Map(isPdfDictionary(pendingRoot) ? pendingRoot : document.catalog);
  const existingValue = await resolve(catalog.get("OCProperties"));
  const existing = isPdfDictionary(existingValue) ? existingValue : new Map<string, PdfValue>();
  const existingConfig = await resolve(existing.get("D")), importedConfig = await resolve(imported.get("D"));
  const config = new Map(isPdfDictionary(existingConfig) ? existingConfig : []);
  if (!config.has("BaseState")) config.set("BaseState", pdfNameValue("ON"));
  if (isPdfDictionary(importedConfig)) for (const [key, value] of importedConfig) {
    if (!isPdfDictionary(existingValue) && !["BaseState", "ON", "OFF", "Order", "Locked", "RBGroups"].includes(key) && !config.has(key)) config.set(key, value);
  }
  const isNew = (value: PdfValue) => !isPdfRef(value) || !reused.has(`${value.objectNumber}:${value.generation}`);
  const importedGroups = (await array(imported.get("OCGs"))).filter(isNew);
  if (!importedGroups.length) return;
  const intentValue = await resolve(config.get("Intent"));
  const activeIntents = (Array.isArray(intentValue) ? intentValue : intentValue ? [intentValue] : [pdfNameValue("View")]).filter(value => isPdfName(value));
  if (!activeIntents.some(intent => intent.value === "All")) for (const ref of importedGroups) if (isPdfRef(ref)) {
    const group = await resolve(ref); if (!isPdfDictionary(group)) continue;
    const own = await resolve(group.get("Intent"));
    const intents = (Array.isArray(own) ? own : own ? [own] : [pdfNameValue("View")]).filter(value => isPdfName(value));
    const names = [...new Set([...intents, ...activeIntents].map(intent => intent.value))];
    if (activeIntents.some(intent => !intents.some(own => own.value === intent.value))) writer.set(ref, new Map([...group, ["Intent", names.map(pdfNameValue)]]));
  }
  const keys = new Set(importedGroups.filter(isPdfRef).map(ref => `${ref.objectNumber}:${ref.generation}`));
  const keepExisting = (value: PdfValue) => !isPdfRef(value) || !keys.has(`${value.objectNumber}:${value.generation}`);
  // Explicit states preserve imported defaults even when the destination's
  // /BaseState is OFF or Unchanged. Never replace its existing configuration.
  config.set("ON", unique([...(await array(config.get("ON"))).filter(keepExisting), ...importedOn.filter(isNew)]));
  config.set("OFF", unique([...(await array(config.get("OFF"))).filter(keepExisting), ...importedOff.filter(isNew)]));
  for (const key of ["Order", "Locked", "RBGroups"]) {
    let incoming = await array(isPdfDictionary(importedConfig) ? importedConfig.get(key) : undefined);
    const pruneOrder = (values: readonly PdfValue[]): PdfValue[] => {
      const result = values.filter(isNew).map(value => Array.isArray(value) ? pruneOrder(value) : value).filter(value => !Array.isArray(value) || value.length);
      return result.some(value => isPdfRef(value) || Array.isArray(value)) ? result : [];
    };
    if (key === "Order") incoming = pruneOrder(incoming);
    else if (key === "Locked") incoming = incoming.filter(isNew);
    else incoming = incoming.map(value => Array.isArray(value) ? value.filter(isNew) : value).filter(value => Array.isArray(value) && value.length);
    const appended = [...await array(config.get(key)), ...incoming];
    if (appended.length) config.set(key, key === "Locked" ? unique(appended) : appended);
  }
  const merged = new Map(existing);
  merged.set("OCGs", unique([...await array(existing.get("OCGs")), ...importedGroups])); merged.set("D", config);
  catalog.set("OCProperties", merged); writer.set(root, catalog);
}

