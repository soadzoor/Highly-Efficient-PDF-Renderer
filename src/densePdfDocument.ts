import {
  EncryptedPDFError,
  ParseSpeeds,
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObjectCopier,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  decodePDFRawStream,
  type PDFContext,
  type PDFObject,
  type PDFPage
} from "pdf-lib";

/** Why a PDF cannot use the conservative dense-page compiler path. */
export type DensePdfFallbackReason =
  | "encrypted"
  | "annotations"
  | "optional-content"
  | "unsupported-resource"
  | "unsupported-filter"
  | "invalid-structure";

export interface DensePdfPreflightOptions {
  /** One-based Chrome-style page selection, for example `"1-5, 8"`. */
  pages?: string;

  /** Target size of decoded content chunks yielded to the compiler. @default 262144 */
  decodedChunkSize?: number;
}

/** An exact PDF page rectangle in `[left, bottom, right, top]` coordinates. */
export interface DensePdfPageBox {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export interface DensePdfDecodeTiming {
  readonly elapsedMs: number;
  readonly decodedBytes: number;
  readonly chunkCount: number;
  /** False when the consumer stopped early or decoding threw. */
  readonly completed: boolean;
}

/** A conservatively validated `/ExtGState` that the dense compiler can apply. */
export interface DensePdfExtGState {
  readonly resourceName: string;
  /** Present only when the dictionary explicitly sets stroking opacity (`/CA`). */
  readonly strokeAlpha?: number;
  /** Present only when the dictionary explicitly sets nonstroking opacity (`/ca`). */
  readonly fillAlpha?: number;
  /** Whether PDF.js emits a `setGState` op for this dictionary. */
  readonly emitsPdfJsOperator: boolean;
}

/** Stable identity for a named resource whose PDF.js dependency op is deduplicated. */
export interface DensePdfResourceDependency {
  readonly resourceName: string;
  readonly dependencyKey: string;
}

/** A conservatively validated `/Subtype /Form` XObject. */
export interface DensePdfFormXObject {
  /** Decoded PDF resource name, without its leading slash. */
  readonly resourceName: string;
  /** Stable source-object identity used to deduplicate PDF.js dependencies. */
  readonly dependencyKey: string;
  readonly bbox: DensePdfPageBox;
  /** The form's `/Matrix`, defaulting to the identity matrix. */
  readonly matrix: readonly [number, number, number, number, number, number];
  readonly encodedContentBytes: number;
  /** Names of validated `/ExtGState` resources supported by the dense compiler. */
  readonly availableExtGStates: readonly string[];
  /** Validated graphics-state behavior keyed by `resourceName`. */
  readonly extGStates: readonly DensePdfExtGState[];
  /** `/Properties` names whose direct OCG is visible in the default configuration. */
  readonly alwaysVisibleOptionalContentProperties: readonly string[];
  /** Stable identities for this Form's local font resources. */
  readonly fontDependencies: readonly DensePdfResourceDependency[];

  /** Resolve a Form-local XObject only when its `Do` operator is actually used. */
  resolveFormXObject(resourceName: string): DensePdfFormXObject | null;

  /** Decode the form stream. Only one active consumer is allowed per form. */
  decodedContentChunks(): AsyncIterable<Uint8Array>;
}

export interface DensePdfSelectedPage {
  /** Zero-based page index in the source PDF. */
  readonly sourcePageIndex: number;
  /** One-based page number in the source PDF. */
  readonly sourcePageNumber: number;
  readonly mediaBox: DensePdfPageBox;
  readonly cropBox: DensePdfPageBox;
  readonly bleedBox?: DensePdfPageBox;
  readonly trimBox?: DensePdfPageBox;
  readonly artBox?: DensePdfPageBox;
  /** The effective source `/Rotate` value, in degrees. */
  readonly rotation: number;
  /** The effective source `/UserUnit`, defaulting to 1. */
  readonly userUnit: number;
  readonly contentStreamCount: number;
  readonly encodedContentBytes: number;
  /** Decoded PDF resource names, without their leading slash. */
  readonly availableFonts: readonly string[];
  /** Decoded PDF resource names, without their leading slash. */
  readonly availableProperties: readonly string[];
  /** Names of validated `/ExtGState` resources supported by the dense compiler. */
  readonly availableExtGStates: readonly string[];
  /** Validated graphics-state behavior keyed by `resourceName`. */
  readonly extGStates: readonly DensePdfExtGState[];
  /** `/Properties` names whose direct OCG is visible in the default configuration. */
  readonly alwaysVisibleOptionalContentProperties: readonly string[];
  /** Stable identities for page font resources. */
  readonly fontDependencies: readonly DensePdfResourceDependency[];
  /** Plain Form XObjects in the page resource scope that may be invoked by `Do`. */
  readonly formXObjects: readonly DensePdfFormXObject[];
  readonly decodeTiming: DensePdfDecodeTiming;

  /**
   * Decode the page's content streams in PDF concatenation order.
   *
   * A newline is inserted between streams so adjacent tokens cannot merge.
   * The iterable may be consumed once at a time and may be requested again
   * until `buildDenseTextMiniPdf` releases the source content objects.
   */
  decodedContentChunks(): AsyncIterable<Uint8Array>;
}

export interface DensePdfPreflightTiming {
  readonly loadMs: number;
  readonly inspectMs: number;
  readonly totalMs: number;
}

/** Opaque source document retained only until the mini PDF has been built. */
export interface DensePdfDocument {
  readonly sourcePageCount: number;
  readonly pages: readonly DensePdfSelectedPage[];
  readonly timing: DensePdfPreflightTiming;
}

export interface DensePdfFallback {
  readonly eligible: false;
  readonly reason: DensePdfFallbackReason;
  readonly message: string;
  readonly sourcePageIndex?: number;
  readonly resourceName?: string;
  readonly filterName?: string;
  readonly timing: DensePdfPreflightTiming;
}

export type DensePdfPreflightResult =
  | {
      readonly eligible: true;
      readonly document: DensePdfDocument;
      readonly timing: DensePdfPreflightTiming;
    }
  | DensePdfFallback;

export interface DensePdfCompiledPage {
  readonly sourcePageIndex: number;
  /** Canonical text/state/clip/marked-content bytes retained by the compiler. */
  readonly retainedTextContent: Uint8Array;
  /** Font resource names used by retained `Tf` operators. */
  readonly referencedFonts: ReadonlySet<string>;
  /** Property resource names used by retained `BDC` operators. */
  readonly referencedProperties: ReadonlySet<string>;
  /** ExtGState resource names used by retained `gs` operators. */
  readonly referencedExtGStates?: ReadonlySet<string>;
  /** Form XObject resource names used by retained `Do` operators. */
  readonly referencedXObjects: ReadonlySet<string>;
}

export interface DensePdfMiniPdfTiming {
  readonly resourceCopyMs: number;
  readonly contentBuildMs: number;
  readonly sourceReleaseMs: number;
  readonly saveMs: number;
  readonly totalMs: number;
}

export interface DensePdfMiniPdfResult {
  readonly bytes: Uint8Array;
  readonly timing: DensePdfMiniPdfTiming;
  readonly releasedSourceContentObjects: number;
}

export type DensePdfBuildErrorCode =
  | "foreign-document"
  | "source-released"
  | "compiled-page-mismatch"
  | "missing-resource";

export class DensePdfBuildError extends Error {
  readonly code: DensePdfBuildErrorCode;

  constructor(code: DensePdfBuildErrorCode, message: string) {
    super(message);
    this.name = "DensePdfBuildError";
    this.code = code;
  }
}

interface MutableDecodeTiming {
  elapsedMs: number;
  decodedBytes: number;
  chunkCount: number;
  completed: boolean;
}

interface ContentStreamDescriptor {
  readonly stream: PDFRawStream;
  readonly filters: readonly string[];
  readonly useNativeFlate: boolean;
}

interface DensePdfPrivatePage {
  readonly publicPage: DensePdfSelectedPage;
  readonly sourcePage: PDFPage;
  readonly streams: ContentStreamDescriptor[];
  readonly contentObjectRefs: PDFRef[];
  readonly fontResources: PDFDict | null;
  readonly propertyResources: PDFDict | null;
  readonly extGStateResources: PDFDict | null;
  readonly xObjectResources: PDFDict | null;
  readonly procSetResource: PDFObject | undefined;
  readonly fontNames: ReadonlyMap<string, PDFName>;
  readonly propertyNames: ReadonlyMap<string, PDFName>;
  readonly extGStateNames: ReadonlyMap<string, PDFName>;
  readonly xObjectNames: ReadonlyMap<string, PDFName>;
  readonly formXObjects: readonly DensePdfPrivateFormXObject[];
  readonly decodeTiming: MutableDecodeTiming;
  owner: DensePdfPrivateDocument | null;
  decodeActive: boolean;
}

interface DensePdfPrivateFormXObject {
  readonly publicForm: DensePdfFormXObject;
  readonly context: PDFContext;
  readonly sourcePageIndex: number;
  readonly chunkSize: number;
  readonly optionalContent: DensePdfOptionalContentConfig;
  readonly xObjectResources: PDFDict | null;
  readonly xObjectNames: ReadonlyMap<string, PDFName>;
  readonly nestedForms: Map<string, DensePdfPrivateFormXObject | null>;
  descriptor: ContentStreamDescriptor | null;
  owner: DensePdfPrivatePage | null;
  decodeActive: boolean;
}

interface DensePdfPrivateDocument {
  readonly sourceDocument: PDFDocument;
  readonly pages: readonly DensePdfPrivatePage[];
  readonly catalogLanguage: PDFString | PDFHexString | PDFName | null;
  released: boolean;
}

interface PreflightRejectionDetails {
  sourcePageIndex?: number;
  resourceName?: string;
  filterName?: string;
}

interface DensePdfOptionalContentConfig {
  readonly alwaysVisibleGroupRefs: ReadonlySet<string>;
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
const ALLOWED_FORM_RESOURCE_KEYS = new Set([
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
const MAX_PAGE_GROUP_FORM_INSPECTION = 256;
const SAFE_LINK_ANNOTATION_KEYS = new Set([
  "A",
  "BS",
  "Border",
  "Dest",
  "F",
  "NM",
  "P",
  "Rect",
  "StructParent",
  "Subtype",
  "Type"
]);
const SAFE_SQUARE_ANNOTATION_KEYS = new Set([
  "Border",
  "Contents",
  "F",
  "NM",
  "P",
  "Rect",
  "Subtype",
  "T",
  "Type"
]);
const denseDocumentState = new WeakMap<object, DensePdfPrivateDocument>();
const directResourceDependencyKeys = new WeakMap<object, string>();
let nextDirectResourceDependencyKey = 1;

/**
 * Structurally inspect selected pages without asking PDF.js to build an
 * operator list. Eligibility is deliberately conservative: the v1 dense
 * compiler only accepts fonts, property lists, graphics/text state operators,
 * clipping, marked content, and conservatively validated text-only Forms.
 *
 * Invalid `pages` syntax/ranges are caller errors and throw. A valid document
 * that needs the ordinary PDF.js path returns `eligible: false` instead.
 */
export async function preflightDensePdfDocument(
  pdfBytes: Uint8Array | ArrayBuffer,
  options: DensePdfPreflightOptions = {}
): Promise<DensePdfPreflightResult> {
  const totalStart = now();
  const chunkSize = normalizeDecodeChunkSize(options.decodedChunkSize);
  const loadStart = now();
  let sourceDocument: PDFDocument;

  try {
    sourceDocument = await PDFDocument.load(pdfBytes, {
      parseSpeed: ParseSpeeds.Fastest,
      updateMetadata: false,
      throwOnInvalidObject: true,
      ignoreEncryption: false
    });
  } catch (error) {
    const loadMs = elapsed(loadStart);
    const encrypted =
      error instanceof EncryptedPDFError ||
      (error instanceof Error && /encrypted/i.test(error.message));
    return makeFallback(
      encrypted ? "encrypted" : "invalid-structure",
      encrypted
        ? "Encrypted PDFs are not supported by the dense compiler."
        : `pdf-lib could not parse the PDF structure: ${errorMessage(error)}`,
      { loadMs, inspectMs: 0, totalMs: elapsed(totalStart) }
    );
  }

  const loadMs = elapsed(loadStart);
  const sourcePageCount = sourceDocument.getPageCount();
  if (sourcePageCount < 1) {
    return makeFallback(
      "invalid-structure",
      "The PDF does not contain any pages.",
      { loadMs, inspectMs: 0, totalMs: elapsed(totalStart) }
    );
  }
  // Selection errors intentionally escape rather than becoming eligibility
  // fallbacks, matching the public PDF loader's existing behavior.
  const selectedPageNumbers = resolvePdfPageNumbers(sourcePageCount, options.pages);
  const inspectStart = now();

  try {
    const optionalContent = inspectDocumentLevelFeatures(sourceDocument);
    const catalogLanguage = readCatalogLanguage(sourceDocument);
    const privatePages = selectedPageNumbers.map((sourcePageNumber) =>
      inspectSelectedPage(
        sourceDocument,
        sourcePageNumber - 1,
        chunkSize,
        optionalContent
      )
    );
    const inspectMs = elapsed(inspectStart);
    const timing: DensePdfPreflightTiming = {
      loadMs,
      inspectMs,
      totalMs: elapsed(totalStart)
    };
    const document: DensePdfDocument = {
      sourcePageCount,
      pages: Object.freeze(privatePages.map((page) => page.publicPage)),
      timing
    };
    const privateDocument: DensePdfPrivateDocument = {
      sourceDocument,
      pages: privatePages,
      catalogLanguage,
      released: false
    };
    for (const page of privatePages) {
      page.owner = privateDocument;
    }
    denseDocumentState.set(document, privateDocument);
    return { eligible: true, document, timing };
  } catch (error) {
    const inspectMs = elapsed(inspectStart);
    const timing: DensePdfPreflightTiming = {
      loadMs,
      inspectMs,
      totalMs: elapsed(totalStart)
    };
    if (error instanceof PreflightRejection) {
      return makeFallback(error.reason, error.message, timing, error.details);
    }
    return makeFallback(
      "invalid-structure",
      `The selected PDF structure is not supported: ${errorMessage(error)}`,
      timing
    );
  }
}

/**
 * Build a small PDF containing only compiler-retained content and the exact
 * source font/property resource subgraphs that content references.
 *
 * This consumes the preflight document. Source content stream objects are
 * detached and deleted from pdf-lib's source context before serialization.
 */
export async function buildDenseTextMiniPdf(
  document: DensePdfDocument,
  compiledPages: readonly DensePdfCompiledPage[]
): Promise<DensePdfMiniPdfResult> {
  const privateDocument = denseDocumentState.get(document);
  if (!privateDocument) {
    throw new DensePdfBuildError(
      "foreign-document",
      "The dense PDF document was not created by preflightDensePdfDocument()."
    );
  }
  if (privateDocument.released) {
    throw new DensePdfBuildError(
      "source-released",
      "The dense PDF source content has already been released."
    );
  }

  const compiledByPageIndex = validateCompiledPages(privateDocument.pages, compiledPages);
  const totalStart = now();
  const outputDocument = await PDFDocument.create({ updateMetadata: false });
  if (privateDocument.catalogLanguage) {
    outputDocument.catalog.set(
      PDFName.of("Lang"),
      privateDocument.catalogLanguage.clone()
    );
  }
  const copier = PDFObjectCopier.for(
    privateDocument.sourceDocument.context,
    outputDocument.context
  );
  let resourceCopyMs = 0;
  let contentBuildMs = 0;

  for (const privatePage of privateDocument.pages) {
    const compiledPage = compiledByPageIndex.get(privatePage.publicPage.sourcePageIndex)!;
    const contentStart = now();
    const outputPage = outputDocument.addPage([
      Math.abs(privatePage.publicPage.mediaBox.right - privatePage.publicPage.mediaBox.left),
      Math.abs(privatePage.publicPage.mediaBox.top - privatePage.publicPage.mediaBox.bottom)
    ]);
    copyPageGeometry(outputPage, privatePage.publicPage);
    const contentStream = outputDocument.context.flateStream(
      compiledPage.retainedTextContent
    );
    const contentStreamRef = outputDocument.context.register(contentStream);
    outputPage.node.set(PDFName.Contents, contentStreamRef);
    contentBuildMs += elapsed(contentStart);

    const resourceStart = now();
    const resources = copyRetainedResources(
      outputDocument.context,
      copier,
      privatePage,
      compiledPage
    );
    outputPage.node.set(PDFName.Resources, resources);
    resourceCopyMs += elapsed(resourceStart);
  }

  const releaseStart = now();
  const releasedSourceContentObjects = releaseSourceContentObjects(privateDocument);
  const sourceReleaseMs = elapsed(releaseStart);

  const saveStart = now();
  const bytes = await outputDocument.save({
    useObjectStreams: false,
    addDefaultPage: false,
    updateFieldAppearances: false
  });
  const saveMs = elapsed(saveStart);

  return {
    bytes,
    releasedSourceContentObjects,
    timing: {
      resourceCopyMs,
      contentBuildMs,
      sourceReleaseMs,
      saveMs,
      totalMs: elapsed(totalStart)
    }
  };
}

function inspectSelectedPage(
  sourceDocument: PDFDocument,
  sourcePageIndex: number,
  chunkSize: number,
  optionalContent: DensePdfOptionalContentConfig
): DensePdfPrivatePage {
  const sourcePage = sourceDocument.getPage(sourcePageIndex);
  const context = sourceDocument.context;
  if (sourcePage.node.get(PDFName.of("OC"))) {
    throw new PreflightRejection(
      "optional-content",
      `PDF page ${sourcePageIndex + 1} is controlled by optional content.`,
      { sourcePageIndex }
    );
  }
  const pageGroup = sourcePage.node.get(PDFName.of("Group"));
  const annotations = sourcePage.node.Annots();
  if (annotations && annotations.size() > 0) {
    validateNonVisualAnnotations(annotations, context, sourcePageIndex);
  }

  const resources = sourcePage.node.Resources();
  validatePageResources(resources, context, sourcePageIndex);
  const fontResources = lookupResourceDictionary(resources, PDFName.Font, context);
  const propertyResources = lookupResourceDictionary(
    resources,
    PDFName.of("Properties"),
    context
  );
  const extGStateResources = lookupResourceDictionary(
    resources,
    PDFName.ExtGState,
    context
  );
  const xObjectResources = lookupResourceDictionary(
    resources,
    PDFName.XObject,
    context
  );
  const alwaysVisibleOptionalContentProperties = inspectOptionalContentProperties(
    propertyResources,
    context,
    sourcePageIndex,
    optionalContent
  );
  const extGStates = inspectSupportedExtGStates(
    extGStateResources,
    context,
    sourcePageIndex
  );
  const formXObjects = inspectFormXObjects(
    xObjectResources,
    context,
    sourcePageIndex,
    chunkSize,
    optionalContent
  );
  validateInertPageGroup(
    pageGroup,
    context,
    sourcePageIndex,
    extGStates,
    formXObjects
  );

  const content = readPageContentStreams(sourcePage, context, sourcePageIndex);
  const mediaBox = readPageBox(sourcePage.node.MediaBox(), "MediaBox", sourcePageIndex);
  const cropBoxArray = sourcePage.node.CropBox();
  const cropBox = cropBoxArray
    ? readPageBox(cropBoxArray, "CropBox", sourcePageIndex)
    : cloneBox(mediaBox);
  const bleedBox = readOptionalPageBox(
    sourcePage.node.BleedBox(),
    "BleedBox",
    sourcePageIndex
  );
  const trimBox = readOptionalPageBox(
    sourcePage.node.TrimBox(),
    "TrimBox",
    sourcePageIndex
  );
  const artBox = readOptionalPageBox(
    sourcePage.node.ArtBox(),
    "ArtBox",
    sourcePageIndex
  );
  const rotation = sourcePage.node.Rotate()?.asNumber() ?? 0;
  if (!Number.isFinite(rotation) || rotation % 90 !== 0) {
    throw new PreflightRejection(
      "invalid-structure",
      `PDF page ${sourcePageIndex + 1} has an invalid Rotate value.`,
      { sourcePageIndex }
    );
  }
  const userUnit = readUserUnit(sourcePage, context, sourcePageIndex);
  const fontNames = readResourceNames(fontResources);
  const propertyNames = readResourceNames(propertyResources);
  const extGStateNames = readResourceNames(extGStateResources);
  const xObjectNames = readResourceNames(xObjectResources);
  const mutableDecodeTiming: MutableDecodeTiming = {
    elapsedMs: 0,
    decodedBytes: 0,
    chunkCount: 0,
    completed: false
  };

  let privatePage!: DensePdfPrivatePage;
  const publicPage: DensePdfSelectedPage = {
    sourcePageIndex,
    sourcePageNumber: sourcePageIndex + 1,
    mediaBox,
    cropBox,
    ...(bleedBox ? { bleedBox } : {}),
    ...(trimBox ? { trimBox } : {}),
    ...(artBox ? { artBox } : {}),
    rotation,
    userUnit,
    contentStreamCount: content.streams.length,
    encodedContentBytes: content.streams.reduce(
      (total, descriptor) => total + descriptor.stream.contents.byteLength,
      0
    ),
    availableFonts: Object.freeze([...fontNames.keys()].sort()),
    availableProperties: Object.freeze([...propertyNames.keys()].sort()),
    availableExtGStates: Object.freeze([...extGStateNames.keys()].sort()),
    extGStates,
    alwaysVisibleOptionalContentProperties,
    fontDependencies: readResourceDependencies(fontResources, context),
    formXObjects: Object.freeze(formXObjects.map((form) => form.publicForm)),
    get decodeTiming(): DensePdfDecodeTiming {
      return { ...mutableDecodeTiming };
    },
    decodedContentChunks(): AsyncIterable<Uint8Array> {
      return decodePageContentChunks(privatePage, chunkSize);
    }
  };

  privatePage = {
    publicPage,
    sourcePage,
    streams: content.streams,
    contentObjectRefs: content.objectRefs,
    fontResources,
    propertyResources,
    extGStateResources,
    xObjectResources,
    procSetResource: resources?.get(PDFName.of("ProcSet")),
    fontNames,
    propertyNames,
    extGStateNames,
    xObjectNames,
    formXObjects,
    decodeTiming: mutableDecodeTiming,
    owner: null,
    decodeActive: false
  };
  for (const form of formXObjects) {
    form.owner = privatePage;
  }
  return privatePage;
}

/**
 * PDF.js does not expose the common opaque page-level transparency-group
 * wrapper in its page operator list. It is safe to ignore only the exact
 * default, non-isolated `/DeviceRGB` shape while every admitted graphics
 * state in the page and its Forms remains fully opaque. Groups with any
 * additional behavior continue through the ordinary PDF.js path.
 */
function validateInertPageGroup(
  rawGroup: PDFObject | undefined,
  context: PDFContext,
  sourcePageIndex: number,
  extGStates: readonly DensePdfExtGState[],
  forms: readonly DensePdfPrivateFormXObject[]
): void {
  if (!rawGroup) return;
  const group = context.lookup(rawGroup);
  const allowedKeys = new Set(["CS", "I", "K", "S", "Type"]);
  const type = group instanceof PDFDict ? group.lookup(PDFName.Type) : undefined;
  const subtype = group instanceof PDFDict
    ? group.lookup(PDFName.of("S"))
    : undefined;
  const colorSpace = group instanceof PDFDict
    ? group.lookup(PDFName.of("CS"))
    : undefined;
  const isolated = group instanceof PDFDict
    ? group.lookup(PDFName.of("I"))
    : undefined;
  const knockout = group instanceof PDFDict
    ? group.lookup(PDFName.of("K"))
    : undefined;
  const exactDefaultShape =
    group instanceof PDFDict &&
    group.keys().every((key) => allowedKeys.has(decodePdfName(key))) &&
    type instanceof PDFName &&
    decodePdfName(type) === "Group" &&
    subtype instanceof PDFName &&
    decodePdfName(subtype) === "Transparency" &&
    colorSpace instanceof PDFName &&
    decodePdfName(colorSpace) === "DeviceRGB" &&
    (!isolated || (isolated instanceof PDFBool && !isolated.asBoolean())) &&
    (!knockout || (knockout instanceof PDFBool && !knockout.asBoolean()));
  const allOpaque =
    extGStates.every(isOpaqueExtGState) &&
    forms.every((form) => isOpaqueFormResourceTree(
      form,
      new Set(),
      new Set(),
      { count: 0 }
    ));
  if (exactDefaultShape && allOpaque) return;

  throw new PreflightRejection(
    "unsupported-resource",
    `PDF page ${sourcePageIndex + 1} uses a page-level transparency group that is not provably inert.`,
    { sourcePageIndex, resourceName: "Group" }
  );
}

function isOpaqueFormResourceTree(
  form: DensePdfPrivateFormXObject,
  active: Set<string>,
  visited: Set<string>,
  budget: { count: number }
): boolean {
  const key = form.publicForm.dependencyKey;
  if (visited.has(key)) return true;
  if (active.has(key)) return false;
  budget.count += 1;
  if (budget.count > MAX_PAGE_GROUP_FORM_INSPECTION) return false;
  if (!form.publicForm.extGStates.every(isOpaqueExtGState)) return false;
  active.add(key);
  try {
    for (const resourceName of form.xObjectNames.keys()) {
      let nested: DensePdfPrivateFormXObject | null;
      try {
        nested = resolveNestedFormXObject(form, resourceName);
      } catch {
        return false;
      }
      // Images and other non-Form resources may carry alpha. An inert page
      // group must prove every reachable resource scope opaque without relying
      // on later content discovery.
      if (!nested || !isOpaqueFormResourceTree(nested, active, visited, budget)) {
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

/**
 * Annotation interactivity is not represented in HEP. Ignore only annotation
 * dictionaries that are provably unable to paint into the page view.
 */
function validateNonVisualAnnotations(
  annotations: PDFArray,
  context: PDFContext,
  sourcePageIndex: number
): void {
  for (let index = 0; index < annotations.size(); index += 1) {
    const annotation = context.lookup(annotations.get(index));
    if (!(annotation instanceof PDFDict)) {
      throw invalidPageStructure(sourcePageIndex, "Annots contains a non-dictionary value.");
    }
    const subtype = annotation.lookup(PDFName.of("Subtype"));
    const subtypeName = subtype instanceof PDFName ? decodePdfName(subtype) : "";
    const allowedKeys = subtypeName === "Link"
      ? SAFE_LINK_ANNOTATION_KEYS
      : subtypeName === "Square"
        ? SAFE_SQUARE_ANNOTATION_KEYS
        : null;
    const type = annotation.lookup(PDFName.Type);
    const safeType = !type || (type instanceof PDFName && decodePdfName(type) === "Annot");
    if (
      !allowedKeys ||
      !safeType ||
      annotation.keys().some((key) => !allowedKeys.has(decodePdfName(key))) ||
      !hasValidAnnotationRectangle(annotation) ||
      !(subtypeName === "Link"
        ? hasExplicitZeroLinkBorder(annotation)
        : hasExplicitZeroAnnotationBorder(annotation))
    ) {
      throw new PreflightRejection(
        "annotations",
        `PDF page ${sourcePageIndex + 1} annotation ${index + 1} may have a visible appearance.`,
        { sourcePageIndex }
      );
    }
  }
}

function hasExplicitZeroLinkBorder(annotation: PDFDict): boolean {
  const hasBorder = annotation.has(PDFName.of("Border"));
  const hasBorderStyle = annotation.has(PDFName.of("BS"));
  if (!hasBorder && !hasBorderStyle) return false;
  if (hasBorder && !hasExplicitZeroAnnotationBorder(annotation)) return false;
  if (!hasBorderStyle) return true;
  const borderStyle = annotation.lookup(PDFName.of("BS"));
  if (
    !(borderStyle instanceof PDFDict) ||
    !dictionaryHasExactlyKeys(borderStyle, ["W"])
  ) return false;
  const width = borderStyle.lookup(PDFName.of("W"));
  return width instanceof PDFNumber && Number.isFinite(width.asNumber()) && width.asNumber() === 0;
}

function hasValidAnnotationRectangle(annotation: PDFDict): boolean {
  const rect = annotation.lookup(PDFName.of("Rect"));
  if (!(rect instanceof PDFArray) || rect.size() !== 4) return false;
  for (let index = 0; index < rect.size(); index += 1) {
    const value = rect.lookup(index);
    if (!(value instanceof PDFNumber) || !Number.isFinite(value.asNumber())) return false;
  }
  return true;
}

function hasExplicitZeroAnnotationBorder(annotation: PDFDict): boolean {
  const border = annotation.lookup(PDFName.of("Border"));
  if (!(border instanceof PDFArray) || border.size() !== 3) return false;
  for (let index = 0; index < border.size(); index += 1) {
    const value = border.lookup(index);
    if (!(value instanceof PDFNumber) || !Number.isFinite(value.asNumber())) return false;
    if (index === 2 && value.asNumber() !== 0) return false;
  }
  return true;
}

function inspectFormXObjects(
  xObjects: PDFDict | null,
  context: PDFContext,
  sourcePageIndex: number,
  chunkSize: number,
  optionalContent: DensePdfOptionalContentConfig
): DensePdfPrivateFormXObject[] {
  if (!xObjects) {
    return [];
  }

  const forms: DensePdfPrivateFormXObject[] = [];
  for (const [name, rawValue] of xObjects.entries()) {
    const resourceName = decodePdfName(name);
    const stream = context.lookup(rawValue);
    // Image and malformed entries are deliberately left unresolved. They are
    // harmless when unused, while an actual `Do` cannot obtain a Form summary
    // and therefore falls back atomically during content compilation.
    if (!isFormXObjectStream(stream)) {
      continue;
    }
    forms.push(inspectFormXObject(
      rawValue,
      stream,
      resourceName,
      context,
      sourcePageIndex,
      chunkSize,
      optionalContent
    ));
  }
  return forms;
}

function inspectFormXObject(
  rawValue: PDFObject,
  stream: PDFRawStream,
  resourceName: string,
  context: PDFContext,
  sourcePageIndex: number,
  chunkSize: number,
  optionalContent: DensePdfOptionalContentConfig
): DensePdfPrivateFormXObject {
  validatePlainFormStreamDictionary(stream, resourceName, sourcePageIndex);
  const rawFormResources = stream.dict.get(PDFName.Resources);
  const formResources = rawFormResources
    ? context.lookup(rawFormResources)
    : undefined;
  if (!(formResources instanceof PDFDict)) {
    throw new PreflightRejection(
      "unsupported-resource",
      `PDF page ${sourcePageIndex + 1} Form XObject /${resourceName} does not have a valid /Resources dictionary.`,
      { sourcePageIndex, resourceName }
    );
  }
  validatePageResources(
    formResources,
    context,
    sourcePageIndex,
    ALLOWED_FORM_RESOURCE_KEYS
  );
  const fontResources = lookupResourceDictionary(
    formResources,
    PDFName.Font,
    context
  );
  const properties = lookupResourceDictionary(
    formResources,
    PDFName.of("Properties"),
    context
  );
  const alwaysVisibleOptionalContentProperties = inspectOptionalContentProperties(
    properties,
    context,
    sourcePageIndex,
    optionalContent
  );

  const bboxObject = stream.dict.lookup(PDFName.of("BBox"));
  if (!(bboxObject instanceof PDFArray)) {
    throw invalidPageStructure(
      sourcePageIndex,
      `Form XObject /${resourceName} does not have a valid BBox.`
    );
  }
  const bbox = readPageBox(
    bboxObject,
    `Form XObject /${resourceName} BBox`,
    sourcePageIndex
  );
  const matrix = readFormMatrix(stream, resourceName, sourcePageIndex);
  const descriptor = inspectContentStream(stream, sourcePageIndex);
  const extGStates = lookupResourceDictionary(
    formResources,
    PDFName.ExtGState,
    context
  );
  const supportedExtGStates = inspectSupportedExtGStates(
    extGStates,
    context,
    sourcePageIndex
  );
  const xObjectResources = lookupResourceDictionary(
    formResources,
    PDFName.XObject,
    context
  );
  const xObjectNames = readResourceNames(xObjectResources);

  let privateForm!: DensePdfPrivateFormXObject;
  const publicForm: DensePdfFormXObject = {
    resourceName,
    dependencyKey: resourceDependencyKey(
      rawValue,
      stream,
      `direct-form:${sourcePageIndex}:${resourceName}`
    ),
    bbox,
    matrix,
    encodedContentBytes: stream.contents.byteLength,
    availableExtGStates: Object.freeze([...readResourceNames(extGStates).keys()].sort()),
    extGStates: supportedExtGStates,
    alwaysVisibleOptionalContentProperties,
    fontDependencies: readResourceDependencies(fontResources, context),
    resolveFormXObject(name: string): DensePdfFormXObject | null {
      return resolveNestedFormXObject(privateForm, name)?.publicForm ?? null;
    },
    decodedContentChunks(): AsyncIterable<Uint8Array> {
      return decodeFormContentChunks(privateForm, chunkSize);
    }
  };
  privateForm = {
    publicForm,
    context,
    sourcePageIndex,
    chunkSize,
    optionalContent,
    xObjectResources,
    xObjectNames,
    nestedForms: new Map(),
    descriptor,
    owner: null,
    decodeActive: false
  };
  return privateForm;
}

function resolveNestedFormXObject(
  parent: DensePdfPrivateFormXObject,
  resourceName: string
): DensePdfPrivateFormXObject | null {
  const normalizedName = normalizeCompilerResourceName(resourceName);
  if (parent.nestedForms.has(normalizedName)) {
    return parent.nestedForms.get(normalizedName) ?? null;
  }
  const sourceName = parent.xObjectNames.get(normalizedName);
  const rawValue = sourceName && parent.xObjectResources?.get(sourceName);
  const stream = rawValue ? parent.context.lookup(rawValue) : undefined;
  if (!rawValue || !isFormXObjectStream(stream)) {
    parent.nestedForms.set(normalizedName, null);
    return null;
  }
  const nested = inspectFormXObject(
    rawValue,
    stream,
    normalizedName,
    parent.context,
    parent.sourcePageIndex,
    parent.chunkSize,
    parent.optionalContent
  );
  nested.owner = parent.owner;
  parent.nestedForms.set(normalizedName, nested);
  return nested;
}

function isFormXObjectStream(value: unknown): value is PDFRawStream {
  if (!(value instanceof PDFRawStream)) return false;
  const subtype = value.dict.lookup(PDFName.of("Subtype"));
  return subtype instanceof PDFName && decodePdfName(subtype) === "Form";
}

function validatePlainFormStreamDictionary(
  stream: PDFRawStream,
  resourceName: string,
  sourcePageIndex: number
): void {
  for (const key of stream.dict.keys()) {
    const keyName = decodePdfName(key);
    if (!ALLOWED_FORM_STREAM_KEYS.has(keyName)) {
      const reason = keyName === "OC" ? "optional-content" : "unsupported-resource";
      throw new PreflightRejection(
        reason,
        `PDF page ${sourcePageIndex + 1} Form XObject /${resourceName} uses unsupported /${keyName}.`,
        { sourcePageIndex, resourceName }
      );
    }
  }

  const type = stream.dict.lookup(PDFName.Type);
  if (
    type &&
    (!(type instanceof PDFName) || decodePdfName(type) !== "XObject")
  ) {
    throw new PreflightRejection(
      "unsupported-resource",
      `PDF page ${sourcePageIndex + 1} XObject /${resourceName} has an invalid /Type.`,
      { sourcePageIndex, resourceName }
    );
  }
  const subtype = stream.dict.lookup(PDFName.of("Subtype"));
  if (!(subtype instanceof PDFName) || decodePdfName(subtype) !== "Form") {
    throw new PreflightRejection(
      "unsupported-resource",
      `PDF page ${sourcePageIndex + 1} XObject /${resourceName} is not a Form XObject.`,
      { sourcePageIndex, resourceName }
    );
  }
  const formType = stream.dict.lookup(PDFName.of("FormType"));
  if (
    formType &&
    (!(formType instanceof PDFNumber) || formType.asNumber() !== 1)
  ) {
    throw new PreflightRejection(
      "unsupported-resource",
      `PDF page ${sourcePageIndex + 1} Form XObject /${resourceName} has a /FormType other than 1.`,
      { sourcePageIndex, resourceName }
    );
  }
}

function readFormMatrix(
  stream: PDFRawStream,
  resourceName: string,
  sourcePageIndex: number
): readonly [number, number, number, number, number, number] {
  const matrixObject = stream.dict.lookup(PDFName.of("Matrix"));
  if (!matrixObject) {
    return Object.freeze([1, 0, 0, 1, 0, 0]);
  }
  if (!(matrixObject instanceof PDFArray) || matrixObject.size() !== 6) {
    throw invalidPageStructure(
      sourcePageIndex,
      `Form XObject /${resourceName} Matrix does not contain six numbers.`
    );
  }
  const values: number[] = [];
  for (let index = 0; index < 6; index += 1) {
    const value = matrixObject.lookup(index);
    if (!(value instanceof PDFNumber) || !Number.isFinite(value.asNumber())) {
      throw invalidPageStructure(
        sourcePageIndex,
        `Form XObject /${resourceName} Matrix contains a non-finite number.`
      );
    }
    values.push(value.asNumber());
  }
  return Object.freeze(values) as readonly [number, number, number, number, number, number];
}

async function* decodePageContentChunks(
  page: DensePdfPrivatePage,
  chunkSize: number
): AsyncIterable<Uint8Array> {
  if (page.decodeActive) {
    throw new Error(`PDF page ${page.publicPage.sourcePageNumber} is already being decoded.`);
  }
  const privateDocument = page.owner;
  if (privateDocument?.released) {
    throw new DensePdfBuildError(
      "source-released",
      "The source content streams were released after building the mini PDF."
    );
  }

  page.decodeActive = true;
  page.decodeTiming.elapsedMs = 0;
  page.decodeTiming.decodedBytes = 0;
  page.decodeTiming.chunkCount = 0;
  page.decodeTiming.completed = false;
  const start = now();
  let completed = false;

  try {
    for (let streamIndex = 0; streamIndex < page.streams.length; streamIndex += 1) {
      if (streamIndex > 0) {
        page.decodeTiming.decodedBytes += STREAM_SEPARATOR.length;
        page.decodeTiming.chunkCount += 1;
        yield STREAM_SEPARATOR;
      }
      const descriptor = page.streams[streamIndex];
      const chunks = descriptor.useNativeFlate
        ? decodeNativeFlateChunks(descriptor.stream.contents, chunkSize)
        : decodeWithPdfLibChunks(descriptor.stream, chunkSize);
      for await (const chunk of chunks) {
        if (chunk.length === 0) {
          continue;
        }
        page.decodeTiming.decodedBytes += chunk.length;
        page.decodeTiming.chunkCount += 1;
        yield chunk;
      }
    }
    completed = true;
  } finally {
    page.decodeTiming.elapsedMs = elapsed(start);
    page.decodeTiming.completed = completed;
    page.decodeActive = false;
  }
}

async function* decodeFormContentChunks(
  form: DensePdfPrivateFormXObject,
  chunkSize: number
): AsyncIterable<Uint8Array> {
  if (form.decodeActive) {
    throw new Error(
      `PDF Form XObject /${form.publicForm.resourceName} is already being decoded.`
    );
  }
  const descriptor = form.descriptor;
  if (form.owner?.owner?.released || !descriptor) {
    throw new DensePdfBuildError(
      "source-released",
      "The source Form XObject streams were released after building the mini PDF."
    );
  }

  form.decodeActive = true;
  try {
    const chunks = descriptor.useNativeFlate
      ? decodeNativeFlateChunks(descriptor.stream.contents, chunkSize)
      : decodeWithPdfLibChunks(descriptor.stream, chunkSize);
    for await (const chunk of chunks) {
      if (chunk.length > 0) {
        yield chunk;
      }
    }
  } finally {
    form.decodeActive = false;
  }
}

async function* decodeNativeFlateChunks(
  compressed: Uint8Array,
  chunkSize: number
): AsyncIterable<Uint8Array> {
  const decompressor = new DecompressionStream("deflate");
  const reader = decompressor.readable.getReader();
  const writer = decompressor.writable.getWriter();
  const writePromise = writer
    .write(compressed as Uint8Array<ArrayBuffer>)
    .then(() => writer.close());
  let pending = new Uint8Array(chunkSize);
  let pendingLength = 0;
  let completed = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      let sourceOffset = 0;
      while (sourceOffset < value.length) {
        const copied = Math.min(
          value.length - sourceOffset,
          pending.length - pendingLength
        );
        pending.set(value.subarray(sourceOffset, sourceOffset + copied), pendingLength);
        pendingLength += copied;
        sourceOffset += copied;
        if (pendingLength === pending.length) {
          yield pending;
          pending = new Uint8Array(chunkSize);
          pendingLength = 0;
        }
      }
    }
    if (pendingLength > 0) {
      yield pending.subarray(0, pendingLength);
    }
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => {
        // A decompression error may already have closed the readable side.
      });
    }
    reader.releaseLock();
    await writePromise.catch((error: unknown) => {
      if (completed) {
        throw error;
      }
    });
  }
}

async function* decodeWithPdfLibChunks(
  stream: PDFRawStream,
  chunkSize: number
): AsyncIterable<Uint8Array> {
  const decoder = decodePDFRawStream(stream);
  while (!decoder.isEmpty) {
    const bytes = decoder.getBytes(chunkSize);
    if (bytes.length === 0) {
      break;
    }
    yield bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
}

function inspectDocumentLevelFeatures(
  sourceDocument: PDFDocument
): DensePdfOptionalContentConfig {
  if (sourceDocument.isEncrypted || sourceDocument.context.trailerInfo.Encrypt) {
    throw new PreflightRejection(
      "encrypted",
      "Encrypted PDFs are not supported by the dense compiler."
    );
  }
  if (sourceDocument.catalog.get(PDFName.of("AcroForm"))) {
    throw new PreflightRejection(
      "annotations",
      "Interactive forms and widget annotations are not supported by the dense compiler."
    );
  }
  return inspectAlwaysVisibleOptionalContent(sourceDocument);
}

/**
 * Recognize only the all-on CAD layer shape exercised by the dense fixtures.
 * The resulting HEP captures that default view and deliberately does not
 * preserve interactive layer controls.
 */
function inspectAlwaysVisibleOptionalContent(
  sourceDocument: PDFDocument
): DensePdfOptionalContentConfig {
  const rawProperties = sourceDocument.catalog.get(PDFName.of("OCProperties"));
  if (!rawProperties) {
    return { alwaysVisibleGroupRefs: new Set() };
  }
  const context = sourceDocument.context;
  const properties = context.lookup(rawProperties);
  if (
    !(properties instanceof PDFDict) ||
    !dictionaryHasExactlyKeys(properties, ["D", "OCGs"])
  ) {
    throw unsupportedOptionalContent(
      "PDF optional-content properties do not use the supported all-visible CAD layer shape."
    );
  }
  const groups = properties.lookup(PDFName.of("OCGs"));
  const defaultConfig = properties.lookup(PDFName.of("D"));
  if (!(groups instanceof PDFArray) || !(defaultConfig instanceof PDFDict)) {
    throw unsupportedOptionalContent(
      "PDF optional-content groups or their default configuration are malformed."
    );
  }
  if (!dictionaryHasExactlyKeys(defaultConfig, ["OFF", "Order"])) {
    throw unsupportedOptionalContent(
      "PDF optional-content default configuration is not the supported all-on shape."
    );
  }
  const off = defaultConfig.lookup(PDFName.of("OFF"));
  const order = defaultConfig.lookup(PDFName.of("Order"));
  if (!(off instanceof PDFArray) || off.size() !== 0 || !(order instanceof PDFArray)) {
    throw unsupportedOptionalContent(
      "PDF optional-content default configuration contains hidden layers or malformed ordering."
    );
  }

  const alwaysVisibleGroupRefs = new Set<string>();
  for (let index = 0; index < groups.size(); index += 1) {
    const rawGroup = groups.get(index);
    if (!(rawGroup instanceof PDFRef) || alwaysVisibleGroupRefs.has(rawGroup.tag)) {
      throw unsupportedOptionalContent(
        "PDF optional-content groups must be unique indirect objects."
      );
    }
    const group = context.lookup(rawGroup);
    if (
      !(group instanceof PDFDict) ||
      !dictionaryHasExactlyKeys(group, ["Name", "Type"])
    ) {
      throw unsupportedOptionalContent(
        "PDF optional-content group dictionaries contain unsupported behavior."
      );
    }
    const type = group.lookup(PDFName.Type);
    const name = group.lookup(PDFName.of("Name"));
    if (
      !(type instanceof PDFName) ||
      decodePdfName(type) !== "OCG" ||
      (!(name instanceof PDFString) && !(name instanceof PDFHexString))
    ) {
      throw unsupportedOptionalContent(
        "PDF optional-content group dictionaries are malformed."
      );
    }
    alwaysVisibleGroupRefs.add(rawGroup.tag);
  }
  return { alwaysVisibleGroupRefs };
}

function unsupportedOptionalContent(message: string): PreflightRejection {
  return new PreflightRejection("optional-content", message);
}

function dictionaryHasExactlyKeys(
  dictionary: PDFDict,
  expectedKeys: readonly string[]
): boolean {
  const actual = dictionary.keys().map(decodePdfName).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function readCatalogLanguage(
  sourceDocument: PDFDocument
): PDFString | PDFHexString | PDFName | null {
  const rawLanguage = sourceDocument.catalog.get(PDFName.of("Lang"));
  if (!rawLanguage) {
    return null;
  }
  const language = sourceDocument.context.lookup(rawLanguage);
  if (
    !(language instanceof PDFString) &&
    !(language instanceof PDFHexString) &&
    !(language instanceof PDFName)
  ) {
    throw new PreflightRejection(
      "invalid-structure",
      "The PDF catalog /Lang entry is not a string or name."
    );
  }
  try {
    if (language.decodeText().trim().length === 0) {
      throw new Error("empty language value");
    }
  } catch {
    throw new PreflightRejection(
      "invalid-structure",
      "The PDF catalog /Lang entry does not contain a valid language value."
    );
  }
  return language.clone();
}

function validatePageResources(
  resources: PDFDict | undefined,
  context: PDFContext,
  sourcePageIndex: number,
  allowedResourceKeys: ReadonlySet<string> = ALLOWED_PAGE_RESOURCE_KEYS
): void {
  if (!resources) {
    return;
  }
  for (const [key, rawValue] of resources.entries()) {
    const name = decodePdfName(key);
    if (allowedResourceKeys.has(name)) {
      continue;
    }
    const value = context.lookup(rawValue);
    const empty =
      (value instanceof PDFDict && value.keys().length === 0) ||
      (value instanceof PDFArray && value.size() === 0);
    if (!empty) {
      throw new PreflightRejection(
        "unsupported-resource",
        `PDF page ${sourcePageIndex + 1} uses unsupported /${name} resources.`,
        { sourcePageIndex, resourceName: name }
      );
    }
  }

  const font = resources.get(PDFName.Font);
  if (font) {
    const fontDictionary = context.lookup(font);
    if (!(fontDictionary instanceof PDFDict)) {
      throw invalidPageStructure(sourcePageIndex, "Font resources are not a dictionary.");
    }
    validateNamedDictionaryValues(
      fontDictionary,
      context,
      sourcePageIndex,
      "Font"
    );
    rejectType3Fonts(fontDictionary, context, sourcePageIndex);
  }
  const properties = resources.get(PDFName.of("Properties"));
  if (properties) {
    const propertyDictionary = context.lookup(properties);
    if (!(propertyDictionary instanceof PDFDict)) {
      throw invalidPageStructure(sourcePageIndex, "Properties resources are not a dictionary.");
    }
    validateNamedDictionaryValues(
      propertyDictionary,
      context,
      sourcePageIndex,
      "Properties"
    );
  }
  const procSet = resources.get(PDFName.of("ProcSet"));
  if (procSet) {
    const procSetArray = context.lookup(procSet);
    if (!(procSetArray instanceof PDFArray)) {
      throw invalidPageStructure(sourcePageIndex, "ProcSet resources are not an array.");
    }
    for (let index = 0; index < procSetArray.size(); index += 1) {
      if (!(procSetArray.lookup(index) instanceof PDFName)) {
        throw invalidPageStructure(sourcePageIndex, "ProcSet contains a value that is not a name.");
      }
    }
  }
  const extGStates = resources.get(PDFName.ExtGState);
  if (extGStates) {
    const extGStateDictionary = context.lookup(extGStates);
    if (!(extGStateDictionary instanceof PDFDict)) {
      throw invalidPageStructure(
        sourcePageIndex,
        "ExtGState resources are not a dictionary."
      );
    }
    validateNamedDictionaryValues(
      extGStateDictionary,
      context,
      sourcePageIndex,
      "ExtGState"
    );
  }
  if (allowedResourceKeys.has("XObject")) {
    const xObjects = resources.get(PDFName.XObject);
    if (xObjects && !(context.lookup(xObjects) instanceof PDFDict)) {
      throw invalidPageStructure(
        sourcePageIndex,
        "XObject resources are not a dictionary."
      );
    }
  }
}

/**
 * Accept only graphics-state resources whose rendering behavior the dense
 * compiler models. `/OPM` selects an overprint algorithm, but has no effect
 * while both stroking and nonstroking overprint remain disabled (their PDF
 * defaults). This narrow
 * allowance covers CAD producers that emit `/OPM 1` without enabling
 * overprint. `/SA false` is the default, while `/SM` can only affect shadings;
 * shading-capable resources are rejected elsewhere in this preflight. Normal
 * source-over blending plus constant stroke/fill opacity are represented in
 * the packed dense styles; masks and every other state still take PDF.js.
 */
function inspectSupportedExtGStates(
  extGStates: PDFDict | null,
  context: PDFContext,
  sourcePageIndex: number
): readonly DensePdfExtGState[] {
  if (!extGStates) {
    return Object.freeze([]);
  }
  const supported: DensePdfExtGState[] = [];
  for (const [name, rawValue] of extGStates.entries()) {
    const resourceName = decodePdfName(name);
    const state = context.lookup(rawValue);
    // validateNamedDictionaryValues has already rejected this case.
    if (!(state instanceof PDFDict)) {
      continue;
    }
    let strokeAlpha: number | undefined;
    let fillAlpha: number | undefined;
    let emitsPdfJsOperator = false;

    for (const [key, rawStateValue] of state.entries()) {
      const keyName = decodePdfName(key);
      const stateValue = context.lookup(rawStateValue);
      if (keyName === "Type") {
        if (
          stateValue instanceof PDFName &&
          decodePdfName(stateValue) === "ExtGState"
        ) {
          continue;
        }
        throw unsupportedExtGState(
          sourcePageIndex,
          resourceName,
          "has a /Type other than /ExtGState"
        );
      }
      if (keyName === "OPM") {
        const overprintMode = stateValue instanceof PDFNumber
          ? stateValue.asNumber()
          : Number.NaN;
        if (overprintMode === 0 || overprintMode === 1) {
          continue;
        }
        throw unsupportedExtGState(
          sourcePageIndex,
          resourceName,
          "has an /OPM value other than 0 or 1"
        );
      }
      if (keyName === "OP" || keyName === "op") {
        if (stateValue instanceof PDFBool && !stateValue.asBoolean()) {
          continue;
        }
        throw unsupportedExtGState(
          sourcePageIndex,
          resourceName,
          `enables or has an invalid /${keyName} overprint value`
        );
      }
      if (keyName === "SA") {
        if (stateValue instanceof PDFBool && !stateValue.asBoolean()) {
          continue;
        }
        throw unsupportedExtGState(
          sourcePageIndex,
          resourceName,
          "enables or has an invalid /SA automatic stroke-adjustment value"
        );
      }
      if (keyName === "SM") {
        const smoothness = stateValue instanceof PDFNumber
          ? stateValue.asNumber()
          : Number.NaN;
        if (Number.isFinite(smoothness) && smoothness >= 0 && smoothness <= 1) {
          continue;
        }
        throw unsupportedExtGState(
          sourcePageIndex,
          resourceName,
          "has an /SM smoothness tolerance outside the range 0 to 1"
        );
      }
      if (keyName === "BM") {
        if (
          stateValue instanceof PDFName &&
          decodePdfName(stateValue) === "Normal"
        ) {
          emitsPdfJsOperator = true;
          continue;
        }
        throw unsupportedExtGState(
          sourcePageIndex,
          resourceName,
          "uses a blend mode other than /Normal"
        );
      }
      if (keyName === "CA" || keyName === "ca") {
        const alpha = stateValue instanceof PDFNumber
          ? stateValue.asNumber()
          : Number.NaN;
        if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
          throw unsupportedExtGState(
            sourcePageIndex,
            resourceName,
            `has an invalid /${keyName} opacity outside the range 0 to 1`
          );
        }
        if (keyName === "CA") strokeAlpha = alpha;
        else fillAlpha = alpha;
        emitsPdfJsOperator = true;
        continue;
      }
      throw unsupportedExtGState(
        sourcePageIndex,
        resourceName,
        `uses unsupported /${keyName}`
      );
    }
    supported.push(Object.freeze({
      resourceName,
      ...(strokeAlpha === undefined ? {} : { strokeAlpha }),
      ...(fillAlpha === undefined ? {} : { fillAlpha }),
      emitsPdfJsOperator
    }));
  }
  supported.sort((a, b) => a.resourceName.localeCompare(b.resourceName));
  return Object.freeze(supported);
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

function validateNamedDictionaryValues(
  dictionary: PDFDict,
  context: PDFContext,
  sourcePageIndex: number,
  label: string
): void {
  for (const [name, rawValue] of dictionary.entries()) {
    if (!(context.lookup(rawValue) instanceof PDFDict)) {
      throw invalidPageStructure(
        sourcePageIndex,
        `${label} resource /${decodePdfName(name)} has an invalid value.`
      );
    }
  }
}

function rejectType3Fonts(
  fonts: PDFDict,
  context: PDFContext,
  sourcePageIndex: number
): void {
  for (const [name, rawValue] of fonts.entries()) {
    const font = context.lookup(rawValue);
    // validateNamedDictionaryValues has already rejected this case.
    if (!(font instanceof PDFDict)) {
      continue;
    }
    const subtype = font.lookup(PDFName.of("Subtype"));
    if (subtype instanceof PDFName && decodePdfName(subtype) === "Type3") {
      const fontName = decodePdfName(name);
      throw new PreflightRejection(
        "unsupported-resource",
        `PDF page ${sourcePageIndex + 1} uses unsupported Type3 font /${fontName}.`,
        { sourcePageIndex, resourceName: fontName }
      );
    }
  }
}

function inspectOptionalContentProperties(
  properties: PDFDict | null,
  context: PDFContext,
  sourcePageIndex: number,
  optionalContent: DensePdfOptionalContentConfig
): readonly string[] {
  if (!properties) {
    return Object.freeze([]);
  }
  const alwaysVisibleNames: string[] = [];
  for (const [name, value] of properties.entries()) {
    const propertyName = decodePdfName(name);
    if (
      value instanceof PDFRef &&
      optionalContent.alwaysVisibleGroupRefs.has(value.tag)
    ) {
      alwaysVisibleNames.push(propertyName);
      continue;
    }
    if (objectGraphContainsOptionalContent(value, context, new Set(), { count: 0 })) {
      throw new PreflightRejection(
        "optional-content",
        `PDF page ${sourcePageIndex + 1} property /${propertyName} uses unsupported optional content.`,
        { sourcePageIndex, resourceName: propertyName }
      );
    }
  }
  alwaysVisibleNames.sort();
  return Object.freeze(alwaysVisibleNames);
}

function objectGraphContainsOptionalContent(
  rawObject: PDFObject,
  context: PDFContext,
  visitedRefs: Set<string>,
  budget: { count: number }
): boolean {
  budget.count += 1;
  if (budget.count > 10_000) {
    throw new PreflightRejection(
      "invalid-structure",
      "A PDF property resource exceeds the dense compiler's structure budget."
    );
  }
  if (rawObject instanceof PDFRef) {
    if (visitedRefs.has(rawObject.tag)) {
      return false;
    }
    visitedRefs.add(rawObject.tag);
    const resolved = context.lookup(rawObject);
    if (!resolved) {
      throw new PreflightRejection(
        "invalid-structure",
        `A PDF property resource references missing object ${rawObject.toString()}.`
      );
    }
    return objectGraphContainsOptionalContent(resolved, context, visitedRefs, budget);
  }
  if (rawObject instanceof PDFName) {
    const name = decodePdfName(rawObject);
    return name === "OCG" || name === "OCMD";
  }
  if (rawObject instanceof PDFArray) {
    for (let index = 0; index < rawObject.size(); index += 1) {
      if (objectGraphContainsOptionalContent(rawObject.get(index), context, visitedRefs, budget)) {
        return true;
      }
    }
    return false;
  }
  const dictionary = rawObject instanceof PDFStream ? rawObject.dict : rawObject;
  if (dictionary instanceof PDFDict) {
    if (dictionary.has(PDFName.of("OC")) || dictionary.has(PDFName.of("OCProperties"))) {
      return true;
    }
    const type = dictionary.get(PDFName.Type);
    if (type && objectGraphContainsOptionalContent(type, context, visitedRefs, budget)) {
      return true;
    }
    for (const [key, value] of dictionary.entries()) {
      const keyName = decodePdfName(key);
      if (keyName === "Type" || keyName === "OC" || keyName === "OCProperties") {
        continue;
      }
      if (objectGraphContainsOptionalContent(value, context, visitedRefs, budget)) {
        return true;
      }
    }
  }
  return false;
}

function readPageContentStreams(
  sourcePage: PDFPage,
  context: PDFContext,
  sourcePageIndex: number
): { streams: ContentStreamDescriptor[]; objectRefs: PDFRef[] } {
  const rawContents = sourcePage.node.get(PDFName.Contents);
  if (!rawContents) {
    return { streams: [], objectRefs: [] };
  }
  const objectRefs = new Map<string, PDFRef>();
  if (rawContents instanceof PDFRef) {
    objectRefs.set(rawContents.tag, rawContents);
  }
  const contents = context.lookup(rawContents);
  const rawStreams = contents instanceof PDFArray
    ? contents.asArray()
    : contents
      ? [rawContents]
      : [];
  const streams: ContentStreamDescriptor[] = [];

  for (const rawStream of rawStreams) {
    if (rawStream instanceof PDFRef) {
      objectRefs.set(rawStream.tag, rawStream);
    }
    const stream = context.lookup(rawStream);
    if (!(stream instanceof PDFRawStream)) {
      throw invalidPageStructure(
        sourcePageIndex,
        "Contents contains an object that is not a raw stream."
      );
    }
    const streamRef = context.getObjectRef(stream);
    if (streamRef) {
      objectRefs.set(streamRef.tag, streamRef);
    }
    streams.push(inspectContentStream(stream, sourcePageIndex));
  }

  return { streams, objectRefs: [...objectRefs.values()] };
}

function inspectContentStream(
  stream: PDFRawStream,
  sourcePageIndex: number
): ContentStreamDescriptor {
  const filterObject = stream.dict.lookup(PDFName.of("Filter"));
  let filterNames: string[] = [];
  if (filterObject instanceof PDFName) {
    filterNames = [decodePdfName(filterObject)];
  } else if (filterObject instanceof PDFArray) {
    filterNames = [];
    for (let index = 0; index < filterObject.size(); index += 1) {
      const filter = filterObject.lookup(index);
      if (!(filter instanceof PDFName)) {
        throw invalidPageStructure(sourcePageIndex, "A content Filter entry is not a name.");
      }
      filterNames.push(decodePdfName(filter));
    }
  } else if (filterObject) {
    throw invalidPageStructure(sourcePageIndex, "A content Filter is not a name or array.");
  }

  for (const filterName of filterNames) {
    if (!SUPPORTED_CONTENT_FILTERS.has(filterName)) {
      throw new PreflightRejection(
        "unsupported-filter",
        `PDF page ${sourcePageIndex + 1} uses unsupported content filter /${filterName}.`,
        { sourcePageIndex, filterName }
      );
    }
  }

  const decodeParms = stream.dict.lookup(PDFName.of("DecodeParms"));
  validateDecodeParameters(decodeParms, filterNames, sourcePageIndex);
  const useNativeFlate =
    filterNames.length === 1 &&
    filterNames[0] === "FlateDecode" &&
    decodeParametersAreNativeFlateSafe(decodeParms);
  if (useNativeFlate && typeof DecompressionStream !== "function") {
    throw new PreflightRejection(
      "unsupported-filter",
      `PDF page ${sourcePageIndex + 1} requires native Flate decompression, but DecompressionStream is unavailable.`,
      { sourcePageIndex, filterName: "FlateDecode" }
    );
  }
  return { stream, filters: filterNames, useNativeFlate };
}

function validateDecodeParameters(
  decodeParms: PDFObject | undefined,
  filters: readonly string[],
  sourcePageIndex: number
): void {
  if (!decodeParms) {
    return;
  }
  if (decodeParms instanceof PDFArray) {
    if (decodeParms.size() > filters.length) {
      throw invalidPageStructure(sourcePageIndex, "DecodeParms has more entries than Filter.");
    }
    for (let index = 0; index < decodeParms.size(); index += 1) {
      const entry = decodeParms.lookup(index);
      if (entry) {
        validateSingleDecodeParameters(entry, filters[index], sourcePageIndex);
      }
    }
    return;
  }
  validateSingleDecodeParameters(decodeParms, filters[0], sourcePageIndex);
}

function validateSingleDecodeParameters(
  params: PDFObject,
  filter: string | undefined,
  sourcePageIndex: number
): void {
  if (!(params instanceof PDFDict)) {
    throw invalidPageStructure(sourcePageIndex, "DecodeParms is not a dictionary or array.");
  }
  if (filter === "LZWDecode") {
    const earlyChange = params.lookup(PDFName.of("EarlyChange"));
    if (
      earlyChange &&
      (!(earlyChange instanceof PDFNumber) ||
        (earlyChange.asNumber() !== 0 && earlyChange.asNumber() !== 1))
    ) {
      throw invalidPageStructure(sourcePageIndex, "LZW EarlyChange is not 0 or 1.");
    }
  }
  const predictor = params.lookup(PDFName.of("Predictor"));
  if (predictor && !(predictor instanceof PDFNumber)) {
    throw invalidPageStructure(sourcePageIndex, "A content-stream Predictor is not a number.");
  }
  if (predictor && predictor.asNumber() !== 1) {
    throw new PreflightRejection(
      "unsupported-filter",
      `PDF page ${sourcePageIndex + 1} uses an unsupported content-stream predictor.`,
      { sourcePageIndex, filterName: filter }
    );
  }
}

function decodeParametersAreNativeFlateSafe(decodeParms: PDFObject | undefined): boolean {
  if (!decodeParms) {
    return true;
  }
  const params = decodeParms instanceof PDFArray ? decodeParms.lookup(0) : decodeParms;
  if (!params) {
    return true;
  }
  if (!(params instanceof PDFDict)) {
    return false;
  }
  const predictor = params.lookup(PDFName.of("Predictor"));
  return !predictor || (predictor instanceof PDFNumber && predictor.asNumber() === 1);
}

function copyRetainedResources(
  outputContext: PDFContext,
  copier: PDFObjectCopier,
  page: DensePdfPrivatePage,
  compiledPage: DensePdfCompiledPage
): PDFDict {
  const resources = outputContext.obj({});
  const fonts = copyNamedResourceDictionary(
    outputContext,
    copier,
    page.fontResources,
    page.fontNames,
    compiledPage.referencedFonts,
    "Font",
    page.publicPage.sourcePageIndex
  );
  if (fonts.keys().length > 0) {
    resources.set(PDFName.Font, fonts);
  }
  const properties = copyNamedResourceDictionary(
    outputContext,
    copier,
    page.propertyResources,
    page.propertyNames,
    compiledPage.referencedProperties,
    "Properties",
    page.publicPage.sourcePageIndex
  );
  if (properties.keys().length > 0) {
    resources.set(PDFName.of("Properties"), properties);
  }
  const extGStates = copyNamedResourceDictionary(
    outputContext,
    copier,
    page.extGStateResources,
    page.extGStateNames,
    compiledPage.referencedExtGStates ?? new Set(),
    "ExtGState",
    page.publicPage.sourcePageIndex
  );
  if (extGStates.keys().length > 0) {
    resources.set(PDFName.ExtGState, extGStates);
  }
  const xObjects = copyNamedResourceDictionary(
    outputContext,
    copier,
    page.xObjectResources,
    page.xObjectNames,
    compiledPage.referencedXObjects,
    "XObject",
    page.publicPage.sourcePageIndex
  );
  if (xObjects.keys().length > 0) {
    resources.set(PDFName.XObject, xObjects);
  }
  if (page.procSetResource) {
    resources.set(PDFName.of("ProcSet"), copier.copy(page.procSetResource));
  }
  return resources;
}

function copyNamedResourceDictionary(
  outputContext: PDFContext,
  copier: PDFObjectCopier,
  sourceDictionary: PDFDict | null,
  sourceNames: ReadonlyMap<string, PDFName>,
  requestedNames: ReadonlySet<string>,
  resourceKind: "ExtGState" | "Font" | "Properties" | "XObject",
  sourcePageIndex: number
): PDFDict {
  const output = outputContext.obj({});
  for (const requestedName of requestedNames) {
    const normalizedName = normalizeCompilerResourceName(requestedName);
    const sourceName = sourceNames.get(normalizedName);
    const sourceValue = sourceName && sourceDictionary?.get(sourceName);
    if (!sourceName || !sourceValue) {
      throw new DensePdfBuildError(
        "missing-resource",
        `Compiler retained missing ${resourceKind} resource /${normalizedName} on PDF page ${sourcePageIndex + 1}.`
      );
    }
    output.set(sourceName.clone(), copier.copy(sourceValue));
  }
  return output;
}

function copyPageGeometry(outputPage: PDFPage, sourcePage: DensePdfSelectedPage): void {
  const context = outputPage.doc.context;
  outputPage.node.set(PDFName.MediaBox, context.obj(boxToArray(sourcePage.mediaBox)));
  outputPage.node.set(PDFName.CropBox, context.obj(boxToArray(sourcePage.cropBox)));
  if (sourcePage.bleedBox) {
    outputPage.node.set(PDFName.BleedBox, context.obj(boxToArray(sourcePage.bleedBox)));
  }
  if (sourcePage.trimBox) {
    outputPage.node.set(PDFName.TrimBox, context.obj(boxToArray(sourcePage.trimBox)));
  }
  if (sourcePage.artBox) {
    outputPage.node.set(PDFName.ArtBox, context.obj(boxToArray(sourcePage.artBox)));
  }
  outputPage.node.set(PDFName.Rotate, context.obj(sourcePage.rotation));
  outputPage.node.set(PDFName.of("UserUnit"), context.obj(sourcePage.userUnit));
}

function validateCompiledPages(
  sourcePages: readonly DensePdfPrivatePage[],
  compiledPages: readonly DensePdfCompiledPage[]
): Map<number, DensePdfCompiledPage> {
  if (compiledPages.length !== sourcePages.length) {
    throw new DensePdfBuildError(
      "compiled-page-mismatch",
      `Expected ${sourcePages.length} compiled page(s), received ${compiledPages.length}.`
    );
  }
  const expected = new Set(sourcePages.map((page) => page.publicPage.sourcePageIndex));
  const out = new Map<number, DensePdfCompiledPage>();
  for (const page of compiledPages) {
    if (
      !Number.isSafeInteger(page.sourcePageIndex) ||
      !expected.has(page.sourcePageIndex) ||
      out.has(page.sourcePageIndex) ||
      !(page.retainedTextContent instanceof Uint8Array) ||
      !isReadonlyStringSet(page.referencedFonts) ||
      !isReadonlyStringSet(page.referencedProperties) ||
      (page.referencedExtGStates !== undefined &&
        !isReadonlyStringSet(page.referencedExtGStates)) ||
      !isReadonlyStringSet(page.referencedXObjects)
    ) {
      throw new DensePdfBuildError(
        "compiled-page-mismatch",
        "Compiled pages do not match the selected source pages or contain invalid data."
      );
    }
    out.set(page.sourcePageIndex, page);
  }
  return out;
}

function releaseSourceContentObjects(document: DensePdfPrivateDocument): number {
  const refs = new Map<string, PDFRef>();
  const context = document.sourceDocument.context;
  for (const sourcePage of document.sourceDocument.getPages()) {
    const rawContents = sourcePage.node.get(PDFName.Contents);
    if (rawContents) {
      collectContentObjectRefs(rawContents, context, refs);
    }
    sourcePage.node.delete(PDFName.Contents);
  }
  let released = 0;
  for (const ref of refs.values()) {
    if (context.delete(ref)) {
      released += 1;
    }
  }

  // The destination document already owns deep copies of every retained
  // resource. Clear the remaining source object table as well, so embedded
  // font streams and unreachable source objects do not overlap the writer's
  // peak memory. In particular, no original page content stream can survive
  // into outputDocument.save().
  for (const [ref] of context.enumerateIndirectObjects()) {
    context.delete(ref);
  }
  for (const page of document.pages) {
    page.streams.length = 0;
    page.contentObjectRefs.length = 0;
    const visitedForms = new Set<DensePdfPrivateFormXObject>();
    for (const form of page.formXObjects) {
      releaseFormContentObjects(form, visitedForms);
    }
  }
  document.released = true;
  return released;
}

function releaseFormContentObjects(
  form: DensePdfPrivateFormXObject,
  visited: Set<DensePdfPrivateFormXObject>
): void {
  if (visited.has(form)) return;
  visited.add(form);
  form.descriptor = null;
  for (const nested of form.nestedForms.values()) {
    if (nested) releaseFormContentObjects(nested, visited);
  }
}

function collectContentObjectRefs(
  rawContents: PDFObject,
  context: PDFContext,
  refs: Map<string, PDFRef>
): void {
  if (rawContents instanceof PDFRef) {
    refs.set(rawContents.tag, rawContents);
  }
  const contents = context.lookup(rawContents);
  if (contents instanceof PDFArray) {
    for (const rawStream of contents.asArray()) {
      if (rawStream instanceof PDFRef) {
        refs.set(rawStream.tag, rawStream);
      }
      const stream = context.lookup(rawStream);
      const streamRef = stream ? context.getObjectRef(stream) : undefined;
      if (streamRef) {
        refs.set(streamRef.tag, streamRef);
      }
    }
    return;
  }
  const streamRef = contents ? context.getObjectRef(contents) : undefined;
  if (streamRef) {
    refs.set(streamRef.tag, streamRef);
  }
}

function readUserUnit(
  page: PDFPage,
  context: PDFContext,
  sourcePageIndex: number
): number {
  const raw = page.node.getInheritableAttribute(PDFName.of("UserUnit"));
  if (!raw) {
    return 1;
  }
  const value = context.lookup(raw);
  if (!(value instanceof PDFNumber) || !Number.isFinite(value.asNumber()) || value.asNumber() <= 0) {
    throw invalidPageStructure(sourcePageIndex, "UserUnit is not a positive number.");
  }
  return value.asNumber();
}

function readPageBox(
  array: PDFArray,
  label: string,
  sourcePageIndex: number
): DensePdfPageBox {
  if (array.size() !== 4) {
    throw invalidPageStructure(sourcePageIndex, `${label} does not contain four numbers.`);
  }
  const values: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const value = array.lookup(index);
    if (!(value instanceof PDFNumber) || !Number.isFinite(value.asNumber())) {
      throw invalidPageStructure(sourcePageIndex, `${label} contains a non-finite number.`);
    }
    values.push(value.asNumber());
  }
  if (!(values[2] > values[0]) || !(values[3] > values[1])) {
    throw invalidPageStructure(sourcePageIndex, `${label} has non-positive dimensions.`);
  }
  return {
    left: values[0],
    bottom: values[1],
    right: values[2],
    top: values[3]
  };
}

function readOptionalPageBox(
  array: PDFArray | undefined,
  label: string,
  sourcePageIndex: number
): DensePdfPageBox | undefined {
  return array ? readPageBox(array, label, sourcePageIndex) : undefined;
}

function readResourceNames(dictionary: PDFDict | null): ReadonlyMap<string, PDFName> {
  const names = new Map<string, PDFName>();
  for (const key of dictionary?.keys() ?? []) {
    names.set(decodePdfName(key), key);
  }
  return names;
}

function readResourceDependencies(
  dictionary: PDFDict | null,
  context: PDFContext
): readonly DensePdfResourceDependency[] {
  const dependencies: DensePdfResourceDependency[] = [];
  for (const [name, rawValue] of dictionary?.entries() ?? []) {
    const value = context.lookup(rawValue);
    dependencies.push(Object.freeze({
      resourceName: decodePdfName(name),
      dependencyKey: resourceDependencyKey(
        rawValue,
        value,
        `direct-resource:${decodePdfName(name)}`
      )
    }));
  }
  dependencies.sort((left, right) => left.resourceName.localeCompare(right.resourceName));
  return Object.freeze(dependencies);
}

function resourceDependencyKey(
  rawValue: PDFObject,
  resolvedValue: PDFObject | undefined,
  fallback: string
): string {
  if (rawValue instanceof PDFRef) return rawValue.tag;
  if (typeof resolvedValue === "object" && resolvedValue !== null) {
    const cached = directResourceDependencyKeys.get(resolvedValue);
    if (cached) return cached;
    const key = `${fallback}:${nextDirectResourceDependencyKey++}`;
    directResourceDependencyKeys.set(resolvedValue, key);
    return key;
  }
  return fallback;
}

function lookupResourceDictionary(
  resources: PDFDict | undefined,
  key: PDFName,
  context: PDFContext
): PDFDict | null {
  const raw = resources?.get(key);
  if (!raw) {
    return null;
  }
  const value = context.lookup(raw);
  return value instanceof PDFDict ? value : null;
}

function normalizeCompilerResourceName(value: string): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
}

function isReadonlyStringSet(value: unknown): value is ReadonlySet<string> {
  if (!(value instanceof Set)) {
    return false;
  }
  for (const item of value) {
    if (typeof item !== "string" || normalizeCompilerResourceName(item).length === 0) {
      return false;
    }
  }
  return true;
}

function decodePdfName(name: PDFName): string {
  return name.decodeText();
}

function boxToArray(box: DensePdfPageBox): [number, number, number, number] {
  return [box.left, box.bottom, box.right, box.top];
}

function cloneBox(box: DensePdfPageBox): DensePdfPageBox {
  return { ...box };
}

function invalidPageStructure(sourcePageIndex: number, detail: string): PreflightRejection {
  return new PreflightRejection(
    "invalid-structure",
    `PDF page ${sourcePageIndex + 1} has an invalid structure: ${detail}`,
    { sourcePageIndex }
  );
}

function normalizeDecodeChunkSize(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_DECODE_CHUNK_SIZE;
  }
  if (!Number.isSafeInteger(value) || value < MIN_DECODE_CHUNK_SIZE || value > MAX_DECODE_CHUNK_SIZE) {
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
    for (let pageNumber = firstPage; pageNumber <= lastPage; pageNumber += 1) {
      seen.add(pageNumber);
    }
  }
  return Array.from(seen).sort((left, right) => left - right);
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
