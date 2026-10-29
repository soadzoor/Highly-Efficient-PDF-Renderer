import { NativePdfDocument } from "./pdf/nativeDocument";
import { NativePdfWriter, pdfAsciiValue, pdfNameValue, pdfStreamValue, pdfTextValue, pdfNumberValue, serializePdfValue } from "./pdf/nativeWriter";
import { NativePdfFormAppearanceRegistry, decodePdfString, type NativePdfAnnotationAppearance, type NativePdfForm } from "./pdf/nativeForms";
import { NativePdfAppearanceSynthesizer } from "./pdf/nativeAppearanceSynthesis";
import { createBundledStandardFontResolver } from "./standardFontResolver";
import { isPdfDictionary, isPdfName, isPdfRef, isPdfStream, isPdfString, type PdfDictionary, type PdfRef, type PdfValue } from "./pdf/nativeCos";
import type { EditorFieldValue, EditorMatrix, EditorObject, EditorPdfSaveOptions, EditorSession, EditorTextObject } from "./editorTypes";
import type { PdfBox } from "./heprDocumentData";
import type { VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import type { EditorFontRegistry } from "./editorFonts";
import { editorTextPdf } from "./editorText";
import { writeScenePdf } from "./editorPdfWriter";
import { computeNativePdfPageGeometry } from "./pdf/nativePageGeometry";
import { editorPoint, editorTransformBounds, invertEditorMatrix, multiplyEditorMatrices } from "./editorScene";
import { ScenePageViews, PAGE_PRIMITIVE_KINDS } from "./scenePageViews";
import { getSceneAnnotationRuns, getScenePrimitive } from "./scenePrimitives";
import { compactEditorScene, bakeEditorSourceScene, transformWholeEditorScene, getEditorAnnotationSource, getEditorAnnotationFrameTransform } from "./editorScene";
import type { PrimitiveKind } from "./scenePrimitives";
import { decodePdfDocEncoding } from "./pdf/nativePdfDocEncoding";
import { computeNativePdfAnnotationPlacement } from "./pdf/nativeFormGeometry";
import { createNativeOptionalContentRegistry, nativeOptionalContentSceneIdentities } from "./pdf/nativeOptionalContent";
import { createLoadProgressReporter, type LoadProgressCallback, type PDFLoadProgress } from "./loadProgress";
import { validatePdfOutputProtection } from "./pdf/pdfProtection";
import { scanDensePdfResourceReferences } from "./pdf/nativeContentCompiler";
import { prepareNativeInlineImages } from "./pdf/nativeInlineImage";
import { normalizePrimitiveColor } from "./colorInput";
import { fitEditorInkPaths, flattenEditorInkPaths } from "./editorInkGeometry";
import { findEditorPdfFormOverlaps } from "./editorPdfFormOverlap";
import { prepareEditorNativePdfLayers } from "./editorNativeLayers";
import { applyEditorSceneLayers, assignEditorGeometryLayer, reorderEditorSceneLayers, editorLayerPaintRank } from "./editorLayerScene";
import { isScenePaintRunVisible, scenePaintOrderedRuns } from "./scenePaintQuery";
import { defaultVectorDrawRuns } from "./vectorDrawOrder";
import { getEditorCapturedSourceScene } from "./editorClipboard";

export const EDITOR_PDF_LAYER_STACKING_DIAGNOSTIC_CODE = "editor.pdf-layer-stacking";

/** Rebuilt vector appearances retain their authoring fonts without replaying old paint. */
async function retainEditorTextAppearanceFonts(writer: NativePdfWriter, appearances: PdfValue | undefined,
  form: PdfDictionary, signal?: AbortSignal): Promise<void> {
  const resolve = async (value: PdfValue | undefined): Promise<PdfValue | undefined> => isPdfRef(value)
    ? writer.get(value) ?? await writer.document.resolveValue(value, signal) : value;
  const fonts: PdfValue[] = [], visited = new Set<PdfValue>(), retained = new Set<PdfValue | string>();
  const portable = async (raw: PdfValue, seen = new Set<PdfValue>()): Promise<boolean> => {
    if (seen.has(raw)) return false; seen.add(raw);
    const font = await resolve(raw); if (!isPdfDictionary(font)) return false;
    const descriptor = await resolve(font.get("FontDescriptor"));
    if (isPdfDictionary(descriptor) && (descriptor.has("FontFile2") || descriptor.has("FontFile3"))) return true;
    const descendants = await resolve(font.get("DescendantFonts"));
    if (Array.isArray(descendants)) for (const child of descendants) if (await portable(child, seen)) return true;
    return false;
  };
  const visit = async (raw: PdfValue | undefined): Promise<void> => {
    signal?.throwIfAborted(); if (raw === undefined || visited.has(raw)) return; visited.add(raw);
    const value = await resolve(raw);
    if (isPdfStream(value)) {
      const resources = await resolve(value.dictionary.get("Resources")); if (!isPdfDictionary(resources)) return;
      const entries = await resolve(resources.get("Font"));
      if (isPdfDictionary(entries)) for (const font of entries.values()) {
        const key = isPdfRef(font) ? `${font.objectNumber}:${font.generation}` : font;
        if (!retained.has(key) && await portable(font)) { retained.add(key); fonts.push(font); }
      }
      const objects = await resolve(resources.get("XObject")); if (isPdfDictionary(objects)) for (const child of objects.values()) await visit(child);
    } else if (isPdfDictionary(value)) for (const child of value.values()) await visit(child);
  };
  await visit(appearances); if (!fonts.length) return;
  const rawResources = await resolve(form.get("Resources")), resources = new Map(isPdfDictionary(rawResources) ? rawResources : []);
  const rawFonts = await resolve(resources.get("Font")), entries = new Map(isPdfDictionary(rawFonts) ? rawFonts : []);
  for (const font of fonts) { let name = `HEPRSourceFont${entries.size}`; while (entries.has(name)) name += "_"; entries.set(name, font); }
  resources.set("Font", entries); form.set("Resources", resources);
}

/** Import reachable resources with copy-on-write identities, including cycles. */
export async function importEditorPdfValue(value: PdfValue, source: NativePdfDocument, writer: NativePdfWriter,
  signal?: AbortSignal, refs = new Map<string, PdfRef>()): Promise<PdfValue> {
  signal?.throwIfAborted();
  if (isPdfRef(value)) {
    const key = `${value.objectNumber}:${value.generation}`; const known = refs.get(key); if (known) return known;
    const resolved = await source.resolveObject(value, signal);
    if (isPdfStream(resolved) && (resolved.dictionary.has("Length1") ||
      (resolved.dictionary.get("Subtype") as { value?: string } | undefined)?.value === "OpenType")) {
      const serialized = serializePdfValue(resolved);
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", serialized.slice().buffer));
      const hash = [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
      const target = writer.intern(`font:${hash}`, resolved); refs.set(key, target); return target;
    }
    const target = writer.add(null); refs.set(key, target);
    writer.set(target, await importEditorPdfValue(resolved, source, writer, signal, refs)); return target;
  }
  if (Array.isArray(value)) return await Promise.all(value.map(item => importEditorPdfValue(item, source, writer, signal, refs)));
  if (isPdfStream(value)) return { ...value, dictionary: await importEditorPdfValue(value.dictionary, source, writer, signal, refs) as PdfDictionary };
  if (isPdfDictionary(value)) {
    const result: PdfDictionary = new Map(); for (const [key, item] of value) result.set(key, await importEditorPdfValue(item, source, writer, signal, refs)); return result;
  }
  return value;
}

export async function importEditorPdfPage(bytes: Uint8Array, writer: NativePdfWriter, signal?: AbortSignal): Promise<{
  form: PdfDictionary; content: Uint8Array;
}> {
  const source = await NativePdfDocument.open({ kind: "bytes", bytes }, { signal });
  try {
    const page = source.getPage(0); const chunks = await source.getDecodedPageContents(0, signal);
    const content = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length + 1, 0));
    let offset = 0; for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.length; content[offset++] = 10; }
    const refs = new Map<string, PdfRef>();
    const properties = await source.resolveValue(source.catalog.get("OCProperties"), signal);
    const reused = isPdfDictionary(properties) ? await reuseImportedEditorPdfLayers(source, properties, writer, refs, signal) : new Set<string>();
    const resources = page.resources ? await importEditorPdfValue(await source.resolveValue(page.resources, signal) ?? new Map(), source, writer, signal, refs) : new Map();
    if (isPdfDictionary(properties)) {
      const registry = await createNativeOptionalContentRegistry(source, { signal });
      const visible = new Set(registry.listGroups().filter(group => group.defaultVisible).map(group => group.identity));
      const imported = await importEditorPdfValue(properties, source, writer, signal, refs);
      if (isPdfDictionary(imported)) {
        const sourceGroups = await source.resolveValue(properties.get("OCGs"), signal);
        const on: PdfRef[] = [], off: PdfRef[] = [];
        for (const group of Array.isArray(sourceGroups) ? sourceGroups : []) if (isPdfRef(group)) {
          const importedRef = refs.get(`${group.objectNumber}:${group.generation}`);
          if (importedRef) (visible.has(`ref:${group.objectNumber}:${group.generation}`) ? on : off).push(importedRef);
        }
        await mergeImportedEditorPdfLayers(writer, imported, on, off, reused, signal);
      }
    }
    return { form: new Map<string, PdfValue>([["Type", pdfNameValue("XObject")], ["Subtype", pdfNameValue("Form")], ["FormType", 1],
      ["BBox", [...page.mediaBox]], ["Resources", resources]]), content };
  } finally { await source.close(); }
}

async function reuseImportedEditorPdfLayers(source: NativePdfDocument, properties: PdfDictionary, writer: NativePdfWriter,
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
async function mergeImportedEditorPdfLayers(writer: NativePdfWriter, imported: PdfDictionary,
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

function fieldPdfValue(value: EditorFieldValue, type?: string, onValue = "Yes"): PdfValue {
  if (type === "Btn") return pdfNameValue(value === true ? onValue : value === false || value === null ? "Off" : String(value));
  if (Array.isArray(value)) return value.map(item => pdfTextValue(item));
  return value === null ? pdfTextValue("") : pdfTextValue(String(value));
}

interface FieldDecoration { reference: PdfRef; form: Pick<NativePdfForm, "bbox" | "matrix"> }
const FIELD_IDENTITY = [1, 0, 0, 1, 0, 0] as const;

interface EditorPdfFieldFrame { rect: PdfBox; transform: EditorMatrix }

/** Recover the native field plane from the ordinary appearance wrappers written by editor transforms. */
export async function readEditorFieldFrame(document: NativePdfDocument, annotation: NativePdfAnnotationAppearance,
  signal?: AbortSignal): Promise<EditorPdfFieldFrame | null> {
  try {
    const ap = await document.resolveValue(annotation.dictionary.get("AP"), signal);
    let value = isPdfDictionary(ap) ? await document.resolveValue(ap.get("N"), signal) : undefined;
    if (isPdfDictionary(value)) value = await document.resolveValue(value.get(annotation.appearanceState ?? "Off") ?? value.values().next().value, signal);
    let transform: EditorMatrix | undefined, frame: EditorPdfFieldFrame | null = null;
    const visited = new Set<PdfValue>();
    while (isPdfStream(value) && !visited.has(value)) {
      visited.add(value);
      if (!isPdfName(value.dictionary.get("Subtype"), "Form")) break;
      const bbox = await document.resolveValue(value.dictionary.get("BBox"), signal);
      const matrix = await document.resolveValue(value.dictionary.get("Matrix"), signal);
      if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(item => typeof item === "number" && Number.isFinite(item)) ||
          !Array.isArray(matrix) || matrix.length !== 6 || !matrix.every(item => typeof item === "number" && Number.isFinite(item))) break;
      const rect = bbox as [number, number, number, number], local = matrix as [number, number, number, number, number, number];
      if (!(rect[2] > rect[0]) || !(rect[3] > rect[1]) || local[0] * local[3] - local[1] * local[2] === 0) break;
      const resources = await document.resolveValue(value.dictionary.get("Resources"), signal);
      const objects = isPdfDictionary(resources) ? await document.resolveValue(resources.get("XObject"), signal) : undefined;
      const original = isPdfDictionary(objects) ? await document.resolveValue(objects.get("Original"), signal) : undefined;
      if (!isPdfStream(original) || !isPdfName(original.dictionary.get("Subtype"), "Form")) break;
      const operators: { operator: string; operands: readonly unknown[] }[] = [];
      scanDensePdfResourceReferences(await document.decodeStream(value, signal), { signal,
        onOperator: (operator, operands) => operators.push({ operator, operands: [...operands] }) });
      if (operators.length !== 4 || operators[0].operator !== "q" || operators[0].operands.length ||
          operators[1].operator !== "cm" || operators[1].operands.length !== 6 ||
          !operators[1].operands.every(item => typeof item === "number" && Number.isFinite(item)) ||
          operators[2].operator !== "Do" || operators[2].operands.length !== 1 || operators[2].operands[0] !== "Original" ||
          operators[3].operator !== "Q" || operators[3].operands.length) break;
      const placement = transform ?? computeNativePdfAnnotationPlacement(annotation, { bbox: rect, matrix: local }, [...FIELD_IDENTITY]).invocationMatrix;
      const current = multiplyEditorMatrices(placement, local);
      frame = { rect: [...rect], transform: current };
      transform = multiplyEditorMatrices(current, operators[1].operands as readonly number[]);
      value = original;
    }
    return frame;
  } catch (error) {
    signal?.throwIfAborted();
    return null;
  }
}

function wrapEditorFieldAppearance(writer: NativePdfWriter, annotation: NativePdfAnnotationAppearance,
  frame: EditorPdfFieldFrame, reference: PdfRef, form: Pick<NativePdfForm, "bbox" | "matrix">): PdfRef {
  const placement = computeNativePdfAnnotationPlacement({ ...annotation, rectangle: frame.rect }, form, [...FIELD_IDENTITY]).invocationMatrix;
  return writer.add(pdfStreamValue(`q ${placement.map(pdfNumberValue).join(" ")} cm /Original Do Q`, new Map<string, PdfValue>([
    ["Type", pdfNameValue("XObject")], ["Subtype", pdfNameValue("Form")], ["BBox", [...frame.rect]],
    ["Matrix", [...frame.transform]], ["Resources", new Map([["XObject", new Map([["Original", reference]])]])]
  ])));
}

/** Keep bespoke non-text paints that /MK cannot describe, using the exact PDF lexer. */
async function preserveTextFieldDecoration(writer: NativePdfWriter, registry: NativePdfFormAppearanceRegistry,
  annotation: NativePdfAnnotationAppearance, options: { signal?: AbortSignal; onWarning?: (message: string) => void;
    fieldFrame?: EditorPdfFieldFrame | null }): Promise<FieldDecoration | undefined> {
  const appearance = await registry.resolveAnnotationAppearance(annotation, options.signal, true);
  if (!appearance) return undefined;
  const form = appearance.normalAppearance.form, content = await registry.decodeFormContent(form, options.signal);
  const encoder = new TextEncoder(), active = new Set<PdfValue>();
  const operand = (value: unknown): PdfValue => {
    if (value === null || typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "string") return pdfNameValue(value);
    if (value instanceof Uint8Array) return { kind: "string", hex: true, bytes: value };
    if (Array.isArray(value)) return value.map(operand);
    if (value instanceof Map) return new Map([...value].map(([key, item]) => [String(key), operand(item)]));
    throw new TypeError("Unsupported operand in the original field appearance.");
  };
  const strip = async (content: Uint8Array, resources: PdfDictionary): Promise<{
    bytes: Uint8Array; resources: PdfDictionary; paints: boolean; shows: number;
  }> => {
    const prepared = prepareNativeInlineImages(content, { signal: options.signal }), chunks: Uint8Array[] = [];
    let paints = false, shows = 0;
    const usedForms = new Set<string>();
    for (const segment of prepared.segments) {
      if (segment.kind === "image") {
        paints = true; chunks.push(content.subarray(segment.sourceOffset, segment.sourceOffset + segment.sourceLength), encoder.encode("\n")); continue;
      }
      scanDensePdfResourceReferences(segment.bytes, { signal: options.signal, onOperator(operator, operands) {
        if (["Tj", "TJ", "'", '"'].includes(operator)) { shows++; return; }
        if (["S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "sh"].includes(operator)) paints = true;
        if (operator === "Do" && typeof operands[0] === "string") usedForms.add(operands[0]);
        for (let index = 0; index < operands.length; index++) {
          let value = operands[index];
          if (operator === "BDC" && index === 1 && value instanceof Map && value.has("ActualText")) {
            value = new Map(value); (value as Map<unknown, unknown>).delete("ActualText");
          }
          chunks.push(serializePdfValue(operand(value)), encoder.encode(" "));
        }
        chunks.push(encoder.encode(`${operator}\n`));
      } });
    }
    let nextResources = resources;
    const xObjects = await writer.document.resolveValue(resources.get("XObject"), options.signal);
    for (const name of usedForms) {
      if (!isPdfDictionary(xObjects)) throw new Error(`The original field appearance references missing XObject ${name}.`);
      const raw = xObjects.get(name);
      const child = await writer.document.resolveValue(raw, options.signal);
      if (!isPdfStream(child)) throw new Error(`The original field appearance references invalid XObject ${name}.`);
      const subtype = child.dictionary.get("Subtype");
      if (!subtype || typeof subtype !== "object" || !("value" in subtype) || subtype.value !== "Form") { paints = true; continue; }
      if (active.has(child)) throw new Error("The original field appearance contains a recursive Form.");
      active.add(child);
      const declared = await writer.document.resolveValue(child.dictionary.get("Resources"), options.signal);
      const nested = await strip(await writer.document.decodeStream(child, options.signal), isPdfDictionary(declared) ? declared : resources);
      active.delete(child); paints ||= nested.paints; shows += nested.shows;
      if (!nested.shows && nested.resources === declared) continue;
      const dictionary = new Map(child.dictionary);
      for (const key of ["Length", "Filter", "DecodeParms"]) dictionary.delete(key);
      dictionary.set("Resources", nested.resources);
      const replacement = writer.add(pdfStreamValue(nested.bytes, dictionary));
      if (nextResources === resources) nextResources = new Map(resources);
      const pending = nextResources.get("XObject"), entries = nextResources === resources || !isPdfDictionary(pending) ? new Map(xObjects) : new Map(pending);
      entries.set(name, replacement); nextResources.set("XObject", entries);
    }
    const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { bytes, resources: nextResources, paints, shows };
  };
  const stripped = await strip(content, form.resources);
  if (!stripped.paints) return undefined;
  const rawAP = await writer.document.resolveValue(annotation.dictionary.get("AP"), options.signal);
  let rawNormal = isPdfDictionary(rawAP) ? await writer.document.resolveValue(rawAP.get("N"), options.signal) : undefined;
  if (isPdfDictionary(rawNormal) && appearance.stateName) rawNormal = await writer.document.resolveValue(rawNormal.get(appearance.stateName), options.signal);
  const dictionary = isPdfStream(rawNormal) ? new Map(rawNormal.dictionary) : new Map<string, PdfValue>();
  for (const key of ["Length", "Filter", "DecodeParms"]) dictionary.delete(key);
  dictionary.set("Type", pdfNameValue("XObject")); dictionary.set("Subtype", pdfNameValue("Form"));
  dictionary.set("BBox", [...form.bbox]); dictionary.set("Matrix", [...form.matrix]); dictionary.set("Resources", stripped.resources);
  if (stripped.shows > 1 && !(annotation.widget!.fieldFlags & (1 << 12))) options.onWarning?.(
    `Field ${annotation.widget!.fullyQualifiedName}: text in its stored appearance was regenerated; its non-text decoration was preserved.`);
  const reference = writer.add(pdfStreamValue(stripped.bytes, dictionary));
  if (options.fieldFrame) {
    const frame = options.fieldFrame;
    const placement = computeNativePdfAnnotationPlacement(annotation, form, [...FIELD_IDENTITY]).invocationMatrix;
    const local = multiplyEditorMatrices(invertEditorMatrix(frame.transform), placement);
    const normalized = writer.add(pdfStreamValue(`q ${local.map(pdfNumberValue).join(" ")} cm /Original Do Q`, new Map<string, PdfValue>([
      ["Type", pdfNameValue("XObject")], ["Subtype", pdfNameValue("Form")], ["BBox", [...frame.rect]],
      ["Resources", new Map([["XObject", new Map([["Original", reference]])]])]
    ])));
    return { reference: normalized, form: { bbox: frame.rect, matrix: FIELD_IDENTITY } };
  }
  return { reference, form };
}

function decorateFieldAppearance(writer: NativePdfWriter, annotation: NativePdfAnnotationAppearance, decoration: FieldDecoration,
  text: PdfRef, textForm: Pick<NativePdfForm, "bbox" | "matrix">): PdfRef {
  const width = annotation.rectangle[2] - annotation.rectangle[0], height = annotation.rectangle[3] - annotation.rectangle[1];
  const local = { ...annotation, rectangle: [0, 0, width, height] as const };
  const backgroundMatrix = computeNativePdfAnnotationPlacement(local, decoration.form, [...FIELD_IDENTITY]).invocationMatrix;
  const textMatrix = computeNativePdfAnnotationPlacement(local, textForm, [...FIELD_IDENTITY]).invocationMatrix;
  const content = `q ${backgroundMatrix.map(pdfNumberValue).join(" ")} cm /Background Do Q\nq ${textMatrix.map(pdfNumberValue).join(" ")} cm /Value Do Q\n`;
  return writer.add(pdfStreamValue(content, new Map<string, PdfValue>([
    ["Type", pdfNameValue("XObject")], ["Subtype", pdfNameValue("Form")], ["BBox", [0, 0, width, height]],
    ["Resources", new Map([["XObject", new Map([["Background", decoration.reference], ["Value", text]])]])]
  ])));
}

/** Apply values and explicit appearances without touching unrelated PDF objects. */
export async function applyEditorPdfFields(writer: NativePdfWriter, values: ReadonlyMap<string, EditorFieldValue>,
  fonts: EditorFontRegistry, options: { signal?: AbortSignal; onWarning?: (message: string) => void; onProgress?: LoadProgressCallback } = {}): Promise<void> {
  const progress = createLoadProgressReporter(options.onProgress);
  progress.report(0, { stage: "compile", sourceType: "pdf", unit: "sections", processed: 0, total: values.size });
  if (!values.size) { progress.complete({ sourceType: "pdf", unit: "sections", processed: 0, total: 0 }); return; }
  const document = writer.document, optionalContent = await createNativeOptionalContentRegistry(document, { signal: options.signal });
  const registry = new NativePdfFormAppearanceRegistry(document, { optionalContent });
  const synthesizer = new NativePdfAppearanceSynthesizer(document, { missingFontResolver: createBundledStandardFontResolver(), optionalContent });
  const changedOwners = new Map<PdfDictionary, { dictionary: PdfDictionary; ref: PdfRef | null }>();
  const directReplacements = new Map<PdfDictionary, PdfDictionary>();
  const found = new Set<string>();
  const annotations = [];
  for (const page of document.pages) annotations.push(...await registry.listPageAnnotations(page.sourcePageIndex, options.signal));
  const buttonStates = new Map<typeof annotations[number], { normal: PdfDictionary | undefined; onValue: string }>();
  const buttonGroups = new Map<string, typeof annotations>();
  const targets = annotations.filter(annotation => annotation.widget?.fullyQualifiedName && values.has(annotation.widget.fullyQualifiedName));
  let processed = 0;
  for (const annotation of annotations) {
    const field = annotation.widget, name = field?.fullyQualifiedName;
    if (field?.fieldType !== "Btn" || !name || !values.has(name) || field.fieldFlags & (1 << 16)) continue;
    const raw = await document.resolveValue(annotation.dictionary.get("AP"), options.signal);
    const normal = isPdfDictionary(raw) ? await document.resolveValue(raw.get("N"), options.signal) : undefined;
    const state = annotation.appearanceState && annotation.appearanceState !== "Off" ? annotation.appearanceState : undefined;
    const onValue = (isPdfDictionary(normal) ? [...normal.keys()].find(key => key !== "Off") : undefined) ?? state ??
      (field.fieldFlags & (1 << 15) ? `Choice${annotation.pageIndex + 1}_${annotation.annotationIndex + 1}` : "Yes");
    buttonStates.set(annotation, { normal: isPdfDictionary(normal) ? normal : undefined, onValue });
    const group = buttonGroups.get(name) ?? []; group.push(annotation); buttonGroups.set(name, group);
  }
  const buttonValues = new Map<string, string>();
  for (const [name, group] of buttonGroups) {
    const value = values.get(name), first = buttonStates.get(group[0])!;
    const selected = value === true ? first.onValue : value === false || value === null ? "Off" : String(value);
    if (selected !== "Off" && !group.some(annotation => {
      const state = buttonStates.get(annotation)!; return state.onValue === selected || state.normal?.has(selected);
    })) throw new RangeError(`Field ${name} does not contain that button choice.`);
    buttonValues.set(name, selected);
  }
  for (const annotation of annotations) {
    options.signal?.throwIfAborted(); const field = annotation.widget; const name = field?.fullyQualifiedName;
    if (!field || !name || !values.has(name)) continue;
    progress.report(processed / Math.max(1, targets.length), { stage: field.fieldType === "Tx" ? "pdf-text" : "compile",
      sourceType: "pdf", unit: "sections", processed, total: targets.length, sourcePageIndex: annotation.pageIndex, sourcePageCount: document.pages.length });
    found.add(name);
    if (field.fieldFlags & 1) throw new Error(`Field ${name} is read-only.`);
    if (!["Tx", "Ch", "Btn"].includes(field.fieldType ?? "") || (field.fieldType === "Btn" && (field.fieldFlags & (1 << 16)))) {
      throw new Error(`Field ${name} is not a fillable text, choice, checkbox or radio field.`);
    }
    const value = values.get(name)!;
    if (field.fieldType === "Tx" && field.maxLength !== undefined && String(value ?? "").length > field.maxLength) throw new RangeError(`Field ${name} allows at most ${field.maxLength} characters.`);
    if (field.fieldType === "Ch" && !(field.fieldFlags & (1 << 18)) && field.choiceOptions) {
      const valid = field.choiceOptions.map(option => documentText(option.exportValue.bytes));
      if ((Array.isArray(value) ? value : [String(value ?? "")]).some(item => !valid.includes(item))) throw new RangeError(`Field ${name} does not contain that choice.`);
    }
    let owner = annotation.dictionary, ownerRef = annotation.ref;
    const parent = owner.get("Parent");
    if (parent) { const resolved = await document.resolveValue(parent, options.signal); if (isPdfDictionary(resolved)) { owner = resolved; ownerRef = isPdfRef(parent) ? parent : null; } }
    let changed = changedOwners.get(owner);
    if (!changed) {
      changed = { dictionary: new Map(owner), ref: ownerRef }; changedOwners.set(owner, changed);
      if (!ownerRef) directReplacements.set(owner, changed.dictionary);
    }
    const widget: PdfDictionary = owner === annotation.dictionary ? changed.dictionary : new Map(annotation.dictionary);
    const rawAP = await document.resolveValue(widget.get("AP"), options.signal);
    const fieldFrame = await readEditorFieldFrame(document, annotation, options.signal);
    const logicalAnnotation = fieldFrame ? { ...annotation, rectangle: fieldFrame.rect } : annotation;
    const storeAppearance = (reference: PdfRef, form: Pick<NativePdfForm, "bbox" | "matrix">): PdfRef => fieldFrame
      ? wrapEditorFieldAppearance(writer, annotation, fieldFrame, reference, form) : reference;
    const button = buttonStates.get(annotation);
    const onValue = button?.onValue ?? "Yes";
    const pdfValue = field.fieldType === "Btn" ? pdfNameValue(buttonValues.get(name)!) : fieldPdfValue(value, field.fieldType, onValue);
    changed.dictionary.set("V", pdfValue);
    const selectedChoices = field.fieldType === "Ch" && field.choiceOptions ? (() => {
      const selected = Array.isArray(value) ? value : [String(value ?? "")];
      return field.choiceOptions!.flatMap((option, index) => selected.includes(documentText(option.exportValue.bytes)) ? [index] : []);
    })() : undefined;
    if (selectedChoices) changed.dictionary.set("I", selectedChoices);
    if (field.fieldType === "Btn") {
      const selected = buttonValues.get(name)!, states = new Map(button?.normal);
      for (const state of ["Off", onValue]) if (!states.has(state)) {
        const dictionary = new Map(widget); dictionary.delete("AP"); dictionary.set("AS", pdfNameValue(state));
        const generated = await synthesizer.synthesize({ ...logicalAnnotation, dictionary, appearanceState: state,
          hasAppearanceDictionary: false, visibleInDefaultView: true, optionalContent: undefined,
          widget: { ...field, value: pdfNameValue(state) } }, options.signal);
        if (!generated) throw new Error(`Field ${name} has no button appearance.`);
        const form = generated.normalAppearance.form;
        states.set(state, storeAppearance(writer.add(pdfStreamValue(generated.decodedContent, new Map<string, PdfValue>([
          ["Type", pdfNameValue("XObject")], ["Subtype", pdfNameValue("Form")], ["BBox", [...form.bbox]],
          ["Matrix", [...form.matrix]], ["Resources", form.resources]
        ]))), form));
      }
      const appearance = isPdfDictionary(rawAP) ? new Map(rawAP) : new Map<string, PdfValue>();
      appearance.set("N", states); widget.set("AP", appearance);
      widget.set("AS", pdfNameValue(selected !== "Off" && (selected === onValue || button?.normal?.has(selected)) ? selected : "Off"));
    } else {
      if (fieldFrame) {
        const bounds = editorTransformBounds({ minX: fieldFrame.rect[0], minY: fieldFrame.rect[1],
          maxX: fieldFrame.rect[2], maxY: fieldFrame.rect[3] }, fieldFrame.transform);
        // Nested transform wrappers can have an enlarged envelope from repeated
        // AABB transforms. The regenerated wrapper uses the original field plane.
        widget.set("Rect", [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]);
      }
      let decoration: FieldDecoration | undefined;
      if (field.fieldType === "Tx" && !widget.has("MK") && annotation.hasAppearanceDictionary) {
        try { decoration = await preserveTextFieldDecoration(writer, registry, annotation, { ...options, fieldFrame }); }
        catch (error) {
          options.signal?.throwIfAborted();
          options.onWarning?.(`Field ${name}: its stored decoration could not be retained and its appearance was regenerated: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      widget.delete("AP");
      try {
        const synthesisDictionary = decoration ? new Map(widget) : widget;
        if (decoration) {
          synthesisDictionary.set("BS", new Map([["W", 0]])); synthesisDictionary.set("Border", [0, 0, 0]);
        }
        const generated = await synthesizer.synthesize({ ...logicalAnnotation, dictionary: synthesisDictionary, hasAppearanceDictionary: false,
          widget: { ...field, value: pdfValue, ...(selectedChoices ? { selectedChoiceIndices: selectedChoices } : {}) } }, options.signal);
        if (!generated) throw new Error("Field has no visible appearance.");
        const form = generated.normalAppearance.form;
        const appearance = writer.add(pdfStreamValue(generated.decodedContent, new Map<string, PdfValue>([
          ["Type", pdfNameValue("XObject")], ["Subtype", pdfNameValue("Form")], ["BBox", [...form.bbox]],
          ["Matrix", [...form.matrix]], ["Resources", form.resources]
        ])));
        const width = logicalAnnotation.rectangle[2] - logicalAnnotation.rectangle[0], height = logicalAnnotation.rectangle[3] - logicalAnnotation.rectangle[1];
        widget.set("AP", new Map([["N", storeAppearance(decoration
          ? decorateFieldAppearance(writer, logicalAnnotation, decoration, appearance, form) : appearance,
        decoration ? { bbox: [0, 0, width, height], matrix: FIELD_IDENTITY } : form)]]));
      } catch (error) {
        options.signal?.throwIfAborted();
        const [x0, y0, x1, y1] = logicalAnnotation.rectangle; const width = Math.abs(x1 - x0), height = Math.abs(y1 - y0);
        const selected = Array.isArray(value) ? value.join("\n") : String(value ?? "");
        const text: EditorTextObject = { id: name, kind: "text", pageIndex: 0, transform: [1, 0, 0, 1, 0, 0],
          x: 2, y: 2, width: Math.max(1, width - 4), height: Math.max(1, height - 4), text: selected,
          fontSize: Math.min(12, Math.max(1, height * .6)), align: field.quadding === 1 ? "center" : field.quadding === 2 ? "right" : "left" };
        const imported = await importEditorPdfPage(await editorTextPdf(text, fonts, options.signal), writer, options.signal);
        imported.form.set("BBox", [0, 0, width, height]);
        const appearance = writer.add(pdfStreamValue(imported.content, imported.form));
        const form = { bbox: [0, 0, width, height] as const, matrix: FIELD_IDENTITY };
        widget.set("AP", new Map([["N", storeAppearance(decoration
          ? decorateFieldAppearance(writer, logicalAnnotation, decoration, appearance, form) : appearance, form)]]));
        options.onWarning?.(`Field ${name} uses a regenerated portable font appearance: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (annotation.ref) writer.set(annotation.ref, widget);
    else directReplacements.set(annotation.dictionary, widget);
    processed++;
    progress.report(processed / Math.max(1, targets.length), { stage: "compile", sourceType: "pdf", unit: "sections",
      processed, total: targets.length, sourcePageIndex: annotation.pageIndex, sourcePageCount: document.pages.length });
  }
  for (const name of values.keys()) if (!found.has(name)) throw new RangeError(`Unknown form field ${name}.`);
  for (const changed of changedOwners.values()) if (changed.ref) writer.set(changed.ref, changed.dictionary);
  // Direct widgets and direct field parents belong to their containing array
  // or dictionary. Rebuild those owners instead of mutating parser Maps, and
  // retain indirect identities shared by /Fields, /Kids and page /Annots.
  const visited = new Set<string>();
  const replaceFields = async (value: PdfValue): Promise<PdfValue> => {
    options.signal?.throwIfAborted();
    if (isPdfRef(value)) {
      const key = `${value.objectNumber}:${value.generation}`;
      if (visited.has(key)) return value;
      visited.add(key);
      const original = writer.get(value) ?? await document.resolveObject(value, options.signal);
      const replaced = await replaceFields(original);
      if (replaced !== original) writer.set(value, replaced);
      return value;
    }
    if (Array.isArray(value)) {
      const replaced: PdfValue[] = [];
      for (const item of value) replaced.push(await replaceFields(item));
      return replaced.some((item, index) => item !== value[index]) ? replaced : value;
    }
    if (!isPdfDictionary(value)) return value;
    let result = directReplacements.get(value) ?? value;
    for (const key of ["Fields", "Kids", "Parent"]) {
      const child = result.get(key);
      if (child === undefined) continue;
      const replaced = await replaceFields(child);
      if (replaced !== child) {
        if (result === value) result = new Map(value);
        result.set(key, replaced);
      }
    }
    return result;
  };
  if (directReplacements.size) for (const page of document.pages) {
    const pending = page.ref ? writer.get(page.ref) : undefined;
    const original = isPdfDictionary(pending) ? pending : page.dictionary;
    const annotations = original.get("Annots"); if (annotations === undefined) continue;
    const replaced = await replaceFields(annotations);
    if (replaced !== annotations) {
      if (!page.ref) throw new Error("A direct PDF page requires a full scene export to save its form fields.");
      const changed = new Map(original); changed.set("Annots", replaced); writer.set(page.ref, changed);
    }
  }
  const acro = document.catalog.get("AcroForm");
  if (acro !== undefined) {
    const resolved = isPdfRef(acro) ? writer.get(acro) ?? await document.resolveObject(acro, options.signal) : acro;
    const replaced = await replaceFields(resolved);
    if (isPdfDictionary(replaced)) {
      const dictionary = new Map(replaced); dictionary.set("NeedAppearances", false);
      if (isPdfRef(acro)) writer.set(acro, dictionary);
      else {
        const root = document.getWriterState().xref.trailers.map(trailer => trailer.get("Root")).find(isPdfRef);
        if (!root) throw new Error("The PDF catalog requires a full scene export to save its form fields.");
        const pending = writer.get(root), catalog = new Map(isPdfDictionary(pending) ? pending : document.catalog);
        catalog.set("AcroForm", dictionary); writer.set(root, catalog);
      }
    }
  }
  progress.complete({ sourceType: "pdf", unit: "sections", processed: targets.length, total: targets.length });
}

/** Remove a deleted widget from its field tree without removing shared siblings. */
export async function removeEditorPdfWidget(writer: NativePdfWriter, reference: PdfRef, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const document = writer.document, key = (ref: PdfRef) => `${ref.objectNumber}:${ref.generation}`;
  const resolve = async (value: PdfValue): Promise<PdfValue> => isPdfRef(value)
    ? writer.get(value) ?? await document.resolveObject(value, signal) : value;
  const target = await resolve(reference);
  if (!isPdfDictionary(target)) return;
  const targetState = target.get("AS"), removed = new Set([key(reference)]), active = new Set<string>();
  interface Result { value: PdfValue; removed?: boolean }
  const prune = async (value: PdfValue, inheritedType?: string): Promise<Result> => {
    signal?.throwIfAborted();
    if (isPdfRef(value)) {
      const identity = key(value);
      if (identity === key(reference)) return { value, removed: true };
      if (active.has(identity)) return { value };
      active.add(identity);
      const original = await resolve(value), result = await prune(original, inheritedType);
      active.delete(identity);
      if (result.removed) { removed.add(identity); return { value, removed: true }; }
      if (result.value !== original) writer.set(value, result.value);
      return { value };
    }
    if (!isPdfDictionary(value)) return { value };
    const raw = value.get("Kids"); if (raw === undefined) return { value };
    const kids = await resolve(raw); if (!Array.isArray(kids)) return { value };
    const fieldType = value.get("FT"), type = fieldType && typeof fieldType === "object" && "value" in fieldType ? String(fieldType.value) : inheritedType;
    const next: PdfValue[] = []; let changed = false;
    for (const child of kids) {
      const result = await prune(child, type);
      if (result.removed) changed = true;
      else { next.push(result.value); changed ||= result.value !== child; }
    }
    if (!changed) return { value };
    if (!next.length) return { value, removed: true };
    const dictionary = new Map(value), selected = dictionary.get("V");
    if (type === "Btn" && targetState && typeof targetState === "object" && "value" in targetState && targetState.value !== "Off" &&
      selected && typeof selected === "object" && "value" in selected && selected.value === targetState.value) {
      let selectedSurvives = false;
      for (const child of next) {
        const widget = await resolve(child), state = isPdfDictionary(widget) ? widget.get("AS") : undefined;
        if (state && typeof state === "object" && "value" in state && state.value === targetState.value) selectedSurvives = true;
      }
      if (!selectedSurvives) {
        dictionary.set("V", pdfNameValue("Off"));
        for (let index = 0; index < next.length; index++) {
          const child = next[index], widget = await resolve(child);
          if (!isPdfDictionary(widget) || !widget.has("AS")) continue;
          const changed = new Map(widget); changed.set("AS", pdfNameValue("Off"));
          if (isPdfRef(child)) writer.set(child, changed); else next[index] = changed;
        }
      }
    }
    if (isPdfRef(raw)) writer.set(raw, next); else dictionary.set("Kids", next);
    return { value: dictionary };
  };
  const rootReference = document.getWriterState().xref.trailers.map(trailer => trailer.get("Root")).find(isPdfRef);
  const pendingCatalog = rootReference ? writer.get(rootReference) : undefined;
  const currentCatalog = isPdfDictionary(pendingCatalog) ? pendingCatalog : document.catalog;
  const rawAcro = currentCatalog.get("AcroForm"); if (rawAcro === undefined) return;
  const acro = await resolve(rawAcro); if (!isPdfDictionary(acro)) return;
  const rawFields = acro.get("Fields"); if (rawFields === undefined) return;
  const fields = await resolve(rawFields); if (!Array.isArray(fields)) return;
  const next: PdfValue[] = []; let changed = false;
  for (const field of fields) {
    const result = await prune(field);
    if (result.removed) changed = true; else { next.push(result.value); changed ||= result.value !== field; }
  }
  const dictionary = new Map(acro);
  if (changed) {
    if (isPdfRef(rawFields)) writer.set(rawFields, next); else dictionary.set("Fields", next);
  }
  const rawOrder = acro.get("CO");
  if (rawOrder !== undefined) {
    const order = await resolve(rawOrder);
    if (Array.isArray(order)) {
      const nextOrder = order.filter(item => !isPdfRef(item) || !removed.has(key(item)));
      if (nextOrder.length !== order.length) {
        changed = true;
        if (isPdfRef(rawOrder)) writer.set(rawOrder, nextOrder); else dictionary.set("CO", nextOrder);
      }
    }
  }
  // A referenced parent can change while its /Fields reference stays intact.
  if (!changed) return;
  if (isPdfRef(rawAcro)) writer.set(rawAcro, dictionary);
  else {
    const root = document.getWriterState().xref.trailers.map(trailer => trailer.get("Root")).find(isPdfRef);
    if (!root) throw new Error("The PDF catalog requires a full scene export to remove its widget.");
    const pending = writer.get(root), catalog = new Map(isPdfDictionary(pending) ? pending : document.catalog);
    catalog.set("AcroForm", dictionary); writer.set(root, catalog);
  }
}
function documentText(bytes: Uint8Array): string {
  if (bytes[0] === 254 && bytes[1] === 255) { let result = ""; for (let i = 2; i + 1 < bytes.length; i += 2) result += String.fromCharCode(bytes[i] * 256 + bytes[i + 1]); return result; }
  return decodePdfDocEncoding(bytes);
}

export async function saveEditorNativePdf(scene: VectorScene, session: EditorSession, options: EditorPdfSaveOptions,
  services: { fonts: EditorFontRegistry; password?: string; compileObject: (object: EditorObject, signal?: AbortSignal) => Promise<VectorScene>;
    sourceSceneIsPageContent?: boolean }): Promise<Blob> {
  options = { ...options, protection: validatePdfOutputProtection(options.protection) };
  const progress = createLoadProgressReporter(options.onProgress);
  const childOptions = (start: number, end: number, fixed: Partial<Omit<PDFLoadProgress, "value">> = {}): EditorPdfSaveOptions => {
    const child = progress.child(start, end);
    // Intermediate appearance PDFs are imported immediately. Protect only the
    // complete output, after resources and annotations have been assembled.
    return { ...options, protection: { mode: "remove" }, onProgress: value => child.report(value.value, { ...value, ...fixed,
      stage: value.stage === "complete" ? fixed.stage ?? "compile" : value.stage }) };
  };
  progress.report(0, { stage: "compile", sourceType: session.sourcePdf ? "pdf" : "scene", pageCount: scene.pageCount });
  if (options.flatten) {
    const plain = new Uint8Array(await (await writeScenePdf(scene, childOptions(0, .7))).arrayBuffer());
    const preserve = !options.protection || options.protection.mode === "preserve";
    const source = preserve && session.sourcePdf ? await NativePdfDocument.open({ kind: "bytes", bytes: session.sourcePdf },
      { password: services.password, signal: options.signal }) : undefined;
    try {
      const { rewritePdfProtection } = await import("./editorPdfProtection");
      const bytes = options.protection?.mode === "password" || source?.getWriterState().protection
        ? await rewritePdfProtection(plain, options.protection, { signal: options.signal, onProgress: childOptions(.7, 1).onProgress }, source)
        : plain;
      progress.complete({ sourceType: "scene" });
      return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
    } finally { await source?.close(); }
  }
  if (!session.sourcePdf) {
    const base = await session.getScene({ signal: options.signal, preview: false, includeObjects: false, onProgress: childOptions(0, .1).onProgress });
    const bytes = new Uint8Array(await (await writeScenePdf(base, childOptions(.1, .5))).arrayBuffer());
    // HEP has no original PDF semantics to preserve. Rebuild its edited base,
    // then write newly authored objects as editable standard annotations.
    const wrapper: EditorSession = { ...session, sourcePdf: bytes, sourceScene: { ...session.sourceScene,
      pdfPages: Array.from({ length: base.pageCount }, (_, index) => ({ pageIndex: index, sourcePageIndex: index,
        pdfToScene: [1, 0, 0, 1, base.pageRects[index * 4], base.pageRects[index * 4 + 1]] })) },
      getSourceEdits: () => [], getAnnotationEdits: () => [], getFieldValues: () => new Map() };
    const blob = await saveEditorNativePdf(scene, wrapper, { ...childOptions(.5, 1), protection: options.protection },
      { ...services, password: undefined, sourceSceneIsPageContent: true });
    progress.complete({ sourceType: "scene" }); return blob;
  }
  progress.report(0, { stage: "source", sourceType: "pdf", unit: "bytes", processed: 0, total: session.sourcePdf.length });
  const document = await NativePdfDocument.open({ kind: "bytes", bytes: session.sourcePdf }, { password: services.password, signal: options.signal });
  try {
    progress.report(.05, { stage: "source", sourceType: "pdf", unit: "bytes", processed: session.sourcePdf.length, total: session.sourcePdf.length });
    const writer = new NativePdfWriter(document);
    await applyEditorPdfFields(writer, session.getFieldValues(), services.fonts, childOptions(.05, .25));
    const layerEdits = session.getLayerEdits();
    const objectOrderChanged = layerEdits.objectOrderChanged === true;
    const paintOrderChanged = objectOrderChanged || layerEdits.stackingChanged;
    const layers = await prepareEditorNativePdfLayers(writer, session.sourceScene.optionalContent, layerEdits, options.signal);
    const edits = session.getSourceEdits();
    const sourceViews = new ScenePageViews(session.sourceScene), currentViews = new ScenePageViews(scene);
    const bakedSourceViews = new ScenePageViews(paintOrderChanged
      ? await session.getScene({ signal: options.signal, preview: false, includeObjects: false })
      : reorderEditorSceneLayers(bakeEditorSourceScene(await applyEditorSceneLayers(session.sourceScene, layerEdits,
        { signal: options.signal, onDiagnostic: options.onDiagnostic }), edits, options.signal), layerEdits));
    const sourceAnnotationRuns = services.sourceSceneIsPageContent ? new Map<string, readonly VectorDrawRun[]>() : getSceneAnnotationRuns(session.sourceScene);
    const annotationEdits = new Map(session.getAnnotationEdits().map(edit => [edit.id, edit]));
    const annotationRefs = new Set([...sourceAnnotationRuns.values()].flatMap(runs => runs.flatMap(run => Array.from({ length: run.count }, (_, i) => `${run.kind}:${run.first + i}`))));
    const changedPages = new Set<number>();
    if (objectOrderChanged) {
      // Project the full arranged sequence onto original page paints. Authored
      // annotations may cross a fixed unlayered slot, so sorting source-only
      // layer slots independently would lose achievable page-body order.
      const lastRank = new Float64Array(sourceViews.pageCount).fill(-1);
      const deleted = new Set(edits.filter(edit => edit.deleted).map(edit => `${edit.ref.kind}:${edit.ref.index}`));
      const runs = session.sourceScene.paintGraph || session.sourceScene.drawRuns ? scenePaintOrderedRuns(session.sourceScene) : defaultVectorDrawRuns(session.sourceScene);
      for (const run of runs) {
        if (!isScenePaintRunVisible(session.sourceScene, run, () => true)) continue;
        for (let index = run.first; index < run.first + run.count; index++) {
          options.signal?.throwIfAborted();
          const identity = `${run.kind}:${index}`;
          if (annotationRefs.has(identity) || deleted.has(identity)) continue;
          const rank = session.getPrimitivePaintRank({ kind: run.kind, index }); if (rank < 0) continue;
          const page = sourceViews.owners[run.kind][index];
          if (rank < lastRank[page]) changedPages.add(page);
          lastRank[page] = Math.max(lastRank[page], rank);
        }
      }
    }
    const changedMemberships = new Set(layerEdits.sourceAssignments.map(assignment => `${assignment.ref.kind}:${assignment.ref.index}`));
    const changedAnnotationMemberships = new Set(layerEdits.annotationAssignments.map(assignment => assignment.id));
    const removedLayers = new Set(layerEdits.removedLayerIds);
    const sourceCounts = Object.fromEntries(PAGE_PRIMITIVE_KINDS.map(kind => [kind, sourceViews.owners[kind].length])) as Record<PrimitiveKind, number>;
    for (const kind of PAGE_PRIMITIVE_KINDS) for (let index = 0; index < sourceCounts[kind]; index++) {
      options.signal?.throwIfAborted();
      const ref = { kind, index }, identity = `${kind}:${index}`;
      const info = getScenePrimitive(session.sourceScene, ref);
      const membershipChanged = changedMemberships.has(identity) || info.optionalContent.layerIds.some(id => removedLayers.has(id));
      if (info.annotationId && !services.sourceSceneIsPageContent) {
        if (membershipChanged) changedAnnotationMemberships.add(info.annotationId);
      } else if (membershipChanged || layerEdits.stackingChanged || info.optionalContent.layerIds.some(id => id.startsWith("direct:") && layerEdits.catalogChanged)) changedPages.add(sourceViews.owners[kind][index]);
    }
    for (const annotation of session.sourceScene.annotations ?? []) if (annotation.optionalContent !== undefined) {
      const pending = [annotation.optionalContent], visited = new Set<number>();
      while (pending.length) {
        const index = pending.pop()!; if (visited.has(index)) continue; visited.add(index);
        const node = session.sourceScene.optionalContent?.conditions[index];
        if (node?.kind === "group" && removedLayers.has(node.groupId)) changedAnnotationMemberships.add(annotation.id);
        else if (node?.kind === "not") pending.push(node.operand);
        else if (node?.kind === "and" || node?.kind === "or") pending.push(...node.operands);
      }
    }
    for (const edit of edits) if (!annotationRefs.has(`${edit.ref.kind}:${edit.ref.index}`)) {
      const page = sourceViews.owners[edit.ref.kind][edit.ref.index]; changedPages.add(page);
    }
    const pageDictionaries = new Map<number, PdfDictionary>();
    const annotationRanks = new Map<PdfValue | string, number | null>();
    const arrangedObjectRank = (id: string): number | null => { const rank = session.getObjectPaintRank(id); return rank >= 0 ? rank : null; };
    const annotationKey = (value: PdfValue): PdfValue | string => isPdfRef(value) ? `${value.objectNumber}:${value.generation}` : value;
    const objectRank = (id: string | null | undefined): number | null => {
      if (id == null) return null;
      const index = layerEdits.catalog.conditions.findIndex(condition => condition.kind === "group" && condition.groupId === id);
      return index < 0 ? null : editorLayerPaintRank(layerEdits.catalog, index);
    };
    const pageDictionary = (index: number) => { let d = pageDictionaries.get(index); if (!d) {
      const page = document.getPage(index), pending = page.ref ? writer.get(page.ref) : undefined;
      d = new Map(isPdfDictionary(pending) ? pending : page.dictionary); pageDictionaries.set(index, d);
    } return d; };
    let rebuiltPages = 0;
    for (const pageIndex of changedPages) {
      options.signal?.throwIfAborted();
      const start = .25 + .25 * rebuiltPages / changedPages.size, end = .25 + .25 * (rebuiltPages + 1) / changedPages.size;
      progress.report(start, { stage: "pdf-page", sourceType: "pdf", unit: "pages", processed: rebuiltPages, total: changedPages.size,
        pageIndex, pageCount: session.sourceScene.pageCount });
      const view = bakedSourceViews.extract(pageIndex).scene;
      const keep = Object.fromEntries(PAGE_PRIMITIVE_KINDS.map(kind => [kind, new Set(Array.from({ length: kind === "stroke" ? view.segmentCount : kind === "fill" ? view.fillPathCount : kind === "text" ? view.textInstanceCount : kind === "raster" ? view.rasterLayers.length : kind === "gradient-fill" ? view.gradientFillPathCount : view.gradientStrokeRunCount }, (_, i) => i))])) as Record<PrimitiveKind, Set<number>>;
      if (!services.sourceSceneIsPageContent) for (const runs of getSceneAnnotationRuns(view).values()) for (const run of runs) for (let i = 0; i < run.count; i++) keep[run.kind].delete(run.first + i);
      const contentScene = compactEditorScene(view, keep);
      const imported = await importEditorPdfPage(new Uint8Array(await (await writeScenePdf(contentScene, childOptions(start, end,
        { pageIndex, pageCount: session.sourceScene.pageCount }))).arrayBuffer()), writer, options.signal);
      const sourceIndex = session.sourceScene.pdfPages?.find(page => page.pageIndex === pageIndex)?.sourcePageIndex ?? pageIndex;
      const page = document.getPage(sourceIndex), geometry = computeNativePdfPageGeometry(page);
      const matrix = invertEditorMatrix(geometry.pageMatrix);
      imported.form.set("Matrix", [...matrix]);
      const form = writer.add(pdfStreamValue(imported.content, imported.form));
      const dictionary = pageDictionary(sourceIndex);
      const resources = new Map(page.resources ? await document.resolveDictionary(page.resources, options.signal) : []);
      const xobjects = new Map(resources.has("XObject") ? await document.resolveDictionary(resources.get("XObject"), options.signal) : []);
      let name = "HEPREditedPage"; while (xobjects.has(name)) name += "_";
      xobjects.set(name, form); resources.set("XObject", xobjects); dictionary.set("Resources", resources);
      dictionary.set("Contents", writer.add(pdfStreamValue(`q /${name} Do Q`)));
      options.onWarning?.(`Page ${sourceIndex + 1}: transformed, reassigned or reordered content was rebuilt as vectors; original page text authoring structure may change.`);
      progress.report(end, { stage: "pdf-page", sourceType: "pdf", unit: "pages", processed: ++rebuiltPages, total: changedPages.size,
        pageIndex, pageCount: session.sourceScene.pageCount });
    }
    // Original annotation appearances are independent of page content. Rebuild
    // only the selected appearance, keeping fields/actions and unrelated /APs.
    const forms = new NativePdfFormAppearanceRegistry(document);
    const widgetIds = new Set<string>();
    for (let pageIndex = 0; pageIndex < session.sourceScene.pageCount; pageIndex++) {
      const sourceIndex = session.sourceScene.pdfPages?.find(page => page.pageIndex === pageIndex)?.sourcePageIndex ?? pageIndex;
      const originalPage = document.getPage(sourceIndex);
      const annotations = await forms.listPageAnnotations(sourceIndex, options.signal, true);
      for (let index = 0; index < annotations.length; index++) {
        const annotation = annotations[index], start = .5 + .25 * (pageIndex + index / annotations.length) / session.sourceScene.pageCount,
          end = .5 + .25 * (pageIndex + (index + 1) / annotations.length) / session.sourceScene.pageCount;
        const rank = paintOrderChanged ? (sourceAnnotationRuns.get(annotation.id) ?? []).reduce((rank, run) => {
          for (let index = run.first; index < run.first + run.count; index++) rank = Math.max(rank, session.getPrimitivePaintRank({ kind: run.kind, index }));
          return rank;
        }, arrangedObjectRank(`annotation:${annotation.id}`) ?? -1) : editorLayerPaintRank(scene.optionalContent, scene.annotations?.find(item => item.id === annotation.id)?.optionalContent);
        annotationRanks.set(annotationKey(annotation.ref ?? annotation.dictionary), rank === -1 ? null : rank);
        if (annotation.subtype === "Widget") widgetIds.add(annotation.id);
        const progressMetadata = { sourceType: "pdf" as const, unit: "sections" as const, total: annotations.length,
          pageIndex, pageCount: session.sourceScene.pageCount, sourcePageIndex: sourceIndex, sourcePageCount: document.pages.length };
        progress.report(start, { ...progressMetadata, stage: "compile", processed: index });
        try {
        const refs = sourceAnnotationRuns.get(annotation.id)?.flatMap(run => Array.from({ length: run.count }, (_, i) => ({ kind: run.kind, index: run.first + i }))) ?? [];
        const affected = edits.filter(edit => refs.some(ref => ref.kind === edit.ref.kind && ref.index === edit.ref.index));
        const annotationEdit = annotationEdits.get(annotation.id);
        const membershipChanged = changedAnnotationMemberships.has(annotation.id);
        if (!affected.length && !annotationEdit && !membershipChanged) continue;
        if (annotationEdit?.deleted || (refs.length && refs.every(ref => affected.some(edit => edit.ref.kind === ref.kind && edit.ref.index === ref.index && edit.deleted)))) {
          if (annotation.subtype === "Widget" && annotation.ref) await removeEditorPdfWidget(writer, annotation.ref, options.signal);
          const dictionary = pageDictionary(sourceIndex);
          const raw = await document.resolveValue(dictionary.get("Annots"), options.signal);
          if (Array.isArray(raw)) dictionary.set("Annots", raw.filter(item => !((annotation.ref && isPdfRef(item) && item.objectNumber === annotation.ref.objectNumber && item.generation === annotation.ref.generation) || item === annotation.dictionary)));
          continue;
        }
        const pendingAnnotation = annotation.ref ? writer.get(annotation.ref) : undefined;
        const originalDictionary = new Map(isPdfDictionary(pendingAnnotation) ? pendingAnnotation : annotation.dictionary);
        const resolvePending = async (value: PdfValue | undefined): Promise<PdfValue | undefined> => isPdfRef(value)
          ? writer.get(value) ?? await document.resolveValue(value, options.signal) : value;
        const rawAppearances = await resolvePending(originalDictionary.get("AP"));
        if (annotationEdit && !membershipChanged && isPdfDictionary(rawAppearances)) {
          const origin = session.sourceScene.pageRects.subarray(pageIndex * 4, pageIndex * 4 + 4);
          const nativeMatrix = computeNativePdfPageGeometry(originalPage).pageMatrix;
          const sourceMatrix = session.sourceScene.pdfPages?.find(page => page.pageIndex === pageIndex)?.pdfToScene
            ?? multiplyEditorMatrices([1, 0, 0, 1, origin[0], origin[1]], nativeMatrix);
          const delta = multiplyEditorMatrices(invertEditorMatrix(sourceMatrix), multiplyEditorMatrices(annotationEdit.transform, sourceMatrix));
          const appearanceDefaults = annotation.subtype === "Widget" ? (await forms.getAcroFormMetadata(options.signal))?.defaultResources : undefined;
          const fallback = appearanceDefaults ?? (originalPage.resources ? await document.resolveDictionary(originalPage.resources, options.signal) : new Map());
          const wrap = async (raw: PdfValue): Promise<PdfValue> => {
            const value = await resolvePending(raw);
            if (!isPdfStream(value)) return raw;
            const bbox = await resolvePending(value.dictionary.get("BBox"));
            const transform = await resolvePending(value.dictionary.get("Matrix"));
            if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(item => typeof item === "number")) return raw;
            const placement = computeNativePdfAnnotationPlacement(annotation, {
              bbox: bbox as [number, number, number, number],
              matrix: Array.isArray(transform) && transform.length === 6 ? transform as [number, number, number, number, number, number] : [1, 0, 0, 1, 0, 0]
            }, [1, 0, 0, 1, 0, 0]).invocationMatrix;
            const reference = value.dictionary.has("Resources") && isPdfRef(raw) ? raw : writer.add({ ...value,
              dictionary: new Map([...value.dictionary, ["Resources", value.dictionary.get("Resources") ?? fallback]]) });
            return writer.add(pdfStreamValue(`q ${placement.map(pdfNumberValue).join(" ")} cm /Original Do Q`, new Map<string, PdfValue>([
              ["Type", pdfNameValue("XObject")], ["Subtype", pdfNameValue("Form")], ["BBox", [...annotation.rectangle]],
              ["Matrix", [...delta]], ["Resources", new Map([["XObject", new Map([["Original", reference]])]])]
            ])));
          };
          const appearances = new Map(rawAppearances);
          for (const key of ["N", "R", "D"]) {
            const raw = appearances.get(key); if (!raw) continue;
            const value = await resolvePending(raw);
            if (isPdfDictionary(value)) {
              const states = new Map<string, PdfValue>(); for (const [name, state] of value) states.set(name, await wrap(state)); appearances.set(key, states);
            } else appearances.set(key, await wrap(raw));
          }
          originalDictionary.set("AP", appearances);
          const bounds = editorTransformBounds({ minX: annotation.rectangle[0], minY: annotation.rectangle[1], maxX: annotation.rectangle[2], maxY: annotation.rectangle[3] }, delta);
          originalDictionary.set("Rect", [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]);
          const storedText = await resolvePending(originalDictionary.get("HEPRText"));
          if (isPdfString(storedText)) {
            try {
              const data = JSON.parse(decodePdfString(storedText, sourceIndex, annotation.annotationIndex)) as { version?: number; object?: EditorTextObject };
              if (data.version === 1 && data.object?.kind === "text" && Array.isArray(data.object.transform)) {
                const localDelta = multiplyEditorMatrices([1, 0, 0, 1, -origin[0], -origin[1]], multiplyEditorMatrices(annotationEdit.transform, [1, 0, 0, 1, origin[0], origin[1]]));
                data.object.transform = multiplyEditorMatrices(localDelta, data.object.transform);
                originalDictionary.set("HEPRText", pdfTextValue(JSON.stringify(data)));
              }
            } catch { options.onWarning?.("The textbox appearance was transformed, but its optional authoring metadata could not be updated."); }
          }
          const metadata = scene.annotations?.find(item => item.id === annotation.id)?.pdfGeometry;
          if (metadata?.inkList) originalDictionary.set("InkList", metadata.inkList.map(path => [...path]));
          if (metadata?.vertices) originalDictionary.set("Vertices", [...metadata.vertices]);
          if (metadata?.line) originalDictionary.set("L", [...metadata.line]);
          if (metadata?.quadPoints) originalDictionary.set("QuadPoints", [...metadata.quadPoints]);
          if (annotation.ref) writer.set(annotation.ref, originalDictionary);
          else {
            const owner = pageDictionary(sourceIndex), raw = await document.resolveValue(owner.get("Annots"), options.signal);
            if (Array.isArray(raw)) owner.set("Annots", raw.map(item => {
              if (item !== annotation.dictionary) return item;
              const ref = writer.add(originalDictionary); annotationRanks.set(annotationKey(ref), rank); return ref;
            }));
          }
          continue;
        }
        const pageScene = currentViews.extract(pageIndex).scene, runs = getSceneAnnotationRuns(pageScene).get(annotation.id) ?? [];
        const keep = Object.fromEntries(PAGE_PRIMITIVE_KINDS.map(kind => [kind, new Set<number>()])) as Record<PrimitiveKind, Set<number>>;
        for (const run of runs) for (let i = 0; i < run.count; i++) keep[run.kind].add(run.first + i);
        let partial = compactEditorScene(pageScene, keep);
        const frameScene = annotation.subtype === "Widget" ? getEditorAnnotationFrameTransform(scene, annotation.id) : undefined;
        const canonical = annotation.subtype === "Widget" ? getEditorAnnotationSource(scene, annotation.id) : undefined;
        if (frameScene && canonical?.pdfGeometry.rect) {
          const pageRects = partial.pageRects, pageBounds = partial.pageBounds;
          partial = transformWholeEditorScene(partial, invertEditorMatrix(frameScene), options.signal);
          partial.pageRects = pageRects; partial.pageBounds = pageBounds; partial.bounds = { ...pageBounds };
        }
        const imported = await importEditorPdfPage(new Uint8Array(await (await writeScenePdf(partial, childOptions(start, end, progressMetadata))).arrayBuffer()), writer, options.signal);
        if (originalDictionary.has("HEPRText")) await retainEditorTextAppearanceFonts(writer, rawAppearances, imported.form, options.signal);
        const matrix = invertEditorMatrix(computeNativePdfPageGeometry(originalPage).pageMatrix);
        imported.form.set("Matrix", [...matrix]);
        const metadata = scene.annotations?.find(item => item.id === annotation.id);
        const origin = session.sourceScene.pageRects.subarray(pageIndex * 4, pageIndex * 4 + 4);
        const bounds = metadata?.bounds ?? { minX: origin[0], minY: origin[1], maxX: origin[2], maxY: origin[3] };
        const local = { minX: bounds.minX - origin[0], minY: bounds.minY - origin[1], maxX: bounds.maxX - origin[0], maxY: bounds.maxY - origin[1] };
        const sourceMatrix = session.sourceScene.pdfPages?.find(page => page.pageIndex === pageIndex)?.pdfToScene
          ?? multiplyEditorMatrices([1, 0, 0, 1, origin[0], origin[1]], computeNativePdfPageGeometry(originalPage).pageMatrix);
        const canonicalBounds = frameScene && canonical?.pdfGeometry.rect ? editorTransformBounds({ minX: canonical.pdfGeometry.rect[0], minY: canonical.pdfGeometry.rect[1],
          maxX: canonical.pdfGeometry.rect[2], maxY: canonical.pdfGeometry.rect[3] }, sourceMatrix) : undefined;
        const appearanceBounds = canonicalBounds ? { minX: canonicalBounds.minX - origin[0], minY: canonicalBounds.minY - origin[1],
          maxX: canonicalBounds.maxX - origin[0], maxY: canonicalBounds.maxY - origin[1] } : local;
        imported.form.set("BBox", [appearanceBounds.minX, appearanceBounds.minY, appearanceBounds.maxX, appearanceBounds.maxY]);
        const rect = editorTransformBounds(local, matrix);
        const existing = annotation.ref ? writer.get(annotation.ref) : undefined;
        const dictionary = new Map(isPdfDictionary(existing) ? existing : annotation.dictionary);
        dictionary.set("Rect", [rect.minX, rect.minY, rect.maxX, rect.maxY]);
        let appearance = writer.add(pdfStreamValue(imported.content, imported.form));
        if (frameScene && canonical?.pdfGeometry.rect) appearance = wrapEditorFieldAppearance(writer, annotation, {
          rect: canonical.pdfGeometry.rect,
          transform: multiplyEditorMatrices(invertEditorMatrix(sourceMatrix), multiplyEditorMatrices(frameScene, sourceMatrix))
        }, appearance, { bbox: [appearanceBounds.minX, appearanceBounds.minY, appearanceBounds.maxX, appearanceBounds.maxY], matrix });
        if (membershipChanged) {
          dictionary.delete("OC");
          const assignment = layerEdits.annotationAssignments.find(value => value.id === annotation.id);
          const partialAssignment = refs.some(ref => changedMemberships.has(`${ref.kind}:${ref.index}`));
          const reference = assignment ? layers.groupReference(assignment.layerId)
            : partialAssignment ? true : layers.conditionReference(scene.optionalContent!, metadata?.optionalContent);
          if (reference && typeof reference !== "boolean") dictionary.set("OC", reference);
          if (reference === false) dictionary.set("F", (typeof dictionary.get("F") === "number" ? dictionary.get("F") as number : 0) | 2);
        }
        if (annotation.subtype === "Widget" && annotation.dictionary.has("AS")) {
          const state = dictionary.get("AS");
          dictionary.set("AP", new Map([["N", new Map([[state && typeof state === "object" && "value" in state ? String(state.value) : "Off", appearance]])]]));
        } else dictionary.set("AP", new Map([["N", appearance]]));
        if (metadata?.pdfGeometry.inkList) dictionary.set("InkList", metadata.pdfGeometry.inkList.map(path => [...path]));
        if (annotation.ref) writer.set(annotation.ref, dictionary);
        else {
          const owner = pageDictionary(sourceIndex), raw = await document.resolveValue(owner.get("Annots"), options.signal);
          if (Array.isArray(raw)) owner.set("Annots", raw.map(item => {
            if (item !== annotation.dictionary) return item;
            const ref = writer.add(dictionary); annotationRanks.set(annotationKey(ref), rank); return ref;
          }));
        }
        } finally { progress.report(end, { ...progressMetadata, stage: "compile", processed: index + 1 }); }
      }
      progress.report(.5 + .25 * (pageIndex + 1) / session.sourceScene.pageCount, { stage: "pdf-page", sourceType: "pdf", unit: "pages",
        processed: pageIndex + 1, total: session.sourceScene.pageCount, pageIndex, pageCount: session.sourceScene.pageCount });
    }
    if (options.onWarning && widgetIds.size && findEditorPdfFormOverlaps(scene, session, { signal: options.signal })
      .some(overlap => widgetIds.has(overlap.widgetId))) {
      options.onWarning("Artwork may overlap form fields. Chrome and some other PDF readers may paint editable fields above it. Use a flattened PDF copy to keep the artwork above the fields; that copy has no editable fields or annotations.");
    }
    const objects = session.getObjects(), objectCount = objects.filter(object => object.kind !== "group" && (object.kind !== "source" || object.isClone)).length;
    let processedObjects = 0;
    const objectProgress = (object: EditorObject) => {
      const start = .75 + .19 * processedObjects / Math.max(1, objectCount), end = .75 + .19 * (processedObjects + 1) / Math.max(1, objectCount);
      const metadata = { sourceType: "pdf" as const, unit: "sections" as const, pageIndex: object.pageIndex,
        pageCount: session.sourceScene.pageCount, total: objectCount };
      progress.report(start, { ...metadata, stage: object.kind === "text" ? "pdf-text" : "compile", processed: processedObjects });
      return { options: childOptions(start, end, metadata), complete() {
        progress.report(end, { ...metadata, stage: "compile", processed: ++processedObjects });
      } };
    };
    for (const object of objects) {
      if (object.kind !== "source" || !object.isClone) continue;
      const work = objectProgress(object);
      const keep = Object.fromEntries(PAGE_PRIMITIVE_KINDS.map(kind => [kind, new Set<number>()])) as Record<PrimitiveKind, Set<number>>;
      for (const ref of object.primitives) keep[ref.kind].add(ref.index);
      const captured = getEditorCapturedSourceScene(session, object.id);
      const cloneSource = captured ?? await applyEditorSceneLayers(session.sourceScene, session.getObjectLayerEdits(object.id), { signal: options.signal, onDiagnostic: options.onDiagnostic });
      const cloned = captured ?? transformWholeEditorScene(compactEditorScene(cloneSource, keep), object.transform, options.signal);
      const view = assignEditorGeometryLayer(new ScenePageViews(cloned).extract(object.pageIndex).scene, layerEdits.catalog, object.layerId, object.layerCondition);
      const imported = await importEditorPdfPage(new Uint8Array(await (await writeScenePdf(view, work.options)).arrayBuffer()), writer, options.signal);
      const sourceIndex = session.sourceScene.pdfPages?.find(page => page.pageIndex === object.pageIndex)?.sourcePageIndex ?? object.pageIndex;
      const page = document.getPage(sourceIndex), matrix = invertEditorMatrix(computeNativePdfPageGeometry(page).pageMatrix);
      const box = session.getObjectBounds(object.id), r = session.sourceScene.pageRects, i = object.pageIndex * 4;
      const local = { minX: box.minX - r[i], minY: box.minY - r[i + 1], maxX: box.maxX - r[i], maxY: box.maxY - r[i + 1] };
      imported.form.set("BBox", [local.minX, local.minY, local.maxX, local.maxY]); imported.form.set("Matrix", [...matrix]);
      const rect = editorTransformBounds(local, matrix);
      const cloneAnnotation = new Map<string, PdfValue>([["Type", pdfNameValue("Annot")], ["Subtype", pdfNameValue("Stamp")],
        ["NM", pdfTextValue(object.id)], ["F", 4], ["Rect", [rect.minX, rect.minY, rect.maxX, rect.maxY]],
        ["AP", new Map([["N", writer.add(pdfStreamValue(imported.content, imported.form))]])]]);
      const cloneMembership = object.layerCondition === undefined ? undefined : session.getObjectLayerCondition(object.id);
      const cloneLayer = object.layerCondition === undefined ? layers.groupReference(object.layerId)
        : layers.conditionReference(cloneMembership!.catalog, cloneMembership!.condition);
      if (cloneLayer && typeof cloneLayer !== "boolean") cloneAnnotation.set("OC", cloneLayer);
      if (cloneLayer === false) cloneAnnotation.set("F", 6);
      const annotation = writer.add(cloneAnnotation);
      const cloneRanks = view.drawRuns?.map(run => editorLayerPaintRank(view.optionalContent, run.optionalContent)).filter((rank): rank is number => rank !== null) ?? [];
      annotationRanks.set(annotationKey(annotation), paintOrderChanged ? arrangedObjectRank(object.id)
        : cloneMembership ? editorLayerPaintRank(cloneMembership.catalog, cloneMembership.condition)
          : object.layerId === undefined ? cloneRanks.length ? Math.min(...cloneRanks) : null : objectRank(object.layerId));
      const dictionary = pageDictionary(sourceIndex), previous = await document.resolveValue(dictionary.get("Annots"), options.signal);
      dictionary.set("Annots", [...(Array.isArray(previous) ? previous : []), annotation]);
      work.complete();
    }
    for (const object of objects) {
      if (object.kind === "source" || object.kind === "group") continue;
      options.signal?.throwIfAborted();
      const work = objectProgress(object);
      const sourceIndex = session.sourceScene.pdfPages?.find(page => page.pageIndex === object.pageIndex)?.sourcePageIndex ?? object.pageIndex;
      const page = document.getPage(sourceIndex), geometry = computeNativePdfPageGeometry(page);
      const localToPdf = multiplyEditorMatrices(invertEditorMatrix(geometry.pageMatrix), object.transform);
      const objectScene = object.kind === "text" ? undefined : await services.compileObject(object, options.signal);
      const bytes = object.kind === "text" ? await editorTextPdf(object, services.fonts, options.signal)
        : new Uint8Array(await (await writeScenePdf(objectScene!, work.options)).arrayBuffer());
      const imported = await importEditorPdfPage(bytes, writer, options.signal);
      let bounds = object.kind === "text" ? { minX: object.x, minY: object.y, maxX: object.x + object.width, maxY: object.y + object.height }
        : objectScene!.pageBounds;
      if ((object.kind === "ink" || object.kind === "signature") && (object.smoothing ?? 0) > 0) {
        // The appearance writer normalizes its page using these Float32 bounds.
        // Matching its BBox avoids a scale-dependent annotation placement drift.
        const box = objectScene!.pageRects;
        bounds = { minX: Math.min(box[0], box[2]), minY: Math.min(box[1], box[3]), maxX: Math.max(box[0], box[2]), maxY: Math.max(box[1], box[3]) };
      }
      const rect = editorTransformBounds(bounds, localToPdf);
      if (object.kind === "text") imported.form.set("BBox", [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]);
      imported.form.set("Matrix", [...localToPdf]);
      const appearance = writer.add(pdfStreamValue(imported.content, imported.form));
      const annotation: PdfDictionary = new Map<string, PdfValue>([["Type", pdfNameValue("Annot")], ["Subtype", pdfNameValue(object.kind === "text" ? "FreeText" : object.kind === "ink" || object.kind === "signature" ? "Ink" : object.kind === "image" ? "Stamp" : object.shape === "rectangle" ? "Square" : object.shape === "ellipse" ? "Circle" : object.shape === "polygon" ? "Polygon" : object.shape === "line" || object.shape === "arrow" ? "Line" : "PolyLine")],
        ["NM", pdfTextValue(object.id)], ["Rect", [rect.minX, rect.minY, rect.maxX, rect.maxY]], ["F", 4], ["AP", new Map([["N", appearance]])]]);
      const membership = session.getObjectLayerCondition(object.id);
      const layer = layers.conditionReference(membership.catalog, membership.condition);
      if (typeof layer !== "boolean") annotation.set("OC", layer);
      else if (!layer) annotation.set("F", 6);
      if (object.kind !== "image") annotation.set("C", normalizePrimitiveColor(object.color ?? 0x000000));
      if (object.kind === "shape" || object.kind === "ink" || object.kind === "signature") {
        annotation.set("BS", new Map<string, PdfValue>([["W", object.strokeWidth ?? 1], ["S", pdfNameValue("S")]]));
        if (object.fill !== undefined && object.fill !== null) annotation.set("IC", normalizePrimitiveColor(object.fill));
      }
      if (object.kind === "shape" && (object.shape === "polygon" || object.shape === "polyline")) annotation.set("Vertices", (object.points ?? []).flatMap(point => editorPoint(localToPdf, point[0], point[1])));
      if (object.kind === "shape" && (object.shape === "line" || object.shape === "arrow")) {
        const points = object.points?.length === 2 ? object.points : [[object.x, object.y], [object.x + object.width, object.y + object.height]];
        annotation.set("L", points.flatMap(point => editorPoint(localToPdf, point[0], point[1])));
        if (object.shape === "arrow") annotation.set("LE", [pdfNameValue("None"), pdfNameValue("ClosedArrow")]);
      }
      if (object.kind === "text") {
        const { layerCondition: _sessionCondition, ...portableObject } = object;
        annotation.set("HEPRText", pdfTextValue(JSON.stringify({ version: 1, object: portableObject })));
        annotation.set("Contents", pdfTextValue(object.runs?.map(run => run.text).join("") ?? object.text));
        const resources = imported.form.get("Resources"), fontResources = isPdfDictionary(resources) ? resources.get("Font") : undefined;
        const firstFont = isPdfDictionary(fontResources) ? fontResources.keys().next().value as string | undefined : undefined;
        annotation.set("DA", pdfAsciiValue(`/${firstFont ?? "Helv"} ${object.fontSize} Tf ${normalizePrimitiveColor(object.color ?? 0).map(pdfNumberValue).join(" ")} rg`));
        const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
        annotation.set("Q", object.align === "center" ? 1 : object.align === "right" ? 2 : 0);
        annotation.set("RC", pdfTextValue(`<body xmlns="http://www.w3.org/1999/xhtml"><p style="text-align:${object.align ?? "left"}">${(object.runs ?? [{ text: object.text }]).map(run => {
          const color = normalizePrimitiveColor(run.color ?? object.color ?? 0).map(value => Math.round(value * 255).toString(16).padStart(2, "0")).join("");
          const decoration = [run.underline ?? object.underline ? "underline" : "", run.strikethrough ?? object.strikethrough ? "line-through" : ""].filter(Boolean).join(" ");
          return `<span style="font-family:${escape(run.fontFamily ?? (run.fontId ? services.fonts.get(run.fontId).family : undefined) ?? object.fontFamily ?? "Liberation Sans")};font-size:${run.fontSize ?? object.fontSize}pt;font-weight:${run.fontWeight ?? object.fontWeight ?? 400};font-style:${run.fontStyle ?? object.fontStyle ?? "normal"};color:#${color};text-decoration:${decoration || "none"}">${escape(run.text)}</span>`;
        }).join("")}</p></body>`));
      } else if (object.kind === "ink" || object.kind === "signature") {
        const smoothing = object.smoothing ?? 0;
        if (smoothing > 0) {
          // Match the Float32 centerlines stored in the appearance, then bound
          // fallback sampling error after the full PDF-space affine transform.
          const toPdf = (point: readonly [number, number]): [number, number] => editorPoint(localToPdf, Math.fround(point[0]), Math.fround(point[1]));
          const curves = fitEditorInkPaths(object.paths, smoothing, options.signal).map(path => path.map(segment => ({
            start: toPdf(segment.start), end: toPdf(segment.end), ...(segment.control ? { control: toPdf(segment.control) } : {})
          })));
          const scale = Math.hypot(...localToPdf.slice(0, 4));
          const paths = flattenEditorInkPaths(curves, Math.max(Number.MIN_VALUE, Math.min(smoothing * scale / 4, .05)), options.signal, "float64");
          annotation.set("InkList", paths.map(path => path.flat()));
        } else annotation.set("InkList", object.paths.map(path => path.flatMap(point => editorPoint(localToPdf, point[0], point[1]))));
      }
      const dictionary = pageDictionary(sourceIndex);
      const previous = await document.resolveValue(dictionary.get("Annots"), options.signal);
      const reference = writer.add(annotation); annotationRanks.set(annotationKey(reference), paintOrderChanged ? arrangedObjectRank(object.id) : editorLayerPaintRank(membership.catalog, membership.condition));
      dictionary.set("Annots", [...(Array.isArray(previous) ? previous : []), reference]);
      work.complete();
    }
    if (paintOrderChanged) {
      let hasAnnotations = false;
      for (let pageIndex = 0; pageIndex < session.sourceScene.pageCount; pageIndex++) {
        const sourceIndex = session.sourceScene.pdfPages?.find(page => page.pageIndex === pageIndex)?.sourcePageIndex ?? pageIndex;
        const dictionary = pageDictionary(sourceIndex), raw = await document.resolveValue(dictionary.get("Annots"), options.signal);
        if (!Array.isArray(raw)) continue;
        hasAnnotations ||= raw.length > 0;
        const sorted = raw.flatMap((value, index) => {
          const rank = annotationRanks.get(annotationKey(value)); return rank == null ? [] : [{ value, rank, index }];
        }).sort((a, b) => a.rank - b.rank || a.index - b.index);
        let next = 0;
        dictionary.set("Annots", raw.map(value => annotationRanks.get(annotationKey(value)) == null ? value : sorted[next++].value));
      }
      if (hasAnnotations) {
        const message = "Editable PDF readers paint annotations above page content and may paint form fields above other annotations. A flattened PDF copy preserves the complete layer and object stacking; it has no editable fields or annotations.";
        options.onDiagnostic?.({ code: EDITOR_PDF_LAYER_STACKING_DIAGNOSTIC_CODE, severity: "warning", message });
        options.onWarning?.(`[${EDITOR_PDF_LAYER_STACKING_DIAGNOSTIC_CODE}] ${message}`);
      }
    }
    for (const [index, dictionary] of pageDictionaries) { const ref = document.getPage(index).ref; if (!ref) throw new Error("Recovered direct page requires a full scene export."); writer.set(ref, dictionary); }
    await layers.finishRemovals();
    progress.report(.94, { stage: "compile", sourceType: "pdf", unit: "sections", processed: processedObjects, total: objectCount });
    const bytes = await writer.save(options.signal, { protection: options.protection });
    progress.complete({ sourceType: "pdf", unit: "bytes", processed: bytes.length, total: bytes.length });
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
  } finally { await document.close(); }
}
