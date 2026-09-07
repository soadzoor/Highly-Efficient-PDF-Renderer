import type {
  DensePdfDecodeTiming,
  DensePdfDocument,
  DensePdfExtGState,
  DensePdfFallback,
  DensePdfFallbackReason,
  DensePdfFormXObject,
  DensePdfPageBox,
  DensePdfPreflightOptions,
  DensePdfPreflightResult,
  DensePdfPreflightTiming,
  DensePdfResourceDependency,
  DensePdfSelectedPage
} from "./densePdfDocumentTypes";
import {
  isPdfDictionary,
  isPdfName,
  isPdfRef,
  isPdfStream,
  isPdfString,
  pdfRefKey,
  type PdfDictionary,
  type PdfStream,
  type PdfValue
} from "./pdf/nativeCos";
import {
  type NativePdfDocument,
  type NativePdfPage,
  type NativePdfPageBox
} from "./pdf/nativeDocument";
import { openNativePdfDocumentFromBorrowedBytes } from "./pdf/nativeBorrowedSource";
import { PdfError } from "./pdf/nativeTypes";

const DEFAULT_DECODE_CHUNK_SIZE = 256 * 1024;
const MIN_DECODE_CHUNK_SIZE = 4 * 1024;
const MAX_DECODE_CHUNK_SIZE = 4 * 1024 * 1024;
const STREAM_SEPARATOR = new Uint8Array([0x0a]);
const SUPPORTED_CONTENT_FILTERS = new Set([
  "FlateDecode",
  "LZWDecode",
  "ASCII85Decode",
  "ASCIIHexDecode",
  "RunLengthDecode"
]);
const ALLOWED_PAGE_RESOURCE_KEYS = new Set([
  "ExtGState",
  "Font",
  "Properties",
  "ProcSet",
  "XObject"
]);
const ALLOWED_FORM_STREAM_KEYS = new Set([
  "BBox",
  "DecodeParms",
  "Filter",
  "FormType",
  "Length",
  "Matrix",
  "Resources",
  "Subtype",
  "Type"
]);
// Keep these structural ceilings aligned with the worker's Form classifier.
// The adapter materializes only lightweight Form metadata; decoded bytes and
// operator traces remain governed by the worker's independent budgets.
const MAX_NATIVE_DENSE_FORM_RECURSION_DEPTH = 16;
const MAX_NATIVE_DENSE_FORM_COUNT = 256;
const MAX_NATIVE_DENSE_PAGE_GROUP_FORM_INSPECTION = 256;
const SAFE_LINK_ANNOTATION_KEYS = new Set([
  "A", "BS", "Border", "Dest", "F", "NM", "P", "Rect",
  "StructParent", "Subtype", "Type"
]);
const SAFE_SQUARE_ANNOTATION_KEYS = new Set([
  "Border", "Contents", "F", "NM", "P", "Rect", "Subtype", "T", "Type"
]);

interface MutableDecodeTiming {
  elapsedMs: number;
  decodedBytes: number;
  chunkCount: number;
  completed: boolean;
}

interface NativeDensePrivatePage {
  readonly sourcePage: NativePdfPage;
  readonly streams: readonly PdfStream[];
  readonly forms: readonly NativeDensePrivateForm[];
  readonly decodeTiming: MutableDecodeTiming;
  readonly publicPage: DensePdfSelectedPage;
  owner: NativeDensePrivateDocument | null;
  decodeActive: boolean;
}

/** Validated source data used by the direct retained-text compiler. @internal */
export interface NativeDenseRetainedFormSource {
  readonly sourcePageIndex: number;
  readonly resourceName: string;
  readonly stream: PdfStream;
  readonly resources: PdfDictionary;
  readonly publicForm: DensePdfFormXObject;
  /** Resolve a validated nested Form source in this Form's resource scope. */
  resolveFormSource(resourceName: string): NativeDenseRetainedFormSource | null;
}

interface NativeDensePrivateForm extends NativeDenseRetainedFormSource {
  readonly node: NativeDenseFormNode;
  owner: NativeDensePrivateDocument | null;
}

interface NativeDenseFormNode {
  readonly dependencyKey: string;
  readonly stream: PdfStream;
  readonly resources: PdfDictionary;
  readonly bbox: DensePdfPageBox;
  readonly matrix: readonly [number, number, number, number, number, number];
  readonly availableExtGStates: readonly string[];
  readonly extGStates: readonly DensePdfExtGState[];
  readonly alwaysVisibleOptionalContentProperties: readonly string[];
  readonly fontDependencies: readonly DensePdfResourceDependency[];
  readonly nestedXObjects: Map<string, NativeDenseNestedFormResolution>;
  decodeActive: boolean;
}

type NativeDenseNestedFormResolution =
  | { readonly kind: "form"; readonly form: NativeDensePrivateForm }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly error: unknown };

interface NativeDenseFormInspectionState {
  readonly document: NativePdfDocument;
  readonly sourcePageIndex: number;
  readonly optionalContent: NativeOptionalContentConfig;
  readonly nodesByDependencyKey: Map<string, NativeDenseFormNode>;
  readonly directDependencyKeys: WeakMap<object, string>;
  nextDirectDependencyKey: number;
  formCount: number;
}

interface NativeDensePrivateDocument {
  readonly nativeDocument: NativePdfDocument;
  readonly pages: readonly NativeDensePrivatePage[];
  readonly chunkSize: number;
  closed: boolean;
}

interface NativeOptionalContentConfig {
  readonly alwaysVisibleGroupRefs: ReadonlySet<string>;
}

interface PreflightRejectionDetails {
  readonly sourcePageIndex?: number;
  readonly resourceName?: string;
  readonly filterName?: string;
}

class PreflightRejection extends Error {
  readonly reason: DensePdfFallbackReason;
  readonly details: PreflightRejectionDetails;

  constructor(
    reason: DensePdfFallbackReason,
    message: string,
    details: PreflightRejectionDetails = {}
  ) {
    super(message);
    this.name = "PreflightRejection";
    this.reason = reason;
    this.details = details;
  }
}

const nativeDenseDocumentState = new WeakMap<object, NativeDensePrivateDocument>();
const nativeDensePagesBySource = new WeakMap<NativePdfDocument, readonly NativeDensePrivatePage[]>();

/**
 * Dependency-free structural backend for the established dense compiler.
 *
 * This vertical slice admits conservatively validated plain Form XObjects,
 * including bounded nested Form resource graphs. Image and malformed
 * non-Form XObjects remain lazy: they are ignored unless a retained `Do`
 * reaches them, at which point the worker falls back atomically.
 * It covers the hot CAD pages that use fonts, marked-content properties, and
 * simple ExtGStates while preserving the exact public DensePdfDocument
 * contract.
 * Unsupported documents remain eligible for the established backend until
 * the native adapter has passed its differential and timing gates.
 *
 * @internal
 */
export async function preflightNativeDensePdfDocument(
  pdfBytes: Uint8Array,
  options: DensePdfPreflightOptions = {}
): Promise<DensePdfPreflightResult> {
  if (!(pdfBytes instanceof Uint8Array) || pdfBytes.byteLength === 0) {
    throw new TypeError("Native dense preflight requires non-empty Uint8Array input.");
  }
  const totalStartedAt = now();
  const chunkSize = normalizeDecodeChunkSize(options.decodedChunkSize);
  const loadStartedAt = now();
  let nativeDocument: NativePdfDocument;
  try {
    nativeDocument = await openNativePdfDocumentFromBorrowedBytes(pdfBytes, {
      label: "dense-source.pdf",
      repair: "safe"
    });
  } catch (error) {
    const loadMs = elapsed(loadStartedAt);
    const encrypted = error instanceof PdfError && error.code === "encrypted";
    return makeFallback(
      encrypted ? "encrypted" : "invalid-structure",
      encrypted
        ? "Encrypted PDFs are not supported by the dense compiler."
        : `HEPR could not parse the PDF structure: ${errorMessage(error)}`,
      { loadMs, inspectMs: 0, totalMs: elapsed(totalStartedAt) }
    );
  }

  const loadMs = elapsed(loadStartedAt);
  if (nativeDocument.pages.length < 1) {
    await nativeDocument.close();
    return makeFallback(
      "invalid-structure",
      "The PDF does not contain any pages.",
      { loadMs, inspectMs: 0, totalMs: elapsed(totalStartedAt) }
    );
  }

  // Selection errors are caller errors and deliberately escape, matching the
  // established dense preflight contract.
  let sourcePageNumbers: number[];
  try {
    sourcePageNumbers = resolvePdfPageNumbers(nativeDocument.pages.length, options.pages);
  } catch (error) {
    await nativeDocument.close();
    throw error;
  }

  const inspectStartedAt = now();
  try {
    if (nativeDocument.info.hasAcroForm) {
      throw new PreflightRejection(
        "annotations",
        "Interactive forms and widget annotations are not supported by the dense compiler."
      );
    }
    const optionalContent = await inspectAlwaysVisibleOptionalContent(nativeDocument);
    const privatePages: NativeDensePrivatePage[] = [];
    for (const sourcePageNumber of sourcePageNumbers) {
      privatePages.push(await inspectSelectedPage(
        nativeDocument,
        sourcePageNumber - 1,
        optionalContent
      ));
    }
    const inspectMs = elapsed(inspectStartedAt);
    const timing: DensePdfPreflightTiming = {
      loadMs,
      inspectMs,
      totalMs: elapsed(totalStartedAt)
    };
    const document: DensePdfDocument = {
      sourcePageCount: nativeDocument.pages.length,
      pages: Object.freeze(privatePages.map(({ publicPage }) => publicPage)),
      timing
    };
    const privateDocument: NativeDensePrivateDocument = {
      nativeDocument,
      pages: privatePages,
      chunkSize,
      closed: false
    };
    for (const page of privatePages) {
      page.owner = privateDocument;
      for (const form of page.forms) form.owner = privateDocument;
    }
    nativeDenseDocumentState.set(document, privateDocument);
    nativeDensePagesBySource.set(nativeDocument, privatePages);
    return { eligible: true, document, timing };
  } catch (error) {
    await nativeDocument.close();
    const inspectMs = elapsed(inspectStartedAt);
    const timing: DensePdfPreflightTiming = {
      loadMs,
      inspectMs,
      totalMs: elapsed(totalStartedAt)
    };
    if (error instanceof PreflightRejection) {
      return makeFallback(error.reason, error.message, timing, error.details);
    }
    const reason = error instanceof PdfError && error.code === "unsupported-filter"
      ? "unsupported-filter"
      : "invalid-structure";
    return makeFallback(
      reason,
      `The selected PDF structure is not supported: ${errorMessage(error)}`,
      timing
    );
  }
}

/** Return the native source retained by a successful adapter preflight. @internal */
export function getNativeDenseSourceDocument(
  document: DensePdfDocument
): NativePdfDocument | null {
  const state = nativeDenseDocumentState.get(document);
  return state && !state.closed ? state.nativeDocument : null;
}

/** Close a successful adapter preflight and release all parser caches. @internal */
export async function closeNativeDensePdfDocument(document: DensePdfDocument): Promise<void> {
  const state = nativeDenseDocumentState.get(document);
  if (!state || state.closed) return;
  state.closed = true;
  nativeDensePagesBySource.delete(state.nativeDocument);
  await state.nativeDocument.close();
}

/** Whether a DensePdfDocument belongs to the dependency-free adapter. @internal */
export function isNativeDensePdfDocument(document: DensePdfDocument): boolean {
  return nativeDenseDocumentState.has(document);
}

/** Return conservative Form sources retained by a successful native preflight. @internal */
export function getNativeDenseRetainedFormSources(
  document: NativePdfDocument,
  sourcePageIndex: number
): readonly NativeDenseRetainedFormSource[] | null {
  const page = nativeDensePagesBySource.get(document)?.find(
    (candidate) => candidate.sourcePage.sourcePageIndex === sourcePageIndex
  );
  return page ? page.forms : null;
}

async function inspectSelectedPage(
  document: NativePdfDocument,
  sourcePageIndex: number,
  optionalContent: NativeOptionalContentConfig
): Promise<NativeDensePrivatePage> {
  const sourcePage = document.getPage(sourcePageIndex);
  if (sourcePage.dictionary.get("OC") !== undefined) {
    throw new PreflightRejection(
      "optional-content",
      `PDF page ${sourcePageIndex + 1} is controlled by optional content.`,
      { sourcePageIndex }
    );
  }
  await validateNoVisibleAnnotations(document, sourcePage);

  const resources = sourcePage.resources === undefined || sourcePage.resources === null
    ? new Map<string, PdfValue>()
    : await document.resolveDictionary(sourcePage.resources);
  await validatePageResources(document, resources, sourcePageIndex);
  const fonts = await resolveResourceDictionary(document, resources, "Font", sourcePageIndex);
  const properties = await resolveResourceDictionary(
    document,
    resources,
    "Properties",
    sourcePageIndex
  );
  const extGStateDictionary = await resolveResourceDictionary(
    document,
    resources,
    "ExtGState",
    sourcePageIndex
  );
  const xObjects = await resolveResourceDictionary(
    document,
    resources,
    "XObject",
    sourcePageIndex
  );
  const alwaysVisibleOptionalContentProperties = await inspectOptionalContentProperties(
    document,
    properties,
    sourcePageIndex,
    optionalContent
  );
  const extGStates = await inspectSupportedExtGStates(
    document,
    extGStateDictionary,
    sourcePageIndex
  );
  const forms = await inspectFormXObjects(
    document,
    xObjects,
    sourcePageIndex,
    optionalContent
  );
  await validateInertPageGroup(
    document,
    sourcePage.dictionary.get("Group"),
    sourcePageIndex,
    extGStates,
    forms
  );
  const streams = await document.getPageContentStreams(sourcePageIndex);
  for (const stream of streams) {
    await validateContentStream(document, stream, sourcePageIndex);
  }

  const mediaBox = readPageBox(sourcePage.mediaBox, "MediaBox", sourcePageIndex);
  const cropBox = readPageBox(sourcePage.cropBox, "CropBox", sourcePageIndex);
  const bleedBox = readOptionalPageBox(sourcePage.bleedBox, "BleedBox", sourcePageIndex);
  const trimBox = readOptionalPageBox(sourcePage.trimBox, "TrimBox", sourcePageIndex);
  const artBox = readOptionalPageBox(sourcePage.artBox, "ArtBox", sourcePageIndex);
  const decodeTiming: MutableDecodeTiming = {
    elapsedMs: 0,
    decodedBytes: 0,
    chunkCount: 0,
    completed: false
  };

  let privatePage!: NativeDensePrivatePage;
  const publicPage: DensePdfSelectedPage = {
    sourcePageIndex,
    sourcePageNumber: sourcePageIndex + 1,
    mediaBox,
    cropBox,
    ...(bleedBox ? { bleedBox } : {}),
    ...(trimBox ? { trimBox } : {}),
    ...(artBox ? { artBox } : {}),
    rotation: sourcePage.rotation,
    userUnit: sourcePage.userUnit,
    contentStreamCount: streams.length,
    encodedContentBytes: streams.reduce((total, stream) => total + stream.bytes.byteLength, 0),
    availableFonts: Object.freeze(sortedResourceNames(fonts)),
    availableProperties: Object.freeze(sortedResourceNames(properties)),
    availableExtGStates: Object.freeze(sortedResourceNames(extGStateDictionary)),
    extGStates,
    alwaysVisibleOptionalContentProperties,
    fontDependencies: await readResourceDependencies(document, fonts, sourcePageIndex),
    formXObjects: Object.freeze(forms.map(({ publicForm }) => publicForm)),
    get decodeTiming(): DensePdfDecodeTiming {
      return { ...decodeTiming };
    },
    decodedContentChunks(): AsyncIterable<Uint8Array> {
      return decodePageContentChunks(privatePage);
    }
  };
  privatePage = {
    sourcePage,
    streams,
    forms,
    decodeTiming,
    publicPage,
    owner: null,
    decodeActive: false
  };
  return privatePage;
}

async function* decodePageContentChunks(
  page: NativeDensePrivatePage
): AsyncIterable<Uint8Array> {
  if (page.decodeActive) {
    throw new Error(`PDF page ${page.publicPage.sourcePageNumber} is already being decoded.`);
  }
  const owner = page.owner;
  if (!owner || owner.closed) {
    throw new PdfError("closed", "The native dense PDF source is closed.");
  }
  page.decodeActive = true;
  page.decodeTiming.elapsedMs = 0;
  page.decodeTiming.decodedBytes = 0;
  page.decodeTiming.chunkCount = 0;
  page.decodeTiming.completed = false;
  const startedAt = now();
  let completed = false;
  try {
    for (let streamIndex = 0; streamIndex < page.streams.length; streamIndex += 1) {
      if (streamIndex !== 0) {
        page.decodeTiming.decodedBytes += STREAM_SEPARATOR.length;
        page.decodeTiming.chunkCount += 1;
        yield STREAM_SEPARATOR;
      }
      const decodedChunks = owner.nativeDocument.decodeStreamChunks(
        page.streams[streamIndex],
        { chunkSize: owner.chunkSize }
      );
      for await (const chunk of coalesceDecodedChunks(decodedChunks, owner.chunkSize)) {
        if (chunk.length === 0) continue;
        page.decodeTiming.decodedBytes += chunk.length;
        page.decodeTiming.chunkCount += 1;
        yield chunk;
      }
    }
    completed = true;
  } finally {
    page.decodeTiming.elapsedMs = elapsed(startedAt);
    page.decodeTiming.completed = completed;
    page.decodeActive = false;
  }
}

async function* decodeFormContentChunks(
  form: NativeDensePrivateForm
): AsyncIterable<Uint8Array> {
  if (form.node.decodeActive) {
    throw new Error(`PDF Form XObject /${form.resourceName} is already being decoded.`);
  }
  const owner = form.owner;
  if (!owner || owner.closed) {
    throw new PdfError("closed", "The native dense PDF source is closed.");
  }
  form.node.decodeActive = true;
  try {
    const decodedChunks = owner.nativeDocument.decodeStreamChunks(
      form.stream,
      { chunkSize: owner.chunkSize }
    );
    for await (const chunk of coalesceDecodedChunks(decodedChunks, owner.chunkSize)) {
      if (chunk.length !== 0) yield chunk;
    }
  } finally {
    form.node.decodeActive = false;
  }
}

async function* coalesceDecodedChunks(
  chunks: AsyncIterable<Uint8Array>,
  chunkSize: number
): AsyncIterable<Uint8Array> {
  let pending = new Uint8Array(chunkSize);
  let pendingLength = 0;
  for await (const chunk of chunks) {
    let sourceOffset = 0;
    while (sourceOffset < chunk.length) {
      if (pendingLength === 0 && chunk.length - sourceOffset === chunkSize) {
        yield chunk.subarray(sourceOffset, sourceOffset + chunkSize);
        sourceOffset += chunkSize;
        continue;
      }
      const copied = Math.min(
        chunk.length - sourceOffset,
        chunkSize - pendingLength
      );
      pending.set(chunk.subarray(sourceOffset, sourceOffset + copied), pendingLength);
      pendingLength += copied;
      sourceOffset += copied;
      if (pendingLength === chunkSize) {
        yield pending;
        pending = new Uint8Array(chunkSize);
        pendingLength = 0;
      }
    }
  }
  if (pendingLength !== 0) yield pending.subarray(0, pendingLength);
}

async function validateNoVisibleAnnotations(
  document: NativePdfDocument,
  page: NativePdfPage
): Promise<void> {
  if (page.annotations === undefined || page.annotations === null) return;
  const annotations = await document.resolveValue(page.annotations);
  if (!Array.isArray(annotations)) {
    throw invalidPageStructure(page.sourcePageIndex, "Annots is not an array.");
  }
  for (let index = 0; index < annotations.length; index += 1) {
    const annotation = await document.resolveValue(annotations[index]);
    if (!isPdfDictionary(annotation)) {
      throw invalidPageStructure(page.sourcePageIndex, "Annots contains a non-dictionary value.");
    }
    const subtype = await document.resolveValue(annotation.get("Subtype"));
    const subtypeName = isPdfName(subtype) ? subtype.value : "";
    const allowedKeys = subtypeName === "Link"
      ? SAFE_LINK_ANNOTATION_KEYS
      : subtypeName === "Square"
        ? SAFE_SQUARE_ANNOTATION_KEYS
        : null;
    const type = await document.resolveValue(annotation.get("Type"));
    const safeType = type === undefined || type === null || isPdfName(type, "Annot");
    const zeroBorder = subtypeName === "Link"
      ? await hasExplicitZeroLinkBorder(document, annotation)
      : await hasExplicitZeroAnnotationBorder(document, annotation);
    if (
      !allowedKeys ||
      !safeType ||
      [...annotation.keys()].some((key) => !allowedKeys.has(key)) ||
      !await hasValidAnnotationRectangle(document, annotation) ||
      !zeroBorder
    ) {
      throw new PreflightRejection(
        "annotations",
        `PDF page ${page.sourcePageIndex + 1} annotation ${index + 1} may have a visible appearance.`,
        { sourcePageIndex: page.sourcePageIndex }
      );
    }
  }
}

async function inspectFormXObjects(
  document: NativePdfDocument,
  xObjects: PdfDictionary | null,
  sourcePageIndex: number,
  optionalContent: NativeOptionalContentConfig
): Promise<readonly NativeDensePrivateForm[]> {
  if (!xObjects || xObjects.size === 0) return Object.freeze([]);
  const state: NativeDenseFormInspectionState = {
    document,
    sourcePageIndex,
    optionalContent,
    nodesByDependencyKey: new Map(),
    directDependencyKeys: new WeakMap(),
    nextDirectDependencyKey: 0,
    formCount: 0
  };
  const forms: NativeDensePrivateForm[] = [];
  for (const [resourceName, rawValue] of xObjects) {
    const stream = await resolveFormStreamCandidate(document, rawValue);
    // Images, missing objects, and malformed non-Form values remain lazy. If
    // page content actually invokes one, the dense compiler receives no Form
    // summary and falls back atomically at that `Do`.
    if (!stream) continue;
    const node = await inspectFormNode(rawValue, stream, resourceName, 0, state);
    forms.push(createPrivateForm(node, resourceName, sourcePageIndex));
  }
  return Object.freeze(forms);
}

async function resolveFormStreamCandidate(
  document: NativePdfDocument,
  rawValue: PdfValue
): Promise<PdfStream | null> {
  try {
    const resolved = await document.resolveValue(rawValue);
    if (!isPdfStream(resolved)) return null;
    const subtype = await document.resolveValue(resolved.dictionary.get("Subtype"));
    return isPdfName(subtype, "Form") ? resolved : null;
  } catch {
    return null;
  }
}

async function inspectFormNode(
  rawValue: PdfValue,
  stream: PdfStream,
  resourceName: string,
  depth: number,
  state: NativeDenseFormInspectionState
): Promise<NativeDenseFormNode> {
  const dependencyKey = nativeFormDependencyKey(rawValue, stream, resourceName, state);
  const cached = state.nodesByDependencyKey.get(dependencyKey);
  if (cached) return cached;
  if (depth > MAX_NATIVE_DENSE_FORM_RECURSION_DEPTH) {
    throw unsupportedForm(
      state.sourcePageIndex,
      resourceName,
      `exceeds the resource depth limit of ${MAX_NATIVE_DENSE_FORM_RECURSION_DEPTH}`
    );
  }
  state.formCount += 1;
  if (state.formCount > MAX_NATIVE_DENSE_FORM_COUNT) {
    throw unsupportedForm(
      state.sourcePageIndex,
      resourceName,
      `exceeds the ${MAX_NATIVE_DENSE_FORM_COUNT}-Form resource limit`
    );
  }

  const { document, sourcePageIndex, optionalContent } = state;
  const dictionary = stream.dictionary;
  for (const key of dictionary.keys()) {
    if (!ALLOWED_FORM_STREAM_KEYS.has(key)) {
      throw new PreflightRejection(
        key === "OC" ? "optional-content" : "unsupported-resource",
        `PDF page ${sourcePageIndex + 1} Form XObject /${resourceName} uses unsupported /${key}.`,
        { sourcePageIndex, resourceName }
      );
    }
  }
  const type = await document.resolveValue(dictionary.get("Type"));
  if (type !== undefined && type !== null && !isPdfName(type, "XObject")) {
    throw unsupportedForm(sourcePageIndex, resourceName, "has an invalid /Type");
  }
  const subtype = await document.resolveValue(dictionary.get("Subtype"));
  if (!isPdfName(subtype, "Form")) {
    throw unsupportedForm(sourcePageIndex, resourceName, "is not a /Subtype /Form XObject");
  }
  const formType = await document.resolveValue(dictionary.get("FormType"));
  if (formType !== undefined && formType !== null && formType !== 1) {
    throw unsupportedForm(sourcePageIndex, resourceName, "has a /FormType other than 1");
  }

  const rawResources = dictionary.get("Resources");
  if (rawResources === undefined || rawResources === null) {
    throw unsupportedForm(sourcePageIndex, resourceName, "has no /Resources dictionary");
  }
  const resources = await document.resolveDictionary(rawResources);
  await validatePageResources(document, resources, sourcePageIndex);
  const nestedXObjects = await resolveResourceDictionary(
    document,
    resources,
    "XObject",
    sourcePageIndex
  );
  const fonts = await resolveResourceDictionary(
    document,
    resources,
    "Font",
    sourcePageIndex
  );
  const properties = await resolveResourceDictionary(
    document,
    resources,
    "Properties",
    sourcePageIndex
  );
  const extGStateDictionary = await resolveResourceDictionary(
    document,
    resources,
    "ExtGState",
    sourcePageIndex
  );
  const alwaysVisibleOptionalContentProperties = await inspectOptionalContentProperties(
    document,
    properties,
    sourcePageIndex,
    optionalContent
  );
  const extGStates = await inspectSupportedExtGStates(
    document,
    extGStateDictionary,
    sourcePageIndex
  );
  await validateContentStream(document, stream, sourcePageIndex);
  const bbox = await readFormBox(document, dictionary.get("BBox"), resourceName, sourcePageIndex);
  const matrix = await readFormMatrix(
    document,
    dictionary.get("Matrix"),
    resourceName,
    sourcePageIndex
  );
  const node: NativeDenseFormNode = {
    dependencyKey,
    stream,
    resources,
    bbox,
    matrix,
    availableExtGStates: Object.freeze(sortedResourceNames(extGStateDictionary)),
    extGStates,
    alwaysVisibleOptionalContentProperties,
    fontDependencies: await readResourceDependencies(
      document,
      fonts,
      sourcePageIndex,
      `direct-form-resource:${sourcePageIndex}:${resourceName}`
    ),
    nestedXObjects: new Map(),
    decodeActive: false
  };
  // Publish the validated node before following child resources so indirect
  // aliases and cycles resolve to a stable dependency identity without
  // recursive construction or unbounded promise chains.
  state.nodesByDependencyKey.set(dependencyKey, node);
  for (const [nestedResourceName, nestedRawValue] of nestedXObjects ?? []) {
    const nestedStream = await resolveFormStreamCandidate(document, nestedRawValue);
    if (!nestedStream) {
      node.nestedXObjects.set(nestedResourceName, { kind: "missing" });
      continue;
    }
    try {
      const nestedNode = await inspectFormNode(
        nestedRawValue,
        nestedStream,
        nestedResourceName,
        depth + 1,
        state
      );
      node.nestedXObjects.set(nestedResourceName, {
        kind: "form",
        form: createPrivateForm(nestedNode, nestedResourceName, sourcePageIndex)
      });
    } catch (error) {
      // Nested Forms are deliberately validated lazily from the caller's
      // perspective. Remember their deterministic failure and surface it only
      // if a retained `Do` asks the worker to classify that resource.
      node.nestedXObjects.set(nestedResourceName, { kind: "error", error });
    }
  }
  return node;
}

function createPrivateForm(
  node: NativeDenseFormNode,
  resourceName: string,
  sourcePageIndex: number
): NativeDensePrivateForm {
  let privateForm!: NativeDensePrivateForm;
  const resolveNestedForm = (rawResourceName: string): NativeDensePrivateForm | null => {
    const nestedResourceName = normalizeFormResourceName(rawResourceName);
    const resolution = node.nestedXObjects.get(nestedResourceName);
    if (!resolution || resolution.kind === "missing") return null;
    if (resolution.kind === "error") throw resolution.error;
    resolution.form.owner = privateForm.owner;
    return resolution.form;
  };
  const publicForm: DensePdfFormXObject = {
    resourceName,
    dependencyKey: node.dependencyKey,
    bbox: node.bbox,
    matrix: node.matrix,
    encodedContentBytes: node.stream.bytes.byteLength,
    availableExtGStates: node.availableExtGStates,
    extGStates: node.extGStates,
    alwaysVisibleOptionalContentProperties: node.alwaysVisibleOptionalContentProperties,
    fontDependencies: node.fontDependencies,
    resolveFormXObject(rawResourceName: string): DensePdfFormXObject | null {
      return resolveNestedForm(rawResourceName)?.publicForm ?? null;
    },
    decodedContentChunks(): AsyncIterable<Uint8Array> {
      return decodeFormContentChunks(privateForm);
    }
  };
  privateForm = {
    sourcePageIndex,
    resourceName,
    stream: node.stream,
    resources: node.resources,
    publicForm,
    resolveFormSource(rawResourceName: string): NativeDenseRetainedFormSource | null {
      return resolveNestedForm(rawResourceName);
    },
    node,
    owner: null
  };
  return privateForm;
}

function nativeFormDependencyKey(
  rawValue: PdfValue,
  stream: PdfStream,
  resourceName: string,
  state: NativeDenseFormInspectionState
): string {
  if (isPdfRef(rawValue)) {
    return `${rawValue.objectNumber} ${rawValue.generation} R`;
  }
  const cached = state.directDependencyKeys.get(stream);
  if (cached) return cached;
  const dependencyKey =
    `direct-form:${state.sourcePageIndex}:${resourceName}:${state.nextDirectDependencyKey++}`;
  state.directDependencyKeys.set(stream, dependencyKey);
  return dependencyKey;
}

function normalizeFormResourceName(value: string): string {
  if (typeof value !== "string") return "";
  return value.startsWith("/") ? value.slice(1) : value;
}

async function readFormBox(
  document: NativePdfDocument,
  rawValue: PdfValue | undefined,
  resourceName: string,
  sourcePageIndex: number
): Promise<DensePdfPageBox> {
  const resolved = await document.resolveValue(rawValue);
  if (!Array.isArray(resolved) || resolved.length !== 4) {
    throw invalidPageStructure(
      sourcePageIndex,
      `Form XObject /${resourceName} does not have a valid BBox.`
    );
  }
  const values: number[] = [];
  for (const rawEntry of resolved) {
    const entry = await document.resolveValue(rawEntry);
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      throw invalidPageStructure(
        sourcePageIndex,
        `Form XObject /${resourceName} BBox contains a non-finite number.`
      );
    }
    values.push(entry);
  }
  return readPageBox(
    values as unknown as NativePdfPageBox,
    `Form XObject /${resourceName} BBox`,
    sourcePageIndex
  );
}

async function readFormMatrix(
  document: NativePdfDocument,
  rawValue: PdfValue | undefined,
  resourceName: string,
  sourcePageIndex: number
): Promise<readonly [number, number, number, number, number, number]> {
  if (rawValue === undefined || rawValue === null) {
    return Object.freeze([1, 0, 0, 1, 0, 0]) as
      readonly [number, number, number, number, number, number];
  }
  const resolved = await document.resolveValue(rawValue);
  if (!Array.isArray(resolved) || resolved.length !== 6) {
    throw invalidPageStructure(
      sourcePageIndex,
      `Form XObject /${resourceName} Matrix does not contain six numbers.`
    );
  }
  const values: number[] = [];
  for (const rawEntry of resolved) {
    const entry = await document.resolveValue(rawEntry);
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      throw invalidPageStructure(
        sourcePageIndex,
        `Form XObject /${resourceName} Matrix contains a non-finite number.`
      );
    }
    values.push(entry);
  }
  return Object.freeze(values) as readonly [number, number, number, number, number, number];
}

async function hasValidAnnotationRectangle(
  document: NativePdfDocument,
  annotation: PdfDictionary
): Promise<boolean> {
  const rectangle = await document.resolveValue(annotation.get("Rect"));
  if (!Array.isArray(rectangle) || rectangle.length !== 4) return false;
  for (const rawValue of rectangle) {
    const value = await document.resolveValue(rawValue);
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
  }
  return true;
}

async function hasExplicitZeroAnnotationBorder(
  document: NativePdfDocument,
  annotation: PdfDictionary
): Promise<boolean> {
  const border = await document.resolveValue(annotation.get("Border"));
  if (!Array.isArray(border) || border.length !== 3) return false;
  for (let index = 0; index < border.length; index += 1) {
    const value = await document.resolveValue(border[index]);
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (index === 2 && value !== 0) return false;
  }
  return true;
}

async function hasExplicitZeroLinkBorder(
  document: NativePdfDocument,
  annotation: PdfDictionary
): Promise<boolean> {
  const hasBorder = annotation.has("Border");
  const hasBorderStyle = annotation.has("BS");
  if (!hasBorder && !hasBorderStyle) return false;
  if (hasBorder && !await hasExplicitZeroAnnotationBorder(document, annotation)) return false;
  if (!hasBorderStyle) return true;
  const borderStyle = await document.resolveValue(annotation.get("BS"));
  if (!isPdfDictionary(borderStyle) || !dictionaryHasExactlyKeys(borderStyle, ["W"])) {
    return false;
  }
  const width = await document.resolveValue(borderStyle.get("W"));
  return typeof width === "number" && Number.isFinite(width) && width === 0;
}

async function validateInertPageGroup(
  document: NativePdfDocument,
  rawGroup: PdfValue | undefined,
  sourcePageIndex: number,
  extGStates: readonly DensePdfExtGState[],
  forms: readonly NativeDensePrivateForm[]
): Promise<void> {
  if (rawGroup === undefined || rawGroup === null) return;
  const group = await document.resolveValue(rawGroup);
  const allowedKeys = new Set(["CS", "I", "K", "S", "Type"]);
  const type = isPdfDictionary(group)
    ? await document.resolveValue(group.get("Type"))
    : undefined;
  const subtype = isPdfDictionary(group)
    ? await document.resolveValue(group.get("S"))
    : undefined;
  const colorSpace = isPdfDictionary(group)
    ? await document.resolveValue(group.get("CS"))
    : undefined;
  const isolated = isPdfDictionary(group)
    ? await document.resolveValue(group.get("I"))
    : undefined;
  const knockout = isPdfDictionary(group)
    ? await document.resolveValue(group.get("K"))
    : undefined;
  const exactDefaultShape =
    isPdfDictionary(group) &&
    [...group.keys()].every((key) => allowedKeys.has(key)) &&
    isPdfName(type, "Group") &&
    isPdfName(subtype, "Transparency") &&
    isPdfName(colorSpace, "DeviceRGB") &&
    (isolated === undefined || isolated === null || isolated === false) &&
    (knockout === undefined || knockout === null || knockout === false);
  const allOpaque = extGStates.every(isOpaqueExtGState) && forms.every((form) =>
    isOpaqueFormResourceTree(form, new Set(), new Set(), { count: 0 })
  );
  if (exactDefaultShape && allOpaque) return;
  throw new PreflightRejection(
    "unsupported-resource",
    `PDF page ${sourcePageIndex + 1} uses a page-level transparency group that is not provably inert.`,
    { sourcePageIndex, resourceName: "Group" }
  );
}

function isOpaqueFormResourceTree(
  form: NativeDensePrivateForm,
  active: Set<string>,
  visited: Set<string>,
  budget: { count: number }
): boolean {
  const key = form.publicForm.dependencyKey;
  if (visited.has(key)) return true;
  if (active.has(key)) return false;
  budget.count += 1;
  if (budget.count > MAX_NATIVE_DENSE_PAGE_GROUP_FORM_INSPECTION) return false;
  if (!form.publicForm.extGStates.every(isOpaqueExtGState)) return false;
  active.add(key);
  try {
    for (const resolution of form.node.nestedXObjects.values()) {
      // Images, malformed resources, and deferred validation errors may carry
      // alpha. A page-level transparency group is inert only when the whole
      // reachable Form resource graph is provably opaque.
      if (
        resolution.kind !== "form" ||
        !isOpaqueFormResourceTree(resolution.form, active, visited, budget)
      ) {
        return false;
      }
    }
    visited.add(key);
    return true;
  } finally {
    active.delete(key);
  }
}

function isOpaqueExtGState(state: DensePdfExtGState): boolean {
  return (
    (state.strokeAlpha === undefined || state.strokeAlpha === 1) &&
    (state.fillAlpha === undefined || state.fillAlpha === 1)
  );
}

async function validatePageResources(
  document: NativePdfDocument,
  resources: PdfDictionary,
  sourcePageIndex: number
): Promise<void> {
  for (const [name, rawValue] of resources) {
    if (ALLOWED_PAGE_RESOURCE_KEYS.has(name)) continue;
    const value = await document.resolveValue(rawValue);
    const empty = (isPdfDictionary(value) && value.size === 0) ||
      (Array.isArray(value) && value.length === 0);
    if (!empty) {
      throw new PreflightRejection(
        "unsupported-resource",
        `PDF page ${sourcePageIndex + 1} uses unsupported /${name} resources.`,
        { sourcePageIndex, resourceName: name }
      );
    }
  }

  const procSet = resources.get("ProcSet");
  if (procSet !== undefined && procSet !== null) {
    const value = await document.resolveValue(procSet);
    if (!Array.isArray(value)) {
      throw invalidPageStructure(sourcePageIndex, "ProcSet resources are not an array.");
    }
    for (const entry of value) {
      const resolved = await document.resolveValue(entry);
      if (!isPdfName(resolved)) {
        throw invalidPageStructure(sourcePageIndex, "ProcSet contains a value that is not a name.");
      }
    }
  }

  for (const category of ["Font", "Properties", "ExtGState"] as const) {
    const dictionary = await resolveResourceDictionary(
      document,
      resources,
      category,
      sourcePageIndex
    );
    for (const [name, value] of dictionary ?? []) {
      const resolved = await document.resolveValue(value);
      if (!isPdfDictionary(resolved)) {
        throw invalidPageStructure(
          sourcePageIndex,
          `${category} resource /${name} has an invalid value.`
        );
      }
      if (category === "Font") {
        const subtype = await document.resolveValue(resolved.get("Subtype"));
        if (isPdfName(subtype, "Type3")) {
          throw new PreflightRejection(
            "unsupported-resource",
            `PDF page ${sourcePageIndex + 1} uses unsupported Type3 font /${name}.`,
            { sourcePageIndex, resourceName: name }
          );
        }
      }
    }
  }
}

async function resolveResourceDictionary(
  document: NativePdfDocument,
  resources: PdfDictionary,
  name: string,
  sourcePageIndex: number
): Promise<PdfDictionary | null> {
  const raw = resources.get(name);
  if (raw === undefined || raw === null) return null;
  const resolved = await document.resolveValue(raw);
  if (!isPdfDictionary(resolved)) {
    throw invalidPageStructure(sourcePageIndex, `${name} resources are not a dictionary.`);
  }
  return resolved;
}

async function inspectSupportedExtGStates(
  document: NativePdfDocument,
  extGStates: PdfDictionary | null,
  sourcePageIndex: number
): Promise<readonly DensePdfExtGState[]> {
  if (!extGStates) return Object.freeze([]);
  const supported: DensePdfExtGState[] = [];
  for (const [resourceName, rawState] of extGStates) {
    const state = await document.resolveValue(rawState);
    if (!isPdfDictionary(state)) {
      throw invalidPageStructure(
        sourcePageIndex,
        `ExtGState resource /${resourceName} has an invalid value.`
      );
    }
    let strokeAlpha: number | undefined;
    let fillAlpha: number | undefined;
    let alphaIsShape: boolean | undefined;
    let softMaskIndex: null | undefined;
    let emitsPdfJsOperator = false;
    for (const [key, rawValue] of state) {
      const value = await document.resolveValue(rawValue);
      if (key === "Type") {
        if (isPdfName(value, "ExtGState")) continue;
        throw unsupportedExtGState(sourcePageIndex, resourceName, "has a /Type other than /ExtGState");
      }
      if (key === "OPM") {
        if (value === 0 || value === 1) continue;
        throw unsupportedExtGState(sourcePageIndex, resourceName, "has an /OPM value other than 0 or 1");
      }
      if (key === "OP" || key === "op") {
        if (value === false) continue;
        throw unsupportedExtGState(
          sourcePageIndex,
          resourceName,
          `enables or has an invalid /${key} overprint value`
        );
      }
      if (key === "SA") {
        // Match the pinned PDF.js oracle: automatic stroke adjustment is not
        // applied by the legacy VectorScene path, but malformed values remain
        // a structural error rather than being silently coerced.
        if (typeof value === "boolean") continue;
        throw unsupportedExtGState(sourcePageIndex, resourceName, "has an invalid /SA value");
      }
      if (key === "SM") {
        if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) {
          continue;
        }
        throw unsupportedExtGState(
          sourcePageIndex,
          resourceName,
          "has an /SM smoothness tolerance outside the range 0 to 1"
        );
      }
      if (key === "BM") {
        if (isPdfName(value, "Normal")) {
          emitsPdfJsOperator = true;
          continue;
        }
        throw unsupportedExtGState(sourcePageIndex, resourceName, "uses a blend mode other than /Normal");
      }
      if (key === "CA" || key === "ca") {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
          throw unsupportedExtGState(
            sourcePageIndex,
            resourceName,
            `has an invalid /${key} opacity outside the range 0 to 1`
          );
        }
        if (key === "CA") strokeAlpha = value;
        else fillAlpha = value;
        emitsPdfJsOperator = true;
        continue;
      }
      if (key === "AIS") {
        if (typeof value !== "boolean") {
          throw unsupportedExtGState(
            sourcePageIndex,
            resourceName,
            "has an invalid /AIS alpha-source flag"
          );
        }
        alphaIsShape = value;
        emitsPdfJsOperator = true;
        continue;
      }
      if (key === "SMask") {
        if (isPdfName(value, "None")) {
          softMaskIndex = null;
          emitsPdfJsOperator = true;
          continue;
        }
        throw unsupportedExtGState(
          sourcePageIndex,
          resourceName,
          "uses an unsupported non-/None /SMask"
        );
      }
      throw unsupportedExtGState(sourcePageIndex, resourceName, `uses unsupported /${key}`);
    }
    supported.push(Object.freeze({
      resourceName,
      ...(strokeAlpha === undefined ? {} : { strokeAlpha }),
      ...(fillAlpha === undefined ? {} : { fillAlpha }),
      ...(alphaIsShape === undefined ? {} : { alphaIsShape }),
      ...(softMaskIndex === undefined ? {} : { softMaskIndex }),
      emitsPdfJsOperator
    }));
  }
  supported.sort((left, right) => left.resourceName.localeCompare(right.resourceName));
  return Object.freeze(supported);
}

async function inspectAlwaysVisibleOptionalContent(
  document: NativePdfDocument
): Promise<NativeOptionalContentConfig> {
  const rawProperties = document.catalog.get("OCProperties");
  if (rawProperties === undefined || rawProperties === null) {
    return { alwaysVisibleGroupRefs: new Set() };
  }
  const properties = await document.resolveValue(rawProperties);
  if (!isPdfDictionary(properties) || !dictionaryHasExactlyKeys(properties, ["D", "OCGs"])) {
    throw unsupportedOptionalContent(
      "PDF optional-content properties do not use the supported all-visible CAD layer shape."
    );
  }
  const groups = await document.resolveValue(properties.get("OCGs"));
  const defaultConfig = await document.resolveValue(properties.get("D"));
  if (!Array.isArray(groups) || !isPdfDictionary(defaultConfig)) {
    throw unsupportedOptionalContent(
      "PDF optional-content groups or their default configuration are malformed."
    );
  }
  if (!dictionaryHasExactlyKeys(defaultConfig, ["OFF", "Order"])) {
    throw unsupportedOptionalContent(
      "PDF optional-content default configuration is not the supported all-on shape."
    );
  }
  const off = await document.resolveValue(defaultConfig.get("OFF"));
  const order = await document.resolveValue(defaultConfig.get("Order"));
  if (!Array.isArray(off) || off.length !== 0 || !Array.isArray(order)) {
    throw unsupportedOptionalContent(
      "PDF optional-content default configuration contains hidden layers or malformed ordering."
    );
  }
  const alwaysVisibleGroupRefs = new Set<string>();
  for (const rawGroup of groups) {
    if (!isPdfRef(rawGroup)) {
      throw unsupportedOptionalContent("PDF optional-content groups must be unique indirect objects.");
    }
    const key = pdfRefKey(rawGroup);
    if (alwaysVisibleGroupRefs.has(key)) {
      throw unsupportedOptionalContent("PDF optional-content groups must be unique indirect objects.");
    }
    const group = await document.resolveValue(rawGroup);
    if (!isPdfDictionary(group) || !dictionaryHasExactlyKeys(group, ["Name", "Type"])) {
      throw unsupportedOptionalContent(
        "PDF optional-content group dictionaries contain unsupported behavior."
      );
    }
    const type = await document.resolveValue(group.get("Type"));
    const name = await document.resolveValue(group.get("Name"));
    if (!isPdfName(type, "OCG") || !isPdfString(name)) {
      throw unsupportedOptionalContent("PDF optional-content group dictionaries are malformed.");
    }
    alwaysVisibleGroupRefs.add(key);
  }
  return { alwaysVisibleGroupRefs };
}

async function inspectOptionalContentProperties(
  document: NativePdfDocument,
  properties: PdfDictionary | null,
  sourcePageIndex: number,
  optionalContent: NativeOptionalContentConfig
): Promise<readonly string[]> {
  if (!properties) return Object.freeze([]);
  const alwaysVisibleNames: string[] = [];
  for (const [name, value] of properties) {
    if (isPdfRef(value) && optionalContent.alwaysVisibleGroupRefs.has(pdfRefKey(value))) {
      alwaysVisibleNames.push(name);
      continue;
    }
    if (await objectGraphContainsOptionalContent(
      document,
      value,
      new Set(),
      { count: 0 }
    )) {
      throw new PreflightRejection(
        "optional-content",
        `PDF page ${sourcePageIndex + 1} property /${name} uses unsupported optional content.`,
        { sourcePageIndex, resourceName: name }
      );
    }
  }
  alwaysVisibleNames.sort();
  return Object.freeze(alwaysVisibleNames);
}

async function objectGraphContainsOptionalContent(
  document: NativePdfDocument,
  rawValue: PdfValue,
  visitedRefs: Set<string>,
  budget: { count: number }
): Promise<boolean> {
  budget.count += 1;
  if (budget.count > 10_000) {
    throw new PreflightRejection(
      "invalid-structure",
      "A PDF property resource exceeds the dense compiler's structure budget."
    );
  }
  if (isPdfRef(rawValue)) {
    const key = pdfRefKey(rawValue);
    if (visitedRefs.has(key)) return false;
    visitedRefs.add(key);
    const resolved = await document.resolveObject(rawValue);
    if (resolved === null) {
      throw new PreflightRejection(
        "invalid-structure",
        `A PDF property resource references missing object ${key}.`
      );
    }
    return await objectGraphContainsOptionalContent(document, resolved, visitedRefs, budget);
  }
  if (isPdfName(rawValue)) {
    return rawValue.value === "OCG" || rawValue.value === "OCMD";
  }
  if (Array.isArray(rawValue)) {
    for (const value of rawValue) {
      if (await objectGraphContainsOptionalContent(document, value, visitedRefs, budget)) return true;
    }
    return false;
  }
  const dictionary = isPdfStream(rawValue) ? rawValue.dictionary : rawValue;
  if (isPdfDictionary(dictionary)) {
    if (dictionary.has("OC") || dictionary.has("OCProperties")) return true;
    const type = dictionary.get("Type");
    if (type && await objectGraphContainsOptionalContent(document, type, visitedRefs, budget)) {
      return true;
    }
    for (const [key, value] of dictionary) {
      if (key === "Type" || key === "OC" || key === "OCProperties") continue;
      if (await objectGraphContainsOptionalContent(document, value, visitedRefs, budget)) return true;
    }
  }
  return false;
}

async function validateContentStream(
  document: NativePdfDocument,
  stream: PdfStream,
  sourcePageIndex: number
): Promise<void> {
  const filterValue = await resolveContainerValues(document, stream.dictionary.get("Filter"));
  const filters: string[] = [];
  if (filterValue !== undefined && filterValue !== null) {
    const values = Array.isArray(filterValue) ? filterValue : [filterValue];
    for (const value of values) {
      if (!isPdfName(value)) {
        throw invalidPageStructure(sourcePageIndex, "A content Filter entry is not a name.");
      }
      if (!SUPPORTED_CONTENT_FILTERS.has(value.value)) {
        throw new PreflightRejection(
          "unsupported-filter",
          `PDF page ${sourcePageIndex + 1} uses unsupported content filter /${value.value}.`,
          { sourcePageIndex, filterName: value.value }
        );
      }
      filters.push(value.value);
    }
  }
  const parameters = await resolveContainerValues(
    document,
    stream.dictionary.get("DecodeParms") ?? stream.dictionary.get("DP")
  );
  await validateDecodeParameters(document, parameters, filters, sourcePageIndex);
}

async function resolveContainerValues(
  document: NativePdfDocument,
  value: PdfValue | undefined
): Promise<PdfValue | undefined> {
  const resolved = await document.resolveValue(value);
  if (!Array.isArray(resolved)) return resolved;
  const output: PdfValue[] = [];
  for (const entry of resolved) {
    output.push((await document.resolveValue(entry)) ?? null);
  }
  return output;
}

async function validateDecodeParameters(
  document: NativePdfDocument,
  parameters: PdfValue | undefined,
  filters: readonly string[],
  sourcePageIndex: number
): Promise<void> {
  if (parameters === undefined || parameters === null) return;
  if (Array.isArray(parameters)) {
    if (parameters.length > filters.length) {
      throw invalidPageStructure(sourcePageIndex, "DecodeParms has more entries than Filter.");
    }
    for (let index = 0; index < parameters.length; index += 1) {
      const value = await document.resolveValue(parameters[index]);
      if (value !== null && value !== undefined) {
        validateSingleDecodeParameters(value, filters[index], sourcePageIndex);
      }
    }
    return;
  }
  validateSingleDecodeParameters(parameters, filters[0], sourcePageIndex);
}

function validateSingleDecodeParameters(
  value: PdfValue,
  filter: string | undefined,
  sourcePageIndex: number
): void {
  if (!isPdfDictionary(value)) {
    throw invalidPageStructure(sourcePageIndex, "DecodeParms is not a dictionary or array.");
  }
  if (filter === "LZWDecode") {
    const earlyChange = value.get("EarlyChange");
    if (earlyChange !== undefined && earlyChange !== 0 && earlyChange !== 1) {
      throw invalidPageStructure(sourcePageIndex, "LZW EarlyChange is not 0 or 1.");
    }
  }
  const predictor = value.get("Predictor");
  if (predictor !== undefined && typeof predictor !== "number") {
    throw invalidPageStructure(sourcePageIndex, "A content-stream Predictor is not a number.");
  }
  if (predictor !== undefined && predictor !== 1) {
    throw new PreflightRejection(
      "unsupported-filter",
      `PDF page ${sourcePageIndex + 1} uses an unsupported content-stream predictor.`,
      { sourcePageIndex, filterName: filter }
    );
  }
}

async function readResourceDependencies(
  document: NativePdfDocument,
  dictionary: PdfDictionary | null,
  sourcePageIndex: number,
  directIdentityPrefix = `direct-resource:${sourcePageIndex}`
): Promise<readonly DensePdfResourceDependency[]> {
  const dependencies: DensePdfResourceDependency[] = [];
  let directIndex = 0;
  for (const [resourceName, rawValue] of dictionary ?? []) {
    const resolved = await document.resolveValue(rawValue);
    if (!isPdfDictionary(resolved)) {
      throw invalidPageStructure(
        sourcePageIndex,
        `Font resource /${resourceName} has an invalid value.`
      );
    }
    dependencies.push(Object.freeze({
      resourceName,
      dependencyKey: isPdfRef(rawValue)
        ? `${rawValue.objectNumber} ${rawValue.generation} R`
        : `${directIdentityPrefix}:${resourceName}:${directIndex++}`
    }));
  }
  dependencies.sort((left, right) => left.resourceName.localeCompare(right.resourceName));
  return Object.freeze(dependencies);
}

function readPageBox(
  box: NativePdfPageBox,
  label: string,
  sourcePageIndex: number
): DensePdfPageBox {
  const [left, bottom, right, top] = box;
  if (![left, bottom, right, top].every(Number.isFinite)) {
    throw invalidPageStructure(sourcePageIndex, `${label} contains a non-finite number.`);
  }
  if (!(right > left) || !(top > bottom)) {
    throw invalidPageStructure(sourcePageIndex, `${label} has non-positive dimensions.`);
  }
  return { left, bottom, right, top };
}

function readOptionalPageBox(
  box: NativePdfPageBox | undefined,
  label: string,
  sourcePageIndex: number
): DensePdfPageBox | undefined {
  return box ? readPageBox(box, label, sourcePageIndex) : undefined;
}

function sortedResourceNames(dictionary: PdfDictionary | null): string[] {
  return dictionary ? [...dictionary.keys()].sort() : [];
}

function dictionaryHasExactlyKeys(
  dictionary: PdfDictionary,
  expectedKeys: readonly string[]
): boolean {
  const actual = [...dictionary.keys()].sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function unsupportedExtGState(
  sourcePageIndex: number,
  resourceName: string,
  detail: string
): PreflightRejection {
  return new PreflightRejection(
    "unsupported-resource",
    `PDF page ${sourcePageIndex + 1} ExtGState /${resourceName} ${detail}.`,
    { sourcePageIndex, resourceName }
  );
}

function unsupportedForm(
  sourcePageIndex: number,
  resourceName: string,
  detail: string
): PreflightRejection {
  return new PreflightRejection(
    "unsupported-resource",
    `PDF page ${sourcePageIndex + 1} Form XObject /${resourceName} ${detail}.`,
    { sourcePageIndex, resourceName }
  );
}

function unsupportedOptionalContent(message: string): PreflightRejection {
  return new PreflightRejection("optional-content", message);
}

function invalidPageStructure(sourcePageIndex: number, detail: string): PreflightRejection {
  return new PreflightRejection(
    "invalid-structure",
    `PDF page ${sourcePageIndex + 1} has an invalid structure: ${detail}`,
    { sourcePageIndex }
  );
}

function normalizeDecodeChunkSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_DECODE_CHUNK_SIZE;
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_DECODE_CHUNK_SIZE ||
    value > MAX_DECODE_CHUNK_SIZE
  ) {
    throw new RangeError(
      `decodedChunkSize must be an integer from ${MIN_DECODE_CHUNK_SIZE} to ${MAX_DECODE_CHUNK_SIZE}.`
    );
  }
  return value;
}

function resolvePdfPageNumbers(pdfPageCount: number, pages: string | undefined): number[] {
  if (pages !== undefined && typeof pages !== "string") {
    throw new TypeError("pages must be a string.");
  }
  const selection = pages?.trim() ?? "";
  if (selection.length === 0) {
    return Array.from({ length: pdfPageCount }, (_value, index) => index + 1);
  }
  const seen = new Set<number>();
  for (const rawPart of selection.split(",")) {
    const part = rawPart.trim();
    const singlePageMatch = /^(\d+)$/.exec(part);
    const rangeMatch = /^(\d*)\s*-\s*(\d*)$/.exec(part);
    if (!singlePageMatch && !rangeMatch) {
      throw new RangeError(
        `Invalid pages value "${pages}". Use comma-separated page numbers or inclusive ranges such as "1-5, 8, 11-13".`
      );
    }
    const firstPage = singlePageMatch
      ? Number(singlePageMatch[1])
      : rangeMatch?.[1]
        ? Number(rangeMatch[1])
        : 1;
    const lastPage = singlePageMatch
      ? firstPage
      : rangeMatch?.[2]
        ? Number(rangeMatch[2])
        : pdfPageCount;
    if (!Number.isSafeInteger(firstPage) || !Number.isSafeInteger(lastPage)) {
      throw new RangeError(`Invalid page range "${part}": page numbers must be safe integers.`);
    }
    if (firstPage < 1 || firstPage > pdfPageCount || lastPage < 1 || lastPage > pdfPageCount) {
      const invalidPage = firstPage < 1 || firstPage > pdfPageCount ? firstPage : lastPage;
      throw new RangeError(
        `PDF page number ${invalidPage} is out of range; the document contains ${pdfPageCount} page${pdfPageCount === 1 ? "" : "s"}.`
      );
    }
    if (firstPage > lastPage) {
      throw new RangeError(`Invalid page range "${part}": the first page must not exceed the last page.`);
    }
    for (let pageNumber = firstPage; pageNumber <= lastPage; pageNumber += 1) seen.add(pageNumber);
  }
  return [...seen].sort((left, right) => left - right);
}

function makeFallback(
  reason: DensePdfFallbackReason,
  message: string,
  timing: DensePdfPreflightTiming,
  details: PreflightRejectionDetails = {}
): DensePdfFallback {
  return { eligible: false, reason, message, timing, ...details };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function now(): number {
  return typeof performance === "object" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function elapsed(start: number): number {
  return Math.max(0, now() - start);
}
