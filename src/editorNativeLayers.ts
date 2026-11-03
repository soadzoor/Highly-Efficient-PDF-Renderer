import type { EditorLayerEdits } from "./editorTypes";
import type { SceneOptionalContent, OptionalContentOrderNode } from "./optionalContentData";
import { isPdfDictionary, isPdfName, isPdfRef, isPdfStream, isPdfString, type PdfDictionary, type PdfRef, type PdfValue } from "./pdf/nativeCos";
import { NativePdfWriter, pdfNameValue, pdfTextValue } from "./pdf/nativeWriter";
import { decodePdfString } from "./pdf/nativeForms";
import { createNativeOptionalContentRegistry, nativeOptionalContentSceneIdentities } from "./pdf/nativeOptionalContent";

const key = (ref: PdfRef): string => `${ref.objectNumber}:${ref.generation}`;
const emptyMembership = (): PdfDictionary => new Map([["Type", pdfNameValue("OCMD")]]);

/** Incremental catalog edits retain source OCG resources and unrelated configuration metadata. */
export async function prepareEditorNativePdfLayers(writer: NativePdfWriter, source: SceneOptionalContent | undefined,
  edits: EditorLayerEdits, signal?: AbortSignal) {
  const document = writer.document, groups = new Map<string, PdfRef>();
  const resolve = async (value: PdfValue | undefined): Promise<PdfValue | undefined> => isPdfRef(value)
    ? writer.get(value) ?? await document.resolveValue(value, signal) : value;
  const array = async (value: PdfValue | undefined): Promise<PdfValue[]> => { const result = await resolve(value); return Array.isArray(result) ? result : []; };
  const root = document.getWriterState().xref.trailers.map(trailer => trailer.get("Root")).find(isPdfRef);
  if (!root) throw new Error("Editing PDF layers requires an indirect document catalog.");
  const pending = writer.get(root), catalog = new Map(isPdfDictionary(pending) ? pending : document.catalog);
  const rawProperties = await resolve(catalog.get("OCProperties"));
  const properties = new Map(isPdfDictionary(rawProperties) ? rawProperties : []);
  const physicalRefs = new Map<string, PdfRef>();
  for (const ref of await array(properties.get("OCGs"))) if (isPdfRef(ref)) physicalRefs.set(`ref:${key(ref)}`, ref);
  for (const group of source?.groups ?? []) {
    const match = /^ref:(\d+):(\d+)$/.exec(group.id);
    if (match && !physicalRefs.has(group.id)) {
      const ref: PdfRef = { kind: "ref", objectNumber: Number(match[1]), generation: Number(match[2]) };
      const entry = document.getWriterState().xref.entries.get(ref.objectNumber);
      if (!entry || entry.kind === "free" || entry.generation !== ref.generation) continue;
      const dictionary = await resolve(ref);
      if (isPdfDictionary(dictionary) && isPdfName(dictionary.get("Type"), "OCG")) physicalRefs.set(group.id, ref);
    }
  }
  const drafts: { identity: string; sceneIdentity?: string }[] = [];
  for (const [identity, ref] of physicalRefs) {
    const dictionary = await resolve(ref), id = isPdfDictionary(dictionary) ? await resolve(dictionary.get("HEPRLayerId")) : undefined;
    drafts.push({ identity, ...(isPdfString(id) ? { sceneIdentity: decodePdfString(id, 0, 0) } : {}) });
  }
  const originalRefs = new Map([...nativeOptionalContentSceneIdentities(drafts)].map(([physical, identity]) => [identity, physicalRefs.get(physical)!]));
  const rawDefault = await resolve(properties.get("D")), defaults = new Map(isPdfDictionary(rawDefault) ? rawDefault : []);
  const rawIntent = await resolve(defaults.get("Intent"));
  const intents = (Array.isArray(rawIntent) ? rawIntent : rawIntent ? [rawIntent] : [pdfNameValue("View")]).filter(value => isPdfName(value));
  const visibilityChanges = new Set<string>();
  for (const group of edits.catalog.groups) if (!group.annotationId) {
    signal?.throwIfAborted();
    const existing = originalRefs.get(group.id), value = existing ? await resolve(existing) : undefined;
    const before = source?.groups.find(item => item.id === group.id);
    const dictionary = new Map(isPdfDictionary(value) ? value : [["Type", pdfNameValue("OCG")]]);
    if (!existing || !isPdfDictionary(value)) {
      dictionary.set("HEPRLayerId", pdfTextValue(group.id));
      dictionary.set("Intent", [...new Set(["View", ...intents.filter(intent => intent.value !== "All").map(intent => intent.value)])].map(pdfNameValue));
    }
    if (!isPdfString(dictionary.get("Name")) || before?.name !== group.name) dictionary.set("Name", pdfTextValue(group.name));
    const ref = existing ?? writer.add(dictionary); groups.set(group.id, ref);
    if (existing && before?.name !== group.name) writer.set(existing, dictionary);
    if (!before || before.defaultVisible !== group.defaultVisible) visibilityChanges.add(key(ref));
  }
  const removedRefs = new Set(edits.removedLayerIds.flatMap(id => originalRefs.has(id) ? [key(originalRefs.get(id)!)] : []));
  const keep = (value: PdfValue): boolean => !isPdfRef(value) || !removedRefs.has(key(value));
  const prune = async (value: PdfValue): Promise<PdfValue> => {
    const resolved = await resolve(value);
    if (!Array.isArray(resolved)) return value;
    const values: PdfValue[] = [];
    for (const child of resolved) if (keep(child)) {
      const next = await prune(child); if (!Array.isArray(next) || next.length) values.push(next);
    }
    return values;
  };
  const cleanConfiguration = async (raw: PdfValue | undefined, defaultConfiguration: boolean): Promise<PdfDictionary> => {
    const value = await resolve(raw), result = new Map(isPdfDictionary(value) ? value : []);
    for (const name of ["ON", "OFF", "Locked", "Order", "RBGroups"]) if (result.has(name)) result.set(name, await prune(result.get(name)!));
    if (result.has("AS")) {
      const applications: PdfValue[] = [];
      for (const rawApplication of await array(result.get("AS"))) {
        const application = await resolve(rawApplication); if (!isPdfDictionary(application)) { applications.push(rawApplication); continue; }
        const event = await resolve(application.get("Event")), editedView = defaultConfiguration && isPdfName(event) && event.value === "View";
        const rawGroups = application.get("OCGs"), own = rawGroups === undefined
          ? [...new Map([...originalRefs.values()].map(ref => [key(ref), ref])).values()] : await array(rawGroups);
        const filtered = own.filter(ref => keep(ref) && (!editedView || !isPdfRef(ref) || !visibilityChanges.has(key(ref))));
        if (!filtered.length) continue;
        applications.push(new Map([...application, ["OCGs", filtered]]));
      }
      result.set("AS", applications);
    }
    return result;
  };
  if (edits.catalogChanged) {
    const configuration = await cleanConfiguration(properties.get("D"), true);
    if (!configuration.has("BaseState")) configuration.set("BaseState", pdfNameValue("ON"));
    for (const name of ["ON", "OFF"]) {
      const values = (await array(configuration.get(name))).filter(value => !isPdfRef(value) || !visibilityChanges.has(key(value)));
      for (const group of edits.catalog.groups) if (!group.annotationId && visibilityChanges.has(key(groups.get(group.id)!)) && group.defaultVisible === (name === "ON")) values.push(groups.get(group.id)!);
      configuration.set(name, values);
    }
    const order = (nodes: readonly OptionalContentOrderNode[]): PdfValue[] => nodes.flatMap(node => {
      const children = order(node.children ?? []);
      if (node.kind === "label") return children.length ? [[pdfTextValue(node.label), ...children]] : [];
      const ref = groups.get(node.groupId); return ref ? [ref, ...(children.length ? [children] : [])] : children;
    });
    configuration.set("Order", order(edits.catalog.order));
    configuration.set("Locked", edits.catalog.groups.filter(group => !group.annotationId && group.locked).map(group => groups.get(group.id)!));
    configuration.set("RBGroups", edits.catalog.radioGroups.map(ids => ids.flatMap(id => groups.has(id) ? [groups.get(id)!] : [])).filter(ids => ids.length > 1));
    properties.set("OCGs", [...new Map([...groups.values()].map(ref => [key(ref), ref])).values()]);
    properties.set("D", configuration);
    if (properties.has("Configs")) properties.set("Configs", await Promise.all((await array(properties.get("Configs"))).map(value => cleanConfiguration(value, false))));
    catalog.set("OCProperties", properties); writer.set(root, catalog);
  }
  const membershipRefs = new Map<string, PdfRef>();
  const conditionReference = (data: SceneOptionalContent, condition: number | undefined): PdfRef | boolean => {
    if (condition === undefined) return true;
    const cache = new Map<number, { value: PdfValue; groups: PdfRef[] }>();
    const expression = (index: number): { value: PdfValue; groups: PdfRef[] } => {
      signal?.throwIfAborted();
      const cached = cache.get(index); if (cached) return cached;
      const node = data.conditions[index]; if (!node) throw new RangeError("Unknown PDF layer condition.");
      let result: { value: PdfValue; groups: PdfRef[] };
      if (node.kind === "constant") result = { value: node.value, groups: [] };
      else if (node.kind === "group") {
        const group = data.groups.find(group => group.id === node.groupId);
        if (group?.annotationId) result = { value: true, groups: [] };
        else { const ref = groups.get(node.groupId); if (!ref) throw new RangeError(`Unknown PDF layer ${node.groupId}.`); result = { value: ref, groups: [ref] }; }
      } else if (node.kind === "not") {
        const child = expression(node.operand); result = { value: typeof child.value === "boolean" ? !child.value : [pdfNameValue("Not"), child.value], groups: child.groups };
      } else {
        const children = node.operands.map(expression), and = node.kind === "and", decisive = children.some(child => child.value === !and);
        const remaining = children.filter(child => typeof child.value !== "boolean");
        result = { value: decisive ? !and : !remaining.length ? and : remaining.length === 1 ? remaining[0].value : [pdfNameValue(and ? "And" : "Or"), ...remaining.map(child => child.value)],
          groups: [...new Map(children.flatMap(child => child.groups).map(ref => [key(ref), ref])).values()] };
      }
      cache.set(index, result); return result;
    };
    const result = expression(condition);
    if (typeof result.value === "boolean") return result.value;
    if (isPdfRef(result.value)) return result.value;
    const identity = JSON.stringify(result.value), known = membershipRefs.get(identity); if (known) return known;
    const reference = writer.add(new Map<string, PdfValue>([["Type", pdfNameValue("OCMD")], ["OCGs", result.groups], ["VE", result.value]]));
    membershipRefs.set(identity, reference); return reference;
  };
  return {
    conditionReference,
    groupReference(id: string | null | undefined): PdfRef | undefined {
      if (id == null) return undefined;
      const ref = groups.get(id); if (!ref) throw new RangeError(`Unknown PDF layer ${id}.`); return ref;
    },
    /** Affected source paint is recompiled first; retained stale resources must not resurrect removed groups. */
    async finishRemovals(): Promise<void> {
      if (!removedRefs.size) return;
      const registry = await createNativeOptionalContentRegistry(document, { signal });
      const identities = new Set([...edits.removedLayerIds, ...[...removedRefs].map(value => `ref:${value}`)]), seenRefs = new Set<string>(), seenObjects = new Set<object>();
      const walk = async (raw: PdfValue, owner?: PdfRef): Promise<void> => {
        signal?.throwIfAborted();
        if (isPdfRef(raw)) { const identity = key(raw); if (seenRefs.has(identity)) return; seenRefs.add(identity); }
        const currentOwner = isPdfRef(raw) ? raw : owner;
        const value = await document.resolveValue(raw, signal);
        if (!value || typeof value !== "object" || seenObjects.has(value)) return; seenObjects.add(value);
        if (Array.isArray(value)) { for (const child of value) await walk(child, currentOwner); return; }
        const dictionary = isPdfStream(value) ? value.dictionary : isPdfDictionary(value) ? value : undefined;
        if (!dictionary) return;
        const type = await document.resolveValue(dictionary.get("Type"), signal);
        if (isPdfName(type) && type.value === "OCMD") {
          const membership = await registry.resolvePropertyValue(raw, signal);
          if (membership?.groupIndices.some(index => identities.has(registry.getGroup(index).identity))) {
            if (isPdfRef(raw)) writer.set(raw, emptyMembership());
            else {
              dictionary.delete("OCGs"); dictionary.delete("VE"); dictionary.delete("P");
              if (currentOwner) writer.set(currentOwner, writer.get(currentOwner) ?? await document.resolveObject(currentOwner, signal));
            }
          }
        }
        for (const child of dictionary.values()) await walk(child, currentOwner);
      };
      await walk(document.catalog);
      for (const ref of originalRefs.values()) if (removedRefs.has(key(ref))) writer.set(ref, emptyMembership());
    }
  };
}
